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
  /** Whether it can be stood on (a stair's underside, say, only stands in the way). */
  stand: boolean;
  /** Whether it stands in the way from the feet up, too low as it is to step over (a wheel). */
  trip?: boolean;
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
/**
 * Side-on, squeezing through a gap: half as deep as they are, chest to back, and as wide as ever
 * along the way they edge.
 */
export const SLIM = 0.17;
/** How fast they edge along side-on (m/s). */
const EDGE = 1.4;
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
   * middle at (`x`, `y`, `z`), turned `yaw` more; one that only stands in the way if not `stand`,
   * and from the feet up if `trip` (see `Block`).
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
    stand = true,
    trip = false,
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
      stand,
      trip,
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
      if (!b.stand || b.y1 > reach || b.y1 <= top) continue;
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
   * whatever reaches higher than a step over their feet and lower than their head. Side-on along
   * `along` (a unit way in x, z), as they squeeze through a gap, they are `SLIM` across it and
   * as wide as ever along it.
   */
  pushOut(p: THREE.Vector3, along?: { x: number; z: number }): void {
    const lo = p.y + STEP;
    const hi = p.y + HEIGHT;
    const r = along ? SLIM : RADIUS;
    // Side-on, a row of three circles from shoulder to shoulder.
    const [ax, az] = along ? [along.x * (RADIUS - SLIM), along.z * (RADIUS - SLIM)] : [0, 0];
    const ends = along ? [0, -1, 1] : [0];
    for (let pass = 0; pass < 3; pass++) {
      for (const b of this.blocks) {
        if (b.y1 <= (b.trip ? p.y + 0.02 : lo) || b.y0 >= hi) continue;
        let [ox, oz, most] = [0, 0, 0];
        for (const k of ends) {
          const [dx, dz] = [p.x + k * ax - b.x, p.z + k * az - b.z];
          const lx = dx * b.cos - dz * b.sin;
          const lz = dx * b.sin + dz * b.cos;
          const qx = Math.max(-b.hx, Math.min(b.hx, lx));
          const qz = Math.max(-b.hz, Math.min(b.hz, lz));
          let [ex, ez] = [lx - qx, lz - qz];
          const d = Math.hypot(ex, ez);
          if (d >= r) continue;
          if (d > 1e-6) {
            [ex, ez] = [(ex / d) * (r - d), (ez / d) * (r - d)];
          } else {
            // Inside it: out the nearest side.
            const px = b.hx - Math.abs(lx);
            const pz = b.hz - Math.abs(lz);
            if (px < pz) [ex, ez] = [Math.sign(lx || 1) * (px + r), 0];
            else [ex, ez] = [0, Math.sign(lz || 1) * (pz + r)];
          }
          const n = Math.hypot(ex, ez);
          if (n > most) [ox, oz, most] = [ex, ez, n];
        }
        p.x += ox * b.cos + oz * b.sin;
        p.z += -ox * b.sin + oz * b.cos;
      }
      for (const c of this.rounds) {
        if (c.y1 <= lo || c.y0 >= hi) continue;
        let [ox, oz, most] = [0, 0, 0];
        for (const k of ends) {
          const [dx, dz] = [p.x + k * ax - c.x, p.z + k * az - c.z];
          const d = Math.hypot(dx, dz);
          const need = c.r + r;
          if (d >= need) continue;
          const [nx, nz] = d > 1e-6 ? [dx / d, dz / d] : [1, 0];
          if (need - d > most) [ox, oz, most] = [nx * (need - d), nz * (need - d), need - d];
        }
        p.x += ox;
        p.z += oz;
      }
    }
  }

  /** Whether a player standing at `p` is clear of everything (side-on along `along`, if given). */
  clear(p: THREE.Vector3, along?: { x: number; z: number }): boolean {
    const q = p.clone();
    this.pushOut(q, along);
    return Math.hypot(q.x - p.x, q.z - p.z) < 0.01;
  }

  /**
   * Pushes a player who has moved to `p` from `from` out of everything (as `pushOut`), or puts
   * them back at `from` where they cannot be: in a gap too narrow for them, pushed out of one
   * side into the other.
   */
  settle(p: THREE.Vector3, from: THREE.Vector3, along?: { x: number; z: number }): void {
    this.pushOut(p, along);
    if (this.clear(p, along) || !this.clear(from, along)) return;
    p.x = from.x;
    p.z = from.z;
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
  /** Whether they turn side-on to squeeze through a gap too narrow to walk through. */
  squeezes = false;
  /** While they squeeze through a gap: the way along it (x, z, a unit long), else null. */
  squeeze: { x: number; z: number } | null = null;
  /** How fast they edge along it (m/s), to their right if more than 0. */
  edging = 0;
  /** How long they have been held up at a gap they would get through side-on (s). */
  private held = 0;

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
    this.squeeze = null;
    this.held = 0;
  }

  update(dt: number, intent: Intent): void {
    const p = this.pos;
    const before = p.clone();
    const g0 = this.ground(p.x, p.z);
    this.wading = this.solids.support(p.x, p.z, p.y + STEP, g0) < this.sea - 0.3;
    const speed = (intent.run ? RUN : WALK) * (this.wading ? 0.55 : 1);
    const want = Math.hypot(intent.x, intent.z);
    this.edging = 0;
    if (this.squeeze) this.edge(dt, intent);
    else {
      p.x += intent.x * speed * dt;
      p.z += intent.z * speed * dt;
      this.solids.settle(p, before);
      if (this.squeezes && this.grounded && want > 0.5)
        this.wedged(before, intent.x / want, intent.z / want, speed * want * dt, dt);
    }
    const g = this.ground(p.x, p.z);
    const under = this.solids.support(p.x, p.z, p.y + STEP, g);
    if (this.sea - under > TOO_DEEP) {
      p.x = before.x;
      p.z = before.z;
    }
    // Side-on while squeezing, their right toward the way along the gap.
    if (this.squeeze) this.heading = Math.atan2(-this.squeeze.x, -this.squeeze.z) + Math.PI / 2;
    else if (want > 0.05) this.heading = Math.atan2(-intent.x, -intent.z);

    const floor = this.solids.support(p.x, p.z, p.y + STEP, this.ground(p.x, p.z));
    if (this.grounded && intent.jump && !this.squeeze) {
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

  /**
   * Held up walking along (`ux`, `uz`), having gone less than a third of the `step` asked: if
   * side-on they would get on, as through a gap narrower than their shoulders but wider than
   * they are deep, and they have kept on at it a moment, they turn side-on to squeeze through.
   */
  private wedged(before: THREE.Vector3, ux: number, uz: number, step: number, dt: number): void {
    const p = this.pos;
    const gone = (p.x - before.x) * ux + (p.z - before.z) * uz;
    if (gone > step * 0.3) {
      this.held = 0;
      return;
    }
    const way = { x: ux, z: uz };
    const q = before.clone();
    q.x += ux * 0.06;
    q.z += uz * 0.06;
    this.solids.settle(q, before, way);
    if ((q.x - before.x) * ux + (q.z - before.z) * uz < 0.03) {
      this.held = 0;
      return;
    }
    this.held += dt;
    if (this.held < 0.1) return;
    this.held = 0;
    this.squeeze = way;
  }

  /**
   * Edging along the gap they squeeze through, as far as they ask to go along it (either way),
   * and turned back to walk on once there is room to stand facing the usual way (shouldered a
   * little aside, if need be), there and a little further on the way they go; or asking to go
   * off another way, once there is room where they stand.
   */
  private edge(dt: number, intent: Intent): void {
    const a = this.squeeze!;
    const p = this.pos;
    const along = Math.max(-1, Math.min(1, intent.x * a.x + intent.z * a.z));
    const from = p.clone();
    p.x += a.x * along * EDGE * dt;
    p.z += a.z * along * EDGE * dt;
    this.solids.settle(p, from, a);
    this.edging = dt > 0 ? ((p.x - from.x) * a.x + (p.z - from.z) * a.z) / dt : 0;
    const room = (s: number) => {
      const q = new THREE.Vector3(p.x + a.x * s, p.y, p.z + a.z * s);
      const at = q.clone();
      this.solids.pushOut(q);
      return q.distanceTo(at) < 0.08 && this.solids.clear(q) ? q : null;
    };
    const here = room(0);
    if (!here) return;
    const off = Math.hypot(intent.x, intent.z) > 0.5;
    const out =
      Math.abs(along) > 0.3 ? room(Math.sign(along) * 0.1) : off || (room(0.1) && room(-0.1));
    if (!out) return;
    p.x = here.x;
    p.z = here.z;
    this.squeeze = null;
  }
}
