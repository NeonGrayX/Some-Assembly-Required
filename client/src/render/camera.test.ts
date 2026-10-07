import { cameraPosition, emptyInput, length, sub, v3 } from '@sar/shared';
import type { Vec3 } from '@sar/shared';
import { describe, expect, it } from 'vitest';
import { CAMERA_FEEL, CameraRig, Spring } from './camera.ts';
import type { CameraTarget, Sightline } from './camera.ts';

const FRAME = 1 / 60;

/** Nothing in the way, anywhere. */
const free: Sightline = (_from, to) => to;

/** A wall across every line, `limit` metres out from where the line starts. */
const wallAt =
  (limit: number): Sightline =>
  (from, to, radius) => {
    const off = sub(to, from);
    const d = length(off);
    const max = limit - radius;
    if (d <= max) return to;
    return {
      x: from.x + (off.x * max) / d,
      y: from.y + (off.y * max) / d,
      z: from.z + (off.z * max) / d,
    };
  };

const target = (eye: Vec3, yaw = 0, pitch = -0.25, firstPerson = false): CameraTarget => ({
  eye,
  yaw,
  pitch,
  firstPerson,
});

/** Where the camera would be with no smoothing at all. */
const direct = (t: CameraTarget): Vec3 =>
  cameraPosition(t.eye, {
    ...emptyInput(),
    yaw: t.yaw,
    pitch: t.pitch,
    firstPerson: t.firstPerson,
  });

/** How far out from the eyes the camera sits with no smoothing at all. */
const full = (t: CameraTarget): number => length(sub(direct(t), t.eye));

const run = (rig: CameraRig, t: CameraTarget, seconds: number, sight: Sightline = free) => {
  let pose = rig.update(t, 0, sight);
  for (let s = 0; s < seconds; s += FRAME) pose = rig.update(t, FRAME, sight);
  return pose;
};

describe('Spring', () => {
  it.each([0.7, 1, 1.5])('gives the same answer whatever the frame rate (zeta %s)', (zeta) => {
    const coarse = new Spring(20, zeta);
    const fine = new Spring(20, zeta);
    coarse.reset(0);
    fine.reset(0);
    coarse.step(1, 0.1);
    for (let i = 0; i < 10; i++) fine.step(1, 0.01);
    expect(fine.x).toBeCloseTo(coarse.x, 9);
    expect(fine.v).toBeCloseTo(coarse.v, 9);
  });

  it('settles on its target without passing it when critically damped', () => {
    const s = new Spring(30, 1);
    let peak = 0;
    for (let i = 0; i < 120; i++) peak = Math.max(peak, s.step(1, FRAME));
    expect(peak).toBeLessThanOrEqual(1);
    expect(s.x).toBeCloseTo(1, 4);
  });

  it('bounces a little past its target when under-damped', () => {
    const s = new Spring(30, 0.5);
    let peak = 0;
    for (let i = 0; i < 120; i++) peak = Math.max(peak, s.step(1, FRAME));
    expect(peak).toBeGreaterThan(1.05);
    expect(s.x).toBeCloseTo(1, 3);
  });
});

