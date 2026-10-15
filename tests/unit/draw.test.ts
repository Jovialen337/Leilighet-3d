import { describe, expect, it } from 'vitest';
import {
  RunDraft,
  UNDER_CEILING,
  layerFor,
  makeFixture,
  makeRun,
  pickNearest,
  resolveHeight,
  runLength,
  snapPlan,
} from '../../src/plan/draw';
import { PlanController } from '../../src/plan/PlanController';
import { PlanEdits } from '../../src/plan/PlanEdits';
import { summarize, planHints } from '../../src/plan/summary';
import { validateApartment } from '../../src/schema/validate';
import { loadDoc, modelOf } from './helpers';

const base = loadDoc();
const model = modelOf(base);

describe('festing (snapping)', () => {
  it('fester til romhjørner, eksisterende punkter og veggflater', () => {
    expect(snapPlan(model, { x: 2410, z: 15 }, { prev: null, tol: 50 })).toEqual({ p: { x: 2400, z: 0 }, kind: 'hjørne' });
    // Kabelen til planterommet starter i (30, 1500).
    expect(snapPlan(model, { x: 45, z: 1490 }, { prev: null, tol: 50 })).toEqual({ p: { x: 30, z: 1500 }, kind: 'punkt' });
    // Midt på stuas vegg mot inngangen (z = 0).
    const s = snapPlan(model, { x: 4000, z: 35 }, { prev: null, tol: 50 });
    expect(s.kind).toBe('vegg');
    expect(s.p.z).toBeCloseTo(0, 6);
  });

  it('rett vinkel fra forrige punkt, ellers 50 mm-rutenett, og fritt med Ctrl', () => {
    const r = snapPlan(model, { x: 4013, z: 2950 }, { prev: { x: 3000, z: 3000 }, tol: 20 });
    expect(r).toEqual({ p: { x: 4010, z: 3000 }, kind: '90°' });
    expect(snapPlan(model, { x: 4013, z: 2238 }, { prev: null, tol: 20 })).toEqual({ p: { x: 4000, z: 2250 }, kind: 'rutenett' });
    expect(snapPlan(model, { x: 4013, z: 2238 }, { prev: null, tol: 20, free: true }).kind).toBe('fri');
  });
});

describe('kabel- og rørstrekk', () => {
  it('ny høyde gir en loddrett stigning, så strekkene blir vannrette eller loddrette', () => {
    const d = new RunDraft();
    d.add({ x: 0, z: 0 }, 300);
    d.add({ x: 1000, z: 0 }, 300);
    d.add({ x: 1000, z: 2000 }, 2100);
    expect(d.points).toEqual([
      [0, 300, 0],
      [1000, 300, 0],
      [1000, 2100, 0],
      [1000, 2100, 2000],
    ]);
    expect(d.length).toBe(1000 + 1800 + 2000);
    d.undo();
    expect(d.points).toEqual([
      [0, 300, 0],
      [1000, 300, 0],
    ]);
  });

  it('lager gyldige objekter i riktig lag', () => {
    expect(layerFor('wire', 'planned')).toBe('wiring');
    expect(layerFor('pipe', 'existing')).toBe('plumbing-existing');
    expect(layerFor('fixture', 'planned', 'tap')).toBe('plumbing-planned');
    expect(layerFor('fixture', 'existing', 'outlet')).toBe('electrical-existing');
    const run = makeRun('pipe', 'ror-1', [[0, 300, 1000], [1000, 300, 1000]], { status: 'planned', wireKind: 'power', pipeKind: 'drain', circuit: null });
    expect(run).toMatchObject({ kind: 'drain', diameter: 50, layer: 'plumbing-planned' });
    const fx = makeFixture(model, 'stk-x', { x: 4000, z: 30 }, { status: 'planned', fixtureType: 'outlet', circuit: 'kurs-1' });
    expect(fx).toMatchObject({ mount: { wall: 'v-inngang', room: 'stue', along: 4200, height: 300 }, circuit: 'kurs-1' });
    const lamp = makeFixture(model, 'lampe-x', { x: 4000, z: 2000 }, { status: 'planned', fixtureType: 'light', circuit: null });
    expect(lamp.position).toBeDefined();
    expect(resolveHeight(model, { x: 4000, z: 2000 }, UNDER_CEILING)).toBeGreaterThan(2000);
  });

  it('velger nærmeste kabel, rør eller punkt', () => {
    expect(pickNearest(model, { x: 40, z: 3000 }, 100)).toMatchObject({ c: 'wiring', id: 'kabel-planterom' });
    expect(pickNearest(model, { x: 3300, z: 5200 }, 100)).toMatchObject({ c: 'pipes', id: 'avlop-bad' });
    expect(pickNearest(model, { x: 7000, z: 2000 }, 100)).toBeNull();
  });
});

