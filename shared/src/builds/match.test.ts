import { describe, expect, it } from 'vitest';
import { BrickGrid } from '../grid.ts';
import type { PlacedBrick } from '../grid.ts';
import { LIGHTHOUSE } from './lighthouse.ts';
import { matchBuild } from './match.ts';
import { allBricks } from './types.ts';
import type { TargetBrick } from './types.ts';

const BASEPLATE: PlacedBrick = {
  id: 0,
  type: 'baseplate16',
  colour: 'baseplate-green',
  x: 0,
  y: 0,
  z: 0,
  rot: 0,
};

/** Builds the lighthouse with the normal snapping rules, optionally changing some bricks. */
function build(edit: (b: TargetBrick, i: number) => TargetBrick | null = (b) => b): BrickGrid {
  const g = BrickGrid.from([BASEPLATE]);
  allBricks(LIGHTHOUSE).forEach((t, i) => {
    const b = edit(t, i);
    if (!b) return;
    const r = g.add({ ...b, id: i + 1 });
    if (!r.ok) throw new Error(`brick ${i} cannot be placed: ${r.reason}`);
  });
  return g;
}

describe('lighthouse', () => {
  it('has 32 bricks in 8 steps', () => {
    expect(LIGHTHOUSE.steps).toHaveLength(8);
    expect(allBricks(LIGHTHOUSE)).toHaveLength(32);
  });

  it('can be built step by step on the baseplate', () => {
    expect(() => build()).not.toThrow();
  });
});

describe('matchBuild', () => {
  it('passes a perfect build', () => {
    const r = matchBuild(LIGHTHOUSE, build());
    expect(r.counts).toMatchObject({ correct: 32, close: 0, wrong: 0, missing: 0, extra: 0 });
    expect(r.passed).toBe(true);
    expect(r.steps.every((s) => s === 'correct')).toBe(true);
  });

  it('treats a half-turned symmetric brick as correct', () => {
    const r = matchBuild(
      LIGHTHOUSE,
      build((b) => (b.type === '2x2' ? { ...b, rot: 2 } : b)),
    );
    expect(r.counts.correct).toBe(32);
  });

  it('rates a look-alike colour as close and fails the step', () => {
    const r = matchBuild(
      LIGHTHOUSE,
      build((b, i) => (i === 6 ? { ...b, colour: 'dark-red' } : b)),
    );
    expect(r.counts).toMatchObject({ correct: 31, close: 1 });
    expect(r.steps[1]).toBe('wrong');
    // One swap out of 32 is survivable...
    expect(r.passed).toBe(true);
  });

  it('fails when two bricks are swapped', () => {
    const r = matchBuild(
      LIGHTHOUSE,
      build((b, i) => (i === 6 || i === 7 ? { ...b, colour: 'dark-red' } : b)),
    );
    expect(r.passed).toBe(false);
  });

  it('rates a look-alike type at the same corner as close', () => {
    // The light-grey 2x2 in the base becomes a light-grey plate 2x2 (still clutched).
    const r = matchBuild(
      LIGHTHOUSE,
      build((b, i) => (i === 4 ? { ...b, type: 'plate2x2' } : b)),
    );
    expect(r.bricks[4]!.status).toBe('close');
  });

  it('reports missing steps as empty and partial steps as partial', () => {
    const firstTwoSteps = LIGHTHOUSE.steps[0]!.bricks.length + 3;
    const r = matchBuild(
      LIGHTHOUSE,
      build((b, i) => (i < firstTwoSteps ? b : null)),
    );
    expect(r.steps.slice(0, 3)).toEqual(['correct', 'partial', 'empty']);
    expect(r.counts.missing).toBe(32 - firstTwoSteps);
    expect(r.passed).toBe(false);
  });

  it('counts stray bricks as extras', () => {
    const g = build();
    g.add({ id: 100, type: '1x1', colour: 'green', x: 0, y: 1, z: 0, rot: 0 });
    g.add({ id: 101, type: '1x1', colour: 'green', x: 15, y: 1, z: 0, rot: 0 });
    const r = matchBuild(LIGHTHOUSE, g);
    expect(r.extras).toEqual([100, 101]);
    expect(r.passed).toBe(false);
  });
});
