/**
 * Målinger fra guidet oppmåling. Alle koordinater er i modellens system
 * (mm, origo i hjørnet ved inngangsdøra). `y` er absolutt høyde fra origo
 * (gangens gulv), ikke fra rommets gulv.
 */
export type Observation =
  | { kind: 'room-floor'; roomId: string; y: number }
  | { kind: 'room-corner'; roomId: string; index: number; x: number; z: number }
  | { kind: 'ceiling'; roomId: string; slot: number; x: number; y: number; z: number }
  | { kind: 'jamb'; openingId: string; side: 0 | 1; x: number; z: number }
  | { kind: 'opening-top'; openingId: string; y: number }
  | { kind: 'opening-sill'; openingId: string; y: number }
  | { kind: 'fixture'; fixtureId: string; x: number; y: number; z: number };

export type ObservationKind = Observation['kind'];
