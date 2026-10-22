/**
 * «Lag ny modell» i appen: panelet, overlegget i 2D-planen, forhåndsvisningen
 * i 3D og VR, hurtigtastene og lagringen.
 *
 * Appen eier modellen som vises. Kontrolleren sier fra hva som skal vises:
 * tegningen som modell (når den er gyldig), en tom plan (ingen rom ennå),
 * eller vanlig visning (fila/utkastet) når byggeren lukkes. Har tegningen
 * feil, vises den siste gyldige utgaven mens man retter.
 */
import { BuilderEditor, TOOL_KEYS, type BuilderSelection } from '../builder/BuilderEditor';
import { BuilderSession, type Consumed } from '../builder/BuilderSession';
import type { BuildIssue } from '../builder/compile';
import { importApartment } from '../builder/importDoc';
import { emptyBuilderDoc } from '../builder/types';
import { formatLength } from '../builder/units';
import type { ApartmentDoc } from '../schema/types';
import type { ValidationResult } from '../schema/validate';
import { Observable } from '../state/Observable';
import type { KV } from '../state/persist';
import type { CameraMode, ViewState } from '../state/ViewState';
import { BuilderBackdrop } from '../ui/BuilderBackdrop';
import { BuilderOverlay, coarsePointer } from '../ui/BuilderOverlay';
import { BuilderPanel } from '../ui/BuilderPanel';
import { h } from '../ui/dom';
import { isTypingTarget } from '../ui/shortcuts';
import type { DesktopView, Extent } from '../views/DesktopView';
import type { XRManager } from '../xr/XRManager';

/** Husker om byggeren var åpen (så den åpnes igjen etter omlasting). */
export const BUILDER_OPEN_KEY = 'leilighet:ny-modell:open';

export interface BuilderHost {
  readonly view: ViewState;
  readonly desktop: DesktopView;
  readonly xr: XRManager;
  readonly canvas: HTMLElement;
  /**
   * Modellen slik den vises nå (fila/utkastet med tegningene som passer), og
   * de lokale endringene som da blir med (se Consumed).
   */
  importSource(): { doc: ApartmentDoc; consumed: Consumed } | null;
  /** Vis tegningen som modell (allerede validert). */
  showPreview(result: ValidationResult): void;
  /** Ingen rom ennå: skjul modellen (rutenettet står). */
  showEmpty(): void;
  /** Vanlig visning igjen (fila eller utkastet). */
  restore(): void;
  helpOpen(): boolean;
  download(text: string, filename: string): void;
  copy(text: string): Promise<boolean>;
  uploadUrl(): string;
  /** Oppmåling av ny modell i gjennomsyn (Quest 3). */
  capture(): void;
}

const DEFAULT_EXTENT: Extent = { minX: 0, maxX: 8000, minZ: 0, maxZ: 6000 };

/** Filnavn for tegningen (bare trygge tegn). */
const draftFileName = (name: string): string =>
  `${(name.trim() || 'ny-modell').toLowerCase().replace(/[æ]/g, 'ae').replace(/[ø]/g, 'o').replace(/[å]/g, 'a').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'ny-modell'}.tegning.json`;

export class BuilderController {
  readonly session: BuilderSession;
  readonly editor: BuilderEditor;
  readonly overlay: BuilderOverlay;
  readonly panel: BuilderPanel;
  /** Skisse eller plantegning under planen. */
  readonly backdrop: BuilderBackdrop;
  /** Bakgrunnsbildet: sett målestokk (to klikk) eller flytt det (dra). */
  private backdropMode: 'calibrate' | 'move' | null = null;
  private calib: { x: number; z: number }[] = [];
  /** Knappen i hovedpanelet som åpner byggeren (med beskjed når en ny modell er publisert). */
  readonly entry: HTMLElement;
  private readonly entryButton: HTMLButtonElement;
  private readonly entryNotice: HTMLElement;
  /** «Lag ny modell» er åpent. */
  readonly open = new Observable(false);
  /** Hva som vises nå mens byggeren er åpen. */
  private showing: 'model' | 'preview' | 'empty' | null = null;
  /** Fila som sist ble vist som forhåndsvisning (tegningens kompilerte utgave). */
  private previewDoc: ApartmentDoc | null = null;
  private prevMode: CameraMode | null = null;
  private fitPending = false;
  private readonly coarse = coarsePointer();

