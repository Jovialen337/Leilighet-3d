import { describe, expect, it } from 'vitest';
import { alignFromTouches } from '../../src/measure/align';
import {
  alignToAxis,
  closeRoom,
  composeRig,
  fitLine,
  medianPoint,
  placeOpening,
  wallLines,
  type P3,
  type RigPose,
} from '../../src/builder/capture';
import { compile } from '../../src/builder/compile';
import { addOpening, addRect, addRoom, commonAxis } from '../../src/builder/ops';
import { deriveWalls } from '../../src/builder/walls';
import { entranceFrame } from '../../src/builder/transform';
import { emptyBuilderDoc } from '../../src/builder/types';

/** Et punkt i referanserommet (m) til verden (m) gitt riggen (three.js: rotation.y = yaw). */
function rigApply(rig: RigPose, p: P3): P3 {
  const c = Math.cos(rig.yaw);
  const s = Math.sin(rig.yaw);
  return { x: p.x * c + p.z * s + rig.x, y: p.y + rig.y, z: -p.x * s + p.z * c + rig.z };
}

/** Litt støy (deterministisk), som en hånd som ikke er helt stødig. */
const jitter = (i: number, amp = 6): number => Math.sin(i * 12.9898) * amp;

describe('vegger fra berøringer', () => {
  it('finner linja gjennom punkter på en skrå vegg', () => {
    const a = (20 * Math.PI) / 180;
    const pts = [0, 800, 1900].map((s, i) => ({ x: 100 + s * Math.cos(a) + jitter(i, 2), z: 50 + s * Math.sin(a) + jitter(i + 7, 2) }));
    const l = fitLine(pts)!;
    expect(Math.atan2(l.u.z, l.u.x)).toBeCloseTo(a, 2);
    // Retningen følger rekkefølgen punktene ble berørt i.
    expect(l.u.x).toBeGreaterThan(0);
  });

  it('et rektangulært rom: én berøring per vegg etter den første', () => {
    // Vegg 0 langs z = 0 (to berøringer), så x = 4000, z = 3000 og x = 0.
    const walls = [
      [
        { x: 500, z: 2 },
        { x: 2500, z: -3 },
      ],
      [{ x: 4004, z: 1500 }],
      [{ x: 1800, z: 2996 }],
      [{ x: -2, z: 1200 }],
    ];
    const r = closeRoom(walls);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Hjørne 0 er mellom siste og første vegg (der man begynte), kant 0 går langs første vegg.
    expect(r.polygon).toHaveLength(4);
    // Retningen kommer fra første vegg (5 mm skjev over 2 m), så hjørnene ligger innen ~1 cm.
    const [c0, c1, c2, c3] = r.polygon;
    expect(Math.abs(c0!.x - -2)).toBeLessThan(10);
    expect(Math.abs(c0!.z)).toBeLessThan(10);
    expect(Math.abs(c1!.x - 4004)).toBeLessThan(10);
    expect(Math.abs(c2!.z - 2996)).toBeLessThan(10);
    expect(Math.abs(c3!.x - -2)).toBeLessThan(10);
  });

  it('støy i berøringene gir hjørner innenfor noen få millimeter', () => {
    const walls = [
      [
        { x: 300 + jitter(1), z: jitter(2) },
        { x: 3200 + jitter(3), z: jitter(4) },
      ],
      [{ x: 3600 + jitter(5), z: 1800 + jitter(6) }],
      [{ x: 2000 + jitter(7), z: 2700 + jitter(8) }],
      [{ x: jitter(9), z: 900 + jitter(10) }],
    ];
    const r = closeRoom(walls);
    if (!r.ok) throw new Error(r.message);
    const want = [
      [0, 0],
      [3600, 0],
      [3600, 2700],
      [0, 2700],
    ];
    r.polygon.forEach((p, i) => {
      expect(Math.abs(p.x - want[i]![0]!)).toBeLessThan(15);
      expect(Math.abs(p.z - want[i]![1]!)).toBeLessThan(15);
    });
  });

  it('en skrå vegg berørt to steder blir skrå', () => {
    // Vegg 1 går fra (4000, 0) til (3500, 3000).
    const at = (t: number) => ({ x: 4000 - 500 * t, z: 3000 * t });
    const walls = [
      [
        { x: 500, z: 0 },
        { x: 2500, z: 0 },
      ],
      [at(0.25), at(0.75)],
      [{ x: 1800, z: 3000 }],
      [{ x: 0, z: 1200 }],
    ];
    const r = closeRoom(walls);
    if (!r.ok) throw new Error(r.message);
    expect(r.polygon[1]!.x).toBeCloseTo(4000, -1);
    expect(r.polygon[2]!.x).toBeCloseTo(3500, -1);
    expect(r.polygon[2]!.z).toBeCloseTo(3000, -1);
  });

  it('L-formet rom med seks vegger', () => {
    // (0,0) → (5000,0) → (5000,2000) → (2000,2000) → (2000,4000) → (0,4000)
    const walls = [
      [
        { x: 600, z: 0 },
        { x: 3000, z: 0 },
      ],
      [{ x: 5000, z: 1000 }],
      [{ x: 3500, z: 2000 }],
      [{ x: 2000, z: 3000 }],
      [{ x: 1000, z: 4000 }],
      [{ x: 0, z: 2000 }],
    ];
    const r = closeRoom(walls);
    if (!r.ok) throw new Error(r.message);
    expect(r.polygon).toEqual([
      { x: 0, z: 0 },
      { x: 5000, z: 0 },
      { x: 5000, z: 2000 },
      { x: 2000, z: 2000 },
      { x: 2000, z: 4000 },
      { x: 0, z: 4000 },
    ]);
  });

  it('forklarer det når rommet ikke kan lukkes', () => {
    expect(closeRoom([[{ x: 0, z: 0 }]])).toEqual({ ok: false, message: expect.stringContaining('minst tre vegger') });
    // Første vegg berørt bare ett sted.
    const one = closeRoom([[{ x: 0, z: 0 }], [{ x: 3000, z: 1000 }], [{ x: 1000, z: 2000 }]]);
    expect(one).toEqual({ ok: false, message: expect.stringContaining('to steder') });
    // Tre vegger som står vinkelrett: siste og første blir parallelle.
    const three = closeRoom([
      [
        { x: 0, z: 0 },
        { x: 2000, z: 0 },
      ],
      [{ x: 3000, z: 1000 }],
      [{ x: 1000, z: 2000 }],
    ]);
    expect(three).toEqual({ ok: false, message: expect.stringContaining('parallelle') });
  });

  it('linjene bygges vegg for vegg mens man berører (for forhåndsvisning)', () => {
    expect(wallLines([[{ x: 0, z: 0 }]])).toEqual([]);
    const lines = wallLines([
      [
        { x: 0, z: 0 },
        { x: 2000, z: 0 },
      ],
      [{ x: 3000, z: 1000 }],
    ]);
    expect(lines).toHaveLength(2);
    expect(Math.abs(lines[1]!.u.x)).toBeLessThan(1e-9);
  });

  it('medianen tar bort et rykk i én av målingene', () => {
    const pts: P3[] = [
      { x: 1, y: 2, z: 3 },
      { x: 1.001, y: 2, z: 3 },
      { x: 1.5, y: 2.4, z: 3.1 },
      { x: 0.999, y: 2.001, z: 3 },
      { x: 1, y: 1.999, z: 2.999 },
    ];
    const m = medianPoint(pts)!;
    expect(m.x).toBeCloseTo(1, 2);
    expect(m.y).toBeCloseTo(2, 2);
    expect(medianPoint([])).toBeNull();
  });
});

