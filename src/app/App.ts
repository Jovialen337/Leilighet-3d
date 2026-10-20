/**
 * Setter sammen appen: laster og validerer apartment.json, bygger scenen,
 * og kobler laptop-visning, VR og UI til den felles visningstilstanden.
 *
 * Oppmåling (fase 2): målingene ligger i en MeasureSession (lagret lokalt).
 * Finnes det målinger, vises utkastet i stedet for fila, til det er lastet
 * opp eller forkastet.
 */
import * as THREE from 'three';
import { MeasureSession } from '../measure/MeasureSession';
import { ApartmentStore } from '../model/ApartmentStore';
import type { ApartmentModel } from '../model/ApartmentModel';
import { ApartmentScene, passes } from '../scene/ApartmentScene';
import { Materials } from '../scene/materials';
import { addLights, applyLights, configureRenderer, LIGHTS, type Lights } from '../scene/lighting';
import { createSky, prepareSky, setGroundLevel, setSkyLight } from '../scene/sky';
import { textureBytes } from '../scene/textureBudget';
import { graphicsProfile } from '../scene/graphicsProfile';
import { MM } from '../scene/geom';
import { localStore } from '../state/persist';
import { SettingsBinding } from '../state/settings';
import { ViewState } from '../state/ViewState';
import { DesktopUI } from '../ui/DesktopUI';
import { FpsMeter } from '../ui/FpsMeter';
import { repoFromLocation, uploadUrl } from '../ui/github';
import { Labels } from '../ui/Labels';
import { DesktopView } from '../views/DesktopView';
import { XRManager } from '../xr/XRManager';
import { applyOps, opFingerprint, PlanEdits, type PlanOp } from '../plan/PlanEdits';
import { PlanController } from '../plan/PlanController';
import { PlanOverlay } from '../plan/PlanOverlay';
import { PlanBox } from '../ui/PlanBox';
import { isTypingTarget } from '../ui/shortcuts';
import type { ApartmentDoc } from '../schema/types';
import { validateApartment, type ValidationResult } from '../schema/validate';
import type { DrawTool } from '../plan/draw';
import { BuilderController } from './BuilderController';
import type { Consumed } from '../builder/BuilderSession';

/** Tegningene som passer (lagt inn), de som ikke passer nå, og valideringen av resultatet. */
type PlanSplit = { doc: ApartmentDoc; hidden: PlanOp[]; result?: ValidationResult };

export class App {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly view = new ViewState();
  readonly store: ApartmentStore;
  readonly materials = new Materials();
  readonly apartment = new ApartmentScene(this.materials);
  readonly desktop: DesktopView;
  readonly xr: XRManager;
  readonly ui: DesktopUI;
  readonly fps = new FpsMeter();
  readonly labels: Labels;
  readonly sky = createSky();
  readonly lights: Lights;
  measure: MeasureSession | null = null;
  readonly settings: SettingsBinding;
  /** Tegnede endringer (el og vann) oppå fila, lagret lokalt. */
  readonly plan: PlanEdits;
  readonly planCtrl: PlanController;
  readonly planOverlay: PlanOverlay;
  readonly planBox: PlanBox;
  /** «Lag ny modell». */
  readonly builder: BuilderController;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly rayHits: THREE.Intersection[] = [];
  private lastTime = -1;
  private loaded = false;
  /** Utkastet er endret under oppmåling og tegnes når AR-økten er over. */
  private draftDirty = false;
  /** Dokumentet som sist ble tegnet (for å slippe unødvendig ombygging). */
  private renderedDoc: ApartmentDoc | null = null;
  /** Tegnede endringer som ikke passer med modellen nå (vises ikke, men beholdes). */
  private planHidden: PlanOp[] = [];
  /** Sist utregnede «tegningene som passer» for et grunnlag (slipper å validere på nytt ved hvert klikk). */
  private planCache: ({ base: ApartmentDoc; rev: number } & PlanSplit) | null = null;
  /** Siste godkjente forhåndssjekk: gjenbrukes når endringen lagres, så den ikke valideres to ganger. */
  private planPending: { base: ApartmentDoc; rev: number; size: number; doc: ApartmentDoc; result: ValidationResult } | null = null;
  /** Den nye modellen har ingen rom ennå: modellen er skjult. */
  private previewEmpty = false;

