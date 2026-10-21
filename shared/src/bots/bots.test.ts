import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { forgePage, realPage } from '../builds/forgery.ts';
import { matchBuild } from '../builds/match.ts';
import type { TargetBrick } from '../builds/types.ts';
import { add, rotate, scale, v3, yawQuat } from '../math.ts';
import { MAX_PLAYERS } from '../net/protocol.ts';
import type { ServerMsg } from '../net/protocol.ts';
import { Room } from '../net/room.ts';
import type { Action, Made } from '../sim/sim.ts';
import { aimAt, loadedPress, machine } from '../sim/testing.ts';
import { partsOf } from './squad.ts';

beforeAll(async () => {
  await RAPIER.init();
});

function setup(seed = 1, rolePicks = false) {
  const inbox = new Map<number, ServerMsg[]>();
  const room = new Room(RAPIER, {
    code: 'BOTS',
    send: (id, msg) => {
      const list = inbox.get(id) ?? [];
      list.push(msg);
      inbox.set(id, list);
    },
    seed,
    rolePicks,
  });
  const lobby = (id: number) =>
    (inbox.get(id) ?? [])
      .filter((m): m is Extract<ServerMsg, { t: 'lobby' }> => m.t === 'lobby')
      .at(-1)!;
  return { room, inbox, lobby };
}

describe('bots in the lobby', () => {
  it('lets the host add bots, fill the room, change their level and take them out', () => {
    const { room, lobby } = setup();
    const host = (room.join('Ada') as { id: number }).id;
    const guest = (room.join('Bob') as { id: number }).id;
    room.handle(guest, { t: 'bots', add: 2 });
    expect(room.botCount).toBe(0);
    room.handle(host, { t: 'bots', add: 2, level: 'hard' });
    expect(room.botCount).toBe(2);
    expect(lobby(guest).players.filter((p) => p.bot)).toHaveLength(2);
    expect(lobby(guest).botLevel).toBe('hard');
    room.handle(host, { t: 'bots', fill: true });
    expect(room.clients.size).toBe(MAX_PLAYERS);
    room.handle(host, { t: 'bots', level: 'expert' });
    expect(
      lobby(guest)
        .players.filter((p) => p.bot)
        .every((p) => p.bot === 'expert'),
    ).toBe(true);
    const bot = lobby(guest).players.find((p) => p.bot)!;
    room.handle(host, { t: 'bots', remove: bot.id });
    expect(room.clients.has(bot.id)).toBe(false);
    // Bots are always ready, and a room of only bots counts as empty.
    expect(
      lobby(guest)
        .players.filter((p) => p.bot)
        .every((p) => p.ready),
    ).toBe(true);
    expect(room.connectedCount).toBe(2);
  });

  it('makes way for a person joining a full lobby', () => {
    const { room } = setup();
    const host = (room.join('Ada') as { id: number }).id;
    room.handle(host, { t: 'bots', fill: true });
    expect(room.clients.size).toBe(MAX_PLAYERS);
    expect(room.listing()?.players).toBe(1);
    const r = room.join('Cleo');
    expect('id' in r).toBe(true);
    expect(room.clients.size).toBe(MAX_PLAYERS);
    expect(room.botCount).toBe(MAX_PLAYERS - 2);
  });
});

describe('bot sides', () => {
  it('deals the saboteur roles to bots, or to people, when asked', () => {
    for (let seed = 1; seed <= 6; seed++) {
      for (const side of ['saboteurs', 'builders'] as const) {
        const { room } = setup(seed);
        const ada = (room.join('Ada') as { id: number }).id;
        room.handle(ada, { t: 'bots', add: 4, side });
        room.handle(ada, { t: 'start' });
        const round = room.round!;
        expect(round.role(ada)).toBe(side === 'saboteurs' ? 'builder' : 'saboteur');
        const bots = [...room.clients.values()].filter((c) => c.bot);
        const sabs = bots.filter((c) => round.role(c.id) === 'saboteur').length;
        expect(sabs).toBe(side === 'saboteurs' ? 1 : 0);
      }
    }
  });
});

