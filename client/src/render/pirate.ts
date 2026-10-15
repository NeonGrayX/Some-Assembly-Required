import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { add, box, mat, metal } from './interiors.ts';
import { KEEP_SEPARATE } from './merge.ts';
import { atNight } from './daynight.ts';
import { FRAME as WALL_FRAME } from './details.ts';
import { hex, painted, put, windowBoxPlants } from './nature.ts';
import { bevelBox, bevelCylinder } from './shapes.ts';
import { Surface, madeOf } from './styles.ts';

/**
 * The pirate island's man-made things, chunky and hand-painted like the rest of the game: iron
 * hooped barrels, a cannon on its truck carriage, rope fences and the rope bridge's rails, the
 * beached ship's planked hull, its mast with striped sails, flags with the skull and crossbones,
 * and the steep shingled roofs of the tavern and the captain's hut.
 *
 * Curved timber (staves, a hull's strakes, a mast, shingles laid on a slope) is painted into
 * vertex colours on a material drawn as no surface in particular (see `nature.ts`), so that the
 * styles' wood, laid out in straight boards along the world's axes, does not run across it.
 * Flat timber standing square to the world (a carriage's cheeks, beams, a deck) is plain wood.
 *
 * Models are built like `props.ts`'s, in a frame centred on their box with local -z its front,
 * `w` wide (x), `h` high and `d` deep (z), and stay inside the box (it is what they collide
 * as), but for what reaches out of it on purpose: sails, flags, a ship's bow and bulwarks.
 */

/** Dark timber: carriages, posts, barge boards and beams. */
const TIMBER = 0x5f3d22;
/** The carriage of a cannon, a shade warmer. */
const CARRIAGE = 0x6e4a2b;
/** Wrought iron: hoops, straps, bolts and caps. */
const IRON = 0x34363a;
/** The cream plaster of a gable end. */
const PLASTER = 0xeadcbc;
/** A ship's deck planks. */
const DECK = 0xa57446;
/** Sailcloth: the red stripes and the cream ones. */
const SAIL_RED = 0xb8432f;
const SAIL_CREAM = 0xeee0c2;
/** A pirate flag's black cloth. */
const FLAG = 0x1c1b1f;
/** The dark inside of a barrel seen over its rim. */
const INSIDE = 0x1c1a18;

const tagged = new Map<string, THREE.MeshStandardMaterial>();

/**
 * A material of its own, made of `surface`: not one of `mat`'s, which every model shares, and
 * which tagging here would tag everywhere.
 */
function made(
  colour: number,
  surface: Surface,
  roughness = 0.8,
  metalness = 0,
  twoSided = false,
): THREE.MeshStandardMaterial {
  const key = [colour, surface, roughness, metalness, twoSided].join();
  let m = tagged.get(key);
  if (!m) {
    m = madeOf(
      new THREE.MeshStandardMaterial({
        color: colour,
        roughness,
        metalness,
        side: twoSided ? THREE.DoubleSide : THREE.FrontSide,
      }),
      surface,
    );
    tagged.set(key, m);
  }
  return m;
}

/** Wrought iron, its edges caught bright in the painted style. */
const iron = () => metal(IRON);

/** Shades of `c`: each a new colour. */
const times = (c: THREE.Color, f: number) => c.clone().multiplyScalar(f);

// ---------------------------------------------------------------- shapes

/** One ring of a turned piece (see `lathe`): its height, radius and colour. */
interface Turn {
  y: number;
  /** Its radius; 0 closes the piece with a point on its axis. */
  r: number;
  colour: THREE.Color;
  /** How much the columns' relief (`Column`) shows in this ring: 0 none, 1 all of it. */
  relief?: number;
}

/** A line of points down a turned piece: its angle, and how far out and how light it is. */
interface Column {
  a: number;
  out: number;
  shade: number;
}

/** `n` plain columns, evenly round. */
const evenly = (n: number): Column[] =>
  Array.from({ length: n }, (_, j) => ({ a: (j / n) * Math.PI * 2, out: 1, shade: 1 }));

/**
 * A piece turned about y through `turns`, bottom to top, its points on `columns` round it,
 * with vertex colours. Its outside faces out where the rings climb, in where they come back
 * down (the inside of a barrel), up where they step in and down where they step out.
 */
function lathe(turns: Turn[], columns: Column[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const colours: number[] = [];
  const starts: number[] = [];
  for (const t of turns) {
    starts.push(positions.length / 3);
    if (t.r === 0) {
      positions.push(0, t.y, 0);
      colours.push(t.colour.r, t.colour.g, t.colour.b);
      continue;
    }
    const f = t.relief ?? 0;
    for (const c of columns) {
      const r = t.r * (1 - f * (1 - c.out));
      positions.push(r * Math.sin(c.a), t.y, r * Math.cos(c.a));
      const k = 1 + f * (c.shade - 1);
      colours.push(t.colour.r * k, t.colour.g * k, t.colour.b * k);
    }
  }
  const n = columns.length;
  const index: number[] = [];
  for (let i = 0; i + 1 < turns.length; i++) {
    const lo = starts[i]!;
    const hi = starts[i + 1]!;
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;
      if (turns[i]!.r === 0) index.push(hi + j, lo, hi + j1);
      else if (turns[i + 1]!.r === 0) index.push(lo + j, lo + j1, hi);
      else index.push(hi + j, lo + j, hi + j1, lo + j, lo + j1, hi + j1);
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
 * A board whose outline seen side on (in z and y) is `outline`, from `x0` to `x1` along x, its
 * edges rounded `round` (a barge board, a strut, a cheek): built in place, so its bounds are
 * snug round it however it slopes.
 */
function slab(
  outline: [number, number][],
  x0: number,
  x1: number,
  round = 0,
): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map(([z, y]) => new THREE.Vector2(z, y)));
  const r = Math.min(round, (x1 - x0) * 0.3);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: x1 - x0 - 2 * r,
    bevelEnabled: r > 0,
    bevelThickness: r,
    bevelSize: r,
    bevelOffset: -r,
    bevelSegments: 1,
    curveSegments: 4,
  });
  // Drawn in x-y and pushed out along z: turned so its x is z and its depth runs along -x.
  geometry.rotateY(-Math.PI / 2);
  geometry.translate(x1 - r, 0, 0);
  return geometry;
}

