/**
 * Framdriften i opplæringen: hvilket spor og steg man er på. Appen melder
 * hendelser (`event`), og steget som venter på hendelsen blir fullført – et
 * kort øyeblikk med ✓ før neste steg vises. Fullførte spor huskes i
 * nettleseren, så startmenyen kan vise at de er gjort.
 */
import { Observable } from '../state/Observable';
import { PersistedSettings, type KV } from '../state/persist';
import { stepsFor, type TutorialEvent, type TutorialStep, type TutorialTrack } from './steps';

export const TUTORIAL_KEY = 'leilighet:opplaering:v1';

export interface TutorialState {
  track: TutorialTrack;
  index: number;
  /** Steget er nettopp fullført (vises med ✓ før neste). */
  done: boolean;
}

const isDone = (v: unknown): v is boolean => typeof v === 'boolean';

export class Tutorial {
  /** null = ingen opplæring pågår. */
  readonly state = new Observable<TutorialState | null>(null);
  private readonly saved: PersistedSettings;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Hendelsen for neste steg, hvis den kom mens ✓ ble vist. */
  private early: TutorialEvent | null = null;

  /** `pause`: hvor lenge ✓ vises før neste steg (ms); 0 = straks. */
  constructor(
    storage: KV | null,
    private readonly pause = 700,
  ) {
    this.saved = new PersistedSettings(storage, TUTORIAL_KEY);
  }

  get active(): boolean {
    return this.state.value !== null;
  }

  get track(): TutorialTrack | null {
    return this.state.value?.track ?? null;
  }

  get step(): TutorialStep | null {
    const s = this.state.value;
    return s ? (stepsFor(s.track)[s.index] ?? null) : null;
  }

  /** «Steg 2 av 6». */
  get position(): { index: number; count: number } | null {
    const s = this.state.value;
    return s ? { index: s.index, count: stepsFor(s.track).length } : null;
  }

  /** Sporet er gjort ferdig før (i denne nettleseren). */
  completed(track: TutorialTrack): boolean {
    return this.saved.get(track, isDone) === true;
  }

  start(track: TutorialTrack): void {
    this.clearTimer();
    this.early = null;
    this.state.set({ track, index: 0, done: false });
  }

  /** Appen melder at brukeren gjorde noe; fullfører steget som venter på det. */
  event(e: TutorialEvent): void {
    const s = this.state.value;
    if (!s) return;
    // Mens ✓ vises: det neste steget kan allerede være gjort (f.eks. menyen lukket med en gang).
    if (s.done) {
      if (stepsFor(s.track)[s.index + 1]?.until === e) this.early = e;
      return;
    }
    if (this.step?.until !== e) return;
    this.complete(s);
  }

  /** «Neste» (eller «Hopp over»): går videre uten å vente. */
  next(): void {
    const s = this.state.value;
    if (!s) return;
    this.clearTimer();
    this.advance(s);
  }

  /** Avslutter uten å fullføre. */
  stop(): void {
    this.clearTimer();
    this.early = null;
    this.state.set(null);
  }

  private complete(s: TutorialState): void {
    if (this.pause <= 0) {
      this.advance(s);
      return;
    }
    this.state.set({ ...s, done: true });
    this.timer = setTimeout(() => {
      this.timer = null;
      const now = this.state.value;
      if (now && now.track === s.track && now.index === s.index) this.advance(now);
    }, this.pause);
  }

  private advance(s: TutorialState): void {
    if (s.index + 1 >= stepsFor(s.track).length) {
      this.saved.set(s.track, true);
      this.state.set(null);
      return;
    }
    this.state.set({ track: s.track, index: s.index + 1, done: false });
    const early = this.early;
    this.early = null;
    if (early) this.event(early);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
