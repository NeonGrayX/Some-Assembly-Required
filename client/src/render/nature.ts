import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { BASEPLATE_SIZE, floorRect, levelSites } from '@sar/shared';
import type { BoxDef, FloorRect, LevelDef } from '@sar/shared';
import { roomSides } from './details.ts';
import { Surface, madeOf } from './styles.ts';

/**
 * The outdoors, drawn chunky and painted as in a storybook game: the camp's pines, stones, logs
 * and stumps, and the tufts of grass, bushes and flowers growing about every map. Their light
 * and shade are painted into each model's vertex colours (darker underneath and in the hollows,
 * lighter at the tips, on top and along worn edges), so they read the same in every visual
 * style, and the scene merge keeps them (see `mergeStatic`).
 *
 * The models are built like `props.ts`'s, in a frame centred on their box, `w` wide (x), `h`
 * high and `d` deep (z).
 */

/** One finish for all of it, so the scene merge bakes it into the meshes it already draws. */
const ROUGHNESS = 0.9;

const materials = new Map<Surface, THREE.MeshStandardMaterial>();

/** A white material showing its mesh's vertex colours, made of `surface`, shared as `mat`'s are. */
function painted(surface: Surface): THREE.MeshStandardMaterial {
  let m = materials.get(surface);
  if (!m) {
    m = madeOf(
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: ROUGHNESS }),
      surface,
    );
    materials.set(surface, m);
  }
  return m;
}

