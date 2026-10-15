/**
 * Oppmåling av en ny modell i gjennomsyn (Quest 3, immersive-ar).
 *
 * Rom for rom: berør veggene etter tur rundt rommet (første vegg to steder,
 * så én gang per vegg; grep + avtrekker legger et punkt til forrige vegg for
 * skrå vegger), trykk A for å lukke rommet, berør gulvet og taket. Rommet
 * legges inn i tegningen («Lag ny modell») med en gang. Dører, vinduer og
 * åpninger måles ved å berøre karmen. Har tegningen rom fra før (tegnet på
 * PC eller målt tidligere), justeres den først mot hjørnet ved inngangsdøra.
 *
 * Knapper:  avtrekker = berør · grep + avtrekker = samme vegg ·
 *           A = lukk rommet / hopp over / neste rom · B = angre ·
 *           X = meny (navn, dør/vindu, mål på nytt, avslutt) ·
 *           høyre stikke-klikk = bytt berør/pek
 */
import * as THREE from 'three';
import type { BuilderSession } from '../builder/BuilderSession';
import {
  alignToAxis,
  closeRoom,
  composeRig,
  medianPoint,
  MIN_WALL_SPAN,
  OPENING_STEPS,
  openCorners,
  placeOpening,
  wallLines,
  type Line,
  type P3,
} from '../builder/capture';
import { alongEdge, dist, dot, edgesOf, roomsOverlap, sub, type P2 } from '../builder/geometry';
import { addOpening, addRoom, commonAxis, linkedEdges, nextRoomName, setPolygon } from '../builder/ops';
import { entranceFrame } from '../builder/transform';
import { ROOM_NAMES, floorColorFor, type BOpeningType, type BuilderDoc } from '../builder/types';
import { formatArea, formatLength } from '../builder/units';
import { leftOf, pointInPolygon, polygonArea } from '../geometry/math2d';
import { alignFromTouches } from '../measure/align';
import { MM } from '../scene/geom';
import { BuildOverlay, type CaptureView } from './BuildOverlay';
import { buildBuildMenu } from './buildMenu';
import { InfoPanel, type PanelContent, type Tone } from './InfoPanel';
import { TIP_DISTANCE, type InputSlot } from './MeasureMode';
import type { WristMenu } from './WristMenu';

export type BuildPhase = 'align-0' | 'align-1' | 'walls' | 'floor' | 'ceiling' | 'opening' | 'ready';
type Method = 'touch' | 'point';
type HitTestState = 'none' | 'pending' | 'ready' | 'unavailable';

/** Punktet som måles er medianen av måletuppen de siste millisekundene før avtrekkeren (rykket teller ikke). */
const TIP_WINDOW_MS = 150;
/** En ny vegg nærmere forrige veggs linje enn dette (mm) er nok samme vegg. */
const SAME_WALL = 100;
/** Plass til måletuppen så mange rammer tilbake (120 Hz × 0,5 s), i en fast ringbuffer. */
const HISTORY = 64;
const RAY_HIT = new THREE.Color('#18d4ff');
const RAY_MISS = new THREE.Color('#ff7a7a');
/** Skjæring krever minst denne vinkelen mellom veggene (sin 20°). */
const MIN_SIN = Math.sin((20 * Math.PI) / 180);

const OPENING_NAME: Record<BOpeningType, string> = { door: 'Dør', window: 'Vindu', passage: 'Åpning' };

export interface BuildDebugState {
  phase: BuildPhase;
  method: Method;
  status: { text: string; tone: Tone } | null;
  captures: number;
  /** Antall berøringer per vegg i rommet som måles. */
  walls: number[];
  corners: number;
  closed: boolean;
  opening: { type: BOpeningType; touches: number } | null;
  target: string | null;
  lastRoom: string | null;
  rooms: number;
  openings: number;
  tip: { x: number; y: number; z: number };
  rig: { x: number; y: number; z: number; yaw: number };
  hitTest: HitTestState;
  ghost: { x: number; z: number } | null;
  menu: { open: boolean; hovered: string | null };
  panel: PanelContent | null;
}

interface Buttons {
  trigger: boolean;
  grip: boolean;
  a: boolean;
  b: boolean;
  x: boolean;
  rightStick: boolean;
}

export class BuildMode {
  readonly overlay = new BuildOverlay();
  readonly panel = new InfoPanel();
  phase: BuildPhase = 'walls';
  method: Method = 'touch';
  captures = 0;
  private readonly tip: THREE.Mesh;
  private readonly probe: THREE.Line;
  private readonly ray: THREE.Line;
  private readonly reticle: THREE.Mesh;
  private status: { text: string; tone: Tone } | null = null;
  /** Knappene denne og forrige ramme (to faste objekter som byttes – ingen nye per ramme). */
  private btnNow: Buttons = { trigger: false, grip: false, a: false, b: false, x: false, rightStick: false };
  private btnPrev: Buttons = { trigger: true, grip: true, a: true, b: true, x: true, rightStick: true };
  /** Rommet som måles: veggene (mm i planet) og høyden de ble berørt i. */
  private walls: P2[][] = [];
  private heights: number[] = [];
  /** Lukket rom som venter på gulv og tak. */
  private pending: { polygon: P2[]; floor: number | null } | null = null;
  /** Rommet ble rettet inn da det ble lukket (B går tilbake og lar en beholde det som målt). */
  private aligned = false;
  /** Lukk neste gang uten å rette inn (valgt med B rett etter en innretting). */
  private keepSkew = false;
  private target: { kind: 'new' } | { kind: 'remeasure'; room: string } = { kind: 'new' };
  private opening: { type: BOpeningType; touches: P3[] } | null = null;
  private lastRoom: string | null = null;
  private q0: THREE.Vector3 | null = null;
  /** Måletuppen i referanserommet (m) de siste rammene: [tid, x, y, z] etter hverandre, ringbuffer. */
  private readonly history = new Float64Array(HISTORY * 4);
  private historyLen = 0;
  private historyAt = 0;
  /** Veggenes linjer (regnes ut når veggene endres, ikke hver ramme). */
  private lines: Line[] = [];
  private readonly ghostPt: P3 = { x: 0, y: 0, z: 0 };
  private readonly hitVec = new THREE.Vector3();
  private hitState: HitTestState = 'none';
  private hitSource: XRHitTestSource | null = null;
  private hit: THREE.Vector3 | null = null;
  private xrSession: XRSession | null = null;
  private refSpace: XRReferenceSpace | null = null;
  private unsubscribe: (() => void) | null = null;
  private roomsDirty = true;
  private captureDirty = true;
  private panelDirty = true;
  private menuDirty = true;
  private ghost: P3 | null = null;
  private readonly tmp = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly onReset = (): void => this.trackingReset();

