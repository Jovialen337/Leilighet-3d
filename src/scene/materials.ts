/**
 * Delte materialer. Flate farger fra vertex-farger, billig Lambert-lys.
 * Topp-visningen (2D-plan) kutter modellen med et klippeplan og viser
 * begge sider av flatene, så kuttede vegger ser massive ut ovenfra.
 */
import * as THREE from 'three';
import type { Bucket } from './buildParts';

export class Materials {
  readonly solid = new THREE.MeshLambertMaterial({ vertexColors: true });
  readonly ceiling = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide });
  readonly glass = new THREE.MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  readonly overlay = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  /** Usynlig materiale for treffflater (brukes aldri til tegning). */
  readonly proxy = new THREE.MeshBasicMaterial({ visible: false });

  for(bucket: Bucket): THREE.Material {
    return this[bucket];
  }

  /** Plan-modus: vis baksider så kuttede vegger ser massive ut ovenfra. */
  setPlanMode(on: boolean): void {
    const side = on ? THREE.DoubleSide : THREE.FrontSide;
    for (const m of [this.solid, this.glass]) {
      if (m.side !== side) {
        m.side = side;
        m.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    for (const m of [this.solid, this.ceiling, this.glass, this.overlay, this.proxy]) m.dispose();
  }
}
