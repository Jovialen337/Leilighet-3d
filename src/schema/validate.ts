/**
 * Kjøretidsvalidering av apartment.json med norske feilmeldinger.
 *
 * 1. Struktur: typer, påkrevde felt, lovlige verdier.
 * 2. Sammenheng: unike id-er, referanser (vegg, rom, lag) finnes.
 * 3. Geometri: polygoner, takplan, åpninger innenfor veggen, dørretning.
 *
 * Feil stopper innlasting. Advarsler vises, men modellen tegnes.
 */
import {
  COLLECTIONS,
  FIXTURE_TYPES,
  STANDARD_LAYER_IDS,
  type ApartmentDoc,
  type CollectionKey,
} from './types';
import { isMeasuredValue, normalize } from './normalize';
import { ApartmentModel } from '../model/ApartmentModel';
import { isSelfIntersecting, p2, polygonArea, signedArea } from '../geometry/math2d';
import { MIN_CEILING_TRIANGLE_AREA, maxTriangleArea } from '../geometry/plane';

export type Severity = 'error' | 'warning';

export interface Issue {
  severity: Severity;
  /** Teknisk sti i fila, f.eks. "rooms[2].polygon". */
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  doc: ApartmentDoc | null;
  model: ApartmentModel | null;
}

type Obj = Record<string, unknown>;

const LABEL: Record<string, string> = {
  schemaVersion: 'skjemaversjon',
  meta: 'metadata',
  name: 'navn',
  polygon: 'polygon',
  floorLevel: 'gulvnivå',
  ceiling: 'tak',
  points: 'punkter',
  height: 'høyde',
  start: 'startpunkt',
  end: 'sluttpunkt',
  thickness: 'tykkelse',
  justify: 'hvilken side tykkelsen ligger',
  color: 'farge',
  material: 'materiale',
  base: 'underkant',
  wall: 'vegg',
  offset: 'avstand fra veggens start',
  width: 'bredde',
  length: 'lengde',
  room: 'rom',
  into: 'rommet man går inn i',
  hinge: 'hengselside',
  swing: 'slår inn/ut',
  swingDirection: 'svingretning',
  openAngle: 'åpningsvinkel',
  entrance: 'inngangsdør',
  sillHeight: 'brystningshøyde',
  type: 'type',
  layer: 'lag',
  status: 'status',
  mount: 'veggplassering',
  position: 'posisjon',
  rotation: 'rotasjon',
  size: 'størrelse',
  along: 'avstand langs veggen',
  face: 'veggside',
  orientation: 'retning',
  label: 'etikett',
  template: 'maltype',
  source: 'kilde',
  parts: 'deler',
  shape: 'form',
  radius: 'radius',
  kind: 'type',
  level: 'nivå',
  url: 'adresse',
  format: 'format',
  scale: 'skala',
  opacity: 'gjennomsiktighet',
  text: 'tekst',
  measured: 'målt',
  note: 'notat',
  visible: 'synlig',
  dimensions: 'kontrollmål',
  floorColor: 'gulvfarge',
  leafColor: 'dørbladfarge',
  frameColor: 'karmfarge',
  planCutHeight: 'snitthøyde for plan',
  defaultWallHeight: 'standard vegghøyde',
  backgroundColor: 'bakgrunnsfarge',
};

const FIXTURE_NAME: Record<string, string> = {
  outlet: 'Stikkontakt',
  switch: 'Bryter',
  radiator: 'Radiator',
  pipe: 'Rør',
  vent: 'Ventil',
  hatch: 'Luke',
};

const COLLECTION_NAME: Record<CollectionKey, string> = {
  rooms: 'Rom',
  walls: 'Vegg',
  openings: 'Åpning',
  fixtures: 'Installasjon',
  furniture: 'Møbel',
  outdoor: 'Uteområde',
  zones: 'Sone',
  wiring: 'Kabel',
  scans: 'Skann',
  notes: 'Notat',
};

const fmt = (n: number): string => (Math.round(n * 10) / 10).toLocaleString('nb-NO');
const field = (key: string): string => (LABEL[key] ? `«${key}» (${LABEL[key]})` : `«${key}»`);
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = (values: readonly string[]): string => values.map((v) => `"${v}"`).join(', ');
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

