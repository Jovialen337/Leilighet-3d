/**
 * Lager veggene ut fra rommene.
 *
 * - To rom med kanter som vender mot hverandre (parallelle, med en luke på
 *   20–400 mm) får én skillevegg midt i luka, like tykk som luka.
 * - Luke 0 (kantene ligger oppå hverandre) er en åpen overgang uten vegg,
 *   f.eks. mellom to nivåer på badet.
 * - Resten av kantene blir yttervegger utenfor rommet (standard 200 mm).
 * - Yttervegger på samme linje slås sammen (f.eks. hele fasaden), utvendige
 *   hjørner lukkes, og veggender forlenges inn i små hull der vegger møtes.
 */
import type { WallMaterial } from '../schema/types';
import { add, dist, dot, edgesOf, scale, sub, type Edge, type P2 } from './geometry';
import { leftOf, rightOf } from '../geometry/math2d';
import type { BRoom, BuilderSettings } from './types';

/** Hvor en vegg kommer fra: et stykke av en romkant (s0–s1 mm langs kanten). */
export interface WallSource {
  room: string;
  edge: number;
  s0: number;
  s1: number;
}

export interface DerivedWall {
  id: string;
  kind: 'interior' | 'exterior';
  start: P2;
  end: P2;
  thickness: number;
  /** Hvilken side av linja start→slutt veggen ligger på (som i apartment.json). */
  justify: 'center' | 'left' | 'right';
  material: WallMaterial;
  color: string;
  name: string;
  /** Nedforing: underkant over laveste gulv (mm). Bare der to rom uten vegg har ulik takhøyde. */
  base?: number;
  /** Fra veggen i den importerte modellen på samme sted (se compile.ts). */
  height?: number;
  note?: string;
  layer?: string;
  /** Rommene veggen grenser til. */
  rooms: string[];
  sources: WallSource[];
}

/** Åpen overgang mellom to rom (ingen vegg). */
export interface OpenBoundary {
  a: WallSource;
  b: WallSource;
  start: P2;
  end: P2;
}

/** To rom med kanter mot hverandre som ikke er parallelle. */
export interface SkewedPair {
  a: string;
  b: string;
  /** Vinkelen mellom kantene (grader). */
  deg: number;
  /** Ble det likevel én skillevegg (under 3°)? Da: tykkelsen i hver ende (mm). */
  joined: boolean;
  gaps?: [number, number];
}

export interface WallResult {
  walls: DerivedWall[];
  open: OpenBoundary[];
  /** Advarsler (norsk), f.eks. veldig tynne vegger. */
  notes: string[];
  /** Skjeve kanter mellom rom (vises med «Rett opp alt»). */
  skewed: SkewedPair[];
}

/** Kanter innenfor 3° regnes som parallelle (blir én skillevegg). */
export const PARALLEL_DEG = 3;
const PARALLEL = Math.cos((PARALLEL_DEG * Math.PI) / 180);
/** Over dette er kantene ikke lenger «nesten parallelle» (et skrått rom med vilje). */
export const SKEW_MAX_DEG = 10;
const SKEW_MAX = Math.cos((SKEW_MAX_DEG * Math.PI) / 180);
/** Under dette er kantene parallelle nok (avrunding). */
const SKEW_MIN_DEG = 0.3;
/** Knekk under 2° er en rett vegg (ingen hjørne å lukke). */
const CORNER_MIN_SIN = Math.sin((2 * Math.PI) / 180);
/** Luker under dette er åpne overganger (mm). */
export const OPEN_GAP = 20;
const MIN_OVERLAP = 10;
const EXTERIOR_COLOR = '#e9e5dc';
const INTERIOR_COLOR = '#f3f1ec';

interface Cover {
  s0: number;
  s1: number;
}

interface Piece {
  start: P2;
  end: P2;
  thickness: number;
  /** Retning ut fra rommet (veggkroppen ligger på denne siden). */
  out: P2;
  material: WallMaterial;
  sources: WallSource[];
  rooms: string[];
}

const unit = (v: P2): P2 => {
  const l = Math.hypot(v.x, v.z);
  return l > 0 ? { x: v.x / l, z: v.z / l } : { x: 0, z: 0 };
};

