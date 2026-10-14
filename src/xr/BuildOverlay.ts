/**
 * Det som tegnes oppå gjennomsynet når man måler opp en ny modell
 * (byggerens ramme, meter): trådskjelettet av rommene som er målt (gulv- og
 * takkant, hjørnestolper, dører og vinduer), og det som måles nå – berørte
 * punkter, veggene som linjer, hjørnene der de møtes, og et spøkelseshjørne
 * som viser hvor neste hjørne havner.
 *
 * Tegningen og oppmålingen er hver sin sammenslåtte mesh, og bygges bare på
 * nytt når noe endres (ikke hver ramme).
 */
import * as THREE from 'three';
import { edgesOf, type P2 } from '../builder/geometry';
import type { Line, P3 } from '../builder/capture';
import type { BuilderDoc } from '../builder/types';
import { MM } from '../scene/geom';
import { GeoBuilder } from './MeasureOverlay';

const COLOR = {
  floor: new THREE.Color('#ffffff'),
  ceiling: new THREE.Color('#8fd3ff'),
  post: new THREE.Color('#d9e6f2'),
  opening: new THREE.Color('#ffd400'),
  highlight: new THREE.Color('#ff9f1a'),
  touch: new THREE.Color('#2fe07a'),
  line: new THREE.Color('#18d4ff'),
  corner: new THREE.Color('#ff9f1a'),
  closed: new THREE.Color('#2fe07a'),
};

const W = 0.005;
const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x * MM, y * MM, z * MM);

export interface CaptureView {
  walls: readonly (readonly P2[])[];
  /** Høyden (mm) der hver vegg ble berørt (for å tegne linjene der). */
  heights: readonly number[];
  lines: readonly Line[];
  corners: readonly (P2 | null)[];
  /** Rommet er lukket (venter på gulv og tak). */
  polygon: readonly P2[] | null;
  /** Berøringer for en åpning (mm). */
  touches: readonly P3[];
}

export class BuildOverlay {
  readonly root = new THREE.Group();
  private readonly rooms: THREE.Mesh;
  private readonly capture: THREE.Mesh;
  readonly ghost: THREE.Mesh;
  private triangles = 0;

