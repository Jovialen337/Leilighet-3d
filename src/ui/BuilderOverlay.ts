/**
 * Overlegget i 2D-planen mens man lager ny modell (SVG over lerretet):
 * romkanter med mål, håndtak for hjørner, kanter og rom, åpninger,
 * festemerke og hjelpelinjer, og forhåndsvisning av det som tegnes.
 *
 * Bare håndtakene fanger pekeren; resten av planen kan fortsatt dras og
 * zoomes. Håndtakene er store nok for laserpekeren på Quest.
 */
import type { BuilderEditor, DragHandle } from '../builder/BuilderEditor';
import type { CompileResult } from '../builder/compile';
import { alongEdge, edgesOf, scale, add, type P2 } from '../builder/geometry';
import { centroid, pointInPolygon, polygonArea } from '../geometry/math2d';
import { formatLength } from '../builder/units';
import type { DesktopView } from '../views/DesktopView';

const NS = 'http://www.w3.org/2000/svg';

/** Et rektangel på skjermen (px). */
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const overlaps = (a: Rect, b: Rect): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Bredden på en tekst med fonten til målene (px), målt med et lerret; anslått uten. */
let measureCtx: CanvasRenderingContext2D | null | undefined;
function textWidth(text: string, strong: boolean): number {
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d');
  const size = strong ? 13 : 11;
  if (!measureCtx) return text.length * size * 0.62;
  measureCtx.font = `600 ${size}px system-ui, sans-serif`;
  return measureCtx.measureText(text).width;
}

/** Et håndtak som skal tegnes (skjermpunkt og radius). */
interface PlannedHandle {
  shape: 'circle' | 'rect';
  p: { x: number; y: number };
  r: number;
  handle: DragHandle;
  cls: string;
  testid: string;
  text?: string;
}

const SNAP_COLOR: Record<string, string> = {
  hjørne: '#ffd400',
  vegg: '#39d98a',
  linje: '#18d4ff',
  vinkel: '#18d4ff',
  rutenett: '#ffffff',
  fri: '#ff9f1a',
};
const OPENING_COLOR = { door: '#9b5d2e', window: '#1e88e5', passage: '#7d8a93' } as const;

