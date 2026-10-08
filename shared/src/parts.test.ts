import { describe, expect, it } from 'vitest';
import { BRICK_TYPES } from './bricks.ts';
import type { BrickTypeId, Facing, Rotation } from './bricks.ts';
import { BrickGrid } from './grid.ts';
import type { PlacedBrick } from './grid.ts';
import { PLATE_H, STUD } from './bricks.ts';
import { partAxes, partBounds, partBox, partQuat, sideStudsOf, topStudCells } from './parts.ts';
import { computeSnap } from './snap.ts';
import { rotate, v3 } from './math.ts';

let nextId = 1;
const brick = (
  type: BrickTypeId,
  x: number,
  y: number,
  z: number,
  rot: Rotation = 0,
  face?: Facing,
): PlacedBrick => ({
  id: nextId++,
  type,
  colour: 'red',
  x,
  y,
  z,
  rot,
  ...(face ? { face } : {}),
});

/** A grid holding one 4x4 plate at the bottom, to build on. */
function base(): BrickGrid {
  return BrickGrid.from([brick('plate4x4', 0, 0, 0)]);
}

describe('parts with fewer studs', () => {
  it('a tile takes nothing on top', () => {
    const g = base();
    expect(g.add(brick('tile2x2', 0, 1, 0)).ok).toBe(true);
    expect(g.add(brick('2x2', 0, 2, 0))).toEqual({ ok: false, reason: 'floating' });
  });

  it('a slope takes bricks on its back row only', () => {
    const g = base();
    // A 2x2 slope at rotation 0: back row z = 0, sloping down toward +z.
    g.add(brick('slope2x2', 0, 1, 0));
    expect(topStudCells(g.bricks.get(nextId - 1)!)).toEqual([
      { x: 0, z: 0 },
      { x: 1, z: 0 },
    ]);
    expect(g.check(brick('1x2', 0, 4, 1)).ok).toBe(false);
    expect(g.check(brick('1x2', 0, 4, 0)).ok).toBe(true);
  });

  it('turns the back row with the slope', () => {
    const s = brick('slope2x2', 0, 1, 0, 2);
    // Turned half way round, the back row is the +z one.
    expect(topStudCells(s)).toEqual(
      expect.arrayContaining([
        { x: 0, z: 1 },
        { x: 1, z: 1 },
      ]),
    );
  });

  it('counts only the studs that meet for a connection', () => {
    const g = base();
    const slope = brick('slope2x3', 0, 1, 0);
    g.add(slope);
    const top = brick('2x2', 0, 4, 0);
    // Covers the back row (2 studs) and one sloped row.
    const c = g.neighbours(top);
    expect(c).toEqual([{ lower: slope.id, upper: top.id, studs: 2 }]);
  });
});