/** Trekker fra dekkede intervaller fra [0, length]. */
function uncovered(length: number, covers: Cover[]): Cover[] {
  const sorted = [...covers].sort((a, b) => a.s0 - b.s0);
  const out: Cover[] = [];
  let at = 0;
  for (const c of sorted) {
    if (c.s0 > at + 1) out.push({ s0: at, s1: Math.min(c.s0, length) });
    at = Math.max(at, c.s1);
  }
  if (length > at + 1) out.push({ s0: at, s1: length });
  return out.filter((c) => c.s1 - c.s0 >= 1);
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'rom';

/** Veggens enhetsretning og normal mot siden kroppen ligger på. */
function frame(w: { start: P2; end: P2; justify: DerivedWall['justify'] }): { u: P2; n: P2; length: number } {
  const d = sub(w.end, w.start);
  const length = Math.hypot(d.x, d.z);
  const u = unit(d);
  return { u, n: w.justify === 'right' ? rightOf(u) : leftOf(u), length };
}

/** Rektangelet veggkroppen dekker: senterlinje og halv tykkelse. */
function body(w: DerivedWall): { a: P2; b: P2; u: P2; half: number } {
  const { u, n } = frame(w);
  const off = w.justify === 'center' ? 0 : w.thickness / 2;
  return { a: add(w.start, scale(n, off)), b: add(w.end, scale(n, off)), u, half: w.thickness / 2 };
}

/** Avstanden langs en stråle til den går inn i en veggkropp (eller Infinity). */
function rayToBody(o: P2, dir: P2, w: DerivedWall): number {
  const bd = body(w);
  const n = { x: -bd.u.z, z: bd.u.x };
  const len = dist(bd.a, bd.b);
  // Rektangelet i veggens egen ramme: s ∈ [0, len], t ∈ [−half, half].
  const os = dot(sub(o, bd.a), bd.u);
  const ot = dot(sub(o, bd.a), n);
  const ds = dot(dir, bd.u);
  const dt = dot(dir, n);
  let t0 = 0;
  let t1 = Infinity;
  for (const [p, d, lo, hi] of [
    [os, ds, 0, len],
    [ot, dt, -bd.half, bd.half],
  ] as const) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo - 0.5 || p > hi + 0.5) return Infinity;
      continue;
    }
    let a = (lo - p) / d;
    let b = (hi - p) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return Infinity;
  }
  return t0;
}

/** Avstanden langs en stråle til den krysser en romkant (eller Infinity). Parallelle kanter teller ikke. */
function rayToRooms(o: P2, dir: P2, rooms: readonly P2[][]): number {
  let best = Infinity;
  for (const poly of rooms)
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const e = sub(b, a);
      const den = dir.x * e.z - dir.z * e.x;
      if (Math.abs(den) < 1e-9) continue;
      const w = sub(a, o);
      const t = (w.x * e.z - w.z * e.x) / den;
      const s = (w.x * dir.z - w.z * dir.x) / den;
      if (t > 0.5 && s >= -1e-6 && s <= 1 + 1e-6) best = Math.min(best, t);
    }
  return best;
}

