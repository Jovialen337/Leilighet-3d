/**
 * Byggertegning → apartment.json.
 *
 * Sjekker tegningen (rom som overlapper, åpninger utenfor veggene, manglende
 * inngangsdør …) og gir norske beskjeder knyttet til rom eller åpning, så
 * byggeren kan vise hvor problemet er. Veggene lages av rommene (walls.ts).
 */
import type {
  ApartmentDoc,
  Ceiling,
  CeilingPoint,
  Door,
  Fixture,
  Num,
  Opening,
  PlanRotation,
  Room,
  Wall,
} from '../schema/types';
import { edgesOf, dist, polygonProblem, roomsOverlap, sub, type P2 } from './geometry';
import { deriveWalls, isOpenAt, wallAt, type DerivedWall, type WallResult } from './walls';
import { entranceFrame, planRotationFor, transformDoc, type PlanTransform } from './transform';
import { DEFAULT_LAYERS, doorLeafColor } from './defaults';
import { floorColorFor, type BOpening, type BRoom, type BuilderDoc } from './types';
import { dot } from '../geometry/math2d';
import { validateApartment, type ValidationResult } from '../schema/validate';

export interface BuildIssue {
  severity: 'error' | 'warning';
  message: string;
  target?: { kind: 'room' | 'opening'; id: string };
  /** En rettelse byggeren kan gjøre med ett trykk. */
  fix?: { id: 'entrance' | 'one-entrance'; label: string };
}

export interface CompileResult {
  /** Fila (null hvis tegningen har feil som hindrer en gyldig fil). */
  doc: ApartmentDoc | null;
  issues: BuildIssue[];
  walls: WallResult;
  /** Rammen som ble brukt ved eksport (origo ved inngangsdøra). */
  transform: PlanTransform | null;
  /** Dør-id → rommet man går inn i (etter standardvalg). */
  doorInto: Map<string, string>;
  /** Skjemasjekken av fila (bare når `doc` ble laget og sjekket med `checked`). */
  validation?: ValidationResult;
}

export interface CompileOptions {
  /** Flytt origo til inngangsdøra (for eksport). */
  normalize?: boolean;
  /** Dato i meta.updated (YYYY-MM-DD). */
  date?: string;
}

const MV = (v: number, measured: boolean | undefined): Num => (measured ? { value: Math.round(v), measured: true } : Math.round(v));

/** Tre hjørner som spenner ut størst trekant (taket trenger tre punkter som ikke ligger på linje). */
function spreadCorners(poly: readonly P2[]): number[] {
  let best = [0, 1, 2];
  let area = -1;
  const n = poly.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++) {
        const a = sub(poly[j]!, poly[i]!);
        const b = sub(poly[k]!, poly[i]!);
        const s = Math.abs(a.x * b.z - a.z * b.x);
        if (s > area) {
          area = s;
          best = [i, j, k];
        }
      }
  return best;
}

function ceilingOf(r: BRoom): Ceiling<Num> {
  const custom = r.ceilingCorners?.some((h) => h !== null && h !== undefined);
  const idx = custom ? r.polygon.map((_, i) => i) : spreadCorners(r.polygon);
  const points: CeilingPoint<Num>[] = idx.map((i) => {
    const p = r.polygon[i]!;
    const h = r.ceilingCorners?.[i] ?? r.ceiling;
    return { x: Math.round(p.x), z: Math.round(p.z), height: MV(h, r.ceilingMeasured) };
  });
  return { points, color: '#f7f6f2' };
}

/**
 * Kontrollmålene med målt-flagget skrevet ut, så de ikke arver rommets
 * `measured` (et plassholdermål må ikke bli «målt» fordi resten av rommet er det).
 */
function dimensionsOut(d: NonNullable<BRoom['dimensions']>): NonNullable<Room<Num>['dimensions']> {
  const out: NonNullable<Room<Num>['dimensions']> = {};
  for (const k of ['length', 'width', 'height'] as const) {
    const v = d[k];
    if (v === undefined) continue;
    out[k] = typeof v === 'number' ? { value: v, measured: false } : { ...v, measured: !!v.measured };
  }
  return out;
}

