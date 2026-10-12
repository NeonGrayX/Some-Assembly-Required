import { describe, expect, it } from 'vitest';
import { MAPS, UPPER_FLOOR } from '@sar/shared';
import { POOL_SIZE, lampRoom, roomPiece } from './furniture.ts';

/**
 * Every ceiling lamp's warm pool and baked shadows lie on the floor of its own room and stop at
 * its walls: a lamp hung high over a hall lights the hall's floor (not a floor at upstairs
 * height), and a small room's pool does not spill onto the ground outside.
 */
describe('the room a lamp hangs in', () => {
  for (const map of MAPS) {
    for (const seed of [1, 2, 3]) {
      const level = map.layout(seed);
      it(`${map.id} (seed ${seed}): every lamp has a floor under it, below it`, () => {
        for (const lamp of level.lights) {
          const room = lampRoom(level, lamp);
          expect(room.rect, `lamp at ${JSON.stringify(lamp)}`).not.toBeNull();
          expect(lamp.y - room.y).toBeGreaterThan(1.5);
          expect(lamp.y - room.y).toBeLessThan(4);
        }
      });
    }
  }

  it('a lamp upstairs lights the upper floor', () => {
    const level = MAPS.find((m) => m.id === 'house')!.layout(1);
    const upstairs = level.lights.filter((l) => l.y > UPPER_FLOOR);
    expect(upstairs.length).toBeGreaterThan(0);
    for (const lamp of upstairs) expect(lampRoom(level, lamp).y).toBe(UPPER_FLOOR);
  });

  it("the merchant's hall lamps light the hall's floor, high as they hang", () => {
    const level = MAPS.find((m) => m.id === 'merchant')!.layout(1);
    const high = level.lights.filter((l) => l.y > UPPER_FLOOR);
    expect(high.length).toBeGreaterThan(0);
    for (const lamp of high) expect(lampRoom(level, lamp).y).toBe(0);
  });

  it("cuts a pool to its room, keeping the whole pool's texture coordinates", () => {
    const at = { x: 1, z: 2 };
    // A room 2 m wide (x) and 4 m deep, centred on the lamp.
    const g = roomPiece(at, POOL_SIZE, POOL_SIZE, { x0: 0, x1: 2, z0: 0, z1: 4 });
    g.computeBoundingBox();
    const box = g.boundingBox!;
    expect(box.min.x).toBeCloseTo(-1);
    expect(box.max.x).toBeCloseTo(1);
    // Laid flat, the plane's +y is the world's -z.
    expect(box.min.y).toBeCloseTo(-2);
    expect(box.max.y).toBeCloseTo(2);
    const uv = g.attributes.uv!;
    const us = Array.from({ length: uv.count }, (_, i) => uv.getX(i));
    expect(Math.min(...us)).toBeCloseTo(0.5 - 1 / POOL_SIZE);
    expect(Math.max(...us)).toBeCloseTo(0.5 + 1 / POOL_SIZE);
  });
});
