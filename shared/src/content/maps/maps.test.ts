import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUILDS } from '../../builds/catalog.ts';
import { IDENTITY, v3, yawQuat } from '../../math.ts';
import { DOG_HALF_HEIGHT, DOG_RADIUS } from '../../sim/dog.ts';
import { PLAYER_HALF_HEIGHT, PLAYER_RADIUS, Sim } from '../../sim/sim.ts';
import { BIN_SIZE, BOARD_SIZE } from '../house.ts';
import type { LevelDef } from '../house.ts';
import { boxesOverlap, hideoutBody, hideoutPartInWorld, inWorld } from '../hideouts.ts';
import type { PartPose } from '../hideouts.ts';
import { rivalLevel } from '../rival.ts';
import { HOUSE } from '../house.ts';
import { mapProblems } from './common.ts';
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

/**
 * A player climbs every ladder from its foot and comes out standing on whatever it reaches,
 * then walks on from there. Standing at the foot facing the ladder and pressing forward is all
 * it takes: nothing has to stop them behind the ladder.
 */
function laddersClimb(level: LevelDef): void {
  const run = (sim: Sim, ticks: number) => {
    for (let i = 0; i < ticks; i++) sim.step();
  };
  for (const l of level.ladders) {
    const sim = new Sim(RAPIER, level);
    const p = sim.addPlayer();
    // A step back from the foot, on the side it is climbed from.
    const back = { x: Math.sin(l.facing) * 0.25, z: Math.cos(l.facing) * 0.25 };
    p.body.setTranslation(
      {
        x: l.pos.x + back.x,
        y: l.pos.y + PLAYER_HALF_HEIGHT + PLAYER_RADIUS + 0.01,
        z: l.pos.z + back.z,
      },
      true,
    );
    run(sim, 20);
    p.input.yaw = l.facing;
    p.input.forward = 1;
    run(sim, 200);
    p.input.forward = 0;
    run(sim, 40);
    const name = `ladder at ${l.pos.x}, ${l.pos.z}`;
    // Standing, with their feet about where the ladder ends.
    expect(p.grounded, `${name}: standing at the top`).toBe(true);
    const feet = p.body.translation().y - PLAYER_HALF_HEIGHT - PLAYER_RADIUS;
    expect(feet, `${name}: up on top`).toBeGreaterThan(l.height - 1.3);
    // And still up there after walking on.
    p.input.forward = 1;
    run(sim, 40);
    expect(
      p.body.translation().y - PLAYER_HALF_HEIGHT - PLAYER_RADIUS,
      `${name}: walked on`,
    ).toBeGreaterThan(l.height - 1.3);
  }
}

/**
 * Every solid thing in a level as a box in the world: the boxes, bins, hiding places (body and
 * shut moving part), the corkboard and the ladders, each with a name for the failure message.
 */
function solids(level: LevelDef): { name: string; pose: PartPose }[] {
  const out: { name: string; pose: PartPose }[] = [];
  level.boxes.forEach((b, i) => {
    if (b.tiltX) return;
    out.push({
      name: `box ${i} (${b.model ?? 'plain'} at ${b.pos.x}, ${b.pos.y}, ${b.pos.z})`,
      pose: { centre: b.pos, half: v3(b.size.x / 2, b.size.y / 2, b.size.z / 2), rot: IDENTITY },
    });
  });
  for (const h of level.hideouts) {
    // A drawer sits in its counter by design; a door or lid shut on its body touches it.
    if (h.kind === 'drawer') continue;
    const body = hideoutBody(h);
    if (body) out.push({ name: `${h.kind} ${h.id} body`, pose: inWorld(h, body) });
    out.push({ name: `${h.kind} ${h.id} part`, pose: hideoutPartInWorld(h, false) });
  }
  for (const b of level.bins)
    out.push({
      name: `bin ${b.id}`,
      pose: {
        centre: v3(b.pos.x, b.pos.y + BIN_SIZE.y / 2, b.pos.z),
        half: v3(BIN_SIZE.x / 2, BIN_SIZE.y / 2, BIN_SIZE.z / 2),
        rot: IDENTITY,
      },
    });
  out.push({
    name: 'corkboard',
    pose: {
      centre: level.board.pos,
      half: v3(BOARD_SIZE.x / 2, BOARD_SIZE.y / 2, BOARD_SIZE.z / 2),
      rot: yawQuat(level.board.facing),
    },
  });
  for (const l of level.ladders)
    out.push({
      name: `ladder at ${l.pos.x}, ${l.pos.z}`,
      pose: {
        centre: v3(l.pos.x, l.pos.y + l.height / 2, l.pos.z),
        half: v3(l.width / 2, l.height / 2, 0.03),
        rot: yawQuat(l.facing),
      },
    });
  return out;
}

/** Pairs of solid things that pass through each other (touching does not count). */
function overlapping(level: LevelDef): string[] {
  const all = solids(level);
  const out: string[] = [];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]!;
      const b = all[j]!;
      // A hiding place's own shut door or lid sits on its body.
      if (a.name.endsWith(' body') && b.name === a.name.replace(/ body$/, ' part')) continue;
      if (boxesOverlap(a.pose, b.pose, 0.01)) out.push(`${a.name} <-> ${b.name}`);
    }
  return out;
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

  it('has ladders a player climbs to the top of and steps off', { timeout: 60000 }, () => {
    laddersClimb(map.layout(1));
    expect(map.layout(1).ladders.length).toBeGreaterThan(0);
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

describe('the Lakeside Camp map', () => {
  const camp = MAPS.find((m) => m.id === 'camp')!;

  it('has nothing standing in anything else, for every seed', () => {
    for (let seed = 1; seed <= 8; seed++)
      expect(overlapping(camp.layout(seed)), `seed ${seed}`).toEqual([]);
  });

  it('keeps its high places where a player can stand under the boughs and up the ladders', () => {
    const level = camp.layout(1);
    // The treehouse deck and the lifeguard tower each have a railed deck and a ladder.
    expect(level.ladders).toHaveLength(2);
    const decks = level.boxes.filter((b) => b.model === 'deck' && b.pos.y > 2.5);
    expect(decks.length).toBeGreaterThanOrEqual(5);
    // A page up on each, which only climbing reaches.
    expect(level.pageSpots.filter((p) => p.y > 3)).toHaveLength(2);
    // Every pitch holds a tent (with its cool box) or a caravan (with a cupboard and a cushion).
    const tents = level.hideouts.filter((h) => h.kind === 'tent').length;
    const caravans = level.hideouts.filter((h) => h.kind === 'cabinet').length;
    expect(tents + caravans).toBe(5);
    expect(level.hideouts.filter((h) => h.kind === 'coolbox')).toHaveLength(tents);
    // Caravans are rooms: a floor, a lamp and windows each.
    expect(level.windows!.length).toBe(2 + caravans * 4);
  });
});

describe('the Platform 9 map', () => {
  const station = MAPS.find((m) => m.id === 'station')!;

  it('has nothing standing in anything else, for every seed', () => {
    for (let seed = 1; seed <= 8; seed++)
      expect(overlapping(station.layout(seed)), `seed ${seed}`).toEqual([]);
  });
});

describe('the house', () => {
  it('has a ladder a player climbs onto the roof from', { timeout: 60000 }, () => {
    laddersClimb(HOUSE);
  });
});