function roomOut(r: BRoom): Room<Num> {
  const all = r.polygon.every((p) => p.m) && r.floorMeasured && r.ceilingMeasured;
  return {
    id: r.id,
    name: r.name,
    measured: !!all,
    ...(r.note ? { note: r.note } : {}),
    polygon: r.polygon.map((p) => [MV(p.x, p.m && !all), MV(p.z, p.m && !all)] as [Num, Num]),
    floorLevel: MV(r.floor, r.floorMeasured && !all),
    floorColor: r.floorColor ?? floorColorFor(r.name),
    ceiling: ceilingOf(r),
    ...(r.dimensions ? { dimensions: dimensionsOut(r.dimensions) } : {}),
    ...(r.layer ? { layer: r.layer } : {}),
  };
}

function wallOut(w: DerivedWall, rooms: Map<string, BRoom>): Wall<Num> {
  const measured = w.sources.every((s) => {
    const r = rooms.get(s.room);
    const n = r?.polygon.length ?? 0;
    return !!r && !!r.polygon[s.edge]?.m && !!r.polygon[(s.edge + 1) % n]?.m;
  });
  return {
    id: w.id,
    name: w.name,
    measured,
    start: [w.start.x, w.start.z],
    end: [w.end.x, w.end.z],
    thickness: w.thickness,
    justify: w.justify,
    ...(w.base !== undefined ? { base: w.base } : {}),
    ...(w.height !== undefined ? { height: w.height } : {}),
    color: w.color,
    material: w.material,
    ...(w.note ? { note: w.note } : {}),
    ...(w.layer ? { layer: w.layer } : {}),
  };
}

/**
 * Nye vegger på samme sted som en vegg i den importerte modellen arver id,
 * navn, farge, materiale, notat, lag og fast høyde – så installasjoner,
 * tegninger og oppmåling som viser til veggen, fortsatt treffer.
 */
function inheritWallIds(walls: DerivedWall[], refs: readonly import('./types').WallRef[] | undefined): void {
  if (!refs?.length) return;
  type Match = { w: DerivedWall; ref: (typeof refs)[number]; overlap: number };
  const matches: Match[] = [];
  for (const w of walls) {
    const d = sub(w.end, w.start);
    const len = Math.hypot(d.x, d.z);
    if (len <= 0) continue;
    const u = { x: d.x / len, z: d.z / len };
    const n = { x: -u.z, z: u.x };
    const off = w.justify === 'center' ? 0 : (w.justify === 'left' ? 1 : -1) * (w.thickness / 2);
    // Senterlinjen til den nye veggen.
    const c0 = { x: w.start.x + n.x * -off, z: w.start.z + n.z * -off };
    for (const ref of refs) {
      const a = { x: ref.start[0], z: ref.start[1] };
      const b = { x: ref.end[0], z: ref.end[1] };
      const rd = sub(b, a);
      const rl = Math.hypot(rd.x, rd.z);
      if (rl <= 0 || Math.abs(dot(rd, u)) / rl < 0.999) continue;
      if (Math.abs(dot(sub(a, c0), n)) > Math.max(w.thickness, ref.thickness) / 2 + 20) continue;
      const s0 = dot(sub(a, c0), u);
      const s1 = dot(sub(b, c0), u);
      const overlap = Math.min(len, Math.max(s0, s1)) - Math.max(0, Math.min(s0, s1));
      if (overlap > 0.5 * Math.min(len, rl)) matches.push({ w, ref, overlap });
    }
  }
  matches.sort((p, q) => q.overlap - p.overlap);
  const usedRef = new Set<string>();
  const done = new Set<DerivedWall>();
  const taken = new Set(walls.map((w) => w.id));
  for (const m of matches) {
    if (usedRef.has(m.ref.id) || done.has(m.w)) continue;
    if (taken.has(m.ref.id) && !walls.some((w) => w.id === m.ref.id && w === m.w)) {
      // Id-en er gitt til en annen ny vegg: bytt så den nye veggen får sin egen.
      const other = walls.find((w) => w.id === m.ref.id && !done.has(w));
      if (!other) continue;
      other.id = m.w.id;
    }
    m.w.id = m.ref.id;
    if (m.ref.name) m.w.name = m.ref.name;
    m.w.color = m.ref.color;
    if (m.ref.material) m.w.material = m.ref.material;
    if (m.ref.note) m.w.note = m.ref.note;
    if (m.ref.layer) m.w.layer = m.ref.layer;
    if (m.ref.height !== undefined) m.w.height = m.ref.height;
    // En nedforing fra tegningen (ulik takhøyde) går foran.
    if (m.ref.base !== undefined && m.w.base === undefined) m.w.base = m.ref.base;
    usedRef.add(m.ref.id);
    done.add(m.w);
    taken.add(m.ref.id);
  }
}

