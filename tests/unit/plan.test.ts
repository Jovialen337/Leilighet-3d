import { describe, expect, it } from 'vitest';
import { PlanEdits, PLAN_KEY } from '../../src/plan/PlanEdits';
import type { KV } from '../../src/state/persist';
import { loadDoc } from './helpers';
import type { ApartmentDoc } from '../../src/schema/types';
import { validateApartment } from '../../src/schema/validate';

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

const wire = (id: string, x = 0) => ({ id, layer: 'wiring', status: 'planned', kind: 'power', points: [[x, 300, 10], [x + 1000, 300, 10]] });

describe('lokale planendringer', () => {
  it('legger til, endrer og fjerner objekter oppå fila uten å endre den', () => {
    const base = loadDoc();
    const e = new PlanEdits(base);
    e.put('wiring', wire('k-1'));
    e.put('wiring', wire('k-1', 500));
    e.remove('wiring', 'kabel-planterom');
    const out = e.apply(base);
    expect(out.wiring.map((w) => w.id)).toEqual(['k-1']);
    expect(out.wiring[0]!.points[0]).toEqual([500, 300, 10]);
    expect(base.wiring.map((w) => w.id)).toEqual(['kabel-planterom']);
    expect(e.changedObjects).toBe(2);
    e.undo();
    expect(e.apply(base).wiring).toHaveLength(2);
  });

  it('nye id-er kolliderer ikke', () => {
    const base = loadDoc();
    const e = new PlanEdits(base);
    expect(e.newId(base, 'kabel')).toBe('kabel-1');
    e.put('wiring', wire('kabel-1'));
    expect(e.newId(base, 'kabel')).toBe('kabel-2');
  });

  it('lagres lokalt, og forsvinner når den publiserte fila har endringene', () => {
    const kv = new MemoryKV();
    const base = loadDoc();
    const a = new PlanEdits(base, kv);
    a.put('wiring', wire('k-1'));
    a.remove('wiring', 'kabel-planterom');
    const b = new PlanEdits(base, kv);
    expect(b.size).toBe(2);
    const published = b.apply(base);
    const c = new PlanEdits(published, kv);
    expect(c.size).toBe(0);
    expect(c.published).toBe(true);
    expect(kv.data.has(PLAN_KEY)).toBe(false);
  });

  it('tåler ødelagte data', () => {
    const kv = new MemoryKV();
    kv.setItem(PLAN_KEY, '{tull');
    expect(new PlanEdits(loadDoc(), kv).size).toBe(0);
    kv.setItem(PLAN_KEY, JSON.stringify({ version: 1, ops: [{ op: 'put', c: 'ukjent', obj: { id: 'x' } }, { op: 'del', c: 'wiring', id: 'kabel-planterom' }] }));
    expect(new PlanEdits(loadDoc(), kv).size).toBe(1);
  });
});

