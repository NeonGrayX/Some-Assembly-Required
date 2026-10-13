import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUILDS } from './builds/catalog.ts';
import { CASTLE } from './builds/castle.ts';
import { b } from './builds/kit.ts';
import { TEST_LIGHTHOUSE as LIGHTHOUSE } from './builds/testing.ts';
import {
  BASEMENT_FLOOR,
  BASEMENT_SLAB,
  HOUSE,
  UPPER_FLOOR,
  UPPER_SLAB,
  floorLevel,
  indoors,
} from './content/house.ts';
import { MAPS } from './content/maps/index.ts';
import { rivalLevel } from './content/rival.ts';
import { houseLayout } from './content/layout.ts';
import type { LevelDef } from './content/house.ts';
import {
  GEAR_HUNT_EXTRA_SECONDS,
  GEAR_IDS,
  LOCKABLE,
  gearBits,
  gearFromBits,
  litAt,
} from './gear.ts';
import type { GearId } from './gear.ts';
import { length, makeRng, sub, v3 } from './math.ts';
import type { Vec3 } from './math.ts';
import { LOCKED_SHARE, Round } from './round.ts';
import { LIMP_TICKS, MAX_LOOSE_BRICKS, Sim } from './sim/sim.ts';
import type { GearItem, Player } from './sim/sim.ts';
import type { TargetBuild } from './builds/types.ts';

/** A build of 32 pages, one 1x1 brick each, stacked in two towers. */
const LONGEST: TargetBuild = {
  id: 'longest',
  name: 'Longest',
  steps: Array.from({ length: 32 }, (_, i) => ({
    bricks: [b('1x1', 'yellow', 7 + Math.floor(i / 16), 1 + 3 * (i % 16), 7)],
  })),
};

beforeAll(async () => {
  await RAPIER.init();
});

function setup(seed = 7, level: LevelDef = HOUSE, build: TargetBuild = LIGHTHOUSE) {
  const sim = new Sim(RAPIER, level, seed, { bell: false });
  const round = new Round(sim, build, { seconds: 60, seed, players: [1, 2, 3], mode: 'gear' });
  const p = sim.addPlayer({ id: 1 });
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) {
      sim.step();
      round.update();
      sim.events = [];
    }
  };
  run(30);
  return { sim, round, p, run };
}

function lookAt(sim: Sim, p: Player, standAt: Vec3, target: Vec3) {
  p.body.setTranslation({ x: standAt.x, y: standAt.y + 0.86, z: standAt.z }, true);
  for (let i = 0; i < 3; i++) sim.step();
  const eye = sim.eye(p);
  p.input.firstPerson = true;
  p.input.yaw = Math.atan2(-(target.x - eye.x), -(target.z - eye.z));
  p.input.pitch = Math.atan2(target.y - eye.y, Math.hypot(target.x - eye.x, target.z - eye.z));
}

const gearOf = (sim: Sim, kind: GearId): GearItem =>
  [...sim.gear.values()].find((g) => g.kind === kind)!;

/** Where a piece of gear is: on a surface, or the hiding place it is in. */
function whereIs(sim: Sim, item: GearItem): { pos: Vec3; locked: boolean } {
  if (item.hideout !== null) {
    const h = sim.hideouts.get(item.hideout)!;
    return { pos: h.def.pos, locked: h.locked };
  }
  return { pos: item.body!.translation(), locked: false };
}

/** Picks a piece of gear lying on a surface up by clicking it. */
function pickUp(sim: Sim, p: Player, item: GearItem): void {
  const pos = item.body!.translation();
  lookAt(sim, p, { x: pos.x, y: floorLevel(pos.y), z: pos.z + 1 }, pos);
  sim.act(p.id, { kind: 'grab' });
}

describe('gear bits', () => {
  it('packs worn gear into a number and back', () => {
    expect(gearFromBits(gearBits([]))).toEqual(new Set());
    expect(gearFromBits(gearBits(['boots', 'leash']))).toEqual(new Set(['boots', 'leash']));
    expect(gearFromBits(gearBits(GEAR_IDS))).toEqual(new Set(GEAR_IDS));
  });
});

/**
 * How `indoors` used to work out the house, from its two slabs, on every map alike: kept to
 * check the house's interiors give the very same answers.
 */
