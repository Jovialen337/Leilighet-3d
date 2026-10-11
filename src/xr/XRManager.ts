/**
 * VR på Quest 3 (WebXR, kun kontrollere i v1).
 *
 * - Start: stående rett innenfor inngangsdøra, med blikket inn i gangen.
 * - Venstre stikke fremover: sikt med teleport-bue, slipp for å hoppe.
 *   Buen lander på gulvet i riktig nivå (gang 0, resten ett trinn opp).
 * - Høyre stikke til siden: snu 30°.
 * - Venstre Y-knapp: vis/skjul bildefrekvens.
 * - Går man fysisk (room-scale) over trinnet, følger gulvhøyden etter.
 *
 * Oppmåling (fase 2) bruker en egen AR-økt med gjennomsyn; da styrer
 * MeasureMode kontrollerne, og teleport/snu/gulvfølging er av.
 */
import * as THREE from 'three';
import type { ApartmentModel } from '../model/ApartmentModel';
import type { MeasureSession } from '../measure/MeasureSession';
import type { ApartmentScene } from '../scene/ApartmentScene';
import { MM } from '../scene/geom';
import { Observable } from '../state/Observable';
import type { ViewState } from '../state/ViewState';
import type { FpsMeter } from '../ui/FpsMeter';
import { MeasureMode, type MeasureDebugState } from './MeasureMode';
import { TeleportArc } from './teleport';
import { WristPanel } from './WristPanel';
import { followFloor, placeAtSpawn, snapTurn, teleportTo } from './rig';

export type XRSupport = 'checking' | 'supported' | 'unsupported' | 'insecure' | 'no-webxr';
export type XRMode = 'walk' | 'measure';

export const SNAP_ANGLE = (30 * Math.PI) / 180;
const AIM_START = -0.6;
const AIM_RELEASE = -0.25;
const TURN_START = 0.6;
const TURN_REARM = 0.3;

interface Slot {
  index: number;
  controller: THREE.XRTargetRaySpace;
  grip: THREE.XRGripSpace;
  source: XRInputSource | null;
}

export interface XRDebugState {
  presenting: boolean;
  mode: XRMode;
  rig: { x: number; y: number; z: number; yaw: number };
  head: { x: number; y: number; z: number };
  aiming: boolean;
  arcHit: { x: number; y: number; z: number; valid: boolean; id: string } | null;
  teleports: number;
  turns: number;
  floorUnderHead: number | null;
}

