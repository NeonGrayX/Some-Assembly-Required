import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SEA } from './ground.ts';
import { buildIsland } from './map.ts';
import { Walker } from './walk.ts';

const island = buildIsland();

/** Walks toward (`x`, `z`) for up to `seconds`, and returns where the walker got to. */
function walkTo(w: Walker, x: number, z: number, seconds = 12): THREE.Vector3 {
  for (let t = 0; t < seconds * 60; t++) {
    const dx = x - w.pos.x;
    const dz = z - w.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.15) break;
    w.update(1 / 60, { x: dx / d, z: dz / d, run: false, jump: false });
  }
  return w.pos.clone();
}

const walker = () => new Walker(island.solids, island.ground, SEA);

describe('the pirate test map', () => {
  it('starts the player on dry sand', () => {
    const w = walker();
    w.spawn(island.spawn.x, island.spawn.z);
    expect(w.pos.y).toBeGreaterThan(SEA + 0.3);
  });

  it('takes the player up the gangway onto the galleon', () => {
    const { gangwayFoot: foot, gangwayTop: top } = island.marks;
    const w = walker();
    w.spawn(foot.x, foot.z);
    const at = walkTo(w, top.x, top.z);
    expect(Math.hypot(at.x - top.x, at.z - top.z)).toBeLessThan(0.3);
    expect(at.y).toBeCloseTo(top.y, 1);
  });

  it('takes the player about the galleon: down from the forecastle and up onto the quarterdeck', () => {
    const [start, ...way] = island.deckWalk;
    const w = walker();
    w.spawn(start!.x, start!.z);
    expect(w.pos.y).toBeCloseTo(start!.y, 1);
    for (const p of way) {
      const at = walkTo(w, p.x, p.z);
      expect(Math.hypot(at.x - p.x, at.z - p.z)).toBeLessThan(0.3);
      expect(at.y).toBeCloseTo(p.y, 1);
    }
  });

  it('takes the player up the outside stair to the balcony', () => {
    const { stairFoot, landing, balcony } = island.marks;
    const w = walker();
    w.spawn(stairFoot.x, stairFoot.z);
    walkTo(w, landing.x, landing.z);
    expect(w.pos.y).toBeCloseTo(landing.y, 1);
    walkTo(w, balcony.x, balcony.z);
    expect(w.pos.y).toBeCloseTo(balcony.y, 1);
  });

  it('keeps the player out of the house and out of the deep sea', () => {
    const w = walker();
    w.spawn(island.spawn.x, island.spawn.z);
    const house = island.marks.balcony;
    // Straight at the house's middle, round the cannon first.
    walkTo(w, -3.6, 6);
    const at = walkTo(w, house.x - 3, house.z - 6);
    expect(Math.hypot(at.x - (house.x - 3), at.z - (house.z - 6))).toBeGreaterThan(1);
    // Out to sea, as far as the water lets them wade.
    const sea = walker();
    sea.spawn(island.spawn.x, island.spawn.z);
    const out = walkTo(sea, island.spawn.x, 40);
    expect(out.z).toBeLessThan(25);
    expect(island.ground(out.x, out.z)).toBeGreaterThan(SEA - 1.4);
  });
});
