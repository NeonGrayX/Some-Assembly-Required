import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { realPage } from '../builds/forgery.ts';
import { LIGHTHOUSE } from '../builds/lighthouse.ts';
import { HOUSE } from '../content/house.ts';
import { length, sub, v3 } from '../math.ts';
import type { Vec3 } from '../math.ts';
import { DOG_HALF_HEIGHT, DOG_ID, DOG_RADIUS } from './dog.ts';
import { Sim } from './sim.ts';
import type { Player } from './sim.ts';

beforeAll(async () => {
  await RAPIER.init();
});

const run = (sim: Sim, ticks: number) => {
  for (let i = 0; i < ticks; i++) sim.step();
};
const flatDist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);

/** Points a first-person view at `target` from where the player stands and clicks. */
function clickOn(sim: Sim, p: Player, target: Vec3) {
  const eye = sim.eye(p);
  p.input.firstPerson = true;
  p.input.yaw = Math.atan2(-(target.x - eye.x), -(target.z - eye.z));
  p.input.pitch = Math.atan2(target.y - eye.y, Math.hypot(target.x - eye.x, target.z - eye.z));
  sim.act(p.id, { kind: 'grab' });
}

/** A player standing still somewhere out of the dog's way. */
const bystander = (sim: Sim, at = { x: 14, y: 0, z: -14 }) => sim.addPlayer({ spawn: at });

describe('the dog', () => {
  it('only walks where nothing is in the way', () => {
    const sim = new Sim(RAPIER, HOUSE);
    run(sim, 1);
    const shape = new RAPIER.Capsule(DOG_HALF_HEIGHT, DOG_RADIUS);
    const flags =
      RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC |
      RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC |
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    for (const [a, b] of HOUSE.dog.links) {
      const from = HOUSE.dog.points[a]!;
      const to = HOUSE.dog.points[b]!;
      const steps = Math.ceil(flatDist(from, to) / 0.1);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        // Lifted a little, so it does not count the floor and the rugs.
        const at = v3(
          from.x + (to.x - from.x) * t,
          0.08 + DOG_RADIUS + DOG_HALF_HEIGHT,
          from.z + (to.z - from.z) * t,
        );
        const hit = sim.world.intersectionWithShape(at, { x: 0, y: 0, z: 0, w: 1 }, shape, flags);
        expect(hit, `link ${a}-${b} blocked at ${at.x.toFixed(2)}, ${at.z.toFixed(2)}`).toBeFalsy();
      }
    }
  });

  it('wanders around the house and yard', () => {
    const sim = new Sim(RAPIER, HOUSE, 5);
    bystander(sim);
    const seen: Vec3[] = [];
    for (let s = 0; s < 90; s++) {
      run(sim, 60);
      seen.push(sim.dog.feet);
    }
    const spread = Math.max(...seen.map((p) => flatDist(p, seen[0]!)));
    expect(spread).toBeGreaterThan(5);
    // Always on the floor, inside the world.
    for (const p of seen) expect(Math.abs(p.y)).toBeLessThan(0.1);
  });

  it('picks up a page left on the floor, carries it off and drops it later', () => {
    const sim = new Sim(RAPIER, HOUSE, 2);
    bystander(sim);
    run(sim, 10 * 60); // its first lookout for pages starts after a while
    const at = sim.dog.feet;
    const page = sim.spawnPage(realPage(LIGHTHOUSE, 2, '★'), { x: at.x + 1, y: 0, z: at.z });
    for (let t = 0; t < 20 * 60 && page.carriedBy !== DOG_ID; t++) sim.step();
    expect(page.carriedBy).toBe(DOG_ID);
    expect(sim.dog.page).toBe(page.id);
    expect(page.body).toBeNull();
    for (let t = 0; t < 90 * 60 && page.carriedBy === DOG_ID; t++) sim.step();
    expect(page.carriedBy).toBeNull();
    expect(page.body).not.toBeNull();
    expect(sim.dog.page).toBeNull();
  });

  it('drops its page when someone grabs its collar, and runs from sprinters', () => {
    const sim = new Sim(RAPIER, HOUSE, 2);
    const p = bystander(sim);
    run(sim, 10 * 60);
    const at = sim.dog.feet;
    const page = sim.spawnPage(realPage(LIGHTHOUSE, 2, '★'), { x: at.x + 1, y: 0, z: at.z });
    for (let t = 0; t < 20 * 60 && sim.dog.page === null; t++) sim.step();
    expect(sim.dog.page).toBe(page.id);

    // Sneak up (walking) and grab it.
    const dog = sim.dog.body.translation();
    sim.teleportPlayer(p, { x: dog.x, y: 0, z: dog.z + 1.6 });
    run(sim, 2);
    clickOn(sim, p, sim.dog.body.translation());
    expect(sim.dog.page).toBeNull();
    expect(page.carriedBy).toBeNull();
    expect(page.body).not.toBeNull();
    expect(sim.events.some((e) => e.kind === 'yelp')).toBe(true);

    // Sprinting at it sends it running.
    run(sim, 3 * 60);
    const d = sim.dog.body.translation();
    sim.teleportPlayer(p, { x: d.x, y: 0, z: d.z + 2.5 });
    Object.assign(p.input, { yaw: 0, pitch: 0, forward: 1, sprint: true });
    run(sim, 5);
    expect(sim.dog.mode).toBe('run');
  });

  it('begs for a treat from the jar, and follows whoever feeds it', () => {
    const sim = new Sim(RAPIER, HOUSE, 3);
    const p = sim.addPlayer({ spawn: { x: -6.8, y: 0, z: 13.4 } });
    run(sim, 30);
    clickOn(sim, p, { ...HOUSE.dog.treatJar, y: HOUSE.dog.treatJar.y + 0.09 });
    expect(p.treat).toBe(true);

    // It comes over and sits in front of the player.
    for (let t = 0; t < 30 * 60 && flatDist(sim.dog.feet, p.body.translation()) > 1.1; t++) {
      sim.step();
    }
    run(sim, 60);
    expect(sim.dog.mode).toBe('beg');
    expect(flatDist(sim.dog.feet, p.body.translation())).toBeLessThan(1.1);

    clickOn(sim, p, sim.dog.body.translation());
    expect(p.treat).toBe(false);
    expect(sim.events.some((e) => e.kind === 'crunch')).toBe(true);
    run(sim, 2);
    expect(sim.dog.mode).toBe('follow');

    // It tags along when the player walks off.
    Object.assign(p.input, { yaw: Math.PI / 2, pitch: 0, forward: 1 });
    run(sim, 90);
    p.input.forward = 0;
    run(sim, 3 * 60);
    expect(length(sub(sim.dog.feet, p.body.translation()))).toBeLessThan(2.5);
  });
});
