/**
 * Innholdet i VR-menyen som rene data (testbart uten three.js): faner og
 * knapper med plassering i lerretet (piksler). Knappene har en `id` som sier
 * hva de gjør, f.eks. «layer:furniture» eller «room:stue».
 */
import type { Quality, TurnMode, XRRate } from '../state/ViewState';

export const MENU_W = 1024;
export const MENU_H = 768;

/** «lagliste» er en underside av «Lag» med hvert enkelt lag. */
export type MenuTab = 'visning' | 'lag' | 'lagliste' | 'tegn' | 'ga' | 'komfort';
export const TABS: readonly { id: MenuTab; label: string }[] = [
  { id: 'visning', label: 'Visning' },
  { id: 'lag', label: 'Lag' },
  { id: 'tegn', label: 'Tegn' },
  { id: 'ga', label: 'Gå til' },
  { id: 'komfort', label: 'Komfort' },
];

/** Tegneverktøy i VR-menyen: id (draw:…) og navn. */
export const DRAW_ITEMS: readonly { id: string; label: string }[] = [
  { id: 'draw:wire:power', label: 'Kabel – strøm' },
  { id: 'draw:wire:light', label: 'Kabel – lys' },
  { id: 'draw:pipe:cold', label: 'Kaldtvann' },
  { id: 'draw:pipe:hot', label: 'Varmtvann' },
  { id: 'draw:pipe:drain', label: 'Avløp' },
  { id: 'draw:fixture:outlet', label: 'Stikkontakt' },
  { id: 'draw:fixture:switch', label: 'Bryter' },
  { id: 'draw:fixture:light', label: 'Lampepunkt' },
  { id: 'draw:fixture:tap', label: 'Kran' },
  { id: 'draw:fixture:drain', label: 'Sluk' },
  { id: 'draw:select', label: 'Velg og slett' },
];

export type ItemKind = 'tab' | 'toggle' | 'choice' | 'action';

