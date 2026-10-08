import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { LIGHTHOUSE } from './builds/lighthouse.ts';
import { STAMPS, forgePage, isForged, realPage } from './builds/forgery.ts';
import { validateBuild } from './builds/validate.ts';
import { binColours, colourVariant } from './builds/variant.ts';
import { allBricks } from './builds/types.ts';
import { COLOURS } from './bricks.ts';
import type { BrickTypeId, ColourId } from './bricks.ts';
import { HOUSE } from './content/house.ts';
import { makeRng } from './math.ts';
import type { Vec3 } from './math.ts';
import { decode, encode } from './net/protocol.ts';
import type { ServerMsg } from './net/protocol.ts';
import { CHAT_RANGE, Room } from './net/room.ts';
import {
  COOLDOWNS,
  INNOCENT_PENALTY_SECONDS,
  MEETING_SECONDS,
  Round,
  defaultSaboteurs,
} from './round.ts';
import { Sim, TICK_RATE } from './sim/sim.ts';
import type { Player } from './sim/sim.ts';

beforeAll(async () => {
  await RAPIER.init();
});

function game(players = 4, saboteurs?: number) {
  const sim = new Sim(RAPIER, HOUSE);
  const ids = Array.from(
    { length: players },
    (_, i) => sim.addPlayer({ spawn: { x: i - 2, y: 0, z: 4 } }).id,
  );
  const round = new Round(sim, LIGHTHOUSE, { seconds: 300, seed: 3, players: ids, saboteurs });
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) {
      sim.step();
      round.update();
      sim.events = [];
    }
  };
  run(20);
  const saboteur = ids.find((id) => round.role(id) === 'saboteur')!;
  const builders = ids.filter((id) => round.role(id) === 'builder');
  return { sim, round, ids, run, saboteur, builders };
}

function lookAt(sim: Sim, p: Player, standAt: Vec3, target: Vec3) {
  p.body.setTranslation({ x: standAt.x, y: 0.86, z: standAt.z }, true);
  for (let i = 0; i < 3; i++) sim.step();
  const eye = sim.eye(p);
  p.input.firstPerson = true;
  p.input.yaw = Math.atan2(-(target.x - eye.x), -(target.z - eye.z));
  p.input.pitch = Math.atan2(target.y - eye.y, Math.hypot(target.x - eye.x, target.z - eye.z));
}