describe('dører og vinduer fra berøringer', () => {
  const room = () => {
    const d = emptyBuilderDoc();
    addRoom(d, [
      { x: 0, z: 0 },
      { x: 4000, z: 0 },
      { x: 4000, z: 3000 },
      { x: 0, z: 3000 },
    ], 'Gang', 120);
    return d;
  };

  it('en dør: begge sider av karmen og overkanten', () => {
    const d = room();
    const r = placeOpening(d, 'door', [
      { x: 1000, y: 1100, z: 12 },
      { x: 1905, y: 900, z: 8 },
      { x: 1450, y: 2130, z: 20 },
    ], 'gang');
    if (!r.ok) throw new Error(r.message);
    expect(r.placement).toMatchObject({ room: 'gang', edge: 0, offset: 1000, width: 905, height: 2010 });
    expect(r.warning).toBeUndefined();
    // Gir en gyldig fil med døra på veggen.
    const o = addOpening(d, 'door', r.placement.room, r.placement.edge, r.placement.offset + r.placement.width / 2, { width: r.placement.width, height: r.placement.height });
    expect(o?.offset).toBe(1000);
    expect(compile(d).doc).not.toBeNull();
  });

  it('et vindu: sider, brystning og overkant', () => {
    const d = room();
    const r = placeOpening(d, 'window', [
      { x: 3990, y: 1300, z: 800 },
      { x: 3995, y: 1300, z: 2000 },
      { x: 3990, y: 1020, z: 1400 },
      { x: 3990, y: 2220, z: 1400 },
    ], 'gang');
    if (!r.ok) throw new Error(r.message);
    expect(r.placement).toMatchObject({ edge: 1, offset: 800, width: 1200, sill: 900, height: 1200 });
  });

  it('avviser karmer langt fra en vegg og for smale åpninger', () => {
    const d = room();
    const far = placeOpening(d, 'door', [
      { x: 1000, y: 0, z: 1500 },
      { x: 1900, y: 0, z: 1500 },
      { x: 1450, y: 2100, z: 1500 },
    ], 'gang');
    expect(far).toEqual({ ok: false, message: expect.stringContaining('Fant ingen vegg') });
    const narrow = placeOpening(d, 'door', [
      { x: 1000, y: 0, z: 0 },
      { x: 1100, y: 0, z: 0 },
      { x: 1050, y: 2100, z: 0 },
    ], 'gang');
    expect(narrow.ok).toBe(false);
  });

  it('advarer når karmen er et stykke fra veggen i tegningen', () => {
    const d = room();
    const r = placeOpening(d, 'passage', [
      { x: 1000, y: 0, z: 250 },
      { x: 2000, y: 0, z: 250 },
      { x: 1500, y: 2120, z: 250 },
    ], 'gang');
    if (!r.ok) throw new Error(r.message);
    expect(r.warning).toContain('25 cm');
  });
});

