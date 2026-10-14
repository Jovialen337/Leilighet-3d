/**
 * apartment.json → byggertegning («Start fra nåværende modell»).
 *
 * Rommene, åpningene og ytterveggenes tykkelse hentes ut; alt annet
 * (installasjoner, møbler, ute, kabler, rør, notater …) tas med uendret.
 * Installasjoner på vegg huskes som et punkt på veggflaten, så de festes til
 * riktig vegg igjen selv om veggene lages på nytt.
 *
 * Planen dreies slik den vises i 2D (settings.planRotation), så tegningen
 * i byggeren ser ut som planen man kjenner.
 */
import { frameAt, type ApartmentModel, type WallFrame } from '../model/ApartmentModel';
import { isMeasured, measuredFlag } from '../schema/normalize';
import type { ApartmentDoc, Fixture } from '../schema/types';
import { validateApartment } from '../schema/validate';
import { cross, dot, edgesOf, sub, type P2 } from './geometry';
import { transformExtras, type PlanTransform } from './transform';
import { BUILDER_VERSION, DEFAULT_BUILDER_SETTINGS, type AnchoredFixture, type BEdge, type BOpening, type BRoom, type BuilderDoc, type BuilderExtras } from './types';

export type ImportResult = { ok: true; doc: BuilderDoc } | { ok: false; message: string };

/** Den vanligste verdien i en liste (eller `fallback`). */
function mode(values: number[], fallback: number): number {
  const count = new Map<number, number>();
  for (const v of values) count.set(v, (count.get(v) ?? 0) + 1);
  let best = fallback;
  let n = 0;
  for (const [v, c] of count) if (c > n) [best, n] = [v, c];
  return best;
}

/** Veggen som ligger langs en romkant, og om den er yttervegg. */
function wallAlong(model: ApartmentModel, a: P2, b: P2): { f: WallFrame; exterior: boolean } | null {
  const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  const d = sub(b, a);
  const len = Math.hypot(d.x, d.z);
  if (len <= 0) return null;
  const u = { x: d.x / len, z: d.z / len };
  for (const f of model.walls.values()) {
    if (Math.abs(cross(u, f.dir)) > 0.05) continue;
    const v = sub(mid, f.p0);
    const along = dot(v, f.dir);
    if (along < -5 || along > f.length + 5) continue;
    const n = dot(v, f.left);
    const side = Math.abs(n - f.nMax) < 15 ? 'right' : Math.abs(n - f.nMin) < 15 ? 'left' : null;
    if (!side) continue;
    // Rommet ligger på den ene siden; finnes det et rom rett bak veggen?
    const behind = model.roomBeside(f, Math.max(0, Math.min(f.length, along)), side);
    return { f, exterior: !behind };
  }
  return null;
}

