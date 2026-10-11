/**
 * Små tilpasningsverktøy for oppmåling (2D i planet, mm):
 * stiv transformasjon (rotasjon + forskyvning), linjetilpasning og
 * stykkevis lineær avbildning langs en vegg.
 */
import { dot, normalize, sub, type P2 } from '../geometry/math2d';

/** Stiv 2D-transformasjon. Positiv vinkel = med klokka sett ovenfra (x høyre, z ned). */
export interface Rigid2 {
  angle: number;
  cos: number;
  sin: number;
  tx: number;
  tz: number;
}

export const IDENTITY: Rigid2 = { angle: 0, cos: 1, sin: 0, tx: 0, tz: 0 };

export const applyRigid = (t: Rigid2, p: P2): P2 => ({
  x: p.x * t.cos - p.z * t.sin + t.tx,
  z: p.x * t.sin + p.z * t.cos + t.tz,
});

export interface Pair {
  from: P2;
  to: P2;
  w?: number;
}

/**
 * Beste stive transformasjon (minste kvadrater) som flytter `from` til `to`.
 * Ett par gir ren forskyvning. Ingen par gir identitet.
 */
export function fitRigid(pairs: readonly Pair[]): Rigid2 {
  if (!pairs.length) return IDENTITY;
  let sw = 0;
  const pf = { x: 0, z: 0 };
  const pt = { x: 0, z: 0 };
  for (const p of pairs) {
    const w = p.w ?? 1;
    sw += w;
    pf.x += p.from.x * w;
    pf.z += p.from.z * w;
    pt.x += p.to.x * w;
    pt.z += p.to.z * w;
  }
  pf.x /= sw;
  pf.z /= sw;
  pt.x /= sw;
  pt.z /= sw;
  let sDot = 0;
  let sCross = 0;
  for (const p of pairs) {
    const w = p.w ?? 1;
    const a = sub(p.from, pf);
    const b = sub(p.to, pt);
    sDot += w * (a.x * b.x + a.z * b.z);
    sCross += w * (a.x * b.z - a.z * b.x);
  }
  const angle = Math.abs(sDot) + Math.abs(sCross) < 1e-6 ? 0 : Math.atan2(sCross, sDot);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { angle, cos, sin, tx: pt.x - (pf.x * cos - pf.z * sin), tz: pt.z - (pf.x * sin + pf.z * cos) };
}

/** Vektet linjetilpasning (hovedakse). null hvis punktene ikke spenner ut en retning. */
export function fitLine(points: readonly { p: P2; w: number }[]): { origin: P2; dir: P2 } | null {
  let sw = 0;
  const c = { x: 0, z: 0 };
  for (const { p, w } of points) {
    sw += w;
    c.x += p.x * w;
    c.z += p.z * w;
  }
  if (sw <= 0) return null;
  c.x /= sw;
  c.z /= sw;
  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  for (const { p, w } of points) {
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    sxx += w * dx * dx;
    sxz += w * dx * dz;
    szz += w * dz * dz;
  }
  if (sxx + szz < 1e-6) return null;
  const theta = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  return { origin: c, dir: { x: Math.cos(theta), z: Math.sin(theta) } };
}

/**
 * Felles retning for flere parallelle linjer (f.eks. veggens to flater) der
 * avstanden mellom dem er ukjent: hver gruppe sentreres for seg.
 * null hvis ingen gruppe har punkter som spenner ut en retning.
 */
export function fitParallelDir(groups: readonly (readonly { p: P2; w: number }[])[]): P2 | null {
  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  for (const g of groups) {
    let sw = 0;
    let cx = 0;
    let cz = 0;
    for (const { p, w } of g) {
      sw += w;
      cx += p.x * w;
      cz += p.z * w;
    }
    if (sw <= 0) continue;
    cx /= sw;
    cz /= sw;
    for (const { p, w } of g) {
      const dx = p.x - cx;
      const dz = p.z - cz;
      sxx += w * dx * dx;
      sxz += w * dx * dz;
      szz += w * dz * dz;
    }
  }
  if (sxx + szz < 1e-6) return null;
  const theta = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  return { x: Math.cos(theta), z: Math.sin(theta) };
}

/**
 * Stykkevis lineær avbildning u → s gjennom kjente par, med stigning 1
 * utenfor endene (veggens forlengelse forbi siste hjørne beholder lengden).
 */
export class AlongMap {
  private readonly us: number[] = [];
  private readonly ss: number[] = [];

  constructor(pairs: readonly [number, number][]) {
    const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
    for (const [u, s] of sorted) {
      const last = this.us.length - 1;
      if (last >= 0 && Math.abs(this.us[last]! - u) < 1) {
        this.ss[last] = (this.ss[last]! + s) / 2;
      } else {
        this.us.push(u);
        this.ss.push(s);
      }
    }
  }

  map(u: number): number {
    const n = this.us.length;
    if (n === 0) return u;
    if (u <= this.us[0]!) return this.ss[0]! + (u - this.us[0]!);
    if (u >= this.us[n - 1]!) return this.ss[n - 1]! + (u - this.us[n - 1]!);
    for (let i = 1; i < n; i++) {
      const u0 = this.us[i - 1]!;
      const u1 = this.us[i]!;
      if (u <= u1) return this.ss[i - 1]! + ((this.ss[i]! - this.ss[i - 1]!) * (u - u0)) / (u1 - u0);
    }
    return u;
  }
}

/** Orienterer en retning så den peker samme vei som `ref`. */
export function alignDir(dir: P2, ref: P2): P2 {
  const d = normalize(dir);
  return dot(d, ref) < 0 ? { x: -d.x, z: -d.z } : d;
}

