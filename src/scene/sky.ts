/**
 * Himmel og mark rundt leiligheten (synlig gjennom vinduene og utenfra på
 * laptopen). Én kuppel med fargeovergang og en markskive – to billige
 * tegnekall som tegnes etter alt annet, så bare synlige piksler fargelegges.
 * Skjules i 2D-planen, i gjennomsyn (oppmåling) og på «Rask».
 */
import * as THREE from 'three';

export const SKY = {
  radius: 150,
  zenith: '#7fb0e2',
  horizon: '#e6edf1',
  ground: '#b3bea4',
  groundEdge: '#dfe6e2',
} as const;

export function createSky(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'himmel';

  const dome = new THREE.SphereGeometry(SKY.radius, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2 + 0.15);
  const pos = dome.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const zen = new THREE.Color(SKY.zenith);
  const hor = new THREE.Color(SKY.horizon);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, pos.getY(i) / SKY.radius);
    c.copy(hor).lerp(zen, Math.pow(t, 0.6));
    c.toArray(colors, i * 3);
  }
  dome.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const domeMesh = new THREE.Mesh(
    dome,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, toneMapped: false, fog: false }),
  );
  domeMesh.name = 'himmel:kuppel';
  domeMesh.renderOrder = 2; // etter marka og modellen: bare synlige piksler fargelegges

  const disc = new THREE.CircleGeometry(SKY.radius, 48).rotateX(-Math.PI / 2);
  const dp = disc.getAttribute('position');
  const dc = new Float32Array(dp.count * 3);
  const g0 = new THREE.Color(SKY.ground);
  const g1 = new THREE.Color(SKY.groundEdge);
  for (let i = 0; i < dp.count; i++) {
    const r = Math.hypot(dp.getX(i), dp.getZ(i)) / SKY.radius;
    c.copy(g0).lerp(g1, Math.min(1, r * 1.6)).toArray(dc, i * 3);
  }
  disc.setAttribute('color', new THREE.BufferAttribute(dc, 3));
  const ground = new THREE.Mesh(disc, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  ground.name = 'himmel:mark';
  ground.renderOrder = 1;

  g.add(domeMesh, ground);
  return g;
}

/** Legger marka like under det laveste (uteområder/gulv), i meter. */
export function setGroundLevel(sky: THREE.Group, y: number): void {
  const ground = sky.getObjectByName('himmel:mark');
  if (ground) ground.position.y = y;
}
