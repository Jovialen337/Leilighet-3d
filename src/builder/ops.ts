/**
 * Endringer i en byggertegning. Alle endrer `doc` direkte (sesjonen tar en
 * kopi og lager angre-steg rundt dem).
 *
 * Åpningene sitter på en kant med et mål fra kantens første hjørne. Når
 * hjørner legges til, fjernes eller flyttes, festes åpningene på nytt ut fra
 * hvor de faktisk sto, så de ikke hopper til en annen vegg.
 */
import { add, alongEdge, dist, dot, edgeCoords, edgesOf, isAxisAligned, orthogonalize, dominantAngle, polygonProblem, roomsOverlap, scale, sub, type P2 } from './geometry';
import { polygonArea } from '../geometry/math2d';
import { OPEN_GAP } from './walls';
import { floorColorFor, ROOM_NAMES, type BEdge, type BOpening, type BOpeningType, type BPoint, type BRoom, type BuilderDoc } from './types';

/** En id som ikke er brukt (prefiks + tall, eller navnet som id). */
export function uniqueId(doc: BuilderDoc, base: string): string {
  const used = new Set<string>([...doc.rooms.map((r) => r.id), ...doc.openings.map((o) => o.id)]);
  const clean =
    base
      .toLowerCase()
      .replace(/æ/g, 'ae')
      .replace(/ø/g, 'o')
      .replace(/å/g, 'a')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'rom';
  if (!used.has(clean)) return clean;
  for (let i = 2; ; i++) if (!used.has(`${clean}-${i}`)) return `${clean}-${i}`;
}

/** Et romnavn som ikke er brukt ennå («Rom», «Rom 2» …). */
export function nextRoomName(doc: BuilderDoc, wanted?: string): string {
  const base = wanted ?? ROOM_NAMES.find((n) => !doc.rooms.some((r) => r.name === n)) ?? 'Rom';
  if (!doc.rooms.some((r) => r.name === base)) return base;
  for (let i = 2; ; i++) if (!doc.rooms.some((r) => r.name === `${base} ${i}`)) return `${base} ${i}`;
}

/**
 * Fester åpninger i et rom på nytt etter at polygonet er endret: nærmeste
 * kant med samme retning (helst samme nummer), målt fra der midten sto.
 */
function reattach(room: BRoom, openings: BOpening[], centers: Map<BOpening, { c: P2; u: P2 }>): void {
  const edges = edgesOf(room.polygon);
  for (const o of openings) {
    const was = centers.get(o);
    if (!was) continue;
    let best: { i: number; s: number; d: number } | null = null;
    for (const e of edges) {
      if (e.length <= 0 || Math.abs(dot(e.u, was.u)) < 0.9) continue;
      const { s, d } = edgeCoords(e, was.c);
      const inside = s >= -1 && s <= e.length + 1;
      const score = Math.abs(d) + (inside ? 0 : 10_000) + (e.i === o.edge ? 0 : 1);
      if (!best || score < best.d) best = { i: e.i, s, d: score };
    }
    if (!best) continue;
    const e = edges[best.i]!;
    o.edge = best.i;
    o.offset = Math.round(Math.max(0, Math.min(e.length - o.width, best.s - o.width / 2)));
  }
}

/** Endrer et rompolygon og holder åpningene på plass. */
export function setPolygon(doc: BuilderDoc, roomId: string, polygon: BPoint[], edgesAfter?: (BEdge | null)[]): void {
  const room = doc.rooms.find((r) => r.id === roomId);
  if (!room) return;
  const mine = doc.openings.filter((o) => o.room === roomId);
  const centers = new Map<BOpening, { c: P2; u: P2 }>();
  const before = edgesOf(room.polygon);
  for (const o of mine) {
    const e = before[o.edge];
    if (e && e.length > 0) centers.set(o, { c: alongEdge(e, o.offset + o.width / 2), u: e.u });
  }
  room.polygon = polygon.map((p) => ({ ...p, x: Math.round(p.x), z: Math.round(p.z) }));
  if (edgesAfter) room.edges = edgesAfter;
  else if (room.edges && room.edges.length !== polygon.length) room.edges = undefined;
  if (room.ceilingCorners && room.ceilingCorners.length !== polygon.length) room.ceilingCorners = undefined;
  reattach(room, mine, centers);
}

