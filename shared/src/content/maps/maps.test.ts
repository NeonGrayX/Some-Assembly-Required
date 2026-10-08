import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUILDS } from '../../builds/catalog.ts';
import { DOG_HALF_HEIGHT, DOG_RADIUS } from '../../sim/dog.ts';
import { PLAYER_HALF_HEIGHT, PLAYER_RADIUS, Sim } from '../../sim/sim.ts';
import type { Player } from '../../sim/sim.ts';
import type { LevelDef } from '../house.ts';
import { rivalLevel } from '../rival.ts';
import { mapProblems, overlappingParts, unreachableHighSpots } from './common.ts';
import { MAPS, levelFor } from './index.ts';
import { merchantLayout, merchantProblems } from './merchant.ts';

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

const feetOf = (p: Player): number => p.body.translation().y - PLAYER_HALF_HEIGHT - PLAYER_RADIUS;

/** Walks the player in a straight line to `to`, jumping when it is a step too high to walk. */
function walkTo(sim: Sim, p: Player, to: { x: number; y: number; z: number }): void {
  for (let tick = 0; tick < 360; tick++) {
    const at = p.body.translation();
    const dx = to.x - at.x;
    const dz = to.z - at.z;
    if (Math.hypot(dx, dz) < 0.12) break;
    p.input.yaw = Math.atan2(-dx, -dz);
    p.input.forward = 1;
    p.input.jump = to.y - feetOf(p) > 0.25 && Math.hypot(dx, dz) < 1.0;
    sim.step();
  }
  p.input.forward = 0;
  p.input.jump = false;
  for (let i = 0; i < 20; i++) sim.step();
}

/** How far a point is from a box's footprint. */
const edgeGap = (
  b: { pos: { x: number; z: number }; size: { x: number; z: number } },
  at: { x: number; z: number },
) =>
  Math.hypot(
    Math.max(Math.abs(at.x - b.pos.x) - b.size.x / 2, 0),
    Math.max(Math.abs(at.z - b.pos.z) - b.size.z / 2, 0),
  );

describe('the Brick & Mortar map', () => {
  it(
    'has nothing running into anything, and every way in and page open',
    { timeout: 120000 },
    () => {
      for (let seed = 1; seed <= 12; seed++) {
        const level = merchantLayout(seed);
        expect(merchantProblems(level), `seed ${seed}`).toEqual([]);
        expect(overlappingParts(level), `seed ${seed}`).toEqual([]);
        expect(unreachableHighSpots(level), `seed ${seed}`).toEqual([]);
      }
    },
  );

  it('puts a header a door high over every doorway and shutter bay', () => {
    const level = merchantLayout(3);
    const heads = level.boxes.filter((b) => b.pos.y - b.size.y / 2 > 2 && b.size.y < 2);
    // Three bays, the hall's three doors, the office door and the dock office's.
    expect(heads.filter((b) => b.model === 'shutter')).toHaveLength(3);
    expect(
      heads.filter((b) => !b.model && b.size.y < 2 && b.pos.y < 4).length,
    ).toBeGreaterThanOrEqual(5);
    expect(level.doors?.filter((d) => d.finish === 'bare')).toHaveLength(3);
  });

  it('lets a player climb the ladder onto the roof and step off it', { timeout: 120000 }, () => {
    for (const seed of [1, 2, 3, 4]) {
      const level = merchantLayout(seed);
      const ladder = level.ladders[0]!;
      const sim = new Sim(RAPIER, level);
      const p = sim.addPlayer();
      for (let i = 0; i < 30; i++) sim.step();
      const standAt = { x: ladder.pos.x, z: ladder.pos.z - 0.45 };
      p.body.setTranslation(
        { x: standAt.x, y: PLAYER_HALF_HEIGHT + PLAYER_RADIUS + 0.02, z: standAt.z },
        true,
      );
      p.input.yaw = ladder.facing;
      p.input.forward = 1;
      for (let i = 0; i < 60 * 6; i++) sim.step();
      // At the top: walk on, onto the roof.
      p.input.yaw = ladder.facing;
      for (let i = 0; i < 90; i++) sim.step();
      p.input.forward = 0;
      for (let i = 0; i < 30; i++) sim.step();
      expect(p.grounded, `seed ${seed}`).toBe(true);
      expect(feetOf(p), `seed ${seed}`).toBeGreaterThan(4.1);
      expect(p.body.translation().z, `seed ${seed}`).toBeGreaterThan(5);
    }
  });

  it('lets a player climb the pallet stairs onto the rack', { timeout: 120000 }, () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const level = merchantLayout(seed);
      const stacks = new Map<string, { x: number; z: number; top: number }>();
      for (const b of level.boxes)
        if (b.model === 'pallet' && b.pos.z > 5) {
          const key = `${b.pos.x},${b.pos.z}`;
          const top = b.pos.y + b.size.y / 2;
          stacks.set(key, {
            x: b.pos.x,
            z: b.pos.z,
            top: Math.max(top, stacks.get(key)?.top ?? 0),
          });
        }
      const steps = [...stacks.values()].sort((a, b) => a.top - b.top);
      expect(steps, `seed ${seed}`).toHaveLength(4);
      // The rack beside the highest stack.
      const high = steps[3]!;
      const rack = level.boxes
        .filter((b) => b.model === 'rack')
        .sort((a, b) => edgeGap(a, high) - edgeGap(b, high))[0]!;
      const sim = new Sim(RAPIER, level);
      const p = sim.addPlayer();
      for (let i = 0; i < 30; i++) sim.step();
      const first = steps[0]!;
      const next = steps[1]!;
      const back = Math.hypot(next.x - first.x, next.z - first.z);
      const start = {
        x: first.x - ((next.x - first.x) / back) * 1.5,
        z: first.z - ((next.z - first.z) / back) * 1.5,
      };
      p.body.setTranslation(
        { x: start.x, y: PLAYER_HALF_HEIGHT + PLAYER_RADIUS + 0.02, z: start.z },
        true,
      );
      for (let i = 0; i < 30; i++) sim.step();
      for (const s of steps) walkTo(sim, p, { x: s.x, y: s.top, z: s.z });
      expect(feetOf(p), `seed ${seed}: on the highest stack`).toBeGreaterThan(1.0);
      // Onto the rack's end nearest the stairs: a hop up from the highest stack.
      const along = rack.size.z > rack.size.x ? { x: 0, z: 1 } : { x: 1, z: 0 };
      const half = Math.max(rack.size.x, rack.size.z) / 2;
      const toward = Math.sign((high.x - rack.pos.x) * along.x + (high.z - rack.pos.z) * along.z);
      walkTo(sim, p, {
        x: rack.pos.x + along.x * toward * (half - 0.4),
        y: rack.pos.y + rack.size.y / 2,
        z: rack.pos.z + along.z * toward * (half - 0.4),
      });
      expect(feetOf(p), `seed ${seed}: on the rack`).toBeGreaterThan(
        rack.pos.y + rack.size.y / 2 - 0.1,
      );
      for (let i = 0; i < 60; i++) sim.step();
      expect(p.grounded).toBe(true);
    }
  });
});
