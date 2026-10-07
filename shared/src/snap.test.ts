import { describe, expect, it } from 'vitest';
import { PLATE_H } from './bricks.ts';
import { BrickGrid, cellsOf } from './grid.ts';
import type { Placement } from './grid.ts';
import { computeGroupSnap, computeSnap, turnPlacement } from './snap.ts';

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
