import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BRICK_TYPES, COLOURS, PLATE_H, STUD, hasTopStud } from '@sar/shared';
import type { BrickType, BrickTypeId, ColourId, Facing } from '@sar/shared';
import { Surface, madeOf } from './styles.ts';

/** Visual gap between neighbouring bricks so seams are readable. */
export const GAP = 0.002;
const STUD_RADIUS = STUD * 0.3;
// A real stud is 1.7 mm high on a 3.2 mm plate.
const STUD_HEIGHT = PLATE_H * (1.7 / 3.2);
// Underside proportions follow a real brick (8 mm pitch): 1.2 mm walls, a 1 mm top,
// 6.51 mm tubes whose bore fits a stud, and 3.2 mm pins under 1-wide bricks.
const WALL = STUD * 0.15;
const TOP = STUD * 0.12;
// The ribs inside the walls, one in front of each stud below, that reach out to touch it: a
// real wall (1.2 mm) stops 0.3 mm short of the stud, and the ribs close that gap.
const RIB = STUD / 2 - STUD_RADIUS - GAP / 2 - WALL;
const RIB_WIDTH = STUD * 0.08;
const TUBE_OUTER = STUD * 0.407;
const TUBE_INNER = STUD_RADIUS;
const PIN_RADIUS = STUD * 0.2;
// The groove round a tile's bottom edge, its wall stepped in this far and up this high.
const GROOVE = STUD * 0.04;
// Round parts: their outer wall, the narrow foot under 1x1 rounds and cones, the hole an open
// stud has for a bar (3.2 mm), and an axle hole's cross (4.8 mm across, arms 1.8 mm).
const ROUND_WALL = STUD * 0.2;
const FOOT = STUD * 0.4;
const HOLE = STUD * 0.2;
const AXLE = STUD * 0.6;
const AXLE_ARM = STUD * 0.225;
const SEGMENTS = 16;
const ROUND_SEGMENTS = 32;

/** A window frame's posts either side of its opening, and its rails above and below it. */
export const WINDOW_POST = STUD * 0.18;
export const WINDOW_RAIL = PLATE_H * 0.9;

const geometries = new Map<BrickTypeId, THREE.BufferGeometry>();
const materials = new Map<ColourId, THREE.MeshStandardMaterial>();

/**
 * Hollow tube standing on y = 0, open at the top (it is hidden under the brick's top).
 * Built by hand because three's cylinders have no bore.
 */
function tubeGeometry(outer: number, inner: number, height: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[][]) => {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(...[a, b, c, d][i]!);
      nrm.push(...n[i]!);
    }
  };
  for (let i = 0; i < SEGMENTS; i++) {
    const a0 = (i / SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / SEGMENTS) * Math.PI * 2;
    const [c0, s0, c1, s1] = [Math.cos(a0), Math.sin(a0), Math.cos(a1), Math.sin(a1)];
    const o = (c: number, s: number, y: number) => [c * outer, y, s * outer];
    const n = (c: number, s: number, y: number) => [c * inner, y, s * inner];
    // Outer wall faces out, bore faces in, bottom ring faces down.
    quad(o(c0, s0, 0), o(c0, s0, height), o(c1, s1, height), o(c1, s1, 0), [
      [c0, 0, s0],
      [c0, 0, s0],
      [c1, 0, s1],
      [c1, 0, s1],
    ]);
    quad(n(c0, s0, 0), n(c1, s1, 0), n(c1, s1, height), n(c0, s0, height), [
      [-c0, 0, -s0],
      [-c1, 0, -s1],
      [-c1, 0, -s1],
      [-c0, 0, -s0],
    ]);
    const down = [0, -1, 0];
    quad(n(c0, s0, 0), o(c0, s0, 0), o(c1, s1, 0), n(c1, s1, 0), [down, down, down, down]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

/**
 * Brick geometry centred on the brick body (studs stick out on top), at rotation 0.
 * The underside is hollow like a real brick: walls, tubes between the studs of 2-wide
 * bricks and pins under 1-wide ones. `userData.body` holds the solid body's Box3.
 */
export function brickGeometry(type: BrickTypeId): THREE.BufferGeometry {
  let g = geometries.get(type);
  if (g) return g;
  const t = BRICK_TYPES[type];
  g = t.shape && t.shape !== 'box' ? shapedGeometry(t) : boxGeometry(t);
  geometries.set(type, g);
  return g;
}

/**
 * A plain brick or plate: a hollow box with studs on top (baseplates are flat underneath). A
 * headlight brick's face is set back half a plate, all the way up, its side stud in the recess.
 */
function boxGeometry(t: BrickType): THREE.BufferGeometry {
  const w = t.studsX * STUD - GAP;
  const h = t.plates * PLATE_H - GAP;
  const d = t.studsZ * STUD - GAP;
  const recess = t.sideStuds?.find((s) => (s.out ?? 0) < 0);
  let parts: THREE.BufferGeometry[];
  if (t.fixture) parts = [new THREE.BoxGeometry(w, h, d)];
  else if (recess) {
    const r = -recess.out! * PLATE_H;
    const dir = SIDE_DIRS[recess.dir];
    const [rw, rd] = dir.x ? [w - r, d] : [w, d - r];
    parts = hollowShell(rw, h, rd).map((g) => g.translate((-dir.x * r) / 2, 0, (-dir.z * r) / 2));
  } else parts = hollowBox(t, w, h, d);
  parts.push(...sideStudParts(t, h));
  for (let x = 0; x < t.studsX; x++)
    for (let z = 0; z < t.studsZ; z++) if (hasTopStud(t.id, x, z)) parts.push(topStud(t, x, z, h));
  return merge(parts, w, h, d);
}

interface ShellOptions {
  /** A tile's groove: the walls' bottom edge stepped in a little all round. */
  groove?: boolean;
  /** How thick the top is. */
  top?: number;
  /** Holes right through the top (a grille's slots), in the top's x and z. */
  holes?: THREE.Path[];
  /** Pins under a 1-wide part; left out where they would show through holes. */
  pins?: boolean;
}

/** A top and four walls, open underneath, `w` by `h` by `d` round the origin. */
function hollowShell(
  w: number,
  h: number,
  d: number,
  { groove = false, top = TOP, holes = [] }: ShellOptions = {},
): THREE.BufferGeometry[] {
  const g = groove ? GROOVE : 0;
  // The four walls are one ring, so each side of the brick is one face: walls made of
  // separate boxes met partway along the sides and showed there as faint lines.
  const ring = (rw: number, rd: number, wall: number, depth: number) => {
    const s = rect(rw, rd);
    s.holes.push(rect(rw - 2 * wall, rd - 2 * wall));
    return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }).rotateX(-Math.PI / 2);
  };
  let parts: THREE.BufferGeometry[];
  if (holes.length) {
    const s = rect(w, d);
    s.holes.push(...holes);
    const cap = new THREE.ExtrudeGeometry(s, { depth: top, bevelEnabled: false });
    parts = [
      cap.rotateX(-Math.PI / 2).translate(0, h / 2 - top, 0),
      ring(w, d, WALL, h - top - g).translate(0, -h / 2 + g, 0),
    ];
  } else parts = [capAndWalls(w, d, -h / 2 + g, h / 2, WALL, top)];
  if (g) parts.push(ring(w - 2 * g, d - 2 * g, WALL - g, g).translate(0, -h / 2, 0));
  return parts;
}

