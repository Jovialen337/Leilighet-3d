/**
 * Byggerens arbeidsøkt: tegningen, angre/gjør om, og lagring i nettleseren.
 *
 * - Hver endring lagres med en gang (ødelagt eller full lagring gjør bare at
 *   den ikke huskes – tegningen er fortsatt i minnet).
 * - Et drag (flytte hjørne/kant/rom) er ett angre-steg.
 * - Når den eksporterte fila er publisert (apartment.json er lik det som ble
 *   lastet ned), er arbeidet ferdig og tegningen ryddes bort.
 * - En lagret tegning som ikke kan leses, legges til side (ikke slettet), og
 *   den forrige tegningen huskes når en ny startes eller den forkastes.
 * - Kompilering kaster aldri: en feil blir en melding i sjekklisten.
 */
import { formatJson } from '../schema/format';
import type { ApartmentDoc } from '../schema/types';
import type { KV } from '../state/persist';
import { hashDoc, hashText } from '../measure/MeasureSession';
import { compileChecked, type CompileOptions, type CompileResult } from './compile';
import { DEFAULT_BUILDER_SETTINGS, type BuilderDoc } from './types';
import { builderDocProblem } from './validateDoc';

export const BUILDER_KEY = 'leilighet:ny-modell:v1';
const MAX_UNDO = 100;

/**
 * Lokale endringer på den gamle modellen (tegnet el og vann, målinger) som
 * ble tatt med da tegningen startet fra den. Er eksporten publisert, er de
 * med i fila og skal ikke legges på en gang til.
 */
export interface Consumed {
  /** Fingeravtrykk av hver tegnede endring (planlagt el og vann) som kom med. */
  plan: string[];
  /** Fingeravtrykk av målingsloggen som kom med, eller null. */
  measure: string | null;
}

interface Saved {
  version: 1;
  doc: BuilderDoc;
  exportedHash?: string;
  /** Fingeravtrykk av tegningen da fila ble eksportert. */
  exportedDraft?: string;
  consumed?: Consumed;
}

const isConsumed = (v: unknown): v is Consumed => {
  const c = v as Partial<Consumed> | null;
  return !!c && Array.isArray(c.plan) && c.plan.every((x) => typeof x === 'string') && (c.measure === null || typeof c.measure === 'string');
};

const hashDraft = (doc: BuilderDoc): string => hashText(JSON.stringify(doc));

const today = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Er dette en gyldig tegning (lagret eller åpnet fra fil)? Se validateDoc.ts. */
export function isBuilderDoc(v: unknown): v is BuilderDoc {
  return builderDocProblem(v) === null;
}

const withDefaults = (doc: BuilderDoc): BuilderDoc => ({ ...doc, settings: { ...DEFAULT_BUILDER_SETTINGS, ...doc.settings } });

/** Kompilerer uten å kaste: en uventet feil blir en melding i sjekklisten. */
function safeCompile(doc: BuilderDoc, opts: CompileOptions): CompileResult {
  try {
    return compileChecked(doc, opts);
  } catch (e) {
    return {
      doc: null,
      issues: [{ severity: 'error', message: `Tegningen kunne ikke gjøres om til en modell: ${(e as Error).message}` }],
      walls: { walls: [], open: [], notes: [], skewed: [] },
      transform: null,
      doorInto: new Map(),
    };
  }
}

