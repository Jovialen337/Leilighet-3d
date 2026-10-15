/**
 * Geometri for byggeren: kanter med utover-normal, overlapp mellom rom og
 * oppretting av skjeve rom (rette vinkler) – ren matematikk, uten three.js.
 */
import { add, cross, dist, dot, isSelfIntersecting, leftOf, len, p2, pointInPolygon, rightOf, scale, signedArea, sub, type P2 } from '../geometry/math2d';

export interface Edge {
  /** Kantens nummer i polygonet (fra hjørne i til i+1). */
  i: number;
  a: P2;
  b: P2;
  /** Enhetsretning a → b. */
  u: P2;
  length: number;
  /** Enhetsnormal ut av rommet. */
  out: P2;
}

/** +1 hvis polygonet går «med klokka» på skjermen (positivt skolisseareal), ellers −1. */
export const orientation = (poly: readonly P2[]): 1 | -1 => (signedArea(poly) >= 0 ? 1 : -1);

/** Kantene i et rom, med retning og normal ut av rommet. Kanter med null lengde får u = 0. */
export function edgesOf(poly: readonly P2[]): Edge[] {
  const sgn = orientation(poly);
  const out: Edge[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const d = sub(b, a);
    const length = len(d);
    const u = length > 0 ? scale(d, 1 / length) : p2(0, 0);
    out.push({ i, a, b, u, length, out: sgn > 0 ? leftOf(u) : rightOf(u) });
  }
  return out;
}

/** Punktet `s` mm langs kanten. */
export const alongEdge = (e: Edge, s: number): P2 => add(e.a, scale(e.u, s));

/** Avstand langs kanten (s) og fra kanten (utover, d) for et punkt. */
export function edgeCoords(e: Edge, p: P2): { s: number; d: number } {
  const v = sub(p, e.a);
  return { s: dot(v, e.u), d: dot(v, e.out) };
}

/** Gyldig rompolygon: minst 3 hjørner, areal, ikke selvkryssende. Returnerer en norsk feilmelding eller null. */
export function polygonProblem(poly: readonly P2[]): string | null {
  if (poly.length < 3) return 'trenger minst 3 hjørner.';
  for (let i = 0; i < poly.length; i++) if (dist(poly[i]!, poly[(i + 1) % poly.length]!) < 1) return 'har to hjørner på samme sted.';
  if (Math.abs(signedArea(poly)) < 10_000) return 'er for lite (under 0,01 m²).';
  if (isSelfIntersecting(poly)) return 'krysser seg selv.';
  return null;
}

function segmentsCross(a: P2, b: P2, c: P2, d: P2): boolean {
  const d1 = cross(sub(b, a), sub(c, a));
  const d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c));
  const d4 = cross(sub(d, c), sub(b, c));
  return d1 * d2 < -1e-6 && d3 * d4 < -1e-6;
}

/** Krymper et polygon litt mot midten (for robuste innenfor-tester). */
function inset(poly: readonly P2[], mm: number): P2[] {
  const edges = edgesOf(poly);
  return poly.map((p, i) => {
    const prev = edges[(i - 1 + poly.length) % poly.length]!;
    const next = edges[i]!;
    const n = scale(add(prev.out, next.out), -0.5);
    return add(p, scale(n, mm));
  });
}

/** Overlapper to rom (mer enn å berøre hverandre langs en kant)? */
export function roomsOverlap(a: readonly P2[], b: readonly P2[]): boolean {
  const ia = inset(a, 15);
  const ib = inset(b, 15);
  for (let i = 0; i < ia.length; i++)
    for (let j = 0; j < ib.length; j++)
      if (segmentsCross(ia[i]!, ia[(i + 1) % ia.length]!, ib[j]!, ib[(j + 1) % ib.length]!)) return true;
  return ia.some((p) => pointInPolygon(p, b)) || ib.some((p) => pointInPolygon(p, a));
}

