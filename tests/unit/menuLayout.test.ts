import { describe, expect, it } from 'vitest';
import { buildMenu, MENU_H, MENU_W, type MenuState, type MenuTab } from '../../src/xr/menuLayout';

const state = (tab: MenuTab, layerCount: number, filterCircuit: string | null = null): MenuState => ({
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
  layers: Array.from({ length: layerCount }, (_, i) => ({ id: `lag-${i}`, name: `Lag ${i + 1}`, visible: true })),
  rooms: Array.from({ length: 8 }, (_, i) => ({ id: `rom-${i}`, name: `Rom ${i + 1}` })),
  showExisting: true,
  showPlanned: true,
  xray: false,
  groups: Array.from({ length: 6 }, (_, i) => ({ id: `g-${i}`, name: `Gruppe ${i + 1}`, state: 'on' as const })),
  presets: [
    { id: 'alt', name: 'Alt' },
    { id: 'el', name: 'El' },
    { id: 'vann', name: 'Vann' },
  ],
  drawTool: null,
  drawPlanned: true,
  circuits: [
    { id: 'kurs-1', name: 'Kurs 1 – gang og stue' },
    { id: 'kurs-2', name: 'Kurs 2 – planterom' },
  ],
  drawCircuit: null,
  filterCircuit,
  qualityNote: null,
});

describe('VR-menyen', () => {
  it.each([13, 15, 20, 24])('alle %i lag får plass på lerretet', (n) => {
    const { items } = buildMenu(state('lagliste', n));
    expect(items.filter((i) => i.id.startsWith('layer:')).length).toBe(n);
    for (const it of items) {
      expect(it.x + it.w).toBeLessThanOrEqual(MENU_W);
      expect(it.y + it.h).toBeLessThanOrEqual(MENU_H);
      expect(it.h).toBeGreaterThanOrEqual(28);
    }
  });

  it('kursvalg i «Lag» (filter) og «Tegn» (nye kabler), og alle sider får plass', () => {
    const lag = (f: string | null) => buildMenu(state('lag', 13, f)).items.find((i) => i.id === 'circuit:next');
    expect(lag(null)).toMatchObject({ label: 'Alle kurser', active: false });
    expect(lag('kurs-2')).toMatchObject({ label: 'Kurs 2 – planterom', active: true });
    const tegn = buildMenu({ ...state('tegn', 13), drawCircuit: 'kurs-1' }).items.find((i) => i.id === 'drawcircuit:next');
    expect(tegn).toMatchObject({ label: 'Kurs for nye: Kurs 1 – gang og stue', active: true });
    expect(buildMenu({ ...state('tegn', 13), circuits: [] }).items.some((i) => i.id === 'drawcircuit:next')).toBe(false);
    for (const tab of ['visning', 'effekter', 'lag', 'lagliste', 'tegn', 'ga', 'komfort'] as const)
      for (const it of buildMenu({ ...state(tab, 13, 'kurs-1'), qualityNote: 'x' }).items) {
        expect(it.y + it.h).toBeLessThanOrEqual(MENU_H);
        expect(it.x + it.w).toBeLessThanOrEqual(MENU_W);
      }
  });

  it('«Egendefinert» i Grafikk-raden, og en underside med hver effekt for seg', () => {
    const effects = (['baked', 'sun', 'shafts', 'lamps', 'sky', 'detail', 'sharp'] as const).map((id) => ({ id, on: id !== 'shafts' && id !== 'sharp' }));
    const row = buildMenu({ ...state('visning', 13), effects }).items.filter((i) => i.id.startsWith('quality:'));
    expect(row.map((i) => [i.label, i.active])).toEqual([
      ['Rask', false],
      ['Standard', true],
      ['Høy', false],
      ['Egendefinert', false],
    ]);
    const page = buildMenu({ ...state('effekter', 13), effects, quality: 'custom', qualityNote: 'Oppløsningen endres neste gang i VR.' });
    expect(page.items.filter((i) => i.id.startsWith('effect:')).map((i) => [i.label, i.active])).toEqual([
      ['Dagslys og skygger', true],
      ['Solflekker', true],
      ['Lysstråler', false],
      ['Lampelys (kveld og natt)', true],
      ['Himmel og utsikt', true],
      ['Gulvmønster', true],
      ['Skarpere bilde', false],
    ]);
    expect(page.labels.map((l) => l.text)).toEqual(['Egendefinert: velg hver effekt selv.', 'Oppløsningen endres neste gang i VR.']);
    // Fanen «Visning» er markert på undersiden, og alt får plass.
    expect(page.items.find((i) => i.id === 'tab:visning' && i.kind === 'tab')?.active).toBe(true);
    expect(page.items.some((i) => i.id === 'tab:visning' && i.kind === 'action')).toBe(true);
    for (const it of page.items) expect(it.y + it.h).toBeLessThanOrEqual(MENU_H);
    expect(Math.max(...page.labels.map((l) => l.y))).toBeLessThanOrEqual(MENU_H - 20);
    expect(buildMenu({ ...state('effekter', 13), effects }).labels[0]?.text).toBe('Nå: Standard. Et valg her gjør det til «Egendefinert».');
  });

  it('beskjed om skarphet vises under grafikkvalget', () => {
    expect(buildMenu({ ...state('visning', 13), qualityNote: 'Skarpere nå – full oppløsning neste gang i VR.' }).labels.map((l) => l.text)).toContain(
      'Skarpere nå – full oppløsning neste gang i VR.',
    );
  });
});
