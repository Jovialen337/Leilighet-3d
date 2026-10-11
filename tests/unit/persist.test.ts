import { describe, expect, it } from 'vitest';
import { Observable } from '../../src/state/Observable';
import { PersistedSettings, inRange, isBool, oneOf, type KV } from '../../src/state/persist';

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

describe('lagrede innstillinger', () => {
  it('husker valg mellom omlastinger', () => {
    const kv = new MemoryKV();
    const a = new PersistedSettings(kv, 'x');
    const q = new Observable<'lav' | 'høy'>('lav');
    a.bind('kvalitet', q, oneOf(['lav', 'høy'] as const));
    q.set('høy');
    const b = new PersistedSettings(kv, 'x');
    const q2 = new Observable<'lav' | 'høy'>('lav');
    b.bind('kvalitet', q2, oneOf(['lav', 'høy'] as const));
    expect(q2.value).toBe('høy');
  });

  it('ugyldige eller ødelagte verdier gir standardverdien', () => {
    const kv = new MemoryKV();
    kv.setItem('x', JSON.stringify({ snu: 999, tak: 'ja' }));
    const s = new PersistedSettings(kv, 'x');
    const turn = new Observable(30);
    const ceil = new Observable(true);
    s.bind('snu', turn, oneOf([15, 30, 45] as const));
    s.bind('tak', ceil, isBool);
    expect(turn.value).toBe(30);
    expect(ceil.value).toBe(true);
    kv.setItem('y', '{ødelagt');
    const h = new Observable(0);
    new PersistedSettings(kv, 'y').bind('h', h, inRange(-500, 500));
    expect(h.value).toBe(0);
  });

  it('virker uten lagring, og «clear» glemmer alt', () => {
    const o = new Observable(false);
    new PersistedSettings(null, 'x').bind('a', o, isBool);
    o.set(true);
    expect(o.value).toBe(true);
    const kv = new MemoryKV();
    const s = new PersistedSettings(kv, 'x');
    const p = new Observable(false);
    s.bind('a', p, isBool);
    p.set(true);
    s.clear();
    expect(kv.data.size).toBe(0);
  });
});
