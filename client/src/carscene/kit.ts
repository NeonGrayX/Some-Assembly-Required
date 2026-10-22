import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { profiler } from '../profiler.ts';
import { Surface, madeOf } from '../render/styles.ts';
import { storePainting, storedPainting } from './paintCache.ts';
import { fbm, hash } from './noise.ts';
import { paint, paintingSize, stretched } from './paint.ts';
import type { PaintJob, Painting } from './paint.ts';
import { paintAway } from './paintPool.ts';

/**
 * The small toolkit the car scene is modelled with: smooth rounded blocks, extruded outlines and
 * bent tubes, laid with a soft hand-painted mottle at a fixed size in the world, and the scene's
 * materials, all left out of the game's own painted style (`Surface.None`): the picture this map
 * copies is smooth studio paint, not the game's chunky boards and grass.
 */

export { fbm, hash, noise } from './noise.ts';

/** A tile `size` pixels square, its brightness at (`u`, `v`) given by `at`, as an sRGB texture. */
export function greyTexture(size: number, at: (u: number, v: number) => number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const g = Math.max(0, Math.min(255, Math.round(at(x / size, y / size) * 255)));
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = g;
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

/** The kinds of mottle a surface is painted with. */
export type Mottle = 'paint' | 'plastic' | 'metal' | 'cast' | 'soil' | 'none';

/** How many metres one tile of each mottle covers. */
const MOTTLE_TILE: Record<Mottle, number> = {
  paint: 2.2,
  plastic: 1.2,
  metal: 0.8,
  cast: 0.4,
  soil: 0.5,
  none: 1,
};

const mottles = new Map<Mottle, THREE.DataTexture>();

/**
 * Soft brushed blotches, a touch lighter and darker than the colour, as on a hand-painted
 * model: broad patches and scuffs on paint, finer on plastic, streaks along metal.
 */
/**
 * Scuffs on paint: short dark dashes scattered over a tile, in its own units, each from (x, y)
 * along (dx, dy).
 */
const SCUFFS = Array.from({ length: 40 }, (_, i) => {
  const a = (hash(i, 1, 51) - 0.5) * 1.2;
  const len = (0.02 + hash(i, 2, 51) * 0.04) / MOTTLE_TILE.paint;
  return {
    x: hash(i, 3, 51),
    y: hash(i, 4, 51),
    dx: Math.cos(a) * len,
    dy: Math.sin(a) * len,
  };
});

/** How far from a dash its scuff reaches, in the tile's units. */
const SCUFF_WIDTH = 0.002 / MOTTLE_TILE.paint;
/**
 * The dashes (each with the tile it is repeated from) whose scuff reaches into each of a grid of
 * `SCUFF_CELLS` squares over the tile, so a pixel only measures the few near it: measuring all
 * of them for every pixel of the 512-pixel tile took a couple of seconds, all in one frame.
 */
const SCUFF_CELLS = 32;
const SCUFF_GRID = (() => {
  // Each a dash's start, the tile it is repeated from, and its length and way.
  type Near = [x: number, y: number, ox: number, oy: number, dx: number, dy: number];
  const grid = Array.from({ length: SCUFF_CELLS * SCUFF_CELLS }, () => [] as Near[]);
  const reach = SCUFF_WIDTH * 2;
  const cell = (x: number) => Math.max(0, Math.min(SCUFF_CELLS - 1, Math.floor(x * SCUFF_CELLS)));
  for (const d of SCUFFS)
    for (const [ox, oy] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const [x0, x1] = [Math.min(0, d.dx) + d.x + ox, Math.max(0, d.dx) + d.x + ox];
      const [y0, y1] = [Math.min(0, d.dy) + d.y + oy, Math.max(0, d.dy) + d.y + oy];
      if (x1 + reach < 0 || x0 - reach >= 1 || y1 + reach < 0 || y0 - reach >= 1) continue;
      for (let cy = cell(y0 - reach); cy <= cell(y1 + reach); cy++)
        for (let cx = cell(x0 - reach); cx <= cell(x1 + reach); cx++)
          grid[cy * SCUFF_CELLS + cx]!.push([d.x, d.y, ox, oy, d.dx, d.dy]);
    }
  return grid;
})();

/** How much of a scuff covers (`u`, `v`): 1 on a dash, fading off it over a few millimetres. */
function scuff(u: number, v: number): number {
  let best = Infinity;
  const cx = Math.min(SCUFF_CELLS - 1, Math.floor(u * SCUFF_CELLS));
  const cy = Math.min(SCUFF_CELLS - 1, Math.floor(v * SCUFF_CELLS));
  for (const [x, y, ox, oy, dx, dy] of SCUFF_GRID[cy * SCUFF_CELLS + cx]!) {
    const px = u - x - ox;
    const py = v - y - oy;
    const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(px - t * dx, py - t * dy));
  }
  return Math.max(0, 1 - best / (SCUFF_WIDTH * 2));
}

