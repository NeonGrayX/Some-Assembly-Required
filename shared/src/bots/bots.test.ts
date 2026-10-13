import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { matchBuild } from '../builds/match.ts';
import { MAX_PLAYERS } from '../net/protocol.ts';
import type { ServerMsg } from '../net/protocol.ts';
import { Room } from '../net/room.ts';

beforeAll(async () => {
  await RAPIER.init();
});

function setup(seed = 1) {
  const inbox = new Map<number, ServerMsg[]>();
  const room = new Room(RAPIER, {
    code: 'BOTS',
    send: (id, msg) => {
      const list = inbox.get(id) ?? [];
      list.push(msg);
      inbox.set(id, list);
    },
    seed,
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
});
