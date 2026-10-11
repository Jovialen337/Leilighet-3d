/**
 * Tegning av el og vann: rene funksjoner (testbare uten nettleser), felles
 * for PC (mus i 2D/3D) og Quest (stråle i VR).
 *
 * - Fest («snapping»): eksisterende punkter og hjørner, veggflater, rette
 *   vinkler, ellers et 50 mm-rutenett.
 * - Kabel/rør: punkter [x, høyde over gulv, z]. Bytter man høyde mellom to
 *   punkter, legges det inn en loddrett stigning først, så strekkene blir
 *   vannrette eller loddrette (slik kabler skal ligge skjult i vegg).
 * - Punkt (stikkontakt, bryter, kran …): festes på nærmeste veggflate, ellers
 *   fritt i rommet. Lamper settes i taket.
 */
import type { ApartmentModel } from '../model/ApartmentModel';
import { dist, dot, p2, sub, type P2 } from '../geometry/math2d';
import {
  WATER_FIXTURES,
  type FixtureType,
  type PipeKind,
  type Status,
  type WireKind,
} from '../schema/types';

export type DrawTool = 'select' | 'wire' | 'pipe' | 'fixture';

export interface DrawOptions {
  tool: DrawTool;
  status: Status;
  wireKind: WireKind;
  pipeKind: PipeKind;
  fixtureType: FixtureType;
  circuit: string | null;
  /** Høyde over gulv (mm) for nye punkter; UNDER_CEILING = rett under taket. */
  height: number;
}

export const UNDER_CEILING = -1;

export const DEFAULT_OPTIONS: DrawOptions = {
  tool: 'select',
  status: 'planned',
  wireKind: 'power',
  pipeKind: 'cold',
  fixtureType: 'outlet',
  circuit: null,
  height: 300,
};

export const HEIGHT_PRESETS: readonly { mm: number; label: string }[] = [
  { mm: 20, label: 'I gulvet (20 mm)' },
  { mm: 300, label: 'Stikkontakthøyde (300 mm)' },
  { mm: 1050, label: 'Bryterhøyde (1050 mm)' },
  { mm: 2100, label: 'Over dør (2100 mm)' },
  { mm: UNDER_CEILING, label: 'Under taket' },
];

/** Vanlig montasjehøyde per type (mm over gulv). Veiledende. */
export const FIXTURE_HEIGHT: Record<FixtureType, number> = {
  outlet: 300,
  switch: 1050,
  radiator: 300,
  pipe: 1000,
  vent: 2100,
  hatch: 1500,
  light: UNDER_CEILING,
  junction: 2100,
  panel: 1500,
  tap: 900,
  drain: 6,
  valve: 400,
  waterheater: 500,
};

/** Punkttypene man kan tegne. */
export const DRAW_FIXTURES: readonly FixtureType[] = ['outlet', 'switch', 'light', 'junction', 'tap', 'drain', 'valve'];

export const WIRE_KIND_TEXT: Record<WireKind, string> = { power: 'Strøm', light: 'Lys', data: 'Data', other: 'Annet' };
export const PIPE_KIND_TEXT: Record<PipeKind, string> = { cold: 'Kaldtvann', hot: 'Varmtvann', drain: 'Avløp', other: 'Annet' };
export const FIXTURE_TEXT: Partial<Record<FixtureType, string>> = {
  outlet: 'Stikkontakt',
  switch: 'Bryter',
  light: 'Lampepunkt',
  junction: 'Koblingsboks',
  tap: 'Kran',
  drain: 'Sluk',
  valve: 'Stoppekran',
};

export type SnapKind = 'punkt' | 'hjørne' | 'vegg' | '90°' | 'rutenett' | 'fri';

export interface Snap {
  p: P2;
  kind: SnapKind;
}

const GRID = 50;
const RIGHT_ANGLE_TOL = (7 * Math.PI) / 180;

/**
 * Festing uten nye objekter per ramme (viktig i VR, der det skjer hver ramme):
 * festepunktene (kabel-/rørpunkter, installasjoner, romhjørner) og veggflatene
 * regnes ut én gang per modell, og resultatet skrives inn i et gjenbrukt objekt.
 */