describe('justering mot en tegning som finnes', () => {
  it('to berøringer ved inngangsdøra gjør verden til byggerens ramme', () => {
    const d = emptyBuilderDoc();
    // Et skrått rom et stykke fra origo, gulv 150 mm.
    const a = (35 * Math.PI) / 180;
    const o = { x: 2000, z: -700 };
    const u = { x: Math.cos(a), z: Math.sin(a) };
    const v = { x: -u.z, z: u.x };
    const P = (s: number, t: number) => ({ x: o.x + u.x * s + v.x * t, z: o.z + u.z * s + v.z * t });
    addRoom(d, [P(0, 0), P(4000, 0), P(4000, 3000), P(0, 3000)], 'Gang', 150);
    addOpening(d, 'door', 'gang', 0, 800);
    const f = entranceFrame(d)!;
    // Hodesettets referanserom er dreid og flyttet i forhold til tegningen.
    const ref = { x: 0.4, y: -0.15, z: -1.2, yaw: 1.1 };
    const toRef = (p: { x: number; z: number }, y: number): P3 => {
      // Omvendt av rigApply(ref, ·): referanserommet sett fra byggerens ramme.
      const wx = p.x / 1000 - ref.x;
      const wz = p.z / 1000 - ref.z;
      const c = Math.cos(ref.yaw);
      const s = Math.sin(ref.yaw);
      return { x: wx * c - wz * s, y: y / 1000 - ref.y, z: wx * s + wz * c };
    };
    const corner = f.origin;
    const along = { x: f.origin.x + f.axis.x * 2000, z: f.origin.z + f.axis.z * 2000 };
    const q0 = toRef(corner, 150);
    const q1 = toRef(along, 1100);
    const r = alignFromTouches(q0, q1);
    if (!r.ok) throw new Error(r.message);
    const rig = composeRig(r.rig, f);
    // Begge berøringene havner der de skal i tegningen (meter).
    const w0 = rigApply(rig, q0);
    expect(w0.x).toBeCloseTo(corner.x / 1000, 6);
    expect(w0.y).toBeCloseTo(0.15, 6);
    expect(w0.z).toBeCloseTo(corner.z / 1000, 6);
    const w1 = rigApply(rig, q1);
    expect(w1.x).toBeCloseTo(along.x / 1000, 6);
    expect(w1.z).toBeCloseTo(along.z / 1000, 6);
    // Et vilkårlig punkt følger med (stiv flytting, ikke speilet).
    const far = P(3000, 2500);
    const w2 = rigApply(rig, toRef(far, 900));
    expect(w2.x).toBeCloseTo(far.x / 1000, 6);
    expect(w2.z).toBeCloseTo(far.z / 1000, 6);
  });
});