function slabIndoors(pos: Vec3): boolean {
  const x0 = Math.min(UPPER_SLAB.x0, BASEMENT_SLAB.x0);
  const x1 = Math.max(UPPER_SLAB.x1, BASEMENT_SLAB.x1);
  const z0 = Math.min(UPPER_SLAB.z0, BASEMENT_SLAB.z0);
  const z1 = Math.max(UPPER_SLAB.z1, BASEMENT_SLAB.z1);
  if (pos.x < x0 || pos.x > x1 || pos.z < z0 || pos.z > z1) return false;
  const storeys = pos.x < UPPER_SLAB.x1 ? 2 : 1;
  return pos.y < storeys * UPPER_FLOOR - 0.3;
}

describe('indoors and light', () => {
  it('knows the house from the yard, the basement and the roofs', () => {
    expect(indoors(HOUSE, v3(0, 1, 10))).toBe(true); // living room
    expect(indoors(HOUSE, v3(8, -2, 10))).toBe(true); // basement
    expect(indoors(HOUSE, v3(-5, 3.5, 10))).toBe(true); // upstairs
    expect(indoors(HOUSE, v3(0, 1, 0))).toBe(false); // yard
    expect(indoors(HOUSE, v3(8, 3, 10))).toBe(false); // the flat roof over the break room
    expect(indoors(HOUSE, v3(-5, 6, 10))).toBe(false); // the roof over the upper floor
  });

  it("gives the house's old answers everywhere anything can be", () => {
    const rng = makeRng(42);
    const at = (lo: number, hi: number) => lo + (hi - lo) * rng();
    const inBasement = (p: Vec3) =>
      p.x >= BASEMENT_SLAB.x0 &&
      p.x <= BASEMENT_SLAB.x1 &&
      p.z >= BASEMENT_SLAB.z0 &&
      p.z <= BASEMENT_SLAB.z1 &&
      p.y >= BASEMENT_FLOOR - 0.3;
    let checked = 0;
    let insides = 0;
    for (let i = 0; i < 40000; i++) {
      // Over the house and a few metres round it, from under the basement to over the roofs.
      const p = v3(at(-15, 15), at(BASEMENT_FLOOR - 1, 7), at(3, 18));
      // Solid earth under the ground floor, round the basement and below it: nothing is ever
      // there, and the old footprint had no floor to it.
      if (p.y < -0.3 && !inBasement(p)) continue;
      const inside = slabIndoors(p);
      expect(indoors(HOUSE, p), `${p.x}, ${p.y}, ${p.z}`).toBe(inside);
      checked++;
      if (inside) insides++;
    }
    // Plenty of both answers.
    expect(checked).toBeGreaterThan(25000);
    expect(insides).toBeGreaterThan(8000);
    expect(checked - insides).toBeGreaterThan(8000);
    // And everything a layout puts anywhere.
    for (const level of [HOUSE, houseLayout(3), houseLayout(11)]) {
      for (const p of [...level.pageSpots, ...level.hideouts.map((h) => h.pos)])
        expect(indoors(level, p)).toBe(slabIndoors(p));
    }
  });

  it("knows the rival team's house as well as the home team's", () => {
    const level = rivalLevel(HOUSE);
    const zm = -HOUSE.floorSize / 2;
    const mirror = (p: Vec3) => v3(-p.x, p.y, 2 * zm - p.z);
    for (const p of [v3(0, 1, 10), v3(8, -2, 10), v3(-5, 3.5, 10), v3(8, 3, 10), v3(0, 1, 0)]) {
      expect(indoors(level, p)).toBe(indoors(HOUSE, p));
      expect(indoors(level, mirror(p))).toBe(indoors(HOUSE, p));
    }
  });

  it("knows every map's rooms from its yard, its roofs and its open shelters", () => {
    const cases: Record<string, [Vec3, boolean][]> = {
      merchant: [
        [v3(0, 1, 10), true], // the hall
        [v3(11, 1, 12.5), true], // the staff room
        [v3(-13, 1, -0.5), true], // the dock office
        [v3(0, 4.4, 10), false], // on the hall's roof
        [v3(0, 1, -5), false], // the yard
      ],
      station: [
        [v3(-6, 1, 12.5), true], // the ticket hall
        [v3(-10, 1, 4.2), true], // the first carriage's corridor
        [v3(-10, 1, -11), true], // the goods shed
        [v3(0, 1, 8), false], // under the canopy on platform 1
        [v3(0, 1, -5), false], // platform 2
      ],
      camp: [
        [v3(-12, 1, 1), true], // the shop
        [v3(12, 1, 1), true], // the toilet block
        [v3(-12, 3.1, 1), false], // on the shop's roof
        [v3(0, 1, -3), false], // the fire
      ],
    };
    for (const map of MAPS) {
      const level = map.plain;
      expect(indoors(level, level.spawn), `${map.id} spawn`).toBe(false);
      for (const [p, inside] of cases[map.id] ?? [])
        expect(indoors(level, p), `${map.id} ${p.x}, ${p.y}, ${p.z}`).toBe(inside);
    }
  });

  it('reads anywhere by day or with the power on, and inside only in a beam', () => {
    const inside = v3(0, 0.5, 10);
    expect(litAt(HOUSE, inside, false, false, [])).toBe(true);
    expect(litAt(HOUSE, inside, true, true, [])).toBe(true);
    expect(litAt(HOUSE, v3(0, 0.5, 0), true, false, [])).toBe(true);
    expect(litAt(HOUSE, inside, true, false, [])).toBe(false);
    const beam = { eye: v3(0, 1.4, 13), dir: v3(0, -0.3, -1) };
    expect(litAt(HOUSE, inside, true, false, [beam])).toBe(true);
    expect(litAt(HOUSE, inside, true, false, [{ ...beam, dir: v3(0, 0, 1) }])).toBe(false);
    expect(litAt(HOUSE, inside, true, false, [{ ...beam, eye: v3(0, 1.4, 25) }])).toBe(false);
  });
});

