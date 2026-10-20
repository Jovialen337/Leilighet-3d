import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { KV } from '../../src/state/persist';
import { PC_STEPS, VR_STEPS, stepsFor } from '../../src/tutorial/steps';
import { Tutorial, TUTORIAL_KEY } from '../../src/tutorial/Tutorial';
import { buildMenu, MENU_H, MENU_W, TABS, wrapText, type MenuState, type MenuTab } from '../../src/xr/menuLayout';
import { legendFor } from '../../src/ui/legend';

class MemoryKV implements KV {
  readonly data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
}

const uiSource = readdirSync(resolve(__dirname, '../../src/ui'))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => readFileSync(resolve(__dirname, '../../src/ui', f), 'utf8'))
  .join('\n');

describe('opplæringen: stegene', () => {
  it('hvert steg har tittel og tekst, og alle venter på noe unntatt det siste på PC-en', () => {
    for (const steps of [PC_STEPS, VR_STEPS]) {
      expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
      for (const s of steps) {
        expect(s.title.length).toBeGreaterThan(2);
        expect(s.text.length).toBeGreaterThan(10);
      }
    }
    expect(PC_STEPS.slice(0, -1).every((s) => s.until !== null)).toBe(true);
    expect(PC_STEPS.at(-1)!.until).toBeNull();
  });

  it('det PC-stegene peker på finnes på siden', () => {
    // Som data-testid direkte, eller som testid-argumentet til en bundet kontroll.
    for (const s of PC_STEPS)
      if (s.target) expect(uiSource.includes(`'data-testid': '${s.target}'`) || uiSource.includes(`, '${s.target}')`), s.target).toBe(true);
  });

  it('VR-stegene har korte linjer til håndleddet, og pekerne finnes i VR-menyen', () => {
    for (const s of VR_STEPS) {
      expect(s.wrist?.length).toBeGreaterThan(0);
      for (const line of s.wrist!) expect(line.length, line).toBeLessThanOrEqual(34);
    }
    const tabIds = TABS.map((t) => `tab:${t.id}`);
    expect(tabIds).toContain('tab:ga');
    expect(tabIds).toContain('tab:hjelp');
  });
});

describe('opplæringen: framdrift', () => {
  afterEach(() => vi.useRealTimers());

  it('et steg fullføres bare av hendelsen det venter på', () => {
    const t = new Tutorial(new MemoryKV(), 0);
    expect(t.active).toBe(false);
    t.start('pc');
    expect(t.step?.id).toBe('se');
    t.event('room');
    expect(t.step?.id).toBe('se');
    t.event('look');
    expect(t.step?.id).toBe('rom');
    expect(t.position).toEqual({ index: 1, count: PC_STEPS.length });
  });

  it('fullført spor huskes; avbrutt gjør ikke', () => {
    const kv = new MemoryKV();
    const t = new Tutorial(kv, 0);
    t.start('vr');
    t.event('teleport');
    t.stop();
    expect(t.active).toBe(false);
    expect(t.completed('vr')).toBe(false);
    t.start('pc');
    for (const s of stepsFor('pc')) {
      if (s.until) t.event(s.until);
      else t.next();
    }
    expect(t.active).toBe(false);
    expect(t.completed('pc')).toBe(true);
    expect(JSON.parse(kv.data.get(TUTORIAL_KEY)!)).toEqual({ pc: true });
    // Ny økt (omlasting): fortsatt fullført.
    expect(new Tutorial(kv).completed('pc')).toBe(true);
  });

  it('✓ vises et øyeblikk før neste steg; «Hopp over» går videre straks', () => {
    vi.useFakeTimers();
    const t = new Tutorial(null, 700);
    t.start('vr');
    t.event('teleport');
    expect(t.state.value).toEqual({ track: 'vr', index: 0, done: true });
    // Samme hendelse igjen mens ✓ vises teller ikke dobbelt.
    t.event('teleport');
    vi.advanceTimersByTime(700);
    expect(t.state.value).toEqual({ track: 'vr', index: 1, done: false });
    t.next();
    expect(t.step?.id).toBe('meny');
    // Avbrutt mens ✓ vises: ingen forsinket hopp etterpå.
    t.event('menu');
    t.stop();
    vi.advanceTimersByTime(1000);
    expect(t.state.value).toBeNull();
  });
});

const base = (tab: MenuTab, extra: Partial<MenuState> = {}): MenuState => ({
  tab,
  ceilings: true,
  highlight: false,
  fps: false,
  quality: 'medium',
  effects: [],
  light: 'dag',
  turn: 30,
  rate: 90,
  wristHelp: false,
  layers: [],
  rooms: Array.from({ length: 8 }, (_, i) => ({ id: `rom-${i}`, name: `Rom ${i + 1}` })),
  showExisting: true,
  showPlanned: true,
  xray: false,
  groups: [],
  presets: [],
  drawTool: null,
  drawPlanned: true,
  circuits: [],
  drawCircuit: null,
  filterCircuit: null,
  qualityNote: null,
  ...extra,
});

