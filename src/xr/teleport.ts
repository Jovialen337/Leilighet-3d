/**
 * Teleport-bue: en kastebane fra kontrolleren som testes mot treffflatene.
 * Gyldig landing = første treff er et gulv (rom, terskel eller uteområde)
 * med flate som peker oppover. Vegger, tak og møbler stopper buen.
 *
 * Ren funksjon uten XR-avhengigheter, så den kan enhetstestes.
 */
import * as THREE from 'three';
import type { ProxyData } from '../scene/ApartmentScene';

export interface ArcOptions {
  speed: number;
  gravity: number;
  step: number;
  maxSteps: number;
  /** Buen stopper under denne høyden (m). */
  minY: number;
}

export const DEFAULT_ARC: ArcOptions = { speed: 7, gravity: 9.81, step: 0.02, maxSteps: 90, minY: -5 };

export interface ArcHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  valid: boolean;
  id: string;
  kind: string;
}

export class TeleportArc {
  readonly points: THREE.Vector3[];
  count = 0;
  hit: ArcHit | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly segBox = new THREE.Box3();
  private readonly dir = new THREE.Vector3();
  private readonly candidates: THREE.Mesh[] = [];

  constructor(readonly options: ArcOptions = DEFAULT_ARC) {
    this.points = Array.from({ length: options.maxSteps + 1 }, () => new THREE.Vector3());
  }

  /** Beregner buen fra `origin` i retning `direction` (normalisert) mot treffflatene. */
  compute(origin: THREE.Vector3, direction: THREE.Vector3, proxies: readonly THREE.Mesh[]): ArcHit | null {
    const o = this.options;
    const vx = direction.x * o.speed;
    const vy = direction.y * o.speed;
    const vz = direction.z * o.speed;
    this.points[0]!.copy(origin);
    this.count = 1;
    this.hit = null;
    for (let i = 1; i <= o.maxSteps; i++) {
      const t = i * o.step;
      const p = this.points[i]!.set(
        origin.x + vx * t,
        origin.y + vy * t - 0.5 * o.gravity * t * t,
        origin.z + vz * t,
      );
      const prev = this.points[i - 1]!;
      const hit = this.segment(prev, p, proxies);
      this.count = i + 1;
      if (hit) {
        p.copy(hit.point);
        this.hit = hit;
        return hit;
      }
      if (p.y < o.minY) break;
    }
    return null;
  }

  private segment(a: THREE.Vector3, b: THREE.Vector3, proxies: readonly THREE.Mesh[]): ArcHit | null {
    this.segBox.makeEmpty().expandByPoint(a).expandByPoint(b);
    this.candidates.length = 0;
    for (const m of proxies) {
      const bb = m.geometry.boundingBox;
      if (bb && bb.intersectsBox(this.segBox)) this.candidates.push(m);
    }
    if (!this.candidates.length) return null;
    const len = this.dir.subVectors(b, a).length();
    if (len < 1e-9) return null;
    this.dir.divideScalar(len);
    this.raycaster.set(a, this.dir);
    this.raycaster.near = 0;
    this.raycaster.far = len;
    const hits = this.raycaster.intersectObjects(this.candidates, false);
    const first = hits[0];
    if (!first) return null;
    const data = first.object.userData as ProxyData;
    const normal = first.face ? first.face.normal.clone() : new THREE.Vector3(0, 1, 0);
    // Treffflatene ligger i verdenskoordinater, så flatenormalen er allerede riktig.
    const valid = data.pick === 'floor' && normal.y > 0.7;
    return { point: first.point.clone(), normal, valid, id: data.id, kind: data.kind };
  }
}