describe('tegninger som ikke passer med modellen', () => {
  const isValid = (d: ApartmentDoc): boolean => validateApartment(d).ok;
  const outlet = (along: number) => ({
    id: 'stk-1',
    type: 'outlet',
    layer: 'electrical-planned',
    status: 'planned',
    mount: { wall: 'v-inngang', room: 'stue', along, height: 300 },
  });
  /** Fila der inngangsveggen har fått ny id (så et punkt på «v-inngang» ikke passer). */
  const renamedDoc = (): ApartmentDoc => {
    const d = loadDoc();
    d.walls.find((x) => x.id === 'v-inngang')!.id = 'v-ost';
    for (const o of d.openings) if (o.wall === 'v-inngang') o.wall = 'v-ost';
    for (const f of d.fixtures) if (f.mount?.wall === 'v-inngang') f.mount.wall = 'v-ost';
    return d;
  };

  it('skjules når veggen de hang på er borte, resten vises, og ingenting slettes', () => {
    const kv = new MemoryKV();
    const base = loadDoc();
    const e = new PlanEdits(base, kv);
    e.put('fixtures', outlet(4200));
    e.put('wiring', wire('k-1'));
    const renamed = renamedDoc();
    expect(isValid(renamed)).toBe(true);
    const b = new PlanEdits(renamed, kv);
    expect(isValid(b.apply(renamed))).toBe(false);
    const { doc, hidden } = b.split(renamed, isValid);
    expect(isValid(doc)).toBe(true);
    expect(hidden.map((o) => (o.op === 'put' ? o.obj.id : o.id))).toEqual(['stk-1']);
    expect(doc.wiring.some((w) => w.id === 'k-1')).toBe(true);
    // Ingenting er slettet: begge ligger fortsatt lagret.
    expect(b.size).toBe(2);
    expect(new PlanEdits(renamed, kv).size).toBe(2);
    // Med den gamle fila passer alt igjen.
    expect(b.split(base, isValid).hidden).toEqual([]);
  });

  it('kommer tilbake når modellen passer igjen (f.eks. når en måling angres)', () => {
    const base = loadDoc();
    const e = new PlanEdits(base);
    e.put('fixtures', {
      id: 'stk-2',
      type: 'outlet',
      layer: 'electrical-planned',
      status: 'planned',
      mount: { wall: 'v-gang-planterom', face: 'left', along: 2260, height: 300 },
    });
    expect(e.split(base, isValid).hidden).toEqual([]);
    // En måling gjør veggen 1 900 mm lang: punktet ved 2 260 mm passer ikke lenger.
    const shorter = loadDoc();
    const w = shorter.walls.find((x) => x.id === 'v-gang-planterom')!;
    w.end = [1900, 2400];
    expect(isValid(shorter)).toBe(true);
    const s1 = e.split(shorter, isValid);
    expect(s1.hidden.length).toBe(1);
    expect(s1.doc.fixtures.some((f) => f.id === 'stk-2')).toBe(false);
    expect(e.size).toBe(1);
    // Målingen angres: punktet er tilbake.
    const s2 = e.split(base, isValid);
    expect(s2.hidden).toEqual([]);
    expect(s2.doc.fixtures.some((f) => f.id === 'stk-2')).toBe(true);
  });

  it('med kjente skjulte holder det med få valideringer, og svaret er det samme', () => {
    const e = new PlanEdits(loadDoc());
    e.put('fixtures', outlet(4200));
    for (let i = 0; i < 8; i++) e.put('wiring', wire(`k-${i}`, 100 * i));
    const renamed = renamedDoc();
    let n = 0;
    const counted = (d: ApartmentDoc): boolean => {
      n++;
      return isValid(d);
    };
    const full = e.split(renamed, counted);
    const fullCalls = n;
    n = 0;
    const quick = e.split(renamed, counted, full.hidden);
    expect(quick.hidden).toEqual(full.hidden);
    expect(quick.doc).toEqual(full.doc);
    expect(n).toBe(3); // alt, resten, og den ene skjulte
    expect(fullCalls).toBe(10);
  });

  it('en skjult endring kommer ikke tilbake forbi en senere sletting av samme objekt', () => {
    const base = loadDoc();
    const e = new PlanEdits(base);
    e.put('fixtures', outlet(4200));
    e.remove('fixtures', 'stk-1');
    e.put('fixtures', { ...outlet(100), id: 'stk-bad', mount: { wall: 'finnes-ikke', room: 'stue', along: 100, height: 300 } });
    // Et utdatert hint (fra en eldre fil) der «stk-1» var skjult.
    const r = e.split(base, isValid, [e.ops[0]!, e.ops[2]!]);
    expect(r.doc.fixtures.some((f) => f.id === 'stk-1')).toBe(false);
    expect(r.hidden).toEqual([e.ops[2]]);
  });

  it('«Forkast» fjerner bare de skjulte', () => {
    const kv = new MemoryKV();
    const e = new PlanEdits(loadDoc(), kv);
    e.put('fixtures', outlet(4200));
    e.put('wiring', wire('k-1'));
    const renamed = renamedDoc();
    let calls = 0;
    e.subscribe(() => calls++);
    e.removeOps(e.split(renamed, isValid).hidden);
    expect(calls).toBe(1);
    expect(e.size).toBe(1);
    expect(e.split(renamed, isValid).hidden).toEqual([]);
    expect(new PlanEdits(renamed, kv).size).toBe(1);
    e.removeOps([]);
    expect(calls).toBe(1);
  });

  it('flere endringer på én gang varsler én gang og angres én om gangen', () => {
    const e = new PlanEdits(loadDoc());
    let calls = 0;
    e.subscribe(() => calls++);
    e.add([
      { op: 'put', c: 'layers', obj: { id: 'ny', name: 'Ny', visible: true } },
      { op: 'put', c: 'wiring', obj: wire('k-1') },
    ]);
    expect(calls).toBe(1);
    expect(e.size).toBe(2);
    e.undo();
    expect(e.size).toBe(1);
  });
});
