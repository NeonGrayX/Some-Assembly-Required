import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { LIGHTHOUSE } from './builds/lighthouse.ts';
import { realPage } from './builds/forgery.ts';
import { HOUSE } from './content/house.ts';
import type { Vec3 } from './math.ts';
import { decode, encode } from './net/protocol.ts';
import type { ServerMsg } from './net/protocol.ts';
import { Room, SHOW_RANGE } from './net/room.ts';
import { Round } from './round.ts';
import { Sim } from './sim/sim.ts';
import type { Player } from './sim/sim.ts';

beforeAll(async () => {
  await RAPIER.init();
});

const run = (sim: Sim, ticks: number) => {
  for (let i = 0; i < ticks; i++) sim.step();
};

function lookAt(sim: Sim, p: Player, standAt: Vec3, target: Vec3) {
  p.body.setTranslation({ x: standAt.x, y: 0.86, z: standAt.z }, true);
  run(sim, 3);
  const eye = sim.eye(p);
  p.input.firstPerson = true;
  p.input.yaw = Math.atan2(-(target.x - eye.x), -(target.z - eye.z));
  p.input.pitch = Math.atan2(target.y - eye.y, Math.hypot(target.x - eye.x, target.z - eye.z));
}

describe('the house', () => {
  it('has at least 25 places to hide pages and seats for a full meeting', () => {
    expect(HOUSE.pageSpots.length + HOUSE.hideouts.length).toBeGreaterThanOrEqual(25);
    expect(HOUSE.meetingSeats.length).toBeGreaterThanOrEqual(10);
  });

  it('hides about half the pages in closed hiding places, out of sight', () => {
    const sim = new Sim(RAPIER, HOUSE);
    new Round(sim, LIGHTHOUSE, { seed: 4 });
    const hidden = [...sim.pages.values()].filter((p) => p.hideout !== null);
    expect(hidden.length).toBe(5);
    for (const p of hidden) {
      expect(p.body).toBeNull();
      expect(sim.hideouts.get(p.hideout!)!.open).toBe(false);
    }
  });

  it('lets anyone open a hiding place, which brings out what is inside', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    run(sim, 30);
    const fridge = sim.hideouts.get(1)!;
    const page = sim.spawnPage(realPage(LIGHTHOUSE, 0, '★'), { x: 0, y: -50, z: 0 });
    sim.hideInHideout(page, 1);
    const front = sim.dropPoint(fridge.def);
    lookAt(sim, p, { x: front.x + 0.8, y: 0, z: front.z }, fridge.def.pos);
    sim.act(p.id, { kind: 'grab' });
    expect(fridge.open).toBe(true);
    expect(fridge.contents).toEqual([]);
    expect(page.body).not.toBeNull();
    expect(page.hideout).toBeNull();
    // Clicking again shuts it.
    sim.act(p.id, { kind: 'grab' });
    expect(fridge.open).toBe(false);
  });

  it('has a ladder up to the roof', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    const l = HOUSE.ladders[0]!;
    p.body.setTranslation({ x: l.pos.x, y: 0.86, z: l.pos.z }, true);
    run(sim, 30);
    p.input.yaw = Math.PI; // facing the wall
    p.input.forward = 1;
    run(sim, 150);
    p.input.forward = 0;
    run(sim, 30);
    // Standing on the roof (top at 2.8 m).
    expect(p.body.translation().y).toBeGreaterThan(3.5);
    expect(p.grounded).toBe(true);
  });
});

describe('bins', () => {
  it('rare bins hold what the round needs plus one, and take bricks back', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const round = new Round(sim, LIGHTHOUSE, { seed: 4 });
    const yellow = HOUSE.bins.find((b) => b.colour === 'yellow')!;
    const needed = round.target.steps
      .flatMap((s) => s.bricks)
      .filter((b) => b.type === '2x2' && b.colour === 'yellow').length;
    expect(sim.binStock.get(yellow.id)).toBe(needed + 1);
    expect(sim.binStock.get(HOUSE.bins.find((b) => !b.rare)!.id)).toBeNull();

    const p = sim.addPlayer();
    run(sim, 30);
    sim.setStock(yellow.id, 1);
    lookAt(sim, p, { x: yellow.pos.x, y: 0, z: yellow.pos.z + 1.4 }, { ...yellow.pos, y: 0.6 });
    sim.act(p.id, { kind: 'grab' });
    expect(p.holding).not.toBeNull();
    expect(sim.binStock.get(yellow.id)).toBe(0);
    // Back into the bin it goes.
    sim.act(p.id, { kind: 'place' });
    expect(p.holding).toBeNull();
    expect(sim.binStock.get(yellow.id)).toBe(1);
    sim.setStock(yellow.id, 0);
    sim.act(p.id, { kind: 'grab' });
    expect(p.holding).toBeNull();
    expect(sim.events.some((e) => e.kind === 'empty')).toBe(true);
  });
});

