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
import { buildContactShade } from './shade';
import { Materials } from './materials';
import { Baker, BAKED_KINDS, TESSELLATED_KINDS, tessellate } from './bake';
import { buildSunPatches, buildSunShafts } from './sunlight';
import { buildLampGlow } from './lamps';
import { floorSurface, SURF } from './detail';
import { LIGHTING, type LightPreset } from './lighting';

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
  /** Fargene med bakt dagslys (bake.ts). */
  bakedColors: Float32Array;
  measureColors: Float32Array;
}

/** Lyseffektene som er slått på (fra grafikkprofilen). */
export interface SceneEffects {
  /** Kontaktskygger under møbler. */
  shades: boolean;
  /** Bakt dagslys i fargene. */
  baked: boolean;
  /** Solflekker gjennom vinduene. */
  sun: boolean;
  /** Lysstråler fra vinduene. */
  shafts: boolean;
  /** Lampelys (når lyset har lamper på). */
  lamps: boolean;
  /** Mønster på gulvet (tre og fliser). */
  detail: boolean;
}

export const DEFAULT_EFFECTS: SceneEffects = { shades: true, baked: true, sun: true, shafts: false, lamps: true, detail: true };

/** Filter for installasjoner (kabler, rør, el- og vannpunkter). */
export interface PartFilter {
  existing: boolean;
  planned: boolean;
  /** Vis bare denne kursen (null = alle). */
  circuit: string | null;
}

export const NO_FILTER: PartFilter = { existing: true, planned: true, circuit: null };

