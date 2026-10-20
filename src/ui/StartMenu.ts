/**
 * Startmenyen: det første man ser på Quest-nettleseren (og laptopen). Rolig
 * og enkel, i designet til resten av appen. Modellen tegnes bak den.
 *
 * - Hovedsiden: tittel, «Neste steg», «Gå inn i VR» / «Fortsett», og fire
 *   kort: «Ny modell», «Last inn», «Innstillinger», «Opplæring og farger».
 * - Undersidene har «‹ Tilbake»; Esc går tilbake (på hovedsiden: «Fortsett»).
 * - Vises når appen åpnes (kan slås av), og fra «⌂» øverst i panelet.
 *   `?direkte` i adressen hopper over den, `?start` viser den alltid.
 */
import { h } from './dom';
import { boundCheckbox } from './controls';
import type { ViewState, Quality, TurnMode } from '../state/ViewState';
import type { LightId } from '../scene/lighting';
import type { NextAction, NextStep } from './nextStep';
import type { LegendGroup } from './legend';
import { legendView } from './LegendView';

export interface StartActions {
  /** Tittel (navnet i fila) og en linje om modellen, eller null mens den lastes / har feil. */
  title(): string;
  summary(): string | null;
  vrSupported(): boolean;
  arSupported(): boolean;
  enterVR(): void;
  enterMeasure(): void;
  builder: {
    summary(): { name: string; rooms: number; errors: number; exported: boolean } | null;
    begin(kind: 'continue' | 'blank' | 'current' | 'capture'): void;
    openFile(file: File): void;
  };
  /** Lokale endringer som bare finnes i nettleseren (målinger og tegnet el og vann). */
  local(): { measurements: number; planEdits: number };
  download(): void;
  reload(): void;
  nextStep(): NextStep;
  doNext(action: NextAction): void;
  /** Alle fargene (opplæringen). */
  legend(): LegendGroup[];
  startTutorial(track: 'pc' | 'vr'): void;
  /** Opplæringen er gjort ferdig før (i denne nettleseren). */
  tutorialDone(track: 'pc' | 'vr'): boolean;
  showShortcuts(): void;
  resetSettings(): void;
  /** Første gang appen åpnes i denne nettleseren (velkomsttekst). */
  firstVisit(): boolean;
}

type Page = 'main' | 'ny' | 'last' | 'innstillinger' | 'opplaering';

const QUALITY: readonly [Quality, string][] = [
  ['low', 'Rask'],
  ['medium', 'Standard'],
  ['high', 'Høy'],
  ['custom', 'Egendefinert'],
];
const LIGHT: readonly [LightId, string][] = [
  ['morgen', 'Morgen'],
  ['dag', 'Dag'],
  ['kveld', 'Kveld'],
  ['natt', 'Natt'],
];
const TURN: readonly [TurnMode, string][] = [
  [15, '15°'],
  [30, '30°'],
  [45, '45°'],
  ['smooth', 'Myk'],
];

export class StartMenu {
  readonly root: HTMLElement;
  private readonly col: HTMLElement;
  private page: Page = 'main';
  private onClose: (() => void) | null = null;

