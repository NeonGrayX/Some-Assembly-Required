import { fbm, hash, noise } from './noise.ts';
import type { StreetPlan } from './street.ts';

/**
 * The car scene's big painted textures, the moss of its cobbled patches, the road's asphalt, the
 * pavements' slabs, and a map's gravelled lot and lawns, millions of pixels and seconds of work each: painted from a `PaintJob`,
 * which says all a texture is painted from and can be sent as it is to a worker, so that they
 * are painted off the main thread (see `paintedOnce`). Nothing here but the noise they are made
 * of, so that is all a worker takes in.
 */

/** A rectangle on the ground: x0, z0, its width along x and depth along z. */
export type Rect = [number, number, number, number];

/** What of the street's plan the road's paint is laid out by. */
export type RoadMarks = Pick<StreetPlan, 'north' | 'south' | 'middle' | 'crossing' | 'bays'>;

/** All a big texture is painted from. */
export type PaintJob =
  | { kind: 'moss'; outline: [number, number][]; rect: Rect; perMetre: number }
  | {
      kind: 'asphalt';
      marks: RoadMarks;
      outline: [number, number][];
      rect: Rect;
      perMetre: number;
    }
  | { kind: 'paving'; w: number; d: number; perMetre: number; seed: number }
  | {
      kind: 'gravel';
      outline: [number, number][];
      /** The middles of the tracks wheels have worn into it, each a line of points. */
      tracks: [number, number][][];
      rect: Rect;
      perMetre: number;
    }
  | { kind: 'lawn'; outline: [number, number][]; rect: Rect; perMetre: number };

/** A painted texture's pixels, RGBA in rows. */
export interface Painting {
  data: Uint8Array;
  width: number;
  height: number;
}

/** How far each lane's stop line is from the crossing's middle: a metre and more short of it. */
export const STOP = 2.8;

/** How many pixels across and down a painting `w × d` metres is at `perMetre`. */
function pixels(w: number, d: number, perMetre: number): [number, number] {
  return [Math.max(1, Math.round(w * perMetre)), Math.max(1, Math.round(d * perMetre))];
}

/** How big `job`'s painting is, in pixels. */
export function paintingSize(job: PaintJob): [number, number] {
  return job.kind === 'paving'
    ? pixels(job.w, job.d, job.perMetre)
    : pixels(job.rect[2], job.rect[3], job.perMetre);
}

/** Paints `job`, `perMetre` as fine (its own, unless a rough copy is wanted). */
export function paint(job: PaintJob, perMetre = job.perMetre): Painting {
  switch (job.kind) {
    case 'moss':
      return moss(polygonField(job.outline), job.rect, perMetre);
    case 'asphalt':
      return asphalt(job.marks, polygonField(job.outline), job.rect, perMetre);
    case 'paving':
      return paving(job.w, job.d, perMetre, job.seed);
    case 'gravel':
      return gravel(polygonField(job.outline), job.tracks, job.rect, perMetre);
    case 'lawn':
      return lawn(polygonField(job.outline), job.rect, perMetre);
  }
}

/** `p` stretched to `width × height`, each pixel taking the nearest of its own. */
export function stretched(p: Painting, width: number, height: number): Painting {
  const data = new Uint8Array(width * height * 4);
  const from = new Uint32Array(p.data.buffer, p.data.byteOffset, p.width * p.height);
  const to = new Uint32Array(data.buffer);
  const cols = new Uint32Array(width);
  for (let i = 0; i < width; i++)
    cols[i] = Math.min(p.width - 1, Math.floor(((i + 0.5) * p.width) / width));
  for (let j = 0; j < height; j++) {
    const row = Math.min(p.height - 1, Math.floor(((j + 0.5) * p.height) / height)) * p.width;
    for (let i = 0; i < width; i++) to[j * width + i] = from[row + cols[i]!]!;
  }
  return { data, width, height };
}

