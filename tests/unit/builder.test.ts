import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compile } from '../../src/builder/compile';
import { deriveWalls } from '../../src/builder/walls';
import { importApartment } from '../../src/builder/importDoc';
import { dominantAngle, isAxisAligned, orthogonalize, roomsOverlap } from '../../src/builder/geometry';
import { DEFAULT_BUILDER_SETTINGS, emptyBuilderDoc, type BRoom, type BuilderDoc } from '../../src/builder/types';
import { validateApartment } from '../../src/schema/validate';
import { MeasureSession } from '../../src/measure/MeasureSession';
import type { ApartmentDoc } from '../../src/schema/types';
import { PUBLISHED_PATH, loadDoc } from './helpers';

const rect = (id: string, name: string, x0: number, z0: number, x1: number, z1: number, floor = 0): BRoom => ({
  id,
  name,
  polygon: [
    { x: x0, z: z0 },
    { x: x1, z: z0 },
    { x: x1, z: z1 },
    { x: x0, z: z1 },
  ],
  floor,
  ceiling: 2400,
});

/** To rom side om side med 100 mm skillevegg, inngangsdør i a, dør mellom og et vindu. */
function twoRooms(): BuilderDoc {
  const d = emptyBuilderDoc('Test');
  d.rooms = [rect('gang', 'Gang', 0, 0, 3000, 2000), rect('stue', 'Stue', 3100, 0, 6000, 2000, 150)];
  d.openings = [
    { id: 'dor-inngang', type: 'door', room: 'gang', edge: 3, offset: 300, width: 900, height: 2000, entrance: true, hinge: 'left', swing: 'out' },
    { id: 'dor-stue', type: 'door', room: 'gang', edge: 1, offset: 500, width: 900, height: 2000 },
    { id: 'vindu-1', type: 'window', room: 'stue', edge: 0, offset: 800, width: 1200, height: 1100, sill: 800 },
  ];
  return d;
}

describe('vegger fra rommene', () => {
  it('to rom med 100 mm luke gir én skillevegg midt i luka og sammenslåtte yttervegger', () => {
    const r = deriveWalls(twoRooms().rooms, DEFAULT_BUILDER_SETTINGS);
    const inner = r.walls.filter((w) => w.kind === 'interior');
    expect(inner).toHaveLength(1);
    // Linja ligger på gangens flate (x = 3000), og kroppen går over luka til stua (x = 3100).
    expect(inner[0]).toMatchObject({ thickness: 100, rooms: ['gang', 'stue'] });
    expect(inner[0]!.start.x).toBe(3000);
    expect(inner[0]!.end.x).toBe(3000);
    const w = inner[0]!;
    const dir = { x: w.end.x - w.start.x, z: w.end.z - w.start.z };
    const left = { x: dir.z, z: -dir.x };
    const side = w.justify === 'left' ? 1 : -1;
    expect(Math.sign(left.x * side)).toBe(1); // kroppen mot +x (stua)
    const outer = r.walls.filter((w) => w.kind === 'exterior');
    // Topp og bunn går over hele leiligheten (slått sammen over skilleveggen), pluss to endevegger.
    expect(outer).toHaveLength(4);
    const top = outer.find((w) => w.start.z === 0 && w.end.z === 0)!;
    expect(Math.min(top.start.x, top.end.x)).toBeLessThanOrEqual(0);
    expect(Math.max(top.start.x, top.end.x)).toBeGreaterThanOrEqual(6000);
    expect(r.open).toHaveLength(0);
  });

  it('rom som ligger kant i kant (luke 0) har en åpen overgang uten vegg', () => {
    // Hevet gulv og lavere tak i den hevede delen: taket er i samme høyde, ingen vegg.
    const raised = { ...rect('b', 'Bad (hevet del)', 2000, 0, 3500, 1500, 150), ceiling: 2250 };
    const r = deriveWalls([rect('a', 'Bad', 0, 0, 2000, 1500), raised], DEFAULT_BUILDER_SETTINGS);
    expect(r.walls.filter((w) => w.kind === 'interior')).toHaveLength(0);
    expect(r.open).toHaveLength(1);
    expect(r.notes).toEqual([]);
  });

  it('ulik takhøyde uten vegg imellom gir en nedforing fra det laveste taket', () => {
    const r = deriveWalls([rect('a', 'Bad', 0, 0, 2000, 1500), rect('b', 'Bad (indre)', 2000, 0, 3500, 1500, 150)], DEFAULT_BUILDER_SETTINGS);
    const soffit = r.walls.filter((w) => w.kind === 'interior');
    expect(soffit).toHaveLength(1);
    expect(soffit[0]).toMatchObject({ base: 2400, thickness: 60 });
  });

  it('et lite mellomrom mellom to rom gir en advarsel', () => {
    const r = deriveWalls([rect('a', 'Bad', 0, 0, 2000, 1500), rect('b', 'Bod', 2008, 0, 3500, 1500)], DEFAULT_BUILDER_SETTINGS);
    expect(r.notes.join('\n')).toMatch(/ligger 8 mm fra hverandre/);
  });

  it('hullet der tre vegger møtes fylles', () => {
    // Gang under stue og planterom (T-kryss med 100 mm vegger).
    const rooms = [
      rect('gang', 'Gang', 0, 0, 2300, 2500),
      rect('stue', 'Stue', 2400, 0, 5600, 2500),
      rect('plante', 'Planterom', 2400, 2600, 5600, 4900),
    ];
    const r = deriveWalls(rooms, DEFAULT_BUILDER_SETTINGS);
    const gangStue = r.walls.find((w) => w.kind === 'interior' && w.rooms.includes('gang'))!;
    // Skilleveggen gang/stue forlenges over hullet (2300–2400, 2500–2600).
    expect(Math.max(gangStue.start.z, gangStue.end.z)).toBe(2600);
  });
});

