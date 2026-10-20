/**
 * Kontrollermodellen i VR: kropp og ring i én mesh med farge per hjørne, så
 * hver kontroller tegnes med ett tegnekall (før: to).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Gir alle hjørnene i geometrien samme farge. */
function painted(g: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export function controllerModel(): THREE.Mesh {
  const body = painted(new THREE.BoxGeometry(0.035, 0.03, 0.11).translate(0, 0, 0.02), '#2b2f33');
  const ring = painted(new THREE.TorusGeometry(0.04, 0.006, 6, 20).rotateX(Math.PI / 2.5).translate(0, 0.02, -0.035), '#4a5058');
  const geo = mergeGeometries([body, ring])!;
  body.dispose();
  ring.dispose();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.name = 'kontroller';
  return mesh;
}
