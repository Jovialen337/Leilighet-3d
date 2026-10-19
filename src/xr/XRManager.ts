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
import { BuildMode, type BuildDebugState } from './BuildMode';
import type { BuilderSession } from '../builder/BuilderSession';
import { TeleportArc } from './teleport';
import { WristPanel } from './WristPanel';
import { WristMenu } from './WristMenu';
import { DRAW_ITEMS, buildMenu, type MenuTab } from './menuLayout';
import type { PlanController } from '../plan/PlanController';
import { FIXTURE_TEXT, PIPE_KIND_TEXT, WIRE_KIND_TEXT, type DrawOptions } from '../plan/draw';
import { QUALITIES, type Quality, type TurnMode, type XRRate } from '../state/ViewState';
import { WATER_FIXTURES } from '../schema/types';
import { LAYER_GROUPS, LAYER_PRESETS, applyPreset, groupState, setGroup } from '../state/layerGroups';
import { followFloor, placeAtSpawn, snapTurn, teleportTo } from './rig';
import { Fade } from './fade';
import { graphicsProfile } from '../scene/graphicsProfile';
import { LIGHT_IDS, type LightId } from '../scene/lighting';

export type XRSupport = 'checking' | 'supported' | 'unsupported' | 'insecure' | 'no-webxr';
/** walk = VR; measure = oppmåling av fila; build = oppmåling av ny modell (begge gjennomsyn). */
export type XRMode = 'walk' | 'measure' | 'build';

export const SNAP_ANGLE = (30 * Math.PI) / 180;
/** Myk dreiing: grader per sekund ved fullt utslag. */
export const SMOOTH_TURN_SPEED = (90 * Math.PI) / 180;
const AIM_START = -0.6;
const AIM_RELEASE = -0.25;
const TURN_START = 0.6;
const TURN_REARM = 0.3;
const SMOOTH_DEADZONE = 0.2;

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
  menu: { open: boolean; tab: MenuTab; hovered: string | null };
  draw: { tool: string | null; points: number; hover: { x: number; h: number; z: number } | null };
  /** Overgangen fra svart: hvor svart (0–1) og om den pågår. */
  fade: { opacity: number; visible: boolean; active: boolean };
  exposure: number;
}