describe('Gear Hunt', () => {
  it('starts with no saboteur, the power out, litter about, padlocks on and every piece of gear once', () => {
    const { sim, round } = setup();
    expect([...round.roles.values()]).toEqual(['builder', 'builder', 'builder']);
    expect(round.timeLeft).toBeCloseTo(60 + GEAR_HUNT_EXTRA_SECONDS - 0.5, 0);
    expect(sim.power.on).toBe(false);
    expect(sim.power.dead).toBe(true);
    expect(round.litter).toBeGreaterThan(30);
    expect(sim.looseLimit).toBe(MAX_LOOSE_BRICKS + round.litter);
    expect([...sim.gear.values()].map((g) => g.kind).sort()).toEqual([...GEAR_IDS].sort());
    expect(sim.hazards).toEqual(new Set(GEAR_IDS));
    const lockable = HOUSE.hideouts.filter((h) => LOCKABLE.has(h.kind)).length;
    const locked = [...sim.hideouts.values()].filter((h) => h.locked);
    expect(locked).toHaveLength(Math.ceil(lockable * LOCKED_SHARE));
    expect(locked.every((h) => LOCKABLE.has(h.def.kind))).toBe(true);
    expect(sim.bell).toBe(false);
    expect(round.callMeeting(1)).toBe(false);
  });

  // Sets up sixty gear hunts: about 2 s alone, several times that beside the other test files.
  it(
    'never needs gear to reach gear: the key ring is never padlocked in, the headlamp never indoors',
    {
      timeout: 60000,
    },
    () => {
      const cases: [number, LevelDef, TargetBuild][] = [];
      for (let seed = 1; seed <= 40; seed++) {
        cases.push([seed, seed % 2 ? HOUSE : houseLayout(seed), BUILDS[seed % BUILDS.length]!]);
      }
      for (let seed = 1; seed <= 10; seed++) cases.push([seed, houseLayout(seed * 31), CASTLE]);
      // The longest manual a build file can have: 32 pages and the index leave little room.
      for (let seed = 1; seed <= 10; seed++) cases.push([seed, houseLayout(seed * 17), LONGEST]);
      let inHideouts = 0;
      for (const [seed, level, build] of cases) {
        const sim = new Sim(RAPIER, level, seed, { bell: false });
        new Round(sim, build, { seconds: 60, seed, mode: 'gear' });
        expect(sim.gear.size).toBe(GEAR_IDS.length);
        const keys = whereIs(sim, gearOf(sim, 'keys'));
        expect(keys.locked, `keys locked in (seed ${seed})`).toBe(false);
        const lamp = whereIs(sim, gearOf(sim, 'headlamp'));
        expect(indoors(level, lamp.pos), `headlamp indoors (seed ${seed})`).toBe(false);
        const goggles = gearOf(sim, 'goggles');
        if (goggles.body) {
          expect(length(sub(goggles.body.translation(), level.spawn))).toBeGreaterThan(9);
        }
        for (const item of sim.gear.values()) if (item.hideout !== null) inHideouts++;
      }
      // About a third of the gear hides in closed hiding places, a bit less with the long manuals
      // (24 to 32 pages) that most builds have, whose pages take more of them.
      expect(inHideouts / (cases.length * GEAR_IDS.length)).toBeGreaterThan(0.2);
      expect(inHideouts / (cases.length * GEAR_IDS.length)).toBeLessThan(0.4);
    },
  );

  it('puts gear on when it is picked up, and drops it again on a number key', () => {
    const { sim, p, run } = setup();
    // One lying out in the yard, where nothing stands between it and the player.
    const item = [...sim.gear.values()].find((g) => g.body && g.body.translation().z < 3)!;
    pickUp(sim, p, item);
    expect(p.gear.has(item.kind)).toBe(true);
    expect(item.wornBy).toBe(p.id);
    expect(item.body).toBeNull();
    expect(sim.events.some((e) => e.kind === 'gearOn' && e.gear === item.kind)).toBe(true);
    run(5);
    sim.act(p.id, { kind: 'unequip', gear: item.kind });
    run(30);
    expect(p.gear.size).toBe(0);
    expect(item.wornBy).toBeNull();
    expect(item.body).not.toBeNull();
    expect(length(sub(item.body!.translation(), p.body.translation()))).toBeLessThan(1.5);
  });

  it('keeps a padlocked hiding place shut for everyone but the key ring wearer', () => {
    const { sim, p } = setup();
    const h = [...sim.hideouts.values()].find((x) => x.locked)!;
    sim.toggleHideout(h.def.id, p.id);
    expect(h.open).toBe(false);
    expect(sim.events.map((e) => e.kind)).toContain('locked');
    sim.events = [];
    p.gear.add('keys');
    sim.toggleHideout(h.def.id, p.id);
    expect(h.open).toBe(true);
    expect(h.locked).toBe(false);
    expect(sim.events.map((e) => e.kind)).toEqual(['unlock', 'open']);
    // Unlocked, it opens for anyone from now on.
    sim.toggleHideout(h.def.id, 2);
    sim.toggleHideout(h.def.id, 2);
    expect(h.open).toBe(true);
  });

  it('lets gear fall out of a hiding place when it is opened', () => {
    const { sim, p, run } = setup();
    const item = [...sim.gear.values()].find((g) => g.hideout !== null)!;
    const h = sim.hideouts.get(item.hideout!)!;
    p.gear.add('keys');
    sim.toggleHideout(h.def.id, p.id);
    run(30);
    expect(item.hideout).toBeNull();
    expect(item.body).not.toBeNull();
    expect(h.gear).toEqual([]);
  });

  it('only lifts the heavy build for a careful walker, unless they wear the back brace', () => {
    const { sim, p, run } = setup();
    const build = sim.build();
    const c = sim.buildCentre();
    const aim = () =>
      lookAt(sim, p, { x: c.x, y: 0, z: c.z + 1.4 }, { x: c.x, y: 0.04, z: c.z + 0.7 });
    aim();
    sim.act(p.id, { kind: 'grab' });
    expect(build.anchored).toBe(true);
    expect(sim.events.map((e) => e.kind)).toContain('heavy');
    p.input.careful = true;
    sim.act(p.id, { kind: 'grab' });
    expect(build.anchored).toBe(false);
    expect(build.heldBy).toBe(p.id);
    // Carrying it, the pace stays careful even when they let go of Ctrl and sprint.
    p.input.careful = false;
    p.input.sprint = true;
    p.input.forward = 1;
    const from = p.body.translation();
    run(60);
    const walked = length(sub(p.body.translation(), from));
    expect(walked).toBeLessThan(1.6);
    p.input.forward = 0;
    p.input.sprint = false;
    sim.act(p.id, { kind: 'drop' });
    run(120);

    const { sim: sim2, p: p2 } = setup();
    p2.gear.add('brace');
    const c2 = sim2.buildCentre();
    lookAt(sim2, p2, { x: c2.x, y: 0, z: c2.z + 1.4 }, { x: c2.x, y: 0.04, z: c2.z + 0.7 });
    sim2.act(p2.id, { kind: 'grab' });
    expect(sim2.build().anchored).toBe(false);
  });

  it('lets steel-toe boots walk over loose bricks that hurt everyone else', () => {
    const walkOverTrap = (boots: boolean) => {
      const sim = new Sim(RAPIER, HOUSE);
      const p = sim.addPlayer({ spawn: v3(-2.5, 0, -4) });
      if (boots) p.gear.add('boots');
      for (let i = 0; i < 30; i++) sim.step();
      p.input.yaw = 0;
      sim.dropTrap(p);
      for (let i = 0; i < 60; i++) sim.step();
      p.input.forward = 1;
      for (let i = 0; i < 90; i++) sim.step();
      return p.limp;
    };
    expect(walkOverTrap(false)).toBeGreaterThan(LIMP_TICKS - 90);
    expect(walkOverTrap(true)).toBe(0);
  });

  it('leashes the dog at its pole, where it sits and steals nothing', () => {
    const { sim, p, run } = setup(8);
    const leash = gearOf(sim, 'leash');
    // Wear it, however it was hidden.
    if (leash.hideout !== null) {
      p.gear.add('keys');
      sim.toggleHideout(leash.hideout, p.id);
      run(30);
    }
    pickUp(sim, p, leash);
    expect(p.gear.has('leash')).toBe(true);
    const dog = sim.dog;
    // Give the dog a page to carry, then stand by it and click.
    const page = [...sim.pages.values()].find((x) => x.body)!;
    const feet = dog.feet;
    page.body!.setTranslation(v3(feet.x, 0.3, feet.z + 0.5), true);
    run(90);
    const at = dog.body.translation();
    lookAt(sim, p, { x: at.x, y: 0, z: at.z + 1.2 }, at);
    sim.act(p.id, { kind: 'grab' });
    expect(dog.leashed).toBe(true);
    expect(dog.page).toBeNull();
    expect(p.gear.has('leash')).toBe(false);
    expect(leash.placed).toBe(true);
    expect(leash.wornBy).toBeNull();
    expect(leash.body).toBeNull();
    expect(sim.events.map((e) => e.kind)).toContain('leash');
    run(60 * 20);
    const pole = sim.dogPole();
    expect(Math.hypot(dog.feet.x - pole.x, dog.feet.z - pole.z)).toBeLessThan(0.5);
    expect(dog.mode).toBe('sit');
    // Hungry or not, it stays put.
    dog.starve();
    dog.stealSoon();
    run(60 * 10);
    expect(Math.hypot(dog.feet.x - pole.x, dog.feet.z - pole.z)).toBeLessThan(0.5);
    expect(dog.page).toBeNull();
  });

  it("drops a leaving player's gear where they stood", () => {
    const { sim, p, run } = setup();
    const item = [...sim.gear.values()].find((g) => g.body)!;
    pickUp(sim, p, item);
    const at = p.body.translation();
    sim.removePlayer(p.id);
    run(30);
    expect(item.wornBy).toBeNull();
    expect(item.body).not.toBeNull();
    expect(length(sub(item.body!.translation(), at))).toBeLessThan(1.5);
  });

  it('plays plain co-op with no saboteur and no gear', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const round = new Round(sim, LIGHTHOUSE, { seed: 3, players: [1, 2, 3, 4], mode: 'coop' });
    expect([...round.roles.values()].every((r) => r === 'builder')).toBe(true);
    expect(sim.gear.size).toBe(0);
    expect(sim.power.on).toBe(true);
    expect(sim.power.dead).toBe(false);
    expect(sim.hazards.size).toBe(0);
  });
});