describe('roles', () => {
  it('picks the usual number of saboteurs for the group size', () => {
    expect([1, 2, 3, 6, 7, 10].map(defaultSaboteurs)).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it('lets saboteurs know each other, and builders know nothing', () => {
    const { round, ids } = game(8);
    const sabs = ids.filter((id) => round.role(id) === 'saboteur');
    expect(sabs).toHaveLength(2);
    expect(round.partners(sabs[0]!)).toEqual([sabs[1]]);
    expect(round.partners(ids.find((id) => !sabs.includes(id))!)).toEqual([]);
  });
});

describe('forged pages', () => {
  it('differ from the real page by one brick colour and the stamp, and stay plausible', () => {
    const [real, fake] = STAMPS[0]!;
    for (let seed = 1; seed <= 40; seed++) {
      const step = seed % LIGHTHOUSE.steps.length;
      const forged = forgePage(LIGHTHOUSE, step, fake, makeRng(seed));
      expect(isForged(LIGHTHOUSE, forged, real)).toBe(true);
      expect(isForged(LIGHTHOUSE, realPage(LIGHTHOUSE, step, real), real)).toBe(false);
      const differing = forged.added.filter(
        (b, i) => JSON.stringify(b) !== JSON.stringify(LIGHTHOUSE.steps[step]!.bricks[i]),
      );
      expect(differing).toHaveLength(1);
      // Only the colour is off: a brick in the wrong place would give the page away.
      forged.added.forEach((b, i) => {
        const o = LIGHTHOUSE.steps[step]!.bricks[i]!;
        expect([b.type, b.x, b.y, b.z, b.rot]).toEqual([o.type, o.x, o.y, o.z, o.rot]);
      });
      const [d] = differing;
      const orig = LIGHTHOUSE.steps[step]!.bricks[forged.added.indexOf(d!)]!;
      expect(COLOURS[orig.colour].nearMiss).toContain(d!.colour);
      // Following the forgery still gives a buildable (just wrong) model.
      const steps = LIGHTHOUSE.steps.map((s, i) => (i === step ? { bricks: forged.added } : s));
      expect(validateBuild({ ...LIGHTHOUSE, steps })).toEqual([]);
    }
  });
});

describe('colour variants', () => {
  const bins = binColours(HOUSE);
  const has = (b: { type: BrickTypeId; colour: ColourId }) => bins.get(b.type)?.has(b.colour);

  it('recolour with look-alikes the bins have, keeping every shape and position', () => {
    const colours = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const v = colourVariant(LIGHTHOUSE, bins, makeRng(seed));
      expect(validateBuild(v)).toEqual([]);
      const base = allBricks(LIGHTHOUSE);
      allBricks(v).forEach((b, i) => {
        const o = base[i]!;
        expect([b.type, b.x, b.y, b.z, b.rot]).toEqual([o.type, o.x, o.y, o.z, o.rot]);
        expect(has(b)).toBe(true);
        expect([o.colour, ...COLOURS[o.colour].nearMiss]).toContain(b.colour);
      });
      colours.add(
        allBricks(v)
          .map((b) => b.colour)
          .join(),
      );
    }
    // Rounds really do differ.
    expect(colours.size).toBeGreaterThan(20);
  });

  it('make look-alike colours normal on real pages', () => {
    let changed = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const v = colourVariant(LIGHTHOUSE, bins, makeRng(seed));
      changed += allBricks(v).filter(
        (b, i) => b.colour !== allBricks(LIGHTHOUSE)[i]!.colour,
      ).length;
    }
    expect(changed / (20 * 32)).toBeGreaterThan(0.25);
  });

  it('forgeries only ask for bricks the bins have', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const v = colourVariant(LIGHTHOUSE, bins, makeRng(seed));
      const forged = forgePage(v, seed % 8, '✩', makeRng(seed + 100), bins);
      forged.added.forEach((b, i) => {
        expect(has(b)).toBe(true);
        const o = v.steps[seed % 8]!.bricks[i]!;
        expect([b.type, b.x, b.y, b.z, b.rot]).toEqual([o.type, o.x, o.y, o.z, o.rot]);
      });
      expect(isForged(v, forged, '★')).toBe(true);
    }
  });

  it('are what the room plays and sends', () => {
    const inbox: ServerMsg[] = [];
    const r = new Room(RAPIER, { code: 'V', seed: 9, send: (_id, m) => inbox.push(m) });
    const res = r.join('Vic');
    if ('error' in res) throw new Error(res.error);
    r.handle(res.id, { t: 'start' });
    const world = inbox
      .filter((m): m is Extract<ServerMsg, { t: 'world' }> => m.t === 'world')
      .at(-1)!;
    expect(world.target).toEqual(r.round!.target);
    const page = [...r.sim.pages.values()].find((p) => p.step === 0)!;
    expect(page.printed!.added).toEqual(r.round!.target.steps[0]!.bricks);
  });
});

