/**
 * Panelet for «Lag ny modell»: start (tom, fra nåværende modell, fra fil,
 * oppmåling i gjennomsyn), verktøy, egenskaper for det som er valgt, sjekk
 * av modellen og lagring. Alle knapper er store nok for laserpekeren på
 * Quest, og alt kan gjøres uten tastatur.
 *
 * Felter lagres når man trykker Enter eller går ut av feltet, så det man
 * skriver aldri blir avbrutt.
 */
import { TOOL_TEXT, type BuilderEditor, type BuilderSelection, type BuilderTool } from '../builder/BuilderEditor';
import type { BuildIssue, CompileResult } from '../builder/compile';
import { defaultInto } from '../builder/compile';
import { OPEN_GAP, SKEW_MAX_DEG } from '../builder/walls';
import { edgesOf, type Edge } from '../builder/geometry';
import { leftOf } from '../geometry/math2d';
import { distributeEvenly, linkedEdges, setEdgeLength, setEntrance } from '../builder/ops';
import { ROOM_NAMES, floorColorFor, type BOpening, type BRoom, type BuilderDoc } from '../builder/types';
import { formatArea, formatLength, parseLength } from '../builder/units';
import type { BackdropState } from './BuilderBackdrop';
import { polygonArea } from '../geometry/math2d';
import type { WallMaterial } from '../schema/types';
import { h } from './dom';

export interface BuilderActions {
  startBlank(): void;
  startFromCurrent(): void;
  /** Den forrige tegningen (før en ny ble startet eller den ble forkastet), eller null. */
  previous(): { name: string; rooms: number } | null;
  restorePrevious(): void;
  openDraftFile(file: File): void;
  /** Oppmåling i gjennomsyn (Quest 3). */
  capture(): void;
  /** Støtter nettleseren gjennomsyn? (null = sjekker) */
  arSupport(): boolean | null;
  vrSupport(): boolean;
  walkVR(): void;
  close(): void;
  download(): void;
  copy(): Promise<boolean>;
  uploadUrl(): string;
  saveDraftFile(): void;
  fit(): void;
  /** Vis det en melding gjelder (velg og flytt kameraet dit). */
  show(target: NonNullable<BuildIssue['target']>): void;
  /** Bytt mellom å tegne (2D ovenfra) og å se på modellen i 3D. */
  toggle3d(): void;
  is3d(): boolean;
  /** Bakgrunnsbilde (skisse eller plantegning) å tegne oppå. */
  backdrop: BackdropActions;
}

export interface BackdropActions {
  state(): BackdropState | null;
  /** Bildet fikk ikke plass i nettleserens lagring. */
  unsaved(): boolean;
  load(file: File): void;
  mode(): 'calibrate' | 'move' | null;
  /** Avstanden mellom de to klikkede punktene (mm), når begge er satt. */
  calibDistance(): number | null;
  calibrate(): void;
  move(): void;
  applyCalibration(mm: number): void;
  setOpacity(v: number): void;
  toggleVisible(): void;
  remove(): void;
  subscribe(fn: () => void): void;
}

const TOOLS: { tool: BuilderTool; key: string }[] = [
  { tool: 'select', key: 'S' },
  { tool: 'rect', key: 'R' },
  { tool: 'poly', key: 'M' },
  { tool: 'beside', key: 'I' },
  { tool: 'door', key: 'D' },
  { tool: 'window', key: 'V' },
  { tool: 'passage', key: 'O' },
];

const MATERIAL_TEXT: Record<WallMaterial, string> = { brick: 'Mur', concrete: 'Betong', drywall: 'Gips/lettvegg', wood: 'Tre', other: 'Annet' };

/** Et tekstfelt for mål (godtar «2,3 m», «230 cm», «2300», «+150»). */
function lengthInput(
  testid: string,
  value: number | null,
  commit: (mm: number, relative: boolean) => void,
  placeholder = '',
  /** Etter Enter (når målet er godtatt): f.eks. gå til neste felt. */
  onEnter?: () => void,
  /** Koordinat eller nivå: «-1100» er en verdi, ikke «trekk fra» (se parseLength). */
  signed = false,
): HTMLInputElement {
  // Quest-tastaturet og mobiler: «decimal» har ikke minustegn, så koordinatfelt får vanlig tastatur.
  const i = h('input', { type: 'text', inputmode: signed ? 'text' : 'decimal', class: 'len-input', 'data-testid': testid, placeholder, autocomplete: 'off', enterkeyhint: onEnter ? 'next' : 'done' });
  if (signed) i.title = 'Negative tall er lov. Legg til med «+=150», trekk fra med «-=150».';
  if (value !== null) i.value = String(Math.round(value));
  let last = i.value;
  const go = (): boolean => {
    const v = parseLength(i.value, signed);
    if (!v) {
      i.classList.toggle('invalid', !!i.value.trim());
      return false;
    }
    i.classList.remove('invalid');
    // Samme tekst to ganger (Enter og så «change», eller uendret felt) gjelder bare én gang.
    if (i.value === last) return true;
    last = i.value;
    commit(v.mm, v.relative);
    return true;
  };
  i.addEventListener('change', () => void go());
  i.addEventListener('focus', () => (last = i.value));
  i.addEventListener('keydown', (e) => {
    e.stopPropagation(); // tastene skal ikke bli hurtigtaster mens man skriver
    if (e.key === 'Escape') i.blur();
    if (e.key === 'Enter') {
      e.preventDefault();
      if (go()) onEnter?.();
    }
  });
  return i;
}

/** Fritekst (notat). Lagres når feltet forlates; tomt felt fjerner notatet. */
function noteInput(testid: string, value: string | undefined, commit: (text: string) => void): HTMLTextAreaElement {
  const t = h('textarea', { class: 'note-input', rows: '2', 'data-testid': testid, placeholder: 'Valgfritt' });
  t.value = value ?? '';
  t.addEventListener('keydown', (e) => {
    e.stopPropagation(); // tastene skal ikke bli hurtigtaster mens man skriver
    if (e.key === 'Escape') t.blur();
  });
  t.addEventListener('change', () => {
    const v = t.value.trim();
    if (v !== (value ?? '')) commit(v);
  });
  return t;
}

const DIM_TEXT = { length: 'lengde', width: 'bredde', height: 'takhøyde' } as const;

/** Felt for en koordinat eller et nivå (negative tall er vanlige verdier). */
const coordInput = (testid: string, value: number, commit: (mm: number, relative: boolean) => void): HTMLInputElement =>
  lengthInput(testid, value, commit, '', undefined, true);