class Checker {
  readonly issues: Issue[] = [];
  error(path: string, subject: string, msg: string): void {
    this.issues.push({ severity: 'error', path, message: subject ? `${subject}: ${msg}` : msg });
  }
  warn(path: string, subject: string, msg: string): void {
    this.issues.push({ severity: 'warning', path, message: subject ? `${subject}: ${msg}` : msg });
  }
  get errorCount(): number {
    return this.issues.filter((i) => i.severity === 'error').length;
  }
}

interface NumOpts {
  required?: boolean;
  min?: number;
  gt?: number;
  max?: number;
}

/** Hjelper for å sjekke feltene i ett objekt. */
class Scope {
  constructor(
    readonly c: Checker,
    readonly path: string,
    readonly subject: string,
    readonly obj: Obj,
  ) {}

  private p(key: string): string {
    return `${this.path}.${key}`;
  }

  has(key: string): boolean {
    return this.obj[key] !== undefined;
  }

  missing(key: string, what: string): void {
    this.c.error(this.p(key), this.subject, `mangler ${field(key)} – må være ${what}.`);
  }

  /** Sjekker et tall (rent eller { value, measured }). Returnerer tallet eller null. */
  numAt(value: unknown, path: string, label: string, opts: NumOpts = {}): number | null {
    let n: number;
    if (typeof value === 'number') n = value;
    else if (isMeasuredValue(value)) {
      if (value.measured !== undefined && typeof value.measured !== 'boolean') {
        this.c.error(path, this.subject, `${label}: «measured» må være true eller false.`);
      }
      n = value.value;
    } else if (isObj(value) && 'value' in value) {
      this.c.error(
        path,
        this.subject,
        `${label} har ukjente felt. Et målt tall skrives som { "value": 900, "measured": true }.`,
      );
      return null;
    } else {
      this.c.error(
        path,
        this.subject,
        `${label} må være et tall (eller { "value": tall, "measured": true/false }), men er ${describe(value)}.`,
      );
      return null;
    }
    if (!Number.isFinite(n)) {
      this.c.error(path, this.subject, `${label} må være et endelig tall.`);
      return null;
    }
    if (opts.gt !== undefined && !(n > opts.gt))
      this.c.error(path, this.subject, `${label} må være større enn ${fmt(opts.gt)} (fant ${fmt(n)}).`);
    else if (opts.min !== undefined && n < opts.min)
      this.c.error(path, this.subject, `${label} kan ikke være mindre enn ${fmt(opts.min)} (fant ${fmt(n)}).`);
    if (opts.max !== undefined && n > opts.max)
      this.c.error(path, this.subject, `${label} kan ikke være større enn ${fmt(opts.max)} (fant ${fmt(n)}).`);
    return n;
  }

  num(key: string, opts: NumOpts = {}): number | null {
    if (!this.has(key)) {
      if (opts.required !== false) this.missing(key, 'et tall i mm');
      return null;
    }
    return this.numAt(this.obj[key], this.p(key), field(key), opts);
  }

  optNum(key: string, opts: NumOpts = {}): number | null {
    return this.num(key, { ...opts, required: false });
  }

  str(key: string, required = true): string | null {
    const v = this.obj[key];
    if (v === undefined) {
      if (required) this.missing(key, 'en tekst');
      return null;
    }
    if (typeof v !== 'string') {
      this.c.error(this.p(key), this.subject, `${field(key)} må være en tekst, men er ${describe(v)}.`);
      return null;
    }
    if (required && !v.trim()) {
      this.c.error(this.p(key), this.subject, `${field(key)} kan ikke være tom.`);
      return null;
    }
    return v;
  }

  bool(key: string, required = false): boolean | null {
    const v = this.obj[key];
    if (v === undefined) {
      if (required) this.missing(key, 'true eller false');
      return null;
    }
    if (typeof v !== 'boolean') {
      this.c.error(this.p(key), this.subject, `${field(key)} må være true eller false, men er ${describe(v)}.`);
      return null;
    }
    return v;
  }

  enumOf<T extends string>(key: string, values: readonly T[], required = true): T | null {
    const v = this.obj[key];
    if (v === undefined) {
      if (required) this.missing(key, `én av ${oneOf(values)}`);
      return null;
    }
    if (typeof v !== 'string' || !values.includes(v as T)) {
      this.c.error(this.p(key), this.subject, `${field(key)} må være én av ${oneOf(values)}, men er ${describe(v)}.`);
      return null;
    }
    return v as T;
  }

