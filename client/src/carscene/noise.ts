/**
 * The car scene's noise, which its painted textures and mottles are made of: on its own, so the
 * workers that paint the big textures (see `paint.ts`) take nothing of the scene's but this.
 */

/** A value in [0, 1) for a lattice point, the same every time. */
export function hash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Most lattice points are in the first repeat already: those skip the division.
const wrap = (i: number, p: number) => (i >= 0 && i < p ? i : ((i % p) + p) % p);
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Smooth noise repeating every `p` cells. */
export function noise(x: number, y: number, p: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  // Named one by one, not unpacked from an array: there are millions of calls to a texture.
  const x0 = wrap(ix, p);
  const x1 = wrap(ix + 1, p);
  const y0 = wrap(iy, p);
  const y1 = wrap(iy + 1, p);
  const a = hash(x0, y0, seed);
  const b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed);
  const d = hash(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Layered noise in [0, 1], `cells` across the tile at its coarsest, tiling. */
export function fbm(u: number, v: number, cells: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const k = cells * 2 ** o;
    sum += amp * noise(u * k, v * k, k, seed + o * 17);
    total += amp;
    amp *= 0.5;
  }
  return sum / total;
}