const field = (label: string, el: HTMLElement, hint?: string): HTMLElement =>
  h('label', { class: 'field bfield' }, h('span', {}, label), el, ...(hint ? [h('small', { class: 'hint' }, hint)] : []));

const button = (text: string, testid: string, onClick: () => void, cls = 'small'): HTMLButtonElement => {
  const b = h('button', { class: cls, 'data-testid': testid, type: 'button' }, text);
  b.addEventListener('click', onClick);
  return b;
};

/** Hvilken ende av kanten som er «venstre» sett fra innsiden av rommet mot veggen. */
function leftIsStart(e: Edge): boolean {
  // Står man i rommet og ser mot veggen, ser man i retning `out`; venstre hånd peker leftOf(out).
  const l = leftOf(e.out);
  return l.x * e.u.x + l.z * e.u.z < 0;
}

export class BuilderPanel {
  readonly root: HTMLElement;
  private readonly start: HTMLElement;
  private readonly work: HTMLElement;
  private readonly name: HTMLInputElement;
  private readonly toolButtons = new Map<BuilderTool, HTMLButtonElement>();
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly deleteBtn: HTMLButtonElement;
  private readonly freeBtn: HTMLButtonElement;
  private readonly message: HTMLElement;
  private readonly context: HTMLElement;
  private readonly issues: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly output: HTMLElement;
  private readonly upload: HTMLAnchorElement;
  private readonly captureBtn: HTMLButtonElement;
  private readonly captureMore: HTMLButtonElement;
  private readonly vrBtn: HTMLButtonElement;
  private readonly copyBtn: HTMLButtonElement;
  private readonly downloadBtn: HTMLButtonElement;
  private readonly settings: HTMLElement;
  private readonly backdropBox: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly previousBtn: HTMLButtonElement;
  private readonly viewBtn: HTMLButtonElement;
  private contextKey = '';
  private contextDoc: BuilderDoc | null = null;
  private settingsKey = '';
  private checkKey: CompileResult | null | undefined = undefined;
  private lastDraftLen = -1;
  /** Feltet som skal ha fokus etter at panelet er bygget på nytt (Enter/Tab). */
  private refocus: string | null = null;
  /** Feltet tall skal skrives i når man begynner å skrive i planen (lengde i mangekant, bredde i rektangel). */
  private typeTarget: HTMLInputElement | null = null;
  /** Sist brukte mål for rektangel. */
  private rectSize = { w: 4000, d: 3000 };