/** A field over the ground: below 0 inside the patch, rising through 0 at its edge. */
export type Field = (x: number, z: number) => number;

/** A field over the ground: how far a point is outside `outline` (negative inside), in metres. */
export function polygonField(outline: [number, number][]): Field {
  return (x, z) => {
    let inside = false;
    let best = Infinity;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const [xi, zi] = outline[i]!;
      const [xj, zj] = outline[j]!;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      const dx = xj - xi;
      const dz = zj - zi;
      const t = Math.max(0, Math.min(1, ((x - xi) * dx + (z - zi) * dz) / (dx * dx + dz * dz)));
      best = Math.min(best, Math.hypot(x - xi - t * dx, z - zi - t * dz));
    }
    return inside ? -best : best;
  };
}

/** Moss, its ragged rim and dark streaks, painted into a texture over `rect` (x0, z0, w, d). */
function moss(field: Field, rect: Rect, perMetre: number): Painting {
  const [x0, z0, w, d] = rect;
  const [W, H] = pixels(w, d, perMetre);
  const data = new Uint8Array(W * H * 4);
  const dark = [0x1e, 0x26, 0x14];
  const mid = [0x3a, 0x4c, 0x22];
  const light = [0x9c, 0xc0, 0x4a];
  const dirt = [0x2a, 0x26, 0x1e];
  const rim = [0x56, 0x60, 0x6a];
  // Round the moss, a band of dark wet ground; beyond it the brushed rim out over the floor, a
  // grey a little darker than the floor, as dry paint.
  const wet = [0x4a, 0x4e, 0x50];
  const wash = [0x9a, 0x94, 0x8c];
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const x = x0 + ((i + 0.5) / W) * w;
      // Rows run along z: the texture's v is 1 at z0 + d (see `patch`).
      const z = z0 + (1 - (j + 0.5) / H) * d;
      // The edge roughened, and dragged out into streaks along x, as by a dry brush.
      const rough = (fbm(x * 0.35, z * 0.35, 8, 3, 4) - 0.5) * 0.9;
      const streak = (noise(x * 0.25, z * 14, 1000, 5) - 0.5) * 0.6;
      const f = field(x, z) + rough + streak * 0.6;
      const k = (j * W + i) * 4;
      if (f > 0.7) {
        data[k + 3] = 0;
        continue;
      }
      let c: number[];
      let a: number;
      if (f > 0.0) {
        const broken = noise(x * 3, z * 14, 1000, 9);
        if (f < 0.25) {
          // The wet band, ragged where it meets the wash.
          c = wet.map((v) => v * (0.85 + 0.3 * broken));
          a = 0.85 * Math.min(1, (0.25 - f) / 0.06 + broken * 0.5);
        } else {
          // The rim: a grey wash, broken and streaky, fading out.
          const t = (f - 0.25) / 0.45;
          a = Math.max(0, (1 - t) * (0.75 + 0.5 * broken) - 0.15) * 0.6;
          c = mix(wet, wash, Math.min(1, t * 3)).map((v) => v * (0.85 + 0.3 * broken));
        }
      } else {
        const m = fbm(x * 0.25, z * 0.25, 8, 13, 4);
        const fleck = noise(x * 18, z * 18, 1000, 17);
        const base = m < 0.5 ? mix(dark, mid, m / 0.5) : mix(mid, light, (m - 0.5) / 0.5);
        c = mix(base, light, Math.max(0, fleck - 0.78) * 2.2);
        // Clumps: darker hollows between brighter cushions.
        const clump = fbm(x * 0.25, z * 0.25, 40, 29, 3);
        c = mix(c, dark, Math.max(0, 0.42 - clump) * 2);
        c = mix(c, light, Math.max(0, clump - 0.6) * 1.8);
        // Bare dark earth showing through it here and there.
        c = mix(c, dirt, Math.max(0, fbm(x * 0.9, z * 0.9, 8, 19, 3) - 0.55) * 2.2);
        // Greyer toward the edge, where the moss gives out.
        c = mix(c, rim, Math.max(0, 1 + f / 0.25) * 0.6);
        a = 1;
      }
      data[k] = c[0]!;
      data[k + 1] = c[1]!;
      data[k + 2] = c[2]!;
      data[k + 3] = Math.round(Math.min(1, a) * 255);
    }
  return { data, width: W, height: H };
}
/** The road's asphalt and paint, over `rect` (x0, z0, w, d), its ends broken off raggedly. */
function asphalt(plan: RoadMarks, field: Field, rect: Rect, perMetre: number): Painting {
  const [x0, z0, w, d] = rect;
  const [W, H] = pixels(w, d, perMetre);
  const data = new Uint8Array(W * H * 4);
  const darkA = [0x3a, 0x40, 0x47];
  const midA = [0x52, 0x59, 0x61];
  const lightA = [0x6c, 0x72, 0x7a];
  const fleck = [0x9a, 0x9e, 0xa2];
  const crack = [0x16, 0x18, 0x1a];
  const moss = [0x3a, 0x4c, 0x22];
  const white = [0xe2, 0xdf, 0xd6];
  const wet = [0x4a, 0x4e, 0x50];
  const wash = [0x9a, 0x94, 0x8c];
  const { north, south, middle, crossing, bays } = plan;
  const band = (v: number, c: number, half: number) =>
    Math.max(0, Math.min(1, (half - Math.abs(v - c)) * perMetre * 0.5 + 0.5));
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const x = x0 + ((i + 0.5) / W) * w;
      const z = z0 + (1 - (j + 0.5) / H) * d;
      const rough = (fbm(x * 0.1, z * 0.35, 8, 143, 4) - 0.5) * 0.9;
      const streak = (noise(x * 0.25, z * 14, 1000, 145) - 0.5) * 0.6;
      const f = field(x, z) + rough + streak * 0.6;
      const k = (j * W + i) * 4;
      if (f > 0.7) {
        data[k + 3] = 0;
        continue;
      }
      let c: number[];
      let a = 1;
      if (f > 0) {
        // Its broken ends brushed out over the floor, as the other roads' are.
        const broken = noise(x * 3, z * 14, 1000, 147);
        if (f < 0.25) {
          c = wet.map((v) => v * (0.85 + 0.3 * broken));
          a = 0.85 * Math.min(1, (0.25 - f) / 0.06 + broken * 0.5);
        } else {
          const t = (f - 0.25) / 0.45;
          a = Math.max(0, (1 - t) * (0.75 + 0.5 * broken) - 0.15) * 0.6;
          c = mix(wet, wash, Math.min(1, t * 3)).map((v) => v * (0.85 + 0.3 * broken));
        }
      } else {
        const m = fbm(x * 0.1, z * 0.1, 8, 151, 4);
        c = m < 0.5 ? mix(darkA, midA, m / 0.5) : mix(midA, lightA, (m - 0.5) / 0.5);
        const grit = noise(x * 60, z * 60, 100000, 153);
        c = mix(c, fleck, Math.max(0, grit - 0.8) * 3);
        c = mix(c, darkA, Math.max(0, 0.18 - grit) * 3);
        // Darker down the middle of each lane, where the traffic runs.
        for (const lane of [(north + middle) / 2, (south + middle) / 2])
          c = mix(c, darkA, 0.25 * Math.max(0, 1 - Math.abs(z - lane) / 0.9));
        // The paint: a solid line inside each kerb, the middle dashed and solid near the
        // crossing, a stop line before it in each lane (traffic keeps right, so +x in the north
        // lane and -x in the south), and the crossing's bars.
        const near = Math.abs(x - crossing);
        let line = Math.max(band(z, north - 0.35, 0.06), band(z, south + 0.35, 0.06));
        const dash = ((x % 3) + 3) % 3 < 1.6 || near < 6 ? 1 : 0;
        line = Math.max(line, band(z, middle, 0.06) * dash * (near > 1.7 ? 1 : 0));
        if (z > middle && z < north - 0.35) line = Math.max(line, band(x, crossing - STOP, 0.15));
        if (z < middle && z > south + 0.35) line = Math.max(line, band(x, crossing + STOP, 0.15));
        if (near < 1.5 && z < north - 0.5 && z > south + 0.5) {
          const across = (z - (south + 0.5)) / 0.5;
          const bar = Math.floor(across) % 2 === 0 ? 1 : 0;
          const soft = Math.min(1, (1.5 - near) * perMetre * 0.5);
          line = Math.max(
            line,
            bar * soft * Math.min(1, Math.min(across % 1, 1 - (across % 1)) * 40),
          );
        }
        // The parking bays, marked out in dashes all round.
        for (const [bx0, bz0, bx1, bz1] of bays) {
          if (x < bx0 - 0.1 || x > bx1 + 0.1 || z < bz0 - 0.1 || z > bz1 + 0.1) continue;
          const alongX = (x - bx0) % 0.9 < 0.55 ? 1 : 0;
          const alongZ = (z - bz0) % 0.65 < 0.4 ? 1 : 0;
          line = Math.max(
            line,
            Math.max(band(z, bz0, 0.05), band(z, bz1, 0.05)) * alongX,
            Math.max(band(x, bx0, 0.05), band(x, bx1, 0.05)) * alongZ,
          );
        }
        const wear = fbm(x * 0.4, z * 0.4, 8, 157, 4);
        const chips = noise(x * 25, z * 25, 100000, 159);
        line *= Math.min(1, Math.max(0, (wear - 0.22) * 4)) * (chips > 0.18 ? 1 : 0.35);
        line *= Math.min(1, Math.max(0, -f / 0.35));
        c = mix(c, white, line * 0.92);
        // Cracks, a few running with moss.
        const along = fbm(x * 0.12, z * 0.3, 8, 161, 4);
        const net = fbm(x * 0.3, z * 0.3, 8, 163, 3);
        const crackAt = Math.max(
          Math.max(0, 1 - Math.abs(along - 0.5) / 0.007) * (net > 0.5 ? 1 : 0),
          Math.max(0, 1 - Math.abs(net - 0.5) / 0.005) * (along > 0.6 ? 1 : 0),
        );
        const mossy = fbm(x * 0.2, z * 0.2, 8, 165, 2) > 0.6;
        c = mix(c, mossy ? moss : crack, crackAt * 0.9);
        // Grime gathered along the kerbs.
        const gutter = Math.max(0, 1 - Math.min(north - z, z - south) / 0.3);
        c = mix(c, [0x30, 0x34, 0x36], gutter * 0.35);
      }
      data[k] = c[0]!;
      data[k + 1] = c[1]!;
      data[k + 2] = c[2]!;
      data[k + 3] = Math.round(Math.min(1, a) * 255);
    }
  return { data, width: W, height: H };
}

