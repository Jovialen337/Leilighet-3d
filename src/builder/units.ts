/**
 * Mål som skrives inn og vises på norsk: «2,3 m», «230 cm», «2300» (mm),
 * «+150» (relativt). Komma og punktum godtas begge som desimaltegn.
 */

export interface ParsedLength {
  /** Verdien i mm. */
  mm: number;
  /** Med fortegn foran (+/−): legges til den nåværende verdien. */
  relative: boolean;
}

/**
 * Leser et mål. Uten enhet: mm – men m når tallet har desimaler og er under
 * 100 («4,2»), eller er et helt tall fra 1 til 9 uten fortegn («3» = 3 m;
 * ingen vegg er 3 mm). Null hvis ugyldig.
 */
export function parseLength(text: string): ParsedLength | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '').replace('−', '-');
  const m = /^([+-]?)(\d+(?:[.,]\d+)?|[.,]\d+)(mm|cm|dm|m)?$/.exec(t);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const value = Number(m[2]!.replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  let unit = m[3];
  if (!unit) unit = (/[.,]/.test(m[2]!) && value < 100) || (!m[1] && value >= 1 && value < 10 && /^\d$/.test(m[2]!)) ? 'm' : 'mm';
  const factor = unit === 'm' ? 1000 : unit === 'dm' ? 100 : unit === 'cm' ? 10 : 1;
  return { mm: Math.round(sign * value * factor), relative: m[1] !== '' };
}

/** «3,20 m» for lengder fra 1 m, ellers «850 mm». */
export function formatLength(mm: number): string {
  const a = Math.abs(mm);
  if (a >= 1000) return `${(mm / 1000).toFixed(2).replace('.', ',')} m`;
  return `${Math.round(mm)} mm`;
}

/** «12,4 m²». */
export const formatArea = (mm2: number): string => `${(mm2 / 1e6).toFixed(1).replace('.', ',')} m²`;
