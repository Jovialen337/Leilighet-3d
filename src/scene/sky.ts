/**
 * Himmel og mark rundt leiligheten (synlig gjennom vinduene og utenfra på
 * laptopen). To billige tegnekall som tegnes etter alt annet, så bare synlige
 * piksler fargelegges:
 *
 * - Kuppelen: fargeovergang fra horisont til senit, glød og solskive der sola
 *   står, skyer (ett lite tekstur-lerret laget i koden) og fjerne åser og
 *   skog langs horisonten (regnet ut i skyggeleggeren – ingen geometri).
 * - Markskiva: gress med litt ujevnhet (liten flislagt tekstur).
 *
 * Fargene følger «Lys» (morgen/dag/kveld/natt); om natta er det stjerner
 * (små punkter regnet ut i skyggeleggeren). Teksturene lages første gang
 * himmelen vises (ikke på «Rask»). Skjules i 2D-planen og i gjennomsyn.
 */
import * as THREE from 'three';
import type { LightPreset } from './lighting';

export const SKY = {
  radius: 150,
  ground: '#b3bea4',
  groundEdge: '#dfe6e2',
  /** Skyteksturen (bredde × høyde) og markteksturen (kvadrat). */
  cloudSize: [1024, 512] as const,
  grassSize: 256,
  /** Hvor mange ganger gressteksturen gjentas over skiva. */
  grassRepeat: 48,
} as const;