  constructor(
    private readonly host: BuilderHost,
    private readonly storage: KV | null,
  ) {
    this.session = new BuilderSession(storage);
    this.editor = new BuilderEditor(this.session);
    this.overlay = new BuilderOverlay(host.canvas, this.editor, host.desktop, () => this.session.compiled(false), (px) => this.tolMm(px));
    // Etter overlegget: bildet legges rett over lerretet, under håndtakene.
    this.backdrop = new BuilderBackdrop(host.canvas, host.desktop, storage);
    this.panel = new BuilderPanel(this.editor, {
      startBlank: () => this.startBlank(),
      startFromCurrent: () => this.startFromCurrent(),
      previous: () => {
        const p = this.session.previous();
        return p ? { name: p.name, rooms: p.rooms.length } : null;
      },
      restorePrevious: () => {
        if (!this.session.restorePrevious()) return;
        this.fitPending = true;
        this.refresh(true);
        this.editor.tool.set('select');
        this.editor.selection.set(null);
        this.editor.message.set('Den forrige tegningen er hentet. «Angre» går tilbake til den du hadde.');
      },
      openDraftFile: (f) => void this.openDraftFile(f),
      capture: () => this.capture(),
      arSupport: () => host.xr.arSupport.value,
      vrSupport: () => host.xr.support.value === 'supported' && this.showing === 'preview',
      walkVR: () => void host.xr.enter(),
      close: () => this.setOpen(false),
      download: () => this.download(),
      copy: () => this.copy(),
      uploadUrl: () => host.uploadUrl(),
      saveDraftFile: () => this.saveDraftFile(),
      fit: () => this.fit(),
      show: (t) => this.show(t),
      toggle3d: () => host.view.cameraMode.set(host.view.cameraMode.value === 'top' ? 'orbit' : 'top'),
      is3d: () => host.view.cameraMode.value !== 'top',
      backdrop: {
        state: () => this.backdrop.state,
        unsaved: () => this.backdrop.unsaved,
        load: (f) => void this.loadBackdrop(f),
        mode: () => this.backdropMode,
        calibDistance: () => (this.calib.length === 2 ? Math.hypot(this.calib[1]!.x - this.calib[0]!.x, this.calib[1]!.z - this.calib[0]!.z) : null),
        calibrate: () => this.setBackdropMode(this.backdropMode === 'calibrate' ? null : 'calibrate'),
        move: () => this.setBackdropMode(this.backdropMode === 'move' ? null : 'move'),
        applyCalibration: (mm) => this.applyCalibration(mm),
        setOpacity: (v) => this.backdrop.setOpacity(v),
        toggleVisible: () => this.backdrop.setVisible(!this.backdrop.state?.visible),
        remove: () => {
          this.setBackdropMode(null);
          this.backdrop.remove();
        },
        subscribe: (fn) => void this.backdrop.version.subscribe(fn),
      },
    }, () => this.session.compiled(false));
    this.panel.root.hidden = true;
    this.entryButton = h('button', { class: 'measure-button builder-entry', 'data-testid': 'builder-entry', type: 'button' }, 'Lag ny modell …');
    this.entryButton.addEventListener('click', () => this.setOpen(true));
    this.entryNotice = h('p', { class: 'draft-ok', 'data-testid': 'builder-published', hidden: '' });
    this.entry = h('div', { class: 'builder-entry-wrap' }, this.entryButton, this.entryNotice);

    this.session.subscribe(() => this.onChanged());
    if (this.session.recovered) {
      // En lagret tegning kunne ikke leses: den er lagt til side, og appen starter som normalt.
      this.publishedText = `En lagret tegning kunne ikke leses (${this.session.recovered}) og er lagt til side.`;
      this.panel.showNotice(this.publishedText, 'error');
      this.entryNotice.textContent = this.publishedText;
      this.entryNotice.hidden = false;
    }
    const view = host.view;
    view.cameraMode.subscribe(() => this.updateOverlay());
    view.inXR.subscribe(() => this.updateOverlay());
    host.xr.arSupport.subscribe(() => this.panel.update());
    host.xr.support.subscribe(() => this.panel.update());
    // Etter oppmåling i gjennomsyn: vis hele tegningen i planen.
    host.xr.measuring.subscribe((on, was) => {
      if (on || !was || !this.open.value) return;
      this.fitPending = true;
      this.refresh(true);
    });
    host.xr.error.subscribe((msg) => {
      if (msg && this.open.value) this.notify(msg, true);
    });
    this.bindCanvas();
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    this.updateEntry();
  }

