import { describe, expect, it } from 'vitest';
import { formatArea, formatLength, parseLength } from '../../src/builder/units';
import { buildBuildMenu } from '../../src/xr/buildMenu';
import { MENU_H, MENU_W } from '../../src/xr/menuLayout';
import { ROOM_NAMES } from '../../src/builder/types';

describe('mål som skrives inn', () => {
  it('forstår meter, centimeter og millimeter på norsk', () => {
    expect(parseLength('2,3 m')).toEqual({ mm: 2300, relative: false });
    expect(parseLength('230 cm')).toEqual({ mm: 2300, relative: false });
    expect(parseLength('2300')).toEqual({ mm: 2300, relative: false });
    expect(parseLength('2.3')).toEqual({ mm: 2300, relative: false });
    expect(parseLength('0,9')).toEqual({ mm: 900, relative: false });
    expect(parseLength(',5')).toEqual({ mm: 500, relative: false });
    expect(parseLength('12 dm')).toEqual({ mm: 1200, relative: false });
  });

  it('et helt tall fra 1 til 9 er meter (ingen vegg er 3 mm)', () => {
    expect(parseLength('3')).toEqual({ mm: 3000, relative: false });
    expect(parseLength('9')).toEqual({ mm: 9000, relative: false });
    expect(parseLength('0')).toEqual({ mm: 0, relative: false });
    expect(parseLength('10')).toEqual({ mm: 10, relative: false });
    expect(parseLength('3 mm')).toEqual({ mm: 3, relative: false });
  });

  it('fortegn betyr «legg til» (og små tall med fortegn er mm)', () => {
    expect(parseLength('+150')).toEqual({ mm: 150, relative: true });
    expect(parseLength('-5')).toEqual({ mm: -5, relative: true });
    expect(parseLength('−2 cm')).toEqual({ mm: -20, relative: true });
  });

  it('i felt for koordinater og nivåer er minus en del av tallet; -= trekker fra, + legger til', () => {
    expect(parseLength('-1100', true)).toEqual({ mm: -1100, relative: false });
    expect(parseLength('−1,1 m', true)).toEqual({ mm: -1100, relative: false });
    expect(parseLength('+150', true)).toEqual({ mm: 150, relative: true });
    expect(parseLength('2400', true)).toEqual({ mm: 2400, relative: false });
    expect(parseLength('+=150', true)).toEqual({ mm: 150, relative: true });
    expect(parseLength('-=2 cm', true)).toEqual({ mm: -20, relative: true });
    // += virker også i vanlige felt.
    expect(parseLength('+=150')).toEqual({ mm: 150, relative: true });
  });

  it('avviser det som ikke er et mål', () => {
    for (const t of ['', 'abc', '2,3,4', '3 km', '1e3', 'm', '=5', '+-5', '==5']) expect(parseLength(t)).toBeNull();
  });

  it('viser mål og areal på norsk', () => {
    expect(formatLength(3200)).toBe('3,20 m');
    expect(formatLength(850)).toBe('850 mm');
    expect(formatArea(12_400_000)).toBe('12,4 m²');
  });
});

describe('menyen for oppmåling av ny modell (VR)', () => {
  const state = {
    room: { id: 'gang', name: 'Gang' },
    inRoom: { id: 'stue', name: 'Stue' },
    names: ROOM_NAMES,
    method: 'touch' as const,
    canRealign: true,
    busy: true,
  };

  it('alle knappene får plass på lerretet og overlapper ikke', () => {
    const { items } = buildBuildMenu(state);
    for (const i of items) {
      expect(i.x).toBeGreaterThanOrEqual(0);
      expect(i.y).toBeGreaterThanOrEqual(0);
      expect(i.x + i.w).toBeLessThanOrEqual(MENU_W);
      expect(i.y + i.h).toBeLessThanOrEqual(MENU_H);
    }
    for (let a = 0; a < items.length; a++)
      for (let b = a + 1; b < items.length; b++) {
        const p = items[a]!;
        const q = items[b]!;
        const overlap = p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
        expect(overlap, `${p.id} / ${q.id}`).toBe(false);
      }
  });

  it('har det man trenger: nytt rom, mål på nytt, dør/vindu/åpning, navn og avslutt', () => {
    const ids = buildBuildMenu(state).items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['b:new-room', 'b:remeasure', 'b:cancel', 'b:door', 'b:window', 'b:passage', 'b:name:Stue', 'b:method', 'b:realign', 'b:exit']));
    expect(buildBuildMenu(state).items.find((i) => i.id === 'b:name:Gang')?.active).toBe(true);
    // Uten rom å gi navn, rom å måle på nytt eller noe å avbryte: knappene er borte.
    const bare = buildBuildMenu({ ...state, room: null, inRoom: null, busy: false, canRealign: false }).items.map((i) => i.id);
    expect(bare.some((id) => id.startsWith('b:name:'))).toBe(false);
    expect(bare).not.toContain('b:remeasure');
    expect(bare).not.toContain('b:cancel');
    expect(bare).not.toContain('b:realign');
  });
});
