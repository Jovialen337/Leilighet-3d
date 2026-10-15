import { describe, expect, it } from 'vitest';
import {
  addOpening,
  addRect,
  addRoom,
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
  roomFrame,
  splitRoom,
  straighten,
} from '../../src/builder/ops';
import { snapPoint } from '../../src/builder/snap';
import { roomsOverlap } from '../../src/builder/geometry';
import { BuilderSession, BUILDER_KEY } from '../../src/builder/BuilderSession';
import { compile, compileChecked } from '../../src/builder/compile';
import { importApartment } from '../../src/builder/importDoc';
import { readFileSync } from 'node:fs';
import { PUBLISHED_PATH } from './helpers';
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

  it('«Del rommet» gir to rom med skillevegg; vinduer følger sin side; skillet går ikke gjennom en dør', () => {
    const d = emptyBuilderDoc();
    const stue = addRect(d, { x: 0, z: 0 }, { x: 4000, z: 3000 }, 'Stue');
    stue.polygon = stue.polygon.map((p) => ({ ...p, m: true }));
    addOpening(d, 'window', stue.id, 0, 3000)!; // midt på x 2500–3500: på høyre side
    addOpening(d, 'window', stue.id, 2, 3000)!; // nederst, x 500–1500 (kanten går fra høyre mot venstre)
    const across = addOpening(d, 'door', stue.id, 0, 2000)!; // x 1550–2450: skillet ved 2000 går gjennom den
    across.name = 'Stuedør';
    const refused = splitRoom(d, stue.id, 'x', 2000);
    expect(refused).toEqual({ ok: false, message: 'Skillet går gjennom «Stuedør» i «Stue». Del rommet et annet sted, eller flytt åpningen først.' });
    expect(d.rooms).toHaveLength(1);
    // Døra flyttes til venstre: nå går det.
    across.offset = 600;
    const r = splitRoom(d, stue.id, 'x', 2000);
    if (!r.ok) throw new Error(r.message);
    expect(r.dropped).toBe(0);
    const xs = (id: string) => d.rooms.find((x) => x.id === id)!.polygon.map((p) => p.x);
    expect([Math.min(...xs(r.a.id)), Math.max(...xs(r.a.id))]).toEqual([0, 1950]);
    expect([Math.min(...xs(r.b.id)), Math.max(...xs(r.b.id))]).toEqual([2050, 4000]);
    expect(r.b.name).toBe('Stue 2');
    // Hjørnene som var målt, er fortsatt målt; de nye hjørnene ved skillet er det ikke.
    expect(r.a.polygon.filter((p) => p.m)).toHaveLength(2);
    // Vinduene sitter der de satt.
    const top = d.openings.find((o) => o.room === r.b.id)!;
    const e = edgesOf(r.b.polygon)[top.edge]!;
    expect(alongEdge(e, top.offset + top.width / 2)).toEqual({ x: 3000, z: 0 });
    const bottom = d.openings.find((o) => o.room === r.a.id && o.type === 'window')!;
    const f = edgesOf(r.a.polygon)[bottom.edge]!;
    expect(alongEdge(f, bottom.offset + bottom.width / 2)).toEqual({ x: 1000, z: 3000 });
    // Én skillevegg på 100 mm mellom dem.
    expect(deriveWalls(d.rooms, d.settings).walls.filter((w) => w.kind === 'interior').map((w) => w.thickness)).toEqual([100]);
  });

  it('«Del rommet»: en dør inn i rommet fra et naborom går inn i delen den står mot', () => {
    const d = emptyBuilderDoc();
    const gang = addRect(d, { x: 0, z: 0 }, { x: 4000, z: 2000 }, 'Gang');
    const bod = addRoomBeside(d, gang.id, 2, 2000, 'Bod')!; // under gangen, 100 mm skillevegg
    // Døra sitter i boden (som ved import), og går inn i gangen.
    const e = edgesOf(bod.polygon).find((x) => Math.abs(x.u.x) > 0.9 && Math.min(x.a.z, x.b.z) < 2200)!;
    const door = addOpening(d, 'door', bod.id, e.i, 3000)!;
    door.into = gang.id;
    const r = splitRoom(d, gang.id, 'x', 2000);
    if (!r.ok) throw new Error(r.message);
    // Døra står ved x ≈ 3000, altså mot den nye delen: «går inn i» regnes ut på nytt.
    expect(door.into).toBeUndefined();
    const out = compileChecked(d);
    expect(out.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(out.doorInto.get(door.id)).toBe(r.b.id);
  });

  it('«Del rommet» på den publiserte fila: dører inn i rommet peker på riktig del, og fila er gyldig', () => {
    const imp = importApartment(JSON.parse(readFileSync(PUBLISHED_PATH, 'utf8')) as ApartmentDoc);
    if (!imp.ok) throw new Error(imp.message);
    const split: string[] = [];
    for (const id of imp.doc.rooms.map((r) => r.id)) {
      const d = structuredClone(imp.doc);
      const room = d.rooms.find((r) => r.id === id)!;
      const xs = room.polygon.map((p) => p.x);
      const zs = room.polygon.map((p) => p.z);
      // Forslaget i panelet: midt i, på tvers av den lengste siden.
      const wide = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs);
      const v = wide ? xs : zs;
      const at = Math.round((Math.min(...v) + Math.max(...v)) / 2 / 10) * 10;
      const r = splitRoom(d, id, wide ? 'x' : 'z', at);
      if (!r.ok) {
        // Bare fordi skillet ville gått gjennom en åpning – aldri en ugyldig fil.
        expect(r.message).toMatch(/går gjennom|minst 0,25 m²/);
        continue;
      }
      split.push(id);
      // Ingen dør peker på et rom som ikke lenger ligger ved døra.
      const out = compileChecked(d, { normalize: true });
      expect({ id, errors: out.issues.filter((i) => i.severity === 'error').map((i) => i.message) }).toEqual({ id, errors: [] });
      expect(out.issues.some((i) => i.message.includes('som ikke ligger ved veggen'))).toBe(false);
    }
    // Badet (med «Baddør» inn fra stua) kan deles, og gir en gyldig fil.
    expect(split).toContain('bad');
  });

  it('«Del rommet» av et rom med skrått tak gir takhøyder fra takets plan', () => {
    const d = emptyBuilderDoc();
    const r0 = addRect(d, { x: 0, z: 0 }, { x: 4000, z: 3000 }, 'Stue');
    // Taket stiger 100 mm per meter mot høyre.
    r0.ceilingCorners = [2400, 2800, 2800, 2400];
    const r = splitRoom(d, r0.id, 'x', 2000);
    if (!r.ok) throw new Error(r.message);
    const at = (room: typeof r0, x: number) => room.ceilingCorners![room.polygon.findIndex((p) => p.x === x)]!;
    expect(at(r.a, 0)).toBe(2400);
    expect(at(r.a, 1950)).toBe(2595);
    expect(at(r.b, 2050)).toBe(2605);
    expect(at(r.b, 4000)).toBe(2800);
  });

  it('«Del rommet» tvers over en U (en side ville blitt to rom) avvises', () => {
    const d = emptyBuilderDoc();
    const u = addRoom(d, [
      { x: 0, z: 0 },
      { x: 1500, z: 0 },
      { x: 1500, z: 3000 },
      { x: 2500, z: 3000 },
      { x: 2500, z: 0 },
      { x: 4000, z: 0 },
      { x: 4000, z: 4000 },
      { x: 0, z: 4000 },
    ]);
    const r = splitRoom(d, u.id, 'z', 1500);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('formet som en U');
    expect(d.rooms).toHaveLength(1);
    // Under U-en (der den er hel) går det fint.
    expect(splitRoom(d, u.id, 'z', 3400).ok).toBe(true);
    // Og en L kan deles gjennom det innvendige hjørnet.
    const e = emptyBuilderDoc();
    const l = addRoom(e, [
      { x: 0, z: 0 },
      { x: 4000, z: 0 },
      { x: 4000, z: 2000 },
      { x: 2000, z: 2000 },
      { x: 2000, z: 4000 },
      { x: 0, z: 4000 },
    ]);
    expect(splitRoom(e, l.id, 'x', 2000).ok).toBe(true);
  });

  describe('«Del rommet» i rom med innhakk (L, U, T, kam), skillet hvor som helst', () => {
    const shapes: Record<string, [number, number][]> = {
      L: [[0, 0], [4000, 0], [4000, 2000], [2000, 2000], [2000, 4000], [0, 4000]],
      U: [[0, 0], [1500, 0], [1500, 3000], [2500, 3000], [2500, 0], [4000, 0], [4000, 4000], [0, 4000]],
      T: [[0, 0], [6000, 0], [6000, 1000], [4000, 1000], [4000, 4000], [2000, 4000], [2000, 1000], [0, 1000]],
      kam: [[0, 0], [1000, 0], [1000, 2000], [1500, 2000], [1500, 0], [2500, 0], [2500, 2000], [3000, 2000], [3000, 0], [4000, 0], [4000, 3000], [0, 3000]],
    };
    const make = (pts: [number, number][]) => {
      const d = emptyBuilderDoc();
      const r = addRoom(d, pts.map(([x, z]) => ({ x, z })), 'Stue');
      return { d, r };
    };
    /** Snur polygonet rett tilbake på seg selv noe sted (en «nål»)? */
    const needle = (poly: { x: number; z: number }[]): boolean =>
      poly.some((b, i) => {
        const a = poly[(i - 1 + poly.length) % poly.length]!;
        const c = poly[(i + 1) % poly.length]!;
        const u = { x: b.x - a.x, z: b.z - a.z };
        const v = { x: c.x - b.x, z: c.z - b.z };
        return Math.abs(u.x * v.z - u.z * v.x) < 1 && u.x * v.x + u.z * v.z < 0;
      });
    const area = (poly: { x: number; z: number }[]) => Math.abs(poly.reduce((s, p, i) => s + p.x * poly[(i + 1) % poly.length]!.z - poly[(i + 1) % poly.length]!.x * p.z, 0) / 2);

    it('skillevegg som flukter med en vegg som er der fra før, gir ingen «nål»', () => {
      for (const [name, axis, at] of [
        ['L', 'x', 1950],
        ['L', 'z', 1950],
        ['U', 'x', 1450],
        ['U', 'x', 2550],
        ['T', 'x', 1950],
        ['T', 'z', 1050],
      ] as const) {
        const { d, r } = make(shapes[name]!);
        const res = splitRoom(d, r.id, axis, at);
        if (!res.ok) throw new Error(`${name} ${axis}=${at}: ${res.message}`);
        expect({ name, axis, at, a: needle(res.a.polygon), b: needle(res.b.polygon) }).toEqual({ name, axis, at, a: false, b: false });
      }
      // L flukt med det innvendige hjørnet: delen til høyre er et rent rektangel.
      const { d, r } = make(shapes.L!);
      const res = splitRoom(d, r.id, 'x', 1950);
      if (!res.ok) throw new Error(res.message);
      expect(res.b.polygon.map(({ x, z }) => [x, z])).toEqual([
        [2000, 0],
        [4000, 0],
        [4000, 2000],
        [2000, 2000],
      ]);
      // Skilleveggen stopper ved hjørnet (ikke 4 m lang), og det blir ingen yttervegg langs en «nål».
      const walls = deriveWalls(d.rooms, d.settings).walls;
      const inner = walls.filter((w) => w.kind === 'interior');
      expect(inner).toHaveLength(1);
      expect(Math.hypot(inner[0]!.end.x - inner[0]!.start.x, inner[0]!.end.z - inner[0]!.start.z)).toBeCloseTo(2000, -1);
    });

    it('hver tillatte deling, i steg på 50 mm, gir to enkle rom uten nåler, og arealet går opp', () => {
      let allowed = 0;
      for (const [name, pts] of Object.entries(shapes)) {
        const xs = pts.map((p) => p[0]);
        const zs = pts.map((p) => p[1]);
        for (const axis of ['x', 'z'] as const) {
          const v = axis === 'x' ? xs : zs;
          for (let at = Math.min(...v); at <= Math.max(...v); at += 50) {
            const { d, r } = make(pts);
            const before = area(r.polygon);
            const res = splitRoom(d, r.id, axis, at);
            if (!res.ok) continue;
            allowed++;
            for (const part of [res.a, res.b]) {
              expect({ name, axis, at, needle: needle(part.polygon) }).toEqual({ name, axis, at, needle: false });
            }
            // Delene + skilleveggens stripe = hele rommet (stripa er høyst 100 mm × rommets bredde).
            const lost = before - area(res.a.polygon) - area(res.b.polygon);
            expect(lost).toBeGreaterThan(0);
            expect(lost).toBeLessThanOrEqual(100 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) + 1);
          }
        }
      }
      expect(allowed).toBeGreaterThan(100);
    });

    it('en stripe smalere enn 50 cm avvises', () => {
      const { d, r } = make(shapes.L!);
      const res = splitRoom(d, r.id, 'x', 3700);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.message).toContain('minst 50 cm');
    });
  });

  it('«Del rommet» i et rom som står dreid i planen (målt i gjennomsyn): skillet følger rommets kanter', () => {
    const d = emptyBuilderDoc();
    const a = (20 * Math.PI) / 180;
    const rot = (x: number, z: number) => ({ x: Math.round(1000 + x * Math.cos(a) - z * Math.sin(a)), z: Math.round(500 + x * Math.sin(a) + z * Math.cos(a)) });
    const r0 = addRoom(d, [rot(0, 0), rot(4000, 0), rot(4000, 3000), rot(0, 3000)], 'Stue');
    const fr = roomFrame(r0);
    expect(fr.deg).toBeCloseTo(20, 1);
    // Midt i rommet, målt langs rommet.
    const xs = r0.polygon.map((p) => fr.toLocal(p).x);
    const at = (Math.min(...xs) + Math.max(...xs)) / 2;
    const r = splitRoom(d, r0.id, 'x', at);
    if (!r.ok) throw new Error(r.message);
    // Begge delene er rektangler med kanter langs rommets retning (ikke skrå trapeser).
    for (const part of [r.a, r.b]) {
      expect(part.polygon).toHaveLength(4);
      for (const e of edgesOf(part.polygon)) {
        const deg = (((Math.atan2(e.u.z, e.u.x) * 180) / Math.PI - 20 + 360) % 90 + 90) % 90;
        expect(Math.min(deg, 90 - deg)).toBeLessThan(0.1);
      }
      const ls = part.polygon.map((p) => fr.toLocal(p));
      const w = Math.max(...ls.map((p) => p.x)) - Math.min(...ls.map((p) => p.x));
      expect(Math.abs(w - 1950)).toBeLessThanOrEqual(2);
    }
    // Én skillevegg på 100 mm, ingen varsel om skjeve rom.
    const walls = deriveWalls(d.rooms, d.settings);
    expect(walls.skewed).toEqual([]);
    expect(walls.walls.filter((w) => w.kind === 'interior').map((w) => w.thickness)).toEqual([100]);
  });

  it('«Del rommet» av et målt skrått tak: de nye høydene er regnet ut, ikke målt', () => {
    const d = emptyBuilderDoc();
    const r0 = addRect(d, { x: 0, z: 0 }, { x: 4000, z: 3000 }, 'Stue');
    r0.ceilingCorners = [2400, 2800, 2800, 2400];
    r0.ceilingMeasured = true;
    const r = splitRoom(d, r0.id, 'x', 2000);
    if (!r.ok) throw new Error(r.message);
    expect(r.a.ceilingMeasured).toBeUndefined();
    expect(r.b.ceilingMeasured).toBeUndefined();
  });

  it('«Del rommet» utenfor rommet eller for nær kanten avvises', () => {
    const d = emptyBuilderDoc();
    const stue = addRect(d, { x: 0, z: 0 }, { x: 4000, z: 3000 }, 'Stue');
    expect(splitRoom(d, stue.id, 'x', 5000).ok).toBe(false);
    expect(splitRoom(d, stue.id, 'z', 60).ok).toBe(false);
    expect(d.rooms).toHaveLength(1);
  });

  it('«Roter 90°» fire ganger gir nøyaktig samme rom (også med odde mål)', () => {
    for (const [x0, z0, w, h] of [[0, 0, 4001, 3000], [-317, 52, 3333, 2222], [5, -5, 1235, 987], [0, 0, 4000, 3000]] as const) {
      const d = emptyBuilderDoc();
      const r = addRect(d, { x: x0, z: z0 }, { x: x0 + w, z: z0 + h }, 'Stue');
      const before = structuredClone(r.polygon);
      for (let i = 0; i < 4; i++) rotateRoom90(d, r.id);
      expect(d.rooms[0]!.polygon).toEqual(before);
    }
  });

  it('en kopi får ikke navnene og notatene til originalens vinduer', () => {
    const { d, gang } = start();
    const w = addOpening(d, 'window', gang.id, 0, 1500)!;
    w.name = 'Stuevindu';
    w.note = 'Nytt 2025';
    const copy = copyRoom(d, gang.id)!;
    const cw = d.openings.find((o) => o.room === copy.id && o.type === 'window')!;
    expect(cw.name).toBeUndefined();
    expect(cw.note).toBeUndefined();
  });

  it('«Rett opp» på ett rom flytter ikke de andre', () => {
    const d = emptyBuilderDoc();
    const a = addRect(d, { x: 0, z: 0 }, { x: 3000, z: 2000 }, 'Gang');
    const b = addRect(d, { x: 3100, z: 12 }, { x: 6000, z: 2000 }, 'Stue');
    const before = structuredClone(a.polygon);
    straighten(d, [b.id]);
    expect(d.rooms[0]!.polygon).toEqual(before);
    // Stuas toppkant er lagt på linje med gangens.
    expect(Math.min(...d.rooms[1]!.polygon.map((p) => p.z))).toBe(0);
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
