/**
 * Designet («Skifer»): ett sted for farger, skrift, avrunding og luft, brukt
 * av laptop-siden (CSS-variabler), VR-panelene (tegnet på lerret) og fargene
 * i 3D som betyr noe (målestatus, el og vann, teleport).
 *
 * - Mørkt tema overalt: rolig i VR (også om kvelden og natta), og modellen
 *   er det lyseste i bildet. Ingen helt hvit eller helt svart flate.
 * - Én betydning per farge: aksent (lyseblå) = valgt; grønn = målt / OK;
 *   oransje = ikke målt; rød = feil / kan ikke. Planlagt el og vann har samme
 *   farge som eksisterende, men stiplet.
 * - Tekst minst 4,5:1 mot bakgrunnen, andre flater minst 3:1 (testet).
 *
 * Ingen three.js her, så modulen kan brukes overalt (også i tester).
 */

export const COLOR = {
  /* Flater */
  bg: '#121417',
  surface: '#1b1e22',
  surface2: '#262a2f',
  surface3: '#31363c',
  line: '#454b52',
  /* Tekst */
  text: '#ece8e1',
  text2: '#b4afa6',
  text3: '#8d8980',
  /* Aksent: valgt, hovedknapp, lenker */
  accent: '#8cc8dc',
  onAccent: '#0d1b21',
  /** Aksent på lys bakgrunn (2D-planen). */
  accentInk: '#2b6f86',
  /* Status */
  success: '#6fd39a',
  warning: '#f0b54e',
  danger: '#f08a7e',
  dangerFill: '#a63d34',
  /* Målestatus (3D, oppmåling og fargeforklaringen) */
  placeholder: '#ff7b00',
  partial: '#ffd400',
  measured: '#1fbf5f',
  /* Peker og mål i VR */
  target: '#18d4ff',
  teleportOk: '#39d98a',
  teleportBad: '#ff5a5a',
  draw: '#ffe14d',
  /* Vann og avløp */
  cold: '#2f7de1',
  hot: '#e0452f',
  drain: '#6f747a',
  /* El uten kurs */
  elExisting: '#33373c',
  elPlanned: '#e8a33a',
  /* Åpninger (byggeren og oppmålingen) */
  door: '#b07a4f',
  window: '#7fb8e0',
  passage: '#9aa3aa',
} as const;

export type ColorToken = keyof typeof COLOR;

/** Oppmåling i gjennomsyn: lysere varianter som synes over det ekte rommet. */
export const MEASURE_AR = {
  todo: '#ff9f1a',
  done: '#2fe07a',
  opening: '#ffd400',
  fixture: '#ff6bd6',
} as const;

/** Festefargene mens man tegner el og vann (markøren). */
export const SNAP: Record<string, string> = {
  punkt: '#ff6bd6',
  hjørne: '#ffd400',
  vegg: '#39d98a',
  '90°': '#18d4ff',
  rutenett: '#ffffff',
  fri: '#ff9f1a',
};

/** Farger til nye kurser (godt unna varmt- og kaldtvann). */
export const CIRCUIT_COLORS: readonly string[] = ['#e8a33a', '#9b7be0', '#d0539b', '#2a9d8f', '#a3a83a', '#a8693a', '#e58fb5'];

export const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** Skriftstørrelser på siden (px). */
export const TYPE = { small: 14, body: 16, title: 18, heading: 22, display: 32, hero: 40 } as const;
/** Avrunding (px). */
export const RADIUS = { s: 4, m: 8, l: 12, xl: 16, pill: 999 } as const;
/** Luft (px). */
export const SPACE = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48 } as const;

/** CSS-variablene (--navn: verdi) for siden. */
export function cssVars(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(COLOR)) out[`--${kebab(k)}`] = v;
  for (const [k, v] of Object.entries(TYPE)) out[`--fs-${k}`] = `${v}px`;
  for (const [k, v] of Object.entries(RADIUS)) out[`--r-${k}`] = `${v}px`;
  for (const [k, v] of Object.entries(SPACE)) out[`--s-${k}`] = `${v}px`;
  out['--font'] = FONT;
  return out;
}

/** Setter variablene på et element (helst <html>, før appen tegnes). */
export function applyCssVars(el: HTMLElement): void {
  for (const [k, v] of Object.entries(cssVars())) el.style.setProperty(k, v);
}

const kebab = (s: string): string => s.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();

/** «#rrggbb» med alfa, som CSS/canvas-farge. */
export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Relativ luminans (WCAG) for en «#rrggbb»-farge. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

/** Fargeforskjell (CIE76, ΔE i Lab) mellom to «#rrggbb»-farger: under ~20 er lett å blande. */
export function deltaE(a: string, b: string): number {
  const lab = (hex: string): [number, number, number] => {
    const n = parseInt(hex.slice(1), 16);
    const lin = (c: number): number => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const [r, g, bl] = [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
    const x = (0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    const z = (0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883;
    const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** Kontrast (WCAG) mellom to farger, 1–21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
