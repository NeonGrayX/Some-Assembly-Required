import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { HOUSE } from '../content/house.ts';
import { makeRng } from '../math.ts';
import { BUILDS } from '../builds/catalog.ts';
import { CASTLE } from '../builds/castle.ts';
import { GIANT_DUCK } from '../builds/duck.ts';
import { matchBuild } from '../builds/match.ts';
import { RANDOM_BUILD, decode, encode } from './protocol.ts';
import type { ClientMsg, ServerMsg } from './protocol.ts';
import { RECONNECT_GRACE_TICKS, Room } from './room.ts';

beforeAll(async () => {
  await RAPIER.init();
});

function setup() {
  const inbox = new Map<number, ServerMsg[]>();
  let n = 0;
  const room = new Room(RAPIER, {
    code: 'TEST',
    // Round-trip through the real codec so everything sent must survive the wire.
    send: (id, msg) => {
      const list = inbox.get(id) ?? [];
      list.push(decode<ServerMsg>(encode(msg)));
      inbox.set(id, list);
    },
    token: () => `token${++n}`,
  });
  const join = (name: string, token?: string) => {
    const r = room.join(name, token);
    if ('error' in r) throw new Error(r.error);
    return r.id;
  };
  const msgs = <T extends ServerMsg['t']>(id: number, t: T) =>
    (inbox.get(id) ?? []).filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) room.update();
  };
  const say = (id: number, msg: ClientMsg) => room.handle(id, decode<ClientMsg>(encode(msg)));
  return { room, inbox, join, msgs, run, say };
}

