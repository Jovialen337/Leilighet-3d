/**
 * «Tegn el og vann» i panelet. Verktøy (Velg / Kabel / Rør / Punkt), valg
 * for det som tegnes, store knapper for Ferdig/Angre/Slett (virker også med
 * laserpekeren i Quest-nettleseren, der det ikke er tastatur), og en oversikt
 * med materialliste.
 */
import type { ApartmentModel } from '../model/ApartmentModel';
import {
  DRAW_FIXTURES,
  FIXTURE_TEXT,
  HEIGHT_PRESETS,
  PIPE_KIND_TEXT,
  WIRE_KIND_TEXT,
  metres,
  type DrawOptions,
  type DrawTool,
} from '../plan/draw';
import type { PlanController } from '../plan/PlanController';
import { DISCLAIMER, summarize, summaryText } from '../plan/summary';
import { PIPE_KINDS, WIRE_KINDS } from '../schema/types';
import { h } from './dom';

const TOOLS: readonly { id: DrawTool; label: string; key: string }[] = [
  { id: 'select', label: 'Velg', key: 'S' },
  { id: 'wire', label: 'Kabel', key: 'E' },
  { id: 'pipe', label: 'Rør', key: 'V' },
  { id: 'fixture', label: 'Punkt', key: 'P' },
];

export class PlanBox {
  readonly root: HTMLElement;
  private readonly toolButtons = new Map<DrawTool, HTMLButtonElement>();
  private readonly statusButtons: Record<'planned' | 'existing', HTMLButtonElement>;
  private readonly wireKind: HTMLSelectElement;
  private readonly pipeKind: HTMLSelectElement;
  private readonly fixtureType: HTMLSelectElement;
  private readonly circuit: HTMLSelectElement;
  private readonly height: HTMLSelectElement;
  private readonly rows: Record<'wire' | 'pipe' | 'fixture' | 'circuit' | 'height' | 'status', HTMLElement>;
  private readonly message: HTMLElement;
  private readonly finishBtn: HTMLButtonElement;
  private readonly undoPointBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;
  private readonly deleteBtn: HTMLButtonElement;
  private readonly summary: HTMLElement;
  private readonly copyBtn: HTMLButtonElement;
  private model: ApartmentModel | null = null;

