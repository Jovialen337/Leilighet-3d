/**
 * Lampelys om kvelden: lampepunktene i apartment.json (fixtures av typen
 * «light») får en varm glød i taket rundt lampa og en lys flekk på gulvet
 * under. Myke sirkler med alfa per hjørne som lyser opp fargen under –
 * ingen ekte lyskilder, som ville kostet mye på Quest. Sirklene stopper ved
 * veggene i rommet lampa henger i.
 *
 * Mm inn, meter ut. Én geometri per lag (følger lampepunktets lag).
 */
import * as THREE from 'three';
import type { ApartmentModel } from '../model/ApartmentModel';
import type { Fixture } from '../schema/types';
import { cross, p2, sub, type P2 } from '../geometry/math2d';
import { MM } from './geom';

export const LAMP = {
  /** Gløden i taket: radius (mm) og alfa i midten. */
  halo: { radius: 520, alpha: 0.6 },
  /** Lysflekken på gulvet. */
  pool: { radius: 1500, alpha: 0.3 },
  segments: 24,
  /** Hvor langt fra flaten (mm). */
  lift: 3,
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

/**
 * Sirkel i planet med høyden `y` (mm): alfa `a` i midten, 0 ved radius `r`
 * (hjørnefarge RGBA). Med `room` stopper sirkelen ved kanten av rommet, og
 * alfaen der er det den ville vært i den avstanden.
 */
function disc(pos: number[], col: number[], x: number, y: number, z: number, r: number, a: number, room?: readonly P2[]): void {
  const n = LAMP.segments;
  const rim: { x: number; z: number; a: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const d = p2(Math.cos(t), Math.sin(t));
    const reach = room ? Math.min(r, rayToEdge(p2(x, z), d, room)) : r;
    rim.push({ x: x + d.x * reach, z: z + d.z * reach, a: a * (1 - reach / r) });
  }
  for (let i = 0; i < n; i++) {
    const p = rim[i]!;
    const q = rim[(i + 1) % n]!;
    pos.push(x * MM, y * MM, z * MM, p.x * MM, y * MM, p.z * MM, q.x * MM, y * MM, q.z * MM);
    col.push(1, 1, 1, a, 1, 1, 1, p.a, 1, 1, 1, q.a);
  }
}

/** `include`: lampepunkter som skal lyse (f.eks. bare de som passerer filteret for el). */
export function buildLampGlow(
  model: ApartmentModel,
  strength: number,
  include: (fx: Fixture) => boolean = () => true,
): Map<string, THREE.BufferGeometry> {
  const byLayer = new Map<string, { pos: number[]; col: number[] }>();
  for (const fx of model.data.fixtures) {
    if (fx.type !== 'light' || !include(fx)) continue;
    const pl = model.fixturePlacement(fx);
    if (!pl) continue;
    const at = p2(pl.x, pl.z);
    const info = model.roomAt(at);
    const floor = model.floorOrDefault(at);
    const ceiling = info ? model.ceilingAt(info, at) : pl.y + 60;
    let b = byLayer.get(fx.layer);
    if (!b) byLayer.set(fx.layer, (b = { pos: [], col: [] }));
    const room = info?.polygon;
    disc(b.pos, b.col, pl.x, Math.min(ceiling, pl.y + 200) - LAMP.lift, pl.z, LAMP.halo.radius, LAMP.halo.alpha * strength, room);
    disc(b.pos, b.col, pl.x, floor + LAMP.lift, pl.z, LAMP.pool.radius, LAMP.pool.alpha * strength, room);
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
