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
import type { MeasureSession } from '../measure/MeasureSession';
import { h } from './dom';
import { MeasureBox, type MeasureActions } from './MeasureBox';
import { LayerPanel } from './LayerPanel';
import { boundCheckbox, boundRange, boundSelect } from './controls';
import { ACTION_TEXT, SHORTCUTS, isTypingTarget, shortcutFor } from './shortcuts';
import { QUALITIES, TURN_MODES, XR_RATES, type Quality, type TurnMode, type XRRate } from '../state/ViewState';

export interface DesktopActions {
  reload: () => void;
  measure: MeasureActions;
  goToRoom: (roomId: string) => void;
  resetView: () => void;
  resetSettings: () => void;
  /** Standard snitthøyde fra fila (mm over laveste gulv). */
  defaultSectionHeight: () => number;
  /** «Tegn el og vann»-seksjonen. */
  planBox?: HTMLElement;
}

const QUALITY_TEXT: Record<Quality, string> = { low: 'Rask', medium: 'Standard', high: 'Høy' };
const TURN_TEXT = (t: TurnMode): string => (t === 'smooth' ? 'Myk dreiing' : `${t}° om gangen`);

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


export class DesktopUI {
  readonly panel: HTMLElement;
  private readonly vrButton: HTMLButtonElement;
  private readonly vrHint: HTMLElement;
  readonly layerPanel: LayerPanel;
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
  readonly measureBox: MeasureBox;
  private measureSession: MeasureSession | null = null;
  private readonly roomList: HTMLElement;
  private readonly helpDialog: HTMLElement;
  private readonly tooltip: HTMLElement;
  private planState: { planChanges: number; planPublished: boolean; planStale?: number } = { planChanges: 0, planPublished: false };

  constructor(
    root: HTMLElement,
    private readonly view: ViewState,
    private readonly xr: XRManager,
    private readonly actions: DesktopActions,
  ) {
    this.vrButton = h('button', { class: 'vr-button', 'data-testid': 'vr-button', disabled: '' }, 'Sjekker VR …');
    this.vrButton.addEventListener('click', () => (xr.presenting ? xr.exit() : xr.enter()));
    this.vrHint = h('p', { class: 'hint', 'data-testid': 'vr-hint' });
    this.measureBox = new MeasureBox(actions.measure);

    this.modeButtons = {
      orbit: h('button', { 'data-testid': 'mode-orbit', 'aria-pressed': 'true' }, '3D'),
      top: h('button', { 'data-testid': 'mode-top', 'aria-pressed': 'false' }, 'Ovenfra (2D)'),
    };
    this.modeButtons.orbit.addEventListener('click', () => view.cameraMode.set('orbit'));
    this.modeButtons.top.addEventListener('click', () => view.cameraMode.set('top'));

    const ceilingBox = boundCheckbox('Vis tak', view.ceilings, 'toggle-ceilings');
    const measureBox = boundCheckbox('Marker umålte mål', view.measureHighlight, 'toggle-measure');
    const dollhouseBox = boundCheckbox('Dukkehus (kutt 3D i snitthøyden)', view.dollhouse, 'toggle-dollhouse');
    const section = boundRange(
      'Snitthøyde',
      view.sectionHeight,
      { min: 300, max: 2600, step: 50, fallback: () => actions.defaultSectionHeight() },
      'section-height',
    );
    const resetView = h('button', { class: 'small', 'data-testid': 'reset-view' }, 'Tilbakestill visning');
    resetView.addEventListener('click', () => actions.resetView());
    const fullscreen = h('button', { class: 'small', 'data-testid': 'fullscreen' }, 'Fullskjerm');
    fullscreen.hidden = !document.fullscreenEnabled;
    fullscreen.addEventListener('click', () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.().catch(() => undefined);
    });
    const shortcutsButton = h('button', { class: 'small', 'data-testid': 'show-help' }, 'Hurtigtaster (H)');
    shortcutsButton.addEventListener('click', () => this.toggleHelp());
    this.roomList = h('div', { class: 'room-list', 'data-testid': 'rooms' });

    const settings = h(
      'div',
      { class: 'group', 'data-testid': 'settings' },
      h('h2', {}, 'Innstillinger'),
      boundSelect<Quality>('Grafikk', view.quality, QUALITIES.map((q) => ({ value: q, label: QUALITY_TEXT[q] })), 'setting-quality'),
      h('p', { class: 'hint' }, 'Rask: enklest. Standard: myke skygger og himmel. Høy: også skarpere bilde (i VR fra neste gang du går inn).'),
      boundSelect<TurnMode>('VR: snu', view.turn, TURN_MODES.map((t) => ({ value: t, label: TURN_TEXT(t) })), 'setting-turn'),
      boundSelect<XRRate>('VR: bildefrekvens', view.xrRate, XR_RATES.map((r) => ({ value: r, label: `${r} Hz` })), 'setting-rate'),
      h('p', { class: 'hint' }, 'Valgene lagres i denne nettleseren. Quest og laptop har hver sine valg; i VR finner du dem i menyen (X).'),
    );
    const resetSettings = h('button', { class: 'link', 'data-testid': 'reset-settings' }, 'Tilbakestill innstillinger');
    resetSettings.addEventListener('click', () => actions.resetSettings());
    settings.append(resetSettings);
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

