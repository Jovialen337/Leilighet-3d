import { describe, expect, it } from 'vitest';
import { applyMeasurements } from '../../src/measure/applyMeasurements';
import { AlongMap, applyRigid, fitLine, fitRigid } from '../../src/measure/fit';
import type { Observation } from '../../src/measure/types';
import { numValue } from '../../src/schema/normalize';
import type { ApartmentDoc, MeasuredValue, Num } from '../../src/schema/types';
import { validateApartment } from '../../src/schema/validate';
import { loadDoc, modelOf } from './helpers';

const base = loadDoc();
const model = modelOf(base);
const nv = (n: Num): number => numValue(n);
const isMeasured = (n: Num): boolean => typeof n === 'object' && (n as MeasuredValue).measured === true;

/** Hjørnemålinger for et rom, flyttet med (dx, dz) og eventuelt rotert om origo. */
function roomCorners(roomId: string, dx = 0, dz = 0, angleDeg = 0): Observation[] {
  const a = (angleDeg * Math.PI) / 180;
  return model.rooms.get(roomId)!.polygon.map((p, index) => ({
    kind: 'room-corner',
    roomId,
    index,
    x: p.x * Math.cos(a) - p.z * Math.sin(a) + dx,
    z: p.x * Math.sin(a) + p.z * Math.cos(a) + dz,
  }));
}

function solve(obs: Observation[]): ApartmentDoc {
  const out = applyMeasurements(base, obs);
  const r = validateApartment(out);
  expect(r.errors.map((e) => e.message)).toEqual([]);
  return out;
}

const wall = (doc: ApartmentDoc, id: string) => doc.walls.find((w) => w.id === id)!;
const room = (doc: ApartmentDoc, id: string) => doc.rooms.find((r) => r.id === id)!;
const opening = (doc: ApartmentDoc, id: string) => doc.openings.find((o) => o.id === id)!;

describe('tilpasningsverktøy', () => {
  it('finner stiv transformasjon (rotasjon + forskyvning)', () => {
    const a = (10 * Math.PI) / 180;
    const pts = [p(0, 0), p(1000, 0), p(1000, 2000), p(0, 2000)];
    const pairs = pts.map((q) => ({ from: q, to: { x: q.x * Math.cos(a) - q.z * Math.sin(a) + 50, z: q.x * Math.sin(a) + q.z * Math.cos(a) - 30 } }));
    const T = fitRigid(pairs);
    expect(T.angle).toBeCloseTo(a, 9);
    const q = applyRigid(T, p(500, 500));
    expect(q.x).toBeCloseTo(500 * Math.cos(a) - 500 * Math.sin(a) + 50, 6);
  });

  it('linjetilpasning og avbildning langs veggen', () => {
    const l = fitLine([{ p: p(0, 10), w: 1 }, { p: p(1000, 10), w: 1 }, { p: p(2000, 10), w: 1 }])!;
    expect(Math.abs(l.dir.x)).toBeCloseTo(1, 9);
    const m = new AlongMap([[0, 10], [1000, 1020]]);
    expect(m.map(500)).toBeCloseTo(515, 9);
    expect(m.map(-100)).toBeCloseTo(-90, 9); // stigning 1 utenfor
    expect(m.map(1100)).toBeCloseTo(1120, 9);
  });
});

function p(x: number, z: number) {
  return { x, z };
}