describe('tegneverktøyet', () => {
  it('klikk for klikk gir en kabel som valideres, og angre fjerner den', () => {
    const edits = new PlanEdits(base);
    let m = model;
    const ctrl = new PlanController(edits, () => m, () => base);
    edits.subscribe(() => (m = modelOf(edits.apply(base))));
    ctrl.set({ tool: 'wire', circuit: 'kurs-1', height: 300 });
    ctrl.click({ x: 3000, z: 1000 }, 20);
    ctrl.click({ x: 3000, z: 3000 }, 20);
    ctrl.click({ x: 3000, z: 3000 }, 20); // samme punkt igjen = ferdig
    const doc = edits.apply(base);
    expect(validateApartment(doc).ok).toBe(true);
    const w = doc.wiring.find((x) => x.id === 'kabel-1')!;
    expect(w).toMatchObject({ circuit: 'kurs-1', status: 'planned', layer: 'wiring' });
    expect(runLength(w.points as [number, number, number][])).toBe(2000);
    ctrl.set({ tool: 'fixture', fixtureType: 'tap', status: 'planned' });
    ctrl.click({ x: 9070, z: 2000 }, 20);
    expect(edits.apply(base).fixtures.at(-1)).toMatchObject({ type: 'tap', layer: 'plumbing-planned', mount: { wall: 'v-kjokken-ost' } });
    ctrl.set({ tool: 'select' });
    ctrl.click({ x: 3010, z: 2000 }, 100);
    expect(ctrl.selected.value).toEqual({ c: 'wiring', id: 'kabel-1' });
    ctrl.deleteSelected();
    expect(edits.apply(base).wiring.some((x) => x.id === 'kabel-1')).toBe(false);
    ctrl.undo();
    expect(edits.apply(base).wiring.some((x) => x.id === 'kabel-1')).toBe(true);
  });

  it('nytt lag legges til hvis fila mangler det, og ny kurs får farge', () => {
    const old = loadDoc();
    old.layers = old.layers.filter((l) => !l.id.startsWith('plumbing'));
    old.pipes = [];
    old.fixtures = old.fixtures.filter((f) => !f.layer.startsWith('plumbing'));
    const edits = new PlanEdits(old);
    const ctrl = new PlanController(edits, () => modelOf(edits.apply(old)), () => old);
    ctrl.set({ tool: 'pipe', pipeKind: 'hot' });
    ctrl.click({ x: 7000, z: 3000 }, 20);
    ctrl.click({ x: 8000, z: 3000 }, 20);
    expect(ctrl.finish()).toBe(true);
    const doc = edits.apply(old);
    expect(doc.layers.some((l) => l.id === 'plumbing-planned')).toBe(true);
    expect(validateApartment(doc).ok).toBe(true);
    const id = ctrl.addCircuit('Kurs 9 – test', 10);
    expect(edits.apply(old).circuits?.find((c) => c.id === id)).toMatchObject({ name: 'Kurs 9 – test', fuse: 10 });
  });
});

