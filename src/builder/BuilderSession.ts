/**
 * Byggerens arbeidsøkt: tegningen, angre/gjør om, og lagring i nettleseren.
 *
 * - Hver endring lagres med en gang (ødelagt eller full lagring gjør bare at
 *   den ikke huskes – tegningen er fortsatt i minnet).
 * - Et drag (flytte hjørne/kant/rom) er ett angre-steg.
 * - Når den eksporterte fila er publisert (apartment.json er lik det som ble
 *   lastet ned), er arbeidet ferdig og tegningen ryddes bort.
 */
import { formatJson } from '../schema/format';
import type { ApartmentDoc } from '../schema/types';
import type { KV } from '../state/persist';
import { hashDoc, hashText } from '../measure/MeasureSession';
import { compileChecked, type CompileResult } from './compile';
import { BUILDER_VERSION, DEFAULT_BUILDER_SETTINGS, type BuilderDoc } from './types';

export const BUILDER_KEY = 'leilighet:ny-modell:v1';
const MAX_UNDO = 100;

interface Saved {
  version: 1;
  doc: BuilderDoc;
  exportedHash?: string;
  /** Fingeravtrykk av tegningen da fila ble eksportert. */
  exportedDraft?: string;
}

const hashDraft = (doc: BuilderDoc): string => hashText(JSON.stringify(doc));

const today = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Grov sjekk av en lagret eller åpnet tegning (alt annet avvises). */
export function isBuilderDoc(v: unknown): v is BuilderDoc {
  if (!v || typeof v !== 'object') return false;
  const d = v as Partial<BuilderDoc>;
  return (
    d.version === BUILDER_VERSION &&
    typeof d.name === 'string' &&
    Array.isArray(d.rooms) &&
    Array.isArray(d.openings) &&
    d.rooms.every((r) => r && typeof r.id === 'string' && Array.isArray(r.polygon) && r.polygon.every((p) => typeof p?.x === 'number' && typeof p?.z === 'number')) &&
    d.openings.every((o) => o && typeof o.id === 'string' && typeof o.room === 'string' && typeof o.edge === 'number')
  );
}

export class BuilderSession {
  /** Tegningen (null = ingen ny modell under arbeid). */
  doc: BuilderDoc | null = null;
  /** Den eksporterte fila er publisert: 'done' = tegningen er ryddet bort, 'kept' = endret etterpå og beholdt. */
  published: 'done' | 'kept' | null = null;
  private exportedHash: string | undefined;
  private exportedDraft: string | undefined;
  private past: BuilderDoc[] = [];
  private future: BuilderDoc[] = [];
  private gesture = false;
  private readonly listeners = new Set<() => void>();
  private cache: { doc: BuilderDoc; normalize: boolean; result: CompileResult } | null = null;

  constructor(
    private readonly storage: KV | null = null,
    private readonly key = BUILDER_KEY,
  ) {
    try {
      const text = storage?.getItem(key);
      const saved = text ? (JSON.parse(text) as Partial<Saved>) : null;
      if (saved?.version === 1 && isBuilderDoc(saved.doc)) {
        this.doc = { ...saved.doc, settings: { ...DEFAULT_BUILDER_SETTINGS, ...saved.doc.settings } };
        this.exportedHash = saved.exportedHash;
        this.exportedDraft = saved.exportedDraft;
      }
    } catch {
      this.doc = null;
    }
  }