describe('CameraRig', () => {
  it('starts exactly where the plain camera would be', () => {
    const t = target(v3(1, 1.45, 2), 0.4);
    const pose = new CameraRig().update(t, FRAME, free);
    const want = direct(t);
    expect(pose.pos.x).toBeCloseTo(want.x, 9);
    expect(pose.pos.y).toBeCloseTo(want.y, 9);
    expect(pose.pos.z).toBeCloseTo(want.z, 9);
    expect(pose.yaw).toBe(t.yaw);
    expect(pose.pitch).toBe(t.pitch);
    expect(pose.closeUp).toBe(false);
  });

  it('turns exactly with the mouse and follows along the ground without lag', () => {
    const rig = new CameraRig();
    let eye = v3(0, 1.45, 0);
    rig.update(target(eye, 0), FRAME, free);
    for (let s = 0; s < 0.5; s += FRAME) {
      eye = v3(eye.x + 6 * FRAME, eye.y, eye.z + 3 * FRAME);
      const t = target(eye, s * 4, -0.25 + s);
      const pose = rig.update(t, FRAME, free);
      expect(pose.yaw).toBe(t.yaw);
      expect(pose.pitch).toBe(t.pitch);
      const want = direct(t);
      expect(pose.pos.x).toBeCloseTo(want.x, 9);
      expect(pose.pos.z).toBeCloseTo(want.z, 9);
    }
  });

  it('is a little soft going up, so a jump lifts the player on screen first', () => {
    const rig = new CameraRig();
    let eye = v3(0, 1.45, 0);
    rig.update(target(eye), FRAME, free);
    let pose = rig.update(target(eye), FRAME, free);
    for (let s = 0; s < 0.2; s += FRAME) {
      eye = v3(eye.x, eye.y + 4 * FRAME, eye.z);
      pose = rig.update(target(eye), FRAME, free);
    }
    const lag = direct(target(eye)).y - pose.pos.y;
    expect(lag).toBeGreaterThan(0.05);
    expect(lag).toBeLessThan(0.4);
    pose = run(rig, target(eye), 0.4);
    expect(pose.pos.y).toBeCloseTo(direct(target(eye)).y, 2);
  });

  it('is bolted to the eyes in first person, with no lag on turning either', () => {
    const rig = new CameraRig();
    const eye = v3(3, 1.45, -2);
    rig.update(target(eye, 0, 0, true), FRAME, free);
    const pose = rig.update(target(eye, 2, 0.3, true), FRAME, free);
    expect(pose.pos).toEqual(eye);
    expect(pose.yaw).toBe(2);
    expect(pose.pitch).toBe(0.3);
    expect(pose.closeUp).toBe(true);
  });

  it('glides into the head on the first-person toggle instead of jumping', () => {
    const rig = new CameraRig();
    const eye = v3(0, 1.45, 0);
    const third = run(rig, target(eye), 0.5);
    const out = length(sub(third.pos, eye));
    expect(out).toBeCloseTo(full(target(eye)), 6);
    const pose = rig.update(target(eye, 0, -0.25, true), FRAME, free);
    const now = length(sub(pose.pos, eye));
    expect(now).toBeLessThan(out);
    expect(now).toBeGreaterThan(out * 0.5);
    const inside = run(rig, target(eye, 0, -0.25, true), 1);
    expect(inside.pos).toEqual(eye);
    expect(inside.closeUp).toBe(true);
  });

  it('pulls in at once when a wall gets in the way, and pays back out gently', () => {
    const rig = new CameraRig();
    const eye = v3(0, 1.45, 0);
    run(rig, target(eye), 0.5);
    const pinched = rig.update(target(eye), FRAME, wallAt(1));
    expect(length(sub(pinched.pos, eye))).toBeLessThanOrEqual(1 + 1e-9);
    // Given time it keeps a little clear of the wall rather than touching it.
    const settled = run(rig, target(eye), 0.5, wallAt(1));
    expect(length(sub(settled.pos, eye))).toBeCloseTo(1 - CAMERA_FEEL.clearance, 3);
    const freed = rig.update(target(eye), FRAME, free);
    const d = length(sub(freed.pos, eye));
    expect(d).toBeGreaterThan(1 - CAMERA_FEEL.clearance + 0.02);
    expect(d).toBeLessThan(full(target(eye)) - 1);
    const back = run(rig, target(eye), 2);
    expect(length(sub(back.pos, eye))).toBeCloseTo(full(target(eye)), 2);
  });

  it('hides the player while the camera is pressed up against their head', () => {
    const rig = new CameraRig();
    const eye = v3(0, 1.45, 0);
    run(rig, target(eye), 0.5);
    expect(run(rig, target(eye), 0.5, wallAt(0.6)).closeUp).toBe(true);
    // Out a little: still hidden, so it does not flicker on the edge...
    expect(run(rig, target(eye), 0.5, wallAt(0.85)).closeUp).toBe(true);
    // ...and back in view once there is room again.
    expect(run(rig, target(eye), 1, free).closeUp).toBe(false);
  });

  it('snaps rather than flies when the player is moved somewhere else', () => {
    const rig = new CameraRig();
    run(rig, target(v3(0, 1.45, 0)), 0.5);
    const far = target(v3(20, 1.45, -8), 1.2);
    const pose = rig.update(far, FRAME, free);
    const want = direct(far);
    expect(pose.pos.x).toBeCloseTo(want.x, 9);
    expect(pose.pos.z).toBeCloseTo(want.z, 9);
    expect(pose.yaw).toBe(1.2);
  });

  it('keeps the soft follow point out of the floor', () => {
    const rig = new CameraRig();
    let eye = v3(0, 1.45, 0);
    rig.update(target(eye), FRAME, free);
    for (let s = 0; s < 0.2; s += FRAME) {
      eye = v3(eye.x, eye.y - 5 * FRAME, eye.z);
      rig.update(target(eye), FRAME, free);
    }
    // Nothing may be more than 0.1 m from the eyes now: the trailing follow point is clipped
    // back too, so the boom cannot start from inside the floor.
    const pose = rig.update(target(eye), FRAME, wallAt(0.1));
    expect(length(sub(pose.pos, eye))).toBeLessThanOrEqual(0.2 + 1e-9);
  });
});
