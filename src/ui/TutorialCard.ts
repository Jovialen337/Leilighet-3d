/**
 * Opplæringen på siden: et kort nede til høyre med steget («2 av 6»), hva
 * man skal gjøre, og «Neste» / «Hopp over» / «Avslutt». Knappen eller valget
 * steget handler om, får en blå ring i panelet. VR-sporet vises på
 * håndleddet; her står bare at det fortsetter i VR.
 */
import { h } from './dom';
import type { Tutorial } from '../tutorial/Tutorial';

export interface TutorialCardActions {
  vrSupported(): boolean;
  enterVR(): void;
}

export class TutorialCard {
  readonly root: HTMLElement;
  private target: HTMLElement | null = null;

  constructor(
    private readonly tutorial: Tutorial,
    private readonly actions: TutorialCardActions,
  ) {
    this.root = h('section', { class: 'tutorial', 'aria-live': 'polite', 'aria-label': 'Opplæring', 'data-testid': 'tutorial', hidden: '' });
    tutorial.state.subscribe(() => this.render(), true);
  }

  render(): void {
    this.target?.classList.remove('tutorial-target');
    this.target = null;
    const s = this.tutorial.state.value;
    const step = this.tutorial.step;
    const pos = this.tutorial.position;
    if (!s || !step || !pos) {
      this.root.hidden = true;
      this.root.replaceChildren();
      return;
    }
    this.root.hidden = false;
    const kicker = `${s.track === 'vr' ? 'Opplæring i VR' : 'Opplæring'} · ${pos.index + 1} av ${pos.count}`;
    const last = pos.index + 1 === pos.count;
    const buttons: HTMLElement[] = [];
    if (s.track === 'vr') {
      if (this.actions.vrSupported()) buttons.push(this.button('Gå inn i VR', 'tutorial-vr', () => this.actions.enterVR(), 'primary'));
    } else if (!s.done) {
      buttons.push(
        step.until
          ? this.button('Hopp over', 'tutorial-skip', () => this.tutorial.next(), 'secondary')
          : this.button(last ? 'Ferdig' : 'Neste', 'tutorial-next', () => this.tutorial.next(), 'primary'),
      );
    }
    buttons.push(this.button('Avslutt', 'tutorial-stop', () => this.tutorial.stop(), 'link'));
    const text =
      s.track === 'vr'
        ? `${step.text} Opplæringen fortsetter på håndleddet når du er i VR.`
        : step.text;
    this.root.replaceChildren(
      h('div', { class: 'tutorial-kicker' }, kicker),
      h('h2', { class: 'tutorial-title', 'data-testid': 'tutorial-title' }, s.done ? `✓ ${step.title}` : step.title),
      h('p', {}, text),
      h('div', { class: 'tutorial-buttons' }, ...buttons),
    );
    this.root.classList.toggle('done', s.done);
    if (s.track === 'pc' && !s.done && step.target) this.highlight(step.target);
  }

  private highlight(testId: string): void {
    const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    if (!el) return;
    // En avkrysningsboks: ringen rundt hele valget (med teksten).
    const ring = el.closest<HTMLElement>('label') ?? el;
    ring.classList.add('tutorial-target');
    this.target = ring;
    // Panelet kan være lukket (mobil): åpne det, så man ser hva steget gjelder.
    ring.closest('.panel')?.classList.remove('collapsed');
    ring.scrollIntoView({ block: 'nearest' });
  }

  private button(label: string, testId: string, onClick: () => void, kind: 'primary' | 'secondary' | 'link'): HTMLButtonElement {
    const b = h('button', { class: `start-btn small ${kind}`, 'data-testid': testId, type: 'button' }, label);
    b.addEventListener('click', onClick);
    return b;
  }
}
