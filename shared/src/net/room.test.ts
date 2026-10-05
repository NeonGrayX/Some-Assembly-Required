import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { HOUSE } from '../content/house.ts';
import { makeRng } from '../math.ts';
import { decode, encode } from './protocol.ts';
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
    expect(world.pages).toHaveLength(9); // 8 pages and the master index
    expect(world.round?.timeLeft).toBe(300);
    run(6);
    expect(msgs(b, 'snap').at(-1)!.round!.timeLeft).toBeLessThan(300);
  });

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
    expect(msgs(a, 'result')[0]!.result.counts.total).toBe(32);
    say(a, { t: 'again' });
    expect(room.phase).toBe('lobby');
    expect(msgs(a, 'world').at(-1)!.pages).toHaveLength(0);
  });
});
