import {
  COLLECTIONS,
  type Apartment,
  type ApartmentDoc,
  type MeasureState,
  type MeasuredValue,
  type Num,
} from './types';

export function isMeasuredValue(v: unknown): v is MeasuredValue {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  return (
    typeof (v as { value?: unknown }).value === 'number' &&
    keys.every((k) => k === 'value' || k === 'measured' || k === 'note')
  );
}

/** Tallverdien i et Num. */
export const numValue = (n: Num): number => (typeof n === 'number' ? n : n.value);

/** Objektets eget «measured»-flagg, ellers det arvede. */
export const measuredFlag = (obj: unknown, inherited = false): boolean => {
  const m = typeof obj === 'object' && obj !== null ? (obj as { measured?: unknown }).measured : undefined;
  return typeof m === 'boolean' ? m : inherited;
};

/** Er tallet målt? Et rent tall arver flagget fra objektet det står i. */
export const isMeasured = (n: unknown, inherited = false): boolean =>
  typeof n === 'number' ? inherited : isMeasuredValue(n) ? (n.measured ?? inherited) : false;

interface Tally {
  measured: number;
  total: number;
}

/**
 * Går gjennom en verdi og erstatter alle `{ value, measured }` med rene tall.
 * Teller samtidig hvor mange tall som er målt. Et objekts `measured` gjelder
 * som standard for tallene under det (nærmeste objekt vinner).
 */
function strip(v: unknown, inherited: boolean, tally: Tally): unknown {
  if (typeof v === 'number') {
    tally.total++;
    if (inherited) tally.measured++;
    return v;
  }
  if (isMeasuredValue(v)) {
    tally.total++;
    if (v.measured ?? inherited) tally.measured++;
    return v.value;
  }
  if (Array.isArray(v)) return v.map((x) => strip(x, inherited, tally));
  if (typeof v === 'object' && v !== null) {
    const obj = v as Record<string, unknown>;
    const here = typeof obj.measured === 'boolean' ? obj.measured : inherited;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(obj)) out[k] = strip(val, here, tally);
    return out;
  }
  return v;
}

function stateOf(t: Tally, ownFlag: boolean): MeasureState {
  if (t.total === 0) return ownFlag ? 'measured' : 'placeholder';
  if (t.measured === t.total) return 'measured';
  return t.measured === 0 ? 'placeholder' : 'partial';
}

export interface Normalized {
  apartment: Apartment;
  /** Målestatus per objekt-id. */
  measure: Map<string, MeasureState>;
}

/** Lager normalisert modell (rene tall) + målestatus. Forutsetter validert dokument. */
export function normalize(doc: ApartmentDoc): Normalized {
  const measure = new Map<string, MeasureState>();
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if ((COLLECTIONS as readonly string[]).includes(key) && Array.isArray(value)) {
      out[key] = value.map((obj) => {
        const tally: Tally = { measured: 0, total: 0 };
        const stripped = strip(obj, false, tally);
        const { id, measured } = obj as { id?: unknown; measured?: unknown };
        if (typeof id === 'string') measure.set(id, stateOf(tally, measured === true));
        return stripped;
      });
    } else {
      out[key] = strip(value, false, { measured: 0, total: 0 });
    }
  }
  return { apartment: out as unknown as Apartment, measure };
}
