import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { add } from '../interiors.ts';
import { hex, put } from '../nature.ts';
import { Surface } from '../styles.ts';
import { TIMBER, coloured, iron, lathe, times } from './kit.ts';
import type { Column, Turn } from './kit.ts';

/** Rope and timber posts: rope fences and rails, lashings, and the old mooring posts. */

/**
 * A hewn timber post `r` round from `y0` up to `y1` at (`x`, `z`): eight rough faces, each a
 * shade of its own, darker at its foot, its top chamfered and pale.
 */
export function timberPost(
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
 * A thick rope `r` round along `curve` in `segments`, `sides` round: its strands twisting round
 * it, painted lighter on top and darker underneath; a loop, if `closed`. (Its normals are
 * smooth, so only its outline shows how few sides it has: five do for a rope seen from a few
 * metres off, a mooring post's or a fence's.)
 */
export function ropeTube(
  curve: THREE.Curve<THREE.Vector3>,
  segments: number,
  r: number,
  colour: number,
  closed = false,
  sides = 6,
): THREE.BufferGeometry {
  // (Its points are spaced evenly along it, found from a table of its length so far: a few
  // entries to a segment place them to well under a millimetre, where the default 200 took
  // most of the time building a rope.)
  curve.arcLengthDivisions = Math.max(16, segments * 4);
  const geometry = new THREE.TubeGeometry(curve, segments, r, sides, closed);
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

/**
 * A thick rope slung from `a` to `b`, sagging `sag` in the middle (see `ropeTube`): a gentle
 * curve, a segment every 15 cm or so following it closely enough.
 */
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
  return ropeTube(curve, Math.max(6, Math.round(a.distanceTo(b) * 6.5)), r, colour, false, 5);
}

/**
 * A turn or two of rope round a post `r` round at height `y`. They lie in the post's shadow,
 * and cast none of their own.
 */
function lashing(g: THREE.Object3D, r: number, x: number, y: number, z: number, colour: number) {
  const base = hex(colour);
  for (const [dy, tube] of [
    [-0.022, 0.024],
    [0.022, 0.022],
  ] as const) {
    // (As many segments round as the post has faces: see `timberPost`.)
    const ring = new THREE.TorusGeometry(r + 0.006, tube, 4, 8).rotateX(Math.PI / 2);
    const normal = ring.attributes.normal!;
    const colours = new Float32Array(normal.count * 3);
    for (let k = 0; k < normal.count; k++) {
      const c = times(base, 0.75 + 0.3 * normal.getY(k));
      colours.set([c.r, c.g, c.b], k * 3);
    }
    ring.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    put(g, ring.translate(x, y + dy, z), Surface.Auto, false);
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
    // From post to post, or on to the next length's post (just past the end of the box). A
    // few centimetres thick, each casts its own shadow: a line across the bridge's deck, or
    // sagging over the sand.
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

/** Old timber gone grey in the sun and the salt, toward the top of a mooring post. */
const BLEACHED = 0xaaa392;
/** Wet timber, dark and green with weed, where the sea comes up a post. */
const WEED = 0x2f3b26;
/** The pale crust of barnacles. */
const BARNACLE = 0xdcd5c2;
/**
 * A barnacle's shape, as much of it as stands out of what it is stuck to: a low point of four
 * faces out along +z, from a rim sunk a little under the face it sits on. Made once, and copied
 * for each one.
 */
const BARNACLE_SHAPE = (() => {
  const rim = [
    [1, 0, -0.3],
    [0, 1, -0.3],
    [-1, 0, -0.3],
    [0, -1, -0.3],
  ];
  const position = rim.flatMap((p, i) => [...p, ...rim[(i + 1) % 4]!, 0, 0, 1]);
  const shape = new THREE.BufferGeometry();
  shape.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  shape.computeVertexNormals();
  return shape;
})();
/** A mooring post's rope, darker than a fence's for the wet. */
const HAWSER = 0xb08c56;

/** Another mooring post lashed to one (see `pilingModel`), in that one's frame. */
export interface LashedPost {
  /** Its middle across the sea bed. */
  x: number;
  z: number;
  /** How high its top is. */
  top: number;
  /** How thick it is: half the least of its box's width and depth. */
  half: number;
}

/** How thick a mooring post is for its box, about the waterline. */
const pilingRadius = (half: number) => half * 0.94;

/**
 * How a mooring post among those lashed together (`group`, the first of them this one, in its
 * frame) leans in toward the middle of them all over the water at `water`: which way, and so far
 * that its top meets the nearest one's, a few degrees at most.
 */
function leanIn(
  group: LashedPost[],
  i: number,
  water: number,
): { x: number; z: number; by: number } {
  const p = group[i]!;
  const mx = group.reduce((a, q) => a + q.x, 0) / group.length;
  const mz = group.reduce((a, q) => a + q.z, 0) / group.length;
  const way = Math.hypot(mx - p.x, mz - p.z) || 1;
  const gap = Math.min(
    ...group
      .filter((q) => q !== p)
      .map((q) => Math.hypot(q.x - p.x, q.z - p.z) - pilingRadius(q.half) - pilingRadius(p.half)),
  );
  const tall = Math.max(0.5, Math.min(...group.map((q) => q.top)) - water);
  const by = Math.min((3.5 * Math.PI) / 180, Math.atan(Math.max(0, gap / 2 + 0.01) / tall));
  return { x: (mx - p.x) / way, z: (mz - p.z) / way, by };
}

/**
 * An old mooring post standing in the sea, the box from below the sea bed: a hewn round trunk,
 * uneven and leaning a few degrees about the waterline (`sea`, in its frame), its top rounded
 * over or sawn off on the slant to pale end grain, dark and weedy from the sea bed to a little
 * over the water and greying in the sun above, crusted with barnacles about the waterline;
 * higher up two or three turns of rope round it with a loose end hanging, and on some an iron
 * band under the top. Each is its own, from `seed`. Leaning, its top reaches out of the box by
 * a few centimetres. Posts `lashed` to it (in twos and threes) lean in together instead, and
 * the rope goes round them all, drawn with the first of them (the one furthest toward -x).
 */
export function pilingModel(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
  sea: number | null,
  lashed: LashedPost[] = [],
): void {
  const R = pilingRadius(Math.min(w, d) / 2);
  const foot = -h / 2;
  const top = h / 2;
  const water = Math.min(top - 0.6, Math.max(foot + 0.3, sea ?? foot + h * 0.45));
  // Built upright about the waterline, then leant over about it.
  const post = new THREE.Group();
  post.position.y = water;
  const group: LashedPost[] = [{ x: 0, z: 0, top, half: Math.min(w, d) / 2 }, ...lashed];
  let lean = ((2 + seed() * 3.5) * Math.PI) / 180;
  let way = seed() * Math.PI * 2;
  if (lashed.length) {
    const inward = leanIn(group, 0, water);
    lean = inward.by;
    // (Turned about x and then z, its top goes toward -sin and cos of `way`.)
    way = Math.atan2(-inward.x, inward.z);
  }
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
  // Barnacles in clumps about the waterline: each a low point of four faces, which is all a
  // white speck needs.
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
      const tone = 0.8 + seed() * 0.3;
      const shell = BARNACLE_SHAPE.clone();
      shell.scale(size, size * 0.8, size * 0.55);
      // Turned to sit flat on the trunk, facing out from it.
      shell.rotateY(-ai + Math.PI / 2);
      shell.translate(r * Math.cos(ai), yi, r * Math.sin(ai));
      crust.push(coloured(shell, times(hex(BARNACLE), tone)));
    }
  }
  if (crust.length) {
    put(post, mergeGeometries(crust), Surface.Auto, false);
    for (const c of crust) c.dispose();
  }
  if (lashed.length === 0) pilingRope(post, rAt, cut, seed);
  else if (lashed.every((q) => q.x > 1e-6 || (q.x > -1e-6 && q.z > 0)))
    lashTogether(g, group, water, seed);
  // An iron band under the top, on some (as many segments round as the post has faces; in its
  // shadow, casting none).
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
      11,
    );
    add(post, band, iron(), 0, 0, 0).castShadow = false;
  }
}

