/**
 * Bakt dagslys i hjørnefargene («Standard» og «Høy»): hvert hjørne i gulv,
 * tak og vegger får en lysfaktor som regnes ut én gang når modellen bygges –
 * ingenting skjer per bilde, og ingen ekstra tegnekall.
 *
 * - Lys fra vinduene: hvor mye av vinduet et punkt «ser» (formfaktoren til
 *   vindusflaten, med retningen på flaten), så gulvet og veggene nær vinduene
 *   blir lyse, og lyset faller av innover i rommet.
 * - Rom med mye vindu er lysere overalt (gjenskinn), og litt av lyset går
 *   videre til naborommene gjennom dører og åpne overganger.
 * - Hjørner og kanter blir mørkere («ambient occlusion»): gulv og tak langs
 *   veggene, veggene nær gulv, tak og innvendige hjørner, og nederst på møbler.
 * - Lampelys: lampepunktene («light») lyser opp rommet de henger i, mest rett
 *   under og avtagende med avstanden.
 *
 * De tre delene (grunnlys, dagslys fra vinduene og lampelys) lagres hver for
 * seg per hjørne, så «Lys» (morgen/dag/kveld) kan blande dem på nytt uten å
 * bake på nytt (`mixLight`).
 *
 * Store flater deles først opp i et rutenett (`tessellate`), så lyset kan
 * variere over dem. Rutene følger faste linjer i verden, så naboflater får
 * de samme hjørnene langs kantene (ingen sprekker).
 *
 * Mm i modellen, meter i geometrien.
 */
import * as THREE from 'three';
import { frameAt, type ApartmentModel, type RoomInfo } from '../model/ApartmentModel';
import { distToSegment, pointInPolygon, polygonArea, polygonGap, type P2 } from '../geometry/math2d';
import { roomEdges, type EdgePiece } from './roomEdges';
import { MM } from './geom';
import type { PartKind } from './buildParts';

export const BAKE = {
  /** Rutenettet store flater deles i (meter). */
  cell: 0.3,
  /** Grunnlys i alle rom. */
  ambient: 0.62,
  /** Lys fra vinduene (ganges med formfaktoren, 0–1). */
  window: 4,
  /** Gjenskinn: vindusareal / gulvareal ganges med dette … */
  roomFill: 0.55,
  /** … og nabolagets vinduer teller med denne andelen. */
  neighbour: 0.3,
  /** Høyeste og laveste faktor; over 1 flater lyset mykt ut mot `max`. */
  max: 1.3,
  min: 0.35,
  /** Lampelys: styrke og hvor mykt det faller av nær lampa (m²). */
  lamp: { power: 2, soft: 0.3 },
  ao: {
    /** Mørkere langs veggene og i hjørner: styrke og bredde (mm). */
    edge: 0.2,
    edgeWidth: 320,
    /** Veggene nær gulvet og taket. */
    floor: 0.16,
    ceiling: 0.12,
    heightWidth: 260,
    /** Nederst på møbler. */
    furniture: 0.22,
    furnitureWidth: 160,
  },
} as const;

/** Delene som får bakt lys (resten beholder fargen fra fila). */
export const BAKED_KINDS: ReadonlySet<PartKind> = new Set<PartKind>(['floor', 'ceiling', 'wall', 'door', 'window', 'threshold', 'trim', 'fixture', 'furniture']);
/** Delene som deles opp i ruter (store flater). */
export const TESSELLATED_KINDS: ReadonlySet<PartKind> = new Set<PartKind>(['floor', 'ceiling', 'wall']);

/* ---------------------------------------------------------------- */
/* Oppdeling i ruter                                                 */
/* ---------------------------------------------------------------- */

type GP = { x: number; y: number; z: number; u: number; v: number };

function clipAxis(poly: GP[], key: 'u' | 'v', at: number, keepAbove: boolean): GP[] {
  const out: GP[] = [];
  const inside = (p: GP): boolean => (keepAbove ? p[key] >= at : p[key] <= at);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ia = inside(a);
    if (ia) out.push(a);
    if (ia !== inside(b)) {
      const t = (at - a[key]) / (b[key] - a[key]);
      out.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
        u: key === 'u' ? at : a.u + (b.u - a.u) * t,
        v: key === 'v' ? at : a.v + (b.v - a.v) * t,
      });
    }
  }
  return out;
}

/**
 * Deler trekantene i et rutenett med ruter på `cell` meter. Vannrette flater
 * deles langs x og z, loddrette langs veggen og i høyden. Geometrien må være
 * uten indeks og ha flate normaler (som fra GeoBuilder).
 */
