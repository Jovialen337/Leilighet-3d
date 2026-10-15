import { describe, expect, it } from 'vitest';
import {
  addOpening,
  addRect,
  addRoomBeside,
  copyRoom,
  deleteCorner,
  distributeEvenly,
  insertCorner,
  linkedEdges,
  moveCorner,
  moveEdge,
  rotateRoom90,
  setEntrance,
  setPartitionThickness,
  straighten,
} from '../../src/builder/ops';
import { snapPoint } from '../../src/builder/snap';
import { roomsOverlap } from '../../src/builder/geometry';
import { BuilderSession, BUILDER_KEY } from '../../src/builder/BuilderSession';
import { compile } from '../../src/builder/compile';
import { deriveWalls } from '../../src/builder/walls';
import { alongEdge, edgesOf, isAxisAligned, type P2 } from '../../src/builder/geometry';
import type { BOpening, BuilderDoc } from '../../src/builder/types';
import { emptyBuilderDoc } from '../../src/builder/types';
import { validateApartment } from '../../src/schema/validate';
import type { ApartmentDoc } from '../../src/schema/types';
import type { KV } from '../../src/state/persist';

/** Midtpunktet til en åpning (mm, i planen), eller null. */
function openingCenter(doc: BuilderDoc, o: BOpening): P2 | null {
  const room = doc.rooms.find((r) => r.id === o.room);
  const e = room ? edgesOf(room.polygon)[o.edge] : undefined;
  return e && e.length > 0 ? alongEdge(e, o.offset + o.width / 2) : null;
}

class MemoryKV implements KV {
  readonly data = new Map<string, string>();
  fail = false;
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (this.fail) throw new Error('full');
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
}

/** Gang 3000 × 2000 med inngangsdør på venstre vegg. */
function start() {
  const d = emptyBuilderDoc();
  const gang = addRect(d, { x: 0, z: 0 }, { x: 3000, z: 2000 }, 'Gang', 0);
  const door = addOpening(d, 'door', gang.id, 3, 1500)!;
  return { d, gang, door };
}

