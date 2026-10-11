/**
 * ApartmentModel: normalisert leilighet + oppslag og avledet geometri i mm.
 *
 * Ingen three.js her – dette er "sannheten" som både validering, 3D-bygging,
 * 2D-plan og XR-bevegelse spør. Alt er avledet fra apartment.json.
 */
import type {
  Apartment,
  Door,
  Fixture,
  Furniture,
  Layer,
  MeasureState,
  Opening,
  OutdoorArea,
  Room,
  Wall,
} from '../schema/types';
import {
  add,
  bounds,
  centroid,
  cross,
  distToSegment,
  dot,
  leftOf,
  len,
  normalize,
  p2,
  pointInPolygon,
  polygonArea,
  scale,
  sub,
  type Bounds2,
  type P2,
} from '../geometry/math2d';
import { fitCeilingPlane, planeY, type CeilingPlane } from '../geometry/plane';
import type { Normalized } from '../schema/normalize';

export const DEFAULTS = {
  planCutHeight: 1500,
  defaultWallHeight: 2400,
  backgroundColor: '#dfe8ef',
  openAngle: 90,
  /** Hvor langt ut fra veggflaten vi ser etter rom (mm). */
  sideProbe: 150,
  /** Veggen går litt over taket så det ikke blir sprekker (mm). */
  wallTopOverlap: 10,
  /** Prøveavstand langs veggen når toppen følger taket (mm). */
  wallTopStep: 50,
  /** Hvor langt innenfor inngangsdøra man starter (mm). */
  spawnInset: 700,
  /** «Gå til rom»: hvor langt inn fra hjørnet man står (mm). */
  viewpointInset: 700,
} as const;

export interface RoomInfo {
  room: Room;
  polygon: P2[];
  plane: CeilingPlane;
  area: number;
  bounds: Bounds2;
}

export interface AreaInfo {
  area: OutdoorArea;
  polygon: P2[];
}

export type Side = 'left' | 'right';

export interface WallFrame {
  wall: Wall;
  p0: P2;
  p1: P2;
  /** Enhetsvektor start → slutt. */
  dir: P2;
  /** Enhetsvektor til venstre for dir (sett ovenfra). */
  left: P2;
  length: number;
  /** Veggkroppen strekker seg fra nMin til nMax langs `left` fra linja. */
  nMin: number;
  nMax: number;
}

export const frameAt = (f: WallFrame, u: number, n: number): P2 =>
  add(add(f.p0, scale(f.dir, u)), scale(f.left, n));

export interface OpeningSpan {
  opening: Opening;
  frame: WallFrame;
  u0: number;
  u1: number;
  /** Absolutt underkant/overkant av hullet i veggen (mm). */
  bottom: number;
  top: number;
}

export interface DoorGeometry {
  span: OpeningSpan;
  /** Enhetsvektor inn i rommet `into`. */
  intoNormal: P2;
  /** Hvilken side av veggen dørbladet slår mot. */
  swingNormal: P2;
  /** Hengselpunkt (på veggflaten på slagsiden). */
  hinge: P2;
  /** Retning fra hengsel mot motsatt karm (lukket dørblad). */
  closedDir: P2;
  /** Retning dørbladet peker ved full åpning. */
  openDir: P2;
  openAngle: number;
  swingDirection: 'clockwise' | 'counterclockwise';
  /** Gulvnivå på slagsiden (for slaglinjen). */
  swingFloor: number;
}

export interface Threshold {
  opening: Opening;
  polygon: P2[];
  level: number;
}

export interface Placement {
  /** Senter i mm, y absolutt. */
  x: number;
  y: number;
  z: number;
  /** Rotasjon om y i radianer (three.js-konvensjon: positiv = mot klokka ovenfra). */
  yaw: number;
}

export interface Spawn {
  position: P2;
  level: number;
  facing: P2;
}

