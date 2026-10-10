/**
 * Små geometrihjelpere. All geometri lages ikke-indeksert med flate normaler
 * (flat fargelegging) og bare `position` + `normal`, slik at alt kan slås
 * sammen til noen få meshes med vertex-farger.
 *
 * Enheter: inn i mm, ut i meter.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { pointInPolygon, type P2 } from '../geometry/math2d';

export const MM = 0.001;

export class GeoBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];

  /** Legger til en trekant (meter). Snur vindingen så den stemmer med normalen `n`. */
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, n: THREE.Vector3): void {
    const ab = _v1.subVectors(b, a);
    const ac = _v2.subVectors(c, a);
    const face = _v3.crossVectors(ab, ac);
    if (face.lengthSq() < 1e-14) return;
    const [p, q] = face.dot(n) >= 0 ? [b, c] : [c, b];
    this.pos.push(a.x, a.y, a.z, p.x, p.y, p.z, q.x, q.y, q.z);
    for (let i = 0; i < 3; i++) this.nrm.push(n.x, n.y, n.z);
  }

  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, n: THREE.Vector3): void {
    this.tri(a, b, c, n);
    this.tri(a, c, d, n);
  }

  /** Legger til en ferdig three-geometri (konverteres til ikke-indeksert). */
  addGeometry(g: THREE.BufferGeometry, matrix: THREE.Matrix4): void {
    const ni = g.index ? g.toNonIndexed() : g;
    ni.applyMatrix4(matrix);
    ni.computeVertexNormals();
    const p = ni.getAttribute('position');
    const n = ni.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    if (ni !== g) ni.dispose();
    g.dispose();
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

export const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
/** Plan-punkt (mm) + høyde (mm) → meter. */
export const w3 = (p: P2, y: number): THREE.Vector3 => new THREE.Vector3(p.x * MM, y * MM, p.z * MM);

export const UP = Object.freeze(new THREE.Vector3(0, 1, 0));
export const DOWN = Object.freeze(new THREE.Vector3(0, -1, 0));

/** Triangulerer et polygon (med hull) i 2D. Returnerer indeks-tripler inn i [kontur, ...hull]. */
export function triangulate(contour: THREE.Vector2[], holes: THREE.Vector2[][] = []): number[][] {
  return THREE.ShapeUtils.triangulateShape(contour, holes);
}

/**
 * Flate over et polygon der høyden er gitt av `heightAt(x, z)` (mm).
 * Brukes til gulv (vannrett) og skrå tak (plan).
 */
export function polygonSurface(
  g: GeoBuilder,
  poly: readonly P2[],
  heightAt: (p: P2) => number,
  normal: THREE.Vector3,
): void {
  const contour = poly.map((p) => new THREE.Vector2(p.x, p.z));
  for (const [i, j, k] of triangulate(contour)) {
    const a = poly[i!]!;
    const b = poly[j!]!;
    const c = poly[k!]!;
    g.tri(w3(a, heightAt(a)), w3(b, heightAt(b)), w3(c, heightAt(c)), normal);
  }
}

/** Loddrette sideflater langs polygonets kanter, fra `bottom` til `top` (mm), vendt utover. */
export function polygonSides(g: GeoBuilder, poly: readonly P2[], bottom: number, top: number): void {
  if (top - bottom < 0.5) return;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz);
    if (l < 1e-6) continue;
    let n = v3(dz / l, 0, -dx / l);
    const mid = { x: (a.x + b.x) / 2 + n.x * 5, z: (a.z + b.z) / 2 + n.z * 5 };
    if (pointInPolygon(mid, poly)) n = n.negate();
    g.quad(w3(a, bottom), w3(b, bottom), w3(b, top), w3(a, top), n);
  }
}

/** Gulvplate: toppflate + sider ned til `bottom`. */
export function slab(g: GeoBuilder, poly: readonly P2[], bottom: number, top: number): void {
  polygonSurface(g, poly, () => top, UP);
  polygonSides(g, poly, bottom, top);
}

/**
 * Matrise for et objekt: posisjon (mm), rotasjon om y (rad), og lokal forskyvning (mm).
 */
export function placeMatrix(
  x: number,
  y: number,
  z: number,
  yaw: number,
  local?: { x: number; y: number; z: number },
): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeTranslation(x * MM, y * MM, z * MM);
  m.multiply(new THREE.Matrix4().makeRotationY(yaw));
  if (local) m.multiply(new THREE.Matrix4().makeTranslation(local.x * MM, local.y * MM, local.z * MM));
  return m;
}

/** Boks sentrert i origo, størrelse i mm. */
export const boxGeo = (w: number, h: number, d: number): THREE.BufferGeometry =>
  new THREE.BoxGeometry(w * MM, h * MM, d * MM);

/** Sylinder langs y, sentrert i origo. [diameter x, høyde, diameter z] i mm. */
export function cylinderGeo(w: number, h: number, d: number, segments = 14): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, segments, 1);
  g.scale(w * MM, h * MM, d * MM);
  return g;
}

export function roundedBoxGeo(w: number, h: number, d: number, radius: number): THREE.BufferGeometry {
  const r = Math.min(radius, w / 2, h / 2, d / 2) * MM;
  return new RoundedBoxGeometry(w * MM, h * MM, d * MM, 2, r);
}

/** Ringsektor på gulvet (slaglinje for dør). Vinkler i radianer, retninger i plan. */
export function floorArc(
  g: GeoBuilder,
  center: P2,
  from: P2,
  to: P2,
  angle: number,
  rInner: number,
  rOuter: number,
  y: number,
  segments = 24,
): void {
  const pt = (t: number, r: number): THREE.Vector3 => {
    const c = Math.cos(t);
    const s = Math.sin(t);
    return w3({ x: center.x + (from.x * c + to.x * s) * r, z: center.z + (from.z * c + to.z * s) * r }, y);
  };
  for (let i = 0; i < segments; i++) {
    const t0 = (angle * i) / segments;
    const t1 = (angle * (i + 1)) / segments;
    g.quad(pt(t0, rInner), pt(t0, rOuter), pt(t1, rOuter), pt(t1, rInner), UP);
  }
}

/** Tynn bjelke mellom to punkter (mm), kvadratisk tverrsnitt. */
export function beam(g: GeoBuilder, a: THREE.Vector3, b: THREE.Vector3, thicknessMm: number): void {
  const len = a.distanceTo(b);
  if (len < 1e-6) return;
  const geo = new THREE.BoxGeometry(thicknessMm * MM, thicknessMm * MM, len);
  const m = new THREE.Matrix4().lookAt(a, b, Math.abs(b.y - a.y) > 0.99 * len ? new THREE.Vector3(1, 0, 0) : UP);
  m.setPosition(a.clone().add(b).multiplyScalar(0.5));
  g.addGeometry(geo, m);
}
