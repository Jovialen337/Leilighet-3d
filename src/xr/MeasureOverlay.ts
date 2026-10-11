/**
 * Det som tegnes oppå gjennomsynet i oppmålingsmodus (i modellens
 * koordinater, meter): et trådskjelett av hvert rom (gulv- og takkant,
 * hjørnestolper), omrisset av dører/vinduer, installasjoner, punktene som
 * er målt, og et lysende merke der neste måling skal gjøres.
 *
 * Alt utenom merket slås sammen til to mesher (få tegnekall på Quest).
 */
import * as THREE from 'three';
import { frameAt, type ApartmentModel } from '../model/ApartmentModel';
import type { MeasureSession } from '../measure/MeasureSession';
import { taskKey, type TaskInfo } from '../measure/tasks';
import { MM } from '../scene/geom';

const COLOR = {
  measured: new THREE.Color('#2fe07a'),
  todo: new THREE.Color('#ff9f1a'),
  floor: new THREE.Color('#ffffff'),
  ceiling: new THREE.Color('#8fd3ff'),
  opening: new THREE.Color('#ffd400'),
  fixture: new THREE.Color('#ff6bd6'),
  dot: new THREE.Color('#2fe07a'),
  target: new THREE.Color('#18d4ff'),
};

const LINE = 0.006; // halv bredde (m) på strekene
const LABEL_W = 0.48;
const LABEL_H = 0.08;
const POST = 0.008;

/** Samler trekanter med farge per hjørne. */
class GeoBuilder {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];

  /** Firkantet stav fra a til b (meter). */
  bar(a: THREE.Vector3, b: THREE.Vector3, w: number, color: THREE.Color): void {
    const d = new THREE.Vector3().subVectors(b, a);
    if (d.lengthSq() < 1e-8) return;
    d.normalize();
    const ref = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(d, ref).normalize().multiplyScalar(w);
    const v = new THREE.Vector3().crossVectors(d, u).normalize().multiplyScalar(w);
    const base = this.pos.length / 3;
    for (const end of [a, b])
      for (const [su, sv] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        this.pos.push(end.x + u.x * su + v.x * sv, end.y + u.y * su + v.y * sv, end.z + u.z * su + v.z * sv);
        this.col.push(color.r, color.g, color.b);
      }
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.idx.push(base + i, base + j, base + 4 + j, base + i, base + 4 + j, base + 4 + i);
    }
    this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    this.idx.push(base + 4, base + 5, base + 6, base + 4, base + 6, base + 7);
  }

  /** Liten kule (lav oppløsning). */
  ball(c: THREE.Vector3, r: number, color: THREE.Color): void {
    const g = BALL;
    const base = this.pos.length / 3;
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      this.pos.push(c.x + p.getX(i) * r, c.y + p.getY(i) * r, c.z + p.getZ(i) * r);
      this.col.push(color.r, color.g, color.b);
    }
    const index = g.getIndex()!;
    for (let i = 0; i < index.count; i++) this.idx.push(base + index.getX(i));
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const BALL = new THREE.SphereGeometry(1, 10, 6);

const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x * MM, y * MM, z * MM);

export class MeasureOverlay {
  readonly root = new THREE.Group();
  private readonly frame: THREE.Mesh;
  private readonly beacon = new THREE.Group();
  private readonly beam: THREE.Mesh;
  private readonly orb: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly label: THREE.Sprite;
  private readonly labelCanvas = document.createElement('canvas');
  private readonly labelTexture: THREE.CanvasTexture;
  private labelText = '';
  /** Mål-punktet (m) for merket som vises nå. */
  readonly target = new THREE.Vector3();