function mottleTexture(kind: Mottle): THREE.DataTexture {
  let t = mottles.get(kind);
  if (t) return t;
  const at =
    kind === 'paint'
      ? (u: number, v: number) => {
          const broad = fbm(u, v, 3, 11, 4);
          const fine = fbm(u, v, 12, 13, 3);
          // A grubby smudge here and there.
          const smudge = Math.max(0, fbm(u, v, 4, 17, 3) - 0.55) * 1.4;
          return (
            (0.92 + (broad - 0.5) * 0.08 + (fine - 0.5) * 0.06 - smudge * 0.1) *
            (1 - 0.4 * scuff(u, v))
          );
        }
      : kind === 'plastic'
        ? (u: number, v: number) => 0.92 + (fbm(u, v, 6, 21, 4) - 0.5) * 0.14
        : kind === 'metal'
          ? (u: number, v: number) => {
              const streak = fbm(u * 0.15, v * 3, 4, 31, 3);
              return 0.88 + (streak - 0.5) * 0.22 + (fbm(u, v, 8, 33, 3) - 0.5) * 0.08;
            }
          : kind === 'cast'
            ? (u: number, v: number) => {
                // Cast iron: a raised diamond tread, its tops worn bright, its hollows dark
                // with grime, and the metal's own streaks over it.
                const a = Math.abs(((u * 10 + v * 10) % 1) - 0.5);
                const b = Math.abs(((u * 10 - v * 10 + 10) % 1) - 0.5);
                const stud = Math.max(0, 1 - Math.hypot(a, b) / 0.22);
                const streak = fbm(u * 0.2, v * 2, 4, 37, 3);
                const grime = fbm(u, v, 5, 39, 3);
                return 0.62 + stud * 0.4 + (streak - 0.5) * 0.18 - Math.max(0, grime - 0.55) * 0.5;
              }
            : kind === 'soil'
              ? (u: number, v: number) => {
                  // Clods and crumbs of earth, a pale grain of grit and a dark pit here and there.
                  const clods = fbm(u, v, 9, 41, 3);
                  const crumbs = fbm(u, v, 34, 43, 2);
                  const grit = hash(Math.floor(u * 256), Math.floor(v * 256), 45);
                  const speck = grit > 0.94 ? 0.3 : grit < 0.05 ? -0.25 : 0;
                  return 0.74 + (clods - 0.5) * 0.5 + (crumbs - 0.5) * 0.4 + speck;
                }
              : () => 1;
  // Paint's tile is finer, for its scuffs.
  const size = kind === 'none' ? 4 : kind === 'paint' ? 512 : 256;
  mottles.set(kind, (t = greyTexture(size, at)));
  return t;
}

const painted = new Map<string, THREE.DataTexture>();

/** How much coarser the rough copy is that stands in while a texture is painted in a worker. */
const ROUGH = 8;