const FIXTURE_DEFAULT_SIZE: Record<Fixture['type'], [number, number, number]> = {
  outlet: [80, 80, 20],
  switch: [80, 80, 15],
  radiator: [800, 500, 100],
  pipe: [60, 1000, 60],
  vent: [200, 200, 40],
  hatch: [300, 300, 25],
  light: [220, 70, 220],
  junction: [90, 90, 45],
  panel: [450, 550, 130],
  tap: [60, 160, 160],
  drain: [160, 12, 160],
  valve: [70, 70, 90],
  waterheater: [450, 1000, 450],
};

export const fixtureSize = (f: Fixture): [number, number, number] =>
  f.size ? [f.size[0], f.size[1], f.size[2]] : FIXTURE_DEFAULT_SIZE[f.type];

/** Grader med klokka sett ovenfra → three.js yaw (radianer). */
export const yawFromDegrees = (deg: number): number => (-deg * Math.PI) / 180;

/** Yaw som får lokal +z til å peke langs `n`. */
export const yawFacing = (n: P2): number => Math.atan2(n.x, n.z);

export class ApartmentModel {
  readonly data: Apartment;
  readonly measure: Map<string, MeasureState>;
  readonly layers = new Map<string, Layer>();
  readonly rooms = new Map<string, RoomInfo>();
  readonly walls = new Map<string, WallFrame>();
  readonly outdoor: AreaInfo[] = [];
  readonly openingsByWall = new Map<string, Opening[]>();
  readonly lowestFloor: number;
  private thresholdCache: Threshold[] | null = null;

  constructor(n: Normalized) {
    // Eldre filer har ikke rør og kurser: tomme lister.
    this.data = { ...n.apartment, pipes: n.apartment.pipes ?? [], circuits: n.apartment.circuits ?? [] };
    this.measure = n.measure;
    for (const l of this.data.layers) this.layers.set(l.id, l);
    for (const room of this.data.rooms) {
      const polygon = room.polygon.map(([x, z]) => p2(x, z));
      const plane = fitCeilingPlane(
        room.ceiling.points.map((p) => ({ x: p.x, z: p.z, y: room.floorLevel + p.height })),
      );
      this.rooms.set(room.id, { room, polygon, plane, area: polygonArea(polygon), bounds: bounds(polygon) });
    }
    for (const wall of this.data.walls) this.walls.set(wall.id, makeFrame(wall));
    for (const area of this.data.outdoor)
      this.outdoor.push({ area, polygon: area.polygon.map(([x, z]) => p2(x, z)) });
    for (const o of this.data.openings) {
      const list = this.openingsByWall.get(o.wall) ?? [];
      list.push(o);
      this.openingsByWall.set(o.wall, list);
    }
    this.lowestFloor = Math.min(0, ...this.data.rooms.map((r) => r.floorLevel));
  }

  get settings() {
    const s = this.data.settings ?? {};
    return {
      planCutHeight: s.planCutHeight ?? DEFAULTS.planCutHeight,
      defaultWallHeight: s.defaultWallHeight ?? DEFAULTS.defaultWallHeight,
      backgroundColor: s.backgroundColor ?? DEFAULTS.backgroundColor,
    };
  }

  measureState(id: string): MeasureState {
    return this.measure.get(id) ?? 'placeholder';
  }

  /* ---------------- rom og gulv ---------------- */

  /** Rommet som inneholder punktet (høyeste gulv hvis flere). */
  roomAt(p: P2): RoomInfo | null {
    let best: RoomInfo | null = null;
    for (const info of this.rooms.values()) {
      if (pointInPolygon(p, info.polygon) && (!best || info.room.floorLevel > best.room.floorLevel)) best = info;
    }
    return best;
  }

  outdoorAt(p: P2): AreaInfo | null {
    let best: AreaInfo | null = null;
    for (const a of this.outdoor) {
      if (pointInPolygon(p, a.polygon) && (!best || a.area.level > best.area.level)) best = a;
    }
    return best;
  }

