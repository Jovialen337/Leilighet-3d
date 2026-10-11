/**
 * Delte materialer. Flate farger fra vertex-farger, billig Lambert-lys.
 *
 * Kutt (2D-plan og dukkehus) gjøres per materiale: bygningen kuttes i
 * snitthøyden og viser begge sider av flatene; baksidene (innsiden av kuttede
 * vegger) tegnes mørke, som snittflater i en arkitekttegning. Installasjoner
 * (kabler, rør, el- og vannpunkter) kuttes ikke, og tegnes oppå i 2D-planen,
 * så hele el- og rørplanen alltid synes.
 *
 * Røntgen gjør vegger, dører og tak gjennomsiktige, så kabler og rør i
 * veggene synes.
 */
import * as THREE from 'three';
import type { Bucket } from './buildParts';

/** Lambert med mørke baksider (snittflater når modellen er kuttet). */
function lambertWithCutFaces(params: THREE.MeshLambertMaterialParameters): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial(params);
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      '#include <dithering_fragment>\n\tif ( !gl_FrontFacing ) gl_FragColor.rgb = vec3( 0.16, 0.18, 0.2 );',
    );
  };
  return m;
}

export const XRAY_OPACITY = 0.22;

export class Materials {
  readonly solid = lambertWithCutFaces({ vertexColors: true, dithering: true });
  /** Vegger (egen gruppe så de kan bli gjennomsiktige i røntgen). */
  readonly wall = lambertWithCutFaces({ vertexColors: true, dithering: true });
  readonly ceiling = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide, dithering: true });
  /** Kabler, rør, el- og vannpunkter: aldri kuttet. */
  readonly lines = new THREE.MeshLambertMaterial({ vertexColors: true, dithering: true });
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
  /** Usynlig materiale for treffflater (brukes aldri til tegning). */
  readonly proxy = new THREE.MeshBasicMaterial({ visible: false });
  private xray = false;

  for(bucket: Bucket): THREE.Material {
    return this[bucket];
  }

  /** Materialene som kuttes i snitthøyden. */
  private get cuttable(): THREE.Material[] {
    return [this.solid, this.wall, this.ceiling, this.glass, this.overlay, this.shade];
  }

  /**
   * Kutt: `plane` (eller null for ingen kutt). `top` = rett ovenfra (2D): da
   * tegnes installasjonene oppå alt, som i en tegning.
   */
  setCut(plane: THREE.Plane | null, top: boolean): void {
    const planes = plane ? [plane] : [];
    for (const m of this.cuttable) {
      if (m.clippingPlanes?.length !== planes.length || m.clippingPlanes[0] !== planes[0]) {
        m.clippingPlanes = planes;
        m.needsUpdate = true;
      }
    }
    const side = plane ? THREE.DoubleSide : THREE.FrontSide;
    for (const m of [this.solid, this.wall, this.glass]) {
      if (m.side !== side) {
        m.side = side;
        m.needsUpdate = true;
      }
    }
    if (this.lines.depthTest !== !top) {
      this.lines.depthTest = !top;
      this.lines.needsUpdate = true;
    }
  }

  /** Røntgen: vegger og tak gjennomsiktige. */
  setXray(on: boolean): void {
    if (this.xray === on) return;
    this.xray = on;
    for (const m of [this.wall, this.ceiling]) {
      m.transparent = on;
      m.opacity = on ? XRAY_OPACITY : 1;
      m.depthWrite = !on;
      m.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const m of [...this.cuttable, this.lines, this.proxy]) m.dispose();
  }
}