  color(key: string, required = false): void {
    const v = this.obj[key];
    if (v === undefined) {
      if (required) this.missing(key, 'en farge som "#rrggbb"');
      return;
    }
    if (typeof v !== 'string' || !COLOR_RE.test(v))
      this.c.error(this.p(key), this.subject, `${field(key)} må være en farge på formen "#rrggbb", men er ${describe(v)}.`);
  }

  /** Sjekker en tuppel av tall, f.eks. [x, z] eller [x, y, z]. */
  vecAt(value: unknown, path: string, label: string, size: 2 | 3, opts: NumOpts = {}): number[] | null {
    const shape = size === 2 ? '[x, z]' : '[x, y, z]';
    if (!Array.isArray(value) || value.length !== size) {
      this.c.error(path, this.subject, `${label} må være en liste med ${size} tall ${shape}, men er ${describe(value)}.`);
      return null;
    }
    const out: number[] = [];
    for (let i = 0; i < size; i++) {
      const n = this.numAt(value[i], `${path}[${i}]`, `${label}[${i}]`, opts);
      if (n === null) return null;
      out.push(n);
    }
    return out;
  }

  vec(key: string, size: 2 | 3, required = true, opts: NumOpts = {}): number[] | null {
    if (!this.has(key)) {
      if (required) this.missing(key, size === 2 ? 'et punkt [x, z]' : 'et punkt [x, y, z]');
      return null;
    }
    return this.vecAt(this.obj[key], this.p(key), field(key), size, opts);
  }

  /** Polygon: liste av [x, z]. */
  polygon(key: string): { x: number; z: number }[] | null {
    const v = this.obj[key];
    if (v === undefined) {
      this.missing(key, 'en liste med punkter [x, z]');
      return null;
    }
    if (!Array.isArray(v)) {
      this.c.error(this.p(key), this.subject, `${field(key)} må være en liste med punkter [x, z].`);
      return null;
    }
    const pts: { x: number; z: number }[] = [];
    let ok = true;
    v.forEach((pt, i) => {
      const r = this.vecAt(pt, `${this.p(key)}[${i}]`, `${field(key)} punkt ${i + 1}`, 2);
      if (r) pts.push(p2(r[0]!, r[1]!));
      else ok = false;
    });
    if (!ok) return null;
    if (pts.length < 3) {
      this.c.error(this.p(key), this.subject, `${field(key)} må ha minst 3 punkter (fant ${pts.length}).`);
      return null;
    }
    if (isSelfIntersecting(pts)) {
      this.c.error(this.p(key), this.subject, `${field(key)} krysser seg selv. Sjekk rekkefølgen på punktene.`);
      return null;
    }
    if (polygonArea(pts) < 1) {
      this.c.error(this.p(key), this.subject, `${field(key)} har null areal – punktene ligger på én linje.`);
      return null;
    }
    return pts;
  }

  child(key: string, what: string, required = true): Scope | null {
    const v = this.obj[key];
    if (v === undefined) {
      if (required) this.missing(key, what);
      return null;
    }
    if (!isObj(v)) {
      this.c.error(this.p(key), this.subject, `${field(key)} må være ${what}, men er ${describe(v)}.`);
      return null;
    }
    return new Scope(this.c, this.p(key), this.subject, v);
  }

  list(key: string, required = true): unknown[] | null {
    const v = this.obj[key];
    if (v === undefined) {
      if (required) this.missing(key, 'en liste');
      return null;
    }
    if (!Array.isArray(v)) {
      this.c.error(this.p(key), this.subject, `${field(key)} må være en liste, men er ${describe(v)}.`);
      return null;
    }
    return v;
  }

  /** Felles felt for alle objekter: id, measured, note. */
  base(): void {
    this.bool('measured');
    this.str('note', false);
  }
}

function describe(v: unknown): string {
  if (v === undefined) return 'tom';
  if (v === null) return 'null';
  if (Array.isArray(v)) return `en liste med ${v.length} element${v.length === 1 ? '' : 'er'}`;
  if (typeof v === 'string') return `teksten "${v.length > 40 ? v.slice(0, 40) + '…' : v}"`;
  if (typeof v === 'number') return `tallet ${fmt(v)}`;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return 'et objekt';
  return typeof v;
}