  /** Gulvnivå (absolutt, mm) i et punkt: rom, dørterskel eller uteområde. null = ingen gulv. */
  floorLevelAt(p: P2): number | null {
    const room = this.roomAt(p);
    if (room) return room.room.floorLevel;
    for (const t of this.thresholds()) if (pointInPolygon(p, t.polygon)) return t.level;
    const out = this.outdoorAt(p);
    if (out) return out.area.level;
    return null;
  }

  /** Absolutt takhøyde (mm) for et rom i et punkt. */
  ceilingAt(info: RoomInfo, p: P2): number {
    return planeY(info.plane, p.x, p.z);
  }

  /* ---------------- vegger ---------------- */

  /** Rommet rett ved siden av veggen, på gitt side, ved posisjon u. */
  roomBeside(f: WallFrame, u: number, side: Side): RoomInfo | null {
    const n = side === 'left' ? f.nMax + DEFAULTS.sideProbe : f.nMin - DEFAULTS.sideProbe;
    return this.roomAt(frameAt(f, u, n));
  }

  outdoorBeside(f: WallFrame, u: number, side: Side): AreaInfo | null {
    const n = side === 'left' ? f.nMax + DEFAULTS.sideProbe : f.nMin - DEFAULTS.sideProbe;
    return this.outdoorAt(frameAt(f, u, n));
  }

  /** Hvilken side av veggen et rom ligger på (prøver flere punkter langs veggen). */
  sideOfRoom(f: WallFrame, roomId: string, uHint?: number): Side | null {
    const us = uHint !== undefined ? [uHint] : sampleUs(f.length, 5);
    for (const u of us) {
      if (this.roomBeside(f, u, 'left')?.room.id === roomId) return 'left';
      if (this.roomBeside(f, u, 'right')?.room.id === roomId) return 'right';
    }
    return null;
  }

  /** Veggens underkant (absolutt mm). */
  wallBase(f: WallFrame): number {
    const floors: number[] = [];
    let exterior = false;
    for (const u of sampleUs(f.length, 7)) {
      for (const side of ['left', 'right'] as const) {
        const r = this.roomBeside(f, u, side);
        if (r) floors.push(r.room.floorLevel);
        else {
          exterior = true;
          const o = this.outdoorBeside(f, u, side);
          if (o) floors.push(o.area.level);
        }
      }
    }
    if (exterior) floors.push(this.lowestFloor);
    const floor = floors.length ? Math.min(...floors) : this.lowestFloor;
    return f.wall.base !== undefined ? floor + f.wall.base : floor;
  }

  /**
   * Veggens overkant som polylinje [(u, y)] (absolutt mm). Følger taket i
   * rommene på begge sider, eller fast høyde hvis `height` er satt.
   */
  wallTop(f: WallFrame): { u: number; y: number }[] {
    const base = this.wallBase(f);
    if (f.wall.height !== undefined) {
      return [
        { u: 0, y: base + f.wall.height },
        { u: f.length, y: base + f.wall.height },
      ];
    }
    const steps = Math.max(1, Math.ceil(f.length / DEFAULTS.wallTopStep));
    const raw: (number | null)[] = [];
    const us: number[] = [];
    const margin = Math.min(DEFAULTS.sideProbe, f.length / 4);
    for (let i = 0; i <= steps; i++) {
      const u = (f.length * i) / steps;
      const probeU = Math.min(Math.max(u, margin), f.length - margin);
      let y: number | null = null;
      for (const side of ['left', 'right'] as const) {
        const r = this.roomBeside(f, probeU, side);
        if (!r) continue;
        const faceN = side === 'left' ? f.nMax : f.nMin;
        const c = this.ceilingAt(r, frameAt(f, u, faceN));
        y = y === null ? c : Math.max(y, c);
      }
      us.push(u);
      raw.push(y);
    }
    const knownIdx = raw.flatMap((y, i) => (y === null ? [] : [i]));
    if (!knownIdx.length) {
      return [
        { u: 0, y: base + this.settings.defaultWallHeight },
        { u: f.length, y: base + this.settings.defaultWallHeight },
      ];
    }
    // Fyll hull fra nærmeste kjente prøve.
    const filled = raw.map((y, i) => {
      if (y !== null) return y;
      let best = knownIdx[0]!;
      for (const k of knownIdx) if (Math.abs(k - i) < Math.abs(best - i)) best = k;
      return raw[best]!;
    });
    // Konservativt: ta maks av naboene, så et høyt tak aldri får sprekk mot veggen
    // der rommet ved siden av skifter mellom to prøvepunkter.
    const top = filled.map((y, i) =>
      Math.max(y, filled[i - 1] ?? y, filled[i + 1] ?? y) + DEFAULTS.wallTopOverlap,
    );
    return simplifyPolyline(us.map((u, i) => ({ u, y: top[i]! })));
  }

