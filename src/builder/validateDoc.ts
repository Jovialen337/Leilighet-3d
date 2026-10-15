/**
 * Full sjekk av en tegning fra «Lag ny modell» som kommer utenfra: lagret i
 * nettleseren eller åpnet fra fil. En tegning som slipper gjennom her, skal
 * aldri kunne krasje byggeren eller appen – resten (rom som overlapper,
 * åpninger utenfor veggen …) er vanlige feil som sjekklisten viser.
 *
 * Gir en norsk beskrivelse av første problem, eller null.
 */
import { BUILDER_VERSION } from './types';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const opt = (v: unknown, ok: (x: unknown) => boolean): boolean => v === undefined || ok(v);
const str = (v: unknown): v is string => typeof v === 'string';
const bool = (v: unknown): v is boolean => typeof v === 'boolean';
const pair = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && v.every(num);
const triple = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every(num);
const listOf = (v: unknown, ok: (x: unknown) => boolean): boolean => v === undefined || (Array.isArray(v) && v.every(ok));

const MATERIALS = ['brick', 'concrete', 'drywall', 'wood', 'other'];
const SETTINGS = ['exteriorThickness', 'interiorThickness', 'maxWallGap', 'defaultCeiling'] as const;

function roomProblem(r: unknown, i: number): string | null {
  const at = `Rom ${i + 1}`;
  if (!isObj(r)) return `${at} er ikke et rom.`;
  if (!str(r.id) || !r.id) return `${at} mangler id.`;
  if (!str(r.name)) return `${at} mangler navn.`;
  if (!Array.isArray(r.polygon) || !r.polygon.every((p) => isObj(p) && num(p.x) && num(p.z) && opt(p.m, bool)))
    return `${at} («${r.name}») har hjørner uten gyldige mål.`;
  if (!num(r.floor) || !num(r.ceiling)) return `${at} («${r.name}») mangler gulvnivå eller takhøyde.`;
  if (!opt(r.floorMeasured, bool) || !opt(r.ceilingMeasured, bool) || !opt(r.floorColor, str)) return `${at} («${r.name}») har ugyldige valg.`;
  if (!listOf(r.ceilingCorners, (h) => h === null || num(h))) return `${at} («${r.name}») har ugyldige takhøyder i hjørnene.`;
  if (!listOf(r.edges, (e) => e === null || (isObj(e) && opt(e.thickness, (t) => num(t) && t > 0) && opt(e.material, (m) => MATERIALS.includes(m as string)))))
    return `${at} («${r.name}») har ugyldige veggvalg.`;
  return null;
}

function openingProblem(o: unknown, i: number): string | null {
  const at = `Åpning ${i + 1}`;
  if (!isObj(o)) return `${at} er ikke en åpning.`;
  if (!str(o.id) || !o.id) return `${at} mangler id.`;
  if (o.type !== 'door' && o.type !== 'window' && o.type !== 'passage') return `${at} har ukjent type.`;
  if (!str(o.room) || !(Number.isInteger(o.edge) && (o.edge as number) >= 0)) return `${at} sitter ikke på en kant i et rom.`;
  if (!num(o.offset) || !num(o.width) || !num(o.height)) return `${at} mangler mål.`;
  const ok =
    opt(o.sill, num) &&
    opt(o.into, str) &&
    opt(o.hinge, (h) => h === 'left' || h === 'right') &&
    opt(o.swing, (s) => s === 'in' || s === 'out') &&
    opt(o.entrance, bool) &&
    opt(o.name, str) &&
    opt(o.measured, bool);
  return ok ? null : `${at} har ugyldige valg.`;
}

/** Det som tas med fra en importert modell: formen må stemme, ellers kan flytting av rammen krasje. */
function extrasProblem(x: unknown): string | null {
  if (x === undefined) return null;
  if (!isObj(x)) return 'Tilleggsdataene i tegningen er ødelagt.';
  const ok =
    opt(x.meta, isObj) &&
    opt(x.settings, isObj) &&
    listOf(x.layers, isObj) &&
    listOf(x.fixtures, (a) => isObj(a) && isObj(a.fixture) && opt(a.anchor, (p) => isObj(p) && num(p.x) && num(p.z)) && opt((a.fixture as Obj).position, triple)) &&
    listOf(x.furniture, (f) => isObj(f) && triple(f.position)) &&
    listOf(x.outdoor, (o) => isObj(o) && Array.isArray(o.polygon) && o.polygon.every(pair) && num(o.level)) &&
    listOf(x.zones, (z) => isObj(z) && Array.isArray(z.polygon) && z.polygon.every(pair)) &&
    listOf(x.wiring, (w) => isObj(w) && Array.isArray(w.points) && w.points.every(triple)) &&
    listOf(x.pipes, (w) => isObj(w) && Array.isArray(w.points) && w.points.every(triple)) &&
    listOf(x.circuits, isObj) &&
    listOf(x.scans, (s) => isObj(s) && triple(s.position)) &&
    listOf(x.notes, (n) => isObj(n) && triple(n.position)) &&
    listOf(x.walls, (w) => isObj(w) && str(w.id) && pair(w.start) && pair(w.end) && num(w.thickness));
  return ok ? null : 'Det som ble tatt med fra den gamle modellen (installasjoner, møbler, kabler …), er ødelagt.';
}

/** Første problem i tegningen (norsk), eller null når den kan brukes. */
export function builderDocProblem(v: unknown): string | null {
  if (!isObj(v) || v.version === undefined) return 'Fila er ikke en tegning fra «Lag ny modell».';
  if (v.version !== BUILDER_VERSION) return 'Tegningen er fra en annen versjon av «Lag ny modell».';
  if (!str(v.name)) return 'Tegningen mangler navn.';
  if (v.settings !== undefined) {
    if (!isObj(v.settings)) return 'Standardvalgene i tegningen er ødelagt.';
    for (const k of SETTINGS) if (!opt(v.settings[k], (n) => num(n) && n > 0)) return 'Standardvalgene i tegningen er ødelagt.';
  }
  if (!Array.isArray(v.rooms) || !Array.isArray(v.openings)) return 'Tegningen mangler rom eller åpninger.';
  for (let i = 0; i < v.rooms.length; i++) {
    const p = roomProblem(v.rooms[i], i);
    if (p) return p;
  }
  for (let i = 0; i < v.openings.length; i++) {
    const p = openingProblem(v.openings[i], i);
    if (p) return p;
  }
  return extrasProblem(v.extras);
}
