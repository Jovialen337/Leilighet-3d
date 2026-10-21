/**
 * «Neste steg»: hva brukeren bør gjøre nå, ut fra tilstanden i appen. Ren
 * funksjon (testbar): samme svar i startmenyen, øverst i panelet og i VR.
 * Det viktigste først – en feil som stopper alt, så ting som ellers går tapt
 * (endringer som bare finnes i nettleseren), så det som tar arbeidet videre.
 */

export type NextAction = 'builder' | 'download' | 'upload' | 'stale' | 'measure' | 'highlight' | 'draw' | 'vr';

export interface NextStepState {
  /** apartment.json kunne ikke vises. */
  loadError: boolean;
  /** «Lag ny modell»: navn, feil som må rettes, og om den er lastet ned. */
  builder: { name: string; rooms: number; errors: number; exported: boolean } | null;
  /** Oppmålingen: målinger, framdrift, gamle målinger og om utkastet er lastet ned. */
  measure: { measurements: number; done: number; total: number; stale: number; exported: boolean } | null;
  /** Tegnede endringer (el og vann) som bare finnes i nettleseren. */
  planEdits: number;
  /** Deler i fila som er plassholdere (ikke målt), og alle delene. */
  placeholders: number;
  parts: number;
  /** Planlagt el eller vann i fila. */
  hasPlanned: boolean;
  /** Nettleseren kan måle opp med gjennomsyn (Quest 3). */
  canMeasure: boolean;
}

export interface NextStep {
  text: string;
  action: NextAction | null;
  /** Knappen for handlingen. */
  label: string | null;
}

export function nextStep(s: NextStepState): NextStep {
  if (s.loadError)
    return { text: 'apartment.json har feil og kan ikke vises. Lag en ny modell, eller rett fila.', action: 'builder', label: 'Ny modell …' };
  if (s.builder) {
    const b = s.builder;
    if (b.errors > 0)
      return {
        text: `Fortsett på «${b.name}»: ${b.errors} feil må rettes før den kan lagres.`,
        action: 'builder',
        label: `Åpne «${b.name}»`,
      };
    if (!b.exported) return { text: `«${b.name}» (${b.rooms} rom) er klar: last ned apartment.json og last den opp.`, action: 'builder', label: `Åpne «${b.name}»` };
  }
  const m = s.measure;
  if (m && m.stale > 0)
    return { text: `${m.stale} ${m.stale === 1 ? 'måling' : 'målinger'} ble gjort mot en eldre fil. Bruk dem eller forkast dem.`, action: 'stale', label: 'Vis målingene' };
  const local = (m?.measurements ?? 0) + s.planEdits;
  if (local > 0) {
    if (m?.exported)
      return { text: 'Last opp apartment.json du lastet ned til GitHub. Trykk «Hent fila på nytt» når den er lagt ut.', action: 'upload', label: 'Last opp til GitHub' };
    const parts: string[] = [];
    if (m && m.measurements > 0) parts.push(`${m.measurements} ${m.measurements === 1 ? 'måling' : 'målinger'}`);
    if (s.planEdits > 0) parts.push(`${s.planEdits} ${s.planEdits === 1 ? 'tegnet endring' : 'tegnede endringer'}`);
    return {
      text: `Du har ${parts.join(' og ')} som bare finnes i denne nettleseren. Last ned apartment.json og last den opp.`,
      action: 'download',
      label: 'Last ned apartment.json',
    };
  }
  if (m && m.done > 0 && m.done < m.total)
    return {
      text: `Fortsett oppmålingen: ${m.done} av ${m.total} punkter.${s.canMeasure ? '' : ' (Gjøres i nettleseren på Quest 3.)'}`,
      action: s.canMeasure ? 'measure' : null,
      label: s.canMeasure ? 'Fortsett oppmålingen' : null,
    };
  if (s.placeholders > 0)
    return {
      text: `${s.placeholders} av ${s.parts} deler er plassholdere (oransje). Mål opp leiligheten med Quest 3.`,
      action: s.canMeasure ? 'measure' : 'highlight',
      label: s.canMeasure ? 'Mål opp' : 'Vis hva som er målt',
    };
  if (!s.hasPlanned)
    return { text: 'Planlegg el og vann: velg «Kabel» (E) eller «Rør» (V). I VR: X → Tegn.', action: 'draw', label: 'Tegn el og vann' };
  return { text: 'Alt er lagret i fila. Gå inn i VR og se deg rundt.', action: 'vr', label: 'Gå inn i VR' };
}