describe('picks for each player', () => {
  it("sets one bot's level, and adding more leaves the others as they were", () => {
    const { room, lobby } = setup();
    const ada = (room.join('Ada') as { id: number }).id;
    room.handle(ada, { t: 'bots', add: 2, level: 'easy' });
    const [first, second] = lobby(ada).players.filter((p) => p.bot);
    room.handle(ada, { t: 'pick', id: first!.id, level: 'expert' });
    room.handle(ada, { t: 'bots', add: 1, level: 'hard' });
    const levels = lobby(ada)
      .players.filter((p) => p.bot)
      .map((p) => [p.id, p.bot]);
    expect(levels).toEqual([
      [first!.id, 'expert'],
      [second!.id, 'easy'],
      [expect.any(Number), 'hard'],
    ]);
    // Only the host picks, and only levels the game knows.
    const bob = (room.join('Bob') as { id: number }).id;
    room.handle(bob, { t: 'pick', id: second!.id, level: 'expert' });
    room.handle(ada, { t: 'pick', id: second!.id, level: 'godlike' });
    expect(room.clients.get(second!.id)?.bot).toBe('easy');
  });

  it('deals the roles the host chose in a solo game, the rest at random', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { room, lobby } = setup(seed, true);
      const ada = (room.join('Ada') as { id: number }).id;
      room.handle(ada, { t: 'bots', add: 6 });
      const bots = lobby(ada).players.filter((p) => p.bot);
      room.handle(ada, { t: 'pick', id: ada, role: 'saboteur' });
      room.handle(ada, { t: 'pick', id: bots[0]!.id, role: 'saboteur' });
      room.handle(ada, { t: 'pick', id: bots[1]!.id, role: 'builder' });
      expect(lobby(ada).players.find((p) => p.id === ada)?.role).toBe('saboteur');
      room.handle(ada, { t: 'start' });
      const round = room.round!;
      expect(round.role(ada)).toBe('saboteur');
      expect(round.role(bots[0]!.id)).toBe('saboteur');
      expect(round.role(bots[1]!.id)).toBe('builder');
      // Seven players usually get one saboteur: two were chosen, so there are two.
      expect([...round.roles.values()].filter((r) => r === 'saboteur')).toHaveLength(2);
    }
  });

  it('keeps chosen builders off the saboteur roles, and Random deals as before', () => {
    const { room, lobby } = setup(3, true);
    const ada = (room.join('Ada') as { id: number }).id;
    room.handle(ada, { t: 'bots', add: 2 });
    room.handle(ada, { t: 'settings', saboteurs: 2 });
    for (const p of lobby(ada).players) room.handle(ada, { t: 'pick', id: p.id, role: 'builder' });
    room.handle(ada, { t: 'pick', id: ada, role: 'random' });
    expect(lobby(ada).players.find((p) => p.id === ada)?.role).toBeUndefined();
    room.handle(ada, { t: 'start' });
    const round = room.round!;
    // Two saboteurs asked for, but the bots must build: only Ada is left to sabotage.
    expect(round.role(ada)).toBe('saboteur');
    expect([...round.roles.values()].filter((r) => r === 'saboteur')).toHaveLength(1);
  });

  it('starts added bots on the side "Bots play as" names, in a solo game', () => {
    const { room, lobby } = setup(2, true);
    const ada = (room.join('Ada') as { id: number }).id;
    const roles = () =>
      lobby(ada)
        .players.filter((p) => p.bot)
        .map((p) => p.role);
    room.handle(ada, { t: 'bots', side: 'builders' });
    room.handle(ada, { t: 'bots', add: 3 });
    expect(roles()).toEqual(['builder', 'builder', 'builder']);
    // Bots playing the saboteurs take the saboteur places (one for a group of four), then build.
    room.handle(ada, { t: 'bots', side: 'saboteurs' });
    expect(roles()).toEqual(['saboteur', 'builder', 'builder']);
    room.handle(ada, { t: 'settings', saboteurs: 2 });
    room.handle(ada, { t: 'bots', add: 1 });
    expect(roles()).toEqual(['saboteur', 'builder', 'builder', 'saboteur']);
    room.handle(ada, { t: 'start' });
    expect(room.round!.role(ada)).toBe('builder');
    // Either side: back to Random.
    const again = setup(2, true);
    const bob = (again.room.join('Bob') as { id: number }).id;
    again.room.handle(bob, { t: 'bots', add: 2, side: 'builders' });
    again.room.handle(bob, { t: 'bots', side: 'any' });
    expect(
      again
        .lobby(bob)
        .players.filter((p) => p.bot)
        .map((p) => p.role),
    ).toEqual([undefined, undefined]);
  });

  it('ignores role picks in a room with other people in it', () => {
    const { room, lobby } = setup(1);
    const ada = (room.join('Ada') as { id: number }).id;
    room.join('Bob');
    room.handle(ada, { t: 'pick', id: ada, role: 'saboteur' });
    expect(lobby(ada).rolePicks).toBe(false);
    expect(lobby(ada).players.find((p) => p.id === ada)?.role).toBeUndefined();
  });
});