function subjectFor(key: CollectionKey, obj: Obj, index: number): string {
  let kind: string = COLLECTION_NAME[key];
  if (key === 'openings') {
    kind = obj.type === 'door' ? 'Dør' : obj.type === 'window' ? 'Vindu' : obj.type === 'passage' ? 'Åpning' : kind;
  } else if (key === 'fixtures' && typeof obj.type === 'string' && FIXTURE_NAME[obj.type]) {
    kind = FIXTURE_NAME[obj.type]!;
  }
  return typeof obj.id === 'string' && obj.id ? `${kind} «${obj.id}»` : `${kind} nr. ${index + 1}`;
}

/* ------------------------------------------------------------------ */
/* Strukturkontroll per objekttype                                     */
/* ------------------------------------------------------------------ */

function checkLayerRef(s: Scope, required: boolean): void {
  s.str('layer', required);
}

function checkRoom(s: Scope): void {
  s.str('name');
  s.polygon('polygon');
  s.num('floorLevel');
  s.color('floorColor');
  checkLayerRef(s, false);
  const ceiling = s.child('ceiling', 'et objekt med høydepunkter');
  if (ceiling) {
    ceiling.bool('measured');
    ceiling.color('color');
    const pts = ceiling.list('points');
    if (pts) {
      const ok: { x: number; z: number; y: number }[] = [];
      pts.forEach((pt, i) => {
        const path = `${ceiling.path}.points[${i}]`;
        if (!isObj(pt)) {
          s.c.error(path, s.subject, `takpunkt ${i + 1} må være et objekt { "x": …, "z": …, "height": … }.`);
          return;
        }
        const ps = new Scope(s.c, path, s.subject, pt);
        const x = ps.num('x');
        const z = ps.num('z');
        const h = ps.num('height', { gt: 0 });
        ps.bool('measured');
        if (x !== null && z !== null && h !== null) ok.push({ x, z, y: h });
      });
      if (pts.length < 3) {
        s.c.error(
          `${ceiling.path}.points`,
          s.subject,
          `taket trenger minst 3 høydepunkter for å bestemme et plan (fant ${pts.length}).`,
        );
      } else if (ok.length === pts.length && maxTriangleArea(ok) < MIN_CEILING_TRIANGLE_AREA) {
        s.c.error(
          `${ceiling.path}.points`,
          s.subject,
          'takpunktene ligger på (nesten) én linje, så takplanet kan ikke bestemmes. Mål et punkt til på tvers.',
        );
      }
    }
  }
  const dims = s.child('dimensions', 'et objekt med kontrollmål', false);
  if (dims) {
    dims.optNum('length', { gt: 0 });
    dims.optNum('width', { gt: 0 });
    dims.optNum('height', { gt: 0 });
  }
}

function checkWall(s: Scope): void {
  s.str('name', false);
  const a = s.vec('start', 2);
  const b = s.vec('end', 2);
  if (a && b && a[0] === b[0] && a[1] === b[1])
    s.c.error(`${s.path}.end`, s.subject, 'start og slutt er samme punkt – veggen har null lengde.');
  s.num('thickness', { gt: 0 });
  s.enumOf('justify', ['center', 'left', 'right'] as const, false);
  s.color('color', true);
  s.enumOf('material', ['concrete', 'drywall', 'wood', 'brick', 'other'] as const, false);
  s.optNum('height', { gt: 0 });
  s.optNum('base', { min: 0 });
  checkLayerRef(s, false);
}

function checkOpening(s: Scope): void {
  const type = s.enumOf('type', ['door', 'window', 'passage'] as const);
  s.str('name', false);
  s.str('wall');
  s.num('offset', { min: 0 });
  s.num('width', { gt: 0 });
  s.num('height', { gt: 0 });
  s.str('room', type === 'window' || type === 'passage');
  checkLayerRef(s, false);
  if (type === 'door') {
    s.str('into');
    s.enumOf('hinge', ['left', 'right'] as const);
    s.enumOf('swing', ['in', 'out'] as const);
    s.enumOf('swingDirection', ['clockwise', 'counterclockwise'] as const, false);
    s.optNum('openAngle', { gt: 0, max: 180 });
    s.bool('entrance');
    s.color('leafColor');
  } else if (type === 'window') {
    s.num('sillHeight', { min: 0 });
    s.color('frameColor');
  }
}

