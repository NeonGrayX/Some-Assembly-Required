import { describe, expect, it } from 'vitest';
import { BrickGrid } from '../grid.ts';
import { LIGHTHOUSE } from './lighthouse.ts';
import { matchBuild } from './match.ts';
import { brickName, inspectionReport } from './report.ts';
import { allBricks } from './types.ts';

describe('brickName', () => {
  it('names bricks and plates the way people say them', () => {
    expect(brickName('2x2', 'white')).toBe('white 2x2 brick');
    expect(brickName('plate2x4', 'dark-grey')).toBe('dark grey 2x4 plate');
  });
});

describe('inspectionReport', () => {
  // Steps 1 and 2 built, with one look-alike, one wrong colour and one brick left out of
  // step 2, plus a stray brick. Step 3 onwards untouched.
  const grid = BrickGrid.from([
    { id: 0, type: 'baseplate16', colour: 'baseplate-green', x: 0, y: 0, z: 0, rot: 0 },
  ]);
  allBricks(LIGHTHOUSE)
    .filter((b) => b.step < 2)
    .forEach((b, i) => {
      if (i === 9) return; // left out
      const colour = i === 6 ? 'dark-red' : i === 1 ? 'blue' : b.colour;
      grid.add({ ...b, colour, id: i + 1 });
    });
  grid.add({ id: 99, type: '1x1', colour: 'green', x: 15, y: 1, z: 0, rot: 0 });
  const report = inspectionReport(matchBuild(LIGHTHOUSE, grid), grid);

  it('counts correct bricks per step and overall', () => {
    expect(report.correct).toBe(7);
    expect(report.total).toBe(32);
    expect(report.steps.slice(0, 3).map((s) => [s.correct, s.total])).toEqual([
      [4, 5],
      [3, 5],
      [0, 4],
    ]);
  });

  it('lists what is wrong in the started steps', () => {
    expect(report.steps[0]!.lines).toEqual([
      { kind: 'wrong', text: 'blue 2x4 brick, should be dark grey 2x4 brick' },
    ]);
    expect(report.steps[1]!.lines).toEqual([
      { kind: 'close', text: 'dark red 2x4 brick, should be red 2x4 brick' },
      { kind: 'missing', text: 'missing: red 2x4 brick' },
    ]);
    expect(report.extras).toEqual([
      { kind: 'extra', text: 'extra: green 1x1 brick (not in the plans)' },
    ]);
  });

  it('does not give away steps nobody has started', () => {
    expect(report.steps[2]!.verdict).toBe('empty');
    expect(report.steps[2]!.lines).toEqual([]);
    expect(report.ghosts).toHaveLength(1);
  });

  it('flags the bricks to mark on the build', () => {
    expect(report.flagged).toEqual([
      { id: 2, kind: 'wrong' },
      { id: 7, kind: 'close' },
      { id: 99, kind: 'wrong' },
    ]);
  });
});
