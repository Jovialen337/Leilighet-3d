/**
 * Lampelys om kvelden: lampepunktene i apartment.json (fixtures av typen
 * «light») får en varm glød i taket rundt lampa og en lys flekk på gulvet
 * under. Myke sirkler med alfa per hjørne som lyser opp fargen under –
 * ingen ekte lyskilder, som ville kostet mye på Quest. Sirklene stopper ved
 * veggene i rommet lampa henger i.
 *
 * Selve lampa lyser også: en lys flate på undersiden. Lyset i rommet er i
 * tillegg bakt inn i fargene (bake.ts, lampelys).
 *
 * Mm inn, meter ut. Én geometri per lag: lyset hører til rommet lampa henger
 * i (følger rommets lag), så det ikke slukkes av lagvalg for el. Den lysende
 * undersiden hører til lampa selv (lampas lag), så den forsvinner med lampa.
 */
import * as THREE from 'three';
import { fixtureSize, type ApartmentModel } from '../model/ApartmentModel';
import type { Fixture } from '../schema/types';
import { cross, p2, sub, type P2 } from '../geometry/math2d';
import { MM } from './geom';

export const LAMP = {
  /** Gløden i taket: radius (mm) og alfa i midten. */
  halo: { radius: 520, alpha: 0.6 },
  /** Lysflekken på gulvet. */
  pool: { radius: 1500, alpha: 0.3 },
  segments: 24,
  /** Ringer fra midten og ut: alfaen følger en myk kurve (ingen topp i midten, ingen ring i kanten). */
  rings: 5,
  /** Hvor langt fra flaten (mm). */
  lift: 3,
  /** Selve lampa: alfa på den lysende undersiden. */
  bulb: 0.95,
} as const;

/** Hvor langt (mm) fra `c` langs retningen `d` til kanten av polygonet (Infinity hvis ingen kant). */
export function rayToEdge(c: P2, d: P2, poly: readonly P2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const e = sub(poly[(i + 1) % poly.length]!, a);
    const den = cross(d, e);
    if (Math.abs(den) < 1e-9) continue;
    const w = sub(a, c);
    const t = cross(w, e) / den;
    const u = cross(w, d) / den;
    if (t > 0 && u >= 0 && u <= 1) best = Math.min(best, t);
  }
  return best;
}

/** Myk lysflekk: 1 i midten, 0 ved kanten, flat i midten og uten knekk i kanten. */
export const falloff = (t: number): number => {
  const u = 1 - Math.min(1, t * t);
  return u * u;
};

/**
 * Sirkel i planet med høyden `y` (mm): alfa `a` i midten, 0 ved radius `r`
 * (hjørnefarge RGBA), i ringer så alfaen følger `falloff`. Med `room` stopper
 * sirkelen ved kanten av rommet, og alfaen der er det den ville vært i den
 * avstanden. Med `heightAt` følger sirkelen en skrå flate (taket) i stedet
 * for å være vannrett.
 */
function disc(
  pos: number[],
  col: number[],
  x: number,
  y: number,
  z: number,
  r: number,
  a: number,
  room?: readonly P2[],
  heightAt?: (x: number, z: number) => number,
): void {
  const n = LAMP.segments;
  const k = LAMP.rings;
  const h = (px: number, pz: number): number => (heightAt ? heightAt(px, pz) : y);
  // Hjørnene: ring j (0 = midten) i retning i; utenfor rommet stopper de ved veggen.
  const pts: { x: number; y: number; z: number; a: number }[][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const d = p2(Math.cos(t), Math.sin(t));
    const reach = room ? Math.min(r, rayToEdge(p2(x, z), d, room)) : r;
    const ring: { x: number; y: number; z: number; a: number }[] = [];
    for (let j = 0; j <= k; j++) {
      const dist = Math.min((j / k) * r, reach);
      const px = x + d.x * dist;
      const pz = z + d.z * dist;
      ring.push({ x: px, y: h(px, pz), z: pz, a: a * falloff(dist / r) });
    }
    pts.push(ring);
  }
  const put = (p: { x: number; y: number; z: number; a: number }): void => {
    pos.push(p.x * MM, p.y * MM, p.z * MM);
    col.push(1, 1, 1, p.a);
  };
  for (let i = 0; i < n; i++) {
    const A = pts[i]!;
    const B = pts[(i + 1) % n]!;
    put(A[0]!);
    put(A[1]!);
    put(B[1]!);
    for (let j = 1; j < k; j++) {
      put(A[j]!);
      put(A[j + 1]!);
      put(B[j + 1]!);
      put(A[j]!);
      put(B[j + 1]!);
      put(B[j]!);
    }
  }
}

/** `include`: lampepunkter som skal lyse (f.eks. bare de som passerer filteret for el). */
export function buildLampGlow(
  model: ApartmentModel,
  strength: number,
  include: (fx: Fixture) => boolean = () => true,
): Map<string, THREE.BufferGeometry> {
  const byLayer = new Map<string, { pos: number[]; col: number[] }>();
  const bucket = (layer: string): { pos: number[]; col: number[] } => {
    let b = byLayer.get(layer);
    if (!b) byLayer.set(layer, (b = { pos: [], col: [] }));
    return b;
  };
  for (const fx of model.data.fixtures) {
    if (fx.type !== 'light' || !include(fx)) continue;
    const pl = model.fixturePlacement(fx);
    if (!pl) continue;
    const at = p2(pl.x, pl.z);
    const info = model.roomAt(at);
    const floor = model.floorOrDefault(at);
    const ceiling = info ? model.ceilingAt(info, at) : pl.y + 60;
    const b = bucket(info?.room.layer ?? 'structure');
    const room = info?.polygon;
    // Gløden følger taket (som kan være skrått).
    const underCeiling = info ? (px: number, pz: number): number => model.ceilingAt(info, p2(px, pz)) - LAMP.lift : undefined;
    disc(b.pos, b.col, pl.x, Math.min(ceiling, pl.y + 200) - LAMP.lift, pl.z, LAMP.halo.radius, LAMP.halo.alpha * strength, room, underCeiling);
    disc(b.pos, b.col, pl.x, floor + LAMP.lift, pl.z, LAMP.pool.radius, LAMP.pool.alpha * strength, room);
    // Lampa selv: lys underside (jevnt lys, ikke fade ut mot kanten), i lampas lag.
    const own = bucket(fx.layer ?? info?.room.layer ?? 'structure');
    const [w, h] = fixtureSize(fx);
    const r = w / 2;
    const y = pl.y - h / 2 - 1;
    const n = LAMP.segments;
    for (let i = 0; i < n; i++) {
      const t0 = (i / n) * Math.PI * 2;
      const t1 = ((i + 1) / n) * Math.PI * 2;
      own.pos.push(pl.x * MM, y * MM, pl.z * MM);
      own.pos.push((pl.x + Math.cos(t0) * r) * MM, y * MM, (pl.z + Math.sin(t0) * r) * MM);
      own.pos.push((pl.x + Math.cos(t1) * r) * MM, y * MM, (pl.z + Math.sin(t1) * r) * MM);
      const a = LAMP.bulb * strength;
      own.col.push(1, 1, 1, a, 1, 1, 1, a, 1, 1, 1, a);
    }
  }
  const out = new Map<string, THREE.BufferGeometry>();
  for (const [layer, b] of byLayer) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 4));
    g.computeBoundingSphere();
    out.set(layer, g);
  }
  return out;
}