  constructor(private readonly root: HTMLElement) {
    this.store = new ApartmentStore(`${import.meta.env.BASE_URL}apartment.json`);
    // Lagrede valg hentes før UI-et bygges, så kontrollene starter riktig.
    this.settings = new SettingsBinding(this.view, localStore());
    this.plan = new PlanEdits(null, localStore());
    this.planCtrl = new PlanController(this.plan, () => this.store.model, () => this.baseDoc());
    this.planCtrl.canApply = (ops) => this.checkPlanOps(ops);
    this.planCtrl.isHidden = (op) => this.planHidden.includes(op);
    // «Velg» skal bare treffe det som synes (lag og filtre).
    this.planCtrl.isVisible = (o) =>
      this.view.layers.isVisible(o.layer) &&
      passes({ kind: o.kind, status: o.status, ...(o.circuit ? { circuit: o.circuit } : {}) }, {
        existing: this.view.showExisting.value,
        planned: this.view.showPlanned.value,
        circuit: this.view.circuit.value,
      });
    this.planOverlay = new PlanOverlay(this.planCtrl, () => this.store.model);
    this.planBox = new PlanBox(this.planCtrl);
    this.plan.subscribe(() => this.onPlanChanged());

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    configureRenderer(this.renderer);
    // Kutt per materiale: installasjoner kuttes ikke (se Materials.setCut).
    this.renderer.localClippingEnabled = true;
    this.renderer.domElement.className = 'viewport';
    this.renderer.domElement.dataset.testid = 'viewport';
    root.appendChild(this.renderer.domElement);

    this.scene.add(this.apartment.root);
    this.lights = addLights(this.scene);
    this.scene.add(this.sky);
    this.scene.add(this.planOverlay.root);

    this.labels = new Labels(root);
    this.scene.add(this.labels.root);

    this.desktop = new DesktopView(this.renderer.domElement);
    this.scene.add(this.desktop.grid);

    this.xr = new XRManager(
      this.renderer,
      this.scene,
      this.view,
      this.apartment,
      () => this.store.model,
      this.fps,
      () => this.measure,
      this.planCtrl,
      () => this.builder?.session ?? null,
    );
    this.builder = new BuilderController(
      {
        view: this.view,
        desktop: this.desktop,
        xr: this.xr,
        canvas: this.renderer.domElement,
        importSource: () => {
          const base = this.baseDoc();
          if (!base) return null;
          const { doc, hidden } = this.splitPlan(base);
          return {
            doc,
            consumed: {
              plan: this.plan.ops.filter((o) => !hidden.includes(o)).map(opFingerprint),
              measure: this.measure?.hasMeasurements ? this.measure.logHash() : null,
            },
          };
        },
        showPreview: (v) => this.showBuilderPreview(v),
        showEmpty: () => this.showBuilderEmpty(),
        restore: () => this.restoreFromBuilder(),
        helpOpen: () => this.ui.helpOpen,
        download: (text, name) => this.downloadText(text, name),
        copy: (text) => this.copyText(text),
        uploadUrl: () => uploadUrl(repoFromLocation()),
        capture: () => void this.xr.enterBuild(),
      },
      localStore(),
    );
    this.ui = new DesktopUI(root, this.view, this.xr, {
      reload: () => void this.load(),
      goToRoom: (id) => this.goToRoom(id),
      resetView: () => this.desktop.resetView(),
      resetSettings: () => this.settings.reset({ layers: this.store.model?.data.layers ?? [] }),
      defaultSectionHeight: () => this.store.model?.settings.planCutHeight ?? 1500,
      planBox: this.planBox.root,
      builder: { entry: this.builder.entry, panel: this.builder.panel.root, open: () => this.builder.setOpen(true) },
      measure: {
        start: () => void this.xr.enterMeasure(),
        stop: () => void this.xr.exit(),
        download: () => this.downloadDraft(),
        copy: () => this.copyDraft(),
        uploadUrl: () => uploadUrl(repoFromLocation()),
        discard: () => this.measure?.discard(),
        discardPlan: () => this.plan.clear(),
        discardStale: () => this.measure?.discardStale(),
        discardPlanStale: () => {
          if (!confirm('Slette tegningene som ikke passer med modellen nå? Dette kan ikke angres.')) return;
          this.plan.removeOps(this.planHidden);
          this.planCtrl.message.set('Tegningene som ikke passet, er slettet.');
        },
        adoptStale: () => this.measure?.adoptStale(),
        keepPlanOlder: () => this.plan.acceptOlder(),
        discardPlanOlder: () => this.plan.clear(),
      },
    });
    this.ui.panel.querySelector('.panel-toggle')?.addEventListener('click', () => this.resize());
    // Ny modell vises: el og vann tegnes på fila, ikke på den (gjelder også i VR).
    this.xr.canDraw = () => !this.builder.ownsView;
    this.builder.open.subscribe((on) => {
      this.ui.setBuilding(on);
      this.labels.setBuilding(on);
      this.resize();
    });

    this.bindState();
    window.addEventListener('resize', () => this.resize());
    this.renderer.domElement.addEventListener('pointermove', (e) => {
      this.ui.updateCoords(this.desktop.planPointAt(e.clientX, e.clientY));
      this.planHover(e);
    });
    this.bindPlanInput();
    this.desktop.onChange(() => this.ui.updateScale(this.desktop.pixelsPerMeter()));
    this.fps.onUpdate(() => this.ui.updateFps(this.fps.label()));
    this.resize();
  }