  constructor() {
    this.root.name = 'ny-modell';
    const mat = (): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({ toneMapped: false, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });
    this.rooms = new THREE.Mesh(new THREE.BufferGeometry(), mat());
    this.capture = new THREE.Mesh(new THREE.BufferGeometry(), mat());
    this.rooms.renderOrder = 10;
    this.capture.renderOrder = 11;
    this.ghost = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 16, 10),
      new THREE.MeshBasicMaterial({ toneMapped: false, color: COLOR.line, transparent: true, opacity: 0.7, depthTest: false }),
    );
    this.ghost.renderOrder = 12;
    this.ghost.visible = false;
    for (const m of [this.rooms, this.capture]) m.frustumCulled = false;
    this.root.add(this.rooms, this.capture, this.ghost);
  }

  /** Trådskjelettet av tegningen. `highlight`: rommet som måles på nytt. */
  buildRooms(doc: BuilderDoc | null, highlight: string | null): void {
    const g = new GeoBuilder();
    for (const r of doc?.rooms ?? []) {
      if (r.polygon.length < 3) continue;
      const hi = r.id === highlight;
      const top = (i: number): number => r.floor + (r.ceilingCorners?.[i] ?? r.ceiling);
      r.polygon.forEach((p, i) => {
        const q = r.polygon[(i + 1) % r.polygon.length]!;
        g.bar(v(p.x, r.floor, p.z), v(q.x, r.floor, q.z), W, hi ? COLOR.highlight : COLOR.floor);
        g.bar(v(p.x, top(i), p.z), v(q.x, top((i + 1) % r.polygon.length), q.z), W * 0.8, hi ? COLOR.highlight : COLOR.ceiling);
        g.bar(v(p.x, r.floor, p.z), v(p.x, top(i), p.z), W * 0.8, hi ? COLOR.highlight : COLOR.post);
      });
      const edges = edgesOf(r.polygon);
      for (const o of doc!.openings) {
        if (o.room !== r.id) continue;
        const e = edges[o.edge];
        if (!e) continue;
        const a = { x: e.a.x + e.u.x * o.offset, z: e.a.z + e.u.z * o.offset };
        const b = { x: a.x + e.u.x * o.width, z: a.z + e.u.z * o.width };
        const y0 = r.floor + (o.type === 'window' ? (o.sill ?? 900) : 0);
        const y1 = y0 + o.height;
        g.bar(v(a.x, y0, a.z), v(a.x, y1, a.z), W, COLOR.opening);
        g.bar(v(b.x, y0, b.z), v(b.x, y1, b.z), W, COLOR.opening);
        g.bar(v(a.x, y1, a.z), v(b.x, y1, b.z), W, COLOR.opening);
        if (o.type === 'window') g.bar(v(a.x, y0, a.z), v(b.x, y0, b.z), W, COLOR.opening);
      }
    }
    this.swap(this.rooms, g);
  }

  /** Det som måles nå. */
  buildCapture(c: CaptureView | null): void {
    const g = new GeoBuilder();
    if (c) {
      c.walls.forEach((pts, i) => {
        const h = c.heights[i] ?? 1000;
        for (const p of pts) g.ball(v(p.x, h, p.z), 0.012, COLOR.touch);
        const l = c.lines[i];
        if (l && !c.polygon) {
          // Linja langs veggen, 1,5 m til hver side av berøringene.
          const mid = pts.reduce((s, p) => ({ x: s.x + p.x / pts.length, z: s.z + p.z / pts.length }), { x: 0, z: 0 });
          const t = (mid.x - l.p.x) * l.u.x + (mid.z - l.p.z) * l.u.z;
          const cx = l.p.x + l.u.x * t;
          const cz = l.p.z + l.u.z * t;
          g.bar(v(cx - l.u.x * 1500, h, cz - l.u.z * 1500), v(cx + l.u.x * 1500, h, cz + l.u.z * 1500), W * 0.7, COLOR.line);
        }
      });
      const h = c.heights.length ? c.heights.reduce((s, x) => s + x, 0) / c.heights.length : 1000;
      if (c.polygon) {
        c.polygon.forEach((p, i) => {
          const q = c.polygon![(i + 1) % c.polygon!.length]!;
          g.bar(v(p.x, h, p.z), v(q.x, h, q.z), W * 1.2, COLOR.closed);
          g.bar(v(p.x, h - 300, p.z), v(p.x, h + 300, p.z), W, COLOR.closed);
        });
      } else
        for (const p of c.corners) if (p) g.bar(v(p.x, h - 300, p.z), v(p.x, h + 300, p.z), W * 1.2, COLOR.corner);
      for (const t of c.touches) g.ball(v(t.x, t.y, t.z), 0.012, COLOR.opening);
    }
    this.swap(this.capture, g);
  }

  /** Spøkelseshjørnet (mm) eller null. */
  setGhost(p: P3 | null): void {
    this.ghost.visible = p !== null;
    if (p) this.ghost.position.set(p.x * MM, p.y * MM, p.z * MM);
  }

  private swap(mesh: THREE.Mesh, g: GeoBuilder): void {
    const before = (mesh.geometry.getIndex()?.count ?? 0) / 3;
    mesh.geometry.dispose();
    mesh.geometry = g.build();
    this.triangles += (mesh.geometry.getIndex()?.count ?? 0) / 3 - before;
  }

  stats(): { triangles: number } {
    return { triangles: this.triangles };
  }

  dispose(): void {
    this.rooms.geometry.dispose();
    this.capture.geometry.dispose();
    (this.rooms.material as THREE.Material).dispose();
    (this.capture.material as THREE.Material).dispose();
    this.ghost.geometry.dispose();
    (this.ghost.material as THREE.Material).dispose();
  }
}
