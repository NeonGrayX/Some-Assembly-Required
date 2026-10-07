import RAPIER from '@dimforge/rapier3d-compat';
import { DEFAULT_LOOK, Room, decode, encode, emptyInput, makeRng } from '@sar/shared';
import type { ClientMsg, ServerMsg } from '@sar/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Connection } from './connection.ts';
import { ClientGame } from './game.ts';

beforeAll(async () => {
  await RAPIER.init();
});

/**
 * Runs a client against a room with uneven timing on both sides and messages delayed by a
 * random number of ticks, and counts how often the client's prediction had to be corrected.
 */
function play(seed: number, walk: (t: number) => { forward: number; yaw: number }, seconds = 20) {
  const rng = makeRng(seed);
  const toServer: { at: number; msg: ClientMsg }[] = [];
  const toClient: { at: number; msg: ServerMsg }[] = [];
  let now = 0;
  const conn: Connection = {
    send: (msg) => toServer.push({ at: now + Math.floor(rng() * 4), msg: decode(encode(msg)) }),
    close: () => {},
    onMessage: () => {},
    onClose: () => {},
  };
  const room = new Room(RAPIER, {
    code: 'P',
    send: (_id, msg) =>
      toClient.push({ at: now + Math.floor(rng() * 4), msg: decode(encode(msg)) }),
  });
  const game = new ClientGame(RAPIER, conn);
  let id = -1;
  const deliver = () => {
    for (const m of toServer.filter((x) => x.at <= now)) {
      if (m.msg.t === 'hello') {
        const r = room.join(m.msg.name);
        if ('id' in r) id = r.id;
      } else room.handle(id, m.msg);
    }
    toServer.splice(0, toServer.length, ...toServer.filter((x) => x.at > now));
    for (const m of toClient.filter((x) => x.at <= now)) conn.onMessage(m.msg);
    toClient.splice(0, toClient.length, ...toClient.filter((x) => x.at > now));
  };
  game.hello('Pat', { ...DEFAULT_LOOK, hat: 'cowboy' });
  const corrections: number[] = [];
  let serverDebt = 0;
  let clientDebt = 0;
  for (let tick = 0; tick < seconds * 60; tick++) {
    now = tick;
    // Each side runs 0-2 ticks per real tick, averaging one: timers and frames are uneven.
    serverDebt += 1;
    clientDebt += 1;
    const s = rng() < 0.2 ? 0 : rng() < 0.25 ? 2 : 1;
    for (let k = 0; k < Math.min(s, serverDebt); k++, serverDebt--) room.update();
    deliver();
    const c = rng() < 0.2 ? 0 : rng() < 0.25 ? 2 : 1;
    for (let k = 0; k < Math.min(c, clientDebt); k++, clientDebt--) {
      const before = game.lastCorrection;
      game.tick({ ...emptyInput(), ...walk(tick / 60) }, []);
      if (game.lastCorrection !== before && game.lastCorrection > 0.01)
        corrections.push(game.lastCorrection);
    }
  }
  return corrections;
}

describe('client prediction', () => {
  it('stays in step with the server walking in open space', () => {
    const c = play(1, (t) => ({ forward: 1, yaw: t * 0.6 }));
    expect(c).toEqual([]);
  });

  it('stays in step with the server walking into a wall and back', () => {
    const c = play(2, (t) => ({ forward: 1, yaw: Math.floor(t / 2.5) % 2 ? 0 : Math.PI }));
    expect(c).toEqual([]);
  });
});
