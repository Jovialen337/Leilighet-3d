/**
 * Tegneverktøyet for el og vann, felles for PC og Quest. Tar imot «klikk» i
 * planet (fra mus i 2D/3D eller fra strålen i VR), fester punktene, bygger
 * kabel-/rørstrekket og lagrer ferdige objekter som lokale planendringer.
 */
import type { ApartmentModel } from '../model/ApartmentModel';
import type { ApartmentDoc } from '../schema/types';
import { Observable } from '../state/Observable';
import type { P2 } from '../geometry/math2d';
import {
  DEFAULT_OPTIONS,
  FIXTURE_TEXT,
  LAYER_NAMES,
  PIPE_KIND_TEXT,
  RunDraft,
  WIRE_KIND_TEXT,
  layerFor,
  makeFixture,
  makeRun,
  metres,
  pickNearest,
  resolveHeight,
  runLength,
  snapPlan,
  type DrawOptions,
  type DrawTool,
  type Snap,
} from './draw';
import type { PlanEdits } from './PlanEdits';

export interface Selection {
  c: 'wiring' | 'pipes' | 'fixtures';
  id: string;
}

/** Farger for nye kurser (går i ring). */
const CIRCUIT_COLORS = ['#d35400', '#2980b9', '#27ae60', '#8e44ad', '#c0392b', '#16a085', '#f39c12', '#7f8c8d'];

export class PlanController {
  readonly options = new Observable<DrawOptions>({ ...DEFAULT_OPTIONS });
  readonly draft = new RunDraft();
  readonly selected = new Observable<Selection | null>(null);
  /** Kort beskjed på norsk (vises i panelet og i VR). */
  readonly message = new Observable<string>('');
  /** Endres hver gang utkastet (punktene under tegning) endres. */
  readonly draftVersion = new Observable(0);
  /** Siste festepunkt under pekeren/strålen (for forhåndsvisning). */
  hover: { p: P2; h: number; snap: Snap['kind'] } | null = null;

  constructor(
    readonly edits: PlanEdits,
    private readonly getModel: () => ApartmentModel | null,
    private readonly getBase: () => ApartmentDoc | null,
  ) {
    this.options.subscribe((o, prev) => {
      if (o.tool !== prev.tool) {
        this.cancel();
        this.selected.set(null);
        this.message.set(this.toolHint());
      }
    });
  }

  get tool(): DrawTool {
    return this.options.value.tool;
  }

  get drawing(): boolean {
    return this.draft.points.length > 0;
  }

  set(patch: Partial<DrawOptions>): void {
    this.options.set({ ...this.options.value, ...patch });
  }

  toolHint(): string {
    switch (this.tool) {
      case 'wire':
      case 'pipe':
        return 'Klikk punkt for punkt. Klikk siste punkt igjen (eller «Ferdig») for å avslutte.';
      case 'fixture':
        return 'Klikk på en vegg for å sette punktet der (lamper og sluk settes fritt).';
      default:
        return 'Klikk på en kabel, et rør eller et punkt for å velge det.';
    }
  }

  /** Fester et punkt (tol i mm). `h` = høyde over gulv; uten den brukes valgt høyde. */
  snap(p: P2, tol: number, free = false): Snap {
    const model = this.getModel();
    if (!model) return { p, kind: 'fri' };
    const last = this.draft.last;
    if (!free)
      for (const q of this.draft.points)
        if (Math.hypot(q[0] - p.x, q[2] - p.z) < tol) return { p: { x: q[0], z: q[2] }, kind: 'punkt' };
    return snapPlan(model, p, { prev: last ? { x: last[0], z: last[2] } : null, tol, free });
  }

  /** Oppdaterer forhåndsvisningen under pekeren. */
  hoverAt(p: P2 | null, tol: number, h?: number, free = false): void {
    const model = this.getModel();
    if (!p || !model || this.tool === 'select') {
      this.hover = null;
      return;
    }
    const s = this.snap(p, tol, free);
    this.hover = { p: s.p, h: h ?? resolveHeight(model, s.p, this.options.value.height), snap: s.kind };
  }

  /** Et klikk/avtrekk i planet. */
  click(p: P2, tol: number, h?: number, free = false): void {
    const model = this.getModel();
    const base = this.getBase();
    if (!model || !base) return;
    const o = this.options.value;
    if (o.tool === 'select') {
      const hit = pickNearest(model, p, tol);
      this.selected.set(hit ? { c: hit.c, id: hit.id } : null);
      this.message.set(hit ? this.describe(model, hit) : 'Ingenting her. Klikk nærmere en kabel, et rør eller et punkt.');
      return;
    }
    const s = this.snap(p, tol, free);
    const height = h ?? resolveHeight(model, s.p, o.height);
    if (o.tool === 'fixture') {
      const id = this.edits.newId(base, o.fixtureType === 'outlet' ? 'stk' : o.fixtureType);
      const obj = makeFixture(model, id, s.p, o, h);
      this.ensureLayer(String(obj.layer));
      this.edits.put('fixtures', obj);
      this.message.set(`${FIXTURE_TEXT[o.fixtureType] ?? 'Punkt'} satt inn (${obj.mount ? 'på vegg' : 'fritt'}).`);
      return;
    }
    // Kabel/rør: klikk på siste punkt igjen = ferdig.
    const last = this.draft.last;
    if (last && Math.hypot(last[0] - s.p.x, last[2] - s.p.z) < 1 && Math.abs(last[1] - height) < 1 && this.draft.points.length >= 2) {
      this.finish();
      return;
    }
    this.draft.add(s.p, height);
    this.bump();
    this.message.set(`${this.draft.points.length} punkt · ${metres(this.draft.length)}. Klikk siste punkt igjen eller «Ferdig» for å avslutte.`);
  }

