import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { fitCeilingPlane, planeY } from '../../src/geometry/plane';
import { buildParts, partsFor } from '../../src/scene/buildParts';
import { interpolate } from '../../src/model/ApartmentModel';
import type { Door } from '../../src/schema/types';
import { loadDoc, modelOf } from './helpers';

const bbox = (g: THREE.BufferGeometry): THREE.Box3 => {
  g.computeBoundingBox();
  return g.boundingBox!.clone();
};

/** Treffer en stråle geometrien? (meter) */
function hits(g: THREE.BufferGeometry, origin: [number, number, number], dir: [number, number, number]): boolean {
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const rc = new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...dir).normalize());
  return rc.intersectObject(mesh).length > 0;
}

describe('takplan', () => {
  it('går nøyaktig gjennom 3 punkter', () => {
    const p = fitCeilingPlane([
      { x: 0, z: 0, y: 2200 },
      { x: 1000, z: 0, y: 2250 },
      { x: 0, z: 1000, y: 2220 },
    ]);
    expect(p.degenerate).toBe(false);
    expect(planeY(p, 1000, 1000)).toBeCloseTo(2270, 6);
    expect(p.maxResidual).toBeLessThan(1e-6);
  });

  it('bruker minste kvadrater for flere punkter og rapporterer avvik', () => {
    const p = fitCeilingPlane([
      { x: 0, z: 0, y: 2200 },
      { x: 2000, z: 0, y: 2300 },
      { x: 0, z: 2000, y: 2240 },
      { x: 2000, z: 2000, y: 2360 },
    ]);
    expect(p.maxResidual).toBeGreaterThan(1);
    expect(p.maxResidual).toBeLessThan(15);
  });

  it('merker punkter på én linje som ubestemt', () => {
    expect(fitCeilingPlane([{ x: 0, z: 0, y: 1 }, { x: 1, z: 1, y: 2 }, { x: 2, z: 2, y: 3 }]).degenerate).toBe(true);
  });
});