describe('corkboard', () => {
  it('holds pinned pages for everyone to see until someone takes one', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    run(sim, 30);
    const page = sim.spawnPage(realPage(LIGHTHOUSE, 2, '★'), { x: 0, y: 0, z: 5 });
    run(sim, 20);
    lookAt(sim, p, { x: 0, y: 0, z: 5.9 }, page.body!.translation());
    sim.act(p.id, { kind: 'grab' });
    expect(p.page).toBe(page.id);
    const board = HOUSE.board.pos;
    lookAt(sim, p, { x: board.x, y: 0, z: board.z + 1.3 }, board);
    sim.act(p.id, { kind: 'grab' });
    expect(p.page).toBeNull();
    expect(page.pinned).not.toBeNull();
    // It hangs on the board, so it can be clicked and taken again.
    lookAt(sim, p, { x: board.x, y: 0, z: board.z + 1.3 }, page.body!.translation());
    sim.act(p.id, { kind: 'grab' });
    expect(p.page).toBe(page.id);
    expect(page.pinned).toBeNull();
  });
});

describe('Room', () => {
  function room(players: number) {
    const inbox = new Map<number, ServerMsg[]>();
    const r = new Room(RAPIER, {
      code: 'H',
      send: (id, msg) => inbox.set(id, [...(inbox.get(id) ?? []), decode<ServerMsg>(encode(msg))]),
    });
    const ids = Array.from({ length: players }, (_, i) => {
      const res = r.join(`P${i}`);
      if ('error' in res) throw new Error(res.error);
      return res.id;
    });
    r.handle(ids[0]!, { t: 'settings', saboteurs: 0 });
    r.handle(ids[0]!, { t: 'start' });
    r.update();
    const msgs = <T extends ServerMsg['t']>(id: number, t: T) =>
      (inbox.get(id) ?? []).filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);
    return { r, ids, msgs };
  }

  it('says a page is hidden, never where', () => {
    const { ids, msgs } = room(1);
    const pages = msgs(ids[0]!, 'world').at(-1)!.pages;
    const hidden = pages.filter((p) => p.hidden);
    expect(hidden.length).toBe(5);
    expect(JSON.stringify(hidden)).not.toMatch(/hideout/);
  });

  it('shows a held-up page only to players close by', () => {
    const { r, ids, msgs } = room(3);
    const [a, b, c] = ids as [number, number, number];
    const page = [...r.sim.pages.values()].find((p) => p.step >= 0)!;
    const pa = r.sim.players.get(a)!;
    // Put the page in a's pocket directly.
    pa.page = page.id;
    page.carriedBy = a;
    r.sim.players.get(c)!.body.setTranslation({ x: -12, y: 0.86, z: -12 }, true);
    r.update();
    r.handle(a, { t: 'show' });
    expect(msgs(b, 'shown').map((m) => m.from)).toEqual([a]);
    expect(msgs(c, 'shown')).toEqual([]);
    expect(SHOW_RANGE).toBeGreaterThan(2);
  });

  it('gathers everyone at the break room table for a meeting, dropping what they hold', () => {
    const { r, ids } = room(3);
    const p = r.sim.players.get(ids[1]!)!;
    const bin = HOUSE.bins.find((b) => !b.rare)!;
    lookAt(r.sim, p, { x: bin.pos.x, y: 0, z: bin.pos.z + 1.4 }, { ...bin.pos, y: 0.6 });
    r.sim.act(p.id, { kind: 'grab' });
    expect(p.holding).not.toBeNull();
    r.round!.callMeeting(ids[0]!);
    expect(p.holding).toBeNull();
    for (const id of ids) {
      const at = r.sim.players.get(id)!.body.translation();
      const nearest = Math.min(
        ...HOUSE.meetingSeats.map((s) => Math.hypot(s.x - at.x, s.z - at.z)),
      );
      expect(nearest).toBeLessThan(0.05);
    }
  });
});
