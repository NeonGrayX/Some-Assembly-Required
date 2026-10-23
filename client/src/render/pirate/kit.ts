import * as THREE from 'three';
import { add, metal } from '../interiors.ts';
import { bevelFor } from '../shapes.ts';
import { Surface, madeOf } from '../styles.ts';

/**
 * What the pirate island's man-made things are built of: the palette, and the shapes (turned
 * on a lathe, sawn as slabs, painted quads, timber with its grain) the models in this folder are
 * put together from.
 *
 * The things themselves are chunky and hand-painted like the rest of the game: iron hooped
 * barrels, a cannon on its truck carriage, rope fences and the rope bridge's rails, old mooring
 * posts, harbour lanterns, coils of rope and an anchor (`harbour.ts`, `rope.ts`), the beached
 * ship's planked hull with its gun ports and its masts rigged with striped sails (`ship.ts`),
 * flags with the skull and crossbones (`flags.ts`), and the steep shingled roofs of the tavern
 * and the captain's hut and its upper storey (`roofs.ts`, `storey.ts`).
 *
 * Curved timber (staves, a hull's strakes, a mast, shingles laid on a slope) is painted into
 * vertex colours on a material drawn as no surface in particular (see `nature.ts`), so that the
 * styles' wood, laid out in straight boards along the world's axes, does not run across it.
 * Flat timber standing square to the world (a carriage's cheeks, beams, a deck) is plain wood.
 *
 * Models are built like `props.ts`'s, in a frame centred on their box with local -z its front,
 * `w` wide (x), `h` high and `d` deep (z), and stay inside the box (it is what they collide
 * as), but for what reaches out of it on purpose: sails and rigging, flags, a ship's bow and
 * bulwarks, a lantern's arm.
 */

/** Dark timber: carriages, posts, barge boards and beams. */
export const TIMBER = 0x5f3d22;
/** The carriage of a cannon, a shade warmer. */
export const CARRIAGE = 0x6e4a2b;
/** Wrought iron: hoops, straps, bolts and caps. */
export const IRON = 0x34363a;
/** The cream plaster of a gable end. */
export const PLASTER = 0xeadcbc;
/** A ship's deck planks. */
export const DECK = 0xa57446;
/**
 * Sailcloth: the red stripes, a deep brick red, and the cream ones. Both are paler and greyer
 * than they show: the painted style makes cloth's colours a good deal richer, and the sun is
 * warm, so a red any richer shows a pillar-box red and a cream any warmer shows a butter yellow.
 */
export const SAIL_RED = 0xc48476;
export const SAIL_CREAM = 0xe5ddcd;
/** A pirate flag's black cloth. */
export const FLAG = 0x1c1b1f;
/** The dark inside of a barrel seen over its rim. */
export const INSIDE = 0x1c1a18;

const tagged = new Map<string, THREE.MeshStandardMaterial>();

/**
 * A material of its own, made of `surface`: not one of `mat`'s, which every model shares, and
 * which tagging here would tag everywhere.
 */