describe('kompilering til apartment.json', () => {
  it('gir en gyldig fil uten advarsler, med origo i hjørnet ved inngangsdøra', () => {
    const r = compile(twoRooms(), { normalize: true, date: '2026-10-14' });
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const v = validateApartment(r.doc);
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
    const doc = v.model!.data;
    // Inngangsdøra sitter på venstre kant (x = 0) nær hjørnet (0, 2000): det hjørnet blir origo.
    expect(doc.rooms.find((x) => x.id === 'gang')!.polygon).toContainEqual([0, 0]);
    expect(doc.rooms.find((x) => x.id === 'gang')!.floorLevel).toBe(0);
    expect(doc.rooms.find((x) => x.id === 'stue')!.floorLevel).toBe(150);
    const entrance = doc.openings.find((o) => o.id === 'dor-inngang')!;
    const wall = doc.walls.find((w) => w.id === entrance.wall)!;
    expect(wall.start[1]).toBe(0);
    expect(wall.end[1]).toBe(0); // inngangsveggen langs x
    expect(doc.meta.updated).toBe('2026-10-14');
    // Planen dreies så den ser ut som tegningen (inngangsveggen gikk opp på skjermen).
    expect(doc.settings!.planRotation).toBe(90);
    // Dør mellom rommene går inn i stua (rommet på den andre siden).
    expect(doc.openings.find((o) => o.id === 'dor-stue')).toMatchObject({ type: 'door', into: 'stue' });
    // Oppmålingen kan starte på den nye modellen.
    expect(new MeasureSession(v.doc!).tasks.length).toBeGreaterThan(10);
  });

  it('gir norske feil knyttet til rom og åpninger', () => {
    const d = twoRooms();
    d.rooms.push(rect('x', 'Bod', 2500, 1500, 3500, 2500));
    d.openings.push({ id: 'v2', type: 'window', room: 'gang', edge: 0, offset: 2500, width: 900, height: 1000, sill: 900 });
    const r = compile(d);
    expect(r.doc).toBeNull();
    expect(r.issues).toContainEqual(expect.objectContaining({ severity: 'error', target: { kind: 'room', id: 'x' } }));
    expect(r.issues.map((i) => i.message).join('\n')).toMatch(/overlapper/);
    expect(r.issues).toContainEqual(expect.objectContaining({ target: { kind: 'opening', id: 'v2' }, message: expect.stringMatching(/går utenfor veggen/) }));
  });

  it('en åpning der det ikke er vegg avvises', () => {
    const d = emptyBuilderDoc();
    d.rooms = [rect('a', 'Bad', 0, 0, 2000, 1500), rect('b', 'Bad 2', 2000, 0, 3500, 1500)];
    d.openings = [{ id: 'd', type: 'door', room: 'a', edge: 1, offset: 200, width: 800, height: 2000 }];
    expect(compile(d).issues.map((i) => i.message).join('\n')).toMatch(/ikke er noen vegg/);
  });

  it('uten inngangsdør advares det, men fila er gyldig', () => {
    const d = twoRooms();
    delete d.openings[0]!.entrance;
    const r = compile(d, { normalize: true });
    expect(r.issues.map((i) => i.message).join('\n')).toMatch(/inngangsdør/);
    expect(validateApartment(r.doc).ok).toBe(true);
  });
});

describe('oppretting av skjeve rom', () => {
  it('nesten rette vinkler blir nøyaktig rette, og lengdene beholdes', () => {
    const noisy = [
      { x: 3, z: -4 },
      { x: 4012, z: 9 },
      { x: 3995, z: 3008 },
      { x: -6, z: 2991 },
    ];
    const a = dominantAngle(noisy);
    const o = orthogonalize(noisy, a);
    expect(isAxisAligned(o, a, 0.01)).toBe(true);
    const w = Math.hypot(o[1]!.x - o[0]!.x, o[1]!.z - o[0]!.z);
    expect(w).toBeGreaterThan(3990);
    expect(w).toBeLessThan(4015);
  });

  it('rom som overlapper oppdages; rom som bare berører gjør ikke', () => {
    const a = rect('a', 'A', 0, 0, 1000, 1000).polygon;
    expect(roomsOverlap(a, rect('b', 'B', 500, 500, 1500, 1500).polygon)).toBe(true);
    expect(roomsOverlap(a, rect('c', 'C', 1000, 0, 2000, 1000).polygon)).toBe(false);
    expect(roomsOverlap(a, rect('d', 'D', 1100, 0, 2000, 1000).polygon)).toBe(false);
  });
});

