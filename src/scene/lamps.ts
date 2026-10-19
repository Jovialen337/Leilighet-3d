/**
 * Lampelys om kvelden: lampepunktene i apartment.json (fixtures av typen
 * «light») får en varm glød i taket rundt lampa og en lys flekk på gulvet
 * under. Myke sirkler med alfa per hjørne, lagt til fargen under (additivt) –
 * ingen ekte lyskilder, som ville kostet mye på Quest.
 *
 * Mm inn, meter ut. Én geometri per lag (følger lampepunktets lag).
 */
import * as THREE from 'three';
import type { ApartmentModel } from '../model/ApartmentModel';
import { p2 } from '../geometry/math2d';
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

/** Sirkel i planet med høyden `y` (mm): alfa `a` i midten, 0 ytterst (hjørnefarge RGBA). */
function disc(pos: number[], col: number[], x: number, y: number, z: number, r: number, a: number): void {
  const n = LAMP.segments;
  for (let i = 0; i < n; i++) {
    const t0 = (i / n) * Math.PI * 2;
    const t1 = ((i + 1) / n) * Math.PI * 2;
    pos.push(x * MM, y * MM, z * MM);
    pos.push((x + Math.cos(t0) * r) * MM, y * MM, (z + Math.sin(t0) * r) * MM);
    pos.push((x + Math.cos(t1) * r) * MM, y * MM, (z + Math.sin(t1) * r) * MM);
    col.push(1, 1, 1, a, 1, 1, 1, 0, 1, 1, 1, 0);
  }
}

export function buildLampGlow(model: ApartmentModel, strength: number): Map<string, THREE.BufferGeometry> {
  const byLayer = new Map<string, { pos: number[]; col: number[] }>();
  for (const fx of model.data.fixtures) {
    if (fx.type !== 'light') continue;
    const pl = model.fixturePlacement(fx);
    if (!pl) continue;
    const at = p2(pl.x, pl.z);
    const info = model.roomAt(at);
    const floor = model.floorOrDefault(at);
    const ceiling = info ? model.ceilingAt(info, at) : pl.y + 60;
    let b = byLayer.get(fx.layer);
    if (!b) byLayer.set(fx.layer, (b = { pos: [], col: [] }));
    disc(b.pos, b.col, pl.x, Math.min(ceiling, pl.y + 200) - LAMP.lift, pl.z, LAMP.halo.radius, LAMP.halo.alpha * strength);
    disc(b.pos, b.col, pl.x, floor + LAMP.lift, pl.z, LAMP.pool.radius, LAMP.pool.alpha * strength);
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