  async start(): Promise<void> {
    if (new URLSearchParams(location.search).has('fps')) this.view.fps.set(true);
    void this.xr.checkSupport();
    this.renderer.setAnimationLoop((time, frame) => this.frame(time, frame));
    await this.load();
    // Var «Lag ny modell» åpen sist, fortsetter man der.
    if (this.builder.wasOpen()) this.builder.setOpen(true);
  }

  async load(): Promise<void> {
    this.ui.showLoading();
    const result = await this.store.load();
    if (!result.ok) {
      console.error('Feil i apartment.json', result.errors);
      this.ui.showErrors(result.errors, result.warnings);
      // Byggeren kan lage en ny, gyldig fil selv om den gamle har feil.
      if (this.builder.open.value) {
        this.ui.hideOverlay();
        if (this.builder.ownsView) this.builder.refresh(true);
      }
      return;
    }
    const published = this.builder.checkPublished(this.store.fileDoc);
    this.measure = this.createMeasureSession();
    this.planHidden = [];
    this.planCache = null;
    this.planPending = null;
    if (this.store.fileDoc) this.plan.rebase(this.store.fileDoc);
    if (published) this.dropConsumed(published.consumed);
    if (this.builder.ownsView) this.builder.refresh(true);
    else if (this.measure?.hasMeasurements || this.plan.size) this.showDraft(true);
    else {
      this.renderedDoc = this.store.doc;
      this.applyModel(result.model);
      this.ui.showModel(result.model, result.warnings);
    }
    this.updateMeasureUi();
  }

  /**
   * Den publiserte fila kom fra «Lag ny modell», som tok med tegnet el og
   * vann og målinger fra den gamle modellen: de er nå med i fila (i den nye
   * rammen) og skal ikke legges på en gang til. Det som ble laget etterpå,
   * beholdes, og byggeren sier fra om det.
   */
  private dropConsumed(c: Consumed | null): void {
    if (c) {
      const done = new Set(c.plan);
      this.plan.removeOps(this.plan.ops.filter((o) => done.has(opFingerprint(o))));
      if (c.measure && this.measure?.staleHash() === c.measure) this.measure.discardStale();
    }
    this.builder.noteLeftovers(this.plan.ops.length, this.measure?.stale?.count ?? 0);
  }