/** Rommets hovedretning (grader, 0–90): lengdevektet snitt av kantenes vinkel modulo 90°. */
export function dominantAngle(poly: readonly P2[]): number {
  let sx = 0;
  let sz = 0;
  for (const e of edgesOf(poly)) {
    if (e.length <= 0) continue;
    // Vinkelen ganget med 4 gjør retninger som er 90° fra hverandre like.
    const a = Math.atan2(e.u.z, e.u.x) * 4;
    sx += Math.cos(a) * e.length;
    sz += Math.sin(a) * e.length;
  }
  const deg = (Math.atan2(sz, sx) / 4) * (180 / Math.PI);
  return ((deg % 90) + 90) % 90;
}

/**
 * Retter opp et polygon: kanter som er innenfor `tolDeg` fra aksene (dreid
 * `axisDeg`) blir nøyaktig vannrette/loddrette, og hjørnene flyttes til der
 * de rette linjene møtes. Andre kanter beholdes. Lengdene endres minst mulig.
 */
export function orthogonalize(poly: readonly P2[], axisDeg: number, tolDeg = 6): P2[] {
  const n = poly.length;
  if (n < 3) return poly.map((p) => ({ ...p }));
  const th = (axisDeg * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  // Til en ramme der aksene er vannrette/loddrette.
  const toLocal = (p: P2): P2 => p2(p.x * c + p.z * s, -p.x * s + p.z * c);
  const toWorld = (p: P2): P2 => p2(p.x * c - p.z * s, p.x * s + p.z * c);
  const q = poly.map(toLocal);
  const tol = Math.tan((tolDeg * Math.PI) / 180);
  type Line = { kind: 'h'; z: number } | { kind: 'v'; x: number } | { kind: 'o'; a: P2; b: P2 };
  const lines: Line[] = [];
  for (let i = 0; i < n; i++) {
    const a = q[i]!;
    const b = q[(i + 1) % n]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    if (Math.abs(dz) <= Math.abs(dx) * tol) lines.push({ kind: 'h', z: (a.z + b.z) / 2 });
    else if (Math.abs(dx) <= Math.abs(dz) * tol) lines.push({ kind: 'v', x: (a.x + b.x) / 2 });
    else lines.push({ kind: 'o', a, b });
  }
  // Etterfølgende kanter med samme retning ligger på samme linje (et hjørne midt på en vegg).
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < n; i++) {
      const l = lines[i]!;
      const m = lines[(i + 1) % n]!;
      if (l.kind === 'h' && m.kind === 'h') l.z = m.z = (l.z + m.z) / 2;
      if (l.kind === 'v' && m.kind === 'v') l.x = m.x = (l.x + m.x) / 2;
    }
  const meet = (l: Line, m: Line, fallback: P2): P2 => {
    if (l.kind === 'h' && m.kind === 'v') return p2(m.x, l.z);
    if (l.kind === 'v' && m.kind === 'h') return p2(l.x, m.z);
    if (l.kind === 'h' && m.kind === 'h') return p2(fallback.x, l.z);
    if (l.kind === 'v' && m.kind === 'v') return p2(l.x, fallback.z);
    // Minst én skrå linje: skjæringspunktet mellom linjene.
    const pts = (k: Line): [P2, P2] =>
      k.kind === 'h' ? [p2(0, k.z), p2(1, k.z)] : k.kind === 'v' ? [p2(k.x, 0), p2(k.x, 1)] : [k.a, k.b];
    const [a, b] = pts(l);
    const [cc, d] = pts(m);
    const r = sub(b, a);
    const t = sub(d, cc);
    const den = cross(r, t);
    if (Math.abs(den) < 1e-9) return fallback;
    const u = cross(sub(cc, a), t) / den;
    return add(a, scale(r, u));
  };
  const out: P2[] = [];
  for (let i = 0; i < n; i++) out.push(toWorld(meet(lines[(i - 1 + n) % n]!, lines[i]!, q[i]!)));
  return out;
}

/** Rett vinkel-test: alle kanter innenfor `tolDeg` av aksene? */
export function isAxisAligned(poly: readonly P2[], axisDeg = 0, tolDeg = 0.5): boolean {
  return edgesOf(poly).every((e) => {
    if (e.length <= 0) return true;
    const a = ((Math.atan2(e.u.z, e.u.x) * 180) / Math.PI - axisDeg + 360) % 90;
    return a < tolDeg || a > 90 - tolDeg;
  });
}

export { dot, sub, add, scale, dist, len, p2, cross };
export type { P2 };
