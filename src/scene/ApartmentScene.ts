/**
 * ApartmentScene: gjør modellen om til three.js-objekter.
 *
 * - Statisk geometri slås sammen til én mesh per (lag, materialgruppe), med
 *   vertex-farger. Hele leiligheten blir da ca. 15–20 tegnekall.
 * - Hvert objekt får i tillegg en usynlig treffflate (proxy) med id og rolle,
 *   brukt til teleport nå og til å velge objekter når VR-redigering kommer.
 * - `ranges` husker hvor hvert objekt ligger i de sammenslåtte meshene, så et
 *   objekt kan markeres/byttes uten å bygge alt på nytt (fase 3).
 */
import * as THREE from 'three';
import type { ApartmentModel } from '../model/ApartmentModel';
import type { MeasureState } from '../schema/types';
import { buildParts, type Bucket, type Part, type PartKind, type PickRole } from './buildParts';
import { buildContactShade, buildRoomShade } from './shade';
import { Materials } from './materials';

export interface ProxyData {
  id: string;
  kind: PartKind;
  layer: string;
  pick: PickRole;
}

export interface MergedMesh {
  mesh: THREE.Mesh;
  layer: string;
  bucket: Bucket;
  baseColors: Float32Array;
  measureColors: Float32Array;
}

export interface Range {
  mesh: MergedMesh;
  start: number;
  count: number;
}

const TINT: Record<MeasureState, { color: THREE.Color; amount: number }> = {
  placeholder: { color: new THREE.Color('#ff7b00'), amount: 0.55 },
  partial: { color: new THREE.Color('#ffd400'), amount: 0.5 },
  measured: { color: new THREE.Color('#1fbf5f'), amount: 0.45 },
};

export class ApartmentScene {
  /** Alt som kommer fra apartment.json. */
  readonly root = new THREE.Group();
  readonly layerGroups = new Map<string, THREE.Group>();
  readonly merged: MergedMesh[] = [];
  readonly proxies: THREE.Mesh[] = [];
  readonly ranges = new Map<string, Range[]>();
  /** Myke skygger (gulv/tak/hjørner og under møbler); av i «Rask». */
  readonly shades: THREE.Mesh[] = [];
  private shadeOn = true;
  private ceilingsOn = true;
  private parts: Part[] = [];
  private measureOn = false;
  /** Treffflatene i synlige lag; bygges på nytt bare når lag/tak endres (ikke hver ramme). */
  private visibleCache: THREE.Mesh[] | null = null;

  constructor(readonly materials: Materials) {
    this.root.name = 'leilighet';
  }

  build(model: ApartmentModel): void {
    this.clear();
    this.visibleCache = null;
    this.parts = buildParts(model);

    for (const layer of model.data.layers) {
      const g = new THREE.Group();
      g.name = `lag:${layer.id}`;
      g.visible = layer.visible;
      this.layerGroups.set(layer.id, g);
      this.root.add(g);
    }

    // Grupper per lag + materiale.
    const buckets = new Map<string, Part[]>();
    for (const p of this.parts) {
      const key = `${p.layer}|${p.bucket}`;
      const list = buckets.get(key) ?? [];
      list.push(p);
      buckets.set(key, list);
    }
    for (const [key, list] of buckets) {
      const [layer, bucket] = key.split('|') as [string, Bucket];
      this.mergeBucket(layer, bucket, list);
    }

    for (const [kind, geos] of [['vegg', buildRoomShade(model)], ['møbel', buildContactShade(model)]] as const) {
      for (const [key, geo] of geos) {
        const [layer = key, part] = key.split('|');
        const mesh = new THREE.Mesh(geo, this.materials.shade);
        mesh.name = `skygge:${kind}:${key}`;
        mesh.userData.ceiling = part === 'tak';
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = 1;
        mesh.visible = this.shadeOn && (!mesh.userData.ceiling || this.ceilingsOn);
        this.shades.push(mesh);
        this.layerGroups.get(layer)?.add(mesh);
      }
    }

    for (const p of this.parts) {
      if (p.pick === 'none') continue;
      const proxy = new THREE.Mesh(p.geometry, this.materials.proxy);
      proxy.userData = { id: p.id, kind: p.kind, layer: p.layer, pick: p.pick } satisfies ProxyData;
      proxy.matrixAutoUpdate = false;
      proxy.updateMatrixWorld(true);
      this.proxies.push(proxy);
    }
    if (this.measureOn) this.setMeasureHighlight(true);
  }