export const passes = (p: { status?: string; circuit?: string; kind: string }, f: PartFilter): boolean => {
  if (p.status === 'existing' && !f.existing) return false;
  if (p.status === 'planned' && !f.planned) return false;
  if (f.circuit && (p.kind === 'wire' || p.circuit !== undefined) && p.circuit !== f.circuit) return false;
  return true;
};

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
  /** Myke skygger under møbler; av i «Rask». */
  readonly shades: THREE.Mesh[] = [];
  /** Solflekker, lysstråler og lampelys (bygges på nytt når «Lys» endres). */
  readonly lightMeshes: THREE.Mesh[] = [];
  private effects: SceneEffects = { ...DEFAULT_EFFECTS };
  private light: LightPreset = LIGHTING;
  private ceilingsOn = true;
  private parts: Part[] = [];
  private model: ApartmentModel | null = null;
  /** Oppdelt geometri og bakte lysfaktorer per del (regnes ut én gang per modell). */
  private readonly render = new Map<Part, { geo: THREE.BufferGeometry; bake: Float32Array }>();
  /** Overflaten på gulvet i hvert rom (tre eller fliser). */
  private readonly floorSurf = new Map<string, number>();
  private measureOn = false;
  private filter: PartFilter = NO_FILTER;
  /** Treffflatene i synlige lag; bygges på nytt bare når lag/tak endres (ikke hver ramme). */
  private visibleCache: THREE.Mesh[] | null = null;

  constructor(readonly materials: Materials) {
    this.root.name = 'leilighet';
  }

  build(model: ApartmentModel): void {
    this.clear();
    this.visibleCache = null;
    this.model = model;
    this.parts = buildParts(model);
    const baker = new Baker(model);
    for (const id of model.rooms.keys()) this.floorSurf.set(id, floorSurface(model, id));
    for (const p of this.parts) {
      if (p.bucket !== 'solid' && p.bucket !== 'wall' && p.bucket !== 'ceiling') continue;
      if (!BAKED_KINDS.has(p.kind)) continue;
      const geo = TESSELLATED_KINDS.has(p.kind) ? tessellate(p.geometry) : p.geometry;
      this.render.set(p, { geo, bake: baker.factors(geo, p.kind, p.id) });
    }

    for (const layer of model.data.layers) {
      const g = new THREE.Group();
      g.name = `lag:${layer.id}`;
      g.visible = layer.visible;
      this.layerGroups.set(layer.id, g);
      this.root.add(g);
    }

    this.merge();

    for (const [layer, geo] of buildContactShade(model)) {
      const mesh = new THREE.Mesh(geo, this.materials.shade);
      mesh.name = `skygge:møbel:${layer}`;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = 1;
      mesh.visible = this.effects.shades;
      this.shades.push(mesh);
      this.layerGroups.get(layer)?.add(mesh);
    }
    this.buildLight();

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

  /** Slår sammen delene (som passerer filteret) til én mesh per lag og materiale. */
  private merge(): void {
    for (const m of this.merged) {
      m.mesh.removeFromParent();
      m.mesh.geometry.dispose();
    }
    this.merged.length = 0;
    this.ranges.clear();
    const buckets = new Map<string, Part[]>();
    for (const p of this.parts) {
      if (!passes(p, this.filter)) continue;
      const key = `${p.layer}|${p.bucket}`;
      const list = buckets.get(key) ?? [];
      list.push(p);
      buckets.set(key, list);
    }
    for (const [key, list] of buckets) {
      const [layer, bucket] = key.split('|') as [string, Bucket];
      this.mergeBucket(layer, bucket, list);
    }
  }

  /** Endrer filteret for installasjoner; slår sammen på nytt uten å bygge geometrien igjen. */
  setFilter(f: PartFilter): void {
    if (f.existing === this.filter.existing && f.planned === this.filter.planned && f.circuit === this.filter.circuit) return;
    this.filter = { ...f };
    if (!this.parts.length) return;
    this.merge();
    this.setCeilingsVisible(this.ceilingsOn);
    if (this.measureOn) this.setMeasureHighlight(true);
  }

  private mergeBucket(layer: string, bucket: Bucket, list: Part[]): void {
    let count = 0;
    for (const p of list) count += (this.render.get(p)?.geo ?? p.geometry).getAttribute('position').count;
    const pos = new Float32Array(count * 3);
    const nrm = new Float32Array(count * 3);
    const baseColors = new Float32Array(count * 3);
    const bakedColors = new Float32Array(count * 3);
    const measureColors = new Float32Array(count * 3);
    // Overflaten per hjørne (mønsteret på gulvet; bare i «solid»).
    const surf = bucket === 'solid' ? new Float32Array(count) : null;
    const tmp = new THREE.Color();
    const merged: MergedMesh = {
      mesh: new THREE.Mesh(),
      layer,
      bucket,
      baseColors,
      bakedColors,
      measureColors,
    };
    let offset = 0;
    for (const p of list) {
      const r = this.render.get(p);
      const geo = r?.geo ?? p.geometry;
      const pa = geo.getAttribute('position').array as Float32Array;
      const na = geo.getAttribute('normal').array as Float32Array;
      const n = pa.length / 3;
      pos.set(pa, offset * 3);
      nrm.set(na, offset * 3);
      const tint = TINT[p.measure];
      tmp.copy(p.color).lerp(tint.color, tint.amount);
      if (surf && p.kind === 'floor') surf.fill(this.floorSurf.get(p.id) ?? SURF.none, offset, offset + n);
      for (let i = 0; i < n; i++) {
        const j = (offset + i) * 3;
        const f = r ? r.bake[i]! : 1;
        baseColors[j] = p.color.r;
        baseColors[j + 1] = p.color.g;
        baseColors[j + 2] = p.color.b;
        bakedColors[j] = p.color.r * f;
        bakedColors[j + 1] = p.color.g * f;
        bakedColors[j + 2] = p.color.b * f;
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
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.colorsFor(merged)), 3));
    if (surf) geo.setAttribute('surf', new THREE.BufferAttribute(surf, 1));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const mesh = merged.mesh;
    mesh.geometry = geo;
    mesh.material = this.materials.for(bucket);
    mesh.name = `${layer}:${bucket}`;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    if (bucket === 'glass' || bucket === 'overlay') mesh.renderOrder = 2;
    // Installasjoner tegnes etter bygningen (oppå i 2D-planen).
    if (bucket === 'lines') mesh.renderOrder = 3;
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

  /** Slår lyseffektene av og på (fra grafikkprofilen). */
  setEffects(e: SceneEffects): void {
    const bakedChanged = e.baked !== this.effects.baked;
    this.effects = { ...e };
    for (const m of this.shades) m.visible = e.shades;
    this.materials.setDetail(e.detail);
    this.applyLightVisibility();
    if (bakedChanged) this.applyColors();
  }

  get currentEffects(): Readonly<SceneEffects> {
    return this.effects;
  }

  /** Bytter lys (morgen/dag/kveld): solflekker og lamper bygges på nytt. */
  setLight(preset: LightPreset): void {
    if (preset === this.light) return;
    this.light = preset;
    if (this.model) this.buildLight();
  }

  /** Solflekker, lysstråler og lampelys for lyset som er valgt. */
  private buildLight(): void {
    for (const m of this.lightMeshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    this.lightMeshes.length = 0;
    const model = this.model;
    if (!model) return;
    const p = this.light;
    this.materials.sun.color.set(p.sun.color);
    this.materials.sun.opacity = p.sun.strength;
    this.materials.glow.color.set(p.sun.color);
    const add = (kind: 'sol' | 'stråler' | 'lamper', geos: Map<string, THREE.BufferGeometry>, material: THREE.Material): void => {
      for (const [layer, geo] of geos) {
        const mesh = new THREE.Mesh(geo, material);
        mesh.name = `lys:${kind}:${layer}`;
        mesh.userData.effect = kind;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = 1;
        this.lightMeshes.push(mesh);
        this.layerGroups.get(layer)?.add(mesh);
      }
    };
    add('sol', buildSunPatches(model, p.key.from), this.materials.sun);
    add('stråler', buildSunShafts(model, p.key.from), this.materials.glow);
    if (p.lamps > 0) add('lamper', buildLampGlow(model, p.lamps), this.materials.lamp);
    this.applyLightVisibility();
  }

  private applyLightVisibility(): void {
    const e = this.effects;
    for (const m of this.lightMeshes) {
      const kind = m.userData.effect as string;
      m.visible = kind === 'sol' ? e.sun : kind === 'stråler' ? e.shafts : e.lamps;
    }
  }

  setCeilingsVisible(visible: boolean): void {
    for (const m of this.merged) if (m.bucket === 'ceiling') m.mesh.visible = visible;
    this.ceilingsOn = visible;
    this.visibleCache = null;
  }

  /** Farger objekter etter målestatus (oransje = plassholder, gul = delvis, grønn = målt). */
  setMeasureHighlight(on: boolean): void {
    this.measureOn = on;
    this.applyColors();
  }

  private colorsFor(m: MergedMesh): Float32Array {
    return this.measureOn ? m.measureColors : this.effects.baked ? m.bakedColors : m.baseColors;
  }

  private applyColors(): void {
    for (const m of this.merged) {
      const attr = m.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
      (attr.array as Float32Array).set(this.colorsFor(m));
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
    const meshes = [...this.merged.map((m) => m.mesh), ...this.shades, ...this.lightMeshes];
    for (const m of meshes) triangles += m.geometry.getAttribute('position').count / 3;
    return { meshes: meshes.length, triangles, proxies: this.proxies.length };
  }

  clear(): void {
    for (const m of this.merged) m.mesh.geometry.dispose();
    for (const m of [...this.shades, ...this.lightMeshes]) m.geometry.dispose();
    this.shades.length = 0;
    this.lightMeshes.length = 0;
    for (const r of this.render.values()) if (!this.parts.some((p) => p.geometry === r.geo)) r.geo.dispose();
    this.render.clear();
    this.floorSurf.clear();
    for (const p of this.parts) p.geometry.dispose();
    this.merged.length = 0;
    this.proxies.length = 0;
    this.parts = [];
    this.ranges.clear();
    this.layerGroups.clear();
    this.root.clear();
  }
}
