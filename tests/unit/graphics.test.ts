import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LIGHT_IDS, LIGHTING, LIGHTS, shadeOf } from '../../src/scene/lighting';
import { roomEdges } from '../../src/scene/roomEdges';
import { buildContactShade } from '../../src/scene/shade';
import { buildParts, partsFor } from '../../src/scene/buildParts';
import { BAKE, Baker, formFactor, mixLight, tessellate } from '../../src/scene/bake';
import { buildSunPatches, buildSunShafts, clipConvex, sunPatches, SUN_PATCH } from '../../src/scene/sunlight';
import { buildLampGlow, falloff, LAMP } from '../../src/scene/lamps';
import { EFFECT_IDS, graphicsProfile, isEffectChoices, matchingPreset, presetEffects, toggleEffect, wantedEffects } from '../../src/scene/graphicsProfile';
import { DETAIL, detailLayers, floorSurface, SURF, woodLike } from '../../src/scene/detail';
import { Fade, FADE } from '../../src/xr/fade';
import { pointInPolygon, polygonGap } from '../../src/geometry/math2d';
import { FpsMeter } from '../../src/ui/FpsMeter';
import { loadDoc, modelOf, PUBLISHED_PATH } from './helpers';
import { readFileSync } from 'node:fs';
import { ApartmentScene } from '../../src/scene/ApartmentScene';
import { Materials } from '../../src/scene/materials';

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

/** Største forskjell mellom to like lange tallrekker. */
const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
};