/**
 * A top and four walls in one, `w` by `d`, from `y0` up to `y1`: each outer side is one face
 * from bottom to top. A top stacked on a ring of walls had a seam round the sides a top's
 * thickness down, and the outline drawn round a brick showed it as a line.
 */
function capAndWalls(
  w: number,
  d: number,
  y0: number,
  y1: number,
  wall: number,
  top: number,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const quad = (vs: THREE.Vector3[], out: THREE.Vector3) => {
    const [a, b, c] = vs as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
    const face = b.clone().sub(a).cross(c.clone().sub(a));
    for (const k of face.dot(out) >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) {
      pos.push(vs[k]!.x, vs[k]!.y, vs[k]!.z);
      nrm.push(out.x, out.y, out.z);
    }
  };
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const [ox, oz] = [w / 2, d / 2];
  const [ix, iz] = [ox - wall, oz - wall];
  const yc = y1 - top;
  const rectAt = (x: number, z: number, y: number) => [
    v(-x, y, -z),
    v(x, y, -z),
    v(x, y, z),
    v(-x, y, z),
  ];
  quad(rectAt(ox, oz, y1), v(0, 1, 0));
  quad(rectAt(ix, iz, yc), v(0, -1, 0));
  const outer = rectAt(ox, oz, 0);
  const inner = rectAt(ix, iz, 0);
  for (let k = 0; k < 4; k++) {
    const l = (k + 1) % 4;
    const [a, b, p, q] = [outer[k]!, outer[l]!, inner[k]!, inner[l]!];
    const out = a.clone().add(b).setY(0).normalize();
    out.set(Math.round(out.x), 0, Math.round(out.z));
    const at = (u: THREE.Vector3, y: number) => v(u.x, y, u.z);
    quad([at(a, y0), at(b, y0), at(b, y1), at(a, y1)], out);
    quad([at(p, y0), at(q, y0), at(q, yc), at(p, yc)], out.clone().negate());
    quad([at(a, y0), at(b, y0), at(q, y0), at(p, y0)], v(0, -1, 0));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

/**
 * A window frame `w` by `h` by `d` round the origin: posts and rails round the opening, the
 * bottom rail hollow underneath to sit on studs. Its front and back are each one face, so no
 * lines show where the posts meet the rails.
 */
function windowFrame(w: number, h: number, d: number): THREE.BufferGeometry {
  const [post, rail] = [WINDOW_POST, WINDOW_RAIL];
  const pos: number[] = [];
  const nrm: number[] = [];
  const add = (g: THREE.BufferGeometry) => {
    const n = g.index ? g.toNonIndexed() : g;
    pos.push(...n.getAttribute('position').array);
    nrm.push(...n.getAttribute('normal').array);
  };
  // Front and back: the frame's outline with the opening cut out.
  const face = rect(w, h);
  face.holes.push(rect(w - 2 * post, h - 2 * rail));
  add(new THREE.ShapeGeometry(face).translate(0, 0, d / 2));
  add(new THREE.ShapeGeometry(face).rotateY(Math.PI).translate(0, 0, -d / 2));
  // A box's face toward `dir`, `a` by `b`, at `at`.
  const plane = (a: number, b: number, at: THREE.Vector3, dir: THREE.Vector3) => {
    const g = new THREE.PlaneGeometry(a, b);
    g.lookAt(dir);
    add(g.translate(at.x, at.y, at.z));
  };
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // Outside: the two ends and the top.
  plane(d, h, v(-w / 2, 0, 0), v(-1, 0, 0));
  plane(d, h, v(w / 2, 0, 0), v(1, 0, 0));
  plane(w, d, v(0, h / 2, 0), v(0, 1, 0));
  // Round the opening, facing into it.
  const ow = w - 2 * post;
  const oh = h - 2 * rail;
  plane(d, oh, v(-ow / 2, 0, 0), v(1, 0, 0));
  plane(d, oh, v(ow / 2, 0, 0), v(-1, 0, 0));
  plane(ow, d, v(0, oh / 2, 0), v(0, -1, 0));
  plane(ow, d, v(0, -oh / 2, 0), v(0, 1, 0));
  // The bottom rail's hollow: a rim underneath, walls inside and a ceiling.
  const y0 = -h / 2;
  const ceiling = y0 + rail - TOP;
  const [iw, id] = [w - 2 * WALL, d - 2 * WALL];
  const rim = rect(w, d);
  rim.holes.push(rect(iw, id));
  add(new THREE.ShapeGeometry(rim).rotateX(Math.PI / 2).translate(0, y0, 0));
  plane(iw, id, v(0, ceiling, 0), v(0, -1, 0));
  const tall = ceiling - y0;
  plane(id, tall, v(-iw / 2, y0 + tall / 2, 0), v(1, 0, 0));
  plane(id, tall, v(iw / 2, y0 + tall / 2, 0), v(-1, 0, 0));
  plane(iw, tall, v(0, y0 + tall / 2, -id / 2), v(0, 0, 1));
  plane(iw, tall, v(0, y0 + tall / 2, id / 2), v(0, 0, -1));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

/** A rectangle round the origin, in a shape's x and y. */
function rect(w: number, d: number): THREE.Shape {
  return new THREE.Shape()
    .moveTo(-w / 2, -d / 2)
    .lineTo(w / 2, -d / 2)
    .lineTo(w / 2, d / 2)
    .lineTo(-w / 2, d / 2)
    .closePath();
}

/**
 * A hollow box like a real brick's: a shell, with tubes where four studs meet under parts two
 * or more wide, so a stud below is clutched between tube and wall, and pins between the studs
 * of 1-wide ones.
 */
function hollowBox(
  t: BrickType,
  w: number,
  h: number,
  d: number,
  opts: ShellOptions = {},
): THREE.BufferGeometry[] {
  const parts = hollowShell(w, h, d, opts);
  const inner = h - (opts.top ?? TOP);
  const x0 = -(t.studsX * STUD) / 2;
  const z0 = -(t.studsZ * STUD) / 2;
  // A rib on each wall in front of every stud along it, sunk a little into the wall.
  const deep = RIB + WALL / 2;
  const y = -h / 2 + inner / 2;
  for (const side of [-1, 1]) {
    const atZ = side * (d / 2 - WALL / 2 - deep / 2);
    const atX = side * (w / 2 - WALL / 2 - deep / 2);
    for (let x = 0; x < t.studsX; x++)
      parts.push(
        new THREE.BoxGeometry(RIB_WIDTH, inner, deep).translate(x0 + (x + 0.5) * STUD, y, atZ),
      );
    for (let z = 0; z < t.studsZ; z++)
      parts.push(
        new THREE.BoxGeometry(deep, inner, RIB_WIDTH).translate(atX, y, z0 + (z + 0.5) * STUD),
      );
  }
  if (t.studsX > 1 && t.studsZ > 1) {
    const tube = tubeGeometry(TUBE_OUTER, TUBE_INNER, inner);
    for (let x = 1; x < t.studsX; x++) {
      for (let z = 1; z < t.studsZ; z++) {
        parts.push(tube.clone().translate(x0 + x * STUD, -h / 2, z0 + z * STUD));
      }
    }
  } else if (opts.pins !== false) {
    const pin = new THREE.CylinderGeometry(PIN_RADIUS, PIN_RADIUS, inner, SEGMENTS);
    for (let i = 1; i < Math.max(t.studsX, t.studsZ); i++) {
      const along = i * STUD;
      parts.push(
        pin
          .clone()
          .translate(
            t.studsX > 1 ? x0 + along : 0,
            -h / 2 + inner / 2,
            t.studsZ > 1 ? z0 + along : 0,
          ),
      );
    }
  }
  return parts;
}

/**
 * A solid turned round the y axis. `profile` is its cross-section in (radius, y), gone round
 * anticlockwise: outward along the bottom, up the outside, back in over the top and down any
 * bore. Stretches along the axis close it and draw nothing.
 */
function revolve(profile: [number, number][], segments = ROUND_SEGMENTS): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  for (let i = 0; i < profile.length; i++) {
    const [r0, y0] = profile[i]!;
    const [r1, y1] = profile[(i + 1) % profile.length]!;
    const len = Math.hypot(r1 - r0, y1 - y0);
    if (len === 0 || (r0 === 0 && r1 === 0)) continue;
    // Outward is to the right of the way round; smooth round the axis, sharp along the profile.
    const nr = (y1 - y0) / len;
    const ny = -(r1 - r0) / len;
    for (let s = 0; s < segments; s++) {
      const a = [(s / segments) * Math.PI * 2, ((s + 1) / segments) * Math.PI * 2];
      const v = (r: number, y: number, k: number) => [r * Math.cos(a[k]!), y, r * Math.sin(a[k]!)];
      const n = (k: number) => [nr * Math.cos(a[k]!), ny, nr * Math.sin(a[k]!)];
      for (const [p, k] of [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
        [1, 1],
        [0, 1],
      ] as const) {
        pos.push(...(p ? v(r1, y1, k) : v(r0, y0, k)));
        nrm.push(...n(k));
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

/** The cross-shaped hole an axle fits, round (`x`, `y`) in a shape's plane. */
function axleHole(x = 0, y = 0): THREE.Path {
  const a = AXLE / 2;
  const b = AXLE_ARM / 2;
  const p = new THREE.Path().moveTo(x + b, y + b);
  for (const [px, py] of [
    [a, b],
    [a, -b],
    [b, -b],
    [b, -a],
    [-b, -a],
    [-b, -b],
    [-a, -b],
    [-a, b],
    [-b, b],
    [-b, a],
    [b, a],
  ] as const)
    p.lineTo(x + px, y + py);
  return p.closePath();
}

/** A shape stood up: extruded `depth` up the y axis from y = 0, its y along -z. */
function upright(shape: THREE.Shape, depth: number, curveSegments = 24): THREE.BufferGeometry {
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments }).rotateX(
    -Math.PI / 2,
  );
}

/** How high the notches under round and curved walls reach: over a stud, with a little room. */
const NOTCH = STUD_HEIGHT + PLATE_H * 0.05;
/** A closed ring of points without points that repeat the one before (or the first). */
function dedupe(ring: THREE.Vector3[]): THREE.Vector3[] {
  const out = ring.filter((v, k) => k === 0 || v.distanceTo(ring[k - 1]!) > 1e-9);
  while (out.length > 1 && out[0]!.distanceTo(out[out.length - 1]!) < 1e-9) out.pop();
  return out;
}

/** How small the bits a notched wall is cut into are, so its notches fit their studs closely. */
const NOTCH_STEP = STUD * 0.02;
/** How many bits across its thickness. */
const NOTCH_ACROSS = 4;

/**
 * A wall round a part's outline, `y0` to `y1` up: the band between the `outer` and `inner`
 * outlines (in a shape's x and -z, point for point alike). Up to `NOTCH` it is cut into small
 * bits and leaves out each one over a stud at one of `studs` (x, z), so a curved wall that
 * crosses a stud below has a notch the stud's shape cut into it, like a real round plate's.
 */
function notchedWall(
  outer: THREE.Vector2[],
  inner: THREE.Vector2[],
  y0: number,
  y1: number,
  studs: { x: number; z: number }[],
  shift = { x: 0, z: 0 },
  cap?: { top: number; holes?: THREE.Vector2[][] },
): THREE.BufferGeometry {
  const m = Math.min(outer.length, inner.length);
  const place = (p: THREE.Vector2) => new THREE.Vector3(p.x + shift.x, 0, -p.y + shift.z);
  // Cut along into short pieces.
  const o: THREE.Vector3[] = [];
  const i: THREE.Vector3[] = [];
  for (let k = 0; k < m; k++) {
    const [o0, o1] = [place(outer[k]!), place(outer[(k + 1) % m]!)];
    const [i0, i1] = [place(inner[k]!), place(inner[(k + 1) % m]!)];
    const pieces = Math.max(
      1,
      Math.ceil(Math.max(o0.distanceTo(o1), i0.distanceTo(i1)) / NOTCH_STEP),
    );
    for (let s = 0; s < pieces; s++) {
      o.push(o0.clone().lerp(o1, s / pieces));
      i.push(i0.clone().lerp(i1, s / pieces));
    }
  }
  const n = o.length;
  const J = NOTCH_ACROSS;
  // Point j of J across the wall at point k along it, from the outside in.
  const P = (k: number, j: number) => o[k % n]!.clone().lerp(i[k % n]!, j / J);
  // A bit is cut away where any of it is over a stud.
  const over = (p: THREE.Vector3) =>
    studs.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < STUD_RADIUS);
  const cut = (k: number, j: number) => {
    const kk = ((k % n) + n) % n;
    if (j < 0 || j >= J) return false;
    return [P(kk, j), P(kk + 1, j), P(kk + 1, j + 1), P(kk, j + 1)].some(over);
  };
  const cuts = Array.from({ length: n }, (_, k) => Array.from({ length: J }, (_, j) => cut(k, j)));
  const isCut = (k: number, j: number) => j >= 0 && j < J && cuts[((k % n) + n) % n]![j]!;
  const pos: number[] = [];
  const nrm: number[] = [];
  // A quad a, b, c, d, wound so it faces `out`, with a normal for each corner (flat if none).
  const quad = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    out: THREE.Vector3,
    normals?: THREE.Vector3[],
  ) => {
    const ns = normals ?? [out, out, out, out].map((v) => v.clone().normalize());
    const face = b.clone().sub(a).cross(c.clone().sub(a));
    const order = face.dot(out) >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    const vs = [a, b, c, d];
    for (const k of order) {
      pos.push(vs[k]!.x, vs[k]!.y, vs[k]!.z);
      nrm.push(ns[k]!.x, ns[k]!.y, ns[k]!.z);
    }
  };
  const up = new THREE.Vector3(0, 1, 0);
  const down = new THREE.Vector3(0, -1, 0);
  const at = (v: THREE.Vector3, y: number) => new THREE.Vector3(v.x, y, v.z);
  // The wall's sides are smooth: each point's normal is the way the band is offset there.
  const side = o.map((p, k) => p.clone().sub(i[k]!).normalize());
  const yn = y0 + NOTCH;
  // With a cap, the inside stops under it.
  const yi = cap ? y1 - cap.top : y1;
  // The wall's outside and inside, each one face from the bottom (or a notch's top) up, so no
  // line shows round them where the notched bottom meets the rest.
  for (let k = 0; k < n; k++) {
    const l = (k + 1) % n;
    const [ok, ol, ik, il] = [o[k]!, o[l]!, i[k]!, i[l]!];
    const [sk, sl] = [side[k]!, side[l]!];
    const [nk, nl] = [sk.clone().negate(), sl.clone().negate()];
    const outward = ok.clone().add(ol).sub(ik).sub(il);
    if (!cap) quad(at(ok, y1), at(ol, y1), at(il, y1), at(ik, y1), up);
    const yo = cuts[k]![0] ? yn : y0;
    quad(at(ok, yo), at(ol, yo), at(ol, y1), at(ok, y1), outward, [sk, sl, sl, sk]);
    const yb = cuts[k]![J - 1] ? yn : y0;
    const inward = outward.clone().negate();
    quad(at(ik, yb), at(il, yb), at(il, yi), at(ik, yi), inward, [nk, nl, nl, nk]);
  }
  if (cap) {
    // One top over the whole outline, so no seam shows where a wall's top would meet a cap's,
    // and a ceiling under it inside the walls; holes go through both.
    const holes = (cap.holes ?? []).map((h) => dedupe(h.map(place)));
    const flat = (v: THREE.Vector3) => new THREE.Vector2(v.x, v.z);
    const face = (ring: THREE.Vector3[], y: number, out: THREE.Vector3) => {
      const contour = dedupe(ring);
      const all = [...contour, ...holes.flat()];
      const tris = THREE.ShapeUtils.triangulateShape(
        contour.map(flat),
        holes.map((h) => h.map(flat)),
      );
      for (const t of tris) {
        const [a, b, c] = t.map((k) => at(all[k]!, y)) as [
          THREE.Vector3,
          THREE.Vector3,
          THREE.Vector3,
        ];
        const n = b.clone().sub(a).cross(c.clone().sub(a));
        for (const v of n.dot(out) >= 0 ? [a, b, c] : [a, c, b]) {
          pos.push(v.x, v.y, v.z);
          nrm.push(out.x, out.y, out.z);
        }
      }
    };
    face(o, y1, up);
    face(i, yi, down);
    // The holes' sides, facing into each hole: to the right of each edge going round it
    // anticlockwise (seen from above), to the left going clockwise.
    for (const h of holes) {
      const clockwise = THREE.ShapeUtils.isClockWise(h.map(flat));
      for (let k = 0; k < h.length; k++) {
        const [a, b] = [h[k]!, h[(k + 1) % h.length]!];
        const e = b.clone().sub(a);
        const left = new THREE.Vector3(e.z, 0, -e.x);
        quad(at(a, yi), at(b, yi), at(b, y1), at(a, y1), clockwise ? left : left.negate());
      }
    }
  }
  // Under the notches' tops, every bit not over a stud: its bottom, and faces where it meets a
  // notch; over a cut bit, the notch's ceiling.
  for (let k = 0; k < n; k++) {
    const l = k + 1;
    const along = P(l, 0).sub(P(k, 0));
    for (let j = 0; j < J; j++) {
      const [a, b, c, d] = [P(k, j), P(l, j), P(l, j + 1), P(k, j + 1)];
      if (cuts[k]![j]) {
        quad(at(a, yn), at(b, yn), at(c, yn), at(d, yn), down);
        continue;
      }
      const outward = a.clone().add(b).sub(c).sub(d);
      quad(at(a, y0), at(b, y0), at(c, y0), at(d, y0), down);
      if (isCut(k, j - 1)) quad(at(a, y0), at(b, y0), at(b, yn), at(a, yn), outward);
      if (isCut(k, j + 1))
        quad(at(d, y0), at(c, y0), at(c, yn), at(d, yn), outward.clone().negate());
      if (isCut(k - 1, j)) quad(at(a, y0), at(d, y0), at(d, yn), at(a, yn), along.clone().negate());
      if (isCut(k + 1, j)) quad(at(b, y0), at(c, y0), at(c, yn), at(b, yn), along);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

/** A circle `r` round the origin, in a shape's x and y, anticlockwise. */
function circlePoints(r: number, segments = ROUND_SEGMENTS * 2): THREE.Vector2[] {
  return Array.from({ length: segments }, (_, k) => {
    const a = (k / segments) * Math.PI * 2;
    return new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r);
  });
}

/** Where studs below stand under a part's cells, in its own frame round its centre. */
function studsBelow(t: BrickType): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let x = 0; x < t.studsX; x++)
    for (let z = 0; z < t.studsZ; z++)
      out.push({ x: (x + 0.5 - t.studsX / 2) * STUD, z: (z + 0.5 - t.studsZ / 2) * STUD });
  return out;
}

/**
 * A round part `h` high and `r` across, hollow underneath like a real round plate or brick: a
 * wall round the outside, a top, and in the middle a tube that grips a stud (`'stud'`) or one
 * with an axle hole through it and the top (`'axle'`).
 */
function roundShell(
  r: number,
  h: number,
  centre: 'stud' | 'axle',
  studs: { x: number; z: number }[] = [],
): THREE.BufferGeometry[] {
  const ri = r - ROUND_WALL;
  const inner = h - TOP;
  // Its top is one with the wall; an axle hole goes through it and the tube.
  const holes = centre === 'axle' ? [axleHole().getPoints()] : [];
  const parts = [
    notchedWall(circlePoints(r), circlePoints(ri), -h / 2, h / 2, studs, undefined, {
      top: TOP,
      holes,
    }),
  ];
  if (centre === 'axle') {
    const tube = new THREE.Shape().absarc(0, 0, TUBE_OUTER, 0, Math.PI * 2, false);
    tube.holes.push(axleHole());
    parts.push(upright(tube, inner, 8).translate(0, -h / 2, 0));
  } else parts.push(tubeGeometry(TUBE_OUTER, TUBE_INNER, inner).translate(0, -h / 2, 0));
  return parts;
}

/**
 * A hollow prism: `profile` (as for `prism`, its first edge the bottom from back to front)
 * made a shell, its top and sides `TOP` and `WALL` thick, open along the bottom.
 */
function shellPrism(profile: [number, number][], w: number): THREE.BufferGeometry[] {
  const p = profile.filter((q, i) => {
    const prev = profile[(i - 1 + profile.length) % profile.length]!;
    return Math.hypot(q[0] - prev[0], q[1] - prev[1]) > 1e-9;
  });
  const n = p.length;
  // Each edge moved inward (to its left, the profile going anticlockwise) by its thickness.
  const lines = p.map((a, i) => {
    const b = p[(i + 1) % n]!;
    const dz = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dz, dy);
    const thick = i === 0 ? 0 : Math.abs(dz) < 1e-9 ? WALL : TOP;
    return { z: a[0] - (dy / len) * thick, y: a[1] + (dz / len) * thick, dz, dy };
  });
  const inner = p.map((_, i) => {
    const l1 = lines[(i - 1 + n) % n]!;
    const l2 = lines[i]!;
    const cross = l1.dz * l2.dy - l1.dy * l2.dz;
    if (Math.abs(cross) < 1e-12) return [l2.z, l2.y] as [number, number];
    const s = ((l2.z - l1.z) * l2.dy - (l2.y - l1.y) * l2.dz) / cross;
    return [l1.z + s * l1.dz, l1.y + s * l1.dy] as [number, number];
  });
  // The outside and the inside are each one prism without its bottom (pieced together, their
  // seams showed as faint lines across the top), the inside turned inside out, and a flat
  // rim between them underneath.
  const bottom = p[0]![1];
  const open = (g: THREE.BufferGeometry, inward: boolean) => {
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    const keep: number[] = [];
    const keepN: number[] = [];
    for (let i = 0; i < pos.count; i += 3) {
      if (nrm.getY(i) < -0.99 && Math.abs(pos.getY(i) - bottom) < 1e-9) continue;
      for (const k of inward ? [0, 2, 1] : [0, 1, 2]) {
        keep.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
        const f = inward ? -1 : 1;
        keepN.push(f * nrm.getX(i + k), f * nrm.getY(i + k), f * nrm.getZ(i + k));
      }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(keepN, 3));
    return out;
  };
  const rim = new THREE.Shape()
    .moveTo(-w / 2, p[0]![0])
    .lineTo(w / 2, p[0]![0])
    .lineTo(w / 2, p[1]![0])
    .lineTo(-w / 2, p[1]![0])
    .closePath();
  rim.holes.push(
    new THREE.Path()
      .moveTo(-w / 2 + WALL, inner[0]![0])
      .lineTo(-w / 2 + WALL, inner[1]![0])
      .lineTo(w / 2 - WALL, inner[1]![0])
      .lineTo(w / 2 - WALL, inner[0]![0])
      .closePath(),
  );
  return [
    open(prism(p, w), false),
    open(prism(inner, w - 2 * WALL), true),
    new THREE.ShapeGeometry(rim).rotateX(Math.PI / 2).translate(0, bottom, 0),
  ];
}

/** The height of a profile's top at `z`. */
function topAt(profile: [number, number][], z: number): number {
  let top = -Infinity;
  for (let i = 1; i < profile.length; i++) {
    const [z0, y0] = profile[i]!;
    const [z1, y1] = profile[(i + 1) % profile.length]!;
    if (z0 === z1 || z < Math.min(z0, z1) || z > Math.max(z0, z1)) continue;
    top = Math.max(top, y0 + ((z - z0) / (z1 - z0)) * (y1 - y0));
  }
  return top;
}

/** A sloped part: its hollow shell, with tubes under it where four studs meet. */
function slopedParts(t: BrickType, profile: [number, number][], w: number, h: number) {
  const parts = shellPrism(profile, w);
  if (t.studsX > 1 && t.studsZ > 1) {
    const x0 = -(t.studsX * STUD) / 2;
    const z0 = -(t.studsZ * STUD) / 2;
    for (let z = 1; z < t.studsZ; z++) {
      const at = z0 + z * STUD;
      // Up to the underside of the top at its lower edge.
      const tall =
        Math.min(topAt(profile, at - TUBE_OUTER), topAt(profile, at + TUBE_OUTER)) -
        TOP * 1.5 +
        h / 2;
      for (let x = 1; x < t.studsX; x++)
        parts.push(tubeGeometry(TUBE_OUTER, TUBE_INNER, tall).translate(x0 + x * STUD, -h / 2, at));
    }
  }
  return parts;
}

/**
 * Outline of a 3x3 round corner plate, `inset` in from its edge, in a shape's x and -z with its
 * square corner at the origin: straight for a stud along each outer side, then round on a
 * 2-stud radius about the middle of the corner cell (1, 1), like the real part (30357).
 */
function roundedCorner(far: number, inset: number): THREE.Shape {
  const c = STUD - GAP / 2;
  return new THREE.Shape()
    .moveTo(inset, -inset)
    .lineTo(far - inset, -inset)
    .lineTo(far - inset, -c)
    .absarc(c, -c, far - c - inset, 0, -Math.PI / 2, true)
    .lineTo(inset, -(far - inset))
    .closePath();
}

/** Outline of a quarter band between radius `hole` and `r` round the origin, `inset` in. */
function quarterBand(r: number, hole: number, inset: number): THREE.Shape {
  const ro = r - inset;
  const ri = hole + inset;
  const ao = Math.asin(inset / ro);
  const ai = Math.asin(inset / ri);
  return new THREE.Shape()
    .moveTo(Math.sqrt(ri * ri - inset * inset), -inset)
    .lineTo(Math.sqrt(ro * ro - inset * inset), -inset)
    .absarc(0, 0, ro, -ao, -(Math.PI / 2 - ao), true)
    .lineTo(inset, -Math.sqrt(ri * ri - inset * inset))
    .absarc(0, 0, ri, -(Math.PI / 2 - ai), -ai, false)
    .closePath();
}

/** Merges parts into one geometry, with `userData.body` the solid body's box. */
function merge(parts: THREE.BufferGeometry[], w: number, h: number, d: number) {
  // Box, cylinder and extruded geometries carry different attribute sets; keep only these.
  for (const p of parts) {
    for (const name of Object.keys(p.attributes)) {
      if (name !== 'position' && name !== 'normal') p.deleteAttribute(name);
    }
  }
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
  g.computeBoundingSphere();
  g.userData.body = new THREE.Box3(
    new THREE.Vector3(-w / 2, -h / 2, -d / 2),
    new THREE.Vector3(w / 2, h / 2, d / 2),
  );
  return g;
}

const SIDE_DIRS: Record<Facing, THREE.Vector3> = {
  '+x': new THREE.Vector3(1, 0, 0),
  '-x': new THREE.Vector3(-1, 0, 0),
  '+z': new THREE.Vector3(0, 0, 1),
  '-z': new THREE.Vector3(0, 0, -1),
};

/**
 * Side studs, and the flange a bracket's studs stand on: half a plate thick in front of the
 * body's side, one stud high round its studs. In the part's own frame, centred on its body
 * (`h` is the body's height). A stud's base stands as far off the body's side as its `out`
 * says, so a headlight brick's sits in its recess.
 */
function sideStudParts(t: BrickType, h: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  // Flanges, one for each row of studs side by side (built a stud at a time, the gaps
  // between the pieces showed as dark slits down the flange): stud cells along the row, by
  // the row's direction, height and line.
  const rows = new Map<
    string,
    { dir: THREE.Vector3; cy: number; line: number; thick: number; at: number[] }
  >();
  for (const s of t.sideStuds ?? []) {
    const dir = SIDE_DIRS[s.dir];
    const cx = (s.x + 0.5) * STUD - (t.studsX * STUD) / 2;
    const cz = (s.z + 0.5) * STUD - (t.studsZ * STUD) / 2;
    const cy = -h / 2 + s.y * PLATE_H;
    const off = (s.out ?? 0) * PLATE_H;
    // Out to the body's side in the stud's direction, then on to the stud's base.
    const side = new THREE.Vector3(cx + (dir.x * STUD) / 2, cy, cz + (dir.z * STUD) / 2);
    const face = side.clone().addScaledVector(dir, off);
    if (off > 0) {
      const line = dir.x ? side.x : side.z;
      const key = `${s.dir}|${cy}|${line}`;
      let row = rows.get(key);
      if (!row) rows.set(key, (row = { dir, cy, line, thick: off, at: [] }));
      row.at.push(dir.x ? s.z : s.x);
    }
    const stud = new THREE.CylinderGeometry(STUD_RADIUS, STUD_RADIUS, STUD_HEIGHT, 12);
    // A cylinder stands along y: lay it along the stud's direction.
    if (dir.x) stud.rotateZ(-Math.sign(dir.x) * (Math.PI / 2));
    else stud.rotateX(Math.sign(dir.z) * (Math.PI / 2));
    stud.translate(face.x + (dir.x * STUD_HEIGHT) / 2, cy, face.z + (dir.z * STUD_HEIGHT) / 2);
    out.push(stud);
  }
  // Runs of cells next to each other, each one flange; flanges stacked one on another (a
  // bracket with two rows of studs) are one piece.
  const flanges: {
    dir: THREE.Vector3;
    line: number;
    thick: number;
    from: number;
    to: number;
    y0: number;
    y1: number;
  }[] = [];
  for (const { dir, cy, line, thick, at } of rows.values()) {
    const cells = [...new Set(at)].sort((a, b) => a - b);
    const half = ((dir.x ? t.studsZ : t.studsX) * STUD) / 2;
    for (let i = 0; i < cells.length;) {
      let j = i;
      while (j + 1 < cells.length && cells[j + 1] === cells[j]! + 1) j++;
      const from = cells[i]! * STUD - half + GAP / 2;
      const to = (cells[j]! + 1) * STUD - half - GAP / 2;
      const [y0, y1] = [cy - (STUD - GAP) / 2, cy + (STUD - GAP) / 2];
      const below = flanges.find(
        (f) =>
          f.dir.equals(dir) &&
          f.line === line &&
          f.thick === thick &&
          f.from === from &&
          f.to === to &&
          Math.min(Math.abs(f.y0 - y1), Math.abs(y0 - f.y1)) < 2 * GAP,
      );
      if (below) [below.y0, below.y1] = [Math.min(below.y0, y0), Math.max(below.y1, y1)];
      else flanges.push({ dir, line, thick, from, to, y0, y1 });
      i = j + 1;
    }
  }
  for (const { dir, line, thick, from, to, y0, y1 } of flanges) {
    // From the body's side (half a gap in from the cell's), so it meets the body.
    const deep = thick + GAP / 2;
    const flange = new THREE.BoxGeometry(
      dir.x ? deep : to - from,
      y1 - y0,
      dir.z ? deep : to - from,
    );
    const mid = (from + to) / 2;
    const at = line + ((dir.x || dir.z) * (thick - GAP / 2)) / 2;
    flange.translate(dir.x ? at : mid, (y0 + y1) / 2, dir.z ? at : mid);
    out.push(flange);
  }
  return out;
}

/** A stud on top of cell (x, z) of a part whose body is `h` high. */
function topStud(t: BrickType, x: number, z: number, h: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(STUD_RADIUS, STUD_RADIUS, STUD_HEIGHT, 12).translate(
    (x + 0.5) * STUD - (t.studsX * STUD) / 2,
    h / 2 + STUD_HEIGHT / 2,
    (z + 0.5) * STUD - (t.studsZ * STUD) / 2,
  );
}

/**
 * A prism whose side profile (in the part's z-y plane, z toward the front) is `profile`,
 * running the part's whole width along x.
 */
function prism(profile: [number, number][], w: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(profile.map(([z, y]) => new THREE.Vector2(-z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false, curveSegments: 8 });
  // Extruded along +z from 0; turned so the extrusion runs along x and the profile's z is z.
  g.rotateY(Math.PI / 2);
  g.translate(-w / 2, 0, 0);
  return g;
}

/** Geometry of every part that is not a plain box with studs. */
function shapedGeometry(t: BrickType): THREE.BufferGeometry {
  const w = t.studsX * STUD - GAP;
  const h = t.plates * PLATE_H - GAP;
  const d = t.studsZ * STUD - GAP;
  const parts: THREE.BufferGeometry[] = [];
  const studsOnTop = () => {
    for (let x = 0; x < t.studsX; x++)
      for (let z = 0; z < t.studsZ; z++)
        if (hasTopStud(t.id, x, z)) parts.push(topStud(t, x, z, h));
  };
  // Heights in a real part's units (LDraw's: a brick is 24 high, a plate 8), from the bottom.
  const ldu = (y: number) => -h / 2 + (y / (t.plates * 8)) * h;
  const top = h / 2;
  switch (t.shape) {
    case 'tile':
      parts.push(...hollowBox(t, w, h, d, { groove: true }));
      break;
    case 'grille': {
      // Two slots right through a thick top, either side of a bar down the middle (2412b).
      const slot = (z0: number, z1: number) =>
        new THREE.Path()
          .moveTo(-STUD * 0.8, z0)
          .lineTo(STUD * 0.8, z0)
          .lineTo(STUD * 0.8, z1)
          .lineTo(-STUD * 0.8, z1)
          .closePath();
      parts.push(
        ...hollowBox(t, w, h, d, {
          groove: true,
          top: h / 2,
          holes: [slot(STUD * 0.1, STUD * 0.3), slot(-STUD * 0.3, -STUD * 0.1)],
          pins: false,
        }),
      );
      break;
    }
    case 'round': {
      const r = (Math.min(t.studsX, t.studsZ) * STUD) / 2 - GAP;
      if (t.studsX > 1) {
        // 2x2: hollow, with an axle hole through the middle (4032, 3941); the tile has a
        // plain stud holder under its smooth top (14769).
        parts.push(...roundShell(r, h, hasTopStud(t.id, 0, 0) ? 'axle' : 'stud', studsBelow(t)));
        studsOnTop();
        break;
      }
      // 1x1: a narrower foot under the round, and a stud's bore up into it (6141, 98138,
      // 3062b). The round brick's stud is open, with a hole down into it.
      const plate = t.plates === 1;
      // A tall foot under a thin flange (6141, 98138, 3062b): narrow enough to go between
      // four studs.
      const foot = ldu(5);
      const profile: [number, number][] = [
        [TUBE_INNER, ldu(0)],
        [FOOT, ldu(0)],
        [FOOT, foot],
        [r, foot],
        [r, top],
      ];
      // An open stud has a hole down into it, that a fern's stem goes into.
      if (!hasTopStud(t.id, 0, 0)) profile.push([0, top]);
      else
        profile.push(
          [STUD_RADIUS, top],
          [STUD_RADIUS, top + STUD_HEIGHT],
          [HOLE, top + STUD_HEIGHT],
          [HOLE, plate ? ldu(6) : ldu(20)],
          [0, plate ? ldu(6) : ldu(20)],
        );
      const bore = plate ? ldu(5) : ldu(17);
      profile.push([0, bore], [TUBE_INNER, bore]);
      parts.push(revolve(profile));
      break;
    }
    case 'cone': {
      // Tapering from a stud wide at the bottom to a stud's width at the top, on a narrower
      // foot, with an open stud whose hole takes a bar, and a stud's bore underneath (4589).
      const r = STUD / 2 - GAP;
      parts.push(
        revolve([
          [TUBE_INNER, ldu(0)],
          [FOOT, ldu(0)],
          [FOOT, ldu(5)],
          [r, ldu(5)],
          [STUD_RADIUS, top],
          [STUD_RADIUS, top + STUD_HEIGHT],
          [HOLE, top + STUD_HEIGHT],
          [HOLE, ldu(14)],
          [0, ldu(14)],
          [0, ldu(6)],
          [TUBE_INNER, ldu(6)],
        ]),
      );
      break;
    }
    case 'dish': {
      // A shallow bowl, open side up, on a foot with a stud's bore; in the bowl a recessed
      // open stud that takes a bar (4740).
      const r = (Math.min(t.studsX, t.studsZ) * STUD) / 2 - GAP;
      const l = STUD / 20;
      parts.push(
        revolve([
          [TUBE_INNER, ldu(0)],
          [FOOT, ldu(0)],
          [FOOT, ldu(1.5)],
          [r, ldu(7.5)],
          [r, top],
          [r - 1.2 * l, top],
          [7.5 * l, ldu(3.5)],
          [STUD_RADIUS, ldu(3.5)],
          [STUD_RADIUS, ldu(7)],
          [HOLE, ldu(7)],
          [HOLE, ldu(4)],
          [0, ldu(4)],
          [0, ldu(2.5)],
          [TUBE_INNER, ldu(2.5)],
        ]),
      );
      break;
    }
    case 'slope': {
      // Flat on top over the back row (z = 0), then down at 45 degrees to a lip at the front.
      const back = -d / 2;
      const lip = PLATE_H * 0.8;
      const profile: [number, number][] = [
        [back, -h / 2],
        [d / 2, -h / 2],
        [d / 2, -h / 2 + lip],
        [back + STUD, h / 2],
        [back, h / 2],
      ];
      parts.push(...slopedParts(t, profile, w, h));
      studsOnTop();
      break;
    }
    case 'cheese':
      // Its low front edge is over half a plate high, so the inside clears the stud under it.
      parts.push(
        ...slopedParts(
          t,
          [
            [-d / 2, -h / 2],
            [d / 2, -h / 2],
            [d / 2, -h / 2 + PLATE_H * 0.6],
            [-d / 2, h / 2],
          ],
          w,
          h,
        ),
      );
      break;
    case 'curve': {
      const profile: [number, number][] = [
        [-d / 2, -h / 2],
        [d / 2, -h / 2],
      ];
      // A quarter-round top falling from the back to a low front.
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * (Math.PI / 2);
        profile.push([d / 2 - d * (1 - Math.cos(a)), -h / 2 + h * 0.2 + h * 0.8 * Math.sin(a)]);
      }
      parts.push(...slopedParts(t, profile, w, h));
      break;
    }
    case 'window': {
      // A frame round the opening (the pane is drawn separately), studs on top. The bottom
      // rail is hollow underneath, to sit on studs.
      parts.push(windowFrame(w, h, d));
      studsOnTop();
      break;
    }
    case 'plant': {
      // A short stem and five leaves fanning out and drooping past the cell.
      parts.push(new THREE.CylinderGeometry(STUD * 0.12, STUD * 0.15, h, 8));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const leaf = new THREE.SphereGeometry(STUD * 0.5, 10, 6);
        leaf.scale(0.45, 0.12, 1);
        leaf.rotateX(0.35);
        leaf.translate(0, h * 0.25, STUD * 0.45);
        leaf.rotateY(a);
        parts.push(leaf);
      }
      break;
    }
    case 'quarter': {
      // Round corner plate (30357): a 3x3 plate with its far corner rounded. Quarter arc tile
      // (79393): a band one stud wide round the (0, 0) corner. Both hollow underneath.
      const far = t.studsX * STUD - GAP;
      const hole = (t.hole ?? 0) * STUD;
      const outline = (inset: number) =>
        hole > 0 ? quarterBand(far, hole, inset) : roundedCorner(far, inset);
      // Its curved walls are notched over the studs they cross.
      parts.push(
        notchedWall(
          outline(0).getPoints(48),
          outline(WALL).getPoints(48),
          -h / 2,
          h / 2,
          studsBelow(t),
          { x: -w / 2, z: -d / 2 },
          { top: TOP },
        ),
      );
      if (!hole) {
        // Tubes where four studs meet, as under a square plate.
        const tube = tubeGeometry(TUBE_OUTER, TUBE_INNER, h - TOP);
        for (const x of [1, 2])
          for (const z of [1, 2])
            parts.push(tube.clone().translate((x - 1.5) * STUD, -h / 2, (z - 1.5) * STUD));
      }
      studsOnTop();
      break;
    }
    case 'flower': {
      // Five round petals round a hub with an open stud, lying flat (98262).
      parts.push(
        revolve([
          [0, -h / 2],
          [STUD * 0.32, -h / 2],
          [STUD * 0.32, top],
          [STUD_RADIUS, top],
          [STUD_RADIUS, top + STUD_HEIGHT],
          [HOLE, top + STUD_HEIGHT],
          [HOLE, top - h * 0.2],
          [0, top - h * 0.2],
        ]),
      );
      // Each petal is flat underneath and domed on top.
      for (let i = 0; i < 5; i++) {
        const dome = new THREE.SphereGeometry(STUD * 0.5, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2);
        const base = new THREE.CircleGeometry(STUD * 0.5, 12).rotateX(Math.PI / 2);
        for (const petal of [dome, base]) {
          petal.scale(0.75, (h / STUD) * 2, 1);
          petal.translate(0, -h / 2, STUD * 0.5);
          petal.rotateY((i / 5) * Math.PI * 2);
          parts.push(petal);
        }
      }
      break;
    }
    case 'spire': {
      // A round foot (hollow, to sit on studs), a collar, a thin mast and two pairs of cross
      // arms near the top.
      const foot = PLATE_H - GAP;
      const r = STUD - GAP;
      parts.push(...roundShell(r, foot, 'stud').map((g) => g.translate(0, -h / 2 + foot / 2, 0)));
      const collar = PLATE_H * 2;
      parts.push(
        new THREE.CylinderGeometry(STUD * 0.3, STUD * 0.36, collar, 16).translate(
          0,
          -h / 2 + foot + collar / 2,
          0,
        ),
      );
      const mast = h - foot - collar;
      parts.push(
        new THREE.CylinderGeometry(STUD * 0.06, STUD * 0.12, mast, 10).translate(
          0,
          -h / 2 + foot + collar + mast / 2,
          0,
        ),
      );
      for (const [at, len] of [
        [0.45, 0.7],
        [0.7, 0.5],
      ] as const) {
        const y = -h / 2 + foot + collar + mast * at;
        parts.push(new THREE.BoxGeometry(STUD * len, STUD * 0.08, STUD * 0.08).translate(0, y, 0));
        parts.push(new THREE.BoxGeometry(STUD * 0.08, STUD * 0.08, STUD * len).translate(0, y, 0));
        parts.push(
          new THREE.CylinderGeometry(STUD * 0.16, STUD * 0.16, STUD * 0.1, 12).translate(
            0,
            y - STUD * 0.25,
            0,
          ),
        );
      }
      break;
    }
    default:
      parts.push(new THREE.BoxGeometry(w, h, d));
  }
  parts.push(...sideStudParts(t, h));
  return merge(parts, w, h, d);
}
/**
 * The one grey every brick is without the colour goggles (Gear Hunt). One grey, not a shade
 * per colour, or players would soon tell dark red from red by its shade.
 */
