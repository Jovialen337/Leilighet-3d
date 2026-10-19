/**
 * Hvor mye teksturminne scenen bruker (for budsjettet: maks 32 MB på
 * «Standard»). Teller hver tekstur én gang: bredde × høyde × lag × byte per
 * piksel (1 for gråtoner, ellers 4), og en tredjedel ekstra for mipmaps.
 * `extra`: teksturer som ligger i delte uniformer (f.eks. mønsteret på gulvet).
 */
import * as THREE from 'three';

export function textureBytes(root: THREE.Object3D, extra: readonly (THREE.Texture | null)[] = []): number {
  const seen = new Set<THREE.Texture>();
  for (const t of extra) if (t) seen.add(t);
  const add = (v: unknown): void => {
    if (v instanceof THREE.Texture) seen.add(v);
  };
  root.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      for (const v of Object.values(m)) add(v);
      const uniforms = (m as THREE.ShaderMaterial).uniforms;
      if (uniforms) for (const u of Object.values(uniforms)) add(u?.value);
    }
  });
  let bytes = 0;
  for (const t of seen) {
    const img = t.image as { width?: number; height?: number; depth?: number } | undefined;
    if (!img?.width || !img.height) continue;
    const texel = t.format === THREE.RedFormat ? 1 : 4;
    bytes += img.width * img.height * (img.depth ?? 1) * texel * (t.generateMipmaps ? 4 / 3 : 1);
  }
  return Math.round(bytes);
}
