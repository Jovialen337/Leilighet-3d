/**
 * Oppmåling av en ny modell i gjennomsyn (Quest 3): regnestykkene, uten
 * three.js, så de kan testes.
 *
 * Vegger: første vegg berøres to steder (gir retningen). Hver neste vegg
 * berøres ett sted og antas å stå vinkelrett på den forrige (langs rommets
 * akser) – eller flere steder (grep + avtrekker) for en skrå vegg. Hjørnene er der veggene møtes,
 * og rommet lukkes mellom siste og første vegg.
 *
 * Dører, vinduer og åpninger: berør begge sidene av karmen (og overkant,
 * for vindu også underkant). Åpningen legges på den nærmeste kanten.
 *
 * Alle mål i mm, i byggerens ramme (x, z i planet, y opp).
 */
import { add, cross, dist, dot, edgeCoords, edgesOf, polygonProblem, scale, sub, type P2 } from './geometry';
import type { PlanTransform } from './transform';
import type { BOpeningType, BuilderDoc } from './types';

export interface P3 {
  x: number;
  y: number;
  z: number;
}

/** En uendelig linje i planet: et punkt og en retning (enhetsvektor). */
export interface Line {
  p: P2;
  u: P2;
}

/** Minste avstand (mm) mellom de to berøringene på første vegg (eller på en skrå vegg). */
export const MIN_WALL_SPAN = 300;
/** Veggene i et rom kan ikke møtes i spissere vinkel enn dette (grader). */
export const MIN_CORNER_ANGLE = 20;

const unit = (v: P2): P2 => {
  const l = Math.hypot(v.x, v.z);
  return l > 0 ? { x: v.x / l, z: v.z / l } : { x: 1, z: 0 };
};
const perp = (u: P2): P2 => ({ x: -u.z, z: u.x });

/** Linja som passer best gjennom punktene (minste kvadraters sum vinkelrett på linja). */
export function fitLine(pts: readonly P2[]): Line | null {
  if (pts.length < 2) return null;
  const c = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, z: pts.reduce((s, p) => s + p.z, 0) / pts.length };
  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  for (const p of pts) {
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    sxx += dx * dx;
    sxz += dx * dz;
    szz += dz * dz;
  }
  if (sxx + szz < 1e-9) return null;
  // Retningen med størst spredning (egenvektor til kovariansmatrisen).
  const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  let u = { x: Math.cos(angle), z: Math.sin(angle) };
  // Behold retningen fra første til siste punkt (så veggene går rundt rommet i rekkefølge).
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (dot(sub(last, first), u) < 0) u = { x: -u.x, z: -u.z };
  return { p: c, u };
}

/** Skjæringspunktet mellom to linjer (null hvis de er nesten parallelle). */
export function intersect(a: Line, b: Line, minAngleDeg = MIN_CORNER_ANGLE): P2 | null {
  const den = cross(a.u, b.u);
  if (Math.abs(den) < Math.sin((minAngleDeg * Math.PI) / 180)) return null;
  const t = cross(sub(b.p, a.p), b.u) / den;
  return add(a.p, scale(a.u, t));
}

/** Linjene for veggene som er berørt så langt (første vegg trenger to punkter). */
export function wallLines(walls: readonly (readonly P2[])[]): Line[] {
  const lines: Line[] = [];
  for (let i = 0; i < walls.length; i++) {
    const pts = walls[i]!;
    // Skrå vegg: berørt flere steder med god avstand – linja gjennom punktene.
    const fitted = pts.length >= 2 && spread(pts) >= MIN_WALL_SPAN ? fitLine(pts) : null;
    if (fitted) {
      lines.push(fitted);
      continue;
    }
    const prev = lines[i - 1];
    if (!prev || !pts.length) break; // første vegg uten to punkter: ingen linjer ennå
    // Én berøring (eller flere tett i tett): langs en av rommets akser (første vegg og
    // vinkelrett på den) – den som står mest på tvers av forrige vegg. Etter en skrå
    // vegg fortsetter rommet altså rett, ikke vinkelrett på den skrå veggen.
    const p = { x: pts.reduce((sum, q) => sum + q.x, 0) / pts.length, z: pts.reduce((sum, q) => sum + q.z, 0) / pts.length };
    const u0 = lines[0]!.u;
    const axes = [u0, perp(u0)];
    let u = Math.abs(dot(axes[0]!, prev.u)) < Math.abs(dot(axes[1]!, prev.u)) ? axes[0]! : axes[1]!;
    if (dot(sub(p, prev.p), u) < 0) u = { x: -u.x, z: -u.z };
    lines.push({ p, u });
  }
  return lines;
}