const VERT = /* glsl */ `
varying vec3 vDir;
varying vec2 vUv;
void main() {
  vDir = position;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 glow;
uniform vec3 hills;
uniform vec3 cloudTint;
uniform vec3 sunDir;
uniform sampler2D clouds;
uniform float cloudAmount;
uniform float stars;
varying vec3 vDir;
varying vec2 vUv;

float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
// Glatt støy som går rundt (periode i heltall), så det ikke blir en søm.
float pnoise(float x, float period) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash(mod(i, period)), hash(mod(i + 1.0, period)), f);
}

void main() {
  vec3 d = normalize(vDir);
  float e = d.y;
  vec3 col = mix(horizon, zenith, pow(clamp(e, 0.0, 1.0), 0.5));
  // Glød rundt sola og selve solskiva.
  float s = max(dot(d, sunDir), 0.0);
  col += glow * (0.28 * pow(s, 6.0) + 0.55 * pow(s, 90.0));
  // Skyer (tettere mot horisonten, borte under den).
  vec4 c = texture2D(clouds, vUv);
  float ca = c.a * cloudAmount * smoothstep(0.0, 0.08, e);
  vec3 cloud = cloudTint * (0.82 + 0.18 * c.r) + glow * 0.25 * pow(s, 4.0);
  col = mix(col, cloud, ca);
  col = mix(col, vec3(1.0, 0.97, 0.9) * 1.15, smoothstep(0.99955, 0.9998, s) * (1.0 - ca));
  // Stjerner (om natta): én av få ruter i et rutenett over himmelen får et punkt, omtrent 1,5 piksel stort.
  vec2 g = d.xz / (1.0 + max(e, 0.0)) * 180.0;
  float px = max(fwidth(g.x), 1e-4);
  if (stars > 0.0 && e > 0.02) {
    vec2 cell = floor(g);
    float n = hash(cell.x * 157.0 + cell.y * 113.0 + 0.5);
    if (n > 0.98) {
      vec2 at = vec2(hash(n * 31.0), hash(n * 57.0)) * 0.6 + 0.2;
      float r = length(fract(g) - at);
      float b = (1.0 - smoothstep(0.0, 1.5 * px, r)) * (0.45 + 0.55 * hash(n * 91.0));
      col += vec3(0.9, 0.93, 1.0) * b * stars * (1.0 - ca) * smoothstep(0.02, 0.12, e);
    }
  }
  // Fjerne åser og en skogkant langs horisonten.
  float a = (atan(d.z, d.x) + 3.14159265) / 6.2831853;
  float h = 0.012 + 0.03 * pnoise(a * 5.0, 5.0) + 0.014 * pnoise(a * 17.0, 17.0);
  float trees = h + 0.006 + 0.007 * pnoise(a * 420.0, 420.0) + 0.004 * pnoise(a * 1300.0, 1300.0);
  float aa = max(fwidth(e), 1e-4) * 1.5;
  vec3 far = mix(hills, horizon, 0.45);
  vec3 near = hills * 0.8;
  col = mix(col, far, 1.0 - smoothstep(h - aa, h + aa, e));
  col = mix(col, near, (1.0 - smoothstep(trees - aa, trees + aa, e)) * smoothstep(-0.02, h, e) * 0.85);
  if (e < 0.0) col = near;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** Liten deterministisk tilfeldighetsgenerator, så himmelen ser lik ut hver gang. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Skyer i en ekvirektangulær tekstur (u = rundt, v = fra bunnen av kuppelen
 * til toppen). Hver sky er en klynge myke flekker, bredere høyt oppe der
 * teksturen strekkes mindre rundt.
 */
function cloudTexture(): THREE.Texture | null {
  const [W, H] = SKY.cloudSize;
  const cv = canvas(W, H);
  const ctx = cv?.getContext('2d');
  if (!cv || !ctx) return null;
  const rand = rng(7);
  const thetaLength = Math.PI / 2 + 0.15;
  ctx.clearRect(0, 0, W, H);
  const blob = (x: number, y: number, rx: number, ry: number, a: number): void => {
    for (const dx of [-W, 0, W]) {
      const g = ctx.createRadialGradient(x + dx, y, 0, x + dx, y, rx);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(0.55, `rgba(235,235,235,${a * 0.6})`);
      g.addColorStop(1, 'rgba(220,220,220,0)');
      ctx.save();
      ctx.translate(x + dx, y);
      ctx.scale(1, ry / rx);
      ctx.translate(-(x + dx), -y);
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - rx, y - rx, rx * 2, rx * 2);
      ctx.restore();
    }
  };
  for (let i = 0; i < 46; i++) {
    // Høyde over horisonten 4–45°, flest lavt.
    const elev = (4 + 41 * Math.pow(rand(), 1.6)) * (Math.PI / 180);
    // Øverste rad i lerretet er senit (v = 1); raden går ned med vinkelen fra senit.
    const y = ((Math.PI / 2 - elev) / thetaLength) * H;
    const stretch = 1 / Math.max(0.25, Math.cos(elev));
    const cx = rand() * W;
    const size = (14 + 30 * rand()) * stretch;
    const n = 5 + Math.floor(rand() * 7);
    for (let k = 0; k < n; k++) {
      const ox = (rand() - 0.5) * size * 2.6;
      const oy = (rand() - 0.5) * size * 0.35;
      const r = size * (0.5 + 0.6 * rand());
      blob(cx + ox, y + oy, r, (r * 0.42) / stretch, 0.32 + 0.3 * rand());
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Gress: lys og mørk ujevnhet rundt 1,0 (ganges med markfargene). */
function grassTexture(): THREE.Texture | null {
  const N = SKY.grassSize;
  const cv = canvas(N, N);
  const ctx = cv?.getContext('2d');
  if (!cv || !ctx) return null;
  const rand = rng(3);
  const img = ctx.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    const v = 236 + Math.floor(rand() * 19);
    img.data[i * 4] = v - 6;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v - 10;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // Litt større flekker (tuer og jordflekker).
  for (let i = 0; i < 420; i++) {
    const x = rand() * N;
    const y = rand() * N;
    const r = 1 + rand() * 3.5;
    const dark = rand() < 0.5;
    ctx.fillStyle = dark ? 'rgba(90,110,60,0.07)' : 'rgba(255,255,230,0.07)';
    for (const dx of [-N, 0, N])
      for (const dy of [-N, 0, N]) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(SKY.grassRepeat, SKY.grassRepeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createSky(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'himmel';

  const dome = new THREE.SphereGeometry(SKY.radius, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2 + 0.15);
  const material = new THREE.ShaderMaterial({
    name: 'himmel',
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      zenith: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      glow: { value: new THREE.Color() },
      hills: { value: new THREE.Color() },
      cloudTint: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      clouds: { value: null },
      cloudAmount: { value: 0 },
      stars: { value: 0 },
    },
  });
  const domeMesh = new THREE.Mesh(dome, material);
  domeMesh.name = 'himmel:kuppel';
  domeMesh.renderOrder = 2; // etter marka og modellen: bare synlige piksler fargelegges
  domeMesh.frustumCulled = false;

  const disc = new THREE.CircleGeometry(SKY.radius, 64).rotateX(-Math.PI / 2);
  const dp = disc.getAttribute('position');
  const dc = new Float32Array(dp.count * 3);
  const g0 = new THREE.Color(SKY.ground);
  const g1 = new THREE.Color(SKY.groundEdge);
  const c = new THREE.Color();
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

/** Lager teksturene (skyer og gress) første gang himmelen skal vises. */
export function prepareSky(sky: THREE.Group): void {
  if (sky.userData.prepared) return;
  sky.userData.prepared = true;
  const dome = sky.getObjectByName('himmel:kuppel') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | undefined;
  const ground = sky.getObjectByName('himmel:mark') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | undefined;
  const clouds = cloudTexture();
  if (dome && clouds) {
    dome.material.uniforms.clouds!.value = clouds;
    dome.material.uniforms.cloudAmount!.value = 1;
  }
  const grass = grassTexture();
  if (ground && grass) {
    ground.material.map = grass;
    ground.material.needsUpdate = true;
  }
}

/** Fargene på himmelen og marka etter «Lys». */
export function setSkyLight(sky: THREE.Group, p: LightPreset): void {
  const dome = sky.getObjectByName('himmel:kuppel') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | undefined;
  if (dome) {
    const u = dome.material.uniforms;
    (u.zenith!.value as THREE.Color).set(p.sky.zenith);
    (u.horizon!.value as THREE.Color).set(p.sky.horizon);
    (u.glow!.value as THREE.Color).set(p.sky.glow);
    (u.hills!.value as THREE.Color).set(p.sky.hills);
    (u.cloudTint!.value as THREE.Color).set(p.sky.clouds);
    (u.sunDir!.value as THREE.Vector3).set(...p.key.from).normalize();
    u.stars!.value = p.night;
  }
  const ground = sky.getObjectByName('himmel:mark') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | undefined;
  // Marka får litt av lysets farge og styrke (mørkere og varmere om kvelden).
  if (ground)
    ground.material.color
      .set(p.key.color)
      .lerp(new THREE.Color('#ffffff'), 0.6)
      .multiplyScalar(Math.min(1, 0.45 + p.hemi.intensity / 4.3) * (1 - 0.8 * p.night));
}

/** Legger marka like under det laveste (uteområder/gulv), i meter. */
export function setGroundLevel(sky: THREE.Group, y: number): void {
  const ground = sky.getObjectByName('himmel:mark');
  if (ground) ground.position.y = y;
}
