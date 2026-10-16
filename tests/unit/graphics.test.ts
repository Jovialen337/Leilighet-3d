import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LIGHT_IDS, LIGHTING, LIGHTS, shadeOf } from '../../src/scene/lighting';
import { roomEdges, isInnerCorner } from '../../src/scene/roomEdges';
import { buildContactShade } from '../../src/scene/shade';
import { buildParts, partsFor } from '../../src/scene/buildParts';
import { BAKE, Baker, formFactor, tessellate } from '../../src/scene/bake';
import { buildSunPatches, buildSunShafts, clipConvex, sunPatches, SUN_PATCH } from '../../src/scene/sunlight';
import { buildLampGlow, LAMP } from '../../src/scene/lamps';
import { graphicsProfile } from '../../src/scene/graphicsProfile';
import { DETAIL, detailLayers, floorSurface, SURF } from '../../src/scene/detail';
import { Fade, FADE } from '../../src/xr/fade';
import { pointInPolygon } from '../../src/geometry/math2d';
import { FpsMeter } from '../../src/ui/FpsMeter';
import { modelOf } from './helpers';

const model = modelOf();

describe('lyssetting', () => {
  it('vegger i ulike retninger får tydelig ulik lysstyrke, uten utbrente gulv eller mørkt tak', () => {
    const walls = [
      shadeOf({ x: 0, y: 0, z: -1 }),
      shadeOf({ x: 0, y: 0, z: 1 }),
      shadeOf({ x: 1, y: 0, z: 0 }),
      shadeOf({ x: -1, y: 0, z: 0 }),
    ];
    const spread = (Math.max(...walls) - Math.min(...walls)) / Math.max(...walls);
    expect(spread).toBeGreaterThan(0.15);
    expect(new Set(walls.map((w) => w.toFixed(2))).size).toBe(4);
    expect(shadeOf({ x: 0, y: 1, z: 0 })).toBeLessThan(1);
    expect(shadeOf({ x: 0, y: -1, z: 0 })).toBeGreaterThan(0.5);
  });
});

describe('fotlister og kanter', () => {
  it('fotlisten går rundt rommet, men ikke gjennom døråpninger', () => {
    const gang = model.rooms.get('gang')!;
    const all = roomEdges(model, gang, false);
    const cut = roomEdges(model, gang, true);
    const length = (es: typeof all) => es.reduce((s, e) => s + Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z), 0);
    const perimeter = 2 * (2300 + 2400);
    expect(length(all)).toBeCloseTo(perimeter, 6);
    // Gangen har inngangsdøra (900), åpningen til stua (1000) og døra til planterommet (900).
    expect(length(cut)).toBeCloseTo(perimeter - 900 - 1000 - 900, 0);
    // Normalen peker inn i rommet.
    for (const e of all) expect(e.inward.x * (1150 - e.a.x) + e.inward.z * (1200 - e.a.z)).toBeGreaterThan(0);
  });

  it('badets innhakk gir et utvendig hjørne', () => {
    const poly = model.rooms.get('bad')!.polygon;
    expect(poly.map((_, i) => isInnerCorner(poly, i))).toEqual([true, true, false, true, true, true]);
  });

  it('fotlister og gerikter er med i modellen', () => {
    const parts = buildParts(model);
    expect(partsFor(parts, 'stue', 'trim')).toHaveLength(1);
    expect(partsFor(parts, 'dor-bad', 'trim')).toHaveLength(1);
    expect(partsFor(parts, 'vindu-stue-1', 'trim')).toHaveLength(1);
  });
});

describe('myke skygger', () => {
  it('møbler på gulvet får kontaktskygge i møbellaget', () => {
    const shade = buildContactShade(model);
    // Skyggen følger møbelets lag (skjules med det).
    expect([...shade.keys()].sort()).toEqual([...new Set(model.data.furniture.map((f) => f.layer))].sort());
    // Høyst (1 + 4) firkanter × 6 hjørner per møbel.
    let total = 0;
    for (const g of shade.values()) total += g.getAttribute('position').count;
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(model.data.furniture.length * 30);
  });
});

