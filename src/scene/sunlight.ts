/**
 * Sollys gjennom vinduene. Sola (retningen i lyset som er valgt, se
 * lighting.ts) skinner gjennom glasset og lager lyse flekker på gulvet og
 * veggene innenfor, med skyggen av karmen og midtposten. Formen regnes ut fra
 * vinduene og rommene i apartment.json; bare retningen og fargen er
 * presentasjon.
 *
 * - Flekkene: hvert vindu sitt lysåpning (glasset, og hullet i veggen på begge
 *   sider) projiseres langs solstrålene ned på gulvet og veggene i rommet, og
 *   flaten klippes til det som er lyst gjennom alle tre. Hvert hjørne får
 *   vinduskoordinater (0–1 over glasset), så skyggeleggeren kan tegne
 *   midtposten og myke kanter.
 * - Strålene («Høy»): svake lyssøyler fra glasset inn i rommet, som fades ut.
 *
 * Alt blir én geometri per slag (ett tegnekall hver). Mm inn, meter ut.
 */
import * as THREE from 'three';
import { frameAt, type ApartmentModel, type RoomInfo } from '../model/ApartmentModel';
import { polygonGap } from '../geometry/math2d';
import { roomEdges } from './roomEdges';
import { MM } from './geom';
import { WINDOW_FRAME } from './buildParts';

export interface V3 {
  x: number;
  y: number;
  z: number;
}


export const SUN_PATCH = {
  /** Hvor langt fra flaten flekken ligger (mm), så den ikke flimrer. */
  lift: 2,
  /** Lavere sol enn dette (sinus til høyden) gir ingen flekker. */
  minElevation: 0.05,
  /** Strålene: lengde (mm) og alfa ved glasset. */
  shaftLength: 1400,
  shaftAlpha: 0.16,
} as const;

type Pt = { x: number; y: number };

const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
const sub3 = (a: V3, b: V3): V3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const addS = (a: V3, b: V3, s: number): V3 => v3(a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);
const dot3 = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/** Retningen lyset går (fra sola), normalisert. */
export function sunTravel(towardSun: readonly [number, number, number]): V3 {
  const [x, y, z] = towardSun;
  const l = Math.hypot(x, y, z) || 1;
  return v3(-x / l, -y / l, -z / l);
}

/** Klipper polygonet til venstre side av linja a→b (Sutherland–Hodgman). */
function clipHalf(poly: readonly Pt[], a: Pt, b: Pt): Pt[] {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const side = (p: Pt): number => ex * (p.y - a.y) - ey * (p.x - a.x);
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const sp = side(p);
    const sq = side(q);
    if (sp >= 0) out.push(p);
    if (sp >= 0 !== sq >= 0) {
      const t = sp / (sp - sq);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  }
  return out;
}

const area2 = (poly: readonly Pt[]): number => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
};

/** Klipper `poly` med et konvekst polygon (hvilken som helst vinding). */
export function clipConvex(poly: readonly Pt[], convex: readonly Pt[]): Pt[] {
  const c = area2(convex) >= 0 ? convex : [...convex].reverse();
  let out: Pt[] = [...poly];
  for (let i = 0; i < c.length && out.length >= 3; i++) out = clipHalf(out, c[i]!, c[(i + 1) % c.length]!);
  return out.length >= 3 && Math.abs(area2(out)) > 1e-6 ? out : [];
}

/** En flate lyset kan treffe: plan med akser og et område (mm) i planets koordinater. */
interface Surface {
  origin: V3;
  ax: V3;
  ay: V3;
  /** Normal ut fra flaten, inn i rommet. */
  normal: V3;
  region: Pt[];
}

/** Et vindu sett fra rommet: lysåpningene (rektangler i 3D) og glasset (for uv). */
export interface WindowLight {
  id: string;
  room: RoomInfo;
  /** Glasset og hullet i veggen på begge sider; lyset må gjennom alle. */
  apertures: V3[][];
  /** Glassplanet: et punkt, normalen og aksene (mm) som gir uv 0–1 over glasset. */
  glass: { origin: V3; normal: V3; u: V3; uLen: number; vLen: number; v0: number };
  /** Halve bredden av midtposten i uv. */
  mullion: number;
}