/** Største avstand mellom punktene (mm). */
export function spread(pts: readonly P2[]): number {
  let m = 0;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) m = Math.max(m, dist(pts[i]!, pts[j]!));
  return m;
}

/** Hjørnene mellom veggene så langt (hjørne k er mellom vegg k−1 og k). */
export function openCorners(lines: readonly Line[]): (P2 | null)[] {
  const out: (P2 | null)[] = [];
  for (let k = 1; k < lines.length; k++) out.push(intersect(lines[k - 1]!, lines[k]!));
  return out;
}

export type CloseResult = { ok: true; polygon: P2[] } | { ok: false; message: string };

/**
 * Lukker rommet: hjørnet mellom siste og første vegg blir hjørne 0, så
 * kant 0 går langs første vegg (der man begynte – ved inngangsdøra).
 */
export function closeRoom(walls: readonly (readonly P2[])[]): CloseResult {
  if (walls.length < 3) return { ok: false, message: 'Berør minst tre vegger før du lukker rommet.' };
  if ((walls[0]?.length ?? 0) < 2 || spread(walls[0]!) < MIN_WALL_SPAN)
    return { ok: false, message: 'Første vegg må berøres to steder, minst 30 cm fra hverandre.' };
  const lines = wallLines(walls);
  if (lines.length !== walls.length) return { ok: false, message: 'En vegg mangler berøring.' };
  const n = lines.length;
  const poly: P2[] = [];
  for (let k = 0; k < n; k++) {
    const c = intersect(lines[(k + n - 1) % n]!, lines[k]!);
    if (!c) {
      const msg =
        k === 0
          ? 'Siste og første vegg er parallelle, så rommet kan ikke lukkes. Berør veggen som mangler mellom dem (eller berør en skrå vegg to steder med grep + avtrekker).'
          : `Vegg ${k} og ${k + 1} er nesten parallelle. Angre (B) og berør veggen imellom, eller berør en skrå vegg to steder.`;
      return { ok: false, message: msg };
    }
    poly.push({ x: Math.round(c.x), z: Math.round(c.z) });
  }
  const problem = polygonProblem(poly);
  if (problem) return { ok: false, message: `Rommet ${problem} Angre (B) og prøv igjen.` };
  // Hver berøring skal ligge på sin egen kant (ellers ble en vegg berørt utenfor rommet).
  const edges = edgesOf(poly);
  for (let k = 0; k < n; k++) {
    const e = edges[k]!;
    for (const p of walls[k]!) {
      const { s } = edgeCoords(e, p);
      if (s < -150 || s > e.length + 150)
        return { ok: false, message: `Berøringen på vegg ${k + 1} havnet utenfor rommet. Angre (B) og berør veggen midt på.` };
    }
  }
  return { ok: true, polygon: poly };
}

/**
 * Median av punkter (hver akse for seg): måler det punktet kontrolleren
 * holdt seg ved like før avtrekkeren ble trykket, så rykket ikke teller.
 */
export function medianPoint(pts: readonly P3[]): P3 | null {
  if (!pts.length) return null;
  const med = (vals: number[]): number => {
    const s = [...vals].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  };
  return { x: med(pts.map((p) => p.x)), y: med(pts.map((p) => p.y)), z: med(pts.map((p) => p.z)) };
}

/* ---------------- dører, vinduer og åpninger ---------------- */

/** Berøringene som trengs for hver type åpning. */
export const OPENING_STEPS: Record<BOpeningType, readonly string[]> = {
  door: ['siden av dørkarmen med hengslene', 'den andre siden av dørkarmen', 'overkanten av døråpningen'],
  window: ['den ene siden av vinduet', 'den andre siden av vinduet', 'underkanten av vinduet (brystningen)', 'overkanten av vinduet'],
  passage: ['den ene siden av åpningen', 'den andre siden av åpningen', 'overkanten av åpningen'],
};

export interface OpeningPlacement {
  room: string;
  edge: number;
  offset: number;
  width: number;
  height: number;
  sill?: number;
  /** Avstand (mm) fra sidene til veggen – stor avstand gir en advarsel. */
  off: number;
}

