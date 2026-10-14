/**
 * Tekstetiketter på laptop (romnavn + areal, notater, etiketter på
 * installasjoner). Vises i 2D-planen. Følger lagene.
 */
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import type { ApartmentModel } from '../model/ApartmentModel';
import { centroid, p2 } from '../geometry/math2d';
import { MM } from '../scene/geom';

export class Labels {
  readonly renderer = new CSS2DRenderer();
  readonly root = new THREE.Group();
  private readonly byLayer = new Map<string, CSS2DObject[]>();

  constructor(container: HTMLElement) {
    this.renderer.domElement.className = 'labels';
    container.appendChild(this.renderer.domElement);
    this.root.name = 'etiketter';
  }

  /** Fjerner alle etiketter (f.eks. når en ny modell ikke har rom ennå). */
  clear(): void {
    for (const list of this.byLayer.values()) for (const o of list) o.element.remove();
    this.root.clear();
    this.byLayer.clear();
  }

  build(model: ApartmentModel): void {
    this.clear();
    const add = (layer: string, text: string, cls: string, x: number, y: number, z: number): void => {
      const el = document.createElement('div');
      el.className = `label ${cls}`;
      el.textContent = text;
      const obj = new CSS2DObject(el);
      obj.position.set(x * MM, y * MM, z * MM);
      this.root.add(obj);
      const list = this.byLayer.get(layer) ?? [];
      list.push(obj);
      this.byLayer.set(layer, list);
    };
    for (const info of model.rooms.values()) {
      const c = centroid(info.polygon);
      const area = (info.area / 1e6).toLocaleString('nb-NO', { maximumFractionDigits: 1 });
      add(info.room.layer ?? 'structure', `${info.room.name}\n${area} m²`, 'room', c.x, info.room.floorLevel, c.z);
    }
    for (const n of model.data.notes) {
      const [x, h, z] = n.position;
      add(n.layer, n.text, 'note', x, model.floorOrDefault(p2(x, z)) + h, z);
    }
    for (const fx of model.data.fixtures) {
      if (!fx.label) continue;
      const pl = model.fixturePlacement(fx);
      if (pl) add(fx.layer, fx.label, 'fixture', pl.x, pl.y, pl.z);
    }
  }

  setLayerVisible(layer: string, visible: boolean): void {
    for (const o of this.byLayer.get(layer) ?? []) o.visible = visible;
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.render(scene, camera);
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
    this.renderer.domElement.style.display = v ? '' : 'none';
  }
}
