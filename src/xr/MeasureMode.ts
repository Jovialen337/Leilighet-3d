/**
 * Oppmålingsmodus på Quest 3 (gjennomsyn / immersive-ar).
 *
 * 1. Justering: berør hjørnet ved inngangsdøra (origo), deretter
 *    inngangsveggen lenger inn. Riggen flyttes så verdensrommet blir
 *    modellens koordinater (meter).
 * 2. Huskelisten: et lysende merke viser hvor neste måling skal gjøres, og
 *    panelet på venstre hånd sier hva man skal gjøre.
 *
 * Knapper:  avtrekker = mål · A = hopp over · B = angre ·
 *           høyre stikke-klikk = bytt berør/pek ·
 *           venstre stikke = bla · venstre stikke-klikk = juster på nytt
 *
 * Berør: målepunktet er den lille kula foran høyre kontroller.
 * Pek: strålen treffer en virkelig flate (WebXR hit-test mot romskanningen).
 */
import * as THREE from 'three';
import { alignFromTouches } from '../measure/align';
import type { MeasureSession } from '../measure/MeasureSession';
import { ALIGN_STEPS, type Method, type TaskInfo } from '../measure/tasks';
import { MM } from '../scene/geom';
import { InfoPanel, type PanelContent, type Tone } from './InfoPanel';
import { MeasureOverlay } from './MeasureOverlay';

export type MeasurePhase = 'align-0' | 'align-1' | 'measure';
type HitTestState = 'none' | 'pending' | 'ready' | 'unavailable';

/** Avstand (m) fra kontrollerens strålestart til måletuppen. */
export const TIP_DISTANCE = 0.06;
const STICK_START = 0.6;
const STICK_REARM = 0.3;
const MAX_RAY = 6;

export interface InputSlot {
  controller: THREE.XRTargetRaySpace;
  grip: THREE.XRGripSpace;
  source: XRInputSource | null;
}

export interface MeasureDebugState {
  phase: MeasurePhase;
  method: Method;
  task: string | null;
  title: string;
  status: { text: string; tone: Tone } | null;
  captures: number;
  tip: { x: number; y: number; z: number };
  rig: { x: number; y: number; z: number; yaw: number };
  hitTest: HitTestState;
  hit: { x: number; y: number; z: number } | null;
  beacon: boolean;
  overlayTriangles: number;
  panel: PanelContent | null;
}

interface Buttons {
  trigger: boolean;
  a: boolean;
  b: boolean;
  rightStick: boolean;
  leftStick: boolean;
}

export class MeasureMode {
  readonly overlay = new MeasureOverlay();
  readonly panel = new InfoPanel();
  phase: MeasurePhase = 'align-0';
  captures = 0;
  private readonly tip: THREE.Mesh;
  private readonly probe: THREE.Line;
  private readonly ray: THREE.Line;
  private readonly reticle: THREE.Mesh;
  private q0: THREE.Vector3 | null = null;
  private override: { key: string; method: Method } | null = null;
  private status: { text: string; tone: Tone } | null = null;
  private prev: Buttons = { trigger: false, a: false, b: false, rightStick: false, leftStick: false };
  private browseArmed = true;
  private hitState: HitTestState = 'none';
  private hitSource: XRHitTestSource | null = null;
  private hit: THREE.Vector3 | null = null;
  private xrSession: XRSession | null = null;
  private unsubscribe: (() => void) | null = null;
  private dirty = true;
  private readonly tmp = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();

