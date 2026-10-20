import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CIRCUIT_COLORS, COLOR, contrast, cssVars, deltaE } from '../../src/ui/tokens';
import { buildParts } from '../../src/scene/buildParts';
import { validateApartment } from '../../src/schema/validate';
import { loadDoc, modelOf } from './helpers';

const css = readFileSync(resolve(__dirname, '../../src/ui/style.css'), 'utf8');

describe('designet («Skifer»)', () => {
  it('tekst er lett å lese: minst 4,5:1 mot flatene, og mørk tekst på aksentfargen', () => {
    for (const bg of [COLOR.bg, COLOR.surface, COLOR.surface2]) {
      expect(contrast(COLOR.text, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(COLOR.text2, bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(COLOR.text3, COLOR.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(COLOR.onAccent, COLOR.accent)).toBeGreaterThanOrEqual(4.5);
    for (const c of [COLOR.success, COLOR.warning, COLOR.danger, COLOR.accent]) expect(contrast(c, COLOR.surface)).toBeGreaterThanOrEqual(4.5);
    // Aksent på den lyse 2D-planen.
    expect(contrast(COLOR.accentInk, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    // Bryteren (ikke tekst): minst 3:1.
    expect(contrast(COLOR.accent, COLOR.surface)).toBeGreaterThanOrEqual(3);
  });

  it('stilarket bruker bare variabler som finnes, og nesten ingen faste farger', () => {
    const vars = cssVars();
    // Egne navn i stilarket, og --c: fargen til en fargeprøve (settes på elementet).
    const local = new Set(['--panel-bg', '--panel-fg', '--muted', '--accent-fg', '--warn', '--c']);
    for (const m of css.matchAll(/var\((--[a-z0-9-]+)/g)) expect(local.has(m[1]!) || m[1]! in vars, m[1]).toBe(true);
    // Faste farger bare der de betyr noe eget (lapp-gul, skissemerke, tegnet rom i byggeren).
    const hex = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());
    expect(new Set(hex)).toEqual(new Set(['#ffd84d', '#3b3200', '#17a362', '#7d8a93', '#ff4d6d', '#fff']));
  });

  it('kursfargene til nye kurser ligner ikke varmt- eller kaldtvann', () => {
    for (const c of CIRCUIT_COLORS) {
      expect(deltaE(c, COLOR.hot), c).toBeGreaterThan(25);
      expect(deltaE(c, COLOR.cold), c).toBeGreaterThan(25);
    }
    // Vannfargene er tydelig forskjellige fra hverandre og fra el.
    expect(deltaE(COLOR.hot, COLOR.cold)).toBeGreaterThan(50);
    expect(deltaE(COLOR.elPlanned, COLOR.hot)).toBeGreaterThan(25);
  });

  it('en kursfarge som ligner vann gir en advarsel (fila endres ikke)', () => {
    const doc = loadDoc();
    doc.circuits![1]!.color = '#e0532f';
    const r = validateApartment(doc);
    expect(r.warnings.map((w) => w.message)).toContainEqual(expect.stringMatching(/Kursfargen ligner varmtvann/));
    expect(validateApartment(loadDoc()).warnings).toEqual([]);
  });
});

describe('planlagt el og vann: samme farge, stiplet form', () => {
  it('planlagte kabler og rør er stiplet; eksisterende er hele', () => {
    const doc = loadDoc();
    const pipe = doc.pipes![0]!;
    doc.pipes!.push({ ...pipe, id: 'ror-planlagt', status: 'planned' });
    const parts = buildParts(modelOf(doc));
    const tris = (id: string): number => parts.find((p) => p.id === id)!.geometry.getAttribute('position').count / 3;
    const existing = parts.find((p) => p.id === pipe.id)!;
    const planned = parts.find((p) => p.id === 'ror-planlagt')!;
    // Samme farge (rørtypen), men mange korte biter i stedet for én per strekk.
    expect(planned.color.getHexString()).toBe(existing.color.getHexString());
    expect(tris('ror-planlagt')).toBeGreaterThan(tris(pipe.id) * 2);
  });

  it('planlagte punkter er bare omrisset, i kursens farge (el) eller kaldtvann (vann)', () => {
    const doc = loadDoc();
    const outlet = doc.fixtures.find((f) => f.type === 'outlet')!;
    doc.fixtures.push({ ...outlet, id: 'stikk-planlagt', status: 'planned', circuit: 'kurs-2' });
    doc.fixtures.push({ ...outlet, id: 'kran-planlagt', type: 'tap', status: 'planned', circuit: undefined } as never);
    const parts = buildParts(modelOf(doc));
    const p = parts.find((x) => x.id === 'stikk-planlagt')!;
    // 12 kanter × 12 trekanter (ingen fylt boks: den har 12).
    expect(p.geometry.getAttribute('position').count / 3).toBe(144);
    expect(`#${p.color.getHexString()}`).toBe(doc.circuits!.find((k) => k.id === 'kurs-2')!.color!.toLowerCase());
    const tap = parts.find((x) => x.id === 'kran-planlagt')!;
    expect(`#${tap.color.getHexString()}`).not.toBe(`#${p.color.getHexString()}`);
  });
});