  get active(): boolean {
    return this.doc !== null;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Starter en ny tegning (den gamle kan angres tilbake). */
  start(doc: BuilderDoc): void {
    if (this.doc) this.push(this.doc);
    this.doc = structuredClone(doc);
    this.future = [];
    this.exportedHash = undefined;
    this.exportedDraft = undefined;
    this.published = null;
    this.changed();
  }

  /**
   * Endrer tegningen. `fn` får en kopi; returnerer den `false`, forkastes
   * endringen. I et drag (begin/endGesture) blir hele draget ett angre-steg.
   */
  apply(fn: (doc: BuilderDoc) => void | boolean): boolean {
    if (!this.doc) return false;
    const next = structuredClone(this.doc);
    if (fn(next) === false) return false;
    if (!this.gesture || !this.gestureStarted) {
      this.push(this.doc);
      this.future = [];
      if (this.gesture) this.gestureStarted = true;
    }
    this.doc = next;
    this.changed(!this.gesture);
    return true;
  }

  private gestureStarted = false;

  /** Et drag begynner: alle endringer til `endGesture` blir ett angre-steg. */
  beginGesture(): void {
    this.gesture = true;
    this.gestureStarted = false;
  }

  endGesture(): void {
    if (!this.gesture) return;
    this.gesture = false;
    const moved = this.gestureStarted;
    this.gestureStarted = false;
    // Lagre og si fra én gang når draget er ferdig (da bygges 3D-modellen).
    if (moved) this.changed();
  }

  /** Et drag pågår (3D-modellen bygges først når det er ferdig). */
  get inGesture(): boolean {
    return this.gesture;
  }

  undo(): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    if (this.doc) this.future.push(this.doc);
    this.doc = prev;
    this.changed();
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    if (this.doc) this.past.push(this.doc);
    this.doc = next;
    this.changed();
    return true;
  }

  /** Forkaster hele tegningen. */
  discard(): void {
    this.doc = null;
    this.past = [];
    this.future = [];
    this.exportedHash = undefined;
    this.exportedDraft = undefined;
    this.changed();
  }

  /** Kompilert og skjemasjekket tegning (mellomlagret per versjon av tegningen). */
  compiled(normalize = false): CompileResult | null {
    if (!this.doc) return null;
    const c = this.cache;
    if (c && c.doc === this.doc && c.normalize === normalize) return c.result;
    const result = compileChecked(this.doc, { normalize });
    this.cache = { doc: this.doc, normalize, result };
    return result;
  }

  /** Fila som tekst (origo ved inngangsdøra, dagens dato). Husker fingeravtrykket. */
  exportText(now = new Date()): string | null {
    if (!this.doc) return null;
    const r = compileChecked(this.doc, { normalize: true, date: today(now) });
    if (!r.doc) return null;
    const text = formatJson(r.doc);
    this.exportedHash = hashDoc(JSON.parse(text) as ApartmentDoc);
    this.exportedDraft = hashDraft(this.doc);
    this.save();
    return text;
  }

  /** Tegningen som egen fil (for å flytte arbeidet mellom laptop og Quest). */
  draftText(): string | null {
    return this.doc ? `${JSON.stringify({ version: 1, doc: this.doc }, null, 1)}\n` : null;
  }

  /** Åpner en tegning fra fil. Returnerer en norsk feilmelding, eller null. */
  openDraft(text: string): string | null {
    try {
      const v = JSON.parse(text) as Partial<Saved>;
      const doc = v && typeof v === 'object' && 'doc' in v ? v.doc : v;
      if (!isBuilderDoc(doc)) return 'Fila er ikke en tegning fra «Lag ny modell».';
      this.start({ ...doc, settings: { ...DEFAULT_BUILDER_SETTINGS, ...doc.settings } });
      return null;
    } catch {
      return 'Fila kunne ikke leses (ikke gyldig JSON).';
    }
  }

  /** Kalles når apartment.json er lastet: er det vår eksport som er publisert, er arbeidet ferdig. */
  checkPublished(file: ApartmentDoc | null): boolean {
    if (!file || !this.doc || !this.exportedHash || hashDoc(file) !== this.exportedHash) return false;
    if (this.exportedDraft && hashDraft(this.doc) !== this.exportedDraft) {
      // Tegningen er endret etter eksporten: behold den (bare markeringen ryddes).
      this.exportedHash = undefined;
      this.exportedDraft = undefined;
      this.published = 'kept';
      this.changed();
      return true;
    }
    this.discard();
    this.published = 'done';
    return true;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private push(doc: BuilderDoc): void {
    this.past.push(doc);
    if (this.past.length > MAX_UNDO) this.past.shift();
  }

  private changed(save = true): void {
    if (save) this.save();
    for (const l of this.listeners) l();
  }

  private save(): void {
    try {
      if (this.doc)
        this.storage?.setItem(
          this.key,
          JSON.stringify({ version: 1, doc: this.doc, exportedHash: this.exportedHash, exportedDraft: this.exportedDraft } satisfies Saved),
        );
      else this.storage?.removeItem(this.key);
    } catch {
      /* full eller utilgjengelig lagring: tegningen finnes fortsatt i minnet */
    }
  }
}
