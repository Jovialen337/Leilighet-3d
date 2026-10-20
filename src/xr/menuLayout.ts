/**
 * Innholdet i VR-menyen som rene data (testbart uten three.js): faner og
 * knapper med plassering i lerretet (piksler). Knappene har en `id` som sier
 * hva de gjør, f.eks. «layer:furniture» eller «room:stue».
 */
import type { Quality, TurnMode, XRRate } from '../state/ViewState';
import type { LightId } from '../scene/lighting';
import { EFFECT_TEXT, type EffectId } from '../scene/graphicsProfile';
import type { LegendGroup, SwatchShape } from '../ui/legend';

export const MENU_W = 1024;
export const MENU_H = 768;

/** Undersider: «lagliste» av «Lag» (hvert enkelt lag), «effekter» av «Visning», «farger» av «Hjelp». */
export type MenuTab = 'visning' | 'effekter' | 'lag' | 'lagliste' | 'tegn' | 'ga' | 'komfort' | 'hjelp' | 'farger';
export const TABS: readonly { id: MenuTab; label: string }[] = [
  { id: 'visning', label: 'Visning' },
  { id: 'lag', label: 'Lag' },
  { id: 'tegn', label: 'Tegn' },
  { id: 'ga', label: 'Gå til' },
  { id: 'komfort', label: 'Komfort' },
  { id: 'hjelp', label: 'Hjelp' },
];
/** Fanen en underside hører til. */
const PARENT: Partial<Record<MenuTab, MenuTab>> = { lagliste: 'lag', effekter: 'visning', farger: 'hjelp' };

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

const QUALITY_ITEMS: readonly { id: Quality; label: string }[] = [
  { id: 'low', label: 'Rask' },
  { id: 'medium', label: 'Standard' },
  { id: 'high', label: 'Høy' },
  { id: 'custom', label: 'Egendefinert' },
];

export interface MenuItem {
  id: string;
  kind: ItemKind;
  label: string;
  /** På (bryter) / valgt (valg, fane). */
  active: boolean;
  /** Opplæringen peker hit (tegnes med en ring). */
  hint?: boolean;
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
  /** Effektene slik de er nå (forhåndsvalget eller «Egendefinert»). */
  effects: readonly { id: EffectId; on: boolean }[];
  light: LightId;
  turn: TurnMode;
  rate: XRRate;
  /** Vis alltid hjelpen på håndleddet. */
  wristHelp: boolean;
  layers: readonly { id: string; name: string; visible: boolean }[];
  rooms: readonly { id: string; name: string }[];
  /** Rommet man står i (markert under «Gå til»), eller null. */
  here?: string | null;
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
  /** «Neste steg» (fanen «Hjelp»). */
  next?: string;
  /** Fargene som er i bruk (undersiden «Farger»). */
  legend?: readonly LegendGroup[];
  /** Opplæringen i VR pågår, og knappene den peker på (fanen først; «room:*» = alle rommene). */
  tutorial?: { active: boolean; targets: readonly string[] };
}

/** Overskrifter i lerretet (tegnes, men kan ikke trykkes på). */
export interface MenuLabel {
  text: string;
  x: number;
  y: number;
  /** Skriftstørrelse (px; standard 32), farge (standard dempet) og vekt (standard 600). */
  size?: number;
  color?: 'text' | 'muted' | 'accent';
  weight?: number;
  /** Bredest (px): teksten krymper og forkortes heller enn å gå utenfor. */
  maxW?: number;
  /** Fargeprøve foran teksten (fargeforklaringen). */
  swatch?: { color: string; shape: SwatchShape };
}

