import * as THREE from 'three';
import { Surface, madeOf } from '../render/styles.ts';

/**
 * Hand-painted textures for the pirate test map, worked out pixel by pixel when the map is built
 * (no image files): warm wood with long grain and dark streaks, boards with dark seams and lit
 * upper edges, mottled plaster, scratched iron, brushed stone, and stained sailcloth. They tile,
 * and are laid on at a fixed size in the world (see `shape.ts`), so a long beam shows more grain
 * rather than a stretched one.
 *
 * The materials they go on are left out of the game's own painted style (`Surface.None`): these
 * textures are the paint.
 */

/** A value in [0, 1) for a lattice point, the same every time. */
function hash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const wrap = (i: number, p: number) => ((i % p) + p) % p;
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Smooth noise repeating every `px` × `py`. */
function noise(x: number, y: number, px: number, py: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const [x0, x1, y0, y1] = [wrap(ix, px), wrap(ix + 1, px), wrap(iy, py), wrap(iy + 1, py)];
  const a = hash(x0, y0, seed);
  const b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed);
  const d = hash(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Layered noise in [0, 1], `fx` × `fy` cells across the tile at its coarsest. */
function fbm(u: number, v: number, fx: number, fy: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const k = 2 ** o;
    sum += amp * noise(u * fx * k, v * fy * k, fx * k, fy * k, seed + o * 17);
    total += amp;
    amp *= 0.5;
  }
  return sum / total;
}

type RGB = [number, number, number];
const rgb = (hex: number): RGB => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const mix = (a: RGB, b: RGB, t: number): RGB => {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
};
const scale = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const step = (e0: number, e1: number, x: number) =>
  smooth(Math.max(0, Math.min(1, (x - e0) / (e1 - e0))));

/** A tile `size` pixels square painted by `at(u, v)` (each 0 to 1), as an sRGB texture. */
function texture(size: number, at: (u: number, v: number) => RGB): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const c = at(x / size, y / size);
      const i = (y * size + x) * 4;
      data[i] = Math.max(0, Math.min(255, c[0]));
      data[i + 1] = Math.max(0, Math.min(255, c[1]));
      data[i + 2] = Math.max(0, Math.min(255, c[2]));
      data[i + 3] = 255;
    }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Wood with its grain along u: broad soft strokes of weathered brown, faint streaks, the odd knot. */
function woodAt(seed: number): (u: number, v: number) => RGB {
  const dark = rgb(0x4d3a2b);
  const mid = rgb(0x9c7a58);
  const light = rgb(0xc9a77c);
  const knots = Array.from({ length: 3 }, (_, i) => [
    hash(i, 1, seed),
    hash(i, 2, seed),
    0.02 + 0.02 * hash(i, 3, seed),
  ]);
  return (u, v) => {
    const broad = fbm(u, v, 2, 5, seed, 3);
    const grain = fbm(u, v, 2, 26, seed + 5, 4);
    let c = mix(mix(dark, mid, 0.45 + broad * 0.8), light, (grain - 0.55) * 1.5);
    // Long thin dark lines along the grain.
    const lines = fbm(u, v, 3, 9, seed + 9, 3) * 9;
    const line = Math.abs((lines % 1) - 0.5);
    c = scale(c, 0.8 + 0.2 * step(0.0, 0.05, line));
    for (const [ku, kv, kr] of knots) {
      let du = Math.abs(u - ku!);
      let dv = Math.abs(v - kv!);
      du = Math.min(du, 1 - du);
      dv = Math.min(dv, 1 - dv);
      const d = Math.hypot(du / 2.4, dv) / kr!;
      if (d < 1.6) {
        const ring = 0.5 + 0.5 * Math.cos(d * 9);
        c = mix(c, scale(dark, 0.9), (1 - step(0.5, 1.6, d)) * (0.45 + 0.4 * ring));
      }
    }
    return c;
  };
}