  /** Grunnlaget for tegning: oppmålingsutkastet eller fila (uten planendringene). */
  private baseDoc(): ApartmentDoc | null {
    return this.measure?.hasMeasurements ? this.measure.draft : this.store.fileDoc;
  }

  private updateMeasureUi(): void {
    this.ui.updateMeasure(this.measure, {
      planChanges: this.plan.changedObjects,
      planPublished: this.plan.published,
      planStale: this.planHidden.length,
      planOlder: this.plan.olderFile,
    });
  }

  private onPlanChanged(): void {
    this.updateMeasureUi();
    if (this.xr.measuring.value) this.draftDirty = true;
    else this.showDraft();
  }

  private createMeasureSession(): MeasureSession | null {
    if (!this.store.fileDoc) return null;
    try {
      const s = new MeasureSession(this.store.fileDoc, localStore());
      s.subscribe(() => this.onDraftChanged(s));
      return s;
    } catch (e) {
      console.error('Kunne ikke starte oppmåling', e);
      return null;
    }
  }

  private onDraftChanged(s: MeasureSession): void {
    if (s !== this.measure) return;
    this.updateMeasureUi();
    if (this.xr.measuring.value) this.draftDirty = true;
    else this.showDraft();
  }

  /**
   * Tegner utkastet: oppmåling (eller fila) med de tegnede endringene oppå.
   * Tegninger som ikke passer med modellen nå (f.eks. en vegg ble kortere ved
   * oppmåling), vises ikke, men beholdes – de kommer tilbake når de passer igjen.
   */
  private showDraft(force = false): void {
    this.draftDirty = false;
    // Mens man lager ny modell, er det den som vises (utkastet tegnes når byggeren lukkes).
    if (this.builder.ownsView) return;
    const base = this.baseDoc();
    if (!base) return;
    const { doc, hidden, result } = this.splitPlan(base);
    const prev = this.planHidden;
    this.planHidden = hidden;
    if (hidden.length !== prev.length || hidden.some((o, i) => o !== prev[i])) {
      this.updateMeasureUi();
      const back = prev.filter((o) => !hidden.includes(o) && this.plan.ops.includes(o)).length;
      if (hidden.some((o) => !prev.includes(o)))
        this.planCtrl.message.set(
          `${hidden.length} ${hidden.length === 1 ? 'tegnet endring passer' : 'tegnede endringer passer'} ikke med modellen nå og vises ikke (se «Oppmåling»).`,
        );
      else if (back)
        this.planCtrl.message.set(`${back} ${back === 1 ? 'tegnet endring passer' : 'tegnede endringer passer'} igjen og vises.`);
    }
    if (!force && doc === this.renderedDoc) return;
    const r = this.store.setValidated(result ?? validateApartment(doc));
    if (!r.ok) {
      console.error('Utkastet er ugyldig', r.errors);
      return;
    }
    this.renderedDoc = doc;
    this.applyModel(r.model);
    this.ui.showModel(r.model, r.warnings);
  }

  /**
   * Tegningene som passer, lagt oppå `base`, og de som ikke passer nå (med
   * valideringen av resultatet). Mellomlagret per grunnlag og endring.
   */
  private splitPlan(base: ApartmentDoc): PlanSplit {
    const c = this.planCache;
    if (c && c.base === base && c.rev === this.plan.revision) return c;
    const p = this.planPending;
    this.planPending = null;
    let r: PlanSplit;
    if (p && p.base === base && p.rev + 1 === this.plan.revision && p.size === this.plan.size) {
      // Akkurat den godkjente endringen er lagret: forhåndssjekken er svaret.
      r = { doc: p.doc, hidden: [], result: p.result };
    } else {
      const checked = new Map<ApartmentDoc, ValidationResult>();
      const s = this.plan.split(
        base,
        (d) => {
          const v = validateApartment(d);
          checked.set(d, v);
          return v.ok;
        },
        this.planHidden,
      );
      r = { ...s, result: checked.get(s.doc) };
    }
    this.planCache = { base, rev: this.plan.revision, ...r };
    return r;
  }