describe('bots playing', () => {
  it('finish a small build together', { timeout: 120_000 }, () => {
    const { room } = setup(7);
    room.mode = 'coop';
    room.build = 'race-car';
    for (let i = 0; i < 4; i++) room.addBot('normal');
    room.startRound();
    const round = room.round!;
    for (let t = 0; t < 600 * 60 && room.phase === 'building'; t++) room.update();
    expect(round.winner).toBe('builders');
    expect(matchBuild(round.target, room.sim.build().grid).counts.wrong).toBe(0);
  });

  it('build a forged page as it says when they miss its stamp', { timeout: 120_000 }, () => {
    const { room } = setup(7);
    room.mode = 'coop';
    room.build = 'race-car';
    for (let i = 0; i < 4; i++) room.addBot('normal');
    room.startRound();
    const round = room.round!;
    // The last page is forged on the board once the bots have read it, and nobody looks closely
    // at stamps.
    const last = round.target.steps.length - 1;
    const page = [...room.sim.pages.values()].find((pg) => pg.printed?.step === last)!;
    for (let t = 0; t < 600 * 60 && !room.squad.teams[0]?.notes.has(last); t++) room.update();
    expect(room.squad.teams[0]!.notes.has(last)).toBe(true);
    const fake = forgePage(round.target, last, round.fakeStamp, () => 0.5);
    page.printed = fake;
    for (const bot of room.squad.bots.values()) {
      const b = bot as unknown as { skill: object };
      b.skill = { ...b.skill, spot: 0 };
    }
    const odd = fake.added.find(
      (b, i) => b.colour !== round.target.steps[last]!.bricks[i]!.colour,
    )!;
    for (let t = 0; t < 600 * 60 && room.phase === 'building'; t++) room.update();
    const placed = [...room.sim.build().grid.bricks.values()].find(
      (b) => b.type === odd.type && b.x === odd.x && b.y === odd.y && b.z === odd.z,
    );
    expect(placed?.colour).toBe(odd.colour);
  });
});

describe('what the bots know of the pages', () => {
  function teamRound() {
    const { room } = setup(7);
    room.mode = 'coop';
    room.build = 'race-car';
    room.addBot('normal');
    room.startRound();
    room.update();
    room.update();
    return { room, round: room.round!, team: room.squad.teams[0]! };
  }

  it('matches the build again when a page they were told turns out forged', () => {
    const { room, round, team } = teamRound();
    const fake = forgePage(round.target, 0, round.fakeStamp, () => 0.5);
    team.tell(fake, 99);
    const before = team.match()!;
    expect(before.known.steps[0]!.bricks).toEqual(fake.added);
    // The real page, told after: the same number of bricks, one of another colour.
    team.tell(realPage(round.target, 0, round.stamp), 99);
    const after = team.match()!;
    expect(after.known.steps[0]!.bricks).toEqual(round.target.steps[0]!.bricks);
    expect(after.result).toEqual(matchBuild(after.known, room.sim.build().grid));
  });

  it('puts the odd colour back on a forged page, printed parts too', () => {
    const { team } = teamRound();
    const brick = (colour: 'red' | 'blue', x: number): TargetBrick => ({
      type: '2x4',
      colour,
      x,
      y: 0,
      z: 0,
      rot: 0,
      prints: { front: 'star' },
    });
    team.index = [partsOf([brick('red', 0), brick('red', 4)])];
    expect(team.mend(0, [brick('red', 0), brick('blue', 4)])).toEqual([
      brick('red', 0),
      brick('red', 4),
    ]);
  });
});

