import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { Surface, madeOf } from '../render/styles.ts';

/**
 * The small toolkit the car scene is modelled with: smooth rounded blocks, extruded outlines and
 * bent tubes, laid with a soft hand-painted mottle at a fixed size in the world, and the scene's
 * materials, all left out of the game's own painted style (`Surface.None`): the picture this map
 * copies is smooth studio paint, not the game's chunky boards and grass.
 */

/** A value in [0, 1) for a lattice point, the same every time. */
export function hash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const wrap = (i: number, p: number) => ((i % p) + p) % p;
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Smooth noise repeating every `p` cells. */
export function noise(x: number, y: number, p: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const [x0, x1, y0, y1] = [wrap(ix, p), wrap(ix + 1, p), wrap(iy, p), wrap(iy + 1, p)];
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
export type Mottle = 'paint' | 'plastic' | 'metal' | 'none';

/** How many metres one tile of each mottle covers. */
const MOTTLE_TILE: Record<Mottle, number> = { paint: 2.2, plastic: 1.2, metal: 0.8, none: 1 };

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

/** How much of a scuff covers (`u`, `v`): 1 on a dash, fading off it over a few millimetres. */
function scuff(u: number, v: number): number {
  let best = Infinity;
  for (const d of SCUFFS)
    for (const [ox, oy] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const px = u - d.x - ox;
      const py = v - d.y - oy;
      const t = Math.max(0, Math.min(1, (px * d.dx + py * d.dy) / (d.dx * d.dx + d.dy * d.dy)));
      best = Math.min(best, Math.hypot(px - t * d.dx, py - t * d.dy));
    }
  const w = 0.002 / MOTTLE_TILE.paint;
  return Math.max(0, 1 - best / (w * 2));
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
          : () => 1;
  // Paint's tile is finer, for its scuffs.
  const size = kind === 'none' ? 4 : kind === 'paint' ? 512 : 256;
  mottles.set(kind, (t = greyTexture(size, at)));
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
  return kind === 'none' ? geo : boxUV(geo, MOTTLE_TILE[kind], ++uvSeeds);
}

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
  return put(parent, mottled(geo, material), material);
}

/** A seeded random in [0, 1). */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
