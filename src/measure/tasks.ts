/**
 * Guidet oppmåling: lager en ordnet huskeliste (på norsk) fra modellen.
 * Rom for rom: gulv, hjørner, tre takpunkter, åpninger og installasjoner.
 * Hver oppgave har et omtrentlig mål-punkt i modellen som vises som et
 * lysende merke, så man ser hvor man skal gå.
 *
 * Det som allerede er målt i fila (measured: true) og det som bare er
 * planlagt, blir ikke med på listen.
 */
import type { ApartmentModel } from '../model/ApartmentModel';
import { centroid, p2, polygonArea, type P2 } from '../geometry/math2d';
import { planeY } from '../geometry/plane';
import { isMeasured, measuredFlag } from '../schema/normalize';
import type { ApartmentDoc, Fixture, Opening } from '../schema/types';
import type { Observation } from './types';

export type Task =
  | { kind: 'room-floor'; roomId: string }
  | { kind: 'room-corner'; roomId: string; index: number }
  | { kind: 'ceiling'; roomId: string; slot: number }
  | { kind: 'jamb'; openingId: string; side: 0 | 1 }
  | { kind: 'opening-top'; openingId: string }
  | { kind: 'opening-sill'; openingId: string }
  | { kind: 'fixture'; fixtureId: string };

export type Method = 'touch' | 'point';

export interface TaskInfo {
  task: Task;
  key: string;
  /** Gruppe (rommet) oppgaven hører til. */
  group: string;
  title: string;
  instruction: string;
  /** Foretrukket måte: berøre med måletuppen eller peke med strålen. */
  method: Method;
  /** Omtrentlig sted i modellen (mm, y absolutt). */
  target: { x: number; y: number; z: number };
}

/** Antall takpunkter per rom. */
export const CEILING_POINTS = 3;
/** Minste areal (mm²) for trekanten mellom takpunktene i ett rom: 0,25 m². */
export const MIN_CEILING_AREA = 250_000;

/** Oppstartsstegene (justering) – håndteres av måle-modusen før listen. */
export const ALIGN_STEPS = [
  {
    title: 'Start: hjørnet ved døra',
    instruction:
      'Gå til inngangsdøra. Hold måletuppen nede i det innvendige hjørnet ved døra, helt ned mot gulvet, og trykk avtrekkeren.',
  },
  {
    title: 'Start: retning',
    instruction:
      'Berør inngangsveggen minst én meter fra hjørnet, forbi døra, og trykk avtrekkeren. Da legges modellen oppå rommet ditt.',
  },
] as const;

export function taskKey(t: Task | Observation): string {
  switch (t.kind) {
    case 'room-floor':
      return `gulv:${t.roomId}`;
    case 'room-corner':
      return `hjorne:${t.roomId}:${t.index}`;
    case 'ceiling':
      return `tak:${t.roomId}:${t.slot}`;
    case 'jamb':
      return `karm:${t.openingId}:${t.side}`;
    case 'opening-top':
      return `overkant:${t.openingId}`;
    case 'opening-sill':
      return `brystning:${t.openingId}`;
    case 'fixture':
      return `inst:${t.fixtureId}`;
  }
}

const FIXTURE_NOUN: Record<Fixture['type'], [string, string]> = {
  outlet: ['Stikkontakt', 'stikkontakten'],
  switch: ['Bryter', 'bryteren'],
  radiator: ['Radiator', 'radiatoren'],
  pipe: ['Rør', 'røret'],
  vent: ['Ventil', 'ventilen'],
  hatch: ['Luke', 'luka'],
  light: ['Lampepunkt', 'lampepunktet'],
  junction: ['Koblingsboks', 'koblingsboksen'],
  panel: ['Sikringsskap', 'sikringsskapet'],
  tap: ['Kran', 'kranen'],
  drain: ['Sluk', 'sluket'],
  valve: ['Stoppekran', 'stoppekranen'],
  waterheater: ['Varmtvannsbereder', 'varmtvannsberederen'],
};

const openingNoun = (o: Opening): [string, string] =>
  o.type === 'door' ? ['Dør', 'døra'] : o.type === 'window' ? ['Vindu', 'vinduet'] : ['Åpning', 'åpningen'];

/** Rommet en åpning måles fra. */
const openingRoom = (o: Opening): string | undefined => o.room ?? (o.type === 'door' ? o.into : undefined);

