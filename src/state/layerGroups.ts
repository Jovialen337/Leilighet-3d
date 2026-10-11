/**
 * Laggrupper og forhåndsvalg («Elplan», «Rørplan» …), felles for laptop-panelet
 * og VR-menyen. Lag som ikke står i en gruppe havner i «Ute og annet».
 */
import type { LayerState } from './ViewState';

export interface LayerGroup {
  id: string;
  name: string;
  layers: readonly string[];
}

export const LAYER_GROUPS: readonly LayerGroup[] = [
  { id: 'bygg', name: 'Bygg', layers: ['structure', 'openings'] },
  { id: 'el', name: 'Elektrisk', layers: ['electrical-existing', 'electrical-planned', 'wiring'] },
  { id: 'vann', name: 'Vann og avløp', layers: ['plumbing-existing', 'plumbing-planned'] },
  { id: 'ventilasjon', name: 'Ventilasjon', layers: ['ventilation'] },
  { id: 'interior', name: 'Interiør', layers: ['furniture', 'workshop-zone'] },
  { id: 'annet', name: 'Ute og annet', layers: ['outdoor', 'scan-reference', 'notes'] },
];

export interface LayerPreset {
  id: string;
  name: string;
  /** Grupper som vises (resten skjules). null = alle. */
  groups: readonly string[] | null;
}

export const LAYER_PRESETS: readonly LayerPreset[] = [
  { id: 'alt', name: 'Alt', groups: null },
  { id: 'elplan', name: 'Elplan', groups: ['bygg', 'el'] },
  { id: 'rorplan', name: 'Rørplan', groups: ['bygg', 'vann'] },
  { id: 'bygg', name: 'Bare bygg', groups: ['bygg'] },
];

export function groupOf(layerId: string): string {
  return LAYER_GROUPS.find((g) => g.layers.includes(layerId))?.id ?? 'annet';
}

/** Lagene i fila som hører til gruppen. */
export function layersIn(state: LayerState, groupId: string): string[] {
  return state.layers.map((l) => l.id).filter((id) => groupOf(id) === groupId);
}

export type GroupState = 'on' | 'off' | 'mixed' | 'empty';

export function groupState(state: LayerState, groupId: string): GroupState {
  const ids = layersIn(state, groupId);
  if (!ids.length) return 'empty';
  const on = ids.filter((id) => state.isVisible(id)).length;
  return on === 0 ? 'off' : on === ids.length ? 'on' : 'mixed';
}

export function setGroup(state: LayerState, groupId: string, visible: boolean): void {
  for (const id of layersIn(state, groupId)) state.set(id, visible);
}

export function applyPreset(state: LayerState, presetId: string): void {
  const p = LAYER_PRESETS.find((x) => x.id === presetId);
  if (!p) return;
  for (const l of state.layers) state.set(l.id, p.groups === null || p.groups.includes(groupOf(l.id)));
}

/** «Bare denne»: vis bare dette laget (pluss bygget, så man ser hvor det er). */
export function solo(state: LayerState, layerId: string): void {
  for (const l of state.layers) state.set(l.id, l.id === layerId || groupOf(l.id) === 'bygg');
}

export function setAll(state: LayerState, visible: boolean): void {
  for (const l of state.layers) state.set(l.id, visible);
}
