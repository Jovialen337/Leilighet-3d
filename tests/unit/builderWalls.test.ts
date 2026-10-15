/**
 * Egenskapstester for veggene byggeren lager: ingen vegg går inn i et rom,
 * og det er ingen hull i veggene rundt rommene (sjekket i et rutenett).
 * Fasit: et punkt utenfor alle rom som ligger nærmere enn ytterveggens
 * tykkelse fra et rom (avstand målt som største av |dx| og |dz|), er vegg.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SKEW_MAX_DEG, deriveWalls, type DerivedWall } from '../../src/builder/walls';
import { edgesOf } from '../../src/builder/geometry';
import { importApartment } from '../../src/builder/importDoc';
import { pointInPolygon } from '../../src/geometry/math2d';
import { DEFAULT_BUILDER_SETTINGS, type BRoom, type BuilderDoc } from '../../src/builder/types';
import { alignFromTouches, rigToWorld } from '../../src/measure/align';
import { compile } from '../../src/builder/compile';
import { emptyBuilderDoc } from '../../src/builder/types';
import { addOpening, addRect, addRoomBeside, straighten } from '../../src/builder/ops';
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

/** Euklidsk avstand fra et punkt til kanten av et polygon. */
function edgeDist(p: P, pts: readonly P[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz));
  }
  return best;
}

/** Polygonet forskjøvet `t` utover (kantlinjene flyttet ut og skåret med hverandre). */
function offsetPoly(pts: readonly P[], t: number): P[] {
  const es = edgesOf(pts);
  return es.map((e, i) => {
    const f = es[(i - 1 + es.length) % es.length]!;
    // Linja til forrige kant og denne kanten, flyttet ut.
    const a = { x: f.a.x + f.out.x * t, z: f.a.z + f.out.z * t };
    const b = { x: e.a.x + e.out.x * t, z: e.a.z + e.out.z * t };
    const den = f.u.x * e.u.z - f.u.z * e.u.x;
    const k = ((b.x - a.x) * e.u.z - (b.z - a.z) * e.u.x) / den;
    return { x: a.x + f.u.x * k, z: a.z + f.u.z * k };
  });
}

describe('utvendige hjørner i alle vinkler: tette, og ingenting stikker ut', () => {
  const T = DEFAULT_BUILDER_SETTINGS.exteriorThickness;
  const shapes: Record<string, [number, number][]> = {
    'karnapp på 45°': [[0, 0], [1500, 0], [2000, -500], [3000, -500], [3500, 0], [5000, 0], [5000, 3000], [0, 3000]],
    'skrått hjørne (45°)': [[0, 0], [3000, 0], [4000, 1000], [4000, 3000], [0, 3000]],
    'skjev vegg (30°)': [[0, 0], [4000, 0], [4000 + 1732, 3000], [0, 3000]],
    'spiss vinkel (37°)': [[0, 0], [4000, 0], [0, 3000]],
  };
  for (const [name, pts] of Object.entries(shapes))
    it(name, () => {
      const r = room('r', pts);
      const { walls } = deriveWalls([r], DEFAULT_BUILDER_SETTINGS);
      const outer = offsetPoly(r.polygon, T + 15);
      const xs = pts.map((p) => p[0]);
      const zs = pts.map((p) => p[1]);
      const holes: P[] = [];
      const outside: P[] = [];
      const intrusions: P[] = [];
      for (let x = Math.min(...xs) - 600 + 7.5; x < Math.max(...xs) + 600; x += 15)
        for (let z = Math.min(...zs) - 600 + 7.5; z < Math.max(...zs) + 600; z += 15) {
          const p = { x, z };
          const wall = walls.some((w) => inBody(w, p));
          const inside = pointInPolygon(p, r.polygon);
          const d = edgeDist(p, r.polygon);
          if (inside && wall && d > 1) intrusions.push(p);
          // Alt nærmere rommet enn veggtykkelsen er vegg (også rundt hjørnene) …
          if (!inside && d > 10 && d < T - 10 && !wall) holes.push(p);
          // … og ingen vegg går utenfor ytterflatene.
          if (wall && !pointInPolygon(p, outer)) outside.push(p);
        }
      expect(intrusions.slice(0, 3)).toEqual([]);
      expect(holes.slice(0, 3)).toEqual([]);
      expect(outside.slice(0, 3)).toEqual([]);
    });
});

