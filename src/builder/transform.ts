/**
 * Flytting og dreiing av en hel byggertegning (uten speilvending).
 *
 * Ved eksport flyttes origo til det innvendige hjørnet ved inngangsdøra og
 * x legges langs inngangsveggen – det oppmålingen bruker for å legge modellen
 * oppå rommet. `planRotation` velges så 2D-planen fortsatt ser ut slik den ble
 * tegnet.
 */
import type { PlanRotation } from '../schema/types';
import { edgesOf, type P2 } from './geometry';
import type { BuilderDoc, BuilderExtras } from './types';

export interface PlanTransform {
  /** Punktet som blir origo. */
  origin: P2;
  /** Retningen som blir +x (enhetsvektor). */
  axis: P2;
  /** Gulvnivået som blir 0. */
  floor: number;
}

export const IDENTITY: PlanTransform = { origin: { x: 0, z: 0 }, axis: { x: 1, z: 0 }, floor: 0 };

/** Punkt inn i den nye rammen. */
export function applyPoint(t: PlanTransform, p: P2): P2 {
  const dx = p.x - t.origin.x;
  const dz = p.z - t.origin.z;
  return { x: dx * t.axis.x + dz * t.axis.z, z: -dx * t.axis.z + dz * t.axis.x };
}

/** Hvor mye (grader, med klokka sett ovenfra) rammen dreies: rotasjoner på møbler o.l. trekkes fra dette. */
export const turnDegrees = (t: PlanTransform): number => (Math.atan2(t.axis.z, t.axis.x) * 180) / Math.PI;

const norm360 = (deg: number): number => Math.round((((deg % 360) + 360) % 360) * 1000) / 1000;

/** Dreiingen av 2D-planen som gjør at modellen ser ut slik den ble tegnet. */
export function planRotationFor(t: PlanTransform): PlanRotation {
  const r = Math.round(-turnDegrees(t) / 90) * 90;
  return (((r % 360) + 360) % 360) as PlanRotation;
}

/**
 * Rammen fra inngangsdøra: origo i hjørnet av rommet nærmest døra på
 * inngangsveggen, x langs veggen bort fra hjørnet, gulvet i rommet = 0.
 * Uten inngangsdør: første hjørne i første rom.
 */
export function entranceFrame(doc: BuilderDoc): PlanTransform | null {
  const door = doc.openings.find((o) => o.type === 'door' && o.entrance);
  const room = doc.rooms.find((r) => r.id === door?.room) ?? doc.rooms[0];
  if (!room || room.polygon.length < 3) return null;
  const edges = edgesOf(room.polygon);
  const into = doc.rooms.find((r) => r.id === door?.into) ?? room;
  const e = door ? edges[door.edge] : edges[0];
  if (!e || e.length <= 0) return null;
  const nearStart = door ? door.offset <= e.length - (door.offset + door.width) : true;
  const origin = nearStart ? e.a : e.b;
  const axis = nearStart ? e.u : { x: -e.u.x, z: -e.u.z };
  return { origin: { x: origin.x, z: origin.z }, axis, floor: into.floor };
}

const tp = (t: PlanTransform, x: number, z: number): [number, number] => {
  const p = applyPoint(t, { x, z });
  return [Math.round(p.x), Math.round(p.z)];
};

export function transformExtras(e: BuilderExtras | undefined, t: PlanTransform): BuilderExtras | undefined {
  if (!e) return e;
  const turn = turnDegrees(t);
  const out: BuilderExtras = structuredClone(e);
  for (const a of out.fixtures ?? []) {
    if (a.anchor) {
      const p = applyPoint(t, a.anchor);
      a.anchor = { ...a.anchor, x: p.x, z: p.z };
    }
    const f = a.fixture;
    if (f.position) {
      const [x, z] = tp(t, f.position[0], f.position[2]);
      f.position = [x, f.position[1], z];
      if (f.rotation !== undefined) f.rotation = norm360(f.rotation - turn);
    }
  }
  for (const f of out.furniture ?? []) {
    const [x, z] = tp(t, f.position[0], f.position[2]);
    f.position = [x, f.position[1], z];
    f.rotation = norm360(f.rotation - turn);
  }
  for (const o of out.outdoor ?? []) {
    o.polygon = o.polygon.map(([x, z]) => tp(t, x, z));
    o.level = o.level - t.floor;
  }
  for (const z of out.zones ?? []) z.polygon = z.polygon.map(([x, zz]) => tp(t, x, zz));
  for (const list of [out.wiring ?? [], out.pipes ?? []])
    for (const r of list) r.points = r.points.map(([x, h, z]) => {
      const [a, b] = tp(t, x, z);
      return [a, h, b];
    });
  for (const s of out.scans ?? []) {
    const [x, z] = tp(t, s.position[0], s.position[2]);
    s.position = [x, s.position[1], z];
    s.rotation = norm360(s.rotation - turn);
  }
  for (const w of out.walls ?? []) {
    w.start = tp(t, w.start[0], w.start[1]);
    w.end = tp(t, w.end[0], w.end[1]);
  }
  for (const n of out.notes ?? []) {
    const [x, z] = tp(t, n.position[0], n.position[2]);
    n.position = [x, n.position[1], z];
  }
  return out;
}

/** Hele tegningen i den nye rammen. Åpningene sitter på kanter og følger med av seg selv. */
export function transformDoc(doc: BuilderDoc, t: PlanTransform): BuilderDoc {
  const out: BuilderDoc = {
    ...doc,
    rooms: doc.rooms.map((r) => ({
      ...r,
      floor: r.floor - t.floor,
      polygon: r.polygon.map((p) => {
        const q = applyPoint(t, p);
        return { ...p, x: Math.round(q.x), z: Math.round(q.z) };
      }),
    })),
    openings: doc.openings.map((o) => ({ ...o })),
  };
  const extras = transformExtras(doc.extras, t);
  if (extras) out.extras = extras;
  else delete out.extras;
  return out;
}
