/**
 * Kantene rundt et rom (gulvpolygonets sider = veggflatene), delt opp der
 * dører og åpninger går gjennom veggen. Brukes til fotlister og skygge langs
 * veggene. Alt i mm.
 */
import type { ApartmentModel, RoomInfo } from '../model/ApartmentModel';
import { frameAt } from '../model/ApartmentModel';
import { add, cross, dot, len, normalize, pointInPolygon, scale, sub, type P2 } from '../geometry/math2d';

export interface EdgePiece {
  a: P2;
  b: P2;
  /** Enhetsvektor langs kanten. */
  dir: P2;
  /** Enhetsvektor inn i rommet. */
  inward: P2;
}

/** Hvor nær (mm) en åpnings karm må være kanten for å regnes som «i» den. */
const ON_EDGE = 30;

/** Normal inn i rommet for kanten a→b. */
export function inwardNormal(a: P2, b: P2, poly: readonly P2[]): P2 {
  const d = normalize(sub(b, a));
  const left = { x: d.z, z: -d.x };
  const mid = scale(add(a, b), 0.5);
  return pointInPolygon(add(mid, scale(left, 20)), poly) ? left : { x: -left.x, z: -left.z };
}

/**
 * Stykkene av kanten a→b som har en vegg (en veggflate langs kanten).
 * Åpne overganger mellom rom (f.eks. to nivåer på badet) har ingen vegg –
 * der skal det verken være fotlist eller skygge. Nedforinger teller ikke.
 */
function walledParts(model: ApartmentModel, a: P2, dir: P2, L: number): [number, number][] {
  const parts: [number, number][] = [];
  for (const f of model.walls.values()) {
    if ((f.wall.base ?? 0) > 0 || Math.abs(cross(dir, f.dir)) > 0.02) continue;
    for (const n of [f.nMin, f.nMax]) {
      const p0 = frameAt(f, 0, n);
      const p1 = frameAt(f, f.length, n);
      if (Math.abs(cross(dir, sub(p0, a))) > ON_EDGE || Math.abs(cross(dir, sub(p1, a))) > ON_EDGE) continue;
      const t0 = dot(sub(p0, a), dir);
      const t1 = dot(sub(p1, a), dir);
      const lo = Math.max(0, Math.min(t0, t1));
      const hi = Math.min(L, Math.max(t0, t1));
      if (hi > lo) parts.push([lo, hi]);
    }
  }
  return parts;
}

/**
 * Kantene i et rom, bare der det er vegg. Med `skipPassages` kuttes de også
 * der dører og åpninger (ikke vinduer) går gjennom veggen.
 */
export function roomEdges(model: ApartmentModel, info: RoomInfo, skipPassages: boolean): EdgePiece[] {
  const poly = info.polygon;
  const out: EdgePiece[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const L = len(sub(b, a));
    if (L < 1) continue;
    const dir = normalize(sub(b, a));
    const inward = inwardNormal(a, b, poly);
    const cuts: [number, number][] = [];
    // Uten vegg: kutt bort det som ikke har en veggflate langs kanten.
    const walled = walledParts(model, a, dir, L).sort((x, y) => x[0] - y[0]);
    let at = 0;
    for (const [lo, hi] of walled) {
      if (lo > at + 1) cuts.push([at, lo]);
      at = Math.max(at, hi);
    }
    if (at < L - 1) cuts.push([at, L]);
    if (skipPassages) {
      for (const o of model.data.openings) {
        if (o.type === 'window') continue;
        const span = model.openingSpan(o);
        if (!span) continue;
        const f = span.frame;
        if (Math.abs(cross(dir, f.dir)) > 0.02) continue;
        for (const n of [f.nMin, f.nMax]) {
          const p0 = frameAt(f, span.u0, n);
          const p1 = frameAt(f, span.u1, n);
          const off0 = Math.abs(cross(dir, sub(p0, a)));
          const off1 = Math.abs(cross(dir, sub(p1, a)));
          if (off0 > ON_EDGE || off1 > ON_EDGE) continue;
          const t0 = dot(sub(p0, a), dir);
          const t1 = dot(sub(p1, a), dir);
          const lo = Math.max(0, Math.min(t0, t1));
          const hi = Math.min(L, Math.max(t0, t1));
          if (hi > lo) cuts.push([lo, hi]);
        }
      }
    }
    cuts.sort((x, y) => x[0] - y[0]);
    let t = 0;
    const emit = (t0: number, t1: number): void => {
      if (t1 - t0 > 20) out.push({ a: add(a, scale(dir, t0)), b: add(a, scale(dir, t1)), dir, inward });
    };
    for (const [lo, hi] of cuts) {
      if (lo > t) emit(t, lo);
      t = Math.max(t, hi);
    }
    emit(t, L);
  }
  return out;
}
