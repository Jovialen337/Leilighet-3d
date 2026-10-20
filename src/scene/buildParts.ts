/**
 * Bygger alle "deler" (geometri + farge + lag) fra modellen. Hver del er i
 * verdenskoordinater (meter). Delene slås sammen per lag og materiale i
 * merge.ts, og brukes også som usynlige treffflater for teleport/valg.
 */
import * as THREE from 'three';
import { COLOR } from '../ui/tokens';
import { ELECTRICAL_FIXTURES, WATER_FIXTURES, type MeasureState, type Opening } from '../schema/types';
import {
  fixtureSize,
  frameAt,
  type ApartmentModel,
  type WallFrame,
} from '../model/ApartmentModel';
import { add, centroid, p2, scale, type P2 } from '../geometry/math2d';
import { planeY } from '../geometry/plane';
import { buildWallGeometry } from './buildWall';
import { roomEdges, type EdgePiece } from './roomEdges';
import {
  GeoBuilder,
  UP,
  beam,
  boxGeo,
  cylinderGeo,
  dashedBeam,
  outlineBox,
  floorArc,
  placeMatrix,
  polygonSurface,
  roundedBoxGeo,
  slab,
  w3,
} from './geom';

export type PartKind =
  | 'floor'
  | 'ceiling'
  | 'wall'
  | 'door'
  | 'window'
  | 'threshold'
  | 'fixture'
  | 'furniture'
  | 'outdoor'
  | 'zone'
  | 'wire'
  | 'note'
  | 'trim'
  | 'pipe';

/** Materialgruppe. Én mesh per lag og gruppe. */
export type Bucket = 'solid' | 'wall' | 'ceiling' | 'glass' | 'overlay' | 'lines';

/** Rolle ved teleport: gulv man kan lande på, hindring, eller ingen. */
export type PickRole = 'floor' | 'blocker' | 'none';

export interface Part {
  id: string;
  kind: PartKind;
  layer: string;
  bucket: Bucket;
  pick: PickRole;
  geometry: THREE.BufferGeometry;
  color: THREE.Color;
  measure: MeasureState;
  /** For filtre: eksisterende/planlagt og elektrisk kurs. */
  status?: 'existing' | 'planned';
  circuit?: string;
}

/** Bredden på vinduskarmen (mm); sollyset (sunlight.ts) går gjennom glasset innenfor. */
export const WINDOW_FRAME = 60;

/** Fotlist og gerikter (mm). Bare presentasjon; plasseringen kommer fra fila. */
/** Geriktene er tykkere enn fotlistene, så de ligger foran der de møtes (ingen flater oppå hverandre). */
export const TRIM = { skirtingHeight: 70, skirtingDepth: 12, casingWidth: 60, casingDepth: 18 } as const;

export const COLORS = {
  floor: '#b5a48f',
  ceiling: '#f5f4f0',
  frame: '#f2f1ec',
  leaf: '#e9e6df',
  handle: '#8a8d91',
  swingArc: '#d9822b',
  glass: '#a8d4f0',
  sill: '#f7f7f5',
  /** Planlagt el uten kurs (stiplet) og eksisterende el uten kurs. */
  wirePlanned: COLOR.elPlanned,
  wireExisting: COLOR.elExisting,
  zone: '#f0a030',
  note: '#ffd84d',
  glbPlaceholder: '#c8c8c8',
} as const;

const FIXTURE_COLOR: Record<string, string> = {
  outlet: '#fbfbfb',
  switch: '#fbfbfb',
  radiator: '#f0f0f0',
  pipe: '#a0a0a0',
  vent: '#d9d9d9',
  hatch: '#5f5f5f',
  light: '#fff6d6',
  junction: '#e6e6e6',
  panel: '#d8d8d8',
  tap: '#c9ced3',
  drain: '#9aa0a6',
  valve: '#c0392b',
  waterheater: '#f2f2f2',
};

export const PIPE_COLOR: Record<string, string> = {
  cold: '#2f7de1',
  hot: '#e0452f',
  drain: '#6f747a',
  other: '#9a8f80',
};

const OUTDOOR_COLOR: Record<string, string> = {
  pathway: '#b9ae9f',
  garden: '#8fb574',
  terrace: '#a89f91',
  other: '#bbbbbb',
};

const col = (hex: string): THREE.Color => new THREE.Color(hex);