describe('bildefrekvens', () => {
  it('teller tapte rammer', () => {
    const m = new FpsMeter();
    let t = 0;
    m.tick(t);
    for (let i = 0; i < 90; i++) m.tick((t += 1000 / 90));
    m.tick((t += 20)); // vindu ferdig
    for (let i = 0; i < 85; i++) m.tick((t += 1000 / 90));
    m.tick((t += 34)); // to tapte rammer i ett hopp
    for (let i = 0; i < 10; i++) m.tick((t += 1000 / 90));
    expect(m.dropped).toBe(1);
    expect(m.label()).toContain('1 tapt');
  });
});

describe('lys: morgen, dag og kveld', () => {
  it('«Dag» er standardlyset, og alle tre gir tydelig ulike veggretninger', () => {
    expect(LIGHTS.dag).toBe(LIGHTING);
    for (const id of LIGHT_IDS) {
      const p = LIGHTS[id];
      const walls = [
        shadeOf({ x: 0, y: 0, z: -1 }, p),
        shadeOf({ x: 0, y: 0, z: 1 }, p),
        shadeOf({ x: 1, y: 0, z: 0 }, p),
        shadeOf({ x: -1, y: 0, z: 0 }, p),
      ];
      expect((Math.max(...walls) - Math.min(...walls)) / Math.max(...walls)).toBeGreaterThan(0.1);
      // Sola står over horisonten, og taket blir ikke mørkt.
      expect(p.key.from[1]).toBeGreaterThan(0);
      expect(shadeOf({ x: 0, y: -1, z: 0 }, p)).toBeGreaterThan(0.3);
    }
  });

  it('morgensola står lavere enn dagsola, og kvelden er mørkere med lampene på', () => {
    const elev = (f: readonly number[]) => Math.atan2(f[1]!, Math.hypot(f[0]!, f[2]!));
    expect(elev(LIGHTS.morgen.key.from)).toBeLessThan(elev(LIGHTS.dag.key.from));
    expect(shadeOf({ x: 0, y: 1, z: 0 }, LIGHTS.kveld)).toBeLessThan(shadeOf({ x: 0, y: 1, z: 0 }, LIGHTS.dag));
    expect(LIGHTS.kveld.lamps).toBeGreaterThan(0);
    expect(LIGHTS.dag.lamps).toBe(0);
  });
});

/** Areal (m²) av en geometri uten indeks. */
function area(g: THREE.BufferGeometry): number {
  const p = g.getAttribute('position');
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let sum = 0;
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    sum += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  return sum;
}

