/**
 * Et lite panel på venstre kontroller (tekst tegnet på et lerret): hjelp til
 * å komme i gang, og – når kontrollene er lært – bare rommet man står i.
 * Bildefrekvensen (Y) står øverst når den er slått på. Panelet er bare så
 * høyt som teksten, nederst mot kontrolleren.
 */
import * as THREE from 'three';
import { COLOR, FONT, rgba } from '../ui/tokens';

const W = 512;
const H = 256;

interface Row {
  text: string;
  size: number;
  weight: number;
  color: string;
  /** Luft under linja (piksler). */
  gap: number;
}

export class WristPanel {
  readonly mesh: THREE.Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private lines: string[] = [];
  /** Uthevet første linje (f.eks. rommet man står i), eller null. */
  private title: string | null = null;
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

  /** Linjene, med en uthevet tittel over (null = ingen). Tegnes bare når noe er endret. */
  setLines(lines: string[], title: string | null = null): void {
    if (title === this.title && lines.length === this.lines.length && lines.every((l, i) => l === this.lines[i])) return;
    this.lines = lines;
    this.title = title;
    this.draw();
  }

  setFps(text: string | null): void {
    if (text === this.fpsLine) return;
    this.fpsLine = text;
    this.draw();
  }

  private draw(): void {
    const rows: Row[] = [];
    if (this.fpsLine) rows.push({ text: this.fpsLine, size: 32, weight: 700, color: COLOR.success, gap: 18 });
    if (this.title) rows.push({ text: this.title, size: 40, weight: 700, color: COLOR.text, gap: 16 });
    // Under bildefrekvens eller tittel: mindre tekst; ellers stor (hjelpen for å komme i gang).
    const small = rows.length > 0;
    const size = small ? 24 : this.lines.length > 3 ? 26 : 30;
    for (const text of this.lines)
      rows.push({ text, size, weight: small ? 500 : 600, color: small ? COLOR.text2 : COLOR.text, gap: small ? 10 : 14 });
    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    const pad = 14;
    const height = Math.min(H - 8, 2 * pad + 4 + rows.reduce((s, r) => s + r.size + r.gap, 0) - (rows.at(-1)?.gap ?? 0));
    const top = H - 4 - height;
    c.fillStyle = rgba(COLOR.surface, 0.9);
    c.beginPath();
    c.roundRect(4, top, W - 8, height, 28);
    c.fill();
    let y = top + pad;
    for (const r of rows) {
      y += r.size;
      c.fillStyle = r.color;
      c.font = `${r.weight} ${r.size}px ${FONT}`;
      c.fillText(r.text, 28, y, W - 48);
      y += r.gap;
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
  }
}
