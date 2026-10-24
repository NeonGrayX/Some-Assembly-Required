import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { add, box, mat } from '../interiors.ts';
import { hex, put } from '../nature.ts';
import { bevelBox, bevelCylinder } from '../shapes.ts';
import { Surface } from '../styles.ts';
import { pirateFlag, pole } from './flags.ts';
import { barrelModel } from './harbour.ts';
import {
  CARRIAGE,
  DECK,
  INSIDE,
  IRON,
  Quads,
  SAIL_CREAM,
  SAIL_RED,
  TIMBER,
  block,
  coloured,
  iron,
  made,
  rod,
  slab,
  times,
} from './kit.ts';
import { litGlass } from './storey.ts';

/**
 * The beached ship: its planked hull with its gun ports, and its masts rigged with striped
 * sails.
 */

/** How long a mast's lower yard is, for its ship's beam (the upper one is shorter). */
const MAST_YARD = 1.45;
/** The beam a mast's yards are sized for when it finds no ship under it. */
const MAST_BEAM = 2.4;
/**
 * How far a mast's yards and sails reach out either side of it at most, for its height (a
 * short mast's are shorter than its ship's beam would make them).
 */
export const mastSpread = (h: number): number => Math.min(2.6, 0.3 * h);
/** How tall a ship's bulwarks stand above its deck (the colliders round it). */
const BULWARK = 0.7;
/**
 * How much broader a ship is at its wale than at its deck (its sides' tumblehome), as a share
 * of its beam: at the deck it is as broad as its box, its bulwarks over the colliders along it.
 */
const TUMBLE = 0.02;
/** How far over a ship's deck the lowest sails' feet hang: clear over the heads of those on it. */
const HEADROOM = 2.45;
/**
 * Where a mast's shrouds come down to the ship's sides, along it from the mast toward the stern:
 * from abeam of it aft, clear of the sails, which hang forward of it. The mainmast has four a
 * side, any other three.
 */
const SHROUDS = { main: [-0.2, 0.12, 0.44, 0.76], other: [-0.1, 0.22, 0.54] };
/**
 * The channels the shrouds come down to outside the bulwarks: how far out from the ship's side
 * they reach, and how high over the deck they are.
 */
const CHANNEL = { out: 0.4, up: 0.32 };
/** How long a ship's bowsprit is, and how steeply it rises from the stem. */
const BOWSPRIT = { length: 1.8, rise: 0.36 };
/**
 * How far round a ship's yards are braced from square across it, in radians, the course's and
 * the topsail's above it a little further: the same way on every mast, the wind on the quarter.
 */
const BRACE = { course: 0.5, topsail: 0.6 };
/** Rigging: the shrouds, stays and lifts, and the ratlines up the shrouds. */
const RIGGING = 0x6b5a44;
/** The red of a gun port's lid. */
const PORT_RED = 0x96402f;
/** How high up a mast its top is: the mainmast's crow's nest, another's platform. */
const mastTop = (h: number, main: boolean) => h * (main ? 0.6 : 0.74);

/** What a sail is like besides its size: how ragged its foot is, and where it is patched. */
interface SailCut {
  /** How deep its foot is torn, at most, as a share of its height. */
  ragged: number;
  /** The middle of a patch sewn on it, across it (0 to 1) and down it (0 to 1); or none. */
  patch: { u: number; v: number } | null;
}

/** A sailcloth patch: tan canvas sewn over the stripes. */
const PATCH = 0xc9a776;

/**
 * A sail `top` wide at its head and `bottom` at its foot, `tall` tall, hanging from y = 0 down
 * across x, bellying out toward -z by `belly`: red and cream stripes, painted darker low down
 * and in its folds, its foot torn as ragged as `cut` has it, and patched if it says so.
 */
function sail(
  top: number,
  bottom: number,
  tall: number,
  belly: number,
  seed: () => number,
  cut: SailCut = { ragged: 0.07, patch: null },
): THREE.BufferGeometry {
  const stripes = 6;
  const rows = 7;
  const q = new Quads();
  // Torn at every column's foot, now and then a bite out deeper than the rest.
  const tears = Array.from(
    { length: stripes * 2 + 1 },
    () => seed() * cut.ragged * tall * (seed() < 0.15 ? 1.8 : 1),
  );
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
  // Each fold of it a shade off, and the lower parts in the shade of the belly.
  const shadeAt = (base: THREE.Color, u: number, v: number) =>
    times(base, (0.95 - 0.22 * v ** 1.5) * (0.94 + 0.08 * Math.cos(u * Math.PI * 12)));
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
        const cs = [
          [u0, v0],
          [u1, v0],
          [u1, v1],
          [u0, v1],
        ].map(([u, v]) => shadeAt(base, u!, v!));
        q.flat(ps, new THREE.Vector3(0, 0, -1), cs);
      }
    }
  }
  if (cut.patch) {
    // Sewn on both faces, standing a hair off the cloth so the two never meet.
    const { u: pu, v: pv } = cut.patch;
    const [pw, ph] = [0.13, 0.16];
    const n = 3;
    const at = (a: number, b: number, off: number) => {
      const u = pu + (a / n - 0.5) * pw;
      const v = pv + (b / n - 0.5) * ph;
      const e = 0.01;
      const p = point(u, v, 0);
      const across = point(u + e, v, 0).sub(point(u - e, v, 0));
      const down = point(u, v + e, 0).sub(point(u, v - e, 0));
      // (Toward the belly's side, -z.)
      const normal = down.cross(across).normalize();
      if (normal.z > 0) normal.negate();
      return p.addScaledVector(normal, off);
    };
    const tan = hex(PATCH);
    for (const off of [0.014, -0.014])
      for (let a = 0; a < n; a++)
        for (let b = 0; b < n; b++)
          q.flat(
            [at(a, b, off), at(a + 1, b, off), at(a + 1, b + 1, off), at(a, b + 1, off)],
            new THREE.Vector3(0, 0, off > 0 ? -1 : 1),
            times(tan, (0.9 + 0.1 * ((a + b) % 2)) * (1 - 0.2 * pv)),
          );
  }
  const geometry = q.geometry();
  // Smooth across the cloth, the stripes still sharp.
  geometry.deleteAttribute('normal');
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A jib, a triangle of sail on the stay from `tip` (out on the bowsprit) up to `head` (on the
 * foremast): its luff up the stay from near the bowsprit's end, its foot back to its clew at
 * `clew`, bellying out toward +x by `belly`; striped as the square sails are.
 */