describe('Room', () => {
  it('welcomes players and shares the lobby and the world', () => {
    const { room, join, msgs } = setup();
    const a = join('Ada');
    const b = join('Bob');
    expect(room.hostId).toBe(a);
    expect(msgs(b, 'welcome')[0]).toMatchObject({ you: b, room: 'TEST' });
    const lobby = msgs(a, 'lobby').at(-1)!;
    expect(lobby.players.map((p) => p.name)).toEqual(['Ada', 'Bob']);
    expect(lobby.players[0]!.colour).not.toBe(lobby.players[1]!.colour);
    const world = msgs(b, 'world')[0]!;
    expect(world.phase).toBe('lobby');
    expect(world.assemblies.map((x) => x.id)).toContain(world.buildId);
  });

  it('answers a ping right away, only to the one who asked', () => {
    const { join, msgs, say } = setup();
    const a = join('Ada');
    const b = join('Bob');
    say(a, { t: 'ping', n: 7 });
    // No tick in between: the answer does not wait for the simulation.
    expect(msgs(a, 'pong')).toEqual([{ t: 'pong', n: 7 }]);
    expect(msgs(b, 'pong')).toEqual([]);
  });

  it('passes voice handshakes to the one player they are for, cleaned', () => {
    const { room, join, msgs, say } = setup();
    const a = join('Ada');
    const b = join('Bob');
    const c = join('Cy');
    const offer = { sdp: { type: 'offer' as const, sdp: 'v=0 fake' } };
    say(a, { t: 'signal', to: b, data: offer });
    expect(msgs(b, 'signal')).toEqual([{ t: 'signal', from: a, data: offer }]);
    expect(msgs(c, 'signal')).toEqual([]);
    expect(msgs(a, 'signal')).toEqual([]);

    // Extra fields are dropped; odd shapes, oversized blobs and other targets go nowhere.
    const ice = {
      candidate: 'candidate:1 1 udp 1 10.0.0.2 5000 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
    };
    say(b, { t: 'signal', to: a, data: { ice: { ...ice, junk: 'x' } } as never });
    expect(msgs(a, 'signal').at(-1)!.data).toEqual({ ice });
    const bad: unknown[] = [
      { sdp: { type: 'pranswer', sdp: 'x' } },
      { sdp: { type: 'offer', sdp: 'x'.repeat(30_000) } },
      { ice: { candidate: 7 } },
      'hello',
      null,
    ];
    for (const data of bad) say(a, { t: 'signal', to: b, data: data as never });
    say(a, { t: 'signal', to: a, data: offer });
    say(a, { t: 'signal', to: 99, data: offer });
    room.disconnect(c);
    say(a, { t: 'signal', to: c, data: offer });
    expect(msgs(b, 'signal')).toHaveLength(1);
    expect(msgs(a, 'signal')).toHaveLength(1);
    expect(msgs(c, 'signal')).toHaveLength(0);
  });

  it('tells each player which STUN and TURN servers to use', () => {
    let n = 0;
    const inbox: ServerMsg[] = [];
    const room = new Room(RAPIER, {
      code: 'ICE',
      send: (_id, msg) => inbox.push(decode<ServerMsg>(encode(msg))),
      ice: () => [{ urls: 'turn:example.org', username: `u${++n}`, credential: 'c' }],
    });
    room.join('Ada');
    room.join('Bob');
    const welcomes = inbox.filter((m) => m.t === 'welcome');
    expect(welcomes.map((w) => w.ice[0]!.username)).toEqual(['u1', 'u2']);
  });

  it('moves players from their inputs and acknowledges them in snapshots', () => {
    const { room, join, msgs, run, say } = setup();
    const a = join('Ada');
    run(30);
    const start = room.sim.players.get(a)!.body.translation();
    for (let seq = 1; seq <= 60; seq++) {
      say(a, {
        t: 'input',
        seq,
        f: 1,
        r: 0,
        jump: false,
        sprint: false,
        yaw: 0,
        pitch: 0,
        fp: false,
      });
      run(1);
    }
    const end = room.sim.players.get(a)!.body.translation();
    expect(start.z - end.z).toBeGreaterThan(2.5);
    const snap = msgs(a, 'snap').at(-1)!;
    expect(snap.ack).toBe(60);
    expect(snap.players.find((p) => p[0] === a)![3]).toBeCloseTo(end.z, 2);
  });

  it('moves exactly one tick per input, however unevenly the inputs arrive', () => {
    // A client predicts one tick of movement per input; the server must match it exactly, or
    // the client gets snapped back and forth (the periodic stutter).
    const { room, join, run, say } = setup();
    const a = join('Ada');
    run(30);
    const p = room.sim.players.get(a)!;
    const start = p.body.translation().x;
    const rng = makeRng(3);
    let seq = 0;
    while (seq < 100) {
      const burst = Math.floor(rng() * 4);
      for (let i = 0; i < burst && seq < 100; i++) {
        say(a, {
          t: 'input',
          seq: ++seq,
          f: 1,
          r: 0,
          jump: false,
          sprint: false,
          yaw: -Math.PI / 2,
          pitch: 0,
          fp: false,
        });
      }
      run(1);
    }
    run(60);
    const steps = (p.body.translation().x - start) / (3.5 / 60);
    expect(steps).toBeCloseTo(100, 2);
  });

  it('only lets the host change settings and start, then hides the pages', () => {
    const { room, join, msgs, run, say } = setup();
    const a = join('Ada');
    const b = join('Bob');
    say(b, { t: 'start' });
    expect(room.phase).toBe('lobby');
    say(a, { t: 'settings', seconds: 300 });
    say(a, { t: 'settings', seconds: 7 }); // not an allowed length
    expect(room.seconds).toBe(300);
    say(a, { t: 'start' });
    expect(room.phase).toBe('building');
    const world = msgs(b, 'world').at(-1)!;
    expect(world.pages).toHaveLength(world.target!.steps.length + 1); // and the master index
    expect(world.round?.timeLeft).toBe(300);
    run(6);
    expect(msgs(b, 'snap').at(-1)!.round!.timeLeft).toBeLessThan(300);
  });

  it('plays the build the host picks, and tells every player which one', () => {
    const { join, msgs, say } = setup();
    const a = join('Ada');
    const b = join('Bob');
    say(b, { t: 'settings', build: 'rocket' }); // not the host
    expect(msgs(a, 'lobby').at(-1)!.build).toBe(RANDOM_BUILD);
    say(a, { t: 'settings', build: 'no-such-build' });
    expect(msgs(a, 'lobby').at(-1)!.build).toBe(RANDOM_BUILD);
    say(a, { t: 'settings', build: 'giant-duck' });
    expect(msgs(b, 'lobby').at(-1)!.build).toBe('giant-duck');
    say(a, { t: 'start' });
    for (const id of [a, b]) {
      const world = msgs(id, 'world').at(-1)!;
      expect(world.targetId).toBe('giant-duck');
      expect(world.target!.steps.flatMap((s) => s.bricks)).toHaveLength(
        GIANT_DUCK.steps.flatMap((s) => s.bricks).length,
      );
    }
  });

  it('picks a random build each round that every player agrees on, never the same twice', () => {
    const { room, join, msgs } = setup();
    const a = join('Ada');
    const b = join('Bob');
    const seen = new Set<string>();
    let last = '';
    for (let i = 0; i < 12; i++) {
      room.startRound();
      const ids = [a, b].map((id) => msgs(id, 'world').at(-1)!.targetId);
      expect(ids[0]).toBe(ids[1]);
      expect(ids[0]).not.toBe(last);
      last = ids[0]!;
      seen.add(last);
    }
    // Each round builds a new world, so a dozen rounds is all a test can afford: enough to see
    // the picks spread over most of the builds.
    expect(seen.size).toBeGreaterThanOrEqual(Math.min(BUILDS.length, 7));
    for (const id of seen) expect(BUILDS.map((x) => x.id)).toContain(id);
  }, 20_000);

  it('plays the round at the time of day the host picked, the same for everyone', () => {
    const { room, join, msgs, run, say } = setup();
    const a = join('Ada');
    const b = join('Bob');
    say(b, { t: 'settings', time: 'night' });
    expect(room.time).toBe('day');
    say(a, { t: 'settings', time: 'night' });
    expect(msgs(b, 'lobby').at(-1)!.time).toBe('night');
    say(a, { t: 'start' });
    expect(msgs(a, 'world').at(-1)!.night).toBe(true);
    expect(msgs(b, 'world').at(-1)!.night).toBe(true);
    // Random picks afresh each round, and over a few rounds lands on both.
    const nights = new Set<boolean>();
    for (let i = 0; i < 12; i++) {
      room.round!.finish('done');
      run(1);
      say(a, { t: 'again' });
      say(a, { t: 'settings', time: 'random' });
      say(a, { t: 'start' });
      nights.add(msgs(b, 'world').at(-1)!.night);
    }
    expect(nights).toEqual(new Set([true, false]));
  });

  it('runs actions with the angles the player clicked at, and tells everyone', () => {
    const { room, join, msgs, run, say } = setup();
    const a = join('Ada');
    const b = join('Bob');
    run(30);
    // Stand in front of the first bin and look at it.
    const bin = HOUSE.bins[0]!;
    const p = room.sim.players.get(a)!;
    p.body.setTranslation({ x: bin.pos.x, y: 0.86, z: bin.pos.z + 1.4 }, true);
    run(3);
    const eye = room.sim.eye(p);
    const yaw = Math.atan2(-(bin.pos.x - eye.x), -(bin.pos.z - eye.z));
    const pitch = Math.atan2(0.6 - eye.y, Math.hypot(bin.pos.x - eye.x, bin.pos.z - eye.z));
    say(a, { t: 'act', a: { kind: 'grab' }, seq: 0, yaw, pitch, fp: true });
    run(3);
    const created = msgs(b, 'asm').find((m) => m.a.heldBy === a);
    expect(created?.a.bricks[0]).toMatchObject([
      expect.any(Number),
      bin.type,
      bin.colour,
      0,
      0,
      0,
      0,
    ]);
    expect(msgs(b, 'fx').some((m) => m.events.some((e) => e.kind === 'grab'))).toBe(true);
    // The brick moves with the player, so it shows up in snapshots.
    const snap = msgs(b, 'snap').at(-1)!;
    expect(snap.players.find((x) => x[0] === a)![6]).toBe(created!.a.id);
  });

  it('holds an action until the input it was made after has been applied', () => {
    const { room, join, run, say } = setup();
    const a = join('Ada');
    run(30);
    const p = room.sim.players.get(a)!;
    const bin = HOUSE.bins[0]!;
    p.body.setTranslation({ x: bin.pos.x, y: 0.86, z: bin.pos.z + 3 }, true);
    run(3);
    // The action is sent right after input 3, before the server has applied any of them.
    const inputs = [1, 2, 3].map((seq) => ({
      t: 'input' as const,
      seq,
      f: 1,
      r: 0,
      jump: false,
      sprint: false,
      yaw: 0,
      pitch: 0,
      fp: true,
    }));
    for (const i of inputs) say(a, i);
    say(a, { t: 'act', a: { kind: 'rotate' }, seq: 3, yaw: 0, pitch: 0, fp: true });
    room.update();
    expect(room.clients.get(a)!.actions).toHaveLength(1); // waiting for input 3
    run(2);
    expect(room.clients.get(a)!.actions).toHaveLength(0);
  });

  it('keeps a dropped player for a reconnect, then removes them', () => {
    const { room, join, msgs, run } = setup();
    const a = join('Ada');
    const b = join('Bob');
    room.disconnect(b);
    expect(
      msgs(a, 'lobby')
        .at(-1)!
        .players.find((p) => p.id === b)!.connected,
    ).toBe(false);
    run(60);
    expect(join('Bob again', 'token2')).toBe(b);
    expect(room.sim.players.has(b)).toBe(true);
    room.disconnect(a);
    run(RECONNECT_GRACE_TICKS + 1);
    expect(room.clients.has(a)).toBe(false);
    expect(room.sim.players.has(a)).toBe(false);
    expect(room.hostId).toBe(b);
  });

  it('reports the result and goes back to the lobby', () => {
    const { room, join, msgs, run, say } = setup();
    const a = join('Ada');
    say(a, { t: 'settings', seconds: 300 });
    say(a, { t: 'start' });
    room.round!.finish('done');
    run(1);
    expect(room.phase).toBe('results');
    expect(msgs(a, 'result')[0]!.result.counts.total).toBe(
      room.round!.target.steps.flatMap((s) => s.bricks).length,
    );
    say(a, { t: 'again' });
    expect(room.phase).toBe('lobby');
    expect(msgs(a, 'world').at(-1)!.pages).toHaveLength(0);
  });
});

