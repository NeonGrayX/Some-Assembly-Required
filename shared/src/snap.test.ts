import { describe, expect, it } from 'vitest';
import { PLATE_H } from './bricks.ts';
import { BrickGrid, cellsOf } from './grid.ts';
import type { Placement } from './grid.ts';
import { COLLIDER_INSET } from './parts.ts';
import {
  aimAtBricks,
  computeGroupSnap,
  computeLayerSnap,
  computeSnap,
  snapLayer,
  turnPlacement,
} from './snap.ts';

const plate = () =>
  BrickGrid.from([
    { id: 1, type: 'baseplate16', colour: 'baseplate-green', x: 0, y: 0, z: 0, rot: 0 },
  ]);
const up = { x: 0, y: 1, z: 0 };
const down = { x: 0, y: -1, z: 0 };
const cells = (ps: Placement[]) => new Set(ps.flatMap((p) => [...cellsOf(p)].map((c) => c.join())));

// A 2x4 with a 1x2 standing on one end of it.
const piece: Placement[] = [
  { type: '2x4', x: 0, y: 0, z: 0, rot: 0 },
  { type: '1x2', x: 0, y: 3, z: 0, rot: 0 },
];

describe('turnPlacement', () => {
  it('turns cells a quarter turn the way yawQuat does: (x, z) to (z, -x)', () => {
    const p: Placement = { type: '2x4', x: 1, y: 0, z: 2, rot: 0 };
    const turned = turnPlacement(p, 1);
    const expected = new Set([...cellsOf(p)].map(([x, y, z]) => [z, y, -x - 1].join()));
    expect(cells([turned])).toEqual(expected);
    expect(turned.rot).toBe(1);
  });

  it('comes back where it started after four quarter turns', () => {
    const p: Placement = { type: '2x3', x: 3, y: 0, z: -2, rot: 1 };
    expect(turnPlacement(turnPlacement(p, 2), 2)).toEqual(p);
  });
});