export function buildParts(model: ApartmentModel): Part[] {
  const parts: Part[] = [];
  const push = (p: Omit<Part, 'measure'> & { geometry: THREE.BufferGeometry }): void => {
    if (!p.geometry.getAttribute('position')?.count) return;
    parts.push({ ...p, measure: model.measureState(p.id) });
  };
  const d = model.data;

  /* Rom: gulv (med trinn) og skrått tak */
  for (const info of model.rooms.values()) {
    const { room } = info;
    const layer = room.layer ?? 'structure';
    const floor = new GeoBuilder();
    slab(floor, info.polygon, model.lowestFloor, room.floorLevel);
    push({ id: room.id, kind: 'floor', layer, bucket: 'solid', pick: 'floor', geometry: floor.build(), color: col(room.floorColor ?? COLORS.floor) });

    const ceil = new GeoBuilder();
    const n = new THREE.Vector3(info.plane.a, -1, info.plane.b).normalize();
    polygonSurface(ceil, info.polygon, (p) => planeY(info.plane, p.x, p.z), n);
    push({ id: room.id, kind: 'ceiling', layer, bucket: 'ceiling', pick: 'blocker', geometry: ceil.build(), color: col(room.ceiling.color ?? COLORS.ceiling) });

    // Fotlist langs veggene, avbrutt ved dører og åpninger (og bak geriktene ved dører).
    const skirt = new GeoBuilder();
    for (const piece of roomEdges(model, info, true)) {
      const e = behindCasings(model, piece);
      // Lengden langs kanten (negativ hvis biten er borte bak geriktene).
      const l = (e.b.x - e.a.x) * e.dir.x + (e.b.z - e.a.z) * e.dir.z;
      if (l < 1) continue;
      const c = add(scale(add(e.a, e.b), 0.5), scale(e.inward, TRIM.skirtingDepth / 2));
      const yaw = Math.atan2(-e.dir.z, e.dir.x);
      skirt.addGeometry(boxGeo(l, TRIM.skirtingHeight, TRIM.skirtingDepth), placeMatrix(c.x, room.floorLevel + TRIM.skirtingHeight / 2, c.z, yaw));
    }
    push({ id: room.id, kind: 'trim', layer, bucket: 'solid', pick: 'none', geometry: skirt.build(), color: col(COLORS.frame) });
  }

  /* Vegger */
  for (const f of model.walls.values()) {
    push({ id: f.wall.id, kind: 'wall', layer: f.wall.layer ?? 'structure', bucket: 'wall', pick: 'blocker', geometry: buildWallGeometry(model, f), color: col(f.wall.color) });
  }

  /* Åpninger */
  for (const o of d.openings) buildOpening(model, o, push);

  /* Installasjoner */
  for (const fx of d.fixtures) {
    const pl = model.fixturePlacement(fx);
    if (!pl) continue;
    const [w, h, dd] = fixtureSize(fx);
    let geo: THREE.BufferGeometry;
    if (fx.type === 'pipe') {
      geo = cylinderGeo(w, h, dd, 12);
      if (fx.orientation === 'horizontal') geo.rotateZ(Math.PI / 2);
    } else {
      geo = boxGeo(w, h, dd);
    }
    const g = new GeoBuilder();
    const isInstall = ELECTRICAL_FIXTURES.includes(fx.type) || WATER_FIXTURES.includes(fx.type);
    // Planlagt punkt: bare omrisset, i fargen til kursen (el) eller kaldtvann (vann). Fargen viser
    // hva det er, formen at det er planlagt – samme regel som stiplet kabel og rør.
    const planned = fx.status === 'planned' && isInstall;
    const m = placeMatrix(pl.x, pl.y, pl.z, pl.yaw);
    if (planned) {
      outlineBox(g, w, h, dd, m);
      geo.dispose();
    } else g.addGeometry(geo, m);
    const circuitColor = fx.circuit ? d.circuits?.find((k) => k.id === fx.circuit)?.color : undefined;
    const color =
      fx.color ??
      (planned ? (WATER_FIXTURES.includes(fx.type) ? COLOR.cold : (circuitColor ?? COLOR.elPlanned)) : FIXTURE_COLOR[fx.type]!);
    push({ id: fx.id, kind: 'fixture', layer: fx.layer, bucket: isInstall ? 'lines' : 'solid', pick: 'none', geometry: g.build(), color: col(color), status: fx.status, ...(fx.circuit ? { circuit: fx.circuit } : {}) });
  }

  /* Møbler */
  for (const fu of d.furniture) {
    const pl = model.furniturePlacement(fu);
    const list = fu.parts.length
      ? fu.parts
      : [{ shape: 'box' as const, size: [500, 500, 500] as [number, number, number], offset: [0, 250, 0] as [number, number, number], color: COLORS.glbPlaceholder }];
    for (const part of list) {
      const [w, h, dd] = part.size;
      const geo =
        part.shape === 'cylinder'
          ? cylinderGeo(w, h, dd)
          : part.shape === 'roundedBox'
            ? roundedBoxGeo(w, h, dd, 'radius' in part && part.radius !== undefined ? part.radius : 30)
            : boxGeo(w, h, dd);
      const g = new GeoBuilder();
      const [ox, oy, oz] = part.offset;
      g.addGeometry(geo, placeMatrix(pl.x, pl.y, pl.z, pl.yaw, { x: ox, y: oy, z: oz }));
      push({ id: fu.id, kind: 'furniture', layer: fu.layer, bucket: 'solid', pick: 'blocker', geometry: g.build(), color: col(part.color) });
    }
  }

  /* Uteområder */
  const lowestOutdoor = Math.min(...model.outdoor.map((a) => a.area.level), model.lowestFloor);
  for (const a of model.outdoor) {
    const g = new GeoBuilder();
    slab(g, a.polygon, lowestOutdoor, a.area.level);
    push({ id: a.area.id, kind: 'outdoor', layer: a.area.layer ?? 'outdoor', bucket: 'solid', pick: 'floor', geometry: g.build(), color: col(a.area.color ?? OUTDOOR_COLOR[a.area.kind]!) });
  }

  /* Soner (gjennomsiktig flate på gulvet) */
  for (const z of d.zones) {
    const poly = z.polygon.map(([x, zz]) => p2(x, zz));
    const level = model.floorOrDefault(centroid(poly)) + 8;
    const g = new GeoBuilder();
    polygonSurface(g, poly, () => level, UP);
    push({ id: z.id, kind: 'zone', layer: z.layer, bucket: 'overlay', pick: 'none', geometry: g.build(), color: col(z.color ?? COLORS.zone) });
  }

  /* Kabler */
  for (const wr of d.wiring) {
    const pts = wr.points.map(([x, h, z]) => w3(p2(x, z), model.floorOrDefault(p2(x, z)) + h));
    const g = new GeoBuilder();
    for (let i = 0; i + 1 < pts.length; i++) (wr.status === 'planned' ? dashedBeam : beam)(g, pts[i]!, pts[i + 1]!, 20);
    const circuitColor = wr.circuit ? d.circuits?.find((k) => k.id === wr.circuit)?.color : undefined;
    push({ id: wr.id, kind: 'wire', layer: wr.layer, bucket: 'lines', pick: 'none', geometry: g.build(), color: col(wr.color ?? circuitColor ?? (wr.status === 'planned' ? COLORS.wirePlanned : COLORS.wireExisting)), status: wr.status, ...(wr.circuit ? { circuit: wr.circuit } : {}) });
  }

  /* Rør (vann og avløp) */
  for (const pr of d.pipes ?? []) {
    const pts = pr.points.map(([x, h, z]) => w3(p2(x, z), model.floorOrDefault(p2(x, z)) + h));
    const g = new GeoBuilder();
    const dia = pr.diameter ?? (pr.kind === 'drain' ? 50 : 22);
    for (let i = 0; i + 1 < pts.length; i++) (pr.status === 'planned' ? dashedBeam : beam)(g, pts[i]!, pts[i + 1]!, dia);
    push({ id: pr.id, kind: 'pipe', layer: pr.layer, bucket: 'lines', pick: 'none', geometry: g.build(), color: col(pr.color ?? PIPE_COLOR[pr.kind]!), status: pr.status });
  }

  /* Notater: en liten svevende lapp (teksten vises i 2D-planen) */
  for (const note of d.notes) {
    const [x, h, z] = note.position;
    const floor = model.floorOrDefault(p2(x, z));
    const g = new GeoBuilder();
    g.addGeometry(boxGeo(160, 110, 16), placeMatrix(x, floor + h, z, Math.PI / 4));
    push({ id: note.id, kind: 'note', layer: note.layer, bucket: 'solid', pick: 'none', geometry: g.build(), color: col(note.color ?? COLORS.note) });
  }

  return parts;
}