function jibSail(
  tip: THREE.Vector3,
  head: THREE.Vector3,
  clew: THREE.Vector3,
  belly: number,
): THREE.BufferGeometry {
  const tack = tip.clone().lerp(head, 0.1);
  const peak = tip.clone().lerp(head, 0.6);
  // Across it from the stay (u = 0) to its leech, up it from its foot (v = 0) to its peak.
  const point = (u: number, v: number) => {
    const p = tack.clone().lerp(clew, u).lerp(peak, v);
    p.x += belly * Math.sin(Math.PI * u) ** 0.8 * Math.sin(Math.PI * Math.min(1, v * 0.9 + 0.06));
    return p;
  };
  const q = new Quads();
  const columns = 8;
  const rows = 6;
  for (let i = 0; i < columns; i++) {
    const base = hex(Math.floor(i / 2) % 2 === 0 ? SAIL_CREAM : SAIL_RED);
    for (let k = 0; k < rows; k++) {
      const [u0, u1, v0, v1] = [i / columns, (i + 1) / columns, k / rows, (k + 1) / rows];
      q.flat(
        [point(u0, v0), point(u1, v0), point(u1, v1), point(u0, v1)],
        new THREE.Vector3(1, 0, 0),
        [
          [u0, v0],
          [u1, v0],
          [u1, v1],
          [u0, v1],
        ].map(([u, v]) => times(base, (0.8 + 0.18 * v!) * (0.95 + 0.05 * Math.cos(u! * 20)))),
      );
    }
  }
  const geometry = q.geometry();
  geometry.deleteAttribute('normal');
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The ship a mast stands on (see `mastModel`): the hull's frame and box, what stands on its
 * deck, where on it the mast stands, which mast it is and the next one forward of it.
 */
export interface ShipLine {
  /** The hull's frame (its middle, its bow toward its -z) in the mast's. */
  frame: THREE.Matrix4;
  /** The hull's box in its own frame: wide, high and deep. */
  hull: { w: number; h: number; d: number };
  /** What stands on its deck, in its frame. */
  fit: HullFittings;
  /** The mast's foot on the deck, in the hull's frame. */
  foot: THREE.Vector3;
  /** Whether it is the mainmast (the tallest): with a crow's nest, a topsail and the flag. */
  main: boolean;
  /**
   * The next mast forward of it (where along the ship, how tall, and whether it is the
   * mainmast), which its stays run to; null for the foremost, whose stay runs out to the end of
   * the bowsprit and carries the jib.
   */
  ahead: { z: number; h: number; main: boolean } | null;
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
  /** Where its masts stand along it, for the channels their shrouds come down to. */
  masts: { z: number; main: boolean }[];
}

/** How a stretch of bulwark stands: whole, cut down to a gun port's sill, or not at all. */
type Wall = 'whole' | 'port' | 'none';

/** How the bulwark stands on a side of a hull at `z` (`front` its box's front). */
function bulwarkAt(fit: HullFittings, front: number, side: number, z: number): Wall {
  if (z < front) return 'whole';
  if (fit.ports.some((p) => p.side === side && Math.abs(z - p.z) < p.width / 2)) return 'port';
  return (fit.sides[side] ?? []).some(([a, b]) => z > a - 1e-6 && z < b + 1e-6) ? 'whole' : 'none';
}

/** A hull's lines in its frame, worked out from its box (see `hullShape`). */
interface HullShape {
  w: number;
  d: number;
  deckY: number;
  keelY: number;
  /** The front of its box, where the bow begins, how long the bow is, and its stem. */
  front: number;
  Lb: number;
  stemZ: number;
  /** Where the stern's transom starts, over the counter's curve up from the keel. */
  counterY: number;
  /** How far out ahead of the box, as a share of the bow's length. */
  ahead(z: number): number;
  /** Half its breadth at its deck, along it. */
  halfDeck(z: number): number;
  /** Its keel's line along it, sweeping up to the stem and under the counter. */
  bottom(z: number): number;
  /** Where its wale runs along it. */
  waleAt(z: number): number;
  /** How much its rail rises toward its ends. */
  sheer(z: number): number;
  /** Its bulwarks' top along it. */
  topAt(z: number): number;
  /** How far out from the middle its side is at `z` and height `y`. */
  halfAt(z: number, y: number): number;
  /** The point on a side (its sign along x) at `z` and height `y`, and the way out of it. */
  point(z: number, y: number, side: number): THREE.Vector3;
  normalAt(z: number, y: number, side: number): THREE.Vector3;
}

/** `f`, remembering what it gave for each place along a hull. */
function perPlace(f: (z: number) => number): (z: number) => number {
  const known = new Map<number, number>();
  return (z) => {
    let v = known.get(z);
    if (v === undefined) known.set(z, (v = f(z)));
    return v;
  };
}

/** The lines of a hull fitted to a box `w` by `h` by `d`, its bow to the front (see `hullModel`). */
function hullShape(w: number, h: number, d: number): HullShape {
  const deckY = h / 2;
  const keelY = -h / 2;
  const topY = deckY + BULWARK;
  const Lb = Math.min(1.7, w * 0.7);
  const front = -d / 2;
  const clamp = (t: number) => Math.min(1, Math.max(0, t));
  // How far out in front of the box, as a share of the bow's length; and how far into the
  // stern's last metre or so, where the hull tucks up under its counter.
  const ahead = (z: number) => clamp((front - z) / Lb);
  const tuck = Math.min(1.3, d * 0.2);
  const astern = (z: number) => clamp((z - (d / 2 - tuck)) / tuck);
  const counterY = deckY - Math.min(0.95, (deckY - keelY) * 0.42);
  // Narrowing to the stem, and a little to the transom, rounded off in plan. (Each worked out
  // once for each place along it: the planking asks for them at every corner of every plank.)
  const halfDeck = perPlace(
    (z) =>
      Math.max(0.07, (w / 2) * Math.max(0, 1 - ahead(z) ** 2.2) ** 0.55) *
      (1 - 0.06 * astern(z) ** 2),
  );
  const bottom = perPlace((z) =>
    Math.max(
      keelY + (deckY - 0.5 - keelY) * ahead(z) ** 1.5,
      keelY + (counterY - keelY) * astern(z) ** 1.6,
    ),
  );
  const waleAt = perPlace((z) => bottom(z) + (deckY - bottom(z)) * 0.72);
  // The sheer: the rail rising toward the stern, and toward the bow and on out along it.
  const sheer = (z: number) =>
    0.5 * clamp((z - (d / 2 - 1.6)) / 1.6) ** 2 +
    0.12 * clamp((front + 1.6 - z) / 1.6) ** 2 +
    0.3 * ahead(z) ** 1.4;
  const topAt = (z: number) => topY + sheer(z);
  // Broadest at the wale, a little out past the box's sides, coming in above it (the
  // tumblehome) to them at the deck, and a hair further to the rail; below the wale, round in
  // to the keel.
  const halfAt = (z: number, y: number) => {
    const hd = halfDeck(z);
    if (y >= deckY) return hd * (1 - 0.008 * Math.min(1, (y - deckY) / BULWARK));
    const wide = hd * (1 + TUMBLE);
    const wy = waleAt(z);
    if (y >= wy) return wide - (wide - hd) * ((y - wy) / (deckY - wy)) ** 1.6;
    const s = Math.max(0, (y - bottom(z)) / (wy - bottom(z)));
    return wide * (1 - 0.7 * (1 - s) ** 2.4);
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
  return {
    w,
    d,
    deckY,
    keelY,
    front,
    Lb,
    stemZ: front - Lb,
    counterY,
    ahead,
    halfDeck,
    bottom,
    waleAt,
    sheer,
    topAt,
    halfAt,
    point,
    normalAt,
  };
}

/** Where a hull's bowsprit rises from at its stem, and its end, in its frame. */
function bowsprit(s: HullShape): { from: THREE.Vector3; to: THREE.Vector3 } {
  const from = new THREE.Vector3(0, s.topAt(s.stemZ) - 0.02, s.stemZ + 0.06);
  const way = new THREE.Vector3(0, Math.sin(BOWSPRIT.rise), -Math.cos(BOWSPRIT.rise));
  return { from, to: from.clone().addScaledVector(way, BOWSPRIT.length) };
}

/**
 * Where a mast's shrouds come down on one side of its ship (along it, in the hull's frame): at
 * `SHROUDS` from the mast at `z`, wherever the bulwark there stands whole round them.
 */
function shroudsAt(
  s: HullShape,
  fit: HullFittings,
  z: number,
  main: boolean,
  side: number,
): number[] {
  return (main ? SHROUDS.main : SHROUDS.other)
    .map((aft) => z + aft)
    .filter(
      (at) =>
        at > s.front + 0.3 &&
        at < s.d / 2 - 0.3 &&
        [-0.15, 0, 0.15].every((e) => bulwarkAt(fit, s.front, side, at + e) === 'whole'),
    );
}

/** How high a channel's top is in its hull's frame, and how far out its middle is at `z`. */
const channelY = (s: HullShape) => s.deckY + CHANNEL.up;

/** Where a shroud comes down to its deadeye on the channel at `z` on a side, in the hull's frame. */
function shroudFoot(s: HullShape, z: number, side: number): THREE.Vector3 {
  const y = channelY(s);
  return new THREE.Vector3(side * (s.halfAt(z, y) + CHANNEL.out - 0.07), y + 0.165, z);
}

/**
 * A ship's mast, the box, drawn in the frame of the hull it stands on (see `ShipLine`; with no
 * ship found, alone, its yards along x): a tapering lower mast bound with iron up to its top, a
 * topmast on up from there to its head, and two yards across the ship, the course's under the
 * top and the topsail's high on the topmast, each with a striped sail bellying toward the bow,
 * one or another ragged or patched. The mainmast's top is a crow's nest, a tub round the mast,
 * and the black flag flies from its head; another's is a railed platform. Shrouds come down
 * either side from the top to deadeyes on the channels outside the bulwarks (see `hullModel`),
 * with ratlines up them; the topmast has shrouds of its own down to the top, and lifts hold up
 * the yards' ends. Stays run forward from its top and its head to the next mast's, or from the
 * foremost's head out to the bowsprit's end, carrying the jib. All of it reaches out of the box
 * well over the heads of those on the deck, or along the bulwarks.
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
  const rig = new THREE.Group();
  g.add(rig);
  const shape = ship ? hullShape(ship.hull.w, ship.hull.h, ship.hull.d) : null;
  if (ship) ship.frame.decompose(rig.position, rig.quaternion, rig.scale);
  const foot = ship?.foot ?? new THREE.Vector3(0, -h / 2, 0);
  const main = ship?.main ?? true;
  const beam = ship?.hull.w ?? MAST_BEAM;
  const [mx, y0, at] = [foot.x, foot.y, foot.z];
  const y1 = y0 + h;
  const ironwork = iron();
  const V = (x: number, y: number, z: number) => new THREE.Vector3(mx + x, y, z);

  // The lower mast up into its top, the topmast on up from the top to the head.
  const topY = y0 + mastTop(h, main);
  put(
    rig,
    pole(r * 0.95, r * 0.74, y0, topY + 0.12, colour, seed).translate(mx, 0, at),
    Surface.Auto,
  );
  put(
    rig,
    pole(r * 0.62, r * 0.4, topY - 0.05, y1, colour, seed).translate(mx, 0, at),
    Surface.Auto,
  );
  // (Its iron bands stand too little proud of it for their shadows to show; their sides are
  // never square to the mast's, which would flicker through them.)
  for (const f of [0.08, 0.3, 0.55, 0.85]) {
    const rb = r * (0.98 - f * 0.22);
    const band = bevelCylinder(rb, rb, 0.06, 12);
    add(rig, band, ironwork, mx, y0 + f * (topY - y0), at).castShadow = false;
  }
  const cap = bevelCylinder(r * 0.68, r * 0.68, 0.07, 10);
  add(rig, cap, ironwork, mx, topY + 0.6, at).castShadow = false;
  // The trestle trees under the top, crosswise.
  const timber = mat(TIMBER, 0.8);
  box(rig, main ? 0.9 : 0.78, 0.09, 0.12, mx, topY - 0.05, at, timber);
  box(rig, 0.12, 0.09, main ? 0.9 : 0.78, mx, topY - 0.05, at, timber);
  const topR = main ? 0.42 : 0.38;
  if (main) {
    // The crow's nest: a tub round the mast, open at the top.
    const nest = new THREE.Group();
    nest.position.set(mx, topY + 0.275, at);
    rig.add(nest);
    barrelModel(nest, 0.96, 0.55, 0.96, 0x8a5a32, seed, 0.4);
  } else {
    // A planked platform with a rail round it on short posts.
    add(rig, bevelCylinder(0.42, 0.42, 0.06, 12), mat(DECK, 0.85), mx, topY + 0.03, at);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
      add(
        rig,
        bevelCylinder(0.02, 0.025, 0.26, 6),
        timber,
        mx + Math.cos(a) * 0.37,
        topY + 0.19,
        at + Math.sin(a) * 0.37,
      );
    }
    const ring = new THREE.TorusGeometry(0.37, 0.022, 4, 14).rotateX(Math.PI / 2);
    add(rig, ring, timber, mx, topY + 0.33, at);
  }

  // The yards, forward of the mast, slung from it and braced round a little, the wind on the
  // quarter; and the sails under them. Each is built square across the ship in a frame of its
  // own turned round the mast.
  const ahead = r + 0.08;
  const yardFrame = (turn: number) => {
    const f = new THREE.Group();
    f.position.set(mx, 0, at);
    f.rotation.y = turn;
    rig.add(f);
    return f;
  };
  /** Where a point `x` along a yard at `y`, braced `turn` round, is in the rig's frame. */
  const onYard = (x: number, y: number, turn: number) =>
    new THREE.Vector3(x, y, -ahead)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), turn)
      .add(new THREE.Vector3(mx, 0, at));
  const yard = (f: THREE.Object3D, y: number, length: number) => {
    const spar = pole(0.075, 0.04, 0, length / 2, colour, seed);
    for (const s of [-1, 1]) {
      const m = put(f, spar.clone().rotateZ((s * Math.PI) / 2), Surface.Auto);
      m.position.set(0, y, -ahead);
    }
    add(f, bevelCylinder(0.095, 0.095, 0.16, 10).rotateZ(Math.PI / 2), ironwork, 0, y, -ahead);
    add(f, bevelBox(0.07, 0.06, r + 0.1), ironwork, 0, y, -ahead / 2);
  };
  const hang = (
    f: THREE.Object3D,
    y: number,
    top: number,
    bottom: number,
    tall: number,
    cut: SailCut,
  ) => {
    if (tall < 0.5) return;
    const cloth = sail(top, bottom, tall, tall * 0.28, seed, cut);
    const m = put(f, cloth.translate(0, y - 0.08, -ahead - 0.05), Surface.Fabric, true, true);
    m.receiveShadow = true;
  };
  const half = Math.min((beam * MAST_YARD) / 2, mastSpread(h));
  const courseY = topY - (main ? 0.38 : 0.34);
  const course = yardFrame(-BRACE.course);
  yard(course, courseY, 2 * half);
  hang(course, courseY, 2 * half - 0.35, 2 * half - 0.1, courseY - 0.08 - (y0 + HEADROOM), {
    ragged: main ? 0.05 : 0.11,
    patch: main ? { u: 0.25 + seed() * 0.15, v: 0.4 + seed() * 0.2 } : null,
  });
  const upper = half * (main ? 0.74 : 0.7);
  const topsailY = y1 - (main ? 0.5 : 0.4);
  const topsailFoot = topY + (main ? 0.68 : 0.45);
  const topsail = topsailY - 0.08 - topsailFoot;
  if (topsail >= 0.5) {
    const f = yardFrame(-BRACE.topsail);
    yard(f, topsailY, 2 * upper);
    hang(f, topsailY, 2 * upper - 0.3, Math.min(2 * half - 0.3, 2 * upper * 1.2), topsail, {
      ragged: main ? 0.13 : 0.06,
      patch: main ? { u: 0.6 + seed() * 0.15, v: 0.35 + seed() * 0.2 } : null,
    });
  }
  // The truck on the topmast's head, and on the mainmast the black flag flying from it toward
  // the bow, the way the wind fills the sails.
  add(rig, new THREE.SphereGeometry(r * 0.5, 8, 6), mat(TIMBER, 0.75), mx, y1 - r * 0.3, at);
  if (main) {
    const flag = pirateFlag(1.05, 0.66, seed);
    flag.rotation.y = Math.PI / 2;
    flag.position.set(mx, y1 - 0.06, at);
    rig.add(flag);
  }

  // The rigging.
  const ropeMat = made(RIGGING, Surface.Auto, 0.85);
  const line = (a: THREE.Vector3, b: THREE.Vector3, thick: number) =>
    rod(rig, a, b, thick, ropeMat, 5);
  // The lifts from the yards' ends up to the mast.
  for (const s of [-1, 1]) {
    const lift = onYard(s * (half - 0.08), courseY, -BRACE.course);
    line(lift, V(s * topR * 0.7, topY - 0.02, at - topR * 0.5), 0.011);
    if (topsail >= 0.5)
      line(
        onYard(s * (upper - 0.06), topsailY, -BRACE.topsail),
        V(0, y1 - 0.14, at - r * 0.45),
        0.01,
      );
  }
  if (!ship || !shape) return;
  // The shrouds, either side from the channels up to the top, with ratlines up them.
  for (const side of [-1, 1]) {
    const shrouds = shroudsAt(shape, ship.fit, at, main, side)
      .sort((a, b) => a - b)
      .map((z) => ({
        from: shroudFoot(shape, z, side),
        to: V(side * topR, topY + 0.02, at + (z - at) * 0.18),
      }));
    for (const { from, to } of shrouds) line(from, to, 0.02);
    const on = (s: (typeof shrouds)[number], y: number) =>
      s.from.clone().lerp(s.to, (y - s.from.y) / (s.to.y - s.from.y));
    const lowest = Math.max(...shrouds.map((s) => s.from.y)) + 0.42;
    for (let y = lowest; y < topY - 0.3; y += 0.36)
      for (let i = 0; i + 1 < shrouds.length; i++)
        rod(rig, on(shrouds[i]!, y), on(shrouds[i + 1]!, y), 0.011, ropeMat, 4);
    // The topmast's shrouds down to the top's rim.
    if (topsail >= 0.5)
      for (const dz of [-0.1, 0.16])
        line(
          V(side * (topR + 0.04), topY + (main ? 0.5 : 0.06), at + dz),
          V(side * r * 0.4, topsailY + 0.22, at),
          0.013,
        );
  }
  // The stays forward: to the next mast's top and head, or out to the bowsprit, with the jib.
  const head = V(0, y1 - 0.16, at - r * 0.4);
  if (ship.ahead) {
    const next = ship.ahead;
    line(
      V(0, topY + (main ? 0.42 : 0.2), at - topR - (main ? 0.06 : 0)),
      V(0, y0 + mastTop(next.h, next.main) + 0.22, next.z + 0.1),
      0.024,
    );
    line(head, V(0, y0 + next.h - 0.16, next.z + 0.08), 0.018);
  } else {
    const { to: tip } = bowsprit(shape);
    line(head, tip, 0.022);
    const clewZ = shape.front - Math.min(0.6, shape.Lb * 0.35);
    const clew = new THREE.Vector3(mx, shape.topAt(clewZ) + 0.95, clewZ);
    const jib = put(rig, jibSail(tip, head, clew, 0.3), Surface.Fabric, true, true);
    jib.name = 'jib';
  }
}