describe('bakt dagslys', () => {
  it('rutenettet beholder flaten og deler den i ruter på maks én rute', () => {
    const floor = partsFor(buildParts(model), 'stue', 'floor')[0]!.geometry;
    const t = tessellate(floor);
    expect(area(t)).toBeCloseTo(area(floor), 4);
    expect(t.getAttribute('position').count).toBeGreaterThan(floor.getAttribute('position').count * 5);
    const p = t.getAttribute('position');
    for (let i = 0; i < p.count; i += 3) {
      for (const [j, k] of [[0, 1], [1, 2], [2, 0]] as const) {
        const dx = p.getX(i + j) - p.getX(i + k);
        const dz = p.getZ(i + j) - p.getZ(i + k);
        expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(BAKE.cell * Math.SQRT2 + 1e-6);
      }
    }
  });

  it('naboflater får de samme hjørnene langs kanten (ingen sprekker)', () => {
    // Et kvadrat delt i to trekanter langs diagonalen.
    const g = new THREE.BufferGeometry();
    const P = [0, 0, 0, 1.3, 0, 0, 1.3, 0, 1.1, 0, 0, 0, 1.3, 0, 1.1, 0, 0, 1.1];
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(Array.from({ length: 6 }, () => [0, 1, 0]).flat(), 3));
    const t = tessellate(g);
    const p = t.getAttribute('position');
    const onDiag = [new Set<string>(), new Set<string>()];
    const half = p.count / 2;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      if (Math.abs(z - (x * 1.1) / 1.3) < 1e-5) onDiag[i < half ? 0 : 1]!.add(`${x.toFixed(5)},${z.toFixed(5)}`);
    }
    expect(onDiag[0]!.size).toBeGreaterThan(4);
    expect([...onDiag[0]!].sort()).toEqual([...onDiag[1]!].sort());
  });

  it('formfaktoren: et stort tak rett over ≈ 1, bak flaten = 0, lite vindu ≈ A/(π d²)', () => {
    const p = { x: 0, y: 0, z: 0 };
    const up = { x: 0, y: 1, z: 0 };
    const big = 1e6;
    const sky = [
      { x: -big, y: 1, z: -big },
      { x: big, y: 1, z: -big },
      { x: big, y: 1, z: big },
      { x: -big, y: 1, z: big },
    ];
    expect(formFactor(p, up, sky)).toBeGreaterThan(0.99);
    expect(formFactor(p, { x: 0, y: -1, z: 0 }, sky)).toBe(0);
    const s = 10;
    const d = 1000;
    const small = [
      { x: -s, y: d, z: -s },
      { x: s, y: d, z: -s },
      { x: s, y: d, z: s },
      { x: -s, y: d, z: s },
    ];
    expect(formFactor(p, up, small)).toBeCloseTo((4 * s * s) / (Math.PI * d * d), 6);
  });

  it('lyst ved vinduene, mørkere innover, i hjørnene og i rom uten vindu', () => {
    const b = new Baker(model);
    const up = { x: 0, y: 1, z: 0 };
    const stue = model.rooms.get('stue')!;
    const floor = stue.room.floorLevel;
    // Stuevinduene sitter i veggen z = 0; en meter inn er lysest, bakerst mørkere.
    const nearWindow = b.factor({ x: 3300, y: floor, z: 1000 }, up, 'floor', 'stue');
    const middle = b.factor({ x: 4200, y: floor, z: 3200 }, up, 'floor', 'stue');
    expect(nearWindow).toBeGreaterThan(middle + 0.1);
    // Midt på gulvet vs. i et hjørne.
    const poly = stue.polygon;
    const corner = poly[2]!;
    const inCorner = b.factor({ x: corner.x + Math.sign(4200 - corner.x) * 30, y: floor, z: corner.z + Math.sign(3200 - corner.z) * 30 }, up, 'floor', 'stue');
    expect(inCorner).toBeLessThan(middle - 0.1);
    // Alle faktorene er innenfor grensene.
    for (const f of [nearWindow, middle, inCorner]) {
      expect(f).toBeGreaterThanOrEqual(BAKE.min);
      expect(f).toBeLessThanOrEqual(BAKE.max);
    }
    // Utenfor leiligheten: uendret farge.
    expect(b.factor({ x: -5000, y: 0, z: -5000 }, up, 'outdoor')).toBe(1);
  });
});

