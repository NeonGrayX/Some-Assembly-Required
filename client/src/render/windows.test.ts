import { describe, expect, it } from 'vitest';
import { WINDOW_WIDTH, houseLayout } from '@sar/shared';
import { levelWindows, windowOpenings } from './details.ts';

describe('windows in a furnished house', () => {
  it('each cut a hole as wide as the layouts expect in an outside wall', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const level = houseLayout(seed * 977);
      const openings = windowOpenings(level, levelWindows(level));
      expect(openings).toHaveLength(level.windows!.length);
      for (const o of openings) {
        expect(o.to - o.from).toBeCloseTo(WINDOW_WIDTH);
        // Inside its wall, never past either end of it.
        const half = (o.alongX ? o.wall.size.x : o.wall.size.z) / 2;
        const mid = o.alongX ? o.wall.pos.x : o.wall.pos.z;
        expect(o.from).toBeGreaterThanOrEqual(mid - half);
        expect(o.to).toBeLessThanOrEqual(mid + half);
      }
    }
  });
});
