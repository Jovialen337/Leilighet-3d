/**
 * Gjør målinger om til en oppdatert apartment.json.
 *
 * Ren funksjon: (opprinnelig dokument, målinger) → nytt dokument. Den kjøres
 * på nytt fra originalen etter hver måling, så angre er bare å fjerne en
 * måling. Alt som er målt skrives som { value, measured: true }.
 *
 * 1. Rom: målte hjørner settes direkte; umålte hjørner følger med
 *    (beste stive tilpasning). Gulvnivå og tak fra målinger.
 * 2. Vegger tilpasses gjennom hjørnene som ligger på veggflatene. Er begge
 *    flatene målt, blir også tykkelsen målt.
 * 3. Åpninger og installasjoner beholder plassen sin langs veggen, og
 *    oppdateres fra egne målinger (karmer, overkant, brystning, senter).
 * 4. Møbler, notater, soner og kabler flytter med rommet de står i.
 */
import type {
  ApartmentDoc,
  CeilingPoint,
  MeasuredValue,
  Num,
  Vec2,
  Vec3,
} from '../schema/types';
import { numValue } from '../schema/normalize';
import { validateApartment } from '../schema/validate';
import { makeFrame, type ApartmentModel, type WallFrame } from '../model/ApartmentModel';
import { add, dot, leftOf, p2, scale, sub, type P2 } from '../geometry/math2d';
import { fitCeilingPlane, planeY } from '../geometry/plane';
import { AlongMap, IDENTITY, alignDir, applyRigid, fitLine, fitParallelDir, fitRigid, type Rigid2 } from './fit';
import type { Observation } from './types';

/** Vekt for umålte hjørner som bare følger med rommet. */
const ESTIMATE_WEIGHT = 0.2;
/** Toleranse (mm) for at et hjørne ligger på en veggflate. */
const FACE_TOLERANCE = 2;

const round = (v: number): number => Math.round(v);
const mv = (v: number): MeasuredValue => ({ value: round(v), measured: true });
const nv = (n: Num): number => numValue(n);

/** Ny verdi i samme form som den gamle (beholder et eventuelt målt-flagg og notat). */
function setNum(old: Num, value: number): Num {
  return typeof old === 'number' ? round(value) : { ...old, value: round(value) };
}

const toP2 = (v: Vec2<Num>): P2 => p2(nv(v[0]), nv(v[1]));

/** Siste måling av hver nøkkel vinner (en ny måling erstatter en gammel). */
function latest<T extends Observation>(list: readonly T[], key: (o: T) => string): T[] {
  const m = new Map<string, T>();
  for (const o of list) m.set(key(o), o);
  return [...m.values()];
}

interface WallResult {
  frame: WallFrame;
  /** Gammel avstand langs veggen → ny avstand fra ny start. */
  newU: (u: number) => number;
}