export function tessellate(geo: THREE.BufferGeometry, cell: number = BAKE.cell): THREE.BufferGeometry {
  const pa = geo.getAttribute('position').array as ArrayLike<number>;
  const na = geo.getAttribute('normal').array as ArrayLike<number>;
  const pos: number[] = [];
  const nrm: number[] = [];
  const emit = (p: GP, nx: number, ny: number, nz: number): void => {
    pos.push(p.x, p.y, p.z);
    nrm.push(nx, ny, nz);
  };
  for (let t = 0; t + 8 < pa.length; t += 9) {
    const nx = na[t]!;
    const ny = na[t + 1]!;
    const nz = na[t + 2]!;
    // Aksene i flaten: x/z for vannrette, (langs veggen, høyde) for loddrette.
    let ux = 1;
    let uz = 0;
    let flat = true;
    if (Math.abs(ny) <= 0.7) {
      flat = false;
      const l = Math.hypot(nz, nx) || 1;
      ux = nz / l;
      uz = -nx / l;
    }
    const tri: GP[] = [0, 3, 6].map((o) => {
      const x = pa[t + o]!;
      const y = pa[t + o + 1]!;
      const z = pa[t + o + 2]!;
      return { x, y, z, u: flat ? x : x * ux + z * uz, v: flat ? z : y };
    });
    const us = tri.map((p) => p.u);
    const vs = tri.map((p) => p.v);
    const i0 = Math.floor(Math.min(...us) / cell);
    const i1 = Math.ceil(Math.max(...us) / cell);
    const j0 = Math.floor(Math.min(...vs) / cell);
    const j1 = Math.ceil(Math.max(...vs) / cell);
    if (i1 - i0 <= 1 && j1 - j0 <= 1) {
      for (const p of tri) emit(p, nx, ny, nz);
      continue;
    }
    for (let i = i0; i < i1; i++) {
      let strip = clipAxis(tri, 'u', i * cell, true);
      strip = clipAxis(strip, 'u', (i + 1) * cell, false);
      if (strip.length < 3) continue;
      for (let j = j0; j < j1; j++) {
        let poly = clipAxis(strip, 'v', j * cell, true);
        poly = clipAxis(poly, 'v', (j + 1) * cell, false);
        if (poly.length < 3) continue;
        for (let k = 1; k + 1 < poly.length; k++) {
          const a = poly[0]!;
          const b = poly[k]!;
          const c = poly[k + 1]!;
          // Hopper over trekanter uten areal (to like hjørner).
          const area = Math.abs((b.u - a.u) * (c.v - a.v) - (c.u - a.u) * (b.v - a.v));
          if (area < 1e-10) continue;
          emit(a, nx, ny, nz);
          emit(b, nx, ny, nz);
          emit(c, nx, ny, nz);
        }
      }
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return out;
}

/* ---------------------------------------------------------------- */
/* Lys                                                               */
/* ---------------------------------------------------------------- */

type V = { x: number; y: number; z: number };

/**
 * Formfaktoren fra et lite flatestykke i `p` med normal `n` til polygonet
 * (0–1): hvor stor del av lyset fra en jevnt lysende flate som når punktet.
 * Polygonet klippes først til halvrommet foran flaten.
 */
export function formFactor(p: V, n: V, poly: readonly V[]): number {
  const front = (q: V): number => (q.x - p.x) * n.x + (q.y - p.y) * n.y + (q.z - p.z) * n.z;
  const eps = 0.5;
  const clipped: V[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const fa = front(a) - eps;
    const fb = front(b) - eps;
    if (fa >= 0) clipped.push(a);
    if (fa >= 0 !== fb >= 0) {
      const t = fa / (fa - fb);
      clipped.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  if (clipped.length < 3) return 0;
  const r = clipped.map((q) => {
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const dz = q.z - p.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    return { x: dx / l, y: dy / l, z: dz / l };
  });
  let sum = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!;
    const b = r[(i + 1) % r.length]!;
    const cx = a.y * b.z - a.z * b.y;
    const cy = a.z * b.x - a.x * b.z;
    const cz = a.x * b.y - a.y * b.x;
    const cl = Math.hypot(cx, cy, cz);
    if (cl < 1e-12) continue;
    const angle = Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z)));
    sum += (angle * (cx * n.x + cy * n.y + cz * n.z)) / cl;
  }
  return Math.min(1, Math.abs(sum) / (2 * Math.PI));
}

/** Hvor mye av hver del av det bakte lyset som brukes (fra «Lys»). */
export interface BakeMix {
  ambient: number;
  window: number;
  lamp: number;
}

