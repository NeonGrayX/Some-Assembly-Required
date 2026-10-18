import { Spring } from './camera.ts';

/**
 * How a builder turns to face the way they walk. The body swings round on a damped spring, so a
 * change of direction is a short turn rather than a snap: a quarter turn takes about a fifth of
 * a second, an about-turn a little longer. `omega` and `zeta` are as for the camera's springs.
 */
export const TURN_FEEL = { omega: 14, zeta: 1 };
/** Going slower than this (m/s), a builder seen from afar is standing: they keep their facing. */
const MOVING = 0.6;
/** Moved this far in one frame (a meeting, a respawn): not walking, and no turn either. */
const TELEPORT = 0.5;

const TAU = Math.PI * 2;
const wrap = (a: number): number => a - TAU * Math.round(a / TAU);

/**
 * The heading (yaw, facing -z at 0) of walking `forward` and `right` (as in `PlayerInput`) with
 * the view turned to `yaw`, or null when not walking at all.
 */
export function walkHeading(yaw: number, forward: number, right: number): number | null {
  if (Math.hypot(forward, right) < 0.05) return null;
  const x = -Math.sin(yaw) * forward + Math.cos(yaw) * right;
  const z = -Math.cos(yaw) * forward - Math.sin(yaw) * right;
  return Math.atan2(-x, -z);
}

/**
 * Which way a builder's body faces, apart from where they look: in third person they face the
 * way they walk (as on the island test map) and keep facing it when they stop, turning round to
 * where they look only when something in their hands has to be held out there.
 */
export class Facing {
  private readonly spring = new Spring(TURN_FEEL.omega, TURN_FEEL.zeta);
  /** What they last turned to face. */
  private want: number;
  /** Where they were last frame, and how fast they went along the ground since, smoothed. */
  private at: { x: number; z: number } | null = null;
  private readonly vel = { x: 0, z: 0 };
  /** They moved too far last frame to have walked there (see `walking`). */
  jumped = false;

  constructor(heading: number) {
    this.spring.reset(heading);
    this.want = heading;
  }

  /** The heading the body is drawn at. */
  get heading(): number {
    return this.spring.x;
  }

  /** How fast the body turns, in radians per second: positive turning to its left. */
  get spin(): number {
    return this.spring.v;
  }

  /** How far the body still has to turn to face the way it is turning to: positive to its left. */
  get lead(): number {
    return wrap(this.want - this.spring.x);
  }

  /**
   * Which way a builder walks, from where they are drawn frame to frame (`x`, `z`, `dt` seconds
   * after the last), or null when they stand still: for someone else, whose keys are not sent,
   * only where they are. Call every frame, for everyone: it also notes a jump (`jumped`).
   */
  walking(x: number, z: number, dt: number): number | null {
    const last = this.at;
    this.at = { x, z };
    this.jumped = false;
    if (!last || dt <= 0) return null;
    const [dx, dz] = [x - last.x, z - last.z];
    if (Math.hypot(dx, dz) > TELEPORT) {
      this.vel.x = this.vel.z = 0;
      this.jumped = true;
      return null;
    }
    // Snapshots come in fewer a second than frames are drawn: smoothed, so a frame between two
    // that did not move does not read as stopping.
    const k = 1 - Math.exp(-dt * 10);
    this.vel.x += (dx / dt - this.vel.x) * k;
    this.vel.z += (dz / dt - this.vel.z) * k;
    if (Math.hypot(this.vel.x, this.vel.z) < MOVING) return null;
    return Math.atan2(-this.vel.x, -this.vel.z);
  }

  /** Turns on by `dt` seconds toward `heading`, or toward the last one given when null. */
  turn(heading: number | null, dt: number): number {
    if (heading !== null) this.want = heading;
    // The short way round, from wherever the body is.
    const s = this.spring;
    if (Math.abs(s.x) > Math.PI) s.x = wrap(s.x);
    return s.step(s.x + wrap(this.want - s.x), dt);
  }

  /** Faces `heading` at once, with no turn (put somewhere new, as at a meeting). */
  snap(heading: number): void {
    this.spring.reset(heading);
    this.want = heading;
  }
}
