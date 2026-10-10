import { describe, expect, it } from 'vitest';
import { PLATE_H } from './bricks.ts';
import { BrickGrid, cellsOf } from './grid.ts';
import type { Placement } from './grid.ts';
import {
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

  it('put a dish between four studs or centred on one, whichever is aimed at', () => {
    expect(computeSnap(plate(), between, up, 'dish2x2', 0)).toMatchObject({ x: 7, z: 7 });
    expect(computeSnap(plate(), onStud, up, 'dish2x2', 0)).toMatchObject({ x: 7.5, z: 7.5 });
  });

  it('leave other parts on whole studs, and do the same for other round 1x1s', () => {
    expect(computeSnap(plate(), onStud, up, '2x2', 0)).toMatchObject({ x: 7, z: 7 });
    expect(computeSnap(plate(), onStud, up, 'plate1x1', 0)).toMatchObject({ x: 8, z: 8 });
    expect(computeSnap(plate(), between, up, 'round1x1', 0)).toMatchObject({ x: 7.5, z: 7.5 });
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
    // The cone's stud is half a stud off too: a dish centres on it, a plate cannot hold.
    const dish = { type: 'dish2x2' as const, x: 0, y: 6, z: 0, rot: 0 as const };
    expect(g.neighbours(dish)).toEqual([{ lower: 2, upper: -1, studs: 1 }]);
    expect(g.check({ type: 'plate1x1', x: 0, y: 6, z: 0, rot: 0 })).toMatchObject({ ok: false });
    // A dish on a single 1x1's stud.
    const one = BrickGrid.from([{ id: 1, type: '1x1', colour: 'red', x: 3, y: 0, z: 3, rot: 0 }]);
    const centred = { type: 'dish2x2' as const, x: 2.5, y: 3, z: 2.5, rot: 0 as const };
    expect(one.neighbours(centred)).toEqual([{ lower: 1, upper: -1, studs: 1 }]);
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