describe('avvisning før lagring', () => {
  it('en endring som gir ugyldig modell lagres ikke, og beskjeden sier hvorfor', () => {
    const edits = new PlanEdits(base);
    const ctrl = new PlanController(edits, () => modelOf(edits.apply(base)), () => base);
    let seen: readonly unknown[] = [];
    ctrl.canApply = (ops) => {
      seen = ops;
      return 'veggen er for kort.';
    };
    ctrl.set({ tool: 'fixture', fixtureType: 'outlet', status: 'planned' });
    ctrl.click({ x: 9070, z: 2000 }, 20);
    expect(seen.length).toBeGreaterThan(0);
    expect(edits.size).toBe(0);
    expect(ctrl.message.value).toBe('Kan ikke legges inn: veggen er for kort.');
    ctrl.set({ tool: 'wire' });
    ctrl.click({ x: 3000, z: 1000 }, 20);
    ctrl.click({ x: 3000, z: 3000 }, 20);
    expect(ctrl.finish()).toBe(false);
    expect(ctrl.drawing).toBe(true); // punktene beholdes, så man kan rette opp
    expect(edits.size).toBe(0);
    expect(ctrl.addCircuit('Kurs X')).toBeNull();
    ctrl.canApply = () => null;
    expect(ctrl.finish()).toBe(true);
    expect(edits.size).toBe(1);
    ctrl.set({ tool: 'select' });
    ctrl.click({ x: 3010, z: 2000 }, 100);
    ctrl.canApply = () => 'noe annet peker på den.';
    expect(ctrl.deleteSelected()).toBe(false);
    expect(ctrl.message.value).toBe('Kan ikke slettes: noe annet peker på den.');
    expect(edits.size).toBe(1);
  });

  it('festing og lengde under tegning lager ingen nye objekter per kall', () => {
    const edits = new PlanEdits(base);
    const ctrl = new PlanController(edits, () => model, () => base);
    ctrl.set({ tool: 'pipe', height: 300 });
    ctrl.click({ x: 3000, z: 1000 }, 20);
    ctrl.hoverAt({ x: 3000, z: 2000 }, 20);
    const first = ctrl.hover;
    ctrl.hoverAt({ x: 9070, z: 2000 }, 60);
    expect(ctrl.hover).toBe(first); // samme objekt gjenbrukes
    expect(ctrl.hover?.snap).toBe('vegg');
    expect(ctrl.liveLength()).toBeCloseTo(Math.hypot(ctrl.hover!.p.x - 3000, ctrl.hover!.p.z - 1000), 6);
  });
});

describe('oversikt', () => {
  it('summerer kabel per kurs og rør per type', () => {
    const s = summarize(model, { existing: true });
    const k2 = s.circuits.find((c) => c.id === 'kurs-2')!;
    expect(k2.length).toBeCloseTo(1750 + Math.hypot(100, 2500) + 750, 6);
    const cold = s.pipes.find((p) => p.kind === 'cold')!;
    expect(cold.length).toBeGreaterThan(cold.planned);
    expect(s.water.tap).toBe(2);
    expect(summarize(model).materials.some((m) => m.startsWith('Kabel – '))).toBe(true);
    const all = summarize(model, { existing: true });
    const total = all.cables.reduce((t, c) => t + c.length, 0);
    expect(total).toBeCloseTo(all.circuits.reduce((t, c) => t + c.length, 0), 6);
  });

  it('avløpsfall: 1:60 mot den laveste enden, uansett tegneretning', async () => {
    const { hasFall, DRAIN_FALL } = await import('../../src/plan/summary');
    // 3 m vannrett med 60 mm fall = 1:50: nok.
    expect(hasFall([[0, 400, 0], [3000, 340, 0]], DRAIN_FALL)).toBe(true);
    expect(hasFall([[3000, 340, 0], [0, 400, 0]], DRAIN_FALL)).toBe(true); // tegnet motsatt vei
    // 3 m med 30 mm fall = 1:100: for lite (sjekket mot 1:60, som teksten sier).
    expect(hasFall([[0, 400, 0], [3000, 370, 0]], DRAIN_FALL)).toBe(false);
    expect(hasFall([[0, 400, 0], [3000, 400, 0]], DRAIN_FALL)).toBe(false);
    // Stigning først, så fall: stigningen teller ikke.
    expect(hasFall([[0, 900, 0], [0, 400, 0], [3000, 340, 0]], DRAIN_FALL)).toBe(true);
    // Feil vei på ett strekk.
    expect(hasFall([[0, 400, 0], [1500, 420, 0], [3000, 300, 0]], DRAIN_FALL)).toBe(false);
  });

  it('hint: skrå kabel i vegg', () => {
    expect(planHints(model).some((h) => h.includes('kabel-planterom') || h.includes('Ny kurs til planterom'))).toBe(true);
  });
});

