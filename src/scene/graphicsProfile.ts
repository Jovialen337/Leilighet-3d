/**
 * Grafikkprofilen: ett sted som bestemmer hva som er på, ut fra
 * grafikkvalget og hvor man er (laptop, 2D-plan, VR, gjennomsyn). App og VR
 * bruker begge denne, så en ny effekt bare trenger å legges til her.
 *
 * - «Rask»: bare modellen med flate farger.
 * - «Standard» (standard, også i VR): bakt dagslys, tregulv og fliser,
 *   myke skygger under møbler, solflekker, lampelys om kvelden og himmel.
 *   Ingen nye tegnekall utover solflekkene (og lampene om kvelden).
 * - «Høy»: i tillegg lysstråler fra vinduene og skarpere bilde (høyere
 *   oppløsning og mindre uskarpt i kantene av synsfeltet i VR).
 *
 * «Egendefinert»: hver effekt av eller på for seg, også skarpere bilde.
 * Settet lagres og kommer tilbake når man velger «Egendefinert» igjen.
 *
 * I gjennomsyn (oppmåling og «Lag ny modell») vises verken himmel eller
 * effekter. I 2D-planen er det verken himmel, sol eller lamper, og i
 * røntgen ingen sol eller lamper (de ville lyst opp vegger man ser gjennom).
 * Det gjelder også «Egendefinert».
 */
import type { Preset, Quality } from '../state/ViewState';
import type { SceneEffects } from './ApartmentScene';

/** Effektene man kan velge selv («Egendefinert»). */
export type EffectId = 'baked' | 'sun' | 'shafts' | 'lamps' | 'sky' | 'detail' | 'sharp';
export const EFFECT_IDS: readonly EffectId[] = ['baked', 'sun', 'shafts', 'lamps', 'sky', 'detail', 'sharp'];
export const EFFECT_TEXT: Record<EffectId, string> = {
  baked: 'Dagslys og myke skygger',
  sun: 'Solflekker',
  shafts: 'Lysstråler',
  lamps: 'Lampelys (kveld)',
  sky: 'Himmel og utsikt',
  detail: 'Gulvmønster',
  sharp: 'Skarpere bilde',
};
export type EffectSet = Record<EffectId, boolean>;
/** Det lagrede «Egendefinert»-settet; det som mangler, er som på «Standard». */
export type EffectChoices = Partial<EffectSet>;

/** Effektene i hvert forhåndsvalg. */
export function presetEffects(p: Preset): EffectSet {
  const on = p !== 'low';
  return { baked: on, sun: on, shafts: p === 'high', lamps: on, sky: on, detail: on, sharp: p === 'high' };
}

const PRESETS: readonly Preset[] = ['low', 'medium', 'high'];

/** Effektene slik de er valgt nå: forhåndsvalget, eller «Egendefinert»-settet. */
export function wantedEffects(q: Quality, custom: EffectChoices = {}): EffectSet {
  return q === 'custom' ? { ...presetEffects('medium'), ...custom } : presetEffects(q);
}

/** Forhåndsvalget som har akkurat disse effektene, eller null. */
export function matchingPreset(set: EffectSet): Preset | null {
  return PRESETS.find((p) => EFFECT_IDS.every((id) => presetEffects(p)[id] === set[id])) ?? null;
}

/**
 * Slår én effekt av eller på: utgangspunktet er effektene som gjelder nå, og
 * resultatet blir «Egendefinert» – eller et forhåndsvalg hvis settet er likt det.
 */
export function toggleEffect(q: Quality, custom: EffectChoices, id: EffectId): { quality: Quality; custom: EffectSet } {
  const next = { ...wantedEffects(q, custom) };
  next[id] = !next[id];
  return { quality: matchingPreset(next) ?? 'custom', custom: next };
}

/** Gyldig lagret sett: bare kjente effekter med av/på. */
export const isEffectChoices = (v: unknown): v is EffectChoices =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.entries(v).every(([k, x]) => (EFFECT_IDS as readonly string[]).includes(k) && typeof x === 'boolean');

export interface GraphicsInput {
  quality: Quality;
  /** 2D-planen på laptopen. */
  top: boolean;
  /** Gjennomsyn (oppmåling eller «Lag ny modell» på Quest). */
  passthrough: boolean;
  /** Røntgen (gjennomsiktige vegger og tak). */
  xray?: boolean;
  /** «Egendefinert»-settet (brukes når grafikkvalget er «custom»). */
  custom?: EffectChoices;
}

export interface GraphicsProfile {
  sky: boolean;
  effects: SceneEffects;
  /** Oppløsning i VR (settes når økten starter). */
  framebufferScale: number;
  /** Fast foveering i VR, 0 (skarpt overalt) – 1 (mest uskarpt i kantene); kan endres underveis. */
  foveation: number;
  /** Pikseltetthet på laptopen ut fra skjermens. */
  pixelRatio: (dpr: number) => number;
}

export function graphicsProfile(i: GraphicsInput): GraphicsProfile {
  const want = wantedEffects(i.quality, i.custom);
  const on = !i.passthrough;
  const scenic = on && !i.top;
  const lit = scenic && !i.xray;
  const sharp = want.sharp && on;
  return {
    sky: scenic && want.sky,
    effects: {
      shades: on && want.baked,
      baked: want.baked,
      sun: lit && want.sun,
      shafts: lit && want.shafts,
      lamps: lit && want.lamps,
      // Lampelyset som er bakt inn i fargene følger valget (ikke 2D eller røntgen).
      bakedLamps: want.lamps,
      detail: on && want.detail,
    },
    framebufferScale: sharp ? 1.3 : 1,
    foveation: sharp ? 0.25 : 1,
    pixelRatio: (dpr) => (want.sharp ? Math.min(dpr * 1.5, 3) : i.quality === 'low' ? Math.min(dpr, 1.25) : Math.min(dpr, 2)),
  };
}
