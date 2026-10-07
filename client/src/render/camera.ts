import { add, cameraPosition, length, scale, sub, v3 } from '@sar/shared';
import type { Vec3 } from '@sar/shared';

/**
 * How the camera follows the player: on a bungee cord rather than bolted to the mouse. Each
 * number is a spring's angular frequency in radians per second (higher snaps back faster; the
 * steady lag behind something moving at speed s is about 2·zeta·s/omega) and how it settles
 * (`zeta` 1 stops dead where it should, lower bounces past a little first). The player
 * themselves is never smoothed: only where the camera is drawn from.
 */
export const CAMERA_FEEL = {
  /** Turning: the view swings after the mouse and catches up within a fifth of a second. */
  turn: { omega: 30, zeta: 1 },
  /** Following along the ground: trails a walking player by about a third of a metre. */
  follow: { omega: 30, zeta: 0.7 },
  /** Following up and down: floats more, so jumps and ladders lift the player on screen. */
  rise: { omega: 16, zeta: 0.7 },
  /** Seconds for the boom to shorten when a wall comes between the camera and the player... */
  pullIn: 0.04,
  /** ...and to stretch back out once the way is clear again. */
  payOut: 0.3,
  /** Seconds for the camera to fly into or out of the player's head on the first-person toggle. */
  toggle: 0.12,
  /** How far the camera keeps clear of walls and furniture as it slides along them, in metres. */
  clearance: 0.25,
  /** The camera is this close behind the eyes (or closer): the player's own head is in the way. */
  closeUp: { hide: 0.55, show: 0.7 },
  /** The eyes jumped this far in one frame (a respawn, a meeting): snap, do not fly there. */
  snap: 2.5,
};

/**
 * A damped spring pulling a value after a moving target. Stepped by the exact solution of its
 * motion, so the feel is the same at any frame rate and it never blows up on a long frame.
 */
export class Spring {
  x = 0;
  v = 0;

  constructor(
    readonly omega: number,
    readonly zeta = 1,
  ) {}

  reset(x: number): void {
    this.x = x;
    this.v = 0;
  }

  step(target: number, dt: number): number {
    const { omega, zeta } = this;
    if (dt <= 0 || omega <= 0) return this.x;
    let pp: number, pv: number, vp: number, vv: number;
    if (zeta > 1 + 1e-6) {
      const za = -omega * zeta;
      const zb = omega * Math.sqrt(zeta * zeta - 1);
      const z1 = za - zb;
      const z2 = za + zb;
      const e1 = Math.exp(z1 * dt) / (2 * zb);
      const e2 = Math.exp(z2 * dt) / (2 * zb);
      pp = e1 * z2 - z2 * e2 + e2 * 2 * zb;
      pv = -e1 + e2;
      vp = (z1 * e1 - z2 * e2 + e2 * 2 * zb) * z2;
      vv = -z1 * e1 + z2 * e2;
    } else if (zeta > 1 - 1e-6) {
      const e = Math.exp(-omega * dt);
      const te = dt * e;
      const tef = te * omega;
      pp = tef + e;
      pv = te;
      vp = -omega * tef;
      vv = -tef + e;
    } else {
      const oz = omega * zeta;
      const alpha = omega * Math.sqrt(1 - zeta * zeta);
      const e = Math.exp(-oz * dt);
      const cos = Math.cos(alpha * dt);
      const sin = Math.sin(alpha * dt);
      const expSin = e * sin;
      const expCos = e * cos;
      const expOzSin = (e * oz * sin) / alpha;
      pp = expCos + expOzSin;
      pv = expSin / alpha;
      vp = -expSin * alpha - oz * expOzSin;
      vv = expCos - expOzSin;
    }
    const d = this.x - target;
    const v = this.v;
    this.x = d * pp + v * pv + target;
    this.v = d * vp + v * vv;
    return this.x;
  }
}

/** Where the player looks from and which way, straight from the simulation and the mouse. */
export interface CameraTarget {
  eye: Vec3;
  yaw: number;
  pitch: number;
  firstPerson: boolean;
}

/** Where the camera is drawn from this frame. */
export interface CameraPose {
  pos: Vec3;
  yaw: number;
  pitch: number;
  /** The camera sits inside or right behind the player's head, so their avatar is in the way. */
  closeUp: boolean;
}

/**
 * The farthest point on the way from `from` to `to` where a camera keeping `radius` clear of
 * walls can sit without looking through one (`Sim.sightline`).
 */
export type Sightline = (from: Vec3, to: Vec3, radius: number) => Vec3;

/** Moves a value part of the way to a target, by the time passed and a time constant. */
const ease = (x: number, target: number, dt: number, tau: number): number =>
  dt > 0 ? target + (x - target) * Math.exp(-dt / tau) : target;

