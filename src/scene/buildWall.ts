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
    extrude(g, f, clean, holePolys, { start: sa <= EPS && capCovered(model, f, 0), end: sb >= f.length - EPS && capCovered(model, f, f.length) });
  }
  return g.build();
}

/**
 * Er endeflaten til veggen ved `u` dekket av en annen veggs sideflate i samme
 * plan (vanlig i hjørner der veggen er forlenget til ytterkanten av den andre)?
 * Da tegnes den ikke: to flater oppå hverandre ville flimret.
 */
function capCovered(model: ApartmentModel, f: WallFrame, u: number): boolean {
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
      const sameFloor = (g.wall.base ?? 0) <= (f.wall.base ?? 0) && g.wall.height === undefined;
      if (lo >= -1 && hi <= g.length + 1 && sameFloor) return true;
    }
  }
  return false;
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
 * `skip`: endeflatene (ved u = 0 og u = lengden) som er dekket av en annen vegg.
 */
function extrude(g: GeoBuilder, f: WallFrame, contourIn: UV[], holesIn: UV[][], skip = { start: false, end: false }): void {
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
      // Endeflate (loddrett kant i starten eller slutten av veggen) som er dekket.
      if (loop === contour && Math.abs(du) < 0.01) {
        if (skip.start && Math.abs(a.u) < EPS) continue;
        if (skip.end && Math.abs(a.u - f.length) < EPS) continue;
      }
      const nu = dv / l;
      const nv = -du / l;
      const n = new THREE.Vector3(f.dir.x * nu, nv, f.dir.z * nu);
      g.quad(W(a, f.nMin), W(b, f.nMin), W(b, f.nMax), W(a, f.nMax), n);
    }
  }
}