describe('bots and a build carried off its job site', () => {
  it('work on it where it is without knocking it about', { timeout: 120_000 }, () => {
    // A bot landing on the loose build now and then knocks a few bricks off whatever it plays
    // like, or gets stuck on a roof plate it cannot put on (seeds 3 and 8 do since the brick
    // works leave what they make in their output areas, and 4 since bots walk up to the
    // machines they work): this seed plays clear of that.
    const { room } = setup(6);
    const ada = (room.join('Ada') as { id: number }).id;
    room.mode = 'coop';
    room.build = 'cottage';
    for (let i = 0; i < 3; i++) room.addBot('normal');
    room.startRound();
    const sim = room.sim;
    for (let t = 0; t < 60 * 60; t++) room.update();
    // Ada lifts the build onto the inspector pad and walks off.
    const build = sim.build();
    (sim as unknown as { setAnchored(a: typeof build, on: boolean): void }).setAnchored(
      build,
      false,
    );
    const pad = sim.sites[0]!.inspector.pos;
    const c = sim.buildCentre(build);
    const p = build.body.translation();
    build.body.setTranslation({ x: p.x + pad.x - c.x, y: p.y + 0.3, z: p.z + pad.z - c.z }, true);
    sim.players.get(ada)!.body.setTranslation({ x: 30, y: 1, z: 30 }, true);
    let size = build.grid.size;
    let worst = 0;
    for (let t = 0; t < 500 * 60 && room.phase === 'building'; t++) {
      room.update();
      worst = Math.max(worst, size - sim.build().grid.size);
      size = sim.build().grid.size;
    }
    // Bricks come off one at a time (a wrong one taken off), never knocked off in a heap.
    expect(worst).toBeLessThanOrEqual(1);
    expect(room.round!.winner).toBe('builders');
  });
});