/** Boards side by side (four to a tile, across v), grain along u, dark seams, lit upper edges. */
function boardsAt(seed: number): (u: number, v: number) => RGB {
  const grain = woodAt(seed);
  return (u, v) => {
    const k = v * 4;
    const board = Math.floor(k);
    const f = k - board;
    // Each board slid along and tinted a little its own way.
    const shift = hash(board, 7, seed);
    let c = grain((u + shift) % 1, (v + shift * 0.37) % 1);
    c = scale(c, 0.86 + 0.26 * hash(board, 3, seed));
    // A dark seam, a lit edge above it, a shaded one below.
    c = scale(c, 0.35 + 0.65 * step(0.0, 0.05, f));
    c = mix(c, scale(rgb(0xd4b088), 1.0), (1 - step(0.05, 0.13, f)) * 0.55 * step(0.0, 0.05, f));
    c = scale(c, 1 - 0.3 * step(0.8, 1.0, f));
    return c;
  };
}

/** Plaster: cream, mottled with cool grey-green and warm patches, soft brushed strokes. */
function plasterAt(seed: number): (u: number, v: number) => RGB {
  const base = rgb(0xddd3b6);
  const cool = rgb(0xb6b6a6);
  const warm = rgb(0xece2c6);
  return (u, v) => {
    const big = fbm(u, v, 3, 3, seed, 4);
    const strokes = fbm(u, v, 6, 2, seed + 3, 3);
    let c = mix(base, cool, (big - 0.45) * 2.2);
    c = mix(c, warm, (strokes - 0.55) * 2.5);
    const fleck = noise(u * 90, v * 90, 90, 90, seed + 11);
    return scale(c, 0.96 + 0.06 * fleck);
  };
}

/** Iron: mid grey, mottled, with pale scratches and darker pits. */
function ironAt(seed: number): (u: number, v: number) => RGB {
  const base = rgb(0x8c8e8e);
  const dark = rgb(0x606366);
  const pale = rgb(0xc4c6c4);
  return (u, v) => {
    const m = fbm(u, v, 4, 4, seed, 4);
    let c = mix(dark, base, 0.3 + m * 1.2);
    const s = fbm(u, v, 2, 14, seed + 4, 3);
    c = mix(c, pale, step(0.66, 0.72, s) * 0.6);
    const pit = noise(u * 40, v * 40, 40, 40, seed + 8);
    return scale(c, pit > 0.82 ? 0.75 : 1);
  };
}

/** Stone: warm pale grey, broad flat brush strokes, lighter and darker. */
function stoneAt(seed: number): (u: number, v: number) => RGB {
  const base = rgb(0xc6c4bc);
  const light = rgb(0xe0ded6);
  const dark = rgb(0x9a9ea4);
  return (u, v) => {
    const a = fbm(u, v, 3, 5, seed, 4);
    const b = fbm(u, v, 6, 2, seed + 2, 3);
    let c = mix(base, light, (a - 0.5) * 1.4);
    c = mix(c, dark, (b - 0.64) * 1.3);
    const spot = noise(u * 30, v * 30, 30, 30, seed + 6);
    return scale(c, 0.97 + 0.05 * spot);
  };
}

/** Sailcloth: near white (stripes come from vertex colours), stains, seams and patches. */
function clothAt(seed: number): (u: number, v: number) => RGB {
  const white = rgb(0xffffff);
  const stain = rgb(0xb79a78);
  return (u, v) => {
    const s = fbm(u, v, 3, 3, seed, 4);
    let c = mix(white, stain, (s - 0.5) * 1.8);
    const weave = 0.97 + 0.03 * noise(u * 120, v * 120, 120, 120, seed + 1);
    c = scale(c, weave);
    // Seams across the cloth.
    const seam = Math.abs(((v * 6) % 1) - 0.5);
    return scale(c, 0.86 + 0.14 * step(0.0, 0.03, 0.5 - seam));
  };
}

