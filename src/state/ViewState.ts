/**
 * Visningstilstand som er uavhengig av hvilket UI som endrer den.
 * Laptop-panelet (DOM) og VR-håndleddsmenyen (fase 3) leser og skriver
 * de samme verdiene, så ingen av dem trenger å kjenne den andre.
 */
import type { Layer } from '../schema/types';
import type { LightId } from '../scene/lighting';
import { customStart, toggleEffect, type EffectChoices, type EffectId } from '../scene/graphicsProfile';
import { Observable } from './Observable';

export type CameraMode = 'orbit' | 'top';
/** Grafikkvalg: «Rask», «Standard», «Høy» eller «Egendefinert» (effektene hver for seg). */
export type Quality = 'low' | 'medium' | 'high' | 'custom';
export type Preset = Exclude<Quality, 'custom'>;
export const QUALITIES: readonly Quality[] = ['low', 'medium', 'high', 'custom'];
/** Snu i VR: fast vinkel (grader) eller myk dreiing. */
export type TurnMode = 15 | 30 | 45 | 'smooth';
export const TURN_MODES: readonly TurnMode[] = [15, 30, 45, 'smooth'];
export type XRRate = 72 | 90 | 120;
export const XR_RATES: readonly XRRate[] = [72, 90, 120];

export class LayerState {
  private readonly visible = new Map<string, Observable<boolean>>();
  private readonly initialized = new Set<string>();
  readonly layers: Layer[] = [];
  /** Lagrede valg fra forrige gang (lag-id → synlig), brukes når laget dukker opp. */
  saved: Record<string, boolean> = {};
  /** Kalles når brukeren endrer et lag (for lagring). */
  onUserChange: ((id: string, visible: boolean) => void) | null = null;

  /**
   * Nye lag får synligheten fra et lagret valg, ellers fra fila. Valg brukeren
   * har gjort i denne økten beholdes ved ny innlasting.
   */
  reset(layers: readonly Layer[]): void {
    this.layers.length = 0;
    this.layers.push(...layers);
    for (const l of layers) {
      if (this.initialized.has(l.id)) continue;
      this.initialized.add(l.id);
      const o = this.get(l.id);
      o.set(this.saved[l.id] ?? l.visible);
      o.subscribe((v) => this.onUserChange?.(l.id, v));
    }
  }

  get(id: string): Observable<boolean> {
    let o = this.visible.get(id);
    if (!o) {
      o = new Observable(true);
      this.visible.set(id, o);
    }
    return o;
  }

  isVisible(id: string): boolean {
    return this.get(id).value;
  }

  set(id: string, visible: boolean): void {
    this.get(id).set(visible);
  }

  toggle(id: string): void {
    this.set(id, !this.isVisible(id));
  }
}

export class ViewState {
  readonly layers = new LayerState();
  readonly cameraMode = new Observable<CameraMode>('orbit');
  readonly ceilings = new Observable(true);
  readonly measureHighlight = new Observable(false);
  readonly fps = new Observable(false);
  readonly inXR = new Observable(false);
  /* ---- innstillinger (lagres i nettleseren) ---- */
  readonly quality = new Observable<Quality>('medium');
  /** Effektene i «Egendefinert» (lagres, så de kommer tilbake). */
  readonly customEffects = new Observable<EffectChoices>({});
  /** Lys: tid på døgnet (morgen/dag/kveld). */
  readonly light = new Observable<LightId>('dag');
  readonly xrRate = new Observable<XRRate>(90);
  readonly turn = new Observable<TurnMode>(30);
  /** Vis alltid hjelpen på håndleddet (ellers bare til kontrollene er lært). */
  readonly wristHelp = new Observable(false);
  /** Snitthøyde over laveste gulv (mm); null = fra fila (planCutHeight). */
  readonly sectionHeight = new Observable<number | null>(null);
  /** Dukkehus: 3D-visningen kuttes i snitthøyden så man ser inn i rommene. */
  readonly dollhouse = new Observable(false);
  /* ---- filtre for el og vann ---- */
  readonly showExisting = new Observable(true);
  readonly showPlanned = new Observable(true);
  /** Vis bare denne elektriske kursen (null = alle). */
  readonly circuit = new Observable<string | null>(null);
  /** Røntgen: gjennomsiktige vegger og tak. */
  readonly xray = new Observable(false);

  constructor() {
    // «Egendefinert» valgt fra et forhåndsvalg: start med effektene i det (se customStart).
    this.quality.subscribe((q, prev) => {
      if (q === 'custom' && prev !== 'custom') this.customEffects.set(customStart(prev, this.customEffects.value));
    });
  }

  /** Slår én effekt av eller på (blir «Egendefinert», eller et forhåndsvalg med akkurat de effektene). */
  toggleEffect(id: EffectId): void {
    const next = toggleEffect(this.quality.value, this.customEffects.value, id);
    this.customEffects.set(next.custom);
    this.quality.set(next.quality);
  }
}
