import { describe, expect, it } from 'vitest';
import { CATCH_UP_MS, DT, catchUp } from './time.ts';

describe('catching up on ticks', () => {
  it('runs every whole tick it is behind by, keeping what is left over', () => {
    let steps = 0;
    const left = catchUp(DT * 4.5, () => steps++);
    expect(steps).toBe(4);
    expect(left).toBeCloseTo(DT / 2, 9);
  });

  it('lets the rest go once the ticks have taken too long', () => {
    let steps = 0;
    const left = catchUp(DT * 15.5, () => {
      steps++;
      const until = Date.now() + CATCH_UP_MS / 2 + 1;
      while (Date.now() < until);
    });
    expect(steps).toBe(2);
    expect(left).toBeCloseTo(DT / 2, 9);
  });
});
