/**
 * Fargeforklaringen på siden (laptop og Quest-nettleseren): gruppene fra
 * `legendFor`, med en fargeprøve i riktig form (fylt, strek, stiplet,
 * omriss, prikk) foran hver linje.
 */
import { h } from './dom';
import type { LegendGroup } from './legend';

export function legendView(groups: readonly LegendGroup[], testId = 'legend'): HTMLElement {
  const root = h('div', { class: 'legend-view', 'data-testid': testId });
  if (!groups.length) {
    root.append(h('p', { class: 'hint' }, 'Ingen farger å forklare her nå. Slå på «Marker umålte mål», eller vis el og vann.'));
    return root;
  }
  for (const g of groups) {
    const list = h('ul', {});
    for (const e of g.entries) {
      const sw = h('span', { class: `swatch ${e.shape}`, 'aria-hidden': 'true' });
      sw.style.setProperty('--c', e.color);
      list.append(h('li', {}, sw, e.label));
    }
    root.append(h('section', { 'data-group': g.id }, h('h3', {}, g.title), list));
  }
  return root;
}