export interface MenuItem {
  id: string;
  kind: ItemKind;
  label: string;
  /** På (bryter) / valgt (valg, fane). */
  active: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MenuState {
  tab: MenuTab;
  ceilings: boolean;
  highlight: boolean;
  fps: boolean;
  quality: Quality;
  turn: TurnMode;
  rate: XRRate;
  layers: readonly { id: string; name: string; visible: boolean }[];
  rooms: readonly { id: string; name: string }[];
  showExisting: boolean;
  showPlanned: boolean;
  xray: boolean;
  groups: readonly { id: string; name: string; state: 'on' | 'off' | 'mixed' }[];
  presets: readonly { id: string; name: string }[];
  /** Aktivt tegneverktøy i VR (id fra DRAW_ITEMS), eller null. */
  drawTool: string | null;
  drawPlanned: boolean;
  /** Bare én kurs vises (filter på). */
  circuitFiltered: boolean;
}

/** Overskrifter i lerretet (tegnes, men kan ikke trykkes på). */
export interface MenuLabel {
  text: string;
  x: number;
  y: number;
}

const PAD = 32;
const TAB_H = 84;
const ROW_H = 76;
const GAP = 14;

export function buildMenu(s: MenuState): { items: MenuItem[]; labels: MenuLabel[] } {
  const items: MenuItem[] = [];
  const labels: MenuLabel[] = [];
  const tabW = (MENU_W - 2 * PAD - (TABS.length - 1) * GAP) / TABS.length;
  TABS.forEach((t, i) =>
    items.push({
      id: `tab:${t.id}`,
      kind: 'tab',
      label: t.label,
      active: s.tab === t.id || (t.id === 'lag' && s.tab === 'lagliste'),
      x: PAD + i * (tabW + GAP),
      y: PAD,
      w: tabW,
      h: TAB_H,
    }),
  );
  let y = PAD + TAB_H + 28;
  const full = MENU_W - 2 * PAD;

  const toggle = (id: string, label: string, on: boolean, x = PAD, w = full): void => {
    items.push({ id, kind: 'toggle', label, active: on, x, y, w, h: ROW_H });
  };
  const choices = (title: string, opts: readonly { id: string; label: string; active: boolean }[]): void => {
    labels.push({ text: title, x: PAD, y: y + 34 });
    y += 52;
    const w = (full - (opts.length - 1) * GAP) / opts.length;
    opts.forEach((o, i) => items.push({ id: o.id, kind: 'choice', label: o.label, active: o.active, x: PAD + i * (w + GAP), y, w, h: ROW_H }));
    y += ROW_H + GAP + 8;
  };
  /** To kolonner med knapper. */
  const grid = (list: readonly { id: string; label: string; active: boolean; kind: ItemKind }[]): void => {
    const w = (full - GAP) / 2;
    const rowH = list.length > 10 ? 62 : ROW_H;
    list.forEach((o, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      items.push({ id: o.id, kind: o.kind, label: o.label, active: o.active, x: PAD + col * (w + GAP), y: y + row * (rowH + 10), w, h: rowH });
    });
  };

  switch (s.tab) {
    case 'visning':
      toggle('toggle:ceilings', 'Vis tak', s.ceilings);
      y += ROW_H + GAP;
      toggle('toggle:highlight', 'Marker umålte mål', s.highlight);
      y += ROW_H + GAP;
      toggle('toggle:fps', 'Vis bildefrekvens', s.fps);
      y += ROW_H + GAP;
      choices('Grafikk', [
        { id: 'quality:low', label: 'Rask', active: s.quality === 'low' },
        { id: 'quality:medium', label: 'Standard', active: s.quality === 'medium' },
        { id: 'quality:high', label: 'Høy', active: s.quality === 'high' },
      ]);
      break;
    case 'lag': {
      labels.push({ text: 'Vis', x: PAD, y: y + 34 });
      y += 52;
      const row1 = [...s.presets.map((p) => ({ id: `preset:${p.id}`, label: p.name })), { id: 'tab:lagliste', label: 'Alle lag …' }];
      const pw = (full - (row1.length - 1) * GAP) / row1.length;
      row1.forEach((p, i) =>
        items.push({ id: p.id, kind: 'action', label: p.label, active: false, x: PAD + i * (pw + GAP), y, w: pw, h: ROW_H }),
      );
      y += ROW_H + GAP + 8;
      const t3 = [
        { id: 'toggle:existing', label: 'Eksisterende', on: s.showExisting, kind: 'toggle' as const },
        { id: 'toggle:planned', label: 'Planlagt', on: s.showPlanned, kind: 'toggle' as const },
        { id: 'toggle:xray', label: 'Røntgen', on: s.xray, kind: 'toggle' as const },
        ...(s.circuitFiltered ? [{ id: 'circuit:all', label: 'Alle kurser', on: false, kind: 'action' as const }] : []),
      ];
      const tw = (full - (t3.length - 1) * GAP) / t3.length;
      t3.forEach((t, i) => items.push({ id: t.id, kind: t.kind, label: t.label, active: t.on, x: PAD + i * (tw + GAP), y, w: tw, h: ROW_H }));
      y += ROW_H + GAP + 8;
      labels.push({ text: 'Laggrupper', x: PAD, y: y + 34 });
      y += 52;
      grid(
        s.groups.map((g) => ({
          id: `group:${g.id}`,
          label: g.state === 'mixed' ? `${g.name} (delvis)` : g.name,
          active: g.state !== 'off',
          kind: 'toggle' as const,
        })),
      );
      break;
    }
    case 'lagliste':
      items.push({ id: 'tab:lag', kind: 'action', label: '‹ Tilbake', active: false, x: PAD, y, w: 260, h: 64 });
      y += 64 + GAP;
      grid(s.layers.map((l) => ({ id: `layer:${l.id}`, label: l.name, active: l.visible, kind: 'toggle' as const })));
      break;
    case 'tegn': {
      grid([
        ...DRAW_ITEMS.map((d) => ({ id: d.id, label: d.label, active: s.drawTool === d.id, kind: 'choice' as const })),
        { id: 'draw:status', label: s.drawPlanned ? 'Nytt: planlagt' : 'Nytt: eksisterende', active: s.drawPlanned, kind: 'toggle' as const },
        { id: 'draw:off', label: 'Slutt å tegne', active: false, kind: 'action' as const },
      ]);
      break;
    }
    case 'ga':
      grid([
        { id: 'start', label: 'Til start (døra)', active: false, kind: 'action' as const },
        ...s.rooms.map((r) => ({ id: `room:${r.id}`, label: r.name, active: false, kind: 'action' as const })),
      ]);
      break;
    case 'komfort':
      choices('Snu med høyre stikke', [
        { id: 'turn:15', label: '15°', active: s.turn === 15 },
        { id: 'turn:30', label: '30°', active: s.turn === 30 },
        { id: 'turn:45', label: '45°', active: s.turn === 45 },
        { id: 'turn:smooth', label: 'Myk', active: s.turn === 'smooth' },
      ]);
      choices('Bildefrekvens', [
        { id: 'rate:72', label: '72 Hz', active: s.rate === 72 },
        { id: 'rate:90', label: '90 Hz', active: s.rate === 90 },
        { id: 'rate:120', label: '120 Hz', active: s.rate === 120 },
      ]);
      labels.push({ text: 'Stikke bakover: snu 180°.', x: PAD, y: y + 30 });
      break;
  }
  return { items, labels };
}

/** Knappen under et punkt i lerretet (piksler), om noen. */
export function itemAt(items: readonly MenuItem[], px: number, py: number): MenuItem | null {
  return items.find((i) => px >= i.x && px <= i.x + i.w && py >= i.y && py <= i.y + i.h) ?? null;
}