export class BuilderSession {
  /** Tegningen (null = ingen ny modell under arbeid). */
  doc: BuilderDoc | null = null;
  /** Den eksporterte fila er publisert: 'done' = tegningen er ryddet bort, 'kept' = endret etterpå og beholdt. */
  published: 'done' | 'kept' | null = null;
  /** En lagret tegning kunne ikke leses og er lagt til side (melding), eller null. */
  recovered: string | null = null;
  /** Det tegningen tok med fra den gamle modellen (se Consumed). */
  consumed: Consumed | null = null;
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
    let text: string | null = null;
    try {
      text = storage?.getItem(key) ?? null;
    } catch {
      text = null;
    }
    if (!text) return;
    let problem: string | null = null;
    try {
      const saved = JSON.parse(text) as Partial<Saved>;
      problem = saved?.version === 1 ? builderDocProblem(saved.doc) : 'Ukjent lagringsformat.';
      if (!problem) {
        this.doc = withDefaults(saved.doc!);
        this.exportedHash = typeof saved.exportedHash === 'string' ? saved.exportedHash : undefined;
        this.exportedDraft = typeof saved.exportedDraft === 'string' ? saved.exportedDraft : undefined;
        this.consumed = isConsumed(saved.consumed) ? saved.consumed : null;
      }
    } catch {
      problem = 'Lagringen er ikke gyldig JSON.';
    }
    if (problem) {
      // Legg den til side (ikke slett den), så appen starter som normalt.
      this.doc = null;
      this.recovered = problem;
      try {
        storage?.setItem(`${key}:ødelagt`, text);
        storage?.removeItem(key);
      } catch {
        /* lagring utilgjengelig */
      }
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

  /**
   * Starter en ny tegning. Den gamle kan angres tilbake, og huskes som
   * «forrige tegning» også etter omlasting. `consumed`: det den nye tegningen
   * tok med fra den gamle modellen.
   */
  start(doc: BuilderDoc, consumed: Consumed | null = null): void {
    if (this.doc) {
      this.push(this.doc);
      this.keepPrevious(this.doc);
    }
    this.doc = structuredClone(doc);
    this.future = [];
    this.exportedHash = undefined;
    this.exportedDraft = undefined;
    this.published = null;
    this.consumed = consumed;
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

  /** Forkaster hele tegningen (den huskes som «forrige tegning»). */
  discard(): void {
    if (this.doc) this.keepPrevious(this.doc);
    this.doc = null;
    this.past = [];
    this.future = [];
    this.exportedHash = undefined;
    this.exportedDraft = undefined;
    this.consumed = null;
    this.changed();
  }

  /** Den forrige tegningen (før en ny ble startet eller denne ble forkastet), eller null. */
  previous(): BuilderDoc | null {
    return this.readPrevious()?.doc ?? null;
  }

  /** Henter den forrige tegningen (den som er åpen nå, blir «forrige» i stedet). */
  restorePrevious(): boolean {
    const prev = this.readPrevious();
    if (!prev) return false;
    this.start(prev.doc, prev.consumed);
    return true;
  }

  private readPrevious(): { doc: BuilderDoc; consumed: Consumed | null } | null {
    try {
      const text = this.storage?.getItem(`${this.key}:forrige`);
      const v = text ? (JSON.parse(text) as { doc?: unknown; consumed?: unknown }) : null;
      if (!v || !isBuilderDoc(v.doc)) return null;
      return { doc: withDefaults(v.doc), consumed: isConsumed(v.consumed) ? v.consumed : null };
    } catch {
      return null;
    }
  }

  /** Husker tegningen (og det den tok med fra den gamle modellen) som «forrige tegning». */
  private keepPrevious(doc: BuilderDoc): void {
    if (!doc.rooms.length) return;
    try {
      this.storage?.setItem(`${this.key}:forrige`, JSON.stringify({ doc, ...(this.consumed ? { consumed: this.consumed } : {}) }));
    } catch {
      /* lagring utilgjengelig */
    }
  }

  /**
   * Kompilert og skjemasjekket tegning (mellomlagret per versjon av
   * tegningen). Under et drag brukes siste resultat, så ingenting kompileres
   * for hver bevegelse; det gjøres når draget er ferdig.
   */
  compiled(normalize = false): CompileResult | null {
    if (!this.doc) return null;
    const c = this.cache;
    if (c && c.normalize === normalize && (c.doc === this.doc || this.gesture)) return c.result;
    const result = safeCompile(this.doc, { normalize });
    this.cache = { doc: this.doc, normalize, result };
    return result;
  }

  /** Fila som tekst (origo ved inngangsdøra, dagens dato). Husker fingeravtrykket. */
  exportText(now = new Date()): string | null {
    if (!this.doc) return null;
    const r = safeCompile(this.doc, { normalize: true, date: today(now) });
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
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      return 'Fila kunne ikke leses (ikke gyldig JSON).';
    }
    const doc = v && typeof v === 'object' && 'doc' in v ? (v as { doc: unknown }).doc : v;
    const problem = builderDocProblem(doc);
    if (problem) return `Fila kan ikke åpnes: ${problem}`;
    this.start(withDefaults(doc as BuilderDoc));
    return null;
  }

  /**
   * Kalles når apartment.json er lastet: er det vår eksport som er publisert,
   * er arbeidet ferdig. Det som ble tatt med fra den gamle modellen, kan da
   * hentes med `takeConsumed` (det er nå med i fila).
   */
  checkPublished(file: ApartmentDoc | null): boolean {
    if (!file || !this.doc || !this.exportedHash || hashDoc(file) !== this.exportedHash) return false;
    this.publishedConsumed = this.consumed;
    this.consumed = null;
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

  private publishedConsumed: Consumed | null = null;

  /** Det den publiserte fila tok med fra den gamle modellen (én gang), eller null. */
  takeConsumed(): Consumed | null {
    const c = this.publishedConsumed;
    this.publishedConsumed = null;
    return c;
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
          JSON.stringify({
            version: 1,
            doc: this.doc,
            exportedHash: this.exportedHash,
            exportedDraft: this.exportedDraft,
            ...(this.consumed ? { consumed: this.consumed } : {}),
          } satisfies Saved),
        );
      else this.storage?.removeItem(this.key);
    } catch {
      /* full eller utilgjengelig lagring: tegningen finnes fortsatt i minnet */
    }
  }
}