describe('lys: morgen, dag, kveld og natt', () => {
  it('«Dag» er standardlyset, og alle gir tydelig ulike veggretninger', () => {
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
      // Taket blir ikke svart (om kvelden og natta lyser lampene det opp i tillegg).
      expect(shadeOf({ x: 0, y: -1, z: 0 }, p)).toBeGreaterThan(id === 'natt' ? 0.06 : id === 'kveld' ? 0.2 : 0.3);
    }
  });

  it('morgensola står lavere enn dagsola, og kvelden er mørkere med lampene på', () => {
    const elev = (f: readonly number[]) => Math.atan2(f[1]!, Math.hypot(f[0]!, f[2]!));
    expect(elev(LIGHTS.morgen.key.from)).toBeLessThan(elev(LIGHTS.dag.key.from));
    expect(shadeOf({ x: 0, y: 1, z: 0 }, LIGHTS.kveld)).toBeLessThan(shadeOf({ x: 0, y: 1, z: 0 }, LIGHTS.dag));
    expect(LIGHTS.kveld.lamps).toBeGreaterThan(0);
    expect(LIGHTS.dag.lamps).toBe(0);
    // Om kvelden er dagslyset fra vinduene dempet, og lampelyset er med.
    expect(LIGHTS.kveld.bake.window).toBeLessThan(0.5);
    expect(LIGHTS.kveld.bake.lamp).toBe(1);
    expect(LIGHTS.dag.bake).toEqual({ ambient: 1, window: 1, lamp: 0 });
  });

  it('natta er mørkest: ingen sol, nesten ikke dagslys, sterkere lamper og stjerner', () => {
    const up = (id: keyof typeof LIGHTS) => shadeOf({ x: 0, y: 1, z: 0 }, LIGHTS[id]);
    expect(up('natt')).toBeLessThan(up('kveld'));
    expect(up('natt')).toBeLessThan(0.4 * up('dag'));
    expect(LIGHTS.natt.sun.strength).toBe(0);
    expect(LIGHTS.natt.bake.window).toBeLessThan(0.1);
    expect(LIGHTS.natt.lamps).toBeGreaterThan(LIGHTS.kveld.lamps);
    expect(LIGHTS.natt.bake.lamp).toBeGreaterThan(LIGHTS.kveld.bake.lamp);
    expect(LIGHTS.natt.night).toBe(1);
    for (const id of ['morgen', 'dag', 'kveld'] as const) expect(LIGHTS[id].night).toBe(0);
    // L går rundt: morgen → dag → kveld → natt.
    expect(LIGHT_IDS).toEqual(['morgen', 'dag', 'kveld', 'natt']);
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
      const winRoom = model.rooms.get(win.type === 'window' ? win.room! : '')!;
      // Vinduets rom, eller et rom uten vegg imellom.
      expect(p.room === winRoom.room.id || polygonGap(info.polygon, winRoom.polygon) < 5).toBe(true);
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
  it('glød i taket og en lys flekk på gulvet i rommets lag; den lysende undersiden i lampas lag', () => {
    const lamps = model.data.fixtures.filter((f) => f.type === 'light');
    expect(lamps.length).toBeGreaterThan(0);
    const glow = buildLampGlow(model, 1);
    const lamp = lamps[0]!;
    const pl = model.fixturePlacement(lamp)!;
    const info = model.roomAt({ x: pl.x, z: pl.z })!;
    // Lyset hører til rommet lampa henger i (rommets lag), undersiden til lampa (el-laget).
    expect([...glow.keys()].sort()).toEqual([...new Set([info.room.layer ?? 'structure', lamp.layer!])].sort());
    const g = glow.get(info.room.layer ?? 'structure')!;
    const c = g.getAttribute('color');
    const p = g.getAttribute('position');
    const floor = info.room.floorLevel;
    const kinds = { floor: 0, ceiling: 0, other: 0 };
    let max = 0;
    for (let i = 0; i < c.count; i++) {
      max = Math.max(max, c.getW(i));
      const y = p.getY(i) * 1000;
      const at = { x: p.getX(i) * 1000, z: p.getZ(i) * 1000 };
      if (Math.abs(y - (floor + LAMP.lift)) < 0.5) kinds.floor++;
      else if (Math.abs(y - (model.ceilingAt(info, at) - LAMP.lift)) < 0.5) kinds.ceiling++;
      else kinds.other++;
    }
    // Gløden følger taket (også skrått), og flekken ligger på gulvet.
    expect(kinds.floor).toBeGreaterThan(0);
    expect(kinds.ceiling).toBeGreaterThan(0);
    expect(kinds.other).toBe(0);
    expect(max).toBeCloseTo(LAMP.halo.alpha, 6);
    // Selve lampa lyser sterkest, jevnt.
    const bulb = glow.get(lamp.layer!)!.getAttribute('color');
    expect(bulb.count).toBe(LAMP.segments * 3);
    for (let i = 0; i < bulb.count; i++) expect(bulb.getW(i)).toBeCloseTo(LAMP.bulb, 6);
    expect(buildLampGlow(model, 0.5).get(info.room.layer ?? 'structure')!.getAttribute('color').getW(0)).toBeCloseTo(LAMP.halo.alpha / 2, 6);
  });

  it('lysflekken er myk: flat i midten, ingen ring i kanten', () => {
    expect(falloff(0)).toBe(1);
    expect(falloff(1)).toBe(0);
    // Flat i midten og helt flat ut mot kanten (ingen knekk).
    expect(falloff(0.1)).toBeGreaterThan(0.97);
    expect((falloff(0.99) - falloff(1)) / 0.01).toBeLessThan(0.1);
    for (let t = 0; t < 1; t += 0.05) expect(falloff(t + 0.05)).toBeLessThanOrEqual(falloff(t));
  });
});

describe('grafikkprofilen', () => {
  it('«Rask» er bare modellen; «Standard» har dagslys og sol uten stråler; «Høy» har alt', () => {
    const low = graphicsProfile({ quality: 'low', top: false, passthrough: false });
    expect(low.sky).toBe(false);
    expect(Object.values(low.effects).every((v) => v === false)).toBe(true);
    const med = graphicsProfile({ quality: 'medium', top: false, passthrough: false });
    expect(med.sky).toBe(true);
    expect(med.effects).toEqual({ shades: true, baked: true, sun: true, shafts: false, lamps: true, bakedLamps: true, detail: true });
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
      // Røntgen: ingen sol, stråler eller lamper (men himmel og bakt lys).
      const xray = graphicsProfile({ quality, top: false, passthrough: false, xray: true });
      expect([xray.effects.sun, xray.effects.shafts, xray.effects.lamps]).toEqual([false, false, false]);
      expect(xray.sky).toBe(quality !== 'low');
    }
  });

  it('«Egendefinert»: hver effekt for seg, også skarpere bilde, med forhåndsvalget som utgangspunkt', () => {
    // Lysstråler på «Standard»: blir «Egendefinert» med Standard + stråler.
    let t = toggleEffect('medium', {}, 'shafts');
    expect(t.quality).toBe('custom');
    expect(t.custom).toEqual({ ...presetEffects('medium'), shafts: true });
    const p = graphicsProfile({ quality: t.quality, top: false, passthrough: false, custom: t.custom });
    expect(p.effects).toMatchObject({ shafts: true, sun: true, detail: true });
    // Stråler uten skarpere bilde: samme oppløsning som «Standard».
    expect([p.framebufferScale, p.foveation]).toEqual([1, 1]);
    // Skarpere bilde uten stråler.
    const sharp = graphicsProfile({ quality: 'custom', top: false, passthrough: false, custom: { sharp: true } });
    expect([sharp.framebufferScale, sharp.foveation, sharp.effects.shafts]).toEqual([1.3, 0.25, false]);
    // Blir settet likt et forhåndsvalg, er det det forhåndsvalget.
    t = toggleEffect('custom', t.custom, 'sharp');
    expect(t.quality).toBe('high');
    expect(matchingPreset(presetEffects('low'))).toBe('low');
    // Lampelys av: heller ikke bakt inn i fargene; himmel av; dagslys styrer også de myke skyggene.
    const own = graphicsProfile({ quality: 'custom', top: false, passthrough: false, custom: { lamps: false, sky: false, baked: false } });
    expect([own.effects.lamps, own.effects.bakedLamps, own.sky, own.effects.baked, own.effects.shades]).toEqual([false, false, false, false, false]);
    // Et lagret sett som mangler noe, er som «Standard» der.
    expect(wantedEffects('custom', { shafts: true })).toEqual({ ...presetEffects('medium'), shafts: true });
    // Forhåndsvalgene bryr seg ikke om det lagrede settet.
    for (const q of ['low', 'medium', 'high'] as const) expect(wantedEffects(q, { sun: false, shafts: true })).toEqual(presetEffects(q));
  });

  it('egne valg slår aldri på noe i gjennomsyn, 2D-planen eller røntgen', () => {
    // Alle 2^7 sett: reglene for gjennomsyn, 2D og røntgen gjelder alltid, og ingenting er tyngre enn «Høy».
    const high = graphicsProfile({ quality: 'high', top: false, passthrough: false });
    for (let bits = 0; bits < 1 << EFFECT_IDS.length; bits++) {
      const custom = Object.fromEntries(EFFECT_IDS.map((id, i) => [id, (bits & (1 << i)) !== 0]));
      const ar = graphicsProfile({ quality: 'custom', top: false, passthrough: true, custom });
      expect([ar.sky, ar.effects.shades, ar.effects.sun, ar.effects.shafts, ar.effects.lamps, ar.effects.detail, ar.framebufferScale, ar.foveation]).toEqual([
        false, false, false, false, false, false, 1, 1,
      ]);
      const top = graphicsProfile({ quality: 'custom', top: true, passthrough: false, custom });
      expect([top.sky, top.effects.sun, top.effects.shafts, top.effects.lamps]).toEqual([false, false, false, false]);
      const xray = graphicsProfile({ quality: 'custom', top: false, passthrough: false, xray: true, custom });
      expect([xray.effects.sun, xray.effects.shafts, xray.effects.lamps]).toEqual([false, false, false]);
      const vr = graphicsProfile({ quality: 'custom', top: false, passthrough: false, custom });
      for (const [k, v] of Object.entries(vr.effects)) if (v) expect(high.effects[k as keyof typeof high.effects]).toBe(true);
      expect(vr.framebufferScale).toBeLessThanOrEqual(high.framebufferScale);
    }
  });

  it('lagrede effektvalg sjekkes: bare kjente effekter med av/på', () => {
    expect(isEffectChoices({ shafts: true, sky: false })).toBe(true);
    expect(isEffectChoices({})).toBe(true);
    for (const bad of [null, [], 'ja', { shafts: 'ja' }, { tåke: true }, { sun: 1 }]) expect(isEffectChoices(bad)).toBe(false);
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

  it('tre, fliser og belegg rundt 0,5 (fargen fra fila i snitt); tre og fliser med mørkere fuger', () => {
    for (let l = 0; l < 3; l++) {
      let sum = 0;
      let min = 255;
      for (let i = 0; i < size * size; i++) {
        const v = layers[l * size * size + i]!;
        sum += v;
        min = Math.min(min, v);
      }
      expect(sum / (size * size)).toBeGreaterThan(115);
      expect(sum / (size * size)).toBeLessThan(140);
      // Fugene er tydelig mørkere enn snittet (belegget har ingen fuger).
      if (l < 2) expect(min).toBeLessThan(100);
      else expect(min).toBeGreaterThan(100);
    }
  });

  it('mønsteret går sømløst over kanten (teksturen gjentas)', () => {
    for (let l = 0; l < 3; l++) {
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

  it('rom med sluk får fliser, trefargede gulv tregulv, resten belegg', () => {
    const drains = model.data.fixtures.filter((f) => f.type === 'drain');
    expect(drains.length).toBeGreaterThan(0);
    const withDrain = new Set<string>();
    for (const id of model.rooms.keys()) if (floorSurface(model, id) === SURF.tile) withDrain.add(id);
    expect(withDrain.size).toBeGreaterThan(0);
    expect(floorSurface(model, 'stue')).toBe(SURF.wood);
    expect(floorSurface(model, 'finnes-ikke')).toBe(SURF.none);
    // Grønt planteromsgulv og grått kjøkkengulv får ikke trebord.
    expect(woodLike('#7d8a6b')).toBe(false);
    expect(woodLike('#c9c4ba')).toBe(false);
    expect(woodLike('#b99a74')).toBe(true);
    const pub = modelOf(JSON.parse(readFileSync(PUBLISHED_PATH, 'utf8')));
    expect(floorSurface(pub, 'planterom')).toBe(SURF.vinyl);
    expect(floorSurface(pub, 'stue')).toBe(SURF.wood);
    expect(floorSurface(pub, 'bad-hoy')).toBe(SURF.tile);
  });
});

describe('meshene som ikke er endret, gjenbrukes', () => {
  it('en ny kabel slår bare sammen kablenes mesh på nytt', () => {
    const scene = new ApartmentScene(new Materials());
    const doc = loadDoc();
    scene.build(modelOf(doc));
    const geoOf = (layer: string, bucket: string) => scene.merged.find((m) => m.layer === layer && m.bucket === bucket)?.mesh.geometry;
    const wall = geoOf('structure', 'wall');
    const solid = geoOf('structure', 'solid');
    const wiredLayer = doc.wiring[0]!.layer;
    const wires = geoOf(wiredLayer, 'lines');
    const wired = loadDoc();
    wired.wiring.push({ id: 'ny-kabel', layer: wiredLayer, status: 'planned', points: [[500, 300, 500], [900, 300, 500]] } as never);
    scene.build(modelOf(wired));
    expect(geoOf('structure', 'wall')).toBe(wall);
    expect(geoOf('structure', 'solid')).toBe(solid);
    expect(geoOf(wiredLayer, 'lines')).not.toBe(wires);
    // Meshene ligger i lagene igjen, og områdene per objekt peker på dem.
    expect(geoOf('structure', 'wall') && scene.layerGroups.get('structure')!.children.some((c) => (c as THREE.Mesh).geometry === wall)).toBe(true);
    expect(scene.ranges.get('ny-kabel')?.[0]?.mesh.mesh.geometry).toBe(geoOf(wiredLayer, 'lines'));
  });
});

describe('bakt lys gjenbrukes når modellen bygges på nytt', () => {
  const floorGeo = (scene: ApartmentScene): THREE.BufferGeometry =>
    scene.merged.find((m) => m.layer === 'structure' && m.bucket === 'solid')!.mesh.geometry;

  it('en ny kabel bygger ikke gulv, vegger og tak på nytt; en flyttet vegg gjør det', () => {
    const scene = new ApartmentScene(new Materials());
    const doc = loadDoc();
    scene.build(modelOf(doc));
    const tessNow = () =>
      [...(scene as unknown as { bakeCache: Map<string, { tess: THREE.BufferGeometry | null }> }).bakeCache.values()]
        .map((e) => e.tess)
        .filter(Boolean);
    const before = new Set(tessNow());
    expect(before.size).toBeGreaterThan(5);
    const colors = Float32Array.from(floorGeo(scene).getAttribute('color').array as Float32Array);

    // Tegner en kabel: alle oppdelte flater er de samme objektene, og fargene er like.
    const wired = loadDoc();
    wired.wiring.push({ id: 'ny-kabel', layer: wired.wiring[0]!.layer, status: 'planned', points: [[500, 300, 500], [900, 300, 500]] } as never);
    scene.build(modelOf(wired));
    const after = tessNow();
    expect(after.length).toBe(before.size);
    expect(after.every((t) => before.has(t))).toBe(true);
    expect(Array.from(floorGeo(scene).getAttribute('color').array as Float32Array)).toEqual(Array.from(colors));


    // Et vindu flyttes: lyset bakes på nytt (nye flater), og de gamle frigjøres.
    const moved = loadDoc();
    const win = moved.openings.find((o) => o.type === 'window')! as { offset: number };
    win.offset += 200;
    scene.build(modelOf(moved));
    const rebaked = tessNow();
    expect(rebaked.length).toBe(before.size);
    expect(rebaked.some((t) => before.has(t))).toBe(false);
  });
});

describe('sollys og lampelys følger rommene', () => {
  it('kveldssola gjennom badevinduet lyser opp badet uten vegg imellom', () => {
    const pub = modelOf(JSON.parse(readFileSync(PUBLISHED_PATH, 'utf8')));
    const patches = sunPatches(pub, LIGHTS.kveld.key.from);
    const bath = patches.filter((p) => p.window === 'vindu-bad');
    expect(bath.length).toBeGreaterThan(0);
    // Lyset havner i badets andre del (åpen overgang), ikke bare i rommet med vinduet.
    expect(bath.some((p) => p.room === 'bad')).toBe(true);
  });

  it('lampelyset stopper ved veggene og følger filteret', () => {
    const glow = buildLampGlow(model, 1);
    const g = [...glow.values()][0]!;
    const p = g.getAttribute('position');
    const lamp = model.data.fixtures.find((f) => f.type === 'light')!;
    const room = model.roomAt(model.fixturePlacement(lamp)! as never)!;
    for (let i = 0; i < p.count; i++) {
      const q = { x: p.getX(i) / 0.001, z: p.getZ(i) / 0.001 };
      const inside = pointInPolygon(q, room.polygon) || room.polygon.some((a, k) => {
        const b = room.polygon[(k + 1) % room.polygon.length]!;
        const l = Math.hypot(b.x - a.x, b.z - a.z);
        return Math.abs((b.x - a.x) * (q.z - a.z) - (b.z - a.z) * (q.x - a.x)) / l < 1;
      });
      expect(inside).toBe(true);
    }
    // Filteret: lampa er ikke med → ingen glød.
    expect(buildLampGlow(model, 1, () => false).size).toBe(0);
  });
});

describe('ingen flater oppå hverandre (de ville flimret med bakt lys)', () => {
  /**
   * Par av vegger med flater i samme plan, samme vei, som overlapper (mer enn
   * 2 × 2 mm) der det synes fra et rom (inne i en annen vegg synes det ikke).
   */
  function overlaps(m: ReturnType<typeof modelOf>): string[] {
    const boxes: { id: string; plane: string; u0: number; u1: number; v0: number; v1: number }[] = [];
    for (const p of buildParts(m)) {
      if (p.kind !== 'wall') continue;
      const a = p.geometry.getAttribute('position');
      const n = p.geometry.getAttribute('normal');
      for (let i = 0; i < a.count; i += 3) {
        const nn = [n.getX(i), n.getY(i), n.getZ(i)];
        const axis = nn.findIndex((c) => Math.abs(c) > 0.999);
        if (axis < 0 || axis === 1) continue;
        const pts = [0, 1, 2].map((k) => [a.getX(i + k), a.getY(i + k), a.getZ(i + k)]);
        const [o1, o2] = [0, 1, 2].filter((k) => k !== axis) as [number, number];
        const us = pts.map((q) => q[o1]!);
        const vs = pts.map((q) => q[o2]!);
        boxes.push({ id: p.id, plane: `${axis}${nn[axis]! > 0 ? '+' : '-'}${pts[0]![axis]!.toFixed(4)}`, u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) });
      }
    }
    const out = new Set<string>();
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (a.id === b.id || a.plane !== b.plane) continue;
        if (Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0) <= 0.002 || Math.min(a.v1, b.v1) - Math.max(a.v0, b.v0) <= 0.002) continue;
        // Midt i overlappet, litt ut fra flaten: står man i et rom der?
        const axis = Number(a.plane[0]);
        const sign = a.plane[1] === '+' ? 1 : -1;
        const off = Number(a.plane.slice(2)) * 1000 + sign * 5;
        const cu = ((Math.max(a.u0, b.u0) + Math.min(a.u1, b.u1)) / 2) * 1000;
        const pt = axis === 0 ? { x: off, z: ((Math.max(a.v0, b.v0) + Math.min(a.v1, b.v1)) / 2) * 1000 } : { x: cu, z: off };
        if ([...m.rooms.values()].some((r) => pointInPolygon(pt, r.polygon))) out.add(`${a.plane} ${a.id}/${b.id}`);
      }
    return [...out];
  }

  it('veggender som er dekket av en annen vegg i hjørnet, tegnes ikke', () => {
    expect(overlaps(model)).toEqual([]);
    expect(overlaps(modelOf(JSON.parse(readFileSync(PUBLISHED_PATH, 'utf8'))))).toEqual([]);
  });

  /**
   * Sideflater fra en vegg som går inn i en annen (hjørner der veggene
   * overlapper), med en kant akkurat i den andre veggens synlige flate: der
   * flimrer de gjennom som en prikkete strek.
   */
  function hiddenEdgesOnSurfaces(m: ReturnType<typeof modelOf>): string[] {
    type Tri = { id: string; pts: number[][]; axis: number; sign: number };
    const tris: Tri[] = [];
    for (const p of buildParts(m)) {
      if (p.kind !== 'wall') continue;
      const a = p.geometry.getAttribute('position');
      const n = p.geometry.getAttribute('normal');
      for (let i = 0; i < a.count; i += 3) {
        const nn = [n.getX(i), n.getY(i), n.getZ(i)];
        const axis = nn.findIndex((c) => Math.abs(c) > 0.999);
        if (axis < 0 || axis === 1) continue;
        tris.push({ id: p.id, pts: [0, 1, 2].map((k) => [a.getX(i + k) * 1000, a.getY(i + k) * 1000, a.getZ(i + k) * 1000]), axis, sign: Math.sign(nn[axis]!) });
      }
    }
    const out = new Set<string>();
    for (const b of tris) {
      const off = b.pts[0]![b.axis]!;
      const o = b.axis === 0 ? 2 : 0;
      const u0 = Math.min(...b.pts.map((q) => q[o]!));
      const u1 = Math.max(...b.pts.map((q) => q[o]!));
      const v0 = Math.min(...b.pts.map((q) => q[1]!));
      const v1 = Math.max(...b.pts.map((q) => q[1]!));
      for (const a of tris) {
        if (a.id === b.id || a.axis === b.axis) continue;
        const on = a.pts.filter((q) => Math.abs(q[b.axis]! - off) < 1);
        if (on.length < 2) continue;
        // Resten av flaten ligger bak den synlige flaten (inne i den andre veggen).
        if (!a.pts.some((q) => b.sign * (q[b.axis]! - off) < -1)) continue;
        for (const q of on) {
          if (q[o]! <= u0 + 1 || q[o]! >= u1 - 1 || q[1]! <= v0 + 1 || q[1]! >= v1 - 1) continue;
          const front = b.axis === 0 ? { x: off + b.sign * 5, z: q[2]! } : { x: q[0]!, z: off + b.sign * 5 };
          if ([...m.rooms.values()].some((r) => pointInPolygon(front, r.polygon))) out.add(`${a.id} i flaten til ${b.id}`);
        }
      }
    }
    return [...out];
  }

  it('ingen skjult sideflate har en kant i en synlig veggflate (ingen prikkete strek i hjørnet på badet)', () => {
    expect(hiddenEdgesOnSurfaces(model)).toEqual([]);
    // Den publiserte fila: badet er fikset. Kjent igjen (senere arbeid, PLAN.md): tre vegger som går
    // inn i hverandre der gang, stue og planterom møtes, uten at endene ligger i en annen veggs flate.
    expect(hiddenEdgesOnSurfaces(modelOf(JSON.parse(readFileSync(PUBLISHED_PATH, 'utf8')))).sort()).toEqual([
      'v-planterom-bunn i flaten til v-gang-hoyre',
      'v-planterom-bunn i flaten til v-stue-plante',
      'v-stue-plante i flaten til v-gang-hoyre',
    ]);
  });

  it('fotlisten stopper bak geriktene ved dører', () => {
    const parts = buildParts(model);
    const door = model.data.openings.find((o) => o.id === 'dor-bad')!;
    const span = model.openingSpan(door)!;
    // Ingen fotlist går inn i døråpningen: alle fotlister slutter minst en gerikt unna kanten.
    for (const p of parts.filter((q) => q.kind === 'trim' && model.rooms.has(q.id))) {
      const a = p.geometry.getAttribute('position');
      for (let i = 0; i < a.count; i++) {
        const q = { x: a.getX(i) * 1000, z: a.getZ(i) * 1000 };
        const n = (q.x - span.frame.p0.x) * span.frame.left.x + (q.z - span.frame.p0.z) * span.frame.left.z;
        if (n < span.frame.nMin - 20 || n > span.frame.nMax + 20) continue;
        const u = (q.x - span.frame.p0.x) * span.frame.dir.x + (q.z - span.frame.p0.z) * span.frame.dir.z;
        expect(u < span.u0 - 50 || u > span.u1 + 50).toBe(true);
      }
    }
  });
});

describe('lampelyset bakes inn, og «Lys» blander lyset på nytt', () => {
  it('kveld: lampa er det lyseste i stua, og dagslyset fra vinduene er dempet', () => {
    const b = new Baker(model);
    const up = { x: 0, y: 1, z: 0 };
    const lamp = model.data.fixtures.find((f) => f.type === 'light')!;
    const pl = model.fixturePlacement(lamp)!;
    const floor = model.rooms.get('stue')!.room.floorLevel;
    const under = b.parts({ x: pl.x, y: floor, z: pl.z }, up, 'floor', 'stue');
    const byWindow = b.parts({ x: 3300, y: floor, z: 1000 }, up, 'floor', 'stue');
    expect(under.lamp).toBeGreaterThan(0.3);
    const kveld = (l: { amb: number; win: number; lamp: number }) => mixLight(l.amb, l.win, l.lamp, LIGHTS.kveld.bake);
    const dag = (l: { amb: number; win: number; lamp: number }) => mixLight(l.amb, l.win, l.lamp, LIGHTS.dag.bake);
    // Om kvelden er det lysere under lampa enn ved vinduet; om dagen omvendt.
    expect(kveld(under)).toBeGreaterThan(kveld(byWindow));
    expect(dag(byWindow)).toBeGreaterThan(dag(under) - 0.05);
    // Lyset flater mykt ut: aldri over taket på faktoren.
    expect(mixLight(5, 5, 5, { ambient: 1, window: 1, lamp: 1 })).toBeLessThanOrEqual(BAKE.max);
  });

  it('scenen blander fargene på nytt når «Lys» endres, uten å bake på nytt', () => {
    const scene = new ApartmentScene(new Materials());
    scene.build(model);
    const geo = scene.merged.find((m) => m.layer === 'structure' && m.bucket === 'solid')!.mesh.geometry;
    const cache = (scene as unknown as { bakeCache: Map<string, unknown> }).bakeCache;
    const before = Float32Array.from(geo.getAttribute('color').array as Float32Array);
    const entries = [...cache.values()];
    scene.setLight(LIGHTS.kveld);
    const after = geo.getAttribute('color').array as Float32Array;
    let darker = 0;
    for (let i = 0; i < before.length; i++) if (after[i]! < before[i]! - 1e-4) darker++;
    expect(darker).toBeGreaterThan(before.length / 4);
    // Ingenting er bakt på nytt.
    expect([...cache.values()]).toEqual(entries);
  });

  it('lampelyset følger lampene: en ny lampe gir samme farger som en fersk baking, og slettet blir det som før', () => {
    const withLamp = (): ReturnType<typeof modelOf> => {
      const doc = loadDoc();
      doc.fixtures.push({ id: 'lampe-ny', name: 'Ny lampe', measured: false, type: 'light', layer: 'electrical-planned', status: 'planned', position: [1150, 2100, 4100] } as never);
      return modelOf(doc);
    };
    const structure = (scene: ApartmentScene): number[] =>
      scene.merged.filter((m) => m.layer === 'structure').flatMap((m) => [...(m.mesh.geometry.getAttribute('color').array as Float32Array)]);
    const sceneFor = (m: ReturnType<typeof modelOf>): ApartmentScene => {
      const sc = new ApartmentScene(new Materials());
      sc.setLight(LIGHTS.kveld);
      sc.build(m);
      return sc;
    };
    const warm = sceneFor(model);
    const before = structure(warm);
    warm.build(withLamp());
    const drawn = structure(warm);
    const fresh = structure(sceneFor(withLamp()));
    expect(drawn.length).toBe(fresh.length);
    expect(maxDiff(drawn, fresh)).toBeLessThan(1e-5);
    expect(maxDiff(drawn, before)).toBeGreaterThan(0.05);
    warm.build(model);
    const deleted = structure(warm);
    expect(maxDiff(deleted, before)).toBeLessThan(1e-5);
  });

  it('lampelyset følger filteret for el: skjult lampe lyser ikke, heller ikke det bakte lyset', () => {
    const doc = loadDoc();
    doc.fixtures = doc.fixtures.filter((f) => f.type !== 'light');
    const noLamp = modelOf(doc);
    // Vegger og tak (filteret skjuler ingen av dem, så meshene er like store).
    const structure = (scene: ApartmentScene): number[] =>
      scene.merged
        .filter((m) => m.layer === 'structure' && (m.bucket === 'wall' || m.bucket === 'ceiling'))
        .flatMap((m) => [...(m.mesh.geometry.getAttribute('color').array as Float32Array)]);
    const sceneFor = (m: ReturnType<typeof modelOf>): ApartmentScene => {
      const sc = new ApartmentScene(new Materials());
      sc.setLight(LIGHTS.kveld);
      sc.build(m);
      return sc;
    };
    const dark = structure(sceneFor(noLamp));
    const sc = sceneFor(model);
    const lit = structure(sc);
    expect(maxDiff(lit, dark)).toBeGreaterThan(0.05);
    for (const f of [
      { existing: false, planned: true, circuit: null },
      { existing: true, planned: true, circuit: 'kurs-2' },
    ]) {
      sc.setFilter(f);
      const hidden = structure(sc);
      expect(maxDiff(hidden, dark)).toBeLessThan(1e-5);
      expect(sc.lightMeshes.some((m) => m.userData.effect === 'lamper' && m.geometry.getAttribute('position').count > 0)).toBe(false);
      sc.setFilter({ existing: true, planned: true, circuit: null });
      const back = structure(sc);
      expect(maxDiff(back, lit)).toBeLessThan(1e-5);
    }
    // «Lampelys» av: heller ikke bakt inn.
    sc.setEffects({ shades: true, baked: true, sun: true, shafts: false, lamps: false, bakedLamps: false, detail: true });
    const off = structure(sc);
    expect(maxDiff(off, dark)).toBeLessThan(1e-5);
  });

  it('kveld: blått lys fra vinduene og varme lamper; lysstyrken er den samme som uten farge', () => {
    const sc = new ApartmentScene(new Materials());
    sc.setLight(LIGHTS.kveld);
    sc.build(model);
    const m = sc.merged.find((x) => x.layer === 'structure' && x.bucket === 'ceiling')!;
    const l = m.light!;
    const ratio = (i: number, c: number): number => m.bakedColors[i * 3 + c]! / m.baseColors[i * 3 + c]!;
    let lampI = 0;
    for (let i = 0; i < l.lamp.length; i++) if (l.lamp[i]! > l.lamp[lampI]!) lampI = i;
    expect(ratio(lampI, 0)).toBeGreaterThan(ratio(lampI, 2) * 1.3);
    const w = sc.merged.find((x) => x.layer === 'structure' && x.bucket === 'wall')!;
    const wl = w.light!;
    let winI = 0;
    for (let i = 0; i < wl.win.length; i++) if (wl.win[i]! - wl.lamp[i]! > wl.win[winI]! - wl.lamp[winI]!) winI = i;
    expect(w.bakedColors[winI * 3 + 2]! / w.baseColors[winI * 3 + 2]!).toBeGreaterThan(w.bakedColors[winI * 3]! / w.baseColors[winI * 3]!);
    // Lysstyrken (luminans) følger fortsatt faktoren uten farge, innen 10 %.
    const f = mixLight(l.amb[lampI]!, l.win[lampI]!, l.lamp[lampI]!, LIGHTS.kveld.bake);
    const lum = 0.2126 * ratio(lampI, 0) + 0.7152 * ratio(lampI, 1) + 0.0722 * ratio(lampI, 2);
    expect(Math.abs(lum - f) / f).toBeLessThan(0.1);
  });

  it('natt: ingen solflekker eller stråler (ingen tegnekall for dem), men lampene lyser', () => {
    const scene = new ApartmentScene(new Materials());
    scene.setEffects({ shades: true, baked: true, sun: true, shafts: true, lamps: true, detail: true });
    scene.build(model);
    scene.setLight(LIGHTS.natt);
    const kinds = scene.lightMeshes.map((m) => m.userData.effect);
    expect(kinds).not.toContain('sol');
    expect(kinds).not.toContain('stråler');
    expect(kinds).toContain('lamper');
    scene.setLight(LIGHTS.dag);
    expect(scene.lightMeshes.some((m) => m.userData.effect === 'sol')).toBe(true);
    expect(scene.lightMeshes.some((m) => m.userData.effect === 'lamper')).toBe(false);
  });

  it('«Rask» baker ikke; lyset bakes først når det trengs', () => {
    const scene = new ApartmentScene(new Materials());
    scene.setEffects({ shades: false, baked: false, sun: false, shafts: false, lamps: false, detail: false });
    scene.build(model);
    const cache = (scene as unknown as { bakeCache: Map<string, unknown> }).bakeCache;
    expect(cache.size).toBe(0);
    scene.setEffects({ shades: true, baked: true, sun: true, shafts: false, lamps: true, detail: true });
    expect(cache.size).toBe(0); // byttet ut med et nytt kart
    expect((scene as unknown as { bakeCache: Map<string, unknown> }).bakeCache.size).toBeGreaterThan(5);
  });
});

describe('å bygge modellen på nytt etter en tegning går raskt', () => {
  it('med lagret bakt lys tar det under 60 % av tiden det tar å bake alt', () => {
    const doc = JSON.parse(readFileSync(PUBLISHED_PATH, 'utf8'));
    const scene = new ApartmentScene(new Materials());
    const time = (f: () => void): number => {
      const t0 = performance.now();
      f();
      return performance.now() - t0;
    };
    const cache = () => scene as unknown as { bakeCache: Map<string, unknown> };
    scene.build(modelOf(doc)); // varmer opp
    let cold = 0;
    let warm = 0;
    for (let i = 0; i < 3; i++) {
      cache().bakeCache = new Map();
      cold += time(() => scene.build(modelOf(doc)));
      // Ett nytt rørpunkt (som når man tegner): resten er uendret.
      const drawn = JSON.parse(JSON.stringify(doc));
      drawn.pipes = [...(drawn.pipes ?? []), { id: `nytt-ror-${i}`, layer: 'plumbing-planned', kind: 'cold', status: 'planned', points: [[1000, 300, 1000], [1500, 300, 1000]] }];
      warm += time(() => scene.build(modelOf(drawn)));
    }
    expect(warm).toBeLessThan(cold * 0.6);
  });
});