/** Nytt hjørne midt på (eller `s` mm ut på) en kant. */
export function insertCorner(doc: BuilderDoc, roomId: string, edge: number, s?: number): number {
  const room = doc.rooms.find((r) => r.id === roomId);
  const e = room ? edgesOf(room.polygon)[edge] : undefined;
  if (!room || !e) return -1;
  const at = alongEdge(e, s ?? e.length / 2);
  const poly = [...room.polygon];
  poly.splice(edge + 1, 0, { x: Math.round(at.x), z: Math.round(at.z) });
  const edges = room.edges ? [...room.edges] : undefined;
  edges?.splice(edge + 1, 0, edges[edge] ? { ...edges[edge] } : null);
  const ceil = room.ceilingCorners ? [...room.ceilingCorners] : undefined;
  ceil?.splice(edge + 1, 0, null);
  setPolygon(doc, roomId, poly, edges);
  if (ceil) room.ceilingCorners = ceil;
  return edge + 1;
}

/** Fjerner et hjørne (rommet må ha minst 3 igjen). */
export function deleteCorner(doc: BuilderDoc, roomId: string, i: number): boolean {
  const room = doc.rooms.find((r) => r.id === roomId);
  if (!room || room.polygon.length <= 3) return false;
  const poly = room.polygon.filter((_, k) => k !== i);
  const edges = room.edges?.filter((_, k) => k !== i);
  const ceil = room.ceilingCorners?.filter((_, k) => k !== i);
  setPolygon(doc, roomId, poly, edges);
  if (ceil) room.ceilingCorners = ceil;
  return true;
}

/** Flytter et hjørne. */
export function moveCorner(doc: BuilderDoc, roomId: string, i: number, p: P2): void {
  const room = doc.rooms.find((r) => r.id === roomId);
  if (!room?.polygon[i]) return;
  const poly = room.polygon.map((q, k) => (k === i ? { x: p.x, z: p.z } : { ...q }));
  setPolygon(doc, roomId, poly, room.edges);
}

/** Kantene i andre rom som danner en vegg med denne kanten (vender mot den, luke under maks). */
export function linkedEdges(doc: BuilderDoc, roomId: string, edge: number): { room: string; edge: number }[] {
  const room = doc.rooms.find((r) => r.id === roomId);
  const e = room ? edgesOf(room.polygon)[edge] : undefined;
  if (!room || !e || e.length <= 0) return [];
  const out: { room: string; edge: number }[] = [];
  for (const other of doc.rooms) {
    if (other.id === roomId) continue;
    for (const f of edgesOf(other.polygon)) {
      if (f.length <= 0 || dot(e.out, f.out) > -0.999) continue;
      const g = (dot(sub(f.a, e.a), e.out) + dot(sub(f.b, e.a), e.out)) / 2;
      if (g < -OPEN_GAP || g > doc.settings.maxWallGap) continue;
      const sa = dot(sub(f.a, e.a), e.u);
      const sb = dot(sub(f.b, e.a), e.u);
      if (Math.min(e.length, Math.max(sa, sb)) - Math.max(0, Math.min(sa, sb)) < 10) continue;
      out.push({ room: other.id, edge: f.i });
    }
  }
  return out;
}

/**
 * Flytter en kant vinkelrett ut (+) eller inn (−). Med `linked` flyttes også
 * kanter i nabørom som danner en vegg med den, så veggtykkelsen beholdes.
 */
export function moveEdge(doc: BuilderDoc, roomId: string, edge: number, delta: number, linked = true): void {
  const room = doc.rooms.find((r) => r.id === roomId);
  const e = room ? edgesOf(room.polygon)[edge] : undefined;
  if (!room || !e || e.length <= 0 || !delta) return;
  const shift = scale(e.out, delta);
  const targets = [{ room: roomId, edge }, ...(linked ? linkedEdges(doc, roomId, edge) : [])];
  for (const t of targets) {
    const r = doc.rooms.find((x) => x.id === t.room)!;
    const n = r.polygon.length;
    const poly = r.polygon.map((p, k) => (k === t.edge || k === (t.edge + 1) % n ? { x: p.x + shift.x, z: p.z + shift.z } : { ...p }));
    setPolygon(doc, t.room, poly, r.edges);
  }
}

/**
 * Gir en kant ny lengde. Står neste kant vinkelrett, flyttes hele den kanten
 * (rette vinkler beholdes, og naborom følger med); ellers flyttes bare hjørnet.
 */