/** A painting as a texture, sampled as the ground's big textures all are. */
function paintedTexture({ data, width, height }: Painting): THREE.DataTexture {
  const t = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/**
 * The texture `job` paints (see `paint.ts`), painted once for each job and shared after: the
 * ground's and the road's are millions of pixels, seconds of work each, and every round on a map
 * lays the same ground out again. Kept in the browser too, for the next visit (see
 * `paintCache.ts`). Painted in a worker where there are workers, so the page does not stand still
 * meanwhile: until it is done the texture is a rough copy, an eighth as fine and painted at once,
 * and the finished pixels are laid into it when they come.
 */
export function paintedOnce(job: PaintJob): THREE.DataTexture {
  const k = JSON.stringify(job);
  const at = performance.now();
  let t = painted.get(k);
  let from: 'painted' | 'stored' | 'shared' | 'rough' = 'shared';
  if (!t) {
    const stored = storedPainting(k);
    const away = stored ? null : paintAway(job);
    if (stored) {
      from = 'stored';
      t = stored;
    } else if (away) {
      from = 'rough';
      const [width, height] = paintingSize(job);
      const rough = paintedTexture(stretched(paint(job, job.perMetre / ROUGH), width, height));
      t = rough;
      const lay = (p: Painting) => {
        rough.image = p;
        rough.needsUpdate = true;
        storePainting(k, rough);
      };
      away.then(
        (p) => {
          lay(p);
          profiler.note({
            kind: 'texture',
            at,
            ms: performance.now() - at,
            key: k,
            from: 'worker',
          });
        },
        // The worker gave out: painted here after all.
        () => lay(paint(job)),
      );
    } else {
      from = 'painted';
      t = paintedTexture(paint(job));
      storePainting(k, t);
    }
  }
  painted.set(k, t);
  profiler.note({ kind: 'texture', at, ms: performance.now() - at, key: k, from });
  return t;
}

export interface MatOptions {
  roughness?: number;
  metalness?: number;
  mottle?: Mottle;
  emissive?: number;
  emissiveIntensity?: number;
  envMapIntensity?: number;
  /** A clear lacquer over it, as on car paint: how much, and how smooth. */
  clearcoat?: number;
  clearcoatRoughness?: number;
  side?: THREE.Side;
  transparent?: boolean;
  opacity?: number;
  vertexColors?: boolean;
}

const materials = new Map<string, THREE.MeshStandardMaterial>();

/** A material of `colour`, shared between parts that are alike. */
export function mat(colour: number, o: MatOptions = {}): THREE.MeshStandardMaterial {
  const key = JSON.stringify([colour, o]);
  let m = materials.get(key);
  if (!m) {
    const mottle = o.mottle ?? 'plastic';
    const kind = o.clearcoat ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
    m = madeOf(
      new kind({
        ...(o.clearcoat
          ? { clearcoat: o.clearcoat, clearcoatRoughness: o.clearcoatRoughness ?? 0.1 }
          : {}),
        color: colour,
        map: mottle === 'none' ? null : mottleTexture(mottle),
        // Paint's sheen breaks up with its grime, as the picture's does: duller in the smudges.
        roughnessMap: mottle === 'paint' ? mottleTexture(mottle) : null,
        roughness: o.roughness ?? 0.6,
        metalness: o.metalness ?? 0,
        emissive: o.emissive ?? 0x000000,
        emissiveIntensity: o.emissiveIntensity ?? 1,
        envMapIntensity: o.envMapIntensity ?? 1,
        side: o.side ?? THREE.FrontSide,
        transparent: o.transparent ?? false,
        opacity: o.opacity ?? 1,
        vertexColors: o.vertexColors ?? false,
      }),
      Surface.None,
    );
    m.userData.mottle = mottle;
    materials.set(key, m);
  }
  return m;
}

/** Earth, dark and crumbly, for the planters. */
export const soil = () => mat(0x4a3526, { mottle: 'soil', roughness: 1 });

/**
 * A bed of soil `w × d` lying flat at y = 0, its middle heaped a little and its surface lumpy, its
 * edges at 0 so that it meets the walls round it; round (`w` across) if `round`.
 */
export function soilBed(w: number, d: number, seed: number, round = false): THREE.BufferGeometry {
  const geo = round
    ? new THREE.RingGeometry(0, w / 2, 48, 12)
    : new THREE.PlaneGeometry(w, d, Math.ceil(w / 0.04), Math.ceil(d / 0.04));
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const [x, z] = [pos.getX(i), pos.getZ(i)];
    const edge = round
      ? w / 2 - Math.hypot(x, z)
      : Math.min(w / 2 - Math.abs(x), d / 2 - Math.abs(z));
    const rise = Math.min(1, edge / 0.08);
    const lumps = fbm(x / 0.6 + 0.5, z / 0.6 + 0.5, 6, seed, 3) - 0.5;
    pos.setY(i, rise * (0.012 + lumps * 0.02));
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * A light that glows `colour`, brighter than white so it blooms. (Its own colour is the glow's
 * too: the game's style scales the glow by it.)
 */
export function glow(colour: number, intensity = 3): THREE.MeshStandardMaterial {
  return mat(colour, {
    emissive: colour,
    emissiveIntensity: intensity,
    roughness: 0.4,
    mottle: 'none',
  });
}

/**
 * Lays texture coordinates over `geo` projected along each face's main axis, at `tile` metres to
 * a tile, so a long panel shows more of the mottle rather than a stretched one.
 */
export function boxUV(geo: THREE.BufferGeometry, tile: number, seed = 0): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.normal) g.computeVertexNormals();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  const uv = new Float32Array(n * 2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const off = [hash(seed, 1, 5) * 7, hash(seed, 2, 5) * 7];
  for (let t = 0; t < n; t += 3) {
    a.fromBufferAttribute(pos, t);
    b.fromBufferAttribute(pos, t + 1);
    c.fromBufferAttribute(pos, t + 2);
    const face = c.clone().sub(b).cross(a.clone().sub(b));
    const f = [Math.abs(face.x), Math.abs(face.y), Math.abs(face.z)];
    const axis = f.indexOf(Math.max(...f));
    const [ua, va] = [(axis + 1) % 3, (axis + 2) % 3];
    for (let k = 0; k < 3; k++) {
      const p = [pos.getX(t + k), pos.getY(t + k), pos.getZ(t + k)];
      uv[(t + k) * 2] = p[ua]! / tile + off[0]!;
      uv[(t + k) * 2 + 1] = p[va]! / tile + off[1]!;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** A mesh of `geometry` in `material` at (`x`, `y`, `z`), turned `rx`, `ry`, `rz`. */
export function put(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}

let uvSeeds = 0;

/** Texture coordinates for `geo` at the size its material's mottle is painted at. */
function mottled(geo: THREE.BufferGeometry, material: THREE.Material): THREE.BufferGeometry {
  const kind = (material.userData.mottle as Mottle | undefined) ?? 'none';
  if (kind === 'none') return geo;
  const out = boxUV(geo, MOTTLE_TILE[kind], ++uvSeeds);
  if (out !== geo) SHAPES.set(out, geo);
  return out;
}

/**
 * The geometry a mottled one was made from (a box, a can, a ball, with its `parameters`), by the
 * geometry it was made into: what the walker collides with as that shape.
 */
export const SHAPES = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/** A box `sx × sy × sz` with rounded edges `r` deep, centred at (`x`, `y`, `z`). */
export function rbox(
  parent: THREE.Object3D,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  r = Math.min(sx, sy, sz) * 0.2,
  rot: [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  const rr = Math.min(r, Math.min(sx, sy, sz) * 0.499);
  const geo = new RoundedBoxGeometry(sx, sy, sz, rr > 0.008 ? 3 : 1, rr);
  return put(parent, mottled(geo, material), material, x, y, z, ...rot);
}

/**
 * `rbox` with crisp edges: rounded only a little (`r`, at most 3 cm), so it reads as pressed
 * sheet or moulded plastic and its edges still catch a line of light.
 */
export function cbox(
  parent: THREE.Object3D,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  r = 0.03,
  rot: [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  return rbox(parent, material, x, y, z, sx, sy, sz, Math.min(r, 0.03), rot);
}

/** A rounded-off outline `w × h` centred on the origin, its corners `r` round. */
export function roundRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const [x0, y0, x1, y1] = [-w / 2, -h / 2, w / 2, h / 2];
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0);
  s.quadraticCurveTo(x1, y0, x1, y0 + r);
  s.lineTo(x1, y1 - r);
  s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1);
  s.quadraticCurveTo(x0, y1, x0, y1 - r);
  s.lineTo(x0, y0 + r);
  s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}

/** An outline through `points`, each corner rounded `r` (or its own third value). */
export function roundedOutline(
  corners: ([number, number] | [number, number, number])[],
  r: number,
): THREE.Shape {
  const s = new THREE.Shape();
  // A corner on top of the one before it would leave no edge between them to round along.
  const points = corners.filter((p, i) => {
    const q = corners[(i + corners.length - 1) % corners.length]!;
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4;
  });
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    const prev = points[(i + n - 1) % n]!;
    const next = points[(i + 1) % n]!;
    const rr = p[2] ?? r;
    const dIn = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    const dOut = Math.hypot(next[0] - p[0], next[1] - p[1]);
    const k = Math.min(rr, dIn * 0.45, dOut * 0.45);
    const a = [p[0] + ((prev[0] - p[0]) / dIn) * k, p[1] + ((prev[1] - p[1]) / dIn) * k];
    const b = [p[0] + ((next[0] - p[0]) / dOut) * k, p[1] + ((next[1] - p[1]) / dOut) * k];
    if (i === 0) s.moveTo(a[0]!, a[1]!);
    else s.lineTo(a[0]!, a[1]!);
    s.quadraticCurveTo(p[0], p[1], b[0]!, b[1]!);
  }
  s.closePath();
  return s;
}

/**
 * `shape` (in x, y) pushed out `depth` along z, centred on z = 0, its edges rounded `bevel`
 * deep (or cut off flat, with one `segments`).
 */
export function slab(
  shape: THREE.Shape,
  depth: number,
  bevel = 0.02,
  curve = 12,
  segments = 3,
): THREE.BufferGeometry {
  const b = Math.min(bevel, depth * 0.45);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, depth - 2 * b),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: b > 0 ? segments : 0,
    curveSegments: curve,
  });
  geo.translate(0, 0, -(depth - 2 * b) / 2);
  // Smooth round its bevels and curves, sharp where its faces meet at a corner.
  return toCreasedNormals(geo, Math.PI / 4);
}