  private planOn(base: ApartmentDoc): ApartmentDoc {
    return this.splitPlan(base).doc;
  }

  /** Avviser nye tegnede endringer som ville gitt en ugyldig modell (før de lagres). */
  private checkPlanOps(ops: readonly PlanOp[]): string | null {
    const base = this.baseDoc();
    if (!base) return 'Ingen modell er lastet.';
    const prev = this.splitPlan(base);
    const doc = applyOps(prev.doc, ops);
    const r = validateApartment(doc);
    if (!r.ok) return r.errors[0]?.message ?? 'Ugyldig endring.';
    // Når ingenting er skjult, er dette nøyaktig det neste utkastet blir.
    if (!prev.hidden.length) this.planPending = { base, rev: this.plan.revision, size: this.plan.size + ops.length, doc, result: r };
    return null;
  }

  /** Hele utkastet som tekst (målinger + tegninger som passer), for nedlasting og kopiering. */
  private exportText(): string | null {
    if (!this.measure) return null;
    return this.measure.exportText(new Date(), (d) => this.planOn(d));
  }

  private downloadDraft(): void {
    const text = this.exportText();
    if (text) this.downloadText(text, 'apartment.json');
  }

  private downloadText(text: string, filename: string): void {
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }

  private async copyDraft(): Promise<boolean> {
    const text = this.exportText();
    return text ? this.copyText(text) : false;
  }

