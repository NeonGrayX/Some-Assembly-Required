import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { HOUSE } from '../content/house.ts';
import { length } from '../math.ts';
import { Sim } from './sim.ts';

beforeAll(async () => {
  await RAPIER.init();
});

const settle = (sim: Sim, ticks: number) => {
  for (let i = 0; i < ticks; i++) sim.step();
};

/** A player standing on the open lawn, facing -z, with nothing pressed. */
function onLawn() {
  const sim = new Sim(RAPIER, HOUSE);
  const p = sim.addPlayer();
  settle(sim, 30);
  p.input.yaw = 0;
  return { sim, p };
}

describe('momentum', () => {
  it('speeds up and slows down over a few ticks rather than instantly', () => {
    const { sim, p } = onLawn();
    p.input.forward = 1;
    sim.step();
    expect(p.vel.z).toBeLessThan(0);
    expect(length(p.vel)).toBeLessThan(3.5);
    settle(sim, 20);
    expect(length(p.vel)).toBeCloseTo(3.5, 3);
    p.input.forward = 0;
    sim.step();
    expect(length(p.vel)).toBeGreaterThan(0);
    settle(sim, 20);
    expect(length(p.vel)).toBe(0);
  });

  it('keeps flying the way it jumped when the keys are let go', () => {
    const { sim, p } = onLawn();
    p.input.forward = 1;
    settle(sim, 20);
    p.input.jump = true;
    sim.step();
    p.input.jump = false;
    p.input.forward = 0;
    expect(p.grounded).toBe(false);
    const z = p.body.translation().z;
    settle(sim, 20);
    expect(p.grounded).toBe(false);
    // About 3.5 m/s for a third of a second, still going.
    expect(z - p.body.translation().z).toBeGreaterThan(1);
    expect(length(p.vel)).toBeCloseTo(3.5, 3);
  });

  it('steers only a little in the air', () => {
    const { sim, p } = onLawn();
    p.input.forward = 1;
    settle(sim, 20);
    p.input.jump = true;
    sim.step();
    p.input.jump = false;
    // Turn around mid-air: still going the way they jumped, only a bit slower.
    p.input.forward = -1;
    settle(sim, 20);
    expect(p.grounded).toBe(false);
    expect(p.vel.z).toBeLessThan(-2.5);
  });
});
