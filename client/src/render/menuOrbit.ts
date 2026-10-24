import { BRICK_TYPES, STUD, groundHeight } from '@sar/shared';
import type { BoxDef, LevelDef, Vec3 } from '@sar/shared';
import { PALM_CROWN } from './nature.ts';
import { PINE_BOUGHS } from './props.ts';
import { flagFly } from './pirate/flags.ts';
import { mastSpread } from './pirate/ship.ts';

/**
 * The slow fly-around of the yard behind the main menu. It circles the job site, starting on
 * its open side with the house in view behind it, and where a wall, a roof or anything else
 * stands between the site and the circle (the house, whichever way it is furnished, or the
 * last round's map) the camera comes in closer, ahead of it, the way the player's camera boom
 * shortens, so it never flies through anything.
 */
export const MENU_ORBIT = {
  /** How far out from the job site the camera circles when nothing is in the way, in metres. */
  radius: 9,
  /** How high over the point it looks at, at that distance. */
  rise: 4.5,
  /** The height above the floor of the point it looks at, over the middle of the baseplate. */
  lookHeight: 0.5,
  /** Radians per second round the circle. */
  speed: 0.1,
  /** Where on the circle it starts: south of the site, looking north at the house. */
  start: Math.PI,
  /** How far the camera keeps clear of walls and furniture, in metres. */
  clearance: 0.6,
  /** Sample directions round the circle where the way out is measured. */
  samples: 360,
  /** Directions either side over which coming in and going back out is eased. */
  ease: 12,
  /** The least of the boom it keeps, so a site boxed in on every side still gets a view. */
  minReach: 0.15,
};

/** An axis-aligned box, by its corners. */
export interface Aabb {
  min: Vec3;
  max: Vec3;
}

/**
 * How far round the middle of a tall thing's box what is drawn of it spreads without colliding:
 * a pine's boughs, a palm's fronds, a mast's yards and sails, a flagpole's flag.
 */
function spread(b: BoxDef): number {
  switch (b.model) {
    case 'pine':
      return b.size.y * PINE_BOUGHS;
    case 'palm':
      return b.size.y * PALM_CROWN;
    case 'mast':
      return mastSpread(b.size.y);
    case 'flagpole':
      return flagFly(b.size.y);
    default:
      return 0;
  }
}

/**
 * Where a box stops a camera: its own box grown by `pad`, and out to whatever spreads round it
 * without colliding (a tree's boughs, a ship's rig: see `spread`).
 */
export function cameraBlocker(b: BoxDef, pad: number): Aabb {
  const out = spread(b);
  const hx = Math.max(b.size.x / 2, out) + pad;
  const hz = Math.max(b.size.z / 2, out) + pad;
  // A tilted box (a ramp) gets the room it needs at any tilt.
  const hy = b.tiltX ? Math.hypot(b.size.y, b.size.z) / 2 + pad : b.size.y / 2 + pad;
  return {
    min: { x: b.pos.x - hx, y: b.pos.y - hy, z: b.pos.z - hz },
    max: { x: b.pos.x + hx, y: b.pos.y + hy, z: b.pos.z + hz },
  };
}

const inside = (p: Vec3, b: Aabb): boolean =>
  p.x > b.min.x &&
  p.x < b.max.x &&
  p.y > b.min.y &&
  p.y < b.max.y &&
  p.z > b.min.z &&
  p.z < b.max.z;

/** How far along `a`→`b` (0 to 1) the line first enters `box`, or 1 if it never does. */
export function entry(a: Vec3, b: Vec3, box: Aabb): number {
  let t0 = 0;
  let t1 = 1;
  for (const k of ['x', 'y', 'z'] as const) {
    const d = b[k] - a[k];
    if (Math.abs(d) < 1e-12) {
      if (a[k] <= box.min[k] || a[k] >= box.max[k]) return 1;
      continue;
    }
    let near = (box.min[k] - a[k]) / d;
    let far = (box.max[k] - a[k]) / d;
    if (near > far) [near, far] = [far, near];
    t0 = Math.max(t0, near);
    t1 = Math.min(t1, far);
    if (t0 >= t1) return 1;
  }
  return t0;
}

