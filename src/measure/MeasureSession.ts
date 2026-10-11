/**
 * Én oppmåling: huskelisten, målingene og utkastet til ny apartment.json.
 *
 * Alt brukeren gjør lagres som en logg (måling / hopp over / ta de
 * overhoppede). Tilstanden avledes fra loggen, så «angre» er bare å fjerne
 * siste hendelse – også etter at siden er lastet på nytt. Utkastet regnes ut
 * på nytt fra den opprinnelige fila etter hver endring.
 *
 * Loggen lagres lokalt (localStorage) sammen med et fingeravtrykk av fila den
 * hører til. Er fila endret siden, legges de gamle målingene til side.
 */
import type { ApartmentModel } from '../model/ApartmentModel';
import type { ApartmentDoc } from '../schema/types';
import { formatJson } from '../schema/format';
import { validateApartment } from '../schema/validate';
import { polygonArea, p2 } from '../geometry/math2d';
import { applyMeasurements } from './applyMeasurements';
import { buildTasks, MIN_CEILING_AREA, taskKey, type Task, type TaskInfo } from './tasks';
import type { Observation } from './types';

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const STORAGE_KEY = 'leilighet:oppmaling:v1';
/** Advarsel når en måling er langt fra der modellen trodde (mm). */
export const FAR_HORIZONTAL = 1500;
export const FAR_VERTICAL = 400;
/** Minste avstand mellom to takpunkter i samme rom (mm). */
export const MIN_CEILING_SPACING = 400;

export type Action = { t: 'obs'; o: Observation } | { t: 'skip'; key: string } | { t: 'revisit' };

interface Saved {
  version: 1;
  baseHash: string;
  log: Action[];
  cursor: string | null;
  /** Fingeravtrykk av sist eksporterte fil. */
  exportedHash?: string;
  updatedAt: string;
}

export type RecordResult = { ok: true; warning?: string } | { ok: false; message: string };

export interface Progress {
  done: number;
  skipped: number;
  total: number;
  groups: { group: string; done: number; total: number }[];
}

export interface StaleInfo {
  count: number;
  updatedAt: string;
}

/** FNV-1a (32 bit) som heksadesimal tekst. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const hashDoc = (doc: ApartmentDoc): string => hashText(JSON.stringify(doc));

const r1 = (v: number): number => Math.round(v * 10) / 10;

export function observationFor(t: Task, p: { x: number; y: number; z: number }): Observation {
  const x = r1(p.x);
  const y = r1(p.y);
  const z = r1(p.z);
  switch (t.kind) {
    case 'room-floor':
      return { kind: t.kind, roomId: t.roomId, y };
    case 'room-corner':
      return { kind: t.kind, roomId: t.roomId, index: t.index, x, z };
    case 'ceiling':
      return { kind: t.kind, roomId: t.roomId, slot: t.slot, x, y, z };
    case 'jamb':
      return { kind: t.kind, openingId: t.openingId, side: t.side, x, z };
    case 'opening-top':
    case 'opening-sill':
      return { kind: t.kind, openingId: t.openingId, y };
    case 'fixture':
      return { kind: t.kind, fixtureId: t.fixtureId, x, y, z };
  }
}

/** Hvor langt (mm) en måling er fra oppgavens mål-punkt, vannrett og loddrett. */
function distanceToTarget(o: Observation, t: TaskInfo): { h: number; v: number } {
  const h = 'x' in o ? Math.hypot(o.x - t.target.x, o.z - t.target.z) : 0;
  const v = 'y' in o && o.kind !== 'fixture' ? Math.abs(o.y - t.target.y) : 0;
  return { h, v };
}

const metres = (mm: number): string => `${(mm / 1000).toFixed(1).replace('.', ',')} m`;