/** Tre hjørner som spenner ut størst mulig trekant, trukket litt inn mot midten. */
function ceilingSpots(poly: readonly P2[]): P2[] {
  let best: [number, number, number] = [0, 1, 2];
  let bestArea = -1;
  for (let i = 0; i < poly.length; i++)
    for (let j = i + 1; j < poly.length; j++)
      for (let k = j + 1; k < poly.length; k++) {
        const a = polygonArea([poly[i]!, poly[j]!, poly[k]!]);
        if (a > bestArea) {
          bestArea = a;
          best = [i, j, k];
        }
      }
  const c = centroid(poly);
  return best.map((i) => {
    const p = poly[i]!;
    const dx = c.x - p.x;
    const dz = c.z - p.z;
    const l = Math.hypot(dx, dz) || 1;
    const inset = Math.min(500, l * 0.35);
    return p2(p.x + (dx / l) * inset, p.z + (dz / l) * inset);
  });
}

const roundTarget = (p: { x: number; y: number; z: number }) => ({
  x: Math.round(p.x),
  y: Math.round(p.y),
  z: Math.round(p.z),
});

/**
 * Lager huskelisten. `model` gir plassering av mål-punktene (gjerne det
 * siste utkastet); `doc` er fila som sier hva som allerede er målt.
 */
export function buildTasks(model: ApartmentModel, doc?: ApartmentDoc): TaskInfo[] {
  const tasks: TaskInfo[] = [];
  const d = model.data;
  const usedOpenings = new Set<string>();
  const usedFixtures = new Set<string>();
  const known = measuredLookup(doc);
  const push = (t: TaskInfo): void => {
    if (!known(t.task)) tasks.push({ ...t, target: roundTarget(t.target) });
  };

  const fixtureRoom = (fx: Fixture): string | undefined => {
    if (fx.mount?.room) return fx.mount.room;
    const pl = model.fixturePlacement(fx);
    return pl ? model.roomAt(p2(pl.x, pl.z))?.room.id : undefined;
  };

  const addOpening = (o: Opening, group: string): void => {
    const span = model.openingSpan(o);
    if (!span) return;
    usedOpenings.add(o.id);
    const [Noun, noun] = openingNoun(o);
    const label = o.name ? `${Noun} «${o.name}»` : Noun;
    const f = span.frame;
    const mid = (f.nMin + f.nMax) / 2;
    const at = (u: number, y: number) => {
      const p = { x: f.p0.x + f.dir.x * u + f.left.x * mid, z: f.p0.z + f.dir.z * u + f.left.z * mid };
      return { x: p.x, y, z: p.z };
    };
    const midY = (span.bottom + span.top) / 2;
    const midU = (span.u0 + span.u1) / 2;
    const base = { group, method: 'touch' as const };
    push({
      ...base,
      task: { kind: 'jamb', openingId: o.id, side: 0 },
      key: taskKey({ kind: 'jamb', openingId: o.id, side: 0 }),
      title: `${label}: side 1 av 2`,
      instruction: `Berør den ene siden av ${noun}, på innsiden av karmen, og trykk avtrekkeren.`,
      target: at(span.u0, midY),
    });
    push({
      ...base,
      task: { kind: 'jamb', openingId: o.id, side: 1 },
      key: taskKey({ kind: 'jamb', openingId: o.id, side: 1 }),
      title: `${label}: side 2 av 2`,
      instruction: `Berør den andre siden av ${noun}, på innsiden av karmen, og trykk avtrekkeren.`,
      target: at(span.u1, midY),
    });
    push({
      ...base,
      task: { kind: 'opening-top', openingId: o.id },
      key: taskKey({ kind: 'opening-top', openingId: o.id }),
      title: `${label}: overkant`,
      instruction: `Berør overkanten av ${noun} (undersiden av karmen øverst) og trykk avtrekkeren.`,
      target: at(midU, span.top),
    });
    if (o.type === 'window') {
      push({
        ...base,
        task: { kind: 'opening-sill', openingId: o.id },
        key: taskKey({ kind: 'opening-sill', openingId: o.id }),
        title: `${label}: underkant`,
        instruction: `Berør underkanten av vindusåpningen, der vinduskarmen er, og trykk avtrekkeren.`,
        target: at(midU, span.bottom),
      });
    }
  };

  const addFixture = (fx: Fixture, group: string): void => {
    if (fx.status === 'planned') return;
    const pl = model.fixturePlacement(fx);
    if (!pl) return;
    usedFixtures.add(fx.id);
    const [Noun, noun] = FIXTURE_NOUN[fx.type];
    const label = fx.name ? `${Noun} «${fx.name}»` : Noun;
    push({
      task: { kind: 'fixture', fixtureId: fx.id },
      key: taskKey({ kind: 'fixture', fixtureId: fx.id }),
      group,
      title: label,
      instruction: `Berør midten av ${noun} og trykk avtrekkeren.`,
      method: fx.type === 'vent' && !fx.mount ? 'point' : 'touch',
      target: { x: pl.x, y: pl.y, z: pl.z },
    });
  };

  for (const info of model.rooms.values()) {
    const { room } = info;
    const group = room.name;
    const floor = room.floorLevel;
    const c = centroid(info.polygon);
    push({
      task: { kind: 'room-floor', roomId: room.id },
      key: taskKey({ kind: 'room-floor', roomId: room.id }),
      group,
      title: `${group}: gulvet`,
      instruction: `Berør gulvet i ${group.toLowerCase()} med måletuppen og trykk avtrekkeren.`,
      method: 'touch',
      target: { x: c.x, y: floor, z: c.z },
    });
    info.polygon.forEach((p, index) => {
      push({
        task: { kind: 'room-corner', roomId: room.id, index },
        key: taskKey({ kind: 'room-corner', roomId: room.id, index }),
        group,
        title: `${group}: hjørne ${index + 1} av ${info.polygon.length}`,
        instruction: 'Berør hjørnet som lyser, i hvilken som helst høyde, og trykk avtrekkeren.',
        method: 'touch',
        target: { x: p.x, y: floor + 1000, z: p.z },
      });
    });
    ceilingSpots(info.polygon).forEach((p, slot) => {
      push({
        task: { kind: 'ceiling', roomId: room.id, slot },
        key: taskKey({ kind: 'ceiling', roomId: room.id, slot }),
        group,
        title: `${group}: tak ${slot + 1} av ${CEILING_POINTS}`,
        instruction:
          'Pek på taket der det lyser og trykk avtrekkeren. Rekker du opp, kan du også berøre taket med måletuppen.',
        method: 'point',
        target: { x: p.x, y: planeY(info.plane, p.x, p.z), z: p.z },
      });
    });
    for (const o of d.openings) if (!usedOpenings.has(o.id) && openingRoom(o) === room.id) addOpening(o, group);
    for (const fx of d.fixtures) if (!usedFixtures.has(fx.id) && fixtureRoom(fx) === room.id) addFixture(fx, group);
  }
  // Det som ikke hører til et bestemt rom kommer til slutt.
  for (const o of d.openings) if (!usedOpenings.has(o.id)) addOpening(o, 'Annet');
  for (const fx of d.fixtures) if (!usedFixtures.has(fx.id)) addFixture(fx, 'Annet');
  return tasks;
}