/**
 * Pavement slabs over a `w × d` strip: square concrete slabs half a metre across, laid in
 * staggered rows, each its own shade, with dark joints, moss in some, and pale worn edges.
 */
function paving(w: number, d: number, perMetre: number, seed: number): Painting {
  const [W, H] = pixels(w, d, perMetre);
  const data = new Uint8Array(W * H * 4);
  const size = 0.5;
  const base = [0xa9, 0xa6, 0xa0];
  const joint = [0x4c, 0x4d, 0x4b];
  const moss = [0x4a, 0x5e, 0x2a];
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const x = (i + 0.5) / perMetre;
      const z = (j + 0.5) / perMetre;
      const row = Math.floor(z / size);
      const sx = x + (row % 2) * size * 0.5;
      const col = Math.floor(sx / size);
      const [u, v] = [sx / size - col, z / size - row];
      const edge = Math.min(u, 1 - u, v, 1 - v) * size;
      const tone = 0.86 + hash(col, row, seed) * 0.2;
      const mottle = 0.9 + 0.2 * fbm(x * 0.6, z * 0.6, 8, seed + 3, 4);
      const speck = noise(x * 70, z * 70, 100000, seed + 5);
      let c = base.map((b) => b * tone * mottle * (0.94 + 0.12 * speck));
      // A worn lighter rim round each slab, and the joint between.
      c = mix(c, [0xc4, 0xc1, 0xba], Math.max(0, 1 - edge / 0.02) * 0.4);
      const inJoint = Math.max(0, Math.min(1, (0.008 - edge) / 0.004 + 0.5));
      const mossy = fbm(x * 0.8, z * 0.8, 8, seed + 7, 3) > 0.58;
      c = mix(c, mossy ? moss : joint, inJoint);
      // Stains here and there.
      const stain = Math.max(0, fbm(x * 0.3, z * 0.3, 8, seed + 9, 3) - 0.62) * 2.2;
      c = c.map((v) => v * (1 - stain * 0.35));
      const k = (j * W + i) * 4;
      data[k] = c[0]!;
      data[k + 1] = c[1]!;
      data[k + 2] = c[2]!;
      data[k + 3] = 255;
    }
  return { data, width: W, height: H };
}