function checkFixture(s: Scope): void {
  s.str('name', false);
  s.enumOf('type', FIXTURE_TYPES);
  checkLayerRef(s, true);
  s.enumOf('status', ['existing', 'planned'] as const);
  s.color('color');
  s.str('label', false);
  const hasMount = s.has('mount');
  const hasPos = s.has('position');
  if (hasMount && hasPos)
    s.c.error(s.path, s.subject, 'bruk enten «mount» (på vegg) eller «position» (fri plassering), ikke begge.');
  if (!hasMount && !hasPos)
    s.c.error(s.path, s.subject, 'mangler plassering – oppgi «mount» (på vegg) eller «position» [x, høyde, z].');
  const m = s.child('mount', 'et objekt { wall, room/face, along, height }', false);
  if (m) {
    m.str('wall');
    m.str('room', false);
    m.enumOf('face', ['left', 'right'] as const, false);
    if (!m.has('room') && !m.has('face'))
      s.c.error(`${m.path}`, s.subject, 'veggplasseringen må si hvilken side: «room» (anbefalt) eller «face».');
    m.num('along', { min: 0 });
    m.num('height', { min: 0 });
  }
  if (hasPos) s.vec('position', 3);
  s.optNum('rotation');
  if (s.has('size')) s.vec('size', 3, true, { gt: 0 });
  s.enumOf('orientation', ['vertical', 'horizontal'] as const, false);
}

function checkFurniture(s: Scope): void {
  s.str('name');
  s.str('template');
  s.vec('position', 3);
  s.num('rotation');
  checkLayerRef(s, true);
  const src = s.child('source', 'et objekt { "kind": "own" } eller { "kind": "glb", "url": … }');
  let kind: string | null = null;
  if (src) {
    kind = src.enumOf('kind', ['own', 'glb'] as const);
    if (kind === 'glb') {
      src.str('url');
      src.optNum('scale', { gt: 0 });
    }
  }
  const parts = s.list('parts');
  if (parts) {
    if (parts.length === 0 && kind === 'own')
      s.c.error(`${s.path}.parts`, s.subject, 'et eget møbel må ha minst én del.');
    parts.forEach((part, i) => {
      const path = `${s.path}.parts[${i}]`;
      if (!isObj(part)) {
        s.c.error(path, s.subject, `del ${i + 1} må være et objekt.`);
        return;
      }
      const ps = new Scope(s.c, path, `${s.subject}, del ${i + 1}`, part);
      ps.enumOf('shape', ['box', 'cylinder', 'roundedBox'] as const);
      ps.vec('size', 3, true, { gt: 0 });
      ps.vec('offset', 3);
      ps.color('color', true);
      ps.optNum('radius', { min: 0 });
      ps.str('name', false);
    });
  }
}

function checkOutdoor(s: Scope): void {
  s.str('name');
  s.enumOf('kind', ['pathway', 'garden', 'terrace', 'other'] as const);
  s.polygon('polygon');
  s.num('level');
  s.color('color');
  checkLayerRef(s, false);
}

function checkZone(s: Scope): void {
  s.str('name');
  checkLayerRef(s, true);
  s.polygon('polygon');
  s.optNum('height', { gt: 0 });
  s.color('color');
}

function checkWire(s: Scope): void {
  s.str('name', false);
  checkLayerRef(s, true);
  s.enumOf('status', ['existing', 'planned'] as const);
  s.enumOf('kind', ['power', 'light', 'data', 'other'] as const, false);
  s.color('color');
  const pts = s.list('points');
  if (pts) {
    if (pts.length < 2) s.c.error(`${s.path}.points`, s.subject, `en kabel trenger minst 2 punkter (fant ${pts.length}).`);
    pts.forEach((p, i) => s.vecAt(p, `${s.path}.points[${i}]`, `punkt ${i + 1}`, 3));
  }
}

function checkScan(s: Scope): void {
  s.str('name');
  checkLayerRef(s, true);
  s.str('url');
  s.enumOf('format', ['glb', 'ply', 'obj', 'image'] as const);
  s.vec('position', 3);
  s.num('rotation');
  s.optNum('scale', { gt: 0 });
  const op = s.obj.opacity;
  if (op !== undefined && (typeof op !== 'number' || op < 0 || op > 1))
    s.c.error(`${s.path}.opacity`, s.subject, `${field('opacity')} må være et tall mellom 0 og 1.`);
}

