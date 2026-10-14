/** Standardlagene en ny modell får (samme som i apartment.json). */
import type { Layer } from '../schema/types';

export const DEFAULT_LAYERS: Layer[] = [
  { id: 'structure', name: 'Konstruksjon', visible: true },
  { id: 'openings', name: 'Dører og vinduer', visible: true },
  { id: 'furniture', name: 'Møbler', visible: true },
  { id: 'electrical-existing', name: 'Elektrisk – eksisterende', visible: true },
  { id: 'electrical-planned', name: 'Elektrisk – planlagt', visible: true },
  { id: 'ventilation', name: 'Ventilasjon', visible: true },
  { id: 'wiring', name: 'Kabling', visible: true },
  { id: 'plumbing-existing', name: 'Vann – eksisterende', visible: true },
  { id: 'plumbing-planned', name: 'Vann – planlagt', visible: true },
  { id: 'workshop-zone', name: 'Verkstedsone', visible: true },
  { id: 'outdoor', name: 'Uteområde', visible: true },
  { id: 'scan-reference', name: 'Skannereferanse', visible: true },
  { id: 'notes', name: 'Notater', visible: true },
];
