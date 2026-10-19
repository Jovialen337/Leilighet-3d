/**
 * Overgang fra svart i VR: når man går inn i VR (og ved «Gå til rom» og
 * «Til start») fades bildet inn fra svart, så hoppet til startpunktet ikke
 * synes og første inntrykk blir rolig. Ved hopp blir det svart med en gang,
 * man flyttes, og bildet fades inn på det nye stedet. En liten svart kule rundt hodet,
 * tegnet over alt annet; den er skjult når overgangen er ferdig (ingen
 * tegnekall da). Ingen allokeringer per bilde.
 */
import * as THREE from 'three';

export const FADE = {
  /** Inngang i VR: holdt svart litt (s), så fade inn (s). */
  enterHold: 0.15,
  enterIn: 0.9,
  /** Hopp («Gå til rom», «Til start»): svart med en gang, holdt litt, så inn (s). */
  jumpHold: 0.05,
  jumpIn: 0.3,
  /** Eksponeringen starter så mye lavere og løftes mens øynene «venner seg til» lyset. */
  exposureDip: 0.25,
  exposureTime: 1.6,
} as const;

const smooth = (t: number): number => t * t * (3 - 2 * t);

export class Fade {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  /** Tid siden overgangen startet (s); negativ når ingen overgang pågår. */
  private t = -1;
  private hold = 0;
  private in = 0;
  private exposureT = -1;

  constructor(camera: THREE.Camera) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 16, 8),
      new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }),
    );
    this.mesh.name = 'overgang';
    this.mesh.renderOrder = 1000;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    camera.add(this.mesh);
  }

  /** Går inn i VR: svart, så fade inn; eksponeringen løftes litt etter. */
  enter(): void {
    this.start(FADE.enterHold, FADE.enterIn);
    this.exposureT = 0;
  }

  /** Hopp: svart med en gang, `move` flytter straks (mens det er svart), så fade inn. */
  jump(move: () => void): void {
    move();
    this.start(FADE.jumpHold, FADE.jumpIn);
  }

  private start(hold: number, inn: number): void {
    this.t = 0;
    this.hold = hold;
    this.in = inn;
    this.apply(1);
  }

  private opacityAt(t: number): number {
    const u = t - this.hold;
    if (u <= 0) return 1;
    return u >= this.in ? 0 : 1 - smooth(u / this.in);
  }

  private apply(opacity: number): void {
    this.mesh.material.opacity = opacity;
    this.mesh.visible = opacity > 0.001;
  }

  /** Avbryter (f.eks. når VR-økten slutter). */
  stop(): void {
    this.t = -1;
    this.exposureT = -1;
    this.apply(0);
  }

  get active(): boolean {
    return this.t >= 0 || this.exposureT >= 0;
  }

  get opacity(): number {
    return this.mesh.visible ? this.mesh.material.opacity : 0;
  }

  /**
   * Et steg; returnerer faktoren eksponeringen skal ganges med (1 når
   * overgangen er ferdig).
   */
  update(dt: number): number {
    if (this.t >= 0) {
      this.t += dt;
      if (this.t >= this.hold + this.in) {
        this.t = -1;
        this.apply(0);
      } else this.apply(this.opacityAt(this.t));
    }
    if (this.exposureT < 0) return 1;
    this.exposureT += dt;
    if (this.exposureT >= FADE.exposureTime) {
      this.exposureT = -1;
      return 1;
    }
    return 1 - FADE.exposureDip * (1 - smooth(this.exposureT / FADE.exposureTime));
  }
}
