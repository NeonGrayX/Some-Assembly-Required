import { describe, expect, it } from 'vitest';
import type { BrickTypeId, Facing, Rotation } from './bricks.ts';
import { BrickGrid } from './grid.ts';
import type { PlacedBrick } from './grid.ts';
import { PLATE_H, STUD } from './bricks.ts';
import {
  partAxes,
  partBounds,
  partBox,
  partQuat,
  partSolids,
  sideStudsOf,
  topStudCells,
} from './parts.ts';
import { cellsOf } from './grid.ts';
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

  it('clip onto a headlight brick, set back into its recess, and only onto its stud side', () => {
    const g = base();
    // Headlight at (1, 1, 1): its stud points +z from the middle of the stud square on top
    // of its face, 1.75 plates up, its base half a plate back in the recess.
    const host = brick('headlight1x1', 1, 1, 1);
    g.add(host);
    expect(sideStudsOf(host)).toEqual([{ x: 1, z: 1, dir: '+z', y: 2.75, out: -0.5 }]);
    const tile = brick('tile1x1', 1, 1.5, 1.8, 0, '+z');
    expect(g.neighbours(tile)).toEqual([{ lower: host.id, upper: tile.id, studs: 1 }]);
    // Its back is half a plate inside the headlight's cell, so it stands out half a plate.
    const b = partBounds(tile);
    expect(b.min.z).toBeCloseTo(2 * STUD - 0.5 * PLATE_H);
    expect(b.max.z).toBeCloseTo(2 * STUD + 0.5 * PLATE_H);
    expect(b.min.y).toBeCloseTo(1.5 * PLATE_H);
    // Flat against the brick's side the stud does not reach it, and a whole layer off it
    // misses the stud.
    expect(g.check(brick('tile1x1', 1, 1.5, 2, 0, '+z')).ok).toBe(false);
    expect(g.check(brick('tile1x1', 1, 1, 1.8, 0, '+z')).ok).toBe(false);
    expect(g.add(tile).ok).toBe(true);
    // Round the back, where there is no stud, it does not hold.
    expect(g.check(brick('tile1x1', 1, 1.5, 0, 0, '-z')).ok).toBe(false);
  });

  it('sit half a plate up on a brick with studs on its side', () => {
    const g = base();
    const host = brick('sidestuds1x2', 0, 1, 0);
    g.add(host);
    // The side is a stud square over a half plate sliver: the studs are in the square.
    expect(sideStudsOf(host).map((s) => s.y)).toEqual([2.75, 2.75]);
    const tile = brick('tile1x2', 0, 1.5, 1, 0, '+z');
    expect(g.neighbours(tile)).toEqual([{ lower: host.id, upper: tile.id, studs: 2 }]);
    expect(g.check(brick('tile1x2', 0, 1, 1, 0, '+z')).ok).toBe(false);
  });

  it('need two plates between stacked side-stud bricks to span both (the sandwich rule)', () => {
    // A brick (3 plates) and two plates make 5 plates: two studs.
    const g = base();
    const low = brick('sidestuds1x2', 0, 1, 0);
    g.add(low);
    g.add(brick('plate1x2', 0, 4, 0));
    g.add(brick('plate1x2', 0, 5, 0));
    const high = brick('sidestuds1x2', 0, 6, 0);
    g.add(high);
    // A 4x2 tile stood on end covers both bricks' studs, all four.
    const tile = brick('tile2x4', 0, 1.5, 1, 1, '+z');
    expect(g.neighbours(tile)).toEqual([
      { lower: low.id, upper: tile.id, studs: 2 },
      { lower: high.id, upper: tile.id, studs: 2 },
    ]);
    // Stacked straight on each other (3 plates apart) only one row lines up: the other row is
    // half a plate off the tile's stud spots and runs into it, either way round.
    const h = base();
    h.add(brick('sidestuds1x2', 0, 1, 0));
    const upper = brick('sidestuds1x2', 0, 4, 0);
    h.add(upper);
    expect(h.check(brick('tile2x4', 0, 1.5, 1, 1, '+z'))).toEqual({
      ok: false,
      reason: 'overlap',
    });
    h.remove(upper.id);
    h.add(brick('tile2x4', 0, 1.5, 1, 1, '+z'));
    expect(h.check(upper)).toEqual({ ok: false, reason: 'overlap' });
    // A 1x1 tile on the lower brick's stud is clear of the upper one's.
    const one = base();
    one.add(brick('sidestuds1x2', 0, 1, 0));
    one.add(brick('sidestuds1x2', 0, 4, 0));
    expect(one.check(brick('tile1x1', 0, 1.5, 1, 0, '+z')).ok).toBe(true);
  });

  it('share a layer when two clip on one over the other', () => {
    // The 1x2x1 2/3 brick is five plates: two tiles, a stud each, cover its side exactly.
    const g = base();
    g.add(brick('sidestuds1x2x2', 0, 1, 0));
    expect(g.add(brick('tile1x2', 0, 1, 1, 0, '+z')).ok).toBe(true);
    expect(g.add(brick('tile1x2', 0, 3.5, 1, 0, '+z')).ok).toBe(true);
    // A third has no room left.
    expect(g.check(brick('tile1x2', 0, 2, 1, 0, '+z')).ok).toBe(false);
  });

  it('a set-back tile does not fit where the side behind it is not set back', () => {
    const g = base();
    g.add(brick('1x1', 0, 1, 0));
    const host = brick('headlight1x1', 0, 4, 0);
    g.add(host);
    // A 1x2 tile stood on end over the headlight would reach down into the plain brick's face.
    expect(g.check(brick('tile1x2', 0, 2, 0.8, 1, '+z'))).toEqual({ ok: false, reason: 'overlap' });
    expect(g.check(brick('tile1x2', 0, 4.5, 0.8, 1, '+z')).ok).toBe(true);
  });

  it('turn their side studs with the brick', () => {
    const host = brick('sidestuds1x2', 0, 1, 0, 1);
    const dirs = sideStudsOf(host).map((s) => s.dir);
    expect(new Set(dirs)).toEqual(new Set(['+x']));
  });

  it('hang from a bracket, on its flange half a plate out', () => {
    const g = BrickGrid.from([brick('plate2x4', 0, 3, 0)]);
    const bracket = brick('bracket2x4', 0, 4, 0);
    g.add(bracket);
    // Its flange hangs from its top, so its studs point +z out of row z = 1, 1.25 plates
    // below its top, on the flange's front half a plate out.
    expect(sideStudsOf(bracket)[0]).toEqual({ x: 0, z: 1, dir: '+z', y: 3.75, out: 0.5 });
    const tile = brick('tile1x4', 0, 2.5, 2.2, 0, '+z');
    expect(g.add(tile).ok).toBe(true);
    // Its top is flush with the bracket's top, its back on the flange.
    expect(partBounds(tile).max.y).toBeCloseTo(5 * PLATE_H);
    expect(partBounds(tile).min.z).toBeCloseTo(2 * STUD + 0.5 * PLATE_H);
  });

  it('snap sideways when a side with studs is aimed at', () => {
    const g = base();
    g.add(brick('sidestuds1x2', 0, 1, 0));
    // Aim at the +z side of the brick (z = 1), half way up.
    const hit = v3(1 * STUD, 2.5 * PLATE_H, 1 * STUD);
    const p = computeSnap(g, hit, v3(0, 0, 1), 'tile1x2', 0);
    expect(p).toMatchObject({ type: 'tile1x2', face: '+z', z: 1, x: 0, y: 1.5 });
    expect(g.add({ ...p!, id: nextId++, colour: 'blue' }).ok).toBe(true);
    // A brick is not thin enough to clip on.
    expect(computeSnap(g, hit, v3(0, 0, 1), '2x2', 0)).toBeNull();
    // A plain side has no studs.
    expect(
      computeSnap(g, v3(2 * STUD, 2.5 * PLATE_H, 0.5 * STUD), v3(1, 0, 0), 'tile1x1', 0),
    ).toBeNull();
  });

  it('take a plate across two side studs, like a tile', () => {
    const g = base();
    const a = brick('sidestuds1x1', 0, 1, 0);
    const b = brick('sidestuds1x1', 1, 1, 0);
    g.add(a);
    g.add(b);
    const hit = v3(1 * STUD, 2.5 * PLATE_H, 1 * STUD);
    const p = computeSnap(g, hit, v3(0, 0, 1), 'plate1x2', 0);
    expect(p).toMatchObject({ type: 'plate1x2', face: '+z', x: 0, y: 1.5, z: 1 });
    expect(g.neighbours(p!)).toEqual([
      { lower: a.id, upper: expect.any(Number), studs: 1 },
      { lower: b.id, upper: expect.any(Number), studs: 1 },
    ]);
    // A brick clips on by its bottom just the same.
    expect(computeSnap(g, hit, v3(0, 0, 1), '1x2', 0)).toMatchObject({
      type: '1x2',
      face: '+z',
      x: 0,
      y: 1.5,
      z: 1,
    });
  });

  it("snap into a headlight brick's recess", () => {
    const g = base();
    g.add(brick('headlight1x1', 0, 1, 0, 1));
    // Its stud points +x; aim at the recessed face, half a plate inside x = 1.
    const hit = v3(1 * STUD - 0.5 * PLATE_H, 2.5 * PLATE_H, 0.5 * STUD);
    const p = computeSnap(g, hit, v3(1, 0, 0), 'roundtile1x1', 0);
    expect(p).toMatchObject({ face: '+x', x: 0.8, y: 1.5, z: 0 });
  });

  it('reach on into the next cell when thicker than a stud', () => {
    // A brick is three plates, 1.2 studs: on a side stud it reaches a fifth of a stud past its
    // cell, so a part right in front of it does not fit.
    const g = base();
    g.add(brick('sidestuds1x1', 0, 1, 0));
    const b = brick('1x1', 0, 1.5, 1, 0, '+z');
    expect(partBox(b)).toMatchObject({ z0: 1, z1: 3 });
    expect(g.add(b)).toEqual({ ok: true });
    expect(g.check({ type: 'plate1x1', x: 0, y: 1, z: 2, rot: 0 })).toEqual({
      ok: false,
      reason: 'overlap',
    });
    expect(g.check({ type: 'plate1x1', x: 0, y: 1, z: 3, rot: 0 }).ok).toBe(true);
  });
});

describe('partSolids', () => {
  it('is the bounds for a part with no hole', () => {
    const b = brick('2x4', 1, 0, 2, 1);
    expect(partSolids(b)).toEqual([partBounds(b)]);
  });

  it('fills just the cells a quarter arc takes, so its hole is free in the physics too', () => {
    for (const rot of [0, 1, 2, 3] as const) {
      const arc = brick('arc3x3', 2, 1, 3, rot);
      const filled = new Set<string>();
      for (const { min, max } of partSolids(arc)) {
        expect(min.y).toBeCloseTo(partBounds(arc).min.y);
        expect(max.y).toBeCloseTo(partBounds(arc).max.y);
        for (let x = Math.round(min.x / STUD); x < Math.round(max.x / STUD); x++)
          for (let z = Math.round(min.z / STUD); z < Math.round(max.z / STUD); z++) {
            expect(filled.has(`${x},${z}`), `rot ${rot}: ${x},${z} twice`).toBe(false);
            filled.add(`${x},${z}`);
          }
      }
      const cells = new Set([...cellsOf(arc)].map(([x, , z]) => `${x},${z}`));
      expect(filled, `rot ${rot}`).toEqual(cells);
      expect(cells.size).toBe(8);
    }
  });
});