export function applyMeasurements(doc: ApartmentDoc, observations: readonly Observation[]): ApartmentDoc {
  const base = validateApartment(doc);
  if (!base.ok || !base.model) throw new Error('Grunnmodellen er ugyldig.');
  const m: ApartmentModel = base.model;
  const out = structuredClone(doc) as ApartmentDoc;
  if (!observations.length) return out;

  const of = <K extends Observation['kind']>(kind: K): Extract<Observation, { kind: K }>[] =>
    observations.filter((o): o is Extract<Observation, { kind: K }> => o.kind === kind);

  /* ---------- 1. Rom: hjørner, gulv, tak ---------- */
  const roomT = new Map<string, Rigid2>();
  const corners: { old: P2; neu: P2; w: number }[] = [];
  const corner = latest(of('room-corner'), (o) => `${o.roomId}#${o.index}`);
  const floors = latest(of('room-floor'), (o) => o.roomId);
  const ceilings = latest(of('ceiling'), (o) => `${o.roomId}#${o.slot}`);

  for (const room of out.rooms) {
    const old = m.rooms.get(room.id)!.polygon;
    const measured = new Map<number, P2>();
    for (const o of corner) if (o.roomId === room.id && o.index < old.length) measured.set(o.index, p2(o.x, o.z));
    const T = fitRigid([...measured].map(([i, q]) => ({ from: old[i]!, to: q })));
    roomT.set(room.id, T);
    if (measured.size) {
      room.polygon = old.map((p, i) => {
        const q = measured.get(i);
        if (q) {
          corners.push({ old: p, neu: q, w: 1 });
          return [mv(q.x), mv(q.z)] as Vec2<Num>;
        }
        const e = applyRigid(T, p);
        corners.push({ old: p, neu: e, w: ESTIMATE_WEIGHT });
        const raw = room.polygon[i]!;
        return [setNum(raw[0], e.x), setNum(raw[1], e.z)] as Vec2<Num>;
      });
    }
    const floor = floors.find((o) => o.roomId === room.id);
    if (floor) room.floorLevel = mv(floor.y);
  }

  for (const room of out.rooms) {
    const T = roomT.get(room.id) ?? IDENTITY;
    const floorNew = nv(room.floorLevel);
    const obs = ceilings.filter((o) => o.roomId === room.id).sort((a, b) => a.slot - b.slot);
    const measuredPts: CeilingPoint<Num>[] = obs.map((o) => ({ x: mv(o.x), z: mv(o.z), height: mv(o.y - floorNew) }));
    if (obs.length >= 3) {
      room.ceiling.points = measuredPts;
      continue;
    }
    const moved = room.ceiling.points.map((pt) => {
      const q = applyRigid(T, p2(nv(pt.x), nv(pt.z)));
      return { ...pt, x: setNum(pt.x, q.x), z: setNum(pt.z, q.z) };
    });
    if (obs.length) {
      // Behold takets helning, men løft/senk det så det passer målepunktene.
      const plane = fitCeilingPlane(moved.map((pt) => ({ x: nv(pt.x), z: nv(pt.z), y: nv(pt.height) })));
      const delta =
        obs.reduce((s, o) => s + (o.y - floorNew - planeY(plane, o.x, o.z)), 0) / obs.length;
      for (const pt of moved) pt.height = setNum(pt.height, nv(pt.height) + delta);
      moved.push(...measuredPts);
    }
    room.ceiling.points = moved;
  }

  const floorOf = (roomId: string | undefined): number => {
    const r = roomId ? out.rooms.find((x) => x.id === roomId) : undefined;
    return r ? nv(r.floorLevel) : 0;
  };

  /* ---------- 2. Vegger ---------- */
  const walls = new Map<string, WallResult>();
  for (const wall of out.walls) {
    const f = m.walls.get(wall.id)!;
    const t = f.nMax - f.nMin;
    const cons: { u: number; face: 'min' | 'max'; q: P2; old: P2; w: number }[] = [];
    for (const c of corners) {
      const rel = sub(c.old, f.p0);
      const u = dot(rel, f.dir);
      const n = dot(rel, f.left);
      if (u < -t - 5 || u > f.length + t + 5) continue;
      const face = Math.abs(n - f.nMin) <= FACE_TOLERANCE ? 'min' : Math.abs(n - f.nMax) <= FACE_TOLERANCE ? 'max' : null;
      if (face) cons.push({ u, face, q: c.neu, old: c.old, w: c.w });
    }
    if (!cons.length) {
      walls.set(wall.id, { frame: f, newU: (u) => u });
      continue;
    }

    const uMin = Math.min(...cons.map((c) => c.u));
    const uMax = Math.max(...cons.map((c) => c.u));
    const faceOld = (face: 'min' | 'max'): number => (face === 'min' ? f.nMin : f.nMax);
    let start: P2;
    let end: P2;
    let newU: (u: number) => number;
    let thicknessMeasured: number | null = null;
    const measuredLine = cons.filter((c) => c.w === 1).length >= 2;

    if (uMax - uMin >= 300) {
      // Retning: flatene er parallelle linjer, så hver flate sentreres for seg.
      // Har ingen flate to punkter, brukes punktene flyttet inn på referanselinja.
      const byFace = (['min', 'max'] as const).map((face) =>
        cons.filter((c) => c.face === face).map((c) => ({ p: c.q, w: c.w })),
      );
      const parallel = fitParallelDir(byFace);
      const fallback = parallel ? null : fitLine(cons.map((c) => ({ p: sub(c.q, scale(f.left, faceOld(c.face))), w: c.w })));
      const raw = parallel ?? fallback?.dir;
      const dir = raw ? alignDir(raw, f.dir) : f.dir;
      const left = leftOf(dir);
      // Tykkelse når begge flatene har målte punkter.
      const offsets = (face: 'min' | 'max', onlyMeasured: boolean): number[] =>
        cons.filter((c) => c.face === face && (!onlyMeasured || c.w === 1)).map((c) => dot(c.q, left));
      const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
      const minM = offsets('min', true);
      const maxM = offsets('max', true);
      let nMin = f.nMin;
      let nMax = f.nMax;
      if (minM.length && maxM.length) {
        const tm = Math.min(600, Math.max(30, Math.abs(mean(maxM) - mean(minM))));
        thicknessMeasured = tm;
        const justify = wall.justify ?? 'center';
        [nMin, nMax] = justify === 'left' ? [0, tm] : justify === 'right' ? [-tm, 0] : [-tm / 2, tm / 2];
      }
      const newFace = (face: 'min' | 'max'): number => (face === 'min' ? nMin : nMax);
      let sw = 0;
      let refN = 0;
      const centroid = { x: 0, z: 0 };
      for (const c of cons) {
        sw += c.w;
        refN += c.w * (dot(c.q, left) - newFace(c.face));
        centroid.x += c.w * c.q.x;
        centroid.z += c.w * c.q.z;
      }
      refN /= sw;
      centroid.x /= sw;
      centroid.z /= sw;
      const origin = add(centroid, scale(left, refN - dot(centroid, left)));
      const along = new AlongMap(cons.map((c) => [c.u, dot(sub(c.q, origin), dir)]));
      start = add(origin, scale(dir, along.map(0)));
      end = add(origin, scale(dir, along.map(f.length)));
      newU = (u) => along.map(u) - along.map(0);
    } else {
      // Bare ett sted langs veggen: flytt veggen uten å vri den.
      let sw = 0;
      const shift = { x: 0, z: 0 };
      for (const c of cons) {
        sw += c.w;
        shift.x += c.w * (c.q.x - c.old.x);
        shift.z += c.w * (c.q.z - c.old.z);
      }
      shift.x /= sw;
      shift.z /= sw;
      start = add(f.p0, shift);
      end = add(f.p1, shift);
      newU = (u) => u;
    }

    const put = (old: Num, v: number): Num => (measuredLine ? mv(v) : setNum(old, v));
    wall.start = [put(wall.start[0], start.x), put(wall.start[1], start.z)];
    wall.end = [put(wall.end[0], end.x), put(wall.end[1], end.z)];
    if (thicknessMeasured !== null) wall.thickness = mv(thicknessMeasured);
    const frame = makeFrame({
      ...m.walls.get(wall.id)!.wall,
      start: [round(start.x), round(start.z)],
      end: [round(end.x), round(end.z)],
      thickness: thicknessMeasured !== null ? round(thicknessMeasured) : f.wall.thickness,
    });
    walls.set(wall.id, { frame, newU });
  }

  const alongOn = (frame: WallFrame, q: P2): number => dot(sub(q, frame.p0), frame.dir);

  /* ---------- 3. Åpninger ---------- */
  const jambs = latest(of('jamb'), (o) => `${o.openingId}#${o.side}`);
  const tops = latest(of('opening-top'), (o) => o.openingId);
  const sills = latest(of('opening-sill'), (o) => o.openingId);
  for (const o of out.openings) {
    const W = walls.get(o.wall)!;
    let width = nv(o.width);
    let offset = W.newU(nv(o.offset) + width / 2) - width / 2;
    const js = jambs.filter((j) => j.openingId === o.id).map((j) => alongOn(W.frame, p2(j.x, j.z)));
    let offsetMeasured = false;
    if (js.length >= 2) {
      offset = Math.min(js[0]!, js[1]!);
      width = Math.abs(js[1]! - js[0]!);
      o.width = mv(width);
      offsetMeasured = true;
    } else if (js.length === 1) {
      const u = js[0]!;
      offset = Math.abs(u - offset) <= Math.abs(u - (offset + width)) ? u : u - width;
    }
    offset = Math.max(0, offset);
    o.offset = offsetMeasured ? mv(offset) : setNum(o.offset, offset);

    const floor = floorOf(o.room ?? (o.type === 'door' ? o.into : undefined));
    const top = tops.find((t) => t.openingId === o.id);
    if (o.type === 'window') {
      const sill = sills.find((s) => s.openingId === o.id);
      if (sill) o.sillHeight = mv(sill.y - floor);
      if (top) o.height = mv(top.y - floor - nv(o.sillHeight));
    } else if (top) {
      o.height = mv(top.y - floor);
    }
  }

  /* ---------- 4. Installasjoner ---------- */
  const fixtureObs = latest(of('fixture'), (o) => o.fixtureId);
  const roomAtOld = (p: P2): string | undefined => m.roomAt(p)?.room.id;
  const moveWithRoom = (p: P2): P2 => applyRigid(roomT.get(roomAtOld(p) ?? '') ?? IDENTITY, p);

  for (const fx of out.fixtures) {
    const ob = fixtureObs.find((o) => o.fixtureId === fx.id);
    if (fx.mount) {
      const W = walls.get(fx.mount.wall)!;
      const oldFrame = m.walls.get(fx.mount.wall)!;
      let side = fx.mount.face ?? null;
      if (fx.mount.room) side = m.sideOfRoom(oldFrame, fx.mount.room, nv(fx.mount.along)) ?? m.sideOfRoom(oldFrame, fx.mount.room) ?? side;
      const sideRoom = fx.mount.room ?? (side ? m.roomBeside(oldFrame, nv(fx.mount.along), side)?.room.id : undefined);
      if (ob) {
        fx.mount.along = mv(alongOn(W.frame, p2(ob.x, ob.z)));
        fx.mount.height = mv(ob.y - floorOf(sideRoom));
      } else {
        fx.mount.along = setNum(fx.mount.along, W.newU(nv(fx.mount.along)));
      }
    } else if (fx.position) {
      const [x, h, z] = fx.position;
      const oldP = p2(nv(x), nv(z));
      if (ob) {
        fx.position = [mv(ob.x), mv(ob.y - floorOf(roomAtOld(oldP))), mv(ob.z)];
      } else {
        const q = moveWithRoom(oldP);
        fx.position = [setNum(x, q.x), h, setNum(z, q.z)];
      }
    }
  }

  /* ---------- 5. Møbler, notater, soner, kabler ---------- */
  const moveVec3 = (v: Vec3<Num>): Vec3<Num> => {
    const q = moveWithRoom(p2(nv(v[0]), nv(v[2])));
    return [setNum(v[0], q.x), v[1], setNum(v[2], q.z)];
  };
  for (const fu of out.furniture) {
    const T = roomT.get(roomAtOld(p2(nv(fu.position[0]), nv(fu.position[2]))) ?? '') ?? IDENTITY;
    fu.position = moveVec3(fu.position);
    if (T.angle) {
      const deg = nv(fu.rotation) + (T.angle * 180) / Math.PI;
      fu.rotation = typeof fu.rotation === 'number' ? Math.round(deg * 10) / 10 : { ...fu.rotation, value: Math.round(deg * 10) / 10 };
    }
  }
  for (const n of out.notes) n.position = moveVec3(n.position);
  for (const w of out.wiring) w.points = w.points.map(moveVec3);
  for (const z of out.zones) {
    const pts = z.polygon.map(toP2);
    const c = pts.reduce((s, p) => add(s, p), p2(0, 0));
    const T = roomT.get(roomAtOld(scale(c, 1 / pts.length)) ?? '') ?? IDENTITY;
    z.polygon = z.polygon.map((v) => {
      const q = applyRigid(T, toP2(v));
      return [setNum(v[0], q.x), setNum(v[1], q.z)] as Vec2<Num>;
    });
  }

  return out;
}