describe('nye rom rettes inn etter tegningen', () => {
  /** Rom på 3 × 2 m med hjørne i (3100, 0), dreid `deg` grader om det hjørnet. */
  const skewed = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return [
      [0, 0],
      [3000, 0],
      [3000, 2000],
      [0, 2000],
    ].map(([x, z]) => ({ x: Math.round(3100 + x! * Math.cos(a) - z! * Math.sin(a)), z: Math.round(x! * Math.sin(a) + z! * Math.cos(a)) }));
  };

  it('under 3° skjevt: dreies inn på aksen om første berøring, og blir én skillevegg', () => {
    const d = emptyBuilderDoc();
    addRect(d, { x: 0, z: 0 }, { x: 3000, z: 2000 }, 'Gang');
    const poly = skewed(1.8);
    const pivot = { x: 3100, z: 1000 };
    const r = alignToAxis(poly, commonAxis(d), pivot);
    expect(Math.abs(r.deg)).toBeCloseTo(1.8, 1);
    // Rett etterpå (innen avrundingen), og punktet man startet med står (nesten) stille.
    const [p0, p1, p2, p3] = r.polygon;
    for (const [a, b] of [[p0!.z, p1!.z], [p1!.x, p2!.x], [p2!.z, p3!.z], [p3!.x, p0!.x]]) expect(Math.abs(a! - b!)).toBeLessThanOrEqual(1);
    expect(r.moved).toBeLessThan(120);
    addRoom(d, r.polygon, 'Stue');
    const walls = deriveWalls(d.rooms, d.settings);
    expect(walls.skewed).toEqual([]);
    expect(walls.walls.filter((w) => w.kind === 'interior')).toHaveLength(1);
  });

  it('over 3° skjevt (med vilje), eller første rom: beholdes som målt', () => {
    const d = emptyBuilderDoc();
    expect(alignToAxis(skewed(2), commonAxis(d), { x: 0, z: 0 }).deg).toBe(0);
    addRect(d, { x: 0, z: 0 }, { x: 3000, z: 2000 }, 'Gang');
    const r = alignToAxis(skewed(8), commonAxis(d), { x: 3100, z: 0 });
    expect(r.deg).toBe(0);
    expect(r.polygon).toEqual(skewed(8));
  });

  it('aksen følger tegningen også når den er dreid', () => {
    const d = emptyBuilderDoc();
    const a = (30 * Math.PI) / 180;
    const rot = (x: number, z: number) => ({ x: Math.round(x * Math.cos(a) - z * Math.sin(a)), z: Math.round(x * Math.sin(a) + z * Math.cos(a)) });
    addRoom(d, [rot(0, 0), rot(3000, 0), rot(3000, 2000), rot(0, 2000)], 'Gang');
    expect(commonAxis(d)).toBeCloseTo(30, 0);
    const b = (31.5 * Math.PI) / 180;
    const poly = [
      [3100, 0],
      [6100, 0],
      [6100, 2000],
      [3100, 2000],
    ].map(([x, z]) => ({ x: x! * Math.cos(b) - z! * Math.sin(b), z: x! * Math.sin(b) + z! * Math.cos(b) }));
    expect(alignToAxis(poly, commonAxis(d), poly[0]!).deg).toBeCloseTo(-1.5, 1);
  });
});
