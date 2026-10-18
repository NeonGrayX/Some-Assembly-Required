import { describe, expect, it } from 'vitest';
import { Facing, walkHeading } from './facing.ts';

const FRAME = 1 / 60;
const TAU = Math.PI * 2;
/** How far apart two headings are, the short way round. */
const apart = (a: number, b: number) => Math.abs(a - b - TAU * Math.round((a - b) / TAU));

/** Turns toward `heading` for `seconds`, and hands back the heading after each frame. */
function turnFor(f: Facing, heading: number | null, seconds: number): number[] {
  const out: number[] = [];
  for (let t = 0; t < seconds - 1e-9; t += FRAME) out.push(f.turn(heading, FRAME));
  return out;
}

describe('walkHeading', () => {
  it('is the way the keys walk, turned by the view', () => {
    const yaw = 0.7;
    expect(walkHeading(yaw, 1, 0)).toBeCloseTo(yaw);
    expect(apart(walkHeading(yaw, -1, 0)!, yaw + Math.PI)).toBeLessThan(1e-9);
    // Right is a quarter turn clockwise seen from above (yaw goes anticlockwise).
    expect(walkHeading(yaw, 0, 1)).toBeCloseTo(yaw - Math.PI / 2);
    expect(walkHeading(yaw, 0, -1)).toBeCloseTo(yaw + Math.PI / 2);
    expect(walkHeading(yaw, 1, 1)).toBeCloseTo(yaw - Math.PI / 4);
  });

  it('is nothing standing still', () => {
    expect(walkHeading(1, 0, 0)).toBeNull();
  });
});

describe('Facing', () => {
  it('turns round in a short swing rather than a snap', () => {
    const f = new Facing(0);
    const path = turnFor(f, Math.PI / 2, 0.6);
    // Not there on the first frame, most of the way in a fifth of a second, there by 0.6 s.
    expect(path[0]!).toBeLessThan(0.2);
    expect(path[12]!).toBeGreaterThan(Math.PI / 2 - 0.4);
    expect(apart(f.heading, Math.PI / 2)).toBeLessThan(0.01);
    // Never past it and back.
    expect(Math.max(...path)).toBeLessThanOrEqual(Math.PI / 2 + 1e-6);
  });

  it('turns the short way round', () => {
    const f = new Facing(3);
    const path = turnFor(f, -3, 0.6);
    // From 3 to -3 is a third of a radian the other way past pi, not six radians back.
    expect(path.every((h) => apart(h, 3) < 0.4)).toBe(true);
    expect(apart(f.heading, -3)).toBeLessThan(0.01);
  });

  it('keeps facing the way they last went when they stop', () => {
    const f = new Facing(0);
    turnFor(f, 1, 1);
    turnFor(f, null, 1);
    expect(apart(f.heading, 1)).toBeLessThan(0.01);
  });

  it('tells the turn and what is left of it for the animation', () => {
    const f = new Facing(0);
    f.turn(1, FRAME);
    expect(f.spin).toBeGreaterThan(0);
    expect(f.lead).toBeGreaterThan(0.5);
    turnFor(f, -1, 0.05);
    expect(f.lead).toBeLessThan(0);
  });

  it('follows the way someone else walks, from where they are drawn', () => {
    const f = new Facing(0);
    let x = 0;
    let went: number | null = null;
    // Walking along +x at 3 m/s: a heading of -pi/2.
    for (let i = 0; i < 30; i++) went = f.walking((x += 3 * FRAME), 0, FRAME);
    expect(went).toBeCloseTo(-Math.PI / 2, 3);
    // Standing still again: no heading, so they keep theirs.
    for (let i = 0; i < 60; i++) went = f.walking(x, 0, FRAME);
    expect(went).toBeNull();
  });

  it('notes a jump across the map, which is not a walk', () => {
    const f = new Facing(0);
    f.walking(0, 0, FRAME);
    expect(f.walking(5, 0, FRAME)).toBeNull();
    expect(f.jumped).toBe(true);
    f.walking(5, 0, FRAME);
    expect(f.jumped).toBe(false);
  });
});