/** Dagslys: grunnlys og vinduer, ingen lamper. */
export const DAY_MIX: BakeMix = { ambient: 1, window: 1, lamp: 0 };

/** Lyset i et punkt delt i grunnlys, dagslys fra vinduene og lampelys (alle med kantmørket). */
export interface LightParts {
  amb: number;
  win: number;
  lamp: number;
}

/** Det samme for alle hjørnene i en geometri. */
export interface LightArrays {
  amb: Float32Array;
  win: Float32Array;
  lamp: Float32Array;
}

/** Blander delene til én faktor; lyst flater mykt ut (ingen utbrente vegger). */
export function mixLight(amb: number, win: number, lamp: number, m: BakeMix): number {
  const f = m.ambient * amb + m.window * win + m.lamp * lamp;
  if (f <= 1) return Math.max(BAKE.min, f);
  const head = BAKE.max - 1;
  return 1 + head * Math.tanh((f - 1) / head);
}

interface RoomLight {
  info: RoomInfo;
  /** Vinduene sett fra rommet: hjørnene på innsiden (mm). */
  windows: V[][];
  edges: EdgePiece[];
  fill: number;
  /** Lampepunktene i rommet (mm). */
  lamps: V[];
}

const segDist = (p: P2, a: P2, b: P2): number => distToSegment(p, a, b);

/** Regner ut lysfaktorene for en modell. */
export class Baker {
  private readonly rooms: RoomLight[] = [];

  constructor(private readonly model: ApartmentModel) {
    const winArea = new Map<string, number>();
    for (const info of model.rooms.values()) {
      const windows: V[][] = [];
      let area = 0;
      for (const o of model.data.openings) {
        if (o.type !== 'window' || o.room !== info.room.id) continue;
        const span = model.openingSpan(o);
        if (!span) continue;
        const f = span.frame;
        const side = model.sideOfRoom(f, info.room.id, (span.u0 + span.u1) / 2);
        if (!side) continue;
        const n = side === 'left' ? f.nMax : f.nMin;
        const a = frameAt(f, span.u0, n);
        const b = frameAt(f, span.u1, n);
        windows.push([
          { x: a.x, y: span.bottom, z: a.z },
          { x: b.x, y: span.bottom, z: b.z },
          { x: b.x, y: span.top, z: b.z },
          { x: a.x, y: span.top, z: a.z },
        ]);
        area += (span.u1 - span.u0) * (span.top - span.bottom);
      }
      winArea.set(info.room.id, area);
      this.rooms.push({ info, windows, edges: roomEdges(model, info, false), fill: 0, lamps: [] });
    }
    for (const fx of model.data.fixtures) {
      if (fx.type !== 'light') continue;
      const pl = model.fixturePlacement(fx);
      const room = pl && model.roomAt({ x: pl.x, z: pl.z });
      const r = room && this.rooms.find((x) => x.info === room);
      if (pl && r) r.lamps.push({ x: pl.x, y: pl.y, z: pl.z });
    }
    // Gjenskinn: egne vinduer, og en del av vinduene i rom man ser inn i.
    for (const r of this.rooms) {
      let area = winArea.get(r.info.room.id) ?? 0;
      for (const o of this.rooms) {
        if (o === r || !this.connected(r.info, o.info)) continue;
        area += BAKE.neighbour * (winArea.get(o.info.room.id) ?? 0);
      }
      const floor = Math.max(1, polygonArea(r.info.polygon));
      r.fill = Math.min(0.35, (BAKE.roomFill * area) / floor);
    }
  }

  /** Henger rommene sammen (åpen overgang eller en dør/åpning mellom dem)? */
  private connected(a: RoomInfo, b: RoomInfo): boolean {
    if (polygonGap(a.polygon, b.polygon) < 5) return true;
    for (const o of this.model.data.openings) {
      if (o.type === 'window') continue;
      const span = this.model.openingSpan(o);
      if (!span) continue;
      const f = span.frame;
      const mid = (span.u0 + span.u1) / 2;
      const p = frameAt(f, mid, f.nMax + 60);
      const q = frameAt(f, mid, f.nMin - 60);
      const inA = (x: P2): boolean => pointInPolygon(x, a.polygon);
      const inB = (x: P2): boolean => pointInPolygon(x, b.polygon);
      if ((inA(p) && inB(q)) || (inA(q) && inB(p))) return true;
    }
    return false;
  }

