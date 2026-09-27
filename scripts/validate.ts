/**
 * Validerer apartment.json fra kommandolinja: `npm run validate`.
 * Samme validering som appen kjører ved innlasting.
 */
import { readFileSync } from 'node:fs';
import { validateApartment, summarize } from '../src/schema/validate';

const file = process.argv[2] ?? 'public/apartment.json';
let raw: unknown;
try {
  raw = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`✗ Klarte ikke å lese ${file} som JSON: ${(e as Error).message}`);
  process.exit(1);
}
const result = validateApartment(raw);
for (const w of result.warnings) console.warn(`⚠ ${w.message}  [${w.path}]`);
if (!result.ok) {
  for (const e of result.errors) console.error(`✗ ${e.message}  [${e.path}]`);
  console.error(`\n${file}: ${result.errors.length} feil.`);
  process.exit(1);
}
console.log(`✓ ${file} er gyldig: ${summarize(result.model!)}.`);