    this.layerPanel = new LayerPanel(view);
    this.status = h('p', { class: 'status', 'data-testid': 'status' }, 'Laster leilighet …');
    this.measureInfo = h('p', { class: 'status', 'data-testid': 'measure-info' });
    this.warnings = h('details', { class: 'warnings', 'data-testid': 'warnings', hidden: '' });
    const reload = h('button', { class: 'link', 'data-testid': 'reload' }, 'Last inn apartment.json på nytt');
    reload.addEventListener('click', () => actions.reload());
    this.help = h(
      'p',
      { class: 'hint' },
      'Dra for å rotere, rull for å zoome, høyreklikk-dra for å panorere. Trykk H for hurtigtaster.',
    );

    const toggle = h('button', { class: 'panel-toggle', 'aria-label': 'Vis/skjul meny', 'data-testid': 'panel-toggle' }, '☰');
    this.panel = h(
      'aside',
      { class: 'panel', 'data-testid': 'panel' },
      h('header', {}, h('h1', {}, 'Leilighet 3D'), toggle),
      h('div', { class: 'panel-body' },
        this.vrButton,
        this.vrHint,
        this.measureBox.root,
        h('div', { class: 'group' },
          h('h2', {}, 'Visning'),
          h('div', { class: 'segmented' }, this.modeButtons.orbit, this.modeButtons.top),
          ceilingBox,
          measureBox,
          this.legend,
          dollhouseBox,
          section,
          h('div', { class: 'row' }, resetView, fullscreen, shortcutsButton),
        ),
        h('div', { class: 'group' }, h('h2', {}, 'Gå til rom'), this.roomList),
        ...(actions.planBox ? [actions.planBox] : []),
        this.layerPanel.root,
        settings,
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

    this.helpDialog = this.buildHelp();
    this.tooltip = h('div', { class: 'plan-tooltip', 'data-testid': 'plan-tooltip', hidden: '' });
    root.append(this.panel, this.overlay, this.scaleBar, this.coords, this.fpsBox, this.helpDialog, this.tooltip);
    // Snitthøyden er bare i bruk ovenfra eller i dukkehus.
    const showSection = (): void => {
      section.hidden = view.cameraMode.value !== 'top' && !view.dollhouse.value;
    };
    view.cameraMode.subscribe(showSection);
    view.dollhouse.subscribe(showSection, true);

    xr.support.subscribe(() => this.updateVrButton(), true);
    xr.error.subscribe((msg) => {
      if (msg) this.vrHint.textContent = msg;
    });
    view.inXR.subscribe(() => {
      this.updateVrButton();
      this.updateMeasure();
    });
    xr.arSupport.subscribe(() => this.updateMeasure(), true);
    xr.measuring.subscribe(() => this.updateMeasure());
    view.cameraMode.subscribe((mode) => {
      this.modeButtons.orbit.setAttribute('aria-pressed', String(mode === 'orbit'));
      this.modeButtons.top.setAttribute('aria-pressed', String(mode === 'top'));
      this.scaleBar.hidden = mode !== 'top';
      this.coords.hidden = mode !== 'top';
      this.help.textContent =
        mode === 'top'
          ? 'Dra for å flytte, rull for å zoome. Rutenett: 1 m. Trykk H for hurtigtaster.'
          : 'Dra for å rotere, rull for å zoome, høyreklikk-dra for å panorere. Trykk H for hurtigtaster.';
    }, true);
    view.fps.subscribe((v) => (this.fpsBox.hidden = !v), true);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.helpDialog.hidden) {
        this.toggleHelp(false);
        e.stopImmediatePropagation(); // Esc lukker bare hjelpen
        return;
      }
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const s = shortcutFor(e.key);
      if (!s) return;
      this.runAction(s.action);
    });
  }

  private runAction(action: string): void {
    const v = this.view;
    switch (action) {
      case 'orbit':
      case 'top':
        v.cameraMode.set(action);
        break;
      case 'ceilings':
        v.ceilings.set(!v.ceilings.value);
        break;
      case 'highlight':
        v.measureHighlight.set(!v.measureHighlight.value);
        break;
      case 'dollhouse':
        v.dollhouse.set(!v.dollhouse.value);
        break;
      case 'resetView':
        this.actions.resetView();
        break;
      case 'fps':
        v.fps.set(!v.fps.value);
        break;
      case 'help':
        this.toggleHelp();
        break;
    }
  }

  private buildHelp(): HTMLElement {
    const rows = SHORTCUTS.map((s) => h('tr', {}, h('td', {}, h('kbd', {}, s.label)), h('td', {}, ACTION_TEXT[s.action] ?? s.action)));
    const close = h('button', { 'data-testid': 'help-close' }, 'Lukk');
    close.addEventListener('click', () => this.toggleHelp(false));
    const plan = h(
      'table',
      {},
      ...[
        ['S / E / V / P', 'Velg / Kabel / Rør / Punkt'],
        ['Klikk', 'Sett punkt (dra = flytt visningen som før)'],
        ['Enter, dobbeltklikk, høyreklikk', 'Ferdig med kabelen/røret'],
        ['Backspace', 'Fjern siste punkt'],
        ['Esc', 'Avbryt / tilbake til «Velg»'],
        ['Delete', 'Slett valgt'],
        ['Ctrl+Z', 'Angre'],
        ['Hold Ctrl', 'Ikke fest (fri plassering)'],
      ].map(([k, t]) => h('tr', {}, h('td', {}, h('kbd', {}, k!)), h('td', {}, t!))),
    );
    const vr = h(
      'ul',
      {},
      h('li', {}, 'Venstre stikke fremover: sikt og slipp for å teleportere'),
      h('li', {}, 'Høyre stikke til siden: snu · bakover: snu 180°'),
      h('li', {}, 'X: meny (lag, tak, tegn, gå til rom, innstillinger) · Y: bildefrekvens'),
      h('li', {}, 'Tegn (velg i menyen): avtrekker = punkt, A = ferdig, B = angre'),
    );
    const dialog = h(
      'div',
      { class: 'help-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Hurtigtaster', 'data-testid': 'help', hidden: '' },
      h('div', { class: 'help-box' },
        h('h2', {}, 'Hurtigtaster'),
        h('table', {}, ...rows),
        h('p', { class: 'hint' }, '3D: dra for å rotere, rull for å zoome, høyreklikk-dra for å panorere. 2D: dra for å flytte.'),
        h('h2', {}, 'Tegn el og vann'),
        plan,
        h('h2', {}, 'I VR (Quest 3)'),
        vr,
        close,
      ),
    );
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) this.toggleHelp(false);
    });
    return dialog;
  }

  get helpOpen(): boolean {
    return !this.helpDialog.hidden;
  }

  private toggleHelp(show = this.helpDialog.hidden): void {
    this.helpDialog.hidden = !show;
    if (show) (this.helpDialog.querySelector('button') as HTMLButtonElement | null)?.focus();
  }

  private buildRoomList(model: ApartmentModel): void {
    this.roomList.replaceChildren(
      ...[...model.rooms.values()].map(({ room }) => {
        const b = h('button', { class: 'chip', 'data-testid': `room-${room.id}` }, room.name);
        b.addEventListener('click', () => this.actions.goToRoom(room.id));
        return b;
      }),
    );
  }

  /** Oppdaterer oppmålingsboksen (kalles når målinger eller tegninger endres). */
  updateMeasure(
    session: MeasureSession | null = this.measureSession,
    plan: { planChanges: number; planPublished: boolean; planStale?: number } = this.planState,
  ): void {
    this.measureSession = session;
    this.planState = plan;
    this.measureBox.update({
      arSupport: this.xr.arSupport.value,
      measuring: this.xr.measuring.value,
      presenting: this.view.inXR.value,
      session,
      ...plan,
    });
  }

  /** Liten lapp ved musepekeren mens man tegner (lengde, høyde, hva den festet til). */
  planTooltip(text: string | null, x = 0, y = 0): void {
    this.tooltip.hidden = !text;
    if (!text) return;
    this.tooltip.textContent = text;
    const r = this.panel.parentElement!.getBoundingClientRect();
    this.tooltip.style.left = `${x - r.left + 14}px`;
    this.tooltip.style.top = `${y - r.top + 14}px`;
  }

  private updateVrButton(): void {
    const s = this.xr.support.value;
    const t = VR_TEXT[s];
    if (this.view.inXR.value && this.xr.mode === 'measure') {
      this.vrButton.textContent = 'Gå inn i VR';
      this.vrButton.disabled = true;
      return;
    }
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
    this.layerPanel.build(model);
    this.buildRoomList(model);
  }

  private setWarnings(warnings: Issue[]): void {
    this.warnings.hidden = warnings.length === 0;
    this.warnings.replaceChildren(
      h('summary', {}, `Advarsler (${warnings.length})`),
      h('ul', {}, ...warnings.map((w) => h('li', {}, w.message))),
    );
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