  constructor() {
    this.root.name = 'oppmåling';
    this.frame = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ toneMapped: false, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.frame.renderOrder = 10;

    const glow = (opacity: number): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({ toneMapped: false, color: COLOR.target, transparent: true, opacity, depthWrite: false });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 10, 1, true), glow(0.45));
    this.orb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 20, 12), glow(0.95));
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.2, 40).rotateX(-Math.PI / 2), glow(0.8));

    this.labelCanvas.width = 768;
    this.labelCanvas.height = 128;
    this.labelTexture = new THREE.CanvasTexture(this.labelCanvas);
    this.labelTexture.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Sprite(
      new THREE.SpriteMaterial({ toneMapped: false, map: this.labelTexture, transparent: true, depthTest: false, depthWrite: false }),
    );
    this.label.scale.set(LABEL_W, LABEL_H, 1);
    this.label.renderOrder = 25;

    this.beacon.add(this.beam, this.orb, this.ring, this.label);
    this.beacon.visible = false;
    this.root.add(this.frame, this.beacon);
  }

  /** Bygger trådskjelettet for utkastet og målingene i økten. */
  build(session: MeasureSession): void {
    const model = session.model;
    const g = new GeoBuilder();
    const done = (key: string): boolean => session.done.has(key) || !session.tasks.some((t) => t.key === key);

    for (const info of model.rooms.values()) {
      const id = info.room.id;
      const floor = info.room.floorLevel;
      const poly = info.polygon;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!;
        const b = poly[(i + 1) % poly.length]!;
        const ca = model.ceilingAt(info, a);
        const cb = model.ceilingAt(info, b);
        g.bar(v3(a.x, floor + 3, a.z), v3(b.x, floor + 3, b.z), LINE, COLOR.floor);
        g.bar(v3(a.x, ca - 3, a.z), v3(b.x, cb - 3, b.z), LINE, COLOR.ceiling);
        const measured = done(taskKey({ kind: 'room-corner', roomId: id, index: i }));
        g.bar(v3(a.x, floor, a.z), v3(a.x, ca, a.z), POST, measured ? COLOR.measured : COLOR.todo);
      }
    }

    for (const o of model.data.openings) {
      const span = model.openingSpan(o);
      if (!span) continue;
      const f = span.frame;
      const roomId = o.room ?? (o.type === 'door' ? o.into : undefined);
      const side = roomId ? model.sideOfRoom(f, roomId, (span.u0 + span.u1) / 2) : null;
      const n = side === 'left' ? f.nMax : side === 'right' ? f.nMin : (f.nMin + f.nMax) / 2;
      const p = (u: number, y: number): THREE.Vector3 => {
        const q = frameAt(f, u, n);
        return v3(q.x, y, q.z);
      };
      const ok = done(`karm:${o.id}:0`) && done(`karm:${o.id}:1`) && done(`overkant:${o.id}`);
      const c = ok ? COLOR.measured : COLOR.opening;
      g.bar(p(span.u0, span.bottom), p(span.u0, span.top), LINE, c);
      g.bar(p(span.u1, span.bottom), p(span.u1, span.top), LINE, c);
      g.bar(p(span.u0, span.top), p(span.u1, span.top), LINE, c);
      if (o.type === 'window') g.bar(p(span.u0, span.bottom), p(span.u1, span.bottom), LINE, c);
    }

    for (const fx of model.data.fixtures) {
      if (fx.status === 'planned') continue;
      const pl = model.fixturePlacement(fx);
      if (!pl) continue;
      g.ball(v3(pl.x, pl.y, pl.z), 0.02, done(`inst:${fx.id}`) ? COLOR.measured : COLOR.fixture);
    }

    // Punktene som er målt.
    const byKey = new Map(session.tasks.map((t) => [t.key, t]));
    for (const o of session.observations) {
      const t = byKey.get(taskKey(o));
      const x = 'x' in o ? o.x : t?.target.x;
      const z = 'z' in o ? o.z : t?.target.z;
      const y = 'y' in o ? o.y : t?.target.y;
      if (x === undefined || y === undefined || z === undefined) continue;
      g.ball(v3(x, y, z), 0.012, COLOR.dot);
    }

    this.frame.geometry.dispose();
    this.frame.geometry = g.build();
  }

  /** Viser merket for oppgaven (eller skjuler det). */
  setTarget(task: TaskInfo | null, model: ApartmentModel): void {
    if (!task) {
      this.beacon.visible = false;
      return;
    }
    const t = task.target;
    const p = { x: t.x, z: t.z };
    const floor = model.floorLevelAt(p) ?? model.floorOrDefault(p);
    const room = model.roomAt(p);
    const ceiling = room ? model.ceilingAt(room, p) : floor + 2400;
    this.target.set(t.x * MM, t.y * MM, t.z * MM);
    this.orb.position.copy(this.target);
    const h = Math.max(0.05, (ceiling - floor) * MM);
    this.beam.scale.set(1, h, 1);
    this.beam.position.set(t.x * MM, floor * MM + h / 2, t.z * MM);
    const onCeiling = task.task.kind === 'ceiling';
    this.ring.visible = task.task.kind === 'room-floor' || onCeiling;
    this.ring.position.set(t.x * MM, onCeiling ? ceiling * MM - 0.01 : floor * MM + 0.01, t.z * MM);
    this.ring.rotation.x = onCeiling ? Math.PI : 0;
    this.label.position.set(t.x * MM, onCeiling ? ceiling * MM - 0.35 : t.y * MM + 0.22, t.z * MM);
    this.setLabel(task.title);
    this.beacon.visible = true;
  }

  private setLabel(text: string): void {
    if (text === this.labelText) return;
    this.labelText = text;
    const c = this.labelCanvas.getContext('2d')!;
    const { width: w, height: h } = this.labelCanvas;
    c.clearRect(0, 0, w, h);
    c.font = '700 54px system-ui, sans-serif';
    const tw = Math.min(w - 8, c.measureText(text).width + 56);
    c.fillStyle = 'rgba(8, 40, 56, 0.85)';
    c.beginPath();
    c.roundRect((w - tw) / 2, 14, tw, h - 28, 40);
    c.fill();
    c.fillStyle = '#ffffff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, w / 2, h / 2 + 2, w - 64);
    this.labelTexture.needsUpdate = true;
  }

  /** Puls på merket; merkelappen blir større på avstand så den kan leses. */
  update(time: number, head: THREE.Vector3): void {
    if (!this.beacon.visible) return;
    const s = 1 + 0.25 * Math.sin(time * 0.006);
    this.orb.scale.setScalar(s);
    const k = Math.max(1, head.distanceTo(this.label.position) / 1.5);
    this.label.scale.set(LABEL_W * k, LABEL_H * k, 1);
  }

  stats(): { triangles: number; beacon: boolean } {
    const idx = this.frame.geometry.getIndex();
    return { triangles: idx ? idx.count / 3 : 0, beacon: this.beacon.visible };
  }

  get labelValue(): string {
    return this.labelText;
  }
}