describe('oppmåling → apartment.json', () => {
  it('ingen målinger gir uendret fil', () => {
    expect(applyMeasurements(base, [])).toEqual(base);
  });

  it('målte hjørner flytter rommet og veggene rundt det', () => {
    const out = solve(roomCorners('gang', 30, -20));
    const gang = room(out, 'gang');
    expect(gang.polygon.every(([x, z]) => isMeasured(x) && isMeasured(z))).toBe(true);
    expect(nv(gang.polygon[0]![0])).toBe(30);
    expect(nv(gang.polygon[0]![1])).toBe(-20);
    // Vestveggen (linje x = 0) følger hjørnene og er nå målt.
    const vest = wall(out, 'v-vest');
    expect(nv(vest.start[0])).toBe(30);
    expect(nv(vest.start[1])).toBe(-20);
    expect(nv(vest.end[1])).toBe(5680);
    expect(isMeasured(vest.start[0])).toBe(true);
    // Inngangsdøra står fortsatt på samme sted langs veggen (veggen ble bare flyttet).
    expect(nv(opening(out, 'dor-inngang').offset)).toBe(400);
  });

  it('rotasjon følges av veggene', () => {
    const out = solve(roomCorners('gang', 0, 0, 3));
    const vest = wall(out, 'v-vest');
    const dx = nv(vest.end[0]) - nv(vest.start[0]);
    const dz = nv(vest.end[1]) - nv(vest.start[1]);
    // Vestveggen gikk langs +z; nå er den vridd 3° (med klokka ovenfra → mot −x).
    expect((Math.atan2(-dx, dz) * 180) / Math.PI).toBeCloseTo(3, 0);
  });

  it('gulvnivå (trinnet) og tak fra målinger', () => {
    const out = solve([
      { kind: 'room-floor', roomId: 'stue', y: 200 },
      { kind: 'ceiling', roomId: 'kjokken', slot: 0, x: 6500, y: 2600, z: 500 },
      { kind: 'ceiling', roomId: 'kjokken', slot: 1, x: 8800, y: 2700, z: 500 },
      { kind: 'ceiling', roomId: 'kjokken', slot: 2, x: 6500, y: 2650, z: 3800 },
    ]);
    expect(room(out, 'stue').floorLevel).toEqual({ value: 200, measured: true });
    const pts = room(out, 'kjokken').ceiling.points;
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual({ x: { value: 6500, measured: true }, z: { value: 500, measured: true }, height: { value: 2420, measured: true } });
    const m2 = modelOf(out);
    expect(m2.floorLevelAt({ x: 3000, z: 1000 })).toBe(200);
    const k = m2.rooms.get('kjokken')!;
    expect(m2.ceilingAt(k, { x: 8800, z: 500 })).toBeCloseTo(2700, 6);
  });

  it('ett takpunkt løfter taket men beholder helningen', () => {
    const before = modelOf(base);
    const s = before.rooms.get('stue')!;
    const old = before.ceilingAt(s, { x: 4000, z: 2000 });
    const out = solve([{ kind: 'ceiling', roomId: 'stue', slot: 0, x: 4000, y: old + 100, z: 2000 }]);
    const after = modelOf(out);
    const s2 = after.rooms.get('stue')!;
    expect(after.ceilingAt(s2, { x: 4000, z: 2000 })).toBeCloseTo(old + 100, 0);
    // Helningen er bevart: forskjellen mellom to punkter er lik som før.
    const slopeBefore = before.ceilingAt(s, { x: 5500, z: 2000 }) - before.ceilingAt(s, { x: 3000, z: 2000 });
    const slopeAfter = after.ceilingAt(s2, { x: 5500, z: 2000 }) - after.ceilingAt(s2, { x: 3000, z: 2000 });
    expect(slopeAfter).toBeCloseTo(slopeBefore, 0);
  });

  it('karmer, overkant og brystning måler dører og vinduer', () => {
    const out = solve([
      // Baddøra sitter i veggen z = 4200 fra x = 3800 mot x = 2400.
      { kind: 'jamb', openingId: 'dor-bad', side: 0, x: 2950, z: 4250 },
      { kind: 'jamb', openingId: 'dor-bad', side: 1, x: 3720, z: 4250 },
      { kind: 'opening-top', openingId: 'dor-bad', y: 2210 },
      { kind: 'opening-sill', openingId: 'vindu-stue-1', y: 1100 },
      { kind: 'opening-top', openingId: 'vindu-stue-1', y: 2050 },
    ]);
    const d = opening(out, 'dor-bad');
    expect(d.offset).toEqual({ value: 80, measured: true });
    expect(d.width).toEqual({ value: 770, measured: true });
    expect(d.height).toEqual({ value: 2030, measured: true }); // 2210 − stuegulv 180
    const w = opening(out, 'vindu-stue-1');
    if (w.type !== 'window') throw new Error('forventet vindu');
    expect(w.sillHeight).toEqual({ value: 920, measured: true });
    expect(w.height).toEqual({ value: 950, measured: true });
  });

  it('installasjoner måles på veggen', () => {
    const out = solve([{ kind: 'fixture', fixtureId: 'stk-stue-1', x: 2700, y: 480, z: 20 }]);
    const fx = out.fixtures.find((f) => f.id === 'stk-stue-1')!;
    expect(fx.mount!.along).toEqual({ value: 2900, measured: true }); // fra veggstart x = −200
    expect(fx.mount!.height).toEqual({ value: 300, measured: true });
  });

  it('veggtykkelse blir målt når begge sider er målt', () => {
    const g = model.rooms.get('gang')!.polygon;
    const s = model.rooms.get('stue')!.polygon;
    const out = solve([
      { kind: 'room-corner', roomId: 'gang', index: 1, x: g[1]!.x, z: g[1]!.z },
      { kind: 'room-corner', roomId: 'gang', index: 2, x: g[2]!.x, z: g[2]!.z },
      // Stua er 20 mm lenger unna: skilleveggen er 120 mm, ikke 100.
      { kind: 'room-corner', roomId: 'stue', index: 0, x: s[0]!.x + 20, z: s[0]!.z },
      { kind: 'room-corner', roomId: 'stue', index: 3, x: s[3]!.x + 20, z: s[3]!.z },
    ]);
    const w = wall(out, 'v-gang-stue');
    expect(w.thickness).toEqual({ value: 120, measured: true });
    expect(nv(w.start[0])).toBe(2300);
  });

  it('møbler flytter med rommet de står i', () => {
    const sofaBefore = base.furniture.find((f) => f.id === 'sofa')!;
    const out = solve(roomCorners('stue', 100, 50));
    const sofa = out.furniture.find((f) => f.id === 'sofa')!;
    expect(nv(sofa.position[0])).toBe(nv(sofaBefore.position[0]) + 100);
    expect(nv(sofa.position[2])).toBe(nv(sofaBefore.position[2]) + 50);
  });

  it('en hel oppmåling med små avvik gir en gyldig modell', () => {
    let seed = 7;
    const noise = (): number => ((seed = (seed * 9301 + 49297) % 233280) / 233280 - 0.5) * 10; // ±5 mm
    const obs: Observation[] = [];
    for (const id of model.rooms.keys()) {
      obs.push({ kind: 'room-floor', roomId: id, y: model.rooms.get(id)!.room.floorLevel + noise() });
      for (const o of roomCorners(id)) if (o.kind === 'room-corner') obs.push({ ...o, x: o.x + noise(), z: o.z + noise() });
    }
    const out = solve(obs);
    const r = validateApartment(out);
    expect(r.ok).toBe(true);
    // Alle rom er nå målt (eller delvis målt) – ingen rene plassholdere igjen blant rommene.
    for (const id of model.rooms.keys()) expect(r.model!.measureState(id)).not.toBe('placeholder');
  });

  it('en ny måling av samme punkt erstatter den gamle', () => {
    const out = solve([
      { kind: 'room-floor', roomId: 'kjokken', y: 150 },
      { kind: 'room-floor', roomId: 'kjokken', y: 175 },
    ]);
    expect(nv(room(out, 'kjokken').floorLevel)).toBe(175);
  });
});