/**
 * `slab` with its broad faces kept flat: the rounding of its edges would otherwise bend the
 * light across their long thin triangles, from every corner of the openings cut in them.
 */
export function flatSlab(shape: THREE.Shape, depth: number, b: number): THREE.BufferGeometry {
  const geo = slab(shape, depth, b);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const [a, c, e] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let t = 0; t < pos.count; t += 3) {
    a.fromBufferAttribute(pos, t);
    c.fromBufferAttribute(pos, t + 1);
    e.fromBufferAttribute(pos, t + 2);
    const n = e.sub(c).cross(a.sub(c)).normalize();
    if (Math.abs(n.z) > 0.999) for (let k = 0; k < 3; k++) nor.setXYZ(t + k, 0, 0, Math.sign(n.z));
  }
  return geo;
}

/** `slab` as a mesh, mottled to suit its material. */
export function putSlab(
  parent: THREE.Object3D,
  shape: THREE.Shape,
  depth: number,
  material: THREE.Material,
  bevel = 0.02,
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.Mesh {
  return put(parent, mottled(slab(shape, depth, bevel), material), material, x, y, z, rx, ry, rz);
}

/** `putSlab` with its broad faces kept flat, as `flatSlab`. */
export function putFlatSlab(
  parent: THREE.Object3D,
  shape: THREE.Shape,
  depth: number,
  material: THREE.Material,
  bevel = 0.02,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  return put(parent, mottled(flatSlab(shape, depth, bevel), material), material, x, y, z);
}

/** A path through `points` with each corner bent round `r`, for tubes. */
export function bentPath(
  points: THREE.Vector3[],
  r: number,
  closed = false,
): THREE.CurvePath<THREE.Vector3> {
  const path = new THREE.CurvePath<THREE.Vector3>();
  const n = points.length;
  const corner = (i: number) => {
    const p = points[i]!;
    const prev = points[(i + n - 1) % n]!;
    const next = points[(i + 1) % n]!;
    const dIn = p.distanceTo(prev);
    const dOut = p.distanceTo(next);
    const k = Math.min(r, dIn * 0.45, dOut * 0.45);
    return {
      a: p.clone().lerp(prev, k / dIn),
      p,
      b: p.clone().lerp(next, k / dOut),
    };
  };
  if (closed) {
    const cs = points.map((_, i) => corner(i));
    for (let i = 0; i < n; i++) {
      const c = cs[i]!;
      const nx = cs[(i + 1) % n]!;
      path.add(new THREE.QuadraticBezierCurve3(c.a, c.p, c.b));
      path.add(new THREE.LineCurve3(c.b, nx.a));
    }
  } else {
    let from = points[0]!.clone();
    for (let i = 1; i < n - 1; i++) {
      const c = corner(i);
      path.add(new THREE.LineCurve3(from, c.a));
      path.add(new THREE.QuadraticBezierCurve3(c.a, c.p, c.b));
      from = c.b;
    }
    path.add(new THREE.LineCurve3(from, points[n - 1]!.clone()));
  }
  return path;
}

/** A tube `radius` thick along `path`. */
export function tube(
  parent: THREE.Object3D,
  path: THREE.Curve<THREE.Vector3>,
  radius: number,
  material: THREE.Material,
  closed = false,
): THREE.Mesh {
  const len = path.getLength();
  const geo = new THREE.TubeGeometry(path, Math.max(16, Math.round(len * 40)), radius, 12, closed);
  const shaped = mottled(geo, material);
  TUBES.set(shaped, { path, radius });
  return put(parent, shaped, material);
}

/**
 * Each tube's path and radius, by its geometry: what the walker collides with as a chain of
 * capsules rather than its many thin triangles.
 */
export const TUBES = new WeakMap<
  THREE.BufferGeometry,
  { path: THREE.Curve<THREE.Vector3>; radius: number }
>();

/** A seeded random in [0, 1). */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
