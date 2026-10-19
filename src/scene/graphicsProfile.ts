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
 * I gjennomsyn (oppmåling og «Lag ny modell») vises verken himmel eller
 * effekter. I 2D-planen er det verken himmel, sol eller lamper.
 */
import type { Quality } from '../state/ViewState';
import type { SceneEffects } from './ApartmentScene';

export interface GraphicsInput {
  quality: Quality;
  /** 2D-planen på laptopen. */
  top: boolean;
  /** Gjennomsyn (oppmåling eller «Lag ny modell» på Quest). */
  passthrough: boolean;
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
  const on = q !== 'low' && !i.passthrough;
  const scenic = on && !i.top;
  return {
    sky: scenic,
    effects: {
      shades: on,
      baked: q !== 'low',
      sun: scenic,
      shafts: scenic && q === 'high',
      lamps: scenic,
      detail: on,
    },
    framebufferScale: q === 'high' && !i.passthrough ? 1.3 : 1,
    foveation: q === 'high' ? 0.25 : 1,
    pixelRatio: (dpr) => (q === 'high' ? Math.min(dpr * 1.5, 3) : q === 'low' ? Math.min(dpr, 1.25) : Math.min(dpr, 2)),
  };
}
