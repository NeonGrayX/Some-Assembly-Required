import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { HOUSE } from '../content/house.ts';
import type { Vec3 } from '../math.ts';
import { DOWN_TICKS, EYE_OFFSET, Sim, assemblyMass } from './sim.ts';
import type { Assembly, Player } from './sim.ts';

beforeAll(async () => {
  await RAPIER.init();
});

const run = (sim: Sim, ticks: number) => {
  for (let i = 0; i < ticks; i++) sim.step();
};

/** A stack of 2x4 bricks, `count` high. */
const tower = (sim: Sim, count: number, at: Vec3): Assembly =>
  sim.spawnBuild(
    Array.from({ length: count }, (_, i) => ({
      type: '2x4' as const,
      colour: 'blue' as const,
      x: 0,
      y: i * 3,
      z: 0,
      rot: 0 as const,
    })),
    at,
  );

/** A player standing in an empty part of the yard, settled on the floor. */
function standing(sim: Sim, at = { x: 0, y: 0, z: -10 }): Player {
  const p = sim.addPlayer({ spawn: at });
  run(sim, 30);
  return p;
}

/** Points a first-person view at `target` and grabs it. */
function grab(sim: Sim, p: Player, target: Vec3) {
  const eye = sim.eye(p);
  p.input.firstPerson = true;
  p.input.yaw = Math.atan2(-(target.x - eye.x), -(target.z - eye.z));
  p.input.pitch = Math.atan2(target.y - eye.y, Math.hypot(target.x - eye.x, target.z - eye.z));
  sim.act(p.id, { kind: 'grab' });
}

describe('knock-downs', () => {
  it('knocks over a player hit by a heavy build, who then gets back up', () => {
    const sim = new Sim(RAPIER, HOUSE, 1);
    const p = standing(sim);
    const build = tower(sim, 6, { x: -0.2, y: 0.5, z: -12.5 });
    expect(assemblyMass(build)).toBeGreaterThan(5);
    build.body.setLinvel({ x: 0, y: 1, z: 7 }, true);
    for (let i = 0; i < 60 && p.down === 0; i++) sim.step();
    expect(p.knocks).toBe(1);
    expect(p.down).toBeGreaterThan(DOWN_TICKS - 10);
    expect(sim.events.some((e) => e.kind === 'trip' && e.playerId === p.id)).toBe(true);
    // The tower breaks up on impact; its pieces would land on the player lying there and trip
    // them again (or not, as the physics happens to fall), so take them away.
    sim.clearLoose();

    // Lying there: no grabbing, no walking off.
    // Off to the side, so getting up and walking on does not step on it.
    const loose = tower(sim, 1, { x: 1.4, y: 0, z: -10.5 });
    run(sim, 20);
    grab(sim, p, loose.body.worldCom());
    expect(p.holding).toBeNull();
    const before = p.body.translation();
    p.input.yaw = 0;
    p.input.forward = 1;
    run(sim, 30);
    expect(
      Math.hypot(p.body.translation().x - before.x, p.body.translation().z - before.z),
    ).toBeLessThan(0.3);

    run(sim, DOWN_TICKS);
    expect(p.down).toBe(0);
    const up = p.body.translation();
    run(sim, 30);
    expect(
      Math.hypot(p.body.translation().x - up.x, p.body.translation().z - up.z),
    ).toBeGreaterThan(1);
  });

  it('shrugs off a single thrown brick', () => {
    const sim = new Sim(RAPIER, HOUSE, 1);
    const p = standing(sim);
    const brick = tower(sim, 1, { x: 0, y: 1, z: -12 });
    brick.body.setLinvel({ x: 0, y: 1, z: 8 }, true);
    run(sim, 60);
    expect(p.knocks).toBe(0);
  });

  it('trips players who sprint with a heavy build in their arms, but not walkers', () => {
    const tripsAfter = (sprint: boolean) => {
      const sim = new Sim(RAPIER, HOUSE, 7);
      const p = standing(sim, { x: 0, y: 0, z: -2 });
      // A sturdy build in front of the player to carry along.
      const build = sim.spawnBuild(
        Array.from({ length: 12 }, (_, i) => ({
          type: '2x4' as const,
          colour: 'blue' as const,
          x: (i % 2) * 2,
          y: Math.floor(i / 2) * 3,
          z: 0,
          rot: 0 as const,
        })),
        { x: -0.2, y: 0.01, z: -3.4 },
      );
      run(sim, 30);
      grab(sim, p, build.body.worldCom());
      expect(p.holding?.assemblyId).toBe(build.id);
      p.input.firstPerson = false;
      p.input.pitch = 0;
      p.input.forward = 1;
      p.input.sprint = sprint;
      // Walk back and forth across the open yard for 12 s.
      for (let t = 0; t < 12 * 60 && p.knocks === 0; t++) {
        p.input.yaw = Math.floor(t / 90) % 2 ? Math.PI : 0;
        sim.step();
      }
      return { knocks: p.knocks, dropped: p.holding === null, mass: assemblyMass(build) };
    };
    const sprinting = tripsAfter(true);
    expect(sprinting.mass).toBeGreaterThan(10);
    expect(sprinting.knocks).toBe(1);
    expect(sprinting.dropped).toBe(true);
    expect(tripsAfter(false).knocks).toBe(0);
  });

  it('knocks over a player who jumps off the roof, but not one who jumps on the spot', () => {
    const sim = new Sim(RAPIER, HOUSE, 1);
    const p = standing(sim);
    p.input.jump = true;
    run(sim, 5);
    p.input.jump = false;
    run(sim, 90);
    expect(p.knocks).toBe(0);
    sim.teleportPlayer(p, { x: 0, y: 3.6, z: -10 });
    run(sim, 90);
    expect(p.knocks).toBe(1);
    expect(sim.eye(p).y).toBeCloseTo(0.85 + EYE_OFFSET, 1);
  });
});