/**
 * A ship's hull fitted to the box, its bow to the front: planked strakes curving in from the
 * deck to the keel, each with a worn light edge and a dark seam, two dark wales along it (the
 * lower studded with iron) and between them a row of gun ports, their lids painted red, some
 * shut and some propped open on a gun's muzzle; a square stern with its cabin windows; in front
 * of the box, the bow sweeping in to the stem, with the bowsprit out over it. On the deck (the
 * box's top), planked bulwarks with a cap rail round it where `fit` says, open for a ladder and
 * cut down for gun ports, a rail across the front of the deck where the bow begins, and round
 * the raised stern a rail on turned balusters with the stern lantern over the transom. Outside
 * the bulwarks by each mast, the channels its shrouds come down to, with their deadeyes and
 * chain plates. The bow, the bulwarks and what is on them reach outside the box, which is the
 * deck players walk on and the hull they bump into.
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
  const s = hullShape(w, h, d);
  const { deckY, Lb, front, stemZ, counterY } = s;
  const { halfDeck, bottom, waleAt, sheer, topAt, halfAt, point, normalAt } = s;
  const ironwork = iron();

  // The strakes' seams: below the deck as shares of the way up from the keel (so they sweep up
  // to the stem with it), over it at heights.
  const below = Math.max(3, Math.round((deckY - s.keelY) / 0.26));
  const seams: ((z: number) => number)[] = [];
  for (let i = 0; i <= below; i++) seams.push((z) => bottom(z) + ((deckY - bottom(z)) * i) / below);
  const over = 3;
  const capT = 0.07;
  for (let i = 1; i <= over; i++)
    seams.push((z) => deckY + ((BULWARK + sheer(z) - capT) * i) / over);

  // Along it: from the stern to the front of the box every metre or so where its sides run
  // straight, every forty centimetres where they curve up toward the stern and its sheer
  // rises, with the ends of the bulwarks' stretches and the gun ports' sides among them; then
  // out along the bow. (A plank's tone is the same along each stretch, so its joints fall on
  // the stops, a metre or so apart as before.)
  const stops = new Set<number>();
  const n = Math.max(4, Math.round(d / 0.9));
  for (let i = 0; i <= n; i++) stops.add(d / 2 - (d * i) / n);
  // (Where the sheer starts to rise toward each end, where the bulwarks are kept apart.)
  const aftRise = d / 2 - 1.6;
  const foreRise = front + 1.6;
  if (foreRise < aftRise)
    stops
      .add(aftRise)
      .add(foreRise)
      .add(front + 0.8);
  for (let z = d / 2 - 0.4; z > aftRise + 0.2; z -= 0.4) stops.add(z);
  for (const spans of Object.values(fit.sides)) for (const [a, b] of spans) stops.add(a).add(b);
  for (const p of fit.ports) stops.add(p.z - p.width / 2).add(p.z + p.width / 2);
  const stations = [...stops]
    .filter((z) => z >= front - 1e-6 && z <= d / 2 + 1e-6)
    .sort((a, b) => b - a);
  const bow = Array.from({ length: 8 }, (_, i) => front - (Lb * (i + 1)) / 8);
  const along = [...stations, ...bow];
  /** How the bulwark stands along a side between z0 and z1. */
  const wall = (side: number, z0: number, z1: number): Wall =>
    bulwarkAt(fit, front, side, (z0 + z1) / 2);
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
    [SHADES[b]!, SHADES[b]!, SHADES[b + 1]!, SHADES[b + 1]!].map((f) => times(wood, f * t));

  // Kept apart, so each part's bounds stay snug: the hull under the deck, the bow, and each
  // bulwark, in three along the side (its waist, and where it rises toward each end).
  const parts = new Map<string, Quads>();
  const part = (key: string) => {
    if (!parts.has(key)) parts.set(key, new Quads());
    return parts.get(key)!;
  };
  const regionOf = (z: number) => (z > aftRise ? 'aft' : z < foreRise ? 'fore' : 'waist');
  const sidePart = (side: number, z0: number, z1: number) =>
    part(`side ${side} ${regionOf((z0 + z1) / 2)}`);
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
    cap: Quads,
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
      // The cap rail: a little wider than the bulwark, its top and its edges. (Apart from the
      // bulwark under it, so that what stands against the bulwark's inside, under the rail's
      // lip, stays out of the bounds of either.)
      const o0 = p0.clone().addScaledVector(n0, 0.03);
      const o1 = p1.clone().addScaledVector(n1, 0.03);
      const i0 = in0.clone().addScaledVector(n0, -0.015);
      const i1 = in1.clone().addScaledVector(n1, -0.015);
      cap.flat([up(o0, t0), up(o1, t1), up(i1, t1), up(i0, t0)], UP, times(capTone, 1.1));
      cap.flat([up(o0, c0), up(o1, c1), up(o1, t1), up(o0, t0)], n0, capTone);
      cap.flat([up(i0, c0), up(i1, c1), up(i1, t1), up(i0, t0)], inward, times(capTone, 0.85));
      cap.flat([up(o0, c0), up(o1, c1), up(i1, c1), up(i0, c0)], DOWN, times(capTone, 0.5));
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
          part(`cap ${side} ${regionOf((z0 + z1) / 2)}`),
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
      const way = b.clone().sub(a);
      return new THREE.Vector3(-way.z, 0, way.x).multiplyScalar(side).normalize();
    });
    lining(part('bow rail'), part('bow rail'), line, outs, topAt, true);
  }
  if (fit.stern) {
    const back = new THREE.Vector3(0, 0, 1);
    lining(
      part('stern'),
      part('stern cap'),
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
  const rim = (z: number) => Math.max(0.02, halfDeck(z) - thick);
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

  // The wales: dark bands proud of the planking along each side, the lower one studded with
  // iron, the upper one along the deck's line.
  // (Each side's apart from the other's, and the bow's from the waist's, so that the bounds of
  // each stay out along the side and off the deck.)
  const wales = new Map<string, Quads>();
  const dark = times(wood, 0.45);
  const proud = 0.05;
  const waleBand = (yAt: (z: number) => number, band: number, from: number) => {
    for (const side of [-1, 1])
      for (let i = 0; i + 1 < along.length; i++) {
        const [z0, z1] = [along[i]!, along[i + 1]!];
        if (z1 < from) continue;
        const at = (z: number, dy: number, by: number) => {
          const y = yAt(z) + dy;
          return point(z, y, side).addScaledVector(normalAt(z, y, side), by);
        };
        const nz = normalAt(z0, yAt(z0), side);
        const key = `${side} ${z0 <= front + 1e-6 ? 'bow' : 'waist'}`;
        if (!wales.has(key)) wales.set(key, new Quads());
        const wale = wales.get(key)!;
        wale.flat(
          [at(z0, -band, proud), at(z1, -band, proud), at(z1, band, proud), at(z0, band, proud)],
          nz,
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
  };
  const band = 0.07;
  waleBand(waleAt, band, front - Lb * 0.8);
  const upperWale = deckY + 0.02;
  waleBand(() => upperWale, 0.05, front - Lb * 0.55);
  for (const q of wales.values()) put(g, q.geometry(), Surface.Auto);
  for (const side of [-1, 1])
    for (let z = d / 2 - 0.3; z > front; z -= 0.6) {
      const y = waleAt(z);
      const p = point(z, y, side).addScaledVector(normalAt(z, y, side), proud + 0.008);
      add(
        g,
        new THREE.CylinderGeometry(0.022, 0.026, 0.02, 6).rotateZ(Math.PI / 2),
        ironwork,
        p.x,
        p.y,
        p.z,
      ).castShadow = false;
    }

  // The gun ports in a row along each side between the wales, but for where the bulwark is
  // open over them for a ladder, which leans on the side there.
  gunPorts(g, s, upperWale - 0.05, band, seed, (side, z) =>
    [-0.35, 0, 0.35].some((dz) => bulwarkAt(fit, front, side, z + dz) === 'none'),
  );

  // By each mast, the channels its shrouds come down to: a thick plank out from the side
  // either side of the ship, the deadeyes on it, and iron chain plates down the side under it.
  const chY = channelY(s);
  const deadeye = mat(0x3a2a1c, 0.75);
  for (const m of fit.masts)
    for (const side of [-1, 1]) {
      const zs = shroudsAt(s, fit, m.z, m.main, side);
      if (zs.length === 0) continue;
      const [za, zb] = [Math.min(...zs) - 0.2, Math.max(...zs) + 0.2];
      const x0 = halfAt((za + zb) / 2, chY) - 0.03;
      const reach = CHANNEL.out + 0.03;
      box(
        g,
        reach,
        0.07,
        zb - za,
        side * (x0 + reach / 2),
        chY - 0.035,
        (za + zb) / 2,
        mat(TIMBER, 0.8),
      );
      for (const z of zs) {
        const f = shroudFoot(s, z, side);
        add(
          g,
          bevelCylinder(0.065, 0.065, 0.045, 8).rotateZ(Math.PI / 2),
          deadeye,
          f.x,
          f.y - 0.07,
          z,
        );
        box(g, 0.03, 0.05, 0.035, f.x, chY + 0.02, z, ironwork);
        const hx = halfAt(z, chY - 0.3) + 0.014;
        box(g, 0.025, 0.42, 0.045, side * hx, chY - 0.28, z, ironwork);
      }
    }

  // The stern's cabin windows in a row across its transom, under the deck, lit warm, between
  // a moulding under the deck's line and another along the top of the counter.
  const frame = mat(TIMBER, 0.75);
  const across = 2 * halfAt(d / 2, deckY - 0.3) - 0.36;
  const panes = across > 2.2 ? 4 : across > 1.6 ? 3 : 2;
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

  // The stern rail: turned balusters on the cap rails round the raised stern under a rail,
  // and the stern lantern on it over the middle of the transom.
  const railUp = 0.36;
  if (fit.stern) {
    const midOf = (z: number, side: number) =>
      new THREE.Vector3(side * (halfAt(z, topAt(z)) - thick / 2), topAt(z), z);
    const run: THREE.Vector3[] = [];
    const sideRun = (side: number) => {
      const pts: THREE.Vector3[] = [];
      for (let z = d / 2 - 0.06; z > d / 2 - 1.75; z -= 0.3) {
        if (bulwarkAt(fit, front, side, z) !== 'whole') break;
        pts.push(midOf(z, side));
      }
      return pts;
    };
    const port = sideRun(-1);
    const starboard = sideRun(1);
    const backX = halfAt(d / 2, topAt(d / 2)) - thick / 2;
    const count = Math.max(2, Math.round((2 * backX) / 0.3));
    const transom: THREE.Vector3[] = [];
    for (let i = 1; i < count; i++)
      transom.push(
        new THREE.Vector3(-backX + (2 * backX * i) / count, topAt(d / 2), d / 2 - thick / 2),
      );
    run.push(...port.reverse(), ...transom, ...starboard);
    const baluster = mat(CARRIAGE, 0.75);
    for (const p of run)
      add(g, bevelCylinder(0.026, 0.034, railUp, 8), baluster, p.x, p.y + railUp / 2, p.z);
    for (let i = 0; i + 1 < run.length; i++) {
      const [a, b] = [run[i]!, run[i + 1]!];
      rod(g, up(a, a.y + railUp + 0.03), up(b, b.y + railUp + 0.03), 0.04, frame, 6, true);
    }
  }
  sternLantern(g, d / 2 - thick / 2, topAt(d / 2) + (fit.stern ? railUp + 0.06 : 0));

  // The stem post up the front of the bow, and the bowsprit out over it, lashed to the stem.
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
  const { from: spritFoot } = bowsprit(s);
  const sprit = pole(0.09, 0.05, 0, BOWSPRIT.length, colour, seed).rotateX(
    -Math.PI / 2 + BOWSPRIT.rise,
  );
  put(g, sprit.translate(spritFoot.x, spritFoot.y, spritFoot.z), Surface.Auto);
  for (const t of [0.12, 0.2]) {
    const ring = new THREE.TorusGeometry(0.095 - t * 0.05, 0.022, 5, 12).rotateX(BOWSPRIT.rise);
    const c = spritFoot
      .clone()
      .add(
        new THREE.Vector3(0, Math.sin(BOWSPRIT.rise), -Math.cos(BOWSPRIT.rise)).multiplyScalar(
          t * BOWSPRIT.length,
        ),
      );
    add(g, ring, made(RIGGING, Surface.Auto, 0.85), c.x, c.y, c.z);
  }
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
      add(
        g,
        bevelCylinder(0.026, 0.032, tall, 8),
        mat(CARRIAGE, 0.75),
        x,
        deckY + 0.06 + tall / 2,
        z,
      );
    }
  }
}

/**
 * A row of gun ports along each side of a hull (`s`), in the waist between the lower wale
 * (`band` either side of its line) and `top`: each a square opening, dark inside, in a timber
 * frame, under a lid painted red and hinged along its top, some shut and some propped open, a
 * gun's muzzle out through most of those. None where `kept` says the side is kept clear.
 */
function gunPorts(
  g: THREE.Object3D,
  s: HullShape,
  top: number,
  band: number,
  seed: () => number,
  kept: (side: number, z: number) => boolean,
) {
  const { front, d } = s;
  const from = d / 2 - 1.25;
  const to = front + 1.1;
  if (from - to < 0.5) return;
  const count = Math.max(1, Math.round((from - to) / 1.15) + 1);
  const frameMat = mat(TIMBER, 0.75);
  const hole = made(INSIDE, Surface.Auto, 0.9);
  const red = hex(PORT_RED);
  const ironwork = iron();
  const UP = new THREE.Vector3(0, 1, 0);
  for (const side of [-1, 1])
    for (let i = 0; i < count; i++) {
      const z = count === 1 ? (from + to) / 2 : from - ((from - to) * i) / (count - 1);
      if (kept(side, z)) continue;
      const low = s.waleAt(z) + band + 0.06;
      const p = Math.min(0.42, top - 0.06 - low);
      if (p < 0.2) continue;
      const y = (top - 0.06 + low) / 2;
      // A frame of its own on the side there: its z out of the side, its y up.
      const out = s.normalAt(z, y, side);
      const upward = UP.clone().addScaledVector(out, -out.y).normalize();
      const port = new THREE.Group();
      port.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(upward.clone().cross(out), upward, out),
      );
      port.position.copy(s.point(z, y, side));
      g.add(port);
      add(port, bevelBox(p + 0.15, p + 0.15, 0.05), frameMat, 0, 0, 0);
      add(port, new THREE.BoxGeometry(p, p, 0.062), hole, 0, 0, 0);
      // The lid, hinged along the frame's top: shut, or swung out and up.
      const open = seed() < 0.55;
      const hinge = new THREE.Group();
      hinge.position.set(0, p / 2 + 0.03, 0.035);
      hinge.rotation.x = open ? -(0.55 + seed() * 0.45) : -0.03;
      port.add(hinge);
      const lid = p + 0.05;
      // Three boards, each a shade off, the paint worn here and there.
      const boards = [0, 1, 2].map((k) =>
        block(
          lid / 3 - 0.008,
          lid,
          0.04,
          (k - 1) * (lid / 3),
          -lid / 2,
          0.02,
          times(red, 0.82 + seed() * 0.22),
        ),
      );
      put(hinge, mergeGeometries(boards), Surface.Auto);
      for (const sx of [-1, 1])
        add(
          hinge,
          new THREE.BoxGeometry(0.035, lid * 0.7, 0.012),
          ironwork,
          sx * lid * 0.28,
          -lid * 0.35,
          0.045,
        );
      if (open && seed() < 0.75) {
        const muzzle = bevelCylinder(p * 0.22, p * 0.25, 0.3, 10).rotateX(Math.PI / 2);
        add(port, muzzle, mat(IRON, 0.4, 0.55), 0, -p * 0.08, 0.12);
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