/** Standard «går inn i» for en dør: rommet på den andre siden av veggen, ellers rommet den sitter på. */
export function defaultInto(o: BOpening, wall: DerivedWall | null): string {
  if (o.into) return o.into;
  // Yttervegg: døra går inn i rommet den sitter i (andre rom langs samme fasade teller ikke).
  if (!wall || wall.kind === 'exterior') return o.room;
  return wall.rooms.find((r) => r !== o.room) ?? o.room;
}

/** Feste installasjoner fra en importert modell til de nye veggene (eller fri plassering). */
function fixturesOut(doc: BuilderDoc, walls: readonly DerivedWall[]): Fixture[] {
  const out: Fixture[] = [];
  for (const a of doc.extras?.fixtures ?? []) {
    const f = structuredClone(a.fixture);
    if (f.mount && a.anchor) {
      const p = { x: a.anchor.x, z: a.anchor.z };
      const room = a.anchor.room;
      let best: { w: DerivedWall; along: number; d: number } | null = null;
      for (const w of walls) {
        if (room && !w.rooms.includes(room)) continue;
        const d = sub(w.end, w.start);
        const len = Math.hypot(d.x, d.z);
        if (len <= 0) continue;
        const u = { x: d.x / len, z: d.z / len };
        const along = dot(sub(p, w.start), u);
        if (along < -50 || along > len + 50) continue;
        const q = { x: w.start.x + u.x * along, z: w.start.z + u.z * along };
        const dd = dist(p, q);
        if (dd < 400 && (!best || dd < best.d)) best = { w, along: Math.max(0, Math.min(len, along)), d: dd };
      }
      if (best) {
        f.mount = { ...f.mount, wall: best.w.id, along: Math.round(best.along), ...(room ? { room } : {}) };
        delete f.mount.face;
        if (!room) f.mount.face = 'left';
      } else {
        // Veggen finnes ikke lenger: fri plassering der den var.
        const h = f.mount.height;
        delete f.mount;
        f.position = [Math.round(p.x), h, Math.round(p.z)];
      }
    }
    out.push(f);
  }
  return out;
}