describe('Brick Meetings', () => {
  it('pauses the clock, sends home the player with most votes and costs time for an innocent', () => {
    const { round, run, builders, ids } = game(4);
    const before = round.timeLeft;
    expect(round.callMeeting(builders[0]!)).toBe(true);
    run(TICK_RATE * 10);
    expect(round.timeLeft).toBe(before);
    const victim = builders[1]!;
    for (const id of ids) round.vote(id, id === victim ? builders[0]! : victim);
    expect(round.meeting?.outcome?.sentHome).toBe(victim);
    expect(round.sentHome).toEqual([victim]);
    expect(round.timeLeft).toBe(before - INNOCENT_PENALTY_SECONDS);
    run(TICK_RATE * 6);
    expect(round.meeting).toBeNull();
    // A player sent home can no longer vote or call meetings.
    expect(round.callMeeting(victim)).toBe(false);
  });

  it('sends nobody home on a tie or when skips win', () => {
    const { round, ids } = game(4);
    round.callMeeting(ids[0]!);
    round.vote(ids[0]!, ids[1]!);
    round.vote(ids[1]!, ids[0]!);
    round.vote(ids[2]!, 0);
    round.vote(ids[3]!, 0);
    expect(round.meeting?.outcome?.sentHome).toBe(0);
    expect(round.sentHome).toEqual([]);
  });

  it('counts the votes in when time runs out', () => {
    const { round, run, ids, builders } = game(4);
    round.callMeeting(ids[0]!);
    round.vote(ids[0]!, builders[0]!);
    run(MEETING_SECONDS * TICK_RATE + 1);
    expect(round.meeting?.outcome?.sentHome).toBe(builders[0]);
  });

  it('gives every player one meeting per round', () => {
    const { round, run, ids } = game(4);
    expect(round.callMeeting(ids[0]!)).toBe(true);
    for (const id of ids) round.vote(id, 0);
    run(TICK_RATE * 6);
    expect(round.callMeeting(ids[0]!)).toBe(false);
    expect(round.callMeeting(ids[1]!)).toBe(true);
  });

  it('hands the win to the saboteur after two innocents are sent home', () => {
    const { round, run, ids, builders } = game(5);
    for (const victim of builders.slice(0, 2)) {
      round.callMeeting(ids.find((id) => round.meetingsLeft.get(id))!);
      for (const id of round.onSite)
        round.vote(id, id === victim ? round.onSite.find((x) => x !== victim)! : victim);
      run(TICK_RATE * 6);
    }
    expect(round.phase).toBe('results');
    expect(round.endReason).toBe('votes');
    expect(round.winner).toBe('saboteurs');
  });
});

