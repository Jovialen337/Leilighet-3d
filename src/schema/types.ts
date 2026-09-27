/**
 * Datamodellen for apartment.json.
 *
 * Konvensjoner (gjelder hele fila):
 * - Alle lengder er i millimeter.
 * - Origo er det innvendige hjørnet ved inngangsdøra, på gangens gulv. y peker opp.
 * - Plan-koordinater skrives som [x, z]. Sett ovenfra (2D-visningen) går x mot høyre
 *   og z nedover på skjermen.
 * - Alle høyder måles fra gulvet der punktet står (rommets gulv), unntatt
 *   `floorLevel` på rom og `level` på uteområder, som er absolutte (fra origo).
 * - Ethvert tall kan skrives som et rent tall eller som
 *   `{ "value": 900, "measured": true }`. Et rent tall arver objektets `measured`
 *   (standard false = plassholder).
 *
 * Typene er generiske i N: `Apartment<Num>` er rådata slik de står i fila,
 * `Apartment` (N = number) er normalisert data som geometrikoden bruker.
 */

export interface MeasuredValue {
  value: number;
  measured?: boolean;
  note?: string;
}

/** Et tall i fila: rent tall eller tall med målt-flagg. */
export type Num = number | MeasuredValue;

/** Plan-punkt [x, z] i mm. */
export type Vec2<N = number> = [N, N];
/** Romlig punkt [x, y, z] i mm. y = høyde over gulvet der punktet står. */
export type Vec3<N = number> = [N, N, N];

/** Farge på formen "#rrggbb". */
export type Color = string;

export const STANDARD_LAYER_IDS = [
  'structure',
  'openings',
  'furniture',
  'electrical-existing',
  'electrical-planned',
  'ventilation',
  'wiring',
  'workshop-zone',
  'outdoor',
  'scan-reference',
  'notes',
] as const;
export type StandardLayerId = (typeof STANDARD_LAYER_IDS)[number];
export type LayerId = string;

/** Felles felt for alle objekter i fila. */
export interface BaseObject {
  /** Unik id i hele fila. */
  id: string;
  /** Standardverdi for alle rene tall i objektet. Standard: false (plassholder). */
  measured?: boolean;
  /** Fritekst-notat (vises ikke i fase 1). */
  note?: string;
}

export interface Meta {
  name: string;
  description?: string;
  /** Beskrivelse av origo, for mennesker. */
  origin?: string;
  updated?: string;
}

export interface Settings<N = number> {
  /** Høyde (fra gulvet) der 2D-planvisningen «kutter» modellen. Standard 1500. */
  planCutHeight?: N;
  /** Vegghøyde når ingen tilstøtende rom har tak. Standard 2400. */
  defaultWallHeight?: N;
  /** Bakgrunnsfarge / himmel. */
  backgroundColor?: Color;
}

export interface Layer {
  id: LayerId;
  /** Norsk visningsnavn. */
  name: string;
  /** Synlig ved oppstart. */
  visible: boolean;
}

/* ------------------------------------------------------------------ */
/* Rom, tak, vegger                                                    */
/* ------------------------------------------------------------------ */

export interface CeilingPoint<N = number> {
  x: N;
  z: N;
  /** Høyde fra rommets gulv til taket i dette punktet. */
  height: N;
}

/** Tak: et (skrått) plan bestemt av minst 3 målte høydepunkter. */
export interface Ceiling<N = number> {
  points: CeilingPoint<N>[];
  color?: Color;
  measured?: boolean;
}

/** Kontrollmål for et rom. Brukes til å sjekke at polygonet stemmer. */
export interface RoomDimensions<N = number> {
  /** Lengste innvendige mål. */
  length?: N;
  /** Korteste innvendige mål. */
  width?: N;
  /** Takhøyde. */
  height?: N;
}

export interface Room<N = number> extends BaseObject {
  name: string;
  /** Gulvpolygon, innvendige mål, [x, z]-punkter i rekkefølge rundt rommet. */
  polygon: Vec2<N>[];
  /** Gulvnivå (absolutt, fra origo). Gangen er 0, resten ett trinn høyere. */
  floorLevel: N;
  ceiling: Ceiling<N>;
  floorColor?: Color;
  dimensions?: RoomDimensions<N>;
  layer?: LayerId;
}