export class XRManager {
  readonly rig = new THREE.Group();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.03, 300);
  readonly support = new Observable<XRSupport>('checking');
  /** Støtter nettleseren gjennomsyn (immersive-ar)? */
  readonly arSupport = new Observable<boolean | null>(null);
  readonly error = new Observable<string | null>(null);
  /** Oppmåling pågår (AR-økt med gjennomsyn: fila eller ny modell). */
  readonly measuring = new Observable(false);
  mode: XRMode = 'walk';
  measure: MeasureMode | null = null;
  /** Oppmåling av ny modell («Lag ny modell»). */
  build: BuildMode | null = null;
  /**
   * Kan el og vann tegnes i VR nå? Ikke mens man går gjennom en ny modell:
   * den har sin egen ramme, så tegningene ville havnet feil i fila.
   */
  canDraw: () => boolean = () => true;
  private requestedMode: XRMode = 'walk';
  private readonly slots: Slot[] = [];
  private readonly arc = new TeleportArc();
  private readonly arcLine: THREE.Line;
  private readonly marker: THREE.Group;
  private readonly wrist = new WristPanel();
  readonly menu = new WristMenu();
  private menuTab: MenuTab = 'visning';
  private menuDirty = true;
  private xWasPressed = false;
  private triggerWasPressed = false;
  /** Avtrekkeren ble trykket ned denne rammen (og er ikke brukt av menyen ennå). */
  private triggerEdge = false;
  /** Aktivt tegneverktøy i VR (id fra DRAW_ITEMS), eller null. */
  private drawTool: string | null = null;
  /** Oppløsningen VR-økten startet med (kan bare settes før økten starter). */
  private sessionScale = 1;
  /** Eksponeringen fra «Lys» (overgangen løfter mot denne). */
  exposure = 1;
  /** Overgang fra svart ved start og hopp. */
  readonly fade: Fade;
  private aWasPressed = false;
  private lastHelp = 0;
  private bWasPressed = false;
  private readonly drawRay = new THREE.Raycaster();
  private readonly drawHits: THREE.Intersection[] = [];
  private readonly drawO = new THREE.Vector3();
  private readonly drawD = new THREE.Vector3();
  /** Gjenbrukt resultat fra strålen (ingen nye objekter per ramme). */
  private readonly drawTargetObj = { p: { x: 0, z: 0 }, h: 0 };
  private aiming = false;
  private turnArmed = true;
  private smoothTurning = false;
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
    private readonly plan: PlanController | null = null,
    private readonly getBuilderSession: () => BuilderSession | null = () => null,
  ) {
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');

    this.rig.name = 'spillerrigg';
    this.rig.add(this.camera);
    this.fade = new Fade(this.camera);
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
    this.arcLine = new THREE.Line(arcGeo, new THREE.LineBasicMaterial({ toneMapped: false, color: '#39d98a' }));
    this.arcLine.frustumCulled = false;
    this.arcLine.visible = false;
    this.marker = teleportMarker();
    this.marker.visible = false;
    scene.add(this.arcLine, this.marker);

    view.turn.subscribe(() => this.updateWristHelp(), true);
    scene.add(this.menu.mesh, this.menu.cursor);
    const dirty = (): void => {
      this.menuDirty = true;
    };
    for (const o of [view.ceilings, view.measureHighlight, view.fps, view.quality, view.light, view.turn, view.xrRate, view.showExisting, view.showPlanned, view.xray, view.circuit] as const)
      (o as { subscribe: (l: () => void) => void }).subscribe(dirty);
    view.xrRate.subscribe(() => void this.applyFrameRate());
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
      // «Høy» grafikk: litt høyere oppløsning i VR (må settes før økten starter).
      this.sessionScale = this.profile().framebufferScale;
      this.renderer.xr.setFramebufferScaleFactor(this.sessionScale);
      const session = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor'],
      });
      await this.renderer.xr.setSession(session);
      await this.applyFrameRate(session);
    } catch (e) {
      this.error.set(`Kunne ikke starte VR: ${(e as Error).message}`);
    }
  }

  /** Beskjed når grafikkvalget endrer oppløsningen (gjelder fra neste VR-økt). */
  private qualityNote(): string | null {
    if (this.mode !== 'walk' || !this.presenting) return null;
    const scale = this.profile().framebufferScale;
    if (scale === this.sessionScale) return null;
    return scale > this.sessionScale ? 'Skarpere nå – full oppløsning neste gang du går inn i VR.' : 'Oppløsningen endres neste gang du går inn i VR.';
  }

  private profile() {
    return graphicsProfile({ quality: this.view.quality.value, top: false, passthrough: false });
  }

  /** Bildefrekvens fra innstillingene (eller ?hz= i adressen), hvis hodesettet støtter den. */
  private async applyFrameRate(session: XRSession | null = this.renderer.xr.getSession()): Promise<void> {
    if (!session) return;
    const hz = Number(new URLSearchParams(location.search).get('hz')) || this.view.xrRate.value;
    try {
      if (session.supportedFrameRates?.includes(hz) && session.frameRate !== hz) await session.updateTargetFrameRate?.(hz);
    } catch {
      /* hodesettet nektet; beholder standard */
    }
  }

  /** Flytter brukeren til et godt sted i rommet, med blikket innover («Gå til rom»). */
  goToRoom(roomId: string): boolean {
    const vp = this.getModel()?.roomViewpoint(roomId);
    if (!vp || !this.presenting || this.mode !== 'walk') return false;
    // Et langt hopp: kort svart, så fade inn på det nye stedet.
    this.fade.jump(() => {
      placeAtSpawn(
        this.rig,
        this.camera.position,
        this.camera.quaternion,
        new THREE.Vector3(vp.position.x * MM, vp.level * MM, vp.position.z * MM),
        vp.facing,
      );
      this.teleports++;
      this.camera.getWorldPosition(this.head);
    });
    return true;
  }

  /** Tilbake til inngangsdøra. */
  goToStart(): boolean {
    if (!this.presenting || this.mode !== 'walk') return false;
    this.fade.jump(() => {
      this.spawn(this.camera.position, this.camera.quaternion);
      this.camera.getWorldPosition(this.head);
    });
    return true;
  }

  /** Starter oppmåling med gjennomsyn (immersive-ar). */
  async enterMeasure(): Promise<void> {
    if (!navigator.xr || this.presenting) return;
    this.error.set(null);
    const ms = this.getMeasureSession();
    if (!ms) return;
    this.requestedMode = 'measure';
    try {
      this.renderer.xr.setFramebufferScaleFactor(1);
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

  /** Oppmåling av en ny modell i gjennomsyn («Lag ny modell»). */
  async enterBuild(): Promise<void> {
    if (!navigator.xr || this.presenting || !this.getBuilderSession()) return;
    this.error.set(null);
    this.requestedMode = 'build';
    try {
      this.renderer.xr.setFramebufferScaleFactor(1);
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
    const bs = this.getBuilderSession();
    if (this.mode === 'build' && xrSession && bs) {
      if (!this.build) this.build = new BuildMode(this.rig, this.camera, this.scene, bs, (hand) => this.slot(hand), this.menu, () => void this.exit());
      this.pendingSpawn = false;
      this.setPointersVisible(false);
      this.wrist.mesh.visible = false;
      this.build.start(xrSession);
      this.measuring.set(true);
    } else if (this.mode === 'measure' && xrSession && ms) {
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
      // Inn fra svart: hopper til startpunktet de første bildene synes ikke.
      this.fade.enter();
      this.renderer.toneMappingExposure = this.exposure * this.fade.update(0);
    }
    this.view.inXR.set(true);
  }

  private onSessionEnd(): void {
    this.aiming = false;
    this.fade.stop();
    this.renderer.toneMappingExposure = this.exposure;
    this.setMenuOpen(false);
    // Tegning i VR avsluttes sammen med økten: et halvferdig strekk forkastes og
    // verktøyet går tilbake til «Velg» (et verktøy valgt på PC beholdes).
    if (this.drawTool && this.plan) this.plan.set({ tool: 'select' });
    this.drawTool = null;
    if (this.plan) this.plan.hover = null;
    this.updateWristHelp();
    this.arcLine.visible = false;
    this.marker.visible = false;
    if (this.mode === 'build') {
      this.build?.stop();
      this.setPointersVisible(true);
      this.wrist.mesh.visible = true;
      this.mode = 'walk';
      this.requestedMode = 'walk';
      this.measuring.set(false);
    }
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
    // Oppmåling av ny modell trenger ingen modell (tegningen kan være tom).
    if (this.mode === 'build' && this.build) {
      this.build.update(frame, this.renderer.xr.getReferenceSpace(), time);
      this.camera.getWorldPosition(this.head);
      return;
    }
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
    if (this.fade.active) this.renderer.toneMappingExposure = this.exposure * this.fade.update(dt);

    if (this.pendingSpawn && this.frames >= 3) {
      this.pendingSpawn = false;
      this.spawn(this.camera.position.clone(), this.camera.quaternion.clone());
      this.camera.getWorldPosition(this.head);
    }

    const left = this.gamepad('left');
    const right = this.gamepad('right');

    this.updateMenu(left, right);
    this.updateDraw(right);

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

    this.turn(right, dt);

    // Gulvet følger med når man går fysisk opp/ned trinnet.
    const level = model.floorLevelAt({ x: this.head.x / MM, z: this.head.z / MM });
    this.floorUnderHead = level;
    if (level !== null) followFloor(this.rig, level * MM, dt);
  }

  /* ---------------- VR-meny (X) ---------------- */

  setMenuOpen(open: boolean): void {
    this.menu.setOpen(open);
    this.wrist.mesh.visible = !open && this.mode === 'walk';
    if (open) this.menuDirty = true;
  }

  private updateMenu(left: Gamepad | null, right: Gamepad | null): void {
    const x = left?.buttons[4]?.pressed ?? false;
    if (x && !this.xWasPressed) this.setMenuOpen(!this.menu.open);
    this.xWasPressed = x;
    const trigger = (right?.buttons[0]?.value ?? 0) > 0.6;
    const pressed = trigger && !this.triggerWasPressed;
    this.triggerWasPressed = trigger;
    this.triggerEdge = pressed;
    if (!this.menu.open) return;
    this.triggerEdge = false; // menyen bruker avtrekkeren

    const leftSlot = this.slot('left');
    const rightSlot = this.slot('right');
    if (leftSlot) this.menu.place(leftSlot.grip, this.head);
    if (this.menuDirty) {
      this.menuDirty = false;
      this.menu.setState(this.menuState());
    }
    if (!rightSlot) return;
    const { changed } = this.menu.point(rightSlot.controller);
    if (changed) this.pulse(rightSlot, 0.25, 15);
    if (pressed && this.menu.hovered) {
      this.menuAction(this.menu.hovered.id);
      this.pulse(rightSlot, 0.6, 40);
    }
  }

  private menuState() {
    const model = this.getModel();
    return {
      tab: this.menuTab,
      ceilings: this.view.ceilings.value,
      highlight: this.view.measureHighlight.value,
      fps: this.view.fps.value,
      quality: this.view.quality.value,
      light: this.view.light.value,
      turn: this.view.turn.value,
      rate: this.view.xrRate.value,
      layers: this.view.layers.layers.map((l) => ({ id: l.id, name: l.name, visible: this.view.layers.isVisible(l.id) })),
      rooms: model ? [...model.rooms.values()].map((r) => ({ id: r.room.id, name: r.room.name })) : [],
      showExisting: this.view.showExisting.value,
      showPlanned: this.view.showPlanned.value,
      xray: this.view.xray.value,
      groups: LAYER_GROUPS.map((g) => ({ id: g.id, name: g.name, state: groupState(this.view.layers, g.id) }))
        .filter((g): g is { id: string; name: string; state: 'on' | 'off' | 'mixed' } => g.state !== 'empty'),
      presets: LAYER_PRESETS.map((p) => ({ id: p.id, name: p.name })),
      drawTool: this.drawTool,
      drawPlanned: (this.plan?.options.value.status ?? 'planned') === 'planned',
      circuits: model ? (model.data.circuits ?? []).map((c) => ({ id: c.id, name: c.name })) : [],
      drawCircuit: this.plan?.options.value.circuit ?? null,
      filterCircuit: this.view.circuit.value,
      drawBlocked: !this.canDraw(),
      qualityNote: this.qualityNote(),
    };
  }

  /** Utfører en menyknapp (id fra menuLayout). */
  menuAction(id: string): void {
    const [kind, arg = ''] = id.split(':') as [string, string?];
    const v = this.view;
    switch (kind) {
      case 'tab':
        this.menuTab = arg as MenuTab;
        break;
      case 'toggle':
        if (arg === 'ceilings') v.ceilings.set(!v.ceilings.value);
        else if (arg === 'highlight') v.measureHighlight.set(!v.measureHighlight.value);
        else if (arg === 'fps') v.fps.set(!v.fps.value);
        else if (arg === 'existing') v.showExisting.set(!v.showExisting.value);
        else if (arg === 'planned') v.showPlanned.set(!v.showPlanned.value);
        else if (arg === 'xray') v.xray.set(!v.xray.value);
        break;
      case 'preset':
        applyPreset(v.layers, arg);
        break;
      case 'group':
        setGroup(v.layers, arg, groupState(v.layers, arg) === 'off');
        break;
      case 'quality':
        if ((QUALITIES as readonly string[]).includes(arg)) v.quality.set(arg as Quality);
        break;
      case 'light':
        if ((LIGHT_IDS as readonly string[]).includes(arg)) v.light.set(arg as LightId);
        break;
      case 'layer':
        v.layers.toggle(arg);
        break;
      case 'turn':
        v.turn.set((arg === 'smooth' ? 'smooth' : Number(arg)) as TurnMode);
        break;
      case 'rate':
        v.xrRate.set(Number(arg) as XRRate);
        break;
      case 'room':
        this.goToRoom(arg);
        this.setMenuOpen(false);
        break;
      case 'start':
        this.goToStart();
        this.setMenuOpen(false);
        break;
      case 'draw':
        this.drawAction(id);
        break;
      case 'circuit':
        v.circuit.set(arg === 'next' ? this.nextCircuit(v.circuit.value) : null);
        break;
      case 'drawcircuit':
        if (this.plan) {
          this.plan.set({ circuit: this.nextCircuit(this.plan.options.value.circuit ?? null) });
          this.updateWristHelp();
        }
        break;
    }
    this.menuDirty = true;
  }

  /* ---------------- Tegning i VR ---------------- */

  private drawAction(id: string): void {
    const p = this.plan;
    if (!p || !this.canDraw()) return;
    const [, what = '', arg = ''] = id.split(':');
    if (what === 'status') {
      p.set({ status: p.options.value.status === 'planned' ? 'existing' : 'planned' });
      return;
    }
    if (what === 'off') {
      p.set({ tool: 'select' });
      this.drawTool = null;
      this.updateWristHelp();
      this.setMenuOpen(false);
      return;
    }
    const patch: Partial<DrawOptions> =
      what === 'wire'
        ? { tool: 'wire', wireKind: arg as DrawOptions['wireKind'], height: 300 }
        : what === 'pipe'
          ? { tool: 'pipe', pipeKind: arg as DrawOptions['pipeKind'], height: 300 }
          : what === 'fixture'
            ? { tool: 'fixture', fixtureType: arg as DrawOptions['fixtureType'] }
            : { tool: 'select' };
    p.set(patch);
    this.drawTool = DRAW_ITEMS.some((d) => d.id === id) ? id : null;
    this.updateWristHelp();
    this.setMenuOpen(false);
  }

  /** Strålen fra høyre kontroller treffer vegg/gulv/tak: punktet (mm) og høyden over gulvet. */
  private drawTarget(): { p: { x: number; z: number }; h: number } | null {
    const slot = this.slot('right');
    const model = this.getModel();
    if (!slot || !model) return null;
    slot.controller.getWorldPosition(this.drawO);
    this.drawD.set(0, 0, -1).transformDirection(slot.controller.matrixWorld);
    this.drawRay.set(this.drawO, this.drawD);
    this.drawRay.far = 8;
    this.drawHits.length = 0;
    const hit = this.drawRay.intersectObjects(this.apartment.visibleProxies(), false, this.drawHits)[0];
    if (!hit) return null;
    const t = this.drawTargetObj;
    t.p.x = hit.point.x / MM;
    t.p.z = hit.point.z / MM;
    t.h = Math.max(0, Math.round(hit.point.y / MM - model.floorOrDefault(t.p)));
    return t;
  }

  private updateDraw(right: Gamepad | null): void {
    const p = this.plan;
    const edge = this.triggerEdge;
    this.triggerEdge = false;
    if (this.drawTool && !this.canDraw()) {
      // Tegning ble skrudd av (f.eks. byggeren tok over visningen): avslutt verktøyet.
      this.drawTool = null;
      if (p) {
        p.set({ tool: 'select' });
        p.hover = null;
      }
      this.updateWristHelp();
    }
    if (!p || !this.drawTool || this.menu.open) {
      if (p && !this.drawTool) p.hover = null;
      return;
    }
    const a = right?.buttons[4]?.pressed ?? false;
    const b = right?.buttons[5]?.pressed ?? false;
    const aEdge = a && !this.aWasPressed;
    const bEdge = b && !this.bWasPressed;
    this.aWasPressed = a;
    this.bWasPressed = b;

    const t = this.drawTarget();
    // I VR festes det innen 6 cm; høyden festes til forrige punkt (vannrett strekk).
    let h = t?.h;
    const last = p.draft.last;
    if (t && last && h !== undefined && Math.abs(h - last[1]) < 60) h = last[1];
    p.hoverAt(t?.p ?? null, 60, h);
    const slot = this.slot('right');
    if (edge && t) {
      const before = p.edits.size + p.draft.points.length;
      p.click(p.hover?.p ?? t.p, p.tool === 'select' ? 200 : 60, p.hover?.h ?? h);
      if (slot) this.pulse(slot, p.edits.size + p.draft.points.length !== before || p.tool === 'select' ? 0.6 : 0.2, 40);
    }
    if (aEdge) {
      const ok = p.tool === 'select' ? p.deleteSelected() : p.finish();
      if (slot) this.pulse(slot, ok ? 0.8 : 0.3, ok ? 80 : 30);
    }
    if (bEdge) p.undo();
    // Hjelpeteksten (med lengde) tegnes høyst 4 ganger i sekundet, og bare når teksten er endret.
    const now = performance.now();
    if (edge || aEdge || bEdge || now - this.lastHelp > 250) {
      this.lastHelp = now;
      this.updateWristHelp();
    }
  }

  private pulse(slot: Slot, intensity: number, ms: number): void {
    try {
      const g = slot.source?.gamepad as (Gamepad & { hapticActuators?: { pulse?: (i: number, d: number) => unknown }[] }) | undefined;
      void g?.hapticActuators?.[0]?.pulse?.(intensity, ms);
    } catch {
      /* ingen vibrasjon */
    }
  }

  /** Overskrifter og beskjeder i menyen slik den ser ut nå (for tester). */
  menuLabels(): { text: string }[] {
    return buildMenu(this.menuState()).labels;
  }

  /** Knappene i menyen slik den ser ut nå (for tester). */
  menuItemsNow(): { id: string; active: boolean }[] {
    return buildMenu(this.menuState()).items.map((i) => ({ id: i.id, active: i.active }));
  }

  /** Midtpunktet av en menyknapp i verden (for tester). */
  menuItemWorld(id: string): { x: number; y: number; z: number } | null {
    const p = this.menu.itemWorld(id);
    return p ? { x: p.x, y: p.y, z: p.z } : null;
  }

  /**
   * Høyre stikke: til siden = snu (fast vinkel fra innstillingene, eller myk
   * dreiing); bakover = snu 180°. Bare den dominerende aksen teller.
   */
  private turn(pad: Gamepad | null, dt: number): void {
    const rx = pad?.axes[2] ?? 0;
    const ry = pad?.axes[3] ?? 0;
    const mode = this.view.turn.value;
    const sideways = Math.abs(rx) >= Math.abs(ry);
    if (mode === 'smooth' && sideways && Math.abs(rx) > SMOOTH_DEADZONE) {
      const k = (Math.abs(rx) - SMOOTH_DEADZONE) / (1 - SMOOTH_DEADZONE);
      snapTurn(this.rig, this.head, -Math.sign(rx) * k * SMOOTH_TURN_SPEED * dt);
      this.smoothTurning = true;
      return;
    }
    if (this.smoothTurning) {
      this.smoothTurning = false;
      this.turns++;
    }
    if (this.turnArmed && sideways && Math.abs(rx) > TURN_START && mode !== 'smooth') {
      snapTurn(this.rig, this.head, (-Math.sign(rx) * mode * Math.PI) / 180);
      this.turns++;
      this.turnArmed = false;
    } else if (this.turnArmed && !sideways && ry > TURN_START) {
      snapTurn(this.rig, this.head, Math.PI);
      this.turns++;
      this.turnArmed = false;
    } else if (Math.abs(rx) < TURN_REARM && Math.abs(ry) < TURN_REARM) {
      this.turnArmed = true;
    }
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

  buildDebug(): BuildDebugState | null {
    return this.build?.debugState() ?? null;
  }

  /** Neste kurs i fila etter `id` (null = ingen/alle; etter siste kommer null igjen). */
  private nextCircuit(id: string | null): string | null {
    const ids = (this.getModel()?.data.circuits ?? []).map((c) => c.id);
    if (!ids.length) return null;
    const i = id ? ids.indexOf(id) : -1;
    return i + 1 < ids.length ? ids[i + 1]! : null;
  }

  private updateWristHelp(): void {
    const p = this.plan;
    if (p && this.drawTool) {
      const o = p.options.value;
      const what =
        o.tool === 'wire'
          ? `Kabel – ${WIRE_KIND_TEXT[o.wireKind].toLowerCase()}`
          : o.tool === 'pipe'
            ? PIPE_KIND_TEXT[o.pipeKind]
            : o.tool === 'fixture'
              ? (FIXTURE_TEXT[o.fixtureType] ?? 'Punkt')
              : 'Velg og slett';
      const len = p.drawing ? ` · ${(p.liveLength() / 1000).toFixed(1).replace('.', ',')} m` : '';
      const electric = o.tool === 'wire' || (o.tool === 'fixture' && !WATER_FIXTURES.includes(o.fixtureType));
      const circuit = electric ? (this.getModel()?.data.circuits?.find((c) => c.id === o.circuit)?.name ?? 'ingen kurs') : null;
      this.wrist.setLines([
        `Tegner: ${what}${len}`,
        ...(circuit ? [`Kurs: ${circuit}`] : []),
        o.tool === 'select' ? 'Avtrekker: velg · A: slett' : o.tool === 'fixture' ? 'Avtrekker: sett inn' : 'Avtrekker: punkt · A: ferdig',
        'B: angre · X: meny',
      ]);
      return;
    }
    const t = this.view.turn.value;
    this.wrist.setLines([
      'Venstre stikke: teleport',
      t === 'smooth' ? 'Høyre stikke: snu (myk)' : `Høyre stikke: snu ${t}°`,
      'Høyre stikke bak: snu 180°',
      'X: meny · Y: bildefrekvens',
    ]);
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
      menu: { open: this.menu.open, tab: this.menuTab, hovered: this.menu.hovered?.id ?? null },
      draw: {
        tool: this.drawTool,
        points: this.plan?.draft.points.length ?? 0,
        hover: this.plan?.hover ? { x: this.plan.hover.p.x, h: this.plan.hover.h, z: this.plan.hover.p.z } : null,
      },
      fade: { opacity: this.fade.opacity, visible: this.fade.mesh.visible, active: this.fade.active },
      exposure: this.renderer.toneMappingExposure,
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
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ toneMapped: false, color: '#ffffff', transparent: true, opacity: 0.5 }));
  line.name = 'peker';
  return line;
}

function teleportMarker(): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.16, 0.22, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ toneMapped: false, color: '#39d98a', transparent: true, opacity: 0.9, depthWrite: false }),
  );
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(0.05, 20).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ toneMapped: false, color: '#39d98a', transparent: true, opacity: 0.9, depthWrite: false }),
  );
  g.add(ring, dot);
  g.renderOrder = 5;
  return g;
}
