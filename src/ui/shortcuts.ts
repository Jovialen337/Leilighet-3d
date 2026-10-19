/**
 * Hurtigtaster på laptopen. Én tabell styrer både tastene og hjelpevinduet.
 */
export interface Shortcut {
  keys: string[];
  label: string;
  action: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { keys: ['1'], label: '1', action: 'orbit' },
  { keys: ['2'], label: '2', action: 'top' },
  { keys: ['t', 'T'], label: 'T', action: 'ceilings' },
  { keys: ['u', 'U'], label: 'U', action: 'highlight' },
  { keys: ['k', 'K'], label: 'K', action: 'dollhouse' },
  { keys: ['r', 'R'], label: 'R', action: 'resetView' },
  { keys: ['f', 'F'], label: 'F', action: 'fps' },
  { keys: ['l', 'L'], label: 'L', action: 'light' },
  { keys: ['h', 'H', '?'], label: 'H', action: 'help' },
];

export const ACTION_TEXT: Record<string, string> = {
  orbit: '3D-visning',
  top: 'Ovenfra (2D)',
  ceilings: 'Vis/skjul tak',
  highlight: 'Marker umålte mål',
  dollhouse: 'Dukkehus (kutt 3D-modellen)',
  resetView: 'Tilbakestill visning',
  fps: 'Vis/skjul bildefrekvens',
  light: 'Lys: morgen → dag → kveld',
  help: 'Vis/skjul denne hjelpen',
};

/** Skal tastetrykket gå til et tekstfelt i stedet for til en hurtigtast? */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  if (t instanceof HTMLInputElement) return !['checkbox', 'radio', 'range', 'button'].includes(t.type);
  return false;
}

export function shortcutFor(key: string): Shortcut | undefined {
  return SHORTCUTS.find((s) => s.keys.includes(key));
}