describe('filtre og eldre filer', () => {
  it('kursfilteret viser bare kabler og punkter i den kursen', async () => {
    const { passes, NO_FILTER } = await import('../../src/scene/ApartmentScene');
    const f = { ...NO_FILTER, circuit: 'kurs-2' };
    expect(passes({ kind: 'wire', status: 'planned', circuit: 'kurs-2' }, f)).toBe(true);
    expect(passes({ kind: 'wire', status: 'planned', circuit: 'kurs-1' }, f)).toBe(false);
    expect(passes({ kind: 'wire', status: 'planned' }, f)).toBe(false); // kabel uten kurs
    expect(passes({ kind: 'fixture', status: 'existing', circuit: 'kurs-1' }, f)).toBe(false);
    expect(passes({ kind: 'fixture', status: 'existing' }, f)).toBe(true); // f.eks. kran
    expect(passes({ kind: 'wall' }, f)).toBe(true);
    expect(passes({ kind: 'pipe', status: 'planned' }, { ...NO_FILTER, planned: false })).toBe(false);
  });

  it('en fil uten «pipes» og «circuits» er gyldig og tegnes', async () => {
    const { buildParts } = await import('../../src/scene/buildParts');
    const old = loadDoc() as unknown as Record<string, unknown>;
    delete old.pipes;
    delete old.circuits;
    for (const w of (old.wiring as { circuit?: string }[])) delete w.circuit;
    for (const f of (old.fixtures as { circuit?: string }[])) delete f.circuit;
    const r = validateApartment(old);
    expect(r.errors).toEqual([]);
    expect(r.model!.data.pipes).toEqual([]);
    expect(r.model!.data.circuits).toEqual([]);
    expect(buildParts(r.model!).length).toBeGreaterThan(50);
    expect(summarize(r.model!).pipes).toEqual([]);
  });

  it('«Velg» treffer ikke det som er skjult', () => {
    expect(pickNearest(model, { x: 40, z: 3000 }, 100, (o) => o.layer !== 'wiring')).toBeNull();
  });
});

describe('tegninger laget mot en eldre fil', () => {
  class KV {
    readonly m = new Map<string, string>();
    getItem(k: string): string | null {
      return this.m.get(k) ?? null;
    }
    setItem(k: string, v: string): void {
      this.m.set(k, v);
    }
    removeItem(k: string): void {
      this.m.delete(k);
    }
  }
  const cable = { id: 'kabel-x', kind: 'power', status: 'planned', layer: 'el-planlagt', points: [[1000, 300, 1000], [2000, 300, 1000]] };

  it('blir rom og vegger byttet (f.eks. publisert fra en annen enhet), sier den fra – til man har sjekket dem', () => {
    const kv = new KV();
    const a = loadDoc();
    new PlanEdits(a, kv).put('wiring', cable);
    // Samme fil: ingenting å si fra om.
    expect(new PlanEdits(a, kv).olderFile).toBe(0);
    // Ny fil med et rom flyttet 50 mm.
    const b = loadDoc();
    b.rooms[0]!.polygon = b.rooms[0]!.polygon.map(([x, z]) => [(x as number) + 50, z]) as typeof b.rooms[0]['polygon'];
    const e = new PlanEdits(b, kv);
    expect(e.olderFile).toBe(1);
    expect(e.size).toBe(1);
    // Også etter omlasting, til man sier at de ligger riktig.
    expect(new PlanEdits(b, kv).olderFile).toBe(1);
    e.acceptOlder();
    expect(e.olderFile).toBe(0);
    expect(new PlanEdits(b, kv).olderFile).toBe(0);
  });

  it('eldre lagring uten avtrykk regnes som tegnet på fila slik den er', () => {
    const kv = new KV();
    kv.setItem('leilighet:plan:v1', JSON.stringify({ version: 1, ops: [{ op: 'put', c: 'wiring', obj: cable }] }));
    expect(new PlanEdits(loadDoc(), kv).olderFile).toBe(0);
  });
});