export const BLIND_GREY = 0x8a8c90;
let colourBlind = false;

/** Whether brick colours are drawn as they are, or all as one grey. */
export function isColourBlind(): boolean {
  return colourBlind;
}

/**
 * Switches every brick material (the bins' sample bricks and held bricks included, since they
 * share these) between its colour and the one grey. Call it whenever the goggles go on or off.
 */
export function setColourBlind(blind: boolean): boolean {
  if (blind === colourBlind) return false;
  colourBlind = blind;
  for (const [colour, m] of materials) m.color.setHex(blind ? BLIND_GREY : COLOURS[colour].hex);
  return true;
}

/** The colour a brick is drawn in: its own, or the one grey without the goggles. */
export function drawnHex(colour: ColourId): number {
  return colourBlind ? BLIND_GREY : COLOURS[colour].hex;
}

/** Whether the theme style is on (see `setThemeGlass`). */
let themeGlass = false;

/**
 * Sets see-through bricks up for the theme style, or back. It draws its outlines and glow from
 * the depth alone, so they write it (drawn after everything solid, that only hides another
 * see-through brick's far side); and it keeps bricks in their own colour where the frame's
 * alpha is lowered, so they lower it under them (see `MARK_BRICKS` in styles.ts).
 */
export function setThemeGlass(on: boolean): void {
  themeGlass = on;
  for (const [colour, m] of materials) if (COLOURS[colour].alpha) glassFor(m, on);
}