/**
 * Past the edge of a patch (`f` above 0, `broken` its noise there): a band of dark wet ground,
 * then a grey wash brushed out over the floor, as dry paint, fading out; the colour and how much
 * it covers. The moss's and the road's rims are painted the same.
 */
function rim(f: number, broken: number): [number[], number] {
  const wet = [0x4a, 0x4e, 0x50];
  const wash = [0x9a, 0x94, 0x8c];
  if (f < 0.25)
    return [
      wet.map((v) => v * (0.85 + 0.3 * broken)),
      0.85 * Math.min(1, (0.25 - f) / 0.06 + broken * 0.5),
    ];
  const t = (f - 0.25) / 0.45;
  return [
    mix(wet, wash, Math.min(1, t * 3)).map((v) => v * (0.85 + 0.3 * broken)),
    Math.max(0, (1 - t) * (0.75 + 0.5 * broken) - 0.15) * 0.6,
  ];
}

/**
 * How far (`x`, `z`) is from the line through `points`, in metres, across it: past either of its
 * ends, as far as can be, so it ends square rather than rounded.
 */
function acrossLine(points: [number, number][], x: number, z: number): number {
  let best = Infinity;
  const last = points.length - 1;
  for (let i = 1; i <= last; i++) {
    const [ax, az] = points[i - 1]!;
    const [bx, bz] = points[i]!;
    const dx = bx - ax;
    const dz = bz - az;
    const along = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz);
    if ((i === 1 && along < 0) || (i === last && along > 1)) continue;
    const t = Math.max(0, Math.min(1, along));
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
}