describe('saboteur tools', () => {
  it('only work for saboteurs, and then cool down', () => {
    const { sim, round, saboteur, builders } = game(4);
    sim.addBricks(sim.build(), LIGHTHOUSE.steps[0]!.bricks);
    const brick = [...sim.build().grid.bricks.values()].find((b) => b.type === '2x4')!;
    const pos = sim.brickPose(sim.build(), brick).pos;
    const aimAt = (id: number) =>
      lookAt(sim, sim.players.get(id)!, { x: pos.x, y: 0, z: pos.z + 1.3 }, pos);

    aimAt(builders[0]!);
    expect(round.sabotage(builders[0]!, 'swap')).toBe(false);
    sim.players.get(builders[0]!)!.body.setTranslation({ x: 8, y: 0.86, z: 8 }, true);
    aimAt(saboteur);
    const version = sim.build().version;
    expect(round.sabotage(saboteur, 'swap')).toBe(true);
    expect(brick.colour).toBe('light-grey'); // dark grey's look-alike
    expect(sim.build().version).toBe(version + 1);
    expect(round.cooldown(saboteur, 'swap')).toBe(COOLDOWNS.swap);
    expect(round.sabotage(saboteur, 'swap')).toBe(false);
  });

  it('forge the page in the pocket and hide it where the saboteur chooses', () => {
    const { sim, round, saboteur } = game(4);
    const p = sim.players.get(saboteur)!;
    // A real page lying in the open yard.
    const page = sim.spawnPage(realPage(round.target, 3, round.stamp), { x: 6, y: 0, z: 4 });
    for (let t = 0; t < 30; t++) sim.step();
    const at = page.body!.translation();
    lookAt(sim, p, { x: at.x, y: 0, z: at.z + 1 }, at);
    sim.act(saboteur, { kind: 'grab' });
    expect(p.page).toBe(page.id);

    expect(round.sabotage(saboteur, 'forge')).toBe(true);
    expect(isForged(LIGHTHOUSE, page.printed!, round.stamp)).toBe(true);
    expect(page.printed!.stamp).toBe(round.fakeStamp);

    // Hiding needs a hiding place to aim at: there is none in the yard.
    expect(round.sabotage(saboteur, 'hide')).toBe(false);
    expect(p.page).toBe(page.id);
    // Walked up to the fridge, the saboteur puts it there.
    const fridge = [...sim.hideouts.values()].find((h) => h.def.kind === 'fridge')!;
    const front = { x: -Math.sin(fridge.def.facing), z: -Math.cos(fridge.def.facing) };
    const { pos } = fridge.def;
    lookAt(sim, p, { x: pos.x + front.x * 1.2, y: 0, z: pos.z + front.z * 1.2 }, pos);
    expect(round.hidesOnClick(saboteur)).toBe(true);
    expect(round.sabotage(saboteur, 'hide')).toBe(true);
    expect(p.page).toBeNull();
    expect(page.body).toBeNull();
    expect(page.hideout).toBe(fridge.def.id);
    expect(fridge.open).toBe(false);
    expect(fridge.contents).toContain(page.id);
    // With nothing left in the pocket, a click just opens the fridge.
    expect(round.hidesOnClick(saboteur)).toBe(false);
  });

  it('clumsy mode trips into the build and knocks loose what is weakly attached, twice a round', () => {
    const { sim, round, saboteur, run } = game(4);
    const build = sim.build();
    // A wobbly tower of 1x1 bricks on the baseplate.
    sim.addBricks(
      build,
      [1, 4, 7].map((y) => ({
        type: '1x1' as const,
        colour: 'red' as const,
        x: 2,
        y,
        z: 8,
        rot: 0 as const,
      })),
    );
    const size = build.grid.size;
    const top = sim.brickPose(build, [...build.grid.bricks.values()].at(-1)!).pos;
    const p = sim.players.get(saboteur)!;
    lookAt(sim, p, { x: top.x, y: 0, z: top.z + 1 }, top);
    sim.events = [];
    expect(round.sabotage(saboteur, 'clumsy')).toBe(true);
    expect(p.down).toBeGreaterThan(0);
    expect(build.grid.size).toBeLessThan(size);
    // It looks like any other trip: no puff, no rustle.
    expect(sim.events.map((e) => e.kind)).toContain('trip');
    expect(sim.events.some((e) => e.witnessRange !== undefined)).toBe(false);
    expect(round.chargesLeft(saboteur, 'clumsy')).toBe(1);

    run(COOLDOWNS.clumsy * TICK_RATE + 10);
    expect(round.sabotage(saboteur, 'clumsy')).toBe(true);
    run(COOLDOWNS.clumsy * TICK_RATE + 10);
    expect(round.sabotage(saboteur, 'clumsy')).toBe(false);
    expect(round.chargesLeft(saboteur, 'clumsy')).toBe(0);
  });

  it('the barefoot trap leaves bricks that make walkers limp and sprinters fall', () => {
    const { sim, round, saboteur, builders, run } = game(4);
    const s = sim.players.get(saboteur)!;
    s.body.setTranslation({ x: -2.5, y: 0.86, z: -4 }, true);
    s.input.yaw = 0;
    run(5);
    const before = new Set(sim.assemblies.keys());
    expect(round.sabotage(saboteur, 'trap')).toBe(true);
    const dropped = [...sim.assemblies.values()].filter((a) => !before.has(a.id));
    expect(dropped).toHaveLength(3);
    s.body.setTranslation({ x: 12, y: 0.86, z: -12 }, true);
    run(60);

    // Walking straight onto one: a yelp and a limp.
    const walkOnto = (id: number, brick: Vec3, sprint: boolean, careful = false) => {
      const p = sim.players.get(id)!;
      p.body.setTranslation({ x: brick.x, y: 0.86, z: brick.z + 1.2 }, true);
      run(3);
      Object.assign(p.input, { yaw: 0, forward: 1, sprint, careful });
      for (let t = 0; t < 90 && p.limp === 0; t++) run(1);
      return p;
    };
    const walker = walkOnto(builders[0]!, dropped[0]!.body.worldCom(), false);
    expect(walker.limp).toBeGreaterThan(0);
    expect(walker.down).toBe(0);
    // Limping is slow.
    const from = walker.body.translation();
    walker.input.yaw = Math.PI;
    run(60);
    expect(Math.abs(walker.body.translation().z - from.z)).toBeLessThan(2);

    const sprinter = walkOnto(builders[1]!, dropped[2]!.body.worldCom(), true);
    expect(sprinter.limp).toBeGreaterThan(0);
    expect(sprinter.knocks).toBe(1);

    // Walking carefully (Ctrl), slowly, right over one: nothing happens.
    const brick = dropped[1]!.body.worldCom();
    const careful = walkOnto(builders[2]!, brick, false, true);
    expect(careful.limp).toBe(0);
    expect(careful.knocks).toBe(0);
    // Started 1.2 m before it, slowly made it across.
    expect(careful.body.translation().z).toBeLessThan(brick.z);
    expect(careful.body.translation().z).toBeGreaterThan(brick.z - 1.2);
  });

  it('cannot be used during a meeting', () => {
    const { round, saboteur, builders } = game(4);
    round.callMeeting(builders[0]!);
    expect(round.sabotage(saboteur, 'hide')).toBe(false);
  });
});