type Push = (p: Omit<Part, 'measure'>) => void;

/** Boks i veggens koordinater: senter (u, v, n) og størrelse (du, dv, dn), alt i mm. */
function wallBox(g: GeoBuilder, f: WallFrame, u: number, v: number, n: number, du: number, dv: number, dn: number): void {
  const c = frameAt(f, u, n);
  const yaw = Math.atan2(-f.dir.z, f.dir.x);
  g.addGeometry(boxGeo(du, dv, dn), placeMatrix(c.x, v, c.z, yaw));
}

function buildOpening(model: ApartmentModel, o: Opening, push: Push): void {
  const span = model.openingSpan(o);
  if (!span) return;
  const f = span.frame;
  const layer = o.layer ?? 'openings';
  const thick = f.nMax - f.nMin;
  const midN = (f.nMin + f.nMax) / 2;
  const width = span.u1 - span.u0;
  const height = span.top - span.bottom;
  const midU = (span.u0 + span.u1) / 2;

  if (o.type !== 'window') {
    // Terskel: gulvflate gjennom veggtykkelsen i åpningens gulvnivå.
    const roomId = o.room ?? (o.type === 'door' ? o.into : undefined);
    const floorColor = (roomId && model.rooms.get(roomId)?.room.floorColor) || COLORS.floor;
    const t = model.thresholds().find((x) => x.opening === o);
    if (t) {
      const g = new GeoBuilder();
      polygonSurface(g, t.polygon, () => t.level + 2, UP);
      push({ id: o.id, kind: 'threshold', layer: 'structure', bucket: 'solid', pick: 'floor', geometry: g.build(), color: col(floorColor) });
    }
  }

  if (o.type === 'door') {
    const jamb = 30;
    const frame = new GeoBuilder();
    wallBox(frame, f, span.u0 + jamb / 2, span.bottom + height / 2, midN, jamb, height, thick + 20);
    wallBox(frame, f, span.u1 - jamb / 2, span.bottom + height / 2, midN, jamb, height, thick + 20);
    wallBox(frame, f, midU, span.top - jamb / 2, midN, width, jamb, thick + 20);
    push({ id: o.id, kind: 'door', layer, bucket: 'solid', pick: 'none', geometry: frame.build(), color: col(COLORS.frame) });
    push({ id: o.id, kind: 'trim', layer, bucket: 'solid', pick: 'none', geometry: casing(f, span, [f.nMin, f.nMax]), color: col(COLORS.frame) });

    const dg = model.doorGeometry(o);
    if (!dg) return;
    const leafW = width - 2 * jamb - 6;
    const leafH = height - jamb - 8;
    const hinge = add(dg.hinge, scale(dg.closedDir, jamb + 3));
    const theta = (dg.openAngle * Math.PI) / 180;
    const leafDir: P2 = {
      x: dg.closedDir.x * Math.cos(theta) + dg.swingNormal.x * Math.sin(theta),
      z: dg.closedDir.z * Math.cos(theta) + dg.swingNormal.z * Math.sin(theta),
    };
    const yaw = Math.atan2(-leafDir.z, leafDir.x);
    const leaf = new GeoBuilder();
    leaf.addGeometry(boxGeo(leafW, leafH, 40), placeMatrix(hinge.x, span.bottom + 4, hinge.z, yaw, { x: leafW / 2, y: leafH / 2, z: 0 }));
    push({ id: o.id, kind: 'door', layer, bucket: 'solid', pick: 'blocker', geometry: leaf.build(), color: col(o.leafColor ?? COLORS.leaf) });

    const handle = new GeoBuilder();
    for (const side of [-1, 1]) {
      handle.addGeometry(
        boxGeo(130, 22, 22),
        placeMatrix(hinge.x, span.bottom + 4, hinge.z, yaw, { x: leafW - 110, y: 1000, z: side * 45 }),
      );
    }
    push({ id: o.id, kind: 'door', layer, bucket: 'solid', pick: 'none', geometry: handle.build(), color: col(COLORS.handle) });

    // Slaglinje på gulvet: kvartsirkel fra lukket til åpen stilling.
    const arc = new GeoBuilder();
    floorArc(arc, hinge, dg.closedDir, dg.swingNormal, theta, leafW - 14, leafW, dg.swingFloor + 3);
    push({ id: o.id, kind: 'door', layer, bucket: 'solid', pick: 'none', geometry: arc.build(), color: col(COLORS.swingArc) });
    return;
  }

  if (o.type === 'window') {
    const fw = WINDOW_FRAME;
    const depth = Math.min(90, thick);
    const frame = new GeoBuilder();
    wallBox(frame, f, midU, span.bottom + fw / 2, midN, width, fw, depth);
    wallBox(frame, f, midU, span.top - fw / 2, midN, width, fw, depth);
    wallBox(frame, f, span.u0 + fw / 2, span.bottom + height / 2, midN, fw, height - 2 * fw, depth);
    wallBox(frame, f, span.u1 - fw / 2, span.bottom + height / 2, midN, fw, height - 2 * fw, depth);
    wallBox(frame, f, midU, span.bottom + height / 2, midN, fw / 2, height - 2 * fw, depth - 20);
    push({ id: o.id, kind: 'window', layer, bucket: 'solid', pick: 'none', geometry: frame.build(), color: col(o.frameColor ?? COLORS.frame) });
    const roomSide = o.room ? model.sideOfRoom(f, o.room, midU) : null;
    if (roomSide)
      push({ id: o.id, kind: 'trim', layer, bucket: 'solid', pick: 'none', geometry: casing(f, span, [roomSide === 'left' ? f.nMax : f.nMin]), color: col(o.frameColor ?? COLORS.frame) });

    const glass = new GeoBuilder();
    wallBox(glass, f, midU, span.bottom + height / 2, midN, width - 2 * fw, height - 2 * fw, 8);
    push({ id: o.id, kind: 'window', layer, bucket: 'glass', pick: 'none', geometry: glass.build(), color: col(COLORS.glass) });

    const side = o.room ? model.sideOfRoom(f, o.room, midU) : null;
    if (side) {
      const sgn = side === 'left' ? 1 : -1;
      const face = side === 'left' ? f.nMax : f.nMin;
      const sill = new GeoBuilder();
      const inner = midN + (sgn * depth) / 2;
      const outer = face + sgn * 50;
      wallBox(sill, f, midU, span.bottom - 12, (inner + outer) / 2, width + 80, 24, Math.abs(outer - inner));
      push({ id: o.id, kind: 'window', layer, bucket: 'solid', pick: 'none', geometry: sill.build(), color: col(COLORS.sill) });
    }
  }
}

