import * as THREE from 'three';
import { GRAVITY } from '@sar/shared';
import { STEP, Solids } from '../carscene/solids.ts';

/**
 * Walking about the pirate test map: a player that walks, runs, jumps, steps up and wades. The
 * map has no game on it, so this is a small controller of its own rather than the game's
 * physics, over the map's `Solids` and the ground's own height.
 */

/** A jump that clears a barrel, under the game's own gravity. */
const JUMP = 6.2;
const WALK = 4.2;
const RUN = 7.5;
/** Water deeper than this over the ground (m) is too deep to wade into. */
const TOO_DEEP = 1.3;

/** What the player asks for this frame. */
export interface Intent {
  /** The way to walk in the world (x, z), at most 1 long. */
  x: number;
  z: number;
  run: boolean;
  jump: boolean;
}

/** The player walking about: where their feet are, and how fast they are falling. */
export class Walker {
  readonly pos = new THREE.Vector3();
  vy = 0;
  grounded = true;
  /** Which way they face (yaw, facing -z at 0, as the game's avatars do). */
  heading = 0;
  /** Whether they stand in water. */
  wading = false;

  constructor(
    private readonly solids: Solids,
    private readonly ground: (x: number, z: number) => number,
    private readonly sea: number,
  ) {}

  /** Puts them on whatever stands at (`x`, `z`), no higher than `reach` if given. */
  spawn(x: number, z: number, reach?: number): void {
    const g = this.ground(x, z);
    this.pos.set(x, this.solids.support(x, z, reach ?? g + 50, g), z);
    this.vy = 0;
    this.grounded = true;
  }

  update(dt: number, intent: Intent): void {
    const p = this.pos;
    const before = p.clone();
    const g0 = this.ground(p.x, p.z);
    this.wading = this.solids.support(p.x, p.z, p.y + STEP, g0) < this.sea - 0.3;
    const speed = (intent.run ? RUN : WALK) * (this.wading ? 0.55 : 1);
    p.x += intent.x * speed * dt;
    p.z += intent.z * speed * dt;
    this.solids.pushOut(p);
    const g = this.ground(p.x, p.z);
    const under = this.solids.support(p.x, p.z, p.y + STEP, g);
    if (this.sea - under > TOO_DEEP) {
      p.x = before.x;
      p.z = before.z;
    }
    if (Math.hypot(intent.x, intent.z) > 0.05) this.heading = Math.atan2(-intent.x, -intent.z);

    const floor = this.solids.support(p.x, p.z, p.y + STEP, this.ground(p.x, p.z));
    if (this.grounded && intent.jump) {
      this.vy = JUMP;
      this.grounded = false;
    }
    if (this.grounded) {
      // Down slopes and steps with the ground, as long as it is within a step.
      if (floor >= p.y - STEP) p.y = floor;
      else this.grounded = false;
    }
    if (!this.grounded) {
      this.vy -= GRAVITY * dt;
      p.y += this.vy * dt;
      const land = this.solids.support(
        p.x,
        p.z,
        Math.max(p.y, before.y) + 0.05,
        this.ground(p.x, p.z),
      );
      if (p.y <= land) {
        p.y = land;
        this.vy = 0;
        this.grounded = true;
      }
    }
  }
}
