import { describe, expect, it } from 'vitest';
import { PlanEdits, PLAN_KEY } from '../../src/plan/PlanEdits';
import type { KV } from '../../src/state/persist';
import { loadDoc } from './helpers';

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
