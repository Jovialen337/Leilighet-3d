/**
 * Takplan: y = a·x + b·z + c (alle i mm, y absolutt fra origo), tilpasset
 * med minste kvadraters metode til målte høydepunkter.
 */

export interface PlanePoint {
  x: number;
  z: number;
  y: number;
}

export interface CeilingPlane {
  a: number;
  b: number;
  c: number;
  /** Største avvik (mm) mellom planet og et målepunkt. 0 for nøyaktig 3 punkter. */
  maxResidual: number;
  /** true hvis punktene ligger på én linje (planet er da ikke bestemt). */
  degenerate: boolean;
}

export const planeY = (p: CeilingPlane, x: number, z: number): number => p.a * x + p.b * z + p.c;

/** Løser 3×3 lineært system med Cramers regel. Returnerer null hvis singulært. */
function solve3(m: number[][], r: number[]): [number, number, number] | null {
  const det = (q: number[][]): number =>
    q[0]![0]! * (q[1]![1]! * q[2]![2]! - q[1]![2]! * q[2]![1]!) -
    q[0]![1]! * (q[1]![0]! * q[2]![2]! - q[1]![2]! * q[2]![0]!) +
    q[0]![2]! * (q[1]![0]! * q[2]![1]! - q[1]![1]! * q[2]![0]!);
  const d = det(m);
  const scaleRef = Math.max(1, ...m.flat().map(Math.abs));
  if (Math.abs(d) < 1e-9 * scaleRef ** 3) return null;
  const col = (i: number): number[][] => m.map((row, k) => row.map((v, j) => (j === i ? r[k]! : v)));
  return [det(col(0)) / d, det(col(1)) / d, det(col(2)) / d];
}

/**
 * Største areal av en trekant utspent av punktene (mm²). Brukes til å avgjøre
 * om punktene ligger (nesten) på én linje.
 */
export function maxTriangleArea(points: readonly PlanePoint[]): number {
  let best = 0;
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      for (let k = j + 1; k < points.length; k++) {
        const p = points[i]!;
        const q = points[j]!;
        const r = points[k]!;
        const area = Math.abs((q.x - p.x) * (r.z - p.z) - (r.x - p.x) * (q.z - p.z)) / 2;
        best = Math.max(best, area);
      }
  return best;
}

/** Minste trekantareal (mm²) for at punktene skal regnes som et gyldig plan: 0,01 m². */
export const MIN_CEILING_TRIANGLE_AREA = 10_000;

export function fitCeilingPlane(points: readonly PlanePoint[]): CeilingPlane {
  const fallbackY = points.length ? points.reduce((s, p) => s + p.y, 0) / points.length : 2400;
  if (points.length < 3 || maxTriangleArea(points) < MIN_CEILING_TRIANGLE_AREA) {
    return { a: 0, b: 0, c: fallbackY, maxResidual: 0, degenerate: true };
  }
  // Sentrer for numerisk stabilitet.
  const mx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const mz = points.reduce((s, p) => s + p.z, 0) / points.length;
  let sxx = 0, sxz = 0, szz = 0, sx = 0, sz = 0, sy = 0, sxy = 0, szy = 0;
  for (const p of points) {
    const x = p.x - mx;
    const z = p.z - mz;
    sxx += x * x;
    sxz += x * z;
    szz += z * z;
    sx += x;
    sz += z;
    sy += p.y;
    sxy += x * p.y;
    szy += z * p.y;
  }
  const n = points.length;
  const sol = solve3(
    [
      [sxx, sxz, sx],
      [sxz, szz, sz],
      [sx, sz, n],
    ],
    [sxy, szy, sy],
  );
  if (!sol) return { a: 0, b: 0, c: fallbackY, maxResidual: 0, degenerate: true };
  const [a, b, c0] = sol;
  const c = c0 - a * mx - b * mz;
  const plane: CeilingPlane = { a, b, c, maxResidual: 0, degenerate: false };
  plane.maxResidual = Math.max(...points.map((p) => Math.abs(planeY(plane, p.x, p.z) - p.y)));
  return plane;
}
