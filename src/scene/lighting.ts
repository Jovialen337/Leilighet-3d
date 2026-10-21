/**
 * Lyssetting: himmellys (lyst ovenfra, varmt fra gulvet), et nøkkellys fra
 * sola og et svakt fyllys fra motsatt side. Ulike veggretninger får dermed
 * tydelig ulik lysstyrke, så hjørner og rom leses godt – uten skygger, som
 * ville vært dyrt på Quest. Dagslyset fra vinduene er bakt inn i fargene
 * (bake.ts), og sola lager lysflekker gjennom vinduene (sunlight.ts).
 *
 * «Lys» velger tid på døgnet: morgen, dag, kveld eller natt. Inngangsveggen
 * antas å vende mot øst (−z), så morgensola står lavt inn gjennom
 * stuevinduene, og kveldssola kommer lavt fra vest. Om natta er det
 * stjernehimmel og måne, og lyset kommer fra lampene. «Dag» er standard.
 *
 * `shadeOf` regner ut hvor lys en hvit Lambert-flate blir (three.js-formlene),
 * så lyssettingen kan testes uten GPU.
 */
import * as THREE from 'three';
import type { BakeMix } from './bake';

export type LightId = 'morgen' | 'dag' | 'kveld' | 'natt';
export const LIGHT_IDS: readonly LightId[] = ['morgen', 'dag', 'kveld', 'natt'];
export const LIGHT_TEXT: Record<LightId, string> = { morgen: 'Morgen', dag: 'Dag', kveld: 'Kveld', natt: 'Natt' };

type Vec = readonly [number, number, number];

export interface LightPreset {
  hemi: { sky: string; ground: string; intensity: number };
  /** Sola: farge, styrke og retningen *mot* sola. */
  key: { color: string; intensity: number; from: Vec };
  fill: { color: string; intensity: number; from: Vec };
  exposure: number;
  /** Himmelen: senit, horisont, glød rundt sola og fjern skog/åser. */
  sky: { zenith: string; horizon: string; glow: string; hills: string; clouds: string };
  /** Lysflekkene fra sola gjennom vinduene: farge og styrke (0–1). */
  sun: { color: string; strength: number };
  /** Lampene lyser (0 = av, 1 = fullt). */
  lamps: number;
  /** Hvor mye av det bakte grunnlyset, dagslyset fra vinduene og lampelyset som brukes. */
  bake: BakeMix;
  /**
   * Fargen på hver del av det bakte lyset (RGB-faktorer rundt 1; uten = hvitt):
   * f.eks. gyllent morgenlys, blått kveldslys fra vinduene og varme lamper.
   */
  bakeTint?: { ambient: Vec; window: Vec; lamp: Vec };
  /** Natt (0–1): stjerner på himmelen, mørk mark og mørkt gjenskinn i vinduene. */
  night: number;
}