describe('sollys gjennom vinduene', () => {
  const sun = LIGHTING.key.from;

  it('flekkene ligger i vinduets rom: på gulvet innenfor rommet, og på veggene mellom gulv og tak', () => {
    const patches = sunPatches(model, sun);
    expect(patches.some((p) => p.surface === 'floor')).toBe(true);
    for (const p of patches) {
      const info = model.rooms.get(p.room)!;
      const win = model.data.openings.find((o) => o.id === p.window)!;
      expect(win.type === 'window' && win.room).toBe(p.room);
      for (const q of p.points) {
        if (p.surface === 'floor') {
          expect(q.y).toBeCloseTo(info.room.floorLevel + SUN_PATCH.lift, 6);
          // Innenfor (eller på kanten av) rommet.
          const inside = pointInPolygon({ x: q.x, z: q.z }, info.polygon) || info.polygon.some((a, i) => {
            const b = info.polygon[(i + 1) % info.polygon.length]!;
            const l = Math.hypot(b.x - a.x, b.z - a.z);
            return Math.abs((b.x - a.x) * (q.z - a.z) - (b.z - a.z) * (q.x - a.x)) / l < 1;
          });
          expect(inside).toBe(true);
        } else {
          expect(q.y).toBeGreaterThanOrEqual(info.room.floorLevel - 1);
          expect(q.y).toBeLessThanOrEqual(model.ceilingAt(info, { x: q.x, z: q.z }) + 1);
        }
      }
      // Vinduskoordinatene er innenfor glasset (0–1).
      for (const [u, v] of p.uv) {
        expect(u).toBeGreaterThan(-0.01);
        expect(u).toBeLessThan(1.01);
        expect(v).toBeGreaterThan(-0.01);
        expect(v).toBeLessThan(1.01);
      }
    }
  });

  it('ingen flekker når sola er under horisonten eller står bak vinduene', () => {
    expect(sunPatches(model, [3, -1, -4])).toEqual([]);
    // Fra +z: ingen vinduer i leiligheten vender den veien.
    const back = sunPatches(model, [0, 1, 4]);
    for (const p of back) expect(['vindu-bad', 'vindu-gang']).not.toContain(p.window === '' ? '' : 'x');
    expect(back.filter((p) => p.window.startsWith('vindu-stue'))).toEqual([]);
  });

  it('klipping med et konvekst polygon', () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    const tri = [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 1, y: 3 },
    ];
    const out = clipConvex(sq, [...tri].reverse());
    let a = 0;
    for (let i = 0; i < out.length; i++) {
      const p = out[i]!;
      const q = out[(i + 1) % out.length]!;
      a += p.x * q.y - q.x * p.y;
    }
    expect(Math.abs(a / 2)).toBeCloseTo(1, 9);
    expect(clipConvex(sq, tri.map((p) => ({ x: p.x + 5, y: p.y })))).toEqual([]);
  });

  it('flekkene blir én geometri per lag med vinduskoordinater; strålene fades ut', () => {
    const patches = buildSunPatches(model, sun);
    expect(patches.size).toBeGreaterThan(0);
    for (const g of patches.values()) {
      expect(g.getAttribute('sunUv').itemSize).toBe(3);
      expect(g.getAttribute('sunUv').count).toBe(g.getAttribute('position').count);
    }
    const shafts = buildSunShafts(model, sun);
    let zeros = 0;
    let max = 0;
    for (const g of shafts.values()) {
      const c = g.getAttribute('color');
      for (let i = 0; i < c.count; i++) {
        if (c.getW(i) === 0) zeros++;
        max = Math.max(max, c.getW(i));
      }
    }
    expect(max).toBeCloseTo(SUN_PATCH.shaftAlpha, 6);
    expect(zeros).toBeGreaterThan(0);
  });
});

describe('lampelys om kvelden', () => {
  it('glød i taket og en lys flekk på gulvet under hvert lampepunkt, i lampens lag', () => {
    const lamps = model.data.fixtures.filter((f) => f.type === 'light');
    expect(lamps.length).toBeGreaterThan(0);
    const glow = buildLampGlow(model, 1);
    expect([...glow.keys()].sort()).toEqual([...new Set(lamps.map((l) => l.layer))].sort());
    const g = [...glow.values()][0]!;
    const c = g.getAttribute('color');
    const p = g.getAttribute('position');
    let max = 0;
    const ys = new Set<number>();
    for (let i = 0; i < c.count; i++) {
      max = Math.max(max, c.getW(i));
      ys.add(Math.round(p.getY(i) * 1000));
    }
    expect(max).toBeCloseTo(LAMP.halo.alpha, 6);
    // To høyder: taket og gulvet.
    expect(ys.size).toBe(2);
    expect(buildLampGlow(model, 0.5).get(lamps[0]!.layer)!.getAttribute('color').getW(0)).toBeCloseTo(LAMP.halo.alpha / 2, 6);
  });
});

describe('grafikkprofilen', () => {
  it('«Rask» er bare modellen; «Standard» har dagslys og sol uten stråler; «Høy» har alt', () => {
    const low = graphicsProfile({ quality: 'low', top: false, passthrough: false });
    expect(low.sky).toBe(false);
    expect(Object.values(low.effects).every((v) => v === false)).toBe(true);
    const med = graphicsProfile({ quality: 'medium', top: false, passthrough: false });
    expect(med.sky).toBe(true);
    expect(med.effects).toEqual({ shades: true, baked: true, sun: true, shafts: false, lamps: true, detail: true });
    // Standard i VR: samme oppløsning og foveering som før.
    expect(med.framebufferScale).toBe(1);
    expect(med.foveation).toBe(1);
    const high = graphicsProfile({ quality: 'high', top: false, passthrough: false });
    expect(high.effects.shafts).toBe(true);
    expect(high.framebufferScale).toBeGreaterThan(1);
    expect(high.foveation).toBeLessThan(1);
  });

  it('gjennomsyn har aldri himmel eller effekter; 2D-planen har dagslys, men ikke himmel, sol eller lamper', () => {
    for (const quality of ['low', 'medium', 'high'] as const) {
      const ar = graphicsProfile({ quality, top: false, passthrough: true });
      expect(ar.sky).toBe(false);
      expect([ar.effects.shades, ar.effects.sun, ar.effects.shafts, ar.effects.lamps, ar.effects.detail]).toEqual([false, false, false, false, false]);
      expect(ar.framebufferScale).toBe(1);
      const top = graphicsProfile({ quality, top: true, passthrough: false });
      expect([top.sky, top.effects.sun, top.effects.shafts, top.effects.lamps]).toEqual([false, false, false, false]);
      expect(top.effects.baked).toBe(quality !== 'low');
    }
  });
});