describe('parts with a centre hollow', () => {
  // Aim points on the baseplate's top, in metres: on the stud of cell (8, 8), and on the corner
  // between the studs of cells 7 and 8 both ways.
  const onStud = { x: 0.85, y: PLATE_H, z: 0.85 };
  const between = { x: 0.8, y: PLATE_H, z: 0.8 };

  it('put a cone on a stud or between four, whichever is aimed at', () => {
    expect(computeSnap(plate(), onStud, up, 'cone1x1', 0)).toMatchObject({ x: 8, z: 8 });
    expect(computeSnap(plate(), between, up, 'cone1x1', 0)).toMatchObject({ x: 7.5, z: 7.5 });
  });

  it('put a dish only centred on a stud that stands a plate clear of what is round it', () => {
    // Its rim comes down to its bottom: between four studs, or on one among others, it would
    // run into them.
    expect(computeSnap(plate(), between, up, 'dish2x2', 0)).toBeNull();
    expect(computeSnap(plate(), onStud, up, 'dish2x2', 0)).toBeNull();
    // On a 1x1 plate a plate up off the baseplate, it centres on the plate's stud.
    const raised = plate();
    raised.add({ id: 2, type: 'plate1x1', colour: 'red', x: 8, y: 1, z: 8, rot: 0 });
    const onTop = { ...onStud, y: 2 * PLATE_H };
    expect(computeSnap(raised, onTop, up, 'dish2x2', 0)).toMatchObject({ x: 7.5, y: 2, z: 7.5 });
    // Not with anything else within a plate under it: a tile, or a plate half a plate down.
    const dish = { type: 'dish2x2' as const, x: 7.5, y: 2, z: 7.5, rot: 0 as const };
    const tiled = plate();
    tiled.add({ id: 2, type: 'plate1x1', colour: 'red', x: 8, y: 1, z: 8, rot: 0 });
    tiled.add({ id: 3, type: 'tile1x1', colour: 'red', x: 9, y: 1, z: 8, rot: 0 });
    expect(tiled.check(dish)).toMatchObject({ ok: false });
    // Nor on a bigger part's one stud: its top would be right under the rim.
    const jumper = plate();
    jumper.add({ id: 2, type: 'jumper2x2', colour: 'red', x: 7, y: 1, z: 7, rot: 0 });
    expect(jumper.check({ ...dish, x: 7, z: 7 })).toMatchObject({ ok: false });
  });

  it("put a 1x1 or a plant stem on a dish's centre stud, and a dish on a dish", () => {
    const g = plate();
    g.add({ id: 2, type: 'plate1x1', colour: 'red', x: 8, y: 1, z: 8, rot: 0 });
    g.add({ id: 3, type: 'dish2x2', colour: 'red', x: 7.5, y: 2, z: 7.5, rot: 0 });
    const centre = { x: 0.85, y: 3 * PLATE_H, z: 0.85 };
    for (const type of ['plate1x1', '1x1', 'roundplate1x1', 'plant1x1'] as const)
      expect(computeSnap(g, centre, up, type, 0), type).toMatchObject({ x: 8, y: 3, z: 8 });
    // Its only stud is in the middle: a 1x1 on one of its cells holds on nothing.
    expect(g.check({ type: 'plate1x1', x: 7.5, y: 3, z: 7.5, rot: 0 }).ok).toBe(false);
    // Its top falls away from its stud, so another dish goes on it.
    expect(g.neighbours({ type: 'dish2x2', x: 7.5, y: 3, z: 7.5, rot: 0 })).toEqual([
      { lower: 3, upper: -1, studs: 1 },
    ]);
    expect(g.check({ type: 'dish2x2', x: 7.5, y: 3, z: 7.5, rot: 0 })).toEqual({ ok: true });
  });

  it('leave other parts on whole studs, and do the same for other round 1x1s', () => {
    expect(computeSnap(plate(), onStud, up, '2x2', 0)).toMatchObject({ x: 7, z: 7 });
    expect(computeSnap(plate(), onStud, up, 'plate1x1', 0)).toMatchObject({ x: 8, z: 8 });
    expect(computeSnap(plate(), between, up, 'round1x1', 0)).toMatchObject({ x: 7.5, z: 7.5 });
    // A 1x1 round tile sits on a stud like any tile, never between four; a round plate can.
    const tile = computeSnap(plate(), between, up, 'roundtile1x1', 0)!;
    expect([tile.x % 1, tile.z % 1]).toEqual([0, 0]);
    expect(computeSnap(plate(), between, up, 'roundplate1x1', 0)).toMatchObject({ x: 7.5, z: 7.5 });
    const one = BrickGrid.from([{ id: 1, type: '2x2', colour: 'red', x: 0, y: 0, z: 0, rot: 0 }]);
    expect(one.check({ type: 'roundtile1x1', x: 0.5, y: 3, z: 0.5, rot: 0 })).toMatchObject({
      ok: false,
    });
    // A stud goes into the 2x2 round tile's hole, not into the 2x2 round plate's axle hole: on a
    // stud that stands up on its own it centres on it.
    const raised = plate();
    raised.add({ id: 2, type: 'plate1x1', colour: 'red', x: 8, y: 1, z: 8, rot: 0 });
    const onTop = { ...onStud, y: 2 * PLATE_H };
    expect(computeSnap(raised, onTop, up, 'roundtile2x2', 0)).toMatchObject({ x: 7.5, z: 7.5 });
    expect(computeSnap(plate(), onStud, up, 'roundplate2x2', 0)).toMatchObject({ x: 7, z: 7 });
  });

  it('hold a cone between studs only with all four there', () => {
    const one = BrickGrid.from([{ id: 1, type: '1x1', colour: 'red', x: 0, y: 0, z: 0, rot: 0 }]);
    expect(one.check({ type: 'cone1x1', x: 0.5, y: 3, z: 0.5, rot: 0 })).toEqual({
      ok: false,
      reason: 'floating',
    });
    // Aimed at the 1x1's corner, it goes on its stud instead.
    const corner = { x: 0.09, y: 3 * PLATE_H, z: 0.09 };
    expect(computeSnap(one, corner, up, 'cone1x1', 0)).toMatchObject({ x: 0, z: 0 });

    // Four 1x1s: the cone between them holds onto each.
    const four = BrickGrid.from(
      [0, 1, 2, 3].map((i) => ({
        id: i + 1,
        type: '1x1' as const,
        colour: 'red' as const,
        x: i % 2,
        y: 0,
        z: Math.floor(i / 2),
        rot: 0 as const,
      })),
    );
    const cone = { type: 'cone1x1' as const, x: 0.5, y: 3, z: 0.5, rot: 0 as const };
    expect(
      four
        .neighbours(cone)
        .map((c) => [c.lower, c.studs])
        .sort(),
    ).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
    ]);
    four.add({ ...cone, id: 5, colour: 'gold' });
    // It covers the four cells it reaches into.
    expect(four.brickAt(1, 4, 1)).toBe(5);
    expect(four.components()).toEqual([[1, 2, 3, 4, 5]]);
  });

  it('hold a dish on one stud, and stack on a cone half a stud off', () => {
    const g = BrickGrid.from([{ id: 1, type: '2x2', colour: 'red', x: 0, y: 0, z: 0, rot: 0 }]);
    g.add({ id: 2, type: 'cone1x1', colour: 'gold', x: 0.5, y: 3, z: 0.5, rot: 0 });
    // The cone's stud is half a stud off too: a dish centres on it, a plate half a stud off too.
    const dish = { type: 'dish2x2' as const, x: 0, y: 6, z: 0, rot: 0 as const };
    expect(g.neighbours(dish)).toEqual([{ lower: 2, upper: -1, studs: 1 }]);
    expect(g.check({ type: 'plate1x1', x: 0, y: 6, z: 0, rot: 0 })).toMatchObject({ ok: false });
    expect(g.check({ type: 'plate1x1', x: 0.5, y: 6, z: 0.5, rot: 0 })).toEqual({ ok: true });
    // A dish on a single 1x1's stud.
    const one = BrickGrid.from([{ id: 1, type: '1x1', colour: 'red', x: 3, y: 0, z: 3, rot: 0 }]);
    const centred = { type: 'dish2x2' as const, x: 2.5, y: 3, z: 2.5, rot: 0 as const };
    expect(one.neighbours(centred)).toEqual([{ lower: 1, upper: -1, studs: 1 }]);
  });

  it('never hold a dish between studs', () => {
    const one = BrickGrid.from([{ id: 1, type: '1x1', colour: 'red', x: 0, y: 0, z: 0, rot: 0 }]);
    // Over the 1x1's corner, its hollow is between that stud and three missing ones.
    expect(one.check({ type: 'dish2x2', x: 0, y: 3, z: 0, rot: 0 })).toMatchObject({ ok: false });
    // With all four there, its rim runs into them.
    const two = BrickGrid.from([{ id: 1, type: '2x2', colour: 'red', x: 0, y: 0, z: 0, rot: 0 }]);
    expect(two.neighbours({ type: 'dish2x2', x: 0, y: 3, z: 0, rot: 0 })).toEqual([]);
    expect(two.check({ type: 'dish2x2', x: 0, y: 3, z: 0, rot: 0 })).toMatchObject({ ok: false });
  });

  it('put any part on a cone between four studs', () => {
    const four = plate();
    four.add({ id: 2, type: 'cone1x1', colour: 'gold', x: 7.5, y: 1, z: 7.5, rot: 0 });
    // Aimed at the cone's top, in the middle of its stud.
    const top = { x: 0.8, y: 4 * PLATE_H, z: 0.8 };
    for (const type of ['1x1', 'plate1x1', 'round1x1', 'cone1x1', '2x2'] as const) {
      const p = computeSnap(four, top, up, type, 0);
      expect(p, type).not.toBeNull();
      expect(four.neighbours(p!), type).toEqual([{ lower: 2, upper: -1, studs: 1 }]);
    }
    expect(computeSnap(four, top, up, '1x1', 0)).toMatchObject({ x: 7.5, y: 4, z: 7.5 });
    // Whole bricks on the plate stay on whole studs.
    expect(computeSnap(four, { x: 0.25, y: PLATE_H, z: 0.25 }, up, '1x1', 0)).toMatchObject({
      x: 2,
      z: 2,
    });
  });

  it('put a fern only into an open stud', () => {
    const g = plate();
    g.add({ id: 2, type: '1x1', colour: 'red', x: 2, y: 1, z: 2, rot: 0 });
    g.add({ id: 3, type: 'round1x1', colour: 'red', x: 4, y: 1, z: 2, rot: 0 });
    g.add({ id: 4, type: 'cone1x1', colour: 'red', x: 6.5, y: 1, z: 2.5, rot: 0 });
    const fern = (x: number, y: number, z: number) => ({
      type: 'plant1x1' as const,
      x,
      y,
      z,
      rot: 0 as const,
    });
    expect(g.check(fern(8, 1, 8))).toMatchObject({ ok: false });
    expect(g.check(fern(2, 4, 2))).toMatchObject({ ok: false });
    expect(g.check(fern(4, 4, 2))).toEqual({ ok: true });
    expect(g.check(fern(6.5, 4, 2.5))).toEqual({ ok: true });
  });

  it('leave the cell in the hole of a quarter arc free, for another part', () => {
    const g = plate();
    for (const rot of [0, 1, 2, 3] as const) {
      const arc = { type: 'arc3x3' as const, x: 4 * rot, y: 1, z: 4, rot };
      g.add({ ...arc, id: 10 + rot, colour: 'light-grey' });
      // The corner its hole goes round, turned with it.
      const corner = [...cellsOf({ ...arc, type: 'plate3x3' as const })].find(
        ([x, , z]) => ![...cellsOf(arc)].some(([ax, , az]) => ax === x && az === z),
      )!;
      expect(
        g.check({ type: '1x1', x: corner[0], y: 1, z: corner[2], rot: 0 }),
        `rot ${rot}`,
      ).toEqual({
        ok: true,
      });
    }
    // Every other cell of its box is taken.
    expect(g.check({ type: '1x1', x: 1, y: 1, z: 4, rot: 0 })).toMatchObject({ ok: false });
  });

  it('turn half a stud off the grid like any part', () => {
    const p: Placement = { type: 'dish2x2', x: 0.5, y: 0, z: 1.5, rot: 0 };
    expect(turnPlacement(p, 1)).toMatchObject({ x: 1.5, z: -2.5 });
    expect(turnPlacement(turnPlacement(p, 2), 2)).toEqual(p);
  });
});

