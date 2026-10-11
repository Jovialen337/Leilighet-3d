/**
 * Skjemakontroller som er bundet begge veier til en Observable: endres
 * verdien et annet sted (VR-menyen, tastatur, «Tilbakestill»), oppdateres
 * kontrollen også.
 */
import type { Observable } from '../state/Observable';
import { h } from './dom';

export function boundCheckbox(label: string, obs: Observable<boolean>, testId: string): HTMLLabelElement {
  const input = h('input', { type: 'checkbox', 'data-testid': testId });
  input.addEventListener('change', () => obs.set(input.checked));
  obs.subscribe((v) => (input.checked = v), true);
  return h('label', { class: 'check' }, input, label);
}

export function boundSelect<T extends string | number>(
  label: string,
  obs: Observable<T>,
  options: readonly { value: T; label: string }[],
  testId: string,
): HTMLLabelElement {
  const select = h('select', { 'data-testid': testId });
  for (const [i, o] of options.entries()) select.append(h('option', { value: String(i) }, o.label));
  select.addEventListener('change', () => {
    const o = options[Number(select.value)];
    if (o) obs.set(o.value);
  });
  obs.subscribe((v) => {
    const i = options.findIndex((o) => o.value === v);
    if (i >= 0) select.value = String(i);
  }, true);
  return h('label', { class: 'field' }, h('span', {}, label), select);
}

/** Glidebryter (mm-verdier) med norsk visning i meter. null = standardverdien `fallback`. */
export function boundRange(
  label: string,
  obs: Observable<number | null>,
  opts: { min: number; max: number; step: number; fallback: () => number },
  testId: string,
): HTMLLabelElement {
  const input = h('input', {
    type: 'range',
    min: String(opts.min),
    max: String(opts.max),
    step: String(opts.step),
    'data-testid': testId,
  });
  const out = h('output', {});
  const show = (mm: number): void => {
    const text = `${(mm / 1000).toFixed(2).replace('.', ',')} m`;
    out.textContent = text;
    input.setAttribute('aria-valuetext', text);
  };
  input.addEventListener('input', () => {
    const v = Number(input.value);
    obs.set(v);
    show(v);
  });
  const sync = (): void => {
    const v = obs.value ?? opts.fallback();
    input.value = String(v);
    show(v);
  };
  obs.subscribe(sync, true);
  return h('label', { class: 'field range' }, h('span', {}, label), input, out);
}