/** Grov peker (Quest-laser, berøring): større håndtak. */
export const coarsePointer = (): boolean =>
  (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || /OculusBrowser|Quest/i.test(navigator.userAgent);

export class BuilderOverlay {
  readonly svg: SVGSVGElement;
  private pending = false;
  private visible = false;
  /** Punkter som merkes (f.eks. målestokk for bakgrunnsbildet), mm. */
  private marks: { x: number; z: number }[] = [];
  private readonly coarse = coarsePointer();

  constructor(
    /** Lerretet: overlegget legges rett over det (under panelet, så håndtak aldri fanger klikk på knappene). */
    canvas: HTMLElement,
    private readonly editor: BuilderEditor,
    private readonly desktop: DesktopView,
    private readonly compiled: () => CompileResult | null,
    /** Toleranse i mm for et antall skjermpiksler (følger zoom). */
    private readonly tolMm: (px: number) => number,
  ) {
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('class', 'builder-overlay');
    this.svg.dataset.testid = 'builder-overlay';
    this.svg.style.display = 'none';
    canvas.after(this.svg);
    editor.version.subscribe(() => this.request());
    editor.selection.subscribe(() => this.request());
    editor.tool.subscribe(() => this.request());
    editor.session.subscribe(() => this.request());
    desktop.onChange(() => this.request());
  }

  /** Merker punkter i planen (to punkter får en strek imellom). */
  setMarks(points: { x: number; z: number }[]): void {
    this.marks = points;
    this.request();
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.svg.style.display = on ? '' : 'none';
    this.request();
  }

  request(): void {
    if (this.pending || !this.visible) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.render();
    });
  }

  private s(p: P2): { x: number; y: number } {
    return this.desktop.screenOf(p.x, 0, p.z);
  }

  private el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element = this.svg): SVGElementTagNameMap[K] {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    parent.appendChild(e);
    return e;
  }

  private label(at: { x: number; y: number }, text: string, cls = 'bo-label', angle = 0): void {
    const t = this.el('text', {
      x: at.x,
      y: at.y,
      class: cls,
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
      ...(angle ? { transform: `rotate(${angle.toFixed(1)} ${at.x.toFixed(1)} ${at.y.toFixed(1)})` } : {}),
    });
    t.textContent = text;
  }

  private line(a: P2, b: P2, attrs: Record<string, string | number>): SVGLineElement {
    const sa = this.s(a);
    const sb = this.s(b);
    return this.el('line', { x1: sa.x, y1: sa.y, x2: sb.x, y2: sb.y, ...attrs });
  }

  /** Størrelsen på romnavn-etikettene (px), etter navn og areal – leses fra siden bare når de endres. */
  private readonly labelSizes = new Map<string, { w: number; h: number }>();

  /** Håndtakene i denne runden, viktigst først. */
  private planned: PlannedHandle[] = [];

  /**
   * Planlegger et håndtak. Overlapper det et håndtak som allerede er
   * planlagt (f.eks. hjørner i to rom som nesten møtes, når man har zoomet
   * ut), droppes det: håndtakene planlegges i viktighetsrekkefølge, og
   * laserpekeren på Quest skal aldri treffe et annet håndtak enn det man ser.
   */
  private handle(shape: 'circle' | 'rect', at: P2, handle: DragHandle, cls: string, testid: string, text?: string): void {
    const p = this.s(at);
    const r = this.coarse ? 16 : cls.includes('small') ? 6 : 9;
    if (this.planned.some((q) => Math.hypot(q.p.x - p.x, q.p.y - p.y) < q.r + r)) return;
    this.planned.push({ shape, p, r, handle, cls, testid, ...(text ? { text } : {}) });
  }

  /** Tegner de planlagte håndtakene, det viktigste sist (øverst). */
  private drawHandles(): void {
    for (let i = this.planned.length - 1; i >= 0; i--) {
      const { shape, p, r, handle, cls, testid, text } = this.planned[i]!;
      this.drawHandle(shape, p, r, handle, cls, testid, text);
    }
  }

  private drawHandle(shape: 'circle' | 'rect', p: { x: number; y: number }, r: number, handle: DragHandle, cls: string, testid: string, text?: string): void {
    const g = this.el('g', { class: `bo-handle ${cls}`, 'data-testid': testid });
    if (shape === 'circle') this.el('circle', { cx: p.x, cy: p.y, r }, g);
    else this.el('rect', { x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r, rx: 3 }, g);
    if (text) {
      const t = this.el('text', { x: p.x, y: p.y + 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle', class: 'bo-handle-text' }, g);
      t.textContent = text;
    }
    g.addEventListener('pointerdown', (e) => this.startDrag(e, handle));
  }

  private startDrag(e: PointerEvent, handle: DragHandle): void {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = this.desktop.planPointAt(e.clientX, e.clientY);
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    this.desktop.plan.enabled = false;
    this.editor.beginDrag(handle, p);
    // Håndtakene tegnes på nytt mens man drar, så draget følges på vinduet
    // (pekerfangst på et håndtak forsvinner når håndtaket byttes ut).
    const id = e.pointerId;
    const move = (ev: PointerEvent): void => {
      if (ev.pointerId !== id) return;
      const q = this.desktop.planPointAt(ev.clientX, ev.clientY);
      if (q) this.editor.dragTo(q, this.tolMm(this.coarse ? 20 : 10), ev.ctrlKey);
    };
    const up = (ev: PointerEvent): void => {
      if (ev.pointerId !== id) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.desktop.plan.enabled = this.desktop.mode === 'top';
      this.editor.endDrag();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  render(): void {
    const svg = this.svg;
    while (svg.firstChild) svg.firstChild.remove();
    try {
      this.draw();
    } catch (e) {
      // Overlegget skal aldri stoppe appen; tegningen kan fortsatt angres eller forkastes.
      console.error('Overlegget for «Lag ny modell» kunne ikke tegnes', e);
    }
  }

  /** Håndtakene i Velg, viktigst først: valgt åpning, valgt rom (hjørner, flytt, kanter), andre rommenes hjørner. */
  private planHandles(): void {
    const ed = this.editor;
    const doc = ed.doc!;
    const sel = ed.selection.value;
    const ppm = this.desktop.pixelsPerMeter();
    if (sel?.kind === 'opening') {
      const o = doc.openings.find((x) => x.id === sel.id);
      const seg = o && ed.openingSegment(o);
      if (o && seg) {
        // Er åpningen kort på skjermen, settes endehåndtakene litt utenfor endene, så alle tre
        // får plass (draget regner fra der man tok tak, så enden hopper ikke).
        const r = this.coarse ? 16 : 9;
        const lenPx = (o.width / 1000) * ppm;
        const push = Math.max(0, (3 * r - lenPx / 2) / Math.max(ppm, 1e-6)) * 1000;
        const a = alongEdge(seg.edge, o.offset - push);
        const b = alongEdge(seg.edge, o.offset + o.width + push);
        this.handle('rect', alongEdge(seg.edge, o.offset + o.width / 2), { kind: 'opening', id: o.id }, 'opening', `bo-opening-move-${o.id}`, '↔');
        this.handle('circle', a, { kind: 'opening-end', id: o.id, end: 'start' }, 'opening-end', `bo-opening-start-${o.id}`);
        this.handle('circle', b, { kind: 'opening-end', id: o.id, end: 'end' }, 'opening-end', `bo-opening-end-${o.id}`);
      }
    }
    const current = sel && sel.kind !== 'opening' ? doc.rooms.find((r) => r.id === sel.room) : undefined;
    const order = current ? [current, ...doc.rooms.filter((r) => r !== current)] : doc.rooms;
    for (const r of order) {
      const selectedRoom = r === current;
      r.polygon.forEach((p, i) =>
        this.handle('circle', p, { kind: 'corner', room: r.id, i }, `corner${selectedRoom ? '' : ' small'}${sel?.kind === 'corner' && sel.room === r.id && sel.i === i ? ' active' : ''}`, `bo-corner-${r.id}-${i}`),
      );
      if (!selectedRoom) continue;
      // Flyttehåndtaket før kantene: et rom kan bare dras i det.
      this.handle('circle', centroid(r.polygon), { kind: 'room', room: r.id }, 'move', `bo-move-${r.id}`, '✥');
      for (const e of edgesOf(r.polygon)) {
        if (e.length <= 0) continue;
        this.handle('rect', alongEdge(e, e.length / 2), { kind: 'edge', room: r.id, edge: e.i }, `edge${sel?.kind === 'edge' && sel.edge === e.i ? ' active' : ''}`, `bo-edge-${r.id}-${e.i}`);
      }
    }
  }

  /**
   * Målene langs kantene. Valgt rom og rommet under pekeren først, så de
   * andre når man har zoomet inn. Et mål tegnes bare der det ikke dekker et
   * annet mål, et romnavn eller et håndtak – vannrett eller langs kanten, og
   * for valgt rom eventuelt utenfor kanten; for andre rom må det ligge helt
   * inne i rommet. Finnes ingen ledig plass, står målet bare i panelet.
   */
  private drawDimensions(ppm: number): void {
    const ed = this.editor;
    const doc = ed.doc!;
    const sel = ed.selection.value;
    const taken: Rect[] = [];
    // Romnavn og areal (etikettene i planen) midt i rommet: størrelsen fra etiketten selv når
    // den vises, ellers anslått (navn + areal på to linjer).
    for (const r of doc.rooms) {
      if (r.polygon.length < 3) continue;
      const c = this.s(centroid(r.polygon));
      const area = `${(polygonArea(r.polygon) / 1e6).toLocaleString('nb-NO', { maximumFractionDigits: 1 })} m²`;
      // Arealet endres mens et hjørne dras, men sjelden antall tegn – det er det som gir bredden.
      const key = `${r.id}|${r.name}|${area.length}`;
      let size = this.labelSizes.get(key);
      if (!size) {
        // Én lesing fra siden per ny etikett (ikke hver gang overlegget tegnes, f.eks. under et drag).
        const el = document.querySelector<HTMLElement>(`.labels .label.room[data-room="${CSS.escape(r.id)}"]`);
        if (el?.offsetWidth) {
          size = { w: el.offsetWidth, h: el.offsetHeight };
          if (this.labelSizes.size > 200) this.labelSizes.clear();
          this.labelSizes.set(key, size);
        }
      }
      const w = (size?.w ?? Math.max(r.name.length, area.length) * 7.5 + 14) + 4;
      const h = (size?.h ?? 36) + 4;
      taken.push({ x0: c.x - w / 2, y0: c.y - h / 2, x1: c.x + w / 2, y1: c.y + h / 2 });
    }
    for (const h of this.planned) taken.push({ x0: h.p.x - h.r, y0: h.p.y - h.r, x1: h.p.x + h.r, y1: h.p.y + h.r });
    const isFocus = (id: string): boolean =>
      (!!sel && sel.kind !== 'opening' && sel.room === id) || (!!ed.hover?.target && ed.hover.target.kind !== 'opening' && ed.hover.target.room === id);
    const rooms = [...doc.rooms].sort((a, b) => Number(isFocus(b.id)) - Number(isFocus(a.id)));
    for (const r of rooms) {
      const focus = isFocus(r.id);
      if (!focus && ppm < 70) continue;
      const screenPoly = r.polygon.map((p) => {
        const q = this.s(p);
        return { x: q.x, z: q.y };
      });
      for (const e of edgesOf(r.polygon)) {
        if (e.length <= 0) continue;
        const text = formatLength(e.length);
        // Med hvit kant rundt teksten (stroke 3 px) og litt luft.
        const w = textWidth(text, focus) + 8;
        const h = focus ? 16 : 14;
        // Retningen inn i rommet og langs kanten, på skjermen.
        const m0 = this.s(alongEdge(e, e.length / 2));
        const m1 = this.s(add(alongEdge(e, e.length / 2), scale(e.out, -1000)));
        const nl = Math.hypot(m1.x - m0.x, m1.y - m0.y) || 1;
        const n = { x: (m1.x - m0.x) / nl, y: (m1.y - m0.y) / nl };
        // Teksten langs kanten, lesbar (ikke opp ned): vinkel i (−90°, 90°].
        let angle = (Math.atan2(-n.x, n.y) * 180) / Math.PI;
        if (angle > 90) angle -= 180;
        if (angle <= -90) angle += 180;
        // Valgt rom: forbi kanthåndtaket midt på kanten, så målet ikke havner under det.
        const clear = focus ? (this.coarse ? 16 : 9) + 4 : 6;
        type Spot = { rect: Rect; angle: number };
        const spot = (t: number, along: boolean, side: 1 | -1): Spot => {
          const a = along ? (angle * Math.PI) / 180 : 0;
          const bw = Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * h;
          const bh = Math.abs(Math.sin(a)) * w + Math.abs(Math.cos(a)) * h;
          const ext = Math.abs(n.x) * (bw / 2) + Math.abs(n.y) * (bh / 2);
          const b = this.s(alongEdge(e, e.length * t));
          const cx = b.x + side * n.x * (clear + ext);
          const cy = b.y + side * n.y * (clear + ext);
          return { rect: { x0: cx - bw / 2, y0: cy - bh / 2, x1: cx + bw / 2, y1: cy + bh / 2 }, angle: along ? angle : 0 };
        };
        const inside = (q: Rect): boolean =>
          [
            { x: q.x0, z: q.y0 },
            { x: q.x1, z: q.y0 },
            { x: q.x1, z: q.y1 },
            { x: q.x0, z: q.y1 },
          ].every((c) => pointInPolygon(c, screenPoly));
        const free = (q: Spot, mustBeInside: boolean): boolean => !taken.some((o) => overlaps(q.rect, o)) && (!mustBeInside || inside(q.rect));
        // Nærmest midten først, vannrett før langs kanten (smale rom), inne i rommet før utenfor
        // (bare valgt rom). Finnes ingen ledig plass, droppes målet – det står i panelet.
        let best: Spot | undefined;
        search: for (const side of focus ? ([1, -1] as const) : ([1] as const))
          for (const t of [0.5, 0.35, 0.65, 0.2, 0.8])
            for (const along of [false, true]) {
              const q = spot(t, along, side);
              if (free(q, side === 1)) {
                best = q;
                break search;
              }
            }
        if (!best) continue;
        taken.push(best.rect);
        this.label({ x: (best.rect.x0 + best.rect.x1) / 2, y: (best.rect.y0 + best.rect.y1) / 2 }, text, `bo-dim${focus ? ' strong' : ''}`, best.angle);
      }
    }
  }

  private draw(): void {
    const doc = this.editor.doc;
    if (!this.visible || !doc) return;
    const ed = this.editor;
    const sel = ed.selection.value;
    const tool = ed.tool.value;
    const res = this.compiled();
    const bad = new Set((res?.issues ?? []).filter((i) => i.severity === 'error' && i.target).map((i) => `${i.target!.kind}:${i.target!.id}`));
    const ppm = this.desktop.pixelsPerMeter();

    // Rom.
    for (const r of doc.rooms) {
      if (r.polygon.length < 2) continue;
      const pts = r.polygon.map((p) => this.s(p));
      const selected = sel && sel.kind !== 'opening' && sel.room === r.id;
      const hovered = ed.hover?.target && ed.hover.target.kind !== 'opening' && ed.hover.target.room === r.id;
      this.el('polygon', {
        points: pts.map((p) => `${p.x},${p.y}`).join(' '),
        class: `bo-room${selected ? ' selected' : ''}${hovered ? ' hovered' : ''}${bad.has(`room:${r.id}`) ? ' bad' : ''}`,
        'data-testid': `bo-room-${r.id}`,
      });
    }

    // Håndtakene planlegges før målene, så målene kan holde seg unna dem.
    this.planned = [];
    if (tool === 'select') this.planHandles();
    this.drawDimensions(ppm);

    // Åpne overganger (ingen vegg) – stiplet.
    for (const o of res?.walls.open ?? []) this.line(o.start, o.end, { class: 'bo-open' });

    // Åpninger.
    for (const o of doc.openings) {
      const seg = ed.openingSegment(o);
      if (!seg) continue;
      const selected = sel?.kind === 'opening' && sel.id === o.id;
      this.line(seg.a, seg.b, {
        class: `bo-opening${selected ? ' selected' : ''}${bad.has(`opening:${o.id}`) ? ' bad' : ''}`,
        stroke: o.entrance ? '#21a366' : OPENING_COLOR[o.type],
        'data-testid': `bo-opening-${o.id}`,
      });
      // «Inngang» utenfor veggen, langt nok ut til at teksten ikke dekker målene.
      if (o.entrance) this.label(this.s(add(alongEdge(seg.edge, o.offset + o.width / 2), scale(seg.edge.out, Math.max(450, (60 / Math.max(ppm, 1)) * 1000)))), 'Inngang', 'bo-tag');
    }

    this.drawHandles();

    // Utkast og forhåndsvisning.
    const hv = ed.hover;
    const draft = ed.draft;
    if (tool === 'rect' && draft[0] && hv) {
      const a = draft[0];
      const b = hv.snap.p;
      const pts = [a, { x: b.x, z: a.z }, b, { x: a.x, z: b.z }].map((p) => this.s(p));
      this.el('polygon', { points: pts.map((p) => `${p.x},${p.y}`).join(' '), class: 'bo-draft' });
      this.label(this.s({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }), `${formatLength(Math.abs(b.x - a.x))} × ${formatLength(Math.abs(b.z - a.z))}`, 'bo-dim strong');
    }
    if (tool === 'poly' && draft.length) {
      const pts = [...draft, ...(hv ? [hv.snap.p] : [])].map((p) => this.s(p));
      this.el('polyline', { points: pts.map((p) => `${p.x},${p.y}`).join(' '), class: 'bo-draft' });
      for (const p of draft) this.el('circle', { ...((q) => ({ cx: q.x, cy: q.y }))(this.s(p)), r: 4, class: 'bo-draft-dot' });
      const last = draft[draft.length - 1]!;
      if (hv) this.label(this.s({ x: (last.x + hv.snap.p.x) / 2, z: (last.z + hv.snap.p.z) / 2 }), formatLength(Math.hypot(hv.snap.p.x - last.x, hv.snap.p.z - last.z)), 'bo-dim strong');
    }
    if (tool === 'beside' && hv?.edge) {
      const r = doc.rooms.find((x) => x.id === hv.edge!.room);
      const e = r ? edgesOf(r.polygon)[hv.edge.edge] : undefined;
      if (e) {
        const gap = doc.settings.interiorThickness;
        const a = add(e.a, scale(e.out, gap));
        const b = add(e.b, scale(e.out, gap));
        const c = add(b, scale(e.out, ed.besideDepth));
        const d = add(a, scale(e.out, ed.besideDepth));
        const pts = [a, b, c, d].map((p) => this.s(p));
        this.el('polygon', { points: pts.map((p) => `${p.x},${p.y}`).join(' '), class: 'bo-draft' });
        this.label(this.s(add(alongEdge(e, e.length / 2), scale(e.out, gap + ed.besideDepth / 2))), `${formatLength(e.length)} × ${formatLength(ed.besideDepth)}`, 'bo-dim strong');
      }
    }
    if ((tool === 'door' || tool === 'window' || tool === 'passage') && hv?.edge) {
      const r = doc.rooms.find((x) => x.id === hv.edge!.room);
      const e = r ? edgesOf(r.polygon)[hv.edge.edge] : undefined;
      if (e) {
        const w = tool === 'window' ? 1000 : tool === 'door' ? 900 : 1000;
        const s0 = Math.max(0, Math.min(e.length - w, hv.edge.s - w / 2));
        this.line(alongEdge(e, s0), alongEdge(e, s0 + w), { class: 'bo-opening preview', stroke: OPENING_COLOR[tool] });
      }
    }

    // Merkede punkter (målestokk for bakgrunnsbildet).
    if (this.marks.length >= 2) this.line(this.marks[0]!, this.marks[1]!, { class: 'bo-mark-line' });
    this.marks.forEach((m, i) => {
      const p = this.s(m);
      this.el('circle', { cx: p.x, cy: p.y, r: 7, class: 'bo-mark', 'data-testid': `bo-mark-${i}` });
    });

    // Festemerke og hjelpelinjer.
    if (hv && tool !== 'select' || (hv && ed.dragging)) {
      for (const g of hv!.snap.guides) this.line(g.a, g.b, { class: 'bo-guide' });
      if (tool === 'rect' || tool === 'poly' || ed.dragging) {
        const p = this.s(hv!.snap.p);
        this.el('circle', { cx: p.x, cy: p.y, r: 6, class: 'bo-snap', fill: SNAP_COLOR[hv!.snap.kind] ?? '#fff' });
        if (hv!.snap.kind !== 'rutenett') this.label({ x: p.x + 14, y: p.y - 14 }, hv!.snap.kind, 'bo-tag');
      }
    }
  }
}
