/**
 * VR-meny (X på venstre kontroller): et panel over venstre hånd som alltid
 * snur seg mot hodet. Pek på en knapp med høyre kontroller og trykk
 * avtrekkeren. Lerretet tegnes bare på nytt når noe endres; markøren er en
 * liten kule, så pekingen koster ingen opplasting av tekstur.
 */
import * as THREE from 'three';
import { COLOR, FONT, luminance, rgba } from '../ui/tokens';
import type { SwatchShape } from '../ui/legend';
import { MENU_H, MENU_W, buildMenu, itemAt, type MenuItem, type MenuLabel, type MenuState } from './menuLayout';

const WIDTH_M = 0.3;
const HEIGHT_M = (WIDTH_M * MENU_H) / MENU_W;

export class WristMenu {
  readonly mesh: THREE.Mesh;
  readonly cursor: THREE.Mesh;
  open = false;
  hovered: MenuItem | null = null;
  items: MenuItem[] = [];
  private labels: MenuLabel[] = [];
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private lastKey = '';
  /** Tekster som ble forkortet med «…» sist menyen ble tegnet (for tester). */
  truncated: string[] = [];
  private readonly inv = new THREE.Matrix4();
  private readonly o = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = MENU_W;
    this.canvas.height = MENU_H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(WIDTH_M, HEIGHT_M),
      new THREE.MeshBasicMaterial({ toneMapped: false, map: this.texture, transparent: true, depthTest: false, depthWrite: false }),
    );
    this.mesh.name = 'vr-meny';
    this.mesh.renderOrder = 50;
    this.mesh.visible = false;
    this.cursor = new THREE.Mesh(
      new THREE.SphereGeometry(0.004, 10, 8),
      new THREE.MeshBasicMaterial({ toneMapped: false, color: '#18d4ff', depthTest: false }),
    );
    this.cursor.renderOrder = 51;
    this.cursor.visible = false;
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.mesh.visible = open;
    if (!open) {
      this.cursor.visible = false;
      this.hovered = null;
    }
  }

  /** Oppdaterer innholdet (tegner bare hvis noe er endret). */
  setState(s: MenuState): void {
    this.setLayout(buildMenu(s));
  }

  /** Et annet innhold (f.eks. menyen for oppmåling av ny modell). */
  setLayout({ items, labels }: { items: MenuItem[]; labels: MenuLabel[] }): void {
    this.items = items;
    this.labels = labels;
    this.hovered = this.hovered ? (items.find((i) => i.id === this.hovered!.id) ?? null) : null;
    this.redraw();
  }

  /** Plasserer menyen over venstre hånd, vendt mot hodet (`lift` m høyere, f.eks. over opplæringen på håndleddet). */
  place(grip: THREE.Object3D, head: THREE.Vector3, lift = 0): void {
    grip.localToWorld(this.mesh.position.set(0, 0.17 + lift, 0.02));
    this.mesh.lookAt(head);
    this.mesh.updateMatrixWorld();
  }

  /**
   * Peker strålen fra `ray` (kontrollerens strålerom) på menyen?
   * Returnerer knappen under markøren og om den er ny (for et lite vibreringsdunk).
   */
  point(ray: THREE.Object3D): { item: MenuItem | null; changed: boolean } {
    const before = this.hovered?.id ?? null;
    this.hovered = null;
    this.cursor.visible = false;
    if (this.open) {
      ray.getWorldPosition(this.o);
      this.d.set(0, 0, -1).transformDirection(ray.matrixWorld);
      // Over i menyens eget koordinatsystem: planet er z = 0.
      this.inv.copy(this.mesh.matrixWorld).invert();
      const lo = this.tmp.copy(this.o).applyMatrix4(this.inv);
      const ox = lo.x;
      const oy = lo.y;
      const oz = lo.z;
      const ld = this.d.transformDirection(this.inv);
      if (Math.abs(ld.z) > 1e-6) {
        const t = -oz / ld.z;
        if (t > 0 && t < 3) {
          const x = ox + ld.x * t;
          const y = oy + ld.y * t;
          if (Math.abs(x) <= WIDTH_M / 2 && Math.abs(y) <= HEIGHT_M / 2) {
            const px = (x / WIDTH_M + 0.5) * MENU_W;
            const py = (0.5 - y / HEIGHT_M) * MENU_H;
            this.hovered = itemAt(this.items, px, py);
            this.cursor.position.set(x, y, 0.002).applyMatrix4(this.mesh.matrixWorld);
            this.cursor.visible = true;
          }
        }
      }
    }
    const after = this.hovered?.id ?? null;
    if (after !== before) this.redraw();
    return { item: this.hovered, changed: after !== before && after !== null };
  }

  /** Tegner knappenes midtpunkt i verden (for tester). */
  itemWorld(id: string): THREE.Vector3 | null {
    const it = this.items.find((i) => i.id === id);
    if (!it) return null;
    const x = ((it.x + it.w / 2) / MENU_W - 0.5) * WIDTH_M;
    const y = (0.5 - (it.y + it.h / 2) / MENU_H) * HEIGHT_M;
    return new THREE.Vector3(x, y, 0).applyMatrix4(this.mesh.matrixWorld);
  }

  private redraw(): void {
    const key = JSON.stringify([this.items, this.labels, this.hovered?.id ?? null]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.truncated = [];
    const c = this.ctx;
    c.clearRect(0, 0, MENU_W, MENU_H);
    c.fillStyle = rgba(COLOR.surface, 0.94);
    c.beginPath();
    c.roundRect(4, 4, MENU_W - 8, MENU_H - 8, 40);
    c.fill();
    c.textBaseline = 'middle';
    for (const l of this.labels) {
      const size = l.size ?? 32;
      const weight = l.weight ?? 600;
      c.font = `${weight} ${size}px ${FONT}`;
      c.fillStyle = l.color === 'text' ? COLOR.text : l.color === 'accent' ? COLOR.accent : COLOR.text2;
      c.textAlign = 'left';
      if (l.swatch) this.swatch(l.swatch.color, l.swatch.shape, l.x - 52, l.y);
      c.fillText(l.maxW ? this.fit(l.text, l.maxW, size, weight, 20) : l.text, l.x, l.y);
    }
    for (const it of this.items) {
      const hover = this.hovered?.id === it.id;
      const on = it.active;
      // Valgt fane eller valg: aksentfarge med mørk tekst (samme regel som på laptopen).
      const chosen = on && (it.kind === 'tab' || it.kind === 'choice');
      c.fillStyle = chosen ? COLOR.accent : it.kind === 'tab' ? COLOR.surface2 : COLOR.surface3;
      if (hover) c.fillStyle = chosen ? COLOR.accentHover : rgba(COLOR.text, 0.22);
      c.beginPath();
      c.roundRect(it.x, it.y, it.w, it.h, 18);
      c.fill();
      if (hover) {
        c.strokeStyle = COLOR.target;
        c.lineWidth = 4;
        c.stroke();
      } else if (it.hint) {
        // Opplæringen peker hit.
        c.strokeStyle = COLOR.warning;
        c.lineWidth = 6;
        c.stroke();
      }
      const cy = it.y + it.h / 2;
      c.fillStyle = chosen ? COLOR.onAccent : COLOR.text;
      // Lange lister får lavere knapper (se menuLayout): tekst og bryter krymper med.
      const size = it.h >= 70 ? 36 : it.h >= 56 ? 32 : Math.max(18, Math.round(it.h * 0.55));
      c.font = it.kind === 'tab' ? `700 32px ${FONT}` : `500 ${size}px ${FONT}`;
      if (it.kind === 'toggle') {
        // Bryter til høyre.
        const sh = Math.min(40, it.h - 12);
        const sw = Math.round(sh * 1.9);
        const sx = it.x + it.w - sw - 18;
        // På: aksentfarget spor med mørk knott; av: mørkt spor med grå knott (grønt betyr bare «målt / OK»).
        c.fillStyle = on ? COLOR.accent : COLOR.surface;
        c.beginPath();
        c.roundRect(sx, cy - sh / 2, sw, sh, sh / 2);
        c.fill();
        c.fillStyle = on ? COLOR.onAccent : COLOR.text2;
        c.beginPath();
        c.arc(on ? sx + sw - sh / 2 : sx + sh / 2, cy, sh * 0.375, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = COLOR.text;
        c.textAlign = 'left';
        c.fillText(this.fit(it.label, it.w - sw - 56, size), it.x + 22, cy + 1);
      } else {
        c.textAlign = 'center';
        // Fanene krymper til 24 px før de forkortes (seks faner på lerretet).
        c.fillText(it.kind === 'tab' ? this.fit(it.label, it.w - 20, 32, 700, 24) : this.fit(it.label, it.w - 24, size), it.x + it.w / 2, cy + 1);
      }
    }
    this.texture.needsUpdate = true;
  }

  /** En fargeprøve (fargeforklaringen), 40 × 22 px med midten på høyde `y`. */
  private swatch(color: string, shape: SwatchShape, x: number, y: number): void {
    const c = this.ctx;
    c.save();
    c.fillStyle = color;
    c.strokeStyle = color;
    c.beginPath();
    switch (shape) {
      case 'fill':
        c.roundRect(x, y - 11, 40, 22, 5);
        c.fill();
        break;
      case 'line':
        c.roundRect(x, y - 4, 40, 8, 4);
        c.fill();
        break;
      case 'dash':
        for (let i = 0; i < 3; i++) c.rect(x + i * 15, y - 4, 10, 8);
        c.fill();
        break;
      case 'outline':
        c.lineWidth = 4;
        c.roundRect(x + 2, y - 9, 36, 18, 4);
        c.stroke();
        break;
      case 'dot':
        c.arc(x + 20, y, 11, 0, Math.PI * 2);
        c.fill();
        break;
    }
    // Lys kant rundt mørke prøver (f.eks. kabel uten kurs), så de synes på den mørke flaten.
    if ((shape === 'fill' || shape === 'line') && luminance(color) < 0.08) {
      c.strokeStyle = rgba(COLOR.text, 0.45);
      c.lineWidth = 2;
      c.stroke();
    }
    c.restore();
  }

  /** Teksten innenfor bredden: først mindre skrift (ned til `min` px), så forkortet med «…». */
  private fit(text: string, width: number, size = 0, weight = 500, min = 28): string {
    const c = this.ctx;
    if (c.measureText(text).width <= width) return text;
    for (let s = size - 2; s >= min; s -= 2) {
      c.font = `${weight} ${s}px ${FONT}`;
      if (c.measureText(text).width <= width) return text;
    }
    let t = text;
    while (t.length > 1 && c.measureText(`${t}…`).width > width) t = t.slice(0, -1);
    this.truncated.push(text);
    return `${t}…`;
  }
}