describe('redigering', () => {
  it('første dør i en yttervegg blir inngangsdøra', () => {
    const { d, door } = start();
    expect(door.entrance).toBe(true);
    const next = addOpening(d, 'door', 'gang', 1, 1000)!;
    expect(next.entrance).toBeUndefined();
    setEntrance(d, next.id);
    expect(d.openings.filter((o) => o.entrance).map((o) => o.id)).toEqual([next.id]);
  });

  it('nytt hjørne og fjernet hjørne flytter ikke døra', () => {
    const { d, gang, door } = start();
    const before = openingCenter(d, door)!;
    // Del kanten før døra (topp-kanten, nr. 0) og kanten døra står på (nr. 3).
    insertCorner(d, gang.id, 0, 1000);
    insertCorner(d, gang.id, 4, 300);
    const after = openingCenter(d, d.openings[0]!)!;
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(1);
    deleteCorner(d, gang.id, 1);
    const again = openingCenter(d, d.openings[0]!)!;
    expect(Math.hypot(again.x - before.x, again.z - before.z)).toBeLessThan(1);
  });

  it('rom ved siden av får en skillevegg med riktig tykkelse, og døra mellom går inn i det nye rommet', () => {
    const { d, gang } = start();
    const stue = addRoomBeside(d, gang.id, 1, 4000, 'Stue')!;
    expect(stue.polygon.map((p) => p.x)).toContain(3100);
    const walls = deriveWalls(d.rooms, d.settings);
    expect(walls.walls.filter((w) => w.kind === 'interior').map((w) => w.thickness)).toEqual([100]);
    addOpening(d, 'door', gang.id, 1, 1000);
    const r = compile(d, { normalize: true });
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(r.doc!.openings.find((o) => o.type === 'door' && !('entrance' in o && o.entrance))).toMatchObject({ into: stue.id });
    expect(validateApartment(r.doc).warnings).toEqual([]);
  });

  it('å flytte en kant flytter også naborommets kant, så veggen beholder tykkelsen', () => {
    const { d, gang } = start();
    const stue = addRoomBeside(d, gang.id, 1, 4000, 'Stue')!;
    expect(linkedEdges(d, gang.id, 1)).toEqual([{ room: stue.id, edge: expect.any(Number) }]);
    moveEdge(d, gang.id, 1, 500);
    expect(Math.max(...d.rooms[0]!.polygon.map((p) => p.x))).toBe(3500);
    expect(Math.min(...d.rooms[1]!.polygon.map((p) => p.x))).toBe(3600);
    moveEdge(d, gang.id, 1, -200, false);
    expect(Math.max(...d.rooms[0]!.polygon.map((p) => p.x))).toBe(3300);
    expect(Math.min(...d.rooms[1]!.polygon.map((p) => p.x))).toBe(3600);
  });

  it('«Fordel jevnt» gir like mellomrom mellom vinduene', () => {
    const d = emptyBuilderDoc();
    const stue = addRect(d, { x: 0, z: 0 }, { x: 3200, z: 2500 }, 'Stue');
    addOpening(d, 'window', stue.id, 0, 500);
    addOpening(d, 'window', stue.id, 0, 2600);
    expect(distributeEvenly(d, stue.id, 0)).toBe(2);
    expect(d.openings.map((o) => o.offset)).toEqual([400, 1800]);
  });

  it('skilleveggens tykkelse settes ved å flytte naborommet', () => {
    const { d, gang } = start();
    const stue = addRoomBeside(d, gang.id, 1, 4000, 'Stue')!;
    expect(setPartitionThickness(d, gang.id, 1, 150)).toBe(1);
    expect(Math.max(...d.rooms[0]!.polygon.map((p) => p.x))).toBe(3000);
    expect(Math.min(...d.rooms.find((r) => r.id === stue.id)!.polygon.map((p) => p.x))).toBe(3150);
    expect(deriveWalls(d.rooms, d.settings).walls.filter((w) => w.kind === 'interior').map((w) => w.thickness)).toEqual([150]);
    // Samme tykkelse igjen: ingenting å gjøre.
    expect(setPartitionThickness(d, gang.id, 1, 150)).toBe(0);
  });

  it('«Kopier rommet» legger kopien inntil originalen med skillevegg, med vinduene men uten inngangsdøra', () => {
    const { d, gang } = start();
    addOpening(d, 'window', gang.id, 0, 1500);
    const copy = copyRoom(d, gang.id)!;
    expect(copy.name).toBe('Gang 2');
    expect(Math.min(...copy.polygon.map((p) => p.x))).toBe(3100);
    expect(roomsOverlap(copy.polygon, gang.polygon)).toBe(false);
    const mine = d.openings.filter((o) => o.room === copy.id);
    expect(mine.map((o) => o.type).sort()).toEqual(['door', 'window']);
    expect(mine.some((o) => o.entrance)).toBe(false);
    expect(d.openings.filter((o) => o.entrance)).toHaveLength(1);
    expect(deriveWalls(d.rooms, d.settings).walls.filter((w) => w.kind === 'interior')).toHaveLength(1);
    // Er plassen til høyre tatt, havner neste kopi under.
    const third = copyRoom(d, gang.id)!;
    expect(Math.min(...third.polygon.map((p) => p.z))).toBe(2100);
  });

  it('«Roter 90°» dreier rommet om midten, og døra følger med', () => {
    const { d, gang, door } = start();
    rotateRoom90(d, gang.id);
    const xs = gang.polygon.map((p) => p.x);
    const zs = gang.polygon.map((p) => p.z);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(2000);
    expect(Math.max(...zs) - Math.min(...zs)).toBe(3000);
    // Døra satt på venstre vegg; etter dreiing med klokka sitter den på toppen.
    const c = openingCenter(d, door)!;
    expect(c.z).toBe(Math.min(...zs));
  });

  it('festing på skrå (45°) runder sidene, ikke diagonalen', () => {
    const d = emptyBuilderDoc();
    const s = snapPoint(d, { x: 2993, z: 3008 }, { tol: 20, prev: { x: 0, z: 0 } });
    expect(s).toMatchObject({ p: { x: 3000, z: 3000 }, kind: 'vinkel' });
    const t = snapPoint(d, { x: -1504, z: 1497 }, { tol: 20, prev: { x: 5, z: 0 } });
    expect(t.p).toEqual({ x: -1495, z: 1500 });
  });

  it('«Rett opp» gir rette vinkler og legger nesten like linjer på linje', () => {
    const d = emptyBuilderDoc();
    addRect(d, { x: 0, z: 0 }, { x: 3000, z: 2000 }, 'Gang');
    const b = addRect(d, { x: 3100, z: 12 }, { x: 6000, z: 2000 }, 'Stue');
    moveCorner(d, b.id, 2, { x: 6025, z: 2010 });
    straighten(d);
    for (const r of d.rooms) expect(isAxisAligned(r.polygon, 0, 0.01)).toBe(true);
    // Toppkantene (z ≈ 0 og 12) er lagt på samme linje.
    expect(Math.min(...d.rooms[1]!.polygon.map((p) => p.z))).toBe(Math.min(...d.rooms[0]!.polygon.map((p) => p.z)));
  });
});