  /** Byggeren bestemmer hva som vises (åpen og med en tegning). */
  get ownsView(): boolean {
    return this.open.value && this.session.doc !== null;
  }

  /** Man tegner i 2D-planen nå (overlegget og pekeren gjelder byggeren). */
  get drawing(): boolean {
    return this.ownsView && this.host.view.cameraMode.value === 'top' && !this.host.view.inXR.value;
  }

  /** Startmenyen: åpner byggeren og fortsetter, eller starter tomt, fra modellen eller med oppmåling. */
  begin(kind: 'continue' | 'blank' | 'current' | 'capture'): void {
    this.setOpen(true);
    if (kind === 'blank') this.startBlank();
    else if (kind === 'current') this.startFromCurrent();
    else if (kind === 'capture') this.capture();
  }

  /** Startmenyen: åpner en fil (en tegning eller en apartment.json) i byggeren. */
  openFile(file: File): void {
    this.setOpen(true);
    void this.openDraftFile(file);
  }

  /** Tegningen som er i arbeid, for startmenyen og «Neste steg» (null = ingen). */
  summary(): { name: string; rooms: number; errors: number; exported: boolean } | null {
    const doc = this.session.doc;
    if (!doc) return null;
    const errors = this.session.compiled()?.issues.filter((i) => i.severity === 'error').length ?? 0;
    return { name: doc.name || 'Ny modell', rooms: doc.rooms.length, errors, exported: this.session.exported };
  }

  /** Var byggeren åpen sist (lagret i nettleseren)? */
  wasOpen(): boolean {
    try {
      return this.storage?.getItem(BUILDER_OPEN_KEY) === '1';
    } catch {
      return false;
    }
  }

  setOpen(on: boolean): void {
    if (on === this.open.value) return;
    const { view, desktop } = this.host;
    try {
      if (on) this.storage?.setItem(BUILDER_OPEN_KEY, '1');
      else this.storage?.removeItem(BUILDER_OPEN_KEY);
    } catch {
      /* lagring utilgjengelig */
    }
    this.open.set(on);
    this.panel.root.hidden = !on;
    if (on) {
      this.prevMode = view.cameraMode.value;
      desktop.gridMargin = 6;
      this.previewDoc = null;
      this.showing = null;
      this.fitPending = true;
      this.entryNotice.hidden = true;
      view.cameraMode.set('top');
      // Verktøylinja ligger over planen, etter sidepanelet (så den kan flyttes forbi panelet i CSS).
      // Den må synes før tegningen tilpasses, så tegningen havner under den.
      this.host.canvas.parentElement?.append(this.panel.toolbar);
      this.panel.update();
      this.refresh(true);
    } else {
      this.editor.cancel();
      this.editor.selection.set(null);
      this.editor.hover = null;
      desktop.gridMargin = 2;
      this.previewDoc = null;
      this.showing = null;
      if (this.prevMode) view.cameraMode.set(this.prevMode);
      desktop.insetTop = 0;
      this.host.restore();
    }
    this.updateOverlay();
    this.updateEntry();
    this.panel.update();
  }

