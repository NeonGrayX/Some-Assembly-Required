import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUILDS } from '../../builds/catalog.ts';
import { binColours } from '../../builds/variant.ts';
import { IDENTITY, v3, yawQuat } from '../../math.ts';
import { DOG_HALF_HEIGHT, DOG_RADIUS } from '../../sim/dog.ts';
import { PLAYER_HALF_HEIGHT, PLAYER_RADIUS, Sim } from '../../sim/sim.ts';
import type { Player } from '../../sim/sim.ts';
import { BOARD_SIZE, HOUSE, isTrashBin, machinePose, levelSites, siteBoards } from '../house.ts';
import { Round } from '../../round.ts';
import { NavGrid } from '../../bots/nav.ts';
import type { TargetBuild } from '../../builds/types.ts';
import type { BoxDef, LevelDef } from '../house.ts';
import { boxesOverlap, hideoutBody, hideoutPartInWorld, inWorld } from '../hideouts.ts';
import { groundHeight, groundSlope, groundSpan, terrainRect } from '../terrain.ts';
import type { PartPose } from '../hideouts.ts';
import { RIVAL_ID_OFFSET, rivalLevel } from '../rival.ts';
import {
  LADDER_CLEAR,
  grow,
  inRect,
  mapProblems,
  overlappingParts,
  unreachableHighSpots,
  walkableGround,
} from './common.ts';
import { MAPS, levelFor } from './index.ts';
import {
  ISLAND_HALF,
  LANTERN_POST,
  PILING_EVERY,
  PILING_IN,
  PILING_TOP,
  SEA,
  SHIP,
  STUMP_TOP,
} from './island.ts';
import { merchantLayout, merchantProblems } from './merchant.ts';

/** The longest manual a build file can have: 32 one-brick pages. */
const LONGEST: TargetBuild = {
  id: 'longest',
  name: 'Longest',
  steps: Array.from({ length: 32 }, (_, i) => ({
    bricks: [
      {
        type: '1x1' as const,
        colour: 'yellow' as const,
        x: 7 + Math.floor(i / 16),
        y: 1 + 3 * (i % 16),
        z: 7,
        rot: 0 as const,
      },
    ],
  })),
};

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
  // A track's bed and its rails are each a step up, which the dog takes: over them it walks
  // that much higher.
  const steps = level.boxes.filter((b) => b.model === 'ballast' || b.model === 'trackRail');
  const under = (x: number, z: number) =>
    Math.max(
      groundHeight(level, x, z),
      ...steps
        .filter(
          (b) =>
            Math.abs(x - b.pos.x) < b.size.x / 2 + DOG_RADIUS &&
            Math.abs(z - b.pos.z) < b.size.z / 2 + DOG_RADIUS,
        )
        .map((b) => b.pos.y + b.size.y / 2),
    );
  for (const [a, b] of links) {
    const [from, to] = [points[a]!, points[b]!];
    const steps = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.1);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t;
      const z = from.z + (to.z - from.z) * t;
      const at = { x, y: under(x, z) + 0.08 + DOG_RADIUS + DOG_HALF_HEIGHT, z };
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
    expect(feet, `${name}: up on top`).toBeGreaterThan(l.pos.y + l.height - 1.3);
    // And still up there after walking on.
    p.input.forward = 1;
    run(sim, 40);
    expect(
      p.body.translation().y - PLAYER_HALF_HEIGHT - PLAYER_RADIUS,
      `${name}: walked on`,
    ).toBeGreaterThan(l.pos.y + l.height - 1.3);
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
  for (const m of level.machines) out.push({ name: `${m.kind} ${m.id}`, pose: machinePose(m) });
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

