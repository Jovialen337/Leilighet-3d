/**
 * Forhåndsvisning mens man tegner (PC og VR): punktene som er satt, en
 * «spøkelseslinje» til pekeren, festemarkøren (farge etter hva den festet
 * til) og utheving av valgt kabel/rør/punkt. Tegnes oppå alt.
 */
import * as THREE from 'three';
import type { ApartmentModel } from '../model/ApartmentModel';
import { p2 } from '../geometry/math2d';
import { MM } from '../scene/geom';
import { SNAP } from '../ui/tokens';
import type { PlanController } from './PlanController';

/** Festemarkørens farge etter hva den festet til (ferdig tolket, så den ikke tolkes hver ramme). */
const SNAP_COLOR: Record<string, THREE.Color> = Object.fromEntries(Object.entries(SNAP).map(([k, v]) => [k, new THREE.Color(v)]));

const mat = (color: string, opacity = 1): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: false, depthWrite: false, toneMapped: false });

/** Firkantet stav mellom to punkter (meter). */
function bar(a: THREE.Vector3, b: THREE.Vector3, w: number, out: number[]): void {
  const d = new THREE.Vector3().subVectors(b, a);
  if (d.lengthSq() < 1e-10) return;
  d.normalize();
  const ref = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(d, ref).normalize().multiplyScalar(w);
  const v = new THREE.Vector3().crossVectors(d, u).normalize().multiplyScalar(w);
  const c = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const;
  const P = (end: THREE.Vector3, i: number): number[] => {
    const [su, sv] = c[i]!;
    return [end.x + u.x * su + v.x * sv, end.y + u.y * su + v.y * sv, end.z + u.z * su + v.z * sv];
  };
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    out.push(...P(a, i), ...P(a, j), ...P(b, j), ...P(a, i), ...P(b, j), ...P(b, i));
  }
}

export class PlanOverlay {
  readonly root = new THREE.Group();
  private readonly path = new THREE.Mesh(new THREE.BufferGeometry(), mat('#ffe14d'));
  private readonly dots = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), mat('#ffe14d'), 64);
  private readonly ghost: THREE.Line;
  private readonly marker = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mat('#ffffff'));
  private readonly highlight = new THREE.Mesh(new THREE.BufferGeometry(), mat('#ffe14d', 0.85));
  private readonly ghostPos = new Float32Array(6);
  private readonly tmp = new THREE.Matrix4();
  /** Siste punkt under tegning (m, verden), regnet ut når utkastet endres. */
  private readonly lastWorld = new THREE.Vector3();
  private hasLast = false;
  private lastSnap = '';
  /** Størrelse på markører (m): større i VR. */
  scale = 0.02;

  constructor(
    private readonly ctrl: PlanController,
    private readonly getModel: () => ApartmentModel | null,
  ) {
    this.root.name = 'tegning';
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.ghostPos, 3));
    this.ghost = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#ffe14d', depthTest: false, toneMapped: false }));
    this.ghost.frustumCulled = false;
    for (const o of [this.path, this.dots, this.ghost, this.marker, this.highlight]) {
      o.renderOrder = 60;
      o.frustumCulled = false;
    }
    this.dots.count = 0;
    this.root.add(this.highlight, this.path, this.dots, this.ghost, this.marker);
    ctrl.draftVersion.subscribe(() => this.rebuildPath());
    ctrl.selected.subscribe(() => this.rebuildHighlight());
  }

  private worldOf(x: number, h: number, z: number): THREE.Vector3 {
    const model = this.getModel();
    const floor = model ? model.floorOrDefault(p2(x, z)) : 0;
    return new THREE.Vector3(x * MM, (floor + h) * MM, z * MM);
  }

  private rebuildPath(): void {
    const pts = this.ctrl.draft.points.map(([x, h, z]) => this.worldOf(x, h, z));
    this.hasLast = pts.length > 0;
    if (this.hasLast) this.lastWorld.copy(pts[pts.length - 1]!);
    const pos: number[] = [];
    for (let i = 1; i < pts.length; i++) bar(pts[i - 1]!, pts[i]!, this.scale * 0.35, pos);
    this.path.geometry.dispose();
    this.path.geometry = new THREE.BufferGeometry();
    this.path.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const n = Math.min(pts.length, 64);
    for (let i = 0; i < n; i++) {
      this.tmp.makeScale(this.scale * 0.6, this.scale * 0.6, this.scale * 0.6).setPosition(pts[i]!);
      this.dots.setMatrixAt(i, this.tmp);
    }
    this.dots.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
  }

  rebuildHighlight(): void {
    const sel = this.ctrl.selected.value;
    const model = this.getModel();
    const pos: number[] = [];
    if (sel && model) {
      if (sel.c === 'fixtures') {
        const fx = model.data.fixtures.find((f) => f.id === sel.id);
        const pl = fx ? model.fixturePlacement(fx) : null;
        if (pl) {
          const c = new THREE.Vector3(pl.x * MM, pl.y * MM, pl.z * MM);
          const r = 0.08;
          bar(c.clone().add(new THREE.Vector3(-r, 0, 0)), c.clone().add(new THREE.Vector3(r, 0, 0)), r, pos);
        }
      } else {
        const run = sel.c === 'wiring' ? model.data.wiring.find((w) => w.id === sel.id) : model.data.pipes?.find((r) => r.id === sel.id);
        const pts = (run?.points ?? []).map(([x, h, z]) => this.worldOf(x, h, z));
        for (let i = 1; i < pts.length; i++) bar(pts[i - 1]!, pts[i]!, 0.03, pos);
      }
    }
    this.highlight.geometry.dispose();
    this.highlight.geometry = new THREE.BufferGeometry();
    this.highlight.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  }

  /** Kalles hver ramme: markør og spøkelseslinje følger pekeren. Lager ingen nye objekter. */
  update(): void {
    const hv = this.ctrl.hover;
    const show = !!hv && this.ctrl.tool !== 'select';
    this.marker.visible = show;
    this.ghost.visible = false;
    if (!hv || !show) return;
    this.marker.position.set(hv.p.x * MM, (hv.floor + hv.h) * MM, hv.p.z * MM);
    this.marker.scale.setScalar(this.scale);
    if (hv.snap !== this.lastSnap) {
      this.lastSnap = hv.snap;
      (this.marker.material as THREE.MeshBasicMaterial).color.copy(SNAP_COLOR[hv.snap] ?? SNAP_COLOR.rutenett!);
    }
    if (this.hasLast && this.ctrl.draft.points.length) {
      const g = this.ghostPos;
      g[0] = this.lastWorld.x;
      g[1] = this.lastWorld.y;
      g[2] = this.lastWorld.z;
      g[3] = this.marker.position.x;
      g[4] = this.marker.position.y;
      g[5] = this.marker.position.z;
      this.ghost.geometry.getAttribute('position').needsUpdate = true;
      this.ghost.visible = true;
    }
  }
}