export function deriveWalls(rooms: readonly BRoom[], settings: BuilderSettings): WallResult {
  const notes: string[] = [];
  const polys = rooms.map((r) => r.polygon.map((p) => ({ x: p.x, z: p.z })));
  const edges: Edge[][] = polys.map((p) => edgesOf(p));
  const covers: Cover[][][] = edges.map((list) => list.map(() => []));
  const interior: DerivedWall[] = [];
  const open: OpenBoundary[] = [];
  const skew = new Map<string, SkewedPair>();
  const noteSkew = (k: SkewedPair): void => {
    const key = `${k.a}|${k.b}`;
    const was = skew.get(key);
    if (!was || k.deg > was.deg) skew.set(key, k);
  };

  // 1. Kanter som vender mot hverandre.
  for (let ra = 0; ra < rooms.length; ra++)
    for (const e of edges[ra]!) {
      if (e.length <= 0) continue;
      for (let rb = 0; rb < rooms.length; rb++) {
        if (rb === ra) continue;
        for (const f of edges[rb]!) {
          if (f.length <= 0) continue;
          const facing = -dot(e.out, f.out);
          if (facing < SKEW_MAX) continue;
          // Avstanden fra kanten i A til hver ende av kanten i B.
          const ga = dot(sub(f.a, e.a), e.out);
          const gb = dot(sub(f.b, e.a), e.out);
          const g = (ga + gb) / 2;
          const sa = dot(sub(f.a, e.a), e.u);
          const sb = dot(sub(f.b, e.a), e.u);
          const s0 = Math.max(0, Math.min(sa, sb));
          const s1 = Math.min(e.length, Math.max(sa, sb));
          if (facing < PARALLEL) {
            // 3–10°: blir ikke én skillevegg, men to yttervegger som kan gå inn i hverandre.
            if (ra < rb && s1 - s0 >= MIN_OVERLAP && Math.max(ga, gb) >= -OPEN_GAP && Math.min(ga, gb) <= settings.maxWallGap)
              noteSkew({ a: rooms[ra]!.id, b: rooms[rb]!.id, deg: (Math.acos(Math.min(1, facing)) * 180) / Math.PI, joined: false });
            continue;
          }
          if (g < -OPEN_GAP || g > settings.maxWallGap) continue;
          if (s1 - s0 < MIN_OVERLAP) continue;
          covers[ra]![e.i]!.push({ s0, s1 });
          // Hvert par lages én gang (fra rommet med lavest nummer).
          if (ra > rb) continue;
          const pa = add(e.a, scale(e.u, s0));
          const pb = add(e.a, scale(e.u, s1));
          const deg = (Math.acos(Math.min(1, facing)) * 180) / Math.PI;
          if (deg > SKEW_MIN_DEG && g >= OPEN_GAP) {
            // Skilleveggen er rett, men luka er kileformet: den passer ikke helt i den ene enden.
            const gapAt = (p: P2): number => Math.round(dot(sub(p, f.a), f.out));
            noteSkew({ a: rooms[ra]!.id, b: rooms[rb]!.id, deg, joined: true, gaps: [gapAt(pa), gapAt(pb)] });
          }
          const fs = (p: P2): number => dot(sub(p, f.a), f.u);
          const srcA: WallSource = { room: rooms[ra]!.id, edge: e.i, s0, s1 };
          const fa = fs(pa);
          const fb = fs(pb);
          const srcB: WallSource = { room: rooms[rb]!.id, edge: f.i, s0: Math.max(0, Math.min(fa, fb)), s1: Math.min(f.length, Math.max(fa, fb)) };
          const gap = Math.max(0, g);
          if (gap < OPEN_GAP) {
            open.push({ a: srcA, b: srcB, start: pa, end: pb });
            if (gap > 2)
              notes.push(
                `«${rooms[ra]!.name}» og «${rooms[rb]!.name}» ligger ${Math.round(gap)} mm fra hverandre – regnet som åpen overgang uten vegg. Flytt kanten inntil, eller lag en luke på minst ${OPEN_GAP} mm for en vegg.`,
              );
            // Ulik takhøyde uten vegg imellom: en nedforing fyller spranget i taket.
            const A = rooms[ra]!;
            const B = rooms[rb]!;
            const ca = A.floor + A.ceiling;
            const cb = B.floor + B.ceiling;
            if (Math.abs(ca - cb) > 20) {
              // Linja på grensen; kroppen over rommet med lavest tak (skjult over det taket).
              const towardB = ca > cb;
              const bodyDir = towardB ? e.out : scale(e.out, -1);
              interior.push({
                id: '',
                kind: 'interior',
                start: pa,
                end: pb,
                thickness: 60,
                justify: dot(leftOf(e.u), bodyDir) > 0 ? 'left' : 'right',
                material: 'drywall',
                color: INTERIOR_COLOR,
                name: `Nedforing ${A.name.toLowerCase()}/${B.name.toLowerCase()}`,
                base: Math.round(Math.min(ca, cb) - Math.min(A.floor, B.floor)),
                rooms: [A.id, B.id],
                sources: [],
              });
            }
            continue;
          }
          if (gap < 50) notes.push(`Veggen mellom «${rooms[ra]!.name}» og «${rooms[rb]!.name}» blir bare ${Math.round(gap)} mm tykk.`);
          const mat = rooms[ra]!.edges?.[e.i]?.material ?? 'drywall';
          // Linja ligger på flaten i rom A, og kroppen går over luka til rom B – begge flatene
          // havner nøyaktig på romkantene (oppmålingen flytter vegger som ligger på kantene).
          interior.push({
            id: '',
            kind: 'interior',
            start: pa,
            end: pb,
            thickness: Math.round(gap),
            justify: dot(leftOf(e.u), e.out) > 0 ? 'left' : 'right',
            material: mat,
            color: INTERIOR_COLOR,
            name: `Skillevegg ${rooms[ra]!.name.toLowerCase()}/${rooms[rb]!.name.toLowerCase()}`,
            rooms: [rooms[ra]!.id, rooms[rb]!.id],
            sources: [srcA, srcB],
          });
        }
      }
    }

  // 2. Resten av kantene: yttervegger.
  const pieces: Piece[] = [];
  rooms.forEach((room, ri) => {
    for (const e of edges[ri]!) {
      if (e.length <= 0) continue;
      const opt = room.edges?.[e.i];
      for (const c of uncovered(e.length, covers[ri]![e.i]!)) {
        // Korte biter mellom to skillevegger er bare kryss der veggene møtes (fylles i steg 5).
        const inner = c.s0 > 1 && c.s1 < e.length - 1;
        if (inner && c.s1 - c.s0 <= settings.maxWallGap) continue;
        pieces.push({
          start: add(e.a, scale(e.u, c.s0)),
          end: add(e.a, scale(e.u, c.s1)),
          thickness: opt?.thickness ?? settings.exteriorThickness,
          out: e.out,
          material: opt?.material ?? 'brick',
          sources: [{ room: room.id, edge: e.i, s0: c.s0, s1: c.s1 }],
          rooms: [room.id],
        });
      }
    }
  });

  // 3. Slå sammen yttervegger på samme linje (luker opp til en skillevegg slås sammen).
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < pieces.length; i++)
      for (let j = i + 1; j < pieces.length; j++) {
        const p = pieces[i]!;
        const q = pieces[j]!;
        if (p.thickness !== q.thickness || p.material !== q.material || dot(p.out, q.out) < PARALLEL) continue;
        const u = unit(sub(p.end, p.start));
        if (Math.abs(dot(sub(q.start, p.start), p.out)) > 5 || Math.abs(dot(sub(q.end, p.start), p.out)) > 5) continue;
        const pa = 0;
        const pb = dot(sub(p.end, p.start), u);
        const qa = dot(sub(q.start, p.start), u);
        const qb = dot(sub(q.end, p.start), u);
        const lo = Math.min(qa, qb);
        const hi = Math.max(qa, qb);
        const gap = Math.max(lo - pb, pa - hi);
        if (gap > settings.maxWallGap) continue;
        const a = Math.min(pa, lo);
        const b = Math.max(pb, hi);
        pieces[i] = {
          ...p,
          start: add(p.start, scale(u, a)),
          end: add(p.start, scale(u, b)),
          sources: [...p.sources, ...q.sources],
          rooms: [...new Set([...p.rooms, ...q.rooms])],
        };
        pieces.splice(j, 1);
        merged = true;
        break outer;
      }
  }

  const byId = new Map(rooms.map((r) => [r.id, r]));
  const exterior: DerivedWall[] = pieces.map((p) => {
    const u = unit(sub(p.end, p.start));
    const justify = dot(leftOf(u), p.out) > 0 ? 'left' : 'right';
    const names = p.rooms.map((id) => byId.get(id)?.name.toLowerCase() ?? id);
    return {
      id: '',
      kind: 'exterior',
      start: p.start,
      end: p.end,
      thickness: Math.round(p.thickness),
      justify,
      material: p.material,
      color: EXTERIOR_COLOR,
      name: `Yttervegg ${names.join('/')}`,
      rooms: p.rooms,
      sources: p.sources,
    };
  });

  // 4. Lukk utvendige hjørner (alle vinkler): veggene forlenges til ytterflatene møtes.
  //    Rett vinkel: bare den ene forlenges (ingen overlapp). Butt vinkel (f.eks. en karnapp
  //    på 45°): begge forlenges til punktet der ytterflatene møtes. Spiss vinkel: begge
  //    forlenges til ytterflaten på den andre (hjørnet kuttes i stedet for å stikke ut).
  const stretch: { w: DerivedWall; key: 'start' | 'end'; dir: P2; by: number }[] = [];
  for (let i = 0; i < exterior.length; i++)
    for (let j = i + 1; j < exterior.length; j++) {
      const A = exterior[i]!;
      const B = exterior[j]!;
      const fa = frame(A);
      const fb = frame(B);
      for (const endA of ['start', 'end'] as const)
        for (const endB of ['start', 'end'] as const) {
          if (dist(A[endA], B[endB]) > 5) continue;
          const outA = endA === 'end' ? fa.u : scale(fa.u, -1);
          const outB = endB === 'end' ? fb.u : scale(fb.u, -1);
          // Sinus til knekkvinkelen, sett fra hver vegg: positiv i et utvendig hjørne.
          const sinA = dot(fb.n, outA);
          const sinB = dot(fa.n, outB);
          if (sinA < CORNER_MIN_SIN || sinB < CORNER_MIN_SIN) continue;
          const cos = dot(fa.n, fb.n);
          if (Math.abs(cos) < 0.02) {
            stretch.push({ w: A, key: endA, dir: outA, by: B.thickness });
            continue;
          }
          const k = Math.max(0, cos);
          stretch.push({ w: A, key: endA, dir: outA, by: (B.thickness - A.thickness * k) / sinA });
          stretch.push({ w: B, key: endB, dir: outB, by: (A.thickness - B.thickness * k) / sinB });
        }
    }
  for (const x of stretch) if (x.by > 0) x.w[x.key] = add(x.w[x.key], scale(x.dir, x.by));

  const walls = [...exterior, ...interior];

  // 5. Fyll små hull der vegger møtes: forleng en veggende til nærmeste veggkropp rett fram,
  //    hvis det ikke ligger et rom imellom.
  for (const w of walls)
    for (const endKey of ['start', 'end'] as const) {
      const f = frame(w);
      const dir = endKey === 'end' ? f.u : scale(f.u, -1);
      const off = w.justify === 'center' ? 0 : w.thickness / 2;
      const o = add(w[endKey], scale(f.n, off));
      let tWall = Infinity;
      for (const v of walls) if (v !== w) tWall = Math.min(tWall, rayToBody(o, dir, v));
      if (!(tWall > 0.5 && tWall <= settings.maxWallGap)) continue;
      if (rayToRooms(o, dir, polys) < tWall - 0.5) continue;
      w[endKey] = add(w[endKey], scale(dir, tWall));
    }

  // 6. Id-er (stabile for samme tegning).
  const used = new Set<string>();
  const uniq = (base: string): string => {
    let id = base;
    for (let k = 2; used.has(id); k++) id = `${base}-${k}`;
    used.add(id);
    return id;
  };
  for (const w of walls) {
    const parts = w.rooms.map((id) => slug(id)).slice(0, 2);
    w.id = uniq(w.kind === 'interior' ? `v-${parts.join('-')}` : `v-${parts[0]}-ute`);
    w.start = { x: Math.round(w.start.x), z: Math.round(w.start.z) };
    w.end = { x: Math.round(w.end.x), z: Math.round(w.end.z) };
  }
  return { walls, open, notes, skewed: [...skew.values()] };
}