/**
 * A mooring post's rope (see `pilingModel`): a few turns round it under its top (`cut`, its
 * thickness at a height `rAt`), and its end hanging down from the last. It lies in the post's
 * own shadow, and casts none.
 */
function pilingRope(
  post: THREE.Object3D,
  rAt: (y: number) => number,
  cut: number,
  seed: () => number,
): void {
  const ry = Math.min(cut - 0.25, 0.55 + seed() * 0.35);
  const tube = 0.03;
  const turnsOf = 2 + Math.floor(seed() * 2);
  for (let i = 0; i < turnsOf; i++) {
    const y = ry + (i - (turnsOf - 1) / 2) * tube * 1.8;
    // (As many segments round as the post has faces.)
    const ring = new THREE.TorusGeometry(rAt(y) * 0.97 + tube * 0.8, tube, 5, 11).rotateX(
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
    put(post, ring, Surface.Auto, false);
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
  put(post, ropeTube(tail, 6, tube * 0.9, HAWSER, false, 4), Surface.Auto, false);
}

/**
 * The rope round mooring posts lashed together (`group`, in the first one's frame, leaning in
 * on each other over the water at `water`, see `leanIn`): three turns round them all under the
 * lowest one's top, and its end hanging down, casting no shadow (the posts cast theirs).
 */
function lashTogether(
  g: THREE.Object3D,
  group: LashedPost[],
  water: number,
  seed: () => number,
): void {
  const tube = 0.03;
  const leans = group.map((_, i) => leanIn(group, i, water));
  const ry = Math.max(
    water + 0.35,
    Math.min(Math.min(...group.map((q) => q.top)) - 0.4, water + 0.6 + seed() * 0.3),
  );
  /** Where a post's middle is at height `y`, leant in. */
  const middle = (i: number, y: number) => {
    const { x, z, by } = leans[i]!;
    const off = (y - water) * Math.tan(by);
    return new THREE.Vector2(group[i]!.x + x * off, group[i]!.z + z * off);
  };
  let last: THREE.Vector3 | null = null;
  for (let t = 0; t < 3; t++) {
    const y = ry + (t - 1) * tube * 1.8;
    // Round the outside of them all: each way out, the furthest post's side that way.
    const points: THREE.Vector3[] = [];
    const n = 36;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const u = new THREE.Vector2(Math.cos(a), Math.sin(a));
      let best = -Infinity;
      let at = new THREE.Vector2();
      for (let i = 0; i < group.length; i++) {
        const c = middle(i, y);
        const out = pilingRadius(group[i]!.half) * 0.92 + tube * 0.9;
        if (c.dot(u) + out > best) {
          best = c.dot(u) + out;
          at = c.clone().addScaledVector(u, out);
        }
      }
      points.push(new THREE.Vector3(at.x, y + Math.sin(a * 2 + t) * 0.006, at.y));
    }
    const loop = new THREE.CatmullRomCurve3(points, true, 'centripetal');
    put(g, ropeTube(loop, 26, tube, HAWSER, true, 5), Surface.Auto, false);
    last = points[Math.floor(seed() * n)]!;
  }
  // The end tucked under the turns and hanging down.
  const from = last!.clone();
  const out = new THREE.Vector3(from.x, 0, from.z).normalize();
  const hang = Math.min(0.45, ry - water - 0.05);
  const tail = new THREE.CatmullRomCurve3([
    from,
    from
      .clone()
      .addScaledVector(out, 0.04)
      .add(new THREE.Vector3(0, -hang * 0.4, 0)),
    from
      .clone()
      .addScaledVector(out, 0.07)
      .add(new THREE.Vector3(0, -hang, 0)),
  ]);
  put(g, ropeTube(tail, 5, tube * 0.9, HAWSER, false, 4), Surface.Auto, false);
}