  /**
   * Viser tegningen: som modell når den er gyldig, tom plan uten rom, og
   * ellers den siste gyldige utgaven. Under et drag bygges ingenting (det
   * gjøres når draget er ferdig). `force`: vis på nytt selv om den er lik.
   */
  refresh(force = false): void {
    if (!this.open.value) return;
    const doc = this.session.doc;
    if (!doc) {
      if (this.showing !== 'model' || force) {
        this.showing = 'model';
        this.previewDoc = null;
        this.host.restore();
      }
      return;
    }
    if (this.session.inGesture) return;
    const r = this.session.compiled(false);
    if (r?.doc && r.validation?.ok) {
      if (force || r.doc !== this.previewDoc || this.showing !== 'preview') {
        this.previewDoc = r.doc;
        this.showing = 'preview';
        this.host.showPreview(r.validation);
      }
    } else if (!doc.rooms.length || !this.previewDoc) {
      if (this.showing !== 'empty' || force) {
        this.showing = 'empty';
        this.previewDoc = null;
        this.host.showEmpty();
        this.host.desktop.buildGrid(this.extent());
      }
    }
    if (this.fitPending) {
      this.fitPending = false;
      this.fit();
    }
  }

  /** Kalles når apartment.json er lastet: er vår eksport publisert, er arbeidet ferdig. */
  /**
   * Kalles når apartment.json er lastet. Er det vår eksport som er publisert,
   * er arbeidet ferdig; svaret er det tegningen tok med fra den gamle modellen
   * (det skal ikke legges på en gang til), ellers null.
   */
  checkPublished(file: ApartmentDoc | null): { consumed: Consumed | null } | null {
    if (!this.session.checkPublished(file)) return null;
    if (this.session.published === 'done') {
      this.publishedText = '✓ Den nye modellen er lagt ut og vises nå. Tegningen er ryddet bort.';
      this.showPublished();
      this.editor.selection.set(null);
    } else this.editor.message.set('Fila du lastet ned, er lagt ut. Tegningen er endret etterpå, så den er beholdt.');
    this.updateEntry();
    return { consumed: this.session.takeConsumed() };
  }

  /**
   * Etter publisering: lokale endringer på den gamle modellen som *ikke* kom
   * med (laget etter at den nye modellen ble startet), er beholdt – si fra.
   */
  noteLeftovers(plan: number, measure: number): void {
    if (!plan && !measure) return;
    const parts = [
      ...(plan ? [`${plan} ${plan === 1 ? 'tegnet endring' : 'tegnede endringer'} (el og vann)`] : []),
      ...(measure ? [`${measure} ${measure === 1 ? 'måling' : 'målinger'}`] : []),
    ];
    const text = `${parts.join(' og ')} fra før er beholdt. De ble laget mot den gamle modellen og kan ligge feil nå – sjekk dem.`;
    this.publishedText = this.publishedText ? `${this.publishedText} ${text}` : text;
    this.showPublished();
  }

  private publishedText = '';

  private showPublished(): void {
    this.panel.showNotice(this.publishedText);
    this.entryNotice.textContent = this.publishedText;
    this.entryNotice.hidden = this.open.value || !this.publishedText;
  }

  private onChanged(): void {
    this.updateEntry();
    if (!this.open.value) return;
    this.refresh();
    this.updateOverlay();
  }

  private updateEntry(): void {
    this.entryButton.textContent = this.session.doc ? 'Fortsett på ny modell …' : 'Lag ny modell …';
  }

  private updateOverlay(): void {
    this.overlay.setVisible(this.drawing);
    this.backdrop.setShown(this.drawing);
    if (!this.drawing && this.backdropMode) this.setBackdropMode(null);
    this.panel.update();
  }

  /* ---------------- bakgrunnsbilde ---------------- */

  private async loadBackdrop(file: File): Promise<void> {
    const rect = this.host.canvas.getBoundingClientRect();
    // Midt i den delen av planen som synes (til høyre for panelet).
    const c = this.host.desktop.planPointAt(rect.left + rect.width * 0.6, rect.top + rect.height / 2) ?? { x: 0, z: 0 };
    const err = await this.backdrop.load(file, c);
    if (err) {
      this.editor.message.set(err);
      return;
    }
    this.setBackdropMode('calibrate');
    this.editor.message.set(
      `Bildet er lagt inn${this.backdrop.unsaved ? ' (for stort til å huskes etter omlasting)' : ''}. Sett målestokken: klikk to punkter i bildet der du kjenner avstanden.`,
    );
  }