/**
 * Finner veggen et stykke av en romkant (s0–s1) ligger på, og hvor langs
 * veggen stykket begynner og slutter. Null hvis stykket ikke ligger helt på
 * én vegg.
 */
export function wallAt(
  walls: readonly DerivedWall[],
  room: BRoom,
  edgeIndex: number,
  s0: number,
  s1: number,
): { wall: DerivedWall; a0: number; a1: number } | null {
  const e = edgesOf(room.polygon)[edgeIndex];
  if (!e) return null;
  for (const w of walls)
    for (const src of w.sources) {
      if (src.room !== room.id || src.edge !== edgeIndex || s0 < src.s0 - 1 || s1 > src.s1 + 1) continue;
      const { u } = frame(w);
      const at = (s: number): number => dot(sub(add(e.a, scale(e.u, s)), w.start), u);
      return { wall: w, a0: at(s0), a1: at(s1) };
    }
  return null;
}

/** Er stykket av romkanten en åpen overgang (ingen vegg)? */
export function isOpenAt(open: readonly OpenBoundary[], room: string, edge: number, s0: number, s1: number): boolean {
  return open.some((o) =>
    [o.a, o.b].some((src) => src.room === room && src.edge === edge && s1 > src.s0 + 1 && s0 < src.s1 - 1),
  );
}

export { slug };
