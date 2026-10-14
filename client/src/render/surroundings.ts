import * as THREE from 'three';
import { floorRect } from '@sar/shared';
import type { BoxDef, FloorRect, LevelDef } from '@sar/shared';
import { NO_AO } from './layers.ts';
import { untraced } from './raytrace.ts';
import { SHORES, Surface, levelShores, madeOf } from './styles.ts';

/**
 * The country round a level, beyond its fence: rolling hills, clumps of trees, rocks and what
 * else stands about where the level is (houses round the house, sheds round the merchant's,
 * fields and a village round the station, pine woods, mountains and the lake round the camp),
 * or for an island, the open sea with a few islets and stacks of rock standing out of it.
 * Before, the fence stood at the edge of nothing, with sky all round above it and haze below.
 *
 * It is scenery only: it starts outside the fence, never casts a shadow or takes one, and
 * nothing aims at it. It is built once per level, the same every time, as few big meshes (the
 * land and all that stands on it, and the water) lit by the scene's light, and fades into the
 * horizon's haze with the fog. The view shows it with the sky, but not on the build editor's map.
 */

/** What the country round a level is like. */
export type Scenery = 'suburb' | 'industry' | 'farmland' | 'forest' | 'sea';

/**
 * What the country round `level` is like, from what the level is: an island's open sea, the
 * camp's lake and grass among woods, the station's tracks out through farmland, the merchant's
 * yard among sheds and the house's garden among other houses.
 */
export function sceneryOf(level: LevelDef): Scenery {
  // (The sea itself is the level's, drawn in every style: see `seaMeshes`.)
  if (level.sea !== undefined) return 'sea';
  if (level.water?.length || level.groundSurface === 'grass') return 'forest';
  if (level.boxes.some((b) => b.model === 'ballast')) return 'farmland';
  if (level.groundColour !== undefined) return 'industry';
  return 'suburb';
}

/** The water's top, as the level's own (see `buildLevelScene`). */
const WATER_Y = 0.06;
/** The fence's outer face, out from the level's edge (fences are 0.3 m thick, on the edge). */
const FENCE_OUT = 0.15;
/**
 * The rings of ground round the level, as how far each is out past the fence: close together
 * near it, where they are seen close up and from inside, and far apart out in the fog. The last
 * is further than the camera sees.
 */
const RINGS = [0, 1, 2.5, 4.5, 7, 10, 14, 19, 25, 32, 41, 52, 65, 80, 98, 120, 145, 175, 215];
/** How far apart the ground's corners are along the fence, about. */
const ALONG = 1.6;
/** Where the light comes from, across the ground (the sun's, see `View`), for painting. */
const SUN = new THREE.Vector3(10, 8, 7.5).normalize();

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** A hash of a whole-numbered point, in [0, 1). */
function hash(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed + 1, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise over the ground, in [0, 1). */
export function noise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed);
  const b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed);
  const d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

/** Three octaves of `noise`, in [0, 1). */
function fbm(x: number, z: number, seed: number): number {
  return (
    (noise(x, z, seed) * 4 +
      noise(x * 2.1, z * 2.1, seed + 7) * 2 +
      noise(x * 4.3, z * 4.3, seed + 13)) /
    7
  );
}

/** A seeded random number generator (mulberry32), in [0, 1). */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const colour = (hex: number) => new THREE.Color(hex);

/**
 * A lake that runs on out past the fence from the level's own water: an oval reaching `ru`
 * along the fence either way and `rv` out, its near shore where the level's water starts, in
 * the frame of the side it leaves by (`u` along it, `v` out of it).
 */
interface Lake {
  /** Along the side, out of it: as unit vectors on the ground. */
  along: THREE.Vector2;
  out: THREE.Vector2;
  centre: THREE.Vector2;
  ru: number;
  rv: number;
}

/**
 * A railway cutting that runs on out past the fence: its floor `y` and its width `w0`..`w1`
 * across, out of the level's side along `out`, with the tracks in it.
 */
interface Cutting {
  out: THREE.Vector2;
  /** Where the fence's outer face is, along `out`. */
  from: number;
  w0: number;
  w1: number;
  y: number;
  beds: BoxDef[];
}

/** An islet out at sea: a mound `r` round at (`x`, `z`), rising `h` out of the water. */
interface Islet {
  x: number;
  z: number;
  r: number;
  h: number;
}

/** The ground's shape round a level: its height everywhere past the fence. */
class Land {
  readonly rect: FloorRect;
  readonly centre: THREE.Vector2;
  readonly lakes: Lake[] = [];
  readonly cuttings: Cutting[] = [];
  /** Round an island: the islets out at sea (the rest is sea bed, under it). */
  readonly islets: Islet[] = [];
  /** The sea's level, round an island. */
  readonly sea: number;

