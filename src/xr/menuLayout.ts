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
  /** Kursene i fila (for kursvalg i «Tegn» og kursfilter i «Lag»). */
  circuits: readonly { id: string; name: string }[];
  /** Kursen nye kabler og el-punkter får, eller null. */
  drawCircuit: string | null;
  /** Kursfilteret (bare denne kursen vises), eller null = alle. */
  filterCircuit: string | null;
  /** Beskjed under grafikkvalget (f.eks. at «Høy» gjelder fra neste VR-økt), eller null. */
  qualityNote: string | null;
  /** Tegning av el og vann er av (f.eks. mens man går gjennom en ny modell). */
  drawBlocked?: boolean;
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
    // Lavere knapper når listen er lang, så den alltid får plass på lerretet.
    const rows = Math.ceil(list.length / 2);
    const fit = rows ? Math.floor((MENU_H - PAD - y) / rows) - 10 : ROW_H;
    const rowH = Math.max(28, Math.min(list.length > 10 ? 62 : ROW_H, fit));
    list.forEach((o, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      items.push({ id: o.id, kind: o.kind, label: o.label, active: o.active, x: PAD + col * (w + GAP), y: y + row * (rowH + 10), w, h: rowH });
    });
    y += rows * (rowH + 10);
  };
  const circuitName = (id: string | null): string | null => (id ? (s.circuits.find((c) => c.id === id)?.name ?? id) : null);

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
      if (s.qualityNote) labels.push({ text: s.qualityNote, x: PAD, y: y + 30 });
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
        // Kursfilter: hvert trykk viser neste kurs, og til slutt alle igjen.
        ...(s.circuits.length || s.filterCircuit
          ? [{ id: 'circuit:next', label: circuitName(s.filterCircuit) ?? 'Alle kurser', on: s.filterCircuit !== null, kind: 'action' as const }]
          : []),
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
      if (s.drawBlocked) {
        labels.push({ text: 'Tegning av el og vann er av mens du går', x: PAD, y: y + 30 });
        labels.push({ text: 'gjennom en ny modell («Lag ny modell»).', x: PAD, y: y + 76 });
        break;
      }
      grid([
        ...DRAW_ITEMS.map((d) => ({ id: d.id, label: d.label, active: s.drawTool === d.id, kind: 'choice' as const })),
        { id: 'draw:status', label: s.drawPlanned ? 'Nytt: planlagt' : 'Nytt: eksisterende', active: s.drawPlanned, kind: 'toggle' as const },
        { id: 'draw:off', label: 'Slutt å tegne', active: false, kind: 'action' as const },
      ]);
      if (s.circuits.length) {
        // Hvert trykk velger neste kurs for nye kabler og el-punkter (og til slutt ingen).
        y += 4;
        items.push({ id: 'drawcircuit:next', kind: 'action', label: `Kurs for nye: ${circuitName(s.drawCircuit) ?? 'ingen'}`, active: s.drawCircuit !== null, x: PAD, y, w: full, h: 62 });
      }
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
