import * as THREE from 'three';
import { fbm } from './kit.ts';
import { Surface, madeOf } from '../render/styles.ts';

/**
 * Cast iron for the covers and grates in the road: a pattern cast in relief, its raised tops worn
 * bright and smooth by tyres, its hollows dark and dull with grime and freckled with rust, and its
 * holes black. Each is a set of maps drawn from the pattern's height: colour, bumps, and how rough
 * and how metallic it is.
 */

/** The pattern at a point, in metres from its middle: how high it stands (0 to 1), or a hole. */
type Relief = (x: number, z: number) => number | 'hole';

/** How deep the deepest of the pattern is, in metres: the bumps' slopes are scaled to it. */
const DEPTH = 0.004;

const smooth = (a: number, b: number, t: number) => {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
/** A ridge `w` either side of where `d` is 0, rounded over its top. */
const ridge = (d: number, w: number) => smooth(w, 0, Math.abs(d));

function texture(data: Uint8Array, w: number, h: number, colour: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Iron's colours: bare and polished, as cast, grimy, and rust. */
const BRIGHT = [128, 134, 140];
const IRON = [78, 83, 88];
const GRIME = [30, 31, 32];
const RUST = [64, 44, 32];
const HOLE = [6, 7, 7];

/**
 * A material of cast iron `wide` × `deep` metres, drawn `px` texels across, its pattern `relief`;
 * `seed` sets its grime and rust.
 */
function castIron(wide: number, deep: number, px: number, relief: Relief, seed: number) {
  const w = px;
  const h = Math.max(4, Math.round((px * deep) / wide));
  const height = new Float32Array(w * h);
  const holes = new Uint8Array(w * h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      // Texel (i, j) at u = i / w along x, v = j / h toward -z, as a flat plane's are.
      const r = relief(((i + 0.5) / w - 0.5) * wide, (0.5 - (j + 0.5) / h) * deep);
      if (r === 'hole') holes[j * w + i] = 1;
      height[j * w + i] = r === 'hole' ? -1.5 : r;
    }
  const colour = new Uint8Array(w * h * 4);
  const normal = new Uint8Array(w * h * 4);
  const surface = new Uint8Array(w * h * 4);
  const at = (i: number, j: number) =>
    height[Math.min(h - 1, Math.max(0, j)) * w + Math.min(w - 1, Math.max(0, i))]!;
  // A rise of one in the pattern, over a texel: how steep that is.
  const steep = DEPTH / (wide / w);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const o = k * 4;
      const [u, v] = [i / w, j / h];
      const dx = ((at(i + 1, j) - at(i - 1, j)) / 2) * steep;
      const dy = ((at(i, j + 1) - at(i, j - 1)) / 2) * steep;
      const n = new THREE.Vector3(-dx, -dy, 1).normalize();
      normal[o] = Math.round((n.x * 0.5 + 0.5) * 255);
      normal[o + 1] = Math.round((n.y * 0.5 + 0.5) * 255);
      normal[o + 2] = Math.round((n.z * 0.5 + 0.5) * 255);
      normal[o + 3] = 255;
      let rgb: number[];
      let rough: number;
      let metal: number;
      if (holes[k]) {
        rgb = HOLE;
        rough = 1;
        metal = 0;
      } else {
        const ht = height[k]!;
        // Worn bright on its tops, grimy down in its hollows, rust freckled over the grime.
        const noise = fbm(u, v, 6, seed, 4);
        const worn = smooth(0.75, 1, ht) * (0.6 + 0.5 * fbm(u, v, 14, seed + 1, 3));
        const grime = Math.min(1, smooth(0.5, 0.1, ht) * 0.8 + Math.max(0, noise - 0.55) * 1.6);
        // Rust only down in the hollows, where the water stands.
        const rust = smooth(0.62, 0.74, fbm(u, v, 12, seed + 2, 4)) * smooth(0.6, 0.3, ht);
        const streak = (fbm(u * 0.3, v * 4, 4, seed + 3, 3) - 0.5) * 0.25;
        rgb = IRON.map((c, ch) => {
          let x = c * (1 + streak);
          x += (BRIGHT[ch]! - x) * Math.min(1, worn);
          x += (GRIME[ch]! - x) * grime * (1 - worn);
          x += (RUST[ch]! - x) * rust * 0.6;
          return x;
        });
        rough = 0.42 - 0.24 * Math.min(1, worn) + 0.4 * grime * (1 - worn) + 0.35 * rust;
        metal = 0.9 + 0.1 * Math.min(1, worn) - 0.55 * grime * (1 - worn) - 0.7 * rust;
      }
      for (let c = 0; c < 3; c++) colour[o + c] = Math.max(0, Math.min(255, Math.round(rgb[c]!)));
      colour[o + 3] = 255;
      surface[o] = 255;
      surface[o + 1] = Math.round(Math.min(1, Math.max(0.05, rough)) * 255);
      surface[o + 2] = Math.round(Math.min(1, Math.max(0, metal)) * 255);
      surface[o + 3] = 255;
    }
  const rm = texture(surface, w, h, false);
  return madeOf(
    new THREE.MeshStandardMaterial({
      map: texture(colour, w, h, true),
      normalMap: texture(normal, w, h, false),
      normalScale: new THREE.Vector2(1, 1),
      roughnessMap: rm,
      metalnessMap: rm,
      roughness: 1,
      metalness: 1,
      envMapIntensity: 1.6,
    }),
    Surface.None,
  );
}

/** How wide a manhole cover is across. */
export const COVER_RADIUS = 0.37;

/**
 * A manhole cover's pattern: a smooth rim, a groove inside it, the field within cast with two
 * rings and twelve spokes over a tread of small diamonds, and a boss in the middle with the
 * lifting keys' two slots through it.
 */
function coverRelief(x: number, z: number): number | 'hole' {
  const r = Math.hypot(x, z) / COVER_RADIUS;
  if (r > 0.995) return 0.85 * smooth(1.06, 0.97, r);
  if (r > 0.9) return 0.95;
  if (r > 0.86) return 0.15 + 0.8 * smooth(0.87, 0.9, r);
  if (r < 0.13) {
    // The boss, its keyholes through it.
    if (Math.abs(Math.abs(x) - 0.026) < 0.012 && Math.abs(z) < 0.004) return 'hole';
    return 0.85 * smooth(0.135, 0.11, r) + 0.3;
  }
  let h = 0.3;
  // The tread: rows of small diamonds, 18 mm apart.
  const p = 0.018;
  const fx = (((x / p) % 1) + 1) % 1;
  const fz = (((z / p) % 1) + 1) % 1;
  h = Math.max(h, 0.3 + 0.38 * smooth(0.5, 0.15, Math.abs(fx - 0.5) + Math.abs(fz - 0.5)));
  // The rings and the spokes, standing proud of the tread.
  for (const ring of [0.34, 0.62]) h = Math.max(h, 0.95 * ridge(r - ring, 0.035));
  const a = Math.atan2(z, x);
  const spoke = Math.PI / 6;
  const off = (((a % spoke) + spoke * 1.5) % spoke) - spoke / 2;
  h = Math.max(h, 0.92 * ridge(off * Math.hypot(x, z), 0.007));
  // The field's edge and the boss's foot, rounded up into them.
  h = Math.max(h, 0.95 * smooth(0.84, 0.86, r), 0.8 * smooth(0.16, 0.13, r));
  return h;
}

/** A drain grate's size: along the kerb, and out from it. */
export const GRATE = { long: 0.7, wide: 0.36 };

/**
 * A drain grate's pattern: a frame round it cast with a cross tread, and nine slots across it,
 * the bars between them crowned.
 */
function grateRelief(x: number, z: number): number | 'hole' {
  const ex = GRATE.long / 2 - Math.abs(x);
  const ez = GRATE.wide / 2 - Math.abs(z);
  const edge = Math.min(ex, ez);
  // The frame's outer edge rounds down into the road.
  if (edge < 0.012) return 0.5 + 0.45 * smooth(0, 0.012, edge);
  const slot = 0.07;
  const fx = x / slot - Math.round(x / slot);
  if (ez > 0.045 && ex > 0.035 && Math.abs(fx) < 0.22) return 'hole';
  if (ez > 0.045 && ex > 0.035) {
    // A bar: crowned across, its edges rounding down into the slots.
    return 0.5 + 0.38 * smooth(0.22, 0.42, Math.abs(fx)) * (1 - Math.abs(fx));
  }
  // The frame: a cross tread over it.
  const p = 0.016;
  const u = (((x / p) % 1) + 1) % 1;
  const w = (((z / p) % 1) + 1) % 1;
  const cross = Math.max(ridge(u - 0.5, 0.14), ridge(w - 0.5, 0.14));
  return 0.62 + 0.3 * cross;
}

let cover: THREE.MeshStandardMaterial | null = null;
let grate: THREE.MeshStandardMaterial | null = null;

/** The manhole covers' cast iron, its pattern centred on a disc laid flat (a circle's own). */
export function coverIron(): THREE.MeshStandardMaterial {
  return (cover ??= castIron(COVER_RADIUS * 2, COVER_RADIUS * 2, 512, coverRelief, 61));
}

/** The drain grates' cast iron, its pattern over a plane `GRATE.long` × `GRATE.wide` laid flat. */
export function grateIron(): THREE.MeshStandardMaterial {
  return (grate ??= castIron(GRATE.long, GRATE.wide, 512, grateRelief, 67));
}
