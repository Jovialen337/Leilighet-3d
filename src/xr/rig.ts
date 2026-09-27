/**
 * Spillerriggen: en gruppe som bærer VR-kameraet og kontrollerne. Å flytte
 * eller rotere riggen flytter brukeren i leiligheten; bevegelse i det fysiske
 * rommet (room-scale) kommer i tillegg via hodesettets posisjon i riggen.
 */
import * as THREE from 'three';

const Y = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();

/** Yaw (rad) som får (0, 0, -1) til å peke langs (x, z). */
export const yawOfForward = (x: number, z: number): number => Math.atan2(-x, -z);

/** Roterer riggen `angle` radianer om en loddrett akse gjennom hodet. Positiv = mot klokka ovenfra. */
export function snapTurn(rig: THREE.Object3D, head: THREE.Vector3, angle: number): void {
  _v.copy(rig.position).sub(head);
  _v.y = 0;
  _v.applyAxisAngle(Y, angle);
  rig.position.set(head.x + _v.x, rig.position.y, head.z + _v.z);
  rig.rotation.y += angle;
  rig.updateMatrixWorld(true);
}

/** Flytter riggen så hodet står rett over `target`, og føttene på target.y. */
export function teleportTo(rig: THREE.Object3D, head: THREE.Vector3, target: THREE.Vector3): void {
  rig.position.x += target.x - head.x;
  rig.position.z += target.z - head.z;
  rig.position.y = target.y;
  rig.updateMatrixWorld(true);
}

/**
 * Plasserer riggen så hodet står på `spawn` (meter) og ser i retning `facing`,
 * uansett hvor i det fysiske rommet og hvilken vei brukeren sto ved oppstart.
 */
export function placeAtSpawn(
  rig: THREE.Object3D,
  headLocal: THREE.Vector3,
  headLocalQuat: THREE.Quaternion,
  spawn: THREE.Vector3,
  facing: { x: number; z: number },
): void {
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(headLocalQuat);
  const headYaw = Math.hypot(fwd.x, fwd.z) > 1e-3 ? yawOfForward(fwd.x, fwd.z) : 0;
  const yaw = yawOfForward(facing.x, facing.z) - headYaw;
  rig.rotation.set(0, yaw, 0);
  const off = new THREE.Vector3(headLocal.x, 0, headLocal.z).applyAxisAngle(Y, yaw);
  rig.position.set(spawn.x - off.x, spawn.y, spawn.z - off.z);
  rig.updateMatrixWorld(true);
}

/** Myk justering av riggens høyde mot gulvnivået under hodet (trinn opp/ned). */
export function followFloor(rig: THREE.Object3D, targetY: number, dt: number, rate = 14): void {
  const diff = targetY - rig.position.y;
  if (Math.abs(diff) < 0.0005) rig.position.y = targetY;
  else rig.position.y += diff * (1 - Math.exp(-rate * dt));
  rig.updateMatrixWorld(true);
}