  constructor(private readonly ctrl: PlanController) {
    const tools = h('div', { class: 'segmented tools', 'data-testid': 'plan-tools' });
    for (const t of TOOLS) {
      const b = h('button', { 'data-testid': `tool-${t.id}`, title: `Hurtigtast ${t.key}` }, t.label);
      b.addEventListener('click', () => ctrl.set({ tool: t.id }));
      this.toolButtons.set(t.id, b);
      tools.append(b);
    }
    this.statusButtons = {
      planned: h('button', { 'data-testid': 'plan-status-planned' }, 'Planlagt'),
      existing: h('button', { 'data-testid': 'plan-status-existing' }, 'Eksisterende'),
    };
    this.statusButtons.planned.addEventListener('click', () => ctrl.set({ status: 'planned' }));
    this.statusButtons.existing.addEventListener('click', () => ctrl.set({ status: 'existing' }));

    const select = (testId: string, opts: readonly { value: string; label: string }[], on: (v: string) => void): HTMLSelectElement => {
      const s = h('select', { 'data-testid': testId });
      for (const o of opts) s.append(h('option', { value: o.value }, o.label));
      s.addEventListener('change', () => on(s.value));
      return s;
    };
    this.wireKind = select('plan-wire-kind', WIRE_KINDS.map((k) => ({ value: k, label: WIRE_KIND_TEXT[k] })), (v) =>
      ctrl.set({ wireKind: v as DrawOptions['wireKind'] }),
    );
    this.pipeKind = select('plan-pipe-kind', PIPE_KINDS.map((k) => ({ value: k, label: PIPE_KIND_TEXT[k] })), (v) =>
      ctrl.set({ pipeKind: v as DrawOptions['pipeKind'] }),
    );
    this.fixtureType = select('plan-fixture-type', DRAW_FIXTURES.map((t) => ({ value: t, label: FIXTURE_TEXT[t] ?? t })), (v) =>
      ctrl.set({ fixtureType: v as DrawOptions['fixtureType'] }),
    );
    this.circuit = select('plan-circuit', [], (v) => {
      if (v === '__ny') {
        this.circuit.value = ctrl.options.value.circuit ?? '';
        const name = prompt('Navn på ny kurs (f.eks. «Kurs 3 – kjøkken»):');
        if (!name) return;
        const fuse = Number(prompt('Sikring i ampere (f.eks. 16), eller tomt:') ?? '');
        ctrl.addCircuit(name, Number.isFinite(fuse) && fuse > 0 ? fuse : undefined);
        return;
      }
      ctrl.set({ circuit: v || null });
    });
    this.height = select('plan-height', HEIGHT_PRESETS.map((p) => ({ value: String(p.mm), label: p.label })), (v) => ctrl.set({ height: Number(v) }));

    const field = (label: string, el: HTMLElement): HTMLElement => h('label', { class: 'field' }, h('span', {}, label), el);
    this.rows = {
      status: h('div', { class: 'segmented' }, this.statusButtons.planned, this.statusButtons.existing),
      wire: field('Kabel', this.wireKind),
      pipe: field('Rør', this.pipeKind),
      fixture: field('Type', this.fixtureType),
      circuit: field('Kurs', this.circuit),
      height: field('Høyde', this.height),
    };

    this.message = h('p', { class: 'hint', 'data-testid': 'plan-message', 'aria-live': 'polite' });
    this.finishBtn = h('button', { class: 'small primary-small', 'data-testid': 'plan-finish' }, 'Ferdig (Enter)');
    this.finishBtn.addEventListener('click', () => ctrl.finish());
    this.undoPointBtn = h('button', { class: 'small', 'data-testid': 'plan-undo' }, 'Angre (Ctrl+Z)');
    this.undoPointBtn.addEventListener('click', () => ctrl.undo());
    this.cancelBtn = h('button', { class: 'small', 'data-testid': 'plan-cancel' }, 'Avbryt (Esc)');
    this.cancelBtn.addEventListener('click', () => ctrl.cancel());
    this.deleteBtn = h('button', { class: 'small danger-small', 'data-testid': 'plan-delete' }, 'Slett valgt (Del)');
    this.deleteBtn.addEventListener('click', () => ctrl.deleteSelected());

    this.summary = h('div', { class: 'plan-summary', 'data-testid': 'plan-summary' });
    this.copyBtn = h('button', { class: 'small', 'data-testid': 'plan-copy' }, 'Kopier oversikt');
    this.copyBtn.addEventListener('click', () => {
      if (!this.model) return;
      void navigator.clipboard
        ?.writeText(summaryText(summarize(this.model)))
        .then(() => (this.copyBtn.textContent = 'Kopiert!'))
        .catch(() => (this.copyBtn.textContent = 'Kunne ikke kopiere'))
        .finally(() => setTimeout(() => (this.copyBtn.textContent = 'Kopier oversikt'), 2000));
    });

    this.root = h(
      'div',
      { class: 'group', 'data-testid': 'plan-box' },
      h('h2', {}, 'Tegn el og vann'),
      tools,
      this.rows.status,
      this.rows.wire,
      this.rows.pipe,
      this.rows.fixture,
      this.rows.circuit,
      this.rows.height,
      this.message,
      h('div', { class: 'row' }, this.finishBtn, this.undoPointBtn, this.cancelBtn, this.deleteBtn),
      h('details', { class: 'plan-details' }, h('summary', {}, 'Oversikt og materialliste'), this.summary, this.copyBtn),
    );

    ctrl.options.subscribe(() => this.sync(), true);
    ctrl.message.subscribe((m) => (this.message.textContent = m || ctrl.toolHint()), true);
    ctrl.draftVersion.subscribe(() => this.syncButtons());
    ctrl.selected.subscribe(() => this.syncButtons());
  }

