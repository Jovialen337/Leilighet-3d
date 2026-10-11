/**
 * «Lag og filtre» i panelet: forhåndsvalg (Alt / Elplan / Rørplan / Bare bygg),
 * filtre for el og vann (eksisterende/planlagt, kurs, røntgen), og lagene
 * gruppert med en hovedbryter per gruppe og «Bare denne» per lag.
 */
import type { ApartmentModel } from '../model/ApartmentModel';
import { LAYER_GROUPS, LAYER_PRESETS, applyPreset, groupState, layersIn, setAll, setGroup, solo } from '../state/layerGroups';
import type { ViewState } from '../state/ViewState';
import { boundCheckbox } from './controls';
import { h } from './dom';

export class LayerPanel {
  readonly root: HTMLElement;
  private readonly groups: HTMLElement;
  private readonly circuitField: HTMLLabelElement;
  private readonly circuitSelect: HTMLSelectElement;
  private unsub: (() => void)[] = [];

  constructor(private readonly view: ViewState) {
    const presets = h('div', { class: 'row presets', 'data-testid': 'layer-presets' });
    for (const p of LAYER_PRESETS) {
      const b = h('button', { class: 'chip', 'data-testid': `preset-${p.id}` }, p.name);
      b.addEventListener('click', () => applyPreset(view.layers, p.id));
      presets.append(b);
    }
    this.circuitSelect = h('select', { 'data-testid': 'filter-circuit' });
    this.circuitSelect.addEventListener('change', () => view.circuit.set(this.circuitSelect.value || null));
    view.circuit.subscribe((c) => (this.circuitSelect.value = c ?? ''));
    this.circuitField = h('label', { class: 'field' }, h('span', {}, 'Kurs'), this.circuitSelect);

    const all = h('button', { class: 'small', 'data-testid': 'layers-all' }, 'Vis alle');
    all.addEventListener('click', () => setAll(view.layers, true));
    const none = h('button', { class: 'small', 'data-testid': 'layers-none' }, 'Skjul alle');
    none.addEventListener('click', () => setAll(view.layers, false));

    this.groups = h('div', { class: 'layer-groups', 'data-testid': 'layers' });
    this.root = h(
      'div',
      { class: 'group', 'data-testid': 'layer-panel' },
      h('h2', {}, 'Lag og filtre'),
      presets,
      h(
        'div',
        { class: 'filters' },
        boundCheckbox('Vis eksisterende el og vann', view.showExisting, 'filter-existing'),
        boundCheckbox('Vis planlagt el og vann', view.showPlanned, 'filter-planned'),
        boundCheckbox('Røntgen (gjennomsiktige vegger og tak)', view.xray, 'filter-xray'),
        this.circuitField,
      ),
      this.groups,
      h('div', { class: 'row' }, all, none),
    );
  }

  /** Bygger lagslisten for modellen (lag og kurser kommer fra fila). */
  build(model: ApartmentModel): void {
    for (const u of this.unsub) u();
    this.unsub = [];
    const circuits = model.data.circuits ?? [];
    this.circuitSelect.replaceChildren(
      h('option', { value: '' }, 'Alle kurser'),
      ...circuits.map((c) => h('option', { value: c.id }, c.name)),
    );
    this.circuitSelect.value = this.view.circuit.value ?? '';
    if (this.view.circuit.value && !circuits.some((c) => c.id === this.view.circuit.value)) this.view.circuit.set(null);
    this.circuitField.hidden = circuits.length === 0;

    const state = this.view.layers;
    this.groups.replaceChildren();
    for (const g of LAYER_GROUPS) {
      const ids = layersIn(state, g.id);
      if (!ids.length) continue;
      const master = h('input', { type: 'checkbox', 'data-testid': `group-${g.id}` });
      const syncMaster = (): void => {
        const s = groupState(state, g.id);
        master.checked = s === 'on';
        master.indeterminate = s === 'mixed';
      };
      master.addEventListener('change', () => setGroup(state, g.id, master.checked));
      const rows = ids.map((id) => {
        const layer = state.layers.find((l) => l.id === id)!;
        const obs = state.get(id);
        const input = h('input', { type: 'checkbox', 'data-testid': `layer-${id}` });
        input.addEventListener('change', () => obs.set(input.checked));
        this.unsub.push(
          obs.subscribe((v) => {
            input.checked = v;
            syncMaster();
          }, true),
        );
        const only = h('button', { class: 'only', title: 'Vis bare dette laget (og bygget)', 'data-testid': `solo-${id}` }, 'Bare');
        only.addEventListener('click', () => solo(state, id));
        return h('div', { class: 'layer-row' }, h('label', { class: 'check' }, input, layer.name), only);
      });
      syncMaster();
      this.groups.append(
        h(
          'details',
          { class: 'layer-group', open: '' },
          h('summary', {}, h('label', { class: 'check group-check' }, master, g.name)),
          ...rows,
        ),
      );
    }
  }
}
