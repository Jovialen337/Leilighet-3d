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
import { centroid } from '../geometry/math2d';
import { formatLength } from '../builder/units';
import type { DesktopView } from '../views/DesktopView';

const NS = 'http://www.w3.org/2000/svg';

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

  private label(at: { x: number; y: number }, text: string, cls = 'bo-label'): void {
    const t = this.el('text', { x: at.x, y: at.y, class: cls, 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
    t.textContent = text;
  }

  private line(a: P2, b: P2, attrs: Record<string, string | number>): SVGLineElement {
    const sa = this.s(a);
    const sb = this.s(b);
    return this.el('line', { x1: sa.x, y1: sa.y, x2: sb.x, y2: sb.y, ...attrs });
  }

  /** Håndtak som er tegnet i denne runden (skjermpunkt og radius). */
  private placed: { x: number; y: number; r: number }[] = [];

  /**
   * Et håndtak som kan dras. Ligger det oppå et håndtak som allerede er
   * tegnet (f.eks. hjørner i to rom som nesten møtes, når man har zoomet ut),
   * tegnes det ikke: håndtakene tegnes i viktighetsrekkefølge, og laserpekeren
   * på Quest skal aldri treffe et annet håndtak enn det man ser.
   */
  private handle(shape: 'circle' | 'rect', at: P2, handle: DragHandle, cls: string, testid: string, text?: string): void {
    const p = this.s(at);
    const r = this.coarse ? 16 : cls.includes('small') ? 6 : 9;
    if (this.placed.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < Math.max(q.r, r))) return;
    this.placed.push({ x: p.x, y: p.y, r });
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
      // Mål på kantene: valgt rom og rommet under pekeren alltid; andre rom når man har
      // zoomet inn, og bare mål som får plass langs kanten (ellers blir det et virvar).
      const focus = selected || hovered;
      if (focus || ppm >= 70) {
        for (const e of edgesOf(r.polygon)) {
          if (e.length <= 0) continue;
          const text = formatLength(e.length);
          if (!focus && (e.length / 1000) * ppm < text.length * 7 + 10) continue;
          const mid = alongEdge(e, e.length / 2);
          const at = this.s(add(mid, scale(e.out, -Math.min(350, 22 / Math.max(ppm, 1) * 1000))));
          this.label(at, text, `bo-dim${focus ? ' strong' : ''}`);
        }
      }
    }

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

    // Håndtak (bare i Velg). Viktigst først: valgt åpning, valgt rom, så de andre rommenes hjørner.
    this.placed = [];
    if (tool === 'select') {
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
