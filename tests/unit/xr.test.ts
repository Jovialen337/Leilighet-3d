import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ApartmentScene } from '../../src/scene/ApartmentScene';
import { Materials } from '../../src/scene/materials';
import { TeleportArc } from '../../src/xr/teleport';
import { followFloor, placeAtSpawn, snapTurn, teleportTo } from '../../src/xr/rig';
import { controllerModel } from '../../src/xr/controllerModel';
import { modelOf } from './helpers';

const model = modelOf();
const scene = new ApartmentScene(new Materials());
scene.build(model);
const proxies = scene.visibleProxies();

/** Retning med gitt kompassretning (x, z) og helning ned (grader). */
function aim(x: number, z: number, downDeg: number): THREE.Vector3 {
  const h = Math.cos((downDeg * Math.PI) / 180);
  const l = Math.hypot(x, z);
  return new THREE.Vector3((x / l) * h, -Math.sin((downDeg * Math.PI) / 180), (z / l) * h).normalize();
}

describe('teleport-bue', () => {
  const arc = new TeleportArc();

  it('lander på stuegulvet (180 mm) gjennom åpningen fra gangen', () => {
    const hit = arc.compute(new THREE.Vector3(0.85, 1.3, 1.1), aim(1, 0, 15), proxies);
    expect(hit?.valid).toBe(true);
    expect(hit?.id).toBe('stue');
    expect(hit!.point.y).toBeCloseTo(0.18, 4);
  });

  it('lander på gangens gulv (0 mm)', () => {
    const hit = arc.compute(new THREE.Vector3(3.3, 1.5, 1.2), aim(-1, 0, 12), proxies);
    expect(hit?.valid).toBe(true);
    expect(hit?.id).toBe('gang');
    expect(hit!.point.y).toBeCloseTo(0, 4);
  });

  it('stoppes av vegger (ugyldig landing)', () => {
    const hit = arc.compute(new THREE.Vector3(1.0, 1.4, 1.8), aim(1, 0.0001, -20), proxies);
    expect(hit?.valid).toBe(false);
    expect(['v-gang-stue', 'gang', 'stue']).toContain(hit?.id);
    const wallHit = arc.compute(new THREE.Vector3(0.3, 1.4, 2.0), aim(0, 1, 0), proxies);
    expect(wallHit?.id).toBe('v-gang-planterom');
    expect(wallHit?.valid).toBe(false);
  });

  it('kan lande utendørs gjennom inngangsdøra', () => {
    const hit = arc.compute(new THREE.Vector3(0.65, 1.3, 0.7), aim(0, -1, 10), proxies);
    expect(hit?.valid).toBe(true);
    expect(['sti', 'hage']).toContain(hit?.id);
  });

  it('skjulte lag stopper ikke buen', () => {
    scene.setLayerVisible('furniture', false);
    const visible = scene.visibleProxies();
    expect(visible.some((p) => p.userData.layer === 'furniture')).toBe(false);
    scene.setLayerVisible('furniture', true);
  });
});

describe('spillerrigg', () => {
  const makeRig = () => {
    const rig = new THREE.Group();
    const cam = new THREE.PerspectiveCamera();
    rig.add(cam);
    return { rig, cam };
  };
  const headOf = (cam: THREE.Object3D) => cam.getWorldPosition(new THREE.Vector3());

  it('snu 30° roterer om hodet og holder hodet i ro', () => {
    const { rig, cam } = makeRig();
    rig.position.set(2, 0.18, 3);
    cam.position.set(0.4, 1.6, -0.3);
    rig.updateMatrixWorld(true);
    const before = headOf(cam);
    snapTurn(rig, before, (-30 * Math.PI) / 180);
    const after = headOf(cam);
    expect(after.distanceTo(before)).toBeLessThan(1e-9);
    expect(rig.rotation.y).toBeCloseTo((-30 * Math.PI) / 180, 9);
  });

  it('teleport flytter hodet over målet og føttene til gulvnivået', () => {
    const { rig, cam } = makeRig();
    cam.position.set(0.3, 1.6, 0.2);
    rig.updateMatrixWorld(true);
    teleportTo(rig, headOf(cam), new THREE.Vector3(4, 0.18, 2));
    const head = headOf(cam);
    expect(head.x).toBeCloseTo(4, 9);
    expect(head.z).toBeCloseTo(2, 9);
    expect(rig.position.y).toBeCloseTo(0.18, 9);
  });

  it('startplassering tar hensyn til hvor brukeren står og ser i det fysiske rommet', () => {
    const { rig, cam } = makeRig();
    cam.position.set(1, 1.7, -0.5);
    cam.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.1);
    rig.updateMatrixWorld(true);
    placeAtSpawn(rig, cam.position, cam.quaternion, new THREE.Vector3(0.65, 0, 0.7), { x: 0, z: 1 });
    const head = headOf(cam);
    expect(head.x).toBeCloseTo(0.65, 9);
    expect(head.z).toBeCloseTo(0.7, 9);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
    expect(fwd.z).toBeCloseTo(1, 6);
  });

  it('gulvhøyden følger mykt etter ved fysisk gange opp trinnet', () => {
    const { rig } = makeRig();
    for (let i = 0; i < 36; i++) followFloor(rig, 0.18, 1 / 72);
    expect(rig.position.y).toBeGreaterThan(0.17); // ca. 0,5 s
    for (let i = 0; i < 36; i++) followFloor(rig, 0.18, 1 / 72);
    expect(rig.position.y).toBeCloseTo(0.18, 3);
  });
});

describe('kontrollermodellen', () => {
  it('er én mesh (ett tegnekall) med kroppen og ringen i hver sin farge', () => {
    const m = controllerModel();
    expect(m.isMesh).toBe(true);
    expect(m.children).toHaveLength(0);
    expect(m.geometry.groups).toHaveLength(0);
    expect((m.material as THREE.MeshLambertMaterial).vertexColors).toBe(true);
    const col = m.geometry.getAttribute('color');
    const colours = new Set<string>();
    for (let i = 0; i < col.count; i++) colours.add(`${col.getX(i).toFixed(4)},${col.getY(i).toFixed(4)},${col.getZ(i).toFixed(4)}`);
    expect(colours.size).toBe(2);
    // Samme mål som før: kroppen 3,5 × 3 × 11 cm, ringen foran.
    m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox!;
    expect(b.max.z).toBeCloseTo(0.075, 3);
    expect(b.min.z).toBeLessThan(-0.07);
    expect(b.max.x - b.min.x).toBeCloseTo(0.092, 2);
  });
});

describe('ytelse', () => {
  it('hele leiligheten er få tegnekall og lite geometri', () => {
    const s = scene.stats();
    expect(s.meshes).toBeLessThanOrEqual(24);
    expect(s.triangles).toBeLessThan(50_000);
  });
});