  private setBackdropMode(mode: 'calibrate' | 'move' | null): void {
    this.backdropMode = mode;
    this.calib = [];
    this.overlay.setMarks([]);
    if (mode === 'calibrate') this.editor.message.set('Målestokk: klikk to punkter i bildet der du kjenner avstanden (f.eks. to hjørner i et rom).');
    else if (mode === 'move') this.editor.message.set('Dra bildet dit det skal. Trykk «Ferdig» når det ligger riktig.');
    this.backdrop.bump();
  }

  private calibClick(p: { x: number; z: number }): void {
    if (this.calib.length >= 2) this.calib = [];
    this.calib.push(p);
    this.overlay.setMarks(this.calib);
    this.editor.message.set(
      this.calib.length === 1
        ? 'Klikk det andre punktet.'
        : `Avstanden i bildet er ${formatLength(Math.hypot(p.x - this.calib[0]!.x, p.z - this.calib[0]!.z))}. Skriv den virkelige avstanden i panelet.`,
    );
    this.backdrop.bump();
  }

  private applyCalibration(mm: number): void {
    const [a, b] = this.calib;
    if (!a || !b || !(mm > 0)) return;
    const now = Math.hypot(b.x - a.x, b.z - a.z);
    if (now < 1) return;
    this.backdrop.scale(mm / now, a);
    this.setBackdropMode(null);
    this.editor.message.set(`Målestokken er satt: bildet er ${formatLength(this.backdrop.widthMm)} bredt. Tegn rommene oppå bildet.`);
  }

  /** Antall skjermpiksler i mm (følger zoom). */
  private tolMm(px: number): number {
    return (px / Math.max(1, this.host.desktop.pixelsPerMeter())) * 1000;
  }

  /** Området tegningen dekker (eller et standardområde uten rom). */
  private extent(): Extent {
    const pts = this.session.doc?.rooms.flatMap((r) => r.polygon) ?? [];
    if (!pts.length) return DEFAULT_EXTENT;
    const xs = pts.map((p) => p.x);
    const zs = pts.map((p) => p.z);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  }

  /** «Vis hele»: hele tegningen i planen (rett vei: x mot høyre, z nedover). */
  fit(): void {
    // Verktøylinja ligger øverst over planen: tegningen skal synes under den.
    const bar = this.panel.toolbar.querySelector('.tb-bar');
    const top = this.host.canvas.getBoundingClientRect().top;
    const r = !this.panel.toolbar.hidden && bar ? bar.getBoundingClientRect() : null;
    this.host.desktop.insetTop = r && r.height && r.top - top < this.host.canvas.clientHeight / 2 ? r.bottom - top + 8 : 0;
    this.host.desktop.fitBox(this.extent(), 0);
  }

  /* ---------------- start ---------------- */

  /** Oppmåling i gjennomsyn (Quest 3): rommene legges rett inn i tegningen. */
  private capture(): void {
    if (!this.session.doc) {
      this.session.start(emptyBuilderDoc());
      this.fitPending = true;
      this.refresh(true);
    }
    this.editor.tool.set('select');
    this.host.capture();
  }

  private startBlank(): void {
    this.session.start(emptyBuilderDoc());
    this.fitPending = true;
    this.refresh(true);
    this.editor.selection.set(null);
    this.editor.tool.set('rect');
    this.editor.message.set('Tegn første rom: klikk ett hjørne og så det motsatte – eller skriv bredde og dybde i panelet.');
  }

  private startFromCurrent(): void {
    const src = this.host.importSource();
    if (!src) {
      this.panel.showNotice('Ingen gyldig modell er lastet. Start med en tom modell i stedet.', 'error');
      return;
    }
    const r = importApartment(src.doc);
    if (!r.ok) {
      this.panel.showNotice(r.message, 'error');
      return;
    }
    // Tegnet el og vann og målinger blir med: når den nye fila er publisert, er de med i den.
    this.session.start(r.doc, src.consumed);
    this.fitPending = true;
    this.refresh(true);
    this.editor.tool.set('select');
    this.editor.selection.set(null);
    const n = r.doc.rooms.length;
    this.editor.message.set(
      `Modellen er hentet inn: ${n} rom og ${r.doc.openings.length} dører/vinduer/åpninger. Klikk et rom, en kant eller et hjørne for å endre.`,
    );
  }