export type WallJustify = 'center' | 'left' | 'right';
export type WallMaterial = 'concrete' | 'drywall' | 'wood' | 'brick' | 'other';

export interface Wall<N = number> extends BaseObject {
  name?: string;
  start: Vec2<N>;
  end: Vec2<N>;
  thickness: N;
  /**
   * Hvilken side av linja start→slutt veggen ligger på, sett ovenfra.
   * "center": linja er veggens midtlinje. "left"/"right": linja er veggens
   * flate, og tykkelsen legges til venstre/høyre. Standard "center".
   */
  justify?: WallJustify;
  color: Color;
  material?: WallMaterial;
  /** Fast høyde fra `base`. Utelatt: veggen går opp til taket i tilstøtende rom. */
  height?: N;
  /** Underkant over gulvet (f.eks. for dragere/nedforinger). Standard: gulvet. */
  base?: N;
  layer?: LayerId;
}

/* ------------------------------------------------------------------ */
/* Åpninger                                                           */
/* ------------------------------------------------------------------ */

export interface OpeningBase<N = number> extends BaseObject {
  name?: string;
  /** Veggen åpningen sitter i. */
  wall: string;
  /** Avstand langs veggen fra veggens start til åpningens nærmeste kant. */
  offset: N;
  width: N;
  height: N;
  /** Rommet høydene måles fra (dette rommets gulv er åpningens gulv). */
  room?: string;
  layer?: LayerId;
}

export type HingeSide = 'left' | 'right';
export type SwingInOut = 'in' | 'out';
/** Sett ovenfra. Utledes av hinge + swing; kan oppgis som kontroll. */
export type SwingDirection = 'clockwise' | 'counterclockwise';

export interface Door<N = number> extends OpeningBase<N> {
  type: 'door';
  /** Rommet man går inn i gjennom døra. */
  into: string;
  /** Hengselside sett av den som går inn i `into`. */
  hinge: HingeSide;
  /** "in": dørbladet slår inn i `into`. "out": slår ut fra `into`. */
  swing: SwingInOut;
  /** Valgfri kontroll: må stemme med hinge + swing. */
  swingDirection?: SwingDirection;
  /** Største åpningsvinkel i grader. Standard 90. */
  openAngle?: N;
  /** Inngangsdøra: der man starter i VR. */
  entrance?: boolean;
  leafColor?: Color;
}

export interface WindowOpening<N = number> extends OpeningBase<N> {
  type: 'window';
  /** Brystningshøyde: fra gulvet til underkant vindu. */
  sillHeight: N;
  frameColor?: Color;
}

/** Åpning uten dør (gjennomgang). */
export interface Passage<N = number> extends OpeningBase<N> {
  type: 'passage';
}

export type Opening<N = number> = Door<N> | WindowOpening<N> | Passage<N>;

/* ------------------------------------------------------------------ */
/* Installasjoner                                                     */
/* ------------------------------------------------------------------ */

export const FIXTURE_TYPES = ['outlet', 'switch', 'radiator', 'pipe', 'vent', 'hatch'] as const;
export type FixtureType = (typeof FIXTURE_TYPES)[number];
export type Status = 'existing' | 'planned';

/** Plassering på en vegg. */
export interface WallMount<N = number> {
  wall: string;
  /** Hvilken side av veggen: rommet på den siden (anbefalt) … */
  room?: string;
  /** … eller siden sett ovenfra fra start mot slutt. */
  face?: 'left' | 'right';
  /** Avstand langs veggen fra veggens start til senter av objektet. */
  along: N;
  /** Høyde fra gulvet til senter av objektet. */
  height: N;
}

export interface Fixture<N = number> extends BaseObject {
  name?: string;
  type: FixtureType;
  layer: LayerId;
  status: Status;
  /** Plassering på vegg (bruk enten `mount` eller `position`). */
  mount?: WallMount<N>;
  /** Fri plassering: [x, høyde over gulv, z] til senter av objektet. */
  position?: Vec3<N>;
  /** Rotasjon om loddrett akse i grader (kun fri plassering). */
  rotation?: N;
  /** [bredde, høyde, dybde]. Standard avhenger av type. For rør: [diameter, lengde, diameter]. */
  size?: Vec3<N>;
  /** Kun rør: "vertical" (standard) eller "horizontal" (langs veggen). */
  orientation?: 'vertical' | 'horizontal';
  color?: Color;
  /** Kort etikett, f.eks. "Feiluke/rør – ikke rør". */
  label?: string;
}