/** Vinduene som vender mot sola, med lysåpningene sine. */
export function sunWindows(model: ApartmentModel, travel: V3): WindowLight[] {
  const out: WindowLight[] = [];
  if (-travel.y < SUN_PATCH.minElevation) return out;
  for (const o of model.data.openings) {
    if (o.type !== 'window' || !o.room) continue;
    const room = model.rooms.get(o.room);
    const span = model.openingSpan(o);
    if (!room || !span) continue;
    const f = span.frame;
    const side = model.sideOfRoom(f, o.room, (span.u0 + span.u1) / 2);
    if (!side) continue;
    const inward = side === 'left' ? f.left : { x: -f.left.x, z: -f.left.z };
    // Sola må stå på utsiden: lyset går inn i rommet gjennom glasset.
    if (travel.x * inward.x + travel.z * inward.z <= 1e-3) continue;
    const fw = WINDOW_FRAME;
    const midN = (f.nMin + f.nMax) / 2;
    const rect = (u0: number, u1: number, y0: number, y1: number, n: number): V3[] => {
      const a = frameAt(f, u0, n);
      const b = frameAt(f, u1, n);
      return [v3(a.x, y0, a.z), v3(b.x, y0, b.z), v3(b.x, y1, b.z), v3(a.x, y1, a.z)];
    };
    const gu0 = span.u0 + fw;
    const gu1 = span.u1 - fw;
    const gy0 = span.bottom + fw;
    const gy1 = span.top - fw;
    if (gu1 - gu0 < 50 || gy1 - gy0 < 50) continue;
    const g0 = frameAt(f, gu0, midN);
    out.push({
      id: o.id,
      room,
      apertures: [
        rect(gu0, gu1, gy0, gy1, midN),
        rect(span.u0, span.u1, span.bottom, span.top, f.nMin),
        rect(span.u0, span.u1, span.bottom, span.top, f.nMax),
      ],
      glass: { origin: v3(g0.x, 0, g0.z), normal: v3(f.left.x, 0, f.left.z), u: v3(f.dir.x, 0, f.dir.z), uLen: gu1 - gu0, vLen: gy1 - gy0, v0: gy0 },
      mullion: fw / 4 / (gu1 - gu0),
    });
  }
  return out;
}

/** Gulvet og veggflatene i rommet (ikke gjennom dører og åpninger). */
function roomSurfaces(model: ApartmentModel, info: RoomInfo): Surface[] {
  const floor = info.room.floorLevel;
  const out: Surface[] = [
    {
      origin: v3(0, floor, 0),
      ax: v3(1, 0, 0),
      ay: v3(0, 0, 1),
      normal: v3(0, 1, 0),
      region: info.polygon.map((p) => ({ x: p.x, y: p.z })),
    },
  ];
  for (const e of roomEdges(model, info, true)) {
    const L = Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z);
    out.push({
      origin: v3(e.a.x, 0, e.a.z),
      ax: v3(e.dir.x, 0, e.dir.z),
      ay: v3(0, 1, 0),
      normal: v3(e.inward.x, 0, e.inward.z),
      region: [
        { x: 0, y: floor },
        { x: L, y: floor },
        { x: L, y: model.ceilingAt(info, e.b) },
        { x: 0, y: model.ceilingAt(info, e.a) },
      ],
    });
  }
  return out;
}

/** Projiserer `p` langs lyset ned på flaten; null hvis flaten ikke ligger foran. */
function project(p: V3, travel: V3, s: Surface): Pt | null {
  const den = dot3(travel, s.normal);
  if (den >= -1e-6) return null;
  const t = dot3(sub3(s.origin, p), s.normal) / den;
  if (t <= 0) return null;
  const x = sub3(addS(p, travel, t), s.origin);
  return { x: dot3(x, s.ax), y: dot3(x, s.ay) };
}

/** Vinduskoordinater (uv over glasset) for et punkt som er lyst opp. */
function windowUv(w: WindowLight, x: V3, travel: V3): [number, number] {
  const g = w.glass;
  const den = dot3(travel, g.normal);
  const t = Math.abs(den) < 1e-9 ? 0 : dot3(sub3(x, g.origin), g.normal) / den;
  const p = addS(x, travel, -t);
  return [dot3(sub3(p, g.origin), g.u) / g.uLen, (p.y - g.v0) / g.vLen];
}

export interface SunPatch {
  window: string;
  room: string;
  /** Trekanter i mm. */
  points: V3[];
  /** Per punkt: vinduskoordinater og halv midtpostbredde. */
  uv: [number, number, number][];
  /** Gulv eller vegg. */
  surface: 'floor' | 'wall';
}

/** Solflekkene for alle vinduene (mm). */
export function sunPatches(model: ApartmentModel, towardSun: readonly [number, number, number]): SunPatch[] {
  const travel = sunTravel(towardSun);
  const out: SunPatch[] = [];
  for (const w of sunWindows(model, travel)) {
    // Lyset når også rom uten vegg imellom (f.eks. badets andre del).
    const rooms = [...model.rooms.values()].filter((r) => r === w.room || polygonGap(r.polygon, w.room.polygon) < 5);
    for (const room of rooms) roomPatches(model, w, room, travel, out);
  }
  return out;
}