describe('computeGroupSnap', () => {
  it('sets a piece on the baseplate by its lowest layer, keeping its shape', () => {
    const hit = { x: 0.8, y: PLATE_H, z: 0.8 };
    const out = computeGroupSnap(plate(), hit, up, piece, 0)!;
    expect(out.map((p) => p.y)).toEqual([1, 4]);
    expect(out[1]!.x - out[0]!.x).toBe(0);
    expect(out[1]!.z - out[0]!.z).toBe(0);
    // The 2x4 is centred on the aim point.
    expect(out[0]).toMatchObject({ x: 6, z: 7 });
  });

  it('turns the whole piece', () => {
    const hit = { x: 0.8, y: PLATE_H, z: 0.8 };
    const out = computeGroupSnap(plate(), hit, up, piece, 1)!;
    expect(out.map((p) => p.rot)).toEqual([1, 1]);
    const expected = cells(piece.map((p) => turnPlacement(p, 1)));
    const dx = out[0]!.x - turnPlacement(piece[0]!, 1).x;
    const dz = out[0]!.z - turnPlacement(piece[0]!, 1).z;
    const moved = new Set(
      [...expected]
        .map((c) => c.split(',').map(Number))
        .map(([x, y, z]) => [x! + dx, y! + 1, z! + dz].join()),
    );
    expect(cells(out)).toEqual(moved);
  });

  it('nudges the piece off a brick in the way, and gives up when nothing fits', () => {
    const g = plate();
    g.insert({ id: 2, type: '1x1', colour: 'red', x: 7, y: 1, z: 6, rot: 0 });
    const hit = { x: 0.8, y: PLATE_H, z: 0.8 };
    const out = computeGroupSnap(g, hit, up, piece, 0)!;
    for (const c of cells(out)) expect(c).not.toBe('7,1,6');
    expect(computeGroupSnap(g, hit, { x: 1, y: 0, z: 0 }, piece, 0)).toBeNull();
  });

  it('hangs a piece underneath by its highest layer', () => {
    const g = BrickGrid.from([{ id: 1, type: '2x4', colour: 'red', x: 0, y: 6, z: 0, rot: 0 }]);
    const out = computeGroupSnap(g, { x: 0.2, y: 6 * PLATE_H, z: 0.1 }, down, piece, 0)!;
    expect(out[1]!.y + 3).toBe(6);
    expect(out[0]!.y).toBe(0);
  });

  it('needs at least one brick of the piece to clutch the target', () => {
    const g = plate();
    // Aimed at the plate's top far outside it: the piece would float beside it.
    expect(computeGroupSnap(g, { x: 3, y: PLATE_H, z: 3 }, up, piece, 0)).toBeNull();
  });

  it('places a single brick exactly as computeSnap does', () => {
    const hit = { x: 0.43, y: PLATE_H, z: 0.77 };
    for (const rot of [0, 1, 2, 3] as const) {
      const one = computeGroupSnap(
        plate(),
        hit,
        up,
        [{ type: '2x3', x: 0, y: 0, z: 0, rot: 0 }],
        rot,
      );
      expect(one?.[0]).toEqual(computeSnap(plate(), hit, up, '2x3', rot));
      expect(one?.[0]?.rot).toBe(rot);
    }
  });
});