export const LIGHTS: Record<LightId, LightPreset> = {
  morgen: {
    hemi: { sky: '#f3f1ff', ground: '#eadccb', intensity: 2.15 },
    key: { color: '#ffd7a8', intensity: 1.25, from: [1, 1.3, -4] },
    fill: { color: '#dfe8ff', intensity: 0.55, from: [-4, 1.5, 3] },
    exposure: 1.0,
    sky: { zenith: '#7da9dc', horizon: '#f6dcc4', glow: '#ffd2a1', hills: '#8f9aa6', clouds: '#fff1e2' },
    sun: { color: '#ffd6a6', strength: 0.8 },
    lamps: 0,
    bake: { ambient: 1, window: 0.9, lamp: 0 },
    bakeTint: { ambient: [1.03, 1, 0.95], window: [1.1, 1, 0.86], lamp: [1, 1, 1] },
    night: 0,
  },
  dag: {
    hemi: { sky: '#ffffff', ground: '#efe9df', intensity: 2.35 },
    key: { color: '#fff1dc', intensity: 1.3, from: [3, 2.5, -4] },
    fill: { color: '#e3ecff', intensity: 0.6, from: [-4, 1.5, 3] },
    exposure: 1.0,
    sky: { zenith: '#6fa6e0', horizon: '#e6edf1', glow: '#fff6e0', hills: '#9aa8a6', clouds: '#ffffff' },
    sun: { color: '#ffe6c0', strength: 0.75 },
    lamps: 0,
    bake: { ambient: 1, window: 1, lamp: 0 },
    night: 0,
  },
  kveld: {
    hemi: { sky: '#d9d6e0', ground: '#e6d2bb', intensity: 1.1 },
    key: { color: '#ffd2a6', intensity: 0.3, from: [1.6, 0.75, 4] },
    fill: { color: '#cdd6f0', intensity: 0.35, from: [-4, 1.5, -3] },
    exposure: 1.0,
    sky: { zenith: '#3f5f9a', horizon: '#f2a46e', glow: '#ff9a50', hills: '#5c5f78', clouds: '#ffc9a0' },
    sun: { color: '#ffbb80', strength: 0.75 },
    lamps: 1,
    bake: { ambient: 0.85, window: 0.3, lamp: 1 },
    // Blått lys fra vinduene i skumringen, varme lamper (rundt 2700 K).
    bakeTint: { ambient: [0.98, 0.98, 1.04], window: [0.8, 0.9, 1.2], lamp: [1.3, 0.92, 0.55] },
    night: 0,
  },
  // Månen står høyt i sør-vest; den lyser svakt og kaster ingen flekker. Lampene gjør jobben.
  natt: {
    hemi: { sky: '#9aa6c8', ground: '#8e93a8', intensity: 0.9 },
    key: { color: '#b4c2e8', intensity: 0.12, from: [-2, 3, 3] },
    fill: { color: '#ffcf9a', intensity: 0.25, from: [-4, 1.5, -3] },
    exposure: 1.0,
    sky: { zenith: '#04071a', horizon: '#1a2442', glow: '#41537e', hills: '#0b1020', clouds: '#2b3352' },
    sun: { color: '#a8bce8', strength: 0 },
    lamps: 1.2,
    bake: { ambient: 0.7, window: 0.04, lamp: 1.25 },
    // Kaldt månelys i rommene uten lampe, varmt der lampa lyser.
    bakeTint: { ambient: [0.8, 0.9, 1.25], window: [0.75, 0.85, 1.3], lamp: [1.3, 0.92, 0.55] },
    night: 1,
  },
};

/** Standardlyset («Dag»). */
export const LIGHTING = LIGHTS.dag;

export interface Lights {
  hemi: THREE.HemisphereLight;
  key: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
}

export function addLights(scene: THREE.Scene, preset: LightPreset = LIGHTING): Lights {
  const hemi = new THREE.HemisphereLight();
  const key = new THREE.DirectionalLight();
  const fill = new THREE.DirectionalLight();
  scene.add(hemi, key, key.target, fill, fill.target);
  const lights = { hemi, key, fill };
  applyLights(lights, preset);
  return lights;
}

/** Setter lysene til et forhåndsvalg (bare tall og farger: ingen ny kompilering). */
export function applyLights(l: Lights, p: LightPreset): void {
  l.hemi.color.set(p.hemi.sky);
  l.hemi.groundColor.set(p.hemi.ground);
  l.hemi.intensity = p.hemi.intensity;
  l.key.color.set(p.key.color);
  l.key.intensity = p.key.intensity;
  l.key.position.set(...p.key.from);
  l.fill.color.set(p.fill.color);
  l.fill.intensity = p.fill.intensity;
  l.fill.position.set(...p.fill.from);
  l.key.updateMatrixWorld();
  l.fill.updateMatrixWorld();
}

/** Tonekartlegging som beholder fargene fra fila (Neutral), med lett eksponering. */
export function configureRenderer(renderer: THREE.WebGLRenderer, preset: LightPreset = LIGHTING): void {
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = preset.exposure;
}

const lum = (hex: string): number => {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};

/** Lysstyrke (lineær, før tonekartlegging) på en hvit flate med normal `n`. */
export function shadeOf(n: { x: number; y: number; z: number }, preset: LightPreset = LIGHTING): number {
  const L = preset;
  const nn = new THREE.Vector3(n.x, n.y, n.z).normalize();
  const w = 0.5 * nn.y + 0.5;
  let irr = (lum(L.hemi.ground) * (1 - w) + lum(L.hemi.sky) * w) * L.hemi.intensity;
  for (const l of [L.key, L.fill]) {
    const d = new THREE.Vector3(...l.from).normalize();
    irr += Math.max(0, nn.dot(d)) * l.intensity * lum(l.color);
  }
  return irr / Math.PI;
}