  constructor(
    level: LevelDef,
    readonly scenery: Scenery,
  ) {
    this.sea = level.sea ?? 0;
    const r = (this.rect = floorRect(level));
    this.centre = new THREE.Vector2((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
    const sides = [
      { out: new THREE.Vector2(1, 0), at: r.x1 },
      { out: new THREE.Vector2(-1, 0), at: -r.x0 },
      { out: new THREE.Vector2(0, 1), at: r.z1 },
      { out: new THREE.Vector2(0, -1), at: -r.z0 },
    ];
    // The level's water that reaches the fence goes on out past it, as a lake.
    for (const w of level.water ?? []) {
      for (const { out, at } of sides) {
        const far = out.x !== 0 ? (out.x > 0 ? w.x1 : -w.x0) : out.y > 0 ? w.z1 : -w.z0;
        const near = out.x !== 0 ? (out.x > 0 ? w.x0 : -w.x1) : out.y > 0 ? w.z0 : -w.z1;
        // Water right along a side (the lake's own side fences) is left to the other side's.
        const span = out.x !== 0 ? w.z1 - w.z0 : w.x1 - w.x0;
        if (Math.abs(far - at) > 0.5 || span < far - near) continue;
        const along = new THREE.Vector2(-out.y, out.x);
        const mid = new THREE.Vector2((w.x0 + w.x1) / 2, (w.z0 + w.z1) / 2);
        const rv = 36;
        const centre = along
          .clone()
          .multiplyScalar(mid.dot(along))
          .addScaledVector(out, near + rv);
        this.lakes.push({ along, out, centre, ru: 92, rv });
      }
    }
    // The tracks that run out to the fence (the station's) go on out in their cutting.
    const holes = level.groundHoles ?? (level.groundHole ? [level.groundHole] : []);
    for (const hole of holes) {
      for (const { out, at } of sides) {
        const far = out.x !== 0 ? (out.x > 0 ? hole.x1 : -hole.x0) : out.y > 0 ? hole.z1 : -hole.z0;
        if (Math.abs(far - at) > 0.5) continue;
        const beds = level.boxes.filter((b) => {
          if (b.model !== 'ballast' && b.model !== 'trackRail') return false;
          const end = out.x !== 0 ? b.pos.x * out.x + b.size.x / 2 : b.pos.z * out.y + b.size.z / 2;
          return Math.abs(end - at) < 1;
        });
        if (!beds.length) continue;
        const [w0, w1] = out.x !== 0 ? [hole.z0, hole.z1] : [hole.x0, hole.x1];
        const floor = Math.min(...beds.map((b) => b.pos.y - b.size.y / 2));
        this.cuttings.push({ out, from: at + FENCE_OUT, w0, w1, y: floor, beds });
      }
    }
  }

  /**
   * Whether a building `w` by `d` at (`x`, `z`) turned `yaw` stands wholly out past the fence
   * (round its edges, every couple of metres).
   */
  outside(x: number, z: number, w: number, d: number, yaw: number): boolean {
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const nu = Math.ceil(w / 2);
    const nv = Math.ceil(d / 2);
    for (let i = 0; i <= nu; i++) {
      for (let k = 0; k <= nv; k++) {
        if (i > 0 && i < nu && k > 0 && k < nv) continue;
        const u = (i / nu - 0.5) * w;
        const v = (k / nv - 0.5) * d;
        if (this.past(x + u * cos + v * sin, z - u * sin + v * cos) < FENCE_OUT + 0.6) return false;
      }
    }
    return true;
  }

  /** How far (`x`, `z`) is out past the level's edge (0 inside). */
  past(x: number, z: number): number {
    const r = this.rect;
    const dx = Math.max(r.x0 - x, 0, x - r.x1);
    const dz = Math.max(r.z0 - z, 0, z - r.z1);
    return Math.hypot(dx, dz);
  }

  /** How far into a lake (`x`, `z`) is: under 1 in its water, the shore at 1. */
  lake(x: number, z: number): number {
    let best = Infinity;
    for (const l of this.lakes) {
      const dx = x - l.centre.x;
      const dz = z - l.centre.y;
      const u = (dx * l.along.x + dz * l.along.y) / l.ru;
      const v = (dx * l.out.x + dz * l.out.y) / l.rv;
      // A wobbly shore, but straight where it meets the fence.
      const wobble = 1 + (noise(x / 18, z / 18, 5) - 0.5) * 0.3 * smooth(4, 20, this.past(x, z));
      best = Math.min(best, (u * u + v * v) * wobble);
    }
    return best;
  }

  /** The ground's height at (`x`, `z`). */
  height(x: number, z: number): number {
    const d = this.past(x, z);
    const near = fbm(x / 34, z / 34, 1);
    const far = fbm(x / 95, z / 95, 2);
    let h: number;
    switch (this.scenery) {
      case 'suburb':
        h = smooth(2, 32, d) * (0.5 + 9 * near) + smooth(35, 130, d) * 34 * far * far;
        break;
      case 'industry':
        // A flat yard round the fence, where the sheds stand, and hills behind.
        h = smooth(30, 55, d) * (1 + 10 * near) + smooth(55, 140, d) * 30 * far * far;
        break;
      case 'farmland':
        h = smooth(4, 45, d) * (0.3 + 6 * near) + smooth(40, 150, d) * 24 * far * far;
        break;
      case 'forest':
        h = smooth(2, 28, d) * (1 + 12 * near) + smooth(30, 120, d) * 40 * far * far;
        break;
      case 'sea':
        // The sea bed, and the islets rising out of it: a shelf of sand round each under the
        // water, and its hump.
        h = this.sea - 6;
        for (const i of this.islets) {
          const q =
            (Math.hypot(x - i.x, z - i.z) / i.r) * (1 + (noise(x / 7, z / 7, 21) - 0.5) * 0.4);
          const hump = smooth(1, 0, q);
          h = Math.max(h, this.sea - 1.5 + 1.9 * smooth(1.15, 0.75, q) + (i.h - 0.4) * hump * hump);
        }
        break;
    }
    if (this.lakes.length) {
      const e = this.lake(x, z);
      if (e < 1) {
        // The lake's bed, deepening away from the shore.
        h = WATER_Y - 0.12 - 3.5 * smooth(1, 0.5, e);
      } else {
        // A beach along the shore, rising into the hills behind.
        const t = smooth(1, 1.7, e);
        h = mix(WATER_Y + 0.08 + 0.5 * smooth(1, 1.15, e), h, t * t);
      }
    }
    for (const c of this.cuttings) {
      const along = x * c.out.x + z * c.out.y;
      if (along < c.from - 0.01) continue;
      const across = c.out.x !== 0 ? z : x;
      const off = Math.max(c.w0 - across, 0, across - c.w1);
      h = Math.min(h, c.y + off * 0.8);
    }
    return h;
  }

  /** The ground's lowest height round (`x`, `z`) out to `r`, to sink something into it. */
  low(x: number, z: number, r: number): number {
    let h = this.height(x, z);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      h = Math.min(h, this.height(x + Math.cos(a) * r, z + Math.sin(a) * r));
    }
    return h;
  }

  /** The ground's normal at (`x`, `z`). */
  normal(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const e = 0.6;
    const dx = this.height(x + e, z) - this.height(x - e, z);
    const dz = this.height(x, z + e) - this.height(x, z - e);
    return out.set(-dx, 2 * e, -dz).normalize();
  }

  /** Whether something `r` round could stand at (`x`, `z`): clear of the level, lakes, cuttings. */
  free(x: number, z: number, r: number): boolean {
    if (this.past(x, z) < r + 0.6) return false;
    if (this.lakes.length && this.lake(x, z) < 1.15) return false;
    for (const c of this.cuttings) {
      const along = x * c.out.x + z * c.out.y;
      const across = c.out.x !== 0 ? z : x;
      if (along > c.from - r - 2 && across > c.w0 - r - 3 && across < c.w1 + r + 3) return false;
    }
    return true;
  }
}

/** The triangles of one mesh, as they are gathered: every corner its own, with its normal and colour. */
class Mesh {
  private readonly position: number[] = [];
  private readonly normal: number[] = [];
  private readonly colour: number[] = [];

  corner(p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color): void {
    this.position.push(p.x, p.y, p.z);
    this.normal.push(n.x, n.y, n.z);
    this.colour.push(c.r, c.g, c.b);
  }

  get triangles(): number {
    return this.position.length / 9;
  }

