import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUILDS } from '../../builds/catalog.ts';
import { DOG_HALF_HEIGHT, DOG_RADIUS } from '../../sim/dog.ts';
import { PLAYER_HALF_HEIGHT, PLAYER_RADIUS, Sim } from '../../sim/sim.ts';
import type { LevelDef } from '../house.ts';
import { rivalLevel } from '../rival.ts';
import { HOUSE } from '../house.ts';
import { mapProblems, meshOverlaps } from './common.ts';
import { MAPS, levelFor } from './index.ts';

beforeAll(async () => {
  await RAPIER.init();
});

/** Every link of the dog's network is clear for its body, and every point can be reached. */
function dogCanWalk(level: LevelDef): void {
  const shape = new RAPIER.Capsule(DOG_HALF_HEIGHT, DOG_RADIUS);
  const flags =
    RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC |
    RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC |
    RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
  const sim = new Sim(RAPIER, level);
  sim.step();
  const { points, links } = level.dog;
  expect(points.length).toBeGreaterThan(12);
  for (const [a, b] of links) {
    const [from, to] = [points[a]!, points[b]!];
    const steps = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.1);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const at = {
        x: from.x + (to.x - from.x) * t,
        y: 0.08 + DOG_RADIUS + DOG_HALF_HEIGHT,
        z: from.z + (to.z - from.z) * t,
      };
      const hit = sim.world.intersectionWithShape(at, { x: 0, y: 0, z: 0, w: 1 }, shape, flags);
      expect(hit, `link ${a}-${b} blocked`).toBeFalsy();
    }
  }
  const seen = new Set([level.dog.start]);
  const todo = [level.dog.start];
  while (todo.length) {
    const p = todo.pop()!;
    for (const [a, b] of links)
      for (const [u, v] of [
        [a, b],
        [b, a],
      ] as const)
        if (u === p && !seen.has(v)) {
          seen.add(v);
          todo.push(v);
        }
  }
  expect(seen.size).toBe(points.length);
}

const generated = MAPS.filter((m) => m.id !== 'house');

describe.each(generated)('the $name map', (map) => {
  it('is fit to play for every seed, and differs between seeds', { timeout: 60000 }, () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 8; seed++) {
      const level = map.layout(seed);
      expect(mapProblems(level), `seed ${seed}`).toEqual([]);
      seen.add(JSON.stringify([level.boxes.length, level.hideouts.map((h) => [h.kind, h.pos])]));
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(levelFor(map.id, null)).toBe(map.plain);
    expect(map.layout(3)).toBe(map.layout(3));
  });

  it('has a bin for every brick the builds use', { timeout: 60000 }, () => {
    const level = map.layout(2);
    const stocked = new Set(level.bins.map((b) => `${b.type}:${b.colour}`));
    for (const build of BUILDS)
      for (const b of build.steps.flatMap((s) => s.bricks))
        expect(stocked.has(`${b.type}:${b.colour}`), `${build.id} ${b.type} ${b.colour}`).toBe(
          true,
        );
  });

  it(
    'gives the dog clear walks everywhere, on its own and doubled for rival teams',
    { timeout: 60000 },
    () => {
      dogCanWalk(map.layout(4));
      const doubled = rivalLevel(map.layout(5));
      expect(mapProblems(doubled)).toEqual([]);
      dogCanWalk(doubled);
    },
  );
});

/**
 * A player climbs every ladder in the level and gets off at the top: standing on whatever the
 * ladder leans against, with their feet on it.
 */
function laddersReachTheirTops(level: LevelDef): void {
  const feet = PLAYER_HALF_HEIGHT + PLAYER_RADIUS;
  for (const l of level.ladders) {
    const at = `ladder at ${l.pos.x}, ${l.pos.z}`;
    const lean = { x: -Math.sin(l.facing), z: -Math.cos(l.facing) };
    // What it leans against: the top of the highest thing just past its plane.
    const probe = { x: l.pos.x + lean.x * 0.6, z: l.pos.z + lean.z * 0.6 };
    const top = Math.max(
      ...level.boxes
        .filter(
          (b) =>
            Math.abs(probe.x - b.pos.x) < b.size.x / 2 &&
            Math.abs(probe.z - b.pos.z) < b.size.z / 2,
        )
        .map((b) => b.pos.y + b.size.y / 2),
    );
    expect(top, `${at} leans on nothing`).toBeGreaterThan(l.pos.y + 0.5);
    const sim = new Sim(RAPIER, level);
    const p = sim.addPlayer();
    for (let t = 0; t < 30; t++) sim.step();
    // At its foot on the climbing side, facing it, and climbing.
    p.body.setTranslation(
      { x: l.pos.x - lean.x * 0.3, y: l.pos.y + feet + 0.02, z: l.pos.z - lean.z * 0.3 },
      true,
    );
    for (let t = 0; t < 2; t++) sim.step();
    p.input.yaw = l.facing;
    p.input.forward = 1;
    let highest = -Infinity;
    let q = p.body.translation();
    for (let t = 0; t < 6 * 60; t++) {
      sim.step();
      q = p.body.translation();
      highest = Math.max(highest, q.y);
      // Up the ladder, past its plane and standing: on the top, or fallen off the far side.
      const past = (q.x - l.pos.x) * lean.x + (q.z - l.pos.z) * lean.z;
      if (p.grounded && past > 0.6 && highest > l.pos.y + feet + 0.5) break;
    }
    expect(p.grounded, `${at}: not standing after the climb`).toBe(true);
    expect(
      Math.abs(q.y - feet - top),
      `${at}: not standing on its top (climbed to ${highest.toFixed(2)}, feet at ${(q.y - feet).toFixed(2)}, top ${top})`,
    ).toBeLessThan(0.08);
  }
}

describe('Platform 9', () => {
  it('has nothing cutting through anything else, for every seed', { timeout: 60000 }, () => {
    const map = MAPS.find((m) => m.id === 'station')!;
    for (let seed = 1; seed <= 8; seed++)
      expect(meshOverlaps(map.layout(seed)), `seed ${seed}`).toEqual([]);
  });

  it('has ladders a player can climb onto the top of', { timeout: 60000 }, () => {
    const map = MAPS.find((m) => m.id === 'station')!;
    laddersReachTheirTops(map.layout(1));
  });
});

describe('the house', () => {
  it('has a ladder a player can climb onto the roof from', { timeout: 60000 }, () => {
    laddersReachTheirTops(HOUSE);
  });
});
