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
 * 100 («4,2»), eller er et helt tall fra 1 til 9 («3» = 3 m; ingen vegg er
 * 3 mm). Null hvis ugyldig.
 *
 * Fortegn: «+150» og «-150» legger til / trekker fra den nåværende verdien.
 * I felt for koordinater og nivåer (`signed`), der et negativt tall er en
 * vanlig verdi, er minus en del av tallet («-1100» = −1100); der trekker man
 * fra med «-=150». «+150» og «+=150» legger alltid til (et positivt tall
 * trenger aldri pluss foran).
 * Små tall med fortegn er mm («-5» = −5 mm), så et lite trinn ikke blir meter.
 */
export function parseLength(text: string, signed = false): ParsedLength | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '').replace(/−/g, '-');
  const m = /^([+-]=?)?(\d+(?:[.,]\d+)?|[.,]\d+)(mm|cm|dm|m)?$/.exec(t);
  if (!m) return null;
  const prefix = m[1] ?? '';
  const sign = prefix.startsWith('-') ? -1 : 1;
  const value = Number(m[2]!.replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  let unit = m[3];
  if (!unit) unit = (/[.,]/.test(m[2]!) && value < 100) || (!prefix && value >= 1 && value < 10 && /^\d$/.test(m[2]!)) ? 'm' : 'mm';
  const factor = unit === 'm' ? 1000 : unit === 'dm' ? 100 : unit === 'cm' ? 10 : 1;
  const relative = prefix.endsWith('=') || prefix === '+' || (!signed && prefix === '-');
  return { mm: Math.round(sign * value * factor), relative };
}

/** «3,20 m» for lengder fra 1 m, ellers «850 mm». */
export function formatLength(mm: number): string {
  const a = Math.abs(mm);
  if (a >= 1000) return `${(mm / 1000).toFixed(2).replace('.', ',')} m`;
  return `${Math.round(mm)} mm`;
}

/** «12,4 m²». */
export const formatArea = (mm2: number): string => `${(mm2 / 1e6).toFixed(1).replace('.', ',')} m²`;
