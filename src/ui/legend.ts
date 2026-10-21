/**
 * «Fargeforklaring»: hva fargene betyr, som rene data, så laptopen, Quest-
 * siden og VR-menyen viser det samme. Bare det som er i bruk nå vises (med
 * `all` vises alt, f.eks. i opplæringen).
 *
 * Regelen i appen: fargen viser hva det er, formen om det er planlagt
 * (stiplet strek, bare omriss) eller finnes (hel strek, fylt).
 */
import { COLOR, MEASURE_AR, SNAP, contrast } from './tokens';

/**
 * Bakgrunnen en fargeprøve trenger: en mørk farge (f.eks. kabel uten kurs)
 * synes ikke på den mørke flaten og tegnes på en lys brikke. null = ingen.
 */
export function swatchBackdrop(color: string): string | null {
  return contrast(color, COLOR.surface) < 3 ? COLOR.text2 : null;
}

/** Formen på fargeprøven: fylt, strek, stiplet strek, omriss eller prikk. */
export type SwatchShape = 'fill' | 'line' | 'dash' | 'outline' | 'dot';

export interface LegendEntry {
  color: string;
  shape: SwatchShape;
  label: string;
}

export interface LegendGroup {
  id: 'oppmalt' | 'el' | 'vann' | 'vr' | 'tegning' | 'oppmaling';
  title: string;
  entries: LegendEntry[];
}

export interface LegendContext {
  /** «Marker umålte mål» er på. */
  highlight: boolean;
  /** El-lagene og vann-lagene synes. */
  el: boolean;
  water: boolean;
  /** Kursene i fila (navn og farge). */
  circuits: readonly { name: string; color?: string }[];
  /** Hvor forklaringen vises. */
  mode: 'laptop' | 'vr' | 'measure' | 'draw';
  /** Vis alle gruppene (opplæringen og startmenyen). */
  all?: boolean;
}

export function legendFor(c: LegendContext): LegendGroup[] {
  const out: LegendGroup[] = [];
  const all = c.all === true;
  if (all || c.highlight)
    out.push({
      id: 'oppmalt',
      title: 'Oppmålt?',
      entries: [
        { color: COLOR.placeholder, shape: 'fill', label: 'Oransje: plassholder – ikke målt ennå' },
        { color: COLOR.partial, shape: 'fill', label: 'Gul: delvis målt' },
        { color: COLOR.measured, shape: 'fill', label: 'Grønn: målt' },
      ],
    });
  if (all || c.el)
    out.push({
      id: 'el',
      title: 'El',
      entries: [
        ...c.circuits.filter((k) => k.color).map((k) => ({ color: k.color!, shape: 'line' as const, label: /^kurs\b/i.test(k.name) ? k.name : `Kurs: ${k.name}` })),
        { color: COLOR.elExisting, shape: 'line', label: 'Kabel uten kurs – finnes' },
        { color: COLOR.elPlanned, shape: 'dash', label: 'Stiplet: planlagt kabel' },
        { color: COLOR.elPlanned, shape: 'outline', label: 'Bare omriss: planlagt punkt' },
      ],
    });
  if (all || c.water)
    out.push({
      id: 'vann',
      title: 'Vann og avløp',
      entries: [
        { color: COLOR.cold, shape: 'line', label: 'Kaldtvann' },
        { color: COLOR.hot, shape: 'line', label: 'Varmtvann' },
        { color: COLOR.drain, shape: 'line', label: 'Avløp' },
        { color: COLOR.cold, shape: 'dash', label: 'Stiplet: planlagt rør' },
      ],
    });
  if (all || c.mode === 'vr' || c.mode === 'measure')
    out.push({
      id: 'vr',
      title: 'I VR',
      entries: [
        { color: COLOR.teleportOk, shape: 'line', label: 'Grønn bue: du kan lande der' },
        { color: COLOR.teleportBad, shape: 'line', label: 'Rød bue: du kan ikke lande der' },
        { color: COLOR.target, shape: 'dot', label: 'Blå prikk: det du peker på' },
        { color: COLOR.accent, shape: 'fill', label: 'Lyseblå knapp: valgt' },
      ],
    });
  if (all || c.mode === 'draw')
    out.push({
      id: 'tegning',
      title: 'Når du tegner el og vann',
      entries: [
        { color: SNAP.punkt!, shape: 'dot', label: 'Rosa: fester til et punkt' },
        { color: SNAP['hjørne']!, shape: 'dot', label: 'Gul: fester til et hjørne' },
        { color: SNAP.vegg!, shape: 'dot', label: 'Grønn: fester til veggen' },
        { color: SNAP['90°']!, shape: 'dot', label: 'Blå: rett vinkel' },
        { color: SNAP.rutenett!, shape: 'dot', label: 'Hvit: rutenett' },
        { color: SNAP.fri!, shape: 'dot', label: 'Oransje: fri plassering (Ctrl)' },
      ],
    });
  if (all || c.mode === 'measure')
    out.push({
      id: 'oppmaling',
      title: 'Oppmåling med Quest 3',
      entries: [
        { color: MEASURE_AR.todo, shape: 'line', label: 'Oransje stolpe: hjørne som ikke er målt' },
        { color: MEASURE_AR.done, shape: 'line', label: 'Grønn: målt' },
        { color: COLOR.target, shape: 'dot', label: 'Blå: neste punkt du skal måle' },
        { color: MEASURE_AR.opening, shape: 'line', label: 'Gul: dør og vindu' },
        { color: MEASURE_AR.fixture, shape: 'line', label: 'Rosa: installasjon' },
      ],
    });
  return out;
}