describe('VR-menyen: «Hjelp» og «Farger»', () => {
  it('«Hjelp» viser neste steg (brutt i linjer), kontrollene og knapper til fargene og opplæringen', () => {
    const next = '80 av 81 deler er plassholdere (oransje). Mål opp leiligheten med Quest 3.';
    const { items, labels } = buildMenu(base('hjelp', { next }));
    const text = labels.map((l) => l.text);
    expect(text.join(' ')).toContain('80 av 81 deler er plassholdere');
    expect(text).toContain('Venstre stikke: teleport · Høyre: snu');
    expect(items.map((i) => i.id)).toEqual(expect.arrayContaining(['tab:farger', 'tutorial:start']));
    expect(items.find((i) => i.id === 'tab:hjelp')?.active).toBe(true);
    // Under opplæringen: hopp over og avslutt i stedet for start.
    const on = buildMenu(base('hjelp', { next, tutorial: { active: true, targets: [] } })).items.map((i) => i.id);
    expect(on).toEqual(expect.arrayContaining(['tutorial:next', 'tutorial:stop']));
    expect(on).not.toContain('tutorial:start');
  });

  it('«Farger» tegner en fargeprøve per farge, i to spalter innenfor lerretet', () => {
    const legend = legendFor({
      highlight: true,
      el: true,
      water: true,
      circuits: [
        { name: 'Kurs 1', color: '#d35400' },
        { name: 'Kurs 2', color: '#9b7be0' },
      ],
      mode: 'vr',
    });
    const { items, labels } = buildMenu(base('farger', { legend }));
    const swatches = labels.filter((l) => l.swatch);
    expect(swatches.length).toBe(legend.reduce((n, g) => n + g.entries.length, 0));
    expect(new Set(swatches.map((l) => l.x)).size).toBe(2);
    for (const l of labels) {
      expect(l.y).toBeLessThanOrEqual(MENU_H - 16);
      expect(l.x + (l.maxW ?? 0)).toBeLessThanOrEqual(MENU_W);
    }
    // «Hjelp»-fanen er valgt (undersiden), og «‹ Tilbake» går dit.
    expect(items.filter((i) => i.id === 'tab:hjelp').map((i) => i.kind)).toEqual(['tab', 'action']);
    expect(items.find((i) => i.kind === 'tab' && i.id === 'tab:hjelp')?.active).toBe(true);
  });

  it('alle fargene på en gang: det som ikke får plass, henvises til laptopen', () => {
    const legend = legendFor({ all: true, highlight: false, el: false, water: false, circuits: [], mode: 'laptop' });
    const { labels } = buildMenu(base('farger', { legend }));
    for (const l of labels) expect(l.y).toBeLessThanOrEqual(MENU_H - 16);
    expect(labels.some((l) => l.text.includes('laptopen'))).toBe(true);
  });

  it('opplæringen peker på fanen først, så på knappen', () => {
    const tutorial = { active: true, targets: ['tab:ga', 'room:*'] };
    const hinted = (tab: MenuTab): string[] => buildMenu(base(tab, { tutorial })).items.filter((i) => i.hint).map((i) => i.id);
    expect(hinted('visning')).toEqual(['tab:ga']);
    expect(hinted('ga')).toEqual(Array.from({ length: 8 }, (_, i) => `room:rom-${i}`));
    const colours = { active: true, targets: ['tab:hjelp', 'tab:farger'] };
    expect(buildMenu(base('visning', { tutorial: colours })).items.filter((i) => i.hint).map((i) => i.id)).toEqual(['tab:hjelp']);
    expect(buildMenu(base('hjelp', { tutorial: colours })).items.filter((i) => i.hint).map((i) => i.id)).toEqual(['tab:farger']);
    // Ingen opplæring: ingen ringer.
    expect(buildMenu(base('visning')).items.some((i) => i.hint)).toBe(false);
  });

  it('seks faner får plass, og lange tekster brytes ved mellomrom', () => {
    const tabs = buildMenu(base('visning')).items.filter((i) => i.kind === 'tab');
    expect(tabs.length).toBe(6);
    expect(tabs.at(-1)!.x + tabs.at(-1)!.w).toBeLessThanOrEqual(MENU_W);
    expect(wrapText('en to tre fire fem', 7)).toEqual(['en to', 'tre', 'fire', 'fem']);
    expect(wrapText('', 10)).toEqual([]);
  });
});