export type OpeningResult = { ok: true; placement: OpeningPlacement; warning?: string } | { ok: false; message: string };

/**
 * Åpningen fra berøringene: sidene (to punkter) gir kant, plassering og
 * bredde; overkant (og underkant) gir høyden. Kanten er den nærmeste – helst
 * i rommet man står i.
 */
export function placeOpening(doc: BuilderDoc, type: BOpeningType, touches: readonly P3[], preferRoom: string | null): OpeningResult {
  const need = OPENING_STEPS[type].length;
  if (touches.length < need) return { ok: false, message: 'Berør alle punktene først.' };
  const a = { x: touches[0]!.x, z: touches[0]!.z };
  const b = { x: touches[1]!.x, z: touches[1]!.z };
  const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  if (dist(a, b) < 200) return { ok: false, message: 'Sidene er for nær hverandre (under 20 cm). Angre (B) og berør begge sidene av karmen.' };
  let best: { room: string; edge: number; d: number; score: number } | null = null;
  for (const r of doc.rooms) {
    for (const e of edgesOf(r.polygon)) {
      if (e.length <= 0) continue;
      const { s, d } = edgeCoords(e, mid);
      if (s < -100 || s > e.length + 100) continue;
      // Sidene skal ligge langs kanten (ikke på tvers).
      if (Math.abs(dot(unit(sub(b, a)), e.u)) < 0.8) continue;
      const score = Math.abs(d) + (r.id === preferRoom ? 0 : 150);
      if (!best || score < best.score) best = { room: r.id, edge: e.i, d: Math.abs(d), score };
    }
  }
  if (!best || best.d > 600)
    return { ok: false, message: 'Fant ingen vegg der. Mål rommet først, og berør karmen helt inntil veggen.' };
  const room = doc.rooms.find((r) => r.id === best!.room)!;
  const e = edgesOf(room.polygon)[best.edge]!;
  const s0 = edgeCoords(e, a).s;
  const s1 = edgeCoords(e, b).s;
  const lo = Math.max(0, Math.min(s0, s1));
  const hi = Math.min(e.length, Math.max(s0, s1));
  const width = Math.round(hi - lo);
  if (width < 200) return { ok: false, message: 'Åpningen ble for smal på veggen. Angre (B) og berør sidene på nytt.' };
  const floor = room.floor;
  let height: number;
  let sill: number | undefined;
  if (type === 'window') {
    const bottom = touches[2]!.y - floor;
    const top = touches[3]!.y - floor;
    sill = Math.round(Math.max(0, Math.min(bottom, top)));
    height = Math.round(Math.abs(top - bottom));
    if (height < 150) return { ok: false, message: 'Vinduet ble for lavt (under- og overkant for nær hverandre). Angre (B) og berør på nytt.' };
  } else {
    height = Math.round(touches[2]!.y - floor);
    if (height < 1000) return { ok: false, message: `Overkanten ble bare ${height} mm over gulvet. Berør toppen av åpningen.` };
  }
  const placement: OpeningPlacement = { room: room.id, edge: e.i, offset: Math.round(lo), width, height, ...(sill !== undefined ? { sill } : {}), off: Math.round(best.d) };
  const warning = best.d > 150 ? `Karmen var ${Math.round(best.d / 10)} cm fra veggen i tegningen – sjekk at rommet er målt riktig.` : undefined;
  return { ok: true, placement, ...(warning ? { warning } : {}) };
}

/* ---------------- justering mot en tegning som finnes ---------------- */

/** Spillerriggens plassering (three.js: rotation.y = yaw), meter. */
export interface RigPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/**
 * Riggen som gjør verden til byggerens ramme (meter), når `rig` gjør verden
 * til inngangsrammen `t` (origo i hjørnet, x langs veggen, gulvet = 0):
 * byggeren = origo + R·inngang, og gulvet i rammen ligger på `t.floor`.
 */
export function composeRig(rig: RigPose, t: PlanTransform): RigPose {
  // Rotasjonen om y som tar (1, 0, 0) til (ax, 0, az): cos φ = ax, −sin φ = az.
  const phi = Math.atan2(-t.axis.z, t.axis.x);
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  return {
    x: rig.x * c + rig.z * s + t.origin.x / 1000,
    y: rig.y + t.floor / 1000,
    z: -rig.x * s + rig.z * c + t.origin.z / 1000,
    yaw: rig.yaw + phi,
  };
}