  /** Kurser og oversikt kommer fra modellen (fila + lokale endringer). */
  setModel(model: ApartmentModel): void {
    this.model = model;
    const circuits = model.data.circuits ?? [];
    this.circuit.replaceChildren(
      h('option', { value: '' }, 'Ingen kurs'),
      ...circuits.map((c) => h('option', { value: c.id }, c.fuse ? `${c.name} (${c.fuse} A)` : c.name)),
      h('option', { value: '__ny' }, 'Ny kurs …'),
    );
    const cur = this.ctrl.options.value.circuit;
    if (cur && !circuits.some((c) => c.id === cur)) this.ctrl.set({ circuit: null });
    this.circuit.value = this.ctrl.options.value.circuit ?? '';
    this.renderSummary();
  }

  private renderSummary(): void {
    if (!this.model) return;
    const s = summarize(this.model);
    const rows: HTMLElement[] = [];
    rows.push(h('p', { class: 'hint' }, 'Planlagt el og vann:'));
    const list = h('ul', {});
    for (const c of s.circuits) {
      const pts = [c.outlets && `${c.outlets} stikk.`, c.switches && `${c.switches} brytere`, c.lights && `${c.lights} lamper`].filter(Boolean).join(', ');
      list.append(h('li', {}, `${c.name}${c.fuse ? ` (${c.fuse} A)` : ''}: ${metres(c.length)}${pts ? ` · ${pts}` : ''}`));
    }
    for (const p of s.pipes) list.append(h('li', {}, `${PIPE_KIND_TEXT[p.kind]}: ${metres(p.length)}`));
    if (!list.children.length) list.append(h('li', {}, 'Ingenting planlagt ennå.'));
    rows.push(list);
    if (s.materials.length) rows.push(h('p', { class: 'hint' }, 'Materialliste:'), h('ul', {}, ...s.materials.map((m) => h('li', {}, m))));
    if (s.hints.length) rows.push(h('p', { class: 'hint' }, 'Hint:'), h('ul', { class: 'hints' }, ...s.hints.map((m) => h('li', {}, m))));
    rows.push(h('p', { class: 'hint small-print' }, DISCLAIMER));
    this.summary.replaceChildren(...rows);
  }

  private sync(): void {
    const o = this.ctrl.options.value;
    for (const [id, b] of this.toolButtons) b.setAttribute('aria-pressed', String(id === o.tool));
    this.statusButtons.planned.setAttribute('aria-pressed', String(o.status === 'planned'));
    this.statusButtons.existing.setAttribute('aria-pressed', String(o.status === 'existing'));
    this.wireKind.value = o.wireKind;
    this.pipeKind.value = o.pipeKind;
    this.fixtureType.value = o.fixtureType;
    this.circuit.value = o.circuit ?? '';
    this.height.value = String(o.height);
    const drawing = o.tool !== 'select';
    this.rows.status.hidden = !drawing;
    this.rows.wire.hidden = o.tool !== 'wire';
    this.rows.pipe.hidden = o.tool !== 'pipe';
    this.rows.fixture.hidden = o.tool !== 'fixture';
    this.rows.circuit.hidden = !(o.tool === 'wire' || (o.tool === 'fixture' && !['tap', 'drain', 'valve'].includes(o.fixtureType)));
    this.rows.height.hidden = !(o.tool === 'wire' || o.tool === 'pipe');
    this.syncButtons();
  }

  private syncButtons(): void {
    const o = this.ctrl.options.value;
    const run = o.tool === 'wire' || o.tool === 'pipe';
    this.finishBtn.hidden = !run;
    this.cancelBtn.hidden = !run;
    this.finishBtn.disabled = this.ctrl.draft.points.length < 2;
    this.cancelBtn.disabled = !this.ctrl.drawing;
    this.deleteBtn.hidden = o.tool !== 'select';
    this.deleteBtn.disabled = !this.ctrl.selected.value;
  }
}