function glassFor(m: THREE.MeshStandardMaterial, theme: boolean): void {
  m.depthWrite = theme;
  // The colour blends as usual; the alpha under the brick is scaled down by the brick's.
  m.blending = theme ? THREE.CustomBlending : THREE.NormalBlending;
  m.blendSrc = THREE.SrcAlphaFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
}

/**
 * What metallic bricks reflect: a sky over a dark band below the horizon and a pale floor, with
 * rows of softboxes all round. Metal only reads as metal where its reflection changes, bright to
 * dark across a face and streaking round a stud; an even sky made it look like painted plastic.
 * White throughout, so the reflection takes the brick's own colour and gold reads
 * as gold in every style and theme. Made here rather than taken from the scene, as bricks are
 * drawn by several renderers (the game, the editor, thumbnails), most with no environment.
 */
function studioEnvironment(): THREE.DataTexture {
  const w = 256;
  const h = 128;
  const data = new Float32Array(w * h * 4);
  const smoothstep = THREE.MathUtils.smoothstep;
  const bump = (d: number, width: number) => Math.exp(-((d / width) ** 2));
  for (let y = 0; y < h; y++) {
    const up = ((y + 0.5) / h - 0.5) * Math.PI;
    // A sky brightening upwards over a pale floor, with a dark band just below the horizon.
    let v = up > 0 ? 0.35 + 1.2 * Math.sin(up) : 0.8 - 0.78 * bump(up + 0.08, 0.14);
    // A bright line along the horizon, which edges catch.
    v += 2.5 * bump(up - 0.04, 0.025);
    for (let x = 0; x < w; x++) {
      const across = (x / w) * Math.PI * 2;
      let lit = v;
      // Rows of softboxes all round, a little apart, so a face catches the edge of one or the
      // gap between two from wherever it is seen, and studs streak.
      const panel = smoothstep(Math.cos(across * 4), -0.15, 0.15);
      const rows = bump(up - 0.32, 0.07) + bump(up - 0.62, 0.09) + bump(up - 0.95, 0.12);
      lit += 7 * rows * panel;
      // Bright strips across the floor, which the walls of a brick seen from above catch.
      lit += 4 * (bump(up + 0.45, 0.05) + bump(up + 0.8, 0.07)) * panel;
      // Brighter than the scene's light overall, so metal outshines the plastic around it.
      lit *= 1.25;
      data.set([lit, lit, lit, 1], (y * w + x) * 4);
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

let studio: THREE.DataTexture | undefined;
/** How brightly metal reflects its surroundings: dimmed at night (see `setMetalShine`). */
let shine = 1;

/** Dims what metallic bricks reflect, at night, so they do not shine in the dark. */
export function setMetalShine(level: number): void {
  shine = level;
  for (const [colour, m] of materials) if (COLOURS[colour].metallic) m.envMapIntensity = level;
}

export function brickMaterial(colour: ColourId): THREE.MeshStandardMaterial {
  let m = materials.get(colour);
  if (!m) {
    const { alpha, metallic } = COLOURS[colour];
    m = new THREE.MeshStandardMaterial({
      color: drawnHex(colour),
      roughness: alpha ? 0.15 : metallic ? 0.05 : 0.45,
      ...(metallic
        ? { metalness: 1, envMap: (studio ??= studioEnvironment()), envMapIntensity: shine }
        : {}),
      ...(alpha ? { transparent: true, opacity: alpha } : {}),
    });
    if (alpha) glassFor(m, themeGlass);
    else madeOf(m, Surface.Brick);
    materials.set(colour, m);
  }
  return m;
}

const markerMaterial = new THREE.MeshStandardMaterial({ color: 0xf5c518, roughness: 0.5 });

/**
 * Yellow stripe and arrow on the front edge (+z) of the 16x16 baseplate, in its grid frame.
 * The plate is square, so without it a build could be made a quarter turn off.
 */
export function baseplateMarker(): THREE.Group {
  const g = new THREE.Group();
  const size = 16 * STUD;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(size, PLATE_H * 0.8, 0.006), markerMaterial);
  stripe.position.set(size / 2, PLATE_H / 2, size + 0.003);
  g.add(stripe);
  const arrow = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.012, 3), markerMaterial);
  arrow.position.set(size / 2, 0.006, size + 0.1);
  g.add(arrow);
  return g;
}
