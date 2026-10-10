import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ApartmentDoc } from '../../src/schema/types';
import { validateApartment } from '../../src/schema/validate';
import type { ApartmentModel } from '../../src/model/ApartmentModel';

export const APARTMENT_PATH = resolve(__dirname, '../../public/apartment.json');

/** Ny, fersk kopi av plassholder-leiligheten. */
export function loadDoc(): ApartmentDoc {
  return JSON.parse(readFileSync(APARTMENT_PATH, 'utf8')) as ApartmentDoc;
}

export function modelOf(doc: ApartmentDoc = loadDoc()): ApartmentModel {
  const r = validateApartment(doc);
  if (!r.ok || !r.model) throw new Error(r.errors.map((e) => e.message).join('\n'));
  return r.model;
}

export function errorsOf(mutate: (doc: Record<string, any>) => void): string[] {
  const doc = loadDoc() as unknown as Record<string, any>;
  mutate(doc);
  return validateApartment(doc).errors.map((e) => e.message);
}
