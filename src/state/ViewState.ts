/**
 * Visningstilstand som er uavhengig av hvilket UI som endrer den.
 * Laptop-panelet (DOM) og VR-håndleddsmenyen (fase 3) leser og skriver
 * de samme verdiene, så ingen av dem trenger å kjenne den andre.
 */
import type { Layer } from '../schema/types';
import { Observable } from './Observable';

export type CameraMode = 'orbit' | 'top';

export class LayerState {
  private readonly visible = new Map<string, Observable<boolean>>();
  private readonly initialized = new Set<string>();
  readonly layers: Layer[] = [];

  /** Nye lag får synligheten fra fila; valg brukeren har gjort beholdes ved ny innlasting. */
  reset(layers: readonly Layer[]): void {
    this.layers.length = 0;
    this.layers.push(...layers);
    for (const l of layers) {
      if (this.initialized.has(l.id)) continue;
      this.initialized.add(l.id);
      this.get(l.id).set(l.visible);
    }
  }

  get(id: string): Observable<boolean> {
    let o = this.visible.get(id);
    if (!o) {
      o = new Observable(true);
      this.visible.set(id, o);
    }
    return o;
  }

  isVisible(id: string): boolean {
    return this.get(id).value;
  }

  set(id: string, visible: boolean): void {
    this.get(id).set(visible);
  }

  toggle(id: string): void {
    this.set(id, !this.isVisible(id));
  }
}

export class ViewState {
  readonly layers = new LayerState();
  readonly cameraMode = new Observable<CameraMode>('orbit');
  readonly ceilings = new Observable(true);
  readonly measureHighlight = new Observable(false);
  readonly fps = new Observable(false);
  readonly inXR = new Observable(false);
}
