/**
 * Bakgrunnsbilde i «Lag ny modell»: en skisse eller plantegning (f.eks. fra
 * salgsoppgaven) under planen, så rommene kan tegnes oppå den. Bildet får
 * riktig målestokk ved å klikke to punkter og skrive avstanden mellom dem.
 *
 * Bildet krympes til høyst 1600 px og lagres som JPEG i nettleseren (ikke i
 * apartment.json). Er det for stort, eller får det ikke plass, virker det
 * likevel til siden lastes på nytt (et eldre bilde blir da ikke hentet frem).
 */
import type { KV } from '../state/persist';
import { Observable } from '../state/Observable';
import type { DesktopView } from '../views/DesktopView';

export const BACKDROP_KEY = 'leilighet:ny-modell:bilde:v1';
const MAX_PX = 1600;
/** Større bilder huskes ikke (de deler lagringsplassen med målinger og tegninger). */
const MAX_STORED = 1_500_000;

export interface BackdropState {
  /** Bildet (data-URL). */
  src: string;
  /** Bildets størrelse i piksler. */
  w: number;
  h: number;
  /** Øvre venstre hjørne i planen (mm). */
  x: number;
  z: number;
  /** Millimeter per bildepiksel. */
  mmPerPx: number;
  /** 0,1–1. */
  opacity: number;
  visible: boolean;
}

const isState = (v: unknown): v is BackdropState => {
  const s = v as Partial<BackdropState> | null;
  return (
    !!s &&
    typeof s.src === 'string' &&
    s.src.startsWith('data:image/') &&
    [s.w, s.h, s.x, s.z, s.mmPerPx, s.opacity].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    (s.mmPerPx ?? 0) > 0
  );
};

export class BuilderBackdrop {
  readonly img: HTMLImageElement;
  state: BackdropState | null = null;
  /** Endres når bildet eller plasseringen endres (for panelet). */
  readonly version = new Observable(0);
  /** Bildet ble ikke lagret (for stort for nettleseren). */
  unsaved = false;
  private shown = false;

  constructor(
    canvas: HTMLElement,
    private readonly desktop: DesktopView,
    private readonly storage: KV | null,
  ) {
    this.img = document.createElement('img');
    this.img.className = 'builder-backdrop';
    this.img.alt = '';
    this.img.draggable = false;
    this.img.dataset.testid = 'builder-backdrop-image';
    this.img.style.display = 'none';
    // Rett over lerretet, under håndtakene (overlegget legges inn før dette).
    canvas.after(this.img);
    try {
      const text = storage?.getItem(BACKDROP_KEY);
      const saved: unknown = text ? JSON.parse(text) : null;
      if (isState(saved)) this.state = { ...saved, opacity: Math.min(1, Math.max(0.1, saved.opacity)), visible: saved.visible !== false };
    } catch {
      this.state = null;
    }
    if (this.state) this.img.src = this.state.src;
    desktop.onChange(() => this.place());
  }

  /** Vis bildet (når man tegner i 2D) eller skjul det. */
  setShown(on: boolean): void {
    this.shown = on;
    this.place();
  }

  /**
   * Leser et bilde fra fil, krymper det og legger det midt i det som synes
   * av planen, 10 m bredt (riktig målestokk settes etterpå). Feilmelding
   * eller null.
   */
  async load(file: File, center: { x: number; z: number }): Promise<string | null> {
    if (!file.type.startsWith('image/')) return 'Fila er ikke et bilde.';
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      return 'Bildet kunne ikke leses.';
    }
    const k = Math.min(1, MAX_PX / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * k));
    const h = Math.max(1, Math.round(bitmap.height * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return 'Bildet kunne ikke leses.';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const src = c.toDataURL('image/jpeg', 0.8);
    const mmPerPx = 10_000 / w;
    this.state = { src, w, h, x: Math.round(center.x - (w * mmPerPx) / 2), z: Math.round(center.z - (h * mmPerPx) / 2), mmPerPx, opacity: 0.5, visible: true };
    this.img.src = src;
    this.changed();
    return null;
  }

  /** Flytter bildet (mm). */
  move(dx: number, dz: number, save = true): void {
    if (!this.state) return;
    this.state.x += dx;
    this.state.z += dz;
    if (save) this.changed();
    else this.place();
  }

  /** Skalerer bildet med `factor`, slik at punktet `anchor` (mm) står stille. */
  scale(factor: number, anchor: { x: number; z: number }): void {
    const s = this.state;
    if (!s || !(factor > 0) || !Number.isFinite(factor)) return;
    s.x = anchor.x + (s.x - anchor.x) * factor;
    s.z = anchor.z + (s.z - anchor.z) * factor;
    s.mmPerPx *= factor;
    this.changed();
  }

  setOpacity(v: number): void {
    if (!this.state) return;
    this.state.opacity = Math.min(1, Math.max(0.1, v));
    this.changed();
  }

  setVisible(v: boolean): void {
    if (!this.state) return;
    this.state.visible = v;
    this.changed();
  }

  remove(): void {
    this.state = null;
    this.img.removeAttribute('src');
    this.changed();
  }

  /** Bildets bredde i planen (mm). */
  get widthMm(): number {
    return this.state ? this.state.w * this.state.mmPerPx : 0;
  }

  /** Lagrer, plasserer og sier fra. */
  saveNow(): void {
    this.changed();
  }

  /** Sier fra til panelet uten å endre bildet (f.eks. når en modus skrus av eller på). */
  bump(): void {
    this.version.set(this.version.value + 1);
  }

  private changed(): void {
    this.unsaved = false;
    try {
      if (!this.state) this.storage?.removeItem(BACKDROP_KEY);
      else if (this.state.src.length > MAX_STORED) throw new Error('for stort');
      else this.storage?.setItem(BACKDROP_KEY, JSON.stringify(this.state));
    } catch {
      // For stort eller full lagring: bildet virker til siden lastes på nytt.
      // Et eldre bilde skal ikke dukke opp igjen da, så det fjernes.
      this.unsaved = true;
      try {
        this.storage?.removeItem(BACKDROP_KEY);
      } catch {
        /* lagring utilgjengelig */
      }
    }
    this.place();
    this.version.set(this.version.value + 1);
  }

  /** Legger bildet over lerretet med samme målestokk og retning som planen. */
  private place(): void {
    const s = this.state;
    const img = this.img;
    if (!s || !this.shown || !s.visible) {
      img.style.display = 'none';
      return;
    }
    // Planen er en affin avbildning: hjørnet og de to kantene av bildet gir matrisen.
    const o = this.desktop.screenOf(s.x, 0, s.z);
    const ex = this.desktop.screenOf(s.x + s.w * s.mmPerPx, 0, s.z);
    const ez = this.desktop.screenOf(s.x, 0, s.z + s.h * s.mmPerPx);
    img.style.display = '';
    img.style.width = `${s.w}px`;
    img.style.height = `${s.h}px`;
    img.style.opacity = String(s.opacity);
    img.style.transform = `matrix(${(ex.x - o.x) / s.w}, ${(ex.y - o.y) / s.w}, ${(ez.x - o.x) / s.h}, ${(ez.y - o.y) / s.h}, ${o.x}, ${o.y})`;
  }
}