  /** Veggtopp (absolutt mm) ved posisjon u. */
  wallTopAt(f: WallFrame, u: number): number {
    return interpolate(this.wallTop(f), u);
  }

  /* ---------------- åpninger ---------------- */

  /** Gulvet (absolutt mm) en åpning måles fra. */
  openingFloor(o: Opening): number {
    const roomId = o.room ?? (o.type === 'door' ? o.into : undefined);
    if (roomId) {
      const r = this.rooms.get(roomId);
      if (r) return r.room.floorLevel;
    }
    const f = this.walls.get(o.wall);
    if (!f) return 0;
    const mid = o.offset + o.width / 2;
    const levels = (['left', 'right'] as const)
      .map((s) => this.roomBeside(f, mid, s)?.room.floorLevel)
      .filter((v): v is number => v !== undefined);
    return levels.length ? Math.max(...levels) : 0;
  }

  openingSpan(o: Opening): OpeningSpan | null {
    const frame = this.walls.get(o.wall);
    if (!frame) return null;
    const floor = this.openingFloor(o);
    const bottom = o.type === 'window' ? floor + o.sillHeight : floor;
    return { opening: o, frame, u0: o.offset, u1: o.offset + o.width, bottom, top: bottom + o.height };
  }

  doorGeometry(d: Door): DoorGeometry | null {
    const span = this.openingSpan(d);
    if (!span) return null;
    const f = span.frame;
    const mid = (span.u0 + span.u1) / 2;
    const intoSide = this.sideOfRoom(f, d.into, mid);
    if (!intoSide) return null;
    const intoNormal = intoSide === 'left' ? f.left : scale(f.left, -1);
    // Sett av den som går inn: venstre hånd = leftOf(intoNormal).
    const hingeTowardsDir = dot(leftOf(intoNormal), f.dir) > 0 === (d.hinge === 'left');
    const hingeU = hingeTowardsDir ? span.u1 : span.u0;
    const closedDir = hingeTowardsDir ? scale(f.dir, -1) : f.dir;
    const swingNormal = d.swing === 'in' ? intoNormal : scale(intoNormal, -1);
    const faceN = dot(swingNormal, f.left) > 0 ? f.nMax : f.nMin;
    const leafInset = 25 * Math.sign(dot(swingNormal, f.left));
    const hinge = frameAt(f, hingeU, faceN - leafInset);
    const swingSide: Side = dot(swingNormal, f.left) > 0 ? 'left' : 'right';
    const swingFloor =
      this.roomBeside(f, mid, swingSide)?.room.floorLevel ??
      this.outdoorBeside(f, mid, swingSide)?.area.level ??
      span.bottom;
    return {
      span,
      intoNormal,
      swingNormal,
      hinge,
      closedDir,
      openDir: swingNormal,
      openAngle: d.openAngle ?? DEFAULTS.openAngle,
      swingDirection: cross(closedDir, swingNormal) > 0 ? 'clockwise' : 'counterclockwise',
      swingFloor,
    };
  }

