/**
 * Festing i byggeren. I rekkefølge:
 *   1. hjørner i andre rom,
 *   2. «veggluke»: linja der et naborom skal ligge (skilleveggens tykkelse
 *      utenfor en kant), eller selve kanten (åpen overgang / felles fasade),
 *   3. linje med et annet hjørne (samme x eller z – hjelpelinjer vises),
 *   4. rett vinkel (90°/45°) fra forrige punkt,
 *   5. 10 mm-rutenett.
 * «Fri» (Ctrl eller knappen) skrur av all festing.
 */
import { add, dist, dot, edgesOf, scale, sub, type P2 } from './geometry';
import type { BuilderDoc } from './types';

export type SnapKind = 'hjørne' | 'vegg' | 'linje' | 'vinkel' | 'rutenett' | 'fri';

export interface SnapResult {
  p: P2;
  kind: SnapKind;
  /** Hjelpelinjer å vise (mm). */
  guides: { a: P2; b: P2 }[];
}

export interface SnapOptions {
  /** Toleranse i mm (regnet fra piksler av den som kaller). */
  tol: number;
  free?: boolean;
  /** Forrige punkt (for rett vinkel). */
  prev?: P2 | null;
  /** Hopp over dette rommet (f.eks. hjørnet som dras). */
  skipRoom?: string;
  /** Hopp over dette hjørnet i rommet. */
  skipCorner?: { room: string; i: number };
  grid?: number;
}

const ANGLE_TOL = (5 * Math.PI) / 180;

export function snapPoint(doc: BuilderDoc, raw: P2, o: SnapOptions): SnapResult {
  if (o.free) return { p: { x: Math.round(raw.x), z: Math.round(raw.z) }, kind: 'fri', guides: [] };
  const tol = o.tol;
  const corners: P2[] = [];
  for (const r of doc.rooms)
    r.polygon.forEach((p, i) => {
      if (o.skipCorner && o.skipCorner.room === r.id && o.skipCorner.i === i) return;
      if (o.skipRoom === r.id) return;
      corners.push(p);
    });

  // 1. Hjørner.
  let best: P2 | null = null;
  let bd = tol;
  for (const c of corners) {
    const d = dist(c, raw);
    if (d < bd) [best, bd] = [c, d];
  }
  if (best) return { p: { x: best.x, z: best.z }, kind: 'hjørne', guides: [] };

  // 2. Veggluke / kantlinje fra andre rom.
  const gap = doc.settings.interiorThickness;
  let line: { p: P2; u: P2; d: number } | null = null;
  for (const r of doc.rooms) {
    if (r.id === o.skipRoom) continue;
    for (const e of edgesOf(r.polygon)) {
      if (e.length <= 0) continue;
      for (const off of [gap, 0]) {
        const a = add(e.a, scale(e.out, off));
        const v = sub(raw, a);
        const s = dot(v, e.u);
        if (s < -tol || s > e.length + tol) continue;
        const d = Math.abs(dot(v, e.out));
        if (d < tol && (!line || d < line.d)) line = { p: add(a, scale(e.u, s)), u: e.u, d };
      }
    }
  }
  if (line) {
    // Langs linja: fest til hjørner (rett ut fra et hjørne) om mulig.
    let p = line.p;
    let guide: { a: P2; b: P2 } | null = null;
    for (const c of corners) {
      const s = dot(sub(c, p), line.u);
      if (Math.abs(s) < tol) {
        const q = add(p, scale(line.u, s));
        if (!guide || dist(q, p) < dist(guide.a, p)) guide = { a: q, b: c };
      }
    }
    if (guide) p = guide.a;
    return { p: { x: Math.round(p.x), z: Math.round(p.z) }, kind: 'vegg', guides: guide && dist(guide.a, guide.b) > 1 ? [guide] : [] };
  }

  // 3. Linje med andre hjørner (samme x / samme z).
  let x = raw.x;
  let z = raw.z;
  const guides: { a: P2; b: P2 }[] = [];
  let gx: P2 | null = null;
  let gz: P2 | null = null;
  for (const c of corners) {
    if (Math.abs(c.x - raw.x) < tol && (!gx || Math.abs(c.x - raw.x) < Math.abs(gx.x - raw.x))) gx = c;
    if (Math.abs(c.z - raw.z) < tol && (!gz || Math.abs(c.z - raw.z) < Math.abs(gz.z - raw.z))) gz = c;
  }
  if (gx) x = gx.x;
  if (gz) z = gz.z;

  // 4. Rett vinkel fra forrige punkt (bare der linjene ikke allerede bestemmer punktet).
  let kind: SnapKind = gx || gz ? 'linje' : 'rutenett';
  if (o.prev && !(gx && gz)) {
    const d = sub({ x, z }, o.prev);
    const len = Math.hypot(d.x, d.z);
    if (len > 1) {
      const a = Math.atan2(d.z, d.x);
      const k = Math.round(a / (Math.PI / 4));
      if (Math.abs(a - (k * Math.PI) / 4) < ANGLE_TOL) {
        const dir = { x: Math.cos((k * Math.PI) / 4), z: Math.sin((k * Math.PI) / 4) };
        const step = o.grid ?? 10;
        let l = Math.round(len / step) * step;
        // Har vi en hjelpelinje, skal punktet ligge på den.
        if (gx && Math.abs(dir.x) > 1e-6) l = (gx.x - o.prev.x) / dir.x;
        else if (gz && Math.abs(dir.z) > 1e-6) l = (gz.z - o.prev.z) / dir.z;
        x = o.prev.x + dir.x * l;
        z = o.prev.z + dir.z * l;
        if (k % 2 !== 0 && !gx && !gz) {
          // På skrå (45°): sidene rundes til rutenettet, ikke diagonalen (3000 × 3000, ikke 2998 × 2998).
          const side = Math.round((len * Math.SQRT1_2) / step) * step;
          x = o.prev.x + Math.sign(dir.x) * side;
          z = o.prev.z + Math.sign(dir.z) * side;
        }
        kind = gx || gz ? 'linje' : 'vinkel';
      }
    }
  }
  if (kind === 'rutenett' || (!gx && kind !== 'vinkel')) x = gx ? x : Math.round(x / (o.grid ?? 10)) * (o.grid ?? 10);
  if (kind === 'rutenett' || (!gz && kind !== 'vinkel')) z = gz ? z : Math.round(z / (o.grid ?? 10)) * (o.grid ?? 10);
  if (gx) guides.push({ a: { x, z }, b: gx });
  if (gz) guides.push({ a: { x, z }, b: gz });
  return { p: { x: Math.round(x), z: Math.round(z) }, kind, guides };
}
