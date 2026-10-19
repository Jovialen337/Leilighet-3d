import { describe, expect, it } from 'vitest';
import { buildMenu, MENU_H, MENU_W, type MenuState, type MenuTab } from '../../src/xr/menuLayout';

const state = (tab: MenuTab, layerCount: number, filterCircuit: string | null = null): MenuState => ({
  tab,
  ceilings: true,
  highlight: false,
  fps: false,
  quality: 'medium',
  light: 'dag',
  turn: 30,
  rate: 90,
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
    for (const tab of ['visning', 'lag', 'lagliste', 'tegn', 'ga', 'komfort'] as const)
      for (const it of buildMenu({ ...state(tab, 13, 'kurs-1'), qualityNote: 'x' }).items) {
        expect(it.y + it.h).toBeLessThanOrEqual(MENU_H);
        expect(it.x + it.w).toBeLessThanOrEqual(MENU_W);
      }
  });

  it('beskjed om skarphet vises under grafikkvalget', () => {
    expect(buildMenu({ ...state('visning', 13), qualityNote: 'Skarpheten endres neste gang du går inn i VR.' }).labels.map((l) => l.text)).toContain(
      'Skarpheten endres neste gang du går inn i VR.',
    );
  });
});