  /** Terskler: gulvflaten i dører og åpninger (gjennom veggtykkelsen). */
  thresholds(): Threshold[] {
    if (this.thresholdCache) return this.thresholdCache;
    const list: Threshold[] = [];
    for (const o of this.data.openings) {
      if (o.type === 'window') continue;
      const span = this.openingSpan(o);
      if (!span) continue;
      const f = span.frame;
      list.push({
        opening: o,
        level: span.bottom,
        polygon: [
          frameAt(f, span.u0, f.nMin),
          frameAt(f, span.u1, f.nMin),
          frameAt(f, span.u1, f.nMax),
          frameAt(f, span.u0, f.nMax),
        ],
      });
    }
    this.thresholdCache = list;
    return list;
  }

  /* ---------------- plassering av objekter ---------------- */

  /** Gulv i et punkt, eller laveste gulv hvis punktet ikke har gulv. */
  floorOrDefault(p: P2): number {
    return this.floorLevelAt(p) ?? this.lowestFloor;
  }

  fixturePlacement(fx: Fixture): Placement | null {
    const size = fixtureSize(fx);
    if (fx.mount) {
      const f = this.walls.get(fx.mount.wall);
      if (!f) return null;
      let side: Side | null = fx.mount.face ?? null;
      if (fx.mount.room) side = this.sideOfRoom(f, fx.mount.room, fx.mount.along) ?? this.sideOfRoom(f, fx.mount.room);
      if (!side) side = 'left';
      const normal = side === 'left' ? f.left : scale(f.left, -1);
      const faceN = side === 'left' ? f.nMax : f.nMin;
      const depth = fx.type === 'pipe' ? size[0] : size[2];
      const c = frameAt(f, fx.mount.along, faceN + (side === 'left' ? 1 : -1) * (depth / 2));
      const floor =
        this.roomBeside(f, fx.mount.along, side)?.room.floorLevel ??
        this.outdoorBeside(f, fx.mount.along, side)?.area.level ??
        this.lowestFloor;
      return { x: c.x, y: floor + fx.mount.height, z: c.z, yaw: yawFacing(normal) };
    }
    if (fx.position) {
      const [x, h, z] = fx.position;
      return { x, y: this.floorOrDefault(p2(x, z)) + h, z, yaw: yawFromDegrees(fx.rotation ?? 0) };
    }
    return null;
  }

  furniturePlacement(fu: Furniture): Placement {
    const [x, h, z] = fu.position;
    return { x, y: this.floorOrDefault(p2(x, z)) + h, z, yaw: yawFromDegrees(fu.rotation) };
  }

  /* ---------------- start i VR ---------------- */

  spawn(): Spawn {
    const entrance = this.data.openings.find((o): o is Door => o.type === 'door' && o.entrance === true);
    if (entrance) {
      const g = this.doorGeometry(entrance);
      if (g) {
        const f = g.span.frame;
        const mid = (g.span.u0 + g.span.u1) / 2;
        const onWall = frameAt(f, mid, (f.nMin + f.nMax) / 2);
        const halfT = (f.nMax - f.nMin) / 2;
        const position = add(onWall, scale(g.intoNormal, halfT + DEFAULTS.spawnInset));
        return { position, level: this.floorOrDefault(position), facing: g.intoNormal };
      }
    }
    const first = [...this.rooms.values()][0];
    const position = first ? centroid(first.polygon) : p2(0, 0);
    return { position, level: this.floorOrDefault(position), facing: p2(0, 1) };
  }