describe('computeLayerSnap', () => {
  // A 2x4 standing on the baseplate (studs 0 to 3 along x), its top 4 plates up.
  const tower = () => {
    const g = plate();
    g.add({ id: 2, type: '2x4', colour: 'red', x: 0, y: 1, z: 0, rot: 0 });
    return g;
  };
  const layer = { y: 4, down: false };
  const one: Placement[] = [{ type: '2x2', x: 0, y: 0, z: 0, rot: 0 }];
  const looking = (x: number) => ({ origin: { x, y: 1, z: 0.2 }, dir: { x: 0, y: -1, z: 0 } });

  it('reads the layer off the face the aim is on', () => {
    expect(snapLayer({ x: 0.1, y: 4 * PLATE_H, z: 0.1 }, up)).toEqual(layer);
    expect(snapLayer({ x: 0.1, y: PLATE_H, z: 0.1 }, down)).toEqual({ y: 1, down: true });
    expect(snapLayer({ x: 0.1, y: PLATE_H, z: 0.1 }, { x: 1, y: 0, z: 0 })).toBeNull();
  });

  it('keeps a brick on the locked layer while one stud still clutches, though the aim is past it', () => {
    const { origin, dir } = looking(0.4);
    // Unlocked, the aim point is on the baseplate beside the 2x4, so the brick drops there.
    expect(computeSnap(tower(), { x: 0.4, y: PLATE_H, z: 0.2 }, up, '2x2', 0)).toMatchObject({
      y: 1,
    });
    expect(computeLayerSnap(tower(), origin, dir, one, 0, layer)?.[0]).toMatchObject({
      x: 3,
      y: 4,
      z: 1,
    });
  });

  it('lets go once no stud of the brick below is left in reach', () => {
    const { origin, dir } = looking(0.6);
    expect(computeLayerSnap(tower(), origin, dir, one, 0, layer)).toBeNull();
  });

  it('only meets the layer from the side its face looks to, and within reach', () => {
    const { origin, dir } = looking(0.2);
    expect(computeLayerSnap(tower(), origin, dir, one, 0, { y: 4, down: true })).toBeNull();
    expect(computeLayerSnap(tower(), origin, dir, one, 0, layer, 0.5)).toBeNull();
  });
});