/** Input that only looks, for placing the camera. */
const NO_WALK = {
  forward: 0,
  right: 0,
  jump: false,
  sprint: false,
  careful: false,
  firstPerson: false,
};

/**
 * The camera on its bungee cord. Each frame it is told where the player's eyes are and which
 * way they look, and answers with where to draw from: turning and following lag a little and
 * catch up on springs, the boom behind the shoulder shortens at once when a wall gets in the
 * way but pays back out gently, and in first person it sits exactly at the eyes with no lag
 * at all, since there the lag would only feel like a slow mouse.
 */
export class CameraRig {
  private readonly yaw = new Spring(CAMERA_FEEL.turn.omega, CAMERA_FEEL.turn.zeta);
  private readonly pitch = new Spring(CAMERA_FEEL.turn.omega, CAMERA_FEEL.turn.zeta);
  private readonly follow = {
    x: new Spring(CAMERA_FEEL.follow.omega, CAMERA_FEEL.follow.zeta),
    y: new Spring(CAMERA_FEEL.rise.omega, CAMERA_FEEL.rise.zeta),
    z: new Spring(CAMERA_FEEL.follow.omega, CAMERA_FEEL.follow.zeta),
  };
  /** How far out along the boom from the eyes the camera sits, 0 (at the eyes) to 1 (fully out). */
  private boom = 0;
  /** How far into first person the camera is, 0 to 1, gliding across on the toggle. */
  private fp = 0;
  private lastEye: Vec3 | null = null;
  private closeUp = false;

  /** Forget where the camera was: the next frame places it without any lag. */
  reset(): void {
    this.lastEye = null;
  }

  update(target: CameraTarget, dt: number, sightline: Sightline): CameraPose {
    const { eye } = target;
    if (!this.lastEye || length(sub(eye, this.lastEye)) > CAMERA_FEEL.snap) {
      this.yaw.reset(target.yaw);
      this.pitch.reset(target.pitch);
      this.follow.x.reset(eye.x);
      this.follow.y.reset(eye.y);
      this.follow.z.reset(eye.z);
      this.fp = target.firstPerson ? 1 : 0;
      this.boom = target.firstPerson ? 0 : 1;
      this.closeUp = target.firstPerson;
      dt = 0;
    }
    this.lastEye = eye;

    this.yaw.step(target.yaw, dt);
    this.pitch.step(target.pitch, dt);
    this.follow.x.step(eye.x, dt);
    this.follow.y.step(eye.y, dt);
    this.follow.z.step(eye.z, dt);

    // In first person the cord goes slack: the view is the mouse, the camera the eyes.
    this.fp = ease(this.fp, target.firstPerson ? 1 : 0, dt, CAMERA_FEEL.toggle);
    if (this.fp < 1e-3) this.fp = 0;
    else if (this.fp > 1 - 1e-3) this.fp = 1;
    const w = 1 - this.fp;
    const yaw = target.yaw + (this.yaw.x - target.yaw) * w;
    const pitch = target.pitch + (this.pitch.x - target.pitch) * w;
    // The trailing follow point never ends up behind a wall the player just walked past.
    const trail = v3(this.follow.x.x, this.follow.y.x, this.follow.z.x);
    const from = add(eye, scale(sub(sightline(eye, trail, 0), eye), w));

    // The boom out behind the shoulder. Its length changes a little with pitch, so the camera
    // sits at a fraction of it: looking up or down then never tugs the cord.
    const arm = sub(cameraPosition(from, { ...NO_WALK, yaw, pitch }), from);
    const reach = length(arm);
    // How far out the camera may go: a hard limit so it never looks through a wall, and a
    // softer one that keeps it a little clear of them, which it eases towards.
    const hard = length(sub(sightline(from, add(from, arm), 0), from)) / reach;
    const soft = length(sub(sightline(from, add(from, arm), CAMERA_FEEL.clearance), from)) / reach;
    const want = Math.min(soft, 1) * w;
    // Pulling in is quick, paying out is gentle, and while the first-person toggle glides the
    // boom keeps up with it either way.
    const toggling = this.fp > 0 && this.fp < 1;
    const tau = want < this.boom || toggling ? CAMERA_FEEL.pullIn : CAMERA_FEEL.payOut;
    this.boom = Math.min(hard, ease(this.boom, want, dt, tau));
    if (this.boom < 1e-4) this.boom = 0;

    const out = this.boom * reach;
    if (out < CAMERA_FEEL.closeUp.hide) this.closeUp = true;
    else if (out > CAMERA_FEEL.closeUp.show) this.closeUp = false;
    return { pos: add(from, scale(arm, this.boom)), yaw, pitch, closeUp: this.closeUp };
  }
}
