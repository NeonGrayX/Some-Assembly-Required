import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUILDS } from './builds/catalog.ts';
import { CASTLE } from './builds/castle.ts';
import { LIGHTHOUSE } from './builds/lighthouse.ts';
import { HOUSE, floorLevel } from './content/house.ts';
import { houseLayout } from './content/layout.ts';
import type { LevelDef } from './content/house.ts';
import {
  GEAR_HUNT_EXTRA_SECONDS,
  GEAR_IDS,
  LOCKABLE,
  gearBits,
  gearFromBits,
  indoors,
  litAt,
} from './gear.ts';
import type { GearId } from './gear.ts';
import { length, sub, v3 } from './math.ts';
import type { Vec3 } from './math.ts';
import { LOCKED_SHARE, Round } from './round.ts';
import { LIMP_TICKS, MAX_LOOSE_BRICKS, Sim } from './sim/sim.ts';
import type { GearItem, Player } from './sim/sim.ts';
import type { TargetBuild } from './builds/types.ts';

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

describe('indoors and light', () => {
  it('knows the house from the yard, the basement and the roofs', () => {
    expect(indoors(v3(0, 1, 10))).toBe(true); // living room
    expect(indoors(v3(8, -2, 10))).toBe(true); // basement
    expect(indoors(v3(-5, 3.5, 10))).toBe(true); // upstairs
    expect(indoors(v3(0, 1, 0))).toBe(false); // yard
    expect(indoors(v3(8, 3, 10))).toBe(false); // the flat roof over the break room
    expect(indoors(v3(-5, 6, 10))).toBe(false); // the roof over the upper floor
  });

  it('reads anywhere by day or with the power on, and inside only in a beam', () => {
    const inside = v3(0, 0.5, 10);
    expect(litAt(inside, false, false, [])).toBe(true);
    expect(litAt(inside, true, true, [])).toBe(true);
    expect(litAt(v3(0, 0.5, 0), true, false, [])).toBe(true);
    expect(litAt(inside, true, false, [])).toBe(false);
    const beam = { eye: v3(0, 1.4, 13), dir: v3(0, -0.3, -1) };
    expect(litAt(inside, true, false, [beam])).toBe(true);
    expect(litAt(inside, true, false, [{ ...beam, dir: v3(0, 0, 1) }])).toBe(false);
    expect(litAt(inside, true, false, [{ ...beam, eye: v3(0, 1.4, 25) }])).toBe(false);
  });
});

describe('Gear Hunt', () => {
  it('starts with no saboteur, the power out, litter about, padlocks on and every piece of gear once', () => {
    const { sim, round } = setup();
    expect([...round.roles.values()]).toEqual(['builder', 'builder', 'builder']);
    expect(round.timeLeft).toBeCloseTo(60 + GEAR_HUNT_EXTRA_SECONDS - 0.5, 0);
    expect(sim.power.on).toBe(false);
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

  it('never needs gear to reach gear: the key ring is never padlocked in, the headlamp never indoors', () => {
    const cases: [number, LevelDef, TargetBuild][] = [];
    for (let seed = 1; seed <= 40; seed++) {
      cases.push([seed, seed % 2 ? HOUSE : houseLayout(seed), BUILDS[seed % BUILDS.length]!]);
    }
    for (let seed = 1; seed <= 10; seed++) cases.push([seed, houseLayout(seed * 31), CASTLE]);
    let inHideouts = 0;
    for (const [seed, level, build] of cases) {
      const sim = new Sim(RAPIER, level, seed, { bell: false });
      new Round(sim, build, { seconds: 60, seed, mode: 'gear' });
      expect(sim.gear.size).toBe(GEAR_IDS.length);
      const keys = whereIs(sim, gearOf(sim, 'keys'));
      expect(keys.locked, `keys locked in (seed ${seed})`).toBe(false);
      const lamp = whereIs(sim, gearOf(sim, 'headlamp'));
      expect(indoors(lamp.pos), `headlamp indoors (seed ${seed})`).toBe(false);
      const goggles = gearOf(sim, 'goggles');
      if (goggles.body) {
        expect(length(sub(goggles.body.translation(), level.spawn))).toBeGreaterThan(9);
      }
      for (const item of sim.gear.values()) if (item.hideout !== null) inHideouts++;
    }
    // About a third of the gear hides in closed hiding places.
    expect(inHideouts / (cases.length * GEAR_IDS.length)).toBeGreaterThan(0.25);
    expect(inHideouts / (cases.length * GEAR_IDS.length)).toBeLessThan(0.4);
  });

  it('puts gear on when it is picked up, and drops it again on a number key', () => {
    const { sim, p, run } = setup();
    const item = [...sim.gear.values()].find((g) => g.body)!;
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
      const p = sim.addPlayer({ spawn: v3(-8, 0, -8) });
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
    const { sim, p, run } = setup();
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
    expect(sim.hazards.size).toBe(0);
  });
});
