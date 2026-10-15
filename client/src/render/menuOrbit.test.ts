import { HOUSE, MAPS, groundHeight } from '@sar/shared';
import type { LevelDef, Vec3 } from '@sar/shared';
import { describe, expect, it } from 'vitest';
import { MENU_ORBIT, MenuOrbit, cameraBlocker, entry } from './menuOrbit.ts';
import type { Aabb } from './menuOrbit.ts';

/** More than the camera's near plane: anything this close in front of it is cut open. */
const NEAR = 0.3;

const inside = (p: Vec3, b: Aabb) =>
  p.x > b.min.x &&
  p.x < b.max.x &&
  p.y > b.min.y &&
  p.y < b.max.y &&
  p.z > b.min.z &&
  p.z < b.max.z;

/** Every box the camera comes within `NEAR` of on a whole lap, with the time it does. */
function clips(level: LevelDef, orbit: { at(t: number): Vec3 } = new MenuOrbit(level)): string[] {
  const boxes = level.boxes.map((b) => ({ b, a: cameraBlocker(b, NEAR) }));
  const lap = (Math.PI * 2) / MENU_ORBIT.speed;
  const hits: string[] = [];
  for (let t = 0; t < lap; t += lap / 720) {
    const p = orbit.at(t);
    for (const { b, a } of boxes) {
      if (inside(p, a)) hits.push(`${t.toFixed(1)}s: ${JSON.stringify(b.pos)}`);
    }
    // Nor into the hills, where the ground rises and falls.
    if (p.y < groundHeight(level, p.x, p.z) + NEAR) hits.push(`${t.toFixed(1)}s: in the ground`);
  }
  return hits;
}

describe('the fly-around behind the menu', () => {
  it('flew through the house on the old circle', () => {
    // The circle it used to fly: 9 m out from the origin, 5 m up, starting in the upper floor.
    const old = {
      at: (t: number) => ({ x: Math.sin(t * 0.1) * 9, y: 5, z: Math.cos(t * 0.1) * 9 }),
    };
    expect(clips(HOUSE, old)).not.toEqual([]);
  });

  it('starts out south of the job site, looking at the house over it', () => {
    const orbit = new MenuOrbit(HOUSE);
    const p = orbit.at(0);
    expect(Math.abs(p.x - orbit.look.x)).toBeLessThan(0.01);
    expect(p.z).toBeLessThan(orbit.look.z - 5);
  });

  it('stays out of the hand-made house all the way round', () => {
    expect(clips(HOUSE)).toEqual([]);
  });

  it('stays out of every furnished house and every map', () => {
    for (const map of MAPS) {
      for (const seed of [1, 42, 99999]) {
        const level = map.layout(seed);
        expect(clips(level), `${map.id} seed ${seed}`).toEqual([]);
      }
      expect(clips(map.plain), `${map.id} plain`).toEqual([]);
    }
  }, 60_000);

  it('eases in and out rather than jumping', () => {
    const orbit = new MenuOrbit(HOUSE);
    const n = MENU_ORBIT.samples;
    for (let i = 0; i < n; i++) {
      const step = Math.abs(orbit.reach[(i + 1) % n]! - orbit.reach[i]!);
      expect(step).toBeLessThan(0.05);
    }
  });

  it('finds where a line first enters a box', () => {
    const box = { min: { x: 1, y: -1, z: -1 }, max: { x: 2, y: 1, z: 1 } };
    expect(entry({ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, box)).toBeCloseTo(0.25);
    expect(entry({ x: 0, y: 0, z: 0 }, { x: 4, y: 9, z: 0 }, box)).toBe(1);
    expect(entry({ x: 0, y: 0, z: 0 }, { x: 0.5, y: 0, z: 0 }, box)).toBe(1);
  });
});
