/**
 * Opplæringen: korte steg som hver venter på at brukeren gjør én ting (eller
 * trykker «Neste»). Ren data – kortet på laptopen og håndleddet i VR viser
 * de samme stegene.
 */

export type TutorialTrack = 'pc' | 'vr';

/** Det appen melder fra om. Et steg er fullført når hendelsen det venter på kommer. */
export type TutorialEvent =
  | 'look'
  | 'room'
  | 'top'
  | 'highlight'
  | 'legend'
  | 'teleport'
  | 'turn'
  | 'menu'
  | 'menu-close'
  | 'vr-room'
  | 'vr-legend';

export interface TutorialStep {
  id: string;
  title: string;
  /** Teksten på kortet (laptop og Quest-siden). */
  text: string;
  /** Korte linjer på håndleddet i VR. */
  wrist?: readonly string[];
  /** Hendelsen som fullfører steget; null = bare «Neste» / «Ferdig». */
  until: TutorialEvent | null;
  /** Det som utheves på siden (data-testid). */
  target?: string;
  /** Knappene som utheves i VR-menyen: fanen først, så knappen («room:*» = alle rommene). */
  menuTargets?: readonly string[];
}

export const PC_STEPS: readonly TutorialStep[] = [
  {
    id: 'se',
    title: 'Se deg rundt',
    text: 'Dra i modellen for å snu den, og rull (eller knip med to fingre) for å zoome. Høyreklikk og dra flytter den.',
    until: 'look',
  },
  {
    id: 'rom',
    title: 'Gå til et rom',
    text: 'Trykk på et rom under «Gå til rom» i panelet. Kameraet flyr dit.',
    until: 'room',
    target: 'rooms',
  },
  {
    id: 'plan',
    title: 'Ovenfra (2D)',
    text: 'Trykk «Ovenfra (2D)» for å se planen ovenfra med mål. «3D» tar deg tilbake.',
    until: 'top',
    target: 'mode-top',
  },
  {
    id: 'malt',
    title: 'Hva er målt?',
    text: 'Slå på «Marker umålte mål». Oransje er plassholdere som ikke er målt, gult er delvis målt og grønt er målt.',
    until: 'highlight',
    target: 'toggle-measure',
  },
  {
    id: 'farger',
    title: 'Hva fargene betyr',
    text: 'Trykk «Farger» øverst i panelet. Der står hva hver farge betyr, også for el og vann.',
    until: 'legend',
    target: 'open-legend',
  },
  {
    id: 'neste',
    title: 'Neste steg',
    text: '«⌂ Start» øverst åpner startmenyen igjen. Der står alltid hva du bør gjøre nå.',
    until: null,
    target: 'open-start',
  },
];

export const VR_STEPS: readonly TutorialStep[] = [
  {
    id: 'teleport',
    title: 'Teleporter',
    text: 'Skyv venstre stikke fram og sikt. Grønn bue: du kan lande der, så slipp stikka. Rød bue: ikke der.',
    wrist: ['Skyv venstre stikke fram', 'Grønn bue: slipp for å lande', 'Rød bue: ikke der'],
    until: 'teleport',
  },
  {
    id: 'snu',
    title: 'Snu deg',
    text: 'Skyv høyre stikke til siden for å snu. Bakover snur deg 180°.',
    wrist: ['Skyv høyre stikke til siden', 'Bakover: snu 180°'],
    until: 'turn',
  },
  {
    id: 'meny',
    title: 'Menyen',
    text: 'Trykk X på venstre kontroller. Menyen dukker opp over hånden.',
    wrist: ['Trykk X på venstre kontroller'],
    until: 'menu',
  },
  {
    id: 'rom',
    title: 'Gå til et rom',
    text: 'Pek med høyre kontroller på «Gå til» og trykk avtrekkeren. Velg så et rom.',
    wrist: ['Pek på «Gå til», trykk avtrekkeren', 'Velg så et rom'],
    until: 'vr-room',
    menuTargets: ['tab:ga', 'room:*'],
  },
  {
    id: 'farger',
    title: 'Hva fargene betyr',
    text: 'Åpne fanen «Hjelp» i menyen og trykk «Hva fargene betyr».',
    wrist: ['Menyen (X): fanen «Hjelp»', 'Trykk «Hva fargene betyr»'],
    until: 'vr-legend',
    menuTargets: ['tab:hjelp', 'tab:farger'],
  },
  {
    id: 'ferdig',
    title: 'Ferdig!',
    text: 'Du kan det viktigste. «Hjelp» i menyen viser neste steg og fargene.',
    wrist: ['Du kan det viktigste!', '«Hjelp» i menyen: neste steg', 'X: lukk menyen'],
    until: 'menu-close',
  },
];

export function stepsFor(track: TutorialTrack): readonly TutorialStep[] {
  return track === 'pc' ? PC_STEPS : VR_STEPS;
}