/** Solflekkene fra ett vindu på gulvet og veggene i ett rom. */
function roomPatches(model: ApartmentModel, w: WindowLight, room: RoomInfo, travel: V3, out: SunPatch[]): void {
  const surfaces = roomSurfaces(model, room);
  surfaces.forEach((s, si) => {
    let poly: Pt[] = s.region;
    for (const ap of w.apertures) {
      const q = ap.map((p) => project(p, travel, s));
      if (q.some((x) => !x)) {
        poly = [];
        break;
      }
      poly = clipConvex(poly, q as Pt[]);
      if (!poly.length) break;
    }
    if (poly.length < 3) return;
    const lift = SUN_PATCH.lift;
    const to3 = (p: Pt): V3 => addS(addS(addS(s.origin, s.ax, p.x), s.ay, p.y), s.normal, lift);
    const tris = THREE.ShapeUtils.triangulateShape(
      poly.map((p) => new THREE.Vector2(p.x, p.y)),
      [],
    );
    const points: V3[] = [];
    const uv: [number, number, number][] = [];
    for (const tri of tris) {
      for (const i of tri) {
        const p = to3(poly[i!]!);
        points.push(p);
        const [u, v] = windowUv(w, p, travel);
        uv.push([u, v, w.mullion]);
      }
    }
    if (points.length) out.push({ window: w.id, room: room.room.id, points, uv, surface: si === 0 ? 'floor' : 'wall' });
  });
}

/** Solflekkene som én geometri per lag (meter), med `sunUv` (u, v, midtpost). */
export function buildSunPatches(model: ApartmentModel, towardSun: readonly [number, number, number]): Map<string, THREE.BufferGeometry> {
  const byLayer = new Map<string, { pos: number[]; uv: number[] }>();
  for (const p of sunPatches(model, towardSun)) {
    const layer = model.rooms.get(p.room)?.room.layer ?? 'structure';
    let b = byLayer.get(layer);
    if (!b) byLayer.set(layer, (b = { pos: [], uv: [] }));
    p.points.forEach((q, i) => {
      b!.pos.push(q.x * MM, q.y * MM, q.z * MM);
      b!.uv.push(...p.uv[i]!);
    });
  }
  const out = new Map<string, THREE.BufferGeometry>();
  for (const [layer, b] of byLayer) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('sunUv', new THREE.Float32BufferAttribute(b.uv, 3));
    g.computeBoundingSphere();
    out.set(layer, g);
  }
  return out;
}

/**
 * Lysstråler («Høy»): fra glasset og et stykke inn langs lyset, som fades ut
 * (alfa i hjørnefargen). Strålen stopper før gulvet.
 */
export function buildSunShafts(model: ApartmentModel, towardSun: readonly [number, number, number]): Map<string, THREE.BufferGeometry> {
  const travel = sunTravel(towardSun);
  const byLayer = new Map<string, { pos: number[]; col: number[] }>();
  for (const w of sunWindows(model, travel)) {
    const layer = w.room.room.layer ?? 'structure';
    let b = byLayer.get(layer);
    if (!b) byLayer.set(layer, (b = { pos: [], col: [] }));
    const glass = w.apertures[0]!;
    const floor = w.room.room.floorLevel;
    const lowest = Math.min(...glass.map((p) => p.y));
    const toFloor = (lowest - floor) / -travel.y;
    const L = Math.min(SUN_PATCH.shaftLength, toFloor * 0.85);
    if (L < 100) continue;
    const a = SUN_PATCH.shaftAlpha;
    const vert = (p: V3, alpha: number): void => {
      b!.pos.push(p.x * MM, p.y * MM, p.z * MM);
      b!.col.push(1, 1, 1, alpha);
    };
    // Hver side av søylen: glasskanten og den samme kanten flyttet langs lyset.
    // Sterkest midt på flaten, borte ved hjørnene og ytterst, så ingen kanter synes.
    const quad = (a0: V3, a1: V3, b1: V3, b0: V3, al0: number, al1: number): void => {
      vert(a0, al0);
      vert(a1, al1);
      vert(b1, 0);
      vert(a0, al0);
      vert(b1, 0);
      vert(b0, 0);
    };
    for (let i = 0; i < 4; i++) {
      const p = glass[i]!;
      const q = glass[(i + 1) % 4]!;
      const m = v3((p.x + q.x) / 2, (p.y + q.y) / 2, (p.z + q.z) / 2);
      quad(p, m, addS(m, travel, L), addS(p, travel, L), 0, a);
      quad(m, q, addS(q, travel, L), addS(m, travel, L), a, 0);
    }
  }
  const out = new Map<string, THREE.BufferGeometry>();
  for (const [layer, b] of byLayer) {
    if (!b.pos.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 4));
    g.computeBoundingSphere();
    out.set(layer, g);
  }
  return out;
}
