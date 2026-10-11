/**
 * ApartmentStore: eier rådataene (apartment.json) og den validerte modellen.
 *
 * Fase 1 laster bare. Fase 2 (oppmåling) viser et utkast med `setDoc()`,
 * mens `fileDoc` beholder fila slik den ble lastet. Fase 3 (VR-redigering)
 * bruker `update()`: endringen
 * gjøres på rådataene, valideres på nytt, og lytterne bygger scenen på nytt.
 * Rådataene beholdes uendret i form (inkl. { value, measured }) så de kan
 * lagres tilbake som JSON.
 */
import type { ApartmentDoc } from '../schema/types';
import type { ApartmentModel } from './ApartmentModel';
import { validateApartment, type Issue, type ValidationResult } from '../schema/validate';

export type LoadResult =
  | { ok: true; model: ApartmentModel; warnings: Issue[] }
  | { ok: false; errors: Issue[]; warnings: Issue[] };

export class ApartmentStore {
  doc: ApartmentDoc | null = null;
  /** Fila slik den ble lastet (grunnlaget for oppmålingen). */
  fileDoc: ApartmentDoc | null = null;
  model: ApartmentModel | null = null;
  warnings: Issue[] = [];
  private listeners = new Set<(model: ApartmentModel) => void>();

  constructor(readonly url: string) {}

  async load(): Promise<LoadResult> {
    let text: string;
    try {
      const res = await fetch(this.url, { cache: 'no-store' });
      if (!res.ok) return this.fail(`Klarte ikke å hente apartment.json (HTTP ${res.status}).`);
      text = await res.text();
    } catch (e) {
      return this.fail(`Klarte ikke å hente apartment.json: ${(e as Error).message}`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      return this.fail(`apartment.json er ikke gyldig JSON: ${(e as Error).message}`);
    }
    const result = this.apply(validateApartment(raw));
    if (result.ok) this.fileDoc = this.doc;
    return result;
  }

  /** Viser et annet dokument (f.eks. utkastet fra oppmålingen) uten å endre `fileDoc`. */
  setDoc(doc: ApartmentDoc): LoadResult {
    return this.apply(validateApartment(doc));
  }

  /** Endrer rådataene (fase 3). Endringen forkastes hvis den gir valideringsfeil. */
  update(mutate: (doc: ApartmentDoc) => void): LoadResult {
    if (!this.doc) return this.fail('Ingen leilighet er lastet.');
    const draft = structuredClone(this.doc);
    mutate(draft);
    const result = validateApartment(draft);
    if (!result.ok) return { ok: false, errors: result.errors, warnings: result.warnings };
    return this.apply(result);
  }

  toJSON(): string {
    return JSON.stringify(this.doc, null, 2);
  }

  subscribe(listener: (model: ApartmentModel) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private apply(result: ValidationResult): LoadResult {
    if (!result.ok || !result.model || !result.doc) {
      return { ok: false, errors: result.errors, warnings: result.warnings };
    }
    this.doc = result.doc;
    this.model = result.model;
    this.warnings = result.warnings;
    for (const l of this.listeners) l(result.model);
    return { ok: true, model: result.model, warnings: result.warnings };
  }

  private fail(message: string): LoadResult {
    return { ok: false, errors: [{ severity: 'error', path: '', message }], warnings: [] };
  }
}