  constructor(
    private readonly view: ViewState,
    private readonly actions: StartActions,
  ) {
    this.col = h('div', { class: 'start-col' });
    this.root = h('div', { class: 'start', 'data-testid': 'start-menu', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Startmeny', hidden: '' }, this.col);
    this.root.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (this.page === 'main') this.close();
      else this.show('main');
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Åpner menyen (på hovedsiden). `onClose` kalles når den lukkes. */
  open(onClose: (() => void) | null = null): void {
    this.onClose = onClose;
    this.root.hidden = false;
    document.body.classList.add('start-open');
    this.show('main');
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    document.body.classList.remove('start-open');
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }

  /** Tegner en side på nytt (f.eks. når modellen er lastet). */
  refresh(): void {
    if (this.isOpen) this.show(this.page);
  }

  show(page: Page): void {
    this.page = page;
    this.col.replaceChildren(...this.pageContent(page));
    this.col.querySelector<HTMLElement>('button:not([disabled])')?.focus({ preventScroll: true });
  }

  private pageContent(page: Page): HTMLElement[] {
    switch (page) {
      case 'main':
        return this.mainPage();
      case 'ny':
        return this.newPage();
      case 'last':
        return this.loadPage();
      case 'innstillinger':
        return this.settingsPage();
      case 'opplaering':
        return this.learnPage();
    }
  }

  /* ---------------- sidene ---------------- */

  private mainPage(): HTMLElement[] {
    const a = this.actions;
    const out: HTMLElement[] = [h('div', { class: 'start-brand' }, '⌂ Leilighet 3D'), h('h1', { class: 'start-title' }, a.title())];
    const sum = a.summary();
    if (sum) out.push(h('p', { class: 'start-sub', 'data-testid': 'start-summary' }, sum));
    if (a.firstVisit())
      out.push(
        h(
          'div',
          { class: 'start-welcome' },
          h('p', {}, 'Velkommen! Her ser du leiligheten i 3D og VR, måler den opp med Quest 3 og planlegger el og vann.'),
          this.button('Ny her? Ta opplæringen (2 min)', 'start-welcome-learn', () => this.show('opplaering'), 'small'),
        ),
      );
    // Neste steg: hva man bør gjøre nå.
    const next = a.nextStep();
    const nextBox = h('div', { class: 'start-next', 'data-testid': 'start-next' }, h('span', { class: 'start-kicker' }, 'Neste steg'), h('p', {}, next.text));
    if (next.action && next.label) nextBox.append(this.button(next.label, 'start-next-action', () => this.after(() => a.doNext(next.action!)), 'small'));
    out.push(nextBox);

    const vr = a.vrSupported();
    const primary = vr
      ? this.button('Gå inn i VR', 'start-vr', () => {
          // Økten må startes i selve klikket (brukerhandling).
          a.enterVR();
          this.close();
        }, 'primary')
      : this.button('Se leiligheten', 'start-continue', () => this.close(), 'primary');
    out.push(primary);
    if (vr) out.push(this.button('Fortsett i nettleseren', 'start-continue', () => this.close(), 'secondary'));

    const cards = h(
      'div',
      { class: 'start-cards' },
      this.card('Ny modell', 'Tegn rommene, eller mål dem opp med Quest 3', 'start-new', () => this.show('ny')),
      this.card('Last inn', 'Modellen, endringer i nettleseren eller en fil', 'start-load', () => this.show('last')),
      this.card('Innstillinger', 'Grafikk, lys og VR', 'start-settings', () => this.show('innstillinger')),
      this.card('Opplæring og farger', 'Kom i gang, og hva fargene betyr', 'start-learn', () => this.show('opplaering')),
    );
    out.push(cards);
    const shortcuts = this.button('Hurtigtaster (H)', 'start-shortcuts', () => this.after(() => a.showShortcuts()), 'link');
    out.push(h('div', { class: 'start-foot' }, boundCheckbox('Vis startmenyen når appen åpnes', this.view.startMenu, 'start-show'), shortcuts));
    return out;
  }

  private newPage(): HTMLElement[] {
    const a = this.actions;
    const b = a.builder.summary();
    const out = [this.back(), h('h2', { class: 'start-h' }, 'Ny modell'), h('p', { class: 'start-sub' }, 'Tegn rommene på PC-en, eller mål dem opp med Quest 3. Veggene lages automatisk.')];
    const list = h('div', { class: 'start-list' });
    if (b) list.append(this.row(`Fortsett på «${b.name}»`, `${b.rooms} rom${b.errors ? ` · ${b.errors} feil` : ''}`, 'start-new-continue', () => this.after(() => a.builder.begin('continue'))));
    list.append(
      this.row('Tom modell', 'Tegn første rom med to klikk', 'start-new-blank', () => {
        if (b && !confirm(`Starte en ny, tom modell? «${b.name}» kan hentes igjen med «Hent forrige tegning».`)) return;
        this.after(() => a.builder.begin('blank'));
      }),
      this.row('Fra nåværende modell', 'Endre leiligheten du har, rom for rom', 'start-new-current', () => this.after(() => a.builder.begin('current'))),
    );
    if (a.arSupported())
      list.append(this.row('Mål opp rommene (Quest 3)', 'Berør hjørnene i gjennomsyn', 'start-new-capture', () => this.after(() => a.builder.begin('capture'))));
    list.append(this.fileRow('Åpne fil …', 'En lagret tegning eller en apartment.json', 'start-new-file'));
    out.push(list);
    return out;
  }

  private loadPage(): HTMLElement[] {
    const a = this.actions;
    const out = [this.back(), h('h2', { class: 'start-h' }, 'Last inn')];
    const list = h('div', { class: 'start-list' });
    list.append(
      this.row('Modellen (apartment.json)', a.summary() ?? 'Lastes …', 'start-load-model', () => this.close()),
      this.row('Hent fila på nytt', 'Når en ny apartment.json er lagt ut', 'start-load-reload', () => this.after(() => a.reload())),
    );
    const local = a.local();
    if (local.measurements + local.planEdits > 0) {
      const parts = [
        ...(local.measurements ? [`${local.measurements} ${local.measurements === 1 ? 'måling' : 'målinger'}`] : []),
        ...(local.planEdits ? [`${local.planEdits} ${local.planEdits === 1 ? 'tegnet endring' : 'tegnede endringer'}`] : []),
      ];
      list.append(this.row('Last ned apartment.json', `${parts.join(' og ')} – bare i denne nettleseren`, 'start-load-download', () => a.download()));
    }
    const b = a.builder.summary();
    if (b) list.append(this.row(`Ny modell: «${b.name}»`, `${b.rooms} rom – åpne den i «Lag ny modell»`, 'start-load-builder', () => this.after(() => a.builder.begin('continue'))));
    list.append(this.fileRow('Åpne fil …', 'En lagret tegning eller en apartment.json (åpnes i «Lag ny modell»)', 'start-load-file'));
    out.push(list);
    return out;
  }

  private settingsPage(): HTMLElement[] {
    const v = this.view;
    return [
      this.back(),
      h('h2', { class: 'start-h' }, 'Innstillinger'),
      this.segmented('Grafikk', QUALITY, () => v.quality.value, (q) => v.quality.set(q), 'start-quality'),
      this.segmented('Lys', LIGHT, () => v.light.value, (l) => v.light.set(l), 'start-light'),
      h('h3', { class: 'start-h3' }, 'I VR'),
      this.segmented('Snu med høyre stikke', TURN, () => v.turn.value, (t) => v.turn.set(t), 'start-turn'),
      this.segmented('Bildefrekvens', [[72, '72 Hz'], [90, '90 Hz'], [120, '120 Hz']] as const, () => v.xrRate.value, (r) => v.xrRate.set(r), 'start-rate'),
      boundCheckbox('Vis alltid hjelp på håndleddet', v.wristHelp, 'start-wrist-help'),
      boundCheckbox('Vis startmenyen når appen åpnes', v.startMenu, 'start-show-2'),
      h('p', { class: 'hint' }, 'Valgene lagres i denne nettleseren. Quest og laptop har hver sine valg.'),
      this.button('Tilbakestill innstillinger', 'start-reset', () => {
        this.actions.resetSettings();
        this.show('innstillinger');
      }, 'link'),
    ];
  }

  private learnPage(): HTMLElement[] {
    const a = this.actions;
    const steps = h(
      'ol',
      { class: 'start-steps' },
      h('li', {}, h('b', {}, 'Se deg rundt'), ' – på laptopen eller i VR (Quest 3).'),
      h('li', {}, h('b', {}, 'Mål opp'), ' – med Quest 3 i gjennomsyn: oransje blir grønt etter hvert.'),
      h('li', {}, h('b', {}, 'Planlegg el og vann'), ' – tegn kabler, rør og punkter (stiplet = planlagt).'),
      h('li', {}, h('b', {}, 'Lagre'), ' – last ned apartment.json og last den opp til GitHub.'),
    );
    const out: HTMLElement[] = [
      this.back(),
      h('h2', { class: 'start-h' }, 'Opplæring og farger'),
      h('p', { class: 'start-sub' }, 'Slik jobber du med leiligheten:'),
      steps,
      h(
        'div',
        { class: 'start-row-buttons' },
        this.button(
          a.tutorialDone('pc') ? 'Kom i gang på PC-en ✓' : 'Kom i gang på PC-en',
          'start-tutorial-pc',
          () => this.after(() => a.startTutorial('pc')),
          'secondary',
        ),
        ...(a.vrSupported()
          ? [
              this.button(a.tutorialDone('vr') ? 'Kom i gang i VR ✓' : 'Kom i gang i VR', 'start-tutorial-vr', () => {
                // Økten må startes i selve klikket (brukerhandling).
                a.startTutorial('vr');
                a.enterVR();
                this.close();
              }, 'secondary'),
            ]
          : []),
      ),
      h(
        'p',
        { class: 'hint' },
        a.vrSupported()
          ? 'Hvert steg venter på at du gjør det. I VR står stegene på venstre håndledd.'
          : 'Hvert steg venter på at du gjør det. Opplæringen i VR startes fra nettleseren på Quest 3, eller fra «Hjelp» i VR-menyen.',
      ),
      h('h3', { class: 'start-h3' }, 'Hva fargene betyr'),
      legendView(a.legend(), 'start-legend'),
    ];
    return out;
  }

  /* ---------------- byggeklosser ---------------- */

  /** Lukker menyen og gjør handlingen etterpå (så den ikke ligger over det som skjer). */
  private after(fn: () => void): void {
    this.close();
    fn();
  }

  private back(): HTMLElement {
    return this.button('‹ Tilbake', 'start-back', () => this.show('main'), 'link');
  }

  private button(label: string, testId: string, onClick: () => void, kind: 'primary' | 'secondary' | 'small' | 'link'): HTMLButtonElement {
    const b = h('button', { class: `start-btn ${kind}`, 'data-testid': testId, type: 'button' }, label);
    b.addEventListener('click', onClick);
    return b;
  }

  private card(title: string, sub: string, testId: string, onClick: () => void): HTMLButtonElement {
    const b = h('button', { class: 'start-card', 'data-testid': testId, type: 'button' }, h('span', { class: 'start-card-title' }, title), h('span', { class: 'start-card-sub' }, sub));
    b.addEventListener('click', onClick);
    return b;
  }

  private row(title: string, sub: string, testId: string, onClick: () => void): HTMLButtonElement {
    const b = h('button', { class: 'start-row', 'data-testid': testId, type: 'button' }, h('span', { class: 'start-card-title' }, title), h('span', { class: 'start-card-sub' }, sub));
    b.addEventListener('click', onClick);
    return b;
  }

  /** Rad som åpner en fil (skjult filvelger). */
  private fileRow(title: string, sub: string, testId: string): HTMLElement {
    const input = h('input', { type: 'file', accept: '.json,application/json', hidden: '', 'data-testid': `${testId}-input` });
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) this.after(() => this.actions.builder.openFile(f));
    });
    const b = this.row(title, sub, testId, () => input.click());
    return h('div', {}, b, input);
  }

  /** Knapperad der én er valgt (som på laptopen og i VR-menyen). */
  private segmented<T extends string | number>(
    label: string,
    options: readonly (readonly [T, string])[],
    get: () => T,
    set: (v: T) => void,
    testId: string,
  ): HTMLElement {
    const row = h('div', { class: 'start-seg', role: 'group', 'aria-label': label, 'data-testid': testId });
    const buttons = options.map(([v, text]) => {
      const b = h('button', { type: 'button', 'data-value': String(v) }, text);
      b.addEventListener('click', () => {
        set(v);
        for (const x of buttons) x.setAttribute('aria-pressed', String(x === b));
      });
      b.setAttribute('aria-pressed', String(get() === v));
      return b;
    });
    row.append(...buttons);
    return h('div', { class: 'start-field' }, h('span', {}, label), row);
  }
}
