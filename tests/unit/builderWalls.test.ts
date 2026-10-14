/**
 * Egenskapstester for veggene byggeren lager: ingen vegg går inn i et rom,
 * og det er ingen hull i veggene rundt rommene (sjekket i et rutenett).
 * Fasit: et punkt utenfor alle rom som ligger nærmere enn ytterveggens
 * tykkelse fra et rom (avstand målt som største av |dx| og |dz|), er vegg.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { deriveWalls, type DerivedWall } from '../../src/builder/walls';
import { importApartment } from '../../src/builder/importDoc';
import { pointInPolygon } from '../../src/geometry/math2d';
import { DEFAULT_BUILDER_SETTINGS, type BRoom } from '../../src/builder/types';
import { alignFromTouches, rigToWorld } from '../../src/measure/align';
import { compile } from '../../src/builder/compile';
import { emptyBuilderDoc } from '../../src/builder/types';
import { addOpening, addRect, addRoomBeside } from '../../src/builder/ops';
import { validateApartment } from '../../src/schema/validate';
import { PUBLISHED_PATH } from './helpers';
import type { ApartmentDoc } from '../../src/schema/types';

type P = { x: number; z: number };

const poly = (pts: [number, number][]): P[] => pts.map(([x, z]) => ({ x, z }));
const room = (id: string, pts: [number, number][], floor = 0): BRoom => ({ id, name: id, polygon: poly(pts), floor, ceiling: 2400 });
const rect = (id: string, x0: number, z0: number, x1: number, z1: number): BRoom =>
  room(id, [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ]);

function inBody(w: DerivedWall, p: P): boolean {
  const dx = w.end.x - w.start.x;
  const dz = w.end.z - w.start.z;
  const len = Math.hypot(dx, dz);
  const u = { x: dx / len, z: dz / len };
  const left = { x: u.z, z: -u.x };
  const vx = p.x - w.start.x;
  const vz = p.z - w.start.z;
  const s = vx * u.x + vz * u.z;
  const n = vx * left.x + vz * left.z;
  const [lo, hi] = w.justify === 'center' ? [-w.thickness / 2, w.thickness / 2] : w.justify === 'left' ? [0, w.thickness] : [-w.thickness, 0];
  return s > -0.5 && s < len + 0.5 && n > lo - 0.5 && n < hi + 0.5;
}

/** Avstand (største av |dx|, |dz|) fra et punkt utenfor til et rom med akserette kanter. */
function linf(p: P, r: BRoom): number {
  let best = Infinity;
  const pts = r.polygon;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const dx = Math.max(Math.min(a.x, b.x) - p.x, 0, p.x - Math.max(a.x, b.x));
    const dz = Math.max(Math.min(a.z, b.z) - p.z, 0, p.z - Math.max(a.z, b.z));
    best = Math.min(best, Math.max(dx, dz));
  }
  return best;
}

function check(rooms: BRoom[]): { intrusions: P[]; holes: P[] } {
  const { walls } = deriveWalls(rooms, DEFAULT_BUILDER_SETTINGS);
  const solid = walls.filter((w) => w.base === undefined);
  const xs = rooms.flatMap((r) => r.polygon.map((p) => p.x));
  const zs = rooms.flatMap((r) => r.polygon.map((p) => p.z));
  const intrusions: P[] = [];
  const holes: P[] = [];
  const T = DEFAULT_BUILDER_SETTINGS.exteriorThickness;
  for (let x = Math.min(...xs) - 300 + 12.5; x < Math.max(...xs) + 300; x += 25)
    for (let z = Math.min(...zs) - 300 + 12.5; z < Math.max(...zs) + 300; z += 25) {
      const p = { x, z };
      const inside = rooms.some((r) => pointInPolygon(p, r.polygon));
      const wall = solid.some((w) => inBody(w, p));
      if (inside && wall) intrusions.push(p);
      if (!inside && !wall && Math.min(...rooms.map((r) => linf(p, r))) < T - 15) holes.push(p);
    }
  return { intrusions, holes };
}