  /** Avslutter kabelen/røret og lagrer det. */
  finish(): boolean {
    const base = this.getBase();
    const o = this.options.value;
    if (!base || (o.tool !== 'wire' && o.tool !== 'pipe')) return false;
    if (this.draft.points.length < 2) {
      this.message.set('Et strekk trenger minst to punkter.');
      return false;
    }
    const what = o.tool === 'wire' ? 'wire' : 'pipe';
    const id = this.edits.newId(base, what === 'wire' ? 'kabel' : 'ror');
    const obj = makeRun(what, id, this.draft.points, o);
    this.ensureLayer(String(obj.layer));
    const len = this.draft.length;
    this.edits.put(what === 'wire' ? 'wiring' : 'pipes', obj);
    this.draft.clear();
    this.bump();
    const kind = what === 'wire' ? `Kabel (${WIRE_KIND_TEXT[o.wireKind].toLowerCase()})` : PIPE_KIND_TEXT[o.pipeKind];
    this.message.set(`${kind} lagt inn: ${metres(len)}.`);
    return true;
  }

  undoPoint(): void {
    this.draft.undo();
    this.bump();
  }

  cancel(): void {
    if (!this.draft.points.length) return;
    this.draft.clear();
    this.bump();
    this.message.set('Avbrutt.');
  }

  /** Angre: først punkter under tegning, ellers siste lagrede endring. */
  undo(): void {
    if (this.drawing) {
      this.undoPoint();
      this.message.set('Punkt fjernet.');
      return;
    }
    const op = this.edits.undo();
    this.message.set(op ? 'Angret.' : 'Ingenting å angre.');
  }

  deleteSelected(): boolean {
    const sel = this.selected.value;
    if (!sel) return false;
    this.edits.remove(sel.c, sel.id);
    this.selected.set(null);
    this.message.set('Slettet. «Angre» henter det tilbake.');
    return true;
  }

  /** Legger til en ny kurs og velger den. */
  addCircuit(name: string, fuse?: number): string | null {
    const base = this.getBase();
    if (!base || !name.trim()) return null;
    const id = this.edits.newId(base, 'kurs');
    const n = (this.edits.apply(base).circuits ?? []).length;
    this.edits.put('circuits', {
      id,
      name: name.trim(),
      ...(fuse && fuse > 0 ? { fuse } : {}),
      color: CIRCUIT_COLORS[n % CIRCUIT_COLORS.length]!,
    });
    this.set({ circuit: id });
    return id;
  }

  /** Lengden av strekket under tegning, inkludert linjen til pekeren. */
  liveLength(): number {
    const pts = [...this.draft.points];
    if (this.hover) pts.push([this.hover.p.x, this.hover.h, this.hover.p.z]);
    return runLength(pts);
  }

  private ensureLayer(id: string): void {
    const model = this.getModel();
    if (!model || model.layers.has(id)) return;
    this.edits.put('layers', { id, name: LAYER_NAMES[id] ?? id, visible: true });
  }

  private describe(model: ApartmentModel, hit: Selection): string {
    if (hit.c === 'fixtures') {
      const fx = model.data.fixtures.find((f) => f.id === hit.id);
      return `Valgt: ${fx?.name ?? FIXTURE_TEXT[fx?.type ?? 'outlet'] ?? 'punkt'} (${fx?.status === 'planned' ? 'planlagt' : 'eksisterende'}).`;
    }
    const run = hit.c === 'wiring' ? model.data.wiring.find((w) => w.id === hit.id) : model.data.pipes?.find((r) => r.id === hit.id);
    if (!run) return 'Valgt.';
    const len = runLength(run.points as [number, number, number][]);
    const what = hit.c === 'wiring' ? 'Kabel' : PIPE_KIND_TEXT[(run as { kind: keyof typeof PIPE_KIND_TEXT }).kind];
    return `Valgt: ${run.name ?? what} – ${metres(len)} (${run.status === 'planned' ? 'planlagt' : 'eksisterende'}).`;
  }

  private bump(): void {
    this.draftVersion.set(this.draftVersion.value + 1);
  }
}

export { layerFor };
