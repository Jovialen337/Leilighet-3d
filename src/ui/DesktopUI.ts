/**
 * Laptop-UI (DOM, norsk bokmål): VR-knapp, visningsvalg, lagbrytere,
 * status, advarsler/feil, målestokk og koordinater i 2D-planen, og skjult
 * bildefrekvens (F-tasten).
 *
 * UI-et leser og skriver bare ViewState. VR-håndleddsmenyen i fase 3 kan
 * dermed styre de samme lagene uten å kjenne til dette panelet.
 */
import type { ApartmentModel } from '../model/ApartmentModel';
import type { Issue } from '../schema/validate';
import { summarize } from '../schema/validate';
import type { ViewState } from '../state/ViewState';
import type { XRManager, XRSupport } from '../xr/XRManager';

const VR_TEXT: Record<XRSupport, { label: string; hint: string; enabled: boolean }> = {
  checking: { label: 'Sjekker VR …', hint: '', enabled: false },
  supported: { label: 'Gå inn i VR', hint: '', enabled: true },
  unsupported: {
    label: 'VR støttes ikke her',
    hint: 'Åpne siden i nettleseren på Quest 3 for å gå inn i VR.',
    enabled: false,
  },
  insecure: { label: 'VR krever HTTPS', hint: 'Bruk https-adressen (GitHub Pages).', enabled: false },
  'no-webxr': {
    label: 'Nettleseren mangler WebXR',
    hint: 'Åpne siden i nettleseren på Quest 3 for å gå inn i VR.',
    enabled: false,
  },
};

const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  el.append(...children);
  return el;
};

export class DesktopUI {
  readonly panel: HTMLElement;
  private readonly vrButton: HTMLButtonElement;
  private readonly vrHint: HTMLElement;
  private readonly layerList: HTMLElement;
  private readonly status: HTMLElement;
  private readonly measureInfo: HTMLElement;
  private readonly legend: HTMLElement;
  private readonly warnings: HTMLDetailsElement;
  private readonly overlay: HTMLElement;
  private readonly scaleBar: HTMLElement;
  private readonly coords: HTMLElement;
  private readonly fpsBox: HTMLElement;
  private readonly modeButtons: Record<'orbit' | 'top', HTMLButtonElement>;
  private readonly help: HTMLElement;