describe('sideways parts', () => {
  it('cover one cell out and their height in layers', () => {
    // A 1x2 tile clipped on facing +z, lying along x: one stud high, so 3 layers.
    expect(partBox(brick('tile1x2', 2, 3, 5, 0, '+z'))).toEqual({
      x0: 2,
      y0: 3,
      z0: 5,
      x1: 4,
      y1: 6,
      z1: 6,
    });
    // Stood on end, two studs high: 5 layers.
    expect(partBox(brick('tile1x2', 2, 3, 5, 1, '+z'))).toEqual({
      x0: 2,
      y0: 3,
      z0: 5,
      x1: 3,
      y1: 8,
      z1: 6,
    });
  });

  it('are drawn thin, flat against the side they clip to', () => {
    const b = partBounds(brick('tile1x1', 4, 3, 2, 0, '-x'));
    // Against x = 5 (the cell's +x side), one plate thick, 2.5 plates high.
    expect(b.max.x).toBeCloseTo(5 * STUD);
    expect(b.max.x - b.min.x).toBeCloseTo(PLATE_H);
    expect(b.max.y - b.min.y).toBeCloseTo(STUD);
  });

  it('point their top along the face, with a right-handed frame', () => {
    for (const face of ['+x', '-x', '+z', '-z'] as const) {
      for (const rot of [0, 1, 2, 3] as const) {
        const p = brick('tile1x2', 0, 0, 0, rot, face);
        const { x, y, z } = partAxes(p);
        expect(y).toEqual(
          {
            '+x': v3(1, 0, 0),
            '-x': v3(-1, 0, 0),
            '+z': v3(0, 0, 1),
            '-z': v3(0, 0, -1),
          }[face],
        );
        // x × y = z
        const cross = v3(x.y * y.z - x.z * y.y, x.z * y.x - x.x * y.z, x.x * y.y - x.y * y.x);
        expect(cross.x).toBeCloseTo(z.x);
        expect(cross.y).toBeCloseTo(z.y);
        expect(cross.z).toBeCloseTo(z.z);
        // The quaternion turns the part's up onto the face.
        const up = rotate(partQuat(p), v3(0, 1, 0));
        expect(up.x).toBeCloseTo(y.x);
        expect(up.z).toBeCloseTo(y.z);
      }
    }
  });

  it('clip onto a headlight brick, and only onto its stud side', () => {
    const g = base();
    // Headlight at (1, 1, 1), its stud pointing +z at 1.5 plates up.
    const host = brick('headlight1x1', 1, 1, 1);
    g.add(host);
    expect(sideStudsOf(host)).toEqual([{ x: 1, z: 1, dir: '+z', y: 2.5 }]);
    const tile = brick('tile1x1', 1, 1, 2, 0, '+z');
    expect(g.neighbours(tile)).toEqual([{ lower: host.id, upper: tile.id, studs: 1 }]);
    expect(g.add(tile).ok).toBe(true);
    // Round the back, where there is no stud, it does not hold.
    expect(g.check(brick('tile1x1', 1, 1, 0, 0, '-z')).ok).toBe(false);
  });

  it('turn their side studs with the brick', () => {
    const host = brick('sidestuds1x2', 0, 1, 0, 1);
    const dirs = sideStudsOf(host).map((s) => s.dir);
    expect(new Set(dirs)).toEqual(new Set(['+x']));
  });

  it('hang below an inverted bracket', () => {
    const g = BrickGrid.from([brick('plate2x4', 0, 3, 0)]);
    const bracket = brick('bracket2x4', 0, 4, 0);
    g.add(bracket);
    // Its studs point +z out of row z = 1, 1.25 plates below its bottom.
    expect(sideStudsOf(bracket)[0]).toEqual({ x: 0, z: 1, dir: '+z', y: 2.75 });
    expect(g.add(brick('print-mangashop', 0, 2, 2, 0, '+z')).ok).toBe(true);
  });

  it('snap sideways when a side with studs is aimed at', () => {
    const g = base();
    g.add(brick('sidestuds1x2', 0, 1, 0));
    // Aim at the +z side of the brick (z = 1), half way up.
    const hit = v3(1 * STUD, 2.5 * PLATE_H, 1 * STUD);
    const p = computeSnap(g, hit, v3(0, 0, 1), 'tile1x2', 0);
    expect(p).toMatchObject({ type: 'tile1x2', face: '+z', z: 1, x: 0 });
    expect(g.add({ ...p!, id: nextId++, colour: 'blue' }).ok).toBe(true);
    // A brick is not thin enough to clip on.
    expect(computeSnap(g, hit, v3(0, 0, 1), '2x2', 0)).toBeNull();
    // A plain side has no studs.
    expect(
      computeSnap(g, v3(2 * STUD, 2.5 * PLATE_H, 0.5 * STUD), v3(1, 0, 0), 'tile1x1', 0),
    ).toBeNull();
  });

  it('only thin parts can be clipped on', () => {
    for (const t of Object.values(BRICK_TYPES)) {
      if (t.mountable) expect(t.plates).toBeLessThanOrEqual(2);
    }
  });
});
