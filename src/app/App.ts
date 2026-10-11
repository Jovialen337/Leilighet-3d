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
import { ApartmentScene } from '../scene/ApartmentScene';
import { Materials } from '../scene/materials';
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
  measure: MeasureSession | null = null;
  readonly settings: SettingsBinding;
  private lastTime = -1;
  private loaded = false;
  /** Utkastet er endret under oppmåling og tegnes når AR-økten er over. */
  private draftDirty = false;

  constructor(private readonly root: HTMLElement) {
    this.store = new ApartmentStore(`${import.meta.env.BASE_URL}apartment.json`);
    // Lagrede valg hentes før UI-et bygges, så kontrollene starter riktig.
    this.settings = new SettingsBinding(this.view, localStore());

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = 'viewport';
    this.renderer.domElement.dataset.testid = 'viewport';
    root.appendChild(this.renderer.domElement);

    this.scene.add(this.apartment.root);
    addLights(this.scene);

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
    );
    this.ui = new DesktopUI(root, this.view, this.xr, {
      reload: () => void this.load(),
      goToRoom: (id) => this.goToRoom(id),
      resetView: () => this.desktop.resetView(),
      resetSettings: () => this.settings.reset({ layers: this.store.model?.data.layers ?? [] }),
      defaultSectionHeight: () => this.store.model?.settings.planCutHeight ?? 1500,
      measure: {
        start: () => void this.xr.enterMeasure(),
        stop: () => void this.xr.exit(),
        download: () => this.downloadDraft(),
        copy: () => this.copyDraft(),
        uploadUrl: () => uploadUrl(repoFromLocation()),
        discard: () => this.measure?.discard(),
        adoptStale: () => this.measure?.adoptStale(),
      },
    });
    this.ui.panel.querySelector('.panel-toggle')?.addEventListener('click', () => this.resize());

    this.bindState();
    window.addEventListener('resize', () => this.resize());
    this.renderer.domElement.addEventListener('pointermove', (e) =>
      this.ui.updateCoords(this.desktop.planPointAt(e.clientX, e.clientY)),
    );
    this.desktop.onChange(() => this.ui.updateScale(this.desktop.pixelsPerMeter()));
    this.fps.onUpdate(() => this.ui.updateFps(this.fps.label()));
    this.resize();
  }

  async start(): Promise<void> {
    if (new URLSearchParams(location.search).has('fps')) this.view.fps.set(true);
    void this.xr.checkSupport();
    this.renderer.setAnimationLoop((time, frame) => this.frame(time, frame));
    await this.load();
  }

  async load(): Promise<void> {
    this.ui.showLoading();
    const result = await this.store.load();
    if (!result.ok) {
      console.error('Feil i apartment.json', result.errors);
      this.ui.showErrors(result.errors, result.warnings);
      return;
    }
    this.measure = this.createMeasureSession();
    if (this.measure?.hasMeasurements) this.showDraft();
    else {
      this.applyModel(result.model);
      this.ui.showModel(result.model, result.warnings);
    }
    this.ui.updateMeasure(this.measure);
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
    this.ui.updateMeasure(s);
    if (this.xr.measuring.value) this.draftDirty = true;
    else this.showDraft();
  }

  /** Tegner utkastet fra oppmålingen (eller fila, hvis det ikke finnes målinger). */
  private showDraft(): void {
    this.draftDirty = false;
    const doc = this.measure?.hasMeasurements ? this.measure.draft : this.store.fileDoc;
    if (!doc || doc === this.store.doc) return;
    const r = this.store.setDoc(doc);
    if (!r.ok) {
      console.error('Utkastet er ugyldig', r.errors);
      return;
    }
    this.applyModel(r.model);
    this.ui.showModel(r.model, r.warnings);
  }

  private downloadDraft(): void {
    if (!this.measure) return;
    const blob = new Blob([this.measure.exportText()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'apartment.json';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }

  private async copyDraft(): Promise<boolean> {
    if (!this.measure) return false;
    try {
      await navigator.clipboard.writeText(this.measure.exportText());
      return true;
    } catch {
      return false;
    }
  }

  private applyModel(model: ApartmentModel): void {
    this.view.layers.reset(model.data.layers);
    this.apartment.build(model);
    this.labels.build(model);
    for (const l of model.data.layers) this.applyLayer(l.id, this.view.layers.isVisible(l.id));
    this.apartment.setCeilingsVisible(this.view.ceilings.value);
    this.apartment.setMeasureHighlight(this.view.measureHighlight.value);
    this.scene.background = new THREE.Color(model.settings.backgroundColor);
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
    this.view.sectionHeight.subscribe((mm) => this.desktop.setSectionHeight(mm));
    this.view.ceilings.subscribe((v) => this.apartment.setCeilingsVisible(v));
    this.view.measureHighlight.subscribe((v) => this.apartment.setMeasureHighlight(v));
    this.xr.measuring.subscribe((on) => {
      // Gjennomsyn: bare trådskjelettet fra oppmålingen vises.
      this.apartment.root.visible = !on;
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
    this.renderer.clippingPlanes = cut ? [this.desktop.cutPlane] : [];
    this.materials.setPlanMode(cut);
    this.labels.setVisible(top);
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
      this.renderer.render(this.scene, this.xr.camera);
      return;
    }
    this.desktop.update(dt);
    this.renderer.render(this.scene, this.desktop.camera);
    if (this.view.cameraMode.value === 'top') this.labels.render(this.scene, this.desktop.camera);
  }

  /** Nøkkeltall for tester og feilsøking (window.leilighet.stats()). */
  stats(): Record<string, number> {
    const info = this.renderer.info;
    const s = this.apartment.stats();
    return {
      drawCalls: info.render.calls,
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

function addLights(scene: THREE.Scene): void {
  // Mykt, jevnt lys uten skygger (billig på Quest). Lys "bakkefarge" så
  // tak (som vender nedover) blir lyse og ikke grå/brune.
  const hemi = new THREE.HemisphereLight('#ffffff', '#e4ddd0', 2.3);
  const ambient = new THREE.AmbientLight('#ffffff', 0.6);
  const sun = new THREE.DirectionalLight('#fff4e0', 0.9);
  sun.position.set(-4, 10, -6);
  const fill = new THREE.DirectionalLight('#dfe9ff', 0.45);
  fill.position.set(6, 6, 8);
  scene.add(hemi, ambient, sun, sun.target, fill, fill.target);
}