describe('arbeidsøkten', () => {
  it('lagres, angres og gjøres om, og et drag er ett angre-steg', () => {
    const kv = new MemoryKV();
    const s = new BuilderSession(kv);
    s.start(emptyBuilderDoc('Min leilighet'));
    s.apply((d) => void addRect(d, { x: 0, z: 0 }, { x: 3000, z: 2000 }, 'Gang'));
    s.beginGesture();
    for (let i = 1; i <= 5; i++) s.apply((d) => moveCorner(d, 'gang', 1, { x: 3000 + i * 100, z: 0 }));
    s.endGesture();
    expect(s.doc!.rooms[0]!.polygon[1]).toMatchObject({ x: 3500 });
    s.undo();
    expect(s.doc!.rooms[0]!.polygon[1]).toMatchObject({ x: 3000 });
    s.redo();
    expect(s.doc!.rooms[0]!.polygon[1]).toMatchObject({ x: 3500 });
    // Overlever omlasting.
    const again = new BuilderSession(kv);
    expect(again.doc!.rooms[0]!.polygon[1]).toMatchObject({ x: 3500 });
    expect(again.doc!.name).toBe('Min leilighet');
  });

  it('tåler ødelagt og full lagring', () => {
    const kv = new MemoryKV();
    kv.setItem(BUILDER_KEY, '{tull');
    expect(new BuilderSession(kv).doc).toBeNull();
    kv.setItem(BUILDER_KEY, JSON.stringify({ version: 1, doc: { version: 1, name: 'x', rooms: [{ id: 3 }], openings: [] } }));
    expect(new BuilderSession(kv).doc).toBeNull();
    const s = new BuilderSession(kv);
    kv.fail = true;
    s.start(emptyBuilderDoc());
    s.apply((d) => void addRect(d, { x: 0, z: 0 }, { x: 1000, z: 1000 }));
    expect(s.doc!.rooms).toHaveLength(1);
  });

  it('eksport gir gyldig fil; når den er publisert ryddes tegningen – men ikke hvis den er endret etterpå', () => {
    const kv = new MemoryKV();
    const s = new BuilderSession(kv);
    const { d } = start();
    s.start(d);
    const text = s.exportText(new Date(2026, 9, 14))!;
    const file = JSON.parse(text) as ApartmentDoc;
    expect(validateApartment(file).ok).toBe(true);
    expect(file.meta.updated).toBe('2026-10-14');
    expect(new BuilderSession(kv).checkPublished(file)).toBe(true);
    expect(new BuilderSession(kv).doc).toBeNull();

    const kv2 = new MemoryKV();
    const s2 = new BuilderSession(kv2);
    s2.start(start().d);
    const file2 = JSON.parse(s2.exportText()!) as ApartmentDoc;
    s2.apply((doc) => moveCorner(doc, 'gang', 1, { x: 3200, z: 0 }));
    const s3 = new BuilderSession(kv2);
    expect(s3.checkPublished(file2)).toBe(true);
    expect(s3.published).toBe('kept');
    expect(s3.doc).not.toBeNull();
  });

  it('tegningen kan lagres som fil og åpnes igjen; feil filer avvises', () => {
    const s = new BuilderSession(new MemoryKV());
    s.start(start().d);
    const text = s.draftText()!;
    const t = new BuilderSession(new MemoryKV());
    expect(t.openDraft(text)).toBeNull();
    expect(t.doc!.rooms[0]!.name).toBe('Gang');
    expect(t.openDraft('{"rooms": 3}')).toMatch(/ikke en tegning/);
    expect(t.openDraft('tull')).toMatch(/ikke gyldig JSON/);
  });
});