describe('winning', () => {
  it('builders win by handing in a correct build; time running out favours the saboteur', () => {
    const a = game(4);
    a.sim.addBricks(
      a.sim.build(),
      LIGHTHOUSE.steps.flatMap((s) => s.bricks),
    );
    a.round.finish('done');
    expect(a.round.winner).toBe('builders');
    const b = game(4);
    b.sim.addBricks(
      b.sim.build(),
      LIGHTHOUSE.steps.flatMap((s) => s.bricks),
    );
    b.round.finish('time');
    expect(b.round.winner).toBe('saboteurs');
    const solo = game(1);
    solo.round.finish('done');
    expect(solo.round.winner).toBe('nobody');
  });
});

describe('Room secrets', () => {
  function room(players: number) {
    const inbox = new Map<number, ServerMsg[]>();
    const r = new Room(RAPIER, {
      code: 'TEST',
      send: (id, msg) => inbox.set(id, [...(inbox.get(id) ?? []), decode<ServerMsg>(encode(msg))]),
    });
    const ids = Array.from({ length: players }, (_, i) => {
      const res = r.join(`P${i}`);
      if ('error' in res) throw new Error(res.error);
      return res.id;
    });
    r.handle(ids[0]!, { t: 'start' });
    const msgs = <T extends ServerMsg['t']>(id: number, t: T) =>
      (inbox.get(id) ?? []).filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);
    return { r, ids, msgs };
  }

  it('tells each player only their own role', () => {
    const { r, ids, msgs } = room(4);
    for (const id of ids) {
      const roles = msgs(id, 'role');
      expect(roles).toHaveLength(1);
      expect(roles[0]!.role).toBe(r.round!.role(id));
    }
  });

  it('only shows a saboteur tell to players close by', () => {
    const { r, ids, msgs } = room(3);
    const [a, b, c] = ids as [number, number, number];
    r.sim.players.get(c)!.body.setTranslation({ x: 9, y: 0.86, z: 9 }, true);
    r.update();
    r.sim.events.push({
      kind: 'swap',
      pos: r.sim.players.get(a)!.body.translation(),
      playerId: a,
      witnessRange: 6,
    });
    r.update();
    const saw = (id: number) => msgs(id, 'fx').some((m) => m.events.some((e) => e.kind === 'swap'));
    expect([saw(a), saw(b), saw(c)]).toEqual([true, true, false]);
  });

  it('carries chat only within shouting distance while building', () => {
    const { r, ids, msgs } = room(3);
    const [a, b, c] = ids as [number, number, number];
    r.sim.players.get(c)!.body.setTranslation({ x: 0, y: 0.86, z: 3.5 + CHAT_RANGE + 3 }, true);
    r.update();
    r.handle(a, { t: 'chat', text: 'who has page 4?' });
    expect(msgs(b, 'chat').map((m) => m.text)).toEqual(['who has page 4?']);
    expect(msgs(c, 'chat')).toEqual([]);
  });
});
