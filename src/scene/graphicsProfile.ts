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
 * Hver effekt kan også slås av og på for seg («Effekter»): egne valg
 * lagres som avvik fra grafikkvalget og nullstilles når man velger
 * «Rask», «Standard» eller «Høy» igjen.
 *
 * I gjennomsyn (oppmåling og «Lag ny modell») vises verken himmel eller
 * effekter. I 2D-planen er det verken himmel, sol eller lamper, og i
 * røntgen ingen sol eller lamper (de ville lyst opp vegger man ser gjennom).
 * Det gjelder også egne valg.
 */
import type { Quality } from '../state/ViewState';
import type { SceneEffects } from './ApartmentScene';

/** Effektene man kan slå av og på selv. */
export type EffectId = 'baked' | 'sun' | 'lamps' | 'shafts' | 'detail' | 'shades' | 'sky';
export const EFFECT_IDS: readonly EffectId[] = ['baked', 'sun', 'lamps', 'shafts', 'detail', 'shades', 'sky'];
export const EFFECT_TEXT: Record<EffectId, string> = {
  baked: 'Dagslys i rommene',
  sun: 'Solflekker',
  lamps: 'Lampelys (kveld)',
  shafts: 'Lysstråler',
  detail: 'Gulvmønster',
  shades: 'Skygger under møbler',
  sky: 'Himmel og utsikt',
};
/** Egne valg: bare effektene som avviker fra grafikkvalget. */
export type EffectChoices = Partial<Record<EffectId, boolean>>;

/** Effektene grafikkvalget alene slår på. */
export function presetEffects(q: Quality): Record<EffectId, boolean> {
  const on = q !== 'low';
  return { baked: on, sun: on, lamps: on, shafts: q === 'high', detail: on, shades: on, sky: on };
}

/** Effektene slik brukeren vil ha dem: grafikkvalget med egne valg oppå. */
export function wantedEffects(q: Quality, custom: EffectChoices = {}): Record<EffectId, boolean> {
  return { ...presetEffects(q), ...custom };
}

/** Egne valg etter at effekten `id` er satt til `on` (lik grafikkvalget = ikke lenger et eget valg). */
export function chooseEffect(q: Quality, custom: EffectChoices, id: EffectId, on: boolean): EffectChoices {
  const next = { ...custom };
  if (presetEffects(q)[id] === on) delete next[id];
  else next[id] = on;
  return next;
}

/** Gyldige egne valg (fra lagringen): bare kjente effekter med av/på. */
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
  /** Egne valg for effektene (avvik fra grafikkvalget). */
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
  const q = i.quality;
  const want = wantedEffects(q, i.custom);
  const on = !i.passthrough;
  const scenic = on && !i.top;
  const lit = scenic && !i.xray;
  return {
    sky: scenic && want.sky,
    effects: {
      shades: on && want.shades,
      baked: want.baked,
      sun: lit && want.sun,
      shafts: lit && want.shafts,
      lamps: lit && want.lamps,
      detail: on && want.detail,
    },
    framebufferScale: q === 'high' && !i.passthrough ? 1.3 : 1,
    foveation: q === 'high' ? 0.25 : 1,
    pixelRatio: (dpr) => (q === 'high' ? Math.min(dpr * 1.5, 3) : q === 'low' ? Math.min(dpr, 1.25) : Math.min(dpr, 2)),
  };
}