/**
 * How far along `a`→`b` (0 to 1) the line first comes within `clearance` over the ground of
 * `level` (where it rises and falls), or 1 if it never does: measured every quarter metre or
 * so, from a little way out (what is right under the start is part of the view).
 */
export function groundEntry(level: LevelDef, a: Vec3, b: Vec3, clearance: number): number {
  if (!level.terrain?.length) return 1;
  const steps = Math.max(4, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 0.25));
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    if (a.y + (b.y - a.y) * t < groundHeight(level, x, z) + clearance) return (k - 1) / steps;
  }
  return 1;
}

/** The point it circles: over the middle of the level's (first) baseplate. */
export function menuLookAt(level: LevelDef): Vec3 {
  const plate = BRICK_TYPES.baseplate16;
  return {
    x: level.baseplate.x + (plate.studsX * STUD) / 2,
    y: level.baseplate.y + MENU_ORBIT.lookHeight,
    z: level.baseplate.z + (plate.studsZ * STUD) / 2,
  };
}

/** Where the camera is on the circle at `angle` when nothing is in the way. */
const outAt = (look: Vec3, angle: number): Vec3 => ({
  x: look.x + Math.sin(angle) * MENU_ORBIT.radius,
  y: look.y + MENU_ORBIT.rise,
  z: look.z + Math.cos(angle) * MENU_ORBIT.radius,
});

/**
 * The fly-around for one level. How much of the boom is free is measured once, in every
 * direction, then eased round the circle: each direction keeps no more than the least of its
 * neighbours', averaged, so the camera starts to come in before it reaches a wall and is
 * never further out than the way is clear.
 */
export class MenuOrbit {
  readonly look: Vec3;
  /** The fraction of the boom the camera keeps, by sample direction. */
  readonly reach: Float64Array;

  constructor(readonly level: LevelDef) {
    const { samples, ease, clearance, minReach } = MENU_ORBIT;
    this.look = menuLookAt(level);
    // Whatever the camera looks at from right on top of it (a fire pit's kerb, a pallet beside
    // the site) is part of the view, not a wall to keep out of.
    const blockers = level.boxes
      .map((b) => cameraBlocker(b, clearance))
      .filter((b) => !inside(this.look, b));
    const raw = new Float64Array(samples);
    for (let i = 0; i < samples; i++) {
      const out = outAt(this.look, (i / samples) * Math.PI * 2);
      // Kept clear of the boxes, and of the hills where the ground rises and falls.
      let s = groundEntry(level, this.look, out, clearance);
      for (const b of blockers) s = Math.min(s, entry(this.look, out, b));
      raw[i] = Math.max(minReach, s);
    }
    const at = (a: Float64Array, i: number) => a[((i % samples) + samples) % samples]!;
    const least = new Float64Array(samples);
    for (let i = 0; i < samples; i++) {
      let m = Infinity;
      for (let j = -ease; j <= ease; j++) m = Math.min(m, at(raw, i + j));
      least[i] = m;
    }
    this.reach = new Float64Array(samples);
    for (let i = 0; i < samples; i++) {
      let sum = 0;
      for (let j = -ease; j <= ease; j++) sum += at(least, i + j);
      this.reach[i] = sum / (2 * ease + 1);
    }
  }

  /** The fraction of the boom kept at `angle`, between the measured directions. */
  reachAt(angle: number): number {
    const n = MENU_ORBIT.samples;
    const f = (((angle / (Math.PI * 2)) % 1) + 1) % 1;
    const i = Math.floor(f * n);
    const k = f * n - i;
    return this.reach[i % n]! * (1 - k) + this.reach[(i + 1) % n]! * k;
  }

  /** Where the camera is `seconds` into the fly-around. */
  at(seconds: number): Vec3 {
    const angle = MENU_ORBIT.start + seconds * MENU_ORBIT.speed;
    const out = outAt(this.look, angle);
    const s = this.reachAt(angle);
    return {
      x: this.look.x + (out.x - this.look.x) * s,
      y: this.look.y + (out.y - this.look.y) * s,
      z: this.look.z + (out.z - this.look.z) * s,
    };
  }
}
