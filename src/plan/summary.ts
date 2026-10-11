/**
 * Oversikt over el- og vannplanen: lengder per kurs og rørtype, antall punkter,
 * en enkel materialliste for det som er planlagt, og veiledende hint.
 *
 * Hintene er veiledning, ikke prosjektering: fast el-installasjon skal gjøres
 * av registrert elektrovirksomhet, og vann/avløp av rørlegger.
 */
import type { ApartmentModel } from '../model/ApartmentModel';
import { p2 } from '../geometry/math2d';
import type { FixtureType, PipeKind, Status, WireKind } from '../schema/types';
import { FIXTURE_TEXT, PIPE_KIND_TEXT, WIRE_KIND_TEXT, metres, runLength } from './draw';

export interface CircuitSummary {
  id: string | null;
  name: string;
  fuse?: number;
  /** Kabellengde (mm), med stigninger. */
  length: number;
  outlets: number;
  switches: number;
  lights: number;
  other: number;
}

export interface PlanSummary {
  circuits: CircuitSummary[];
  pipes: { kind: PipeKind; length: number; planned: number }[];
  /** Kabellengde per type (strøm, lys, data …), mm. */
  cables: { kind: WireKind; length: number }[];
  water: Partial<Record<FixtureType, number>>;
  materials: string[];
  hints: string[];
}

/** Tillegg på kabel og rør for kapp og tilkobling. */
export const MARGIN = 0.1;

export function summarize(model: ApartmentModel, include: { existing: boolean } = { existing: false }): PlanSummary {
  const d = model.data;
  const take = (s: Status): boolean => s === 'planned' || include.existing;

  const byCircuit = new Map<string | null, CircuitSummary>();
  const circ = (id: string | null): CircuitSummary => {
    let c = byCircuit.get(id);
    if (!c) {
      const def = id ? d.circuits?.find((k) => k.id === id) : undefined;
      c = { id, name: def?.name ?? (id ? id : 'Uten kurs'), length: 0, outlets: 0, switches: 0, lights: 0, other: 0 };
      if (def?.fuse !== undefined) c.fuse = def.fuse;
      byCircuit.set(id, c);
    }
    return c;
  };
  for (const k of d.circuits ?? []) circ(k.id);
  const cableMap = new Map<WireKind, number>();
  for (const w of d.wiring) {
    if (!take(w.status)) continue;
    const l = runLength(w.points);
    circ(w.circuit ?? null).length += l;
    const kind = w.kind ?? 'other';
    cableMap.set(kind, (cableMap.get(kind) ?? 0) + l);
  }
  const cables = [...cableMap].map(([kind, length]) => ({ kind, length })).filter((c) => c.length > 0);
  const water: Partial<Record<FixtureType, number>> = {};
  for (const fx of d.fixtures) {
    if (!take(fx.status)) continue;
    if (fx.type === 'tap' || fx.type === 'drain' || fx.type === 'valve' || fx.type === 'waterheater') {
      water[fx.type] = (water[fx.type] ?? 0) + 1;
      continue;
    }
    if (fx.type !== 'outlet' && fx.type !== 'switch' && fx.type !== 'light' && fx.type !== 'junction') continue;
    const c = circ(fx.circuit ?? null);
    if (fx.type === 'outlet') c.outlets++;
    else if (fx.type === 'switch') c.switches++;
    else if (fx.type === 'light') c.lights++;
    else c.other++;
  }
  const circuits = [...byCircuit.values()].filter((c) => c.length > 0 || c.outlets + c.switches + c.lights + c.other > 0 || c.id !== null);

  const pipeMap = new Map<PipeKind, { kind: PipeKind; length: number; planned: number }>();
  for (const r of d.pipes ?? []) {
    const e = pipeMap.get(r.kind) ?? { kind: r.kind, length: 0, planned: 0 };
    const l = runLength(r.points);
    if (take(r.status)) e.length += l;
    if (r.status === 'planned') e.planned += l;
    pipeMap.set(r.kind, e);
  }
  const pipes = [...pipeMap.values()].filter((p) => p.length > 0);

  // Materialliste (planlagt).
  const materials: string[] = [];
  for (const c of cables)
    materials.push(`Kabel – ${WIRE_KIND_TEXT[c.kind].toLowerCase()}: ${metres(c.length * (1 + MARGIN))} (inkl. ${MARGIN * 100} % tillegg)`);
  for (const p of pipes) materials.push(`${PIPE_KIND_TEXT[p.kind]}: ${metres(p.length * (1 + MARGIN))} rør`);
  const boxes = circuits.reduce((s, c) => s + c.outlets + c.switches + c.other, 0);
  if (boxes > 0) materials.push(`Veggbokser: ${boxes} stk`);
  const count = (t: FixtureType): number => d.fixtures.filter((f) => f.type === t && take(f.status)).length;
  for (const t of ['outlet', 'switch', 'light', 'tap', 'drain', 'valve'] as const) {
    const n = count(t);
    if (n) materials.push(`${FIXTURE_TEXT[t]}: ${n} stk`);
  }

  return { circuits, pipes, cables, water, materials, hints: planHints(model) };
}

