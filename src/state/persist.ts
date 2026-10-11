/**
 * Lagrer valgte innstillinger (Observable-verdier) i localStorage, så de
 * overlever omlasting. Ukjente eller ødelagte verdier ignoreres (standard
 * brukes), og utilgjengelig lagring gjør bare at ingenting huskes.
 */
import type { Observable } from './Observable';

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class PersistedSettings {
  private values: Record<string, unknown> = {};

  constructor(
    private readonly storage: KV | null,
    private readonly key: string,
  ) {
    try {
      const text = storage?.getItem(key);
      const parsed: unknown = text ? JSON.parse(text) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) this.values = parsed as Record<string, unknown>;
    } catch {
      this.values = {};
    }
  }

  /** Henter lagret verdi (hvis gyldig) inn i `obs`, og lagrer hver endring. */
  bind<T>(name: string, obs: Observable<T>, isValid: (v: unknown) => v is T): void {
    const saved = this.values[name];
    if (saved !== undefined && isValid(saved)) obs.set(saved);
    obs.subscribe((v) => {
      this.values[name] = v;
      this.save();
    });
  }

  /** Glemmer alle lagrede valg (standardverdiene brukes ved neste lasting). */
  clear(): void {
    this.values = {};
    try {
      this.storage?.removeItem(this.key);
    } catch {
      /* lagring utilgjengelig */
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.values));
    } catch {
      /* full eller utilgjengelig lagring */
    }
  }
}

/** Typevakter for vanlige innstillinger. */
export const oneOf =
  <T extends string | number>(options: readonly T[]) =>
  (v: unknown): v is T =>
    options.includes(v as T);
export const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
export const inRange =
  (min: number, max: number) =>
  (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** localStorage hvis det er tilgjengelig (ikke i privat modus o.l.). */
export function localStore(): KV | null {
  try {
    const k = '__leilighet_test__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    return null;
  }
}
