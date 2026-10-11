import { describe, expect, it } from 'vitest';
import { buildMenu, MENU_H, MENU_W, type MenuState, type MenuTab } from '../../src/xr/menuLayout';

const state = (tab: MenuTab, layerCount: number, circuitFiltered = false): MenuState => ({
  tab,
  ceilings: true,
  highlight: false,
  fps: false,
  quality: 'medium',
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
  circuitFiltered,
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

  it('«Alle kurser» vises bare når et kursfilter er på, og alle sider får plass', () => {
    expect(buildMenu(state('lag', 13)).items.some((i) => i.id === 'circuit:all')).toBe(false);
    expect(buildMenu(state('lag', 13, true)).items.some((i) => i.id === 'circuit:all')).toBe(true);
    for (const tab of ['visning', 'lag', 'lagliste', 'tegn', 'ga', 'komfort'] as const)
      for (const it of buildMenu(state(tab, 13, true)).items) expect(it.y + it.h).toBeLessThanOrEqual(MENU_H);
  });
});