function checkNote(s: Scope): void {
  s.str('text');
  checkLayerRef(s, true);
  s.vec('position', 3);
  s.color('color');
}

const CHECKERS: Record<CollectionKey, (s: Scope) => void> = {
  rooms: checkRoom,
  walls: checkWall,
  openings: checkOpening,
  fixtures: checkFixture,
  furniture: checkFurniture,
  outdoor: checkOutdoor,
  zones: checkZone,
  wiring: checkWire,
  scans: checkScan,
  notes: checkNote,
};

/** Standardlag for objekter uten eget «layer». */
const DEFAULT_LAYER: Partial<Record<CollectionKey, string>> = {
  rooms: 'structure',
  walls: 'structure',
  openings: 'openings',
  outdoor: 'outdoor',
};

/* ------------------------------------------------------------------ */
/* Hovedfunksjon                                                       */
/* ------------------------------------------------------------------ */

export function validateApartment(raw: unknown): ValidationResult {
  const c = new Checker();
  const fail = (): ValidationResult => ({
    ok: false,
    errors: c.issues.filter((i) => i.severity === 'error'),
    warnings: c.issues.filter((i) => i.severity === 'warning'),
    doc: null,
    model: null,
  });

  if (!isObj(raw)) {
    c.error('', '', 'Fila må inneholde ett JSON-objekt på toppnivå.');
    return fail();
  }
  const root = new Scope(c, '$', '', raw);
  if (raw.schemaVersion !== 1)
    c.error('schemaVersion', '', `«schemaVersion» må være 1 (fant ${describe(raw.schemaVersion)}).`);
  const meta = root.child('meta', 'et objekt med «name»');
  if (meta) {
    meta.str('name');
    meta.str('description', false);
    meta.str('origin', false);
    meta.str('updated', false);
  }
  const settings = root.child('settings', 'et objekt', false);
  if (settings) {
    settings.optNum('planCutHeight', { gt: 0 });
    settings.optNum('defaultWallHeight', { gt: 0 });
    settings.color('backgroundColor');
  }

  // Lag
  const layerIds = new Set<string>();
  const layers = root.list('layers');
  layers?.forEach((l, i) => {
    const path = `layers[${i}]`;
    if (!isObj(l)) {
      c.error(path, '', `Lag nr. ${i + 1} må være et objekt { id, name, visible }.`);
      return;
    }
    const s = new Scope(c, path, typeof l.id === 'string' ? `Lag «${l.id}»` : `Lag nr. ${i + 1}`, l);
    const id = s.str('id');
    s.str('name');
    s.bool('visible', true);
    if (id) {
      if (layerIds.has(id)) c.error(`${path}.id`, s.subject, 'id-en er brukt av et annet lag.');
      layerIds.add(id);
    }
  });
  for (const std of STANDARD_LAYER_IDS)
    if (layers && !layerIds.has(std)) c.warn('layers', '', `Standardlaget «${std}» mangler i «layers».`);

  // Objektsamlinger
  const seenIds = new Map<string, string>();
  const layerRefs: { path: string; subject: string; layer: string }[] = [];
  for (const key of COLLECTIONS) {
    const list = root.list(key);
    if (!list) continue;
    list.forEach((item, i) => {
      const path = `${key}[${i}]`;
      if (!isObj(item)) {
        c.error(path, '', `${COLLECTION_NAME[key]} nr. ${i + 1} må være et objekt, men er ${describe(item)}.`);
        return;
      }
      const subject = subjectFor(key, item, i);
      const s = new Scope(c, path, subject, item);
      const id = s.str('id');
      s.base();
      if (id) {
        const prev = seenIds.get(id);
        if (prev) c.error(`${path}.id`, subject, `id-en er allerede brukt av ${prev}. Alle id-er må være unike.`);
        else seenIds.set(id, subject);
      }
      CHECKERS[key](s);
      const layer = typeof item.layer === 'string' ? item.layer : DEFAULT_LAYER[key];
      if (layer) layerRefs.push({ path: `${path}.layer`, subject, layer });
    });
  }
  for (const ref of layerRefs)
    if (layers && !layerIds.has(ref.layer))
      c.error(ref.path, ref.subject, `laget «${ref.layer}» finnes ikke i «layers».`);

  if (c.errorCount > 0) return fail();

  // Referanser og geometri – nå vet vi at strukturen er riktig.
  const doc = raw as unknown as ApartmentDoc;
  const model = new ApartmentModel(normalize(doc));
  checkReferences(c, model);
  if (c.errorCount > 0) return fail();
  checkGeometry(c, model);
  if (c.errorCount > 0) return fail();

  return {
    ok: true,
    errors: [],
    warnings: c.issues.filter((i) => i.severity === 'warning'),
    doc,
    model,
  };
}

