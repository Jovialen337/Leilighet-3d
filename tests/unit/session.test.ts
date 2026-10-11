import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MeasureSession, STORAGE_KEY, hashDoc, observationFor, type KV } from '../../src/measure/MeasureSession';
import { buildTasks, taskKey } from '../../src/measure/tasks';
import { formatJson } from '../../src/schema/format';
import { numValue } from '../../src/schema/normalize';
import type { ApartmentDoc } from '../../src/schema/types';
import { APARTMENT_PATH, loadDoc, modelOf } from './helpers';

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

const base = loadDoc();
const model = modelOf(base);

/** Måler oppgaven som står for tur nøyaktig der modellen tror den er, forskjøvet litt. */
function measureCurrent(s: MeasureSession, dx = 0, dy = 0, dz = 0) {
  const t = s.current()!;
  return s.record({ x: t.target.x + dx, y: t.target.y + dy, z: t.target.z + dz });
}

describe('huskelisten', () => {
  const tasks = buildTasks(model, base);

  it('har unike nøkler som stemmer med målingene', () => {
    const keys = tasks.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of tasks) expect(taskKey(observationFor(t.task, t.target))).toBe(t.key);
  });

  it('går rom for rom og hopper over det som er målt eller bare planlagt', () => {
    // Gangens gulv er origo og måles ikke; første oppgave er hjørnet ved døra.
    expect(tasks[0]!.key).toBe('hjorne:gang:0');
    expect(tasks[0]!.target).toEqual({ x: 0, y: 1000, z: 0 });
    // Planterommets tak er allerede målt (2100 mm).
    expect(tasks.some((t) => t.key.startsWith('tak:planterom'))).toBe(false);
    expect(tasks.some((t) => t.key === 'gulv:planterom')).toBe(true);
    // Planlagte installasjoner finnes ikke ennå.
    expect(tasks.some((t) => t.key === 'inst:stk-planterom-1')).toBe(false);
    // Rommene kommer i samme rekkefølge som i fila.
    const groups = [...new Set(tasks.map((t) => t.group))];
    expect(groups).toEqual(['Gang', 'Stue', 'Kjøkken', 'Bad', 'Bad (indre del)', 'Planterom']);
    // Tak pekes på, resten berøres.
    expect(tasks.filter((t) => t.method === 'point').every((t) => t.task.kind === 'ceiling' || t.task.kind === 'fixture')).toBe(true);
    // Vinduer har underkant, dører ikke.
    expect(tasks.some((t) => t.key === 'brystning:vindu-stue-1')).toBe(true);
    expect(tasks.some((t) => t.key === 'brystning:dor-bad')).toBe(false);
    // Uten fila tas alt med (unntatt planlagte installasjoner).
    expect(buildTasks(model).length).toBeGreaterThan(tasks.length);
  });

  it('alle tekster er på norsk og har innhold', () => {
    for (const t of tasks) {
      expect(t.title.length).toBeGreaterThan(3);
      expect(t.instruction).toMatch(/avtrekkeren/);
    }
  });
});

