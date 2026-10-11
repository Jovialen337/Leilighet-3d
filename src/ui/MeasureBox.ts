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
}

export interface MeasureUiState {
  arSupport: boolean | null;
  measuring: boolean;
  /** VR eller AR pågår. */
  presenting: boolean;
  session: MeasureSession | null;
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
    const discard = h('button', { class: 'link danger', 'data-testid': 'draft-discard' }, 'Forkast målingene');
    discard.addEventListener('click', () => {
      if (confirm('Slette alle lokale målinger? Dette kan ikke angres.')) actions.discard();
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
    this.published = h(
      'p',
      { class: 'draft-ok', 'data-testid': 'draft-published', hidden: '' },
      'Målingene dine er nå med i apartment.json.',
    );

    this.root = h(
      'div',
      { class: 'group', 'data-testid': 'measure-group' },
      h('h2', {}, 'Oppmåling'),
      this.button,
      this.hint,
      this.draft,
      this.stale,
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
    this.draft.hidden = !ms || !ms.hasMeasurements;
    if (ms && p && ms.hasMeasurements) {
      const skipped = p.skipped ? ` (${p.skipped} hoppet over)` : '';
      this.draftStatus.textContent = `Lokale målinger: ${p.done} av ${p.total} punkter${skipped}. De er lagret i denne nettleseren, ikke i fila ennå.`;
      this.upload.href = this.actions.uploadUrl();
    }
    this.draftError.hidden = !ms?.error;
    this.draftError.textContent = ms?.error ? `Siste måling ga en feil i modellen: ${ms.error}` : '';

    this.stale.hidden = !ms?.stale;
    if (ms?.stale)
      this.staleText.textContent = `Det finnes ${plural(ms.stale.count, 'måling', 'målinger')} laget mot en eldre versjon av apartment.json.`;
    this.published.hidden = !ms?.published;
  }
}
