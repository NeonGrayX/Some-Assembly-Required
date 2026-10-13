import { describe, expect, it } from 'vitest';
import { breakablePieces, clutchPower, planBreaks } from './breaking.ts';
import type { BrickTypeId } from './bricks.ts';
import { BrickGrid } from './grid.ts';
import type { PlacedBrick } from './grid.ts';

/** A baseplate with `count` parts of `type` stacked on it, `plates` tall each. */
const stack = (type: BrickTypeId, count: number, plates = 3): BrickGrid =>
  BrickGrid.from([
    { id: 0, type: 'baseplate16', colour: 'baseplate-green', x: 0, y: 0, z: 0, rot: 0 },
    ...Array.from({ length: count }, (_, i): PlacedBrick => ({
      id: i + 1,
      type,
      colour: 'red',
      x: 4,
      y: 1 + i * plates,
      z: 4,
      rot: 0,
    })),
  ]);

const weakest = (g: BrickGrid) => breakablePieces(g)[0]!;

describe('clutch power', () => {
  it('is contact area over volume, levered by height: round 1x1 bricks least, plates most', () => {
    expect(clutchPower('2x4')).toBeCloseTo(1 / 3);
    expect(clutchPower('plate8x16')).toBe(1);
    expect(clutchPower('round1x1')).toBeLessThan(clutchPower('1x1'));
    expect(clutchPower('1x1')).toBeLessThan(clutchPower('2x4'));
    expect(clutchPower('2x4')).toBeLessThan(clutchPower('plate8x16'));
    for (const t of ['1x1', '1x2', '2x2', '2x4', '1x4', '2x10', 'plate1x1', 'plate8x16'] as const)
      expect(clutchPower('round1x1')).toBeLessThan(clutchPower(t));
  });

  it('keeps an 8x16 plate on even when someone trips over it', () => {
    const plate = stack('plate8x16', 1, 1);
    expect(weakest(plate).strength).toBeGreaterThan(100);
    expect(planBreaks(plate, 10, () => 1)).toEqual([]);
  });

  it('lets a 10-high tower of round 1x1 bricks fall over from just picking up its plate', () => {
    const tower = stack('round1x1', 10);
    const bottom = weakest(tower);
    expect(bottom.bricks).toHaveLength(10);
    expect(bottom.strength).toBeLessThan(0.8);
    expect(planBreaks(tower, 1, () => 0)).toEqual([{ lower: 0, upper: 1, studs: 1 }]);
    // Three round bricks are still fine when picked up, only not when dropped.
    const short = weakest(stack('round1x1', 3));
    expect(short.strength).toBeGreaterThan(1.2);
    expect(short.strength).toBeLessThan(5);
  });

  it('holds a piece by every joint in its plane, spread wide', () => {
    // Two 1x1 legs under a 1x6 plate: the plate and what is on it stand on both.
    const g = BrickGrid.from([
      { id: 0, type: 'baseplate16', colour: 'baseplate-green', x: 0, y: 0, z: 0, rot: 0 },
      { id: 1, type: '1x1', colour: 'red', x: 4, y: 1, z: 4, rot: 0 },
      { id: 2, type: '1x1', colour: 'red', x: 9, y: 1, z: 4, rot: 0 },
      { id: 3, type: 'plate1x6', colour: 'red', x: 4, y: 4, z: 4, rot: 0 },
    ]);
    const top = breakablePieces(g).find((p) => p.bricks.length === 1 && p.bricks[0] === 3)!;
    expect(top.joints).toHaveLength(2);
    // Lifting both legs off the baseplate takes it all.
    const all = breakablePieces(g).find((p) => p.bricks.length === 3)!;
    expect(all.joints.map((c) => c.upper).sort()).toEqual([1, 2]);
  });

  it('grows weaker the taller a tower gets', () => {
    const strengths = [2, 4, 6, 8].map((n) => weakest(stack('1x1', n)).strength);
    for (let i = 1; i < strengths.length; i++) expect(strengths[i]).toBeLessThan(strengths[i - 1]!);
  });
});
