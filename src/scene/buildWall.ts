/**
 * Vegg med hull for dører/vinduer/åpninger.
 *
 * Veggflaten tegnes i veggens eget (u, v)-plan: u langs veggen (mm fra start),
 * v = absolutt høyde (mm). Overkanten følger taket. Åpninger som går helt
 * ned til gulvet blir "hakk" i omrisset, åpninger midt i veggen blir hull, og
 * åpninger fra gulv til tak deler veggen i flere biter. Flaten ekstruderes så
 * gjennom veggtykkelsen.
 */
import * as THREE from 'three';
import { frameAt, interpolate, type ApartmentModel, type OpeningSpan, type WallFrame } from '../model/ApartmentModel';
import { GeoBuilder, MM, triangulate } from './geom';

interface UV {
  u: number;
  v: number;
}

const EPS = 1;
/**
 * En dekket veggende trekkes inn i veggen som dekker den: den dekkede delen
 * opp til 20 mm (høyst halve tykkelsen på den andre veggen), resten et halvt
 * millimeter. Ellers ligger kantene på sideflatene akkurat i den andre
 * veggens flate og flimrer gjennom den (en prikkete strek i veggen).
 */
const COVER_DEEP = 20;
const COVER_INSET = 0.5;

export function buildWallGeometry(model: ApartmentModel, f: WallFrame): THREE.BufferGeometry {
  const base = model.wallBase(f);
  const top = model.wallTop(f);
  const topAt = (u: number): number => interpolate(top, u);

  const spans = (model.openingsByWall.get(f.wall.id) ?? [])
    .map((o) => model.openingSpan(o))
    .filter((s): s is OpeningSpan => s !== null)
    .map((s) => ({ ...s, u0: Math.max(0, s.u0), u1: Math.min(f.length, s.u1) }))
    .filter((s) => s.u1 - s.u0 > EPS && s.top > s.bottom)
    .sort((a, b) => a.u0 - b.u0);

  const touchesBottom = (s: OpeningSpan): boolean => s.bottom <= base + EPS;
  const touchesTop = (s: OpeningSpan): boolean => s.top >= Math.min(topAt(s.u0), topAt(s.u1)) - EPS;

  // Del veggen der en åpning går fra gulv til tak.
  const segments: [number, number][] = [];
  let start = 0;
  for (const s of spans) {
    if (touchesBottom(s) && touchesTop(s)) {
      if (s.u0 - start > EPS) segments.push([start, s.u0]);
      start = Math.max(start, s.u1);
    }
  }
  if (f.length - start > EPS) segments.push([start, f.length]);

  const g = new GeoBuilder();
  for (const [sa, sb] of segments) {
    const inSeg = spans.filter((s) => s.u0 >= sa - EPS && s.u1 <= sb + EPS && !(touchesBottom(s) && touchesTop(s)));
    const bottomNotches = inSeg.filter(touchesBottom);
    const topNotches = inSeg.filter((s) => touchesTop(s) && !touchesBottom(s));
    const holes = inSeg.filter((s) => !touchesBottom(s) && !touchesTop(s));

    // Underkant (sa → sb) med hakk opp rundt dører, overkant (sb → sa) som
    // følger taket med hakk ned for åpninger som når taket.
    const bottom = profile(
      sa,
      sb,
      () => base,
      [],
      bottomNotches.map((s) => ({ u0: s.u0, u1: s.u1, v: s.top })),
    );
    const upper = profile(
      sa,
      sb,
      topAt,
      top.map((p) => p.u),
      topNotches.map((s) => ({ u0: s.u0, u1: s.u1, v: s.bottom })),
    );
    const contour = [...bottom, ...upper.reverse()];

    const clean = dedupe(contour);
    if (clean.length < 3) continue;
    const holePolys = holes.map((s) => [
      { u: s.u0, v: s.bottom },
      { u: s.u1, v: s.bottom },
      { u: s.u1, v: s.top },
      { u: s.u0, v: s.top },
    ]);
    const start = sa <= EPS ? endCover(model, f, 0) : null;
    const end = sb >= f.length - EPS ? endCover(model, f, f.length) : null;
    let inset = clean;
    let cutHoles = holePolys;
    // Kuttet ende (hjørnet eies av den andre veggen): konturen og hullene klippes der.
    for (const [c, at, sign] of [[start, 0, 1], [end, f.length, -1]] as const) {
      if (!c?.cut) continue;
      const line = at + sign * Math.min(c.depth, f.length / 2);
      inset = clipU(inset, line, sign);
      cutHoles = cutHoles.map((h) => clipU(h, line, sign)).filter((h) => h.length >= 3);
    }
    if (inset.length < 3) continue;
    if (start?.depth && !start.cut) inset = insetEnd(inset, 0, 1, start, f.length);
    if (end?.depth && !end.cut) inset = insetEnd(inset, f.length, -1, end, f.length);
    extrude(g, f, inset, cutHoles, { start: start?.cut ? null : (start?.height ?? null), end: end?.cut ? null : (end?.height ?? null) });
  }
  return g.build();
}