export class Snapper {
  /** x, z for hvert festepunkt (flatt), og om det er et hjørne. */
  private readonly ax: Float64Array;
  private readonly az: Float64Array;
  private readonly corner: Uint8Array;
  /** Veggflater: p0 (x, z), retning (x, z), lengde, og normalavstand per side. */
  private readonly walls: { id: string; x: number; z: number; dx: number; dz: number; lx: number; lz: number; len: number; nMax: number; nMin: number }[];

  constructor(readonly model: ApartmentModel) {
    const xs: number[] = [];
    const zs: number[] = [];
    const cs: number[] = [];
    const add = (x: number, z: number, c: boolean): void => {
      xs.push(x);
      zs.push(z);
      cs.push(c ? 1 : 0);
    };
    for (const w of model.data.wiring) for (const [x, , z] of w.points) add(x, z, false);
    for (const r of model.data.pipes ?? []) for (const [x, , z] of r.points) add(x, z, false);
    for (const fx of model.data.fixtures) {
      const pl = model.fixturePlacement(fx);
      if (pl) add(pl.x, pl.z, false);
    }
    for (const info of model.rooms.values()) for (const v of info.polygon) add(v.x, v.z, true);
    this.ax = Float64Array.from(xs);
    this.az = Float64Array.from(zs);
    this.corner = Uint8Array.from(cs);
    this.walls = [...model.walls.values()].map((f) => ({
      id: f.wall.id,
      x: f.p0.x,
      z: f.p0.z,
      dx: f.dir.x,
      dz: f.dir.z,
      lx: f.left.x,
      lz: f.left.z,
      len: f.length,
      nMax: f.nMax,
      nMin: f.nMin,
    }));
  }

  /** Nærmeste veggflate: skriver punktet på flaten i `out` og returnerer avstanden (Infinity hvis ingen vegger). */
  nearestWall(px: number, pz: number, out: { x: number; z: number; wallId: string; face: 'left' | 'right'; along: number }): number {
    let best = Infinity;
    for (const w of this.walls) {
      const u = Math.max(0, Math.min(w.len, (px - w.x) * w.dx + (pz - w.z) * w.dz));
      for (let k = 0; k < 2; k++) {
        const n = k === 0 ? w.nMax : w.nMin;
        const qx = w.x + w.dx * u + w.lx * n;
        const qz = w.z + w.dz * u + w.lz * n;
        const d = Math.hypot(px - qx, pz - qz);
        if (d < best) {
          best = d;
          out.x = qx;
          out.z = qz;
          out.wallId = w.id;
          out.face = k === 0 ? 'left' : 'right';
          out.along = u;
        }
      }
    }
    return best;
  }

  private readonly wallTmp = { x: 0, z: 0, wallId: '', face: 'left' as 'left' | 'right', along: 0 };