  private async openDraftFile(file: File): Promise<void> {
    let text: string;
    try {
      text = await file.text();
    } catch {
      this.notify('Fila kunne ikke leses.', true);
      return;
    }
    // En apartment.json (rom, vegger og lag) hentes inn som tegning; ellers er det en lagret tegning.
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* openDraft gir meldingen */
    }
    if (parsed && typeof parsed === 'object' && 'rooms' in parsed && 'walls' in parsed && 'layers' in parsed) {
      const r = importApartment(parsed as Parameters<typeof importApartment>[0]);
      if (!r.ok) {
        this.notify(r.message, true);
        return;
      }
      this.session.start(r.doc);
    } else {
      const err = this.session.openDraft(text);
      if (err) {
        this.notify(err, true);
        return;
      }
    }
    this.fitPending = true;
    this.refresh(true);
    this.editor.tool.set('select');
    this.editor.selection.set(null);
    this.editor.message.set(`Tegningen «${this.session.doc?.name ?? ''}» er åpnet. «Angre» går tilbake til den forrige.`);
  }

  /** Beskjed der den synes: på startsiden uten tegning, ellers i meldingsfeltet. */
  private notify(text: string, error = false): void {
    if (this.session.doc) this.editor.message.set(text);
    else this.panel.showNotice(text, error ? 'error' : 'ok');
  }

  /* ---------------- lagring ---------------- */

  private download(): void {
    const text = this.session.exportText(new Date());
    if (!text) {
      this.editor.message.set('Modellen har feil som må rettes før den kan lagres (se «Sjekk»).');
      return;
    }
    this.host.download(text, 'apartment.json');
    this.editor.message.set('apartment.json er lastet ned. Last den opp til GitHub (public/-mappa) for å ta den i bruk.');
  }

  private async copy(): Promise<boolean> {
    const text = this.session.exportText(new Date());
    if (!text) return false;
    return this.host.copy(text);
  }

  private saveDraftFile(): void {
    const text = this.session.draftText();
    if (!text) return;
    this.host.download(text, draftFileName(this.session.doc?.name ?? ''));
    this.editor.message.set('Tegningen er lagret som fil. Åpne den med «Åpne tegning …» på en annen maskin (f.eks. Quest).');
  }

  /** «Vis» ved en melding: velg det den gjelder, og flytt planen dit. */
  private show(t: NonNullable<BuildIssue['target']>): void {
    const sel: BuilderSelection = t.kind === 'room' ? { kind: 'room', room: t.id } : { kind: 'opening', id: t.id };
    this.editor.tool.set('select');
    this.editor.selection.set(sel);
    this.editor.message.set(this.editor.describe(sel));
    if (this.host.view.cameraMode.value !== 'top') this.host.view.cameraMode.set('top');
    const b = this.editor.boundsOf(t);
    if (b) this.host.desktop.focusBox(b);
  }

  /* ---------------- mus, laserpeker og tastatur ---------------- */

  private bindCanvas(): void {
    const el = this.host.canvas;
    const ed = this.editor;
    let down: { x: number; y: number; button: number } | null = null;
    const tol = (): number => this.tolMm(this.coarse ? 20 : 10);
    const point = (e: { clientX: number; clientY: number }) => this.host.desktop.planPointAt(e.clientX, e.clientY);
    el.addEventListener('pointerdown', (e) => {
      down = this.drawing ? { x: e.clientX, y: e.clientY, button: e.button } : null;
      if (this.drawing && this.backdropMode === 'move' && e.button === 0) this.dragBackdrop(e);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.drawing || ed.dragging) return;
      ed.pointerMove(point(e), tol(), e.ctrlKey);
    });
    el.addEventListener('pointerup', (e) => {
      const d = down;
      down = null;
      if (!d || !this.drawing) return;
      // Et klikk (ikke et drag som flytter planen). Laserpekeren skjelver litt.
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > (this.coarse ? 14 : 5)) return;
      if (d.button === 2) {
        if (ed.tool.value === 'poly' && ed.draft.length >= 3) ed.finishPoly();
        else ed.cancel();
        return;
      }
      if (d.button !== 0 || this.backdropMode === 'move') return;
      const p = point(e);
      if (!p) return;
      if (this.backdropMode === 'calibrate') this.calibClick(p);
      else ed.click(p, tol(), e.ctrlKey);
    });
    el.addEventListener('pointerleave', () => {
      if (this.drawing && !ed.dragging) ed.pointerMove(null, 0);
    });
    el.addEventListener('dblclick', () => {
      if (this.drawing && ed.tool.value === 'poly' && ed.draft.length >= 3) ed.finishPoly();
    });
    el.addEventListener('contextmenu', (e) => {
      if (this.drawing) e.preventDefault();
    });
  }

  /** Drar bakgrunnsbildet (i «Flytt bildet»). */
  private dragBackdrop(e: PointerEvent): void {
    const desk = this.host.desktop;
    let last = desk.planPointAt(e.clientX, e.clientY);
    if (!last) return;
    desk.plan.enabled = false;
    const id = e.pointerId;
    const move = (ev: PointerEvent): void => {
      if (ev.pointerId !== id) return;
      const p = desk.planPointAt(ev.clientX, ev.clientY);
      if (!p || !last) return;
      this.backdrop.move(p.x - last.x, p.z - last.z, false);
      last = p;
    };
    const up = (ev: PointerEvent): void => {
      if (ev.pointerId !== id) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      desk.plan.enabled = desk.mode === 'top';
      this.backdrop.saveNow();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** Hurtigtastene i byggeren (fanges før de vanlige, så de ikke gjør to ting). */
  private onKey(e: KeyboardEvent): void {
    if (!this.ownsView || this.host.view.inXR.value) return;
    if (isTypingTarget(e.target) || e.altKey || e.metaKey || this.host.helpOpen()) return;
    const ed = this.editor;
    const k = e.key;
    const consume = (): void => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    if (e.ctrlKey) {
      if (k === 'z' || k === 'Z') {
        consume();
        if (e.shiftKey) this.editor.redo();
        else this.editor.undo();
      } else if (k === 'y' || k === 'Y') {
        consume();
        this.editor.redo();
      }
      return;
    }
    // Verktøy, tall og piler bare når man tegner i 2D; i 3D virker de vanlige tastene (R, 1, 2 …).
    if (!this.drawing) return;
    const tool = TOOL_KEYS[k.toLowerCase()];
    if (tool && !e.shiftKey) {
      consume();
      if (!e.repeat) ed.tool.set(tool);
      return;
    }
    if (k === 'Enter') {
      if (ed.tool.value === 'poly' && ed.draft.length) {
        consume();
        ed.finishPoly();
      }
      return;
    }
    if (k === 'Backspace' || k === 'Delete') {
      consume();
      if (ed.draft.length) ed.undoPoint();
      else ed.deleteSelected();
      return;
    }
    if (k === 'Escape') {
      consume();
      if (this.backdropMode) this.setBackdropMode(null);
      else if (!ed.cancel()) {
        if (ed.tool.value !== 'select') ed.tool.set('select');
        else ed.selection.set(null);
      }
      return;
    }
    if (k.startsWith('Arrow') && ed.selection.value && this.drawing) {
      consume();
      const step = e.shiftKey ? 100 : 10;
      const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0;
      const dz = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
      ed.nudge(dx, dz);
      return;
    }
    // Tall mens man tegner: rett inn i målefeltet (bredde/lengde).
    if (/^[0-9.,+-]$/.test(k)) {
      const input = this.panel.lengthTarget();
      if (!input) return;
      consume();
      input.value = k;
      input.classList.remove('invalid');
      input.focus();
      input.setSelectionRange(1, 1);
    }
  }
}
