import type { Collider } from '@dimforge/rapier3d-compat';
import { BRICK_TYPES, PLATE_H, STUD } from '../bricks.ts';
import { v3 } from '../math.ts';
import type { Vec3 } from '../math.ts';
import type { Assembly, Player } from './sim.ts';
import { TICK_RATE } from './time.ts';

/**
 * The bodies the simulation is made of, as every part of it measures them: a player's capsule
 * and how they step, squeeze and climb, what a brick weighs, and which bodies the physics world
 * lets meet.
 */

// Player
export const PLAYER_RADIUS = 0.3;
export const PLAYER_HALF_HEIGHT = 0.55;
/** How far below the centre of a player's capsule their feet are. */
export const PLAYER_FEET = PLAYER_HALF_HEIGHT + PLAYER_RADIUS;
/** Eye height above the capsule centre. */
export const EYE_OFFSET = 0.6;
/** The gap the character controller keeps between a player and what they stand on or touch. */
export const CONTROLLER_OFFSET = 0.02;
/**
 * How high a player steps up without jumping (m), no higher than there is room overhead; held
 * up on the ground, they try stepping up by each of `CLIMB_TRIES` in turn (see `climb`).
 */
export const STEP_UP = 0.45;
export const CLIMB_TRIES = [0.2, 0.32, STEP_UP];
/**
 * Squeezing through a gap narrower than their shoulders: how far their shoulders reach out to
 * each side, how deep they are side-on (half of it), how fast they edge along (m/s), and how far
 * before and behind them a gap's sides are looked for (m).
 */
export const SQUEEZE = { shoulder: 0.37, slim: 0.17, edge: 1.4, reach: 0.3 };
// Bricks
export const BRICK_DENSITY = 300;
/** The steepest slope a player walks up (in radians): steeper ground they slide back down. */
export const MAX_CLIMB = (50 * Math.PI) / 180;
// Collision groups: membership in the high 16 bits, filter in the low 16 bits.
export const G_WORLD = 0x1;
export const G_PLAYER = 0x2;
export const G_HELD = 0x4;
export const groups = (member: number, filter: number) => (member << 16) | filter;
export const WORLD_GROUPS = groups(G_WORLD, 0xffff);
export const PLAYER_GROUPS = groups(G_PLAYER, G_WORLD | G_PLAYER);
export const HELD_GROUPS = groups(G_HELD, G_WORLD | G_HELD);
/** In the way of players (and the dog), and nothing else; and of everything else but them. */
export const PLAYER_ONLY_GROUPS = groups(G_WORLD, G_PLAYER);
export const NOT_PLAYER_GROUPS = groups(G_WORLD, 0xffff & ~G_PLAYER);
/** Direction the player is looking. Yaw 0 looks down -z, positive pitch looks up. */
export function viewDir(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return v3(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
}
/**
 * A single loose brick, carried in the hands. A baseplate on its own is still a build: it is
 * carried in front, set down gently and goes back on the job site.
 */
export function isLooseBrick(a: Assembly): boolean {
  if (a.grid.size !== 1) return false;
  const only = a.grid.bricks.values().next().value!;
  return !BRICK_TYPES[only.type].fixture;
}
/** Mass of an assembly computed from its bricks, so client and server agree on it. */
export function assemblyMass(a: Assembly): number {
  let volume = 0;
  for (const b of a.grid.bricks.values()) {
    const t = BRICK_TYPES[b.type];
    volume += t.studsX * t.studsZ * STUD * STUD * t.plates * PLATE_H;
  }
  return volume * BRICK_DENSITY;
}

/**
 * Carry fatigue: after this long carrying a build (not a single brick) arms tire and the
 * carrier slows down, at `TIRED_DROP_TICKS` they set it down, and a tired player cannot lift a
 * build again until rested below the first mark. Rest takes as long as the carrying did.
 */
export const TIRED_TICKS = 45 * TICK_RATE;
export const TIRED_DROP_TICKS = 60 * TICK_RATE;
/** Speed at the drop mark, against fresh arms. */
export const TIRED_SPEED = 0.5;
/** How fast tired arms let a player go (1: not tired), from `TIRED_TICKS` down to the drop. */
export function tiredFactor(p: Player): number {
  if (p.fatigue <= TIRED_TICKS) return 1;
  const t = Math.min(1, (p.fatigue - TIRED_TICKS) / (TIRED_DROP_TICKS - TIRED_TICKS));
  return 1 - (1 - TIRED_SPEED) * t;
}

/** How far a player reaches to click something (m), from their eye. */
export const REACH = 2.6;

/** A quarter turn (radians), what a brick in hand turns by. */
export const QUARTER = Math.PI / 2;

/** All of an assembly's colliders. */
export function* collidersOf(a: Assembly): Generator<Collider> {
  for (const cs of a.colliders.values()) yield* cs;
}

export const PAGE_SIZE = { x: 0.3, y: 0.008, z: 0.42 };
/**
 * Where the middle of something `size.y` tall goes to rest on a surface at `at` (just clear of
 * it, so it never starts out stuck in it): pages and gear are placed by their middle.
 */
export function restingOn(at: Vec3, size: { y: number }): Vec3 {
  return v3(at.x, at.y + size.y / 2 + 0.01, at.z);
}

/** Size of a piece of gear lying about (its collider, and about what the client draws). */
export const GEAR_SIZE = { x: 0.3, y: 0.14, z: 0.3 };