  private mergeBucket(layer: string, bucket: Bucket, list: Part[]): void {
    let count = 0;
    for (const p of list) count += p.geometry.getAttribute('position').count;
    const pos = new Float32Array(count * 3);
    const nrm = new Float32Array(count * 3);
    const baseColors = new Float32Array(count * 3);
    const measureColors = new Float32Array(count * 3);
    const tmp = new THREE.Color();
    const merged: MergedMesh = {
      mesh: new THREE.Mesh(),
      layer,
      bucket,
      baseColors,
      measureColors,
    };
    let offset = 0;
    for (const p of list) {
      const pa = p.geometry.getAttribute('position').array as Float32Array;
      const na = p.geometry.getAttribute('normal').array as Float32Array;
      const n = pa.length / 3;
      pos.set(pa, offset * 3);
      nrm.set(na, offset * 3);
      const tint = TINT[p.measure];
      tmp.copy(p.color).lerp(tint.color, tint.amount);
      for (let i = 0; i < n; i++) {
        const j = (offset + i) * 3;
        baseColors[j] = p.color.r;
        baseColors[j + 1] = p.color.g;
        baseColors[j + 2] = p.color.b;
        measureColors[j] = tmp.r;
        measureColors[j + 1] = tmp.g;
        measureColors[j + 2] = tmp.b;
      }
      const ranges = this.ranges.get(p.id) ?? [];
      ranges.push({ mesh: merged, start: offset, count: n });
      this.ranges.set(p.id, ranges);
      offset += n;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(baseColors), 3));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const mesh = merged.mesh;
    mesh.geometry = geo;
    mesh.material = this.materials.for(bucket);
    mesh.name = `${layer}:${bucket}`;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    if (bucket === 'glass' || bucket === 'overlay') mesh.renderOrder = 2;
    this.merged.push(merged);
    this.layerGroups.get(layer)?.add(mesh);
  }

  setLayerVisible(layer: string, visible: boolean): void {
    const g = this.layerGroups.get(layer);
    if (g) g.visible = visible;
    this.visibleCache = null;
  }

  isLayerVisible(layer: string): boolean {
    return this.layerGroups.get(layer)?.visible ?? false;
  }

  setShadesVisible(visible: boolean): void {
    this.shadeOn = visible;
    for (const m of this.shades) m.visible = visible && (!m.userData.ceiling || this.ceilingsOn);
  }

  setCeilingsVisible(visible: boolean): void {
    for (const m of this.merged) if (m.bucket === 'ceiling') m.mesh.visible = visible;
    this.ceilingsOn = visible;
    for (const m of this.shades) if (m.userData.ceiling) m.visible = visible && this.shadeOn;
    this.visibleCache = null;
  }

  /** Farger objekter etter målestatus (oransje = plassholder, gul = delvis, grønn = målt). */
  setMeasureHighlight(on: boolean): void {
    this.measureOn = on;
    for (const m of this.merged) {
      const attr = m.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
      (attr.array as Float32Array).set(on ? m.measureColors : m.baseColors);
      attr.needsUpdate = true;
    }
  }

  /** Treffflater i synlige lag (for teleport/valg). */
  visibleProxies(): THREE.Mesh[] {
    if (this.visibleCache) return this.visibleCache;
    const ceilings = this.merged.some((m) => m.bucket === 'ceiling' && m.mesh.visible);
    this.visibleCache = this.proxies.filter((p) => {
      const d = p.userData as ProxyData;
      if (!this.isLayerVisible(d.layer)) return false;
      return d.kind !== 'ceiling' || ceilings;
    });
    return this.visibleCache;
  }

  stats(): { meshes: number; triangles: number; proxies: number } {
    let triangles = 0;
    for (const m of this.merged) triangles += m.mesh.geometry.getAttribute('position').count / 3;
    for (const m of this.shades) triangles += m.geometry.getAttribute('position').count / 3;
    return { meshes: this.merged.length + this.shades.length, triangles, proxies: this.proxies.length };
  }

  clear(): void {
    for (const m of this.merged) m.mesh.geometry.dispose();
    for (const m of this.shades) m.geometry.dispose();
    this.shades.length = 0;
    for (const p of this.parts) p.geometry.dispose();
    this.merged.length = 0;
    this.proxies.length = 0;
    this.parts = [];
    this.ranges.clear();
    this.layerGroups.clear();
    this.root.clear();
  }
}