  constructor(
    private readonly editor: BuilderEditor,
    private readonly actions: BuilderActions,
    private readonly compiled: () => CompileResult | null,
  ) {
    const file = h('input', { type: 'file', accept: '.json,application/json', hidden: '', 'data-testid': 'builder-open-file' });
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (f) actions.openDraftFile(f);
      file.value = '';
    });
    const openFile = (): void => file.click();
    // Fra arbeidsflaten: den åpne tegningen byttes ut (den kan hentes igjen som «forrige tegning»).
    const openFileReplacing = (): void => {
      if (editor.doc?.rooms.length && !confirm('Åpne en annen tegning? Den du har nå, kan hentes igjen med «Hent forrige tegning».')) return;
      file.click();
    };
    this.previousBtn = button('Hent forrige tegning', 'builder-previous', () => actions.restorePrevious(), 'small big');

    this.captureBtn = button('Mål opp i gjennomsyn (Quest)', 'builder-capture', () => actions.capture(), 'small big');
    this.notice = h('p', { class: 'draft-ok', 'data-testid': 'builder-notice', hidden: '' });
    this.start = h(
      'div',
      { class: 'builder-start', 'data-testid': 'builder-start' },
      this.notice,
      h(
        'p',
        { class: 'hint' },
        'Tegn leiligheten selv – rom, dører og vinduer – eller mål den opp med Quest 3 ved å berøre veggene. Veggene lages automatisk der rommene møtes.',
      ),
      h(
        'div',
        { class: 'builder-big' },
        button('Ny tom modell', 'builder-new', () => actions.startBlank(), 'small primary-small big'),
        button('Start fra nåværende modell', 'builder-from-current', () => actions.startFromCurrent(), 'small big'),
        this.captureBtn,
        button('Åpne tegning fra fil …', 'builder-open', openFile, 'small big'),
        this.previousBtn,
      ),
      h('p', { class: 'hint small-print' }, '«Start fra nåværende modell» tar med installasjoner, møbler, kabler og rør. Da kan du legge til og fjerne hjørner, rom, dører og vinduer – det oppmålingen ikke kan.'),
    );

    // Arbeidsflaten.
    this.name = h('input', { type: 'text', class: 'name-input', 'data-testid': 'builder-name', placeholder: 'Navn på modellen' });
    this.name.addEventListener('keydown', (e) => e.stopPropagation());
    this.name.addEventListener('change', () => {
      const v = this.name.value.trim();
      if (v) editor.session.apply((d) => void (d.name = v));
    });
    const tools = h('div', { class: 'builder-tools', role: 'toolbar' });
    for (const t of TOOLS) {
      const b = button(`${TOOL_TEXT[t.tool]}`, `builder-tool-${t.tool}`, () => editor.tool.set(t.tool));
      b.title = `${TOOL_TEXT[t.tool]} (${t.key})`;
      b.append(h('kbd', {}, t.key));
      this.toolButtons.set(t.tool, b);
      tools.append(b);
    }
    this.undoBtn = button('Angre', 'builder-undo', () => editor.session.undo());
    this.redoBtn = button('Gjør om', 'builder-redo', () => editor.session.redo());
    this.deleteBtn = button('Slett valgt', 'builder-delete', () => editor.deleteSelected(), 'small danger-small');
    this.freeBtn = button('Fri (uten festing)', 'builder-free', () => editor.free.set(!editor.free.value));
    const fit = button('Vis hele', 'builder-fit', () => actions.fit());
    this.viewBtn = button('Se i 3D', 'builder-view', () => actions.toggle3d());
    const straightAll = button('Rett opp alt', 'builder-straighten-all', () => editor.straighten(true));
    this.message = h('p', { class: 'hint builder-message', 'data-testid': 'builder-message', 'aria-live': 'polite' });
    this.context = h('div', { class: 'builder-context', 'data-testid': 'builder-context' });
    this.summary = h('p', { class: 'builder-summary', 'data-testid': 'builder-summary' });
    this.issues = h('ul', { class: 'builder-issues', 'data-testid': 'builder-issues' });

    this.downloadBtn = button('Last ned apartment.json', 'builder-download', () => actions.download(), 'small primary-small');
    this.copyBtn = button('Kopier', 'builder-copy', () => {
      void actions.copy().then((ok) => {
        this.copyBtn.textContent = ok ? 'Kopiert!' : 'Kunne ikke kopiere';
        setTimeout(() => (this.copyBtn.textContent = 'Kopier'), 2000);
      });
    });
    this.upload = h('a', { class: 'button small', 'data-testid': 'builder-upload', target: '_blank', rel: 'noopener' }, 'Last opp til GitHub');
    this.vrBtn = button('Gå gjennom i VR', 'builder-vr', () => actions.walkVR());
    this.captureMore = button('Mål opp i gjennomsyn', 'builder-capture-more', () => actions.capture());
    this.output = h(
      'div',
      { class: 'builder-output' },
      h('div', { class: 'row' }, this.downloadBtn, this.copyBtn, this.upload),
      h(
        'p',
        { class: 'hint' },
        'Slik lagrer du: last ned fila, trykk «Last opp til GitHub», velg fila og trykk «Commit changes». Siden oppdateres etter et par minutter, og da er den nye modellen med.',
      ),
      h('div', { class: 'row' }, this.vrBtn, this.captureMore),
      h(
        'div',
        { class: 'row' },
        button('Lagre tegningen som fil', 'builder-save-draft', () => actions.saveDraftFile()),
        button('Åpne tegning …', 'builder-open-2', openFileReplacing),
      ),
    );
    this.settings = h('div', {});
    const details = h('details', { class: 'builder-settings' }, h('summary', {}, 'Standardvalg'), this.settings);
    this.backdropBox = h('div', { class: 'builder-backdrop-box' });
    const backdropDetails = h(
      'details',
      { class: 'builder-settings', 'data-testid': 'builder-backdrop' },
      h('summary', {}, 'Bakgrunnsbilde (skisse eller plantegning)'),
      this.backdropBox,
    );
    actions.backdrop.subscribe(() => {
      this.renderBackdrop();
      this.update();
    });
    const discard = button(
      'Forkast tegningen',
      'builder-discard',
      () => {
        if (confirm('Forkaste tegningen av den nye modellen? Den kan hentes igjen med «Hent forrige tegning» (til en annen tegning forkastes).')) editor.session.discard();
      },
      'link danger',
    );

    this.work = h(
      'div',
      { class: 'builder-work', 'data-testid': 'builder-work' },
      field('Navn', this.name),
      tools,
      h('div', { class: 'row' }, this.undoBtn, this.redoBtn, this.deleteBtn, this.freeBtn, fit, straightAll, this.viewBtn),
      this.message,
      this.context,
      h('h2', { class: 'sub' }, 'Sjekk'),
      this.summary,
      this.issues,
      h('h2', { class: 'sub' }, 'Lagre'),
      this.output,
      backdropDetails,
      details,
      discard,
    );

    const close = button('Lukk', 'builder-close', () => actions.close(), 'small');
    this.root = h(
      'div',
      { class: 'group builder', 'data-testid': 'builder' },
      h('div', { class: 'builder-head' }, h('h2', {}, 'Lag ny modell'), close),
      this.start,
      this.work,
      file,
    );

    editor.message.subscribe((m) => (this.message.textContent = m));
    // Utkastet (punktene i en mangekant) endres uten at tegningen endres.
    editor.version.subscribe(() => {
      if (editor.draft.length !== this.lastDraftLen) this.update();
    });
    this.context.addEventListener('keydown', (e) => this.fieldKey(e), true);
    // Et valg i en nedtrekksliste lagres med en gang: behold fokus i lista etterpå.
    this.context.addEventListener(
      'change',
      (e) => {
        const t = e.target;
        if (!(t instanceof HTMLSelectElement) || !t.dataset.testid) return;
        this.refocus = t.dataset.testid;
        setTimeout(() => (this.refocus = null), 0);
      },
      true,
    );
    editor.tool.subscribe(() => this.update());
    editor.selection.subscribe(() => this.update());
    editor.free.subscribe(() => this.update());
    editor.session.subscribe(() => this.update());
    this.update();
    this.renderBackdrop();
  }

  /** Bakgrunnsbildet: velg, målestokk (to klikk + virkelig avstand), flytt, gjennomsiktighet, skjul og fjern. */
  private renderBackdrop(): void {
    const b = this.actions.backdrop;
    const s = b.state();
    const box = this.backdropBox;
    box.replaceChildren();
    const file = h('input', { type: 'file', accept: 'image/*', hidden: '', 'data-testid': 'builder-backdrop-file' });
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (f) b.load(f);
      file.value = '';
    });
    const choose = button(s ? 'Bytt bilde …' : 'Velg bilde …', 'builder-backdrop-choose', () => file.click());
    if (!s) {
      box.append(
        h('p', { class: 'hint' }, 'Legg en skisse eller en plantegning (f.eks. fra salgsoppgaven) under planen og tegn rommene oppå. Bildet lagres bare i denne nettleseren.'),
        h('div', { class: 'row' }, choose),
        file,
      );
      return;
    }
    const mode = b.mode();
    const opacity = h('input', { type: 'range', min: '10', max: '100', step: '5', 'data-testid': 'builder-backdrop-opacity' });
    opacity.value = String(Math.round(s.opacity * 100));
    opacity.addEventListener('change', () => b.setOpacity(Number(opacity.value) / 100));
    const calib = button(mode === 'calibrate' ? 'Avbryt målestokk' : 'Sett målestokk', 'builder-backdrop-calibrate', () => b.calibrate());
    calib.setAttribute('aria-pressed', String(mode === 'calibrate'));
    const move = button(mode === 'move' ? 'Ferdig å flytte' : 'Flytt bildet', 'builder-backdrop-move', () => b.move());
    move.setAttribute('aria-pressed', String(mode === 'move'));
    box.append(
      h('p', { class: 'hint' }, `Bildet er ${formatLength(s.w * s.mmPerPx)} bredt i planen.${b.unsaved() ? ' Det er for stort til å huskes etter omlasting.' : ''}`),
      h('label', { class: 'field bfield' }, h('span', {}, 'Synlighet'), opacity),
      h('div', { class: 'row' }, calib, move),
    );
    const d = b.calibDistance();
    if (mode === 'calibrate' && d !== null) {
      const real = lengthInput('builder-backdrop-real', null, (mm) => b.applyCalibration(mm), 'f.eks. 3,4 m');
      box.append(
        h('p', { class: 'hint' }, `Avstanden mellom punktene er ${formatLength(d)} i bildet nå. Hvor langt er det i virkeligheten?`),
        h('div', { class: 'row' }, real, button('Bruk', 'builder-backdrop-apply', () => real.dispatchEvent(new Event('change')), 'small primary-small')),
      );
      queueMicrotask(() => real.focus());
    } else if (mode === 'calibrate') box.append(h('p', { class: 'hint' }, 'Klikk to punkter i bildet der du kjenner avstanden.'));
    box.append(
      h(
        'div',
        { class: 'row' },
        button(s.visible ? 'Skjul' : 'Vis', 'builder-backdrop-toggle', () => b.toggleVisible()),
        choose,
        button('Fjern bildet', 'builder-backdrop-remove', () => b.remove(), 'small danger-small'),
      ),
      file,
    );
  }

  /** Oppdaterer panelet (kalles når tegning, verktøy eller utvalg endres). */
  update(): void {
    const ed = this.editor;
    const doc = ed.doc;
    this.start.hidden = !!doc;
    this.work.hidden = !doc;
    const ar = this.actions.arSupport();
    this.captureBtn.disabled = ar !== true;
    this.captureBtn.textContent = ar === true ? 'Mål opp i gjennomsyn' : ar === null ? 'Mål opp i gjennomsyn (sjekker …)' : 'Mål opp i gjennomsyn (bare på Quest 3)';
    this.captureBtn.classList.toggle('primary-small', ar === true);
    const prev = doc ? null : this.actions.previous();
    this.previousBtn.hidden = !prev;
    if (prev) this.previousBtn.textContent = `Hent forrige tegning («${prev.name}», ${prev.rooms} rom)`;
    this.lastDraftLen = ed.draft.length;
    if (!doc) return;
    this.notice.hidden = true;
    const in3d = this.actions.is3d();
    this.viewBtn.textContent = in3d ? 'Tegn (2D)' : 'Se i 3D';
    this.viewBtn.setAttribute('aria-pressed', String(in3d));
    if (document.activeElement !== this.name) this.name.value = doc.name;
    for (const [t, b] of this.toolButtons) b.setAttribute('aria-pressed', String(ed.tool.value === t));
    this.undoBtn.disabled = !ed.session.canUndo;
    this.redoBtn.disabled = !ed.session.canRedo;
    this.deleteBtn.disabled = !ed.selection.value || ed.selection.value.kind === 'edge';
    this.freeBtn.setAttribute('aria-pressed', String(ed.free.value));
    this.captureMore.disabled = ar !== true;
    this.vrBtn.disabled = !this.actions.vrSupport();
    this.upload.href = this.actions.uploadUrl();
    try {
      this.renderContext(doc);
      this.renderCheck(doc);
      this.renderSettings(doc);
    } catch (e) {
      // Panelet skal aldri ta med seg resten av appen: vis feilen og fortsett.
      console.error('Panelet for «Lag ny modell» kunne ikke tegnes', e);
      this.message.textContent = `Noe i tegningen kunne ikke vises: ${(e as Error).message}. «Angre» eller «Forkast tegningen» hjelper.`;
    }
  }

  /* ---------------- egenskaper ---------------- */

  private renderContext(doc: BuilderDoc): void {
    const ed = this.editor;
    const sel = ed.selection.value;
    const tool = ed.tool.value;
    // Bygg feltene på nytt bare når noe er endret (tegningen er en ny kopi ved hver endring).
    const bmode = this.actions.backdrop.mode();
    const key = JSON.stringify({ tool, sel, draft: ed.draft.length, bmode });
    const docRef = tool === 'select' || sel ? doc : null;
    if (key === this.contextKey && docRef === this.contextDoc) return;
    this.contextKey = key;
    this.contextDoc = docRef;
    const c = this.context;
    c.replaceChildren();
    this.typeTarget = null;
    // Etter Enter/Tab i et felt: fokus tilbake i det nye feltet med samme navn.
    const refocus = this.refocus;
    this.refocus = null;
    if (refocus)
      queueMicrotask(() => {
        const el = c.querySelector<HTMLElement>(`[data-testid="${refocus}"]`);
        el?.focus();
        if (el instanceof HTMLInputElement) el.select();
      });
    // Mens bakgrunnsbildet justeres, går klikkene i planen dit (ikke til verktøyet).
    if (bmode) {
      c.append(
        h(
          'p',
          { class: 'hint', 'data-testid': 'builder-backdrop-mode' },
          bmode === 'calibrate'
            ? 'Målestokk for bakgrunnsbildet: klikk to punkter i bildet der du kjenner avstanden, og skriv den under «Bakgrunnsbilde». Esc avbryter.'
            : 'Flytt bakgrunnsbildet: dra i planen. Trykk «Ferdig å flytte» under «Bakgrunnsbilde» når det ligger riktig.',
        ),
      );
      return;
    }
    if (tool === 'rect') {
      let w = this.rectSize.w;
      let d = this.rectSize.d;
      const make = (): void => {
        this.rectSize = { w, d };
        ed.typedRect(w, d);
      };
      const depth = lengthInput('builder-rect-d', d, (v) => (d = Math.abs(v)), '', make);
      const width = lengthInput('builder-rect-w', w, (v) => (w = Math.abs(v)), '', () => {
        depth.focus();
        depth.select();
      });
      this.typeTarget = width;
      c.append(
        h('p', { class: 'hint' }, ed.draft.length ? 'Første hjørne er satt. Skriv målene (Enter), eller klikk det motsatte hjørnet.' : 'Klikk første hjørne i planen – eller skriv målene: rommet starter der pekeren er (eller i 0, 0).'),
        field('Bredde (x)', width),
        field('Dybde (z)', depth),
        h('div', { class: 'row' }, button('Lag rommet', 'builder-rect-make', make, 'small primary-small')),
      );
      this.renderSelection(doc, sel, true);
      return;
    }
    if (tool === 'poly') {
      const len = lengthInput('builder-seg-len', null, (v) => {
        ed.typedSegment(v);
        len.value = '';
      }, 'f.eks. 3,2 m');
      this.typeTarget = ed.draft.length ? len : null;
      const dir = (deg: number, arrow: string, name: string, id: string): HTMLButtonElement => {
        const b = button(arrow, `builder-seg-${id}`, () => {
          const v = parseLength(len.value);
          if (!v || v.mm <= 0) {
            len.classList.add('invalid');
            len.focus();
            return;
          }
          ed.typedSegment(v.mm, deg);
        });
        b.title = `Neste vegg ${name}`;
        b.disabled = !ed.draft.length;
        return b;
      };
      c.append(
        h('p', { class: 'hint' }, ed.draft.length ? `${ed.draft.length} hjørner. Skriv lengden på neste vegg og trykk Enter (i retningen pekeren peker) – eller en pil.` : 'Klikk første hjørne i planen.'),
        field('Lengde', len),
        h('div', { class: 'row dir-row' }, dir(0, '→', 'mot høyre', 'right'), dir(90, '↓', 'ned', 'down'), dir(180, '←', 'mot venstre', 'left'), dir(270, '↑', 'opp', 'up')),
        h(
          'div',
          { class: 'row' },
          button('Ferdig', 'builder-poly-finish', () => ed.finishPoly(), 'small primary-small'),
          button('Angre punkt', 'builder-poly-undo', () => ed.undoPoint()),
          button('Avbryt', 'builder-poly-cancel', () => ed.cancel()),
        ),
      );
      this.renderSelection(doc, sel, true);
      return;
    }
    if (tool === 'beside') {
      c.append(
        h('p', { class: 'hint' }, 'Klikk en kant i et rom. Det nye rommet blir like bredt som kanten.'),
        field('Dybde på nytt rom', lengthInput('builder-beside-depth', ed.besideDepth, (v) => (ed.besideDepth = Math.max(300, v)))),
      );
      this.renderSelection(doc, sel, true);
      return;
    }
    if (tool !== 'select') {
      c.append(h('p', { class: 'hint' }, 'Klikk på en kant (vegg) i et rom. Etterpå kan du justere mål og plassering her.'));
      this.renderSelection(doc, sel, true);
      return;
    }
    if (!sel) {
      c.append(h('p', { class: 'hint' }, doc.rooms.length ? 'Ingenting valgt. Klikk et rom, et hjørne, en kant eller en åpning.' : 'Ingen rom ennå. Velg «Rektangel» (R) og klikk to hjørner – eller skriv bredde og dybde.'));
      return;
    }
    this.renderSelection(doc, sel, false);
  }

  /** Egenskapene til det som er valgt. `below`: under verktøyfeltene (det man nettopp laget). */
  private renderSelection(doc: BuilderDoc, sel: BuilderSelection, below: boolean): void {
    if (!sel) return;
    if (below) this.context.append(h('hr', { class: 'builder-sep' }));
    if (sel.kind === 'opening') {
      const o = doc.openings.find((x) => x.id === sel.id);
      if (o) this.renderOpening(doc, o);
      return;
    }
    const room = doc.rooms.find((r) => r.id === sel.room);
    if (!room) return;
    if (sel.kind === 'edge') this.renderEdge(doc, room, sel.edge);
    else if (sel.kind === 'corner') this.renderCorner(room, sel.i);
    else this.renderRoom(doc, room);
  }

  private apply(fn: (d: BuilderDoc) => void | boolean): void {
    this.editor.session.apply(fn);
  }

  private renderRoom(doc: BuilderDoc, room: BRoom): void {
    const c = this.context;
    const ed = this.editor;
    const names = h('datalist', { id: 'builder-room-names' });
    for (const n of ROOM_NAMES) names.append(h('option', { value: n }));
    const name = h('input', { type: 'text', list: 'builder-room-names', 'data-testid': 'builder-room-name', class: 'name-input' });
    name.value = room.name;
    name.addEventListener('keydown', (e) => e.stopPropagation());
    name.addEventListener('change', () => {
      const v = name.value.trim();
      if (!v) return;
      this.apply((d) => {
        const r = d.rooms.find((x) => x.id === room.id)!;
        // Fargen følger navnet, så lenge den ikke er valgt for hånd.
        if (!r.floorColor || r.floorColor === floorColorFor(r.name)) r.floorColor = floorColorFor(v);
        r.name = v;
      });
    });
    const area = polygonArea(room.polygon);
    const edges = edgesOf(room.polygon);
    const edgeList = h('div', { class: 'edge-list' });
    edges.forEach((e) => {
      const linked = linkedEdges(doc, room.id, e.i).length > 0;
      edgeList.append(
        h(
          'div',
          { class: 'edge-row' },
          button(`Kant ${e.i + 1}`, `builder-room-edge-${e.i}`, () => ed.select({ kind: 'edge', room: room.id, edge: e.i }), 'chip'),
          lengthInput(`builder-edge-len-${e.i}`, e.length, (v, rel) => this.apply((d) => setEdgeLength(d, room.id, e.i, rel ? e.length + v : v))),
          h('small', { class: 'hint' }, linked ? 'skillevegg' : 'yttervegg'),
        ),
      );
    });
    const sloped = (room.ceilingCorners ?? []).some((x) => x !== null && x !== undefined);
    const corners = h('details', { class: 'ceil-corners', ...(sloped ? { open: '' } : {}) }, h('summary', {}, 'Skrått tak (takhøyde i hvert hjørne)'));
    room.polygon.forEach((_, i) => {
      const v = room.ceilingCorners?.[i] ?? null;
      corners.append(
        field(
          `Hjørne ${i + 1}`,
          lengthInput(`builder-ceil-${i}`, v, (mm, rel) =>
            this.apply((d) => {
              const r = d.rooms.find((x) => x.id === room.id)!;
              const arr = r.ceilingCorners ? [...r.ceilingCorners] : r.polygon.map(() => null);
              arr[i] = rel ? (arr[i] ?? r.ceiling) + mm : mm;
              r.ceilingCorners = arr;
            }),
            String(room.ceiling),
          ),
        ),
      );
    });
    if (sloped)
      corners.append(
        button('Flatt tak igjen', 'builder-ceil-flat', () =>
          this.apply((d) => {
            delete d.rooms.find((x) => x.id === room.id)!.ceilingCorners;
          }),
        ),
      );
    c.append(
      names,
      h('p', { class: 'builder-sel' }, `Rom: ${room.name} · ${formatArea(area)} · ${room.polygon.length} hjørner`),
      field('Navn', name),
      field(
        'Gulvnivå (mm)',
        coordInput('builder-room-floor', room.floor, (v, rel) => this.apply((d) => void (d.rooms.find((x) => x.id === room.id)!.floor = rel ? room.floor + v : v))),
        'Høyde over gulvet i det laveste rommet (f.eks. 180 for et trinn opp, -150 for et trinn ned).',
      ),
      field(
        'Takhøyde (mm)',
        lengthInput('builder-room-ceiling', room.ceiling, (v, rel) =>
          this.apply((d) => void (d.rooms.find((x) => x.id === room.id)!.ceiling = Math.max(1000, rel ? room.ceiling + v : v))),
        ),
      ),
      corners,
      field(
        'Notat',
        noteInput('builder-room-note', room.note, (v) =>
          this.apply((d) => {
            const r = d.rooms.find((x) => x.id === room.id)!;
            if (v) r.note = v;
            else delete r.note;
          }),
        ),
      ),
      ...this.dimensionsBlock(room),
      h('p', { class: 'hint' }, 'Kantene (lengde innvendig – skriv nytt mål og trykk Enter):'),
      edgeList,
      this.moveRow(),
      h(
        'div',
        { class: 'row' },
        button('Rett opp rommet', 'builder-straighten', () => ed.straighten(false)),
        button('Kopier rommet', 'builder-room-copy', () => ed.copySelected()),
        button('Roter 90°', 'builder-room-rotate', () => ed.rotateSelected()),
        button('Slett rommet', 'builder-room-delete', () => ed.deleteSelected(), 'small danger-small'),
      ),
    );
  }

  /** «Flytt rommet»: skriv hvor langt (mm, negative tall er lov) og trykk Enter eller «Flytt». */
  private moveRow(): HTMLElement {
    const ed = this.editor;
    const dx = lengthInput('builder-move-x', null, () => undefined, 'x', () => dz.focus(), true);
    const dz = lengthInput('builder-move-z', null, () => undefined, 'z', () => go(), true);
    const go = (): void => {
      const read = (i: HTMLInputElement): number | null => {
        if (!i.value.trim()) return 0;
        const v = parseLength(i.value, true);
        i.classList.toggle('invalid', !v);
        return v ? v.mm : null;
      };
      const x = read(dx);
      const z = read(dz);
      if (x === null || z === null) return;
      if (ed.moveSelectedBy(x, z)) dx.value = dz.value = '';
    };
    return h(
      'div',
      { class: 'move-row' },
      h('span', {}, 'Flytt rommet'),
      dx,
      dz,
      button('Flytt', 'builder-move-go', go),
      h('small', { class: 'hint' }, 'mm mot høyre (x) og nedover (z) i planen; negative tall flytter motsatt vei.'),
    );
  }

  /** Kontrollmålene fra den importerte fila (vises bare når rommet har dem). */
  private dimensionsBlock(room: BRoom): HTMLElement[] {
    const d = room.dimensions;
    if (!d) return [];
    const parts = (['length', 'width', 'height'] as const).flatMap((k) => {
      const v = d[k];
      if (v === undefined) return [];
      const n = typeof v === 'number' ? v : v.value;
      const measured = typeof v !== 'number' && v.measured;
      return [`${DIM_TEXT[k]} ${formatLength(n)}${measured ? ' (målt)' : ''}`];
    });
    return [
      h(
        'p',
        { class: 'hint', 'data-testid': 'builder-room-dims' },
        `Kontrollmål fra fila: ${parts.join(' · ')}. Stemmer ikke rommet med dem, står det i sjekklisten.`,
      ),
      h(
        'div',
        { class: 'row' },
        button('Fjern kontrollmålene', 'builder-room-dims-remove', () =>
          this.apply((x) => {
            delete x.rooms.find((r) => r.id === room.id)!.dimensions;
          }),
        ),
      ),
    ];
  }

  private renderEdge(doc: BuilderDoc, room: BRoom, edge: number): void {
    const c = this.context;
    const ed = this.editor;
    const e = edgesOf(room.polygon)[edge];
    if (!e) return;
    const linked = linkedEdges(doc, room.id, edge);
    const opt = room.edges?.[edge] ?? null;
    const setOpt = (patch: { thickness?: number; material?: WallMaterial }): void =>
      this.apply((d) => {
        const r = d.rooms.find((x) => x.id === room.id)!;
        const arr = r.edges ? [...r.edges] : r.polygon.map(() => null);
        arr[edge] = { ...(arr[edge] ?? {}), ...patch };
        r.edges = arr;
      });
    const material = h('select', { 'data-testid': 'builder-edge-material' });
    for (const [k, v] of Object.entries(MATERIAL_TEXT)) material.append(h('option', { value: k }, v));
    material.value = opt?.material ?? (linked.length ? 'drywall' : 'brick');
    material.addEventListener('change', () => setOpt({ material: material.value as WallMaterial }));
    const add = (type: 'door' | 'window' | 'passage'): void => {
      const was = ed.tool.value;
      ed.tool.set(type);
      ed.click({ x: e.a.x + (e.u.x * e.length) / 2, z: e.a.z + (e.u.z * e.length) / 2 }, 1, true);
      // Tilbake til verktøyet man hadde, men behold beskjeden om det som ble satt inn.
      const msg = ed.message.value;
      ed.tool.set(was);
      ed.message.set(msg);
    };
    c.append(
      h('p', { class: 'builder-sel' }, `Kant ${edge + 1} i «${room.name}» · ${linked.length ? 'skillevegg mot nabo' : 'yttervegg'}`),
      field('Lengde', lengthInput('builder-edge-length', e.length, (v, rel) => this.apply((d) => setEdgeLength(d, room.id, edge, rel ? e.length + v : v)))),
      ...(linked.length
        ? [
            field(
              'Skilleveggens tykkelse',
              lengthInput('builder-edge-partition', this.gapTo(doc, room.id, edge), (v, rel) => {
                const now = this.gapTo(doc, room.id, edge);
                ed.setPartition(room.id, edge, Math.max(OPEN_GAP, Math.min(doc.settings.maxWallGap, rel ? now + v : v)));
              }),
              `Naborommet flyttes. Dras kanten, følger naborommet med, så veggen beholder tykkelsen.`,
            ),
          ]
        : [
            field(
              'Ytterveggens tykkelse',
              lengthInput('builder-edge-thickness', opt?.thickness ?? doc.settings.exteriorThickness, (v) => setOpt({ thickness: Math.max(30, v) })),
            ),
          ]),
      field('Materiale', material),
      h(
        'div',
        { class: 'row' },
        button('Nytt hjørne midt på', 'builder-split', () => ed.splitSelectedEdge()),
        button('Dør her', 'builder-edge-door', () => add('door')),
        button('Vindu her', 'builder-edge-window', () => add('window')),
        button('Åpning her', 'builder-edge-passage', () => add('passage')),
        button('Fordel vinduer jevnt', 'builder-distribute', () => this.apply((d) => distributeEvenly(d, room.id, edge) > 0)),
      ),
    );
  }

  private gapTo(doc: BuilderDoc, roomId: string, edge: number): number {
    const res = this.compiled();
    const w = res?.walls.walls.find((x) => x.sources.some((s) => s.room === roomId && s.edge === edge));
    return w?.thickness ?? doc.settings.interiorThickness;
  }

  private renderCorner(room: BRoom, i: number): void {
    const c = this.context;
    const p = room.polygon[i];
    if (!p) return;
    c.append(
      h('p', { class: 'builder-sel' }, `Hjørne ${i + 1} i «${room.name}»${p.m ? ' · målt' : ''}`),
      field('x (mm)', coordInput('builder-corner-x', p.x, (v, rel) => this.apply((d) => void (d.rooms.find((r) => r.id === room.id)!.polygon[i]!.x = rel ? p.x + v : v)))),
      field('z (mm)', coordInput('builder-corner-z', p.z, (v, rel) => this.apply((d) => void (d.rooms.find((r) => r.id === room.id)!.polygon[i]!.z = rel ? p.z + v : v)))),
      h('p', { class: 'hint' }, 'Dra hjørnet i planen, eller skriv koordinatene (negative tall er lov; «+=150» flytter 150 mm). Hjørnet fester seg til andre rom og hjelpelinjer.'),
      h('div', { class: 'row' }, button('Fjern hjørnet', 'builder-corner-delete', () => this.editor.deleteSelected(), 'small danger-small')),
    );
  }

  private renderOpening(doc: BuilderDoc, o: BOpening): void {
    const c = this.context;
    const room = doc.rooms.find((r) => r.id === o.room);
    const e = room ? edgesOf(room.polygon)[o.edge] : undefined;
    if (!room || !e) return;
    const set = (fn: (x: BOpening) => void): void =>
      this.apply((d) => {
        const x = d.openings.find((q) => q.id === o.id);
        if (x) fn(x);
      });
    const startLeft = leftIsStart(e);
    const fromStart = o.offset;
    const fromEnd = e.length - o.offset - o.width;
    const leftVal = startLeft ? fromStart : fromEnd;
    const rightVal = startLeft ? fromEnd : fromStart;
    const setLeft = (v: number): void =>
      set((x) => {
        const val = Math.max(0, Math.min(e.length - x.width, v));
        x.offset = startLeft ? val : e.length - x.width - val;
      });
    const setRight = (v: number): void => setLeft(e.length - o.width - v);
    const type = h('select', { 'data-testid': 'builder-opening-type' });
    for (const [k, v] of [
      ['door', 'Dør'],
      ['window', 'Vindu'],
      ['passage', 'Åpning (uten dør)'],
    ] as const)
      type.append(h('option', { value: k }, v));
    type.value = o.type;
    type.addEventListener('change', () =>
      set((x) => {
        x.type = type.value as BOpening['type'];
        if (x.type === 'window') x.sill ??= 900;
        if (x.type !== 'door') delete x.entrance;
      }),
    );
    const rows: HTMLElement[] = [
      h('p', { class: 'builder-sel' }, `${o.type === 'door' ? (o.entrance ? 'Inngangsdør' : 'Dør') : o.type === 'window' ? 'Vindu' : 'Åpning'} i «${room.name}», kant ${o.edge + 1}`),
      field('Type', type),
      field('Fra venstre hjørne', lengthInput('builder-op-left', leftVal, (v, rel) => setLeft(rel ? leftVal + v : v)), 'Sett fra rommet, mot veggen.'),
      field('Bredde', lengthInput('builder-op-width', o.width, (v, rel) => set((x) => void (x.width = Math.max(200, Math.min(e.length - x.offset, rel ? o.width + v : v)))))),
      field('Fra høyre hjørne', lengthInput('builder-op-right', rightVal, (v, rel) => setRight(rel ? rightVal + v : v))),
      field('Høyde', lengthInput('builder-op-height', o.height, (v, rel) => set((x) => void (x.height = Math.max(200, rel ? o.height + v : v))))),
    ];
    if (o.type === 'window') rows.push(field('Brystning (fra gulvet)', lengthInput('builder-op-sill', o.sill ?? 900, (v, rel) => set((x) => void (x.sill = Math.max(0, rel ? (o.sill ?? 900) + v : v))))));
    if (o.type === 'door') {
      const res = this.compiled();
      const wall = res?.walls.walls.find((w) => w.sources.some((s) => s.room === o.room && s.edge === o.edge && s.s0 <= o.offset + 1 && s.s1 >= o.offset + o.width - 1)) ?? null;
      const into = h('select', { 'data-testid': 'builder-op-into' });
      const options = [...new Set([o.room, ...(wall?.rooms ?? [])])];
      for (const id of options) into.append(h('option', { value: id }, doc.rooms.find((r) => r.id === id)?.name ?? id));
      into.value = defaultInto(o, wall);
      into.addEventListener('change', () => set((x) => void (x.into = into.value)));
      const hinge = h('select', { 'data-testid': 'builder-op-hinge' }, h('option', { value: 'left' }, 'Venstre'), h('option', { value: 'right' }, 'Høyre'));
      hinge.value = o.hinge ?? 'left';
      hinge.addEventListener('change', () => set((x) => void (x.hinge = hinge.value as 'left' | 'right')));
      const swing = h('select', { 'data-testid': 'builder-op-swing' }, h('option', { value: 'in' }, 'Inn i rommet'), h('option', { value: 'out' }, 'Ut av rommet'));
      swing.value = o.swing ?? 'in';
      swing.addEventListener('change', () => set((x) => void (x.swing = swing.value as 'in' | 'out')));
      rows.push(
        field('Går inn i', into),
        field('Hengsler', hinge, 'Sett av den som går inn.'),
        field('Slår', swing),
        o.entrance
          ? h('p', { class: 'draft-ok', 'data-testid': 'builder-op-is-entrance' }, 'Dette er inngangsdøra. Oppmålingen starter i hjørnet ved den.')
          : button('Gjør til inngangsdør', 'builder-op-entrance', () => this.apply((d) => setEntrance(d, o.id)), 'small primary-small'),
      );
    }
    rows.push(
      field(
        'Notat',
        noteInput('builder-op-note', o.note, (v) =>
          set((x) => {
            if (v) x.note = v;
            else delete x.note;
          }),
        ),
      ),
      h('div', { class: 'row' }, button('Slett', 'builder-op-delete', () => this.editor.deleteSelected(), 'small danger-small')),
    );
    c.append(...rows);
  }

  /* ---------------- sjekk og lagring ---------------- */

  private renderCheck(doc: BuilderDoc): void {
    const res = this.compiled();
    if (res === this.checkKey) return;
    this.checkKey = res;
    const issues = res?.issues ?? [];
    const errors = issues.filter((i) => i.severity === 'error');
    const area = doc.rooms.reduce((s, r) => s + (r.polygon.length >= 3 ? polygonArea(r.polygon) : 0), 0);
    const walls = res?.walls.walls.length ?? 0;
    this.summary.textContent = `${doc.rooms.length} rom · ${formatArea(area)} · ${walls} vegger · ${doc.openings.length} dører/vinduer/åpninger`;
    this.issues.replaceChildren();
    if (!issues.length && doc.rooms.length) this.issues.append(h('li', { class: 'ok' }, '✓ Modellen er gyldig og klar til å lagres.'));
    for (const i of issues) {
      const li = h('li', { class: i.severity }, i.severity === 'error' ? '✗ ' : '⚠ ', i.message);
      if (i.target) li.append(' ', button('Vis', `builder-issue-show-${i.target.id}`, () => this.actions.show(i.target!), 'link'));
      if (i.fix) li.append(' ', button(i.fix.label, `builder-fix-${i.fix.id}`, () => this.fix(i.fix!.id), 'link'));
      this.issues.append(li);
    }
    this.downloadBtn.disabled = errors.length > 0 || !res?.doc;
    this.copyBtn.disabled = this.downloadBtn.disabled;
    this.upload.classList.toggle('disabled', this.downloadBtn.disabled);
  }

  /** Rettelsene i sjekklista (ett trykk). */
  private fix(id: NonNullable<BuildIssue['fix']>['id']): void {
    // Skjeve rom: rett opp alle kanter som er nesten rette (opptil 10° skjeve).
    if (id === 'straighten-all') return this.editor.straighten(true, SKEW_MAX_DEG + 1);
    this.apply((d) => {
      if (id === 'entrance') {
        // Helst en dør i en yttervegg.
        const door = d.openings.find((o) => o.type === 'door' && !linkedEdges(d, o.room, o.edge).length) ?? d.openings.find((o) => o.type === 'door');
        if (!door) return false;
        setEntrance(d, door.id);
        this.editor.select({ kind: 'opening', id: door.id });
        return true;
      }
      const first = d.openings.find((o) => o.type === 'door' && o.entrance);
      if (!first) return false;
      setEntrance(d, first.id);
      return true;
    });
  }

  private renderSettings(doc: BuilderDoc): void {
    const s = doc.settings;
    const key = JSON.stringify(s);
    if (key === this.settingsKey) return;
    this.settingsKey = key;
    const set = (k: keyof BuilderDoc['settings']) => (v: number): void => this.apply((d) => void (d.settings[k] = Math.max(1, v)));
    this.settings.replaceChildren(
      field('Yttervegger (mm)', lengthInput('builder-set-exterior', s.exteriorThickness, set('exteriorThickness'))),
      field('Skillevegger for «Rom inntil» (mm)', lengthInput('builder-set-interior', s.interiorThickness, set('interiorThickness'))),
      field('Takhøyde for nye rom (mm)', lengthInput('builder-set-ceiling', s.defaultCeiling, set('defaultCeiling'))),
      field('Største luke som blir vegg (mm)', lengthInput('builder-set-gap', s.maxWallGap, set('maxWallGap'))),
      h('p', { class: 'hint' }, 'Rom med en luke mellom seg (inntil «største luke») får en skillevegg i luka. Rom kant i kant (ingen luke) har en åpen overgang uten vegg.'),
    );
  }

  /**
   * Enter og Tab i feltene: målet lagres, panelet bygges på nytt, og fokus
   * havner i det nye feltet (Enter) eller det neste (Tab) – ikke i lufta.
   */
  private fieldKey(e: KeyboardEvent): void {
    const t = e.target;
    if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement)) return;
    const id = t.dataset.testid;
    if (!id) return;
    if (e.key === 'Enter') {
      // Feltets egen Enter-lytter lagrer etterpå; nullstill først når hendelsen er ferdig
      // (mikrooppgaver kjøres mellom lytterne, så de er for tidlige her).
      this.refocus = id;
      setTimeout(() => (this.refocus = null), 0);
      return;
    }
    if (e.key !== 'Tab' || !(t instanceof HTMLInputElement)) return;
    e.preventDefault();
    this.refocus = id;
    t.dispatchEvent(new Event('change'));
    this.refocus = null;
    const fields = (): HTMLElement[] => [...this.context.querySelectorAll<HTMLElement>('input, select, button, summary')].filter((x) => !x.hidden && !(x as HTMLButtonElement).disabled);
    // Etter en ny oppbygging er det gamle feltet borte: finn det nye med samme navn.
    const cur = t.isConnected ? t : this.context.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const list = fields();
    const i = cur ? list.indexOf(cur) : -1;
    const next = list[i + (e.shiftKey ? -1 : 1)] ?? null;
    queueMicrotask(() => {
      next?.focus();
      if (next instanceof HTMLInputElement) next.select();
    });
  }

  /** Feltet et tall skal skrives i når man begynner å skrive mens man tegner (eller null). */
  lengthTarget(): HTMLInputElement | null {
    const t = this.typeTarget;
    return t && t.isConnected && !this.root.hidden ? t : null;
  }

  /** Beskjed på startsiden (f.eks. at den nye modellen er publisert, eller at en fil ikke kunne åpnes). */
  showNotice(text: string | null, kind: 'ok' | 'error' = 'ok'): void {
    this.notice.hidden = !text;
    this.notice.textContent = text ?? '';
    this.notice.className = kind === 'ok' ? 'draft-ok' : 'draft-ok draft-error-box';
  }
}