/* ------------------------------------------------------------------ */
/* Møbler                                                             */
/* ------------------------------------------------------------------ */

export type PartShape = 'box' | 'cylinder' | 'roundedBox';

export interface FurniturePart<N = number> {
  shape: PartShape;
  /** [bredde, høyde, dybde]. For sylinder: [diameter, høyde, diameter]. */
  size: Vec3<N>;
  /** Senter av delen relativt til møbelets origo (på gulvet). */
  offset: Vec3<N>;
  color: Color;
  /** Kun roundedBox: avrundingsradius. */
  radius?: N;
  name?: string;
}

export type FurnitureSource =
  | { kind: 'own' }
  | { kind: 'glb'; url: string; scale?: number };

export interface Furniture<N = number> extends BaseObject {
  name: string;
  /** Maltype, f.eks. "sofa", "bord", "benk", "hylle". */
  template: string;
  /** [x, høyde over gulv, z] for møbelets origo. */
  position: Vec3<N>;
  /** Rotasjon om loddrett akse i grader. */
  rotation: N;
  layer: LayerId;
  source: FurnitureSource;
  parts: FurniturePart<N>[];
}

/* ------------------------------------------------------------------ */
/* Ute, soner, kabler, skann, notater                                  */
/* ------------------------------------------------------------------ */

export type OutdoorKind = 'pathway' | 'garden' | 'terrace' | 'other';

export interface OutdoorArea<N = number> extends BaseObject {
  name: string;
  kind: OutdoorKind;
  polygon: Vec2<N>[];
  /** Absolutt nivå (fra origo). */
  level: N;
  color?: Color;
  layer?: LayerId;
}

export interface Zone<N = number> extends BaseObject {
  name: string;
  layer: LayerId;
  polygon: Vec2<N>[];
  /** Soneshøyde (for visning som volum senere). */
  height?: N;
  color?: Color;
}

export type WireKind = 'power' | 'light' | 'data' | 'other';

export interface WireRun<N = number> extends BaseObject {
  name?: string;
  layer: LayerId;
  status: Status;
  kind?: WireKind;
  /** Punkter [x, høyde over gulv, z]. */
  points: Vec3<N>[];
  color?: Color;
}

export type ScanFormat = 'glb' | 'ply' | 'obj' | 'image';

export interface ScanReference<N = number> extends BaseObject {
  name: string;
  layer: LayerId;
  url: string;
  format: ScanFormat;
  position: Vec3<N>;
  rotation: N;
  scale?: N;
  opacity?: number;
}

export interface Note<N = number> extends BaseObject {
  text: string;
  layer: LayerId;
  position: Vec3<N>;
  color?: Color;
}

/* ------------------------------------------------------------------ */
/* Hele fila                                                          */
/* ------------------------------------------------------------------ */

export interface Apartment<N = number> {
  schemaVersion: 1;
  meta: Meta;
  settings?: Settings<N>;
  layers: Layer[];
  rooms: Room<N>[];
  walls: Wall<N>[];
  openings: Opening<N>[];
  fixtures: Fixture<N>[];
  furniture: Furniture<N>[];
  outdoor: OutdoorArea<N>[];
  zones: Zone<N>[];
  wiring: WireRun<N>[];
  scans: ScanReference<N>[];
  notes: Note<N>[];
}

/** Rådata slik de står i apartment.json. */
export type ApartmentDoc = Apartment<Num>;

/** Objektsamlingene i fila (nøkler i Apartment som er lister av objekter). */
export const COLLECTIONS = [
  'rooms',
  'walls',
  'openings',
  'fixtures',
  'furniture',
  'outdoor',
  'zones',
  'wiring',
  'scans',
  'notes',
] as const;
export type CollectionKey = (typeof COLLECTIONS)[number];

/** Målestatus for et objekt: alle verdier målt, noen, eller ingen. */
export type MeasureState = 'measured' | 'partial' | 'placeholder';