function checkReferences(c: Checker, m: ApartmentModel): void {
  const d = m.data;
  const roomRef = (path: string, subject: string, key: string, id: string | undefined): void => {
    if (id !== undefined && !m.rooms.has(id))
      c.error(path, subject, `${field(key)} viser til rommet «${id}», som ikke finnes.`);
  };
  const wallRef = (path: string, subject: string, id: string): boolean => {
    if (m.walls.has(id)) return true;
    c.error(path, subject, `${field('wall')} viser til veggen «${id}», som ikke finnes.`);
    return false;
  };
  d.openings.forEach((o, i) => {
    const subject = subjectFor('openings', o as unknown as Obj, i);
    wallRef(`openings[${i}].wall`, subject, o.wall);
    roomRef(`openings[${i}].room`, subject, 'room', o.room);
    if (o.type === 'door') roomRef(`openings[${i}].into`, subject, 'into', o.into);
  });
  d.fixtures.forEach((f, i) => {
    if (!f.mount) return;
    const subject = subjectFor('fixtures', f as unknown as Obj, i);
    wallRef(`fixtures[${i}].mount.wall`, subject, f.mount.wall);
    roomRef(`fixtures[${i}].mount.room`, subject, 'room', f.mount.room);
  });
  const entrances = d.openings.filter((o) => o.type === 'door' && o.entrance);
  if (entrances.length === 0)
    c.warn('openings', '', 'Ingen dør er merket med "entrance": true. VR starter da midt i første rom.');
  if (entrances.length > 1)
    c.warn('openings', '', `${entrances.length} dører er merket som inngangsdør. Den første brukes som startpunkt.`);
}

