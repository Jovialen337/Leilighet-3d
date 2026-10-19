/**
 * Overflater på gulvet: tregulv med bord, fuger og årer, fliser i rom med
 * sluk, og et rolig belegg (vinyl) på andre gulv. Uten mønster ser flate
 * farger like ut på alle avstander; med et lite mønster ser øynene dybden og
 * størrelsen i VR.
 *
 * - Mønsteret er gråtoner rundt 0,5 (0,5 = fargen fra fila), laget i koden
 *   (ingen bildefiler) i én liten tekstur med tre lag (tre, fliser, belegg),
 *   med mipmaps så det ikke flimrer på avstand.
 * - Hvert hjørne i gulvet får et tall for overflaten (`surf`); skyggeleggeren
 *   (materials.ts) ganger fargen med mønsteret, lagt ut i verdenskoordinater.
 * - Hvilken overflate et gulv får, er presentasjon: rom med sluk får fliser,
 *   gulv med trefarge (brunt nok) får tregulv, resten belegg.
 */
import * as THREE from 'three';
import type { ApartmentModel } from '../model/ApartmentModel';
import { pointInPolygon, polygonGap, p2 } from '../geometry/math2d';

/** Overflatene (verdien i `surf`; lag i teksturen = verdi − 1). */
export const SURF = { none: 0, wood: 1, tile: 2, vinyl: 3 } as const;
export type Surf = (typeof SURF)[keyof typeof SURF];

export const DETAIL = {
  /** Teksturens størrelse (piksler per side) og hvor mange meter den dekker. */
  size: 1024,
  woodMeters: 2.4,
  tileMeters: 1.2,
  vinylMeters: 1.2,
  /** Bordbredde og -lengde, og flisene (mm). */
  plank: 150,
  plankLength: 1200,
  tile: 200,
  /** Fugebredde (mm). */
  seam: 2,
  grout: 3,
  /** Hvor mye mønsteret endrer fargen (0 = ingenting, 1 = fullt). */
  amount: 1,
} as const;

/** Faste tilfeldige tall (0–1), så mønsteret blir likt hver gang og lages raskt. */
const RANDOM = (() => {
  const t = new Float32Array(4096);
  let s = 0x2545f491;
  for (let i = 0; i < t.length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    t[i] = (s >>> 0) / 4294967296;
  }
  return t;
})();

/** Et tall 0–1 for et heltall. */
const hash = (n: number): number => RANDOM[Math.imul(n | 0, 0x9e3779b1) >>> 20]!;

/** Glatt støy langs én akse med periode `period` (heltall). */
function noise1(x: number, period: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const t = f * f * (3 - 2 * f);
  const a = hash((((i % period) + period) % period) + seed * 4099);
  const b = hash(((((i + 1) % period) + period) % period) + seed * 4099);
  return a + (b - a) * t;
}

/** Hvor langt (mm) fra nærmeste linje i et rutenett med avstand `step`. */
const gridDist = (v: number, step: number): number => {
  const m = ((v % step) + step) % step;
  return Math.min(m, step - m);
};

/** Mørkere fuge: 1 utenfor, `depth` midt i, mykt over én piksel. */
const seam = (d: number, half: number, px: number, depth: number): number => {
  const t = Math.min(1, Math.max(0, (d - half) / px + 0.5));
  return depth + (1 - depth) * t;
};

/**
 * Mønstrene som gråtoner (0–255, 128 = uendret farge), lag for lag:
 * [tre, fliser], hvert `size × size`. Fliser sømløst.
 */