describe('oppmålingsøkt', () => {
  it('måling oppdaterer utkastet og går videre', () => {
    const s = new MeasureSession(base);
    const total = s.tasks.length;
    expect(s.current()!.key).toBe('hjorne:gang:0');
    expect(measureCurrent(s, 20, 0, -10)).toEqual({ ok: true });
    expect(s.current()!.key).toBe('hjorne:gang:1');
    expect(s.progress()).toMatchObject({ done: 1, skipped: 0, total });
    expect(s.progress().groups[0]).toEqual({ group: 'Gang', done: 1, total: s.tasks.filter((t) => t.group === 'Gang').length });
    const gang = s.draft.rooms.find((r) => r.id === 'gang')!;
    expect(gang.polygon[0]).toEqual([
      { value: 20, measured: true },
      { value: -10, measured: true },
    ]);
    // Grunnfila er uendret.
    expect(numValue(base.rooms[0]!.polygon[0]![0])).toBe(0);
    expect(s.error).toBeNull();
  });

  it('hopp over legger oppgaven til slutt; de overhoppede kan tas igjen', () => {
    const s = new MeasureSession(base);
    s.skip();
    expect(s.current()!.key).toBe('hjorne:gang:1');
    expect(s.progress().skipped).toBe(1);
    // Mål resten av gangens hjørner: hjørne 1 er fortsatt hoppet over.
    for (let i = 0; i < 3; i++) measureCurrent(s);
    expect(s.current()!.key).toBe('tak:gang:0');
    s.revisitSkipped();
    expect(s.current()!.key).toBe('hjorne:gang:0');
    expect(s.progress().skipped).toBe(0);
  });

  it('angre fjerner siste måling og går tilbake til den oppgaven', () => {
    const s = new MeasureSession(base);
    measureCurrent(s, 50);
    measureCurrent(s, 50);
    expect(s.undo()).toBe(true);
    expect(s.current()!.key).toBe('hjorne:gang:1');
    expect(s.progress().done).toBe(1);
    expect(s.undo()).toBe(true);
    expect(s.draft).toEqual(base);
    expect(s.hasMeasurements).toBe(false);
    expect(s.undo()).toBe(false);
  });

  it('angre etter hopp over henter oppgaven tilbake', () => {
    const s = new MeasureSession(base);
    s.skip();
    s.undo();
    expect(s.current()!.key).toBe('hjorne:gang:0');
    expect(s.progress().skipped).toBe(0);
  });

  it('ny måling av samme punkt erstatter den gamle, og angre gir den gamle tilbake', () => {
    const s = new MeasureSession(base);
    measureCurrent(s, 10);
    s.select('hjorne:gang:0');
    measureCurrent(s, 30);
    const x = () => numValue(s.draft.rooms[0]!.polygon[0]![0]);
    expect(x()).toBe(30 + 10); // mål-punktet følger utkastet (allerede flyttet 10)
    expect(s.progress().done).toBe(1);
    s.undo();
    expect(x()).toBe(10);
  });

  it('blar mellom oppgaver uten å hoppe over', () => {
    const s = new MeasureSession(base);
    s.step(-1);
    expect(s.current()!.key).toBe(s.tasks[s.tasks.length - 1]!.key);
    s.step(1);
    s.step(1);
    expect(s.current()!.key).toBe('hjorne:gang:1');
    expect(s.progress().skipped).toBe(0);
  });

  it('takpunkter for nær hverandre eller på linje avvises', () => {
    const s = new MeasureSession(base);
    s.select('tak:stue:0');
    expect(s.record({ x: 3000, y: 2400, z: 500 }).ok).toBe(true);
    // For nær det første.
    const near = s.record({ x: 3100, y: 2400, z: 600 }, s.tasks.find((t) => t.key === 'tak:stue:1')!);
    expect(near).toEqual({ ok: false, message: expect.stringMatching(/For nær/) });
    expect(s.record({ x: 5500, y: 2500, z: 500 }, s.tasks.find((t) => t.key === 'tak:stue:1')!).ok).toBe(true);
    // Tredje punkt på linja mellom de to.
    const line = s.record({ x: 4200, y: 2450, z: 520 }, s.tasks.find((t) => t.key === 'tak:stue:2')!);
    expect(line).toEqual({ ok: false, message: expect.stringMatching(/rett linje/) });
    expect(s.record({ x: 5500, y: 2550, z: 3800 }, s.tasks.find((t) => t.key === 'tak:stue:2')!).ok).toBe(true);
    const stue = s.draft.rooms.find((r) => r.id === 'stue')!;
    expect(stue.ceiling.points).toHaveLength(3);
  });

  it('advarer når målingen er langt fra der modellen trodde', () => {
    const s = new MeasureSession(base);
    const r = measureCurrent(s, 2000);
    expect(r.ok).toBe(true);
    expect(r.ok && r.warning).toMatch(/2,0 m.*B for å angre/);
  });

  it('en måling som gir ugyldig modell beholder forrige utkast og viser feilen', () => {
    const s = new MeasureSession(base);
    measureCurrent(s, 15);
    const before = s.draft;
    // Overkanten av baddøra under gulvet gir negativ høyde.
    s.select('overkant:dor-bad');
    expect(s.record({ x: 3300, y: 100, z: 4250 }).ok).toBe(true);
    expect(s.error).toMatch(/høyde|height/i);
    expect(s.draft).toBe(before);
    s.undo();
    expect(s.error).toBeNull();
  });
});

