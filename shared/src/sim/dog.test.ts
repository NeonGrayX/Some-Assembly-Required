import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { realPage } from '../builds/forgery.ts';
import { LIGHTHOUSE } from '../builds/lighthouse.ts';
import { HOUSE } from '../content/house.ts';
import type { LevelDef } from '../content/house.ts';
import { houseLayout, walkable } from '../content/layout.ts';
import { length, sub, v3 } from '../math.ts';
import type { Vec3 } from '../math.ts';
import { DOG_HALF_HEIGHT, DOG_ID, DOG_RADIUS } from './dog.ts';
import { PLAYER_HALF_HEIGHT, PLAYER_RADIUS, Sim } from './sim.ts';
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

  it('sits in front of whoever pats it until they walk off', () => {
    const sim = new Sim(RAPIER, HOUSE, 5);
    const p = sim.addPlayer({ spawn: { x: -6.8, y: 0, z: 13.4 } });
    run(sim, 30);
    const d = sim.dog.body.translation();
    sim.teleportPlayer(p, { x: d.x, y: 0, z: d.z + 1.5 });
    run(sim, 2);
    sim.events.length = 0;
    clickOn(sim, p, sim.dog.body.translation());
    expect(sim.events.some((e) => e.kind === 'pat' && e.playerId === p.id)).toBe(true);

    // It comes under the player's hand, faces them and lets itself be patted.
    for (let t = 0; t < 2 * 60 && sim.dog.patBy === null; t++) sim.step();
    expect(sim.dog.mode).toBe('pat');
    expect(sim.dog.patBy).toBe(p.id);
    expect(flatDist(sim.dog.feet, p.body.translation())).toBeLessThan(0.9);
    const toPlayer = sub(p.body.translation(), sim.dog.feet);
    expect(Math.cos(sim.dog.yaw - Math.atan2(-toPlayer.x, -toPlayer.z))).toBeGreaterThan(0.95);

    // Clicking again keeps it going; walking away ends it.
    run(sim, 2 * 60);
    clickOn(sim, p, sim.dog.body.translation());
    run(sim, 2 * 60);
    expect(sim.dog.patBy).toBe(p.id);
    p.input.forward = -1;
    run(sim, 2);
    expect(sim.dog.patBy).toBeNull();
    expect(sim.dog.mode).not.toBe('pat');
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

/** Pins a fresh page to a corkboard slot. */
function pinned(sim: Sim, slot: number) {
  const page = sim.spawnPage(realPage(LIGHTHOUSE, slot % 8, '★'), { x: 14, y: 0, z: 14 });
  sim.pinToBoard(page, slot);
  return page;
}

/** The dog point nearest to `at`, and how far it is. */
function nearestDogPoint(level: LevelDef, at: Vec3) {
  return Math.min(...level.dog.points.map((q) => flatDist(q, at)));
}

describe('the dog and the corkboard', () => {
  it('goes for the corkboard every minute nobody feeds it', () => {
    const sim = new Sim(RAPIER, HOUSE, 1);
    bystander(sim);
    expect(sim.dog.ticksToSteal).toBe(60 * 60);
    const page = pinned(sim, 5);
    for (let t = 0; t < 60 * 60 - 1; t++) sim.step();
    expect(page.pinned).toBe(5);
    for (let t = 0; t < 60 * 60 && page.carriedBy !== DOG_ID; t++) sim.step();
    expect(page.carriedBy).toBe(DOG_ID);
  });

  it('steals a page from the bottom row, carries it off and drops it on one of its walks', () => {
    const sim = new Sim(RAPIER, HOUSE, 2);
    const p = bystander(sim);
    const page = pinned(sim, 5);
    run(sim, 30);
    sim.dog.stealSoon();
    let jumped = false;
    for (let t = 0; t < 60 * 60 && page.carriedBy !== DOG_ID; t++) {
      sim.step();
      jumped ||= sim.dog.mode === 'jump';
    }
    expect(jumped).toBe(true);
    expect(page.carriedBy).toBe(DOG_ID);
    expect(page.pinned).toBeNull();
    expect(sim.dog.page).toBe(page.id);
    // The next steal is a minute off again.
    expect(sim.dog.ticksToSteal).toBe(60 * 60);

    for (let t = 0; t < 90 * 60 && page.carriedBy === DOG_ID; t++) sim.step();
    expect(page.carriedBy).toBeNull();
    run(sim, 60);
    const at = page.body!.translation();
    // Out of the dog's way, which is still nearby.
    sim.dog['wait'] = Infinity;
    sim.dog.body.setTranslation(v3(15, 0.4, 15), true);
    sim.dog.collider.setTranslation(v3(15, 0.4, 15));
    expect(nearestDogPoint(HOUSE, at)).toBeLessThan(0.6);
    expect(Math.abs(at.y)).toBeLessThan(0.1);

    // Someone picks it up (standing on the dog's side of it) and pins it back.
    const point = HOUSE.dog.points.reduce((a, b) => (flatDist(b, at) < flatDist(a, at) ? b : a));
    const d = flatDist(point, at);
    const back = d > 0.05 ? 0.7 / d : 0;
    sim.teleportPlayer(p, {
      x: point.x - (at.x - point.x) * back,
      y: 0,
      z: point.z - (at.z - point.z) * back + (d > 0.05 ? 0 : 0.7),
    });
    run(sim, 2);
    clickOn(sim, p, at);
    expect(p.page).toBe(page.id);
    const b = HOUSE.boards[0]!.pos;
    sim.teleportPlayer(p, { x: b.x, y: 0, z: b.z + 1.5 });
    run(sim, 2);
    clickOn(sim, p, { x: b.x, y: b.y, z: b.z });
    expect(page.pinned).not.toBeNull();
  });

  it('lets go of a stolen page when someone grabs its collar', () => {
    const sim = new Sim(RAPIER, HOUSE, 4);
    const p = bystander(sim);
    const page = pinned(sim, 12);
    run(sim, 30);
    sim.dog.stealSoon();
    for (let t = 0; t < 60 * 60 && page.carriedBy !== DOG_ID; t++) sim.step();
    expect(page.carriedBy).toBe(DOG_ID);
    run(sim, 3 * 60);
    const dog = sim.dog.body.translation();
    sim.teleportPlayer(p, { x: dog.x, y: 0, z: dog.z + 1.6 });
    run(sim, 2);
    clickOn(sim, p, sim.dog.body.translation());
    expect(page.carriedBy).toBeNull();
    expect(page.body).not.toBeNull();
  });

  it('leaves the top row alone, and pages someone is standing by', () => {
    const sim = new Sim(RAPIER, HOUSE, 3);
    bystander(sim);
    const high = pinned(sim, 1);
    run(sim, 30);
    sim.dog.stealSoon();
    run(sim, 40 * 60);
    expect(high.pinned).toBe(1);

    const low = pinned(sim, 6);
    const b = HOUSE.boards[0]!.pos;
    sim.addPlayer({ spawn: { x: b.x, y: 0, z: b.z + 1.2 } });
    sim.dog.stealSoon();
    run(sim, 40 * 60);
    expect(low.pinned).toBe(6);
  });

  it('starts its waits over when it gets a treat', () => {
    const sim = new Sim(RAPIER, HOUSE, 3);
    const p = sim.addPlayer({ spawn: { x: -6.8, y: 0, z: 13.4 } });
    run(sim, 30);
    clickOn(sim, p, { ...HOUSE.dog.treatJar, y: HOUSE.dog.treatJar.y + 0.09 });
    for (let t = 0; t < 30 * 60 && flatDist(sim.dog.feet, p.body.translation()) > 1.1; t++) {
      sim.step();
    }
    run(sim, 60);
    sim.dog.stealSoon();
    sim.dog.starve();
    expect(sim.dog.ticksToSteal).toBe(0);
    clickOn(sim, p, sim.dog.body.translation());
    expect(sim.events.some((e) => e.kind === 'crunch')).toBe(true);
    expect(sim.dog.ticksToSteal).toBe(60 * 60);
    expect(sim.dog.ticksHungry).toBe(0);
  });

  it('jumps for every bottom-row slot from a spot it can walk to', () => {
    const sim = new Sim(RAPIER, HOUSE, 1);
    bystander(sim);
    for (let slot = 0; slot < 16; slot++) pinned(sim, slot);
    const targets = sim.stealTargets();
    expect(targets.map((t) => t.page.pinned).sort((a, b) => a! - b!)).toEqual([
      4, 5, 6, 7, 12, 13, 14, 15,
    ]);
    const shape = new RAPIER.Capsule(DOG_HALF_HEIGHT, DOG_RADIUS);
    const flags =
      RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC |
      RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC |
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    for (const { stand } of targets) {
      const at = v3(stand.x, 0.08 + DOG_RADIUS + DOG_HALF_HEIGHT, stand.z);
      expect(
        sim.world.intersectionWithShape(at, { x: 0, y: 0, z: 0, w: 1 }, shape, flags),
      ).toBeFalsy();
    }
  });

  // A page the dog drops must never end up where nobody can get it back, or the round could not
  // be won. It drops them on its dog points (or just in front, where that is clear), so: a
  // player can stand near each of those spots and pick the page up, in the house and in
  // randomly furnished ones.
  for (const [name, level] of [
    ['the house', HOUSE],
    ...[11, 222, 3333, 44444].map((s) => [`layout ${s}`, houseLayout(s)] as const),
  ] as const) {
    it(`drops pages only where players can pick them up again (${name})`, () => {
      const sim = new Sim(RAPIER, level, 1);
      const p = bystander(sim);
      // The dog sits out of the way in a far corner of the yard.
      sim.dog['wait'] = Infinity;
      sim.dog.body.setTranslation(v3(15, 0.4, 15), true);
      sim.dog.collider.setTranslation(v3(15, 0.4, 15));
      run(sim, 1);
      const walk = walkable(level);
      const indoors = (x: number, z: number) => z > 4.6 && Math.abs(x) < 12;
      const host = sim['dogHost']();
      const shape = new RAPIER.Capsule(PLAYER_HALF_HEIGHT, PLAYER_RADIUS);
      const flags =
        RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC |
        RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC |
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
      const fits = (x: number, z: number) =>
        (!indoors(x, z) || walk(x, z)) &&
        !sim.world.intersectionWithShape(
          v3(x, 0.08 + PLAYER_HALF_HEIGHT + PLAYER_RADIUS, z),
          { x: 0, y: 0, z: 0, w: 1 },
          shape,
          flags,
        );
      /** The closest spot to `at` where a player fits (and, indoors, can walk to). */
      const standNear = (at: Vec3): Vec3 | null => {
        for (let r = 0.6; r <= 1.6; r += 0.1)
          for (let a = 0; a < 24; a++) {
            const x = at.x + r * Math.cos((a * Math.PI) / 12);
            const z = at.z + r * Math.sin((a * Math.PI) / 12);
            if (fits(x, z)) return v3(x, 0, z);
          }
        return null;
      };
      level.dog.points.forEach((point, i) => {
        const spots = [point];
        for (let a = 0; a < 8; a++) {
          const front = v3(
            point.x + 0.35 * Math.cos((a * Math.PI) / 4),
            0,
            point.z + 0.35 * Math.sin((a * Math.PI) / 4),
          );
          const up = (q: Vec3) => v3(q.x, q.y + 0.25, q.z);
          if (host.clearLine(up(point), up(front))) spots.push(front);
        }
        for (const spot of spots) {
          const where = `dog point ${i} (${spot.x.toFixed(2)}, ${spot.z.toFixed(2)})`;
          const stand = standNear(spot);
          expect(stand, `nowhere to stand near ${where}`).not.toBeNull();
          const page = sim.spawnPage(realPage(LIGHTHOUSE, 0, '★'), v3(spot.x, 0.02, spot.z));
          sim.teleportPlayer(p, stand!);
          run(sim, 3);
          clickOn(sim, p, page.body!.translation());
          expect(p.page, `cannot pick up a page at ${where}`).toBe(page.id);
          p.page = null;
          sim.pages.delete(page.id);
          page.carriedBy = null;
        }
      });
    });
  }
});

describe('the hungry dog and the build', () => {
  /** A house with the first lighthouse step built on the baseplate, and the dog let loose on it. */
  function withBuild(seed: number) {
    const sim = new Sim(RAPIER, HOUSE, seed);
    bystander(sim);
    sim.addBricks(sim.build(), [...LIGHTHOUSE.steps[0]!.bricks, ...LIGHTHOUSE.steps[1]!.bricks]);
    sim.dogMayWreck = true;
    run(sim, 2);
    return sim;
  }
  const brickCount = (sim: Sim) => sim.build().grid.size;

  it('knocks part of the build off after three minutes without a treat', () => {
    const sim = withBuild(2);
    const before = brickCount(sim);
    for (let t = 0; t < 179 * 60; t++) sim.step();
    expect(brickCount(sim)).toBe(before);
    let broke = false;
    for (let t = 0; t < 60 * 60 && brickCount(sim) === before; t++) {
      sim.step();
      broke ||= sim.events.some((e) => e.kind === 'break');
    }
    expect(brickCount(sim)).toBeLessThan(before);
    // Only part of it: the baseplate and some bricks stay.
    expect(brickCount(sim)).toBeGreaterThan(1);
    expect(broke).toBe(true);
    // Three more minutes before the next go.
    expect(sim.dog.ticksHungry).toBeLessThan(60);
  });

  it('leaves the build alone while it may not wreck it (the last 90 seconds)', () => {
    const sim = withBuild(3);
    sim.dogMayWreck = false;
    const before = brickCount(sim);
    sim.dog.starve();
    run(sim, 60 * 60);
    expect(brickCount(sim)).toBe(before);
  });

  it('gives up on the way when the round gets into its last 90 seconds', () => {
    const sim = withBuild(4);
    const before = brickCount(sim);
    sim.dog.starve();
    run(sim, 30);
    expect(sim.dog.mode).toBe('fetch');
    sim.dogMayWreck = false;
    run(sim, 60 * 60);
    expect(brickCount(sim)).toBe(before);
  });

  it('stands just off the baseplate, on a side where it can get to the bricks', () => {
    const sim = withBuild(1);
    const c = sim.buildCentre();
    for (const from of [v3(10, 0, 0), v3(-10, 0, 0), v3(0, 0, 10), v3(0, 0, -10)]) {
      const at = sim.wreckTarget(from)!;
      expect(at).not.toBeNull();
      const out = Math.max(Math.abs(at.stand.x - c.x), Math.abs(at.stand.z - c.z));
      expect(out).toBeGreaterThan(0.8);
      expect(out).toBeLessThan(1.3);
    }
    // Nothing on the baseplate: nothing to wreck.
    const empty = new Sim(RAPIER, HOUSE, 1);
    expect(empty.wreckTarget(v3(5, 0, 0))).toBeNull();
  });
});
