/**
 * Verktøyene i «Lag ny modell» (2D-planen, mus/laserpeker):
 *
 *   Velg      – klikk rom, hjørne, kant eller åpning; dra håndtakene
 *   Rektangel – klikk to hjørner (eller skriv bredde × dybde)
 *   Mangekant – klikk hjørne for hjørne, skriv lengder; klikk første hjørne for å lukke
 *   Rom inntil – klikk en kant: nytt rom på den andre siden av en skillevegg
 *   Dør / Vindu / Åpning – klikk på en kant
 *
 * Alt går gjennom BuilderSession (angre/gjør om, lagring). Under et drag
 * endres bare tegningen; 3D-modellen bygges når draget er ferdig.
 */
import { Observable } from '../state/Observable';
import { BuilderSession } from './BuilderSession';
import { add, alongEdge, dist, dot, edgeCoords, edgesOf, scale, sub, type Edge, type P2 } from './geometry';
import { pointInPolygon } from '../geometry/math2d';
import {
  addOpening,
  addRect,
  addRoom,
  addRoomBeside,
  copyRoom,
  deleteCorner,
  insertCorner,
  moveCorner,
  moveEdge,
  moveRoom,
  removeRoom,
  rotateRoom90,
  setPartitionThickness,
  splitRoom,
  straighten,
  type SplitResult,
} from './ops';
import { snapPoint, type SnapResult } from './snap';
import { formatLength } from './units';
import type { BOpening, BOpeningType, BRoom, BuilderDoc } from './types';

export type BuilderTool = 'select' | 'rect' | 'poly' | 'beside' | 'door' | 'window' | 'passage';

export type BuilderSelection =
  | { kind: 'room'; room: string }
  | { kind: 'corner'; room: string; i: number }
  | { kind: 'edge'; room: string; edge: number }
  | { kind: 'opening'; id: string }
  | null;

export type DragHandle =
  | { kind: 'corner'; room: string; i: number }
  | { kind: 'edge'; room: string; edge: number }
  | { kind: 'room'; room: string }
  | { kind: 'opening'; id: string }
  | { kind: 'opening-end'; id: string; end: 'start' | 'end' };

export const TOOL_TEXT: Record<BuilderTool, string> = {
  select: 'Velg og flytt',
  rect: 'Rektangel',
  poly: 'Mangekant',
  beside: 'Rom inntil',
  door: 'Dør',
  window: 'Vindu',
  passage: 'Åpning',
};

/** Hurtigtaster i byggeren. */
export const TOOL_KEYS: Record<string, BuilderTool> = { s: 'select', r: 'rect', m: 'poly', i: 'beside', d: 'door', v: 'window', o: 'passage', å: 'passage' };

export const TOOL_HINT: Record<BuilderTool, string> = {
  select: 'Klikk et rom, et hjørne, en kant eller en åpning. Dra de runde og firkantede håndtakene for å flytte.',
  rect: 'Klikk ett hjørne og så det motsatte hjørnet – eller skriv bredde og dybde.',
  poly: 'Klikk hjørne for hjørne. Skriv lengden og trykk Enter for nøyaktige mål. Klikk første hjørne (eller «Ferdig») for å lukke rommet.',
  beside: 'Klikk en kant: et nytt rom legges på den andre siden, med en skillevegg imellom.',
  door: 'Klikk på en kant for å sette inn en dør.',
  window: 'Klikk på en kant for å sette inn et vindu.',
  passage: 'Klikk på en kant for å sette inn en åpning uten dør.',
};

interface Hover {
  raw: P2;
  snap: SnapResult;
  /** Kanten under pekeren (for Rom inntil og åpninger). */
  edge: { room: string; edge: number; s: number } | null;
  /** Det som ville blitt valgt (for utheving i Velg). */
  target: BuilderSelection;
}