describe('overgang fra svart i VR', () => {
  it('starter svart, fades inn og skjules; eksponeringen løftes til 1', () => {
    const cam = new THREE.PerspectiveCamera();
    const f = new Fade(cam);
    expect(f.mesh.visible).toBe(false);
    f.enter();
    expect(f.mesh.visible).toBe(true);
    expect(f.opacity).toBe(1);
    const first = f.update(0);
    expect(first).toBeCloseTo(1 - FADE.exposureDip, 6);
    let t = 0;
    let last = 1;
    const ops: number[] = [];
    while (t < FADE.exposureTime + 0.2) {
      last = f.update(1 / 90);
      ops.push(f.opacity);
      t += 1 / 90;
    }
    expect(last).toBe(1);
    expect(f.mesh.visible).toBe(false);
    expect(f.active).toBe(false);
    // Opasiteten går bare nedover.
    for (let i = 1; i < ops.length; i++) expect(ops[i]!).toBeLessThanOrEqual(ops[i - 1]! + 1e-9);
  });

  it('hopp flytter med en gang (svart), og fades inn igjen', () => {
    const f = new Fade(new THREE.PerspectiveCamera());
    let moved = 0;
    f.jump(() => moved++);
    expect(moved).toBe(1);
    expect(f.opacity).toBe(1);
    for (let i = 0; i < 60; i++) f.update(1 / 60);
    expect(f.mesh.visible).toBe(false);
    f.jump(() => moved++);
    f.stop();
    expect(moved).toBe(2);
    expect(f.mesh.visible).toBe(false);
  });
});

describe('mønster på gulvet', () => {
  const size = DETAIL.size;
  const layers = detailLayers();

  it('tre og fliser rundt 0,5 (fargen fra fila i snitt), med mørkere fuger', () => {
    for (let l = 0; l < 2; l++) {
      let sum = 0;
      let min = 255;
      for (let i = 0; i < size * size; i++) {
        const v = layers[l * size * size + i]!;
        sum += v;
        min = Math.min(min, v);
      }
      expect(sum / (size * size)).toBeGreaterThan(115);
      expect(sum / (size * size)).toBeLessThan(140);
      // Fugene er tydelig mørkere enn snittet.
      expect(min).toBeLessThan(100);
    }
  });

  it('mønsteret går sømløst over kanten (teksturen gjentas)', () => {
    for (let l = 0; l < 2; l++) {
      let diff = 0;
      let inside = 0;
      for (let y = 0; y < size; y++) {
        const row = l * size * size + y * size;
        diff += Math.abs(layers[row]! - layers[row + size - 1]!);
        inside += Math.abs(layers[row + size / 2]! - layers[row + size / 2 - 1]!);
      }
      // Overgangen ved kanten er ikke større enn mellom to naboer midt i.
      expect(diff).toBeLessThan(inside * 1.6 + size * 2);
    }
  });

  it('rom med sluk får fliser, de andre tregulv', () => {
    const drains = model.data.fixtures.filter((f) => f.type === 'drain');
    expect(drains.length).toBeGreaterThan(0);
    const withDrain = new Set<string>();
    for (const id of model.rooms.keys()) if (floorSurface(model, id) === SURF.tile) withDrain.add(id);
    expect(withDrain.size).toBeGreaterThan(0);
    expect(floorSurface(model, 'stue')).toBe(SURF.wood);
    expect(floorSurface(model, 'finnes-ikke')).toBe(SURF.none);
  });
});