describe('start fra nåværende modell', () => {
  const roundTrip = (raw: ApartmentDoc) => {
    const imp = importApartment(raw);
    if (!imp.ok) throw new Error(imp.message);
    const r = compile(imp.doc, { normalize: true });
    return { imp: imp.doc, r, v: validateApartment(r.doc) };
  };

  it('den publiserte fila kommer tilbake lik: samme rom, åpninger og installasjoner', () => {
    const raw = JSON.parse(readFileSync(PUBLISHED_PATH, 'utf8')) as ApartmentDoc;
    const { r, v } = roundTrip(raw);
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(v.errors).toEqual([]);
    const before = validateApartment(raw).model!.data;
    const after = v.model!.data;
    expect(after.settings!.planRotation).toBe(before.settings!.planRotation);
    expect(after.rooms.map((x) => x.id)).toEqual(before.rooms.map((x) => x.id));
    for (const room of before.rooms) expect(after.rooms.find((x) => x.id === room.id)!.polygon).toEqual(room.polygon);
    expect(after.openings.map((o) => o.id).sort()).toEqual(before.openings.map((o) => o.id).sort());
    // Åpningene sitter på samme sted (midtpunkt i planen).
    const mid = (m: NonNullable<typeof v.model>, id: string) => {
      const o = m.data.openings.find((x) => x.id === id)!;
      const s = m.openingSpan(o)!;
      const u = (s.u0 + s.u1) / 2;
      return { x: s.frame.p0.x + s.frame.dir.x * u, z: s.frame.p0.z + s.frame.dir.z * u, w: s.u1 - s.u0 };
    };
    const mb = validateApartment(raw).model!;
    for (const o of before.openings) {
      const a = mid(mb, o.id);
      const b = mid(v.model!, o.id);
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(60);
      expect(Math.abs(a.w - b.w)).toBeLessThan(2);
    }
    // Installasjoner på vegg havner på samme sted (innen 2 cm).
    for (const fx of before.fixtures) {
      const p = mb.fixturePlacement(fx)!;
      const q = v.model!.fixturePlacement(after.fixtures.find((x) => x.id === fx.id)!)!;
      expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeLessThan(20);
      expect(Math.abs(p.y - q.y)).toBeLessThan(2);
    }
    expect(after.furniture).toEqual(before.furniture);
    expect(after.pipes).toEqual(before.pipes);
  });

  it('plassholderen kommer også tilbake gyldig, med målte verdier som målt', () => {
    const { r, v } = roundTrip(loadDoc());
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(v.errors).toEqual([]);
    expect(v.model!.measureState('planterom')).not.toBe('placeholder');
  });
});

describe('sjekken av tegningen', () => {
  it('rom uten dør eller åpning fra inngangen får en advarsel', () => {
    const d = emptyBuilderDoc('Test');
    d.rooms = [rect('gang', 'Gang', 0, 0, 3000, 2000), rect('bod', 'Bod', 3100, 0, 4500, 2000)];
    d.openings = [{ id: 'inn', type: 'door', room: 'gang', edge: 3, offset: 500, width: 900, height: 2000, entrance: true }];
    let r = compile(d);
    expect(r.issues).toContainEqual(expect.objectContaining({ message: expect.stringContaining('kommer ikke inn i «Bod»'), target: { kind: 'room', id: 'bod' } }));
    // En dør i skilleveggen gjør boden tilgjengelig.
    d.openings.push({ id: 'til-bod', type: 'door', room: 'gang', edge: 1, offset: 500, width: 800, height: 2000 });
    r = compile(d);
    expect(r.issues.some((i) => i.message.includes('kommer ikke inn'))).toBe(false);
  });

  it('åpen overgang (rom kant i kant) teller som vei inn', () => {
    const d = emptyBuilderDoc('Test');
    d.rooms = [rect('gang', 'Gang', 0, 0, 3000, 2000), rect('stue', 'Stue', 3000, 0, 6000, 2000)];
    d.openings = [{ id: 'inn', type: 'door', room: 'gang', edge: 3, offset: 500, width: 900, height: 2000, entrance: true }];
    expect(compile(d).issues.some((i) => i.message.includes('kommer ikke inn'))).toBe(false);
  });

  it('for kort inngangsvegg og manglende inngangsdør gir advarsel med rettelse', () => {
    const d = emptyBuilderDoc('Test');
    d.rooms = [rect('gang', 'Gang', 0, 0, 950, 2000)];
    d.openings = [{ id: 'inn', type: 'door', room: 'gang', edge: 0, offset: 20, width: 900, height: 2000 }];
    let r = compile(d);
    expect(r.issues).toContainEqual(expect.objectContaining({ fix: { id: 'entrance', label: 'Merk en inngangsdør' } }));
    d.openings[0]!.entrance = true;
    r = compile(d);
    expect(r.issues).toContainEqual(expect.objectContaining({ message: expect.stringContaining('minst 1 m'), target: { kind: 'opening', id: 'inn' } }));
  });
});
