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

/** Er hjørnet i polygonet «innvendig» (vinkel < 180° sett fra rommet)? */
export function isInnerCorner(poly: readonly P2[], i: number): boolean {
  const n = poly.length;
  const v = poly[i]!;
  const p = poly[(i + n - 1) % n]!;
  const q = poly[(i + 1) % n]!;
  const bis = add(normalize(sub(p, v)), normalize(sub(q, v)));
  if (len(bis) < 1e-6) return false;
  return pointInPolygon(add(v, scale(normalize(bis), 30)), poly);
}

/**
 * Kantene i et rom. Med `skipPassages` kuttes de der dører og åpninger
 * (ikke vinduer) går gjennom veggen.
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
