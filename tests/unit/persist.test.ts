import { describe, expect, it } from 'vitest';
import { Observable } from '../../src/state/Observable';
import { PersistedSettings, inRange, isBool, oneOf, type KV } from '../../src/state/persist';
import { SettingsBinding, SETTINGS_KEY } from '../../src/state/settings';
import { ViewState } from '../../src/state/ViewState';
import { presetEffects, wantedEffects } from '../../src/scene/graphicsProfile';

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

describe('innstillingene i appen', () => {
  it('«Tilbakestill innstillinger» setter alt som lagres tilbake til standard og tømmer lagringen', () => {
    const kv = new MemoryKV();
    const view = new ViewState();
    const fresh = new ViewState();
    const binding = new SettingsBinding(view, kv);
    // Endre alt som lagres.
    view.ceilings.set(false);
    view.measureHighlight.set(true);
    view.quality.set('custom');
    view.customEffects.set({ shafts: true });
    view.light.set('natt');
    view.xrRate.set(120);
    view.turn.set('smooth');
    view.wristHelp.set(true);
    view.sectionHeight.set(1200);
    view.dollhouse.set(true);
    view.cameraMode.set('top');
    view.showExisting.set(false);
    view.showPlanned.set(false);
    view.circuit.set('kurs-1');
    view.xray.set(true);
    expect(JSON.parse(kv.getItem(SETTINGS_KEY)!)).toMatchObject({ kvalitet: 'custom', effekter: { shafts: true }, lys: 'natt', hjelp: true });
    binding.reset({ layers: [] });
    for (const key of Object.keys(fresh) as (keyof ViewState)[]) {
      const o = fresh[key] as unknown;
      if (o && typeof o === 'object' && 'value' in o && key !== 'inXR' && key !== 'fps') expect((view[key] as { value: unknown }).value, key).toEqual((o as { value: unknown }).value);
    }
    expect(kv.data.size).toBe(0);
  });

  it('lagret «Egendefinert»-sett med ukjente eller ødelagte verdier gir standard', () => {
    const kv = new MemoryKV();
    kv.setItem(SETTINGS_KEY, JSON.stringify({ kvalitet: 'custom', effekter: { tåke: true } }));
    const view = new ViewState();
    new SettingsBinding(view, kv);
    expect(view.quality.value).toBe('custom');
    // Effektene er de samme som «Standard».
    expect(wantedEffects(view.quality.value, view.customEffects.value)).toEqual(presetEffects('medium'));
  });
});