export function setEdgeLength(doc: BuilderDoc, roomId: string, edge: number, length: number): void {
  const room = doc.rooms.find((r) => r.id === roomId);
  if (!room || length <= 0) return;
  const edges = edgesOf(room.polygon);
  const e = edges[edge];
  if (!e || e.length <= 0) return;
  const delta = length - e.length;
  if (Math.abs(delta) < 0.5) return;
  const next = edges[(edge + 1) % edges.length]!;
  if (next.length > 0 && Math.abs(dot(next.u, e.u)) < 0.01) moveEdge(doc, roomId, next.i, delta * Math.sign(dot(next.out, e.u)), true);
  else moveCorner(doc, roomId, (edge + 1) % room.polygon.length, add(e.b, scale(e.u, delta)));
}

/** Flytter et helt rom (åpningene følger med). */
export function moveRoom(doc: BuilderDoc, roomId: string, dx: number, dz: number): void {
  const room = doc.rooms.find((r) => r.id === roomId);
  if (!room) return;
  room.polygon = room.polygon.map((p) => ({ ...p, x: Math.round(p.x + dx), z: Math.round(p.z + dz) }));
}

/**
 * Gir skilleveggen langs en kant ny tykkelse ved å flytte kanten i
 * naborommet(-ene). Gir antall naborom som ble flyttet.
 */
export function setPartitionThickness(doc: BuilderDoc, roomId: string, edge: number, thickness: number): number {
  const room = doc.rooms.find((r) => r.id === roomId);
  const e = room ? edgesOf(room.polygon)[edge] : undefined;
  if (!room || !e || !(thickness >= OPEN_GAP)) return 0;
  let n = 0;
  for (const l of linkedEdges(doc, roomId, edge)) {
    const other = doc.rooms.find((r) => r.id === l.room);
    const f = other ? edgesOf(other.polygon)[l.edge] : undefined;
    if (!f) continue;
    const gap = (dot(sub(f.a, e.a), e.out) + dot(sub(f.b, e.a), e.out)) / 2;
    const delta = Math.round(thickness - gap);
    if (!delta) continue;
    // Kanten i naborommet vender mot dette rommet: bort fra det er «inn» for naborommet.
    moveEdge(doc, l.room, l.edge, -delta, false);
    n++;
  }
  return n;
}

/**
 * Klipper et polygon mot halvplanet der `side · (p[axis] − at) ≥ 0`
 * (Sutherland–Hodgman). Hjørner fra originalen beholder målt-flagget; nye
 * hjørner der kanten kuttes, gjør ikke.
 */
function clipPolygon(poly: readonly BPoint[], axis: 'x' | 'z', at: number, side: 1 | -1): BPoint[] {
  const val = (p: BPoint): number => side * (p[axis] - at);
  const out: BPoint[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const va = val(a);
    const vb = val(b);
    if (va >= 0) out.push({ ...a });
    if ((va >= 0) !== (vb >= 0)) {
      const t = va / (va - vb);
      out.push({ x: Math.round(a.x + (b.x - a.x) * t), z: Math.round(a.z + (b.z - a.z) * t) });
    }
  }
  // Like punkter etter hverandre (kuttet gikk gjennom et hjørne) slås sammen.
  return out.filter((p, i) => dist(p, out[(i + 1) % out.length]!) >= 1);
}

export type SplitResult = { ok: true; a: BRoom; b: BRoom; dropped: number } | { ok: false; message: string };

/**
 * «Del rommet»: deler et rom i to med en skillevegg (standard tykkelse) langs
 * en loddrett (`axis` = 'x', ved x = `at`) eller vannrett linje. Rommet
 * beholder navn og id på den ene siden; den andre siden blir et nytt rom.
 * Vinduer og dører følger siden de står på; en åpning som krysser skillet,
 * fjernes (antallet gis tilbake).
 */
