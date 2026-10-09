import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BRICK_TYPES, COLOURS, PLATE_H, STUD, hasTopStud } from '@sar/shared';
import type { BrickType, BrickTypeId, ColourId, Facing } from '@sar/shared';

/** Visual gap between neighbouring bricks so seams are readable. */
const GAP = 0.002;
const STUD_RADIUS = STUD * 0.3;
const STUD_HEIGHT = PLATE_H * 0.45;
// Underside proportions follow a real brick (8 mm pitch): 1.2 mm walls, a 1 mm top,
// 6.51 mm tubes whose bore fits a stud, and 3.2 mm pins under 1-wide bricks.
const WALL = STUD * 0.15;
const TOP = STUD * 0.12;
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

/** A plain brick or plate: a hollow box with studs on top (baseplates are flat underneath). */
function boxGeometry(t: BrickType): THREE.BufferGeometry {
  const w = t.studsX * STUD - GAP;
  const h = t.plates * PLATE_H - GAP;
  const d = t.studsZ * STUD - GAP;
  const parts = t.fixture ? [new THREE.BoxGeometry(w, h, d)] : hollowBox(t, w, h, d);
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
  let cap: THREE.BufferGeometry;
  if (holes.length) {
    const s = rect(w, d);
    s.holes.push(...holes);
    cap = new THREE.ExtrudeGeometry(s, { depth: top, bevelEnabled: false }).rotateX(-Math.PI / 2);
  } else cap = new THREE.BoxGeometry(w, top, d).translate(0, top / 2, 0);
  const parts = [
    cap.translate(0, h / 2 - top, 0),
    ring(w, d, WALL, h - top - g).translate(0, -h / 2 + g, 0),
  ];
  if (g) parts.push(ring(w - 2 * g, d - 2 * g, WALL - g, g).translate(0, -h / 2, 0));
  return parts;
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

/**
 * `outer` with `inner` cut out of it. Three only turns a hole round to match its shape when it
 * has to turn the shape, so the hole is drawn the other way round to the shape here.
 */
function withHole(outer: THREE.Shape, inner: THREE.Shape): THREE.Shape {
  const points = inner.getPoints(12);
  const same =
    THREE.ShapeUtils.isClockWise(outer.getPoints(12)) === THREE.ShapeUtils.isClockWise(points);
  outer.holes.push(new THREE.Path(same ? points.reverse() : points));
  return outer;
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

/**
 * A round part `h` high and `r` across, hollow underneath like a real round plate or brick: a
 * wall round the outside, a top, and in the middle a tube that grips a stud (`'stud'`) or one
 * with an axle hole through it and the top (`'axle'`).
 */
function roundShell(r: number, h: number, centre: 'stud' | 'axle'): THREE.BufferGeometry[] {
  const ri = r - ROUND_WALL;
  const inner = h - TOP;
  const parts = [
    revolve([
      [ri, -h / 2],
      [r, -h / 2],
      [r, h / 2],
      [ri, h / 2],
    ]),
  ];
  if (centre === 'axle') {
    const cap = new THREE.Shape().absarc(0, 0, ri, 0, Math.PI * 2, false);
    cap.holes.push(axleHole());
    const tube = new THREE.Shape().absarc(0, 0, TUBE_OUTER, 0, Math.PI * 2, false);
    tube.holes.push(axleHole());
    parts.push(
      upright(cap, TOP).translate(0, h / 2 - TOP, 0),
      upright(tube, inner, 8).translate(0, -h / 2, 0),
    );
  } else {
    parts.push(
      revolve([
        [0, h / 2 - TOP],
        [ri, h / 2 - TOP],
        [ri, h / 2],
        [0, h / 2],
      ]),
      tubeGeometry(TUBE_OUTER, TUBE_INNER, inner).translate(0, -h / 2, 0),
    );
  }
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
 * Side studs, and the flange a bracket's studs stand on where they reach past its body. In the
 * part's own frame, centred on its body (`w`, `h`, `d` are the body's size).
 */
function sideStudParts(t: BrickType, h: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  // Flanges, one for each row of studs side by side (built a stud at a time, the gaps
  // between the pieces showed as dark slits down the flange): stud cells along the row, by
  // the row's direction, height and line.
  const rows = new Map<string, { dir: THREE.Vector3; cy: number; line: number; at: number[] }>();
  for (const s of t.sideStuds ?? []) {
    const dir = SIDE_DIRS[s.dir];
    const cx = (s.x + 0.5) * STUD - (t.studsX * STUD) / 2;
    const cz = (s.z + 0.5) * STUD - (t.studsZ * STUD) / 2;
    const cy = -h / 2 + s.y * PLATE_H;
    // Out to the body's side in the stud's direction.
    const face = new THREE.Vector3(cx + (dir.x * STUD) / 2, cy, cz + (dir.z * STUD) / 2);
    const below = cy - STUD / 2 < -h / 2;
    const above = cy + STUD / 2 > h / 2;
    if (below || above) {
      // A flange one plate thick on that side, one stud high around the stud.
      const line = dir.x ? face.x : face.z;
      const key = `${s.dir}|${cy}|${line}`;
      let row = rows.get(key);
      if (!row) rows.set(key, (row = { dir, cy, line, at: [] }));
      row.at.push(dir.x ? s.z : s.x);
    }
    const stud = new THREE.CylinderGeometry(STUD_RADIUS, STUD_RADIUS, STUD_HEIGHT, 12);
    // A cylinder stands along y: lay it along the stud's direction.
    if (dir.x) stud.rotateZ(-Math.sign(dir.x) * (Math.PI / 2));
    else stud.rotateX(Math.sign(dir.z) * (Math.PI / 2));
    stud.translate(face.x + (dir.x * STUD_HEIGHT) / 2, cy, face.z + (dir.z * STUD_HEIGHT) / 2);
    out.push(stud);
  }
  for (const { dir, cy, line, at } of rows.values()) {
    const cells = [...new Set(at)].sort((a, b) => a - b);
    const half = ((dir.x ? t.studsZ : t.studsX) * STUD) / 2;
    // Runs of cells next to each other, each one flange.
    for (let i = 0; i < cells.length;) {
      let j = i;
      while (j + 1 < cells.length && cells[j + 1] === cells[j]! + 1) j++;
      const from = cells[i]! * STUD - half;
      const to = (cells[j]! + 1) * STUD - half;
      const length = to - from - GAP;
      const mid = (from + to) / 2;
      // Round its studs, and on into the body it hangs from or stands on: studs set more than
      // half a stud off the body (a hanging bracket's) left a slit between the two.
      const y0 = Math.min(cy - (STUD - GAP) / 2, h / 2 - PLATE_H / 2);
      const y1 = Math.max(cy + (STUD - GAP) / 2, -h / 2 + PLATE_H / 2);
      const flange = new THREE.BoxGeometry(
        dir.x ? PLATE_H : length,
        y1 - y0,
        dir.z ? PLATE_H : length,
      );
      flange.translate(
        dir.x ? line - (dir.x * PLATE_H) / 2 : mid,
        (y0 + y1) / 2,
        dir.z ? line - (dir.z * PLATE_H) / 2 : mid,
      );
      out.push(flange);
      i = j + 1;
    }
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
        parts.push(...roundShell(r, h, hasTopStud(t.id, 0, 0) ? 'axle' : 'stud'));
        studsOnTop();
        break;
      }
      // 1x1: a narrower foot under the round, and a stud's bore up into it (6141, 98138,
      // 3062b). The round brick's stud is open, with a hole down into it.
      const plate = t.plates === 1;
      const profile: [number, number][] = [
        [TUBE_INNER, ldu(0)],
        [FOOT, ldu(0)],
        [FOOT, ldu(5)],
        [r, ldu(5)],
        [r, top],
      ];
      if (!hasTopStud(t.id, 0, 0)) profile.push([0, top]);
      else if (plate)
        profile.push([STUD_RADIUS, top], [STUD_RADIUS, top + STUD_HEIGHT], [0, top + STUD_HEIGHT]);
      else
        profile.push(
          [STUD_RADIUS, top],
          [STUD_RADIUS, top + STUD_HEIGHT],
          [HOLE, top + STUD_HEIGHT],
          [HOLE, ldu(20)],
          [0, ldu(20)],
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
      parts.push(
        ...slopedParts(
          t,
          [
            [-d / 2, -h / 2],
            [d / 2, -h / 2],
            [d / 2, -h / 2 + h * 0.12],
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
      const post = STUD * 0.18;
      const rail = PLATE_H * 0.9;
      parts.push(
        new THREE.BoxGeometry(post, h - 2 * rail, d).translate(-w / 2 + post / 2, 0, 0),
        new THREE.BoxGeometry(post, h - 2 * rail, d).translate(w / 2 - post / 2, 0, 0),
        new THREE.BoxGeometry(w, rail, d).translate(0, h / 2 - rail / 2, 0),
        ...hollowShell(w, rail, d).map((g) => g.translate(0, -h / 2 + rail / 2, 0)),
      );
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
      const walls = withHole(outline(0), outline(WALL));
      parts.push(
        upright(outline(0), TOP, 12).translate(-w / 2, h / 2 - TOP, -d / 2),
        upright(walls, h - TOP, 12).translate(-w / 2, -h / 2, -d / 2),
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
      for (let i = 0; i < 5; i++) {
        const petal = new THREE.SphereGeometry(STUD * 0.5, 12, 6);
        petal.scale(0.75, (h / STUD) * 0.9, 1);
        petal.translate(0, 0, STUD * 0.5);
        petal.rotateY((i / 5) * Math.PI * 2);
        parts.push(petal);
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

export function brickMaterial(colour: ColourId): THREE.MeshStandardMaterial {
  let m = materials.get(colour);
  if (!m) {
    const alpha = COLOURS[colour].alpha;
    m = new THREE.MeshStandardMaterial({
      color: drawnHex(colour),
      roughness: alpha ? 0.15 : 0.45,
      ...(alpha ? { transparent: true, opacity: alpha, depthWrite: false } : {}),
    });
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