/** Gives every point of `geometry` the colour `c`, for a mesh painted in vertex colours. */
function coloured(geometry: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry {
  const n = geometry.attributes.position!.count;
  const colours = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colours.set([c.r, c.g, c.b], i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return geometry;
}

/**
 * Quadrilaterals gathered into one geometry, each with its own colours (so a plank's edge can
 * be dark where the next one's is light), and smooth normals given with them.
 */
class Quads {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colours: number[] = [];

  /** The quad `p` (its corners in turn round it), facing the way of its normals `n`. */
  quad(p: THREE.Vector3[], n: THREE.Vector3[], c: THREE.Color[]): void {
    for (const [a, b, e] of [
      [0, 1, 2],
      [0, 2, 3],
    ] as const) {
      const face = p[b]!.clone().sub(p[a]!).cross(p[e]!.clone().sub(p[a]!));
      const order = face.dot(n[a]!.clone().add(n[b]!).add(n[e]!)) < 0 ? [a, e, b] : [a, b, e];
      for (const k of order) {
        this.positions.push(p[k]!.x, p[k]!.y, p[k]!.z);
        this.normals.push(n[k]!.x, n[k]!.y, n[k]!.z);
        this.colours.push(c[k]!.r, c[k]!.g, c[k]!.b);
      }
    }
  }

  /** A flat quad, its normal worked out from its corners and turned to face `towards`. */
  flat(p: THREE.Vector3[], towards: THREE.Vector3, c: THREE.Color | THREE.Color[]): void {
    const n = p[1]!.clone().sub(p[0]!).cross(p[2]!.clone().sub(p[0]!)).normalize();
    if (n.dot(towards) < 0) n.negate();
    const cs = Array.isArray(c) ? c : [c, c, c, c];
    this.quad(p, [n, n, n, n], cs);
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

/**
 * A bevelled box `sx × sy × sz` at (`x`, `y`, `z`) painted `c` in vertex colours, as a brush
 * would: a little lighter on top and darker underneath.
 */
function block(
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
  c: THREE.Color,
): THREE.BufferGeometry {
  const geometry = bevelBox(sx, sy, sz);
  const normal = geometry.attributes.normal!;
  const colours = new Float32Array(normal.count * 3);
  for (let k = 0; k < normal.count; k++) {
    const up = normal.getY(k);
    const f = up > 0 ? 1 + 0.16 * up : 1 + 0.42 * up;
    colours.set([c.r * f, c.g * f, c.b * f], k * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return geometry.translate(x, y, z);
}

/** A cylinder `r` round from `a` to `b`, as a mesh turned along the line between them. */
function rod(
  g: THREE.Object3D,
  a: THREE.Vector3,
  b: THREE.Vector3,
  r: number,
  material: THREE.Material,
  sides = 6,
): THREE.Mesh {
  const length = a.distanceTo(b);
  const m = add(g, new THREE.CylinderGeometry(r, r, length, sides), material, 0, 0, 0);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

// ---------------------------------------------------------------- barrels

/** How far a barrel's staves bulge: its middle this much wider than its ends, as a share. */
const BULGE = 0.14;
/** How thick a barrel's staves are. */
const STAVE = 0.028;

/**
 * A barrel standing on its end, filling the box: a dozen or so staves bulging out in the
 * middle, each its own shade with a dark groove either side and a worn lighter edge, bound with
 * four flat iron hoops, its head of planks sunk a little inside the rim. `open` leaves the head
 * out: the barrel is open at the top, dark inside down to a floor that far under the rim (a bin
 * bricks are thrown in, see `bins.ts`).
 */
export function barrelModel(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
  open = 0,
): void {
  const hoop = 0.012;
  const R = Math.min(w, d) / 2 - hoop - 0.012;
  const foot = -h / 2;
  const top = h / 2;
  const rAt = (y: number) => R * (1 - BULGE + BULGE * Math.sin((Math.PI * (y - foot)) / h));
  const staves = 12 + Math.floor(seed() * 3);
  const columns: Column[] = [];
  for (let i = 0; i < staves; i++) {
    const tone = 0.84 + seed() * 0.3;
    const a = (i / staves) * Math.PI * 2;
    const da = (Math.PI * 2) / staves;
    columns.push(
      { a, out: 0.965, shade: 0.42 },
      { a: a + da * 0.1, out: 1, shade: 1.14 * tone },
      { a: a + da * 0.5, out: 1.012, shade: tone },
      { a: a + da * 0.86, out: 0.996, shade: 0.88 * tone },
    );
  }
  const wood = hex(colour);
  const end = wood.clone().lerp(hex(0xd9c29a), 0.4);
  const turns: Turn[] = [
    { y: foot, r: 0, colour: times(wood, 0.3) },
    { y: foot, r: rAt(foot) - 0.008, colour: times(wood, 0.45), relief: 1 },
  ];
  const rows = 10;
  for (let i = 0; i <= rows; i++) {
    const y = foot + 0.012 + ((h - 0.024) * i) / rows;
    // Darker low down, in the shade of its own belly.
    const shade = 0.66 + 0.34 * Math.min(1, (i / rows) * 1.7);
    turns.push({ y, r: rAt(y), colour: times(wood, shade), relief: 1 });
  }
  // The rim: the staves' ends, worn pale, and inside them the head (or the dark inside).
  turns.push(
    { y: top, r: rAt(top) - 0.008, colour: end, relief: 1 },
    { y: top, r: rAt(top) - STAVE, colour: times(end, 0.9), relief: 0.6 },
  );
  const head = top - (open || 0.03);
  const dark = hex(INSIDE);
  if (open > 0)
    turns.push(
      { y: top - 0.03, r: rAt(top - 0.03) - STAVE, colour: times(wood, 0.4), relief: 0.6 },
      { y: head, r: rAt(head) - STAVE, colour: dark, relief: 0.6 },
      { y: head, r: 0, colour: dark },
    );
  else
    turns.push(
      { y: head, r: rAt(head) - STAVE, colour: times(wood, 0.4), relief: 0.6 },
      { y: head, r: 0, colour: dark },
    );
  // Turned its own way (in its points, so its bounds stay square to the box).
  const yaw = seed() * Math.PI * 2;
  put(g, lathe(turns, columns).rotateY(yaw), Surface.Auto);
  if (!open)
    put(
      g,
      barrelHead(rAt(head) - STAVE - 0.003, head + 0.006, end, seed).rotateY(yaw),
      Surface.Auto,
    );
  // The hoops: two near each end, flat iron bands with their edges rounded.
  for (const f of [0.1, 0.26, 0.74, 0.9]) {
    const y = foot + f * h;
    const half = Math.min(0.026, h * 0.03);
    const y0 = y - half;
    const y1 = y + half;
    const inner = Math.min(rAt(y0), rAt(y1)) - 0.004;
    const r0 = rAt(y0) + hoop;
    const r1 = rAt(y1) + hoop;
    const c = 0.005;
    const band = new THREE.LatheGeometry(
      [
        [inner, y0],
        [r0 - c, y0],
        [r0, y0 + c],
        [r1, y1 - c],
        [r1 - c, y1],
        [inner, y1],
        [inner, y0],
      ].map(([r, yy]) => new THREE.Vector2(r, yy)),
      28,
    );
    add(g, band, iron(), 0, 0, 0);
  }
}

/** A barrel's head: planks across a disc `r` round at `y`, each its own shade, gaps between. */
function barrelHead(r: number, y: number, wood: THREE.Color, seed: () => number) {
  const planks = 4;
  const gap = 0.006;
  const positions: number[] = [];
  const colours: number[] = [];
  for (let k = 0; k < planks; k++) {
    const z0 = -r + (2 * r * k) / planks + gap / 2;
    const z1 = -r + (2 * r * (k + 1)) / planks - gap / 2;
    const tone = times(wood, 0.82 + seed() * 0.3);
    // Its outline: down one side of the disc and back up the other.
    const steps = 4;
    const ring: THREE.Vector3[] = [];
    for (let i = 0; i <= steps; i++) {
      const z = z0 + ((z1 - z0) * i) / steps;
      ring.push(new THREE.Vector3(-Math.sqrt(Math.max(0, r * r - z * z)), y, z));
    }
    for (let i = steps; i >= 0; i--) {
      const z = z0 + ((z1 - z0) * i) / steps;
      ring.push(new THREE.Vector3(Math.sqrt(Math.max(0, r * r - z * z)), y, z));
    }
    // A fan from its first corner, wound to face up.
    for (let i = 1; i + 1 < ring.length; i++) {
      const [a, b, c] = [ring[0]!, ring[i]!, ring[i + 1]!];
      const up = b.clone().sub(a).cross(c.clone().sub(a)).y >= 0;
      for (const p of up ? [a, b, c] : [a, c, b]) {
        positions.push(p.x, p.y, p.z);
        colours.push(tone.r, tone.g, tone.b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------- posts and rope

/**
 * A hewn timber post `r` round from `y0` up to `y1` at (`x`, `z`): eight rough faces, each a
 * shade of its own, darker at its foot, its top chamfered and pale.
 */
function timberPost(
  g: THREE.Object3D,
  r: number,
  x: number,
  y0: number,
  y1: number,
  z: number,
  colour: number,
  seed: () => number,
): void {
  const wood = hex(colour);
  const columns: Column[] = Array.from({ length: 8 }, (_, i) => ({
    a: ((i + (seed() - 0.5) * 0.3) / 8) * Math.PI * 2,
    out: 0.93 + seed() * 0.07,
    shade: 0.8 + seed() * 0.35,
  }));
  const c = Math.min(0.03, r * 0.3);
  const geometry = lathe(
    [
      { y: y0, r: 0, colour: times(wood, 0.5) },
      { y: y0, r, colour: times(wood, 0.55), relief: 1 },
      { y: y0 + (y1 - y0) * 0.4, r: r * 0.98, colour: times(wood, 0.9), relief: 1 },
      { y: y1 - c, r, colour: times(wood, 1.1), relief: 1 },
      { y: y1, r: r - c, colour: wood.clone().lerp(hex(0xd9c29a), 0.45), relief: 0.5 },
      { y: y1, r: 0, colour: wood.clone().lerp(hex(0xd9c29a), 0.3) },
    ],
    columns,
  );
  put(g, geometry.translate(x, 0, z), Surface.Auto);
}

/**
 * A thick rope `r` round along `curve` in `segments`: its strands twisting round it, painted
 * lighter on top and darker underneath.
 */
function ropeTube(
  curve: THREE.Curve<THREE.Vector3>,
  segments: number,
  r: number,
  colour: number,
): THREE.BufferGeometry {
  const geometry = new THREE.TubeGeometry(curve, segments, r, 6, false);
  const uv = geometry.attributes.uv!;
  const normal = geometry.attributes.normal!;
  const base = hex(colour);
  const colours = new Float32Array(uv.count * 3);
  for (let k = 0; k < uv.count; k++) {
    // Three strands round it, twisting along it.
    const twist =
      0.5 + 0.5 * Math.cos(Math.PI * 2 * (uv.getY(k) * 3 - uv.getX(k) * segments * 0.5));
    const c = times(base, (0.72 + 0.32 * twist) * (0.82 + 0.22 * normal.getY(k)));
    colours.set([c.r, c.g, c.b], k * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return geometry;
}

/** A thick rope slung from `a` to `b`, sagging `sag` in the middle (see `ropeTube`). */
function rope(
  a: THREE.Vector3,
  b: THREE.Vector3,
  sag: number,
  r: number,
  colour: number,
): THREE.BufferGeometry {
  // The middle of a quadratic curve is halfway from its ends' middle to its control point.
  const control = a.clone().add(b).multiplyScalar(0.5);
  control.y -= 2 * sag;
  const curve = new THREE.QuadraticBezierCurve3(a, control, b);
  return ropeTube(curve, Math.max(8, Math.round(a.distanceTo(b) * 10)), r, colour);
}

/** A turn or two of rope round a post `r` round at height `y`. */
function lashing(g: THREE.Object3D, r: number, x: number, y: number, z: number, colour: number) {
  const base = hex(colour);
  for (const [dy, tube] of [
    [-0.022, 0.024],
    [0.022, 0.022],
  ] as const) {
    const ring = new THREE.TorusGeometry(r + 0.006, tube, 5, 12).rotateX(Math.PI / 2);
    const normal = ring.attributes.normal!;
    const colours = new Float32Array(normal.count * 3);
    for (let k = 0; k < normal.count; k++) {
      const c = times(base, 0.75 + 0.3 * normal.getY(k));
      colours.set([c.r, c.g, c.b], k * 3);
    }
    ring.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    put(g, ring.translate(x, y + dy, z), Surface.Auto);
  }
}

/**
 * A fence of thick timber posts along the box's long side, with ropes in `colour` slung between
 * their tops and lower down, sagging, and lashed round each post: the island's edge out in the
 * shallows. As a `rail` (the rope bridge's handrail, one length of it), it is a short post at
 * its start with the ropes slung on from it to the end of the box, where the next length's post
 * stands `rise` higher; or, if it is the last (`rise` null), to a post of its own there.
 */
export function ropeFence(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
  rail: { rise: number | null } | null = null,
): void {
  const last = rail?.rise === null;
  const rise = rail?.rise ?? 0;
  const alongX = w >= d;
  const L = Math.max(w, d);
  const T = Math.min(w, d);
  const r = Math.min(rail ? 0.055 : 0.12, T / 2 - 0.005);
  const at = (u: number, y: number) =>
    alongX ? new THREE.Vector3(u, y, 0) : new THREE.Vector3(0, y, u);
  const bays = rail ? 1 : Math.max(1, Math.round(L / 2.1));
  // The end posts stand in far enough for the rope lashed round them to stay in the box.
  const end = L / 2 - r - 0.035;
  const posts = rail
    ? [-end, ...(last ? [end] : [])]
    : Array.from({ length: bays + 1 }, (_, i) =>
        Math.min(end, Math.max(-end, -L / 2 + (i * L) / bays)),
      );
  for (const u of posts) {
    const p = at(u, 0);
    timberPost(g, r, p.x, -h / 2, h / 2, p.z, TIMBER, seed);
  }
  const strands = rail ? [h / 2 - 0.1, -h / 2 + 0.42] : [h / 2 - 0.16, h / 2 - 0.62];
  const thick = rail ? 0.022 : 0.032;
  for (const y of strands) {
    // From post to post, or on to the next length's post (just past the end of the box).
    const spans: [number, number][] = rail
      ? [[-end + r * 0.6, (last ? end : L - end) - r * 0.6]]
      : posts.slice(1).map((u, i) => [posts[i]! + r * 0.6, u - r * 0.6]);
    for (const [a, b] of spans) {
      const sag = Math.min(rail ? 0.07 : 0.2, 0.11 * (b - a));
      const up = rail && !last ? rise : 0;
      put(g, rope(at(a, y), at(b, y + up), sag, thick, colour), Surface.Auto);
    }
    for (const u of posts) {
      const p = at(u, y);
      lashing(g, r, p.x, y, p.z, colour);
    }
  }
}

// ---------------------------------------------------------------- mooring posts

/** Old timber gone grey in the sun and the salt, toward the top of a mooring post. */
const BLEACHED = 0xaaa392;
/** Wet timber, dark and green with weed, where the sea comes up a post. */
const WEED = 0x2f3b26;
/** The pale crust of barnacles. */
const BARNACLE = 0xdcd5c2;
/** A mooring post's rope, darker than a fence's for the wet. */
const HAWSER = 0xb08c56;

/**
 * An old mooring post standing in the sea, the box from below the sea bed: a hewn round trunk,
 * uneven and leaning a few degrees about the waterline (`sea`, in its frame), its top rounded
 * over or sawn off on the slant to pale end grain, dark and weedy from the sea bed to a little
 * over the water and greying in the sun above, crusted with barnacles about the waterline;
 * higher up two or three turns of rope round it with a loose end hanging, and on some an iron
 * band under the top. Each is its own, from `seed`. Leaning, its top reaches out of the box by
 * a few centimetres.
 */
export function pilingModel(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
  sea: number | null,
): void {
  const R = (Math.min(w, d) / 2) * 0.94;
  const foot = -h / 2;
  const top = h / 2;
  const water = Math.min(top - 0.6, Math.max(foot + 0.3, sea ?? foot + h * 0.45));
  // Built upright about the waterline, then leant over about it.
  const post = new THREE.Group();
  post.position.y = water;
  const lean = ((2 + seed() * 3.5) * Math.PI) / 180;
  const way = seed() * Math.PI * 2;
  post.rotation.set(Math.cos(way) * lean, 0, Math.sin(way) * lean);
  g.add(post);
  const y0 = foot - water;
  const y1 = top - water;
  const wood = hex(colour);
  const bleached = wood.clone().lerp(hex(BLEACHED), 0.7);
  const wet = times(wood, 0.4).lerp(hex(WEED), 0.6);
  const weed = wet.clone().lerp(hex(0x5d6e36), 0.55);
  /**
   * Its colour at height `y` over the waterline: dark and wet up to a hand's breadth over the
   * water, a fringe of weed over that, then greying up to its top.
   */
  const colourAt = (y: number) => {
    if (y < 0.2) return wet.clone();
    if (y < 0.28) return wet.clone().lerp(weed, (y - 0.2) / 0.08);
    if (y < 0.48) return weed.clone().lerp(wood, (y - 0.28) / 0.2);
    return wood.clone().lerp(bleached, Math.min(1, (y - 0.48) / Math.max(0.3, y1 - 0.6)));
  };
  // A little thinner toward the top, and swelling a touch here and there.
  const swell = seed() * Math.PI * 2;
  const rAt = (y: number) =>
    R * (1 - 0.1 * ((y - y0) / (y1 - y0))) * (1 + 0.025 * Math.sin(y * 4.1 + swell));
  const columns: Column[] = Array.from({ length: 11 }, (_, i) => ({
    a: ((i + (seed() - 0.5) * 0.4) / 11) * Math.PI * 2,
    out: 0.9 + seed() * 0.1,
    shade: 0.78 + seed() * 0.36,
  }));
  const slanted = seed() < 0.55;
  const rise = slanted ? 2 * R * Math.tan(0.35 + seed() * 0.2) : 0;
  const cut = y1 - rise;
  const turns: Turn[] = [{ y: y0, r: 0, colour: times(wet, 0.6) }];
  const heights = [y0, -0.6, -0.2, 0.2, 0.28, 0.48, 0.9, 1.25].filter(
    (y) => y >= y0 && y < cut - 0.2,
  );
  for (const y of heights) turns.push({ y, r: rAt(y), colour: colourAt(y), relief: 1 });
  const grain = bleached.clone().lerp(hex(0xe2d3b0), 0.45);
  if (slanted)
    // Sawn off on the slant: its end grain pale, a darker ring in it.
    turns.push(
      { y: cut, r: rAt(cut), colour: colourAt(cut), relief: 1 },
      { y: cut, r: rAt(cut), colour: times(grain, 0.85), relief: 0.6 },
      { y: cut, r: rAt(cut) * 0.62, colour: times(grain, 0.72), relief: 0.3 },
      { y: cut, r: rAt(cut) * 0.5, colour: grain, relief: 0.2 },
      { y: cut, r: 0, colour: times(grain, 0.92) },
    );
  else
    // Worn round over the top.
    turns.push(
      { y: y1 - 0.16, r: rAt(y1 - 0.16), colour: colourAt(y1), relief: 1 },
      { y: y1 - 0.07, r: rAt(y1) * 0.86, colour: times(bleached, 1.05), relief: 0.8 },
      { y: y1 - 0.015, r: rAt(y1) * 0.5, colour: times(bleached, 1.12), relief: 0.5 },
      { y: y1, r: 0, colour: times(bleached, 1.1) },
    );
  const trunk = lathe(turns, columns);
  if (slanted) {
    // The cut tipped up to one side.
    const tip = seed() * Math.PI * 2;
    const pos = trunk.attributes.position!;
    for (let k = 0; k < pos.count; k++) {
      if (pos.getY(k) < cut - 1e-6) continue;
      const along = pos.getX(k) * Math.cos(tip) + pos.getZ(k) * Math.sin(tip);
      pos.setY(k, cut + (rise / 2) * (1 + along / rAt(cut)));
    }
    trunk.computeVertexNormals();
  }
  put(post, trunk, Surface.Auto);
  // Barnacles in clumps about the waterline.
  const crust: THREE.BufferGeometry[] = [];
  const clumps = 4 + Math.floor(seed() * 3);
  for (let c = 0; c < clumps; c++) {
    const a = seed() * Math.PI * 2;
    const y = -0.05 + seed() * 0.25;
    const n = 4 + Math.floor(seed() * 4);
    for (let i = 0; i < n; i++) {
      const ai = a + (seed() - 0.5) * 0.8;
      const yi = Math.max(y0 + 0.05, y + (seed() - 0.5) * 0.2);
      const size = 0.026 + seed() * 0.026;
      const r = rAt(yi) * 0.95;
      const shell = new THREE.IcosahedronGeometry(1, 0);
      shell.deleteAttribute('uv');
      shell.scale(size, size * 0.8, size * 0.55);
      // Turned to sit flat on the trunk, facing out from it.
      shell.rotateY(-ai + Math.PI / 2);
      shell.translate(r * Math.cos(ai), yi, r * Math.sin(ai));
      crust.push(coloured(shell, times(hex(BARNACLE), 0.8 + seed() * 0.3)));
    }
  }
  if (crust.length) {
    put(post, mergeGeometries(crust), Surface.Auto, false);
    for (const c of crust) c.dispose();
  }
  // The rope: a few turns round it, and its end hanging down from the last.
  const ry = Math.min(cut - 0.25, 0.55 + seed() * 0.35);
  const tube = 0.03;
  const turnsOf = 2 + Math.floor(seed() * 2);
  for (let i = 0; i < turnsOf; i++) {
    const y = ry + (i - (turnsOf - 1) / 2) * tube * 1.8;
    const ring = new THREE.TorusGeometry(rAt(y) * 0.97 + tube * 0.8, tube, 6, 16).rotateX(
      Math.PI / 2,
    );
    ring.rotateZ((seed() - 0.5) * 0.12).translate(0, y, 0);
    const normal = ring.attributes.normal!;
    const colours = new Float32Array(normal.count * 3);
    const base = hex(HAWSER);
    for (let k = 0; k < normal.count; k++) {
      const c = times(base, (0.72 + 0.3 * normal.getY(k)) * (0.9 + 0.12 * Math.sin(k * 1.7)));
      colours.set([c.r, c.g, c.b], k * 3);
    }
    ring.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    put(post, ring, Surface.Auto);
  }
  const ta = seed() * Math.PI * 2;
  const out = new THREE.Vector3(Math.cos(ta), 0, Math.sin(ta));
  const side = new THREE.Vector3(-out.z, 0, out.x);
  const from = out
    .clone()
    .multiplyScalar(rAt(ry) + tube * 1.6)
    .setY(ry - tube);
  const hang = Math.min(0.5, ry - 0.05);
  const tail = new THREE.CatmullRomCurve3([
    from,
    from
      .clone()
      .addScaledVector(out, 0.04)
      .add(new THREE.Vector3(0, -hang * 0.35, 0)),
    from
      .clone()
      .addScaledVector(out, 0.05)
      .addScaledVector(side, 0.04)
      .setY(ry - hang * 0.75),
    from
      .clone()
      .addScaledVector(out, 0.08)
      .addScaledVector(side, 0.09)
      .setY(ry - hang),
  ]);
  put(post, ropeTube(tail, 10, tube * 0.9, HAWSER), Surface.Auto);
  // An iron band under the top, on some.
  if (seed() < 0.4) {
    const y = cut - 0.14;
    const r = rAt(y) + 0.008;
    const band = new THREE.LatheGeometry(
      [
        [r - 0.02, y - 0.03],
        [r, y - 0.03],
        [r + 0.006, y],
        [r, y + 0.03],
        [r - 0.02, y + 0.03],
      ].map(([rr, yy]) => new THREE.Vector2(rr, yy)),
      16,
    );
    add(post, band, iron(), 0, 0, 0);
  }
}

// ---------------------------------------------------------------- the cannon

/**
 * A cannon on its truck carriage, its muzzle to the box's front, as big as the box lets it be:
 * the fat iron barrel turned with a swelling muzzle, heavy rings and the knob of its cascabel,
 * dark and polished where the light catches it, cocked up a hair, resting by its trunnions on
 * the carriage's stepped cheeks under iron cap-squares; the cheeks on their axletrees, on four
 * chunky wooden trucks with iron tyres and hubs, bolted.
 */
export function cannonModel(g: THREE.Object3D, w: number, h: number, d: number, colour: number) {
  const barrelIron = mat(new THREE.Color(colour).multiplyScalar(0.85).getHex(), 0.4, 0.55);
  const wood = mat(CARRIAGE, 0.78);
  const dark = mat(TIMBER, 0.8);
  const foot = -h / 2;
  // The trucks.
  const wr = h * 0.25;
  const wt = Math.min(0.11, w * 0.13);
  const tyre = 0.016;
  const wx = w / 2 - wt / 2 - 0.012;
  const axleY = foot + wr + tyre;
  // The carriage's length, and the trucks at its ends.
  const cz0 = -0.24 * d;
  const cz1 = 0.3 * d;
  const trucks = [cz0 + wr * 0.95, cz1 - wr * 0.85];
  const cheekT = 0.08;
  const cheekX = wx - wt / 2 - 0.006 - cheekT / 2;
  // The barrel, as fat as fits between the cheeks, its axis through its trunnions as high as
  // the box lets it.
  const R0 = Math.min(h * 0.27, cheekX - cheekT / 2 - 0.004);
  const Lb = d - 0.04;
  const zt = -0.06 * d;
  const yA = h / 2 - R0 * 1.1 - 0.015;
  const raise = 0.045;
  // The cheeks: stepped down from the trunnions toward the back, on the axletrees.
  const yb = axleY - 0.04;
  const yt = yA - 0.04;
  const steps = 3;
  const rise = (yt - yb - 0.12) / steps;
  const outline: [number, number][] = [
    [cz0, yb],
    [cz0, yt - 0.06],
    [cz0 + 0.06, yt],
    [zt + 0.07, yt],
  ];
  const run = (cz1 - (zt + 0.07)) / steps;
  for (let i = 1; i <= steps; i++) {
    const z = zt + 0.07 + run * (i - 1);
    outline.push([z, yt - rise * (i - 1)], [z, yt - rise * i], [z + run, yt - rise * i]);
  }
  outline.push([cz1, yb]);
  // (Each step's corner once: the outline above lists the riser's top twice.)
  const cheek = outline.filter(
    (p, i) => i === 0 || Math.hypot(p[0] - outline[i - 1]![0], p[1] - outline[i - 1]![1]) > 1e-6,
  );
  for (const s of [-1, 1])
    add(g, slab(cheek, s * cheekX - cheekT / 2, s * cheekX + cheekT / 2, 0.015), wood, 0, 0, 0);
  // The axletrees under them, the transom between their fronts, and the bed under the breech.
  for (const z of trucks) box(g, 2 * wx - wt, 0.1, 0.12, 0, axleY, z, dark);
  box(g, 2 * cheekX - cheekT, 0.14, 0.1, 0, yb + 0.09, cz0 + 0.07, wood);
  const bed = yA - R0 * 1.1 - 0.05;
  box(g, 2 * cheekX - cheekT, 0.05, cz1 - zt - 0.15, 0, bed, (zt + 0.1 + cz1 - 0.05) / 2, wood);
  // The trucks: thick wooden wheels with iron tyres, and hubs with a ring of bolts.
  for (const z of trucks)
    for (const s of [-1, 1]) {
      const x = s * wx;
      for (const [geometry, material] of [
        [bevelCylinder(wr, wr, wt, 20), mat(CARRIAGE, 0.82)],
        [bevelCylinder(wr + tyre, wr + tyre, wt * 0.66, 20), iron()],
        [bevelCylinder(wr * 0.32, wr * 0.32, wt + 0.02, 12), iron()],
        [bevelCylinder(wr * 0.14, wr * 0.14, wt + 0.05, 8), iron()],
      ] as const) {
        add(g, geometry.rotateZ(Math.PI / 2), material, x, axleY, z);
      }
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const bolt = new THREE.CylinderGeometry(0.016, 0.016, wt + 0.012, 6).rotateZ(Math.PI / 2);
        add(g, bolt, iron(), x, axleY + Math.sin(a) * wr * 0.62, z + Math.cos(a) * wr * 0.62);
      }
    }
  // The barrel, muzzle to -z: turned up the axis from the cascabel's knob to the muzzle's face
  // and down into its bore.
  const knob = R0 * 0.32;
  const P: [number, number][] = [
    [0, 0],
    [knob * 0.75, knob * 0.3],
    [knob, knob],
    [knob * 0.7, knob * 1.75],
    [R0 * 0.26, knob * 2.2],
    [R0 * 0.55, Lb * 0.035],
    [R0 * 0.88, Lb * 0.07],
    [R0, Lb * 0.1],
    [R0 * 1.1, Lb * 0.11],
    [R0 * 1.1, Lb * 0.16],
    [R0, Lb * 0.17],
    [R0 * 0.95, Lb * 0.44],
    [R0 * 1.03, Lb * 0.45],
    [R0 * 1.03, Lb * 0.49],
    [R0 * 0.9, Lb * 0.5],
    [R0 * 0.76, Lb * 0.82],
    [R0 * 0.84, Lb * 0.83],
    [R0 * 0.84, Lb * 0.86],
    [R0 * 0.72, Lb * 0.87],
    [R0 * 0.7, Lb * 0.9],
    [R0 * 0.9, Lb * 0.955],
    [R0 * 0.97, Lb * 0.98],
    [R0 * 0.95, Lb],
    [R0 * 0.42, Lb],
    [R0 * 0.42, Lb - 0.12],
    [0, Lb - 0.12],
  ];
  const barrel = lathe(
    P.map(([r, y]) => ({ y, r, colour: hex(colour) })),
    evenly(24),
  );
  barrel.deleteAttribute('color');
  // Laid along -z with its muzzle at the box's front, its trunnions on the axis, cocked up.
  barrel.rotateX(-Math.PI / 2);
  barrel.translate(0, 0, Lb - (zt - (-d / 2 + 0.02)));
  barrel.rotateX(raise);
  barrel.translate(0, yA, zt);
  add(g, barrel, barrelIron, 0, 0, 0);
  // The bore, dark just inside the muzzle.
  const bore = new THREE.CylinderGeometry(R0 * 0.42, R0 * 0.42, 0.01, 16).rotateX(Math.PI / 2);
  bore.translate(0, 0, -(Lb - 0.02) + (Lb - (zt - (-d / 2 + 0.02))));
  bore.rotateX(raise).translate(0, yA, zt);
  add(g, bore, made(INSIDE, Surface.Auto, 0.9), 0, 0, 0);
  // The trunnions through it into the cheeks' tops, and the iron cap-squares over them.
  const trunnion = new THREE.CylinderGeometry(0.05, 0.05, 2 * cheekX + cheekT * 0.8, 10);
  add(g, trunnion.rotateZ(Math.PI / 2), barrelIron, 0, yA, zt);
  for (const s of [-1, 1]) {
    box(g, cheekT + 0.012, 0.035, 0.16, s * cheekX, yA + 0.055, zt, iron());
    for (const dz of [-0.06, 0.06])
      add(
        g,
        new THREE.CylinderGeometry(0.018, 0.018, 0.02, 8),
        iron(),
        s * cheekX,
        yA + 0.08,
        zt + dz,
      );
    // An iron strap down the cheek's front.
    box(
      g,
      cheekT + 0.012,
      yt - yb - 0.1,
      0.02,
      s * cheekX,
      (yt + yb) / 2 - 0.02,
      cz0 + 0.02,
      iron(),
    );
  }
}

// ---------------------------------------------------------------- flags

/** The skull and crossbones, painted once on a canvas every pirate flag shares. */
let jollyRoger: THREE.CanvasTexture | null | undefined;

function skullTexture(): THREE.CanvasTexture | null {
  if (jollyRoger !== undefined) return jollyRoger;
  // Drawn on a canvas, which only a browser has.
  if (typeof document === 'undefined') return (jollyRoger = null);
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 168;
  const x = c.getContext('2d')!;
  x.fillStyle = '#1c1b1f';
  x.fillRect(0, 0, 256, 168);
  const bone = '#efe5cc';
  x.fillStyle = bone;
  x.strokeStyle = bone;
  x.lineCap = 'round';
  // The crossbones, behind the skull, knobbly at their ends.
  x.lineWidth = 16;
  for (const [a, b, e, f] of [
    [70, 46, 186, 140],
    [186, 46, 70, 140],
  ] as const) {
    x.beginPath();
    x.moveTo(a, b);
    x.lineTo(e, f);
    x.stroke();
    for (const [px, py] of [
      [a, b],
      [e, f],
    ] as const) {
      const dx = px < 128 ? -1 : 1;
      x.beginPath();
      x.arc(px + dx * 2, py - 9, 11, 0, Math.PI * 2);
      x.arc(px + dx * 6, py + 7, 11, 0, Math.PI * 2);
      x.fill();
    }
  }
  // The skull: its dome, its jaw, and the dark of its eyes, nose and teeth.
  x.beginPath();
  x.arc(128, 74, 44, 0, Math.PI * 2);
  x.fill();
  x.beginPath();
  x.roundRect(100, 92, 56, 42, 10);
  x.fill();
  x.fillStyle = '#1c1b1f';
  for (const ex of [110, 146]) {
    x.beginPath();
    x.ellipse(ex, 80, 13, 15, 0, 0, Math.PI * 2);
    x.fill();
  }
  x.beginPath();
  x.moveTo(128, 96);
  x.lineTo(121, 110);
  x.lineTo(135, 110);
  x.fill();
  x.fillRect(107, 119, 42, 3);
  for (const tx of [115, 124, 133, 142]) x.fillRect(tx, 114, 3, 18);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return (jollyRoger = texture);
}

let flagCloth: THREE.Material | null = null;

/**
 * A pirate flag `fw` long and `fh` deep flying from a pole at the origin out along +x, its
 * head at y = 0: black with the skull and crossbones, rippling, and ragged at its free end.
 */
function pirateFlag(fw: number, fh: number, seed: () => number): THREE.Mesh {
  const cols = 12;
  const rows = 6;
  const geometry = new THREE.PlaneGeometry(fw, fh, cols, rows);
  geometry.translate(fw / 2, -fh / 2, 0);
  const pos = geometry.attributes.position!;
  const phase = seed() * Math.PI * 2;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k);
    const y = pos.getY(k);
    // (Clamped: the hoist's x can come out a hair under 0, and a power of that is NaN.)
    const t = Math.min(1, Math.max(0, x / fw));
    // Ripples running out along it, deeper toward its free end, which droops a little and is
    // torn ragged.
    const z = 0.09 * t ** 0.7 * Math.sin((x / fw) * Math.PI * 2.4 + phase - y * 1.5);
    const ragged = t > 0.99 ? -(0.03 + 0.08 * Math.abs(Math.sin(y * 37 + phase))) * fw : 0;
    pos.setXYZ(k, x + ragged, y - 0.06 * fh * t * t, z);
  }
  geometry.computeVertexNormals();
  const texture = skullTexture();
  flagCloth ??= texture
    ? new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.95,
        side: THREE.DoubleSide,
      })
    : made(FLAG, Surface.Fabric, 0.95, 0, true);
  const flag = new THREE.Mesh(geometry, flagCloth);
  flag.castShadow = flag.receiveShadow = true;
  // (Painted on a canvas: drawn as it is, not merged.)
  flag.userData[KEEP_SEPARATE] = !!texture;
  return flag;
}

/** A turned timber pole from `y0` to `y1`, `r0` round at its foot and `r1` at its top. */
function pole(r0: number, r1: number, y0: number, y1: number, colour: number, seed: () => number) {
  const wood = hex(colour);
  const columns: Column[] = Array.from({ length: 10 }, (_, i) => ({
    a: (i / 10) * Math.PI * 2,
    out: 0.96 + seed() * 0.04,
    shade: 0.82 + seed() * 0.3,
  }));
  const turns: Turn[] = [{ y: y0, r: 0, colour: times(wood, 0.5) }];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const y = y0 + ((y1 - y0) * i) / n;
    turns.push({
      y,
      r: r0 + ((r1 - r0) * i) / n,
      colour: times(wood, 0.8 + 0.25 * (i / n)),
      relief: 1,
    });
  }
  turns.push({ y: y1, r: 0, colour: wood.clone().lerp(hex(0xd9c29a), 0.4) });
  return lathe(turns, columns);
}

/** How far a flagpole's flag flies out from the pole, for the pole's height. */
export const flagFly = (h: number): number => Math.min(1.1, h * 0.28);

/**
 * A flagpole, the box: a timber pole with an iron collar at its foot and a ball on its top,
 * and a pirate flag flying from it out over -x, beyond the box.
 */
export function flagpoleModel(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
): void {
  const r = Math.min(w, d) / 2;
  put(g, pole(r * 0.85, r * 0.55, -h / 2, h / 2 - 0.07, colour, seed), Surface.Auto);
  add(g, bevelCylinder(r * 0.98, r, 0.12, 10), iron(), 0, -h / 2 + 0.08, 0);
  add(g, new THREE.SphereGeometry(r * 0.75, 10, 8), iron(), 0, h / 2 - r * 0.6, 0);
  const flag = pirateFlag(flagFly(h), Math.min(0.7, h * 0.18), seed);
  flag.rotation.y = Math.PI;
  flag.position.set(-r * 0.4, h / 2 - 0.14, 0);
  g.add(flag);
}

// ---------------------------------------------------------------- the ship

/** How long a mast's lower yard is, for its ship's beam (the upper one is shorter). */
export const MAST_YARD = 1.45;
/** The beam a mast's yards are sized for when it finds no ship under it. */
export const MAST_BEAM = 2.4;
/** How tall a ship's bulwarks stand above its deck (the colliders round it). */
const BULWARK = 0.7;
/** How broad a ship is at its deck, for its sides' tumblehome: a share of its beam. */
const TUMBLE = 0.98;
/**
 * Where a mast's shrouds come down to the ship's sides, along it from the mast toward the stern:
 * about it, and short of a ladder's gap a metre aft of it.
 */
const SHROUDS = [-0.6, -0.25, 0.1];

/** Which way a mast's ship lies: along x or z, which way along it the bow is, and its beam. */
export interface ShipLine {
  alongX: boolean;
  bow: 1 | -1;
  beam: number;
}

/**
 * A sail `top` wide at its head and `bottom` at its foot, `tall` tall, hanging from y = 0 down
 * across x, bellying out toward -z by `belly`: red and cream stripes, painted darker low down
 * and in its folds, its foot torn ragged.
 */
function sail(
  top: number,
  bottom: number,
  tall: number,
  belly: number,
  seed: () => number,
): THREE.BufferGeometry {
  const stripes = 6;
  const rows = 7;
  const q = new Quads();
  const tears = Array.from({ length: stripes * 2 + 1 }, () => seed() * 0.07 * tall);
  const red = hex(SAIL_RED);
  const cream = hex(SAIL_CREAM);
  const point = (u: number, v: number, foot: number) => {
    const half = (top + (bottom - top) * v) / 2;
    // The foot curves up toward the corners, where it is tied.
    const y = -v * tall + 0.12 * tall * (2 * u - 1) ** 2 * v ** 3 + foot * v ** 4;
    const out =
      belly * Math.sin(Math.PI * u) ** 0.8 * Math.sin(Math.PI * Math.min(1, v * 0.85 + 0.08));
    return new THREE.Vector3(-half + 2 * half * u, y, -out);
  };
  for (let s = 0; s < stripes; s++) {
    const base = s % 2 === 0 ? red : cream;
    for (let c = 0; c < 2; c++) {
      const i = s * 2 + c;
      const u0 = i / (stripes * 2);
      const u1 = (i + 1) / (stripes * 2);
      for (let k = 0; k < rows; k++) {
        const v0 = k / rows;
        const v1 = (k + 1) / rows;
        const ps = [
          point(u0, v0, tears[i]!),
          point(u1, v0, tears[i + 1]!),
          point(u1, v1, tears[i + 1]!),
          point(u0, v1, tears[i]!),
        ];
        // Each fold of it a shade off, and the lower parts in the shade of the belly.
        const cs = [
          [u0, v0],
          [u1, v0],
          [u1, v1],
          [u0, v1],
        ].map(([u, v]) =>
          times(base, (0.95 - 0.22 * v! ** 1.5) * (0.94 + 0.08 * Math.cos(u! * Math.PI * 12))),
        );
        q.flat(ps, new THREE.Vector3(0, 0, -1), cs);
      }
    }
  }
  const geometry = q.geometry();
  // Smooth across the cloth, the stripes still sharp.
  geometry.deleteAttribute('normal');
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A ship's mast, the box: a tapering timber pole bound with iron, a crow's nest (a barrel) high
 * on it, two yards across the ship with striped sails bellying toward the bow, a black flag at
 * its head, and the shrouds down to the ship's sides (see `ShipLine`; with no ship found, the
 * yards run along x).
 */
export function mastModel(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
  ship: ShipLine | null,
): void {
  const r = Math.min(w, d) / 2;
  const foot = -h / 2;
  const top = h / 2;
  put(g, pole(r * 0.95, r * 0.55, foot, top, colour, seed), Surface.Auto);
  for (const f of [0.08, 0.3, 0.52])
    add(
      g,
      bevelCylinder(r * (1.02 - f * 0.4), r * (1.02 - f * 0.4), 0.06, 14),
      iron(),
      0,
      foot + f * h,
      0,
    );
  // Everything across the ship is built along x and turned to lie across it.
  const rig = new THREE.Group();
  g.add(rig);
  const acrossX = ship ? !ship.alongX : true;
  const bow = ship?.bow ?? -1;
  // Turned so its -z (where the sails belly) is toward the bow.
  rig.rotation.y = acrossX ? (bow > 0 ? Math.PI : 0) : bow > 0 ? -Math.PI / 2 : Math.PI / 2;
  const beam = ship?.beam ?? MAST_BEAM;
  const yards = [
    { y: foot + h * 0.62, length: beam * MAST_YARD, sail: h * 0.3 },
    { y: foot + h * 0.93, length: beam * 1.1, sail: h * 0.18 },
  ];
  for (const yard of yards) {
    const spar = pole(0.065, 0.035, 0, yard.length / 2, colour, seed);
    for (const side of [-1, 1]) {
      const half = spar.clone().rotateZ((side * Math.PI) / 2);
      const m = put(rig, half, Surface.Auto);
      m.position.y = yard.y;
    }
    // The sling binding it to the mast.
    add(rig, bevelCylinder(r * 0.9, r * 0.9, 0.12, 12), iron(), 0, yard.y, 0);
    const cloth = sail(yard.length - 0.35, yard.length - 0.1, yard.sail, yard.sail * 0.3, seed);
    const m = put(rig, cloth.translate(0, yard.y - 0.08, -0.07), Surface.Fabric, true, true);
    m.receiveShadow = true;
  }
  // The crow's nest, between the yards: a barrel open at the top, round the mast.
  const nest = new THREE.Group();
  nest.position.y = foot + h * 0.7;
  g.add(nest);
  barrelModel(nest, 0.8, 0.5, 0.8, 0x8a5a32, seed, 0.42);
  // The flag at its head, flying toward the bow.
  const flag = pirateFlag(0.8, 0.5, seed);
  flag.rotation.y = acrossX ? (bow > 0 ? -Math.PI / 2 : Math.PI / 2) : bow > 0 ? 0 : Math.PI;
  flag.position.set(0, top - 0.04, 0);
  g.add(flag);
  // The shrouds: three a side from under the nest down to the ship's sides.
  if (ship) {
    const ropeMat = made(0x4a3a28, Surface.Auto, 0.85);
    for (const side of [-1, 1])
      for (const aft of SHROUDS) {
        const from = new THREE.Vector3(side * r, nest.position.y - 0.32, 0);
        const to = new THREE.Vector3(side * (beam / 2 - 0.05), foot + BULWARK, aft);
        rod(rig, from, to, 0.014, ropeMat);
      }
  }
}

/** Where a hull's bulwarks stand, and what passes through them, in its own frame. */
export interface HullFittings {
  /** The stretches along each side (by its sign along x) the bulwarks run, as [from, to] in z. */
  sides: Record<number, [number, number][]>;
  /** Whether there is a bulwark across its stern (+z), and across its front (-z). */
  stern: boolean;
  front: boolean;
  /**
   * Gun ports: where a cannon's muzzle comes out through a side (-1 or 1): the middle of the
   * port along z, and how wide it is (the bulwark is cut down to a sill there, gap or not).
   */
  ports: { side: number; z: number; width: number }[];
  /** Where the mast stands along it, for the chain plates of its shrouds. */
  mast: number | null;
}

/** How a stretch of bulwark stands: whole, cut down to a gun port's sill, or not at all. */
type Wall = 'whole' | 'port' | 'none';

/**
 * A ship's hull fitted to the box, its bow to the front: planked strakes curving in from the
 * deck to the keel, each with a worn light edge and a dark seam, a dark wale along it studded
 * with iron, and a square stern with its cabin windows; in front of the box, the bow sweeping in
 * to the stem, with the bowsprit out over it. On the deck (the box's top), planked bulwarks with
 * a cap rail round it where `fit` says, open for a ladder and cut down for gun ports, and a rail
 * across the front of the deck where the bow begins. The bow and the bulwarks reach outside the
 * box, which is the deck players walk on and the hull they bump into.
 */
export function hullModel(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
  fit: HullFittings,
): void {
  const wood = hex(colour);
  const deckY = h / 2;
  const keelY = -h / 2;
  const topY = deckY + BULWARK;
  const Lb = Math.min(1.7, w * 0.7);
  const front = -d / 2;
  const stemZ = front - Lb;
  const clamp = (t: number) => Math.min(1, Math.max(0, t));
  // How far out in front of the box, as a share of the bow's length; and how far into the
  // stern's last metre or so, where the hull tucks up under its counter.
  const ahead = (z: number) => clamp((front - z) / Lb);
  const tuck = Math.min(1.3, d * 0.2);
  const astern = (z: number) => clamp((z - (d / 2 - tuck)) / tuck);
  /** Where the stern's transom starts, over the counter's curve up from the keel. */
  const counterY = deckY - Math.min(0.95, (deckY - keelY) * 0.42);
  // Narrowing to the stem, and a little to the transom, rounded off in plan.
  const halfDeck = (z: number) =>
    Math.max(0.07, (w / 2) * Math.max(0, 1 - ahead(z) ** 2.2) ** 0.55) *
    (1 - 0.06 * astern(z) ** 2);
  const bottom = (z: number) =>
    Math.max(
      keelY + (deckY - 0.5 - keelY) * ahead(z) ** 1.5,
      keelY + (counterY - keelY) * astern(z) ** 1.6,
    );
  const waleAt = (z: number) => bottom(z) + (deckY - bottom(z)) * 0.72;
  // The sheer: the rail rising toward the stern, and toward the bow and on out along it.
  const sheer = (z: number) =>
    0.5 * clamp((z - (d / 2 - 1.6)) / 1.6) ** 2 +
    0.12 * clamp((front + 1.6 - z) / 1.6) ** 2 +
    0.3 * ahead(z) ** 1.4;
  const topAt = (z: number) => topY + sheer(z);
  // Broadest at the wale, out to the box's sides, coming in a little above it (the
  // tumblehome) to the deck and a little further to the rail; below it, round in to the keel.
  const halfAt = (z: number, y: number) => {
    const hd = halfDeck(z);
    if (y >= deckY) return hd * (TUMBLE - 0.02 * Math.min(1, (y - deckY) / BULWARK));
    const wy = waleAt(z);
    if (y >= wy) return hd * (1 - (1 - TUMBLE) * ((y - wy) / (deckY - wy)) ** 1.6);
    const s = Math.max(0, (y - bottom(z)) / (wy - bottom(z)));
    return hd * (1 - 0.7 * (1 - s) ** 2.4);
  };
  const point = (z: number, y: number, side: number) =>
    new THREE.Vector3(side * halfAt(z, y), y, z);
  const normalAt = (z: number, y: number, side: number) => {
    const e = 0.01;
    const dy = (halfAt(z, y + e) - halfAt(z, y - e)) / (2 * e);
    const dz = (halfAt(z + e, y) - halfAt(z - e, y)) / (2 * e);
    // Out of the side: square to its slope up it and along it.
    return new THREE.Vector3(side, -dy, -dz).normalize();
  };

  // The strakes' seams: below the deck as shares of the way up from the keel (so they sweep up
  // to the stem with it), over it at heights.
  const below = Math.max(3, Math.round((deckY - keelY) / 0.26));
  const seams: ((z: number) => number)[] = [];
  for (let i = 0; i <= below; i++) seams.push((z) => bottom(z) + ((deckY - bottom(z)) * i) / below);
  const over = 3;
  const capT = 0.07;
  for (let i = 1; i <= over; i++)
    seams.push((z) => deckY + ((BULWARK + sheer(z) - capT) * i) / over);

  // Along it: from the stern to the front of the box every half metre or so, with the ends of
  // the bulwarks' stretches and the gun ports' sides among them; then out along the bow.
  const stops = new Set<number>();
  const n = Math.max(4, Math.round(d / 0.45));
  for (let i = 0; i <= n; i++) stops.add(d / 2 - (d * i) / n);
  // (Where the sheer starts to rise toward each end, where the bulwarks are kept apart.)
  const aftRise = d / 2 - 1.6;
  const foreRise = front + 1.6;
  if (foreRise < aftRise) stops.add(aftRise).add(foreRise);
  for (const spans of Object.values(fit.sides)) for (const [a, b] of spans) stops.add(a).add(b);
  for (const p of fit.ports) stops.add(p.z - p.width / 2).add(p.z + p.width / 2);
  const stations = [...stops]
    .filter((z) => z >= front - 1e-6 && z <= d / 2 + 1e-6)
    .sort((a, b) => b - a);
  const bow = Array.from({ length: 8 }, (_, i) => front - (Lb * (i + 1)) / 8);
  const along = [...stations, ...bow];
  /** How the bulwark stands along a side between z0 and z1. */
  const wall = (side: number, z0: number, z1: number): Wall => {
    const mid = (z0 + z1) / 2;
    if (mid < front) return 'whole';
    if (fit.ports.some((p) => p.side === side && Math.abs(mid - p.z) < p.width / 2)) return 'port';
    return (fit.sides[side] ?? []).some(([a, b]) => mid > a - 1e-6 && mid < b + 1e-6)
      ? 'whole'
      : 'none';
  };
  // (A gun port's sill is the first of the bulwark's seams.)
  const wallTop = (state: Wall, z: number) =>
    state === 'whole' ? topAt(z) : state === 'port' ? seams[below + 1]!(z) : deckY;

  // A plank's tone, by its strake and which length of it: the joints staggered strake to strake.
  const tones = new Map<string, number>();
  const tone = (plank: number, z: number) => {
    const key = `${plank}:${Math.floor((z + plank * 0.7) / 1.7)}`;
    if (!tones.has(key)) tones.set(key, 0.82 + seed() * 0.3);
    return tones.get(key)!;
  };
  // Each strake in three bands: a dark seam at its foot, the plank, and its worn top edge.
  const BANDS = [0, 0.14, 0.84, 1];
  const SHADES = [0.42, 0.88, 1, 1.22];
  const bandShades = (b: number, t: number) =>
    [SHADES[b]!, SHADES[b]!, SHADES[b + 1]!, SHADES[b + 1]!].map((s) => times(wood, s * t));

  // Kept apart, so each part's bounds stay snug: the hull under the deck, the bow, and each
  // bulwark, in three along the side (its waist, and where it rises toward each end).
  const parts = new Map<string, Quads>();
  const part = (key: string) => {
    if (!parts.has(key)) parts.set(key, new Quads());
    return parts.get(key)!;
  };
  const sidePart = (side: number, z0: number, z1: number) => {
    const mid = (z0 + z1) / 2;
    return part(`side ${side} ${mid > aftRise ? 'aft' : mid < foreRise ? 'fore' : 'waist'}`);
  };
  for (const side of [-1, 1])
    for (let i = 0; i + 1 < along.length; i++) {
      const [z0, z1] = [along[i]!, along[i + 1]!];
      const state = wall(side, z0, z1);
      for (let k = 0; k + 1 < seams.length; k++) {
        const high = k >= below;
        if (high && seams[k + 1]!(z0) > wallTop(state, z0) + 1e-6) continue;
        const into =
          z0 <= front + 1e-6 ? part('bow') : high ? sidePart(side, z0, z1) : part('hull');
        const t = tone(k, (z0 + z1) / 2);
        for (let b = 0; b + 1 < BANDS.length; b++) {
          const ys = (z: number) => {
            const lo = seams[k]!(z);
            const hi = seams[k + 1]!(z);
            return [lo + (hi - lo) * BANDS[b]!, lo + (hi - lo) * BANDS[b + 1]!] as const;
          };
          const [a0, a1] = ys(z0);
          const [c0, c1] = ys(z1);
          const corners: [number, number][] = [
            [z0, a0],
            [z1, c0],
            [z1, c1],
            [z0, a1],
          ];
          into.quad(
            corners.map(([z, y]) => point(z, y, side)),
            corners.map(([z, y]) => normalAt(z, y, side)),
            bandShades(b, t),
          );
        }
      }
    }
  // The flat bottom between the sides along the keel.
  for (let i = 0; i + 1 < along.length; i++) {
    const [z0, z1] = [along[i]!, along[i + 1]!];
    const [y0, y1] = [bottom(z0), bottom(z1)];
    (z0 <= front + 1e-6 ? part('bow') : part('hull')).flat(
      [point(z0, y0, -1), point(z1, y1, -1), point(z1, y1, 1), point(z0, y0, 1)],
      new THREE.Vector3(0, -1, 0),
      times(wood, 0.35),
    );
  }
  // The square stern: strakes across it, and its bulwark if it has one.
  for (let k = 0; k + 1 < seams.length; k++) {
    const high = k >= below;
    if (high && !fit.stern) continue;
    const t = tone(k, d);
    for (let b = 0; b + 1 < BANDS.length; b++) {
      const lo = seams[k]!(d / 2);
      const hi = seams[k + 1]!(d / 2);
      const y0 = lo + (hi - lo) * BANDS[b]!;
      const y1 = lo + (hi - lo) * BANDS[b + 1]!;
      (high ? part('stern') : part('hull')).flat(
        [point(d / 2, y0, -1), point(d / 2, y0, 1), point(d / 2, y1, 1), point(d / 2, y1, -1)],
        new THREE.Vector3(0, 0, 1),
        bandShades(b, t),
      );
    }
  }

  // The bulwarks' insides and the cap rails along their tops, from points along the outside of
  // the planking at deck level (in order) and the way out of it at each.
  const thick = 0.08;
  const capTone = wood.clone().lerp(hex(0xc89a62), 0.35);
  const insideTone = wood.clone().lerp(hex(0xa77a4c), 0.3);
  const up = (p: THREE.Vector3, y: number) => new THREE.Vector3(p.x, y, p.z);
  const UP = new THREE.Vector3(0, 1, 0);
  const DOWN = new THREE.Vector3(0, -1, 0);
  const lining = (
    q: Quads,
    line: THREE.Vector3[],
    outs: THREE.Vector3[],
    top: (z: number) => number,
    capped: boolean,
  ) => {
    for (let i = 0; i + 1 < line.length; i++) {
      const [p0, p1] = [line[i]!, line[i + 1]!];
      const [n0, n1] = [outs[i]!, outs[i + 1]!];
      const in0 = p0.clone().addScaledVector(n0, -thick);
      const in1 = p1.clone().addScaledVector(n1, -thick);
      const inward = n0.clone().negate();
      const [t0, t1] = [top(p0.z), top(p1.z)];
      const [c0, c1] = capped ? [t0 - capT, t1 - capT] : [t0, t1];
      // The inside face, darker down by the deck.
      q.flat([up(in0, deckY), up(in1, deckY), up(in1, c1), up(in0, c0)], inward, [
        times(insideTone, 0.6),
        times(insideTone, 0.6),
        insideTone,
        insideTone,
      ]);
      if (!capped) {
        // A gun port's sill: the planking's top, and the rail beyond the port's sides.
        q.flat([up(p0, t0), up(p1, t1), up(in1, t1), up(in0, t0)], UP, times(capTone, 0.9));
        continue;
      }
      // The cap rail: a little wider than the bulwark, its top and its edges.
      const o0 = p0.clone().addScaledVector(n0, 0.03);
      const o1 = p1.clone().addScaledVector(n1, 0.03);
      const i0 = in0.clone().addScaledVector(n0, -0.03);
      const i1 = in1.clone().addScaledVector(n1, -0.03);
      q.flat([up(o0, t0), up(o1, t1), up(i1, t1), up(i0, t0)], UP, times(capTone, 1.1));
      q.flat([up(o0, c0), up(o1, c1), up(o1, t1), up(o0, t0)], n0, capTone);
      q.flat([up(i0, c0), up(i1, c1), up(i1, t1), up(i0, t0)], inward, times(capTone, 0.85));
      q.flat([up(o0, c0), up(o1, c1), up(i1, c1), up(i0, c0)], DOWN, times(capTone, 0.5));
    }
  };
  /** The cut end of a bulwark at `z` on a side, from `y0` to `y1`, facing along `towards`. */
  const cutEnd = (q: Quads, z: number, side: number, y0: number, y1: number, towards: number) => {
    const out = point(z, deckY, side);
    const inn = out.clone().addScaledVector(normalAt(z, deckY, side), -thick);
    q.flat(
      [up(out, y0), up(inn, y0), up(inn, y1), up(out, y1)],
      new THREE.Vector3(0, 0, towards),
      times(capTone, 0.8),
    );
  };
  for (const side of [-1, 1]) {
    const out = new THREE.Vector3(side, 0, 0);
    for (let i = 0; i + 1 < stations.length; i++) {
      const [z0, z1] = [stations[i]!, stations[i + 1]!];
      const q = sidePart(side, z0, z1);
      const state = wall(side, z0, z1);
      if (state !== 'none')
        lining(
          q,
          [point(z0, deckY, side), point(z1, deckY, side)],
          [out, out],
          (z) => wallTop(state, z),
          state === 'whole',
        );
      // Where it steps down (or up) to the next stretch, its end.
      const next = i + 2 < stations.length ? wall(side, z1, stations[i + 2]!) : 'whole';
      const [a, b] = [wallTop(state, z1), wallTop(next, z1)];
      if (Math.abs(a - b) > 1e-6)
        cutEnd(q, z1, side, Math.min(a, b), Math.max(a, b), a > b ? -1 : 1);
      if (i === 0 && state !== 'whole' && fit.stern)
        cutEnd(q, z0, side, wallTop(state, z0), topAt(z0), -1);
    }
    // Round the bow, from the box's front out to the stem.
    const line = [front, ...bow].map((z) => point(z, deckY, side));
    const outs = line.map((_, i) => {
      const a = line[Math.max(0, i - 1)]!;
      const b = line[Math.min(line.length - 1, i + 1)]!;
      const along = b.clone().sub(a);
      return new THREE.Vector3(-along.z, 0, along.x).multiplyScalar(side).normalize();
    });
    lining(part('bow rail'), line, outs, topAt, true);
  }
  if (fit.stern) {
    const back = new THREE.Vector3(0, 0, 1);
    lining(
      part('stern'),
      [point(d / 2, deckY, 1), point(d / 2, deckY, -1)],
      [back, back],
      topAt,
      true,
    );
  }
  for (const q of parts.values()) if (!q.empty) put(g, q.geometry(), Surface.Auto);

  // The deck: planks along the ship over the box, and on over the bow to the stem, out to the
  // bulwarks' insides.
  const deck = mat(DECK, 0.85);
  const plankT = 0.06;
  const rim = (z: number) => Math.max(0.02, halfDeck(z) * TUMBLE - thick);
  const deckLine = [d / 2 - 0.01, ...along.filter((z) => z < d / 2 - 0.01)];
  const deckPlan = new THREE.Shape(
    [
      ...deckLine.map((z) => [-rim(z), z]),
      ...deckLine
        .slice()
        .reverse()
        .map((z) => [rim(z), z]),
    ].map(([x, z]) => new THREE.Vector2(x, -z!)),
  );
  // Drawn in x and -z, and stood up along y.
  const boards = new THREE.ExtrudeGeometry(deckPlan, { depth: plankT, bevelEnabled: false });
  add(g, boards.rotateX(-Math.PI / 2), deck, 0, deckY - plankT, 0);

  // The wale: a dark band proud of the planking along each side, studded with iron.
  const wale = new Quads();
  const dark = times(wood, 0.45);
  const proud = 0.05;
  const band = 0.07;
  for (const side of [-1, 1])
    for (let i = 0; i + 1 < along.length; i++) {
      const [z0, z1] = [along[i]!, along[i + 1]!];
      if (z1 < front - Lb * 0.8) continue;
      const at = (z: number, dy: number, by: number) => {
        const y = waleAt(z) + dy;
        return point(z, y, side).addScaledVector(normalAt(z, y, side), by);
      };
      const n = normalAt(z0, waleAt(z0), side);
      wale.flat(
        [at(z0, -band, proud), at(z1, -band, proud), at(z1, band, proud), at(z0, band, proud)],
        n,
        [dark, dark, times(dark, 1.5), times(dark, 1.5)],
      );
      wale.flat(
        [at(z0, band, 0), at(z1, band, 0), at(z1, band, proud), at(z0, band, proud)],
        UP,
        times(dark, 1.7),
      );
      wale.flat(
        [at(z0, -band, 0), at(z1, -band, 0), at(z1, -band, proud), at(z0, -band, proud)],
        DOWN,
        times(dark, 0.6),
      );
    }
  put(g, wale.geometry(), Surface.Auto);
  for (const side of [-1, 1])
    for (let z = d / 2 - 0.3; z > front; z -= 0.6) {
      const y = waleAt(z);
      const p = point(z, y, side).addScaledVector(normalAt(z, y, side), proud + 0.008);
      add(
        g,
        new THREE.CylinderGeometry(0.022, 0.026, 0.02, 8).rotateZ(Math.PI / 2),
        iron(),
        p.x,
        p.y,
        p.z,
      );
    }
  // The chain plates the mast's shrouds are made fast to: iron straps up the sides to the rail.
  if (fit.mast !== null)
    for (const side of [-1, 1])
      for (const aft of SHROUDS) {
        const z = fit.mast + aft;
        if (wall(side, z - 0.03, z + 0.03) === 'none') continue;
        const y0 = waleAt(z) + band;
        const y1 = topAt(z) - capT;
        const x = halfAt(z, (y0 + y1) / 2) + 0.015;
        box(g, 0.03, y1 - y0, 0.05, side * x, (y0 + y1) / 2, z, iron());
      }
  // The stern's cabin windows in a row across its transom, under the deck, lit warm, between
  // a moulding under the deck's line and another along the top of the counter; and a lantern
  // on the taffrail over them.
  const frame = mat(TIMBER, 0.75);
  const across = 2 * halfAt(d / 2, deckY - 0.3) - 0.36;
  const panes = across > 1.6 ? 3 : 2;
  const wy = (deckY - 0.16 + counterY + 0.14) / 2;
  const wh = Math.min(0.42, deckY - counterY - 0.5);
  const ww = Math.min(0.36, across / panes - 0.16);
  for (let i = 0; i < panes; i++) {
    const x = (i - (panes - 1) / 2) * (across / panes);
    box(g, ww + 0.12, wh + 0.12, 0.05, x, wy, d / 2 + 0.025, frame);
    add(g, new THREE.BoxGeometry(ww, wh, 0.02), litGlass(), x, wy, d / 2 + 0.055);
    // (The bars run a little past the glass into the frame.)
    box(g, 0.035, wh + 0.03, 0.03, x, wy, d / 2 + 0.07, frame);
    box(g, ww + 0.03, 0.035, 0.03, x, wy, d / 2 + 0.07, frame);
  }
  for (const y of [deckY - 0.08, counterY + 0.05])
    box(g, 2 * halfAt(d / 2, y) - 0.04, 0.09, 0.06, 0, y, d / 2 + 0.03, mat(TIMBER, 0.75));
  sternLantern(g, d / 2 - thick / 2, topAt(d / 2));
  // The stem post up the front of the bow, and the bowsprit out over it.
  const stem = slab(
    [
      [stemZ + 0.16, bottom(stemZ + 0.16) - 0.02],
      [stemZ - 0.08, bottom(stemZ) + 0.05],
      [stemZ - 0.14, topAt(stemZ) + 0.18],
      [stemZ + 0.1, topAt(stemZ) + 0.18],
    ],
    -0.08,
    0.08,
    0.02,
  );
  put(g, coloured(stem, times(wood, 0.6)), Surface.Auto);
  const sprit = pole(0.08, 0.045, 0, 1.7, colour, seed).rotateX(-Math.PI / 2 + 0.38);
  put(g, sprit.translate(0, topAt(stemZ) - 0.02, stemZ + 0.06), Surface.Auto);
  // A rail across the front of the deck where the bow begins, if the deck stops there.
  if (fit.front) {
    const z = front + 0.04;
    const span = 2 * rim(front) - 0.02;
    box(g, span, 0.08, 0.08, 0, topAt(front) - 0.06, z, frame);
    box(g, span, 0.06, 0.08, 0, deckY + 0.03, z, frame);
    const count = Math.max(3, Math.round(span / 0.22));
    const tall = BULWARK + sheer(front) - 0.16;
    for (let i = 0; i < count; i++) {
      const x = -span / 2 + 0.06 + ((span - 0.12) * i) / (count - 1);
      add(g, bevelCylinder(0.026, 0.032, tall), mat(CARRIAGE, 0.75), x, deckY + 0.06 + tall / 2, z);
    }
  }
}

/**
 * A ship's stern lantern on the taffrail at `z`, its foot at `y`: an iron post up to a big
 * lantern, an iron cage round warm glass under a pointed roof, with a ring on top.
 */
function sternLantern(g: THREE.Object3D, z: number, y: number): void {
  const ironwork = iron();
  add(g, bevelBox(0.14, 0.04, 0.14), ironwork, 0, y + 0.02, z);
  add(g, bevelCylinder(0.03, 0.035, 0.3, 8), ironwork, 0, y + 0.19, z);
  const ly = y + 0.5;
  add(g, new THREE.CylinderGeometry(0.11, 0.09, 0.26, 6), litGlass(), 0, ly, z);
  add(g, bevelCylinder(0.13, 0.13, 0.04, 6), ironwork, 0, ly - 0.15, z);
  add(g, bevelCylinder(0.13, 0.13, 0.035, 6), ironwork, 0, ly + 0.145, z);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    add(
      g,
      new THREE.BoxGeometry(0.02, 0.28, 0.02),
      ironwork,
      Math.cos(a) * 0.105,
      ly,
      z + Math.sin(a) * 0.105,
    );
  }
  add(g, new THREE.ConeGeometry(0.15, 0.16, 6), ironwork, 0, ly + 0.24, z);
  add(g, new THREE.TorusGeometry(0.035, 0.009, 6, 10), ironwork, 0, ly + 0.35, z);
}

// ---------------------------------------------------------------- roofs

/** The walls a roof stands on, in its own frame: the outer faces of their footprint. */
export interface RoofWalls {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/**
 * A steep pitched roof over a building, the box from the eaves up to the ridge, which runs along
 * its long side: rows of chunky shingles in `colour`, each its own shade, a little askew, each
 * row lying over the one under it; heavy timber barge boards down the gable ends, shod with
 * iron, a ridge beam along the top, and the rafters' ends out under the overhang. Each gable is
 * cream plaster in a frame of dark timber with a round window, standing a little proud of the
 * end wall under it, and along the eaves wall plates close the gap over the side walls. Tie
 * beams cross the room under it. `walls` (their outer faces) are where the overhang begins.
 */
export function gableRoofModel(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
  walls: RoofWalls | null,
): void {
  // Built with the ridge along x, and turned a quarter if it runs along z: then the frame's x is
  // the box's -z, and its z the box's x.
  const alongX = w >= d;
  const frame = new THREE.Group();
  frame.rotation.y = alongX ? 0 : Math.PI / 2;
  g.add(frame);
  const L = alongX ? w : d;
  const D = alongX ? d : w;
  const H = h;
  const inner = walls
    ? alongX
      ? walls
      : { x0: -walls.z1, x1: -walls.z0, z0: walls.x0, z1: walls.x1 }
    : { x0: -L / 2 + 0.4, x1: L / 2 - 0.4, z0: -D / 2 + 0.4, z1: D / 2 - 0.4 };
  const bargeT = 0.13;
  const tab = 0.05;
  const sark = 0.04;
  const cap = 0.16;
  // The roof's outer line (the shingles' top): from the eaves, high enough over the box's foot
  // for the layers under it, up to the ridge beam.
  const yRidge = H / 2 - cap * 0.5;
  const guess = Math.cos(Math.atan2(H, D / 2));
  const yEave = -H / 2 + (tab + sark) / guess + 0.01;
  const slope = Math.atan2(yRidge - yEave, D / 2);
  const cos = Math.cos(slope);
  const outerY = (z: number) => yEave + (D / 2 - Math.abs(z)) * Math.tan(slope);
  // The underside of the boards under the shingles.
  const underY = (z: number) => Math.max(-H / 2, outerY(z) - (tab + sark) / cos);
  const timber = made(TIMBER, Surface.Auto, 0.8);
  const beams = mat(TIMBER, 0.8);
  // The boards, a slab down each slope between the barge boards.
  const sx0 = -L / 2 + bargeT;
  const sx1 = L / 2 - bargeT;
  for (const s of [-1, 1]) {
    const e = (s * D) / 2;
    const outline: [number, number][] = [
      [e, outerY(e) - tab / cos],
      [0, outerY(0) - tab / cos],
      [0, underY(0)],
      [e, underY(e)],
    ];
    add(frame, slab(outline, sx0, sx1), mat(0x7a5232, 0.8), 0, 0, 0);
  }
  // The shingles, row upon row from the eaves to the ridge, each row's foot kicked up onto the
  // row under it, the joints of every other row halfway along the ones under them.
  const base = hex(colour);
  const S = D / 2 / cos;
  const rows = Math.max(3, Math.round(S / 0.25));
  const step = S / rows;
  const kick = Math.atan2(tab * 0.9, step * 1.3);
  for (const s of [-1, 1]) {
    const tabs: THREE.BufferGeometry[] = [];
    for (let k = 0; k < rows; k++) {
      const a0 = k * step;
      const length = Math.min(step * 1.35, S - a0 - 0.02);
      const widths: number[] = [];
      let left = sx1 - sx0 - 0.02;
      if (k % 2) widths.push(0.16 + seed() * 0.06);
      left -= widths[0] ?? 0;
      while (left > 1e-6) {
        const wide = 0.3 + seed() * 0.12;
        widths.push(left - wide < 0.14 ? left : wide);
        left -= widths[widths.length - 1]!;
      }
      let x = sx0 + 0.01;
      for (const wide of widths) {
        const geometry = bevelBox(wide - 0.012, tab, length, 0.012);
        // Each a little askew, but for the bottom row, which lies flat on the boards (askew by
        // a hair, its underside would all but lie in the plane of theirs).
        const tilt = slope - (k === 0 ? 0 : kick + (seed() - 0.5) * 0.03);
        geometry.rotateX(s > 0 ? tilt : Math.PI - tilt);
        const z = s * (D / 2 - (a0 + length / 2) * cos);
        const y = outerY(z) - tab / 2 / cos + (k === 0 ? 0 : tab * 0.45);
        geometry.translate(x + wide / 2, y, z);
        // Lighter up the slope, where the sun has bleached them.
        const shade = (0.78 + seed() * 0.34) * (0.86 + 0.18 * (k / rows));
        const c = base
          .clone()
          .offsetHSL((seed() - 0.5) * 0.03, 0, 0)
          .multiplyScalar(shade);
        tabs.push(coloured(geometry, c));
        x += wide;
      }
    }
    put(frame, mergeGeometries(tabs), Surface.Auto);
    for (const t of tabs) t.dispose();
  }
  // The ridge beam along the top, over the top rows' heads.
  box(frame, L - 0.02, cap, cap * 1.2, 0, H / 2 - cap / 2, 0, beams);
  // The barge boards: down each gable from the ridge to the eaves, standing over the shingles,
  // with an iron shoe at each foot and a strap over the peak.
  const depth = 0.24;
  for (const end of [-1, 1]) {
    const x0 = end < 0 ? -L / 2 : L / 2 - bargeT;
    for (const s of [-1, 1]) {
      const e = (s * D) / 2;
      const outline: [number, number][] = [
        [e, Math.max(-H / 2, outerY(e) + 0.04 - depth)],
        [e, outerY(e) + 0.04],
        [0, outerY(0) + 0.04],
        [0, outerY(0) + 0.04 - depth],
      ];
      add(frame, slab(outline, x0, x0 + bargeT, 0.02), timber, 0, 0, 0);
      const foot = e - s * 0.12;
      const y = Math.max(-H / 2 + 0.08, outerY(foot) - 0.06);
      box(frame, bargeT + 0.016, 0.16, 0.16, x0 + bargeT / 2, y, foot, iron());
    }
    box(frame, bargeT + 0.016, 0.12, 0.3, x0 + bargeT / 2, outerY(0) - 0.12, 0, iron());
  }
  // The gables, standing on the end walls a little proud of them: cream plaster in a frame of
  // dark timber, with a round window.
  const plaster = made(PLASTER, Surface.Wall, 0.9);
  const { z0: zw0, z1: zw1 } = inner;
  const peak = underY(0);
  const tall = peak + H / 2;
  const jetty = 0.03;
  const gableT = 0.16;
  for (const end of [-1, 1]) {
    const x0 = end < 0 ? inner.x0 - jetty : inner.x1 + jetty - gableT;
    const outline: [number, number][] = [
      [zw0, -H / 2],
      [zw1, -H / 2],
      [zw1, underY(zw1)],
      [0, peak],
      [zw0, underY(zw0)],
    ];
    add(frame, slab(outline, x0, x0 + gableT), plaster, 0, 0, 0);
    // The timbers on its outside: a tie beam along its foot, a king post up its middle and a
    // strut out from it either side.
    const face = end < 0 ? x0 : x0 + gableT;
    const proud = (o: [number, number][]) =>
      add(
        frame,
        coloured(
          slab(o, Math.min(face, face + end * 0.035), Math.max(face, face + end * 0.035)),
          times(hex(TIMBER), 0.95),
        ),
        painted(Surface.Auto),
        0,
        0,
        0,
      );
    const beam = -H / 2 + 0.16;
    proud([
      [zw0, -H / 2],
      [zw1, -H / 2],
      [zw1, beam],
      [zw0, beam],
    ]);
    // The round window, up between the struts, the king post stopping under it and going on
    // over it.
    const wy = beam + tall * 0.42;
    const wr = Math.min(0.2, tall * 0.11);
    const post = (y0: number, y1: number) =>
      y1 - y0 > 0.05 &&
      proud([
        [-0.07, y0],
        [0.07, y0],
        [0.07, y1],
        [-0.07, y1],
      ]);
    if (wr > 0.08) {
      post(beam, wy - wr - 0.07);
      post(wy + wr + 0.07, peak - 0.03);
      // Half sunk in the plaster, so its back is hidden in it.
      const disc = new THREE.CylinderGeometry(wr, wr, 0.02, 16).rotateZ(Math.PI / 2);
      add(frame, disc, made(0x2f3d4c, Surface.Auto, 0.35), face, wy, 0);
      const ring = new THREE.TorusGeometry(wr, 0.035, 6, 18).rotateY(Math.PI / 2);
      add(frame, ring, beams, face + end * 0.012, wy, 0);
    } else post(beam, peak - 0.03);
    for (const s of [-1, 1]) {
      const zs = s * Math.abs(s > 0 ? zw1 : zw0) * 0.62;
      const ys = underY(zs) - 0.03;
      const from = beam + tall * 0.1;
      proud([
        [s * 0.07, from],
        [s * 0.07, from + 0.13],
        [zs, ys],
        [zs - s * 0.1, ys - 0.1],
      ]);
    }
  }
  // Over the side walls, wall plates up to the boards; and out under the overhang, the rafters'
  // ends.
  for (const s of [-1, 1]) {
    const zw = s > 0 ? zw1 : zw0;
    const top = underY(zw);
    // Between the gables' inner faces.
    const span = inner.x1 - inner.x0 + 2 * (jetty - gableT);
    box(
      frame,
      span,
      top + H / 2,
      0.18,
      (inner.x0 + inner.x1) / 2,
      (top - H / 2) / 2,
      zw - s * 0.1,
      beams,
    );
    const count = Math.max(2, Math.round((sx1 - sx0) / 0.7));
    const e = s * (D / 2 - 0.04);
    for (let i = 0; i <= count; i++) {
      const x = sx0 + 0.08 + ((sx1 - sx0 - 0.16) * i) / count;
      const outline: [number, number][] = [
        [zw, underY(zw)],
        [e, underY(e)],
        [e, Math.max(-H / 2, underY(e) - 0.08)],
        [zw, Math.max(-H / 2, underY(zw) - 0.12)],
      ];
      add(frame, slab(outline, x - 0.045, x + 0.045, 0.01), timber, 0, 0, 0);
    }
  }
  // Tie beams across the room, from wall plate to wall plate: one over its middle, where a lamp
  // hangs from it.
  for (const f of [-1 / 3, 0, 1 / 3]) {
    const x = (inner.x0 + inner.x1) / 2 + f * (inner.x1 - inner.x0);
    box(frame, 0.14, 0.16, zw1 - zw0 - 0.38, x, -H / 2 + 0.08, (zw0 + zw1) / 2, beams);
  }
}

// ---------------------------------------------------------------- the upper storey

/** A storey's timber frame, a rich dark brown. */
const FRAME = 0x66401f;
/** The boards under a jetty, in its shade. */
const SOFFIT = 0x5b3b22;
/**
 * The iron of a building's straps, plates and brackets: a dark grey, catching the light (any
 * bluer or paler and the blue sky in it turns it bright blue).
 */
const STRAP = 0x484b50;
/** The leading of a lattice window. */
const LEADING = 0x2b2723;
/** A shutter's boards. */
const SHUTTER = 0x80522c;
/** The warm glow of a lamp-lit room behind glass. */
const GLOW = 0xffc46a;

/** A building's ironwork: grey, its edges catching the light, but less of a mirror than steel. */
const strapIron = () => made(STRAP, Surface.Metal, 0.55, 0.4);

let lampLit: THREE.MeshStandardMaterial | null = null;

/** Glass with a lamp-lit room behind it: warm by day, glowing at night. */
function litGlass(): THREE.MeshStandardMaterial {
  lampLit ??= atNight(
    madeOf(
      new THREE.MeshStandardMaterial({
        color: 0xe9b65a,
        emissive: GLOW,
        emissiveIntensity: 0.22,
        roughness: 0.3,
      }),
      Surface.Auto,
    ),
    1.3,
  );
  return lampLit;
}

/** One side of a storey, by the way out of it in its frame. */
export type StoreySide = '-z' | '+z' | '-x' | '+x';

/** What a storey stands on, in its frame (see `storeyModel`). */
export interface StoreyBelow {
  /** The outer faces of the walls under it. */
  walls: RoofWalls;
  /**
   * Where nothing may come down the walls under its jetty: round the doorways and windows in
   * them, and whatever stands against them up there (a porch's roof).
   */
  keepOut: THREE.Box3[];
  /** Whether those walls are plank walls framed in timber (see `UNDER_FRAME`). */
  framed: boolean;
}

/**
 * The timber frame round a plank building's walls (drawn with the house's details, see
 * `WALL_FRAME`): how far the beam along their tops stands out from them (and a little more), and
 * how deep it is; and how far its corner posts, with the iron straps round them, reach along
 * the walls from the corners (and a centimetre more).
 */
const UNDER_FRAME = {
  proud: WALL_FRAME.beamProud + 0.002,
  beam: WALL_FRAME.beam,
  corner: Math.max(WALL_FRAME.post, WALL_FRAME.strap.length) + 0.01,
};

/** How a side of a storey lies in its frame: turned `turn` about y from the front (-z). */
const SIDES: { side: StoreySide; turn: number }[] = [
  { side: '-z', turn: 0 },
  { side: '+z', turn: Math.PI },
  { side: '-x', turn: Math.PI / 2 },
  { side: '+x', turn: -Math.PI / 2 },
];

/**
 * The lattice of a window `pw` wide and `ph` tall about (`uc`, `yc`) in the plane z = `z`,
 * facing -z: diamond panes between thin strips of leading, as flat quads.
 */
function lattice(uc: number, yc: number, pw: number, ph: number, z: number): THREE.BufferGeometry {
  const q = new Quads();
  const c = hex(LEADING);
  const bar = 0.014;
  // The two families of lines, u - uc = ±k (y - yc) + c: diamonds taller than they are wide.
  const k = 0.62;
  const spacing = pw / 3;
  const out = new THREE.Vector3(0, 0, -1);
  for (const s of [-1, 1])
    for (let i = -6; i <= 6; i++) {
      const c0 = i * spacing;
      // Where the line is in the pane: y over its height, cut where u leaves it.
      const ys: number[] = [];
      for (const [ya, yb] of [[-ph / 2, ph / 2]]) {
        let lo = ya!;
        let hi = yb!;
        // u = c0 + s k y must lie in [-pw/2, pw/2].
        const y1 = (-pw / 2 - c0) / (s * k);
        const y2 = (pw / 2 - c0) / (s * k);
        lo = Math.max(lo, Math.min(y1, y2));
        hi = Math.min(hi, Math.max(y1, y2));
        if (hi - lo > 0.02) ys.push(lo, hi);
      }
      if (ys.length < 2) continue;
      const [y0, y1] = ys as [number, number];
      const a = new THREE.Vector3(uc + c0 + s * k * y0, yc + y0, z);
      const b = new THREE.Vector3(uc + c0 + s * k * y1, yc + y1, z);
      const along = b.clone().sub(a).normalize();
      const across = new THREE.Vector3(-along.y, along.x, 0).multiplyScalar(bar / 2);
      q.flat(
        [
          a.clone().add(across),
          b.clone().add(across),
          b.clone().sub(across),
          a.clone().sub(across),
        ],
        out,
        c,
      );
    }
  return q.geometry();
}

/**
 * The upper storey of a half-timbered building over the walls of its room, the box, jutting out
 * past them (`below`) on its jetty: on every side a dark timber frame of a sill and a head beam,
 * posts at the corners and studs between, braced on the slant, with plaster in `colour` in the
 * panels between them; on each side one or two windows of leaded diamond panes, lit warm, in chunky
 * frames, with board shutters open either side and a sill under them, and a window box of
 * flowers under the front's. Under it the floor's joists run out to the jetty, capped in iron,
 * and on the longer stretches of wall below, heavy knee braces strapped in iron hold it up. The
 * head beams cross at the corners and run out past them, capped in iron; iron plates bind the
 * corners, and a lantern hangs at the front on an iron arm.
 *
 * The frame stands at the box's faces and the plaster a little in from them; what stands out
 * from a wall (shutters, sills, the window box, the lantern, the head beams' ends) reaches out
 * of the box, and the knee braces down the walls under it.
 */
export function storeyModel(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
  below: StoreyBelow | null,
): void {
  const wood = hex(FRAME);
  const tone = () => times(wood, 0.86 + seed() * 0.26);
  const timber = (geometry: THREE.BufferGeometry, parent: THREE.Object3D = g) =>
    put(parent, geometry, Surface.Auto);
  const ironwork = strapIron();
  const foot = -h / 2;
  // How far in from the box's faces the plaster is, and how deep the timbers are from them.
  const e = 0.004;
  const inset = 0.06;
  const deep = inset + 0.03;
  // The joists under it (and the boards on them), the sill and head beams and the posts.
  const joistH = 0.2;
  const boards = 0.05;
  const sillH = 0.2;
  const headH = 0.2;
  const corner = 0.24;
  const stud = 0.13;
  const sillTop = foot + joistH + sillH;
  const headFoot = h / 2 - headH;
  const walls = below?.walls ?? {
    x0: -w / 2 + 0.3,
    x1: w / 2 - 0.3,
    z0: -d / 2 + 0.3,
    z1: d / 2 - 0.3,
  };

  // The plaster, one block in from the faces, on the boards, and its top a hair under the head
  // beams' (where the roof hides it).
  const plasterH = h - joistH - 0.006;
  add(
    g,
    new THREE.BoxGeometry(w - 2 * inset, plasterH, d - 2 * inset),
    made(colour, Surface.Wall, 0.92),
    0,
    foot + joistH + plasterH / 2,
    0,
  );
  // The boards over the joists: the ceiling of the room under it.
  add(
    g,
    new THREE.BoxGeometry(w - 2 * e, boards, d - 2 * e),
    made(SOFFIT, Surface.Planks, 0.85),
    0,
    foot + joistH - boards / 2,
    0,
  );
  // The joists: right across from front to back every half metre or so, and short ones out
  // over the end walls, each end that shows capped in iron and bolted (the caps a hair proud of
  // the boards' edges).
  const jh = joistH - boards;
  const jy = foot + jh / 2;
  const cap = 0.025;
  const capAt = (s: number, half: number) => s * (half - e / 2 - cap / 2);
  const capOn = (x: number, z: number, alongZ: boolean, out: number) => {
    const plate = alongZ ? bevelBox(0.15, jh + 0.02, cap) : bevelBox(cap, jh + 0.02, 0.15);
    add(g, plate, ironwork, x, jy, z);
    const bolt = new THREE.CylinderGeometry(0.022, 0.022, 0.03, 8);
    if (alongZ) add(g, bolt.rotateX(Math.PI / 2), ironwork, x, jy, z + out * 0.02);
    else add(g, bolt.rotateZ(Math.PI / 2), ironwork, x + out * 0.02, jy, z);
  };
  const across = Math.max(2, Math.round((w - 0.3) / 0.48));
  const xs = Array.from({ length: across + 1 }, (_, i) => -w / 2 + 0.15 + ((w - 0.3) * i) / across);
  for (const x of xs) {
    timber(block(0.12, jh, d - 2 * (e + cap), x, jy, 0, tone()));
    for (const s of [-1, 1]) capOn(x, capAt(s, d / 2), true, s);
  }
  const span = walls.z1 - walls.z0 - 0.6;
  const along = Math.max(1, Math.round(span / 0.48));
  const zs = Array.from({ length: along + 1 }, (_, i) => walls.z0 + 0.3 + (span * i) / along);
  for (const s of [-1, 1]) {
    // From the face in to a little over the wall.
    const x0 = s * (w / 2 - e - cap);
    const x1 = (s < 0 ? walls.x0 : walls.x1) - s * 0.25;
    if (s * (x0 - x1) < 0.15) continue;
    for (const z of zs) {
      timber(block(Math.abs(x1 - x0), jh, 0.12, (x0 + x1) / 2, jy, z, tone()));
      capOn(capAt(s, w / 2), z, false, s);
    }
  }

  // Each side, built in a frame of its own: its face the plane z = 0, the way out of it -z, and
  // u (its x) along it.
  for (const { side, turn } of SIDES) {
    const f = new THREE.Group();
    f.rotation.y = turn;
    const long = side === '-z' || side === '+z';
    const L = long ? w : d;
    const half = long ? d / 2 : w / 2;
    f.position.set(-Math.sin(turn) * half, 0, -Math.cos(turn) * half);
    g.add(f);
    // The sill and head beams run from corner to corner on the front and back, and between
    // those on the ends, so that no two faces lie in one plane at a corner. The front's and
    // back's head beams run on out past the corners, where the ends' cross them, capped in iron.
    const ends = long ? L / 2 - e : L / 2 - deep;
    const z = (deep - e) / 2 + e;
    timber(block(2 * ends, sillH, deep - e, 0, foot + joistH + sillH / 2, z, tone()), f);
    const run = long ? 0.16 : 0;
    const headY = h / 2 - headH / 2;
    timber(block(2 * (ends + run), headH, deep - e, 0, headY, z, tone()), f);
    if (long)
      for (const s of [-1, 1]) {
        add(f, bevelBox(0.03, headH, deep + 0.01), ironwork, s * (ends + run + 0.012), headY, z);
        const bolt = new THREE.CylinderGeometry(0.024, 0.024, 0.03, 8).rotateZ(Math.PI / 2);
        add(f, bolt, ironwork, s * (ends + run + 0.03), headY, z);
      }
    // The corner posts, square, showing on both faces (built with the front and back).
    const tall = headFoot - sillTop;
    const ym = sillTop + tall / 2;
    if (long)
      for (const s of [-1, 1])
        timber(
          block(corner, tall, corner, s * (L / 2 - e - corner / 2), ym, e + corner / 2, tone()),
          f,
        );
    // The bays between the corner posts, an odd number of them, with studs between.
    const u0 = -L / 2 + e + corner;
    const u1 = L / 2 - e - corner;
    const bays = Math.max(3, 2 * Math.round(((u1 - u0) / 1.05 - 1) / 2) + 1);
    const bay = (u1 - u0) / bays;
    for (let i = 1; i < bays; i++)
      timber(block(stud, tall, deep - e, u0 + bay * i, ym, z, tone()), f);
    // The windows: in the middle bay, or either side of it on a long side.
    const windows = bays >= 5 && L > 4.6 ? [1, bays - 2] : [(bays - 1) / 2];
    const winW = Math.min(0.78, bay - stud - 0.24);
    const fw = 0.09;
    const winH = Math.min(0.95, tall - 0.5);
    const winY = headFoot - 0.14 - fw - winH / 2;
    for (let i = 0; i < bays; i++) {
      const ua = u0 + bay * i + (i > 0 ? stud / 2 : 0);
      const ub = u0 + bay * (i + 1) - (i < bays - 1 ? stud / 2 : 0);
      if (windows.includes(i)) {
        storeyWindow(f, (ua + ub) / 2, winY, winW, winH, fw, wood, tone, seed, {
          inset,
          deep,
          railTo: [ua, ub],
          box: side === '-z' && i === windows[0],
        });
        continue;
      }
      // A brace on the slant, rising to the corner post in an end bay, or a cross of two (the
      // one behind set back a hair) in a bay between.
      const bw = 0.15;
      const brace = (from: number, to: number, back = 0) => {
        const outline: [number, number][] = [
          [from - bw / 2, sillTop],
          [from + bw / 2, sillTop],
          [to + bw / 2, headFoot],
          [to - bw / 2, headFoot],
        ];
        const geometry = slab(outline, -deep + back, -e - back, 0.012).rotateY(Math.PI / 2);
        timber(coloured(geometry, tone()), f);
      };
      const inA = ua + bw / 2 + 0.01;
      const inB = ub - bw / 2 - 0.01;
      if (i === 0) brace(inB, inA);
      else if (i === bays - 1) brace(inA, inB);
      else {
        brace(inA, inB);
        brace(inB, inA, 0.012);
      }
    }
    // Iron plates binding the corners at the sill and the head, bolted through: on the front
    // and back round the corner's edge, on the ends up to the corner posts.
    const plate = 0.34;
    const reach = long ? L / 2 + 0.012 : L / 2 - deep;
    for (const s of [-1, 1])
      for (const y of [foot + joistH + sillH / 2, headY]) {
        const u = s * (reach - plate / 2);
        add(f, bevelBox(plate, 0.12, 0.02), ironwork, u, y, -0.006);
        for (const du of [-0.09, 0.09]) {
          const bolt = new THREE.CylinderGeometry(0.02, 0.02, 0.025, 8).rotateX(Math.PI / 2);
          add(f, bolt, ironwork, u + du, y, -0.02);
        }
      }
    // Knee braces under the jetty, where the walls under it run on clear.
    const face = {
      '-z': walls.z0 + d / 2,
      '+z': d / 2 - walls.z1,
      '-x': walls.x0 + w / 2,
      '+x': w / 2 - walls.x1,
    }[side];
    if (below && face > 0.15 + (below.framed ? UNDER_FRAME.proud : 0)) {
      // The wall's ends and the joists over it, along the side.
      const [wa, wb, us] = {
        '-z': [walls.x0, walls.x1, xs],
        '+z': [-walls.x1, -walls.x0, xs.map((x) => -x)],
        '-x': [-walls.z1, -walls.z0, zs.map((zz) => -zz)],
        '+x': [walls.z0, walls.z1, zs],
      }[side] as [number, number, number[]];
      kneeBraces(f, us, wa, wb, face, foot, tone, below, ironwork);
    }
    // A lantern on an iron arm on a front corner post.
    if (side === '-z')
      frontLantern(f, (seed() < 0.5 ? -1 : 1) * (L / 2 - e - corner / 2), headFoot - 0.1, ironwork);
  }
}

/** The tones a storey's timbers are painted in, each its own. */
type Tones = () => THREE.Color;

/** How a window of a storey's side is fitted in its bay (see `storeyWindow`). */
interface WindowFit {
  /** How far in the plaster is from the face, and how deep the timbers are. */
  inset: number;
  deep: number;
  /** The bay it is in, along the side, which the rail under it spans. */
  railTo: [number, number];
  /** Whether a window box of flowers hangs under it. */
  box: boolean;
}

/**
 * A storey's window in a side's frame (see `storeyModel`), its middle at (`uc`, `yc`): leaded
 * diamond panes `winW` by `winH`, lit warm, in a chunky frame `fw` broad standing proud of the
 * timbers, on a rail across its bay, with a sill under it and board shutters open flat either
 * side, battened and hung on long iron straps; and under the front's, a window box of flowers.
 */
function storeyWindow(
  f: THREE.Object3D,
  uc: number,
  yc: number,
  winW: number,
  winH: number,
  fw: number,
  wood: THREE.Color,
  tone: Tones,
  seed: () => number,
  fit: WindowFit,
): void {
  const { inset, deep } = fit;
  const e = 0.004;
  const timber = (geometry: THREE.BufferGeometry) => put(f, geometry, Surface.Auto);
  const proud = 0.035;
  const fz = (deep - proud) / 2;
  const fd = deep + proud;
  const top = yc + winH / 2;
  const bottom = yc - winH / 2;
  // The frame round it, its head and foot across the posts' tops and feet.
  timber(block(winW + 2 * fw, fw, fd, uc, top + fw / 2, fz, tone()));
  timber(block(winW + 2 * fw, fw, fd, uc, bottom - fw / 2, fz, tone()));
  for (const s of [-1, 1])
    timber(block(fw, winH, fd, uc + s * (winW / 2 + fw / 2), yc, fz, tone()));
  // The rail under it across the bay, and the sill standing out over it.
  const railH = 0.12;
  const [ua, ub] = fit.railTo;
  const sillY = bottom - fw;
  timber(
    block(ub - ua, railH, deep - e, (ua + ub) / 2, sillY - railH / 2, (deep - e) / 2 + e, tone()),
  );
  const sillD = 0.12 + deep;
  timber(
    block(winW + 2 * fw + 0.1, 0.06, sillD, uc, sillY - 0.03, deep - sillD / 2, times(wood, 1.05)),
  );
  // The glass, just out from the plaster, and its leading.
  add(f, new THREE.BoxGeometry(winW, winH, 0.01), litGlass(), uc, yc, inset - 0.012);
  put(f, lattice(uc, yc, winW, winH, inset - 0.02), Surface.Auto, false);
  // The shutters either side, each of three boards with battens across and a brace between
  // them, hung on iron straps from the frame's side.
  const ironwork = strapIron();
  const sw = winW / 2 + fw * 0.5;
  const sh = winH + 2 * fw;
  const shutterWood = hex(SHUTTER).lerp(wood, 0.25);
  for (const s of [-1, 1]) {
    const inner = uc + s * (winW / 2 + fw + 0.012);
    const mid = inner + (s * sw) / 2;
    const n = 3;
    const gap = 0.008;
    const bw = (sw - gap * (n - 1)) / n;
    for (let k = 0; k < n; k++) {
      const u = inner + s * (bw / 2 + k * (bw + gap));
      timber(
        block(
          bw,
          sh - seed() * 0.03,
          0.038,
          u,
          yc,
          -0.031,
          times(shutterWood, 0.86 + seed() * 0.26),
        ),
      );
    }
    const battens = [yc - sh * 0.32, yc + sh * 0.32];
    for (const y of battens)
      timber(block(sw - 0.04, 0.08, 0.026, mid, y, -0.063, times(shutterWood, 0.9)));
    // The brace between the battens, rising away from the hinges.
    const geometry = slab(
      [
        [inner + s * 0.05, battens[0]! + 0.04],
        [inner + s * 0.05, battens[0]! + 0.04 + 0.08],
        [inner + s * (sw - 0.05), battens[1]! - 0.04],
        [inner + s * (sw - 0.05), battens[1]! - 0.04 - 0.08],
      ].map(([u, y]) => [u!, y!] as [number, number]),
      0.05,
      0.076,
    ).rotateY(Math.PI / 2);
    timber(coloured(geometry, times(shutterWood, 0.82)));
    // The straps: from the frame's side out along each batten, with a knuckle at the hinge.
    for (const y of battens) {
      add(
        f,
        new THREE.BoxGeometry(sw * 0.72, 0.045, 0.008),
        ironwork,
        inner + s * sw * 0.36,
        y,
        -0.08,
      );
      add(
        f,
        new THREE.CylinderGeometry(0.018, 0.018, 0.09, 8),
        ironwork,
        inner - s * 0.006,
        y,
        -0.06,
      );
    }
  }
  if (!fit.box) return;
  // The window box: a planked trough on two iron brackets, flowers spilling over its edge.
  const bx = winW + 2 * fw + 0.04;
  const by = 0.17;
  const bz = 0.2;
  const boxTop = sillY - 0.08;
  const zc = -bz / 2 - 0.006;
  timber(block(bx, by, bz, uc, boxTop - by / 2, zc, times(wood, 1.15)));
  add(
    f,
    new THREE.BoxGeometry(bx - 0.06, 0.01, bz - 0.06),
    made(0x3a2a1c, Surface.Auto, 0.95),
    uc,
    boxTop - 0.025,
    zc,
  );
  for (const s of [-1, 1]) {
    const u = uc + s * (bx / 2 - 0.08);
    add(f, bevelBox(0.03, 0.2, 0.02), ironwork, u, boxTop - by - 0.08, -0.012);
    add(f, bevelBox(0.03, 0.02, bz), ironwork, u, boxTop - by - 0.01, zc);
  }
  put(
    f,
    windowBoxPlants(bx - 0.06, bz - 0.06, seed).translate(uc, boxTop - 0.03, zc),
    Surface.Auto,
  );
}

/**
 * Knee braces in a side's frame (see `storeyModel`) under the jetty, `face` out from the walls,
 * from the joists at `us` (along the side) down the wall between `wa` and `wb`, where it runs
 * on clear of what `below` keeps out (in the storey's frame): a timber knee rounded underneath,
 * strapped to its joist with iron plates either side and bolted through, its foot on an iron
 * plate on the wall. On framed walls the knee stands on the beam along their tops, and below
 * the beam on a short post fixed to the wall, clear of the corner posts. One near each end of
 * the wall, and on a long one, one in the middle.
 */
function kneeBraces(
  f: THREE.Object3D,
  us: number[],
  wa: number,
  wb: number,
  face: number,
  foot: number,
  tone: Tones,
  below: StoreyBelow,
  ironwork: THREE.Material,
): void {
  const drop = 0.5;
  const t = 0.1;
  // The knee's back: on the wall, or on the beam along its top.
  const back = below.framed ? face - UNDER_FRAME.proud - 0.004 : face;
  const ends = below.framed ? UNDER_FRAME.corner + t / 2 + 0.04 : 0.22;
  f.updateMatrix();
  const toStorey = f.matrix;
  const clear = (u: number) => {
    const reach = new THREE.Box3(
      new THREE.Vector3(u - t, foot - drop - 0.1, 0),
      new THREE.Vector3(u + t, foot, face + 0.05),
    ).applyMatrix4(toStorey);
    return !below.keepOut.some((k) => k.intersectsBox(reach));
  };
  const ok = us.filter((u) => u > wa + ends && u < wb - ends && clear(u)).sort((a, b) => a - b);
  if (ok.length === 0) return;
  const picked = new Set([ok[0]!, ok[ok.length - 1]!]);
  if (wb - wa > 4.5) {
    const mid = (wa + wb) / 2;
    const middle = ok.reduce((m, u) => (Math.abs(u - mid) < Math.abs(m - mid) ? u : m));
    if (Math.min(...[...picked].map((u) => Math.abs(u - middle))) > 1) picked.add(middle);
  }
  const strap = Math.min(0.24, back - 0.03);
  for (const u of picked) {
    // The knee: along the joist's underside from the wall out to near the jetty's face, and
    // round from there down to the wall.
    const out = 0.07;
    const outline: [number, number][] = [[back, foot]];
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * (Math.PI / 2);
      outline.push([back - (back - out) * Math.cos(a), foot - drop * Math.sin(a)]);
    }
    put(f, coloured(slab(outline, u - t / 2, u + t / 2, 0.015), tone()), Surface.Auto);
    // Strapped to the joist either side, bolted through.
    for (const s of [-1, 1])
      add(
        f,
        bevelBox(0.016, 0.2, strap),
        ironwork,
        u + s * (t / 2 + 0.008),
        foot - 0.02,
        back - strap / 2 - 0.01,
      );
    add(
      f,
      new THREE.CylinderGeometry(0.02, 0.02, t + 0.06, 8).rotateZ(Math.PI / 2),
      ironwork,
      u,
      foot - 0.05,
      back - Math.min(0.12, strap / 2),
    );
    // Under the beam, the post it springs from, down the wall past its foot.
    const low = foot - drop - 0.1;
    if (below.framed) {
      const high = foot - UNDER_FRAME.beam - 0.02;
      put(
        f,
        coloured(bevelBox(t, high - low, face - back - 0.002, 0.012), tone()),
        Surface.Auto,
      ).position.set(u, (low + high) / 2, (back + face - 0.002) / 2);
    }
    // Its foot on an iron plate on the wall.
    add(f, bevelBox(0.18, 0.22, 0.02), ironwork, u, foot - drop + 0.02, face - 0.011);
  }
}

/**
 * A lantern at `u` along a side's frame (see `storeyModel`), hung from an iron arm out from the
 * wall at height `y`, with a stay under the arm: an iron cage round warm glass under a little
 * pyramid roof.
 */
function frontLantern(f: THREE.Object3D, u: number, y: number, ironwork: THREE.Material): void {
  const reach = 0.46;
  add(f, bevelBox(0.12, 0.42, 0.02), ironwork, u, y - 0.12, -0.012);
  add(f, bevelBox(0.035, 0.035, reach), ironwork, u, y, -reach / 2 - 0.01);
  rod(
    f,
    new THREE.Vector3(u, y - 0.3, -0.02),
    new THREE.Vector3(u, y - 0.01, -reach * 0.7),
    0.014,
    ironwork,
  );
  // The hook, and the lantern under it.
  const lz = -reach + 0.04;
  add(f, new THREE.TorusGeometry(0.03, 0.008, 6, 10), ironwork, u, y - 0.04, lz);
  const ly = y - 0.27;
  add(f, new THREE.BoxGeometry(0.15, 0.22, 0.15), litGlass(), u, ly, lz);
  add(f, bevelBox(0.21, 0.035, 0.21), ironwork, u, ly - 0.125, lz);
  add(f, bevelBox(0.19, 0.03, 0.19), ironwork, u, ly + 0.122, lz);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      add(
        f,
        new THREE.BoxGeometry(0.022, 0.24, 0.022),
        ironwork,
        u + sx * 0.085,
        ly,
        lz + sz * 0.085,
      );
  const roof = add(f, new THREE.ConeGeometry(0.16, 0.12, 4), ironwork, u, ly + 0.195, lz);
  roof.rotation.y = Math.PI / 4;
  add(f, new THREE.TorusGeometry(0.025, 0.007, 6, 10), ironwork, u, ly + 0.27, lz);
}