export function splitRoom(doc: BuilderDoc, roomId: string, axis: 'x' | 'z', at: number): SplitResult {
  const room = doc.rooms.find((r) => r.id === roomId);
  if (!room || room.polygon.length < 3) return { ok: false, message: 'Velg et rom først.' };
  if (room.ceilingCorners?.some((h) => h !== null && h !== undefined))
    return { ok: false, message: 'Rommet har skrått tak. Gjør taket flatt før du deler det (eller del det og sett takhøydene etterpå).' };
  const half = doc.settings.interiorThickness / 2;
  const pa = clipPolygon(room.polygon, axis, at - half, -1);
  const pb = clipPolygon(room.polygon, axis, at + half, 1);
  for (const p of [pa, pb]) {
    const problem = polygonProblem(p);
    if (problem || Math.abs(polygonArea(p)) < 250_000)
      return { ok: false, message: 'Skillet må gå tvers gjennom rommet, med minst 0,25 m² på hver side.' };
  }
  // Åpningene: midtpunkt og ende i den gamle tegningen, så de kan festes til siden de står på.
  const old = edgesOf(room.polygon);
  const mine = doc.openings.filter((o) => o.room === roomId);
  const spans = new Map(
    mine.flatMap((o) => {
      const e = old[o.edge];
      return e ? [[o, { a: alongEdge(e, o.offset), b: alongEdge(e, o.offset + o.width), u: e.u }] as const] : [];
    }),
  );
  // Valg per kant (yttervegg): beholdes på kanter som ligger langs en gammel kant.
  const edgeOpts = (poly: BPoint[]): (BEdge | null)[] | undefined => {
    if (!room.edges) return undefined;
    return edgesOf(poly).map((e) => {
      const mid = alongEdge(e, e.length / 2);
      const src = old.find((f) => Math.abs(dot(f.u, e.u)) > 0.999 && Math.abs(edgeCoords(f, mid).d) < 1);
      return src ? (room.edges?.[src.i] ?? null) : null;
    });
  };
  const name = nextRoomName(doc, room.name.replace(/\s+\d+$/, ''));
  const b: BRoom = {
    ...structuredClone(room),
    id: uniqueId(doc, name),
    name,
    polygon: pb,
  };
  delete b.note;
  delete b.dimensions;
  const eb = edgeOpts(pb);
  if (eb) b.edges = eb;
  else delete b.edges;
  room.polygon = pa;
  const ea = edgeOpts(pa);
  if (ea) room.edges = ea;
  else delete room.edges;
  // Kontrollmålene gjaldt hele rommet.
  delete room.dimensions;
  doc.rooms.splice(doc.rooms.indexOf(room) + 1, 0, b);
  let dropped = 0;
  for (const o of mine) {
    const sp = spans.get(o);
    let placed = false;
    for (const r of [room, b]) {
      for (const e of edgesOf(r.polygon)) {
        if (e.length <= 0 || Math.abs(dot(e.u, sp?.u ?? e.u)) < 0.999 || !sp) continue;
        const ca = edgeCoords(e, sp.a);
        const cb = edgeCoords(e, sp.b);
        if (Math.abs(ca.d) > 1 || Math.abs(cb.d) > 1) continue;
        const s0 = Math.min(ca.s, cb.s);
        const s1 = Math.max(ca.s, cb.s);
        if (s0 < -1 || s1 > e.length + 1) continue;
        o.room = r.id;
        o.edge = e.i;
        o.offset = Math.round(Math.max(0, s0));
        placed = true;
        break;
      }
      if (placed) break;
    }
    if (!placed) {
      doc.openings = doc.openings.filter((x) => x !== o);
      dropped++;
    }
  }
  return { ok: true, a: room, b, dropped };
}

/** Hjørnenes ytterpunkter. */
function boundsOf(poly: readonly P2[]): { x0: number; z0: number; x1: number; z1: number } {
  const xs = poly.map((p) => p.x);
  const zs = poly.map((p) => p.z);
  return { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) };
}

/**
 * Kopierer et rom med vinduer, dører og åpninger (ikke inngangsdøra), og
 * legger kopien inntil originalen med en skillevegg imellom: til høyre,
 * under, til venstre eller over – der det er ledig. Navnet får et nummer.
 */
