/**
 * «Lag ny modell»: byggerens egen, enkle beskrivelse av en leilighet.
 *
 * Alt tegnes som rom (innvendige mål). Veggene lages automatisk av hvordan
 * rommene ligger mot hverandre (se walls.ts), og åpningene sitter på
 * rommenes kanter. `compile()` gjør dette om til en gyldig apartment.json.
 *
 * Koordinater er i byggerens ramme: mm, x mot høyre og z nedover slik
 * planen tegnes. Ved eksport flyttes origo til hjørnet ved inngangsdøra
 * (se transform.ts), slik oppmålingen forventer.
 */
import type { Furniture, Fixture, Layer, Meta, Note, OutdoorArea, PipeRun, ScanReference, Settings, WallMaterial, WireRun, Zone, Circuit } from '../schema/types';

export const BUILDER_VERSION = 1;

/** Et hjørne. `m` = målt (fra oppmåling i gjennomsyn eller importert som målt). */
export interface BPoint {
  x: number;
  z: number;
  m?: boolean;
}

/** Valg for veggen langs én kant av et rom (gjelder ytterveggen på den kanten). */
export interface BEdge {
  /** Tykkelse på yttervegg langs kanten (mm). Utelatt: standard. */
  thickness?: number;
  material?: WallMaterial;
}

export interface BRoom {
  id: string;
  name: string;
  /** Gulvpolygon, innvendige mål, hjørnene i rekkefølge rundt rommet. */
  polygon: BPoint[];
  /** Gulvnivå (mm, absolutt i byggerens ramme). */
  floor: number;
  floorMeasured?: boolean;
  /** Takhøyde over gulvet (mm). */
  ceiling: number;
  /** Takhøyde i hvert hjørne (skrått tak); null = vanlig takhøyde. */
  ceilingCorners?: (number | null)[];
  ceilingMeasured?: boolean;
  /** Valg per kant (samme rekkefølge som hjørnene: kant i går fra hjørne i til i+1). */
  edges?: (BEdge | null)[];
  floorColor?: string;
}

export type BOpeningType = 'door' | 'window' | 'passage';

/** En dør, et vindu eller en åpning på kanten av et rom. */
export interface BOpening {
  id: string;
  type: BOpeningType;
  /** Rommet og kanten åpningen sitter på. */
  room: string;
  edge: number;
  /** Avstand langs kanten fra kantens første hjørne til åpningens nærmeste kant (mm). */
  offset: number;
  width: number;
  height: number;
  /** Vindu: brystningshøyde over gulvet. */
  sill?: number;
  /** Dør: rommet man går inn i. Utelatt: rommet på den andre siden (ellers `room`). */
  into?: string;
  hinge?: 'left' | 'right';
  swing?: 'in' | 'out';
  /** Inngangsdøra: der oppmålingen starter og VR begynner. */
  entrance?: boolean;
  name?: string;
  measured?: boolean;
}

export interface BuilderSettings {
  /** Standard tykkelse på yttervegger (mm). */
  exteriorThickness: number;
  /** Tykkelse på skillevegger når et rom legges inntil et annet (mm). */
  interiorThickness: number;
  /** Største avstand mellom to rom som regnes som én vegg mellom dem (mm). */
  maxWallGap: number;
  /** Takhøyde for nye rom (mm). */
  defaultCeiling: number;
}

export const DEFAULT_BUILDER_SETTINGS: BuilderSettings = {
  exteriorThickness: 200,
  interiorThickness: 100,
  maxWallGap: 400,
  defaultCeiling: 2400,
};

/** En installasjon på vegg, husket som punkt så den kan festes til den nye veggen. */
export interface AnchoredFixture {
  fixture: Fixture;
  /** Punkt på veggflaten (byggerens ramme) og rommet den vender mot. */
  anchor?: { x: number; z: number; room?: string };
}

/** En vegg fra den importerte modellen: nye vegger på samme sted arver id, navn og farge. */
export interface WallRef {
  id: string;
  name?: string;
  color: string;
  material?: WallMaterial;
  measured?: boolean;
  start: [number, number];
  end: [number, number];
  thickness: number;
}

/**
 * Alt fra en importert modell som ikke er rom, vegger eller åpninger.
 * Lagret i byggerens ramme og tas med uendret (flyttet sammen med resten).
 */
export interface BuilderExtras {
  meta?: Partial<Meta>;
  settings?: Settings;
  layers?: Layer[];
  fixtures?: AnchoredFixture[];
  furniture?: Furniture[];
  outdoor?: OutdoorArea[];
  zones?: Zone[];
  wiring?: WireRun[];
  pipes?: PipeRun[];
  circuits?: Circuit[];
  scans?: ScanReference[];
  notes?: Note[];
  /** Veggene i den importerte modellen (senterlinjer), for å beholde id-ene. */
  walls?: WallRef[];
}

export interface BuilderDoc {
  version: typeof BUILDER_VERSION;
  name: string;
  settings: BuilderSettings;
  rooms: BRoom[];
  openings: BOpening[];
  extras?: BuilderExtras;
}

export const emptyBuilderDoc = (name = 'Ny leilighet'): BuilderDoc => ({
  version: BUILDER_VERSION,
  name,
  settings: { ...DEFAULT_BUILDER_SETTINGS },
  rooms: [],
  openings: [],
});

/** Romnavn å velge mellom (også i VR, der det er vanskelig å skrive). */
export const ROOM_NAMES = ['Gang', 'Stue', 'Kjøkken', 'Bad', 'Soverom', 'Kontor', 'Bod', 'Vaskerom', 'Planterom', 'Entré', 'Toalett', 'Rom'] as const;

/** Gulvfarge etter romnavn (bare utseende). */
export function floorColorFor(name: string): string {
  const n = name.toLowerCase();
  if (n.startsWith('bad') || n.startsWith('toalett') || n.startsWith('vask')) return '#9fb2b8';
  if (n.startsWith('kjøkken')) return '#c9c4ba';
  if (n.startsWith('gang') || n.startsWith('entré')) return '#8a7f73';
  if (n.startsWith('plante')) return '#7d8a6b';
  if (n.startsWith('bod')) return '#9a9186';
  return '#b99a74';
}
