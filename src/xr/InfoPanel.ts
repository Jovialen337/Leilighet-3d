/**
 * Instruksjonspanel på venstre kontroller i oppmålingsmodus: hva som skal
 * måles nå, framdrift, siste tilbakemelding og knappene. Tekst tegnes på et
 * lerret og tegnes bare på nytt når innholdet endres.
 */
import * as THREE from 'three';
import { COLOR, FONT, rgba } from '../ui/tokens';

const W = 1024;
const H = 640;
const PAD = 40;

export type Tone = 'ok' | 'warn' | 'error' | 'info';

export interface PanelContent {
  header: string;
  title: string;
  body: string;
  status?: { text: string; tone: Tone } | null;
  /** Modus-merke øverst til høyre, f.eks. «Berør». */
  badge?: string;
  footer: string[];
  /** 0–1. */
  progress?: number;
}

const TONE: Record<Tone, string> = {
  ok: COLOR.success,
  warn: COLOR.warning,
  error: COLOR.danger,
  info: COLOR.accent,
};

export class InfoPanel {
  readonly mesh: THREE.Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private last = '';
  content: PanelContent | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false, map: this.texture, transparent: true, depthWrite: false, depthTest: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.15), mat);
    this.mesh.name = 'måleinstruksjoner';
    this.mesh.renderOrder = 30;
  }

  show(content: PanelContent): void {
    const key = JSON.stringify(content);
    if (key === this.last) return;
    this.last = key;
    this.content = content;
    this.draw(content);
  }

  private draw(p: PanelContent): void {
    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    c.fillStyle = rgba(COLOR.surface, 0.94);
    c.beginPath();
    c.roundRect(4, 4, W - 8, H - 8, 36);
    c.fill();
    c.textBaseline = 'alphabetic';

    let y = PAD + 30;
    c.font = `500 30px ${FONT}`;
    c.fillStyle = COLOR.text2;
    c.fillText(this.fit(p.header, W - 2 * PAD - 220), PAD, y);
    if (p.badge) {
      c.font = `700 30px ${FONT}`;
      const bw = c.measureText(p.badge).width + 36;
      c.fillStyle = COLOR.accent;
      c.beginPath();
      c.roundRect(W - PAD - bw, y - 32, bw, 44, 22);
      c.fill();
      c.fillStyle = COLOR.onAccent;
      c.fillText(p.badge, W - PAD - bw + 18, y);
    }

    y += 66;
    c.font = `700 52px ${FONT}`;
    c.fillStyle = COLOR.text;
    for (const line of this.wrap(p.title, W - 2 * PAD).slice(0, 2)) {
      c.fillText(line, PAD, y);
      y += 60;
    }

    y += 8;
    c.font = `400 36px ${FONT}`;
    c.fillStyle = COLOR.text;
    for (const line of this.wrap(p.body, W - 2 * PAD).slice(0, 5)) {
      c.fillText(line, PAD, y);
      y += 44;
    }

    if (p.status) {
      y += 10;
      c.font = `600 34px ${FONT}`;
      c.fillStyle = TONE[p.status.tone];
      for (const line of this.wrap(p.status.text, W - 2 * PAD).slice(0, 3)) {
        c.fillText(line, PAD, y);
        y += 42;
      }
    }

    // Knapper nederst.
    c.font = `500 27px ${FONT}`;
    c.fillStyle = COLOR.text2;
    let fy = H - PAD - 14 - (p.footer.length - 1) * 36;
    for (const line of p.footer) {
      c.fillText(this.fit(line, W - 2 * PAD), PAD, fy);
      fy += 36;
    }
    if (p.progress !== undefined) {
      const bw = W - 2 * PAD;
      c.fillStyle = rgba(COLOR.text, 0.15);
      c.fillRect(PAD, H - 26, bw, 8);
      c.fillStyle = COLOR.success;
      c.fillRect(PAD, H - 26, bw * Math.max(0, Math.min(1, p.progress)), 8);
    }
    this.texture.needsUpdate = true;
  }

  private wrap(text: string, width: number): string[] {
    const c = this.ctx;
    const lines: string[] = [];
    for (const para of text.split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (c.measureText(next).width > width && line) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      lines.push(line);
    }
    return lines;
  }

  private fit(text: string, width: number): string {
    const c = this.ctx;
    if (c.measureText(text).width <= width) return text;
    let t = text;
    while (t.length > 1 && c.measureText(`${t}…`).width > width) t = t.slice(0, -1);
    return `${t}…`;
  }

  dispose(): void {
    this.texture.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
  }
}