export function copyRoom(doc: BuilderDoc, roomId: string): BRoom | null {
  const room = doc.rooms.find((r) => r.id === roomId);
  if (!room || room.polygon.length < 3) return null;
  const b = boundsOf(room.polygon);
  const gap = doc.settings.interiorThickness;
  const w = b.x1 - b.x0 + gap;
  const h = b.z1 - b.z0 + gap;
  const tries: P2[] = [
    { x: w, z: 0 },
    { x: 0, z: h },
    { x: -w, z: 0 },
    { x: 0, z: -h },
  ];
  const shifted = (d: P2): P2[] => room.polygon.map((p) => ({ x: p.x + d.x, z: p.z + d.z }));
  const free = tries.find((d) => !doc.rooms.some((r) => r.polygon.length >= 3 && roomsOverlap(r.polygon, shifted(d)))) ?? { x: w, z: h };
  const base = room.name.replace(/\s+\d+$/, '');
  const copy = addRoom(doc, shifted(free), base, room.floor);
  copy.ceiling = room.ceiling;
  if (room.ceilingCorners) copy.ceilingCorners = [...room.ceilingCorners];
  if (room.edges) copy.edges = room.edges.map((e) => (e ? { ...e } : null));
  if (room.floorColor) copy.floorColor = room.floorColor;
  // Målt-flaggene gjelder originalen, ikke kopien.
  copy.polygon = copy.polygon.map(({ x, z }) => ({ x, z }));
  for (const o of doc.openings.filter((x) => x.room === roomId)) {
    const c: BOpening = { ...structuredClone(o), id: uniqueId(doc, o.id), room: copy.id };
    delete c.entrance;
    delete c.measured;
    delete c.into;
    // Navn og notat hørte til originalen.
    delete c.name;
    delete c.note;
    doc.openings.push(c);
  }
  return copy;
}

/** Dreier et rom 90° (med klokka i planen) om midten; vinduer og dører følger med. */
export function rotateRoom90(doc: BuilderDoc, roomId: string): boolean {
  const room = doc.rooms.find((r) => r.id === roomId);
  if (!room || room.polygon.length < 3) return false;
  const b = boundsOf(room.polygon);
  // Om midten. Er bare den ene av bredde og dybde et oddetall, ligger midten på en halv
  // mm i den ene retningen: da brukes nabopunktet med partall sum, så alle fire stillinger
  // dreies om samme punkt og fire dreininger gir nøyaktig samme rom igjen.
  let cx = (b.x0 + b.x1) / 2;
  let cz = (b.z0 + b.z1) / 2;
  const even = (v: number): boolean => ((v % 2) + 2) % 2 === 0;
  if (cx % 1 !== 0 && cz % 1 === 0) cx = even(Math.floor(cx) + cz) ? Math.floor(cx) : Math.ceil(cx);
  else if (cz % 1 !== 0 && cx % 1 === 0) cz = even(cx + Math.floor(cz)) ? Math.floor(cz) : Math.ceil(cz);
  // Med klokka på skjermen (x mot høyre, z nedover): (x, z) → (−z, x) om midten.
  room.polygon = room.polygon.map((p) => ({ ...p, x: Math.round(cx - (p.z - cz)), z: Math.round(cz + (p.x - cx)) }));
  return true;
}

/** Nytt rektangulært rom. */
export function addRect(doc: BuilderDoc, a: P2, b: P2, name?: string, floor?: number): BRoom {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const z0 = Math.min(a.z, b.z);
  const z1 = Math.max(a.z, b.z);
  return addRoom(
    doc,
    [
      { x: x0, z: z0 },
      { x: x1, z: z0 },
      { x: x1, z: z1 },
      { x: x0, z: z1 },
    ],
    name,
    floor,
  );
}

/** Nytt rom fra et polygon. */
export function addRoom(doc: BuilderDoc, polygon: P2[], name?: string, floor?: number): BRoom {
  const n = nextRoomName(doc, name);
  const room: BRoom = {
    id: uniqueId(doc, n),
    name: n,
    polygon: polygon.map((p) => ({ ...(p as BPoint), x: Math.round(p.x), z: Math.round(p.z) })),
    floor: floor ?? doc.rooms[doc.rooms.length - 1]?.floor ?? 0,
    ceiling: doc.settings.defaultCeiling,
    floorColor: floorColorFor(n),
  };
  doc.rooms.push(room);
  return room;
}

/**
 * Nytt rom på den andre siden av en kant, med en skillevegg imellom:
 * like bredt som kanten og `depth` mm dypt.
 */
export function addRoomBeside(doc: BuilderDoc, roomId: string, edge: number, depth: number, name?: string): BRoom | null {
  const room = doc.rooms.find((r) => r.id === roomId);
  const e = room ? edgesOf(room.polygon)[edge] : undefined;
  if (!room || !e || e.length <= 0 || depth <= 0) return null;
  const gap = doc.settings.interiorThickness;
  const a = add(e.a, scale(e.out, gap));
  const b = add(e.b, scale(e.out, gap));
  const c = add(b, scale(e.out, depth));
  const d = add(a, scale(e.out, depth));
  // Samme omløpsretning som rommet (b → a → d → c), så kantene vender riktig vei.
  return addRoom(doc, [b, a, d, c], name, room.floor);
}

