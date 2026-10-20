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
import { DETAIL, detailTexture } from './detail';

/** Mønsteret på gulvet (detail.ts): teksturen og hvor mye det synes (0 = av). */
interface DetailUniforms {
  detailMap: THREE.IUniform<THREE.DataArrayTexture | null>;
  detailAmount: THREE.IUniform<number>;
}

/**
 * Lambert med mørke baksider (snittflater når modellen er kuttet). Med
 * `detail` får flater med `surf` > 0 mønsteret (tre eller fliser), lagt ut i
 * verdenskoordinater (meter) og ganget med fargen.
 */
function lambertWithCutFaces(params: THREE.MeshLambertMaterialParameters, detail?: DetailUniforms): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial(params);
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      '#include <dithering_fragment>\n\tif ( !gl_FrontFacing ) gl_FragColor.rgb = vec3( 0.16, 0.18, 0.2 );',
    );
    if (!detail) return;
    Object.assign(shader.uniforms, detail);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float surf;\nvarying float vSurf;\nvarying vec2 vDetailUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvSurf = surf;\n\tvDetailUv = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2DArray detailMap;\nuniform float detailAmount;\nvarying float vSurf;\nvarying vec2 vDetailUv;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
	if ( vSurf > 0.5 && detailAmount > 0.0 ) {
		float layer = floor( vSurf - 0.5 );
		float metres = layer < 0.5 ? ${DETAIL.woodMeters.toFixed(2)} : layer < 1.5 ? ${DETAIL.tileMeters.toFixed(2)} : ${DETAIL.vinylMeters.toFixed(2)};
		float d = texture( detailMap, vec3( vDetailUv / metres, layer ) ).r;
		diffuseColor.rgb *= mix( 1.0, 0.5 + d, detailAmount );
	}`,
      );
  };
  // Egen programnøkkel, så materialet med mønster ikke deler program med de andre.
  if (detail) m.customProgramCacheKey = () => 'lambert-cut-detail';
  return m;
}

export const XRAY_OPACITY = 0.22;
/** Gjenskinnet i vinduene om dagen og om natta (sRGB). */
const GLASS_DAY = [0.86, 0.92, 0.98] as const;
const GLASS_NIGHT = [0.1, 0.12, 0.19] as const;
const GLASS_NIGHT_VEC = new THREE.Vector3();

/**
 * Glass: nesten klart rett forfra, mer gjenskinn (himmelfarge) på skrå
 * (Fresnel), så vinduene ser ut som glass og ikke som blå plater. Om natta
 * er gjenskinnet mørkt (`setNight`).
 */
function glassMaterial(reflection: THREE.IUniform<THREE.Vector3>): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 1, depthWrite: false });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.glassReflection = reflection;
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 glassReflection;').replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
	{
		float facing = abs( dot( normalize( vViewPosition ), normal ) );
		float fres = pow( 1.0 - facing, 4.0 );
		gl_FragColor.rgb = mix( gl_FragColor.rgb, glassReflection, 0.1 + 0.45 * fres );
		gl_FragColor.a = opacity * ( 0.05 + 0.35 * fres );
	}`,
    );
  };
  return m;
}

/**
 * «Skjerm»-blanding for lys: lyser opp det som er under uten å bli helt hvitt
 * (resultat = lys + under · (1 − lys)), så solflekker på hvite vegger ikke
 * brenner ut.
 */
const SCREEN = {
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcColorFactor,
  premultipliedAlpha: true,
} as const;

/**
 * Lysstråler (sunlight.ts): flater som lyser opp det bak. Sett på skrå
 * fades de ut (etter vinkelen mot blikket), så det aldri blir en lys strek
 * når man ser en flate rett fra siden.
 */
function shaftMaterial(): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    ...SCREEN,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vShaftN;\nvarying vec3 vShaftV;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n\tvShaftN = normalize( normalMatrix * normal );\n\tvShaftV = - mvPosition.xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vShaftN;\nvarying vec3 vShaftV;')
      .replace(
        '#include <alphamap_fragment>',
        '#include <alphamap_fragment>\n\tdiffuseColor.a *= smoothstep( 0.15, 0.6, abs( dot( normalize( vShaftV ), normalize( vShaftN ) ) ) );',
      );
  };
  return m;
}

/**
 * Solflekker (sunlight.ts): lyser opp fargen under («skjerm»). Hjørnene har
 * vinduskoordinater (`sunUv`): myke kanter og skyggen av midtposten.
 */
function sunPatchMaterial(): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    color: '#fff3d6',
    transparent: true,
    opacity: 0.5,
    ...SCREEN,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
    toneMapped: false,
  });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 sunUv;\nvarying vec3 vSunUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvSunUv = sunUv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSunUv;')
      .replace(
        '#include <alphamap_fragment>',
        `#include <alphamap_fragment>
	{
		vec2 aa = fwidth( vSunUv.xy ) + 1e-4;
		vec2 soft = vec2( 0.03 ) + aa;
		vec2 e = smoothstep( vec2( 0.0 ), soft, vSunUv.xy ) * smoothstep( vec2( 0.0 ), soft, 1.0 - vSunUv.xy );
		float post = smoothstep( vSunUv.z, vSunUv.z + 0.02 + aa.x, abs( vSunUv.x - 0.5 ) );
		diffuseColor.a *= e.x * e.y * post;
	}`,
      );
  };
  return m;
}

export class Materials {
  /** Mønsteret på gulvet; teksturen lages første gang den trengs (`prepareDetail`). */
  readonly detail: DetailUniforms = { detailMap: { value: null }, detailAmount: { value: 0 } };
  readonly solid = lambertWithCutFaces({ vertexColors: true, dithering: true }, this.detail);
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
  /** Gjenskinnet i vinduene (sRGB): lys himmel om dagen, mørkt om natta. */
  private readonly glassReflection = { value: new THREE.Vector3(...GLASS_DAY) };
  readonly glass = glassMaterial(this.glassReflection);
  /** Solflekker gjennom vinduene. */
  readonly sun = sunPatchMaterial();
  /** Lysstråler: hvitt med alfa per hjørne, lyser opp det bak («skjerm»). */
  readonly glow = shaftMaterial();
  /** Lampelys om kvelden (varmt, «skjerm»). */
  readonly lamp = new THREE.MeshBasicMaterial({
    color: '#ffc98a',
    vertexColors: true,
    transparent: true,
    ...SCREEN,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
    toneMapped: false,
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
    return [this.solid, this.wall, this.ceiling, this.glass, this.overlay, this.shade, this.sun, this.glow, this.lamp];
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

  /** Natt (0–1): mørkere gjenskinn i vinduene. */
  setNight(night: number): void {
    this.glassReflection.value.fromArray(GLASS_DAY).lerp(GLASS_NIGHT_VEC.fromArray(GLASS_NIGHT), night);
  }

  /** Slår mønsteret på gulvet av og på (lager teksturen første gang). */
  setDetail(on: boolean): void {
    if (on && !this.detail.detailMap.value) this.detail.detailMap.value = detailTexture();
    this.detail.detailAmount.value = on ? DETAIL.amount : 0;
  }

  dispose(): void {
    for (const m of [...this.cuttable, this.lines, this.proxy]) m.dispose();
    this.detail.detailMap.value?.dispose();
  }
}
