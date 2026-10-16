/**
 * Ren 2D-matematikk i planet (x, z). Ingen three.js-avhengighet, så den kan
 * brukes både av validering, geometribygging og XR-bevegelse.
 */

export interface P2 {
  x: number;
  z: number;
}

export const p2 = (x: number, z: number): P2 => ({ x, z });
export const add = (a: P2, b: P2): P2 => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a: P2, b: P2): P2 => ({ x: a.x - b.x, z: a.z - b.z });
export const scale = (a: P2, s: number): P2 => ({ x: a.x * s, z: a.z * s });
export const dot = (a: P2, b: P2): number => a.x * b.x + a.z * b.z;
/** 2D-kryssprodukt. Positivt = med klokka sett ovenfra (x høyre, z ned). */
export const cross = (a: P2, b: P2): number => a.x * b.z - a.z * b.x;
export const len = (a: P2): number => Math.hypot(a.x, a.z);
export const dist = (a: P2, b: P2): number => Math.hypot(a.x - b.x, a.z - b.z);
export const normalize = (a: P2): P2 => {
  const l = len(a);
  return l > 0 ? { x: a.x / l, z: a.z / l } : { x: 0, z: 0 };
};

/**
 * Venstre side av en retning, sett ovenfra (x høyre, z ned på skjermen).
 * Samme som venstre hånd for en person som går i retningen `f` med y opp.
 */
export const leftOf = (f: P2): P2 => ({ x: f.z, z: -f.x });
export const rightOf = (f: P2): P2 => ({ x: -f.z, z: f.x });

/** Signert areal (skolisseformelen). */
export function signedArea(poly: readonly P2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

export const polygonArea = (poly: readonly P2[]): number => Math.abs(signedArea(poly));

export function centroid(poly: readonly P2[]): P2 {
  const a = signedArea(poly);
  if (Math.abs(a) < 1e-9) {
    const s = poly.reduce((acc, p) => add(acc, p), p2(0, 0));
    return scale(s, 1 / Math.max(1, poly.length));
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const f = p.x * q.z - q.x * p.z;
    cx += (p.x + q.x) * f;
    cz += (p.z + q.z) * f;
  }
  return p2(cx / (6 * a), cz / (6 * a));
}

/** Punkt-i-polygon (strålekasting). Punkter nøyaktig på kanten er udefinert. */
export function pointInPolygon(pt: P2, poly: readonly P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.z > pt.z !== b.z > pt.z) {
      const x = ((b.x - a.x) * (pt.z - a.z)) / (b.z - a.z) + a.x;
      if (pt.x < x) inside = !inside;
    }
  }
  return inside;
}

export interface Bounds2 {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export function bounds(points: readonly P2[]): Bounds2 {
  const b: Bounds2 = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const p of points) {
    b.minX = Math.min(b.minX, p.x);
    b.minZ = Math.min(b.minZ, p.z);
    b.maxX = Math.max(b.maxX, p.x);
    b.maxZ = Math.max(b.maxZ, p.z);
  }
  return b;
}

function segmentsProperlyIntersect(a: P2, b: P2, c: P2, d: P2): boolean {
  const d1 = cross(sub(b, a), sub(c, a));
  const d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c));
  const d4 = cross(sub(d, c), sub(b, c));
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Sjekker om to ikke-nabokanter i polygonet krysser hverandre. */
export function isSelfIntersecting(poly: readonly P2[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      const c = poly[j]!;
      const d = poly[(j + 1) % n]!;
      if (segmentsProperlyIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

/** Avstand fra punkt til linjestykke. */
export function distToSegment(p: P2, a: P2, b: P2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, add(a, scale(ab, t)));
}

/** Korteste avstand mellom to polygoners kanter (0 når de berører hverandre). */
export function polygonGap(a: readonly P2[], b: readonly P2[]): number {
  let m = Infinity;
  for (const [p, q] of [
    [a, b],
    [b, a],
  ] as const)
    for (const v of p) for (let i = 0; i < q.length; i++) m = Math.min(m, distToSegment(v, q[i]!, q[(i + 1) % q.length]!));
  return m;
}
