/**
 * Et lite panel på venstre kontroller (tekst tegnet på et lerret). I fase 1
 * viser det hjelpetekst og (skjult som standard) bildefrekvens. Dette er
 * utgangspunktet for håndleddsmenyen i fase 3.
 */
import * as THREE from 'three';

const W = 512;
const H = 256;

export class WristPanel {
  readonly mesh: THREE.Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private lines: string[] = [];
  private fpsLine: string | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false, map: this.texture, transparent: true, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.07), mat);
    this.mesh.name = 'håndleddspanel';
    // Litt over og foran kontrolleren, vippet mot brukeren.
    this.mesh.position.set(0, 0.07, 0.02);
    this.mesh.rotation.set(-Math.PI / 4, 0, 0);
    this.mesh.renderOrder = 20;
  }

  setLines(lines: string[]): void {
    if (lines.length === this.lines.length && lines.every((l, i) => l === this.lines[i])) return;
    this.lines = lines;
    this.draw();
  }

  setFps(text: string | null): void {
    if (text === this.fpsLine) return;
    this.fpsLine = text;
    this.draw();
  }

  private draw(): void {
    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(20, 28, 36, 0.82)';
    c.beginPath();
    c.roundRect(4, 4, W - 8, H - 8, 28);
    c.fill();
    c.fillStyle = '#ffffff';
    c.font = `600 ${this.lines.length > 3 ? 26 : 30}px system-ui, sans-serif`;
    let y = 48;
    if (this.fpsLine) {
      c.fillStyle = '#7dffb0';
      c.font = '700 32px system-ui, sans-serif';
      c.fillText(this.fpsLine, 28, y, W - 48);
      y += 50;
      c.fillStyle = '#ffffff';
      c.font = '500 24px system-ui, sans-serif';
    }
    const step = this.fpsLine ? 34 : 44;
    for (const line of this.lines) {
      c.fillText(line, 28, y, W - 48);
      y += step;
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
  }
}