  constructor(
    root: HTMLElement,
    private readonly view: ViewState,
    private readonly xr: XRManager,
    private readonly actions: { reload: () => void },
  ) {
    this.vrButton = h('button', { class: 'vr-button', 'data-testid': 'vr-button', disabled: '' }, 'Sjekker VR …');
    this.vrButton.addEventListener('click', () => (xr.presenting ? xr.exit() : xr.enter()));
    this.vrHint = h('p', { class: 'hint', 'data-testid': 'vr-hint' });

    this.modeButtons = {
      orbit: h('button', { 'data-testid': 'mode-orbit', 'aria-pressed': 'true' }, '3D'),
      top: h('button', { 'data-testid': 'mode-top', 'aria-pressed': 'false' }, 'Ovenfra (2D)'),
    };
    this.modeButtons.orbit.addEventListener('click', () => view.cameraMode.set('orbit'));
    this.modeButtons.top.addEventListener('click', () => view.cameraMode.set('top'));

    const ceilingBox = this.checkbox('Vis tak', view.ceilings.value, (v) => view.ceilings.set(v), 'toggle-ceilings');
    const measureBox = this.checkbox(
      'Marker umålte mål',
      view.measureHighlight.value,
      (v) => view.measureHighlight.set(v),
      'toggle-measure',
    );
    this.legend = h(
      'p',
      { class: 'legend', hidden: '' },
      h('span', { class: 'sw placeholder' }),
      'plassholder ',
      h('span', { class: 'sw partial' }),
      'delvis målt ',
      h('span', { class: 'sw measured' }),
      'målt',
    );
    view.measureHighlight.subscribe((v) => (this.legend.hidden = !v));

    this.layerList = h('div', { class: 'layers', 'data-testid': 'layers' });
    this.status = h('p', { class: 'status', 'data-testid': 'status' }, 'Laster leilighet …');
    this.measureInfo = h('p', { class: 'status', 'data-testid': 'measure-info' });
    this.warnings = h('details', { class: 'warnings', 'data-testid': 'warnings', hidden: '' });
    const reload = h('button', { class: 'link', 'data-testid': 'reload' }, 'Last inn apartment.json på nytt');
    reload.addEventListener('click', () => actions.reload());
    this.help = h(
      'p',
      { class: 'hint' },
      'Dra for å rotere, rull for å zoome, høyreklikk-dra for å panorere. Trykk F for bildefrekvens.',
    );

    const toggle = h('button', { class: 'panel-toggle', 'aria-label': 'Vis/skjul meny', 'data-testid': 'panel-toggle' }, '☰');
    this.panel = h(
      'aside',
      { class: 'panel', 'data-testid': 'panel' },
      h('header', {}, h('h1', {}, 'Leilighet 3D'), toggle),
      h('div', { class: 'panel-body' },
        this.vrButton,
        this.vrHint,
        h('div', { class: 'group' }, h('h2', {}, 'Visning'), h('div', { class: 'segmented' }, this.modeButtons.orbit, this.modeButtons.top), ceilingBox, measureBox, this.legend),
        h('div', { class: 'group' }, h('h2', {}, 'Lag'), this.layerList),
        h('div', { class: 'group' }, this.status, this.measureInfo, this.warnings, reload),
        this.help,
      ),
    );
    toggle.addEventListener('click', () => this.panel.classList.toggle('collapsed'));
    if (window.matchMedia('(max-width: 640px)').matches) this.panel.classList.add('collapsed');

    this.overlay = h('div', { class: 'overlay', 'data-testid': 'overlay' }, h('p', {}, 'Laster leilighet …'));
    this.scaleBar = h('div', { class: 'scalebar', 'data-testid': 'scalebar', hidden: '' }, h('div', { class: 'bar' }), h('span', {}));
    this.coords = h('div', { class: 'coords', 'data-testid': 'coords', hidden: '' });
    this.fpsBox = h('div', { class: 'fps', 'data-testid': 'fps', hidden: '' });

    root.append(this.panel, this.overlay, this.scaleBar, this.coords, this.fpsBox);

    xr.support.subscribe(() => this.updateVrButton(), true);
    xr.error.subscribe((msg) => {
      if (msg) this.vrHint.textContent = msg;
    });
    view.inXR.subscribe(() => this.updateVrButton());
    view.cameraMode.subscribe((mode) => {
      this.modeButtons.orbit.setAttribute('aria-pressed', String(mode === 'orbit'));
      this.modeButtons.top.setAttribute('aria-pressed', String(mode === 'top'));
      this.scaleBar.hidden = mode !== 'top';
      this.coords.hidden = mode !== 'top';
      this.help.textContent =
        mode === 'top'
          ? 'Dra for å flytte, rull for å zoome. Rutenett: 1 m. Trykk F for bildefrekvens.'
          : 'Dra for å rotere, rull for å zoome, høyreklikk-dra for å panorere. Trykk F for bildefrekvens.';
    }, true);
    view.fps.subscribe((v) => (this.fpsBox.hidden = !v), true);

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'f' || e.key === 'F') view.fps.set(!view.fps.value);
    });
  }

  private checkbox(label: string, checked: boolean, onChange: (v: boolean) => void, testId: string): HTMLLabelElement {
    const input = h('input', { type: 'checkbox', 'data-testid': testId });
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    return h('label', { class: 'check' }, input, label);
  }

  private updateVrButton(): void {
    const s = this.xr.support.value;
    const t = VR_TEXT[s];
    if (this.view.inXR.value) {
      this.vrButton.textContent = 'Avslutt VR';
      this.vrButton.disabled = false;
      return;
    }
    this.vrButton.textContent = t.label;
    this.vrButton.disabled = !t.enabled;
    this.vrHint.textContent = t.hint;
  }

  showLoading(): void {
    this.overlay.hidden = false;
    this.overlay.replaceChildren(h('p', {}, 'Laster leilighet …'));
  }

  showErrors(errors: Issue[], warnings: Issue[]): void {
    this.overlay.hidden = false;
    this.overlay.classList.add('error');
    const list = h('ul', {}, ...errors.map((e) => h('li', {}, e.message, e.path ? h('code', {}, ` ${e.path}`) : '')));
    const retry = h('button', {}, 'Prøv igjen');
    retry.addEventListener('click', () => this.actions.reload());
    this.overlay.replaceChildren(
      h('div', { class: 'error-box', 'data-testid': 'errors' },
        h('h2', {}, `Feil i apartment.json (${errors.length})`),
        h('p', {}, 'Modellen kan ikke tegnes før feilene er rettet:'),
        list,
        retry,
      ),
    );
    this.setWarnings(warnings);
    this.status.textContent = 'Leilighetsdata har feil.';
  }

  showModel(model: ApartmentModel, warnings: Issue[]): void {
    this.overlay.hidden = true;
    this.overlay.classList.remove('error');
    this.status.textContent = summarize(model);
    const states = [...model.measure.values()];
    const measured = states.filter((s) => s === 'measured').length;
    const partial = states.filter((s) => s === 'partial').length;
    this.measureInfo.textContent = `Målt: ${measured} av ${states.length} objekter (${partial} delvis). Resten er plassholdere.`;
    this.setWarnings(warnings);
    this.buildLayerList();
  }

  private setWarnings(warnings: Issue[]): void {
    this.warnings.hidden = warnings.length === 0;
    this.warnings.replaceChildren(
      h('summary', {}, `Advarsler (${warnings.length})`),
      h('ul', {}, ...warnings.map((w) => h('li', {}, w.message))),
    );
  }

  private buildLayerList(): void {
    this.layerList.replaceChildren();
    for (const layer of this.view.layers.layers) {
      const state = this.view.layers.get(layer.id);
      const input = h('input', { type: 'checkbox', 'data-testid': `layer-${layer.id}` });
      input.checked = state.value;
      input.addEventListener('change', () => state.set(input.checked));
      state.subscribe((v) => (input.checked = v));
      this.layerList.append(h('label', { class: 'check' }, input, layer.name));
    }
  }

  /** Målestokk: velger en rund lengde som blir 60–160 px. */
  updateScale(pixelsPerMeter: number): void {
    const candidates = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20];
    const meters = candidates.find((m) => m * pixelsPerMeter >= 60) ?? 20;
    const bar = this.scaleBar.querySelector('.bar') as HTMLElement;
    const label = this.scaleBar.querySelector('span') as HTMLElement;
    bar.style.width = `${meters * pixelsPerMeter}px`;
    label.textContent = meters < 1 ? `${Math.round(meters * 100)} cm` : `${meters} m`;
    this.scaleBar.dataset.pxPerM = pixelsPerMeter.toFixed(3);
    this.scaleBar.dataset.meters = String(meters);
  }

  updateCoords(p: { x: number; z: number } | null): void {
    if (!p) {
      this.coords.textContent = '';
      return;
    }
    const f = (v: number): string => Math.round(v).toLocaleString('nb-NO');
    this.coords.textContent = `x ${f(p.x)} mm · z ${f(p.z)} mm`;
    this.coords.dataset.x = String(Math.round(p.x));
    this.coords.dataset.z = String(Math.round(p.z));
  }

  updateFps(label: string): void {
    this.fpsBox.textContent = label;
  }
}