export function compile(doc: BuilderDoc, opts: CompileOptions = {}): CompileResult {
  if (opts.normalize) {
    const t = entranceFrame(doc);
    if (t) {
      const r = compile(transformDoc(doc, t), { ...opts, normalize: false });
      if (r.doc) r.doc.settings = { ...r.doc.settings, planRotation: planRotationFor(t) as PlanRotation };
      return { ...r, transform: t };
    }
  }
  const issues: BuildIssue[] = [];
  const err = (message: string, target?: BuildIssue['target']): void => void issues.push({ severity: 'error', message, ...(target ? { target } : {}) });
  const warn = (message: string, target?: BuildIssue['target']): void => void issues.push({ severity: 'warning', message, ...(target ? { target } : {}) });

  if (!doc.rooms.length) err('Tegn minst ett rom.');
  const ids = new Set<string>();
  for (const r of doc.rooms) {
    const t = { kind: 'room' as const, id: r.id };
    if (ids.has(r.id)) err(`To rom har samme id «${r.id}».`, t);
    ids.add(r.id);
    if (!r.name.trim()) err('Et rom mangler navn.', t);
    const p = polygonProblem(r.polygon);
    if (p) err(`Rommet «${r.name}» ${p}`, t);
    if (!(r.ceiling > 0)) err(`Rommet «${r.name}» trenger en takhøyde over 0.`, t);
    else if (r.ceiling < 1800) warn(`Rommet «${r.name}» har lav takhøyde (${Math.round(r.ceiling)} mm).`, t);
  }
  for (let i = 0; i < doc.rooms.length; i++)
    for (let j = i + 1; j < doc.rooms.length; j++) {
      const a = doc.rooms[i]!;
      const b = doc.rooms[j]!;
      if (a.polygon.length >= 3 && b.polygon.length >= 3 && roomsOverlap(a.polygon, b.polygon))
        err(`Rommene «${a.name}» og «${b.name}» overlapper. Flytt et av dem.`, { kind: 'room', id: b.id });
    }

  const walls = deriveWalls(doc.rooms, doc.settings);
  inheritWallIds(walls.walls, doc.extras?.walls);
  for (const n of walls.notes) warn(n);
  const rooms = new Map(doc.rooms.map((r) => [r.id, r]));
  const openings: Opening<Num>[] = [];
  const doorInto = new Map<string, string>();
  const entrances = doc.openings.filter((o) => o.type === 'door' && o.entrance);
  const doors = doc.openings.filter((o) => o.type === 'door');
  if (!entrances.length && doc.rooms.length)
    issues.push({
      severity: 'warning',
      message: 'Ingen dør er merket som inngangsdør. Oppmålingen og VR starter ved inngangsdøra – merk den før du lagrer.',
      ...(doors.length ? { fix: { id: 'entrance' as const, label: 'Merk en inngangsdør' } } : {}),
    });
  if (entrances.length > 1)
    issues.push({
      severity: 'warning',
      message: 'Flere dører er merket som inngangsdør. Bare én kan være det.',
      fix: { id: 'one-entrance', label: 'Behold bare den første' },
    });
  // Justeringen ved oppmåling går langs veggen med inngangsdøra: den må være minst 1 m.
  const entranceDoor = entrances[0];
  const entranceEdge = entranceDoor ? edgesOf(rooms.get(entranceDoor.room)?.polygon ?? [])[entranceDoor.edge] : undefined;
  if (entranceDoor && entranceEdge && entranceEdge.length < 1000)
    warn(
      `Veggen med inngangsdøra er bare ${(entranceEdge.length / 1000).toFixed(2).replace('.', ',')} m innvendig. Oppmålingen trenger minst 1 m vegg å justere langs.`,
      { kind: 'opening', id: entranceDoor.id },
    );

  for (const o of doc.openings) {
    const t = { kind: 'opening' as const, id: o.id };
    const what = o.type === 'door' ? 'Døra' : o.type === 'window' ? 'Vinduet' : 'Åpningen';
    const label = o.name ? `${what} «${o.name}»` : what;
    const room = rooms.get(o.room);
    if (!room) {
      err(`${label} sitter i et rom som ikke finnes.`, t);
      continue;
    }
    const e = edgesOf(room.polygon)[o.edge];
    if (!e) {
      err(`${label} sitter på en kant som ikke finnes.`, t);
      continue;
    }
    if (!(o.width > 0) || !(o.height > 0)) {
      err(`${label} trenger bredde og høyde over 0.`, t);
      continue;
    }
    if (o.offset < -1 || o.offset + o.width > e.length + 1) {
      err(`${label} går utenfor veggen i «${room.name}» (veggen er ${Math.round(e.length)} mm).`, t);
      continue;
    }
    const hit = wallAt(walls.walls, room, o.edge, o.offset, o.offset + o.width);
    if (!hit) {
      if (isOpenAt(walls.open, room.id, o.edge, o.offset, o.offset + o.width))
        err(`${label} sitter der det ikke er noen vegg (åpen overgang mellom rom).`, t);
      else err(`${label} går over et veggskille. Flytt den eller gjør den smalere.`, t);
      continue;
    }
    const offset = Math.round(Math.min(hit.a0, hit.a1));
    const width = Math.round(Math.abs(hit.a1 - hit.a0));
    const base = {
      id: o.id,
      ...(o.name ? { name: o.name } : {}),
      measured: !!o.measured,
      ...(o.note ? { note: o.note } : {}),
      wall: hit.wall.id,
      offset,
      width,
      height: Math.round(o.height),
      ...(o.layer ? { layer: o.layer } : {}),
    };
    if (o.type === 'door') {
      const into = defaultInto(o, hit.wall);
      if (!rooms.has(into)) {
        err(`${label} går inn i et rom som ikke finnes.`, t);
        continue;
      }
      if (!hit.wall.rooms.includes(into) && into !== o.room) warn(`${label} går inn i «${rooms.get(into)!.name}», som ikke ligger ved veggen.`, t);
      doorInto.set(o.id, into);
      const door: Door<Num> = {
        ...base,
        type: 'door',
        into,
        hinge: o.hinge ?? 'left',
        swing: o.swing ?? 'in',
        ...(o.openAngle !== undefined ? { openAngle: o.openAngle } : {}),
        ...(o.entrance ? { entrance: true } : {}),
        leafColor: o.leafColor ?? doorLeafColor(!!o.entrance),
      };
      const ceil = rooms.get(into)!.ceiling;
      if (o.height > ceil) warn(`${label} er høyere (${Math.round(o.height)} mm) enn taket i «${rooms.get(into)!.name}».`, t);
      openings.push(door);
    } else if (o.type === 'window') {
      const sill = Math.round(o.sill ?? 900);
      if (sill + o.height > room.ceiling) warn(`${label} går over taket i «${room.name}».`, t);
      openings.push({ ...base, type: 'window', sillHeight: sill, room: room.id, ...(o.frameColor ? { frameColor: o.frameColor } : {}) });
    } else openings.push({ ...base, type: 'passage', room: room.id });
  }

  // Rom man ikke kommer inn i (ingen dør, åpning eller åpen overgang fra inngangen).
  const entranceRoom = entranceDoor ? (doorInto.get(entranceDoor.id) ?? entranceDoor.room) : null;
  if (entranceRoom && rooms.has(entranceRoom)) {
    const links = new Map<string, Set<string>>();
    const link = (a: string, b: string): void => {
      if (a === b) return;
      (links.get(a) ?? links.set(a, new Set()).get(a)!).add(b);
      (links.get(b) ?? links.set(b, new Set()).get(b)!).add(a);
    };
    for (const o of walls.open) link(o.a.room, o.b.room);
    for (const o of doc.openings) {
      if (o.type === 'window') continue;
      const room = rooms.get(o.room);
      if (!room) continue;
      const hit = wallAt(walls.walls, room, o.edge, o.offset, o.offset + o.width);
      if (!hit) continue;
      for (const r of hit.wall.rooms) link(o.room, r);
      const into = doorInto.get(o.id);
      if (into) link(o.room, into);
    }
    const seen = new Set([entranceRoom]);
    const queue = [entranceRoom];
    while (queue.length) for (const n of links.get(queue.shift()!) ?? []) if (!seen.has(n)) seen.add(n), queue.push(n);
    for (const r of doc.rooms)
      if (!seen.has(r.id)) warn(`Man kommer ikke inn i «${r.name}» fra inngangen: rommet mangler dør eller åpning.`, { kind: 'room', id: r.id });
  }

  // Åpninger som overlapper på samme vegg.
  for (let i = 0; i < openings.length; i++)
    for (let j = i + 1; j < openings.length; j++) {
      const a = openings[i]!;
      const b = openings[j]!;
      if (a.wall !== b.wall) continue;
      const a0 = a.offset as number;
      const b0 = b.offset as number;
      if (a0 < b0 + (b.width as number) && b0 < a0 + (a.width as number))
        err('To åpninger overlapper i samme vegg. Flytt den ene.', { kind: 'opening', id: b.id });
    }

  const errors = issues.some((i) => i.severity === 'error');
  if (errors) return { doc: null, issues, walls, transform: null, doorInto };

  const x = doc.extras ?? {};
  const out: ApartmentDoc = {
    schemaVersion: 1,
    meta: {
      name: doc.name.trim() || 'Leiligheten',
      description: x.meta?.description ?? 'Laget med «Lag ny modell».',
      origin: 'Innvendig hjørne ved inngangsdøra, på gangens gulv. x langs inngangsveggen bort fra hjørnet, y opp.',
      ...(opts.date ? { updated: opts.date } : x.meta?.updated ? { updated: x.meta.updated } : {}),
    },
    settings: {
      planCutHeight: x.settings?.planCutHeight ?? 1500,
      defaultWallHeight: x.settings?.defaultWallHeight ?? Math.round(Math.max(...doc.rooms.map((r) => r.ceiling))),
      backgroundColor: x.settings?.backgroundColor ?? '#dfe8ef',
      planRotation: 0,
    },
    layers: x.layers ?? structuredClone(DEFAULT_LAYERS),
    rooms: doc.rooms.map(roomOut),
    walls: walls.walls.map((w) => wallOut(w, rooms)),
    openings,
    fixtures: fixturesOut(doc, walls.walls),
    furniture: structuredClone(x.furniture ?? []),
    outdoor: structuredClone(x.outdoor ?? []),
    zones: structuredClone(x.zones ?? []),
    wiring: structuredClone(x.wiring ?? []),
    pipes: structuredClone(x.pipes ?? []),
    circuits: structuredClone(x.circuits ?? []),
    scans: structuredClone(x.scans ?? []),
    notes: structuredClone(x.notes ?? []),
  };
  return { doc: out, issues, walls, transform: null, doorInto };
}