  /**
   * Fester (px, pz) og skriver resultatet i `out`. `prev` = forrige punkt
   * (for rett vinkel), `tol` i mm, `free` = ingen festing.
   */
  snapInto(
    px: number,
    pz: number,
    prevX: number | null,
    prevZ: number | null,
    tol: number,
    free: boolean,
    out: { x: number; z: number; kind: SnapKind },
  ): void {
    if (free) {
      out.x = px;
      out.z = pz;
      out.kind = 'fri';
      return;
    }
    let bi = -1;
    let bd = tol;
    for (let i = 0; i < this.ax.length; i++) {
      const d = Math.hypot(px - this.ax[i]!, pz - this.az[i]!);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    if (bi >= 0) {
      out.x = this.ax[bi]!;
      out.z = this.az[bi]!;
      out.kind = this.corner[bi] ? 'hjørne' : 'punkt';
      return;
    }
    if (this.nearestWall(px, pz, this.wallTmp) < tol) {
      out.x = this.wallTmp.x;
      out.z = this.wallTmp.z;
      out.kind = 'vegg';
      return;
    }
    if (prevX !== null && prevZ !== null) {
      const dx = px - prevX;
      const dz = pz - prevZ;
      const len = Math.hypot(dx, dz);
      if (len > 1) {
        const a = Math.atan2(dz, dx);
        const k = Math.round(a / (Math.PI / 2));
        if (Math.abs(a - (k * Math.PI) / 2) < RIGHT_ANGLE_TOL) {
          const l = Math.round(len / 10) * 10;
          out.x = prevX + Math.round(Math.cos((k * Math.PI) / 2)) * l;
          out.z = prevZ + Math.round(Math.sin((k * Math.PI) / 2)) * l;
          out.kind = '90°';
          return;
        }
      }
    }
    out.x = Math.round(px / GRID) * GRID;
    out.z = Math.round(pz / GRID) * GRID;
    out.kind = 'rutenett';
  }
}

/** Nærmeste punkt på en veggflate (begge sider av alle vegger). */
export function nearestWallFace(model: ApartmentModel, p: P2): { q: P2; wallId: string; face: 'left' | 'right'; along: number; d: number } | null {
  const out = { x: 0, z: 0, wallId: '', face: 'left' as 'left' | 'right', along: 0 };
  const d = new Snapper(model).nearestWall(p.x, p.z, out);
  return Number.isFinite(d) ? { q: p2(out.x, out.z), wallId: out.wallId, face: out.face, along: out.along, d } : null;
}

/**
 * Fester et punkt i planet. `tol` er festeavstanden i mm (regnet om fra
 * piksler eller vinkel av den som kaller). `free` = ingen festing.
 * (Enkel variant; hver ramme brukes en Snapper som gjenbrukes.)
 */
export function snapPlan(model: ApartmentModel, p: P2, opts: { prev: P2 | null; tol: number; free?: boolean }, snapper = new Snapper(model)): Snap {
  const out = { x: 0, z: 0, kind: 'fri' as SnapKind };
  snapper.snapInto(p.x, p.z, opts.prev?.x ?? null, opts.prev?.z ?? null, opts.tol, !!opts.free, out);
  return { p: opts.free ? p : p2(out.x, out.z), kind: out.kind };
}

/** Høyde (mm over gulv) i et punkt, med «under taket» regnet ut fra taket der. */
export function resolveHeight(model: ApartmentModel, p: P2, height: number): number {
  if (height !== UNDER_CEILING) return height;
  const room = model.roomAt(p);
  const floor = model.floorOrDefault(p);
  const ceil = room ? model.ceilingAt(room, p) : floor + model.settings.defaultWallHeight;
  return Math.max(0, Math.round(ceil - floor - 60));
}

export type Pt = [number, number, number];

/** Et kabel- eller rørstrekk under tegning. */
export class RunDraft {
  points: Pt[] = [];

  /** Legger til et punkt; ved ny høyde legges en loddrett stigning inn først. */
  add(p: P2, h: number): void {
    const last = this.points[this.points.length - 1];
    const x = Math.round(p.x);
    const z = Math.round(p.z);
    const hh = Math.round(h);
    if (last && last[0] === x && last[2] === z && last[1] === hh) return;
    if (last && last[1] !== hh && (last[0] !== x || last[2] !== z)) this.points.push([last[0], hh, last[2]]);
    this.points.push([x, hh, z]);
  }

  /** Fjerner siste punkt (og en automatisk stigning foran det). */
  undo(): void {
    this.points.pop();
    const n = this.points.length;
    if (n >= 2) {
      const a = this.points[n - 2]!;
      const b = this.points[n - 1]!;
      if (a[0] === b[0] && a[2] === b[2]) this.points.pop();
    }
  }

  get last(): Pt | null {
    return this.points[this.points.length - 1] ?? null;
  }

  /** Lengde i mm (3D, med stigninger). */
  get length(): number {
    return runLength(this.points);
  }