export class BuilderEditor {
  readonly tool = new Observable<BuilderTool>('select');
  readonly selection = new Observable<BuilderSelection>(null);
  readonly message = new Observable<string>(TOOL_HINT.select);
  /** Ingen festing (for Quest, der Ctrl ikke finnes). */
  readonly free = new Observable(false);
  /** Endres når hover/utkast endres (for å tegne overlegget på nytt). */
  readonly version = new Observable(0);
  hover: Hover | null = null;
  /** Punktene i mangekanten som tegnes, eller første hjørne i rektangelet. */
  draft: P2[] = [];
  /** Dybde for «Rom inntil» (mm). */
  besideDepth = 3000;
  private drag: { handle: DragHandle; start: BuilderDoc; p0: P2; grab: number } | null = null;

  constructor(readonly session: BuilderSession) {
    this.tool.subscribe((t, prev) => {
      if (t === prev) return;
      this.draft = [];
      this.hover = null;
      this.message.set(TOOL_HINT[t]);
      this.bump();
    });
    session.subscribe(() => {
      // Utvalget kan peke på noe som er borte (angre, slett).
      const sel = this.selection.value;
      if (sel && !this.exists(sel)) this.selection.set(null);
    });
  }

  get doc(): BuilderDoc | null {
    return this.session.doc;
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  private bump(): void {
    this.version.set(this.version.value + 1);
  }

  private exists(sel: NonNullable<BuilderSelection>): boolean {
    const d = this.doc;
    if (!d) return false;
    if (sel.kind === 'opening') return d.openings.some((o) => o.id === sel.id);
    const r = d.rooms.find((x) => x.id === sel.room);
    if (!r) return false;
    if (sel.kind === 'corner') return sel.i < r.polygon.length;
    if (sel.kind === 'edge') return sel.edge < r.polygon.length;
    return true;
  }

  /* ---------------- treff ---------------- */

  /** Nærmeste kant (i et hvilket som helst rom) innen `tol` mm. */
  edgeAt(p: P2, tol: number): { room: string; edge: number; s: number; d: number } | null {
    const d = this.doc;
    if (!d) return null;
    let best: { room: string; edge: number; s: number; d: number } | null = null;
    for (const r of d.rooms)
      for (const e of edgesOf(r.polygon)) {
        if (e.length <= 0) continue;
        const { s, d: off } = edgeCoords(e, p);
        if (s < 0 || s > e.length) continue;
        const dd = Math.abs(off);
        if (dd < tol && (!best || dd < best.d)) best = { room: r.id, edge: e.i, s, d: dd };
      }
    return best;
  }

  /** Hva ligger under punktet: hjørne, åpning, kant eller rom (i den rekkefølgen). */
  hitTest(p: P2, tol: number): BuilderSelection {
    const d = this.doc;
    if (!d) return null;
    for (const r of d.rooms) for (let i = 0; i < r.polygon.length; i++) if (dist(r.polygon[i]!, p) < tol) return { kind: 'corner', room: r.id, i };
    for (const o of d.openings) {
      const seg = this.openingSegment(o);
      if (!seg) continue;
      const { s, d: off } = edgeCoords(seg.edge, p);
      if (s >= o.offset - tol / 2 && s <= o.offset + o.width + tol / 2 && Math.abs(off) < tol) return { kind: 'opening', id: o.id };
    }
    const e = this.edgeAt(p, tol);
    if (e) return { kind: 'edge', room: e.room, edge: e.edge };
    // Minste rom som inneholder punktet (et rom inni et annet vinner).
    const hits = d.rooms.filter((r) => pointInPolygon(p, r.polygon));
    if (hits.length) return { kind: 'room', room: hits[hits.length - 1]!.id };
    return null;
  }

  /** Kanten en åpning sitter på, og endepunktene. */
  openingSegment(o: BOpening): { edge: Edge; a: P2; b: P2 } | null {
    const r = this.doc?.rooms.find((x) => x.id === o.room);
    const e = r ? edgesOf(r.polygon)[o.edge] : undefined;
    if (!e || e.length <= 0) return null;
    return { edge: e, a: alongEdge(e, o.offset), b: alongEdge(e, o.offset + o.width) };
  }

  /* ---------------- peker ---------------- */

  /** Pekeren flyttes (mm). `tol` i mm, `free` = Ctrl eller «Fri». */
  pointerMove(raw: P2 | null, tol: number, free = false): void {
    const d = this.doc;
    if (!raw || !d) {
      if (this.hover) {
        this.hover = null;
        this.bump();
      }
      return;
    }
    const t = this.tool.value;
    const prev = this.draft[this.draft.length - 1] ?? null;
    const snap = snapPoint(d, raw, { tol, free: free || this.free.value, prev: t === 'poly' || t === 'rect' ? prev : null });
    const edge = t === 'beside' || t === 'door' || t === 'window' || t === 'passage' ? this.edgeAt(raw, tol * 2) : null;
    this.hover = { raw, snap, edge: edge ? { room: edge.room, edge: edge.edge, s: edge.s } : null, target: t === 'select' ? this.hitTest(raw, tol) : null };
    this.bump();
  }

  /** Et klikk i planet (mm). */
  click(raw: P2, tol: number, free = false): void {
    if (!this.session.doc) return;
    this.pointerMove(raw, tol, free);
    const hv = this.hover!;
    const t = this.tool.value;
    if (t === 'select') {
      this.selection.set(hv.target);
      this.message.set(hv.target ? this.describe(hv.target) : TOOL_HINT.select);
      return;
    }
    if (t === 'rect') {
      if (!this.draft.length) {
        this.draft = [hv.snap.p];
        this.message.set('Klikk det motsatte hjørnet – eller skriv bredde og dybde.');
        this.bump();
      } else this.finishRect(this.draft[0]!, hv.snap.p);
      return;
    }
    if (t === 'poly') {
      const first = this.draft[0];
      if (first && this.draft.length >= 3 && dist(first, hv.snap.p) < Math.max(tol, 1)) {
        this.finishPoly();
        return;
      }
      const last = this.draft[this.draft.length - 1];
      if (last && dist(last, hv.snap.p) < 1) return;
      this.draft = [...this.draft, hv.snap.p];
      this.message.set(`${this.draft.length} hjørner. Skriv lengden og trykk Enter, eller klikk neste hjørne. Klikk første hjørne for å lukke.`);
      this.bump();
      return;
    }
    if (t === 'beside') {
      if (!hv.edge) {
        this.message.set('Klikk nærmere en kant i et rom.');
        return;
      }
      this.roomBeside(hv.edge.room, hv.edge.edge);
      return;
    }
    // Dør, vindu, åpning.
    if (!hv.edge) {
      this.message.set('Klikk nærmere en kant (vegg) i et rom.');
      return;
    }
    const type: BOpeningType = t;
    const { room, edge, s } = hv.edge;
    let made: BOpening | null = null;
    this.session.apply((d) => {
      made = addOpening(d, type, room, edge, Math.round(s / 10) * 10);
      return made !== null;
    });
    if (made) {
      const m = made as BOpening;
      this.selection.set({ kind: 'opening', id: m.id });
      this.message.set(`${t === 'door' ? 'Dør' : t === 'window' ? 'Vindu' : 'Åpning'} satt inn${m.entrance ? ' (inngangsdør)' : ''}. Juster mål og plassering i panelet, eller dra den langs veggen.`);
    }
  }

  /* ---------------- rom ---------------- */

  /** Lager rektangelet fra a til b (begge mm). */
  finishRect(a: P2, b: P2): boolean {
    if (Math.abs(b.x - a.x) < 300 || Math.abs(b.z - a.z) < 300) {
      this.message.set('Rommet er for smalt. Klikk et hjørne lenger unna (minst 30 cm).');
      return false;
    }
    let id = '';
    this.session.apply((d) => void (id = addRect(d, a, b).id));
    this.draft = [];
    this.selection.set({ kind: 'room', room: id });
    this.message.set(`Rom lagt til (${formatLength(Math.abs(b.x - a.x))} × ${formatLength(Math.abs(b.z - a.z))}). Gi det navn i panelet, eller tegn neste.`);
    this.bump();
    return true;
  }

  /** Rektangel med skrevne mål fra første hjørne (mot pekeren, ellers ned og til høyre). */
  typedRect(width: number, depth: number): boolean {
    const a = this.draft[0] ?? this.hover?.snap.p ?? { x: 0, z: 0 };
    const towards = this.hover?.snap.p ?? { x: a.x + 1, z: a.z + 1 };
    const sx = towards.x >= a.x ? 1 : -1;
    const sz = towards.z >= a.z ? 1 : -1;
    return this.finishRect(a, { x: a.x + sx * width, z: a.z + sz * depth });
  }

  finishPoly(): boolean {
    if (this.draft.length < 3) {
      this.message.set('Et rom trenger minst 3 hjørner.');
      return false;
    }
    const pts = this.draft;
    let id = '';
    this.session.apply((d) => void (id = addRoom(d, pts).id));
    this.draft = [];
    this.selection.set({ kind: 'room', room: id });
    this.message.set('Rom lagt til. Gi det navn i panelet, eller tegn neste.');
    this.bump();
    return true;
  }

  /**
   * Neste hjørne i mangekanten: `length` mm i retningen til pekeren (festet
   * til 45°), eller i retningen `deg` (0 = mot høyre, 90 = ned i planen).
   */
  typedSegment(length: number, deg?: number): boolean {
    const last = this.draft[this.draft.length - 1];
    if (!last || length <= 0) return false;
    const towards = this.hover?.raw ?? { x: last.x + 1, z: last.z };
    const a = deg !== undefined ? (deg * Math.PI) / 180 : Math.atan2(towards.z - last.z, towards.x - last.x);
    const k = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
    const p = { x: Math.round(last.x + Math.cos(k) * length), z: Math.round(last.z + Math.sin(k) * length) };
    this.draft = [...this.draft, p];
    this.message.set(`${this.draft.length} hjørner. Fortsett, eller klikk første hjørne for å lukke.`);
    this.bump();
    return true;
  }

  undoPoint(): void {
    if (!this.draft.length) return;
    this.draft = this.draft.slice(0, -1);
    this.bump();
  }

  cancel(): boolean {
    if (this.draft.length) {
      this.draft = [];
      this.message.set('Avbrutt.');
      this.bump();
      return true;
    }
    return false;
  }

  roomBeside(roomId: string, edge: number): void {
    let id = '';
    this.session.apply((d) => {
      const r = addRoomBeside(d, roomId, edge, this.besideDepth);
      if (!r) return false;
      id = r.id;
      return true;
    });
    if (id) {
      this.selection.set({ kind: 'room', room: id });
      this.message.set(`Nytt rom inntil, ${formatLength(this.besideDepth)} dypt. Skilleveggen er ${this.session.doc!.settings.interiorThickness} mm.`);
    }
  }

  /* ---------------- dra ---------------- */

  beginDrag(handle: DragHandle, p: P2): void {
    const d = this.doc;
    if (!d) return;
    let grab = 0;
    if (handle.kind === 'opening' || handle.kind === 'opening-end') {
      const o = d.openings.find((x) => x.id === handle.id);
      const seg = o && this.openingSegment(o);
      // Hvor langt fra det som dras pekeren tok tak (håndtaket kan sitte litt utenfor enden).
      const at = handle.kind === 'opening-end' && handle.end === 'end' ? o!.offset + o!.width : o?.offset ?? 0;
      if (seg) grab = edgeCoords(seg.edge, p).s - at;
    }
    this.drag = { handle, start: structuredClone(d), p0: p, grab };
    this.session.beginGesture();
    if (handle.kind !== 'opening-end') this.select(handle.kind === 'room' ? { kind: 'room', room: handle.room } : handle.kind === 'opening' ? { kind: 'opening', id: handle.id } : handle);
  }

  /** Velger noe og sier hva som er valgt. */
  select(sel: BuilderSelection): void {
    this.selection.set(sel);
    if (sel) this.message.set(this.describe(sel));
  }

  dragTo(raw: P2, tol: number, free = false): void {
    const g = this.drag;
    if (!g) return;
    const h = g.handle;
    const isFree = free || this.free.value;
    const restore = (d: BuilderDoc): void => {
      d.rooms = structuredClone(g.start.rooms);
      d.openings = structuredClone(g.start.openings);
    };
    if (h.kind === 'corner') {
      const s = snapPoint(g.start, raw, { tol, free: isFree, skipCorner: { room: h.room, i: h.i } });
      this.hover = { raw, snap: s, edge: null, target: null };
      this.session.apply((d) => {
        restore(d);
        moveCorner(d, h.room, h.i, s.p);
      });
    } else if (h.kind === 'edge') {
      const r = g.start.rooms.find((x) => x.id === h.room);
      const e = r ? edgesOf(r.polygon)[h.edge] : undefined;
      if (!e) return;
      const mid = alongEdge(e, e.length / 2);
      const raw0 = add(mid, scale(e.out, dot(sub(raw, g.p0), e.out)));
      const s = snapPoint(g.start, raw0, { tol, free: isFree, skipRoom: h.room });
      const delta = Math.round(dot(sub(s.p, mid), e.out));
      this.hover = { raw, snap: s, edge: null, target: null };
      this.session.apply((d) => {
        restore(d);
        moveEdge(d, h.room, h.edge, delta, true);
      });
      this.message.set(`Kanten flyttet ${delta > 0 ? 'ut' : 'inn'} ${formatLength(Math.abs(delta))}.`);
    } else if (h.kind === 'room') {
      const r = g.start.rooms.find((x) => x.id === h.room);
      if (!r) return;
      let dx = raw.x - g.p0.x;
      let dz = raw.z - g.p0.z;
      // Fest det hjørnet som kommer nærmest et mål.
      let bestS: SnapResult | null = null;
      let bestD = Infinity;
      for (const c of r.polygon) {
        const moved = { x: c.x + dx, z: c.z + dz };
        const s = snapPoint(g.start, moved, { tol, free: isFree, skipRoom: h.room });
        if (s.kind === 'rutenett' || s.kind === 'fri') continue;
        const dd = dist(s.p, moved);
        if (dd < bestD) [bestS, bestD] = [{ ...s, p: { x: s.p.x - c.x, z: s.p.z - c.z } }, dd];
      }
      if (bestS) [dx, dz] = [bestS.p.x, bestS.p.z];
      else if (!isFree) [dx, dz] = [Math.round(dx / 10) * 10, Math.round(dz / 10) * 10];
      this.session.apply((d) => {
        restore(d);
        moveRoom(d, h.room, dx, dz);
      });
    } else {
      const o0 = g.start.openings.find((x) => x.id === h.id);
      const r = o0 && g.start.rooms.find((x) => x.id === o0.room);
      const e = r ? edgesOf(r.polygon)[o0!.edge] : undefined;
      if (!o0 || !e) return;
      const s = edgeCoords(e, raw).s;
      const step = isFree ? 1 : 10;
      this.session.apply((d) => {
        restore(d);
        const o = d.openings.find((x) => x.id === h.id)!;
        const at = s - g.grab;
        if (h.kind === 'opening') o.offset = Math.round(Math.max(0, Math.min(e.length - o.width, at)) / step) * step;
        else if (h.end === 'start') {
          const end = o0.offset + o0.width;
          const start = Math.max(0, Math.min(end - 300, Math.round(at / step) * step));
          o.offset = start;
          o.width = end - start;
        } else o.width = Math.max(300, Math.min(e.length - o0.offset, Math.round(at / step) * step - o0.offset));
      });
    }
    this.bump();
  }

  endDrag(): void {
    if (!this.drag) return;
    this.drag = null;
    this.hover = null;
    this.session.endGesture();
    this.bump();
  }

  /* ---------------- handlinger fra panelet ---------------- */

  /** Kopierer valgt rom (med vinduer og dører), legger kopien inntil originalen og velger den. */
  copySelected(): boolean {
    const sel = this.selection.value;
    if (!sel || sel.kind === 'opening') return false;
    const made: { room: BRoom | null } = { room: null };
    this.session.apply((d) => {
      made.room = copyRoom(d, sel.room);
      return !!made.room;
    });
    const copy = made.room;
    if (!copy) return false;
    this.selection.set({ kind: 'room', room: copy.id });
    this.message.set(`Kopi: «${copy.name}», lagt inntil med skillevegg. Dra den dit den skal, eller skriv hvor langt den skal flyttes.`);
    return true;
  }

  /** Deler valgt rom i to med en skillevegg langs x = `at` (loddrett) eller z = `at` (vannrett). */
  splitSelected(axis: 'x' | 'z', at: number): boolean {
    const sel = this.selection.value;
    if (!sel || sel.kind === 'opening') return false;
    const res: { r: SplitResult | null } = { r: null };
    this.session.apply((d) => {
      res.r = splitRoom(d, sel.room, axis, at);
      return res.r.ok;
    });
    const r = res.r;
    if (!r) return false;
    if (!r.ok) {
      this.message.set(r.message);
      return false;
    }
    this.selection.set({ kind: 'room', room: r.b.id });
    const gap = this.doc?.settings.interiorThickness ?? 100;
    this.message.set(
      `Delt i «${r.a.name}» og «${r.b.name}» med ${formatLength(gap)} skillevegg.${r.dropped ? ` ${r.dropped} åpning${r.dropped > 1 ? 'er' : ''} som krysset skillet, ble fjernet.` : ''}`,
    );
    return true;
  }

  /** Dreier valgt rom 90° med klokka. */
  rotateSelected(): boolean {
    const sel = this.selection.value;
    if (!sel || sel.kind === 'opening') return false;
    const ok = this.session.apply((d) => rotateRoom90(d, sel.room));
    if (ok) this.message.set('Rommet er dreid 90° med klokka. Vinduer og dører fulgte med.');
    return ok;
  }

  /** Flytter valgt rom et bestemt stykke (mm). */
  moveSelectedBy(dx: number, dz: number): boolean {
    const sel = this.selection.value;
    if (!sel || sel.kind === 'opening' || (!dx && !dz)) return false;
    const ok = this.session.apply((d) => {
      moveRoom(d, sel.room, dx, dz);
      return true;
    });
    if (ok) this.message.set(`Rommet er flyttet ${formatLength(Math.hypot(dx, dz))}.`);
    return ok;
  }

  /** Ny tykkelse på skilleveggen langs valgt kant (naborommet flyttes). */
  setPartition(roomId: string, edge: number, thickness: number): boolean {
    let n = 0;
    this.session.apply((d) => {
      n = setPartitionThickness(d, roomId, edge, thickness);
      return n > 0;
    });
    this.message.set(n ? `Skilleveggen er nå ${formatLength(thickness)}. Naborommet ble flyttet.` : 'Skilleveggen har allerede den tykkelsen.');
    return n > 0;
  }

  deleteSelected(): boolean {
    const sel = this.selection.value;
    if (!sel) return false;
    let ok = false;
    this.session.apply((d) => {
      if (sel.kind === 'room') {
        removeRoom(d, sel.room);
        ok = true;
      } else if (sel.kind === 'opening') {
        d.openings = d.openings.filter((o) => o.id !== sel.id);
        ok = true;
      } else if (sel.kind === 'corner') ok = deleteCorner(d, sel.room, sel.i);
      return ok;
    });
    if (sel.kind === 'corner' && !ok) this.message.set('Et rom trenger minst 3 hjørner.');
    else if (ok) {
      this.selection.set(null);
      this.message.set(sel.kind === 'room' ? 'Rommet er slettet. «Angre» henter det tilbake.' : 'Slettet.');
    } else if (sel.kind === 'edge') this.message.set('Velg et hjørne, et rom eller en åpning for å slette.');
    return ok;
  }

  /**
   * Flytter det som er valgt med piltastene: hjørne og rom i planet, en kant
   * vinkelrett ut/inn (naborommet følger med) og en åpning langs veggen.
   */
  nudge(dx: number, dz: number): boolean {
    const sel = this.selection.value;
    const d0 = this.doc;
    if (!sel || !d0) return false;
    const ok = this.session.apply((d) => {
      if (sel.kind === 'corner') {
        const p = d.rooms.find((r) => r.id === sel.room)?.polygon[sel.i];
        if (!p) return false;
        moveCorner(d, sel.room, sel.i, { x: p.x + dx, z: p.z + dz });
      } else if (sel.kind === 'room') moveRoom(d, sel.room, dx, dz);
      else if (sel.kind === 'edge') {
        const r = d.rooms.find((x) => x.id === sel.room);
        const e = r ? edgesOf(r.polygon)[sel.edge] : undefined;
        const delta = e ? Math.round(dx * e.out.x + dz * e.out.z) : 0;
        if (!delta) return false;
        moveEdge(d, sel.room, sel.edge, delta, true);
      } else {
        const o = d.openings.find((x) => x.id === sel.id);
        const seg = o && this.openingSegment(o);
        if (!o || !seg) return false;
        const along = Math.round(dx * seg.edge.u.x + dz * seg.edge.u.z);
        const next = Math.max(0, Math.min(seg.edge.length - o.width, o.offset + along));
        if (next === o.offset) return false;
        o.offset = next;
      }
      return true;
    });
    if (ok) this.message.set(this.describe(sel));
    return ok;
  }

  /** Området (mm) det valgte (eller et rom/en åpning) dekker – for «Vis». */
  boundsOf(target: { kind: 'room' | 'opening'; id: string }): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
    const d = this.doc;
    if (!d) return null;
    let pts: P2[] = [];
    if (target.kind === 'room') pts = d.rooms.find((r) => r.id === target.id)?.polygon ?? [];
    else {
      const o = d.openings.find((x) => x.id === target.id);
      const seg = o && this.openingSegment(o);
      if (seg) pts = [seg.a, seg.b];
    }
    if (!pts.length) return null;
    const xs = pts.map((p) => p.x);
    const zs = pts.map((p) => p.z);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  }

