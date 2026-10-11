/**
 * Legger modellen oppå det virkelige rommet fra to berøringer (meter, i
 * hodesettets referanserom):
 *
 *   q0 – det innvendige hjørnet ved inngangsdøra, nede ved gulvet (origo)
 *   q1 – et punkt lenger inn langs inngangsveggen (retningen til +x)
 *
 * Resultatet er en plassering av spillerriggen som gjør at verdensrommet
 * blir modellens koordinater (meter): origo i hjørnet, +x langs
 * inngangsveggen, y = 0 på gangens gulv.
 */
export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** Riggens plassering (three.js: rotation.y = yaw). */
export interface RigPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Minste avstand (m) mellom de to berøringene. */
export const MIN_ALIGN_DISTANCE = 0.5;

export type AlignResult = { ok: true; rig: RigPose } | { ok: false; message: string };

export function alignFromTouches(q0: V3, q1: V3): AlignResult {
  const dx = q1.x - q0.x;
  const dz = q1.z - q0.z;
  const d = Math.hypot(dx, dz);
  if (d < MIN_ALIGN_DISTANCE)
    return {
      ok: false,
      message: 'For nær hjørnet. Gå minst en meter langs inngangsveggen og berør veggen der.',
    };
  // Modellens +x skal peke langs (dx, dz): rotY(θ)·(1,0,0) = (cos θ, 0, −sin θ).
  const theta = Math.atan2(-dz, dx);
  // Riggen er den omvendte avbildningen: verden = rotY(−θ)·(p − q0).
  const yaw = -theta;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return {
    ok: true,
    rig: {
      x: -(q0.x * c + q0.z * s),
      y: -q0.y,
      z: -(-q0.x * s + q0.z * c),
      yaw,
    },
  };
}

/** Punkt fra referanserommet til verden (= modellen i meter) gitt riggens plassering. */
export function rigToWorld(rig: RigPose, p: V3): V3 {
  const c = Math.cos(rig.yaw);
  const s = Math.sin(rig.yaw);
  return { x: p.x * c + p.z * s + rig.x, y: p.y + rig.y, z: -p.x * s + p.z * c + rig.z };
}
