import * as THREE from 'three';

/**
 * Walking about the pirate test map: what stands in the way and what can be stood on, and a
 * player that walks, runs, jumps, steps up and wades. The map has no game on it, so this is a
 * small controller of its own rather than the game's physics: upright boxes, round posts and
 * ramps, laid down by the models as they are built, over the ground's own height.
 */

/** An upright box turned `yaw` about y (as `cos`, `sin`), in the world. */
interface Block {
  x: number;
  z: number;
  hx: number;
  hz: number;
  cos: number;
  sin: number;
  y0: number;
  y1: number;
}

/** A sloping walkway: its top `ya` high at its local -z end and `yb` at its +z end. */
interface Ramp {
  x: number;
  z: number;
  hx: number;
  hz: number;
  cos: number;
  sin: number;
  ya: number;
  yb: number;
}

/** An upright cylinder. */
interface Round {
  x: number;
  z: number;
  r: number;
  y0: number;
  y1: number;
}

/** How high a player steps up without jumping, in metres. */
export const STEP = 0.45;
/** The player's radius and height. */
export const RADIUS = 0.32;
export const HEIGHT = 1.75;
/** The game's own gravity and a jump that clears a barrel. */
const GRAVITY = 15;
const JUMP = 6.2;
const WALK = 4.2;
const RUN = 7.5;
/** Water deeper than this over the ground (m) is too deep to wade into. */
const TOO_DEEP = 1.3;

const v = new THREE.Vector3();
const e = new THREE.Vector3();

/** Where `frame`'s local point is in the world, and which way it is turned about y. */
function place(frame: THREE.Object3D, x: number, y: number, z: number, yaw: number) {
  frame.updateWorldMatrix(true, false);
  v.set(x, y, z).applyMatrix4(frame.matrixWorld);
  e.set(1, 0, 0).transformDirection(frame.matrixWorld);
  const turn = Math.atan2(-e.z, e.x) + yaw;
  return { x: v.x, y: v.y, z: v.z, cos: Math.cos(turn), sin: Math.sin(turn) };
}

/** Everything solid on the map, and what can be stood on. */
export class Solids {
  readonly blocks: Block[] = [];
  readonly ramps: Ramp[] = [];
  readonly rounds: Round[] = [];

  /**
   * A box `sx × sy × sz` in `frame`'s own space (which may only be turned about y), its foot's
   * middle at (`x`, `y`, `z`), turned `yaw` more.
   */
  box(
    frame: THREE.Object3D,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    yaw = 0,
  ): void {
    const p = place(frame, x, y, z, yaw);
    this.blocks.push({
      x: p.x,
      z: p.z,
      hx: sx / 2,
      hz: sz / 2,
      cos: p.cos,
      sin: p.sin,
      y0: p.y,
      y1: p.y + sy,
    });
  }

  /** A walkway `sx × sz`, its top rising from `ya` at its -z end to `yb` at its +z end. */
  ramp(
    frame: THREE.Object3D,
    x: number,
    z: number,
    sx: number,
    sz: number,
    ya: number,
    yb: number,
    yaw = 0,
  ): void {
    const p = place(frame, x, 0, z, yaw);
    const base = p.y;
    this.ramps.push({
      x: p.x,
      z: p.z,
      hx: sx / 2,
      hz: sz / 2,
      cos: p.cos,
      sin: p.sin,
      ya: base + ya,
      yb: base + yb,
    });
  }

  /** An upright post of radius `r` from `y0` to `y1` over (`x`, `z`) in `frame`'s space. */
  post(frame: THREE.Object3D, x: number, z: number, r: number, y0: number, y1: number): void {
    const p = place(frame, x, y0, z, 0);
    this.rounds.push({ x: p.x, z: p.z, r, y0: p.y, y1: p.y + (y1 - y0) });
  }

  /**
   * The highest thing to stand on under (`x`, `z`) no higher than `reach`, over `ground` (the
   * terrain's height there).
   */
  support(x: number, z: number, reach: number, ground: number): number {
    let top = ground;
    const foot = RADIUS * 0.6;
    for (const b of this.blocks) {
      if (b.y1 > reach || b.y1 <= top) continue;
      const [dx, dz] = [x - b.x, z - b.z];
      const lx = dx * b.cos - dz * b.sin;
      const lz = dx * b.sin + dz * b.cos;
      if (Math.abs(lx) <= b.hx + foot && Math.abs(lz) <= b.hz + foot) top = b.y1;
    }
    for (const r of this.rounds) {
      if (r.y1 > reach || r.y1 <= top) continue;
      if (Math.hypot(x - r.x, z - r.z) <= r.r + foot) top = r.y1;
    }
    for (const r of this.ramps) {
      const [dx, dz] = [x - r.x, z - r.z];
      const lx = dx * r.cos - dz * r.sin;
      const lz = dx * r.sin + dz * r.cos;
      if (Math.abs(lx) > r.hx || Math.abs(lz) > r.hz) continue;
      const y = r.ya + ((r.yb - r.ya) * (lz + r.hz)) / (2 * r.hz);
      if (y <= reach && y > top) top = y;
    }
    return top;
  }

  /**
   * Pushes a player standing at `p` (their feet) out of everything they would stand inside:
   * whatever reaches higher than a step over their feet and lower than their head.
   */
  pushOut(p: THREE.Vector3): void {
    const lo = p.y + STEP;
    const hi = p.y + HEIGHT;
    for (let pass = 0; pass < 3; pass++) {
      for (const b of this.blocks) {
        if (b.y1 <= lo || b.y0 >= hi) continue;
        const [dx, dz] = [p.x - b.x, p.z - b.z];
        const lx = dx * b.cos - dz * b.sin;
        const lz = dx * b.sin + dz * b.cos;
        const qx = Math.max(-b.hx, Math.min(b.hx, lx));
        const qz = Math.max(-b.hz, Math.min(b.hz, lz));
        let [ox, oz] = [lx - qx, lz - qz];
        const d = Math.hypot(ox, oz);
        if (d >= RADIUS) continue;
        if (d > 1e-6) {
          [ox, oz] = [(ox / d) * (RADIUS - d), (oz / d) * (RADIUS - d)];
        } else {
          // Inside it: out the nearest side.
          const px = b.hx - Math.abs(lx);
          const pz = b.hz - Math.abs(lz);
          if (px < pz) [ox, oz] = [Math.sign(lx || 1) * (px + RADIUS), 0];
          else [ox, oz] = [0, Math.sign(lz || 1) * (pz + RADIUS)];
        }
        p.x += ox * b.cos + oz * b.sin;
        p.z += -ox * b.sin + oz * b.cos;
      }
      for (const r of this.rounds) {
        if (r.y1 <= lo || r.y0 >= hi) continue;
        const [dx, dz] = [p.x - r.x, p.z - r.z];
        const d = Math.hypot(dx, dz);
        const need = r.r + RADIUS;
        if (d >= need) continue;
        const [nx, nz] = d > 1e-6 ? [dx / d, dz / d] : [1, 0];
        p.x = r.x + nx * need;
        p.z = r.z + nz * need;
      }
    }
  }
}

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
