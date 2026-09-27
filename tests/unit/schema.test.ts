import { describe, expect, it } from 'vitest';
import { validateApartment } from '../../src/schema/validate';
import { normalize } from '../../src/schema/normalize';
import { FIXTURE_TYPES, STANDARD_LAYER_IDS } from '../../src/schema/types';
import { errorsOf, loadDoc } from './helpers';

describe('apartment.json (plassholder)', () => {
  it('er gyldig uten feil eller advarsler', () => {
    const r = validateApartment(loadDoc());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('har alle standardlag og alle objekttyper', () => {
    const d = loadDoc();
    expect(d.layers.map((l) => l.id).sort()).toEqual([...STANDARD_LAYER_IDS].sort());
    expect(new Set(d.openings.map((o) => o.type))).toEqual(new Set(['door', 'window', 'passage']));
    expect(new Set(d.fixtures.map((f) => f.type))).toEqual(new Set(FIXTURE_TYPES));
    expect(new Set(d.fixtures.map((f) => f.status))).toEqual(new Set(['existing', 'planned']));
    expect(new Set(d.furniture.flatMap((f) => f.parts.map((p) => p.shape)))).toEqual(new Set(['box', 'cylinder', 'roundedBox']));
    expect(new Set(d.outdoor.map((o) => o.kind))).toEqual(new Set(['pathway', 'garden']));
    expect(d.zones.length).toBeGreaterThan(0);
    expect(d.wiring.length).toBeGreaterThan(0);
    expect(d.notes.length).toBeGreaterThan(0);
    expect(d.rooms.map((r) => r.id)).toEqual(expect.arrayContaining(['gang', 'stue', 'kjokken', 'bad', 'planterom']));
  });

  it('markerer alt som plassholder unntatt planterommets størrelse', () => {
    const { measure } = normalize(loadDoc());
    const notPlaceholder = [...measure.entries()].filter(([, s]) => s !== 'placeholder');
    expect(notPlaceholder).toEqual([['planterom', 'partial']]);
  });

  it('godtar både rene tall og { value, measured }', () => {
    const doc = loadDoc();
    doc.walls[0]!.thickness = { value: 250, measured: true };
    const r = validateApartment(doc);
    expect(r.ok).toBe(true);
    expect(r.model!.walls.get(doc.walls[0]!.id)!.wall.thickness).toBe(250);
  });

  it('godtar en skannereferanse', () => {
    const doc = loadDoc();
    doc.scans.push({ id: 'skann-1', name: 'Skann stue', layer: 'scan-reference', url: 'skann/stue.glb', format: 'glb', position: [0, 0, 0], rotation: 0 });
    expect(validateApartment(doc).ok).toBe(true);
  });
});

describe('validering gir tydelige norske feilmeldinger', () => {
  const cases: [string, (d: Record<string, any>) => void, RegExp][] = [
    ['ikke et objekt', (d) => Object.keys(d).forEach((k) => delete d[k]), /mangler «rooms»/],
    ['manglende liste', (d) => delete d.walls, /mangler «walls»/],
    ['for få polygonpunkter', (d) => (d.rooms[0].polygon = [[0, 0], [100, 0]]), /minst 3 punkter \(fant 2\)/],
    ['selvkryssende polygon', (d) => (d.rooms[0].polygon = [[0, 0], [2300, 2400], [2300, 0], [0, 2400]]), /krysser seg selv/],
    ['for få takpunkter', (d) => d.rooms[1].ceiling.points.splice(2), /minst 3 høydepunkter/],
    ['takpunkter på linje', (d) => (d.rooms[1].ceiling.points = [{ x: 0, z: 0, height: 2000 }, { x: 1000, z: 0, height: 2100 }, { x: 2000, z: 0, height: 2200 }]), /én linje/],
    ['negativ tykkelse', (d) => (d.walls[0].thickness = -10), /«thickness» \(tykkelse\) må være større enn 0/],
    ['tekst i stedet for tall', (d) => (d.walls[0].thickness = '200'), /må være et tall/],
    ['feil målt-verdi', (d) => (d.walls[0].thickness = { value: 200, målt: true }), /ukjente felt/],
    ['ukjent vegg', (d) => (d.openings[0].wall = 'finnes-ikke'), /veggen «finnes-ikke», som ikke finnes/],
    ['ukjent rom', (d) => (d.openings[0].into = 'loft'), /rommet «loft», som ikke finnes/],
    ['vindu utenfor veggen', (d) => (d.openings[1].offset = 9400), /går utenfor veggen/],
    ['dobbel id', (d) => (d.walls[1].id = d.walls[0].id), /allerede brukt/],
    ['ukjent lag', (d) => (d.fixtures[0].layer = 'hemmelig'), /laget «hemmelig» finnes ikke/],
    ['ugyldig farge', (d) => (d.walls[0].color = 'rød'), /#rrggbb/],
    ['ugyldig hengsel', (d) => (d.openings[0].hinge = 'midt'), /«hinge» \(hengselside\) må være én av "left", "right"/],
    ['svingretning stemmer ikke', (d) => (d.openings[0].swingDirection = 'counterclockwise'), /med klokka/],
    ['dør uten rom på noen side', (d) => (d.openings[0].into = 'kjokken'), /finner ikke rommet «kjokken»/],
    ['installasjon med to plasseringer', (d) => (d.fixtures[0].position = [0, 0, 0]), /enten «mount»/],
    ['møbel uten deler', (d) => (d.furniture[0].parts = []), /minst én del/],
    ['kabel med ett punkt', (d) => (d.wiring[0].points = [[0, 0, 0]]), /minst 2 punkter/],
    ['feil skjemaversjon', (d) => (d.schemaVersion = 2), /schemaVersion/],
  ];
  for (const [name, mutate, re] of cases) {
    it(name, () => {
      const errors = errorsOf(mutate);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.join('\n')).toMatch(re);
    });
  }

  it('advarer når kontrollmål ikke stemmer med polygonet', () => {
    const doc = loadDoc();
    const room = doc.rooms.find((r) => r.id === 'planterom')!;
    room.polygon = [[0, 2500], [2300, 2500], [2300, 6000], [0, 6000]];
    const r = validateApartment(doc);
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.message).join('\n')).toMatch(/kontrollmålet lengde 3.?200 mm stemmer ikke/);
  });
});