export class XRManager {
  readonly rig = new THREE.Group();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.03, 300);
  readonly support = new Observable<XRSupport>('checking');
  /** Støtter nettleseren gjennomsyn (immersive-ar)? */
  readonly arSupport = new Observable<boolean | null>(null);
  readonly error = new Observable<string | null>(null);
  /** Oppmåling pågår (AR-økt). */
  readonly measuring = new Observable(false);
  mode: XRMode = 'walk';
  measure: MeasureMode | null = null;
  private requestedMode: XRMode = 'walk';
  private readonly slots: Slot[] = [];
  private readonly arc = new TeleportArc();
  private readonly arcLine: THREE.Line;
  private readonly marker: THREE.Group;
  private readonly wrist = new WristPanel();
  private aiming = false;
  private turnArmed = true;
  private yWasPressed = false;
  private frames = 0;
  private pendingSpawn = false;
  private teleports = 0;
  private turns = 0;
  private floorUnderHead: number | null = null;
  private readonly head = new THREE.Vector3();
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private measureSession: MeasureSession | null = null;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly view: ViewState,
    private readonly apartment: ApartmentScene,
    private readonly getModel: () => ApartmentModel | null,
    private readonly fps: FpsMeter,
    private readonly getMeasureSession: () => MeasureSession | null = () => null,
  ) {
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');

    this.rig.name = 'spillerrigg';
    this.rig.add(this.camera);
    scene.add(this.rig);

    for (let i = 0; i < 2; i++) {
      const slot: Slot = {
        index: i,
        controller: renderer.xr.getController(i),
        grip: renderer.xr.getControllerGrip(i),
        source: null,
      };
      slot.controller.addEventListener('connected', (e) => {
        slot.source = e.data ?? null;
        if (slot.source?.handedness === 'left') slot.grip.add(this.wrist.mesh);
      });
      slot.controller.addEventListener('disconnected', () => {
        if (this.wrist.mesh.parent === slot.grip) slot.grip.remove(this.wrist.mesh);
        slot.source = null;
      });
      slot.grip.add(controllerBody());
      slot.controller.add(pointerLine());
      this.rig.add(slot.controller, slot.grip);
      this.slots.push(slot);
    }

    // Teleport-bue og landingsmarkør (i verdensrommet).
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.arc.points.length * 3), 3));
    this.arcLine = new THREE.Line(arcGeo, new THREE.LineBasicMaterial({ color: '#39d98a' }));
    this.arcLine.frustumCulled = false;
    this.arcLine.visible = false;
    this.marker = teleportMarker();
    this.marker.visible = false;
    scene.add(this.arcLine, this.marker);

    this.wrist.setLines(['Venstre stikke: teleport', 'Høyre stikke: snu 30°', 'Y: vis bildefrekvens']);
    view.fps.subscribe(() => this.updateWristFps(), true);
    fps.onUpdate(() => this.updateWristFps());

    renderer.xr.addEventListener('sessionstart', () => this.onSessionStart());
    renderer.xr.addEventListener('sessionend', () => this.onSessionEnd());
  }

  async checkSupport(): Promise<void> {
    if (!window.isSecureContext) return this.support.set('insecure');
    if (!('xr' in navigator) || !navigator.xr) return this.support.set('no-webxr');
    try {
      const ok = await navigator.xr.isSessionSupported('immersive-vr');
      this.support.set(ok ? 'supported' : 'unsupported');
    } catch {
      this.support.set('unsupported');
    }
    try {
      this.arSupport.set(await navigator.xr.isSessionSupported('immersive-ar'));
    } catch {
      this.arSupport.set(false);
    }
  }

  get presenting(): boolean {
    return this.renderer.xr.isPresenting;
  }

  async enter(): Promise<void> {
    if (!navigator.xr || this.presenting) return;
    this.error.set(null);
    this.requestedMode = 'walk';
    try {
      const session = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor'],
      });
      await this.renderer.xr.setSession(session);
      const hz = Number(new URLSearchParams(location.search).get('hz'));
      if (hz && session.supportedFrameRates?.includes(hz)) await session.updateTargetFrameRate?.(hz);
    } catch (e) {
      this.error.set(`Kunne ikke starte VR: ${(e as Error).message}`);
    }
  }

  /** Starter oppmåling med gjennomsyn (immersive-ar). */
  async enterMeasure(): Promise<void> {
    if (!navigator.xr || this.presenting) return;
    this.error.set(null);
    const ms = this.getMeasureSession();
    if (!ms) return;
    this.requestedMode = 'measure';
    try {
      const session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['local-floor'],
        optionalFeatures: ['hit-test'],
      });
      await this.renderer.xr.setSession(session);
    } catch (e) {
      this.requestedMode = 'walk';
      this.error.set(`Kunne ikke starte oppmåling: ${(e as Error).message}`);
    }
  }

  async exit(): Promise<void> {
    await this.renderer.xr.getSession()?.end();
  }

  private onSessionStart(): void {
    this.frames = 0;
    this.aiming = false;
    this.mode = this.requestedMode;
    const xrSession = this.renderer.xr.getSession();
    const ms = this.getMeasureSession();
    if (this.mode === 'measure' && xrSession && ms) {
      if (!this.measure || this.measureSession !== ms) {
        this.measure?.stop();
        this.measure = new MeasureMode(this.rig, this.camera, this.scene, ms, (hand) => this.slot(hand));
        this.measureSession = ms;
      }
      this.pendingSpawn = false;
      this.setPointersVisible(false);
      this.wrist.mesh.visible = false;
      this.measure.start(xrSession);
      this.measuring.set(true);
    } else {
      this.mode = 'walk';
      this.pendingSpawn = true;
      this.spawn(new THREE.Vector3(), new THREE.Quaternion());
    }
    this.view.inXR.set(true);
  }

  private onSessionEnd(): void {
    this.aiming = false;
    this.arcLine.visible = false;
    this.marker.visible = false;
    if (this.mode === 'measure') {
      this.measure?.stop();
      this.setPointersVisible(true);
      this.wrist.mesh.visible = true;
      this.mode = 'walk';
      this.requestedMode = 'walk';
      this.measuring.set(false);
    }
    this.view.inXR.set(false);
  }

  private setPointersVisible(visible: boolean): void {
    for (const s of this.slots) {
      const line = s.controller.getObjectByName('peker');
      if (line) line.visible = visible;
    }
  }

  /** Setter brukeren innenfor inngangsdøra (fra apartment.json). */
  private spawn(headLocal: THREE.Vector3, headQuat: THREE.Quaternion): void {
    const model = this.getModel();
    if (!model) return;
    const s = model.spawn();
    placeAtSpawn(this.rig, headLocal, headQuat, new THREE.Vector3(s.position.x * MM, s.level * MM, s.position.z * MM), s.facing);
  }

  /** Kalles hver ramme i VR, før tegning. */
  update(dt: number, frame?: XRFrame, time = performance.now()): void {
    const model = this.getModel();
    if (!model) return;
    this.frames++;

    // Y-knappen viser/skjuler bildefrekvens (begge moduser).
    const yPressed = this.gamepad('left')?.buttons[5]?.pressed ?? false;
    if (yPressed && !this.yWasPressed) this.view.fps.set(!this.view.fps.value);
    this.yWasPressed = yPressed;

    if (this.mode === 'measure' && this.measure) {
      this.measure.update(frame, this.renderer.xr.getReferenceSpace(), time);
      this.camera.getWorldPosition(this.head);
      return;
    }

    this.camera.getWorldPosition(this.head);

    if (this.pendingSpawn && this.frames >= 3) {
      this.pendingSpawn = false;
      this.spawn(this.camera.position.clone(), this.camera.quaternion.clone());
      this.camera.getWorldPosition(this.head);
    }

    const left = this.gamepad('left');
    const right = this.gamepad('right');

    // Teleport med venstre stikke.
    const ly = left?.axes[3] ?? 0;
    if (!this.aiming && ly < AIM_START) this.aiming = true;
    if (this.aiming) {
      const slot = this.slot('left');
      if (slot) this.aim(slot);
      if (ly > AIM_RELEASE) {
        const hit = this.arc.hit;
        if (hit?.valid) {
          teleportTo(this.rig, this.head, hit.point);
          this.teleports++;
          this.camera.getWorldPosition(this.head);
        }
        this.aiming = false;
        this.arcLine.visible = false;
        this.marker.visible = false;
      }
    }

    // Snu 30° med høyre stikke.
    const rx = right?.axes[2] ?? 0;
    if (this.turnArmed && Math.abs(rx) > TURN_START) {
      snapTurn(this.rig, this.head, -Math.sign(rx) * SNAP_ANGLE);
      this.turns++;
      this.turnArmed = false;
    } else if (Math.abs(rx) < TURN_REARM) {
      this.turnArmed = true;
    }

    // Gulvet følger med når man går fysisk opp/ned trinnet.
    const level = model.floorLevelAt({ x: this.head.x / MM, z: this.head.z / MM });
    this.floorUnderHead = level;
    if (level !== null) followFloor(this.rig, level * MM, dt);
  }

  private aim(slot: Slot): void {
    slot.controller.getWorldPosition(this.tmpPos);
    slot.controller.getWorldQuaternion(this.tmpQuat);
    this.tmpDir.set(0, 0, -1).applyQuaternion(this.tmpQuat).normalize();
    const hit = this.arc.compute(this.tmpPos, this.tmpDir, this.apartment.visibleProxies());
    const attr = this.arcLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.arc.count; i++) {
      const p = this.arc.points[i]!;
      attr.setXYZ(i, p.x, p.y, p.z);
    }
    attr.needsUpdate = true;
    this.arcLine.geometry.setDrawRange(0, this.arc.count);
    const color = hit?.valid ? '#39d98a' : '#ff5a5a';
    (this.arcLine.material as THREE.LineBasicMaterial).color.set(color);
    this.arcLine.visible = true;
    if (hit) {
      this.marker.position.copy(hit.point).y += 0.005;
      for (const c of this.marker.children) ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(color);
      this.marker.visible = true;
    } else {
      this.marker.visible = false;
    }
  }

  private slot(hand: XRHandedness): Slot | undefined {
    return this.slots.find((s) => s.source?.handedness === hand);
  }

  private gamepad(hand: XRHandedness): Gamepad | null {
    return this.slot(hand)?.source?.gamepad ?? null;
  }

  measureDebug(): MeasureDebugState | null {
    return this.measure?.debugState() ?? null;
  }

  private updateWristFps(): void {
    this.wrist.setFps(this.view.fps.value ? this.fps.label() : null);
  }

  debugState(): XRDebugState {
    const hit = this.arc.hit;
    this.camera.getWorldPosition(this.head);
    return {
      presenting: this.presenting,
      mode: this.mode,
      rig: { x: this.rig.position.x, y: this.rig.position.y, z: this.rig.position.z, yaw: this.rig.rotation.y },
      head: { x: this.head.x, y: this.head.y, z: this.head.z },
      aiming: this.aiming,
      arcHit: hit ? { x: hit.point.x, y: hit.point.y, z: hit.point.z, valid: hit.valid, id: hit.id } : null,
      teleports: this.teleports,
      turns: this.turns,
      floorUnderHead: this.floorUnderHead,
    };
  }
}

function controllerBody(): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.035, 0.03, 0.11),
    new THREE.MeshLambertMaterial({ color: '#2b2f33' }),
  );
  body.position.z = 0.02;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.04, 0.006, 6, 20),
    new THREE.MeshLambertMaterial({ color: '#4a5058' }),
  );
  ring.position.set(0, 0.02, -0.035);
  ring.rotation.x = Math.PI / 2.5;
  g.add(body, ring);
  return g;
}

function pointerLine(): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -0.35)]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5 }));
  line.name = 'peker';
  return line;
}

function teleportMarker(): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.16, 0.22, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#39d98a', transparent: true, opacity: 0.9, depthWrite: false }),
  );
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(0.05, 20).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#39d98a', transparent: true, opacity: 0.9, depthWrite: false }),
  );
  g.add(ring, dot);
  g.renderOrder = 5;
  return g;
}