describe('veggene: ingen vegg inne i rom, ingen hull', () => {
  const layouts: Record<string, BRoom[]> = {
    'L-formet rom': [room('l', [[0, 0], [4000, 0], [4000, 2000], [2000, 2000], [2000, 4000], [0, 4000]])],
    'pluss-kryss (fire rom)': [rect('a', 0, 0, 2000, 2000), rect('b', 2100, 0, 4000, 2000), rect('c', 0, 2100, 2000, 4000), rect('d', 2100, 2100, 4000, 4000)],
    'T-kryss med ulike luker': [rect('a', 0, 0, 3000, 2000), rect('b', 0, 2150, 1400, 4000), rect('c', 1500, 2100, 3000, 4000)],
    'delvis mot hverandre': [rect('a', 0, 0, 3000, 2000), rect('b', 1000, 2100, 4000, 3500)],
    'trinn uten vegg': [rect('a', 0, 0, 2000, 1500), { ...rect('b', 2000, 0, 3500, 1500), floor: 150, ceiling: 2250 }],
  };
  for (const [name, rooms] of Object.entries(layouts))
    it(name, () => {
      const r = check(rooms);
      expect(r.intrusions.slice(0, 3)).toEqual([]);
      expect(r.holes.slice(0, 3)).toEqual([]);
    });

  it('den publiserte leiligheten', () => {
    const imp = importApartment(JSON.parse(readFileSync(PUBLISHED_PATH, 'utf8')) as ApartmentDoc);
    if (!imp.ok) throw new Error(imp.message);
    const r = check(imp.doc.rooms);
    expect(r.intrusions.slice(0, 3)).toEqual([]);
    expect(r.holes.slice(0, 3)).toEqual([]);
  });
});

describe('oppmålingen legger en ny modell riktig (ikke speilvendt)', () => {
  /** Leilighet med inngangsdøra nær venstre eller høyre ende av inngangsveggen. */
  function build(doorNearEnd: boolean) {
    const d = emptyBuilderDoc();
    const gang = addRect(d, { x: 0, z: 0 }, { x: 3000, z: 2400 }, 'Gang');
    addRoomBeside(d, gang.id, 1, 3500, 'Stue');
    // Inngangsdøra på bunnkanten (nr. 2 går fra (3000,2400) til (0,2400)).
    addOpening(d, 'door', gang.id, 2, doorNearEnd ? 2400 : 600)!;
    return d;
  }
  for (const nearEnd of [false, true])
    it(`døra nær ${nearEnd ? 'høyre' : 'venstre'} hjørne`, () => {
      const d = build(nearEnd);
      const r = compile(d, { normalize: true });
      const v = validateApartment(r.doc);
      expect(v.errors).toEqual([]);
      const t = r.transform!;
      // Den «virkelige» leiligheten: tegningen dreid og flyttet vilkårlig (som i hodesettets rom).
      const ang = 0.7;
      const real = (p: P) => ({ x: Math.cos(ang) * p.x - Math.sin(ang) * p.z + 1.3, z: Math.sin(ang) * p.x + Math.cos(ang) * p.z - 0.4 });
      // Brukeren berører hjørnet ved døra og et punkt 1,5 m langs inngangsveggen (meter).
      const o = t.origin;
      const along = { x: o.x + t.axis.x * 1500, z: o.z + t.axis.z * 1500 };
      const q0 = real({ x: o.x / 1000, z: o.z / 1000 });
      const q1 = real({ x: along.x / 1000, z: along.z / 1000 });
      const a = alignFromTouches({ x: q0.x, y: 0, z: q0.z }, { x: q1.x, y: 0, z: q1.z });
      if (!a.ok) throw new Error(a.message);
      // Hvert hjørne i tegningen havner der modellen sier det skal være.
      const model = v.model!;
      for (const roomB of d.rooms)
        for (const p of roomB.polygon) {
          const rp = real({ x: p.x / 1000, z: p.z / 1000 });
          const w = rigToWorld(a.rig, { x: rp.x, y: 0, z: rp.z });
          const inModel = [...model.rooms.values()].some((info) =>
            info.polygon.some((q) => Math.hypot(q.x / 1000 - w.x, q.z / 1000 - w.z) < 0.002),
          );
          expect(inModel).toBe(true);
        }
    });
});