  /** Rommet et punkt (mm) ligger i, sett litt ut langs normalen. */
  roomAt(p: V, n: V, hint?: string): RoomLight | null {
    if (hint) {
      const r = this.rooms.find((x) => x.info.room.id === hint);
      if (r) return r;
    }
    const q = { x: p.x + n.x * 60, z: p.z + n.z * 60 };
    for (const r of this.rooms) {
      if (!pointInPolygon(q, r.info.polygon)) continue;
      if (p.y < r.info.room.floorLevel - 60 || p.y > this.model.ceilingAt(r.info, q) + 60) continue;
      return r;
    }
    return null;
  }

  /** Lysfaktoren i punktet `p` (mm) med normal `n`, i dagslys. */
  factor(p: V, n: V, kind: PartKind, hint?: string): number {
    const l = this.parts(p, n, kind, hint);
    return mixLight(l.amb, l.win, l.lamp, DAY_MIX);
  }

  /** Grunnlys, dagslys og lampelys i punktet `p` (mm) med normal `n`. */
  parts(p: V, n: V, kind: PartKind, hint?: string): LightParts {
    // Gulv og tak hører til rommet sitt (men ikke sidekantene på gulvtrinn).
    const r = this.roomAt(p, n, (kind === 'floor' || kind === 'ceiling') && Math.abs(n.y) > 0.7 ? hint : undefined);
    if (!r) return { amb: 1, win: 0, lamp: 0 };
    const A = BAKE.ao;
    let win = r.fill;
    const q = { x: p.x + n.x, y: p.y + n.y, z: p.z + n.z };
    for (const w of r.windows) win += BAKE.window * formFactor(q, n, w);
    let lamp = 0;
    for (const L of r.lamps) {
      const dx = (L.x - q.x) * MM;
      const dy = (L.y - q.y) * MM;
      const dz = (L.z - q.z) * MM;
      const d2 = dx * dx + dy * dy + dz * dz;
      const d = Math.sqrt(d2) || 1;
      const facing = Math.max(0, (dx * n.x + dy * n.y + dz * n.z) / d);
      // Lampa lyser mest nedover.
      const down = 0.3 + 0.7 * Math.max(0, dy / d);
      lamp += (BAKE.lamp.power * facing * down) / (d2 + BAKE.lamp.soft);
    }
    // Mørkere nær kanter og hjørner.
    let ao = 1;
    const p2 = { x: p.x, z: p.z };
    const horizontal = Math.abs(n.y) > 0.7;
    for (const e of r.edges) {
      // Hopp over veggflaten punktet selv ligger på.
      if (!horizontal && e.inward.x * n.x + e.inward.z * n.z > 0.9 && segDist(p2, e.a, e.b) < 15) continue;
      const d = segDist(p2, e.a, e.b);
      if (d < A.edgeWidth * 4) ao *= 1 - A.edge * Math.exp(-d / A.edgeWidth);
    }
    const floor = r.info.room.floorLevel;
    if (!horizontal) {
      const ceil = this.model.ceilingAt(r.info, p2);
      ao *= 1 - A.floor * Math.exp(-Math.max(0, p.y - floor) / A.heightWidth);
      ao *= 1 - A.ceiling * Math.exp(-Math.max(0, ceil - p.y) / A.heightWidth);
    }
    if (kind === 'furniture') ao *= 1 - A.furniture * Math.exp(-Math.max(0, p.y - floor) / A.furnitureWidth);
    return { amb: BAKE.ambient * ao, win: win * ao, lamp: lamp * ao };
  }

  /**
   * Faktorene for alle hjørnene i en geometri (meter). Trekantene deler
   * hjørner, så hvert hjørne (posisjon og normal) regnes ut bare én gang.
   */
  factors(geo: THREE.BufferGeometry, kind: PartKind, hint?: string): LightArrays {
    const pa = geo.getAttribute('position');
    const na = geo.getAttribute('normal');
    const out: LightArrays = { amb: new Float32Array(pa.count), win: new Float32Array(pa.count), lamp: new Float32Array(pa.count) };
    const seen = new Map<string, LightParts>();
    const p = { x: 0, y: 0, z: 0 };
    const n = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < pa.count; i++) {
      p.x = pa.getX(i) / MM;
      p.y = pa.getY(i) / MM;
      p.z = pa.getZ(i) / MM;
      n.x = na.getX(i);
      n.y = na.getY(i);
      n.z = na.getZ(i);
      const key = `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)},${Math.round(n.x * 100)},${Math.round(n.y * 100)},${Math.round(n.z * 100)}`;
      let f = seen.get(key);
      if (f === undefined) {
        f = this.parts(p, n, kind, hint);
        seen.set(key, f);
      }
      out.amb[i] = f.amb;
      out.win[i] = f.win;
      out.lamp[i] = f.lamp;
    }
    return out;
  }
}