export function made(
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
export const iron = () => metal(IRON);

/**
 * A small fitting (a bolt, a plate, a strap) as `add` places it, but casting no shadow of the
 * sun's: from where anyone stands its shadow would be a few pixels, and a sun's shadow pass
 * redraws every caster.
 */
export function fitting(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const m = add(parent, geometry, material, x, y, z);
  m.castShadow = false;
  return m;
}

/** Shades of `c`: each a new colour. */
export const times = (c: THREE.Color, f: number) => c.clone().multiplyScalar(f);

/** One ring of a turned piece (see `lathe`): its height, radius and colour. */
export interface Turn {
  y: number;
  /** Its radius; 0 closes the piece with a point on its axis. */
  r: number;
  colour: THREE.Color;
  /** How much the columns' relief (`Column`) shows in this ring: 0 none, 1 all of it. */
  relief?: number;
}

/** A line of points down a turned piece: its angle, and how far out and how light it is. */
export interface Column {
  a: number;
  out: number;
  shade: number;
}

/** `n` plain columns, evenly round. */
export const evenly = (n: number): Column[] =>
  Array.from({ length: n }, (_, j) => ({ a: (j / n) * Math.PI * 2, out: 1, shade: 1 }));

/**
 * A piece turned about y through `turns`, bottom to top, its points on `columns` round it,
 * with vertex colours. Its outside faces out where the rings climb, in where they come back
 * down (the inside of a barrel), up where they step in and down where they step out.
 */
export function lathe(turns: Turn[], columns: Column[]): THREE.BufferGeometry {
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
export function slab(
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
export function coloured(geometry: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry {
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
export class Quads {
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
 * A length of timber `width × height × depth` centred on the origin, with the four edges that
 * run along its length (its longest side) taken off `radius` deep, as `BevelBoxGeometry` takes
 * off all twelve: 28 triangles to its 44. Those are the edges that show, catching the light
 * along a beam, a post or a joist; its ends are butted against other timbers or only a hand
 * across. Still a `BoxGeometry` with a box's size parameters, for what takes one for a solid
 * block (the model checks). Its normals and points are its own, each face's apart.
 */
class TimberGeometry extends THREE.BoxGeometry {
  constructor(width?: number, height = 1, depth = 1, radius = 0.05) {
    super(width ?? 1, height, depth);
    // (Bare, as three.js makes one to copy another into when it clones it: left a plain box.)
    if (width === undefined) return;
    const size = [width, height, depth];
    const along = size.indexOf(Math.max(...size));
    const [u, v] = [0, 1, 2].filter((k) => k !== along) as [number, number];
    const r = Math.max(0, Math.min(radius, size[u]! * 0.225, size[v]! * 0.225));
    // Every timber along the same axis has its points in the same places, but for its size and
    // its bevel: laid out once (see `timberLayout`), and placed for each.
    const { codes, normals } = timberLayout(along);
    const position = new Float32Array(codes.length);
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i]!;
      const half = size[i % 3]! / 2 - (Math.abs(code) === 2 ? r : 0);
      position[i] = code > 0 ? half : -half;
    }
    this.setIndex(null);
    this.clearGroups();
    this.setAttribute('position', new THREE.BufferAttribute(position, 3));
    this.setAttribute('normal', new THREE.BufferAttribute(normals.slice(), 3));
    this.deleteAttribute('uv');
  }
}

/**
 * How a timber along the axis `along` is laid out (see `TimberGeometry`): each point's every
 * coordinate as which side of the middle it is on (its sign) and whether it is at the face (1)
 * or in from it by the bevel (2); and the normals. Worked out once for each axis from a timber
 * whose half sizes and bevel tell every coordinate apart.
 */
const timberLayouts: { codes: Int8Array; normals: Float32Array }[] = [];
function timberLayout(along: number): { codes: Int8Array; normals: Float32Array } {
  const known = timberLayouts[along];
  if (known) return known;
  const [u, v] = [0, 1, 2].filter((k) => k !== along) as [number, number];
  const halves = [0, 0, 0];
  [halves[u], halves[v], halves[along]] = [1, 2, 4];
  const [hu, hv, hl] = [1, 2, 4];
  const r = 0.25;
  /** A point (`pu`, `pv`) across it, `pl` along it. */
  const at = (pu: number, pv: number, pl: number) =>
    new THREE.Vector3().setComponent(u, pu).setComponent(v, pv).setComponent(along, pl);
  const axis = (k: number, sign: number) => new THREE.Vector3().setComponent(k, sign);
  const q = new Quads();
  const white = new THREE.Color(1, 1, 1);
  const cs = [white, white, white, white];
  for (const s of [-1, 1]) {
    // The faces across u and across v on this side, inset from the edges by the bevel.
    const nu = axis(u, s);
    const nv = axis(v, s);
    q.quad(
      [-1, 1, 1, -1].map((e, i) => at(s * hu, e * (hv - r), i < 2 ? -hl : hl)),
      [nu, nu, nu, nu],
      cs,
    );
    q.quad(
      [-1, 1, 1, -1].map((e, i) => at(e * (hu - r), s * hv, i < 2 ? -hl : hl)),
      [nv, nv, nv, nv],
      cs,
    );
    // The chamfers from the face across u to those across v either side of it, their normals
    // turning from the one face's to the other's.
    for (const t of [-1, 1]) {
      const nt = axis(v, t);
      q.quad(
        [
          at(s * hu, t * (hv - r), -hl),
          at(s * (hu - r), t * hv, -hl),
          at(s * (hu - r), t * hv, hl),
          at(s * hu, t * (hv - r), hl),
        ],
        [nu, nt, nt, nu],
        cs,
      );
    }
    // Its end at this end: an octagon, as a strip across its middle and a trapezium either side
    // of that.
    const n = axis(along, s);
    const ns = [n, n, n, n];
    const end = (pu: number, pv: number) => at(pu, pv, s * hl);
    q.quad([end(-hu, -hv + r), end(hu, -hv + r), end(hu, hv - r), end(-hu, hv - r)], ns, cs);
    for (const t of [-1, 1])
      q.quad(
        [end(-hu, t * (hv - r)), end(hu, t * (hv - r)), end(hu - r, t * hv), end(-hu + r, t * hv)],
        ns,
        cs,
      );
  }
  const g = q.geometry();
  const points = g.attributes.position!.array;
  const codes = new Int8Array(points.length);
  for (let i = 0; i < points.length; i++) {
    const x = points[i]!;
    codes[i] = Math.sign(x) * (Math.abs(x) < halves[i % 3]! - 1e-6 ? 2 : 1);
  }
  const layout = { codes, normals: new Float32Array(g.attributes.normal!.array) };
  timberLayouts[along] = layout;
  return layout;
}

/**
 * A timber `sx × sy × sz` at (`x`, `y`, `z`), its long edges bevelled to suit its size (see
 * `TimberGeometry`; a plain box if it is too thin for a bevel to show), painted `c` in vertex
 * colours as a brush would: a little lighter on top and darker underneath.
 */
export function block(
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
  c: THREE.Color,
): THREE.BufferGeometry {
  const radius = bevelFor(sx, sy, sz);
  const geometry =
    radius > 0 ? new TimberGeometry(sx, sy, sz, radius) : new THREE.BoxGeometry(sx, sy, sz);
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

/**
 * A cylinder `r` round from `a` to `b`, as a mesh turned along the line between them; open at
 * its ends unless `capped` (a line of rigging's are tucked into what it runs between, and a
 * centimetre across besides).
 */
export function rod(
  g: THREE.Object3D,
  a: THREE.Vector3,
  b: THREE.Vector3,
  r: number,
  material: THREE.Material,
  sides = 6,
  capped = false,
): THREE.Mesh {
  const length = a.distanceTo(b);
  const geometry = new THREE.CylinderGeometry(r, r, length, sides, 1, !capped);
  const m = add(g, geometry, material, 0, 0, 0);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}