  clear(): void {
    this.points = [];
  }
}

export function runLength(points: readonly (readonly [number, number, number])[]): number {
  let s = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    s += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return s;
}

/** Laget et nytt objekt hører hjemme i. */
export function layerFor(what: 'wire' | 'pipe' | 'fixture', status: Status, type?: FixtureType): string {
  if (what === 'wire') return 'wiring';
  const water = what === 'pipe' || (type !== undefined && WATER_FIXTURES.includes(type));
  if (water) return status === 'planned' ? 'plumbing-planned' : 'plumbing-existing';
  return status === 'planned' ? 'electrical-planned' : 'electrical-existing';
}

export const LAYER_NAMES: Record<string, string> = {
  wiring: 'Kabling',
  'electrical-existing': 'Elektrisk – eksisterende',
  'electrical-planned': 'Elektrisk – planlagt',
  'plumbing-existing': 'Vann – eksisterende',
  'plumbing-planned': 'Vann – planlagt',
};

/** Et nytt kabel- eller rørobjekt (rå JSON slik det står i fila). */
export function makeRun(
  what: 'wire' | 'pipe',
  id: string,
  points: readonly Pt[],
  o: Pick<DrawOptions, 'status' | 'wireKind' | 'pipeKind' | 'circuit'>,
): Record<string, unknown> & { id: string } {
  const base = { id, layer: layerFor(what, o.status), status: o.status, points: points.map((p) => [...p]) };
  if (what === 'wire') return { ...base, kind: o.wireKind, ...(o.circuit ? { circuit: o.circuit } : {}) };
  return { ...base, kind: o.pipeKind, ...(o.pipeKind === 'drain' ? { diameter: 50 } : {}) };
}

/** Et nytt punkt (stikkontakt, kran …): på nærmeste vegg innen 250 mm, ellers fritt. */
export function makeFixture(
  model: ApartmentModel,
  id: string,
  p: P2,
  o: Pick<DrawOptions, 'status' | 'fixtureType' | 'circuit'>,
  height?: number,
): Record<string, unknown> & { id: string } {
  const type = o.fixtureType;
  const h = resolveHeight(model, p, height ?? FIXTURE_HEIGHT[type]);
  const base: Record<string, unknown> & { id: string } = {
    id,
    type,
    layer: layerFor('fixture', o.status, type),
    status: o.status,
    ...(o.circuit && !WATER_FIXTURES.includes(type) ? { circuit: o.circuit } : {}),
  };
  const wall = type === 'light' || type === 'drain' ? null : nearestWallFace(model, p);
  if (wall && wall.d < 250) {
    const f = model.walls.get(wall.wallId)!;
    const room = model.roomBeside(f, wall.along, wall.face);
    const mount: Record<string, unknown> = { wall: wall.wallId, along: Math.round(wall.along), height: h };
    if (room) mount.room = room.room.id;
    else mount.face = wall.face;
    return { ...base, mount };
  }
  return { ...base, position: [Math.round(p.x), h, Math.round(p.z)] };
}

/** Nærmeste kabel, rør eller installasjon (i planet) innen `tol` mm. */
/** Det som kan velges, slik `pickNearest` ser det (for filter på synlighet). */
export interface Pickable {
  kind: 'wire' | 'pipe' | 'fixture';
  layer: string;
  status: 'existing' | 'planned';
  circuit?: string;
}

export function pickNearest(
  model: ApartmentModel,
  p: P2,
  tol: number,
  visible: (o: Pickable) => boolean = () => true,
): { c: 'wiring' | 'pipes' | 'fixtures'; id: string; d: number } | null {
  let best: { c: 'wiring' | 'pipes' | 'fixtures'; id: string; d: number } | null = null;
  const consider = (c: 'wiring' | 'pipes' | 'fixtures', id: string, d: number): void => {
    if (d <= tol && (!best || d < best.d)) best = { c, id, d };
  };
  const segDist = (pts: readonly (readonly number[])[]): number => {
    let m = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const a = p2(pts[i - 1]![0]!, pts[i - 1]![2]!);
      const b = p2(pts[i]![0]!, pts[i]![2]!);
      m = Math.min(m, segmentDistance(p, a, b));
    }
    return m;
  };
  for (const w of model.data.wiring)
    if (visible({ kind: 'wire', layer: w.layer, status: w.status, ...(w.circuit ? { circuit: w.circuit } : {}) }))
      consider('wiring', w.id, segDist(w.points));
  for (const r of model.data.pipes ?? [])
    if (visible({ kind: 'pipe', layer: r.layer, status: r.status })) consider('pipes', r.id, segDist(r.points));
  for (const fx of model.data.fixtures) {
    if (!visible({ kind: 'fixture', layer: fx.layer, status: fx.status, ...(fx.circuit ? { circuit: fx.circuit } : {}) })) continue;
    const pl = model.fixturePlacement(fx);
    if (pl) consider('fixtures', fx.id, dist(p, p2(pl.x, pl.z)) - 20);
  }
  return best;
}

function segmentDistance(p: P2, a: P2, b: P2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-9) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, p2(a.x + ab.x * t, a.z + ab.z * t));
}

/** «1,24 m» */
export const metres = (mm: number): string => `${(mm / 1000).toFixed(2).replace('.', ',')} m`;