describe('leilighetsmodellen', () => {
  const m = modelOf();

  it('gangen er ett trinn lavere enn resten', () => {
    expect(m.floorLevelAt({ x: 1000, z: 1000 })).toBe(0);
    for (const [x, z] of [[4000, 2000], [7000, 2000], [3000, 5000], [4000, 6000], [1000, 4000]] as const) {
      expect(m.floorLevelAt({ x, z })).toBe(180);
    }
    // Terskelen i åpningen gang–stue ligger på stuenivå.
    expect(m.floorLevelAt({ x: 2350, z: 1200 })).toBe(180);
    // Ute: gangsti og hage.
    expect(m.floorLevelAt({ x: 600, z: -1000 })).toBe(-60);
    expect(m.floorLevelAt({ x: 5000, z: -2000 })).toBe(-150);
  });

  it('taket er lavest i gangens hjørne lengst fra kjøkkenet og stiger mot kjøkkenet', () => {
    const gang = m.rooms.get('gang')!;
    const heights = gang.polygon.map((p) => ({ p, h: m.ceilingAt(gang, p) }));
    const lowest = heights.reduce((a, b) => (b.h < a.h ? b : a));
    expect(lowest.p).toEqual({ x: 0, z: 0 });
    const along = [500, 2000, 3000, 5000, 6500, 8500].map((x) => {
      const room = m.roomAt({ x, z: 1500 })!;
      return m.ceilingAt(room, { x, z: 1500 });
    });
    for (let i = 1; i < along.length; i++) expect(along[i]!).toBeGreaterThan(along[i - 1]!);
    const kitchen = m.rooms.get('kjokken')!;
    expect(m.ceilingAt(kitchen, { x: 9100, z: 4200 })).toBeGreaterThan(lowest.h + 400);
  });

  it('planterommet har målt størrelse 3200 × 2300 × 2100', () => {
    const r = m.rooms.get('planterom')!;
    const w = r.bounds.maxX - r.bounds.minX;
    const d = r.bounds.maxZ - r.bounds.minZ;
    expect([w, d].sort()).toEqual([2300, 3200]);
    for (const p of r.polygon) expect(m.ceilingAt(r, p) - r.room.floorLevel).toBeCloseTo(2100, 6);
  });

  it('badets indre del har høyere tak enn den nære', () => {
    const near = m.rooms.get('bad')!;
    const far = m.rooms.get('bad-indre')!;
    expect(m.ceilingAt(far, { x: 4000, z: 6000 })).toBeGreaterThan(m.ceilingAt(near, { x: 3000, z: 5000 }));
  });

  it('dørene slår riktig vei', () => {
    const door = (id: string) => m.doorGeometry(m.data.openings.find((o) => o.id === id) as Door)!;
    // Inngang: hengsel til venstre når man går inn (+z → venstre er +x), slår UT (mot −z).
    const inn = door('dor-inngang');
    expect(inn.intoNormal).toEqual({ x: -0, z: 1 });
    expect(inn.hinge.x).toBe(1100);
    expect(inn.openDir.z).toBe(-1);
    expect(inn.hinge.z).toBeLessThan(0);
    expect(inn.swingDirection).toBe('clockwise');
    // Bad: hengsel til høyre (−x når man går mot +z), slår INN.
    const bad = door('dor-bad');
    expect(bad.hinge.x).toBe(2900);
    expect(bad.openDir.z).toBe(1);
    // Planterom: hengsel til venstre (+x), slår INN, ca. 900 bred.
    const plante = door('dor-planterom');
    expect(plante.hinge.x).toBe(1600);
    expect(plante.openDir.z).toBe(1);
    expect(plante.span.u1 - plante.span.u0).toBe(900);
  });

  it('vinduene sitter i inngangsveggen mellom døra og kjøkkenet, i riktig høyde', () => {
    const inn = m.data.openings.find((o) => o.id === 'dor-inngang')!;
    const windows = m.data.openings.filter((o) => o.type === 'window');
    expect(windows).toHaveLength(2);
    for (const w of windows) {
      expect(w.wall).toBe(inn.wall);
      const s = m.openingSpan(w)!;
      const x0 = s.frame.p0.x + s.u0;
      const x1 = s.frame.p0.x + s.u1;
      expect(x0).toBeGreaterThan(1100);
      expect(x1).toBeLessThan(6100);
      expect(s.bottom).toBe(180 + 900);
      expect(s.top).toBe(180 + 900 + 1000);
    }
  });

  it('starter rett innenfor inngangsdøra, med blikket mot lengste utsikt', () => {
    const s = m.spawn();
    expect(s.level).toBe(0);
    expect(s.position.x).toBeGreaterThan(200);
    expect(s.position.x).toBeLessThan(1100);
    expect(s.position.z).toBeGreaterThan(300);
    expect(s.position.z).toBeLessThan(1200);
    // Rett inn (+z) ser man gangens yttervegg; mot +x ser man gjennom åpningene til stua og kjøkkenet.
    expect(s.facing.x).toBeGreaterThan(0.9);
    expect(s.facing.z).toBeGreaterThan(0);
    expect(Math.hypot(s.facing.x, s.facing.z)).toBeCloseTo(1, 9);
    const eye = s.level + 1600;
    expect(m.sightline(s.position, s.facing, eye)).toBeGreaterThan(5000);
    expect(m.sightline(s.position, { x: 0, z: 1 }, eye)).toBeLessThan(2500);
  });

  it('sikten stoppes av vegger og vinduer, men går gjennom åpninger', () => {
    const s = m.spawn();
    const eye = s.level + 1600;
    // Mot −x: gangens vindusvegg (vindu stopper blikket) like ved.
    const west = m.sightline(s.position, { x: -1, z: 0 }, eye);
    expect(west).toBeGreaterThan(0);
    expect(west).toBeLessThan(1000);
    // Mot −z: ut inngangsdøra (lukket dørblad teller ikke) – ut av leiligheten gir 0.
    expect(m.sightline(s.position, { x: 0, z: -1 }, eye)).toBe(0);
  });

  it('veggtoppen er aldri under taket i rommene ved siden av (ingen sprekker)', () => {
    for (const f of m.walls.values()) {
      if (f.wall.height !== undefined) continue;
      const top = m.wallTop(f);
      for (let u = 0; u <= f.length; u += 20) {
        for (const side of ['left', 'right'] as const) {
          const room = m.roomBeside(f, Math.min(Math.max(u, 150), f.length - 150), side);
          if (!room) continue;
          const face = side === 'left' ? f.nMax : f.nMin;
          const p = { x: f.p0.x + f.dir.x * u + f.left.x * face, z: f.p0.z + f.dir.z * u + f.left.z * face };
          expect(interpolate(top, u)).toBeGreaterThanOrEqual(m.ceilingAt(room, p) - 0.5);
        }
      }
    }
  });
});