function checkGeometry(c: Checker, m: ApartmentModel): void {
  const d = m.data;

  d.rooms.forEach((room, i) => {
    const subject = `Rom «${room.id}»`;
    const info = m.rooms.get(room.id)!;
    if (info.plane.maxResidual > 30)
      c.warn(
        `rooms[${i}].ceiling.points`,
        subject,
        `takpunktene passer dårlig i ett plan (avvik opptil ${fmt(info.plane.maxResidual)} mm). Sjekk målingene.`,
      );
    for (const p of info.polygon) {
      const h = m.ceilingAt(info, p) - room.floorLevel;
      if (h < 1500) {
        c.warn(`rooms[${i}].ceiling`, subject, `takhøyden blir bare ${fmt(h)} mm i hjørnet (${fmt(p.x)}, ${fmt(p.z)}).`);
        break;
      }
    }
    if (room.dimensions) {
      const bw = info.bounds.maxX - info.bounds.minX;
      const bd = info.bounds.maxZ - info.bounds.minZ;
      const [short, long] = bw < bd ? [bw, bd] : [bd, bw];
      const { length, width, height } = room.dimensions;
      if (length !== undefined && Math.abs(length - long) > 20)
        c.warn(`rooms[${i}].dimensions.length`, subject, `kontrollmålet lengde ${fmt(length)} mm stemmer ikke med polygonet (${fmt(long)} mm).`);
      if (width !== undefined && Math.abs(width - short) > 20)
        c.warn(`rooms[${i}].dimensions.width`, subject, `kontrollmålet bredde ${fmt(width)} mm stemmer ikke med polygonet (${fmt(short)} mm).`);
      if (height !== undefined) {
        const hs = info.polygon.map((p) => m.ceilingAt(info, p) - room.floorLevel);
        if (Math.abs(Math.min(...hs) - height) > 20 && Math.abs(Math.max(...hs) - height) > 20)
          c.warn(`rooms[${i}].dimensions.height`, subject, `kontrollmålet takhøyde ${fmt(height)} mm stemmer ikke med taket.`);
      }
    }
    if (signedArea(info.polygon) === 0) c.error(`rooms[${i}].polygon`, subject, 'polygonet har null areal.');
  });

  d.openings.forEach((o, i) => {
    const subject = subjectFor('openings', o as unknown as Obj, i);
    const span = m.openingSpan(o)!;
    const f = span.frame;
    if (span.u1 > f.length + 0.5)
      c.error(
        `openings[${i}].offset`,
        subject,
        `går utenfor veggen «${o.wall}»: slutter ${fmt(span.u1)} mm fra veggens start, men veggen er bare ${fmt(f.length)} mm lang.`,
      );
    const topAt = Math.min(m.wallTopAt(f, span.u0), m.wallTopAt(f, span.u1));
    if (span.top > topAt)
      c.warn(`openings[${i}].height`, subject, `overkanten (${fmt(span.top)} mm) går over taket/veggtoppen (${fmt(topAt)} mm).`);
    for (const other of m.openingsByWall.get(o.wall) ?? []) {
      if (other === o || d.openings.indexOf(other) < i) continue;
      const a0 = other.offset;
      const a1 = other.offset + other.width;
      if (a0 < span.u1 && span.u0 < a1) {
        const os = m.openingSpan(other)!;
        if (os.bottom < span.top && span.bottom < os.top)
          c.error(`openings[${i}]`, subject, `overlapper med «${other.id}» i samme vegg.`);
      }
    }
    if (o.type === 'door') {
      const g = m.doorGeometry(o);
      if (!g) {
        c.error(
          `openings[${i}].into`,
          subject,
          `finner ikke rommet «${o.into}» på noen side av veggen «${o.wall}». Sjekk «into», «wall» og «offset».`,
        );
      } else if (o.swingDirection && o.swingDirection !== g.swingDirection) {
        const no = (s: string): string => (s === 'clockwise' ? 'med klokka' : 'mot klokka');
        c.error(
          `openings[${i}].swingDirection`,
          subject,
          `«swingDirection» sier ${no(o.swingDirection)}, men hengsel «${o.hinge}» + «${o.swing}» gir ${no(g.swingDirection)} sett ovenfra.`,
        );
      }
    } else if (o.room && !m.sideOfRoom(f, o.room, (span.u0 + span.u1) / 2)) {
      c.warn(`openings[${i}].room`, subject, `rommet «${o.room}» ligger ikke inntil veggen ved åpningen.`);
    }
  });

  d.fixtures.forEach((fx, i) => {
    if (!fx.mount) return;
    const subject = subjectFor('fixtures', fx as unknown as Obj, i);
    const f = m.walls.get(fx.mount.wall)!;
    if (fx.mount.along > f.length)
      c.error(
        `fixtures[${i}].mount.along`,
        subject,
        `sitter ${fmt(fx.mount.along)} mm langs veggen «${f.wall.id}», men veggen er bare ${fmt(f.length)} mm lang.`,
      );
    if (fx.mount.room && !m.sideOfRoom(f, fx.mount.room))
      c.warn(`fixtures[${i}].mount.room`, subject, `rommet «${fx.mount.room}» ligger ikke inntil veggen «${f.wall.id}».`);
  });

  d.fixtures.forEach((fx, i) => {
    const subject = subjectFor('fixtures', fx as unknown as Obj, i);
    if (fx.status === 'planned' && fx.layer === 'electrical-existing')
      c.warn(`fixtures[${i}].layer`, subject, 'er planlagt, men ligger i laget for eksisterende elektrisk.');
    if (fx.status === 'existing' && fx.layer === 'electrical-planned')
      c.warn(`fixtures[${i}].layer`, subject, 'finnes allerede, men ligger i laget for planlagt elektrisk.');
  });
}

/** Kort sammendrag for status-linja. */
export function summarize(model: ApartmentModel): string {
  const d = model.data;
  const area = [...model.rooms.values()].reduce((s, r) => s + r.area, 0) / 1e6;
  return `${d.rooms.length} rom (${area.toLocaleString('nb-NO', { maximumFractionDigits: 1 })} m²), ${d.walls.length} vegger, ${d.openings.length} åpninger, ${d.fixtures.length} installasjoner, ${d.furniture.length} møbler`;
}