/** How far apart a lorry's wheels run, and how wide the rut each wears. */
const WHEELS = { apart: 1.7, rut: 0.6 };

/**
 * A building lot's ground, over `rect` (x0, z0, w, d): rolled gravel, grey-brown, flecked with
 * pale and dark stones, darker where it lies damp, ruts worn in it along `tracks` with puddles
 * standing in them, moss creeping in from the edge, a few weeds; its edge brushed out over the
 * floor as the moss's is.
 */
function gravel(
  field: Field,
  tracks: [number, number][][],
  rect: Rect,
  perMetre: number,
): Painting {
  const [x0, z0, w, d] = rect;
  const [W, H] = pixels(w, d, perMetre);
  const data = new Uint8Array(W * H * 4);
  const dark = [0x5e, 0x58, 0x4e];
  const mid = [0x7e, 0x77, 0x6a];
  const light = [0x9c, 0x95, 0x87];
  const pale = [0xc2, 0xbd, 0xb2];
  const stone = [0x3e, 0x3b, 0x36];
  const damp = [0x50, 0x4a, 0x40];
  const mud = [0x46, 0x3e, 0x32];
  const puddle = [0x30, 0x35, 0x3a];
  const moss = [0x3a, 0x4c, 0x22];
  const mossLight = [0x6e, 0x8a, 0x36];
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const x = x0 + ((i + 0.5) / W) * w;
      const z = z0 + (1 - (j + 0.5) / H) * d;
      const rough = (fbm(x * 0.35, z * 0.35, 8, 303, 4) - 0.5) * 0.9;
      const streak = (noise(x * 0.25, z * 14, 1000, 305) - 0.5) * 0.6;
      const f = field(x, z) + rough + streak * 0.6;
      const k = (j * W + i) * 4;
      if (f > 0.7) {
        data[k + 3] = 0;
        continue;
      }
      let c: number[];
      let a = 1;
      if (f > 0) [c, a] = rim(f, noise(x * 3, z * 14, 1000, 307));
      else {
        const m = fbm(x * 0.03, z * 0.03, 24, 311, 4);
        c = m < 0.5 ? mix(dark, mid, m / 0.5) : mix(mid, light, (m - 0.5) / 0.5);
        // The ruts: a pair along each track, worn smooth and dark, water standing in the deepest.
        let rut = 0;
        for (const t of tracks) {
          const off = Math.abs(acrossLine(t, x, z) - WHEELS.apart / 2);
          // Dying out toward the track's end.
          const [ex, ez] = t[t.length - 1]!;
          const fade = Math.min(1, Math.hypot(x - ex, z - ez) / 2.5);
          // Flat along its floor, its sides worn smooth.
          const across = Math.max(0, Math.min(1, (off / (WHEELS.rut / 2) - 0.5) / 0.5));
          rut = Math.max(rut, (1 - across * across * (3 - 2 * across)) * fade);
        }
        rut *= 0.7 + 0.3 * fbm(x * 0.05, z * 0.05, 20, 313, 3);
        // The stones: pale ones and dark ones, fewer where the wheels have pressed them in.
        const s1 = noise(x * 34, z * 34, 100000, 317);
        const s2 = noise(x * 52 + 7.3, z * 52, 100000, 319);
        const loose = 1 - 0.6 * rut;
        c = mix(c, pale, Math.max(0, s1 - 0.68) * 2.6 * loose);
        c = mix(c, stone, Math.max(0, 0.3 - s2) * 2.4 * loose);
        c = c.map((v) => v * (0.94 + 0.12 * noise(x * 110, z * 110, 100000, 321)));
        // Damp, darker ground in broad patches.
        c = mix(c, damp, Math.max(0, fbm(x * 0.04, z * 0.04, 24, 323, 3) - 0.6) * 2.4);
        c = mix(c, mud, rut * 0.8);
        const pool = Math.max(0, fbm(x * 0.06, z * 0.06, 24, 327, 3) - 0.58) * 6;
        c = mix(c, puddle, Math.min(1, pool * rut) * 0.9);
        // Moss creeping in from the edge in clumps, and here and there out in the open.
        const clump = fbm(x * 0.08, z * 0.08, 24, 331, 4);
        const edge = Math.max(0, 1 + f / 1.4);
        const green = Math.max(0, Math.min(1, (clump + edge * 0.35 - 0.68) * 5)) * (1 - rut);
        const tuft = noise(x * 16, z * 16, 100000, 333);
        c = mix(c, mix(moss, mossLight, tuft), green * (0.6 + 0.4 * tuft));
        // Weeds: a scatter of small bright sprigs.
        const weed = noise(x * 9, z * 9, 100000, 337);
        c = mix(c, mossLight, Math.max(0, weed - 0.93) * 12 * (1 - rut));
      }
      data[k] = c[0]!;
      data[k + 1] = c[1]!;
      data[k + 2] = c[2]!;
      data[k + 3] = Math.round(Math.min(1, a) * 255);
    }
  return { data, width: W, height: H };
}