describe('lagring lokalt', () => {
  it('målinger, overhopp og posisjon overlever omlasting, og angre virker etterpå', () => {
    const kv = new MemoryKV();
    const a = new MeasureSession(base, kv);
    measureCurrent(a, 10);
    a.skip();
    measureCurrent(a, 5);
    const b = new MeasureSession(loadDoc(), kv);
    expect(b.progress()).toMatchObject({ done: 2, skipped: 1 });
    expect(b.current()!.key).toBe(a.current()!.key);
    expect(b.draft).toEqual(a.draft);
    b.undo();
    expect(b.progress().done).toBe(1);
    expect(new MeasureSession(base, kv).progress().done).toBe(1);
  });

  it('målinger mot en eldre fil legges til side og kan tas i bruk', () => {
    const kv = new MemoryKV();
    const a = new MeasureSession(base, kv);
    measureCurrent(a, 10);
    measureCurrent(a, 10);
    const changed = loadDoc();
    changed.meta.name = 'Endret';
    const b = new MeasureSession(changed, kv);
    expect(b.stale).toMatchObject({ count: 2 });
    expect(b.hasMeasurements).toBe(false);
    expect(kv.getItem(STORAGE_KEY)).toBeNull();
    expect(b.adoptStale()).toBe(true);
    expect(b.stale).toBeNull();
    expect(b.progress().done).toBe(2);
    expect(new MeasureSession(changed, kv).progress().done).toBe(2);
  });

  it('«Forkast» på gamle målinger sletter bare dem – dagens målinger beholdes', () => {
    const kv = new MemoryKV();
    const a = new MeasureSession(base, kv);
    measureCurrent(a, 10);
    measureCurrent(a, 10);
    const changed = loadDoc();
    changed.meta.name = 'Endret';
    const b = new MeasureSession(changed, kv);
    measureCurrent(b, 10);
    expect(b.stale).toMatchObject({ count: 2 });
    let calls = 0;
    b.subscribe(() => calls++);
    b.discardStale();
    expect(calls).toBe(1);
    expect(b.stale).toBeNull();
    expect(b.progress().done).toBe(1);
    const c = new MeasureSession(changed, kv);
    expect(c.stale).toBeNull();
    expect(c.progress().done).toBe(1);
  });

  it('når den eksporterte fila er lastet opp, ryddes de lokale målingene', () => {
    const kv = new MemoryKV();
    const a = new MeasureSession(base, kv);
    measureCurrent(a, 10);
    const text = a.exportText(new Date(2026, 9, 10));
    const published = JSON.parse(text) as ApartmentDoc;
    expect(published.meta.updated).toBe('2026-10-10');
    const b = new MeasureSession(published, kv);
    expect(b.published).toBe(true);
    expect(b.stale).toBeNull();
    expect(kv.data.size).toBe(0);
    // Det som er målt, er borte fra listen.
    expect(b.tasks.some((t) => t.key === 'hjorne:gang:0')).toBe(false);
  });

  it('forkast sletter alt', () => {
    const kv = new MemoryKV();
    const a = new MeasureSession(base, kv);
    measureCurrent(a);
    a.discard();
    expect(a.hasMeasurements).toBe(false);
    expect(kv.data.size).toBe(0);
    expect(new MeasureSession(base, kv).size).toBe(0);
  });

  it('virker uten lagring og tåler ødelagte data', () => {
    const kv = new MemoryKV();
    kv.setItem(STORAGE_KEY, '{ikke json');
    expect(new MeasureSession(base, kv).size).toBe(0);
    const s = new MeasureSession(base, null);
    expect(measureCurrent(s).ok).toBe(true);
  });

  it('fingeravtrykket er stabilt for samme innhold', () => {
    expect(hashDoc(loadDoc())).toBe(hashDoc(base));
  });
});

describe('formatering av apartment.json', () => {
  it('gir nøyaktig samme tekst som den håndskrevne plassholder-fila', () => {
    const text = readFileSync(APARTMENT_PATH, 'utf8');
    expect(formatJson(JSON.parse(text))).toBe(text);
  });

  it('korte verdier på én linje, lange brytes', () => {
    expect(formatJson({ a: [1, 2], b: { value: 3, measured: true } })).toBe(
      '{"a": [1, 2], "b": {"value": 3, "measured": true}}\n',
    );
    const long = formatJson({ text: 'x'.repeat(120), n: 1 });
    expect(long.split('\n')).toHaveLength(5);
    expect(JSON.parse(long)).toEqual({ text: 'x'.repeat(120), n: 1 });
  });
});

describe('justering mot det virkelige rommet', () => {
  it('to berøringer gir origo i hjørnet og +x langs inngangsveggen', async () => {
    const { alignFromTouches, rigToWorld } = await import('../../src/measure/align');
    const THREE = await import('three');
    // Hjørnet står et sted i rommet; veggen går 35° på skrå.
    const q0 = { x: 1.2, y: 0.03, z: -0.4 };
    const a = (35 * Math.PI) / 180;
    const q1 = { x: q0.x + 2 * Math.cos(a), y: 1.1, z: q0.z + 2 * Math.sin(a) };
    const r = alignFromTouches(q0, q1);
    if (!r.ok) throw new Error(r.message);
    const w0 = rigToWorld(r.rig, q0);
    expect(w0.x).toBeCloseTo(0, 9);
    expect(w0.y).toBeCloseTo(0, 9);
    expect(w0.z).toBeCloseTo(0, 9);
    const w1 = rigToWorld(r.rig, q1);
    expect(w1.x).toBeCloseTo(2, 9);
    expect(w1.z).toBeCloseTo(0, 9);
    expect(w1.y).toBeCloseTo(1.07, 9);
    // Samme svar som three.js gir for en gruppe med denne plasseringen.
    const g = new THREE.Group();
    g.position.set(r.rig.x, r.rig.y, r.rig.z);
    g.rotation.y = r.rig.yaw;
    g.updateMatrixWorld(true);
    const p = { x: -0.7, y: 1.5, z: 2.2 };
    const v = g.localToWorld(new THREE.Vector3(p.x, p.y, p.z));
    const w = rigToWorld(r.rig, p);
    expect(v.x).toBeCloseTo(w.x, 9);
    expect(v.y).toBeCloseTo(w.y, 9);
    expect(v.z).toBeCloseTo(w.z, 9);
  });

  it('for kort avstand avvises', async () => {
    const { alignFromTouches } = await import('../../src/measure/align');
    const r = alignFromTouches({ x: 0, y: 0, z: 0 }, { x: 0.2, y: 1, z: 0.1 });
    expect(r).toEqual({ ok: false, message: expect.stringMatching(/For nær/) });
  });
});