/** Deler av fila som kommer fra den importerte modellen (ikke fra tegningen). */
const EXTRA_PATHS = /^(fixtures|furniture|outdoor|zones|wiring|pipes|circuits|scans|notes)\b/;

/**
 * Kompilerer og kjører den vanlige skjemasjekken på fila. Feil der (f.eks. en
 * kabel som viser til en installasjon som ikke finnes lenger) hindrer lagring
 * og vises i lista; advarsler om det som ble tatt med fra den gamle modellen
 * vises også (resten dekker tegningssjekken selv).
 */
export function compileChecked(doc: BuilderDoc, opts: CompileOptions = {}): CompileResult {
  const r = compile(doc, opts);
  if (!r.doc) return r;
  const out = r.doc;
  const v = validateApartment(out);
  const extra: BuildIssue[] = [];
  for (const w of v.warnings) {
    if (EXTRA_PATHS.test(w.path)) extra.push({ severity: 'warning', message: w.message });
    // Kontrollmål fra den importerte modellen som ikke stemmer med rommet lenger.
    const dim = /^rooms\[(\d+)\]\.dimensions/.exec(w.path);
    const room = dim ? out.rooms[Number(dim[1])] : undefined;
    if (room) extra.push({ severity: 'warning', message: w.message, target: { kind: 'room', id: room.id } });
  }
  // Svingretningen (kontrollfeltet i fila) regnes ut av hengsel og slag, så den alltid stemmer.
  if (v.model)
    for (const o of out.openings) {
      if (o.type !== 'door') continue;
      const d = v.model.data.openings.find((x) => x.id === o.id);
      const g = d?.type === 'door' ? v.model.doorGeometry(d) : null;
      if (g) o.swingDirection = g.swingDirection;
    }
  if (!v.ok)
    return {
      ...r,
      doc: null,
      validation: v,
      issues: [...r.issues, ...v.errors.map((e): BuildIssue => ({ severity: 'error', message: `Fila blir ugyldig: ${e.message}` })), ...extra],
    };
  return { ...r, validation: v, issues: [...r.issues, ...extra] };
}
