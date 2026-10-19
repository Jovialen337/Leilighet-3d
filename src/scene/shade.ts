/**
 * Myke skygger under møbler (kontaktskygge) uten skyggekart (billig på
 * Quest): gjennomsiktige svarte flater som fades ut, så møblene står *på*
 * gulvet. Mørkere hjørner og kanter i rommene er bakt inn i fargene
 * (bake.ts).
 *
 * Geometrien har RGBA-hjørnefarger (svart, alfa varierer) og tegnes med ett
 * felles materiale. Alt i meter; inn i mm.
 */
import * as THREE from 'three';
import type { ApartmentModel } from '../model/ApartmentModel';
import { MM } from './geom';

export const SHADE = {
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