  constructor(
    private readonly rig: THREE.Group,
    private readonly camera: THREE.Camera,
    private readonly scene: THREE.Scene,
    private readonly session: MeasureSession,
    private readonly slot: (hand: XRHandedness) => InputSlot | undefined,
  ) {
    const tipMat = new THREE.MeshBasicMaterial({ color: '#ffe14d', depthTest: false });
    this.tip = new THREE.Mesh(new THREE.SphereGeometry(0.007, 16, 10), tipMat);
    this.tip.position.set(0, 0, -TIP_DISTANCE);
    this.tip.renderOrder = 40;
    this.probe = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -TIP_DISTANCE)]),
      new THREE.LineBasicMaterial({ color: '#ffe14d', transparent: true, opacity: 0.8 }),
    );
    this.ray = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: '#18d4ff', transparent: true, opacity: 0.85 }),
    );
    this.ray.frustumCulled = false;
    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.025, 0.035, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#18d4ff', depthTest: false, transparent: true, side: THREE.DoubleSide }),
    );
    this.reticle.renderOrder = 40;
    this.reticle.visible = false;
    this.overlay.root.visible = false;
  }

  /** Kalles når AR-økten starter. */
  start(xrSession: XRSession): void {
    this.xrSession = xrSession;
    this.hitState = 'none';
    this.hitSource = null;
    this.hit = null;
    this.status = null;
    this.override = null;
    this.prev = { trigger: true, a: true, b: true, rightStick: true, leftStick: true };
    this.scene.add(this.overlay.root, this.reticle, this.panel.mesh);
    this.unsubscribe = this.session.subscribe(() => (this.dirty = true));
    this.dirty = true;
    this.realign();
    this.attach();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.hitSource?.cancel();
    this.hitSource = null;
    this.xrSession = null;
    this.scene.remove(this.overlay.root, this.reticle, this.panel.mesh);
    this.tip.removeFromParent();
    this.probe.removeFromParent();
    this.ray.removeFromParent();
    this.resetRig();
  }

  /** Begynner justeringen på nytt (riggen tilbake til referanserommet). */
  realign(): void {
    this.phase = 'align-0';
    this.q0 = null;
    this.overlay.root.visible = false;
    this.resetRig();
  }

  private resetRig(): void {
    this.rig.position.set(0, 0, 0);
    this.rig.rotation.set(0, 0, 0);
    this.rig.updateMatrixWorld(true);
  }

  /** Fester måletupp og stråle til høyre kontroller (når den er koblet til). */
  private attach(): void {
    const right = this.slot('right');
    if (right && this.tip.parent !== right.controller) right.controller.add(this.tip, this.probe, this.ray);
  }

  /** Panelet følger venstre hånd og snur seg alltid mot hodet, så det er lett å lese. */
  private placePanel(): void {
    const left = this.slot('left');
    const mesh = this.panel.mesh;
    mesh.visible = !!left?.source;
    if (!left?.source) return;
    left.grip.localToWorld(mesh.position.set(0, 0.13, 0.02));
    this.camera.getWorldPosition(this.tmp);
    mesh.lookAt(this.tmp);
  }

  update(frame: XRFrame | undefined, refSpace: XRReferenceSpace | null, time: number): void {
    this.attach();
    const right = this.slot('right');
    const left = this.slot('left');
    const rg = right?.source?.gamepad ?? null;
    const lg = left?.source?.gamepad ?? null;

    if (this.dirty) {
      this.dirty = false;
      this.overlay.build(this.session);
    }

    this.requestHitTest(right);
    this.readHit(frame, refSpace);

    const task = this.phase === 'measure' ? this.session.current() : null;
    const method = this.methodFor(task);
    this.updateAimVisuals(method, right);
    this.overlay.setTarget(task, this.session.model);
    this.camera.getWorldPosition(this.tmp);
    this.overlay.update(time, this.tmp);

    const now: Buttons = {
      trigger: (rg?.buttons[0]?.value ?? 0) > 0.6,
      a: rg?.buttons[4]?.pressed ?? false,
      b: rg?.buttons[5]?.pressed ?? false,
      rightStick: rg?.buttons[3]?.pressed ?? false,
      leftStick: lg?.buttons[3]?.pressed ?? false,
    };
    const pressed = (k: keyof Buttons): boolean => now[k] && !this.prev[k];

    if (pressed('trigger')) this.capture(task, method, right);
    if (pressed('a')) this.onSkip();
    if (pressed('b')) this.onUndo();
    if (pressed('rightStick') && task) this.toggleMethod(task, method);
    if (pressed('leftStick')) {
      this.realign();
      this.say('Juster på nytt: start i hjørnet ved inngangsdøra.', 'info');
    }
    this.prev = now;

    // Bla i listen med venstre stikke.
    const lx = lg?.axes[2] ?? 0;
    if (this.phase === 'measure' && this.browseArmed && Math.abs(lx) > STICK_START) {
      this.browseArmed = false;
      this.session.step(Math.sign(lx));
      this.status = null;
    } else if (Math.abs(lx) < STICK_REARM) this.browseArmed = true;

    this.panel.show(this.content(this.phase === 'measure' ? this.session.current() : null));
    this.placePanel();
  }

  /* ---------------- måling ---------------- */

  private methodFor(task: TaskInfo | null): Method {
    if (!task) return 'touch';
    if (this.override?.key === task.key) return this.override.method;
    return task.method;
  }

  private toggleMethod(task: TaskInfo, method: Method): void {
    const next: Method = method === 'touch' ? 'point' : 'touch';
    this.override = { key: task.key, method: next };
    if (next === 'point' && this.hitState === 'unavailable')
      this.say('Pek-modus virker ikke her (ingen romskanning). Berør i stedet.', 'warn');
    else this.status = null;
  }

  /** Punktet (m, verden) som måles nå, eller en forklaring på hvorfor ikke. */
  private capturePoint(method: Method): THREE.Vector3 | string {
    if (method === 'touch') {
      if (!this.tip.parent) return 'Finner ikke høyre kontroller.';
      return this.tip.getWorldPosition(new THREE.Vector3());
    }
    if (this.hitState === 'unavailable')
      return 'Pek-modus virker ikke her (ingen romskanning). Trykk høyre stikke for å berøre i stedet.';
    if (!this.hit) return 'Strålen treffer ingen flate. Sikt på nytt, eller trykk høyre stikke for å berøre.';
    return this.hit.clone();
  }

  private capture(task: TaskInfo | null, method: Method, right: InputSlot | undefined): void {
    const p = this.capturePoint(this.phase === 'measure' ? method : 'touch');
    if (typeof p === 'string') {
      this.fail(p, right);
      return;
    }
    if (this.phase === 'align-0') {
      this.q0 = this.rig.worldToLocal(p.clone());
      this.phase = 'align-1';
      this.captures++;
      this.say('Hjørnet er registrert.', 'ok');
      this.buzz(right, 0.6, 60);
      return;
    }
    if (this.phase === 'align-1') {
      const q1 = this.rig.worldToLocal(p.clone());
      const r = alignFromTouches(this.q0!, q1);
      if (!r.ok) {
        this.fail(r.message, right);
        return;
      }
      this.rig.position.set(r.rig.x, r.rig.y, r.rig.z);
      this.rig.rotation.set(0, r.rig.yaw, 0);
      this.rig.updateMatrixWorld(true);
      this.phase = 'measure';
      this.captures++;
      this.overlay.root.visible = true;
      this.dirty = true;
      this.say('Modellen er lagt på plass. Strekene skal følge veggene omtrent.', 'ok');
      this.buzz(right, 0.8, 90);
      return;
    }
    if (!task) {
      this.fail(this.session.skipped.size ? 'Trykk A for å ta punktene du hoppet over.' : 'Alt er målt.', right);
      return;
    }
    const r = this.session.record({ x: p.x / MM, y: p.y / MM, z: p.z / MM }, task);
    if (!r.ok) {
      this.fail(r.message, right);
      return;
    }
    this.captures++;
    this.override = null;
    if (this.session.error)
      this.say(`Modellen fikk en feil: ${this.session.error} Trykk B for å angre.`, 'error');
    else if (r.warning) this.say(r.warning, 'warn');
    else this.say(`Målt: ${task.title}`, 'ok');
    this.buzz(right, r.warning || this.session.error ? 1 : 0.6, r.warning ? 150 : 60);
  }

  private onSkip(): void {
    if (this.phase !== 'measure') return;
    const task = this.session.current();
    if (task) {
      this.session.skip(task);
      this.say(`Hoppet over: ${task.title}. Den kommer igjen til slutt.`, 'info');
    } else if (this.session.skipped.size) {
      this.session.revisitSkipped();
      this.say('Tar punktene du hoppet over.', 'info');
    }
  }

  private onUndo(): void {
    if (this.phase === 'align-1') {
      this.realign();
      this.say('Tilbake til hjørnet ved døra.', 'info');
      return;
    }
    if (this.phase !== 'measure') return;
    if (this.session.undo()) this.say('Angret. Mål punktet på nytt, eller trykk A for å hoppe over.', 'info');
    else this.say('Ingenting å angre.', 'info');
  }

  private fail(message: string, slot: InputSlot | undefined): void {
    this.say(message, 'error');
    this.buzz(slot, 1, 40);
    setTimeout(() => this.buzz(slot, 1, 40), 120);
  }

  private say(text: string, tone: Tone): void {
    this.status = { text, tone };
  }

  private buzz(slot: InputSlot | undefined, intensity: number, ms: number): void {
    try {
      const g = slot?.source?.gamepad as (Gamepad & { hapticActuators?: { pulse?: (i: number, d: number) => unknown }[] }) | undefined;
      void g?.hapticActuators?.[0]?.pulse?.(intensity, ms);
    } catch {
      /* ingen vibrasjon */
    }
  }

  /* ---------------- pek (hit-test) ---------------- */

  private requestHitTest(right: InputSlot | undefined): void {
    const s = this.xrSession;
    const src = right?.source;
    if (this.hitState !== 'none' || !s || !src) return;
    if (!s.requestHitTestSource) {
      this.hitState = 'unavailable';
      return;
    }
    this.hitState = 'pending';
    s.requestHitTestSource({ space: src.targetRaySpace })
      ?.then((h) => {
        if (this.xrSession !== s) return h.cancel();
        this.hitSource = h;
        this.hitState = 'ready';
      })
      .catch(() => (this.hitState = 'unavailable'));
  }

  private readHit(frame: XRFrame | undefined, refSpace: XRReferenceSpace | null): void {
    this.hit = null;
    if (!frame || !refSpace || !this.hitSource) return;
    const results = frame.getHitTestResults(this.hitSource);
    const pose = results[0]?.getPose(refSpace);
    if (!pose) return;
    const { position: p, orientation: o } = pose.transform;
    this.hit = this.rig.localToWorld(new THREE.Vector3(p.x, p.y, p.z));
    this.tmpQ.set(o.x, o.y, o.z, o.w).premultiply(this.rig.quaternion);
    this.reticle.quaternion.copy(this.tmpQ);
  }

  private updateAimVisuals(method: Method, right: InputSlot | undefined): void {
    const pointing = this.phase === 'measure' && method === 'point';
    this.tip.visible = !pointing;
    this.probe.visible = !pointing;
    this.ray.visible = pointing;
    this.reticle.visible = pointing && this.hit !== null;
    if (!pointing || !right) return;
    let length = 2;
    if (this.hit) {
      right.controller.getWorldPosition(this.tmp);
      length = Math.min(MAX_RAY, this.tmp.distanceTo(this.hit));
      this.reticle.position.copy(this.hit);
    }
    this.ray.scale.set(1, 1, length);
    (this.ray.material as THREE.LineBasicMaterial).color.set(this.hit ? '#18d4ff' : '#ff7a7a');
  }

  /* ---------------- panel ---------------- */

  private content(task: TaskInfo | null): PanelContent {
    const footerMeasure = [
      'Avtrekker: mål  ·  A: hopp over  ·  B: angre',
      'Høyre stikke, trykk: bytt mellom berør og pek',
      'Venstre stikke: bla  ·  trykk: juster på nytt',
    ];
    if (this.phase !== 'measure') {
      const i = this.phase === 'align-0' ? 0 : 1;
      const step = ALIGN_STEPS[i];
      return {
        header: `Oppmåling · justering ${i + 1} av 2`,
        title: step.title,
        body: step.instruction,
        status: this.status,
        badge: 'Berør',
        footer: [
          'Avtrekker: registrer punktet med den gule kula',
          i === 1 ? 'B: tilbake til hjørnet' : 'Y: vis bildefrekvens',
        ],
      };
    }
    const p = this.session.progress();
    const progress = p.total ? p.done / p.total : 1;
    if (!task) {
      const skipped = p.skipped;
      return {
        header: `Totalt ${p.done} av ${p.total} målt`,
        title: skipped ? 'Nesten ferdig' : 'Ferdig!',
        body: skipped
          ? `Du hoppet over ${skipped} ${skipped === 1 ? 'punkt' : 'punkter'}. Trykk A for å ta ${skipped === 1 ? 'det' : 'dem'} nå.`
          : 'Alt er målt. Avslutt og lagre apartment.json fra siden i nettleseren.',
        status: this.status,
        footer: ['A: ta de overhoppede  ·  B: angre', 'Venstre stikke: bla i listen'],
        progress,
      };
    }
    const method = this.methodFor(task);
    const g = p.groups.find((x) => x.group === task.group);
    const body =
      method === task.method
        ? task.instruction
        : method === 'point'
          ? 'Pek med strålen på punktet og trykk avtrekkeren.'
          : 'Berør punktet med den gule kula og trykk avtrekkeren.';
    return {
      header: `${task.group} · ${g?.done ?? 0} av ${g?.total ?? 0}   ·   totalt ${p.done} av ${p.total}`,
      title: task.title,
      body,
      status: this.status,
      badge: method === 'touch' ? 'Berør' : 'Pek',
      footer: footerMeasure,
      progress,
    };
  }

  debugState(): MeasureDebugState {
    const task = this.phase === 'measure' ? this.session.current() : null;
    const tip = this.tip.getWorldPosition(new THREE.Vector3());
    return {
      phase: this.phase,
      method: this.methodFor(task),
      task: task?.key ?? null,
      title: this.panel.content?.title ?? '',
      status: this.status,
      captures: this.captures,
      tip: { x: tip.x, y: tip.y, z: tip.z },
      rig: { x: this.rig.position.x, y: this.rig.position.y, z: this.rig.position.z, yaw: this.rig.rotation.y },
      hitTest: this.hitState,
      hit: this.hit ? { x: this.hit.x, y: this.hit.y, z: this.hit.z } : null,
      beacon: this.overlay.stats().beacon,
      overlayTriangles: this.overlay.stats().triangles,
      panel: this.panel.content,
    };
  }
}
