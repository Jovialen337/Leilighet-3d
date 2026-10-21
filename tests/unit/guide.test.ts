import { describe, expect, it } from 'vitest';
import { legendFor } from '../../src/ui/legend';
import { nextStep, type NextStepState } from '../../src/ui/nextStep';
import { COLOR } from '../../src/ui/tokens';

describe('fargeforklaringen', () => {
  const base = { highlight: false, el: false, water: false, circuits: [], mode: 'laptop' as const };

  it('viser bare det som er i bruk nå', () => {
    expect(legendFor(base)).toEqual([]);
    expect(legendFor({ ...base, highlight: true }).map((g) => g.id)).toEqual(['oppmalt']);
    expect(legendFor({ ...base, el: true, water: true }).map((g) => g.id)).toEqual(['el', 'vann']);
    expect(legendFor({ ...base, mode: 'vr' }).map((g) => g.id)).toEqual(['vr']);
    expect(legendFor({ ...base, mode: 'measure' }).map((g) => g.id)).toEqual(['vr', 'oppmaling']);
    expect(legendFor({ ...base, mode: 'draw' }).map((g) => g.id)).toEqual(['tegning']);
    expect(legendFor({ ...base, all: true }).map((g) => g.id)).toEqual(['oppmalt', 'el', 'vann', 'vr', 'tegning', 'oppmaling']);
  });

  it('målestatusen har de samme fargene som modellen, og kursene står med navn', () => {
    const g = legendFor({ ...base, highlight: true })[0]!;
    expect(g.entries.map((e) => e.color)).toEqual([COLOR.placeholder, COLOR.partial, COLOR.measured]);
    const el = legendFor({ ...base, el: true, circuits: [{ name: 'Kurs 1 – gang', color: '#d35400' }, { name: 'Uten farge' }] })[0]!;
    // Navnet står for seg selv når det allerede begynner med «Kurs».
    expect(el.entries[0]).toEqual({ color: '#d35400', shape: 'line', label: 'Kurs 1 – gang' });
    expect(el.entries.some((e) => e.label.includes('Uten farge'))).toBe(false);
    // Planlagt: stiplet eller bare omriss, aldri bare en annen farge.
    for (const g2 of legendFor({ ...base, all: true }))
      for (const e of g2.entries) if (/planlagt/i.test(e.label)) expect(['dash', 'outline']).toContain(e.shape);
  });
});

describe('«Neste steg»', () => {
  const s = (o: Partial<NextStepState> = {}): NextStepState => ({
    loadError: false,
    builder: null,
    measure: null,
    planEdits: 0,
    placeholders: 0,
    parts: 40,
    hasPlanned: true,
    canMeasure: false,
    ...o,
  });

  it('det viktigste først: feil i fila, så ny modell, gamle målinger, lokale endringer, oppmåling og planlegging', () => {
    expect(nextStep(s({ loadError: true, planEdits: 3 })).action).toBe('builder');
    expect(nextStep(s({ builder: { name: 'Hytta', rooms: 3, errors: 2, exported: false } })).text).toMatch(/«Hytta»: 2 feil må rettes/);
    expect(nextStep(s({ builder: { name: 'Hytta', rooms: 3, errors: 0, exported: false } })).text).toMatch(/er klar: last ned/);
    expect(nextStep(s({ measure: { measurements: 5, done: 5, total: 80, stale: 2, exported: false } })).action).toBe('stale');
    const local = nextStep(s({ measure: { measurements: 5, done: 5, total: 80, stale: 0, exported: false }, planEdits: 1 }));
    expect(local).toMatchObject({ action: 'download', label: 'Last ned apartment.json' });
    expect(local.text).toBe('Du har 5 målinger og 1 tegnet endring som bare finnes i denne nettleseren. Last ned apartment.json og last den opp.');
    expect(nextStep(s({ measure: { measurements: 5, done: 5, total: 80, stale: 0, exported: true } })).action).toBe('upload');
    expect(nextStep(s({ measure: { measurements: 0, done: 12, total: 80, stale: 0, exported: false }, canMeasure: true })).text).toBe(
      'Fortsett oppmålingen: 12 av 80 punkter.',
    );
    expect(nextStep(s({ measure: { measurements: 0, done: 12, total: 80, stale: 0, exported: false } })).action).toBeNull();
    expect(nextStep(s({ placeholders: 23 })).text).toBe('23 av 40 deler er plassholdere (oransje). Mål opp leiligheten med Quest 3.');
    expect(nextStep(s({ placeholders: 23 })).action).toBe('highlight');
    expect(nextStep(s({ placeholders: 23, canMeasure: true })).action).toBe('measure');
    expect(nextStep(s({ hasPlanned: false })).action).toBe('draw');
    expect(nextStep(s()).action).toBe('vr');
  });
});