/**
 * Er endeflaten til veggen ved `u` dekket av en annen veggs sideflate i samme
 * plan (vanlig i hjørner der veggen er forlenget til ytterkanten av den andre)?
 * Svaret er hvor høyt (mm) den er dekket, eller null. Den dekkede delen
 * tegnes ikke: to flater oppå hverandre ville flimret.
 */
interface Cover {
  /** Hvor høyt enden er dekket (mm). */
  height: number;
  /** Tykkelsen på veggen som dekker enden, når den ligger innover (veggene overlapper); ellers 0. */
  depth: number;
  /** Veggen som dekker enden. */
  by: WallFrame;
  /** Hjørne der begge er forlenget: enden kuttes tilbake til innsiden av den andre (et butt hjørne). */
  cut?: boolean;
}

function capCover(model: ApartmentModel, f: WallFrame, u: number): Cover | null {
  let best: Cover | null = null;
  // Retningen inn i veggen fra denne enden.
  const inward = u <= EPS ? 1 : -1;
  const a = frameAt(f, u, f.nMin);
  const b = frameAt(f, u, f.nMax);
  for (const g of model.walls.values()) {
    if (g === f || Math.abs(g.left.x * f.dir.x + g.left.z * f.dir.z) < 0.999) continue;
    for (const n of [g.nMin, g.nMax]) {
      const o = frameAt(g, 0, n);
      const off = (p: { x: number; z: number }): number => (p.x - o.x) * g.left.x + (p.z - o.z) * g.left.z;
      if (Math.abs(off(a)) > 1 || Math.abs(off(b)) > 1) continue;
      const along = (p: { x: number; z: number }): number => (p.x - o.x) * g.dir.x + (p.z - o.z) * g.dir.z;
      const lo = Math.min(along(a), along(b));
      const hi = Math.max(along(a), along(b));
      if (lo < -1 || hi > g.length + 1) continue;
      // Den andre veggen må starte like lavt; den dekker opp til sin egen topp.
      if (model.wallBase(g) > model.wallBase(f) + 1) continue;
      const cover = Math.min(interpolate(model.wallTop(g), Math.max(0, lo)), interpolate(model.wallTop(g), Math.min(g.length, hi)));
      // Ligger den andre veggen på innsiden (veggene overlapper i hjørnet), kan enden trekkes inn i den;
      // står veggen bare mot den andre utenfra, er dybden 0.
      const out = (n === g.nMax ? 1 : -1) * (g.left.x * f.dir.x + g.left.z * f.dir.z);
      const depth = out * inward < 0 ? g.nMax - g.nMin : 0;
      if (!best || cover > best.height) best = { height: cover, depth, by: g };
    }
  }
  return best;
}

/**
 * Dekningen av enden, med hjørner der begge veggene er forlenget gjennom
 * hjørnet (hver ende ligger i den andres ytterside). Trekkes begge endene
 * inn, blir hjørnesøylen tom; trekkes bare én inn, mangler et stykke av
 * yttersiden eller to flater ligger oppå hverandre. Derfor eier én vegg
 * hjørnet – den høyeste (lik høyde: laveste id). Den tegner enden sin; den
 * andre kuttes tilbake til innsiden av den, som et butt hjørne.
 */
