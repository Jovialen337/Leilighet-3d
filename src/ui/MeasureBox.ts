/**
 * «Oppmåling» i laptop-/nettleserpanelet: start oppmåling på Quest 3, og
 * lagre målingene (last ned / kopier / last opp til GitHub) eller forkast dem.
 */
import type { MeasureSession } from '../measure/MeasureSession';
import { h } from './dom';

export interface MeasureActions {
  start(): void;
  stop(): void;
  download(): void;
  copy(): Promise<boolean>;
  uploadUrl(): string;
  discard(): void;
  adoptStale(): void;
  /** Forkast tegnede endringer som ikke passer med modellen nå. */
  discardPlanStale?(): void;
}

export interface MeasureUiState {
  arSupport: boolean | null;
  measuring: boolean;
  /** VR eller AR pågår. */
  presenting: boolean;
  session: MeasureSession | null;
  /** Antall objekter endret med tegneverktøyet (el og vann), og om de er publisert. */
  planChanges?: number;
  planPublished?: boolean;
  /** Tegnede endringer som ikke passer med modellen nå (vises ikke, men beholdes). */
  planStale?: number;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export class MeasureBox {
  readonly root: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly hint: HTMLElement;
  private readonly draft: HTMLElement;
  private readonly draftStatus: HTMLElement;
  private readonly draftError: HTMLElement;
  private readonly stale: HTMLElement;
  private readonly staleText: HTMLElement;
  private readonly published: HTMLElement;
  private readonly planStale: HTMLElement;
  private readonly planStaleText: HTMLElement;
  private readonly upload: HTMLAnchorElement;
  private readonly copyButton: HTMLButtonElement;
  private measuring = false;

  constructor(private readonly actions: MeasureActions) {
    this.button = h('button', { class: 'measure-button', 'data-testid': 'measure-button', disabled: '' }, 'Mål opp leiligheten');
    this.button.addEventListener('click', () => (this.measuring ? actions.stop() : actions.start()));
    this.hint = h('p', { class: 'hint', 'data-testid': 'measure-hint' });

    this.draftStatus = h('p', { 'data-testid': 'draft-status' });
    this.draftError = h('p', { class: 'draft-error', 'data-testid': 'draft-error', hidden: '' });
    const download = h('button', { class: 'primary', 'data-testid': 'draft-download' }, 'Last ned apartment.json');
    download.addEventListener('click', () => actions.download());
    this.upload = h(
      'a',
      { class: 'button', 'data-testid': 'draft-upload', target: '_blank', rel: 'noopener' },
      'Last opp til GitHub',
    );
    this.copyButton = h('button', { 'data-testid': 'draft-copy' }, 'Kopier');
    this.copyButton.addEventListener('click', () => {
      void actions.copy().then((ok) => {
        this.copyButton.textContent = ok ? 'Kopiert!' : 'Kunne ikke kopiere';
        setTimeout(() => (this.copyButton.textContent = 'Kopier'), 2000);
      });
    });
    const discard = h('button', { class: 'link danger', 'data-testid': 'draft-discard' }, 'Forkast endringene');
    discard.addEventListener('click', () => {
      if (confirm('Slette alle lokale endringer (målinger og tegninger)? Dette kan ikke angres.')) actions.discard();
    });
    this.draft = h(
      'div',
      { class: 'draft', 'data-testid': 'draft', hidden: '' },
      this.draftStatus,
      this.draftError,
      h('div', { class: 'actions' }, download, this.upload, this.copyButton),
      h(
        'p',
        { class: 'hint' },
        'Slik lagrer du: last ned fila, trykk «Last opp til GitHub», velg fila og trykk «Commit changes». Siden oppdateres etter et par minutter.',
      ),
      discard,
    );

    this.staleText = h('p', {});
    const adopt = h('button', { 'data-testid': 'stale-adopt' }, 'Bruk dem likevel');
    adopt.addEventListener('click', () => actions.adoptStale());
    const dropStale = h('button', { class: 'link danger', 'data-testid': 'stale-discard' }, 'Forkast');
    dropStale.addEventListener('click', () => {
      if (confirm('Slette de gamle målingene?')) actions.discard();
    });
    this.stale = h('div', { class: 'draft stale', 'data-testid': 'draft-stale', hidden: '' }, this.staleText, h('div', { class: 'actions' }, adopt, dropStale));
    this.planStaleText = h('p', {});
    const dropPlanStale = h('button', { class: 'link danger', 'data-testid': 'plan-stale-discard' }, 'Forkast dem');
    dropPlanStale.addEventListener('click', () => actions.discardPlanStale?.());
    this.planStale = h('div', { class: 'draft stale', 'data-testid': 'plan-stale', hidden: '' }, this.planStaleText, dropPlanStale);
    this.published = h(
      'p',
      { class: 'draft-ok', 'data-testid': 'draft-published', hidden: '' },
      'Endringene dine er nå med i apartment.json.',
    );

    this.root = h(
      'div',
      { class: 'group', 'data-testid': 'measure-group' },
      h('h2', {}, 'Oppmåling'),
      this.button,
      this.hint,
      this.draft,
      this.stale,
      this.planStale,
      this.published,
    );
  }

  update(s: MeasureUiState): void {
    this.measuring = s.measuring;
    const ms = s.session;
    if (s.measuring) {
      this.button.textContent = 'Avslutt oppmåling';
      this.button.disabled = false;
    } else {
      this.button.textContent = ms?.hasMeasurements ? 'Fortsett oppmålingen' : 'Mål opp leiligheten';
      this.button.disabled = !s.arSupport || !ms || s.presenting;
    }
    this.hint.textContent =
      s.arSupport === false
        ? 'Oppmåling gjøres i nettleseren på Quest 3: du ser rommet gjennom brillene og blir guidet punkt for punkt.'
        : s.arSupport && !ms?.hasMeasurements
          ? 'Du ser rommet gjennom brillene og blir guidet punkt for punkt. Start ved inngangsdøra.'
          : '';

    const p = ms?.progress();
    const plan = s.planChanges ?? 0;
    const measured = !!ms?.hasMeasurements;
    this.draft.hidden = !measured && plan === 0;
    if (!this.draft.hidden) {
      const parts: string[] = [];
      if (ms && p && measured) parts.push(`målinger: ${p.done} av ${p.total} punkter${p.skipped ? ` (${p.skipped} hoppet over)` : ''}`);
      if (plan) parts.push(`tegnet el og vann: ${plural(plan, 'endring', 'endringer')}`);
      this.draftStatus.textContent = `Lokale endringer – ${parts.join(' · ')}. De er lagret i denne nettleseren, ikke i fila ennå.`;
      this.upload.href = this.actions.uploadUrl();
    }
    this.draftError.hidden = !ms?.error;
    this.draftError.textContent = ms?.error ? `Siste måling ga en feil i modellen: ${ms.error}` : '';

    this.stale.hidden = !ms?.stale;
    if (ms?.stale)
      this.staleText.textContent = `Det finnes ${plural(ms.stale.count, 'måling', 'målinger')} laget mot en eldre versjon av apartment.json.`;
    const ps = s.planStale ?? 0;
    this.planStale.hidden = ps === 0;
    this.planStaleText.textContent = `${plural(ps, 'tegnet endring passer', 'tegnede endringer passer')} ikke med modellen nå (f.eks. er en vegg blitt kortere eller borte) og vises ikke. De er tatt vare på og kommer tilbake hvis modellen endres så de passer igjen.`;
    this.published.hidden = !ms?.published && !s.planPublished;
  }
}
