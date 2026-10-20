import { describe, expect, it } from 'vitest';
import { BrickGrid } from './grid.ts';
import type { PlacedBrick } from './grid.ts';
import { computeSnap } from './snap.ts';
import { planBreaks } from './breaking.ts';
import { PLATE_H, STUD } from './bricks.ts';

const brick = (id: number, p: Partial<PlacedBrick> = {}): PlacedBrick => ({
  id,
  type: '2x4',
  colour: 'red',
  x: 0,
  y: 0,
  z: 0,
  rot: 0,
  ...p,
});

describe('BrickGrid', () => {
  it('accepts the first brick anywhere', () => {
    const g = new BrickGrid();
    expect(g.add(brick(1, { x: 5, y: 7 }))).toEqual({ ok: true });
  });

  it('rejects overlapping bricks', () => {
    const g = BrickGrid.from([brick(1)]);
    expect(g.check({ type: '1x1', x: 3, y: 2, z: 1, rot: 0 })).toEqual({
      ok: false,
      reason: 'overlap',
    });
  });

  it("keeps the plate over a leaf plate's leaves free, but not over its stud", () => {
    const g = BrickGrid.from([brick(1), brick(2, { type: 'leaf2x2', y: 3 })]);
    // On the leaf plate's stud.
    expect(g.check({ type: 'plate1x1', x: 0, y: 4, z: 0, rot: 0 }).ok).toBe(true);
    // Over its leaves, which tip up into that plate.
    for (const [x, z] of [
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const)
      expect(g.check({ type: 'plate2x2', x, y: 4, z, rot: 0 })).toEqual({
        ok: false,
        reason: 'overlap',
      });
    // Nor does it go in under a plate already there.
    const over = BrickGrid.from([brick(1), brick(3, { type: 'plate1x1', x: 1, y: 4 })]);
    expect(over.check({ type: 'leaf2x2', x: 0, y: 3, z: 0, rot: 0 }).ok).toBe(false);
  });

  it('rejects floating bricks and bricks only touching at the side', () => {
    const g = BrickGrid.from([brick(1)]);
    expect(g.check({ type: '1x1', x: 0, y: 4, z: 0, rot: 0 }).ok).toBe(false);
    expect(g.check({ type: '1x1', x: 4, y: 0, z: 0, rot: 0 }).ok).toBe(false);
  });

  it('connects stacked bricks and counts shared studs', () => {
    const g = BrickGrid.from([brick(1)]);
    // 2x4 rotated a quarter turn sits across the first one: overlap is 2x2 studs.
    expect(g.add(brick(2, { y: 3, rot: 1, x: 1, z: 0 })).ok).toBe(true);
    expect(g.connections()).toEqual([{ lower: 1, upper: 2, studs: 4 }]);
  });

  it('connects a brick hanging underneath', () => {
    const g = BrickGrid.from([brick(1, { y: 3 })]);
    expect(g.add(brick(2, { type: '1x1', x: 3, y: 0, z: 1 })).ok).toBe(true);
    expect(g.connections()).toEqual([{ lower: 2, upper: 1, studs: 1 }]);
  });

  it('splits into components when a brick is removed', () => {
    const g = BrickGrid.from([
      brick(1),
      brick(2, { type: '1x1', x: 0, y: 3 }),
      brick(3, { type: '1x1', x: 3, y: 3 }),
      brick(4, { x: 0, y: 6 }),
    ]);
    expect(g.components()).toEqual([[1, 2, 3, 4]]);
    g.remove(1);
    // 2 and 3 are still joined through brick 4 on top.
    expect(g.components()).toEqual([[2, 3, 4]]);
    g.remove(4);
    expect(g.components()).toEqual([[2], [3]]);
  });

  it('honours broken connections when splitting', () => {
    const g = BrickGrid.from([brick(1), brick(2, { y: 3 }), brick(3, { y: 6 })]);
    expect(g.components([{ lower: 2, upper: 3, studs: 8 }])).toEqual([[1, 2], [3]]);
  });
});

describe('computeSnap', () => {
  const plate = BrickGrid.from([brick(1, { type: 'baseplate16' })]);

  it('centres the brick on the aim point on a top face', () => {
    const hit = { x: 8 * STUD, y: 1 * PLATE_H, z: 8 * STUD };
    expect(computeSnap(plate, hit, { x: 0, y: 1, z: 0 }, '2x4', 0)).toEqual({
      type: '2x4',
      rot: 0,
      x: 6,
      y: 1,
      z: 7,
    });
  });

  it('swaps the footprint for a quarter turn', () => {
    const hit = { x: 8 * STUD, y: 1 * PLATE_H, z: 8 * STUD };
    expect(computeSnap(plate, hit, { x: 0, y: 1, z: 0 }, '2x4', 1)).toMatchObject({ x: 7, z: 6 });
  });

  it('allows overhang as long as one stud is clutched', () => {
    const hit = { x: 0.2 * STUD, y: 1 * PLATE_H, z: 0.2 * STUD };
    expect(computeSnap(plate, hit, { x: 0, y: 1, z: 0 }, '2x2', 0)).toMatchObject({ x: -1, z: -1 });
  });

  it('nudges the brick by a stud when the centred spot is taken', () => {
    const g = BrickGrid.from([brick(1), brick(2, { type: '1x1', y: 3 })]);
    const hit = { x: 1 * STUD, y: 3 * PLATE_H, z: 1 * STUD };
    expect(computeSnap(g, hit, { x: 0, y: 1, z: 0 }, '2x2', 0)).toMatchObject({ x: 0, z: 1 });
  });

  it('does not snap to side faces', () => {
    const hit = { x: 16 * STUD, y: 0.5 * PLATE_H, z: 4 * STUD };
    expect(computeSnap(plate, hit, { x: 1, y: 0, z: 0 }, '1x1', 0)).toBeNull();
  });

  it('hangs a brick underneath when aiming at a bottom face', () => {
    const hit = { x: 4 * STUD, y: 0, z: 4 * STUD };
    expect(computeSnap(plate, hit, { x: 0, y: -1, z: 0 }, '1x1', 0)).toMatchObject({ y: -3 });
  });
});

describe('planBreaks', () => {
  const tower = () =>
    BrickGrid.from([
      brick(1),
      brick(2, { type: 'round1x1', y: 3 }), // one stud with a thin ring: weak
      brick(3, { type: 'round1x1', y: 6 }),
    ]);

  it('ignores gentle knocks', () => {
    expect(planBreaks(tower(), 0.2, () => 0.5)).toEqual([]);
  });

  it('breaks weak joints before strong ones', () => {
    const g = BrickGrid.from([brick(1), brick(2, { y: 3 }), brick(3, { type: '1x1x5', y: 6 })]);
    const broken = planBreaks(g, 20, () => 0.5);
    expect(broken).toEqual([{ lower: 2, upper: 3, studs: 1 }]);
  });

  it('shatters everything on a huge impact', () => {
    expect(tower().components(planBreaks(tower(), 500, () => 0.5))).toHaveLength(3);
  });
});

describe('bracket flanges', () => {
  const sideStud = (id: number, p: Partial<PlacedBrick> = {}) =>
    brick(id, { type: 'sidestuds1x1', ...p });
  const bracket = (p: Partial<PlacedBrick> = {}) =>
    brick(9, { type: 'bracket1x1', x: 0, y: 3, z: 0, ...p });

  it('keep off a side stud sticking out under them', () => {
    const g = BrickGrid.from([sideStud(1)]);
    expect(g.check(bracket())).toEqual({ ok: false, reason: 'overlap' });
    // Turned the other way, or a plate higher, the flange clears the stud.
    expect(g.check(bracket({ rot: 2 }))).toEqual({ ok: true });
    g.add(brick(2, { type: 'plate1x1', y: 3 }));
    expect(g.check(bracket({ y: 4 }))).toEqual({ ok: true });
  });

  it('go over a headlight brick, its stud set back in its recess', () => {
    const g = BrickGrid.from([brick(1, { type: 'headlight1x1' })]);
    expect(g.check(bracket())).toEqual({ ok: true });
  });

  it('keep a side stud from going in under them', () => {
    const g = BrickGrid.from([
      brick(1, { type: '1x1' }),
      brick(2, { type: 'bracket1x2', x: 0, y: 3, z: 0 }),
    ]);
    expect(g.check(sideStud(3, { x: 1 }))).toEqual({ ok: false, reason: 'overlap' });
    expect(g.check(sideStud(3, { x: 1, rot: 2 }))).toEqual({ ok: true });
  });
});