/** Adds a mesh painted in its vertex colours to `g`. */
function put(
  g: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  surface: Surface,
  castShadow = true,
): THREE.Mesh {
  const m = new THREE.Mesh(geometry, painted(surface));
  m.castShadow = castShadow;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

/** A colour from its hex code, as a new `THREE.Color` to work on. */
const hex = (colour: number) => new THREE.Color(colour);

/**
 * The bark and the sawn wood are drawn as an unknown surface, not as wood: their ridges and
 * rings are in the models' own colours, and the styles' wood is sawn timber's straight grain
 * and boards, which would run across them. The stones likewise are not concrete, a cast,
 * man-made finish.
 */
const BARK = Surface.Auto;
const STONE = Surface.Auto;

/** The pale wood of a sawn face, worked out from the bark's colour. */
const sawnWood = (bark: number) => hex(bark).lerp(hex(0xd9c29a), 0.68);

/**
 * Bark round a piece, a share of its radius at each point round it: three points to a ridge,
 * two out on its flat top and the third down in the groove after it. Its tops catch the light
 * and wear pale (the two a shade apart, as if brushed); its grooves are deep in shade.
 */
const BARK_RIDGE = [1, 1, 0.78];
const BARK_SHADE = [1.3, 1.12, 0.4];

// ---------------------------------------------------------------- turned wood

/** One ring of a round wooden piece (see `turned`). */
interface Ring {
  /** Its height along the piece. */
  y: number;
  /** Its radius; 0 closes the piece with a point on its axis. */
  r: number;
  /** How far the bark's ridges stand out of it: 0 on a sawn face, 1 on the bark. */
  ridges: number;
  colour: THREE.Color;
}

/**
 * A round wooden piece turned about y through `rings`, bottom to top, with `ridges` ridges of
 * bark running along it (see `BARK_RIDGE`, each a little different). Sawn faces are rings at
 * one height, painted with the tree's rings. Its outside faces out wherever the rings turn, so
 * a piece closed at both ends is solid.
 */
function turned(rings: Ring[], ridges: number, seed: () => number): THREE.BufferGeometry {
  const sides = ridges * BARK_RIDGE.length;
  const reach = Array.from({ length: sides }, (_, j) => {
    const f = BARK_RIDGE[j % BARK_RIDGE.length]!;
    return f < 1 ? f + seed() * 0.06 : f - seed() * 0.03;
  });
  const positions: number[] = [];
  const colours: number[] = [];
  const starts: number[] = [];
  for (const ring of rings) {
    starts.push(positions.length / 3);
    const points = ring.r === 0 ? 1 : sides;
    for (let j = 0; j < points; j++) {
      const a = (j / sides) * Math.PI * 2;
      const out = ring.r * (1 - ring.ridges * (1 - reach[j]!));
      positions.push(out * Math.sin(a), ring.y, out * Math.cos(a));
      const lit = ring.r === 0 ? 1 : 1 + ring.ridges * (BARK_SHADE[j % BARK_SHADE.length]! - 1);
      // A brush's unevenness.
      const c = ring.colour.clone().multiplyScalar(lit * (0.94 + seed() * 0.12));
      colours.push(c.r, c.g, c.b);
    }
  }
  const index: number[] = [];
  for (let k = 0; k + 1 < rings.length; k++) {
    const lower = starts[k]!;
    const upper = starts[k + 1]!;
    for (let j = 0; j < sides; j++) {
      const j1 = (j + 1) % sides;
      if (rings[k]!.r === 0) index.push(upper + j, lower, upper + j1);
      else if (rings[k + 1]!.r === 0) index.push(lower + j, lower + j1, upper);
      else index.push(upper + j, lower + j, upper + j1, lower + j, lower + j1, upper + j1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A sawn face's rings, from the bark's edge in to the heart, `r` across at height `y` (on its
 * underside if `down`): pale wood with darker year rings painted round it, and the heart dark.
 */
function sawnFace(y: number, r: number, wood: THREE.Color, down = false): Ring[] {
  const face: [number, number][] = [
    [0.9, 1.12],
    [0.7, 0.72],
    [0.42, 1.04],
    [0, 0.6],
  ];
  const rings = face.map(([f, shade]) => ({
    y,
    r: r * f,
    ridges: 0,
    colour: wood.clone().multiplyScalar(shade),
  }));
  return down ? rings.reverse() : rings;
}

// ---------------------------------------------------------------- the camp's models

/** A log along the box's x: chunky bark round it, sawn ends, resting on the box's bottom. */
export function logModel(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
): void {
  const r = Math.min(h, d) / 2;
  const half = (w - 0.02) / 2;
  const bark = hex(colour);
  const worn = bark.clone().lerp(hex(0xb08a62), 0.35);
  const wood = sawnWood(colour);
  // Each end's bark rounded over onto the sawn face, a little in from the end.
  const bevel = Math.min(0.04, r * 0.25);
  const along = (y: number, f: number): Ring => ({ y, r: r * f, ridges: 1, colour: bark });
  const rings: Ring[] = [
    ...sawnFace(-half, r, wood, true),
    { y: -half + bevel * 0.35, r: r * 0.96, ridges: 0.6, colour: worn },
    along(-half + bevel, 1),
    along(-half * 0.3 + (seed() - 0.5) * 0.2, 0.96 + seed() * 0.04),
    along(half * 0.4 + (seed() - 0.5) * 0.2, 0.96 + seed() * 0.04),
    along(half - bevel, 1),
    { y: half - bevel * 0.35, r: r * 0.96, ridges: 0.6, colour: worn },
    ...sawnFace(half, r, wood),
  ];
  // Turned about y, then laid along x.
  const geometry = turned(rings, 6, seed).rotateZ(-Math.PI / 2);
  geometry.rotateX(seed() * Math.PI * 2);
  // On its side, resting on its lowest ridge, not hovering over the ground.
  geometry.computeBoundingBox();
  geometry.translate(0, -h / 2 - geometry.boundingBox!.min.y, 0);
  put(g, geometry, BARK);
}

/** A stump standing on its end: its bark flared to the ground, rings on the sawn top. */
export function stumpModel(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
): void {
  const r = Math.min(w, d) / 2;
  const bark = hex(colour);
  const wood = sawnWood(colour);
  const top = h / 2;
  const rings: Ring[] = [
    // Its roots spreading into the ground, darker with the earth on them.
    { y: -h / 2, r, ridges: 1, colour: bark.clone().multiplyScalar(0.7) },
    { y: -h / 2 + h * 0.18, r: r * 0.88, ridges: 1, colour: bark },
    { y: top - 0.05, r: r * 0.85, ridges: 1, colour: bark },
    // The bark's rim, worn pale, standing a little proud of the sawn wood.
    { y: top, r: r * 0.83, ridges: 0.6, colour: bark.clone().lerp(hex(0xb08a62), 0.4) },
    ...sawnFace(top - 0.008, r * 0.8, wood),
  ];
  const geometry = turned(rings, 7, seed);
  geometry.rotateY(seed() * Math.PI * 2);
  put(g, geometry, BARK);
}

/** How far a pine's lowest boughs spread round its trunk, for its height. */
export const PINE_BOUGHS = 0.22;

/**
 * A pine: the box is the trunk, and five chunky tiers of boughs sit on it from `boughs` up (its
 * box's `boughs`, or a little under half way), spreading `PINE_BOUGHS` of its height round it
 * and so well outside the box. Nothing collides with them, which is how a tree's foliage should
 * be. The trunk, in ridged bark flaring at its foot, tapers up into the lowest tier.
 */
export function pineModel(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
  boughs = h * 0.42,
): void {
  const r = Math.min(w, d) / 2;
  // (The tree's deck fixings are drawn to this taper, see `treeDeckFixings`.)
  const trunkTop = h * 0.66;
  const bark = hex(colour);
  const foot = -h / 2;
  const at = (t: number, ridges = 1, shade = 1): Ring => ({
    y: foot + t * trunkTop,
    r: r * (1 - 0.4 * t),
    ridges,
    colour: bark.clone().multiplyScalar(shade),
  });
  const trunk = turned(
    [
      { y: foot, r: r * 1.12, ridges: 1, colour: bark.clone().multiplyScalar(0.65) },
      { ...at(0.3 / trunkTop), r: r * 0.99 },
      at(0.3),
      at(0.65),
      // Up in the boughs' shade.
      at(1, 1, 0.6),
      { ...at(1, 0, 0.5), r: 0 },
    ],
    6,
    seed,
  );
  put(g, trunk, BARK);
  const green = hex(0x3f6b3a).offsetHSL(seed() * 0.05 - 0.025, 0, seed() * 0.08 - 0.04);
  const R = h * PINE_BOUGHS;
  // The tiers fill from the lowest boughs to a tenth over the trunk's top, closer together
  // over a long bare trunk, each narrower than the one under it.
  const span = h * 1.1 - boughs;
  const tiers = 5;
  const tier = span * 0.34;
  for (let i = 0; i < tiers; i++) {
    const f = i / (tiers - 1);
    const th = tier * (1 - 0.25 * f);
    // Each turned its own way and, over the lowest (which stays level, for a deck may be built
    // just under it), leaning a hair off true, as if grown, not stacked. (Turned in its own
    // points, so that its bounds stay snug round it, as a deck's builders would measure.)
    const lean = i === 0 ? 0 : 0.04;
    const geometry = bough(R * (1 - 0.74 * f), th, f, green, seed)
      .rotateY(seed() * Math.PI * 2)
      .rotateX((seed() - 0.5) * lean)
      .rotateZ((seed() - 0.5) * lean);
    put(g, geometry, Surface.Grass).position.y = foot + boughs + f * (span - tier) + th / 2;
  }
}

/**
 * One tier of a pine's boughs, `r` round and `h` tall, `f` of the way up the tree: a cone that
 * bulges a little, its rim spread into seven to nine chunky branch tips drooping to its foot
 * with the hollows between them tucked in and up (never out past the tier or down under it,
 * where a deck may be built round it), hollowed underneath so the tier above does not show
 * through as a flat lid. Painted dark deep inside and underneath, in `green` over its slopes,
 * and light and yellower out at the tips, and the higher up the tree, the lighter.
 */
function bough(
  r: number,
  h: number,
  f: number,
  green: THREE.Color,
  seed: () => number,
): THREE.BufferGeometry {
  const tips = 7 + Math.floor(seed() * 3);
  const sides = tips * 2;
  const rows = 3;
  const geo = new THREE.ConeGeometry(r, h, sides, rows);
  const reach = Array.from({ length: sides }, (_, j) =>
    j % 2 === 0 ? 0.94 + seed() * 0.06 : 0.66 + seed() * 0.1,
  );
  const deep = green.clone().multiply(hex(0x4a5a66)).multiplyScalar(0.55);
  const light = green.clone().lerp(hex(0xc9d870), 0.55).multiplyScalar(1.15);
  const sunlit = 0.82 + 0.3 * f;
  const pos = geo.attributes.position!;
  const colours = new Float32Array(pos.count * 3);
  // The cone's points, as three.js lays them out: rows from the tip down, each `sides + 1`
  // round (the first point repeated at the seam), then the underside's middle (one per side)
  // and its rim.
  const torso = (rows + 1) * (sides + 1);
  const c = new THREE.Color();
  for (let k = 0; k < pos.count; k++) {
    const under = k >= torso;
    const middle = under && k < torso + sides;
    const j = (under ? (middle ? k - torso : k - torso - sides) : k % (sides + 1)) % sides;
    const v = under ? 1 : Math.floor(k / (sides + 1)) / rows;
    const tip = j % 2 === 0;
    if (middle) {
      // The middle of the underside, pushed up into the cone.
      pos.setXYZ(k, 0, -h / 2 + h * 0.45, 0);
      c.copy(deep).multiplyScalar(0.6);
    } else {
      const a = (j / sides) * Math.PI * 2;
      const out = r * (v + 0.12 * Math.sin(Math.PI * v)) * (1 - (1 - reach[j]!) * v ** 1.5);
      // The tips droop to the tier's foot; the hollows between them lift.
      const y = -h / 2 + h * (1 - v) + (tip ? -0.07 * h * Math.sin(Math.PI * v) : 0.22 * h * v * v);
      pos.setXYZ(k, out * Math.sin(a), y, out * Math.cos(a));
      if (under) c.copy(deep).lerp(green, 0.3);
      else {
        c.copy(deep)
          .lerp(green, Math.min(1, v / 0.7))
          .lerp(light, (tip ? 0.8 : 0.2) * v * v);
        c.multiplyScalar(sunlit);
      }
    }
    c.multiplyScalar(0.93 + seed() * 0.14);
    colours.set([c.r, c.g, c.b], k * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * A boulder fitted to the box: a chunky lump of a few big flat facets, its edges bevelled as if
 * knocked off and worn, each facet its own shade of grey, lighter on top and pale along the
 * worn bevels, dark underneath and down by the ground, with moss on some of its top.
 *
 * It is the hull round a ring of points on the ground (its flat foot), a ring round its
 * shoulders and a few on top, and then the hull again round each of its faces drawn in a
 * little from its edges, which cuts a bevel along every edge.
 */
export function rockModel(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
): void {
  const points: THREE.Vector3[] = [];
  const ring = (n: number, y: number, r0: number, r1: number, rise: number) => {
    const turn = seed() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = turn + ((i + (seed() - 0.5) * 0.5) / n) * Math.PI * 2;
      const r = r0 + seed() * (r1 - r0);
      points.push(new THREE.Vector3(Math.cos(a) * r, y + seed() * rise, Math.sin(a) * r));
    }
  };
  ring(6, 0, 0.75, 0.95, 0);
  ring(5 + Math.floor(seed() * 2), 0.4, 0.85, 1, 0.2);
  ring(3, 0.85, 0.2, 0.55, 0.15);
  const hull = new ConvexHull().setFromPoints(points);
  const bevel = 0.07;
  const inset: THREE.Vector3[] = [];
  const middle = new THREE.Vector3();
  const towards = new THREE.Vector3();
  for (const face of hull.faces) {
    const corners: THREE.Vector3[] = [];
    let edge = face.edge;
    do {
      corners.push(edge.head().point);
      edge = edge.next;
    } while (edge !== face.edge);
    middle.set(0, 0, 0);
    for (const c of corners) middle.addScaledVector(c, 1 / corners.length);
    for (const c of corners) {
      towards.subVectors(middle, c);
      const by = Math.min(bevel, towards.length() * 0.4);
      inset.push(c.clone().addScaledVector(towards.normalize(), by));
    }
  }
  const geo = new ConvexGeometry(inset);
  // Stretched to just fill the box, standing on the ground.
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const size = bb.getSize(new THREE.Vector3());
  geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  geo.scale((w * 0.98) / size.x, (h * 0.98) / size.y, (d * 0.98) / size.z);
  geo.computeVertexNormals();
  const at = geo.attributes.position!;
  const normals = geo.attributes.normal!;
  // Weathered paler than the stone's own colour, which reads near black in the shade.
  const base = hex(colour).lerp(hex(0xbab5ab), 0.5);
  const moss = hex(0x6d8f3a);
  const mossy = seed() < 0.6;
  const colours = new Float32Array(at.count * 3);
  const c = new THREE.Color();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const e = new THREE.Vector3();
  // The facets are big; the bevels and the corners between them small.
  const area = w * d * 0.02;
  for (let k = 0; k < at.count; k += 3) {
    const up = normals.getY(k);
    a.fromBufferAttribute(at, k);
    b.fromBufferAttribute(at, k + 1).sub(a);
    e.fromBufferAttribute(at, k + 2).sub(a);
    const worn = b.cross(e).length() / 2 < area;
    // Each facet a shade of its own, from which way it faces.
    const tone =
      Math.abs(Math.sin(normals.getX(k) * 12.9898 + normals.getZ(k) * 78.233) * 43758.5453) % 1;
    c.copy(base).multiplyScalar(0.84 + 0.26 * tone);
    c.multiplyScalar(up > 0 ? 1 + 0.3 * up : 1 + 0.45 * up);
    if (worn) c.multiplyScalar(1.12 + 0.12 * Math.max(0, up));
    for (let n = 0; n < 3; n++) {
      const y = at.getY(k + n);
      const p = c.clone();
      // Down by the ground, earthy; on top, mossy.
      p.multiplyScalar(0.72 + 0.28 * Math.min(1, y / (h * 0.3)));
      if (mossy && up > 0.55 && y > h * 0.5) p.lerp(moss, 0.5);
      colours.set([p.r, p.g, p.b], (k + n) * 3);
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  put(g, geo, STONE).position.y = -h / 2;
}

// ---------------------------------------------------------------- greenery

/** Triangles gathered into one geometry: their points, normals and colours. */
class Batch {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colours: number[] = [];

  /** One point of a triangle. */
  point(p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color): void {
    this.positions.push(p.x, p.y, p.z);
    this.normals.push(n.x, n.y, n.z);
    this.colours.push(c.r, c.g, c.b);
  }

  /** Adds a geometry with normals and colours, moved by `matrix`. */
  add(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    g.applyMatrix4(matrix);
    this.positions.push(...g.attributes.position!.array);
    this.normals.push(...g.attributes.normal!.array);
    this.colours.push(...g.attributes.color!.array);
    g.dispose();
  }

  get empty(): boolean {
    return this.positions.length === 0;
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colours, 3));
    return g;
  }
}

/** A number from 0 to 1 that looks random, the same for the same numbers on every client. */
function hash(...xs: number[]): number {
  let h = 2166136261;
  for (const x of xs) {
    h = Math.imul(h ^ Math.round(x * 1000), 16777619);
    h ^= h >>> 13;
  }
  return (h >>> 0) / 4294967296;
}

/** Pseudo-random numbers seeded from a position (mulberry32), the same on every client. */
function rngAt(...xs: number[]): () => number {
  let s = Math.floor(hash(...xs) * 4294967296);
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The greens of grass and leaves: dark at the root and in the shade, light at the tips. */
const GRASS_ROOT = hex(0x24401f);
const GRASS_TIP = hex(0xa9c95a);
const GRASS_DRY = hex(0xd1c46a);
const LEAF_SHADE = hex(0x1f3a24);
const LEAF = hex(0x4a8a3a);
const LEAF_LIGHT = hex(0xb0d662);
const PETALS = [0xf4f1e4, 0xf6c91c, 0xe2553f, 0xb36ad6, 0xf08fb5];

const UP = new THREE.Vector3(0, 1, 0);

/**
 * A tuft of grass, `size` tall, at `x, z`: five to seven chunky blades, each a thin spike of
 * three faces leaning out from the root, dark at its foot and light at its tip. They are lit as
 * if part of the ground under them (their normals mostly up), so a tuft reads as grass grown up
 * out of it, not as a cluster of shiny spikes.
 */
function tuft(batch: Batch, x: number, z: number, size: number, rng: () => number): void {
  const blades = 6 + Math.floor(rng() * 3);
  const tip = GRASS_TIP.clone().lerp(GRASS_DRY, rng() * 0.35);
  const root = new THREE.Vector3();
  const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const top = new THREE.Vector3();
  const out = new THREE.Vector3();
  const across = new THREE.Vector3();
  const nFoot = new THREE.Vector3();
  const nTip = new THREE.Vector3();
  const cTip = new THREE.Color();
  const turn = rng() * Math.PI * 2;
  for (let k = 0; k < blades; k++) {
    const a = turn + ((k + rng() * 0.7) / blades) * Math.PI * 2;
    out.set(Math.cos(a), 0, Math.sin(a));
    across.set(-out.z, 0, out.x);
    const lean = 0.25 + rng() * 0.5;
    const length = size * (0.6 + rng() * 0.5);
    const width = size * (0.11 + rng() * 0.05);
    root.set(x, -0.01, z).addScaledVector(out, size * 0.1 * rng());
    corners[0]!.copy(root).addScaledVector(across, width);
    corners[1]!.copy(root).addScaledVector(across, -width);
    corners[2]!.copy(root).addScaledVector(out, -width * 0.7);
    top
      .copy(root)
      .addScaledVector(out, length * Math.sin(lean))
      .addScaledVector(across, (rng() - 0.5) * length * 0.25)
      .addScaledVector(UP, length * Math.cos(lean));
    nFoot.copy(out).multiplyScalar(0.3).add(UP).normalize();
    nTip.copy(out).multiplyScalar(0.8).add(UP).normalize();
    cTip.copy(tip).multiplyScalar(0.85 + rng() * 0.3);
    for (let s = 0; s < 3; s++) {
      batch.point(corners[s]!, nFoot, GRASS_ROOT);
      batch.point(corners[(s + 1) % 3]!, nFoot, GRASS_ROOT);
      batch.point(top, nTip, cTip);
    }
  }
}

/** A lumpy ball of leaves, `detail` fine (see `IcosahedronGeometry`), its own lumps from `rng`. */
function leafBall(detail: number, rng: () => number): THREE.BufferGeometry {
  const ball = new THREE.IcosahedronGeometry(1, detail);
  ball.deleteAttribute('normal');
  ball.deleteAttribute('uv');
  const geo = mergeVertices(ball);
  ball.dispose();
  const pos = geo.attributes.position!;
  const v = new THREE.Vector3();
  const waves = Array.from({ length: 3 }, () => ({
    k: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize().multiplyScalar(4),
    phase: rng() * Math.PI * 2,
  }));
  for (let k = 0; k < pos.count; k++) {
    v.fromBufferAttribute(pos, k);
    let r = 1;
    for (const w of waves) r += 0.09 * Math.sin(v.dot(w.k) + w.phase);
    v.multiplyScalar(r);
    pos.setXYZ(k, v.x, v.y, v.z);
  }
  return geo;
}

/**
 * A bush, `r` round and `h` tall, at `x, z`: a big lumpy ball of leaves with smaller ones
 * huddled round it, painted dark underneath and inside, in leaf green round their sides and
 * light on top, where the sun catches them.
 */
function bush(batch: Batch, x: number, z: number, r: number, h: number, rng: () => number): void {
  const tint = new THREE.Color().setHSL(rng() * 0.06 - 0.03, 0, 0);
  const mid = LEAF.clone().offsetHSL(tint.r, 0, rng() * 0.06 - 0.03);
  const light = LEAF_LIGHT.clone().offsetHSL(tint.r, 0, 0);
  const balls: { x: number; y: number; z: number; s: THREE.Vector3; detail: number }[] = [
    { x: 0, y: h * 0.52, z: 0, s: new THREE.Vector3(r * 0.72, h * 0.5, r * 0.72), detail: 1 },
  ];
  const more = 3 + Math.floor(rng() * 3);
  const turn = rng() * Math.PI * 2;
  for (let i = 0; i < more; i++) {
    const a = turn + ((i + rng() * 0.5) / more) * Math.PI * 2;
    const s = 0.42 + rng() * 0.18;
    balls.push({
      x: Math.cos(a) * r * 0.55,
      y: h * (0.25 + rng() * 0.15),
      z: Math.sin(a) * r * 0.55,
      s: new THREE.Vector3(r * s, h * s * 0.85, r * s),
      detail: s > 0.52 ? 1 : 0,
    });
  }
  const matrix = new THREE.Matrix4();
  const c = new THREE.Color();
  for (const b of balls) {
    const geo = leafBall(b.detail, rng);
    geo.scale(b.s.x, b.s.y, b.s.z);
    geo.computeVertexNormals();
    const pos = geo.attributes.position!;
    const normals = geo.attributes.normal!;
    const colours = new Float32Array(pos.count * 3);
    for (let k = 0; k < pos.count; k++) {
      const up = normals.getY(k);
      const y = b.y + pos.getY(k);
      c.copy(LEAF_SHADE).lerp(mid, THREE.MathUtils.smoothstep(up, -0.7, 0.2));
      c.lerp(light, THREE.MathUtils.smoothstep(up, 0.2, 1) * 0.85);
      // Shaded in, low down among the others.
      c.multiplyScalar((0.55 + 0.45 * Math.min(1, y / h + 0.25)) * (0.9 + rng() * 0.2));
      colours.set([c.r, c.g, c.b], k * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    batch.add(geo, matrix.makeTranslation(x + b.x, b.y, z + b.z));
    geo.dispose();
  }
}

/**
 * A flower at `x, z`: a green stalk up to a head of five petals in `colour` round a yellow
 * middle, turned up to the sun.
 */
function flower(batch: Batch, x: number, z: number, colour: number, rng: () => number): void {
  const tall = 0.12 + rng() * 0.12;
  const head = new THREE.Vector3(x + (rng() - 0.5) * 0.06, tall, z + (rng() - 0.5) * 0.06);
  const stalk = 0.008;
  const foot = [0, 1, 2].map((i) => {
    const a = (i / 3) * Math.PI * 2;
    return new THREE.Vector3(x + Math.cos(a) * stalk, -0.01, z + Math.sin(a) * stalk);
  });
  const n = new THREE.Vector3();
  for (let s = 0; s < 3; s++) {
    const a = foot[s]!;
    const b = foot[(s + 1) % 3]!;
    n.copy(a).add(b).multiplyScalar(0.5).sub(head).setY(0).normalize().add(UP).normalize();
    batch.point(b, n, GRASS_ROOT);
    batch.point(a, n, GRASS_ROOT);
    batch.point(head, n, LEAF);
  }
  // The head: a shallow five-pointed star, its middle raised and yellow.
  const petal = hex(colour);
  const middle = hex(0xf2c230);
  const size = 0.05 + rng() * 0.025;
  const turn = rng() * Math.PI * 2;
  const centre = head.clone().setY(tall + size * 0.45);
  const under = head.clone().setY(tall - size * 0.2);
  const rim = Array.from({ length: 5 }, (_, i) => {
    const a = turn + (i / 5) * Math.PI * 2;
    return new THREE.Vector3(head.x + Math.cos(a) * size, tall, head.z + Math.sin(a) * size);
  });
  const down = new THREE.Vector3(0, -1, 0);
  const shade = petal.clone().multiplyScalar(0.55);
  for (let i = 0; i < 5; i++) {
    const a = rim[i]!;
    const b = rim[(i + 1) % 5]!;
    batch.point(centre, UP, middle);
    batch.point(b, UP, petal);
    batch.point(a, UP, petal);
    batch.point(under, down, shade);
    batch.point(a, down, shade);
    batch.point(b, down, shade);
  }
}

/** A rectangle greenery keeps out of, and the level's box it is, if it is one. */
interface Patch extends FloorRect {
  box?: BoxDef;
}

/** The rectangle `half` round a point. */
const around = (x: number, z: number, half: number): Patch => ({
  x0: x - half,
  x1: x + half,
  z0: z - half,
  z1: z + half,
});

/** Whether a box stands on the ground. */
const grounded = (b: BoxDef) => Math.abs(b.pos.y - b.size.y / 2) < 0.05;

/**
 * Where nothing may grow: water, the buildings, the job sites, the paving in front of doors,
 * whatever stands on the ground, and round everything players come for (the hiding places,
 * the pages lying about, the machines, the ladders, the catapult), so that greenery never
 * hides or crowds any of it.
 */
function keepOuts(level: LevelDef): Patch[] {
  const out: Patch[] = [];
  for (const w of level.water ?? []) out.push(grown(w, 0.2));
  for (const i of level.interiors) if (i.y0 < 0.6) out.push(grown(i.rect, 0.02));
  // A hole in the ground, kept a step clear of, unless it is a cellar under a building's floor
  // (which already keeps out to the building's walls, where tufts grow outside).
  const inside = (h: FloorRect) =>
    level.interiors.some(
      (i) =>
        h.x0 > i.rect.x0 - 0.01 &&
        h.x1 < i.rect.x1 + 0.01 &&
        h.z0 > i.rect.z0 - 0.01 &&
        h.z1 < i.rect.z1 + 0.01,
    );
  for (const h of level.groundHoles ?? (level.groundHole ? [level.groundHole] : []))
    if (!inside(h)) out.push(grown(h, 0.2));
  // Whatever stands low enough to be in the way (decking on tall posts, roofs and the like
  // leave the ground under them alone).
  for (const b of level.boxes) {
    if (b.pos.y - b.size.y / 2 > 1.2) continue;
    out.push({
      x0: b.pos.x - b.size.x / 2,
      x1: b.pos.x + b.size.x / 2,
      z0: b.pos.z - b.size.z / 2,
      z1: b.pos.z + b.size.z / 2,
      box: b,
    });
  }
  for (const h of level.hideouts) {
    if (h.pos.y - h.size.y / 2 > 1.2) continue;
    out.push(around(h.pos.x, h.pos.z, Math.hypot(h.size.x, h.size.z) / 2 + 0.45));
  }
  for (const m of level.machines)
    out.push(around(m.pos.x, m.pos.z, Math.max(m.size.x, m.size.z) / 2 + 0.9));
  for (const p of level.pageSpots) if (p.y < 0.4) out.push(around(p.x, p.z, 0.7));
  for (const l of level.ladders) out.push(around(l.pos.x, l.pos.z, 0.9));
  for (const s of level.meetingSeats) out.push(around(s.x, s.z, 0.45));
  for (const site of levelSites(level)) {
    const bp = site.baseplate;
    const margin = 1.1;
    out.push({
      x0: bp.x - margin,
      x1: bp.x + BASEPLATE_SIZE + margin,
      z0: bp.z - margin,
      z1: bp.z + BASEPLATE_SIZE + margin,
    });
    const ins = site.inspector;
    out.push({
      x0: ins.pos.x - ins.size.x / 2 - 1,
      x1: ins.pos.x + ins.size.x / 2 + 1,
      z0: ins.pos.z - ins.size.z / 2 - 1,
      z1: ins.pos.z + ins.size.z / 2 + 1,
    });
    for (const p of [site.doneButton, site.bell]) out.push(around(p.x, p.z, 0.7));
    for (const b of [site.board, ...(site.moreBoards ?? [])])
      out.push(around(b.pos.x, b.pos.z, 1.2));
    out.push(around(site.spawn.x, site.spawn.z, 1.5));
  }
  if (level.catapult) out.push(around(level.catapult.pos.x, level.catapult.pos.z, 2.6));
  // The dog's kennel and pole.
  const kennel = level.dog.points[level.dog.start];
  if (kennel) out.push(around(kennel.x, kennel.z, 1.5));
  // The paving in front of every doorway out of a building on the ground.
  for (const s of roomSides(level)) {
    if (s.floor > 0.6) continue;
    for (const d of s.doorways) {
      const face = s.face - s.normal * d.thickness;
      const [a0, a1] = [face, face - s.normal * 1.8].sort((p, q) => p - q) as [number, number];
      const [u0, u1] = [d.from - 0.5, d.to + 0.5];
      out.push(s.alongX ? { x0: u0, x1: u1, z0: a0, z1: a1 } : { x0: a0, x1: a1, z0: u0, z1: u1 });
    }
  }
  return out;
}

const grown = (r: FloorRect, by: number): FloorRect => ({
  x0: r.x0 - by,
  x1: r.x1 + by,
  z0: r.z0 - by,
  z1: r.z1 + by,
});

/** How much a spot of ground grows: freely, only at the foot of things, or nothing. */
type Growth = 'grass' | 'edges' | 'none';

/** Things whose foot greenery gathers round, and how thickly (tufts round a metre of edge). */
const FOOT: Partial<Record<NonNullable<BoxDef['model']>, number>> = {
  rock: 5,
  stump: 4,
  log: 3,
  pine: 3,
  post: 2,
  lampPost: 3,
};

/**
 * Greenery for a level, decoration only (nothing collides with it): tufts of grass, bushes and
 * flowers. On grassy ground it grows all over, thickest at the foot of the fences and walls,
 * round the stones, stumps, logs, trees, posts and lamp posts, with bushes along the fence and
 * under the trees. Paved, gravelled or tarmacked ground only has weeds at the foot of things
 * and a few bushes along the fences and walls, and the paths, the beach and the trodden ground
 * by the job site nothing but tufts at the foot of things. Placed the same on every client:
 * every random choice is seeded from where it is made.
 *
 * Built as three meshes (the tufts, which cast no shadow, the bushes and the flowers), which
 * the scene merge bakes in with the rest.
 */
export function greenery(level: LevelDef): THREE.Group {
  const keep = keepOuts(level);
  const floor = floorRect(level);
  const grassy = level.groundSurface === 'grass';
  // Whether nothing keeps greenery `r` round a point out, but for the box it grows against.
  const free = (x: number, z: number, r: number, against?: BoxDef) =>
    x > floor.x0 + 0.2 + r &&
    x < floor.x1 - 0.2 - r &&
    z > floor.z0 + 0.2 + r &&
    z < floor.z1 - 0.2 - r &&
    !keep.some(
      (k) =>
        (!against || k.box !== against) &&
        x > k.x0 - r &&
        x < k.x1 + r &&
        z > k.z0 - r &&
        z < k.z1 + r,
    );
  // Ground floors drawn over the ground: rooms, paths, the beach, the trodden ground round
  // the job site.
  const floors = level.decals.filter((d) => Math.abs(d.pos.y) < 0.05);
  const growth = (x: number, z: number): Growth => {
    const d = floors.find(
      (f) => Math.abs(x - f.pos.x) <= f.size.x / 2 && Math.abs(z - f.pos.z) <= f.size.z / 2,
    );
    // A narrow strip (a path, the beach) is kept clear: it is walked along.
    if (d) return Math.min(d.size.x, d.size.z) < 4 ? 'none' : 'edges';
    return grassy ? 'grass' : 'edges';
  };

  const tufts = new Batch();
  const bushes = new Batch();
  const flowers = new Batch();
  const tuftAt = (x: number, z: number, size: number, rng: () => number) => {
    if (growth(x, z) !== 'none' && free(x, z, 0.04)) tuft(tufts, x, z, size, rng);
  };
  const flowersAt = (x: number, z: number, n: number, spread: number, rng: () => number) => {
    const colour = PETALS[Math.floor(rng() * PETALS.length)]!;
    for (let i = 0; i < n; i++) {
      const fx = x + (rng() - 0.5) * spread;
      const fz = z + (rng() - 0.5) * spread;
      if (growth(fx, fz) !== 'none' && free(fx, fz, 0.05)) flower(flowers, fx, fz, colour, rng);
    }
  };
  // A bush `r` round, clear of everything by `clear` (and up against the box `against`).
  const bushAt = (
    x: number,
    z: number,
    r: number,
    clear: number,
    rng: () => number,
    against?: BoxDef,
  ) => {
    if (growth(x, z) === 'none' || !free(x, z, clear, against)) return false;
    bush(bushes, x, z, r, r * (1.1 + rng() * 0.4), rng);
    return true;
  };

  for (const b of level.boxes) {
    if (!grounded(b) || b.tiltX) continue;
    const rng = rngAt(b.pos.x, b.pos.z, b.size.y);
    const thin = Math.min(b.size.x, b.size.z);
    const long = Math.max(b.size.x, b.size.z);
    const alongX = b.size.x >= b.size.z;
    if (!b.model && thin <= 0.35 && long >= 1 && b.size.y >= 0.6) {
      // A fence or a wall: tufts all along its foot on both sides (those indoors, or on the far
      // side of the level's edge, come to nothing), and now and then a bush.
      const step = grassy ? 0.42 : 0.55;
      for (const side of [-1, 1]) {
        let nextBush = 1 + rng() * 3;
        // Grass grows in clumps along it, thick in places and thin between them.
        const phase = rng() * Math.PI * 2;
        const every = 1.6 + rng() * 1.4;
        for (
          let u = -long / 2 + 0.3 + rng() * step;
          u < long / 2 - 0.3;
          u += step * (0.6 + rng() * 0.8)
        ) {
          const off = side * (thin / 2 + 0.04 + rng() * 0.14);
          const x = b.pos.x + (alongX ? u : off);
          const z = b.pos.z + (alongX ? off : u);
          const clump = 0.5 + 0.5 * Math.sin((u / every) * Math.PI * 2 + phase);
          if (rng() < (grassy ? 0.45 : 0.25) + 0.55 * clump)
            tuftAt(x, z, 0.24 + rng() * 0.12 + clump * 0.1, rng);
          if (u + long / 2 < nextBush) continue;
          nextBush += grassy ? 3 + rng() * 4 : 2.5 + rng() * 3;
          const r = 0.35 + rng() * 0.25;
          const at = (out: number) => {
            const o = side * (thin / 2 + out);
            return [b.pos.x + (alongX ? u : o), b.pos.z + (alongX ? o : u)] as const;
          };
          // Up against it, clear of anything else, a building's walls included (whose
          // insides reach out to their outer faces); flowers in front of some of them.
          if (bushAt(...at(r), r, r - 0.05, rng, b) && rng() < 0.6)
            flowersAt(...at(r * 2 + 0.15), 4, 0.6, rng);
        }
      }
      continue;
    }
    const per = b.model ? FOOT[b.model] : undefined;
    if (!per) continue;
    // Round the foot of a stone, a stump, a log, a tree trunk or a post: its own footprint,
    // or the round foot a lamp post or a pine stands on.
    const flare = b.model === 'pine' ? 1.12 : 1;
    const hx = Math.max((b.size.x / 2) * flare, b.model === 'lampPost' ? 0.12 : 0);
    const hz = Math.max((b.size.z / 2) * flare, b.model === 'lampPost' ? 0.12 : 0);
    const n = Math.max(2, Math.round(per * 2 * (hx + hz) * (0.7 + rng() * 0.6)));
    for (let i = 0; i < n; i++) {
      const a = ((i + rng() * 0.8) / n) * Math.PI * 2;
      const off = 0.03 + rng() * 0.1;
      const c = Math.cos(a);
      const s = Math.sin(a);
      // Out to the footprint's edge along that way (a log's is square, the rest round), and a
      // little beyond.
      const reach =
        b.model === 'log'
          ? Math.min(hx / Math.max(Math.abs(c), 1e-3), hz / Math.max(Math.abs(s), 1e-3))
          : 1 / Math.hypot(c / hx, s / hz);
      tuftAt(b.pos.x + c * (reach + off), b.pos.z + s * (reach + off), 0.22 + rng() * 0.16, rng);
    }
    if (b.model === 'pine' && grassy) {
      // Undergrowth in the shade of the trees.
      for (let i = 0, count = 1 + Math.floor(rng() * 2); i < count; i++) {
        const a = rng() * Math.PI * 2;
        const d = 0.8 + rng() * 0.7;
        const x = b.pos.x + Math.cos(a) * d;
        const z = b.pos.z + Math.sin(a) * d;
        const r = 0.35 + rng() * 0.2;
        if (bushAt(x, z, r, r + 0.1, rng) && rng() < 0.5)
          flowersAt(x + Math.cos(a) * (r + 0.3), z + Math.sin(a) * (r + 0.3), 4, 0.5, rng);
      }
    }
  }

  if (grassy) {
    // Tufts and the odd patch of flowers scattered over the open grass, one chance a square
    // metre.
    for (let i = Math.floor(floor.x0); i < floor.x1; i++)
      for (let j = Math.floor(floor.z0); j < floor.z1; j++) {
        const rng = rngAt(i, j, 7);
        const x = i + 0.1 + rng() * 0.8;
        const z = j + 0.1 + rng() * 0.8;
        if (growth(x, z) !== 'grass') continue;
        if (rng() < 0.5) tuftAt(x, z, 0.16 + rng() * 0.14, rng);
        if (rng() < 0.03) flowersAt(x, z, 4 + Math.floor(rng() * 4), 0.7, rng);
      }
  }

  const group = new THREE.Group();
  if (!tufts.empty) put(group, tufts.geometry(), Surface.Grass, false);
  if (!bushes.empty) put(group, bushes.geometry(), Surface.Grass);
  if (!flowers.empty) put(group, flowers.geometry(), Surface.Auto);
  return group;
}