  /** Nytt hjørne midt på valgt kant. */
  splitSelectedEdge(): boolean {
    const sel = this.selection.value;
    if (sel?.kind !== 'edge') return false;
    let i = -1;
    this.session.apply((d) => {
      i = insertCorner(d, sel.room, sel.edge);
      return i >= 0;
    });
    if (i >= 0) {
      this.selection.set({ kind: 'corner', room: sel.room, i });
      this.message.set('Nytt hjørne midt på kanten. Dra det dit det skal.');
    }
    return i >= 0;
  }

  /** Angre (og si fra, så meldingen ikke viser det som ble angret). */
  undo(): boolean {
    const ok = this.session.undo();
    this.message.set(ok ? 'Angret.' : 'Ingenting å angre.');
    return ok;
  }

  redo(): boolean {
    const ok = this.session.redo();
    this.message.set(ok ? 'Gjort om.' : 'Ingenting å gjøre om.');
    return ok;
  }

  /** Retter opp valgt rom (eller alle). */
  straighten(all: boolean): void {
    const sel = this.selection.value;
    this.straightenRooms(all || !sel || sel.kind === 'opening' ? undefined : [sel.room]);
  }

  /** Retter opp bestemte rom (alle: `undefined`). `tolDeg`: hvor skjeve kanter som rettes (standard 4°). */
  straightenRooms(ids?: string[], tolDeg?: number): void {
    let n = 0;
    this.session.apply((d) => {
      n = straighten(d, ids, tolDeg);
      return n > 0;
    });
    this.message.set(n ? 'Rettet opp: vinklene er rette, og nesten like linjer ligger på linje.' : 'Alt var allerede rett.');
  }

  describe(sel: NonNullable<BuilderSelection>): string {
    const d = this.doc!;
    if (sel.kind === 'opening') {
      const o = d.openings.find((x) => x.id === sel.id);
      return o ? `Valgt: ${o.type === 'door' ? (o.entrance ? 'inngangsdør' : 'dør') : o.type === 'window' ? 'vindu' : 'åpning'}, ${formatLength(o.width)} bred.` : '';
    }
    const r = d.rooms.find((x) => x.id === sel.room);
    if (!r) return '';
    if (sel.kind === 'corner') return `Valgt: hjørne ${sel.i + 1} i «${r.name}». Dra det, eller slett det.`;
    if (sel.kind === 'edge') {
      const e = edgesOf(r.polygon)[sel.edge];
      return `Valgt: kant ${sel.edge + 1} i «${r.name}», ${formatLength(e?.length ?? 0)}. Dra for å flytte veggen.`;
    }
    return `Valgt: «${r.name}».`;
  }
}
