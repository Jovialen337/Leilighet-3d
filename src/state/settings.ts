/**
 * Kobler innstillingene i ViewState til lagring i nettleseren.
 *
 * Merk: lagringen er per enhet. Valg gjort på laptopen følger ikke med til
 * Quest-nettleseren; derfor kan de samme valgene gjøres i VR-menyen.
 */
import { PersistedSettings, inRange, isBool, oneOf, type KV } from './persist';
import { QUALITIES, TURN_MODES, XR_RATES, type ViewState } from './ViewState';

export const SETTINGS_KEY = 'leilighet:innstillinger:v1';

const isLayerMap = (v: unknown): v is Record<string, boolean> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'boolean');
const isSection = (v: unknown): v is number | null => v === null || inRange(300, 2600)(v);

export class SettingsBinding {
  private readonly store: PersistedSettings;

  constructor(
    private readonly view: ViewState,
    storage: KV | null,
  ) {
    this.store = new PersistedSettings(storage, SETTINGS_KEY);
    const s = this.store;
    s.bind('tak', view.ceilings, isBool);
    s.bind('umalte', view.measureHighlight, isBool);
    s.bind('kvalitet', view.quality, oneOf(QUALITIES));
    s.bind('bildefrekvens', view.xrRate, oneOf(XR_RATES));
    s.bind('snu', view.turn, oneOf(TURN_MODES));
    s.bind('snitthoyde', view.sectionHeight, isSection);
    s.bind('dukkehus', view.dollhouse, isBool);
    s.bind('visning', view.cameraMode, oneOf(['orbit', 'top'] as const));
    s.bind('eksisterende', view.showExisting, isBool);
    s.bind('planlagt', view.showPlanned, isBool);
    s.bind('rontgen', view.xray, isBool);
    s.bind('kurs', view.circuit, (v: unknown): v is string | null => v === null || typeof v === 'string');
    // Lag: valgene brukeren har gjort lagres per lag-id (lag som ikke finnes, ignoreres).
    view.layers.saved = { ...(s.get('lag', isLayerMap) ?? {}) };
    view.layers.onUserChange = (id, visible) => {
      view.layers.saved = { ...view.layers.saved, [id]: visible };
      s.set('lag', view.layers.saved);
    };
  }

  /** Alle innstillinger tilbake til standard (lagene fra fila). */
  reset(defaults: { layers: readonly { id: string; visible: boolean }[] }): void {
    const v = this.view;
    v.ceilings.set(true);
    v.measureHighlight.set(false);
    v.quality.set('medium');
    v.xrRate.set(90);
    v.turn.set(30);
    v.sectionHeight.set(null);
    v.dollhouse.set(false);
    v.showExisting.set(true);
    v.showPlanned.set(true);
    v.circuit.set(null);
    v.xray.set(false);
    for (const l of defaults.layers) v.layers.set(l.id, l.visible);
    this.store.clear();
    v.layers.saved = {};
  }
}