/**
 * A lawn over `rect` (x0, z0, w, d): grass mown in broad stripes along x, its blades flecked
 * light and dark, clumps of darker clover, yellowed patches and a few worn bare ones, a scatter
 * of daisies, the grass longer and darker toward its edge, brushed out over the floor past it.
 */
function lawn(field: Field, rect: Rect, perMetre: number): Painting {
  const [x0, z0, w, d] = rect;
  const [W, H] = pixels(w, d, perMetre);
  const data = new Uint8Array(W * H * 4);
  const dark = [0x2c, 0x42, 0x1a];
  const mid = [0x46, 0x62, 0x26];
  const light = [0x6e, 0x8e, 0x34];
  const tip = [0x9c, 0xb8, 0x52];
  const dry = [0x8a, 0x86, 0x4c];
  const earth = [0x4c, 0x40, 0x30];
  const daisy = [0xe8, 0xe6, 0xd8];
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const x = x0 + ((i + 0.5) / W) * w;
      const z = z0 + (1 - (j + 0.5) / H) * d;
      const rough = (fbm(x * 0.35, z * 0.35, 8, 403, 4) - 0.5) * 0.9;
      const streak = (noise(x * 0.25, z * 14, 1000, 405) - 0.5) * 0.6;
      const f = field(x, z) + rough + streak * 0.6;
      const k = (j * W + i) * 4;
      if (f > 0.7) {
        data[k + 3] = 0;
        continue;
      }
      let c: number[];
      let a = 1;
      if (f > 0) [c, a] = rim(f, noise(x * 3, z * 14, 1000, 407));
      else {
        const m = fbm(x * 0.03, z * 0.03, 24, 411, 4);
        c = m < 0.5 ? mix(dark, mid, m / 0.5) : mix(mid, light, (m - 0.5) / 0.5);
        // Mown in stripes a mower wide, each laid the other way: lighter and darker in turn.
        const stripe = Math.sin(((z + 0.3 * noise(x * 0.4, 0, 1000, 413)) / 1.1) * Math.PI);
        c = c.map((v) => v * (1 + 0.09 * Math.max(-1, Math.min(1, stripe * 3))));
        // The blades: short streaks along the stripes, their tips catching the light.
        const blade = noise(x * 70, z * 180, 100000, 415);
        c = mix(c, tip, Math.max(0, blade - 0.72) * 1.6);
        c = mix(c, dark, Math.max(0, 0.25 - blade) * 1.6);
        // Clumps of clover, darker; yellowed patches; and bare earth worn through in a few.
        c = mix(c, dark, Math.max(0, fbm(x * 0.12, z * 0.12, 24, 417, 3) - 0.6) * 2.2);
        c = mix(c, dry, Math.max(0, fbm(x * 0.05, z * 0.05, 24, 419, 3) - 0.58) * 2.4);
        const bare = Math.max(0, fbm(x * 0.07, z * 0.07, 24, 421, 4) - 0.68) * 5;
        c = mix(c, earth, Math.min(1, bare) * (0.7 + 0.3 * blade));
        // Longer and darker toward the edge, where the mower does not reach.
        c = mix(c, dark, Math.max(0, 1 + f / 0.5) * 0.45);
        // Daisies: a few white dots with yellow hearts.
        const flower = noise(x * 28, z * 28, 100000, 423);
        if (flower > 0.975 && bare < 0.2) c = mix(daisy, [0xe0, 0xc0, 0x30], (flower - 0.975) * 80);
      }
      data[k] = c[0]!;
      data[k + 1] = c[1]!;
      data[k + 2] = c[2]!;
      data[k + 3] = Math.round(Math.min(1, a) * 255);
    }
  return { data, width: W, height: H };
}

/** `a` toward `b` by `t` (held to 0 to 1), channel by channel. */
export function mix(a: number[], b: number[], t: number): number[] {
  const k = Math.max(0, Math.min(1, t));
  return a.map((v, i) => v + (b[i]! - v) * k);
}