describe('Room demo mode', () => {
  it('starts a round with the picked build, time of day and role', () => {
    const { room, join, msgs } = setup();
    const a = join('Ada');
    room.demoRound({ build: GIANT_DUCK.id, night: true, role: 'saboteur', pinned: false });
    expect(room.phase).toBe('building');
    expect(room.target.id).toBe(GIANT_DUCK.id);
    expect(msgs(a, 'world').at(-1)!.night).toBe(true);
    expect(msgs(a, 'role').at(-1)!.role).toBe('saboteur');
    room.demoRound({ build: GIANT_DUCK.id, night: false, role: 'builder', pinned: false });
    expect(msgs(a, 'world').at(-1)!.night).toBe(false);
    expect(msgs(a, 'role').at(-1)!.role).toBe('builder');
  });

  it('switches role mid-round, with every saboteur tool ready', () => {
    const { room, join, msgs, run, say } = setup();
    const a = join('Ada');
    room.demoRound({ build: GIANT_DUCK.id, night: false, role: 'builder', pinned: false });
    run(2);
    say(a, {
      t: 'act',
      a: { kind: 'sabotage', tool: 'clumsy' },
      seq: 0,
      yaw: 0,
      pitch: 0,
      fp: false,
    });
    run(2);
    expect(msgs(a, 'sabotaged')).toHaveLength(0);
    room.demoRole(a, 'saboteur');
    expect(room.round!.role(a)).toBe('saboteur');
    expect(msgs(a, 'role').at(-1)!.role).toBe('saboteur');
    say(a, {
      t: 'act',
      a: { kind: 'sabotage', tool: 'clumsy' },
      seq: 0,
      yaw: 0,
      pitch: 0,
      fp: false,
    });
    run(2);
    expect(msgs(a, 'sabotaged').at(-1)!.tool).toBe('clumsy');
    // Switching again clears the cooldown and the charge used.
    room.demoRole(a, 'builder');
    room.demoRole(a, 'saboteur');
    expect(room.round!.cooldown(a, 'clumsy')).toBe(0);
    expect(room.round!.chargesLeft(a, 'clumsy')).toBe(2);
  });

  it('pins every page of the round to the corkboard in step order, index last', () => {
    const { room, join, msgs, run } = setup();
    const a = join('Ada');
    room.demoRound({ build: GIANT_DUCK.id, night: false, role: 'builder', pinned: true });
    run(1);
    const pages = [...room.sim.pages.values()];
    expect(pages.every((p) => p.pinned !== null && p.hideout === null)).toBe(true);
    // Seen from in front, slots run right to left, so step 1 goes in the top row's last slot.
    const reading = [3, 2, 1, 0, 7, 6, 5, 4, 11, 10, 9, 8, 15, 14, 13, 12];
    for (const p of pages) {
      expect(p.pinned).toBe(reading[p.step < 0 ? GIANT_DUCK.steps.length : p.step]);
    }
    for (const h of room.sim.hideouts.values()) expect(h.contents).toHaveLength(0);
    // Every client hears where each page now hangs.
    const sent = new Map(msgs(a, 'page').map((m) => [m.p.id, m.p.pinned]));
    for (const p of pages) expect(sent.get(p.id)).toBe(p.pinned);
  });

  it('fills all sixteen slots with the castle and leaves its index where it was', () => {
    const { room, join } = setup();
    join('Ada');
    room.demoRound({ build: CASTLE.id, night: false, role: 'builder', pinned: true });
    const pages = [...room.sim.pages.values()];
    const slots = pages.map((p) => p.pinned).filter((s) => s !== null);
    expect(new Set(slots).size).toBe(16);
    expect(pages.find((p) => p.step < 0)!.pinned).toBeNull();
  });

  it('clears loose bricks and pieces, held ones too, but leaves the build alone', () => {
    const { room, join, msgs, run, say } = setup();
    const a = join('Ada');
    room.demoRound({ build: GIANT_DUCK.id, night: false, role: 'builder', pinned: false });
    run(30);
    const bin = HOUSE.bins[0]!;
    room.sim.setStock(bin.id, 5);
    // Take a brick from the bin, so one is held.
    const p = room.sim.players.get(a)!;
    p.body.setTranslation({ x: bin.pos.x, y: 0.86, z: bin.pos.z + 1.4 }, true);
    run(3);
    const eye = room.sim.eye(p);
    const yaw = Math.atan2(-(bin.pos.x - eye.x), -(bin.pos.z - eye.z));
    const pitch = Math.atan2(0.6 - eye.y, Math.hypot(bin.pos.x - eye.x, bin.pos.z - eye.z));
    say(a, { t: 'act', a: { kind: 'grab' }, seq: 0, yaw, pitch, fp: true });
    run(3);
    expect(p.holding).not.toBeNull();
    expect(room.sim.binStock.get(bin.id)).toBe(4);
    // A mess on the floor: a loose brick and a loose piece.
    room.sim.spawnBrick(bin.type, bin.colour, { x: 0, y: 0.5, z: 0 });
    room.sim.spawnBuild(
      [
        { type: '2x2', colour: 'red', x: 0, y: 0, z: 0, rot: 0 },
        { type: '2x2', colour: 'red', x: 0, y: 1, z: 0, rot: 0 },
      ],
      { x: 1, y: 0.5, z: 0 },
    );
    room.sim.addBricks(room.sim.build(), [
      { type: '2x2', colour: 'red', x: 0, y: 1, z: 0, rot: 0 },
    ]);
    run(2);
    const onPlate = room.sim.build().grid.size;
    room.demoClearPieces();
    run(2);
    expect([...room.sim.assemblies.keys()]).toEqual([room.sim.buildId]);
    expect(room.sim.build().grid.size).toBe(onPlate);
    expect(p.holding).toBeNull();
    expect(room.sim.binStock.get(bin.id)).toBe(6);
    expect(msgs(a, 'asmDel')).toHaveLength(3);
  });

  it('finishes the build on the baseplate so the inspector and the round pass it', () => {
    const { room, join, msgs, run } = setup();
    const a = join('Ada');
    room.demoRound({ build: GIANT_DUCK.id, night: false, role: 'builder', pinned: false });
    // A stray brick already on the plate is cleared away.
    room.sim.addBricks(room.sim.build(), [
      { type: '2x2', colour: 'red', x: 0, y: 1, z: 0, rot: 0 },
    ]);
    room.demoFinishBuild();
    run(1);
    const result = matchBuild(room.round!.target, room.sim.build().grid);
    expect(result.passed).toBe(true);
    expect(result.counts.extra).toBe(0);
    expect(result.counts.correct).toBe(result.counts.total);
    expect(room.sim.build().anchored).toBe(true);
    const sent = msgs(a, 'asm')
      .filter((m) => m.a.id === room.sim.buildId)
      .at(-1)!;
    expect(sent.a.bricks.length).toBe(result.counts.total + 1);
    room.round!.finish('done');
    expect(room.round!.winner).toBe('builders');
  });
});