describe('3D-geometri', () => {
  const m = modelOf();
  const parts = buildParts(m);

  it('alle vegger, rom og åpninger gir geometri', () => {
    for (const w of m.data.walls) expect(partsFor(parts, w.id, 'wall')).toHaveLength(1);
    for (const r of m.data.rooms) {
      expect(partsFor(parts, r.id, 'floor')).toHaveLength(1);
      expect(partsFor(parts, r.id, 'ceiling')).toHaveLength(1);
    }
    for (const f of m.data.fixtures) expect(partsFor(parts, f.id).length).toBeGreaterThan(0);
    for (const f of m.data.furniture) expect(partsFor(parts, f.id).length).toBe(f.parts.length);
  });

  it('trinnet: stuegulvet ligger 180 mm over gangen', () => {
    const gang = bbox(partsFor(parts, 'gang', 'floor')[0]!.geometry);
    const stue = bbox(partsFor(parts, 'stue', 'floor')[0]!.geometry);
    expect(gang.max.y).toBeCloseTo(0, 6);
    expect(stue.max.y).toBeCloseTo(0.18, 6);
    expect(stue.min.y).toBeCloseTo(0, 6); // sideflaten (opptrinnet) går ned til gangen
  });

  it('det skrå taket følger takplanet', () => {
    const g = partsFor(parts, 'stue', 'ceiling')[0]!.geometry;
    const pos = g.getAttribute('position');
    const stue = m.rooms.get('stue')!;
    for (let i = 0; i < pos.count; i++) {
      const y = planeY(stue.plane, pos.getX(i) * 1000, pos.getZ(i) * 1000) / 1000;
      expect(pos.getY(i)).toBeCloseTo(y, 5);
    }
    const b = bbox(g);
    expect(b.max.y - b.min.y).toBeGreaterThan(0.2);
  });

  it('inngangsveggen har hull for døra og vinduene', () => {
    const wall = partsFor(parts, 'v-inngang', 'wall')[0]!.geometry;
    // Stråler fra utsiden (−z) inn mot veggen.
    expect(hits(wall, [0.65, 1.0, -1], [0, 0, 1])).toBe(false); // gjennom døra
    expect(hits(wall, [1.5, 1.0, -1], [0, 0, 1])).toBe(true); // vegg ved siden av
    expect(hits(wall, [3.3, 1.58, -1], [0, 0, 1])).toBe(false); // gjennom vindu 1
    expect(hits(wall, [3.3, 0.6, -1], [0, 0, 1])).toBe(true); // under vinduet
    expect(hits(wall, [3.3, 2.2, -1], [0, 0, 1])).toBe(true); // over vinduet
    expect(hits(wall, [5.1, 1.58, -1], [0, 0, 1])).toBe(false); // gjennom vindu 2
  });

  it('åpningen gang–stue er et hull over trinnet', () => {
    const wall = partsFor(parts, 'v-gang-stue', 'wall')[0]!.geometry;
    expect(hits(wall, [1, 1.0, 1.2], [1, 0, 0])).toBe(false);
    expect(hits(wall, [1, 0.1, 1.2], [1, 0, 0])).toBe(true); // opptrinnet under åpningen
    expect(hits(wall, [1, 1.0, 2.0], [1, 0, 0])).toBe(true);
  });
});

describe('modellen kommer 100 % fra apartment.json', () => {
  it('endret tall → endret geometri', () => {
    const base = buildParts(modelOf());
    const doc = loadDoc();
    doc.walls.find((w) => w.id === 'v-inngang')!.thickness = 400;
    const win = doc.openings.find((o) => o.id === 'vindu-stue-1')!;
    if (win.type === 'window') win.sillHeight = 500;
    doc.rooms.find((r) => r.id === 'stue')!.floorLevel = 300;
    const changed = buildParts(modelOf(doc));

    const wallA = bbox(partsFor(base, 'v-inngang', 'wall')[0]!.geometry);
    const wallB = bbox(partsFor(changed, 'v-inngang', 'wall')[0]!.geometry);
    expect(wallA.min.z).toBeCloseTo(-0.2, 6);
    expect(wallB.min.z).toBeCloseTo(-0.4, 6);

    const floorB = bbox(partsFor(changed, 'stue', 'floor')[0]!.geometry);
    expect(floorB.max.y).toBeCloseTo(0.3, 6);

    const glassA = bbox(partsFor(base, 'vindu-stue-1', 'window').find((p) => p.bucket === 'glass')!.geometry);
    const glassB = bbox(partsFor(changed, 'vindu-stue-1', 'window').find((p) => p.bucket === 'glass')!.geometry);
    // Brystning −400 mm, men stuegulvet er hevet +120 mm: netto −280 mm.
    expect(glassB.min.y).toBeCloseTo(glassA.min.y - 0.28, 5);
  });
});
