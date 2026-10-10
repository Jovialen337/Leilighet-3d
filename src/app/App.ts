/**
 * Setter sammen appen: laster og validerer apartment.json, bygger scenen,
 * og kobler laptop-visning, VR og UI til den felles visningstilstanden.
 */
import * as THREE from 'three';
import { ApartmentStore } from '../model/ApartmentStore';
import type { ApartmentModel } from '../model/ApartmentModel';
import { ApartmentScene } from '../scene/ApartmentScene';
import { Materials } from '../scene/materials';
import { MM } from '../scene/geom';
import { ViewState } from '../state/ViewState';
import { DesktopUI } from '../ui/DesktopUI';
import { FpsMeter } from '../ui/FpsMeter';
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
  private lastTime = -1;
  private loaded = false;

  constructor(private readonly root: HTMLElement) {
    this.store = new ApartmentStore(`${import.meta.env.BASE_URL}apartment.json`);

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

    this.xr = new XRManager(this.renderer, this.scene, this.view, this.apartment, () => this.store.model, this.fps);
    this.ui = new DesktopUI(root, this.view, this.xr, { reload: () => void this.load() });
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
    this.renderer.setAnimationLoop((time) => this.frame(time));
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
    this.applyModel(result.model);
    this.ui.showModel(result.model, result.warnings);
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
    this.view.ceilings.subscribe((v) => this.apartment.setCeilingsVisible(v));
    this.view.measureHighlight.subscribe((v) => this.apartment.setMeasureHighlight(v));
    this.view.inXR.subscribe((inXR) => {
      this.fps.reset();
      this.labels.setVisible(!inXR && this.view.cameraMode.value === 'top');
      this.applyCameraMode();
    });
  }

  /** Plan-modus: klipp i snitthøyden og vis baksider. VR/3D: ingen klipping. */
  private applyCameraMode(): void {
    const top = this.view.cameraMode.value === 'top' && !this.view.inXR.value;
    this.desktop.setMode(this.view.cameraMode.value);
    this.renderer.clippingPlanes = top ? [this.desktop.cutPlane] : [];
    this.materials.setPlanMode(top);
    this.labels.setVisible(top);
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

  private frame(time: number): void {
    const dt = this.lastTime < 0 ? 0 : Math.min(0.1, (time - this.lastTime) / 1000);
    this.lastTime = time;
    this.fps.tick(time);
    if (this.renderer.xr.isPresenting) {
      this.xr.update(dt);
      this.renderer.render(this.scene, this.xr.camera);
      return;
    }
    this.desktop.update();
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