describe.each(MAPS)('the $name map', (map) => {
  it('has two corkboards and the brick works, its machines apart and not in a row', () => {
    for (const level of [map.layout(3), rivalLevel(map.layout(3))]) {
      for (const site of levelSites(level)) expect(siteBoards(site)).toHaveLength(2);
      const sites = levelSites(level).length;
      expect(level.machines.map((m) => m.kind).sort()).toEqual(
        ['dispenser', 'press', 'press', 'printer', 'silo'].flatMap((k) =>
          Array<string>(sites).fill(k),
        ),
      );
      const ids = new Set(level.machines.map((m) => m.id % RIVAL_ID_OFFSET));
      expect([...ids].sort((a, b) => a - b)).toEqual(HOUSE.machines.map((m) => m.id).sort());
      // Not all along one line: some stand turned another way, or out of line with the rest.
      for (let side = 0; side < sites; side++) {
        const own = level.machines.filter((m) => Math.floor(m.id / RIVAL_ID_OFFSET) === side);
        const facings = new Set(own.map((m) => Math.round(m.facing / (Math.PI / 2)) & 3));
        expect(facings.size, 'facing ways').toBeGreaterThan(1);
      }
    }
  });

  it('has room for every page of a 32-page manual and the gear', { timeout: 60000 }, () => {
    for (const [seed, rival] of [
      [1, false],
      [2, false],
      [3, true],
    ] as const)
      for (const mode of ['saboteur', 'gear'] as const) {
        const base = map.layout(seed);
        const level = rival ? rivalLevel(base) : base;
        const sim = new Sim(RAPIER, level, seed, { bell: mode !== 'gear' });
        new Round(sim, LONGEST, { seconds: 60, seed, mode });
        // Every step and the index, on each side.
        const sides = rival ? 2 : 1;
        expect(sim.pages.size).toBe(sides * (32 + 1));
      }
  });

  it('is fit to play for every seed, and differs between seeds', { timeout: 60000 }, () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 8; seed++) {
      const level = map.layout(seed);
      expect(mapProblems(level), `seed ${seed}`).toEqual([]);
      expect(mapProblems(map.plain), 'without a seed').toEqual([]);
      seen.add(JSON.stringify([level.boxes.length, level.hideouts.map((h) => [h.kind, h.pos])]));
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(levelFor(map.id, null)).toBe(map.plain);
    expect(map.layout(3)).toBe(map.layout(3));
  });

  it('makes every brick the builds use', { timeout: 60000 }, () => {
    const makes = binColours(map.layout(2));
    for (const build of BUILDS)
      for (const b of build.steps.flatMap((s) => s.bricks))
        expect(makes.get(b.type)?.has(b.colour), `${build.id} ${b.type} ${b.colour}`).toBe(true);
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

describe('the Cutlass Cove map', () => {
  const island = MAPS.find((m) => m.id === 'island')!;

  it('has nothing standing in anything else, for every seed', () => {
    for (let seed = 1; seed <= 8; seed++)
      expect(overlapping(island.layout(seed)), `seed ${seed}`).toEqual([]);
  });

  it('has hardly any flat ground but what its buildings and decks stand on', () => {
    for (const seed of [1, 4]) {
      const level = island.layout(seed);
      const t = level.terrain![0]!;
      const r = terrainRect(t);
      const under = (x: number, z: number) =>
        level.boxes.some(
          (b) => Math.abs(x - b.pos.x) <= b.size.x / 2 && Math.abs(z - b.pos.z) <= b.size.z / 2,
        );
      let land = 0;
      let flat = 0;
      for (let x = r.x0 + 0.25; x < r.x1; x += 0.5)
        for (let z = r.z0 + 0.25; z < r.z1; z += 0.5) {
          if (groundHeight(level, x, z) < 0.05) continue;
          land++;
          // Flatter than 2°, with nothing standing on it.
          if (groundSlope(level, x, z) < 0.035 && !under(x, z)) flat++;
        }
      expect(land).toBeGreaterThan(2000);
      expect(flat / land, `seed ${seed}`).toBeLessThan(0.06);
    }
  });

  it('keeps everyone in with walls nobody sees, mooring posts in the sea marking them', () => {
    for (const seed of [1, 4]) {
      const level = island.layout(seed);
      const half = ISLAND_HALF;
      const edges = level.boxes.filter(
        (b) =>
          Math.max(Math.abs(b.pos.x) + b.size.x / 2, Math.abs(b.pos.z) + b.size.z / 2) >
          half - 0.01,
      );
      // Nothing drawn at the edge, and the south wall is the one rival teams' wall is made from.
      for (const b of edges) expect(b.model, `seed ${seed}`).toBe('collider');
      expect(edges.find((b) => b.role === 'southFence')?.pos.z).toBeLessThan(-half + 0.5);
      // Closed all round, from under the ground to well over a jump from it.
      for (let t = -half + 0.05; t < half; t += 0.25)
        for (const [x, z] of [
          [t, -half + 0.1],
          [t, half - 0.1],
          [-half + 0.1, t],
          [half - 0.1, t],
        ] as const) {
          const g = groundHeight(level, x, z);
          const wall = edges.some(
            (b) =>
              Math.abs(x - b.pos.x) <= b.size.x / 2 &&
              Math.abs(z - b.pos.z) <= b.size.z / 2 &&
              b.pos.y - b.size.y / 2 < g &&
              b.pos.y + b.size.y / 2 > g + 2,
          );
          expect(wall, `seed ${seed}: the edge at ${x}, ${z}`).toBe(true);
        }
      // Posts out in the sea in a ragged line round it, in from the walls, their feet in the
      // sea bed and their tops a little over a metre over the sea, or broken off just over it.
      const posts = level.boxes.filter((b) => b.model === 'piling');
      expect(posts.length).toBeGreaterThan(36);
      const insets: number[] = [];
      let lashed = 0;
      let stumps = 0;
      for (const p of posts) {
        const r = { x0: p.pos.x - p.size.x / 2, x1: p.pos.x + p.size.x / 2 };
        const under = groundSpan(level, {
          ...r,
          z0: p.pos.z - p.size.z / 2,
          z1: p.pos.z + p.size.z / 2,
        });
        const name = `post at ${p.pos.x}, ${p.pos.z}`;
        expect(under.max, name).toBeLessThan(SEA - 0.1);
        expect(p.pos.y - p.size.y / 2, name).toBeLessThan(under.min);
        const top = p.pos.y + p.size.y / 2 - SEA;
        const stump = top < 1;
        if (stump) stumps++;
        const tops = stump ? STUMP_TOP : PILING_TOP;
        expect(top, name).toBeGreaterThanOrEqual(tops.least - 0.01);
        expect(top, name).toBeLessThanOrEqual(tops.least + tops.more + 0.01);
        // In from the edge by half a metre to two and a half (a little more for one lashed in
        // behind others), clear of the wall there.
        const out = Math.max(Math.abs(p.pos.x), Math.abs(p.pos.z)) + p.size.x / 2;
        insets.push(half - out);
        expect(out, name).toBeLessThanOrEqual(half - PILING_IN.least + 1e-6);
        expect(out, name).toBeGreaterThan(half - PILING_IN.least - PILING_IN.more - 0.5);
        // The next one along a few metres off (or lashed to it), unless the land or the ship
        // comes between; none standing in another.
        const gaps = posts
          .filter((q) => q !== p)
          .map((q) => Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z));
        const next = Math.min(...gaps);
        expect(next, name).toBeGreaterThan(Math.max(p.size.x, 0.4));
        expect(next, name).toBeLessThan(PILING_EVERY.least + PILING_EVERY.more + 0.5);
        if (next < 0.8) lashed++;
        else expect(next, name).toBeGreaterThan(1.5);
      }
      // Not a neat square seen from above: how far in they stand varies by metres, some are
      // lashed together in twos and threes and some are stumps.
      expect(Math.max(...insets) - Math.min(...insets)).toBeGreaterThan(1.5);
      const mean = insets.reduce((a, b) => a + b, 0) / insets.length;
      const spread = Math.sqrt(insets.reduce((a, b) => a + (b - mean) ** 2, 0) / insets.length);
      expect(spread).toBeGreaterThan(0.4);
      expect(lashed).toBeGreaterThanOrEqual(6);
      expect(stumps).toBeGreaterThanOrEqual(2);
      expect(stumps).toBeLessThan(posts.length / 5);
      // All four sides have them, and their heights differ.
      const band = PILING_IN.least + PILING_IN.more + 1;
      for (const side of [
        (b: (typeof posts)[number]) => b.pos.z < -half + band,
        (b: (typeof posts)[number]) => b.pos.z > half - band,
        (b: (typeof posts)[number]) => b.pos.x < -half + band,
        (b: (typeof posts)[number]) => b.pos.x > half - band,
      ])
        expect(posts.filter(side).length).toBeGreaterThan(6);
      expect(new Set(posts.map((p) => p.pos.y + p.size.y / 2)).size).toBeGreaterThan(20);
    }
  });

  it('lets a player through the gap in rival teams’ wall, which nobody sees', () => {
    const level = rivalLevel(island.layout(2));
    const wall = level.boxes.filter((b) => Math.abs(b.pos.z - level.divide!.z) < 0.01);
    expect(wall).toHaveLength(2);
    for (const w of wall) expect(w.model).toBe('collider');
    // Nothing runs into anything on either island, nor into the wall.
    expect(overlapping(level)).toEqual([]);
    // Through both gates and the gap between them, from one spit to the other.
    const sim = new Sim(RAPIER, level);
    const p = sim.addPlayer();
    const start = { x: 0.2, z: -18.6 };
    p.body.setTranslation(
      {
        x: start.x,
        y: groundHeight(level, start.x, start.z) + PLAYER_HALF_HEIGHT + PLAYER_RADIUS + 0.05,
        z: start.z,
      },
      true,
    );
    for (let i = 0; i < 20; i++) sim.step();
    walkTo(sim, p, { x: 0.2, y: groundHeight(level, 0.2, -23.4), z: -23.4 });
    expect(p.body.translation().z).toBeLessThan(-23);
  });

  it('has great rocks on the hills and by the cove, clear of every way about', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const level = island.layout(seed);
      const rocks = level.boxes.filter(
        (b) => b.model === 'boulder' && Math.max(b.size.x, b.size.y, b.size.z) >= 3,
      );
      expect(rocks.length, `seed ${seed}`).toBeGreaterThanOrEqual(4);
      expect(rocks.length, `seed ${seed}`).toBeLessThanOrEqual(6);
      const spots = [
        ...level.pageSpots,
        ...level.hideouts.map((h) => h.pos),
        ...level.ladders.map((l) => l.pos),
        ...level.machines.map((m) => m.pos),
        ...level.meetingSeats,
        ...level.dog.points,
        ...level.boxes.filter(isTrashBin).map((b) => b.pos),
        level.board.pos,
        ...(level.moreBoards ?? []).map((b) => b.pos),
        level.inspector.pos,
        level.doneButton,
        level.bell,
        level.dog.treatJar,
        level.spawn,
      ];
      for (const r of rocks) {
        const name = `seed ${seed}: rock at ${r.pos.x}, ${r.pos.z}`;
        const foot = {
          x0: r.pos.x - r.size.x / 2,
          x1: r.pos.x + r.size.x / 2,
          z0: r.pos.z - r.size.z / 2,
          z1: r.pos.z + r.size.z / 2,
        };
        // Sunk well into the ground, under its lowest side too.
        expect(r.pos.y - r.size.y / 2, name).toBeLessThan(groundSpan(level, foot).min - 0.4);
        for (const s of spots)
          expect(edgeGap(r, s), `${name} by ${s.x}, ${s.z}`).toBeGreaterThan(0.6);
      }
    }
  });

  it('builds the tavern and the hut two storeys high, their roofs on top', () => {
    for (const seed of [1, 5]) {
      const level = island.layout(seed);
      const storeys = level.boxes.filter((b) => b.model === 'storey');
      expect(storeys).toHaveLength(2);
      expect(level.interiors).toHaveLength(2);
      for (const room of level.interiors) {
        // Over the room's walls (its rect is out to their outer faces), jutting a little past them.
        const s = storeys.find(
          (b) => Math.abs(b.pos.x - (room.rect.x0 + room.rect.x1) / 2) < 0.01,
        )!;
        expect(s, `seed ${seed}`).toBeDefined();
        expect(s.pos.y - s.size.y / 2).toBeCloseTo(room.y1, 5);
        expect(s.size.y).toBeGreaterThanOrEqual(1.8);
        for (const jut of [
          s.size.x / 2 - (room.rect.x1 - room.rect.x0) / 2,
          s.size.z / 2 - (room.rect.z1 - room.rect.z0) / 2,
        ]) {
          expect(jut).toBeGreaterThanOrEqual(0.2 - 1e-6);
          expect(jut).toBeLessThanOrEqual(0.25 + 1e-6);
        }
        // The roof on top, out over it.
        const roof = level.boxes.find(
          (b) =>
            b.model === 'gableRoof' &&
            Math.abs(b.pos.x - s.pos.x) < 0.01 &&
            Math.abs(b.pos.z - s.pos.z) < 0.01,
        )!;
        expect(roof.pos.y - roof.size.y / 2).toBeCloseTo(s.pos.y + s.size.y / 2, 5);
        expect(roof.size.x).toBeGreaterThan(s.size.x);
        expect(roof.size.z).toBeGreaterThan(s.size.z);
        // Its front the way the doorway below looks (where the wall over it is).
        const header = level.boxes.find(
          (b) =>
            !b.model &&
            !b.role &&
            Math.abs(b.pos.y + b.size.y / 2 - room.y1) < 0.01 &&
            b.size.y < 1 &&
            Math.abs(b.pos.x - s.pos.x) <= (room.rect.x1 - room.rect.x0) / 2 &&
            Math.abs(b.pos.z - s.pos.z) <= (room.rect.z1 - room.rect.z0) / 2,
        )!;
        expect(header, `seed ${seed}`).toBeDefined();
        const way = { x: header.pos.x - s.pos.x, z: header.pos.z - s.pos.z };
        const front = { '-z': [0, -1], '+z': [0, 1], '-x': [-1, 0], '+x': [1, 0] }[s.front!];
        expect(way.x * front[0]! + way.z * front[1]!, `seed ${seed}`).toBeGreaterThan(1);
      }
      // The porch's roof stays under the tavern's jetty, its boards seen from below.
      const porch = level.boxes.find(
        (b) =>
          b.model === 'deck' &&
          b.pos.y > level.inspector.pos.y + 2 &&
          Math.abs(b.pos.z - level.inspector.pos.z) < 3 &&
          Math.abs(b.pos.x - level.inspector.pos.x) < 1.5,
      )!;
      expect(porch, `seed ${seed}`).toBeDefined();
      expect(porch.surface).toBeUndefined();
      const tavern = storeys.reduce((a, b) =>
        Math.abs(a.pos.x - porch.pos.x) < Math.abs(b.pos.x - porch.pos.x) ? a : b,
      );
      expect(porch.pos.y + porch.size.y / 2).toBeLessThanOrEqual(
        tavern.pos.y - tavern.size.y / 2 + 1e-6,
      );
    }
  });

  it(
    'lets bots get to every ladder, page, bin, hiding place, machine and corkboard',
    { timeout: 60000 },
    () => {
      // The ship on either beach, and doubled.
      const west = island.layout(shipSeeds().west);
      for (const level of [island.layout(1), west, rivalLevel(island.layout(6))]) {
        const sim = new Sim(RAPIER, level);
        sim.step();
        const nav = new NavGrid(RAPIER, sim);
        expect(nav.ladders).toHaveLength(level.ladders.length);
        for (const l of nav.ladders)
          expect(nav.reachable(l.foot) && nav.reachable(l.top)).toBe(true);
        const near = (name: string, p: { x: number; y: number; z: number }, r: number) =>
          expect(
            nav.around(p, r, 2, 0.6).some((n) => nav.reachable(n)),
            `${name} at ${p.x}, ${p.y}, ${p.z}`,
          ).toBe(true);
        level.pageSpots.forEach((p, i) => near(`page spot ${i}`, p, 1.5));
        for (const b of level.boxes.filter(isTrashBin))
          near('bin', { ...b.pos, y: b.pos.y - b.size.y / 2 }, 1.2);
        for (const h of level.hideouts) near(`${h.kind} ${h.id}`, h.pos, 1.6);
        for (const m of level.machines) near(`${m.kind} ${m.id}`, m.pos, 2.2);
        near('corkboard', { ...level.board.pos, y: level.board.pos.y - 1.3 }, 1.6);
      }
    },
  );

  /** A seed whose ship lies on the east beach, and one whose ship lies on the west. */
  const shipSeeds = () => {
    const sides = Array.from({ length: 16 }, (_, i) => i + 1).map((seed) => ({
      seed,
      x: island.layout(seed).boxes.find((b) => b.model === 'hull')!.pos.x,
    }));
    return {
      east: sides.find((s) => s.x > 0)!.seed,
      west: sides.find((s) => s.x < 0)!.seed,
    };
  };
  const frontWay = { '-z': [0, -1], '+z': [0, 1], '-x': [-1, 0], '+x': [1, 0] } as const;

  it('hangs its lanterns from timber posts out over open ground, none by a door', () => {
    for (const seed of [1, 2, 7]) {
      const level = island.layout(seed);
      // No garden lamp posts: ship's lanterns on timber posts.
      expect(level.boxes.filter((b) => b.model === 'lampPost')).toEqual([]);
      const posts = level.boxes.filter((b) => b.model === 'lanternPost');
      expect(posts.length, `seed ${seed}`).toBeGreaterThanOrEqual(6);
      // The doorways: the headers over them, a door high in a room's walls.
      const doors = level.interiors.flatMap((room) =>
        level.boxes.filter(
          (b) =>
            !b.model &&
            !b.role &&
            Math.abs(b.pos.y + b.size.y / 2 - room.y1) < 0.01 &&
            b.size.y < 1 &&
            inRect(grow(room.rect, 0.2), b.pos.x, b.pos.z),
        ),
      );
      expect(doors.length, `seed ${seed}`).toBe(2);
      for (const p of posts) {
        const name = `seed ${seed}: lantern post at ${p.pos.x}, ${p.pos.z}`;
        expect(p.front, name).toBeDefined();
        expect(Math.max(p.size.x, p.size.z), name).toBeCloseTo(LANTERN_POST.thick, 5);
        const top = p.pos.y + p.size.y / 2;
        const [fx, fz] = frontWay[p.front!];
        const lamp = {
          x: p.pos.x + fx * LANTERN_POST.reach,
          z: p.pos.z + fz * LANTERN_POST.reach,
        };
        // Its top a man's height and more over the ground at its foot and under its lantern.
        const ground = Math.max(
          groundHeight(level, p.pos.x, p.pos.z),
          groundHeight(level, lamp.x, lamp.z),
        );
        expect(top - ground, name).toBeGreaterThan(2.8);
        expect(top - ground, name).toBeLessThan(3.1);
        // Its foot in the ground.
        expect(p.pos.y - p.size.y / 2, name).toBeLessThan(
          groundSpan(level, {
            x0: p.pos.x - p.size.x / 2,
            x1: p.pos.x + p.size.x / 2,
            z0: p.pos.z - p.size.z / 2,
            z1: p.pos.z + p.size.z / 2,
          }).min,
        );
        // The lantern, out on the arm in front: nothing within a hand or two of it.
        const y0 = top - 0.9;
        for (const b of level.boxes) {
          if (b === p) continue;
          const near =
            edgeGap(b, lamp) < 0.3 &&
            b.pos.y - b.size.y / 2 < top + 0.1 &&
            b.pos.y + b.size.y / 2 > y0;
          expect(
            near,
            `${name}: its lantern runs into ${b.model ?? 'a box'} at ${b.pos.x}, ${b.pos.z}`,
          ).toBe(false);
        }
        // And none crowding a doorway, where the buildings hang their own lanterns.
        for (const d of doors)
          expect(Math.hypot(d.pos.x - p.pos.x, d.pos.z - p.pos.z), name).toBeGreaterThan(2.5);
      }
    }
  });

  it(
    'beaches a galleon on either shore, two-masted, its deck up a ladder from the beach',
    { timeout: 60000 },
    () => {
      const seeds = shipSeeds();
      for (const seed of [seeds.east, seeds.west]) {
        const level = island.layout(seed);
        const hull = level.boxes.find((b) => b.model === 'hull')!;
        const name = `seed ${seed}`;
        const [bx, bz] = frontWay[hull.front!];
        const length = bx ? hull.size.x : hull.size.z;
        const beam = bx ? hull.size.z : hull.size.x;
        expect(length, name).toBeGreaterThanOrEqual(9.5);
        expect(beam, name).toBeGreaterThanOrEqual(3);
        expect(length, name).toBe(SHIP.length);
        const deck = hull.pos.y + hull.size.y / 2;
        // Its keel down in the sea bed, its deck well over the beach.
        const under = groundSpan(level, {
          x0: hull.pos.x - hull.size.x / 2,
          x1: hull.pos.x + hull.size.x / 2,
          z0: hull.pos.z - hull.size.z / 2,
          z1: hull.pos.z + hull.size.z / 2,
        });
        expect(hull.pos.y - hull.size.y / 2, name).toBeLessThan(under.min);
        expect(deck - Math.max(under.max, SEA), name).toBeGreaterThanOrEqual(1.7);
        // Two masts standing on the deck: the mainmast tall, the foremast shorter and toward
        // the bow.
        const masts = level.boxes
          .filter(
            (b) =>
              b.model === 'mast' &&
              Math.abs(b.pos.y - b.size.y / 2 - deck) < 0.01 &&
              edgeGap(hull, b.pos) === 0,
          )
          .sort((a, b) => b.size.y - a.size.y);
        expect(masts, name).toHaveLength(2);
        const [main, fore] = masts as [BoxDef, BoxDef];
        expect(main.size.y, name).toBeGreaterThanOrEqual(7.5);
        expect(fore.size.y, name).toBeLessThan(main.size.y);
        const along = (b: BoxDef) => (b.pos.x - hull.pos.x) * bx + (b.pos.z - hull.pos.z) * bz;
        expect(along(fore), name).toBeGreaterThan(along(main) + 2);
        // Cannons on the deck, and a chest and a page up there to climb for.
        const onDeck = (p: { x: number; y: number; z: number }) =>
          edgeGap(hull, p) === 0 && Math.abs(p.y - deck) < 1;
        const guns = level.boxes.filter((b) => b.model === 'cannon' && onDeck(b.pos));
        expect(guns.length, name).toBeGreaterThanOrEqual(2);
        expect(
          level.hideouts.some((h) => h.kind === 'chest' && onDeck(h.pos)),
          name,
        ).toBe(true);
        expect(level.pageSpots.some(onDeck), name).toBe(true);
        // The ladder from the beach up its side comes out on the deck, and a player climbs it.
        const ladder = level.ladders.find((l) => edgeGap(hull, l.pos) < 0.5)!;
        expect(ladder, name).toBeDefined();
        expect(groundHeight(level, ladder.pos.x, ladder.pos.z), name).toBeGreaterThan(SEA);
        expect(ladder.pos.y + ladder.height - LADDER_CLEAR, name).toBeCloseTo(deck, 2);
        laddersClimb({ ...level, ladders: [ladder] });
        // And the rival teams' half, turned round, has room for it too.
        const doubled = rivalLevel(level);
        expect(overlapping(doubled), `${name}, doubled`).toEqual([]);
        expect(mapProblems(doubled), `${name}, doubled`).toEqual([]);
      }
    },
  );

  it('has a harbour’s clutter about it, cutting nothing off', { timeout: 60000 }, () => {
    const clutter = new Set(['crate', 'barrel', 'ropeCoil', 'anchor']);
    for (const seed of [1, 4, shipSeeds().west]) {
      const level = island.layout(seed);
      const name = `seed ${seed}`;
      const pieces = level.boxes.filter((b) => clutter.has(b.model!));
      const count = (model: string) => pieces.filter((b) => b.model === model).length;
      expect(count('ropeCoil'), name).toBeGreaterThanOrEqual(3);
      expect(count('anchor'), name).toBeGreaterThanOrEqual(1);
      expect(count('crate'), name).toBeGreaterThanOrEqual(8);
      expect(count('barrel'), name).toBeGreaterThanOrEqual(12);
      const ladders = level.ladders.map((l) => l.pos);
      for (const b of pieces) {
        const where = `${name}: ${b.model} at ${b.pos.x}, ${b.pos.z}`;
        const foot = b.pos.y - b.size.y / 2;
        // On dry ground, or up on something (the ship's deck).
        const ground = groundHeight(level, b.pos.x, b.pos.z);
        if (foot - ground < 0.3) expect(ground, where).toBeGreaterThan(SEA);
        // Clear of where players stand to do things.
        for (const p of [...level.pageSpots, ...level.meetingSeats])
          if (Math.abs(p.y - foot) < 1.2)
            expect(edgeGap(b, p) > 0.3 || p.y > b.pos.y + b.size.y / 2 - 0.05, where).toBe(true);
        for (const l of ladders) expect(edgeGap(b, l), where).toBeGreaterThan(0.8);
        expect(edgeGap(b, level.spawn), where).toBeGreaterThan(1.5);
        for (const p of level.dog.points)
          if (Math.abs(p.y - foot) < 1) expect(edgeGap(b, p), where).toBeGreaterThan(DOG_RADIUS);
      }
      // It takes the ground it stands on and no more: all the ground a player could walk on
      // without it, but for what is right by it, they still can.
      const bare = walkableGround({
        ...level,
        boxes: level.boxes.filter((b) => !clutter.has(b.model!)),
      });
      const walk = walkableGround(level);
      const lost: string[] = [];
      for (let x = -ISLAND_HALF; x < ISLAND_HALF; x += 0.2)
        for (let z = -ISLAND_HALF; z < ISLAND_HALF; z += 0.2)
          if (bare(x, z) && !walk(x, z) && pieces.every((b) => edgeGap(b, { x, z }) > 0.45))
            lost.push(`${x.toFixed(1)}, ${z.toFixed(1)}`);
      expect(lost, name).toEqual([]);
    }
  });

  it('grows palms all round its shores, their crowns clear of the buildings', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const level = island.layout(seed);
      const palms = level.boxes.filter((b) => b.model === 'palm');
      expect(palms.length, `seed ${seed}`).toBeGreaterThanOrEqual(15);
      const high = level.boxes.filter(
        (b) => b.role === 'wall' || b.model === 'storey' || b.model === 'gableRoof',
      );
      for (const p of palms) {
        const name = `seed ${seed}: palm at ${p.pos.x}, ${p.pos.z}`;
        expect(groundHeight(level, p.pos.x, p.pos.z), name).toBeGreaterThan(SEA - 0.1);
        // Its fronds spread two fifths of its height and more round its top, and droop: no
        // wall, upper storey or roof stands in their way.
        const top = p.pos.y + p.size.y / 2;
        for (const b of high)
          if (b.pos.y + b.size.y / 2 > top - 1.9 && b.pos.y - b.size.y / 2 < top + 0.8)
            expect(
              edgeGap(b, p.pos),
              `${name}, by the box at ${b.pos.x}, ${b.pos.z}`,
            ).toBeGreaterThan(0.4 * p.size.y);
      }
      // On every side of the island.
      for (const [sx, sz] of [
        [-1, 1],
        [1, 1],
        [-1, -1],
        [1, -1],
      ] as const)
        expect(
          palms.filter((p) => p.pos.x * sx > 0 && p.pos.z * sz > 0).length,
          `seed ${seed}`,
        ).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('the house', () => {
  it('has a ladder a player climbs onto the roof from', { timeout: 60000 }, () => {
    laddersClimb(HOUSE);
  });
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

describe('the boxes the maps check by what they are', () => {
  it('tag the south fence, the walls and the shut shutter', { timeout: 60000 }, () => {
    for (const map of MAPS) {
      for (const level of [map.plain, map.layout(2)]) {
        const half = level.floorSize / 2;
        // One south fence, right along the yard's south edge.
        const fences = level.boxes.filter((b) => b.role === 'southFence');
        expect(fences, map.id).toHaveLength(1);
        expect(Math.abs(fences[0]!.pos.z + half), map.id).toBeLessThan(0.5);
        expect(fences[0]!.size.x, map.id).toBeGreaterThanOrEqual(level.floorSize - 1);
        // Walls: full height and thin, with nothing drawn in their place.
        for (const b of level.boxes.filter((x) => x.role === 'wall')) {
          expect(b.model, map.id).toBeUndefined();
          expect(b.size.y, map.id).toBeGreaterThanOrEqual(2.4);
          expect(Math.min(b.size.x, b.size.z), map.id).toBeLessThanOrEqual(0.3);
        }
        expect(level.boxes.some((b) => b.role === 'wall')).toBe(true);
      }
    }
    // Two of the merchant's three shutters stand open; the third has its slats down.
    for (let seed = 1; seed <= 4; seed++) {
      const slats = merchantLayout(seed).boxes.filter((b) => b.role === 'shutterSlats');
      expect(slats, `seed ${seed}`).toHaveLength(1);
      expect(slats[0]!.model).toBe('shutter');
    }
    // A doubled level has the low wall instead of the fence.
    expect(rivalLevel(HOUSE).boxes.some((b) => b.role === 'southFence')).toBe(false);
  });
});

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

  it('has nothing standing in anything else, and a ladder that climbs', { timeout: 60000 }, () => {
    for (let seed = 1; seed <= 8; seed++)
      expect(overlapping(merchantLayout(seed)), `seed ${seed}`).toEqual([]);
    laddersClimb(merchantLayout(1));
  });

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