/** Gerikt rundt en åpning på de gitte veggflatene: to sider og topp (under vinduer er det vinduskarmen). */
function casing(f: WallFrame, span: { u0: number; u1: number; bottom: number; top: number }, faces: number[]): THREE.BufferGeometry {
  const g = new GeoBuilder();
  const w = TRIM.casingWidth;
  const t = TRIM.casingDepth;
  const h = span.top - span.bottom;
  for (const face of faces) {
    const out = face === f.nMax ? 1 : -1;
    const n = face + (out * t) / 2;
    wallBox(g, f, span.u0 - w / 2, span.bottom + (h + w) / 2, n, w, h + w, t);
    wallBox(g, f, span.u1 + w / 2, span.bottom + (h + w) / 2, n, w, h + w, t);
    wallBox(g, f, (span.u0 + span.u1) / 2, span.top + w / 2, n, span.u1 - span.u0, w, t);
  }
  return g.build();
}

/**
 * Fotlisten stopper bak geriktene ved dører (ikke kant i kant med åpningen),
 * så endene ikke ligger i samme plan som geriktens innerside.
 */
function behindCasings(model: ApartmentModel, e: EdgePiece): EdgePiece {
  let a = e.a;
  let b = e.b;
  for (const o of model.data.openings) {
    if (o.type !== 'door') continue;
    const span = model.openingSpan(o);
    if (!span) continue;
    for (const n of [span.frame.nMin, span.frame.nMax]) {
      for (const u of [span.u0, span.u1]) {
        const p = frameAt(span.frame, u, n);
        // Litt inn bak gerikten, så endeflaten ikke ligger i samme plan som gerikten.
        const back = TRIM.casingWidth - 2;
        if (Math.hypot(p.x - e.a.x, p.z - e.a.z) < 5) a = add(e.a, scale(e.dir, back));
        if (Math.hypot(p.x - e.b.x, p.z - e.b.z) < 5) b = add(e.b, scale(e.dir, -back));
      }
    }
  }
  return { ...e, a, b };
}

/** Hjelper for tester: finn deler for et objekt. */
export function partsFor(parts: readonly Part[], id: string, kind?: PartKind): Part[] {
  return parts.filter((p) => p.id === id && (!kind || p.kind === kind));
}

