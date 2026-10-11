/**
 * Myke skygger uten skyggekart (billig på Quest): gjennomsiktige svarte
 * flater som fades ut.
 *
 * - Langs gulv og tak inntil veggene, og loddrett i innvendige hjørner
 *   (som «ambient occlusion»: hjørner blir litt mørkere, så rommet får dybde).
 * - Under møbler (kontaktskygge), så de står *på* gulvet.
 *
 * Geometrien har RGBA-hjørnefarger (svart, alfa varierer) og tegnes med ett
 * felles materiale. Alt i meter; inn i mm.
 */
import * as THREE from 'three';
import type { ApartmentModel } from '../model/ApartmentModel';
import { add, p2, scale, type P2 } from '../geometry/math2d';
import { isInnerCorner, roomEdges } from './roomEdges';
import { MM } from './geom';

export const SHADE = {
  floor: { width: 260, alpha: 0.3 },
  ceiling: { width: 320, alpha: 0.24 },
  corner: { width: 220, alpha: 0.2 },
  contact: { fade: 110, alpha: 0.32 },
  /** Hvor høyt over/under flaten skyggen ligger (mm). */
  lift: 2,
} as const;

class ShadeBuilder {
  readonly pos: number[] = [];
  readonly col: number[] = [];

  /** Firkant a-b-c-d (meter) med alfa per hjørne. */
  quad(a: number[], b: number[], c: number[], d: number[], aa: number, ab: number, ac: number, ad: number): void {
    this.vert(a, aa);
    this.vert(b, ab);
    this.vert(c, ac);
    this.vert(a, aa);
    this.vert(c, ac);
    this.vert(d, ad);
  }

  private vert(p: number[], alpha: number): void {
    this.pos.push(p[0]! * MM, p[1]! * MM, p[2]! * MM);
    this.col.push(0, 0, 0, alpha);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 4));
    g.computeBoundingSphere();
    return g;
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }
}

const at = (p: P2, y: number): number[] => [p.x, y, p.z];

/**
 * Skygge langs vegger og i hjørner, per lag. Nøkkelen er laget, med «|tak»
 * for skyggene i taket (de skjules sammen med taket).
 */
export function buildRoomShade(model: ApartmentModel): Map<string, THREE.BufferGeometry> {
  const byLayer = new Map<string, ShadeBuilder>();
  const get = (layer: string): ShadeBuilder => {
    let b = byLayer.get(layer);
    if (!b) byLayer.set(layer, (b = new ShadeBuilder()));
    return b;
  };
  for (const info of model.rooms.values()) {
    const g = get(info.room.layer ?? 'structure');
    const floor = info.room.floorLevel + SHADE.lift;
    // Gulv langs veggene (ikke i døråpninger).
    for (const e of roomEdges(model, info, true)) {
      const w = SHADE.floor.width;
      const ia = add(e.a, scale(e.inward, w));
      const ib = add(e.b, scale(e.inward, w));
      g.quad(at(e.a, floor), at(e.b, floor), at(ib, floor), at(ia, floor), SHADE.floor.alpha, SHADE.floor.alpha, 0, 0);
    }
    // Tak langs veggene.
    const ceil = (p: P2): number => model.ceilingAt(info, p) - SHADE.lift;
    const gc = get(`${info.room.layer ?? 'structure'}|tak`);
    for (const e of roomEdges(model, info, false)) {
      const w = SHADE.ceiling.width;
      const ia = add(e.a, scale(e.inward, w));
      const ib = add(e.b, scale(e.inward, w));
      gc.quad(at(e.a, ceil(e.a)), at(e.b, ceil(e.b)), at(ib, ceil(ib)), at(ia, ceil(ia)), SHADE.ceiling.alpha, SHADE.ceiling.alpha, 0, 0);
    }
    // Loddrett i innvendige hjørner, på begge veggene.
    const poly = info.polygon;
    const edges = roomEdges(model, info, false);
    for (let i = 0; i < poly.length; i++) {
      if (!isInnerCorner(poly, i)) continue;
      const v = poly[i]!;
      for (const e of edges) {
        const atStart = Math.hypot(e.a.x - v.x, e.a.z - v.z) < 1;
        const atEnd = Math.hypot(e.b.x - v.x, e.b.z - v.z) < 1;
        if (!atStart && !atEnd) continue;
        const along = atStart ? e.dir : p2(-e.dir.x, -e.dir.z);
        const c = add(v, scale(e.inward, SHADE.lift));
        const o = add(c, scale(along, SHADE.corner.width));
        const top = ceil(v);
        g.quad(at(c, floor), at(o, floor), at(o, top), at(c, top), SHADE.corner.alpha, 0, 0, SHADE.corner.alpha);
      }
    }
  }
  const out = new Map<string, THREE.BufferGeometry>();
  for (const [layer, b] of byLayer) if (!b.empty) out.set(layer, b.build());
  return out;
}

/** Kontaktskygge under hvert møbel (myk firkant rundt fotavtrykket), per lag. */
export function buildContactShade(model: ApartmentModel): Map<string, THREE.BufferGeometry> {
  const byLayer = new Map<string, ShadeBuilder>();
  for (const fu of model.data.furniture) {
    if (!fu.parts.length) continue;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    let low = Infinity;
    for (const part of fu.parts) {
      const [w, h, d] = part.size;
      const [ox, oy, oz] = part.offset;
      x0 = Math.min(x0, ox - w / 2);
      x1 = Math.max(x1, ox + w / 2);
      z0 = Math.min(z0, oz - d / 2);
      z1 = Math.max(z1, oz + d / 2);
      low = Math.min(low, oy - h / 2);
    }
    if (low > 450) continue; // svever (f.eks. hylle på veggen)
    const pl = model.furniturePlacement(fu);
    const floor = pl.y - (fu.position[1] ?? 0) + SHADE.lift;
    const c = Math.cos(pl.yaw);
    const s = Math.sin(pl.yaw);
    const place = (lx: number, lz: number): number[] => [pl.x + lx * c + lz * s, floor, pl.z - lx * s + lz * c];
    const f = SHADE.contact.fade;
    const a = SHADE.contact.alpha;
    let b = byLayer.get(fu.layer);
    if (!b) byLayer.set(fu.layer, (b = new ShadeBuilder()));
    const inner = [place(x0, z0), place(x1, z0), place(x1, z1), place(x0, z1)];
    const outer = [place(x0 - f, z0 - f), place(x1 + f, z0 - f), place(x1 + f, z1 + f), place(x0 - f, z1 + f)];
    b.quad(inner[0]!, inner[1]!, inner[2]!, inner[3]!, a, a, a, a);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      b.quad(inner[i]!, outer[i]!, outer[j]!, inner[j]!, a, 0, 0, a);
    }
  }
  const out = new Map<string, THREE.BufferGeometry>();
  for (const [layer, b] of byLayer) out.set(layer, b.build());
  return out;
}
