/**
 * Menyen (X) når man måler opp en ny modell i gjennomsyn: nytt rom, mål
 * rommet på nytt, dør/vindu/åpning, navn på rommet, berør/pek, juster på
 * nytt og avslutt. Rene data (testbart), tegnes av WristMenu.
 */
import { MENU_H, MENU_W, type MenuItem, type MenuLabel } from './menuLayout';

export interface BuildMenuState {
  /** Rommet man nettopp målte (kan få navn), eller null. */
  room: { id: string; name: string } | null;
  /** Rommet man står i (kan måles på nytt), eller null. */
  inRoom: { id: string; name: string } | null;
  /** Romnavn å velge mellom. */
  names: readonly string[];
  method: 'touch' | 'point';
  /** Tegningen har rom (justering gir mening). */
  canRealign: boolean;
  /** Et rom eller en åpning er under oppmåling (kan avbrytes). */
  busy: boolean;
}

const PAD = 32;
const ROW_H = 72;
const GAP = 14;

export function buildBuildMenu(s: BuildMenuState): { items: MenuItem[]; labels: MenuLabel[] } {
  const items: MenuItem[] = [];
  const labels: MenuLabel[] = [];
  const full = MENU_W - 2 * PAD;
  let y = PAD;
  const row = (title: string | null, list: readonly { id: string; label: string; active?: boolean; kind?: MenuItem['kind'] }[], h = ROW_H): void => {
    if (title) {
      labels.push({ text: title, x: PAD, y: y + 26 });
      y += 44;
    }
    const w = (full - (list.length - 1) * GAP) / list.length;
    list.forEach((o, i) =>
      items.push({ id: o.id, kind: o.kind ?? 'action', label: o.label, active: o.active ?? false, x: PAD + i * (w + GAP), y, w, h }),
    );
    y += h + GAP;
  };

  row('Rom', [
    { id: 'b:new-room', label: 'Nytt rom' },
    ...(s.inRoom ? [{ id: 'b:remeasure', label: `Mål «${s.inRoom.name}» på nytt` }] : []),
    ...(s.busy ? [{ id: 'b:cancel', label: 'Avbryt' }] : []),
  ]);
  row('Legg til i veggen', [
    { id: 'b:door', label: 'Dør' },
    { id: 'b:window', label: 'Vindu' },
    { id: 'b:passage', label: 'Åpning' },
  ]);
  if (s.room) {
    labels.push({ text: `Navn på «${s.room.name}»`, x: PAD, y: y + 26 });
    y += 44;
    const cols = 4;
    const w = (full - (cols - 1) * GAP) / cols;
    const h = 58;
    s.names.forEach((n, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      items.push({ id: `b:name:${n}`, kind: 'choice', label: n, active: s.room!.name === n, x: PAD + c * (w + GAP), y: y + r * (h + 10), w, h });
    });
    y += Math.ceil(s.names.length / cols) * (h + 10) + 4;
  }
  // Nederst: verktøy.
  y = Math.max(y, MENU_H - PAD - ROW_H);
  row(null, [
    { id: 'b:method', label: 'Pek', active: s.method === 'point', kind: 'toggle' },
    ...(s.canRealign ? [{ id: 'b:realign', label: 'Juster på nytt' }] : []),
    { id: 'b:exit', label: 'Avslutt' },
  ]);
  return { items, labels };
}
