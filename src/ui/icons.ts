/**
 * Små strekikoner (24 × 24, i tekstfargen) til verktøylinja og kortene.
 * Tegnet som SVG-stier, så de er skarpe på alle skjermer og i Quest-nettleseren.
 */

const PATHS = {
  select: 'M5 3l13 7.5-5.5 1.6-2.4 5.4z',
  rect: 'M4 6h16v12H4z',
  poly: 'M4 4h9v6h7v10H4z',
  beside: 'M3 6h8v12H3z M13 6h8v12h-8z',
  door: 'M5 21V4h10v17 M3 21h18 M12 12.5v.01',
  window: 'M4 5h16v14H4z M12 5v14 M4 12h16',
  passage: 'M5 21V10a7 7 0 0 1 14 0v11 M3 21h4 M17 21h4',
  undo: 'M9 14L4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5 M20 9H10a6 6 0 0 0 0 12h3',
  trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3',
  fit: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
  cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z M12 12l8-4.5 M12 12v9 M12 12L4 7.5',
  plan: 'M4 4h16v16H4z M4 12h9 M13 4v16',
  new: 'M12 5v14 M5 12h14',
  copy: 'M8 8h12v12H8z M4 16V4h12',
  file: 'M6 3h8l4 4v14H6z M14 3v4h4',
  headset: 'M3 9h18v7h-5l-2-3h-4l-2 3H3z',
  history: 'M3 12a9 9 0 1 0 3-6.7 M3 4v5h5 M12 8v4l3 2',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', PATHS[name]);
  svg.append(path);
  return svg;
}
