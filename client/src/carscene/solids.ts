import * as THREE from 'three';

/**
 * What stands in the way and what can be stood on, for a player walking about a map with no
 * game on it: upright boxes, round posts and ramps, laid down by the models as they are built.
 * The pirate test page walks its player through these, and Chevron Street's level is worked
 * out from the car scene's (see `carSolids`).
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
   * middle at (`x`, `y`, `z`), turned `yaw` more; one that only stands in the way if not `stand`.
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
