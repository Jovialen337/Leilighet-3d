/**
 * Lokale planendringer (el og vann) oppå apartment.json.
 *
 * Hver endring er «legg inn/erstatt objekt» eller «fjern objekt» i en av
 * samlingene i fila. Endringene lagres i nettleseren og kan angres. De tas med
 * når fila lastes ned/eksporteres, og forsvinner av seg selv når den
 * publiserte fila allerede inneholder dem.
 */
import type { ApartmentDoc } from '../schema/types';
import type { KV } from '../state/persist';

export type PlanCollection = 'wiring' | 'pipes' | 'fixtures' | 'circuits' | 'layers';
export type PlanObject = { id: string } & Record<string, unknown>;

export type PlanOp =
  | { op: 'put'; c: PlanCollection; obj: PlanObject }
  | { op: 'del'; c: PlanCollection; id: string };

export const PLAN_KEY = 'leilighet:plan:v1';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

type DocLists = Record<PlanCollection, PlanObject[] | undefined>;

export class PlanEdits {
  ops: PlanOp[] = [];
  /** Endringene som lå lagret, er nå med i fila. */
  published = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    base: ApartmentDoc | null,
    private readonly storage: KV | null = null,
    private readonly key = PLAN_KEY,
  ) {
    try {
      const text = storage?.getItem(key);
      const saved = text ? (JSON.parse(text) as { version?: number; ops?: unknown }) : null;
      if (saved?.version === 1 && Array.isArray(saved.ops)) this.ops = saved.ops.filter(isOp);
    } catch {
      this.ops = [];
    }
    if (base && this.ops.length) {
      const before = this.ops.length;
      this.ops = this.prune(base);
      if (!this.ops.length) this.published = true;
      if (this.ops.length !== before) this.save();
    }
  }

  /** Endringer som ikke passet med fila (lagt til side, kan forkastes). */
  get staleCount(): number {
    try {
      const t = this.storage?.getItem(`${this.key}:gammel`);
      const ops = t ? (JSON.parse(t) as { ops?: unknown[] }).ops : null;
      return Array.isArray(ops) ? ops.length : 0;
    } catch {
      return 0;
    }
  }

  discardStale(): void {
    try {
      this.storage?.removeItem(`${this.key}:gammel`);
    } catch {
      /* lagring utilgjengelig */
    }
    for (const l of this.listeners) l();
  }

  /**
   * Beholder bare endringene som gir en gyldig fil (i rekkefølge). De andre
   * fjernes – eller legges til side (`setAside`), f.eks. når fila er byttet ut
   * og en vegg en tegning hang på, er borte. Returnerer antall som ble tatt ut.
   */
  keepValid(base: ApartmentDoc, isValid: (doc: ApartmentDoc) => boolean, setAside: boolean): number {
    const kept: PlanOp[] = [];
    const out: PlanOp[] = [];
    for (const op of this.ops) {
      const all = this.ops;
      this.ops = [...kept, op];
      const ok = isValid(this.apply(base));
      this.ops = all;
      (ok ? kept : out).push(op);
    }
    if (!out.length) return 0;
    this.ops = kept;
    if (setAside) {
      try {
        const prev = this.staleCount ? (JSON.parse(this.storage!.getItem(`${this.key}:gammel`)!) as { ops: PlanOp[] }).ops : [];
        this.storage?.setItem(`${this.key}:gammel`, JSON.stringify({ version: 1, ops: [...prev, ...out] }));
      } catch {
        /* lagring utilgjengelig */
      }
    }
    this.changed();
    return out.length;
  }

  /** Ny grunnfil (lastet på nytt): fjerner det fila allerede har. */
  rebase(base: ApartmentDoc): void {
    const before = this.ops.length;
    if (!before) return;
    this.ops = this.prune(base);
    if (!this.ops.length) this.published = true;
    if (this.ops.length !== before) this.changed();
  }

  get size(): number {
    return this.ops.length;
  }

  /** Antall objekter som er endret (lagt til, endret eller fjernet). */
  get changedObjects(): number {
    return new Set(this.ops.map((o) => `${o.c}:${o.op === 'put' ? o.obj.id : o.id}`)).size;
  }

  put(c: PlanCollection, obj: PlanObject): void {
    this.ops.push({ op: 'put', c, obj: structuredClone(obj) });
    this.changed();
  }

  remove(c: PlanCollection, id: string): void {
    this.ops.push({ op: 'del', c, id });
    this.changed();
  }

  undo(): PlanOp | null {
    const op = this.ops.pop() ?? null;
    if (op) this.changed();
    return op;
  }

  clear(): void {
    this.ops = [];
    this.published = false;
    this.changed();
  }

  /** Fila med endringene lagt inn (originalen endres ikke). */
  apply(doc: ApartmentDoc): ApartmentDoc {
    if (!this.ops.length) return doc;
    const out = structuredClone(doc);
    const lists = out as unknown as DocLists;
    for (const o of this.ops) {
      const list = (lists[o.c] ??= []);
      if (o.op === 'put') {
        const i = list.findIndex((x) => x.id === o.obj.id);
        if (i >= 0) list[i] = structuredClone(o.obj);
        else list.push(structuredClone(o.obj));
      } else {
        const i = list.findIndex((x) => x.id === o.id);
        if (i >= 0) list.splice(i, 1);
      }
    }
    return out;
  }

  /** En id som ikke er i bruk i fila eller i endringene. */
  newId(doc: ApartmentDoc, prefix: string): string {
    const used = new Set<string>();
    const d = this.apply(doc) as unknown as Record<string, unknown>;
    for (const v of Object.values(d)) if (Array.isArray(v)) for (const x of v) if (x && typeof x === 'object' && 'id' in x) used.add(String((x as { id: unknown }).id));
    let i = 1;
    while (used.has(`${prefix}-${i}`)) i++;
    return `${prefix}-${i}`;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Slår sammen loggen til én endring per objekt og fjerner det fila allerede har. */
  private prune(base: ApartmentDoc): PlanOp[] {
    const last = new Map<string, PlanOp>();
    for (const o of this.ops) {
      const k = `${o.c}:${o.op === 'put' ? o.obj.id : o.id}`;
      last.delete(k);
      last.set(k, o);
    }
    const lists = base as unknown as DocLists;
    return [...last.values()].filter((o) => {
      const list = lists[o.c] ?? [];
      if (o.op === 'put') return !same(list.find((x) => x.id === o.obj.id), o.obj);
      return list.some((x) => x.id === o.id);
    });
  }

  private changed(): void {
    try {
      if (this.ops.length) this.storage?.setItem(this.key, JSON.stringify({ version: 1, ops: this.ops }));
      else this.storage?.removeItem(this.key);
    } catch {
      /* full eller utilgjengelig lagring: endringene finnes fortsatt i minnet */
    }
    for (const l of this.listeners) l();
  }

  private save(): void {
    try {
      if (this.ops.length) this.storage?.setItem(this.key, JSON.stringify({ version: 1, ops: this.ops }));
      else this.storage?.removeItem(this.key);
    } catch {
      /* lagring utilgjengelig */
    }
  }
}

function isOp(v: unknown): v is PlanOp {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  const cOk = o.c === 'wiring' || o.c === 'pipes' || o.c === 'fixtures' || o.c === 'circuits' || o.c === 'layers';
  if (!cOk) return false;
  if (o.op === 'put') return !!o.obj && typeof o.obj === 'object' && typeof (o.obj as { id?: unknown }).id === 'string';
  return o.op === 'del' && typeof o.id === 'string';
}