export function removeRoom(doc: BuilderDoc, roomId: string): void {
  doc.rooms = doc.rooms.filter((r) => r.id !== roomId);
  doc.openings = doc.openings.filter((o) => o.room !== roomId);
  for (const o of doc.openings) if (o.into === roomId) delete o.into;
}

/** Standardmål for nye åpninger (mm). */
export const OPENING_DEFAULTS: Record<BOpeningType, { width: number; height: number; sill?: number }> = {
  door: { width: 900, height: 2000 },
  window: { width: 1000, height: 1000, sill: 900 },
  passage: { width: 1000, height: 2000 },
};

/** Ny åpning med midten `s` mm ut på kanten (flyttes inn på kanten om nødvendig). */
export function addOpening(doc: BuilderDoc, type: BOpeningType, roomId: string, edge: number, s: number, opts: Partial<BOpening> = {}): BOpening | null {
  const room = doc.rooms.find((r) => r.id === roomId);
  const e = room ? edgesOf(room.polygon)[edge] : undefined;
  if (!room || !e) return null;
  const def = OPENING_DEFAULTS[type];
  const width = Math.min(opts.width ?? def.width, Math.max(300, e.length - 20));
  const prefix = type === 'door' ? 'dor' : type === 'window' ? 'vindu' : 'apning';
  const o: BOpening = {
    id: uniqueId(doc, `${prefix}-${room.id}`),
    type,
    room: roomId,
    edge,
    offset: Math.round(Math.max(0, Math.min(e.length - width, s - width / 2))),
    width,
    height: opts.height ?? def.height,
    ...(type === 'window' ? { sill: opts.sill ?? def.sill } : {}),
    ...(type === 'door' ? { hinge: 'left' as const, swing: 'in' as const } : {}),
  };
  // Første dør i en yttervegg blir inngangsdøra.
  if (type === 'door' && !doc.openings.some((x) => x.entrance) && !linkedEdges(doc, roomId, edge).length) o.entrance = true;
  doc.openings.push(o);
  return o;
}

/** Gjør en dør til inngangsdøra (og ingen andre). */
export function setEntrance(doc: BuilderDoc, openingId: string): void {
  for (const o of doc.openings) {
    if (o.id === openingId && o.type === 'door') o.entrance = true;
    else delete o.entrance;
  }
}

/** Fordeler vinduene på en kant med like store mellomrom. */
export function distributeEvenly(doc: BuilderDoc, roomId: string, edge: number, type: BOpeningType = 'window'): number {
  const room = doc.rooms.find((r) => r.id === roomId);
  const e = room ? edgesOf(room.polygon)[edge] : undefined;
  const list = doc.openings.filter((o) => o.room === roomId && o.edge === edge && o.type === type).sort((a, b) => a.offset - b.offset);
  if (!e || !list.length) return 0;
  const total = list.reduce((s, o) => s + o.width, 0);
  const gap = (e.length - total) / (list.length + 1);
  if (gap < 0) return 0;
  let at = gap;
  for (const o of list) {
    o.offset = Math.round(at);
    at += o.width + gap;
  }
  return list.length;
}

/** Forskjellen mellom to retninger modulo 90° (grader, 0–45). */
const axisDiff = (a: number, b: number): number => Math.abs((((a - b + 45) % 90) + 90) % 90 - 45);

/**
 * Tegningens felles akse (grader, 0–90): lengdevektet snitt av rommenes
 * hovedretning (modulo 90°). Er et rom allerede helt rett innen `tolDeg` fra
 * snittet, brukes aksen til det største av dem (rom langs rutenettet teller
 * mer) – rette rom skal ikke flyttes.
 * `skip`: rom som ikke teller med (f.eks. et nytt rom som skal rettes inn).
 */