describe('slak knekk mellom en tynn og en tykk yttervegg: ingen tupp ut av huset eller inn i rommet', () => {
  /** Rom med en knekk på `deg` grader etter en kort kant; `thick` = kanten som er 300 mm. */
  const shapes = (deg: number): Record<string, { pts: [number, number][]; thick: number[] }> => {
    const a = (deg * Math.PI) / 180;
    const bx = Math.round(800 + 3000 * Math.cos(a));
    const bz = Math.round(3000 * Math.sin(a));
    const lx = Math.round(1000 + 3000 * Math.cos(a));
    const lz = Math.round(3000 * Math.sin(a));
    const plain: [number, number][] = [[0, 0], [800, 0], [bx, bz], [bx, 3000], [0, 3000]];
    const ell: [number, number][] = [[-2000, -1000], [0, -1000], [0, 0], [1000, 0], [lx, lz], [lx, 3000], [-2000, 3000]];
    return {
      'kort tykk kant før knekken': { pts: plain, thick: [0] },
      'tykk kant etter knekken': { pts: plain, thick: [1] },
      'kort tykk kant etter et innvendig hjørne': { pts: ell, thick: [2] },
      'tynn kant etter et innvendig hjørne, tykk etter knekken': { pts: ell, thick: [3] },
    };
  };
  for (const deg of [3, 5, 10, 30])
    for (const [name, { pts, thick }] of Object.entries(shapes(deg)))
      it(`${deg}°: ${name}`, () => {
        const r = room('r', pts);
        r.edges = pts.map((_, i) => (thick.includes(i) ? { thickness: 300 } : null));
        const { walls } = deriveWalls([r], DEFAULT_BUILDER_SETTINGS);
        const xs = pts.map((p) => p[0]);
        const zs = pts.map((p) => p[1]);
        const holes: P[] = [];
        const far: P[] = [];
        const intrusions: P[] = [];
        for (let x = Math.min(...xs) - 1500 + 7.5; x < Math.max(...xs) + 1500; x += 15)
          for (let z = Math.min(...zs) - 1500 + 7.5; z < Math.max(...zs) + 1500; z += 15) {
            const p = { x, z };
            const wall = walls.some((w) => inBody(w, p));
            const inside = pointInPolygon(p, r.polygon);
            const d = edgeDist(p, r.polygon);
            if (inside && wall && d > 1) intrusions.push(p);
            if (!inside && d > 10 && d < 190 && !wall) holes.push(p);
            // Ingen vegg lenger ut enn hjørnet på den tykkeste veggen.
            if (wall && !inside && d > 300 * Math.SQRT2 + 15) far.push(p);
          }
        expect(intrusions.slice(0, 3)).toEqual([]);
        expect(holes.slice(0, 3)).toEqual([]);
        expect(far.slice(0, 3)).toEqual([]);
      });
});

describe('skjeve rom ved siden av hverandre', () => {
  /** Rom B dreid `deg` grader rundt sitt eget hjørne, 100 mm fra A (og lenger unna i den andre enden). */
  const pair = (deg: number): BuilderDoc => {
    const d = emptyBuilderDoc('Test');
    const a = (-deg * Math.PI) / 180;
    const rot = (x: number, z: number): { x: number; z: number } => ({ x: Math.round(3100 + x * Math.cos(a) - z * Math.sin(a)), z: Math.round(x * Math.sin(a) + z * Math.cos(a)) });
    d.rooms = [rect('a', 0, 0, 3000, 3000), { id: 'b', name: 'B', polygon: [rot(0, 0), rot(3000, 0), rot(3000, 3000), rot(0, 3000)], floor: 0, ceiling: 2400 }];
    return d;
  };
  const skewIssues = (d: BuilderDoc) => compile(d).issues.filter((i) => i.fix?.id === 'straighten');

  it('rette rom gir ingen advarsel', () => {
    expect(skewIssues(pair(0))).toEqual([]);
  });

  it('korte kanter som bare er avrundet skjeve (1–2 mm), gir ingen advarsel', () => {
    const d = emptyBuilderDoc('Test');
    d.rooms = [
      room('a', [[0, 0], [3000, 0], [3000, 100], [0, 100]]),
      room('b', [[0, 200], [3000, 202], [3000, 300], [0, 300]]),
      room('c', [[3100, 0], [3300, 0], [3300, 3000], [3101, 3000]]),
    ];
    expect(skewIssues(d)).toEqual([]);
  });

  it('1,5° skjevt: én skillevegg, men advarsel med tykkelsen i hver ende', () => {
    const issues = skewIssues(pair(1.5));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toMatch(/«a» og «B» er ikke parallelle \(1,5°\): skilleveggen blir \d+ mm i den ene enden og \d+ mm i den andre/);
    expect(issues[0]!.target).toEqual({ kind: 'room', id: 'b' });
  });

  it('6° skjevt: advarsel om to yttervegger som går inn i hverandre', () => {
    const issues = skewIssues(pair(6));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toMatch(/«a» og «B» står 6,0° skjevt mot hverandre: det blir ikke én skillevegg/);
  });

  it('«Rett opp rommene» retter det skjeve rommet og lar det rette ligge', () => {
    for (const deg of [1.5, 6]) {
      const d = pair(deg);
      const before = structuredClone(d.rooms[0]!.polygon);
      expect(straighten(d, undefined, SKEW_MAX_DEG + 1)).toBeGreaterThan(0);
      expect(skewIssues(d)).toEqual([]);
      expect(d.rooms[0]!.polygon).toEqual(before);
      // Nå blir det én skillevegg mellom dem.
      expect(compile(d).walls.walls.filter((w) => w.kind === 'interior')).toHaveLength(1);
    }
  });

  it('et rom som er skrått med vilje (45°) gir ingen advarsel', () => {
    expect(skewIssues(pair(45))).toEqual([]);
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
