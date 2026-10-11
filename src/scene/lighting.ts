/**
 * Lyssetting: himmellys (lyst ovenfra, varmt fra gulvet), et nøkkellys fra
 * øst-sørøst (inngangsveggen vender mot øst / −z) og et svakt fyllys fra
 * motsatt side. Ulike veggretninger får dermed tydelig ulik lysstyrke, så
 * hjørner og rom leses godt – uten skygger, som ville vært dyrt på Quest.
 *
 * `shadeOf` regner ut hvor lys en hvit Lambert-flate blir (three.js-formlene),
 * så lyssettingen kan testes uten GPU.
 */
import * as THREE from 'three';

export const LIGHTING = {
  hemi: { sky: '#ffffff', ground: '#efe9df', intensity: 2.35 },
  key: { color: '#fff1dc', intensity: 1.3, from: [3, 2.5, -4] as const },
  fill: { color: '#e3ecff', intensity: 0.6, from: [-4, 1.5, 3] as const },
  exposure: 1.0,
} as const;

export function addLights(scene: THREE.Scene): THREE.Light[] {
  const L = LIGHTING;
  const hemi = new THREE.HemisphereLight(L.hemi.sky, L.hemi.ground, L.hemi.intensity);
  const key = new THREE.DirectionalLight(L.key.color, L.key.intensity);
  key.position.set(...L.key.from);
  const fill = new THREE.DirectionalLight(L.fill.color, L.fill.intensity);
  fill.position.set(...L.fill.from);
  scene.add(hemi, key, key.target, fill, fill.target);
  return [hemi, key, fill];
}

/** Tonekartlegging som beholder fargene fra fila (Neutral), med lett eksponering. */
export function configureRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = LIGHTING.exposure;
}

const lum = (hex: string): number => {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};

/** Lysstyrke (lineær, før tonekartlegging) på en hvit flate med normal `n`. */
export function shadeOf(n: { x: number; y: number; z: number }): number {
  const L = LIGHTING;
  const nn = new THREE.Vector3(n.x, n.y, n.z).normalize();
  const w = 0.5 * nn.y + 0.5;
  let irr = (lum(L.hemi.ground) * (1 - w) + lum(L.hemi.sky) * w) * L.hemi.intensity;
  for (const l of [L.key, L.fill]) {
    const d = new THREE.Vector3(...l.from).normalize();
    irr += Math.max(0, nn.dot(d)) * l.intensity * lum(l.color);
  }
  return irr / Math.PI;
}