export function commonAxis(doc: BuilderDoc, tolDeg = 4, skip?: string): number | null {
  const rooms = doc.rooms.filter((r) => r.id !== skip && r.polygon.length >= 3);
  if (!rooms.length) return null;
  let sx = 0;
  let sz = 0;
  const perim = (r: BRoom): number => edgesOf(r.polygon).reduce((s, e) => s + e.length, 0);
  for (const r of rooms) {
    const a = (dominantAngle(r.polygon) * Math.PI * 4) / 180;
    const w = perim(r);
    sx += Math.cos(a) * w;
    sz += Math.sin(a) * w;
  }
  const mean = ((Math.atan2(sz, sx) / 4) * 180) / Math.PI;
  let best: { a: number; w: number } | null = null;
  for (const r of rooms) {
    const a = dominantAngle(r.polygon);
    // Rom som følger rutenettet (tegnet rett), går foran et like stort rom som er dreid.
    const w = perim(r) * (axisDiff(a, 0) < 0.05 ? 1.5 : 1);
    if (axisDiff(a, mean) < Math.max(1, tolDeg) && isAxisAligned(r.polygon, a, 0.05) && (!best || w > best.w)) best = { a, w };
  }
  return best ? best.a : ((mean % 90) + 90) % 90;
}

/**
 * Retter opp rom (`roomIds`, eller alle): kanter innenfor `tolDeg` fra den
 * felles aksen (se `commonAxis`) blir nøyaktig rette, og kanter som nesten
 * ligger på linje med kanter i andre rom, legges på linje (innen `align` mm).
 * Rom som ikke rettes, står stille. Gir antall endringer.
 */
export function straighten(doc: BuilderDoc, roomIds?: string[], tolDeg = 4, align = 30): number {
  const targets = doc.rooms.filter((r) => !roomIds || roomIds.includes(r.id));
  if (!targets.length) return 0;
  const axis = commonAxis(doc, tolDeg) ?? 0;
  let changed = 0;
  for (const r of targets) {
    const next = orthogonalize(r.polygon, axis, tolDeg).map((p, i) => ({ ...r.polygon[i], x: p.x, z: p.z }));
    if (next.some((p, i) => dist(p, r.polygon[i]!) > 0.5)) {
      setPolygon(doc, r.id, next, r.edges);
      changed++;
    }
  }
  // Legg nesten like linjer på linje (i aksens ramme): kanter med samme retning ut.
  const th = (axis * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const loc = (p: P2): P2 => ({ x: p.x * c + p.z * s, z: -p.x * s + p.z * c });
  const wor = (p: P2): P2 => ({ x: p.x * c - p.z * s, z: p.x * s + p.z * c });
  type Line = { room: BRoom; edge: number; horiz: boolean; value: number; sign: number };
  const lines: Line[] = [];
  for (const r of doc.rooms)
    for (const e of edgesOf(r.polygon)) {
      if (e.length <= 0) continue;
      const a = loc(e.a);
      const b = loc(e.b);
      const o = loc(add(e.a, e.out));
      const oa = sub(o, a);
      if (Math.abs(a.z - b.z) < 0.5) lines.push({ room: r, edge: e.i, horiz: true, value: (a.z + b.z) / 2, sign: Math.sign(oa.z) });
      else if (Math.abs(a.x - b.x) < 0.5) lines.push({ room: r, edge: e.i, horiz: false, value: (a.x + b.x) / 2, sign: Math.sign(oa.x) });
    }
  const groups: Line[][] = [];
  for (const l of lines) {
    const g = groups.find((gr) => gr[0]!.horiz === l.horiz && gr[0]!.sign === l.sign && Math.abs(gr[0]!.value - l.value) <= align);
    if (g) g.push(l);
    else groups.push([l]);
  }
  const isTarget = (l: Line): boolean => !roomIds || roomIds.includes(l.room.id);
  for (const g of groups) {
    if (g.length < 2 || !g.some(isTarget)) continue;
    // Rom som ikke skal rettes, står stille: de andre legges på linje med dem.
    const fixed = g.filter((l) => !isTarget(l));
    const ref = fixed.length ? fixed : g;
    const v = Math.round(ref.reduce((sum, l) => sum + l.value, 0) / ref.length);
    for (const l of g) {
      if (!isTarget(l) || Math.abs(l.value - v) < 0.5) continue;
      const n = l.room.polygon.length;
      const poly = l.room.polygon.map((p, k) => {
        if (k !== l.edge && k !== (l.edge + 1) % n) return { ...p };
        const q = loc(p);
        return { ...p, ...wor(l.horiz ? { x: q.x, z: v } : { x: v, z: q.z }) };
      });
      setPolygon(doc, l.room.id, poly, l.room.edges);
      changed++;
    }
  }
  return changed;
}

export { scale, add, sub, dist, dot };
