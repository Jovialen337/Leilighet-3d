/**
 * Delte materialer. Flate farger fra vertex-farger, billig Lambert-lys.
 * Topp-visningen (2D-plan) og dukkehus kutter modellen med et klippeplan og
 * viser begge sider av flatene; baksidene (innsiden av kuttede vegger) tegnes
 * mørke, som snittflater i en arkitekttegning.
 */
import * as THREE from 'three';
import type { Bucket } from './buildParts';

export class Materials {
  readonly solid = new THREE.MeshLambertMaterial({ vertexColors: true, dithering: true });
  readonly ceiling = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide, dithering: true });
  /** Myke skygger: svart med alfa per hjørne (se shade.ts). */
  readonly shade = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
    toneMapped: false,
  });
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
  constructor() {
    // Snittflater: baksider (synlige bare når modellen er kuttet) blir mørke.
    this.solid.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\n\tif ( !gl_FrontFacing ) gl_FragColor.rgb = vec3( 0.16, 0.18, 0.2 );',
      );
    };
  }

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
    for (const m of [this.solid, this.ceiling, this.glass, this.overlay, this.shade, this.proxy]) m.dispose();
  }
}