/** Deler tekst i linjer på høyst `max` tegn (ved mellomrom). */
export function wrapText(text: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > max) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
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
      active: s.tab === t.id || PARENT[s.tab] === t.id,
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
        // «Egendefinert» åpner også siden med effektene hver for seg.
        ...QUALITY_ITEMS.map((q) => ({ id: `quality:${q.id}`, label: q.label, active: s.quality === q.id })),
      ]);
      // Plass til beskjeden alltid, så «Lys» ikke flytter seg når den kommer.
      if (s.qualityNote) labels.push({ text: s.qualityNote, x: PAD, y: y + 22 });
      y += 40;
      choices('Lys', [
        { id: 'light:morgen', label: 'Morgen', active: s.light === 'morgen' },
        { id: 'light:dag', label: 'Dag', active: s.light === 'dag' },
        { id: 'light:kveld', label: 'Kveld', active: s.light === 'kveld' },
        { id: 'light:natt', label: 'Natt', active: s.light === 'natt' },
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
        // Kursfilter: hvert trykk viser neste kurs, og til slutt alle igjen.
        ...(s.circuits.length || s.filterCircuit
          ? [{ id: 'circuit:next', label: circuitName(s.filterCircuit) ?? 'Alle kurser', on: s.filterCircuit !== null, kind: 'action' as const }]
          : []),
      ];
      // Fire knapper får ikke plass til tekstene på én rad: da to rader med to.
      const perRow = t3.length > 3 ? 2 : t3.length;
      const tw = (full - (perRow - 1) * GAP) / perRow;
      t3.forEach((t, i) =>
        items.push({ id: t.id, kind: t.kind, label: t.label, active: t.on, x: PAD + (i % perRow) * (tw + GAP), y: y + Math.floor(i / perRow) * (ROW_H + GAP), w: tw, h: ROW_H }),
      );
      y += Math.ceil(t3.length / perRow) * (ROW_H + GAP) + 8;
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
    case 'effekter':
      items.push({ id: 'tab:visning', kind: 'action', label: '‹ Tilbake', active: false, x: PAD, y, w: 260, h: 64 });
      y += 64 + GAP;
      labels.push({
        text:
          s.quality === 'custom'
            ? 'Egendefinert: velg hver effekt selv.'
            : `Nå: ${QUALITY_ITEMS.find((q) => q.id === s.quality)?.label ?? ''}. Et valg her gjør det til «Egendefinert».`,
        x: PAD,
        y: y + 30,
      });
      y += 52;
      grid(s.effects.map((e) => ({ id: `effect:${e.id}`, label: EFFECT_TEXT[e.id], active: e.on, kind: 'toggle' as const })));
      if (s.qualityNote) labels.push({ text: s.qualityNote, x: PAD, y: y + 30 });
      break;
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
        ...s.rooms.map((r) => ({ id: `room:${r.id}`, label: r.name, active: r.id === s.here, kind: 'choice' as const })),
      ]);
      break;
    case 'hjelp': {
      labels.push({ text: 'NESTE STEG', x: PAD, y: y + 18, size: 24, color: 'accent', weight: 700 });
      y += 44;
      for (const line of wrapText(s.next ?? 'Se deg rundt i leiligheten.', 52).slice(0, 3)) {
        labels.push({ text: line, x: PAD, y: y + 18, size: 32, color: 'text', weight: 500, maxW: full });
        y += 42;
      }
      y += 16;
      const t = s.tutorial;
      const row = [
        { id: 'tab:farger', label: 'Hva fargene betyr …' },
        ...(t?.active ? [{ id: 'tutorial:next', label: 'Hopp over steget' }] : [{ id: 'tutorial:start', label: 'Opplæring' }]),
      ];
      const rw = (full - (row.length - 1) * GAP) / row.length;
      row.forEach((r, i) => items.push({ id: r.id, kind: 'action', label: r.label, active: false, x: PAD + i * (rw + GAP), y, w: rw, h: ROW_H }));
      y += ROW_H + GAP;
      if (t?.active) {
        items.push({ id: 'tutorial:stop', kind: 'action', label: 'Avslutt opplæringen', active: false, x: PAD, y, w: full, h: 56 });
        y += 56 + GAP;
      }
      labels.push({ text: 'KONTROLLER', x: PAD, y: y + 22, size: 24, color: 'accent', weight: 700 });
      y += 48;
      for (const line of [
        'Venstre stikke: teleport · Høyre: snu',
        'X: meny · Y: bildefrekvens',
        'Høyre avtrekker: trykk i menyen',
        'Når du tegner: A ferdig · B angre',
      ]) {
        labels.push({ text: line, x: PAD, y: y + 16, size: 28, color: 'text', weight: 500, maxW: full });
        y += 38;
      }
      break;
    }
    case 'farger': {
      items.push({ id: 'tab:hjelp', kind: 'action', label: '‹ Tilbake', active: false, x: PAD, y, w: 260, h: 64 });
      labels.push({ text: 'Stiplet eller bare omriss = planlagt', x: PAD + 260 + 28, y: y + 32, size: 26, maxW: full - 288 });
      y += 64 + GAP + 8;
      legendColumns(s.legend ?? [], y, labels);
      break;
    }
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
      toggle('toggle:wristhelp', 'Vis alltid hjelp på håndleddet', s.wristHelp);
      y += ROW_H + GAP;
      labels.push({ text: 'Stikke bakover: snu 180°.', x: PAD, y: y + 30 });
      break;
  }
  markHints(items, s.tutorial);
  return { items, labels };
}

/** Fargeforklaringen i to spalter (gruppene flyter fra venstre til høyre spalte). */
function legendColumns(groups: readonly LegendGroup[], top: number, labels: MenuLabel[]): void {
  const colW = (MENU_W - 2 * PAD - GAP * 2) / 2;
  const bottom = MENU_H - PAD;
  const HEAD = 40;
  const ROW = 36;
  if (!groups.length) {
    labels.push({ text: 'Ingen farger å forklare her nå.', x: PAD, y: top + 24, size: 28, color: 'text' });
    return;
  }
  let col = 0;
  let y = top;
  let hidden = 0;
  for (const g of groups) {
    const height = HEAD + g.entries.length * ROW;
    if (y + height > bottom && y > top) {
      col++;
      y = top;
    }
    if (col > 1 || y + height > bottom) {
      hidden++;
      continue;
    }
    const x = PAD + col * (colW + GAP * 2);
    labels.push({ text: g.title.toUpperCase(), x, y: y + 18, size: 22, color: 'accent', weight: 700, maxW: colW });
    y += HEAD;
    for (const e of g.entries) {
      labels.push({ text: e.label, x: x + 52, y: y + 16, size: 24, color: 'text', weight: 500, maxW: colW - 56, swatch: { color: e.color, shape: e.shape } });
      y += ROW;
    }
    y += 8;
  }
  if (hidden) labels.push({ text: 'Flere farger: «Farger» på laptopen.', x: PAD, y: bottom - 6, size: 22 });
}

/** Ringer rundt det opplæringen peker på: første mål som ikke allerede er valgt. */
function markHints(items: MenuItem[], t: MenuState['tutorial']): void {
  if (!t?.active) return;
  for (const target of t.targets) {
    const match = (i: MenuItem): boolean => (target.endsWith(':*') ? i.id.startsWith(target.slice(0, -1)) : i.id === target);
    const hits = items.filter(match);
    if (!hits.length || hits.every((i) => i.kind === 'tab' && i.active)) continue;
    for (const i of hits) i.hint = true;
    return;
  }
}

/** Knappen under et punkt i lerretet (piksler), om noen. */
export function itemAt(items: readonly MenuItem[], px: number, py: number): MenuItem | null {
  return items.find((i) => px >= i.x && px <= i.x + i.w && py >= i.y && py <= i.y + i.h) ?? null;
}
