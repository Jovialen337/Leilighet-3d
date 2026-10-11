/**
 * Laptop-visning: 3D med banekamera (orbit) eller 2D-plan ovenfra
 * (ortografisk, i riktig målestokk). I plan-modus kuttes modellen i
 * snitthøyden som i en arkitekttegning, og et 1 m-rutenett tegnes over.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ApartmentModel } from '../model/ApartmentModel';
import type { CameraMode } from '../state/ViewState';
import { MM } from '../scene/geom';

const PLAN_MARGIN = 1.2; // m rundt leiligheten i plan-visningen

export class DesktopView {
  readonly perspective = new THREE.PerspectiveCamera(50, 1, 0.05, 300);
  readonly ortho = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 300);
  readonly orbit: OrbitControls;
  readonly plan: OrbitControls;
  readonly grid = new THREE.Group();
  /** Klippeplan for plan-visningen: beholder alt under snitthøyden. */
  readonly cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.5);
  mode: CameraMode = 'orbit';
  private width = 1;
  private height = 1;
  private planHalfHeight = 5;
  /** Piksler til venstre som dekkes av panelet; innholdet sentreres i resten. */
  private insetLeft = 0;
  private readonly changeListeners = new Set<() => void>();
  /** Myk kameraflytting («Gå til rom»). */
  private tween: {
    t: number;
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    fromZoom: number;
    toZoom: number;
    controls: OrbitControls;
    camera: THREE.Camera & { zoom: number };
  } | null = null;
  private lastModel: ApartmentModel | null = null;

  constructor(private readonly dom: HTMLElement) {
    this.orbit = new OrbitControls(this.perspective, dom);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.12;
    this.orbit.maxPolarAngle = Math.PI * 0.49;
    this.orbit.minDistance = 1;
    this.orbit.maxDistance = 60;

    this.ortho.up.set(0, 0, -1);
    this.plan = new OrbitControls(this.ortho, dom);
    this.plan.enableRotate = false;
    this.plan.screenSpacePanning = true;
    this.plan.zoomToCursor = true;
    this.plan.minZoom = 0.3;
    this.plan.maxZoom = 20;
    this.plan.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.plan.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    this.plan.enabled = false;

    for (const c of [this.orbit, this.plan]) c.addEventListener('change', () => this.emitChange());
    this.grid.name = 'rutenett';
    this.grid.visible = false;
  }

  get camera(): THREE.Camera {
    return this.mode === 'top' ? this.ortho : this.perspective;
  }

  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private emitChange(): void {
    for (const l of this.changeListeners) l();
  }

  /** Plasserer kameraene så hele leiligheten synes. */
  fit(model: ApartmentModel): void {
    const e = model.extent();
    const cx = ((e.minX + e.maxX) / 2) * MM;
    const cz = ((e.minZ + e.maxZ) / 2) * MM;
    const w = (e.maxX - e.minX) * MM;
    const d = (e.maxZ - e.minZ) * MM;
    const r = Math.max(w, d);

    this.orbit.target.set(cx, 0.6, cz);
    this.perspective.position.set(cx - r * 0.1, r * 1.25, cz + r * 0.85);
    this.orbit.update();

    const availW = Math.max(1, this.width - this.insetLeft);
    this.planHalfHeight = Math.max(d / 2, w / 2 / Math.max(0.3, availW / this.height)) + PLAN_MARGIN;
    this.updateOrthoFrustum();
    // Flytt kameraet så leiligheten havner midt i området til høyre for panelet.
    const shift = this.insetLeft / 2 / ((this.height / (2 * this.planHalfHeight)) || 1);
    this.ortho.position.set(cx - shift, 60, cz);
    this.ortho.zoom = 1;
    this.plan.target.set(cx - shift, 0, cz);
    this.plan.update();

    this.lastModel = model;
    this.setSectionHeight(null, model);
    this.emitChange();
  }

  /** Snitthøyde (mm over laveste gulv); null = fra fila. Flytter også rutenettet. */
  setSectionHeight(mm: number | null, model: ApartmentModel | null = this.lastModel): void {
    if (!model) return;
    this.lastModel = model;
    const h = mm ?? model.settings.planCutHeight;
    this.cutPlane.constant = (model.lowestFloor + h) * MM;
    this.buildGrid(model);
    this.emitChange();
  }

  /** Flytter kameraet mykt så rommet fyller bildet (3D: skrått ovenfra; 2D: rett ovenfra). */
  focusRoom(model: ApartmentModel, roomId: string): boolean {
    const info = model.rooms.get(roomId);
    if (!info) return false;
    const b = info.bounds;
    const cx = ((b.minX + b.maxX) / 2) * MM;
    const cz = ((b.minZ + b.maxZ) / 2) * MM;
    const r = (Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * MM) / 2 + 0.6;
    const floor = info.room.floorLevel * MM;
    if (this.mode === 'top') {
      const zoom = Math.min(this.plan.maxZoom, Math.max(this.plan.minZoom, this.planHalfHeight / (r * 1.15)));
      const target = new THREE.Vector3(cx, 0, cz);
      this.startTween(this.plan, this.ortho, new THREE.Vector3(cx, 60, cz), target, zoom);
    } else {
      const target = new THREE.Vector3(cx, floor + 0.8, cz);
      const dir = this.perspective.position.clone().sub(this.orbit.target);
      dir.y = 0;
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
      dir.normalize().multiplyScalar(r * 1.1);
      const pos = target.clone().add(dir).setY(floor + r * 1.6 + 1);
      this.startTween(this.orbit, this.perspective, pos, target, 1);
    }
    return true;
  }

  private startTween(
    controls: OrbitControls,
    camera: THREE.Camera & { zoom: number },
    toPos: THREE.Vector3,
    toTarget: THREE.Vector3,
    toZoom: number,
  ): void {
    this.tween = {
      t: 0,
      fromPos: camera.position.clone(),
      toPos,
      fromTarget: controls.target.clone(),
      toTarget,
      fromZoom: camera.zoom,
      toZoom,
      controls,
      camera,
    };
  }

  /** Tilbake til oversikten over hele leiligheten. */
  resetView(): void {
    if (this.lastModel) this.fit(this.lastModel);
  }

  /** Høyde over laveste gulv (mm) som modellen kuttes i nå. */
  get sectionHeight(): number {
    return this.lastModel ? this.cutPlane.constant / MM - this.lastModel.lowestFloor : 1500;
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.orbit.enabled = mode === 'orbit';
    this.plan.enabled = mode === 'top';
    this.grid.visible = mode === 'top';
    this.emitChange();
  }

  resize(width: number, height: number, insetLeft = this.insetLeft): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.insetLeft = insetLeft;
    this.perspective.aspect = this.width / this.height;
    if (insetLeft > 0) this.perspective.setViewOffset(this.width, this.height, -insetLeft / 2, 0, this.width, this.height);
    else this.perspective.clearViewOffset();
    this.perspective.updateProjectionMatrix();
    this.updateOrthoFrustum();
    this.emitChange();
  }

  private updateOrthoFrustum(): void {
    const aspect = this.width / this.height;
    this.ortho.top = this.planHalfHeight;
    this.ortho.bottom = -this.planHalfHeight;
    this.ortho.left = -this.planHalfHeight * aspect;
    this.ortho.right = this.planHalfHeight * aspect;
    this.ortho.updateProjectionMatrix();
  }

  update(dt = 1 / 60): void {
    const tw = this.tween;
    if (tw) {
      tw.t = Math.min(1, tw.t + dt / 0.6);
      const k = tw.t * tw.t * (3 - 2 * tw.t);
      tw.camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
      tw.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, k);
      if (tw.camera instanceof THREE.OrthographicCamera) {
        tw.camera.zoom = tw.fromZoom + (tw.toZoom - tw.fromZoom) * k;
        tw.camera.updateProjectionMatrix();
      }
      if (tw.t >= 1) this.tween = null;
      this.emitChange();
    }
    if (this.mode === 'top') this.plan.update();
    else this.orbit.update();
  }

  /** Skjermpiksler per meter i plan-visningen (for målestokk). */
  pixelsPerMeter(): number {
    return (this.height * this.ortho.zoom) / (this.ortho.top - this.ortho.bottom);
  }

  /** Verdenspunkt (mm) under et skjermpunkt i plan-visningen. */
  planPointAt(clientX: number, clientY: number): { x: number; z: number } | null {
    if (this.mode !== 'top') return null;
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector3(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
      0,
    );
    ndc.unproject(this.ortho);
    return { x: ndc.x / MM, z: ndc.z / MM };
  }

  /** Skjermposisjon (CSS-piksler, relativt til lerretet) for et punkt i mm. */
  screenOf(xMm: number, yMm: number, zMm: number): { x: number; y: number } {
    const v = new THREE.Vector3(xMm * MM, yMm * MM, zMm * MM).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
  }

  private buildGrid(model: ApartmentModel): void {
    for (const c of this.grid.children) {
      const l = c as THREE.LineSegments;
      l.geometry.dispose();
      (l.material as THREE.Material).dispose();
    }
    this.grid.clear();
    const e = model.extent();
    const x0 = Math.floor(e.minX * MM) - 2;
    const x1 = Math.ceil(e.maxX * MM) + 2;
    const z0 = Math.floor(e.minZ * MM) - 2;
    const z1 = Math.ceil(e.maxZ * MM) + 2;
    const y = this.cutPlane.constant - 0.01;
    const minor: number[] = [];
    const major: number[] = [];
    for (let x = x0; x <= x1; x++) (x === 0 ? major : minor).push(x, y, z0, x, y, z1);
    for (let z = z0; z <= z1; z++) (z === 0 ? major : minor).push(x0, y, z, x1, y, z);
    const mk = (pts: number[], color: string, opacity: number): THREE.LineSegments => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false });
      const l = new THREE.LineSegments(g, m);
      l.renderOrder = 10;
      l.frustumCulled = false;
      return l;
    };
    this.grid.add(mk(minor, '#1f3a4d', 0.22), mk(major, '#c0392b', 0.6));
  }

  dispose(): void {
    this.orbit.dispose();
    this.plan.dispose();
  }
}