export function detailLayers(size: number = DETAIL.size): Uint8Array {
  const out = new Uint8Array(size * size * 3);
  const put = (i: number, val: number): void => {
    out[i] = val <= 0 ? 0 : val >= 1 ? 255 : (val * 255 + 0.5) | 0;
  };
  // Tregulv: bord langs x, skjøtene forskjøvet fra rad til rad.
  const wmm = DETAIL.woodMeters * 1000;
  const rows = Math.round(wmm / DETAIL.plank);
  const pxW = wmm / size;
  const wave = new Float32Array(size);
  const fine = new Float32Array(size);
  const joint = new Float32Array(size);
  const plankOf = new Int32Array(size);
  let current = -1;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * pxW;
    const row = Math.floor(v / DETAIL.plank) % rows;
    const across = v - row * DETAIL.plank;
    const rowSeam = seam(gridDist(v, DETAIL.plank), DETAIL.seam / 2, pxW, 0.62);
    // Det som bare avhenger av plassen langs bordet, regnes ut én gang per bordrad.
    if (row !== current) {
      current = row;
      const shift = hash(row + 7) * wmm;
      for (let x = 0; x < size; x++) {
        const along = ((x + 0.5) * pxW + shift) % wmm;
        wave[x] = noise1(along / 90, Math.round(wmm / 90), row) * 6;
        fine[x] = noise1(along / 25, Math.round(wmm / 25), row + 3) - 0.5;
        joint[x] = seam(gridDist(along, DETAIL.plankLength), DETAIL.seam / 2, pxW, 0.62);
        plankOf[x] = Math.floor(along / DETAIL.plankLength);
      }
    }
    for (let x = 0; x < size; x++) {
      // Hvert bord har sin egen tone; årene er tynne striper som bølger litt.
      const tone = 0.5 + 0.11 * (hash(row * 31 + plankOf[x]! * 17 + 1) - 0.5);
      const grain = Math.sin((across + wave[x]!) * 0.32 + row) * 0.5;
      put(y * size + x, (tone + 0.07 * grain + 0.05 * fine[x]!) * rowSeam * joint[x]!);
    }
  }
  // Fliser: 200 mm med fuger, svakt ulike fliser og litt prikkete overflate.
  const tmm = DETAIL.tileMeters * 1000;
  const pxT = tmm / size;
  const base = size * size;
  const colDist = new Float32Array(size);
  const colId = new Int32Array(size);
  for (let x = 0; x < size; x++) {
    const u = (x + 0.5) * pxT;
    colDist[x] = gridDist(u, DETAIL.tile);
    colId[x] = Math.floor(u / DETAIL.tile);
  }
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * pxT;
    const rowDist = gridDist(v, DETAIL.tile);
    const rowId = Math.floor(v / DETAIL.tile);
    for (let x = 0; x < size; x++) {
      const tone = 0.52 + 0.05 * (hash(colId[x]! * 7 + rowId * 13 + 2) - 0.5) + 0.03 * (hash(x * 977 + y * 131) - 0.5);
      put(base + y * size + x, tone * seam(Math.min(colDist[x]!, rowDist), DETAIL.grout / 2, pxT, 0.72));
    }
  }
  // Belegg: rolige, store skyer og fine prikker (ingen linjer).
  const vbase = 2 * size * size;
  // Glatt støy som går rundt: et rutenett med tilfeldige tall, glatt mellom punktene.
  const lattice = (c: number, k: number): Float32Array => {
    const g = new Float32Array(c * c);
    for (let j = 0; j < c; j++) for (let i = 0; i < c; i++) g[j * c + i] = hash(i * 131 + j * 7919 + k * 104729);
    return g;
  };
  const layers = [
    { c: 8, amp: 0.06, g: lattice(8, 0) },
    { c: 32, amp: 0.035, g: lattice(32, 1) },
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let val = 0.5 + 0.03 * (hash(x * 977 + y * 131 + 7) - 0.5);
      for (const { c, amp, g } of layers) {
        const fx = (x / size) * c;
        const fy = (y / size) * c;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = fx - ix;
        const ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const i1 = (ix + 1) % c;
        const j1 = (iy + 1) % c;
        const a = g[iy * c + ix]! + (g[iy * c + i1]! - g[iy * c + ix]!) * sx;
        const b = g[j1 * c + ix]! + (g[j1 * c + i1]! - g[j1 * c + ix]!) * sx;
        val += amp * (a + (b - a) * sy - 0.5);
      }
      put(vbase + y * size + x, val);
    }
  }
  return out;
}

/** Teksturen med alle lagene (mipmaps, skarp på skrå med anisotropi). */
export function detailTexture(): THREE.DataArrayTexture {
  const size = DETAIL.size;
  const tex = new THREE.DataArrayTexture(detailLayers(size), size, size, 3);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Ser fargen ut som tre (brun-gul tone, ikke grå)? */
export function woodLike(hex: string): boolean {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(hex).getHSL(hsl);
  const deg = hsl.h * 360;
  return deg >= 15 && deg <= 50 && hsl.s > 0.18 && hsl.l > 0.2 && hsl.l < 0.85;
}

/**
 * Overflaten på gulvet i et rom: fliser der det er sluk i gulvet – også i en
 * del av rommet uten vegg imellom (f.eks. badets hevede del) – tre der
 * gulvfargen ser ut som tre, ellers belegg.
 */
export function floorSurface(model: ApartmentModel, roomId: string, defaultColor = '#b5a48f'): Surf {
  const info = model.rooms.get(roomId);
  if (!info) return SURF.none;
  const wet = [...model.rooms.values()].filter((r) => r === info || polygonGap(r.polygon, info.polygon) < 5);
  for (const fx of model.data.fixtures) {
    if (fx.type !== 'drain') continue;
    const pl = model.fixturePlacement(fx);
    if (pl && wet.some((r) => pointInPolygon(p2(pl.x, pl.z), r.polygon))) return SURF.tile;
  }
  return woodLike(info.room.floorColor ?? defaultColor) ? SURF.wood : SURF.vinyl;
}
