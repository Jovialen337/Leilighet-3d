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
import { frameAt, type ApartmentModel } from '../model/ApartmentModel';
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

/** Alle punkter man kan feste til: kabel-/rørpunkter, installasjoner og romhjørner. */
function anchorPoints(model: ApartmentModel): { p: P2; kind: SnapKind }[] {
  const out: { p: P2; kind: SnapKind }[] = [];
  for (const w of model.data.wiring) for (const [x, , z] of w.points) out.push({ p: p2(x, z), kind: 'punkt' });
  for (const r of model.data.pipes ?? []) for (const [x, , z] of r.points) out.push({ p: p2(x, z), kind: 'punkt' });
  for (const fx of model.data.fixtures) {
    const pl = model.fixturePlacement(fx);
    if (pl) out.push({ p: p2(pl.x, pl.z), kind: 'punkt' });
  }
  for (const info of model.rooms.values()) for (const v of info.polygon) out.push({ p: v, kind: 'hjørne' });
  return out;
}

/** Nærmeste punkt på en veggflate (begge sider av alle vegger). */
export function nearestWallFace(model: ApartmentModel, p: P2): { q: P2; wallId: string; face: 'left' | 'right'; along: number; d: number } | null {
  let best: { q: P2; wallId: string; face: 'left' | 'right'; along: number; d: number } | null = null;
  for (const f of model.walls.values()) {
    const u = Math.max(0, Math.min(f.length, dot(sub(p, f.p0), f.dir)));
    for (const [n, face] of [
      [f.nMax, 'left'],
      [f.nMin, 'right'],
    ] as const) {
      const q = frameAt(f, u, n);
      const d = dist(p, q);
      if (!best || d < best.d) best = { q, wallId: f.wall.id, face, along: u, d };
    }
  }
  return best;
}

/**
 * Fester et punkt i planet. `tol` er festeavstanden i mm (regnet om fra
 * piksler eller vinkel av den som kaller). `free` = ingen festing.
 */
export function snapPlan(model: ApartmentModel, p: P2, opts: { prev: P2 | null; tol: number; free?: boolean }): Snap {
  if (opts.free) return { p, kind: 'fri' };
  let bestA: { p: P2; kind: SnapKind } | null = null;
  let bestD = opts.tol;
  for (const a of anchorPoints(model)) {
    const d = dist(p, a.p);
    if (d < bestD) {
      bestD = d;
      bestA = a;
    }
  }
  if (bestA) return { p: bestA.p, kind: bestA.kind };

  const wall = nearestWallFace(model, p);
  if (wall && wall.d < opts.tol) return { p: wall.q, kind: 'vegg' };

  const prev = opts.prev;
  if (prev) {
    const d = sub(p, prev);
    const len = Math.hypot(d.x, d.z);
    if (len > 1) {
      const a = Math.atan2(d.z, d.x);
      const k = Math.round(a / (Math.PI / 2));
      if (Math.abs(a - (k * Math.PI) / 2) < RIGHT_ANGLE_TOL) {
        const ax = Math.round(Math.cos((k * Math.PI) / 2));
        const az = Math.round(Math.sin((k * Math.PI) / 2));
        const l = Math.round(len / 10) * 10;
        return { p: p2(prev.x + ax * l, prev.z + az * l), kind: '90°' };
      }
    }
  }
  return { p: p2(Math.round(p.x / GRID) * GRID, Math.round(p.z / GRID) * GRID), kind: 'rutenett' };
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
export function pickNearest(
  model: ApartmentModel,
  p: P2,
  tol: number,
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
  for (const w of model.data.wiring) consider('wiring', w.id, segDist(w.points));
  for (const r of model.data.pipes ?? []) consider('pipes', r.id, segDist(r.points));
  for (const fx of model.data.fixtures) {
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