  /**
   * Godt sted å stå i et rom («Gå til rom»): litt inn fra et hjørne, med
   * blikket mot midten, der man ser lengst – da får man oversikt over rommet.
   */
  roomViewpoint(roomId: string): Spawn | null {
    const info = this.rooms.get(roomId);
    if (!info) return null;
    const poly = info.polygon;
    const c = centroid(poly);
    const edgeDist = (p: P2): number => {
      let d = Infinity;
      for (let i = 0; i < poly.length; i++) d = Math.min(d, distToSegment(p, poly[i]!, poly[(i + 1) % poly.length]!));
      return d;
    };
    let best: Spawn | null = null;
    let bestReach = -1;
    for (const v of poly) {
      const toC = sub(c, v);
      const l = len(toC);
      if (l < 1) continue;
      const dir = scale(toC, 1 / l);
      const p = add(v, scale(dir, Math.min(DEFAULTS.viewpointInset, l * 0.5)));
      if (!pointInPolygon(p, poly) || edgeDist(p) < 250) continue;
      const reach = rayToPolygon(p, dir, poly);
      if (reach > bestReach + 1) {
        bestReach = reach;
        best = { position: p, level: info.room.floorLevel, facing: dir };
      }
    }
    if (best) return best;
    const p = pointInPolygon(c, poly) ? c : poly[0]!;
    return { position: p, level: info.room.floorLevel, facing: p2(0, 1) };
  }

  /** Samlet omriss av alle rom (for kamera). */
  extent(): Bounds2 {
    const pts: P2[] = [];
    for (const r of this.rooms.values()) pts.push(...r.polygon);
    for (const f of this.walls.values()) pts.push(f.p0, f.p1);
    return pts.length ? bounds(pts) : { minX: -1000, minZ: -1000, maxX: 1000, maxZ: 1000 };
  }

  /** Høyeste tak (absolutt mm). */
  maxCeiling(): number {
    let m = this.lowestFloor + this.settings.defaultWallHeight;
    for (const r of this.rooms.values())
      for (const p of r.polygon) m = Math.max(m, this.ceilingAt(r, p));
    return m;
  }
}

export function makeFrame(wall: Wall): WallFrame {
  const p0 = p2(wall.start[0], wall.start[1]);
  const p1 = p2(wall.end[0], wall.end[1]);
  const d = sub(p1, p0);
  const dir = normalize(d);
  const t = wall.thickness;
  const justify = wall.justify ?? 'center';
  const [nMin, nMax] = justify === 'left' ? [0, t] : justify === 'right' ? [-t, 0] : [-t / 2, t / 2];
  return { wall, p0, p1, dir, left: leftOf(dir), length: len(d), nMin, nMax };
}

function sampleUs(length: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push((length * (i + 0.5)) / count);
  return out;
}

export function interpolate(poly: readonly { u: number; y: number }[], u: number): number {
  if (!poly.length) return 0;
  if (u <= poly[0]!.u) return poly[0]!.y;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]!;
    const b = poly[i]!;
    if (u <= b.u) return a.y + ((b.y - a.y) * (u - a.u)) / Math.max(1e-9, b.u - a.u);
  }
  return poly[poly.length - 1]!.y;
}

function simplifyPolyline(pts: { u: number; y: number }[]): { u: number; y: number }[] {
  if (pts.length <= 2) return pts;
  const out = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    const expected = a.y + ((c.y - a.y) * (b.u - a.u)) / (c.u - a.u);
    if (Math.abs(expected - b.y) > 0.5) out.push(b);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}


/** Avstand fra `o` langs `dir` (enhetsvektor) til nærmeste kant av polygonet. */
function rayToPolygon(o: P2, dir: P2, poly: readonly P2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const e = sub(b, a);
    const den = cross(dir, e);
    if (Math.abs(den) < 1e-9) continue;
    const ao = sub(a, o);
    const t = cross(ao, e) / den;
    const u = cross(ao, dir) / den;
    if (t > 1e-6 && u >= 0 && u <= 1) best = Math.min(best, t);
  }
  return Number.isFinite(best) ? best : 0;
}