  constructor(
    private readonly rig: THREE.Group,
    private readonly camera: THREE.Camera,
    private readonly scene: THREE.Scene,
    private readonly session: BuilderSession,
    private readonly slot: (hand: XRHandedness) => InputSlot | undefined,
    private readonly menu: WristMenu,
    /** Avslutt (menyen): ender AR-økten. */
    private readonly onExit: () => void,
  ) {
    const tipMat = new THREE.MeshBasicMaterial({ toneMapped: false, color: '#ffe14d', depthTest: false });
    this.tip = new THREE.Mesh(new THREE.SphereGeometry(0.007, 16, 10), tipMat);
    this.tip.position.set(0, 0, -TIP_DISTANCE);
    this.tip.renderOrder = 40;
    this.probe = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -TIP_DISTANCE)]),
      new THREE.LineBasicMaterial({ toneMapped: false, color: '#ffe14d', transparent: true, opacity: 0.8 }),
    );
    this.ray = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ toneMapped: false, color: '#18d4ff', transparent: true, opacity: 0.85 }),
    );
    this.ray.frustumCulled = false;
    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.025, 0.035, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ toneMapped: false, color: '#18d4ff', depthTest: false, transparent: true, side: THREE.DoubleSide }),
    );
    this.reticle.renderOrder = 40;
    this.reticle.visible = false;
  }

  private get doc(): BuilderDoc | null {
    return this.session.doc;
  }

  /** Kalles når AR-økten starter. */
  start(xrSession: XRSession): void {
    this.xrSession = xrSession;
    this.hitState = 'none';
    this.hitSource = null;
    this.hit = null;
    this.status = null;
    // Knapper som holdes inne når økten starter, teller ikke som trykk.
    Object.assign(this.btnPrev, { trigger: true, grip: true, a: true, b: true, x: true, rightStick: true });
    this.scene.add(this.overlay.root, this.reticle, this.panel.mesh);
    this.unsubscribe = this.session.subscribe(() => {
      this.roomsDirty = true;
      this.panelDirty = true;
      this.menuDirty = true;
    });
    this.resetCapture();
    this.resetRig();
    // Har tegningen rom fra før, må den legges oppå det virkelige rommet først.
    this.phase = this.doc?.rooms.length ? 'align-0' : 'walls';
    this.q0 = null;
    this.overlay.root.visible = this.phase === 'walls';
    this.menu.setOpen(false);
    this.dirtyAll();
    this.attach();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.hitSource?.cancel();
    this.hitSource = null;
    this.refSpace?.removeEventListener('reset', this.onReset);
    this.refSpace = null;
    this.xrSession = null;
    this.menu.setOpen(false);
    this.setPointer(false);
    this.scene.remove(this.overlay.root, this.reticle, this.panel.mesh);
    this.tip.removeFromParent();
    this.probe.removeFromParent();
    this.ray.removeFromParent();
    this.resetRig();
  }

  private resetRig(): void {
    this.rig.position.set(0, 0, 0);
    this.rig.rotation.set(0, 0, 0);
    this.rig.updateMatrixWorld(true);
    this.historyLen = 0;
  }

  private resetCapture(): void {
    this.aligned = false;
    this.keepSkew = false;
    this.walls = [];
    this.heights = [];
    this.pending = null;
    this.opening = null;
    this.target = { kind: 'new' };
    this.captureDirty = true;
    this.roomsDirty = true;
  }

  private dirtyAll(): void {
    this.roomsDirty = true;
    this.captureDirty = true;
    this.panelDirty = true;
    this.menuDirty = true;
  }

  private attach(): void {
    const right = this.slot('right');
    if (right && this.tip.parent !== right.controller) right.controller.add(this.tip, this.probe, this.ray);
  }

  /** Strålen fra kontrolleren (vises når menyen er åpen, for å sikte). */
  private setPointer(visible: boolean): void {
    for (const hand of ['left', 'right'] as const) {
      const line = this.slot(hand)?.controller.getObjectByName('peker');
      if (line) line.visible = visible && hand === 'right';
    }
  }

  /* ---------------- hver ramme ---------------- */

  update(frame: XRFrame | undefined, refSpace: XRReferenceSpace | null, time: number): void {
    this.attach();
    if (refSpace && refSpace !== this.refSpace) {
      this.refSpace?.removeEventListener('reset', this.onReset);
      this.refSpace = refSpace;
      refSpace.addEventListener('reset', this.onReset);
    }
    const right = this.slot('right');
    const left = this.slot('left');
    const rg = right?.source?.gamepad ?? null;
    const lg = left?.source?.gamepad ?? null;

    if (this.roomsDirty) {
      this.roomsDirty = false;
      this.overlay.buildRooms(this.doc, this.target.kind === 'remeasure' ? this.target.room : null);
    }
    if (this.captureDirty) {
      this.captureDirty = false;
      this.lines = wallLines(this.walls);
      this.overlay.buildCapture(this.captureView());
    }

    this.requestHitTest(right);
    this.readHit(frame, refSpace);
    this.updateAimVisuals(right);
    this.sampleTip(time);

    const now = this.btnNow;
    const prev = this.btnPrev;
    now.trigger = (rg?.buttons[0]?.value ?? 0) > 0.6;
    now.grip = (rg?.buttons[1]?.value ?? 0) > 0.5;
    now.a = rg?.buttons[4]?.pressed ?? false;
    now.b = rg?.buttons[5]?.pressed ?? false;
    now.x = lg?.buttons[4]?.pressed ?? false;
    now.rightStick = rg?.buttons[3]?.pressed ?? false;
    const trigger = now.trigger && !prev.trigger;

    if (now.x && !prev.x) {
      this.menu.setOpen(!this.menu.open);
      this.setPointer(this.menu.open);
      this.menuDirty = true;
    }
    if (this.menu.open) {
      // Menyen bruker avtrekkeren: ingenting måles mens den er åpen.
      this.updateMenu(left, right, trigger);
    } else {
      if (trigger) this.onTrigger(now.grip, right, time);
      if (now.a && !prev.a) this.onA(right);
      if (now.b && !prev.b) this.onB();
      if (now.rightStick && !prev.rightStick) this.toggleMethod();
    }
    this.btnNow = prev;
    this.btnPrev = now;
    this.updateGhost();

    if (this.panelDirty) {
      this.panelDirty = false;
      this.panel.show(this.content());
    }
    this.placePanel(left);
  }

  /* ---------------- måletupp og pek ---------------- */

  /** Husker måletuppen (referanserommet, m) for medianen ved avtrekkeren. */
  private sampleTip(time: number): void {
    if (!this.tip.parent) return;
    this.tip.getWorldPosition(this.tmp);
    this.rig.worldToLocal(this.tmp);
    const i = this.historyAt * 4;
    this.history[i] = time;
    this.history[i + 1] = this.tmp.x;
    this.history[i + 2] = this.tmp.y;
    this.history[i + 3] = this.tmp.z;
    this.historyAt = (this.historyAt + 1) % HISTORY;
    this.historyLen = Math.min(HISTORY, this.historyLen + 1);
  }

  /** Punktet som måles, i referanserommet (m): medianen av måletuppen rett før avtrekkeren. */
  private tipLocal(time: number): THREE.Vector3 | null {
    if (!this.historyLen) return null;
    const recent: P3[] = [];
    let latest = -1;
    for (let k = 0; k < this.historyLen; k++) {
      const i = ((this.historyAt - 1 - k + HISTORY) % HISTORY) * 4;
      if (latest < 0) latest = i;
      if (this.history[i]! < time - TIP_WINDOW_MS) break;
      recent.push({ x: this.history[i + 1]!, y: this.history[i + 2]!, z: this.history[i + 3]! });
    }
    if (!recent.length) recent.push({ x: this.history[latest + 1]!, y: this.history[latest + 2]!, z: this.history[latest + 3]! });
    const m = medianPoint(recent)!;
    return new THREE.Vector3(m.x, m.y, m.z);
  }

  /** Punktet (mm, byggerens ramme) som måles nå, eller en forklaring. */
  private capturePoint(time: number): P3 | string {
    if (this.method === 'point') {
      if (this.hitState === 'unavailable') return 'Pek-modus virker ikke her (ingen romskanning). Trykk høyre stikke for å berøre i stedet.';
      if (!this.hit) return 'Strålen treffer ingen flate. Sikt på nytt, eller trykk høyre stikke for å berøre.';
      return { x: this.hit.x / MM, y: this.hit.y / MM, z: this.hit.z / MM };
    }
    const local = this.tipLocal(time);
    if (!local) return 'Finner ikke høyre kontroller.';
    const w = this.rig.localToWorld(local);
    return { x: w.x / MM, y: w.y / MM, z: w.z / MM };
  }

  private toggleMethod(): void {
    this.method = this.method === 'touch' ? 'point' : 'touch';
    if (this.method === 'point' && this.hitState === 'unavailable') this.say('Pek-modus virker ikke her (ingen romskanning). Berør i stedet.', 'warn');
    else this.status = null;
    this.panelDirty = true;
    this.menuDirty = true;
  }

  /* ---------------- avtrekker, A og B ---------------- */

  private onTrigger(grip: boolean, right: InputSlot | undefined, time: number): void {
    if (this.phase === 'align-0' || this.phase === 'align-1') {
      if (this.method === 'point') this.method = 'touch';
      const q = this.tipLocal(time);
      if (!q) return this.fail('Finner ikke høyre kontroller.', right);
      this.align(q, right);
      return;
    }
    const p = this.capturePoint(time);
    if (typeof p === 'string') return this.fail(p, right);
    const p2 = { x: p.x, z: p.z };
    switch (this.phase) {
      case 'ready':
        // Første berøring i et nytt rom.
        this.resetCapture();
        this.phase = 'walls';
        this.addWallTouch(p2, p.y, false, right);
        break;
      case 'walls':
        this.addWallTouch(p2, p.y, grip, right);
        break;
      case 'floor': {
        const lowest = Math.min(...this.heights);
        if (p.y > lowest + 50) return this.fail('Gulvet ble høyere enn der du berørte veggene. Berør selve gulvet.', right);
        this.pending!.floor = Math.round(p.y);
        this.phase = 'ceiling';
        this.method = 'touch';
        this.ok(`Gulvet er målt (${formatLength(p.y)}).`, right);
        break;
      }
      case 'ceiling': {
        const floor = this.pending!.floor ?? this.defaultFloor();
        const h = Math.round(p.y - floor);
        if (h < 1500 || h > 6000) return this.fail(`Takhøyden ble ${formatLength(h)}. Berør selve taket (eller pek på det).`, right);
        this.commitRoom(h, right);
        break;
      }
      case 'opening':
        this.addOpeningTouch(p, right);
        break;
    }
    this.captures++;
    this.captureDirty = true;
    this.panelDirty = true;
  }

  private addWallTouch(p: P2, y: number, grip: boolean, right: InputSlot | undefined): void {
    const walls = this.walls;
    if (!walls.length) {
      walls.push([p]);
      this.heights.push(y);
      this.ok('Første punkt. Berør den samme veggen et stykke lenger bort.', right);
      return;
    }
    const first = walls[0]!;
    if (walls.length === 1 && first.length === 1) {
      if (dist(first[0]!, p) < MIN_WALL_SPAN) return this.fail('For nær det første punktet. Berør den samme veggen minst 30 cm lenger bort.', right);
      first.push(p);
      this.ok('Første vegg er målt. Gå videre rundt rommet og berør neste vegg.', right);
      return;
    }
    if (grip) {
      // Samme vegg et sted til (skrå vegg).
      walls[walls.length - 1]!.push(p);
      this.ok(`Punkt lagt til vegg ${walls.length}.`, right);
      return;
    }
    const lines = wallLines(walls);
    const last = lines[lines.length - 1];
    if (last && distToLine(p, last) < SAME_WALL)
      return this.fail('Det ser ut som samme vegg som sist. Berør neste vegg – eller hold grepet inne for å legge punktet til denne.', right);
    walls.push([p]);
    this.heights.push(y);
    this.ok(`Vegg ${walls.length} er berørt.${walls.length >= 4 ? ' Trykk A når alle veggene er berørt.' : ''}`, right);
  }

  private addOpeningTouch(p: P3, right: InputSlot | undefined): void {
    const o = this.opening!;
    o.touches.push(p);
    const steps = OPENING_STEPS[o.type];
    if (o.touches.length < steps.length) {
      this.ok('Registrert.', right);
      return;
    }
    const doc = this.doc;
    if (!doc) return;
    const r = placeOpening(doc, o.type, o.touches, this.roomAtHead()?.id ?? this.lastRoom);
    if (!r.ok) {
      o.touches.pop();
      return this.fail(r.message, right);
    }
    const pl = r.placement;
    let made = '';
    this.session.apply((d) => {
      const x = addOpening(d, o.type, pl.room, pl.edge, pl.offset + pl.width / 2, {
        width: pl.width,
        height: pl.height,
        ...(pl.sill !== undefined ? { sill: pl.sill } : {}),
      });
      if (!x) return false;
      x.measured = true;
      // Første berøring var hengselsiden.
      if (x.type === 'door') x.hinge = hingeSide(d, pl, o.touches[0]!);
      made = x.id;
      return true;
    });
    if (!made) return this.fail('Åpningen kunne ikke legges inn.', right);
    const entrance = this.doc?.openings.find((x) => x.id === made)?.entrance;
    this.opening = null;
    this.phase = 'ready';
    const what = `${OPENING_NAME[o.type]}${entrance ? ' (inngangsdør)' : ''}`;
    if (r.warning) this.say(`${what} lagt inn, ${formatLength(pl.width)} bred. ${r.warning}`, 'warn');
    else this.ok(`${what} lagt inn: ${formatLength(pl.width)} × ${formatLength(pl.height)}.`, right);
  }

  /** A: lukk rommet / hopp over gulv eller tak / avbryt åpningen / nytt rom. */
  private onA(right: InputSlot | undefined): void {
    switch (this.phase) {
      case 'walls': {
        const r = closeRoom(this.walls);
        if (!r.ok) return this.fail(r.message, right);
        // Litt skjevt i forhold til resten av tegningen (sporingen): rett inn om første berøring.
        const t = this.target;
        const axis = this.doc && !this.keepSkew ? commonAxis(this.doc, 4, t.kind === 'remeasure' ? t.room : undefined) : null;
        const al = alignToAxis(r.polygon, axis, this.walls[0]![0]!);
        this.pending = { polygon: al.polygon, floor: null };
        this.aligned = al.deg !== 0;
        this.phase = 'floor';
        const fix = al.deg
          ? ` Rettet inn ${Math.abs(al.deg).toFixed(1).replace('.', ',')}° etter de andre rommene (flyttet høyst ${formatLength(al.moved)}; B + A beholder det som målt).`
          : this.keepSkew
            ? ' Beholdt slik det ble målt.'
            : '';
        this.ok(`Rommet er lukket: ${r.polygon.length} hjørner, ${formatArea(polygonArea(al.polygon))}.${fix} Berør gulvet.`, right);
        break;
      }
      case 'floor':
        this.phase = 'ceiling';
        this.say(`Gulvet er ikke målt – bruker ${formatLength(this.defaultFloor())}.`, 'info');
        break;
      case 'ceiling':
        this.commitRoom(null, right);
        break;
      case 'opening':
        this.opening = null;
        this.phase = 'ready';
        this.say('Avbrutt.', 'info');
        break;
      case 'ready':
        this.resetCapture();
        this.phase = 'walls';
        this.say('Nytt rom: berør første vegg to steder.', 'info');
        break;
      default:
        return;
    }
    this.captureDirty = true;
    this.panelDirty = true;
    this.menuDirty = true;
  }

  /** B: angre siste berøring (eller gå ett steg tilbake). */
  private onB(): void {
    switch (this.phase) {
      case 'align-1':
        this.phase = 'align-0';
        this.q0 = null;
        this.say('Tilbake til hjørnet ved døra.', 'info');
        break;
      case 'walls': {
        const last = this.walls[this.walls.length - 1];
        if (!last) {
          this.say('Ingenting å angre.', 'info');
          break;
        }
        last.pop();
        if (!last.length) {
          this.walls.pop();
          this.heights.pop();
        }
        this.say('Angret siste berøring.', 'info');
        break;
      }
      case 'floor':
        this.pending = null;
        this.phase = 'walls';
        if (this.aligned) {
          // Rett etter en innretting: neste A lukker rommet slik det ble målt.
          this.keepSkew = true;
          this.aligned = false;
          this.say('Tilbake til veggene. A lukker rommet slik det ble målt (uten å rette det inn).', 'info');
        } else if (this.keepSkew) {
          // Ombestemt seg: rett inn likevel.
          this.keepSkew = false;
          this.say('Tilbake til veggene. A lukker rommet og retter det inn etter de andre.', 'info');
        } else this.say('Tilbake til veggene. Trykk A for å lukke rommet igjen.', 'info');
        break;
      case 'ceiling':
        this.pending!.floor = null;
        this.phase = 'floor';
        this.say('Tilbake til gulvet.', 'info');
        break;
      case 'opening':
        if (this.opening?.touches.length) {
          this.opening.touches.pop();
          this.say('Angret siste berøring.', 'info');
        } else {
          this.opening = null;
          this.phase = 'ready';
          this.say('Avbrutt.', 'info');
        }
        break;
      case 'ready':
        if (this.session.undo()) this.say('Angret siste endring i tegningen.', 'info');
        else this.say('Ingenting å angre.', 'info');
        break;
      default:
        return;
    }
    this.captureDirty = true;
    this.panelDirty = true;
  }

  /* ---------------- rom inn i tegningen ---------------- */

  private defaultFloor(): number {
    const d = this.doc;
    if (this.target.kind === 'remeasure') {
      const id = this.target.room;
      return d?.rooms.find((r) => r.id === id)?.floor ?? 0;
    }
    return d?.rooms.find((r) => r.id === this.lastRoom)?.floor ?? d?.rooms[d.rooms.length - 1]?.floor ?? 0;
  }

  private commitRoom(ceiling: number | null, right: InputSlot | undefined): void {
    const pend = this.pending;
    if (!pend) return;
    const target = this.target;
    const floor = pend.floor ?? this.defaultFloor();
    let id = '';
    this.session.apply((d) => {
      const poly = pend.polygon.map((p) => ({ x: p.x, z: p.z, m: true }));
      if (target.kind === 'remeasure') {
        const r = d.rooms.find((x) => x.id === target.room);
        if (!r) return false;
        setPolygon(d, r.id, poly);
        r.floor = floor;
        if (pend.floor !== null) r.floorMeasured = true;
        if (ceiling !== null) {
          r.ceiling = ceiling;
          r.ceilingMeasured = true;
          delete r.ceilingCorners;
        }
        id = r.id;
        return true;
      }
      const r = addRoom(d, poly, undefined, floor);
      if (pend.floor !== null) r.floorMeasured = true;
      if (ceiling !== null) {
        r.ceiling = ceiling;
        r.ceilingMeasured = true;
      }
      id = r.id;
      return true;
    });
    if (!id) return this.fail('Rommet finnes ikke lenger.', right);
    const room = this.doc!.rooms.find((r) => r.id === id)!;
    this.lastRoom = id;
    this.walls = [];
    this.heights = [];
    this.pending = null;
    this.aligned = false;
    this.keepSkew = false;
    this.target = { kind: 'new' };
    this.phase = 'ready';
    this.roomsDirty = true;
    this.menuDirty = true;
    const other = this.doc!.rooms.find((r) => r.id !== id && r.polygon.length >= 3 && roomsOverlap(r.polygon, room.polygon));
    if (other) this.say(`«${room.name}» overlapper «${other.name}». Var det samme rom? Velg «Mål … på nytt» i menyen (X), eller angre (B).`, 'warn');
    else this.ok(`«${room.name}» er lagt til: ${formatArea(polygonArea(room.polygon))}, takhøyde ${formatLength(room.ceiling)}.`, right);
  }

  /** Rommet hodet er i (mm), eller null. */
  private roomAtHead(): { id: string; name: string } | null {
    this.camera.getWorldPosition(this.tmp);
    const p = { x: this.tmp.x / MM, z: this.tmp.z / MM };
    const r = this.doc?.rooms.find((x) => x.polygon.length >= 3 && pointInPolygon(p, x.polygon));
    return r ? { id: r.id, name: r.name } : null;
  }

  /* ---------------- justering ---------------- */

  private align(q: THREE.Vector3, right: InputSlot | undefined): void {
    if (this.phase === 'align-0') {
      this.q0 = q.clone();
      this.phase = 'align-1';
      this.ok('Hjørnet er registrert.', right);
      this.panelDirty = true;
      return;
    }
    const doc = this.doc;
    const f = doc ? entranceFrame(doc) : null;
    if (!f || !this.q0) {
      this.phase = 'walls';
      this.panelDirty = true;
      return;
    }
    const r = alignFromTouches(this.q0, q);
    if (!r.ok) return this.fail(r.message, right);
    const rig = composeRig(r.rig, f);
    this.rig.position.set(rig.x, rig.y, rig.z);
    this.rig.rotation.set(0, rig.yaw, 0);
    this.rig.updateMatrixWorld(true);
    this.historyLen = 0;
    this.phase = 'ready';
    this.overlay.root.visible = true;
    this.captures++;
    this.dirtyAll();
    this.ok('Tegningen er lagt på plass. Strekene skal følge veggene.', right);
  }

  /** Hodesettet mistet sporingen (referanserommet er flyttet): juster på nytt. */
  private trackingReset(): void {
    const had = this.walls.length > 0 || this.opening !== null;
    this.resetCapture();
    this.resetRig();
    if (this.doc?.rooms.length) {
      this.phase = 'align-0';
      this.q0 = null;
      this.overlay.root.visible = false;
      this.say('Sporingen ble nullstilt. Juster på nytt ved inngangsdøra.', 'warn');
    } else {
      this.phase = 'walls';
      if (had) this.say('Sporingen ble nullstilt. Begynn på rommet igjen.', 'warn');
    }
    this.dirtyAll();
  }

  /* ---------------- meny ---------------- */

  private menuState() {
    const lastRoom = this.doc?.rooms.find((r) => r.id === this.lastRoom) ?? null;
    return {
      room: lastRoom ? { id: lastRoom.id, name: lastRoom.name } : null,
      inRoom: this.phase === 'align-0' || this.phase === 'align-1' ? null : this.roomAtHead(),
      names: ROOM_NAMES,
      method: this.method,
      canRealign: !!this.doc?.rooms.length,
      busy: this.walls.length > 0 || this.pending !== null || this.opening !== null,
    };
  }

  private updateMenu(left: InputSlot | undefined, right: InputSlot | undefined, trigger: boolean): void {
    if (left) {
      this.camera.getWorldPosition(this.tmp);
      this.menu.place(left.grip, this.tmp);
    }
    if (this.menuDirty) {
      this.menuDirty = false;
      this.menu.setLayout(buildBuildMenu(this.menuState()));
    }
    if (!right) return;
    const { changed } = this.menu.point(right.controller);
    if (changed) this.buzz(right, 0.25, 15);
    if (trigger && this.menu.hovered) {
      this.menuAction(this.menu.hovered.id);
      this.buzz(right, 0.6, 40);
    }
  }

  /** Utfører en menyknapp (id fra buildMenu). */
  menuAction(id: string): void {
    const [, what = '', arg = ''] = id.split(':');
    const close = (): void => {
      this.menu.setOpen(false);
      this.setPointer(false);
    };
    switch (what) {
      case 'new-room':
        this.resetCapture();
        this.phase = 'walls';
        this.say('Nytt rom: berør første vegg to steder.', 'info');
        close();
        break;
      case 'remeasure': {
        const r = this.roomAtHead();
        if (!r) break;
        this.resetCapture();
        this.target = { kind: 'remeasure', room: r.id };
        this.phase = 'walls';
        this.roomsDirty = true;
        this.say(`Måler «${r.name}» på nytt: berør første vegg to steder. Dører og vinduer blir med.`, 'info');
        close();
        break;
      }
      case 'cancel':
        this.resetCapture();
        this.phase = 'ready';
        this.say('Avbrutt.', 'info');
        close();
        break;
      case 'door':
      case 'window':
      case 'passage':
        if (!this.doc?.rooms.length) {
          this.say('Mål et rom først.', 'warn');
          break;
        }
        this.resetCapture();
        this.opening = { type: what, touches: [] };
        this.phase = 'opening';
        close();
        break;
      case 'name': {
        const id2 = this.lastRoom;
        if (!id2 || !arg) break;
        this.session.apply((d) => {
          const r = d.rooms.find((x) => x.id === id2);
          if (!r) return false;
          if (!r.floorColor || r.floorColor === floorColorFor(r.name)) r.floorColor = floorColorFor(arg);
          r.name = d.rooms.some((x) => x.id !== id2 && x.name === arg) ? nextRoomName(d, arg) : arg;
          return true;
        });
        break;
      }
      case 'method':
        this.toggleMethod();
        break;
      case 'realign':
        this.resetCapture();
        this.resetRig();
        this.phase = 'align-0';
        this.q0 = null;
        this.overlay.root.visible = false;
        close();
        break;
      case 'exit':
        close();
        this.onExit();
        break;
    }
    this.captureDirty = true;
    this.panelDirty = true;
    this.menuDirty = true;
  }

  /* ---------------- forhåndsvisning ---------------- */

  private captureView(): CaptureView {
    const lines = this.lines;
    return {
      walls: this.walls,
      heights: this.heights,
      lines,
      corners: openCorners(lines),
      polygon: this.pending?.polygon ?? null,
      touches: this.opening?.touches ?? [],
    };
  }

  /**
   * Spøkelseshjørnet: der neste hjørne havner hvis neste vegg berøres der
   * måletuppen er nå (langs rommets akser, som i wallLines). Regnes med tall,
   * uten nye objekter hver ramme.
   */
  private updateGhost(): void {
    let g: P3 | null = null;
    const lines = this.lines;
    const last = lines[lines.length - 1];
    const first = lines[0];
    if (this.phase === 'walls' && last && first && !this.menu.open && this.method === 'touch' && this.tip.parent) {
      this.tip.getWorldPosition(this.tmp);
      const px = this.tmp.x / MM;
      const pz = this.tmp.z / MM;
      // Neste vegg: den av rommets akser som står mest på tvers av forrige vegg.
      const along = Math.abs(first.u.x * last.u.x + first.u.z * last.u.z) < Math.abs(-first.u.z * last.u.x + first.u.x * last.u.z);
      const nx = along ? first.u.x : -first.u.z;
      const nz = along ? first.u.z : first.u.x;
      const den = last.u.x * nz - last.u.z * nx;
      if (Math.abs(den) >= MIN_SIN) {
        const t = ((px - last.p.x) * nz - (pz - last.p.z) * nx) / den;
        const cx = last.p.x + last.u.x * t;
        const cz = last.p.z + last.u.z * t;
        if (Math.hypot(cx - px, cz - pz) > SAME_WALL) {
          g = this.ghostPt;
          g.x = cx;
          g.y = this.tmp.y / MM;
          g.z = cz;
        }
      }
    }
    const was = this.ghost;
    this.ghost = g;
    if (!g && !was) return;
    this.overlay.setGhost(g);
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
    // Bare i pek-modus: ellers trengs ikke treffet, og det spares hver ramme.
    if (this.method !== 'point' || !frame || !refSpace || !this.hitSource) return;
    const pose = frame.getHitTestResults(this.hitSource)[0]?.getPose(refSpace);
    if (!pose) return;
    const { position: p, orientation: o } = pose.transform;
    this.hit = this.rig.localToWorld(this.hitVec.set(p.x, p.y, p.z));
    this.tmpQ.set(o.x, o.y, o.z, o.w).premultiply(this.rig.quaternion);
    this.reticle.quaternion.copy(this.tmpQ);
  }

  private updateAimVisuals(right: InputSlot | undefined): void {
    const pointing = this.method === 'point' && this.phase !== 'align-0' && this.phase !== 'align-1';
    this.tip.visible = !pointing;
    this.probe.visible = !pointing;
    this.ray.visible = pointing && !this.menu.open;
    this.reticle.visible = pointing && this.hit !== null;
    if (!pointing || !right) return;
    let length = 2;
    if (this.hit) {
      right.controller.getWorldPosition(this.tmp);
      length = Math.min(6, this.tmp.distanceTo(this.hit));
      this.reticle.position.copy(this.hit);
    }
    this.ray.scale.set(1, 1, length);
    (this.ray.material as THREE.LineBasicMaterial).color.copy(this.hit ? RAY_HIT : RAY_MISS);
  }

  /* ---------------- tilbakemelding ---------------- */

  private ok(text: string, slot: InputSlot | undefined): void {
    this.say(text, 'ok');
    this.buzz(slot, 0.6, 50);
  }

  private fail(message: string, slot: InputSlot | undefined): void {
    this.say(message, 'error');
    this.buzz(slot, 1, 40);
    setTimeout(() => this.buzz(slot, 1, 40), 120);
  }

  private say(text: string, tone: Tone): void {
    this.status = { text, tone };
    this.panelDirty = true;
  }

  private buzz(slot: InputSlot | undefined, intensity: number, ms: number): void {
    try {
      const g = slot?.source?.gamepad as (Gamepad & { hapticActuators?: { pulse?: (i: number, d: number) => unknown }[] }) | undefined;
      void g?.hapticActuators?.[0]?.pulse?.(intensity, ms);
    } catch {
      /* ingen vibrasjon */
    }
  }

  /** Panelet følger venstre hånd og snur seg mot hodet. */
  private placePanel(left: InputSlot | undefined): void {
    const mesh = this.panel.mesh;
    mesh.visible = !!left?.source && !this.menu.open;
    if (!mesh.visible || !left) return;
    left.grip.localToWorld(mesh.position.set(0, 0.13, 0.02));
    this.camera.getWorldPosition(this.tmp);
    mesh.lookAt(this.tmp);
  }

  private content(): PanelContent {
    const doc = this.doc;
    const rooms = doc?.rooms.length ?? 0;
    const badge = this.method === 'touch' ? 'Berør' : 'Pek';
    const header = `Ny modell · ${rooms} rom · ${doc?.openings.length ?? 0} dører/vinduer`;
    const status = this.status;
    const roomLabel =
      this.target.kind === 'remeasure'
        ? `«${doc?.rooms.find((r) => r.id === (this.target as { room: string }).room)?.name ?? ''}» på nytt`
        : `Rom ${rooms + 1}`;
    switch (this.phase) {
      case 'align-0':
      case 'align-1': {
        const door = doc?.openings.some((o) => o.type === 'door' && o.entrance);
        const first = doc?.rooms[0]?.name ?? 'første rom';
        const step0 = door
          ? 'Hold måletuppen i det innvendige hjørnet nærmest inngangsdøra, helt nede ved gulvet, og trykk avtrekkeren.'
          : `Hold måletuppen i hjørnet der du begynte å måle «${first}», nede ved gulvet, og trykk avtrekkeren.`;
        const step1 = door
          ? 'Berør veggen med inngangsdøra minst én meter fra hjørnet, forbi døra, og trykk avtrekkeren.'
          : `Berør den første veggen du målte i «${first}», minst én meter fra hjørnet, og trykk avtrekkeren.`;
        return {
          header: `Ny modell · justering ${this.phase === 'align-0' ? 1 : 2} av 2`,
          title: this.phase === 'align-0' ? 'Legg tegningen på plass' : 'Retning',
          body: this.phase === 'align-0' ? step0 : step1,
          status,
          badge: 'Berør',
          footer: ['Avtrekker: registrer punktet med den gule kula', this.phase === 'align-1' ? 'B: tilbake · X: meny' : 'X: meny (avslutt)'],
        };
      }
      case 'walls': {
        const n = this.walls.length;
        const firstDone = n > 1 || (this.walls[0]?.length ?? 0) >= 2;
        const title = !n ? `${roomLabel}: første vegg` : !firstDone ? 'Første vegg: ett punkt til' : `${roomLabel}: vegg ${n + 1}`;
        const body = !n
          ? rooms
            ? 'Stå i rommet. Berør en vegg med den gule kula, nær et hjørne, og trykk avtrekkeren.'
            : 'Begynn ved inngangsdøra: berør veggen med døra, nær hjørnet ved døra, og trykk avtrekkeren.'
          : !firstDone
            ? 'Berør den samme veggen minst 30 cm lenger bort (gjerne 1–2 m) og trykk avtrekkeren. Det gir retningen.'
            : 'Gå videre rundt rommet: berør neste vegg ett sted, midt på. Skrå vegg: hold grepet inne og berør den et sted til. Trykk A når alle veggene er berørt.';
        return {
          header: `${header}  ·  ${Math.max(0, n - 1)} hjørner`,
          title,
          body,
          status,
          badge,
          footer: ['Avtrekker: berør vegg · grep + avtrekker: samme vegg', 'A: lukk rommet · B: angre · X: meny'],
        };
      }
      case 'floor':
        return {
          header,
          title: `${roomLabel}: gulvet`,
          body: 'Berør gulvet med den gule kula (hvor som helst i rommet) og trykk avtrekkeren.',
          status,
          badge,
          footer: [`A: hopp over (bruker ${formatLength(this.defaultFloor())})`, 'B: tilbake til veggene · X: meny'],
        };
      case 'ceiling':
        return {
          header,
          title: `${roomLabel}: taket`,
          body: 'Berør taket og trykk avtrekkeren. Når du ikke når opp: trykk høyre stikke og pek på taket.',
          status,
          badge,
          footer: [`A: hopp over (bruker ${formatLength(doc?.settings.defaultCeiling ?? 2400)})`, 'B: tilbake · høyre stikke: berør/pek'],
        };
      case 'opening': {
        const o = this.opening!;
        const steps = OPENING_STEPS[o.type];
        const k = o.touches.length;
        return {
          header,
          title: `${OPENING_NAME[o.type]}: ${k + 1} av ${steps.length}`,
          body: `Berør ${steps[k] ?? ''} og trykk avtrekkeren.${k < 2 ? ' Sidene måles innvendig, der karmen møter veggen.' : ''}`,
          status,
          badge,
          footer: ['Avtrekker: registrer · B: angre', 'A: avbryt · X: meny'],
        };
      }
      case 'ready': {
        const last = doc?.rooms.find((r) => r.id === this.lastRoom);
        return {
          header,
          title: last ? `«${last.name}» er lagt til` : 'Klar',
          body: 'Trykk X for navn, dør og vindu, eller for å måle et rom på nytt. Neste rom: berør første vegg der (eller trykk A).',
          status,
          badge,
          footer: ['Avtrekker: start neste rom · A: nytt rom', 'B: angre siste endring · X: meny'],
        };
      }
    }
  }

  debugState(): BuildDebugState {
    const tip = this.tip.getWorldPosition(new THREE.Vector3());
    const lines = wallLines(this.walls);
    return {
      phase: this.phase,
      method: this.method,
      status: this.status,
      captures: this.captures,
      walls: this.walls.map((w) => w.length),
      corners: openCorners(lines).filter(Boolean).length,
      closed: this.pending !== null,
      opening: this.opening ? { type: this.opening.type, touches: this.opening.touches.length } : null,
      target: this.target.kind === 'remeasure' ? this.target.room : null,
      lastRoom: this.lastRoom,
      rooms: this.doc?.rooms.length ?? 0,
      openings: this.doc?.openings.length ?? 0,
      tip: { x: tip.x, y: tip.y, z: tip.z },
      rig: { x: this.rig.position.x, y: this.rig.position.y, z: this.rig.position.z, yaw: this.rig.rotation.y },
      hitTest: this.hitState,
      ghost: this.ghost ? { x: this.ghost.x, z: this.ghost.z } : null,
      menu: { open: this.menu.open, hovered: this.menu.hovered?.id ?? null },
      panel: this.panel.content,
    };
  }
}

/** Avstand (mm) fra et punkt til en linje. */
function distToLine(p: P2, l: Line): number {
  const d = sub(p, l.p);
  return Math.abs(dot(d, { x: -l.u.z, z: l.u.x }));
}

/**
 * Hengslene sett av den som går inn: inn i rommet døra sitter i (yttervegg)
 * eller inn i naborommet (skillevegg). `h` er punktet på hengselsiden (mm).
 */
function hingeSide(doc: BuilderDoc, pl: { room: string; edge: number; offset: number; width: number }, h: P3): 'left' | 'right' {
  const room = doc.rooms.find((r) => r.id === pl.room);
  const e = room ? edgesOf(room.polygon)[pl.edge] : undefined;
  if (!e) return 'left';
  const interior = linkedEdges(doc, pl.room, pl.edge).length > 0;
  const intoNormal = interior ? e.out : { x: -e.out.x, z: -e.out.z };
  const center = alongEdge(e, pl.offset + pl.width / 2);
  return dot(sub({ x: h.x, z: h.z }, center), leftOf(intoNormal)) >= 0 ? 'left' : 'right';
}