describe('bots at the brick works', () => {
  /** What of a bot these tests reach into, to give it one thing to do. */
  interface Inside {
    id: number;
    job: Generator<void, unknown> | null;
    stop(): void;
    halt(): void;
    collect(id: number, wanted: Made, order: Action): Generator<void, boolean>;
  }

  /** A race-car round with Ada (out of the way) and bots that stand still until given a job. */
  function works(bots: number) {
    const { room } = setup(3);
    const ada = (room.join('Ada') as { id: number }).id;
    room.mode = 'coop';
    room.build = 'race-car';
    for (let i = 0; i < bots; i++) room.addBot('normal');
    room.startRound();
    while (room.round!.starting) room.update();
    room.update();
    const sim = room.sim;
    sim.players.get(ada)!.body.setTranslation({ x: 30, y: 1, z: 30 }, true);
    const run = (until: () => boolean, seconds = 60): void => {
      for (let t = 0; t < seconds * 60 && !until(); t++) room.update();
    };
    /** Has a bot do one thing and then stand still: `result` says how it went, once it is done. */
    const give = (b: Inside, job: () => Generator<void, boolean>) => {
      const done: { result?: boolean } = {};
      b.stop();
      b.halt();
      b.job = (function* () {
        done.result = yield* job();
        for (;;) yield;
      })();
      return done;
    };
    const idle = function* (): Generator<void, boolean> {
      yield;
      return true;
    };
    const inside = [...room.squad.bots.values()] as unknown as Inside[];
    for (const b of inside) give(b, idle);
    return { room, sim, ada, bots: inside, run, give, idle };
  }

  const blue = { kind: 'bucket', colour: 'blue' } as const;
  const fillBlue = { kind: 'fill', colour: 'blue' } as const;

  it(
    'leave what a person ordered for them a while, then clear it if nobody comes',
    { timeout: 60_000 },
    () => {
      const { room, sim, ada, bots, run, give } = works(2);
      const [one, two] = bots as [Inside, Inside];
      const silo = machine(sim, 'silo');
      // Ada has the silo fill a red bucket, and goes off to see to something else meanwhile.
      const p = sim.players.get(ada)!;
      p.body.setTranslation(silo.stand, true);
      room.update();
      aimAt(sim, p, silo.target);
      const { yaw, pitch } = p.input;
      const red = { kind: 'bucket', colour: 'red' } as const;
      room.handle(ada, {
        t: 'act',
        a: { kind: 'fill', colour: 'red' },
        seq: 0,
        yaw,
        pitch,
        fp: true,
      });
      run(() => !!silo.m.out[0]);
      const landed = room.squad.tick;
      p.body.setTranslation({ x: 30, y: 1, z: 30 }, true);
      expect(silo.m.out[0]).toEqual(red);
      // A bot that wants blue waits its turn, and one that wants red does not take hers: before
      // long both give up, leaving it there.
      const jobs = [
        give(one, () => one.collect(silo.m.def.id, red, { kind: 'fill', colour: 'red' })),
        give(two, () => two.collect(silo.m.def.id, blue, fillBlue)),
      ];
      run(() => jobs.every((j) => j.result !== undefined));
      expect(jobs.map((j) => j.result)).toEqual([false, false]);
      run(() => room.squad.tick - landed > 20 * 60);
      expect(silo.m.out[0]).toEqual(red);
      // Nobody came for it: now a bot takes it out of the way to fill its own.
      const job = give(two, () => two.collect(silo.m.def.id, blue, fillBlue));
      run(() => job.result !== undefined);
      expect(job.result).toBe(true);
      expect(sim.players.get(two.id)!.tool).toEqual(blue);
      expect(silo.m.out[0]).toBeNull();
    },
  );

  it('leave what lies in a machine that cannot make what they want', { timeout: 60_000 }, () => {
    const { sim, bots, run, give, idle } = works(1);
    const bot = bots[0]!;
    const silo = machine(sim, 'silo');
    // A red bucket the bot had filled, then went off to do something else.
    give(bot, () =>
      bot.collect(
        silo.m.def.id,
        { kind: 'bucket', colour: 'red' },
        { kind: 'fill', colour: 'red' },
      ),
    );
    run(() => !!silo.m.making);
    give(bot, idle);
    run(() => !!silo.m.out[0]);
    const red = silo.m.out[0];
    expect(red).toEqual({ kind: 'bucket', colour: 'red' });
    const tryBlue = (meanwhile = () => {}) => {
      const job = give(bot, () => bot.collect(silo.m.def.id, blue, fillBlue));
      run(() => false, 1);
      meanwhile();
      run(() => job.result !== undefined);
      return job.result;
    };
    // Without power, or jammed, the silo fills nothing: the red one stays where it is.
    sim.breakPower();
    expect(tryBlue()).toBe(false);
    expect(silo.m.out[0]).toBe(red);
    sim.restorePower();
    silo.m.jammed = true;
    expect(tryBlue()).toBe(false);
    expect(silo.m.out[0]).toBe(red);
    silo.m.jammed = false;
    // The same if the power goes while it waits for someone to come for the red one.
    expect(tryBlue(() => sim.breakPower())).toBe(false);
    expect(silo.m.out[0]).toBe(red);
    sim.restorePower();
    expect(tryBlue()).toBe(true);
    expect(sim.players.get(bot.id)!.tool).toEqual(blue);
  });

  it(
    'do not both wait for the one part they clicked for at the same time',
    { timeout: 60_000 },
    () => {
      const { room, sim, bots, run, give } = works(2);
      const press = loadedPress(sim, '2x4', 'red');
      // The two bots side by side in front of the moulding machine.
      const side = rotate(yawQuat(press.m.def.facing), v3(0.35, 0, 0));
      bots.forEach((b, i) => {
        sim.players.get(b.id)!.body.setTranslation(add(press.stand, scale(side, i ? 1 : -1)), true);
      });
      run(() => false, 0.5);
      const orders: number[] = [];
      const handle = room.handle.bind(room);
      room.handle = (id, msg) => {
        if (msg.t === 'act' && msg.a.kind === 'grab' && !msg.a.output) orders.push(room.squad.tick);
        handle(id, msg);
      };
      const part = { kind: 'part', type: '2x4', colour: 'red' } as const;
      const jobs = bots.map((b) =>
        give(b, () => b.collect(press.m.def.id, part, { kind: 'grab' })),
      );
      let twice = 0;
      run(() => {
        const places = [...room.squad.collecting.values()].map((c) => `${c.machine}|${c.slot}`);
        if (new Set(places).size < places.length) twice++;
        return jobs.every((j) => j.result !== undefined);
      });
      // Both clicked for a part at once, and the machine made one: one bot waits for it, and the
      // other has its own made after.
      expect(orders.length).toBeGreaterThan(1);
      expect(orders[1]).toBe(orders[0]);
      expect(twice).toBe(0);
      expect(jobs.map((j) => j.result)).toEqual([true, true]);
      for (const b of bots) expect(sim.players.get(b.id)!.holding).not.toBeNull();
      // Nothing more made than they took.
      expect(press.m.out.every((x) => x === null) && !press.m.making).toBe(true);
    },
  );

  it('let go of what they wait for when sent home', { timeout: 60_000 }, () => {
    const { room, sim, bots, run, give } = works(2);
    const [a, b] = bots as [Inside, Inside];
    const silo = machine(sim, 'silo');
    give(a, () => a.collect(silo.m.def.id, blue, fillBlue));
    run(() => room.squad.collecting.has(a.id));
    expect(room.squad.collecting.has(a.id)).toBe(true);
    // Voted off while the silo fills its bucket.
    sim.removePlayer(a.id);
    room.update();
    expect(room.squad.collecting.has(a.id)).toBe(false);
    run(() => !!silo.m.out[0]);
    // The bucket is anyone's now: the other bot takes it.
    const job = give(b, () => b.collect(silo.m.def.id, blue, fillBlue));
    run(() => job.result !== undefined);
    expect(job.result).toBe(true);
    expect(sim.players.get(b.id)!.tool).toEqual(blue);
  });
});