  /** These meshes' triangles in one geometry, drawn in the order given. */
  static geometry(...meshes: Mesh[]): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    const join = (key: 'position' | 'normal' | 'colour') => meshes.flatMap((m) => m[key]);
    g.setAttribute('position', new THREE.Float32BufferAttribute(join('position'), 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(join('normal'), 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(join('colour'), 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** How a shape is put into a `Mesh`. */
interface Put {
  matrix: THREE.Matrix4;
  /** Its colour at a corner, from where the corner is and the way it faces (world space). */
  paint: (p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) => void;
  /** Faceted: each face lit flat, as cut stone is (else as smooth as the shape's own normals). */
  flat?: boolean;
  /** Bends the shape's corners before they are placed (in its own space). */
  shape?: (p: THREE.Vector3) => void;
  /** Smooth normals straight out from the shape's middle (a blob's), not its own. */
  round?: boolean;
}

const _p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _n = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _c = new THREE.Color();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _normalMatrix = new THREE.Matrix3();

/** Puts `shape` (a three.js geometry, indexed or not) into `mesh`. */
function put(mesh: Mesh, shape: THREE.BufferGeometry, how: Put): void {
  const g = shape.index ? shape.toNonIndexed() : shape;
  const pos = g.attributes.position!;
  const nor = g.attributes.normal;
  _normalMatrix.getNormalMatrix(how.matrix);
  for (let i = 0; i < pos.count; i += 3) {
    for (let k = 0; k < 3; k++) {
      const p = _p[k]!.fromBufferAttribute(pos, i + k);
      const n = _n[k]!;
      if (how.round || !nor) n.copy(p).normalize();
      else n.fromBufferAttribute(nor, i + k);
      how.shape?.(p);
      p.applyMatrix4(how.matrix);
      n.applyMatrix3(_normalMatrix).normalize();
    }
    if (how.flat) {
      _e1.subVectors(_p[1]!, _p[0]!);
      _e2.subVectors(_p[2]!, _p[0]!);
      const f = _e1.cross(_e2).normalize();
      for (const n of _n) n.copy(f);
    }
    for (let k = 0; k < 3; k++) {
      how.paint(_p[k]!, _n[k]!, _c);
      mesh.corner(_p[k]!, _n[k]!, _c);
    }
  }
  if (g !== shape) g.dispose();
}

// The shapes everything is made of, made once.
const BLOB = new THREE.IcosahedronGeometry(1, 1);
const LUMP = new THREE.IcosahedronGeometry(1, 0);
const STONE = new THREE.IcosahedronGeometry(1, 1);
const TRUNK = new THREE.CylinderGeometry(0.7, 1, 1, 5, 1, true).translate(0, 0.5, 0);
const CONE = new THREE.ConeGeometry(1, 1, 7, 1, true).translate(0, 0.5, 0);
/** A pine's tier of boughs: a cone with a branch tip every other corner round its rim. */
const BOUGHS = new THREE.ConeGeometry(1, 1, 14, 1, true).translate(0, 0.5, 0);
const BOX = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const PEAK = new THREE.ConeGeometry(1, 1, 11, 4, true).translate(0, 0.5, 0);
const TANK = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false).translate(0, 0.5, 0);

/** A gable roof's shape, a metre each way and a metre high, over its eaves at 0. */
const GABLE = (() => {
  const g = new THREE.BufferGeometry();
  // Two slopes and the two gable ends.
  const v = [
    [-0.5, 0, -0.5, 0, 1, -0.5, 0, 1, 0.5],
    [-0.5, 0, -0.5, 0, 1, 0.5, -0.5, 0, 0.5],
    [0.5, 0, -0.5, 0.5, 0, 0.5, 0, 1, 0.5],
    [0.5, 0, -0.5, 0, 1, 0.5, 0, 1, -0.5],
    [-0.5, 0, 0.5, 0, 1, 0.5, 0.5, 0, 0.5],
    [-0.5, 0, -0.5, 0.5, 0, -0.5, 0, 1, -0.5],
  ].flat();
  // Each face wound to face out, away from the middle.
  const p = [0, 1, 2].map(() => new THREE.Vector3());
  const middle = new THREE.Vector3(0, 0.3, 0);
  for (let i = 0; i < v.length; i += 9) {
    p.forEach((q, k) => q.fromArray(v, i + k * 3));
    const n = p[1]!.clone().sub(p[0]!).cross(p[2]!.clone().sub(p[0]!));
    if (n.dot(p[0]!.clone().add(p[1]!).add(p[2]!).divideScalar(3).sub(middle)) < 0) {
      p[1]!.toArray(v, i + 6);
      p[2]!.toArray(v, i + 3);
    }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  return g;
})();

/** Paints a shape in one colour, lighter on its faces turned up, as painted with light from above. */
function plain(hex: number, up = 0.12): Put['paint'] {
  const c = colour(hex);
  return (_p, n, out) => out.copy(c).multiplyScalar(1 - up + up * (0.5 + 0.5 * n.y));
}

/**
 * Paints foliage in three tones, as a painter would: dark and cool underneath and on the side
 * away from the sun, its own green, and a warm light green where the sun catches it on top.
 */
function foliage(dark: THREE.Color, mid: THREE.Color, light: THREE.Color): Put['paint'] {
  return (_p, n, out) => {
    const sun = 0.5 + 0.5 * (n.y * 0.7 + (n.x * SUN.x + n.z * SUN.z) * 0.6);
    out
      .copy(dark)
      .lerp(mid, smooth(0.25, 0.6, sun))
      .lerp(light, smooth(0.72, 1, sun));
  };
}

/** Paints rock: pale on its tops, blue-grey on its sides, dark underneath, a little uneven. */
function rock(tint: number): Put['paint'] {
  const top = colour(0xe2ddd1);
  const side = colour(0xa1a7b2);
  const under = colour(0x666d7c);
  return (p, n, out) => {
    out
      .copy(under)
      .lerp(side, smooth(-0.6, 0.1, n.y))
      .lerp(top, smooth(0.45, 0.75, n.y))
      .multiplyScalar(tint * (0.94 + 0.12 * noise(p.x * 0.7, p.z * 0.7 + p.y, 9)));
  };
}

/**
 * Everything the land carries, gathered as it is built: what stands on it, the shade under it,
 * and the ground, drawn in that order (in one mesh), so the ground hidden under the rest is never
 * shaded; and the water.
 */
class Builder {
  readonly things = new Mesh();
  readonly shadows = new Mesh();
  readonly ground = new Mesh();
  readonly water = new Mesh();
  /** Where things already stand, by the 4 m square, so nothing stands in another. */
  private readonly taken = new Map<string, { x: number; z: number; r: number }[]>();
  private readonly matrix = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(
    readonly land: Land,
    readonly rnd: () => number,
  ) {}

  /** Places a shape at (`x`, `y`, `z`) turned `yaw` about the vertical and scaled `s`. */
  at(x: number, y: number, z: number, s: THREE.Vector3, yaw = 0): THREE.Matrix4 {
    this.q.setFromAxisAngle(this.up, yaw);
    return this.matrix.compose(new THREE.Vector3(x, y, z), this.q, s);
  }

  /**
   * Whether something `r` round fits at (`x`, `z`), clear of what already stands about and
   * `clear` clear of the level, and if so takes the place.
   */
  claim(x: number, z: number, r: number, clear = r): boolean {
    if (!this.land.free(x, z, clear)) return false;
    const ix = Math.floor(x / 4);
    const iz = Math.floor(z / 4);
    const reach = Math.ceil(r / 4) + 2;
    for (let i = ix - reach; i <= ix + reach; i++) {
      for (let k = iz - reach; k <= iz + reach; k++) {
        for (const o of this.taken.get(`${i},${k}`) ?? []) {
          if (Math.hypot(o.x - x, o.z - z) < (o.r + r) * 0.8) return false;
        }
      }
    }
    const key = `${ix},${iz}`;
    const list = this.taken.get(key) ?? [];
    list.push({ x, z, r });
    this.taken.set(key, list);
    return true;
  }

  /**
   * A soft darker patch on the ground round something standing on it, a little away from the
   * sun, standing in for the shadow it does not cast (nothing out here does).
   */
  shade(x: number, z: number, r: number, depth = 0.6): void {
    const cx = x - SUN.x * r * 0.4;
    const cz = z - SUN.z * r * 0.4;
    // Never over the fence into the level.
    r = Math.min(r, this.land.past(cx, cz) - FENCE_OUT - 0.3);
    if (r < 0.5) return;
    const ring = 7;
    const n = new THREE.Vector3();
    const centre = new THREE.Vector3(cx, this.land.height(cx, cz) + 0.1, cz);
    const groundAt = (px: number, pz: number, out: THREE.Color) => this.paintGround(px, pz, out);
    const middle = new THREE.Color();
    groundAt(cx, cz, middle).multiplyScalar(depth);
    for (let i = 0; i < ring; i++) {
      const pts = [i, i + 1].map((k) => {
        const a = (k / ring) * Math.PI * 2;
        const px = cx + Math.cos(a) * r;
        const pz = cz + Math.sin(a) * r;
        return new THREE.Vector3(px, this.land.height(px, pz) + 0.1, pz);
      });
      const rim = pts.map((p) => groundAt(p.x, p.z, new THREE.Color()));
      this.land.normal(cx, cz, n);
      // Wound to face up.
      this.shadows.corner(centre, n, middle);
      this.shadows.corner(pts[1]!, n, rim[1]!);
      this.shadows.corner(pts[0]!, n, rim[0]!);
    }
  }

  /** The ground's own colour at (`x`, `z`), set by `paintGround`'s owner. */
  paintGround: (x: number, z: number, out: THREE.Color) => THREE.Color = (_x, _z, out) => out;
}

/**
 * A broad-leaved tree `size` tall at (`x`, `z`): a short trunk under a full, chunky crown of a
 * big lumpy blob with smaller ones bulging out round its foot and one on top.
 */
function tree(b: Builder, x: number, z: number, size: number, leaves: THREE.Color[]): void {
  const rnd = b.rnd;
  const y = b.land.height(x, z) - 0.2;
  const R = size * (0.3 + rnd() * 0.05);
  const trunk = size * 0.3;
  const paint = foliage(leaves[0]!, leaves[1]!, leaves[2]!);
  put(b.things, TRUNK, {
    matrix: b.at(x, y, z, new THREE.Vector3(size * 0.045, trunk + R * 0.6, size * 0.045)),
    paint: plain(0x6e4b30),
  });
  const seed = Math.floor(rnd() * 1000);
  const lumpy = (p: THREE.Vector3) => {
    p.multiplyScalar(0.86 + 0.28 * noise(p.x * 1.7 + seed, p.z * 1.7 + p.y * 1.3, 3));
  };
  const middle = y + trunk + R * 0.8;
  const crown = (dx: number, dy: number, dz: number, r: number, shape: THREE.BufferGeometry) =>
    put(b.things, shape, {
      matrix: b.at(x + dx, middle + dy, z + dz, new THREE.Vector3(r, r * 0.86, r), rnd() * 6),
      paint,
      round: true,
      shape: lumpy,
    });
  crown(0, 0, 0, R, BLOB);
  // Further out, where the fog has it, it is plainer.
  const near = b.land.past(x, z) < 45;
  const sides = near ? 2 + Math.floor(rnd() * 2) : 1;
  const turn = rnd() * Math.PI * 2;
  for (let i = 0; i < sides; i++) {
    const a = turn + (i / sides) * Math.PI * 2 + rnd() * 0.8;
    crown(
      Math.cos(a) * R * 0.62,
      -R * 0.3,
      Math.sin(a) * R * 0.62,
      R * (0.55 + rnd() * 0.15),
      LUMP,
    );
  }
  if (!near) return;
  crown((rnd() - 0.5) * R * 0.4, R * 0.62, (rnd() - 0.5) * R * 0.4, R * 0.55, LUMP);
  b.shade(x, z, R * 1.3);
}

/** A pine `size` tall at (`x`, `z`): a trunk and three ragged tiers of boughs, pale at the tips. */
function pine(b: Builder, x: number, z: number, size: number, tint: number): void {
  const rnd = b.rnd;
  const y = b.land.height(x, z) - 0.2;
  const R = size * (0.2 + rnd() * 0.05);
  put(b.things, TRUNK, {
    matrix: b.at(x, y, z, new THREE.Vector3(size * 0.035, size * 0.4, size * 0.035)),
    paint: plain(0x5a3e2b),
  });
  const dark = colour(0x1d4430).multiplyScalar(tint);
  const mid = colour(0x2c6340).multiplyScalar(tint);
  const tip = colour(0x6a9d4c).multiplyScalar(tint);
  // The rim ragged with branch tips, the hollows between them tucked in and up, as the
  // level's own pines' boughs are (see \`props.ts\`).
  const ragged = (p: THREE.Vector3) => {
    if (p.y > 0.01) return;
    const k = Math.round(((Math.atan2(p.x, p.z) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 7));
    if (k % 2 === 1) {
      p.x *= 0.72;
      p.z *= 0.72;
      p.y += 0.14;
    }
  };
  const tiers = 3;
  for (let i = 0; i < tiers; i++) {
    const f = i / tiers;
    const r = R * (1 - f * 0.55);
    const h = size * (0.42 - f * 0.08);
    const base = y + size * (0.22 + f * 0.24);
    put(b.things, BOUGHS, {
      matrix: b.at(x, base, z, new THREE.Vector3(r, h, r), rnd() * Math.PI),
      shape: ragged,
      paint: (p, n, out) => {
        // Dark in under the boughs, the needles' green, paling to the tips catching the light.
        const up = (p.y - base) / h;
        const lit = 0.5 + 0.5 * (n.x * SUN.x + n.z * SUN.z);
        out
          .copy(dark)
          .lerp(mid, smooth(0.05, 0.4, up))
          .lerp(tip, smooth(0.45, 0.95, lit) * (1 - smooth(0.3, 0.9, up)) * 0.8);
      },
    });
  }
  if (b.land.past(x, z) < 45) b.shade(x, z, R * 1.1);
}

/** A boulder `size` across at (`x`, `z`), its faces cut flat, half sunk in the ground. */
function boulder(b: Builder, x: number, z: number, size: number, tall = 0.7): void {
  const rnd = b.rnd;
  const seed = Math.floor(rnd() * 1000);
  const y = b.land.low(x, z, size * 0.4) - size * 0.12;
  put(b.things, rnd() < 0.5 ? STONE : LUMP, {
    matrix: b.at(
      x,
      y,
      z,
      new THREE.Vector3(size * 0.5, size * 0.5 * tall, size * (0.38 + rnd() * 0.15)),
      rnd() * Math.PI,
    ),
    paint: rock(0.9 + rnd() * 0.15),
    flat: true,
    shape: (p) => {
      // Chunky: pulled in and out a lot, and its top cut flatter.
      p.multiplyScalar(0.8 + 0.4 * noise(p.x * 1.3 + seed, p.z * 1.3 - p.y, 11));
      if (p.y > 0.4) p.y = 0.4 + (p.y - 0.4) * 0.5;
    },
  });
  b.shade(x, z, size * 0.75, 0.75);
}

/** A mountain `size` across at its foot at (`x`, `z`), `h` high: rock over wooded slopes. */
function mountain(b: Builder, x: number, z: number, size: number, h: number, snow: boolean): void {
  const rnd = b.rnd;
  const seed = Math.floor(rnd() * 1000);
  const y = b.land.low(x, z, size / 2) - 4;
  const wood = colour(0x2f5a3c);
  const stone = colour(0x8d95a2);
  const pale = colour(0xc3c7cd);
  const white = colour(0xf3f6fa);
  put(b.things, PEAK, {
    matrix: b.at(x, y, z, new THREE.Vector3(size / 2, h, size / 2), rnd() * Math.PI),
    flat: true,
    shape: (p) => {
      // Craggy, its peak off to one side.
      const k = 0.82 + 0.36 * noise(p.x * 2.2 + seed, p.z * 2.2 + p.y * 3, 17);
      p.x = p.x * k + p.y * 0.12;
      p.z *= k;
      p.y *= 0.85 + 0.3 * noise(p.x * 3 + seed, p.z * 3, 19);
    },
    paint: (p, n, out) => {
      const up = (p.y - y) / h;
      out
        .copy(wood)
        .lerp(stone, smooth(0.25, 0.45, up + (n.y - 0.5) * 0.2))
        .lerp(pale, smooth(0.3, 0.8, n.y) * 0.5);
      if (snow) out.lerp(white, smooth(0.66, 0.74, up + n.y * 0.08));
    },
  });
}

/** A house `w` by `d` at (`x`, `z`) turned `yaw`: walls with windows, a gable roof, a chimney. */
function house(
  b: Builder,
  x: number,
  z: number,
  w: number,
  d: number,
  h: number,
  yaw: number,
  wall: number,
  roof: number,
): void {
  const y = b.land.low(x, z, Math.max(w, d) / 2) - 0.4;
  put(b.things, BOX, {
    matrix: b.at(x, y, z, new THREE.Vector3(w, h + 0.4, d), yaw),
    paint: plain(wall, 0.2),
  });
  // The windows: dark panes a little proud of the walls.
  const glass = plain(0x3b4a5a, 0);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const local = (u: number, v: number) => [x + u * cos + v * sin, z - u * sin + v * cos] as const;
  for (const side of [-1, 1]) {
    for (const u of [-w / 4, w / 4]) {
      const [px, pz] = local(u, side * (d / 2 + 0.03));
      put(b.things, BOX, {
        matrix: b.at(px, y + 0.4 + h * 0.45, pz, new THREE.Vector3(w * 0.16, h * 0.28, 0.06), yaw),
        paint: glass,
      });
    }
  }
  const pitch = Math.min(w, d) * 0.45;
  // The ridge along its longer side.
  const long = w > d;
  put(b.things, GABLE, {
    matrix: b.at(
      x,
      y + h + 0.4,
      z,
      long
        ? new THREE.Vector3(d + 0.6, pitch, w + 0.6)
        : new THREE.Vector3(w + 0.6, pitch, d + 0.6),
      yaw + (long ? Math.PI / 2 : 0),
    ),
    flat: true,
    paint: plain(roof, 0.25),
  });
  const [cx, cz] = local(w * 0.25, d * 0.15);
  put(b.things, BOX, {
    matrix: b.at(cx, y + h, cz, new THREE.Vector3(0.6, pitch + 0.9, 0.6), yaw),
    paint: plain(0x8a4a38),
  });
  b.shade(x, z, Math.max(w, d) * 0.75, 0.75);
}

/** A shed `w` by `d` at (`x`, `z`), `h` high, turned `yaw`: a big door and a shallow roof. */
function shed(
  b: Builder,
  x: number,
  z: number,
  w: number,
  d: number,
  h: number,
  yaw: number,
  wall: number,
  roof: number,
): void {
  const y = b.land.low(x, z, Math.max(w, d) / 2) - 0.3;
  put(b.things, BOX, {
    matrix: b.at(x, y, z, new THREE.Vector3(w, h + 0.3, d), yaw),
    paint: plain(wall, 0.2),
  });
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  // The loading doors along its long side, and a band of windows high up.
  for (const side of [-1, 1]) {
    const v = side * (d / 2 + 0.05);
    for (const u of [-w / 4, w / 4]) {
      put(b.things, BOX, {
        matrix: b.at(
          x + u * cos + v * sin,
          y,
          z - u * sin + v * cos,
          new THREE.Vector3(w * 0.18, h * 0.6, 0.1),
          yaw,
        ),
        paint: plain(0x4b5258, 0.1),
      });
    }
    put(b.things, BOX, {
      matrix: b.at(
        x + v * sin,
        y + h * 0.78,
        z + v * cos,
        new THREE.Vector3(w * 0.8, h * 0.12, 0.1),
        yaw,
      ),
      paint: plain(0xb9d3df, 0),
    });
  }
  put(b.things, GABLE, {
    matrix: b.at(
      x,
      y + h + 0.3,
      z,
      new THREE.Vector3(d + 0.5, Math.min(w, d) * 0.12, w + 0.5),
      yaw + Math.PI / 2,
    ),
    flat: true,
    paint: plain(roof, 0.25),
  });
  b.shade(x, z, Math.max(w, d) * 0.65, 0.75);
}

/** The rings and spokes an islet's ground is made of, as fractions of its radius. */
const ISLET_RINGS = [0, 0.15, 0.3, 0.45, 0.6, 0.72, 0.82, 0.9, 0.98, 1.08, 1.2];
const ISLET_SPOKES = 28;

/** An islet's ground: a disc of rings round its middle, shaped and painted as the land is. */
function isletGround(
  b: Builder,
  islet: Islet,
  paint: (x: number, z: number, out: THREE.Color) => void,
): void {
  const land = b.land;
  const grid = ISLET_RINGS.map((f) =>
    Array.from({ length: ISLET_SPOKES }, (_, j) => {
      const a = (j / ISLET_SPOKES) * Math.PI * 2;
      const x = islet.x + Math.cos(a) * islet.r * f;
      const z = islet.z + Math.sin(a) * islet.r * f;
      const c = new THREE.Color();
      paint(x, z, c);
      const p = new THREE.Vector3(x, land.height(x, z), z);
      return { p, n: land.normal(x, z, new THREE.Vector3()), c };
    }),
  );
  for (let k = 0; k + 1 < ISLET_RINGS.length; k++) {
    for (let j = 0; j < ISLET_SPOKES; j++) {
      const a = grid[k]![j]!;
      const bb = grid[k]![(j + 1) % ISLET_SPOKES]!;
      const c = grid[k + 1]![j]!;
      const d = grid[k + 1]![(j + 1) % ISLET_SPOKES]!;
      // Wound to face up (the spokes turn anticlockwise seen from above, from x to z).
      for (const v of [a, bb, d, a, d, c]) b.ground.corner(v.p, v.n, v.c);
    }
  }
}

/** A palm frond: a long flat blade, its base at 0 and its tip a metre up. */
const FROND = new THREE.ConeGeometry(1, 1, 4, 1, true).translate(0, 0.5, 0).rotateY(Math.PI / 4);

/** A palm `size` tall at (`x`, `z`): a slender trunk bowing over, under drooping fronds. */
function palm(b: Builder, x: number, z: number, size: number): void {
  const rnd = b.rnd;
  const lean = rnd() * Math.PI * 2;
  const bow = 0.25 + rnd() * 0.3;
  // Turning about the level axis across the way it leans bows it that way.
  const axis = new THREE.Vector3(Math.cos(lean), 0, -Math.sin(lean));
  const at = new THREE.Vector3(x, b.land.height(x, z) - 0.2, z);
  const q = new THREE.Quaternion();
  const segments = 4;
  const len = size / segments;
  for (let i = 0; i < segments; i++) {
    q.setFromAxisAngle(axis, bow * Math.pow((i + 0.5) / segments, 1.5));
    const r = size * 0.032 * (1 - i * 0.12);
    put(b.things, TRUNK, {
      matrix: new THREE.Matrix4().compose(at, q, new THREE.Vector3(r, len * 1.06, r)),
      paint: plain(0x8a6a45),
    });
    at.add(new THREE.Vector3(0, len, 0).applyQuaternion(q));
  }
  const paint = foliage(colour(0x3c7428), colour(0x7db63a), colour(0xc6dc5a));
  const fronds = 7;
  for (let i = 0; i < fronds; i++) {
    const yaw = (i / fronds) * Math.PI * 2 + rnd() * 0.5;
    // Out and drooping, from upright.
    const droop = 1.25 + rnd() * 0.6;
    q.setFromEuler(new THREE.Euler(droop, yaw, 0, 'YXZ'));
    put(b.things, FROND, {
      matrix: new THREE.Matrix4().compose(
        at,
        q,
        new THREE.Vector3(size * 0.1, size * 0.4, size * 0.02),
      ),
      paint,
      flat: true,
    });
  }
  b.shade(x, z, size * 0.3);
}

/** A stack of rock `w` across standing `h` out of the sea at (`x`, `z`), its foot deep under it. */
function stack(b: Builder, x: number, z: number, w: number, h: number): void {
  const rnd = b.rnd;
  const seed = Math.floor(rnd() * 1000);
  const foot = b.land.sea - 2;
  put(b.things, rnd() < 0.5 ? STONE : LUMP, {
    matrix: b.at(
      x,
      foot,
      z,
      new THREE.Vector3(w * 0.5, h + 2, w * (0.36 + rnd() * 0.14)),
      rnd() * Math.PI,
    ),
    paint: rock(0.92 + rnd() * 0.12),
    flat: true,
    shape: (p) => {
      // Chunky, as the level's own boulders are, and its top cut flatter.
      p.multiplyScalar(0.8 + 0.4 * noise(p.x * 1.3 + seed, p.z * 1.3 - p.y, 11));
      if (p.y > 0.6) p.y = 0.6 + (p.y - 0.6) * 0.5;
    },
  });
}

/**
 * Where to stand something `past` metres out past the fence, all the way round, in step with
 * the level's shape: `t` goes once round, from the middle of its north side.
 */
function round(land: Land, t: number, past: number): [number, number] {
  const a = t * Math.PI * 2;
  const dx = Math.sin(a);
  const dz = Math.cos(a);
  const r = land.rect;
  const hx = (r.x1 - r.x0) / 2;
  const hz = (r.z1 - r.z0) / 2;
  // Out to the fence along that way, then on past it.
  const toEdge = Math.min(hx / Math.max(Math.abs(dx), 1e-6), hz / Math.max(Math.abs(dz), 1e-6));
  const d = toEdge + FENCE_OUT + past;
  return [land.centre.x + dx * d, land.centre.y + dz * d];
}

/** Clumps of trees round the level, thick near the fence (where they show over it) and out. */
function woods(
  b: Builder,
  clumps: number,
  near: number,
  far: number,
  plant: (x: number, z: number, size: number) => void,
  perClump = 5,
  sizes: [number, number] = [7, 12],
  /** How far a tree's crown spreads round it, for its height (kept out past the fence). */
  crown = 0.55,
): void {
  const rnd = b.rnd;
  for (let i = 0; i < clumps; i++) {
    const past = near + (far - near) * Math.pow(rnd(), 1.6);
    const [cx, cz] = round(b.land, rnd(), past);
    const n = 1 + Math.floor(rnd() * perClump);
    const spread = 3 + n * 1.5;
    for (let k = 0; k < n; k++) {
      const x = cx + (rnd() - 0.5) * 2 * spread;
      const z = cz + (rnd() - 0.5) * 2 * spread;
      const size = sizes[0] + rnd() * (sizes[1] - sizes[0]);
      if (b.claim(x, z, size * 0.3, size * crown)) plant(x, z, size);
    }
  }
}

/** Boulders strewn about, and a few great rocks further out, like cliffs breaking the hills. */
function rocks(b: Builder, small: number, big: number): void {
  const rnd = b.rnd;
  for (let i = 0; i < small; i++) {
    const [x, z] = round(b.land, rnd(), 4 + rnd() * 60);
    const size = 1.5 + rnd() * 3;
    if (b.claim(x, z, size * 0.5, size * 0.65)) boulder(b, x, z, size);
  }
  for (let i = 0; i < big; i++) {
    const [x, z] = round(b.land, rnd(), 35 + rnd() * 70);
    const size = 9 + rnd() * 14;
    if (b.claim(x, z, size * 0.5, size * 0.65)) boulder(b, x, z, size, 1 + rnd() * 0.6);
  }
}

/** The palettes of broad-leaved trees: dark, mid and light greens, from bluish to golden. */
const LEAVES = [
  [0x1f4d36, 0x4a8c36, 0x9ccb48],
  [0x26502a, 0x5f9832, 0xb2cb4e],
  [0x1d4b42, 0x408654, 0x8cc460],
  [0x2f4f26, 0x6f9032, 0xbdb952],
].map((p) => p.map(colour));

/** How each scenery's ground is painted: its grass, from hollows to sunny tops. */
const GRASS: Record<Scenery, [number, number, number]> = {
  suburb: [0x3d7a3c, 0x67a843, 0xb2d35a],
  industry: [0x4e7440, 0x7f9f4a, 0xc2c46a],
  farmland: [0x447a3a, 0x74ad45, 0xbfd162],
  forest: [0x2f5f3a, 0x568a45, 0x98b95c],
  sea: [0x4a8a32, 0x7db43a, 0xbdd458],
};

/**
 * Builds the country round `level` (see the top of this file): a group holding the land with
 * all that stands on it, and the water if a lake runs on out past the fence.
 */
export function buildSurroundings(level: LevelDef): THREE.Group {
  const scenery = sceneryOf(level);
  const land = new Land(level, scenery);
  const b = new Builder(land, random(0x5eed + scenery.length * 977));
  const rnd = b.rnd;
  const [hollow, grass, sunny] = GRASS[scenery].map(colour) as [
    THREE.Color,
    THREE.Color,
    THREE.Color,
  ];
  const sand = colour(0xe0cc95);
  const shallow = colour(0x235f96);
  const deep = colour(0x123661);
  const asphalt = colour(0x5c5a57);
  const concrete = colour(0x8e8a83);
  const ballast = colour(0x7d776d);
  const fields = [0xe3c158, 0x87bd45, 0x8c6440, 0xcdb35a, 0x6fa840, 0xa98a52].map(colour);
  const hedge = colour(0x3a6b33);

  /** The ground's colour at (`x`, `z`). */
  const groundAt = (x: number, z: number, out: THREE.Color): void => {
    const h = land.height(x, z);
    const d = land.past(x, z);
    const patch = fbm(x / 16, z / 16, 3);
    // Painted in broad strokes: a sunny yellow green on the tops and in big sunny patches, a
    // cool blue green in the hollows, with smaller patches of each over them.
    const t =
      (noise(x / 45, z / 45, 8) - 0.5) * 1.5 + (patch - 0.5) * 1.1 + smooth(1, 20, h) * 0.35 + 0.4;
    out
      .copy(hollow)
      .lerp(grass, smooth(0.1, 0.45, t))
      .lerp(sunny, smooth(0.5, 0.85, t));
    if (scenery === 'sea') {
      // Sand round the islets' shores, up out of the water and down under it, and their grass
      // above.
      out.lerp(sand, 1 - smooth(0.5, 0.9, h - land.sea + (patch - 0.5) * 0.5));
      return;
    }
    if (land.lakes.length) {
      const e = land.lake(x, z);
      if (e < 1) {
        out.copy(shallow).lerp(deep, smooth(1, 0.6, e));
        return;
      }
      // (Only near, where the ground's corners are close enough together to draw a beach.)
      if (e < 1.2 && d < 40) out.lerp(sand, 1 - smooth(1.12, 1.2, e));
    }
    for (const c of land.cuttings) {
      const along = x * c.out.x + z * c.out.y;
      const across = c.out.x !== 0 ? z : x;
      if (along > c.from - 0.5 && across > c.w0 - 0.5 && across < c.w1 + 0.5) {
        out.copy(ballast);
        return;
      }
    }
    if (scenery === 'industry' && d < 30) {
      // The yard: asphalt, patched with concrete slabs, and a grass verge at its edge.
      const slab = hash(Math.floor(x / 9), Math.floor(z / 9), 4) < 0.35;
      const yard = out.clone();
      out.copy(slab ? concrete : asphalt).multiplyScalar(0.94 + 0.12 * patch);
      out.lerp(yard, smooth(24, 30, d));
      return;
    }
    if (scenery === 'farmland' && d > 8) {
      // A patchwork of fields, each its own crop, hedged round.
      const u = (x * 0.94 + z * 0.34) / 30;
      const v = (z * 0.94 - x * 0.34) / 22;
      const kind = hash(Math.floor(u), Math.floor(v), 6);
      const edge = Math.min(Math.abs(u - Math.round(u)) * 30, Math.abs(v - Math.round(v)) * 22);
      const crop = fields[Math.floor(kind * fields.length)]!;
      const field = out
        .clone()
        .lerp(crop, 0.85)
        .multiplyScalar(0.92 + 0.16 * patch);
      out.lerp(field, smooth(8, 14, d) * smooth(1, 2.5, edge));
      out.lerp(hedge, (1 - smooth(0.5, 1.5, edge)) * smooth(8, 14, d) * 0.6);
    }
  };
  b.paintGround = (x, z, out) => {
    groundAt(x, z, out);
    return out;
  };

  // The ground: rings round the level, out from the fence's outer face.
  const r = land.rect;
  const nx = Math.max(8, Math.round((r.x1 - r.x0) / ALONG));
  const nz = Math.max(8, Math.round((r.z1 - r.z0) / ALONG));
  const around = 2 * (nx + nz);
  const ringAt = (k: number, j: number): [number, number] => {
    const o = FENCE_OUT + RINGS[k]!;
    const [x0, x1, z0, z1] = [r.x0 - o, r.x1 + o, r.z0 - o, r.z1 + o];
    const i = j % around;
    if (i < nx) return [mix(x0, x1, i / nx), z0];
    if (i < nx + nz) return [x1, mix(z0, z1, (i - nx) / nz)];
    if (i < 2 * nx + nz) return [mix(x1, x0, (i - nx - nz) / nx), z1];
    return [x0, mix(z1, z0, (i - 2 * nx - nz) / nz)];
  };
  const grid = RINGS.map((_, k) =>
    Array.from({ length: around }, (_, j) => {
      const [x, z] = ringAt(k, j);
      const c = new THREE.Color();
      groundAt(x, z, c);
      const p = new THREE.Vector3(x, land.height(x, z), z);
      const n = land.normal(x, z, new THREE.Vector3());
      // Under the lake's water (the cutting's floor is lower still, but dry).
      return { p, n, c, wet: land.lakes.length > 0 && land.lake(x, z) < 1.02 };
    }),
  );
  const wet = (k: number, j: number) => grid[k]![j % around]!.wet;
  const flat = new THREE.Vector3(0, 1, 0);
  const lake = new THREE.Color(0x3f8fc9);
  // (Round an island all of it is sea bed, out of sight under the sea.)
  for (let k = 0; k + 1 < (scenery === 'sea' ? 0 : RINGS.length); k++) {
    for (let j = 0; j < around; j++) {
      const a = grid[k]![j]!;
      const bb = grid[k]![(j + 1) % around]!;
      const c = grid[k + 1]![j]!;
      const d = grid[k + 1]![(j + 1) % around]!;
      // Wound to face up.
      for (const v of [a, d, c, a, bb, d]) b.ground.corner(v.p, v.n, v.c);
      if (wet(k, j) || wet(k, j + 1) || wet(k + 1, j) || wet(k + 1, j + 1)) {
        for (const v of [a, d, c, a, bb, d]) {
          b.water.corner(new THREE.Vector3(v.p.x, WATER_Y, v.p.z), flat, lake);
        }
      }
    }
  }

  // The tracks on out of the level along their cutting.
  for (const c of land.cuttings) {
    for (const bed of c.beds) {
      const along = c.out.x !== 0;
      const length = 160;
      const mid = c.from + length / 2;
      const x = along ? mid * c.out.x : bed.pos.x;
      const z = along ? bed.pos.z : mid * c.out.y;
      const size = along
        ? new THREE.Vector3(length, bed.size.y, bed.size.z)
        : new THREE.Vector3(bed.size.x, bed.size.y, length);
      put(b.things, BOX, {
        matrix: b.at(x, bed.pos.y - bed.size.y / 2, z, size),
        paint: plain(bed.colour, 0.2),
      });
    }
  }

  // What stands on it, by what the country is like.
  switch (scenery) {
    case 'suburb': {
      const plant = (x: number, z: number, size: number) =>
        tree(b, x, z, size, LEAVES[Math.floor(rnd() * LEAVES.length)]!);
      woods(b, 24, 3, 14, plant, 4);
      woods(b, 30, 14, 110, plant, 6, [8, 14]);
      const walls = [0xf1e4c6, 0xe6cfa8, 0xf4efe4, 0xd8c4a4, 0xc9d6dc];
      const roofs = [0xb5482c, 0x8e3a26, 0x56677f, 0xa8602e, 0x6b4a3a];
      for (let i = 0; i < 16; i++) {
        const [x, z] = round(land, (i + rnd() * 0.6) / 16, 26 + rnd() * 50);
        const w = 7 + rnd() * 4;
        const dd = 6 + rnd() * 3;
        // Facing the level, as the houses round a garden do.
        const yaw = Math.atan2(x - land.centre.x, z - land.centre.y);
        if (!land.outside(x, z, w + 1, dd + 1, yaw) || !b.claim(x, z, Math.max(w, dd) * 0.7, 0))
          continue;
        house(b, x, z, w, dd, 3 + rnd() * 2.5, yaw, walls[i % 5]!, roofs[(i * 3) % 5]!);
      }
      rocks(b, 14, 5);
      break;
    }
    case 'industry': {
      const walls = [0x9fb0bb, 0xc2b394, 0x8c4b3b, 0x6f8ea3, 0xb9bcbf];
      const roofs = [0x5a6066, 0x44505c, 0x7b8186];
      for (let i = 0; i < 12; i++) {
        const w = 16 + rnd() * 16;
        const dd = 10 + rnd() * 6;
        const [x, z] = round(land, (i + 0.2 + rnd() * 0.6) / 12, dd / 2 + 7 + rnd() * 18);
        // Turned square to the fence they face.
        const yaw =
          Math.round(Math.atan2(x - land.centre.x, z - land.centre.y) / (Math.PI / 2)) *
          (Math.PI / 2);
        if (!land.outside(x, z, w + 1, dd + 1, yaw) || !b.claim(x, z, Math.max(w, dd) * 0.55, 0))
          continue;
        shed(b, x, z, w, dd, 5 + rnd() * 3.5, yaw, walls[i % 5]!, roofs[i % 3]!);
      }
      for (let i = 0; i < 3; i++) {
        const [x, z] = round(land, rnd(), 25 + rnd() * 30);
        if (!b.claim(x, z, 2)) continue;
        const y = land.height(x, z) - 0.5;
        const tall = 18 + rnd() * 8;
        put(b.things, TRUNK, {
          matrix: b.at(x, y, z, new THREE.Vector3(1.1, tall, 1.1)),
          paint: (p, n, out) =>
            out
              .set(p.y - y > tall * 0.82 && p.y - y < tall * 0.9 ? 0xe9e4da : 0x8f3e2e)
              .multiplyScalar(0.9 + 0.1 * n.y),
        });
      }
      for (let i = 0; i < 4; i++) {
        const [x, z] = round(land, rnd(), 22 + rnd() * 20);
        if (!b.claim(x, z, 4)) continue;
        put(b.things, TANK, {
          matrix: b.at(x, land.height(x, z) - 0.3, z, new THREE.Vector3(3.5, 7 + rnd() * 3, 3.5)),
          paint: plain(0xd8dcdf, 0.25),
        });
      }
      const plant = (x: number, z: number, size: number) =>
        tree(b, x, z, size, LEAVES[Math.floor(rnd() * LEAVES.length)]!);
      woods(b, 30, 28, 110, plant, 5, [8, 13]);
      rocks(b, 6, 5);
      break;
    }
    case 'farmland': {
      const plant = (x: number, z: number, size: number) =>
        tree(b, x, z, size, LEAVES[Math.floor(rnd() * LEAVES.length)]!);
      woods(b, 14, 3, 12, plant, 3);
      woods(b, 26, 14, 110, plant, 4, [8, 13]);
      // A village on a rise, its church in the middle.
      const [vx, vz] = round(land, 0.35 + rnd() * 0.1, 70);
      const walls = [0xf1e4c6, 0xe8d7b8, 0xd9c09b, 0xf4efe4];
      const roofs = [0xa8442a, 0x8e3a26, 0x5a6475];
      for (let i = 0; i < 12; i++) {
        const a = rnd() * Math.PI * 2;
        const dist = 8 + rnd() * 22;
        const x = vx + Math.cos(a) * dist;
        const z = vz + Math.sin(a) * dist;
        if (!land.outside(x, z, 10, 10, 0) || !b.claim(x, z, 5)) continue;
        house(
          b,
          x,
          z,
          6 + rnd() * 3,
          5 + rnd() * 2,
          3 + rnd() * 2,
          a,
          walls[i % 4]!,
          roofs[i % 3]!,
        );
      }
      if (b.claim(vx, vz, 5)) {
        house(b, vx, vz, 6, 13, 7, 0.3, 0xcfc8b8, 0x55606e);
        const y = land.height(vx, vz);
        put(b.things, BOX, {
          matrix: b.at(
            vx + Math.sin(0.3) * 7,
            y - 0.5,
            vz + Math.cos(0.3) * 7,
            new THREE.Vector3(3.6, 13, 3.6),
            0.3,
          ),
          paint: plain(0xcfc8b8, 0.2),
        });
        put(b.things, CONE, {
          matrix: b.at(
            vx + Math.sin(0.3) * 7,
            y + 12.5,
            vz + Math.cos(0.3) * 7,
            new THREE.Vector3(2.6, 9, 2.6),
            0.3,
          ),
          flat: true,
          paint: plain(0x55606e, 0.25),
        });
      }
      // Hedgerows along some fields' edges.
      const blob = (x: number, z: number, len: number, yaw: number) => {
        put(b.things, BLOB, {
          matrix: b.at(x, land.height(x, z) + 0.2, z, new THREE.Vector3(len / 2, 1.5, 1.1), yaw),
          round: true,
          paint: foliage(colour(0x24502c), colour(0x3f7a35), colour(0x8fbf4a)),
        });
      };
      for (let i = 0; i < 26; i++) {
        const u = Math.floor((rnd() - 0.5) * 9) + 0.5;
        const v = Math.floor((rnd() - 0.5) * 12);
        // Along a field's edge, in the fields' own slant (see `groundAt`).
        const fu = u * 30;
        const fv = v * 22;
        const x = fu * 0.94 - fv * 0.34;
        const z = fu * 0.34 + fv * 0.94;
        if (land.past(x, z) < 16 || !land.free(x, z, 12)) continue;
        blob(x, z, 24, Math.atan2(-0.34, 0.94));
      }
      rocks(b, 6, 2);
      break;
    }
    case 'sea': {
      // A few islets, near enough to make out and further off in the haze, with palms on them
      // and rocks round their shores; stacks of rock standing out of the sea nearer in.
      const placed: Islet[] = [];
      for (let i = 0; i < 6; i++) {
        const [x, z] = round(land, (i + 0.15 + rnd() * 0.7) / 6, 40 + rnd() * 70);
        const r = 7 + rnd() * 9;
        if (!b.claim(x, z, r * 1.2, r * 1.3)) continue;
        placed.push({ x, z, r, h: 1.6 + rnd() * 3.2 });
      }
      // One great island far off, its hills standing over the horizon.
      const [fx, fz] = round(land, 0.3 + rnd() * 0.4, 135);
      placed.push({ x: fx, z: fz, r: 38, h: 15 });
      land.islets.push(...placed);
      for (const islet of placed) {
        isletGround(b, islet, groundAt);
        const palms = Math.round((islet.r / 4) * (0.6 + rnd() * 0.6));
        for (let k = 0; k < palms; k++) {
          const a = rnd() * Math.PI * 2;
          const d = islet.r * (0.15 + rnd() * 0.45);
          const x = islet.x + Math.cos(a) * d;
          const z = islet.z + Math.sin(a) * d;
          if (land.height(x, z) > land.sea + 0.5) palm(b, x, z, 5 + rnd() * 3);
        }
        for (let k = 0; k < 3; k++) {
          const a = rnd() * Math.PI * 2;
          const d = islet.r * (0.75 + rnd() * 0.2);
          stack(
            b,
            islet.x + Math.cos(a) * d,
            islet.z + Math.sin(a) * d,
            1.5 + rnd() * 2,
            0.5 + rnd(),
          );
        }
      }
      for (let i = 0; i < 10; i++) {
        const [x, z] = round(land, rnd(), 14 + rnd() * 50);
        const w = 2 + rnd() * 3;
        if (b.claim(x, z, w, w + 2)) stack(b, x, z, w, w * (0.8 + rnd() * 1.4));
      }
      break;
    }
    case 'forest': {
      const plant = (x: number, z: number, size: number) => pine(b, x, z, size, 0.85 + rnd() * 0.3);
      woods(b, 40, 2.5, 16, plant, 6, [8, 14], 0.27);
      woods(b, 60, 16, 110, plant, 8, [10, 17], 0.27);
      rocks(b, 22, 6);
      // Mountains all round, beyond the woods and the lake.
      for (let i = 0; i < 11; i++) {
        const [x, z] = round(land, (i + rnd() * 0.5) / 11, 105 + rnd() * 45);
        const size = 70 + rnd() * 50;
        mountain(b, x, z, size, 38 + rnd() * 34, rnd() < 0.6);
      }
      break;
    }
  }

  const group = new THREE.Group();
  group.name = 'surroundings';
  // Too far off for its corners to show any shade, and that costs every pixel of it.
  group.userData[NO_AO] = true;
  const meshes = [new THREE.Mesh(Mesh.geometry(b.things, b.shadows, b.ground), landMaterial())];
  if (b.water.triangles) {
    // As the level's own water, so the two meet unseen at the fence, with the level's shore
    // carried on past it.
    const water = untracedMaterial(
      madeOf(
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          vertexColors: true,
          roughness: 0.15,
          metalness: 0.1,
          transparent: true,
          opacity: 0.8,
        }),
        Surface.Water,
      ),
      false,
    );
    water.userData[SHORES] = levelShores(level);
    meshes.push(new THREE.Mesh(Mesh.geometry(b.water), water));
  }
  for (const mesh of meshes) {
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.raycast = () => {};
    mesh.matrixAutoUpdate = false;
    // Drawn after the level, so whatever of it the level hides is never shaded: drawn first
    // (it sits round the middle, as near as anything), it cost as much again as all it showed.
    mesh.renderOrder = 1;
    group.add(mesh);
  }
  group.matrixAutoUpdate = false;
  return group;
}

/**
 * The land's material, painted plain: the painted textures (grass blades, grain, pores, see
 * `styleDetail`) would be too fine to see out past the fence. They are taken out of its shader
 * altogether, not only left unused: graphics that run every branch of a shader (as software
 * rendering does) worked out every texture for every pixel all the same, and over the country,
 * which covers so much of the screen, that cost more than all the rest of its drawing.
 */
function landMaterial(): THREE.MeshStandardMaterial {
  return untracedMaterial(
    madeOf(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }), Surface.None),
    true,
  );
}

/**
 * `material` styled as everything else is (see `graphics.ts`), but left out of ray traced
 * shadows: it takes no shadow, as with shadow maps, and every pixel of it traced a ray towards
 * the sun all the same. With `plain`, its texture is taken out too (see `untextured`).
 */
export function untracedMaterial<M extends THREE.Material>(material: M, plain: boolean): M {
  material.onBeforeCompile = function (shader, renderer) {
    THREE.Material.prototype.onBeforeCompile.call(this, shader, renderer);
    untraced(shader);
    if (plain) shader.fragmentShader = untextured(shader.fragmentShader);
  };
  material.customProgramCacheKey = function () {
    const key = THREE.Material.prototype.customProgramCacheKey.call(this);
    return `${key}|untraced${plain ? '|untextured' : ''}`;
  };
  return material;
}

/**
 * A styled fragment shader with its texture (`styleDetail`) swapped for the none it starts
 * from, as for a surface left as it is. If the style's shader is not as expected, it is left
 * as it is: textured, which is only slower.
 */
export function untextured(fragmentShader: string): string {
  const none = /StyleDetail styleDetail\([^)]*\) \{\s*StyleDetail d = (StyleDetail\([^;]*\));/.exec(
    fragmentShader,
  )?.[1];
  return none ? fragmentShader.replace(/= styleDetail\([^;]*\);/g, `= ${none};`) : fragmentShader;
}

/** Frees what `buildSurroundings` made. */
export function disposeSurroundings(group: THREE.Group): void {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
}
