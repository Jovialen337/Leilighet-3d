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
  /** Øker ved hver endring (for mellomlagring hos den som bruker endringene). */
  revision = 0;
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

  /**
   * Fila med bare de endringene som passer (gir en gyldig modell), og listen
   * over dem som ikke passer akkurat nå. Ingenting slettes: blir modellen
   * gyldig for dem igjen (f.eks. når en måling angres), vises de igjen.
   */
  split(
    base: ApartmentDoc,
    isValid: (doc: ApartmentDoc) => boolean,
    /** De som ikke passet sist: prøves først for seg, så det holder med få valideringer. */
    hint: readonly PlanOp[] = [],
  ): { doc: ApartmentDoc; hidden: PlanOp[] } {
    const all = this.apply(base);
    if (!this.ops.length || isValid(all)) return { doc: all, hidden: [] };
    const quick = this.splitWithHint(base, isValid, hint);
    if (quick) return quick;
    const hidden: PlanOp[] = [];
    let doc = base;
    for (const op of this.ops) {
      const next = applyOps(doc, [op]);
      if (isValid(next)) doc = next;
      else hidden.push(op);
    }
    return { doc, hidden };
  }

  /**
   * Rask vei når de som ikke passet sist er kjent: resten legges inn samlet, og
   * de kjente prøves én og én oppå. Brukes bare når ingen andre endringer
   * gjelder de samme objektene (så en sletting aldri overstyres). Resultatet er
   * alltid gyldig, men kan vise flere enn gjennomgangen i rekkefølge, som
   * prøver hver endring mot det som kom før (f.eks. en kabel på en kurs som
   * lages senere).
   */
  private splitWithHint(
    base: ApartmentDoc,
    isValid: (doc: ApartmentDoc) => boolean,
    hint: readonly PlanOp[],
  ): { doc: ApartmentDoc; hidden: PlanOp[] } | null {
    const inHint = new Set(hint.filter((o) => this.ops.includes(o)));
    if (!inHint.size) return null;
    const hintKeys = new Set([...inHint].map(keyOf));
    const rest = this.ops.filter((o) => !inHint.has(o));
    if (rest.some((o) => hintKeys.has(keyOf(o)))) return null;
    let doc = applyOps(base, rest);
    if (!isValid(doc)) return null;
    const hidden: PlanOp[] = [];
    for (const op of this.ops) {
      if (!inHint.has(op)) continue;
      const next = applyOps(doc, [op]);
      if (isValid(next)) doc = next;
      else hidden.push(op);
    }
    return { doc, hidden };
  }

  /** Fjerner bestemte endringer (f.eks. de som ikke passer, etter «Forkast»). */
  removeOps(ops: readonly PlanOp[]): void {
    if (!ops.length) return;
    const drop = new Set(ops);
    this.ops = this.ops.filter((o) => !drop.has(o));
    this.changed();
  }

  /**
   * Ny grunnfil (lastet på nytt): fjerner det fila allerede har. Varsler ikke
   * lytterne – den som laster, tegner modellen på nytt uansett.
   */
  rebase(base: ApartmentDoc): void {
    const before = this.ops.length;
    if (!before) return;
    this.ops = this.prune(base);
    if (!this.ops.length) this.published = true;
    if (this.ops.length !== before) this.save();
  }

  get size(): number {
    return this.ops.length;
  }

  /** Antall objekter som er endret (lagt til, endret eller fjernet). */
  get changedObjects(): number {
    return new Set(this.ops.map(keyOf)).size;
  }

  put(c: PlanCollection, obj: PlanObject): void {
    this.add([{ op: 'put', c, obj }]);
  }

  remove(c: PlanCollection, id: string): void {
    this.add([{ op: 'del', c, id }]);
  }

  /** Flere endringer på én gang (lytterne varsles én gang). */
  add(ops: readonly PlanOp[]): void {
    if (!ops.length) return;
    for (const o of ops) this.ops.push(o.op === 'put' ? { op: 'put', c: o.c, obj: structuredClone(o.obj) } : { ...o });
    this.changed();
  }

  /**
   * Angrer siste endring. `skip` hopper over endringer (f.eks. tegninger som
   * ikke vises nå), så «Angre» aldri sletter noe man ikke ser.
   */
  undo(skip: (op: PlanOp) => boolean = () => false): PlanOp | null {
    for (let i = this.ops.length - 1; i >= 0; i--) {
      const op = this.ops[i]!;
      if (skip(op)) continue;
      this.ops.splice(i, 1);
      this.changed();
      return op;
    }
    return null;
  }

  clear(): void {
    this.ops = [];
    this.published = false;
    this.changed();
  }

  /** Fila med endringene lagt inn (originalen endres ikke). */
  apply(doc: ApartmentDoc): ApartmentDoc {
    return applyOps(doc, this.ops);
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
      const k = keyOf(o);
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
    this.save();
    for (const l of this.listeners) l();
  }

  private save(): void {
    this.revision++;
    try {
      if (this.ops.length) this.storage?.setItem(this.key, JSON.stringify({ version: 1, ops: this.ops }));
      else this.storage?.removeItem(this.key);
    } catch {
      /* full eller utilgjengelig lagring: endringene finnes fortsatt i minnet */
    }
  }
}

/** Hvilket objekt en endring gjelder («samling:id»). */
const keyOf = (o: PlanOp): string => `${o.c}:${o.op === 'put' ? o.obj.id : o.id}`;

/** Legger endringene inn i en kopi av fila. */
export function applyOps(doc: ApartmentDoc, ops: readonly PlanOp[]): ApartmentDoc {
  if (!ops.length) return doc;
  const out = structuredClone(doc);
  const lists = out as unknown as DocLists;
  for (const o of ops) {
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

function isOp(v: unknown): v is PlanOp {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  const cOk = o.c === 'wiring' || o.c === 'pipes' || o.c === 'fixtures' || o.c === 'circuits' || o.c === 'layers';
  if (!cOk) return false;
  if (o.op === 'put') return !!o.obj && typeof o.obj === 'object' && typeof (o.obj as { id?: unknown }).id === 'string';
  return o.op === 'del' && typeof o.id === 'string';
}