export function importApartment(raw: ApartmentDoc): ImportResult {
  const r = validateApartment(raw);
  if (!r.ok || !r.model) return { ok: false, message: r.errors[0]?.message ?? 'Fila er ikke gyldig.' };
  const model = r.model;
  const data = model.data;
  const theta = (model.settings.planRotation * Math.PI) / 180;
  const view: PlanTransform = { origin: { x: 0, z: 0 }, axis: { x: Math.round(Math.cos(theta)), z: Math.round(Math.sin(theta)) }, floor: 0 };

  const exteriorT: number[] = [];
  const interiorT: number[] = [];
  // Ytterveggenes tykkelse/materiale per kant (justeres mot den vanligste tykkelsen til slutt).
  const edgeWalls = new Map<string, { t: number; material?: BEdge['material'] }>();
  const rooms: BRoom[] = [];
  for (const info of model.rooms.values()) {
    const rawRoom = (raw.rooms as unknown as Record<string, unknown>[]).find((x) => x.id === info.room.id) ?? {};
    const rm = measuredFlag(rawRoom);
    const rawPoly = (rawRoom.polygon as unknown[][] | undefined) ?? [];
    const floor = info.room.floorLevel;
    const heights = info.polygon.map((p) => Math.round(model.ceilingAt(info, p) - floor));
    const flat = Math.max(...heights) - Math.min(...heights) <= 3;
    const rawCeil = (rawRoom.ceiling as { points?: { height?: unknown }[]; measured?: boolean } | undefined) ?? {};
    const ceilM = measuredFlag(rawCeil, rm);
    info.polygon.forEach((a, i) => {
      const b = info.polygon[(i + 1) % info.polygon.length]!;
      const w = wallAlong(model, a, b);
      const t = w ? Math.round(w.f.nMax - w.f.nMin) : 0;
      if (w?.exterior) {
        exteriorT.push(t);
        edgeWalls.set(`${info.room.id}:${i}`, { t, ...(w.f.wall.material && w.f.wall.material !== 'brick' ? { material: w.f.wall.material } : {}) });
      } else if (w) interiorT.push(t);
    });
    const room: BRoom = {
      id: info.room.id,
      name: info.room.name,
      polygon: info.polygon.map((p, i) => {
        const v = rawPoly[i] ?? [];
        return { x: p.x, z: p.z, ...(isMeasured(v[0], rm) && isMeasured(v[1], rm) ? { m: true } : {}) };
      }),
      floor,
      ...(isMeasured(rawRoom.floorLevel, rm) ? { floorMeasured: true } : {}),
      ceiling: flat ? Math.round(heights.reduce((s, h) => s + h, 0) / heights.length) : Math.max(...heights),
      ...(flat ? {} : { ceilingCorners: heights }),
      ...((rawCeil.points ?? []).length && (rawCeil.points ?? []).every((p) => isMeasured(p.height, ceilM)) ? { ceilingMeasured: true } : {}),
      ...(info.room.floorColor ? { floorColor: info.room.floorColor } : {}),
    };
    rooms.push(room);
  }

  // Åpningene: på kanten av rommet de hører til (dør: rommet man går inn i).
  const openings: BOpening[] = [];
  for (const o of data.openings) {
    const span = model.openingSpan(o);
    if (!span) continue;
    const f = span.frame;
    const mid = (f.nMin + f.nMax) / 2;
    const p0 = frameAt(f, span.u0, mid);
    const p1 = frameAt(f, span.u1, mid);
    const pm = frameAt(f, (span.u0 + span.u1) / 2, mid);
    const prefer = o.type === 'door' ? [o.into] : [o.room];
    const candidates = [...prefer, ...rooms.map((x) => x.id)].filter((x): x is string => !!x);
    let placed: { room: BRoom; edge: number; s0: number; s1: number } | null = null;
    for (const id of candidates) {
      const room = rooms.find((x) => x.id === id);
      if (!room) continue;
      let best: { edge: number; s0: number; s1: number; d: number } | null = null;
      for (const e of edgesOf(room.polygon)) {
        if (e.length <= 0 || Math.abs(cross(e.u, f.dir)) > 0.05) continue;
        const v = sub(pm, e.a);
        const d = Math.abs(dot(v, e.out));
        const s = dot(v, e.u);
        if (d > (f.nMax - f.nMin) / 2 + 60 || s < -10 || s > e.length + 10) continue;
        const a = dot(sub(p0, e.a), e.u);
        const b = dot(sub(p1, e.a), e.u);
        if (!best || d < best.d) best = { edge: e.i, s0: Math.min(a, b), s1: Math.max(a, b), d };
      }
      if (best) {
        placed = { room, edge: best.edge, s0: best.s0, s1: best.s1 };
        break;
      }
    }
    if (!placed) continue;
    const bo: BOpening = {
      id: o.id,
      type: o.type,
      room: placed.room.id,
      edge: placed.edge,
      offset: Math.round(Math.max(0, placed.s0)),
      width: Math.round(placed.s1 - placed.s0),
      height: Math.round(o.height),
      ...(o.name ? { name: o.name } : {}),
      ...(model.measureState(o.id) === 'measured' ? { measured: true } : {}),
    };
    if (o.type === 'window') bo.sill = Math.round(o.sillHeight);
    if (o.type === 'door') {
      bo.into = o.into;
      bo.hinge = o.hinge;
      bo.swing = o.swing;
      if (o.entrance) bo.entrance = true;
    }
    openings.push(bo);
  }

  // Installasjoner på vegg: punktet på veggflaten mot rommet.
  const fixtures: AnchoredFixture[] = data.fixtures.map((fx) => {
    const rawFx = (raw.fixtures as unknown as Record<string, unknown>[]).find((x) => x.id === fx.id);
    const fixture = structuredClone(fx) as Fixture;
    if (rawFx && typeof rawFx.measured === 'boolean') fixture.measured = rawFx.measured;
    if (!fx.mount) return { fixture };
    const f = model.walls.get(fx.mount.wall);
    if (!f) return { fixture };
    const side = fx.mount.room ? (model.sideOfRoom(f, fx.mount.room, fx.mount.along) ?? 'left') : (fx.mount.face ?? 'left');
    const p = frameAt(f, fx.mount.along, side === 'left' ? f.nMax : f.nMin);
    const room = fx.mount.room ?? model.roomBeside(f, fx.mount.along, side)?.room.id;
    return { fixture, anchor: { x: p.x, z: p.z, ...(room ? { room } : {}) } };
  });

  const extras: BuilderExtras = {
    meta: { ...(data.meta.description ? { description: data.meta.description } : {}), ...(data.meta.updated ? { updated: data.meta.updated } : {}) },
    settings: {
      planCutHeight: model.settings.planCutHeight,
      defaultWallHeight: model.settings.defaultWallHeight,
      backgroundColor: model.settings.backgroundColor,
    },
    layers: structuredClone(data.layers),
    fixtures,
    furniture: structuredClone(data.furniture),
    outdoor: structuredClone(data.outdoor),
    zones: structuredClone(data.zones),
    wiring: structuredClone(data.wiring),
    pipes: structuredClone(data.pipes ?? []),
    circuits: structuredClone(data.circuits ?? []),
    scans: structuredClone(data.scans),
    notes: structuredClone(data.notes),
    // Senterlinjene til veggene, så nye vegger på samme sted beholder id, navn og farge.
    walls: [...model.walls.values()].map((f) => {
      const mid = (f.nMin + f.nMax) / 2;
      const a = frameAt(f, 0, mid);
      const b = frameAt(f, f.length, mid);
      return {
        id: f.wall.id,
        ...(f.wall.name ? { name: f.wall.name } : {}),
        color: f.wall.color,
        ...(f.wall.material ? { material: f.wall.material } : {}),
        ...(model.measureState(f.wall.id) === 'measured' ? { measured: true } : {}),
        start: [a.x, a.z] as [number, number],
        end: [b.x, b.z] as [number, number],
        thickness: f.nMax - f.nMin,
      };
    }),
  };

  // Ytterveggene: bare avvik fra den vanligste tykkelsen lagres per kant.
  const extMode = mode(exteriorT, DEFAULT_BUILDER_SETTINGS.exteriorThickness);
  for (const room of rooms) {
    const edges = room.polygon.map((_, i): BEdge | null => {
      const w = edgeWalls.get(`${room.id}:${i}`);
      if (!w) return null;
      const e: BEdge = { ...(w.t !== extMode ? { thickness: w.t } : {}), ...(w.material ? { material: w.material } : {}) };
      return Object.keys(e).length ? e : null;
    });
    if (edges.some((e) => e)) room.edges = edges;
  }

  // Til byggerens ramme (planen slik den vises i 2D).
  const turned = rooms.map((room) => ({
    ...room,
    polygon: room.polygon.map((p) => {
      const q = { x: p.x * view.axis.x + p.z * view.axis.z, z: -p.x * view.axis.z + p.z * view.axis.x };
      return { ...p, x: Math.round(q.x), z: Math.round(q.z) };
    }),
  }));
  const maxInterior = Math.max(0, ...interiorT);
  return {
    ok: true,
    doc: {
      version: BUILDER_VERSION,
      name: data.meta.name,
      settings: {
        ...DEFAULT_BUILDER_SETTINGS,
        exteriorThickness: extMode,
        interiorThickness: mode(interiorT, DEFAULT_BUILDER_SETTINGS.interiorThickness),
        maxWallGap: Math.max(DEFAULT_BUILDER_SETTINGS.maxWallGap, maxInterior + 50),
      },
      rooms: turned,
      openings,
      extras: transformExtras(extras, view)!,
    },
  };
}