/** Leaves: bright yellow-green with darker veins along u and a lit sheen. */
function leafAt(seed: number): (u: number, v: number) => RGB {
  const base = rgb(0xb4cc3c);
  const dark = rgb(0x557c1e);
  const light = rgb(0xe2ec64);
  return (u, v) => {
    const a = fbm(u, v, 2, 6, seed, 3);
    let c = mix(dark, base, 0.4 + a);
    c = mix(c, light, (fbm(u, v, 4, 4, seed + 3, 3) - 0.6) * 2.5);
    const vein = Math.abs(((v * 10 + fbm(u, v, 3, 3, seed + 7, 2) * 0.6) % 1) - 0.5);
    return scale(c, 0.85 + 0.15 * step(0.0, 0.1, vein));
  };
}

/** Moss and bush leaves: lumpy greens, dark between, sunlit tips. */
function mossAt(seed: number): (u: number, v: number) => RGB {
  const dark = rgb(0x34561c);
  const mid = rgb(0x6c9030);
  const light = rgb(0xb0c650);
  return (u, v) => {
    const a = fbm(u, v, 8, 8, seed, 4);
    const b = noise(u * 24, v * 24, 24, 24, seed + 2);
    return mix(mix(dark, mid, a * 1.6), light, (b - 0.6) * 2.4);
  };
}

export type Paint = 'wood' | 'boards' | 'plaster' | 'iron' | 'stone' | 'cloth' | 'leaf' | 'moss';

const PAINTERS: Record<Paint, [number, (seed: number) => (u: number, v: number) => RGB]> = {
  wood: [256, woodAt],
  boards: [256, boardsAt],
  plaster: [256, plasterAt],
  iron: [128, ironAt],
  stone: [256, stoneAt],
  cloth: [256, clothAt],
  leaf: [128, leafAt],
  moss: [128, mossAt],
};

/** How many metres each texture's tile covers in the world (see `shape.ts`). */
export const TILE: Record<Paint, number> = {
  wood: 1.6,
  boards: 1.4,
  plaster: 2.2,
  iron: 0.6,
  stone: 4,
  cloth: 3,
  leaf: 1.2,
  moss: 1,
};

const textures = new Map<Paint, THREE.DataTexture>();

/** The texture `paint`, painted the first time it is asked for. */
export function paintTexture(paint: Paint): THREE.DataTexture {
  let t = textures.get(paint);
  if (!t) {
    const [size, painter] = PAINTERS[paint];
    textures.set(paint, (t = texture(size, painter(Object.keys(PAINTERS).indexOf(paint) + 3))));
  }
  return t;
}

export interface PaintOptions {
  roughness?: number;
  metalness?: number;
  side?: THREE.Side;
  emissive?: number;
  emissiveIntensity?: number;
  /** Brighter (or darker) than the texture by this much, past what a tint can say. */
  bright?: number;
}

const materials = new Map<string, THREE.MeshStandardMaterial>();

/**
 * A material painted with `paint`, tinted `tint`, shaded by its parts' vertex colours (their
 * worn edges and the shade low down, see `shape.ts`). Shared between parts that are alike.
 */
export function painted(
  paint: Paint,
  tint = 0xffffff,
  o: PaintOptions = {},
): THREE.MeshStandardMaterial {
  const key = JSON.stringify([paint, tint, o]);
  let m = materials.get(key);
  if (!m) {
    m = madeOf(
      new THREE.MeshStandardMaterial({
        map: paintTexture(paint),
        color: tint,
        vertexColors: true,
        roughness: o.roughness ?? 0.82,
        metalness: o.metalness ?? 0,
        side: o.side ?? THREE.FrontSide,
        emissive: o.emissive ?? 0x000000,
        emissiveIntensity: o.emissiveIntensity ?? 1,
      }),
      Surface.None,
    );
    m.color.multiplyScalar(o.bright ?? 1);
    m.userData.paint = paint;
    materials.set(key, m);
  }
  return m;
}