  private async copyText(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  /* ---------------- Lag ny modell ---------------- */

  /** Tegningen vises som modell (i 2D, 3D og VR). */
  private showBuilderPreview(v: ValidationResult): void {
    const r = this.store.setValidated(v);
    if (!r.ok) return;
    this.renderedDoc = null; // vanlig visning tegnes på nytt når byggeren lukkes
    this.ui.hideOverlay();
    this.applyModel(r.model);
    this.ui.showModel(r.model, r.warnings);
  }

  /** Ingen rom ennå: bare rutenettet. */
  private showBuilderEmpty(): void {
    this.renderedDoc = null;
    this.previewEmpty = true;
    this.apartment.root.visible = false;
    this.labels.clear();
    this.ui.hideOverlay();
  }

  /** Byggeren er lukket (eller har ingen tegning): fila eller utkastet vises igjen. */
  private restoreFromBuilder(): void {
    if (!this.store.fileDoc) {
      // Fila har feil: feilene vises igjen når byggeren lukkes.
      if (!this.builder.open.value) void this.load();
      else this.showBuilderEmpty();
      return;
    }
    this.renderedDoc = null;
    this.showDraft(true);
    if (this.store.model) this.desktop.fit(this.store.model);
  }

  private applyModel(model: ApartmentModel): void {
    this.previewEmpty = false;
    this.apartment.root.visible = !this.xr.measuring.value;
    this.view.layers.reset(model.data.layers);
    this.planBox.setModel(model);
    const sel = this.planCtrl.selected.value;
    if (sel && !(model.data[sel.c] ?? []).some((o: { id: string }) => o.id === sel.id)) this.planCtrl.selected.set(null);
    else this.planOverlay.rebuildHighlight();
    this.apartment.build(model);
    this.labels.build(model);
    for (const l of model.data.layers) this.applyLayer(l.id, this.view.layers.isVisible(l.id));
    this.apartment.setCeilingsVisible(this.view.ceilings.value);
    this.apartment.setMeasureHighlight(this.view.measureHighlight.value);
    this.scene.background = new THREE.Color(model.settings.backgroundColor);
    const lowest = Math.min(model.lowestFloor, ...model.outdoor.map((a) => a.area.level));
    setGroundLevel(this.sky, (lowest - 30) * MM);
    if (!this.loaded) this.desktop.fit(model);
    this.desktop.setSectionHeight(this.view.sectionHeight.value, model);
    this.loaded = true;
    this.applyCameraMode();
  }

  private applyLayer(id: string, visible: boolean): void {
    this.apartment.setLayerVisible(id, visible);
    this.labels.setLayerVisible(id, visible);
  }

  private bindState(): void {
    const subscribed = new Set<string>();
    this.store.subscribe((model) => {
      for (const l of model.data.layers) {
        if (subscribed.has(l.id)) continue;
        subscribed.add(l.id);
        this.view.layers.get(l.id).subscribe((v) => this.applyLayer(l.id, v));
      }
    });
    this.view.cameraMode.subscribe(() => this.applyCameraMode());
    this.view.dollhouse.subscribe(() => this.applyCameraMode());
    this.view.quality.subscribe(() => this.applyQuality());
    this.view.effects.subscribe(() => this.applyQuality());
    this.view.light.subscribe(() => this.applyLight(), true);
    const filter = (): void =>
      this.apartment.setFilter({ existing: this.view.showExisting.value, planned: this.view.showPlanned.value, circuit: this.view.circuit.value });
    this.view.showExisting.subscribe(filter);
    this.view.showPlanned.subscribe(filter);
    this.view.circuit.subscribe(filter);
    filter();
    this.view.xray.subscribe((on) => {
      this.materials.setXray(on);
      this.applyQuality();
    }, true);
    this.view.sectionHeight.subscribe((mm) => this.desktop.setSectionHeight(mm));
    this.view.ceilings.subscribe((v) => this.apartment.setCeilingsVisible(v));
    this.view.measureHighlight.subscribe((v) => this.apartment.setMeasureHighlight(v));
    this.xr.measuring.subscribe((on) => {
      // Gjennomsyn: bare trådskjelettet fra oppmålingen vises.
      this.apartment.root.visible = !on && !this.previewEmpty;
      this.applyQuality();
      this.desktop.grid.visible = !on && this.view.cameraMode.value === 'top';
      if (!on && this.draftDirty) this.showDraft();
    });
    this.view.inXR.subscribe((inXR) => {
      this.fps.reset();
      this.labels.setVisible(!inXR && this.view.cameraMode.value === 'top');
      this.applyCameraMode();
    });
  }

  /** Plan-modus og dukkehus: klipp i snitthøyden og vis baksider. VR: ingen klipping. */
  private applyCameraMode(): void {
    const v = this.view;
    const top = v.cameraMode.value === 'top' && !v.inXR.value;
    const cut = (top || v.dollhouse.value) && !v.inXR.value;
    this.desktop.setMode(v.cameraMode.value);
    // Rutenettet hører til 2D-planen på laptopen, ikke VR.
    this.desktop.grid.visible = top;
    this.materials.setCut(cut ? this.desktop.cutPlane : null, top);
    this.labels.setVisible(top);
    this.applyQuality();
  }

  /** Grafikkvalitet og effekter etter grafikkprofilen (se graphicsProfile.ts). */
  private applyQuality(): void {
    const prof = graphicsProfile({
      quality: this.view.quality.value,
      top: this.view.cameraMode.value === 'top' && !this.view.inXR.value,
      passthrough: this.xr.measuring.value,
      xray: this.view.xray.value,
      custom: this.view.effects.value,
    });
    this.apartment.setEffects(prof.effects);
    if (prof.sky) prepareSky(this.sky);
    this.sky.visible = prof.sky;
    // Foveeringen kan endres mens man er i VR; oppløsningen settes når økten starter.
    this.renderer.xr.setFoveation(prof.foveation);
    if (!this.renderer.xr.isPresenting) {
      this.renderer.setPixelRatio(prof.pixelRatio(window.devicePixelRatio || 1));
      this.resize();
    }
  }

  /** «Lys» (morgen/dag/kveld): lysene, eksponeringen, himmelen, sola og lampene. */
  private applyLight(): void {
    const preset = LIGHTS[this.view.light.value];
    applyLights(this.lights, preset);
    configureRenderer(this.renderer, preset);
    this.xr.exposure = preset.exposure;
    setSkyLight(this.sky, preset);
    this.materials.setNight(preset.night);
    this.apartment.setLight(preset);
  }

  /* ---------------- Tegning med mus og tastatur (PC) ---------------- */

  /** Punkt i planet (mm) og høyde over gulv under musepekeren. 2D: planpunktet; 3D: der strålen treffer. */
  private planPointFromEvent(e: { clientX: number; clientY: number }): { p: { x: number; z: number }; h?: number; tol: number } | null {
    const model = this.store.model;
    if (!model) return null;
    if (this.view.cameraMode.value === 'top') {
      const p = this.desktop.planPointAt(e.clientX, e.clientY);
      if (!p) return null;
      return { p, tol: (12 / Math.max(1, this.desktop.pixelsPerMeter())) * 1000 };
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.desktop.camera);
    this.rayHits.length = 0;
    const cut = this.view.dollhouse.value ? this.desktop.cutPlane.constant : Infinity;
    const hit = this.raycaster
      .intersectObjects(this.apartment.visibleProxies(), false, this.rayHits)
      .find((h) => h.point.y <= cut + 1e-3);
    if (!hit) return null;
    const p = { x: hit.point.x / MM, z: hit.point.z / MM };
    const floor = model.floorOrDefault(p);
    return { p, h: Math.max(0, Math.round(hit.point.y / MM - floor)), tol: 80 };
  }

  private planHover(e: PointerEvent): void {
    if (this.planCtrl.tool === 'select' || this.renderer.xr.isPresenting || this.builder.open.value) {
      this.planCtrl.hover = null;
      this.ui.planTooltip(null);
      return;
    }
    const hit = this.planPointFromEvent(e);
    this.planCtrl.hoverAt(hit?.p ?? null, hit?.tol ?? 0, hit?.h, e.ctrlKey);
    const hv = this.planCtrl.hover;
    if (!hv) {
      this.ui.planTooltip(null);
      return;
    }
    const total = this.planCtrl.drawing ? ` · totalt ${(this.planCtrl.liveLength() / 1000).toFixed(2).replace('.', ',')} m` : '';
    this.ui.planTooltip(`${hv.snap === 'fri' ? '' : `${hv.snap} · `}h ${hv.h} mm${total}`, e.clientX, e.clientY);
  }

  private bindPlanInput(): void {
    const el = this.renderer.domElement;
    let down: { x: number; y: number; button: number } | null = null;
    el.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY, button: e.button }));
    el.addEventListener('pointerup', (e) => {
      const d = down;
      down = null;
      // Mens man lager ny modell, går klikkene til byggeren (BuilderController).
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || this.renderer.xr.isPresenting || this.builder.open.value) return;
      if (d.button === 2) {
        if (this.planCtrl.drawing) this.planCtrl.finish();
        return;
      }
      if (d.button !== 0) return;
      const hit = this.planPointFromEvent(e);
      if (!hit) return;
      this.planCtrl.click(hit.p, hit.tol, hit.h, e.ctrlKey);
    });
    el.addEventListener('pointerleave', () => {
      this.planCtrl.hover = null;
      this.ui.planTooltip(null);
    });
    this.view.cameraMode.subscribe(() => this.ui.planTooltip(null));
    this.planCtrl.options.subscribe(() => this.ui.planTooltip(null));
    el.addEventListener('dblclick', () => {
      if (this.planCtrl.drawing && !this.builder.open.value) this.planCtrl.finish();
    });
    el.addEventListener('contextmenu', (e) => {
      if (this.planCtrl.tool !== 'select' && !this.builder.open.value) e.preventDefault();
    });
    const tools: Record<string, DrawTool> = { s: 'select', e: 'wire', v: 'pipe', p: 'fixture' };
    window.addEventListener('keydown', (e) => {
      if (isTypingTarget(e.target) || e.altKey || e.metaKey || this.builder.open.value) return;
      const k = e.key;
      if (e.ctrlKey) {
        if (k === 'z' || k === 'Z') {
          e.preventDefault();
          this.planCtrl.undo();
        }
        return;
      }
      if (e.repeat) return;
      const tool = tools[k.toLowerCase()];
      if (tool && !e.shiftKey) this.planCtrl.set({ tool });
      else if (k === 'Enter') this.planCtrl.finish();
      else if (k === 'Backspace' && this.planCtrl.drawing) {
        e.preventDefault();
        this.planCtrl.undoPoint();
      } else if (k === 'Escape') {
        if (this.ui.helpOpen) return; // Esc lukker hjelpen (DesktopUI), ikke tegningen
        if (this.planCtrl.drawing) this.planCtrl.cancel();
        else if (this.planCtrl.tool !== 'select') this.planCtrl.set({ tool: 'select' });
      } else if (k === 'Delete') this.planCtrl.deleteSelected();
    });
  }

  /** «Gå til rom»: i VR flyttes du dit, på laptopen flyttes kameraet. */
  goToRoom(roomId: string): void {
    const model = this.store.model;
    if (!model) return;
    if (this.xr.presenting) this.xr.goToRoom(roomId);
    else this.desktop.focusRoom(model, roomId);
  }

  private resize(): void {
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    if (!this.renderer.xr.isPresenting) this.renderer.setSize(w, h);
    this.desktop.resize(w, h, this.panelInset(w));
    this.labels.resize(w, h);
  }

  /** Bredden panelet dekker (bare på brede skjermer med åpent panel). */
  private panelInset(width: number): number {
    const panel = this.ui?.panel;
    if (!panel || width < 900 || panel.classList.contains('collapsed')) return 0;
    return panel.getBoundingClientRect().right + 12;
  }

  private frame(time: number, frame?: XRFrame): void {
    const dt = this.lastTime < 0 ? 0 : Math.min(0.1, (time - this.lastTime) / 1000);
    this.lastTime = time;
    this.fps.tick(time);
    if (this.renderer.xr.isPresenting) {
      this.xr.update(dt, frame, time);
      this.planOverlay.scale = 0.025;
      this.planOverlay.update();
      this.renderer.render(this.scene, this.xr.camera);
      return;
    }
    this.desktop.update(dt);
    this.planOverlay.scale = this.view.cameraMode.value === 'top' ? 0.05 : 0.025;
    this.planOverlay.update();
    this.renderer.render(this.scene, this.desktop.camera);
    if (this.view.cameraMode.value === 'top') this.labels.render(this.scene, this.desktop.camera);
  }

  /** Nøkkeltall for tester og feilsøking (window.leilighet.stats()). */
  stats(): Record<string, number> {
    const info = this.renderer.info;
    const s = this.apartment.stats();
    return {
      drawCalls: info.render.calls,
      // I VR tegnes hvert objekt én gang per øye.
      drawCallsPerEye: info.render.calls / (this.renderer.xr.isPresenting ? 2 : 1),
      textureBytes: textureBytes(this.scene, [this.materials.detail.detailMap.value]),
      trianglesRendered: info.render.triangles,
      mergedMeshes: s.meshes,
      sceneTriangles: s.triangles,
      proxies: s.proxies,
      fps: this.fps.fps,
    };
  }

  /** Gulvhøyde (m) i et punkt (m) – for tester. */
  floorAt(x: number, z: number): number | null {
    const l = this.store.model?.floorLevelAt({ x: x / MM, z: z / MM });
    return l === null || l === undefined ? null : l * MM;
  }
}