function endCover(model: ApartmentModel, f: WallFrame, u: number): Cover | null {
  const c = capCover(model, f, u);
  if (!c || c.depth <= 0) return c;
  const g = c.by;
  // Enden av den andre veggen som ligger i dette hjørnet.
  const here = frameAt(f, u, (f.nMin + f.nMax) / 2);
  const dist = (v: number): number => {
    const p = frameAt(g, v, (g.nMin + g.nMax) / 2);
    return Math.hypot(p.x - here.x, p.z - here.z);
  };
  const ug = dist(0) <= dist(g.length) ? 0 : g.length;
  const back = capCover(model, g, ug);
  if (!back || back.by !== f || back.depth <= 0) return c;
  const top = (w: WallFrame, at: number): number => interpolate(model.wallTop(w), at);
  const dh = top(f, u) - top(g, ug);
  const owner = Math.abs(dh) > 1 ? dh > 0 : f.wall.id < g.wall.id;
  return owner ? null : { ...c, cut: true };
}

/** Beholder delen av polygonet på innsiden av u = `line` (`sign` = 1: u ≥ line, −1: u ≤ line). */
function clipU(pts: UV[], line: number, sign: number): UV[] {
  const keep = (p: UV): boolean => sign * (p.u - line) >= 0;
  const out: UV[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    if (keep(a)) out.push(a);
    if (keep(a) !== keep(b)) {
      const t = (line - a.u) / (b.u - a.u);
      out.push({ u: line, v: a.v + t * (b.v - a.v) });
    }
  }
  return dedupe(out);
}

/**
 * Flytter enden av konturen (punktene ved u = `at`) inn i veggen som dekker
 * den (`sign` = retningen innover): opp til den dekkede høyden 20 mm (høyst
 * halve tykkelsen på den andre veggen og en tredel av veggen), over den bare
 * et halvt millimeter, med et trinn der kanten krysser den dekkede høyden.
 */
function insetEnd(pts: UV[], at: number, sign: number, cover: Cover, length: number): UV[] {
  const d = Math.min(COVER_DEEP, length / 3, cover.depth / 2);
  const above = COVER_INSET;
  const onEnd = (p: UV): boolean => Math.abs(p.u - at) <= EPS;
  const shift = (p: UV): UV => ({ u: at + sign * (p.v <= cover.height + EPS ? d : above), v: p.v });
  const out: UV[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    out.push(onEnd(a) ? shift(a) : a);
    if (onEnd(a) && onEnd(b) && (a.v - cover.height - EPS) * (b.v - cover.height - EPS) < 0) {
      const lo = { u: at + sign * d, v: cover.height };
      const hi = { u: at + sign * above, v: cover.height };
      out.push(...(a.v < b.v ? [lo, hi] : [hi, lo]));
    }
  }
  return out;
}

interface Notch {
  u0: number;
  u1: number;
  v: number;
}

/**
 * Kant fra sa til sb (stigende u): følger `defaultAt`, men hopper til `v`
 * innenfor hvert hakk. `breaks` er ekstra knekkpunkter (f.eks. i skrått tak).
 */
function profile(sa: number, sb: number, defaultAt: (u: number) => number, breaks: number[], notches: Notch[]): UV[] {
  const inside = (u: number): Notch | undefined => notches.find((n) => u > n.u0 + EPS && u < n.u1 - EPS);
  const startNotch = notches.find((n) => n.u0 <= sa + EPS && n.u1 > sa + EPS);
  const endNotch = notches.find((n) => n.u1 >= sb - EPS && n.u0 < sb - EPS);
  const out: UV[] = [{ u: sa, v: startNotch ? startNotch.v : defaultAt(sa) }];
  const events = [...new Set([...breaks, ...notches.flatMap((n) => [n.u0, n.u1])])]
    .filter((u) => u > sa + EPS && u < sb - EPS)
    .sort((x, y) => x - y);
  for (const u of events) {
    const entering = notches.find((n) => Math.abs(n.u0 - u) <= EPS);
    const leaving = notches.find((n) => Math.abs(n.u1 - u) <= EPS);
    if (leaving) out.push({ u, v: leaving.v }, { u, v: defaultAt(u) });
    if (entering) out.push({ u, v: defaultAt(u) }, { u, v: entering.v });
    if (!entering && !leaving && !inside(u)) out.push({ u, v: defaultAt(u) });
  }
  out.push({ u: sb, v: endNotch ? endNotch.v : defaultAt(sb) });
  return out;
}