/**
 * Svarer på om oppgavens verdi allerede er målt i fila.
 * Gulvet i rommet inngangsdøra går inn til er origo (0) og måles aldri.
 */
function measuredLookup(doc: ApartmentDoc | undefined): (t: Task) => boolean {
  if (!doc) return () => false;
  const rooms = new Map(doc.rooms.map((r) => [r.id, r]));
  const openings = new Map(doc.openings.map((o) => [o.id, o]));
  const fixtures = new Map(doc.fixtures.map((f) => [f.id, f]));
  const entrance = doc.openings.find((o) => o.type === 'door' && o.entrance);
  const originRoom = entrance?.type === 'door' ? entrance.into : undefined;
  return (t) => {
    switch (t.kind) {
      case 'room-floor': {
        const r = rooms.get(t.roomId);
        return !r || t.roomId === originRoom || isMeasured(r.floorLevel, measuredFlag(r));
      }
      case 'room-corner': {
        const r = rooms.get(t.roomId);
        const v = r?.polygon[t.index];
        const f = measuredFlag(r);
        return !v || (isMeasured(v[0], f) && isMeasured(v[1], f));
      }
      case 'ceiling': {
        const r = rooms.get(t.roomId);
        if (!r) return true;
        const cf = measuredFlag(r.ceiling, measuredFlag(r));
        const pts = r.ceiling.points;
        return pts.length >= 3 && pts.every((p) => isMeasured(p.height, measuredFlag(p, cf)));
      }
      case 'jamb': {
        const o = openings.get(t.openingId);
        const f = measuredFlag(o);
        return !o || (isMeasured(o.offset, f) && isMeasured(o.width, f));
      }
      case 'opening-top': {
        const o = openings.get(t.openingId);
        const f = measuredFlag(o);
        if (!o) return true;
        return isMeasured(o.height, f) && (o.type !== 'window' || isMeasured(o.sillHeight, f));
      }
      case 'opening-sill': {
        const o = openings.get(t.openingId);
        return !o || o.type !== 'window' || isMeasured(o.sillHeight, measuredFlag(o));
      }
      case 'fixture': {
        const fx = fixtures.get(t.fixtureId);
        if (!fx) return true;
        const f = measuredFlag(fx);
        if (fx.mount) {
          const mf = measuredFlag(fx.mount, f);
          return isMeasured(fx.mount.along, mf) && isMeasured(fx.mount.height, mf);
        }
        return !!fx.position && fx.position.every((v) => isMeasured(v, f));
      }
    }
  };
}