describe('aimAtBricks', () => {
  // A 2x4 brick on the plate, 3 plates high, over cells x 2..6, z 2..4.
  const brick = {
    id: 2,
    type: '2x4' as const,
    colour: 'red' as const,
    x: 2,
    y: 1,
    z: 2,
    rot: 0 as const,
  };
  const grid = () => BrickGrid.from([...plate().bricks.values(), brick]);

  it('meets the top of a brick, drawn in like its collider, facing up', () => {
    const hit = aimAtBricks(grid().bricks.values(), { x: 0.3, y: 2, z: 0.3 }, down);
    expect(hit?.brickId).toBe(2);
    expect(hit?.normal).toEqual(up);
    expect(hit?.point.y).toBeCloseTo(4 * PLATE_H - COLLIDER_INSET);
  });

  it('meets the nearest box, and a side from the side', () => {
    const hit = aimAtBricks(
      grid().bricks.values(),
      { x: -1, y: 0.06, z: 0.3 },
      { x: 1, y: 0, z: 0 },
    );
    expect(hit?.brickId).toBe(2);
    expect(hit?.normal).toEqual({ x: -1, y: 0, z: 0 });
    expect(hit?.point.x).toBeCloseTo(0.2 + COLLIDER_INSET);
  });

  it('snaps on top where the game would: on the brick it meets', () => {
    const g = grid();
    const hit = aimAtBricks(g.bricks.values(), { x: 0.3, y: 2, z: 0.3 }, down)!;
    const p = computeSnap(g, hit.point, hit.normal, '1x1', 0);
    expect(p).toMatchObject({ y: 4 });
  });

  it('misses past the bricks, or beyond the reach given', () => {
    expect(aimAtBricks(grid().bricks.values(), { x: -1, y: 2, z: -1 }, up)).toBeNull();
    expect(aimAtBricks(grid().bricks.values(), { x: 0.3, y: 2, z: 0.3 }, down, 1)).toBeNull();
  });
});
