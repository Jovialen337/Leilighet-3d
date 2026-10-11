import { describe, expect, it } from 'vitest';
import { shadeOf } from '../../src/scene/lighting';
import { roomEdges, isInnerCorner } from '../../src/scene/roomEdges';
import { buildContactShade, buildRoomShade, SHADE } from '../../src/scene/shade';
import { buildParts, partsFor } from '../../src/scene/buildParts';
import { FpsMeter } from '../../src/ui/FpsMeter';
import { modelOf } from './helpers';

const model = modelOf();

describe('lyssetting', () => {
  it('vegger i ulike retninger får tydelig ulik lysstyrke, uten utbrente gulv eller mørkt tak', () => {
    const walls = [
      shadeOf({ x: 0, y: 0, z: -1 }),
      shadeOf({ x: 0, y: 0, z: 1 }),
      shadeOf({ x: 1, y: 0, z: 0 }),
      shadeOf({ x: -1, y: 0, z: 0 }),
    ];
    const spread = (Math.max(...walls) - Math.min(...walls)) / Math.max(...walls);
    expect(spread).toBeGreaterThan(0.15);
    expect(new Set(walls.map((w) => w.toFixed(2))).size).toBe(4);
    expect(shadeOf({ x: 0, y: 1, z: 0 })).toBeLessThan(1);
    expect(shadeOf({ x: 0, y: -1, z: 0 })).toBeGreaterThan(0.5);
  });
});

describe('fotlister og kanter', () => {
  it('fotlisten går rundt rommet, men ikke gjennom døråpninger', () => {
    const gang = model.rooms.get('gang')!;
    const all = roomEdges(model, gang, false);
    const cut = roomEdges(model, gang, true);
    const length = (es: typeof all) => es.reduce((s, e) => s + Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z), 0);
    const perimeter = 2 * (2300 + 2400);
    expect(length(all)).toBeCloseTo(perimeter, 6);
    // Gangen har inngangsdøra (900), åpningen til stua (1000) og døra til planterommet (900).
    expect(length(cut)).toBeCloseTo(perimeter - 900 - 1000 - 900, 0);
    // Normalen peker inn i rommet.
    for (const e of all) expect(e.inward.x * (1150 - e.a.x) + e.inward.z * (1200 - e.a.z)).toBeGreaterThan(0);
  });

  it('badets innhakk gir et utvendig hjørne', () => {
    const poly = model.rooms.get('bad')!.polygon;
    expect(poly.map((_, i) => isInnerCorner(poly, i))).toEqual([true, true, false, true, true, true]);
  });

  it('fotlister og gerikter er med i modellen', () => {
    const parts = buildParts(model);
    expect(partsFor(parts, 'stue', 'trim')).toHaveLength(1);
    expect(partsFor(parts, 'dor-bad', 'trim')).toHaveLength(1);
    expect(partsFor(parts, 'vindu-stue-1', 'trim')).toHaveLength(1);
  });
});

describe('myke skygger', () => {
  it('skyggene langs vegger og i tak fades ut, og takskyggen er egen', () => {
    const shade = buildRoomShade(model);
    expect([...shade.keys()].sort()).toEqual(['structure', 'structure|tak']);
    const col = shade.get('structure')!.getAttribute('color');
    let max = 0;
    let zeros = 0;
    for (let i = 0; i < col.count; i++) {
      max = Math.max(max, col.getW(i));
      if (col.getW(i) === 0) zeros++;
      expect(col.getX(i)).toBe(0);
    }
    expect(max).toBeCloseTo(SHADE.floor.alpha, 6);
    expect(zeros).toBeGreaterThan(col.count / 3);
  });

  it('møbler på gulvet får kontaktskygge i møbellaget', () => {
    const shade = buildContactShade(model);
    // Skyggen følger møbelets lag (skjules med det).
    expect([...shade.keys()].sort()).toEqual([...new Set(model.data.furniture.map((f) => f.layer))].sort());
    // Høyst (1 + 4) firkanter × 6 hjørner per møbel.
    let total = 0;
    for (const g of shade.values()) total += g.getAttribute('position').count;
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(model.data.furniture.length * 30);
  });
});

describe('bildefrekvens', () => {
  it('teller tapte rammer', () => {
    const m = new FpsMeter();
    let t = 0;
    m.tick(t);
    for (let i = 0; i < 90; i++) m.tick((t += 1000 / 90));
    m.tick((t += 20)); // vindu ferdig
    for (let i = 0; i < 85; i++) m.tick((t += 1000 / 90));
    m.tick((t += 34)); // to tapte rammer i ett hopp
    for (let i = 0; i < 10; i++) m.tick((t += 1000 / 90));
    expect(m.dropped).toBe(1);
    expect(m.label()).toContain('1 tapt');
  });
});