describe('bots in the chat', () => {
  function round() {
    const { room, inbox } = setup(3);
    const ada = (room.join('Ada') as { id: number }).id;
    room.handle(ada, { t: 'bots', add: 3 });
    room.handle(ada, { t: 'settings', saboteurs: 0 });
    room.handle(ada, { t: 'start' });
    while (room.round!.starting) room.update();
    for (let t = 0; t < 30; t++) room.update();
    const bots = [...room.clients.values()].filter((c) => c.bot);
    // Everyone within earshot of Ada.
    const at = room.sim.players.get(ada)!.body.translation();
    bots.forEach((b, i) =>
      room.sim.players.get(b.id)!.body.setTranslation({ x: at.x + 1 + i, y: at.y, z: at.z }, true),
    );
    const said = () =>
      (inbox.get(ada) ?? []).filter(
        (m): m is Extract<ServerMsg, { t: 'chat' }> => m.t === 'chat' && m.from !== ada,
      );
    const run = (seconds: number) => {
      for (let t = 0; t < seconds * 60; t++) room.update();
    };
    return { room, ada, bots, said, run };
  }

  it('weighs what people claim, and the accused bot answers', () => {
    const { room, ada, bots, said, run } = round();
    const [a, b] = bots;
    room.handle(ada, { t: 'chat', text: `I saw ${b!.name} swap a brick!` });
    expect(room.squad.suspicion.get(b!.id)).toBeGreaterThan(0.3);
    // The bot blamed doubts whoever blamed it.
    expect(room.squad.suspicion.get(ada)).toBeGreaterThan(0);
    run(5);
    expect(said().some((m) => m.from === b!.id && /not me/i.test(m.text))).toBe(true);
    // Asked who it suspects, a bot gives the name and the reason.
    room.handle(ada, { t: 'chat', text: `${a!.name}, who do you think it is?` });
    run(5);
    const answer = said().find((m) => m.from === a!.id && /suspect|maybe/i.test(m.text));
    expect(answer?.text).toContain(b!.name);
    expect(answer?.text).toContain('Ada saw them swap a brick');
  });

  it('answers where a page is, and runs errands', () => {
    const { room, ada, bots, said, run } = round();
    const page = [...room.sim.pages.values()].find((p) => p.printed && p.printed.step === 0)!;
    room.sim.pages.get(page.id)!.carriedBy = bots[2]!.id;
    room.handle(ada, { t: 'chat', text: `${bots[0]!.name}, where is page 1?` });
    run(5);
    expect(
      said().some((m) => m.from === bots[0]!.id && m.text === `${bots[2]!.name} has it.`),
    ).toBe(true);
    room.handle(ada, { t: 'chat', text: `${bots[1]!.name}, come here` });
    run(2);
    expect(room.squad.bots.get(bots[1]!.id)!.doing).toBe('come over');
  });

  it('lets go of the panel when it drops the job for an errand', () => {
    const { room, ada, run } = round();
    room.sim.breakPower();
    run(1);
    const fixer = room.squad.panelBy;
    expect(fixer).not.toBeNull();
    expect(room.squad.bots.get(fixer!)!.doing).toBe('fix the panel');
    room.handle(ada, { t: 'chat', text: `${room.clients.get(fixer!)!.name}, come here` });
    run(2);
    expect(room.squad.bots.get(fixer!)!.doing).toBe('come over');
    // Free for another bot to see to.
    expect(room.squad.panelBy).not.toBe(fixer);
  });

  it('only blames a forger it can see, not one behind a wall', () => {
    const { room, ada, bots } = round();
    const sim = room.sim;
    const bot = bots[0]!;
    const at = sim.players.get(ada)!.body.translation();
    const forge = () => {
      const pos = sim.players.get(ada)!.body.translation();
      room.squad.witness([{ kind: 'forge', pos, playerId: ada, witnessRange: 6 }]);
    };
    // Close by and in plain view: it saw.
    sim.players.get(bot.id)!.body.setTranslation({ x: at.x + 3, y: at.y, z: at.z }, true);
    room.update();
    forge();
    expect(room.squad.suspicion.get(ada) ?? 0).toBeGreaterThan(0.9);

    // Just as close, but with a wall in between: it did not.
    room.squad.suspicion.clear();
    const R = RAPIER;
    const wall = sim.world.createRigidBody(R.RigidBodyDesc.fixed());
    const c = sim.world.createCollider(
      R.ColliderDesc.cuboid(0.1, 3, 3).setTranslation(at.x + 1.5, at.y, at.z),
      wall,
    );
    (sim as unknown as { owners: Map<number, { kind: string }> }).owners.set(c.handle, {
      kind: 'static',
    });
    room.update();
    sim.players.get(ada)!.body.setTranslation(at, true);
    sim.players.get(bot.id)!.body.setTranslation({ x: at.x + 3, y: at.y, z: at.z }, true);
    room.update();
    forge();
    expect(room.squad.suspicion.get(ada) ?? 0).toBe(0);
  });

  it('pays no heed to bots, or to people out of earshot', () => {
    const { room, ada, bots } = round();
    room.handle(bots[0]!.id, { t: 'chat', text: `I saw ${bots[1]!.name} swap a brick!` });
    expect(room.squad.suspicion.get(bots[1]!.id) ?? 0).toBe(0);
    room.sim.players.get(ada)!.body.setTranslation({ x: 40, y: 1, z: 40 }, true);
    room.handle(ada, { t: 'chat', text: `I saw ${bots[1]!.name} swap a brick!` });
    expect(room.squad.suspicion.get(bots[1]!.id) ?? 0).toBe(0);
  });
});

describe('bots in free build', () => {
  it('keep out of the way and never press Done', () => {
    const { room } = setup(2);
    const ada = (room.join('Ada') as { id: number }).id;
    room.handle(ada, { t: 'settings', mode: 'free' });
    room.handle(ada, { t: 'bots', add: 2 });
    room.handle(ada, { t: 'start' });
    for (let t = 0; t < 60 * 60; t++) room.update();
    expect(room.phase).toBe('building');
    expect([...room.squad.bots.values()].every((b) => b.doing === 'wait' || b.doing === '')).toBe(
      true,
    );
  });
});