const today = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export class MeasureSession {
  readonly baseHash: string;
  readonly baseModel: ApartmentModel;
  /** Gjeldende utkast (siste gyldige) og modellen for det. */
  draft: ApartmentDoc;
  model: ApartmentModel;
  tasks: TaskInfo[] = [];
  observations: Observation[] = [];
  /** Nøkler som er målt. */
  done = new Set<string>();
  /** Nøkler som er hoppet over (og ikke målt senere). */
  skipped = new Set<string>();
  /** Feilmelding hvis siste endring ga en ugyldig modell; da vises forrige gyldige utkast. */
  error: string | null = null;
  /** Lagrede målinger som hører til en eldre versjon av fila. */
  stale: StaleInfo | null = null;
  /** Målingene som lå lagret, er nå med i fila (den ble lastet opp). */
  published = false;

  private log: Action[] = [];
  private cursor: string | null = null;
  private exportedHash: string | undefined;
  private listeners = new Set<() => void>();

  constructor(
    readonly base: ApartmentDoc,
    private readonly storage: KV | null = null,
    private readonly key = STORAGE_KEY,
  ) {
    const r = validateApartment(base);
    if (!r.ok || !r.model) throw new Error('Grunnmodellen er ugyldig.');
    this.baseHash = hashDoc(base);
    this.baseModel = r.model;
    this.draft = base;
    this.model = r.model;
    this.restore();
    this.recompute(true);
  }

  /* ---------------- Lesing ---------------- */

  /** Antall hendelser i loggen (målinger og hopp). */
  get size(): number {
    return this.log.length;
  }

  get hasMeasurements(): boolean {
    return this.observations.length > 0;
  }

  /** Oppgaven som står for tur: den man har bladd til, ellers første som gjenstår. */
  current(): TaskInfo | null {
    if (this.cursor) {
      const t = this.tasks.find((x) => x.key === this.cursor);
      if (t) return t;
    }
    return this.tasks.find((t) => this.isOpen(t.key)) ?? null;
  }

  isOpen(key: string): boolean {
    return !this.done.has(key) && !this.skipped.has(key);
  }

  progress(): Progress {
    const groups: Progress['groups'] = [];
    let done = 0;
    let skipped = 0;
    for (const t of this.tasks) {
      let g = groups[groups.length - 1];
      if (!g || g.group !== t.group) groups.push((g = { group: t.group, done: 0, total: 0 }));
      g.total++;
      if (this.done.has(t.key)) {
        done++;
        g.done++;
      } else if (this.skipped.has(t.key)) skipped++;
    }
    return { done, skipped, total: this.tasks.length, groups };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /* ---------------- Endringer ---------------- */

  /** Registrerer en måling (mm, modellkoordinater) for oppgaven som står for tur. */
  record(p: { x: number; y: number; z: number }, task: TaskInfo | null = this.current()): RecordResult {
    if (!task) return { ok: false, message: 'Det er ingen oppgave å måle akkurat nå.' };
    const o = observationFor(task.task, p);
    const problem = this.check(o);
    if (problem) return { ok: false, message: problem };
    const { h, v } = distanceToTarget(o, task);
    this.log.push({ t: 'obs', o });
    this.recompute();
    this.cursor = this.nextOpen(task.key);
    this.changed();
    if (h > FAR_HORIZONTAL || v > FAR_VERTICAL)
      return {
        ok: true,
        warning: `Målingen er ${metres(Math.max(h, v))} fra der modellen trodde. Stemmer den ikke, trykk B for å angre.`,
      };
    return { ok: true };
  }

  /** Hopper over oppgaven som står for tur (den kommer igjen til slutt). */
  skip(task: TaskInfo | null = this.current()): void {
    if (!task) return;
    this.log.push({ t: 'skip', key: task.key });
    this.recompute();
    this.cursor = this.nextOpen(task.key);
    this.changed();
  }

  /** Tar de overhoppede oppgavene på nytt. */
  revisitSkipped(): void {
    if (!this.skipped.size) return;
    this.log.push({ t: 'revisit' });
    this.recompute();
    this.cursor = null;
    this.changed();
  }

  /** Angrer siste hendelse og går tilbake til den oppgaven. */
  undo(): boolean {
    const a = this.log.pop();
    if (!a) return false;
    this.recompute();
    if (a.t === 'obs') this.cursor = taskKey(a.o);
    else if (a.t === 'skip') this.cursor = a.key;
    this.changed();
    return true;
  }

  /** Blar til forrige/neste oppgave uten å hoppe over noe. */
  step(delta: number): void {
    if (!this.tasks.length) return;
    const cur = this.current();
    const i = cur ? this.tasks.indexOf(cur) : -1;
    const n = this.tasks.length;
    const j = i < 0 ? (delta > 0 ? 0 : n - 1) : (((i + delta) % n) + n) % n;
    this.cursor = this.tasks[j]!.key;
    this.changed();
  }

  /** Går til en bestemt oppgave. */
  select(key: string): void {
    if (!this.tasks.some((t) => t.key === key)) return;
    this.cursor = key;
    this.changed();
  }

  /** Forkaster alle lokale målinger. */
  discard(): void {
    this.log = [];
    this.cursor = null;
    this.exportedHash = undefined;
    this.stale = null;
    this.published = false;
    this.recompute(true);
    try {
      this.storage?.removeItem(this.key);
      this.storage?.removeItem(this.staleKey);
    } catch {
      /* lagring utilgjengelig */
    }
    this.notify();
  }

  /** Forkaster bare de gamle målingene (laget mot en eldre fil); dagens beholdes. */
  discardStale(): void {
    if (!this.stale) return;
    this.stale = null;
    try {
      this.storage?.removeItem(this.staleKey);
    } catch {
      /* lagring utilgjengelig */
    }
    this.notify();
  }

  /** Bruker målinger som ble laget mot en eldre versjon av fila. */
  adoptStale(): boolean {
    const saved = this.read(this.staleKey);
    if (!saved) return false;
    const keys = new Set(this.tasks.map((t) => t.key));
    const keep = (a: Action): boolean =>
      a.t === 'revisit' || (a.t === 'skip' ? keys.has(a.key) : keys.has(taskKey(a.o)));
    this.log = [...this.log, ...saved.log.filter(keep)];
    this.stale = null;
    try {
      this.storage?.removeItem(this.staleKey);
    } catch {
      /* lagring utilgjengelig */
    }
    this.recompute(true);
    this.changed();
    return true;
  }

  /**
   * Utkastet som apartment.json-tekst (med dagens dato). Husker fingeravtrykket.
   * `transform` legger til andre lokale endringer (f.eks. planlagt el og vann)
   * før fila skrives, så den publiserte fila gjenkjennes som «vår».
   */
  exportText(now = new Date(), transform: (doc: ApartmentDoc) => ApartmentDoc = (d) => d): string {
    const doc = transform(structuredClone(this.draft));
    doc.meta.updated = today(now);
    const text = formatJson(doc);
    this.exportedHash = hashDoc(JSON.parse(text) as ApartmentDoc);
    this.save();
    return text;
  }

  /* ---------------- Internt ---------------- */

  private get staleKey(): string {
    return `${this.key}:gammel`;
  }

  /** Avviser målinger som ikke kan stemme. */
  private check(o: Observation): string | null {
    if (o.kind !== 'ceiling') return null;
    const others = this.observations.filter(
      (x): x is Extract<Observation, { kind: 'ceiling' }> =>
        x.kind === 'ceiling' && x.roomId === o.roomId && x.slot !== o.slot,
    );
    for (const x of others)
      if (Math.hypot(x.x - o.x, x.z - o.z) < MIN_CEILING_SPACING)
        return 'For nær et annet takpunkt i rommet. Pek litt lenger unna.';
    if (others.length >= 2) {
      const tri = [p2(others[0]!.x, others[0]!.z), p2(others[1]!.x, others[1]!.z), p2(o.x, o.z)];
      if (polygonArea(tri) < MIN_CEILING_AREA)
        return 'For nær en rett linje med de andre takpunktene. Pek lenger unna.';
    }
    return null;
  }

  /** Neste oppgave som gjenstår etter `key` (rundt til starten). */
  private nextOpen(key: string): string | null {
    const n = this.tasks.length;
    const i = this.tasks.findIndex((t) => t.key === key);
    for (let k = 1; k <= n; k++) {
      const t = this.tasks[(i + k + n) % n]!;
      if (this.isOpen(t.key)) return t.key;
    }
    return null;
  }

  /**
   * Avleder målinger og overhoppede fra loggen og regner ut utkastet.
   * `fresh`: ingen tidligere gyldig tilstand i minnet – faller tilbake til
   * den lengste gyldige begynnelsen av loggen.
   */
  private recompute(fresh = false): void {
    const obs = new Map<string, Observation>();
    const skipped = new Set<string>();
    for (const a of this.log) {
      if (a.t === 'obs') {
        const k = taskKey(a.o);
        obs.delete(k);
        obs.set(k, a.o);
      } else if (a.t === 'skip') skipped.add(a.key);
      else skipped.clear();
    }
    this.observations = [...obs.values()];
    this.done = new Set(obs.keys());
    for (const k of this.done) skipped.delete(k);
    this.skipped = skipped;

    const solved = this.solve(this.observations);
    if (solved.ok) {
      this.draft = solved.doc;
      this.model = solved.model;
      this.error = null;
    } else {
      this.error = solved.message;
      if (fresh) {
        // Siste gyldige: prøv med færre og færre av de nyeste målingene.
        this.draft = this.base;
        this.model = this.baseModel;
        for (let n = this.observations.length - 1; n > 0; n--) {
          const s = this.solve(this.observations.slice(0, n));
          if (s.ok) {
            this.draft = s.doc;
            this.model = s.model;
            break;
          }
        }
      }
    }
    this.tasks = buildTasks(this.model, this.base);
  }

  private solve(
    obs: readonly Observation[],
  ): { ok: true; doc: ApartmentDoc; model: ApartmentModel } | { ok: false; message: string } {
    if (!obs.length) return { ok: true, doc: this.base, model: this.baseModel };
    try {
      const doc = applyMeasurements(this.base, obs);
      const r = validateApartment(doc);
      if (r.ok && r.model) return { ok: true, doc, model: r.model };
      return { ok: false, message: r.errors[0]?.message ?? 'Modellen ble ugyldig.' };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  private read(key: string): Saved | null {
    try {
      const text = this.storage?.getItem(key);
      if (!text) return null;
      const s = JSON.parse(text) as Saved;
      return s && s.version === 1 && Array.isArray(s.log) ? s : null;
    } catch {
      return null;
    }
  }

  private restore(): void {
    const saved = this.read(this.key);
    if (!saved) return;
    if (saved.baseHash === this.baseHash) {
      this.log = saved.log;
      this.cursor = saved.cursor;
      this.exportedHash = saved.exportedHash;
      return;
    }
    try {
      this.storage?.removeItem(this.key);
      if (saved.exportedHash === this.baseHash) {
        // Fila er byttet ut med den eksporterte: målingene er med.
        this.published = true;
        return;
      }
      this.storage?.setItem(this.staleKey, JSON.stringify(saved));
    } catch {
      /* lagring utilgjengelig */
    }
    const count = saved.log.filter((a) => a.t === 'obs').length;
    if (count) this.stale = { count, updatedAt: saved.updatedAt };
  }

  private save(): void {
    if (!this.storage) return;
    try {
      if (!this.log.length && !this.exportedHash) {
        this.storage.removeItem(this.key);
        return;
      }
      const s: Saved = {
        version: 1,
        baseHash: this.baseHash,
        log: this.log,
        cursor: this.cursor,
        exportedHash: this.exportedHash,
        updatedAt: new Date().toISOString(),
      };
      this.storage.setItem(this.key, JSON.stringify(s));
    } catch {
      /* full eller utilgjengelig lagring: målingene finnes fortsatt i minnet */
    }
  }

  private changed(): void {
    this.save();
    this.notify();
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}