describe('tegninger som er ødelagt eller tatt med fra den gamle modellen', () => {
  /** En tegning der første rom mangler navn (slapp gjennom den gamle sjekken og krasjet oppstarten). */
  const nameless = () => {
    const d = structuredClone(start().d) as any;
    delete d.rooms[0].name;
    return d;
  };

  it('en lagret tegning som ikke kan leses, legges til side – oppstarten går som normalt', () => {
    const kv = new MemoryKV();
    kv.setItem(BUILDER_KEY, JSON.stringify({ version: 1, doc: nameless() }));
    const s = new BuilderSession(kv);
    expect(s.doc).toBeNull();
    expect(s.recovered).toContain('mangler navn');
    expect(s.compiled()).toBeNull();
    // Ikke slettet: lagt til side under en egen nøkkel.
    expect(kv.getItem(BUILDER_KEY)).toBeNull();
    expect(JSON.parse(kv.getItem(`${BUILDER_KEY}:ødelagt`)!).doc.rooms).toHaveLength(1);
    // Neste gang starter den helt rent.
    expect(new BuilderSession(kv).recovered).toBeNull();
  });

  it('en fil der et rom mangler navn eller mål, avvises med riktig forklaring – tegningen er uendret', () => {
    const kv = new MemoryKV();
    const s = new BuilderSession(kv);
    s.start(start().d);
    const before = JSON.stringify(s.doc);
    expect(s.openDraft(JSON.stringify({ version: 1, doc: nameless() }))).toMatch(/kan ikke åpnes.*mangler navn/);
    const noCeiling = structuredClone(start().d) as any;
    noCeiling.rooms[0].ceiling = 'høy';
    expect(s.openDraft(JSON.stringify(noCeiling))).toMatch(/gulvnivå eller takhøyde/);
    const badOpening = structuredClone(start().d) as any;
    badOpening.openings[0].edge = 1.5;
    expect(s.openDraft(JSON.stringify(badOpening))).toMatch(/sitter ikke på en kant/);
    const badExtras = structuredClone(start().d) as any;
    badExtras.extras = { wiring: [{ id: 'k', points: 'feil' }] };
    expect(s.openDraft(JSON.stringify(badExtras))).toMatch(/ødelagt/);
    expect(JSON.stringify(s.doc)).toBe(before);
    expect(JSON.parse(kv.getItem(BUILDER_KEY)!).doc).toEqual(JSON.parse(before));
  });

  it('kompilering kaster aldri: en uventet feil blir en melding i sjekklisten', () => {
    const s = new BuilderSession(new MemoryKV());
    s.start(start().d);
    s.apply((d) => void ((d.rooms[0] as any).polygon = null));
    const r = s.compiled()!;
    expect(r.doc).toBeNull();
    expect(r.issues[0]).toMatchObject({ severity: 'error', message: expect.stringContaining('kunne ikke gjøres om') });
    expect(s.exportText()).toBeNull();
  });

  it('den forrige tegningen huskes når en ny startes eller den forkastes, og kan hentes igjen', () => {
    const kv = new MemoryKV();
    const s = new BuilderSession(kv);
    expect(s.previous()).toBeNull();
    s.start(start().d);
    s.apply((d) => void (d.name = 'Første'));
    s.start(emptyBuilderDoc('Andre'));
    expect(s.previous()?.name).toBe('Første');
    // Også etter omlasting.
    const t = new BuilderSession(kv);
    expect(t.restorePrevious()).toBe(true);
    expect(t.doc!.name).toBe('Første');
    t.discard();
    expect(new BuilderSession(kv).previous()?.name).toBe('Første');
  });

  it('det som ble tatt med fra den gamle modellen, huskes og gis tilbake én gang når eksporten er publisert', () => {
    const kv = new MemoryKV();
    const s = new BuilderSession(kv);
    s.start(start().d, { plan: ['a1', 'b2'], measure: 'm3' });
    const file = JSON.parse(s.exportText()!) as ApartmentDoc;
    // Omlasting før publisering: fortsatt husket.
    const t = new BuilderSession(kv);
    expect(t.consumed).toEqual({ plan: ['a1', 'b2'], measure: 'm3' });
    expect(t.checkPublished(file)).toBe(true);
    expect(t.takeConsumed()).toEqual({ plan: ['a1', 'b2'], measure: 'm3' });
    expect(t.takeConsumed()).toBeNull();
    // En tom tegning tar ikke med noe.
    const u = new BuilderSession(new MemoryKV());
    u.start(start().d);
    expect(u.checkPublished(JSON.parse(u.exportText()!))).toBe(true);
    expect(u.takeConsumed()).toBeNull();
  });
});

describe('en importert modell overlever lagring', () => {
  it('«Start fra nåværende modell» med den publiserte fila og plassholderen gir en tegning som leses inn igjen', async () => {
    const { importApartment } = await import('../../src/builder/importDoc');
    const { loadDoc, PUBLISHED_PATH } = await import('./helpers');
    const { readFileSync } = await import('node:fs');
    for (const raw of [loadDoc(), JSON.parse(readFileSync(PUBLISHED_PATH, 'utf8'))]) {
      const r = importApartment(raw);
      if (!r.ok) throw new Error(r.message);
      const kv = new MemoryKV();
      new BuilderSession(kv).start(r.doc);
      const again = new BuilderSession(kv);
      expect(again.recovered).toBeNull();
      expect(again.doc!.rooms).toHaveLength(r.doc.rooms.length);
      expect(again.compiled()!.doc).not.toBeNull();
    }
  });
});