/** Minste fall for avløp som veiledning (1:60). */
export const DRAIN_FALL = 1 / 60;

/**
 * Om et rør faller minst `ratio` på hvert vannrette strekk, i retning mot den
 * laveste enden. Loddrette strekk (stigninger) teller ikke.
 */
export function hasFall(points: readonly (readonly [number, number, number])[], ratio: number): boolean {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const dir = first[1] >= last[1] ? 1 : -1; // 1 = renner fra første mot siste punkt
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const horiz = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (horiz < 300) continue;
    if ((a[1] - b[1]) * dir < horiz * ratio) return false;
  }
  return true;
}

/** Veiledende sjekker (ikke regler). */
export function planHints(model: ApartmentModel): string[] {
  const d = model.data;
  const hints: string[] = [];
  // Skjult kabel i vegg bør gå loddrett eller vannrett.
  for (const w of d.wiring) {
    for (let i = 1; i < w.points.length; i++) {
      const a = w.points[i - 1]!;
      const b = w.points[i]!;
      const horiz = Math.hypot(b[0] - a[0], b[2] - a[2]);
      const vert = Math.abs(b[1] - a[1]);
      if (horiz > 50 && vert > 50) {
        hints.push(`Kabel «${w.name ?? w.id}» har et skrått strekk. Skjult kabel i vegg bør gå loddrett eller vannrett.`);
        break;
      }
    }
  }
  // Avløp skal ha fall mot den laveste enden (uansett hvilken vei det ble tegnet).
  for (const r of d.pipes ?? []) {
    if (r.kind !== 'drain' || r.points.length < 2) continue;
    if (!hasFall(r.points, DRAIN_FALL))
      hints.push(`Avløp «${r.name ?? r.id}» har for lite fall (ofte minst 1:60 – sjekk med rørlegger).`);
  }
  // Stikkontakter i oppholdsrom: omtrent 2 per påbegynte 4 m² (sjekk gjeldende norm).
  for (const info of model.rooms.values()) {
    const n = d.fixtures.filter((f) => {
      if (f.type !== 'outlet') return false;
      const pl = model.fixturePlacement(f);
      if (!pl) return false;
      if (f.mount?.room) return f.mount.room === info.room.id;
      return model.roomAt(p2(pl.x, pl.z))?.room.id === info.room.id;
    }).length;
    const m2 = info.area / 1e6;
    const want = 2 * Math.ceil(m2 / 4);
    if (/stue|soverom|kontor/i.test(info.room.name) && n < want)
      hints.push(`${info.room.name}: ${n} stikkontakter. Veiledning for oppholdsrom er rundt ${want} for ${m2.toFixed(1).replace('.', ',')} m².`);
  }
  return hints;
}

export const DISCLAIMER =
  'Veiledning, ikke prosjektering. Fast el-installasjon skal utføres av registrert elektrovirksomhet. Vann og avløp: bruk rørlegger.';

/** Teksten til «Kopier» (enkel liste). */
export function summaryText(s: PlanSummary): string {
  const lines = ['Plan for el og vann', ''];
  for (const c of s.circuits)
    lines.push(
      `${c.name}${c.fuse ? ` (${c.fuse} A)` : ''}: kabel ${metres(c.length)}, ${c.outlets} stikkontakter, ${c.switches} brytere, ${c.lights} lamper`,
    );
  for (const c of s.cables) lines.push(`Kabel – ${WIRE_KIND_TEXT[c.kind].toLowerCase()}: ${metres(c.length)}`);
  for (const p of s.pipes) lines.push(`${PIPE_KIND_TEXT[p.kind]}: ${metres(p.length)}`);
  if (s.materials.length) lines.push('', 'Materialliste (planlagt):', ...s.materials.map((m) => `- ${m}`));
  if (s.hints.length) lines.push('', 'Hint:', ...s.hints.map((h) => `- ${h}`));
  lines.push('', DISCLAIMER);
  return lines.join('\n');
}