function dedupe(pts: UV[]): UV[] {
  const out: UV[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.u - p.u) > 0.01 || Math.abs(last.v - p.v) > 0.01) out.push(p);
  }
  while (out.length > 1) {
    const a = out[0]!;
    const b = out[out.length - 1]!;
    if (Math.abs(a.u - b.u) <= 0.01 && Math.abs(a.v - b.v) <= 0.01) out.pop();
    else break;
  }
  return out;
}

const area = (pts: UV[]): number => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p.u * q.v - q.u * p.v;
  }
  return a / 2;
};

/**
 * Ekstruderer flaten (kontur mot klokka, hull med klokka) gjennom veggen.
 * `cover`: hvor høyt endeflatene (ved u = 0 og u = lengden) er dekket av en
 * annen vegg (null = ikke dekket); bare delen over tegnes.
 */
function extrude(
  g: GeoBuilder,
  f: WallFrame,
  contourIn: UV[],
  holesIn: UV[][],
  cover: { start: number | null; end: number | null } = { start: null, end: null },
): void {
  const contour = area(contourIn) < 0 ? [...contourIn].reverse() : contourIn;
  const holes = holesIn.map((h) => (area(h) > 0 ? [...h].reverse() : h));

  const W = (p: UV, n: number): THREE.Vector3 => {
    const q = frameAt(f, p.u, n);
    return new THREE.Vector3(q.x * MM, p.v * MM, q.z * MM);
  };
  const front = new THREE.Vector3(f.left.x, 0, f.left.z);
  const back = front.clone().negate();

  const all = [...contour, ...holes.flat()];
  const faces = triangulate(
    contour.map((p) => new THREE.Vector2(p.u, p.v)),
    holes.map((h) => h.map((p) => new THREE.Vector2(p.u, p.v))),
  );
  for (const [i, j, k] of faces) {
    const a = all[i!]!;
    const b = all[j!]!;
    const c = all[k!]!;
    g.tri(W(a, f.nMax), W(b, f.nMax), W(c, f.nMax), front);
    g.tri(W(a, f.nMin), W(b, f.nMin), W(c, f.nMin), back);
  }

  // Sideflater: normal i (u, v) for kant a→b i en kontur mot klokka er (dv, -du).
  for (const loop of [contour, ...holes]) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      const du = b.u - a.u;
      const dv = b.v - a.v;
      const l = Math.hypot(du, dv);
      if (l < 0.01) continue;
      // Endeflate (loddrett kant i starten eller slutten av veggen): bare delen over det som er dekket.
      let qa = a;
      let qb = b;
      if (loop === contour && Math.abs(du) < 0.01) {
        const c = Math.abs(a.u) < EPS ? cover.start : Math.abs(a.u - f.length) < EPS ? cover.end : null;
        if (c !== null) {
          if (Math.max(a.v, b.v) <= c + EPS) continue;
          qa = { u: a.u, v: Math.max(a.v, Math.min(c, Math.max(a.v, b.v))) };
          qb = { u: b.u, v: Math.max(b.v, Math.min(c, Math.max(a.v, b.v))) };
        }
      }
      const nu = dv / l;
      const nv = -du / l;
      const n = new THREE.Vector3(f.dir.x * nu, nv, f.dir.z * nu);
      g.quad(W(qa, f.nMin), W(qb, f.nMin), W(qb, f.nMax), W(qa, f.nMax), n);
    }
  }
}
