import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { LIGHTHOUSE } from './builds/lighthouse.ts';
import { realPage } from './builds/forgery.ts';
import { BOARD_FACE_SLOTS, HOUSE, floorLevel } from './content/house.ts';
import type { BoxDef } from './content/house.ts';
import { dropSpot, hideoutBody, hideoutPartInWorld, inWorld } from './content/hideouts.ts';
import { add, dot, length, rotate, sub, yawQuat } from './math.ts';
import type { Vec3 } from './math.ts';
import { decode, encode } from './net/protocol.ts';
import type { ServerMsg } from './net/protocol.ts';
import { Room, SHOW_RANGE } from './net/room.ts';
import { Round } from './round.ts';
import { CAMERA_DISTANCE, isLooseBrick, MAX_LOOSE_BRICKS, Sim } from './sim/sim.ts';
import type { HideoutState, Player } from './sim/sim.ts';

beforeAll(async () => {
  await RAPIER.init();
});

const run = (sim: Sim, ticks: number) => {
  for (let i = 0; i < ticks; i++) sim.step();
};

function lookAt(sim: Sim, p: Player, standAt: Vec3, target: Vec3) {
  p.body.setTranslation({ x: standAt.x, y: standAt.y + 0.86, z: standAt.z }, true);
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
    // Half of the pages (whole ones, halves of paired steps, and the index), rounded up.
    expect(hidden.length).toBe(Math.ceil(sim.pages.size / 2));
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
    const front = dropSpot(HOUSE, fridge.def);
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

  it('once open, only the door, drawer, lid or rug that moved can be clicked', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    run(sim, 30);
    const aimFromFront = (h: HideoutState, target: Vec3) => {
      const front = { x: -Math.sin(h.def.facing), z: -Math.cos(h.def.facing) };
      const floor = floorLevel(h.def.pos.y);
      lookAt(
        sim,
        p,
        { x: target.x + front.x * 1.2, y: floor, z: target.z + front.z * 1.2 },
        target,
      );
      return sim.aim(p)?.owner;
    };
    const isThis = (h: HideoutState) => ({ kind: 'hideout', hideoutId: h.def.id });
    for (const h of sim.hideouts.values()) {
      const name = `${h.def.kind} #${h.def.id}`;
      const shut = hideoutPartInWorld(h.def, false).centre;
      const still = hideoutBody(h.def);
      // Shut, the whole thing opens it.
      expect(aimFromFront(h, shut), name).toEqual(isThis(h));
      if (still) expect(aimFromFront(h, inWorld(h.def, still).centre), name).toEqual(isThis(h));
      sim.toggleHideout(h.def.id);
      // Open, only the moved part shuts it: not the cabinet, not where the rug used to lie.
      expect(aimFromFront(h, hideoutPartInWorld(h.def, true, h.opening).centre), name).toEqual(
        isThis(h),
      );
      // (A drawer still fills most of the spot it slid out of.)
      if (h.def.kind !== 'drawer') expect(aimFromFront(h, shut), name).not.toEqual(isThis(h));
      if (still) {
        expect(aimFromFront(h, inWorld(h.def, still).centre), name).not.toEqual(isThis(h));
      }
      sim.toggleHideout(h.def.id);
    }
  });

  it("can be clicked on an open drawer's tray, not just its front", () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    run(sim, 30);
    const drawer = sim.hideouts.get(2)!;
    sim.toggleHideout(2);
    // Looking down into the tray, over the drawer's front.
    const { pos, size } = drawer.def;
    const tray = { x: pos.x, y: pos.y + size.y * 0.4, z: pos.z - 0.15 };
    lookAt(sim, p, { x: pos.x, y: 0, z: pos.z - 1.2 }, tray);
    const hit = sim.aim(p)!;
    expect(hit.owner).toEqual({ kind: 'hideout', hideoutId: 2 });
    expect(hit.point.z).toBeGreaterThan(pos.z - 0.3);
  });

  it('opens doors, lids and cushions without going through walls or furniture', () => {
    const sim = new Sim(RAPIER, HOUSE);
    // The TV cabinet stands by a wall, so its door stops short, at the wall.
    const tv = sim.hideouts.get(7)!;
    expect(tv.opening).toBeLessThan(1.8);
    expect(tv.opening).toBeGreaterThan(1.2);
    const inside = (p: Vec3, b: BoxDef) =>
      Math.abs(p.x - b.pos.x) < b.size.x / 2 - 0.005 &&
      Math.abs(p.y - b.pos.y) < b.size.y / 2 - 0.005 &&
      Math.abs(p.z - b.pos.z) < b.size.z / 2 - 0.005;
    for (const h of sim.hideouts.values()) {
      // Drawers slide into their counter by design.
      if (h.def.kind === 'drawer') continue;
      const part = hideoutPartInWorld(h.def, true, h.opening);
      for (const sx of [-1, 0, 1])
        for (const sy of [-1, 0, 1])
          for (const sz of [-1, 0, 1]) {
            const corner = add(
              part.centre,
              rotate(part.rot, { x: sx * part.half.x, y: sy * part.half.y, z: sz * part.half.z }),
            );
            for (const b of HOUSE.boxes.filter((b) => !b.tiltX))
              expect(inside(corner, b), `${h.def.kind} #${h.def.id}`).toBe(false);
          }
    }
  });

  it('lets players walk through an open door', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    const fridge = sim.hideouts.get(1)!;
    sim.toggleHideout(1);
    const door = hideoutPartInWorld(fridge.def, true, fridge.opening).centre;
    // Walk south along the kitchen wall, straight through where the open door hangs.
    p.body.setTranslation({ x: door.x, y: 0.86, z: door.z + 1 }, true);
    run(sim, 30);
    p.input.yaw = 0;
    p.input.forward = 1;
    run(sim, 60);
    expect(p.body.translation().z).toBeLessThan(door.z - 0.5);
  });

  it('lets players walk and jump through every doorway, under its header', () => {
    for (const [start, yaw, check] of [
      // In through the front door, heading north.
      [{ x: 0, z: 4.5 }, Math.PI, (x: number, z: number) => z > 7.5],
      // Living room into the kitchen, heading west, and into the break room, heading east.
      [{ x: -2.5, z: 10 }, Math.PI / 2, (x: number) => x < -5.5],
      [{ x: 2.5, z: 10 }, -Math.PI / 2, (x: number) => x > 5.5],
    ] as const) {
      const sim = new Sim(RAPIER, HOUSE);
      const p = sim.addPlayer();
      p.body.setTranslation({ x: start.x, y: 0.86, z: start.z }, true);
      run(sim, 30);
      p.input.yaw = yaw;
      p.input.forward = 1;
      p.input.jump = true;
      run(sim, 90);
      const at = p.body.translation();
      expect(check(at.x, at.z)).toBe(true);
    }
  });

  it('aims along the crosshair even when the camera is squeezed against a wall', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    // Back to the kitchen's north wall, looking at a page on the floor in third person.
    const page = sim.spawnPage(realPage(LIGHTHOUSE, 0, '★'), { x: -6, y: 0, z: 12.6 });
    p.body.setTranslation({ x: -6.6, y: 0.86, z: 14.4 }, true);
    run(sim, 30);
    const target = page.body!.translation();
    p.input.firstPerson = false;
    const eye = sim.eye(p);
    // Turn until the camera (wherever it ends up) looks straight at the page.
    for (let i = 0; i < 20; i++) {
      const cam = sim.camera(p, eye);
      p.input.yaw = Math.atan2(-(target.x - cam.x), -(target.z - cam.z));
      p.input.pitch = Math.atan2(target.y - cam.y, Math.hypot(target.x - cam.x, target.z - cam.z));
    }
    expect(length(sub(sim.camera(p, eye), eye))).toBeLessThan(CAMERA_DISTANCE);
    expect(sim.aim(p)?.owner).toEqual({ kind: 'page', pageId: page.id });
  });

  it('has a ladder up to the roof', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    const l = HOUSE.ladders[0]!;
    p.body.setTranslation({ x: l.pos.x, y: 0.86, z: l.pos.z }, true);
    run(sim, 30);
    // Standing at its foot is not climbing.
    expect(p.climbing).toBe(false);
    p.input.yaw = Math.PI; // facing the wall
    p.input.forward = 1;
    run(sim, 30);
    expect(p.body.translation().y).toBeGreaterThan(1.5);
    expect(p.climbing).toBe(true);
    // Hanging on halfway up still is.
    p.input.forward = 0;
    run(sim, 30);
    expect(p.climbing).toBe(true);
    p.input.forward = 1;
    run(sim, 120);
    p.input.forward = 0;
    run(sim, 30);
    // Standing on the roof (top at 2.8 m), at the ladder's top, is not.
    expect(p.body.translation().y).toBeGreaterThan(3.5);
    expect(p.grounded).toBe(true);
    expect(p.climbing).toBe(false);
    // And walks on from there onto the roof, through the gap in its railing.
    p.input.forward = 1;
    run(sim, 30);
    expect(p.body.translation().z).toBeGreaterThan(7);
    expect(p.body.translation().y).toBeGreaterThan(3.5);
  });

  it('has a railing round the roof that nobody walks or jumps over', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    // South, east and north, each a long way past the edge.
    for (const yaw of [0, -Math.PI / 2, Math.PI]) {
      sim.teleportPlayer(p, { x: 8, y: 3.7, z: 10.5 });
      run(sim, 30);
      p.input.yaw = yaw;
      p.input.forward = 1;
      for (let i = 0; i < 8; i++) {
        p.input.jump = true;
        run(sim, 5);
        p.input.jump = false;
        run(sim, 25);
      }
      p.input.forward = 0;
      run(sim, 30);
      const at = p.body.translation();
      expect(at.y).toBeGreaterThan(3.5);
      expect(at.x).toBeLessThan(12.1);
      expect(at.z).toBeGreaterThan(5.9);
      expect(at.z).toBeLessThan(15.1);
    }
  });
});

describe('bins', () => {
  it('hand out every brick from its own bin, and never run out', () => {
    const keys = HOUSE.bins.map((b) => `${b.type}|${b.colour}`);
    expect(new Set(keys).size).toBe(keys.length); // one bin per brick
    const sim = new Sim(RAPIER, HOUSE);
    new Round(sim, LIGHTHOUSE, { seed: 4 });
    const bin = HOUSE.bins.find((b) => b.pos.y === 0)!;
    const p = sim.addPlayer();
    run(sim, 30);
    lookAt(sim, p, { x: bin.pos.x, y: 0, z: bin.pos.z + 1.4 }, { ...bin.pos, y: 0.6 });
    // Far more than any build needs: take one, put it back, again and again.
    for (let i = 0; i < 50; i++) {
      sim.act(p.id, { kind: 'grab' });
      expect(p.holding).not.toBeNull();
      const held = sim.assemblies.get(p.holding!.assemblyId)!;
      expect([...held.grid.bricks.values()][0]).toMatchObject({
        type: bin.type,
        colour: bin.colour,
      });
      sim.act(p.id, { kind: 'place' });
      expect(p.holding).toBeNull();
      expect(sim.assemblies.has(held.id)).toBe(false);
    }
  });

  it('tidy away the longest-lying loose bricks once there are too many', () => {
    const sim = new Sim(RAPIER, HOUSE);
    new Round(sim, LIGHTHOUSE, { seed: 4 });
    const bin = HOUSE.bins.find((b) => b.pos.y === 0)!;
    const p = sim.addPlayer();
    run(sim, 30);
    lookAt(sim, p, { x: bin.pos.x, y: 0, z: bin.pos.z + 1.4 }, { ...bin.pos, y: 0.6 });
    const lying = () =>
      [...sim.assemblies.values()].filter((a) => isLooseBrick(a) && a.heldBy === null);
    const before = lying().length;
    const spilled = Array.from({ length: MAX_LOOSE_BRICKS - before + 1 }, (_, i) =>
      sim.spawnBrick(bin.type, bin.colour, { x: -40 + (i % 20), y: 1, z: -40 + i / 20 }),
    );
    expect(lying().length).toBe(MAX_LOOSE_BRICKS + 1);
    sim.act(p.id, { kind: 'grab' });
    expect(p.holding).not.toBeNull();
    expect(lying().length).toBe(MAX_LOOSE_BRICKS);
    // The one held stays; whatever had lain there longest went.
    expect(sim.assemblies.has(p.holding!.assemblyId)).toBe(true);
    expect(sim.assemblies.has(spilled.at(-1)!.id)).toBe(true);
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

  /** Puts a fresh page in the player's pocket. */
  function pocketPage(sim: Sim, p: Player) {
    const page = sim.spawnPage(realPage(LIGHTHOUSE, 2, '★'), { x: 0, y: 0, z: 5 });
    run(sim, 20);
    lookAt(sim, p, { x: 0, y: 0, z: 5.9 }, page.body!.translation());
    sim.act(p.id, { kind: 'grab' });
    expect(p.page).toBe(page.id);
    return page;
  }

  /** Where to stand to use one face of the board: 0 the front, 1 the back. */
  function standBy(face: number): Vec3 {
    const b = HOUSE.board;
    const out = rotate(yawQuat(b.facing), { x: 0, y: 0, z: face === 0 ? -1.3 : 1.3 });
    return add({ x: b.pos.x, y: 0, z: b.pos.z }, out);
  }

  for (const face of [0, 1]) {
    it(`pins pages upright on the ${face === 0 ? 'front' : 'back'}, and takes them off again`, () => {
      const sim = new Sim(RAPIER, HOUSE);
      const p = sim.addPlayer();
      run(sim, 30);
      const page = pocketPage(sim, p);
      const board = HOUSE.board.pos;
      lookAt(sim, p, standBy(face), board);
      sim.act(p.id, { kind: 'grab' });
      expect(p.page).toBeNull();
      expect(page.pinned).not.toBeNull();
      expect(Math.floor(page.pinned! / BOARD_FACE_SLOTS)).toBe(face);
      // On the clicked side of the board, printed face (+y) out toward the player, the top of the
      // print (-z) up.
      const at = page.body!.translation();
      const rot = page.body!.rotation();
      const toPlayer = sub(standBy(face), { x: board.x, y: 0, z: board.z });
      expect(dot(sub(at, board), toPlayer)).toBeGreaterThan(0);
      expect(dot(rotate(rot, { x: 0, y: 1, z: 0 }), toPlayer) / length(toPlayer)).toBeGreaterThan(
        0.99,
      );
      expect(rotate(rot, { x: 0, y: 0, z: -1 }).y).toBeGreaterThan(0.99);
      // Taken off again from the same side.
      lookAt(sim, p, standBy(face), at);
      sim.act(p.id, { kind: 'grab' });
      expect(p.page).toBe(page.id);
      expect(page.pinned).toBeNull();
    });
  }

  it('fills one face without spilling pages onto the other', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    run(sim, 30);
    const board = HOUSE.board.pos;
    const pinned = [];
    for (let i = 0; i < BOARD_FACE_SLOTS; i++) {
      const page = pocketPage(sim, p);
      lookAt(sim, p, standBy(1), board);
      sim.act(p.id, { kind: 'grab' });
      pinned.push(page.pinned);
    }
    expect(new Set(pinned).size).toBe(BOARD_FACE_SLOTS);
    expect(pinned.every((s) => s !== null && s >= BOARD_FACE_SLOTS)).toBe(true);
    // The back is full: the next page stays in the pocket, though the front is empty.
    const extra = pocketPage(sim, p);
    lookAt(sim, p, standBy(1), board);
    sim.act(p.id, { kind: 'grab' });
    expect(p.page).toBe(extra.id);
    lookAt(sim, p, standBy(0), board);
    sim.act(p.id, { kind: 'grab' });
    expect(extra.pinned).toBeLessThan(BOARD_FACE_SLOTS);
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
    expect(hidden.length).toBe(Math.ceil(pages.length / 2));
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
    const bin = HOUSE.bins[0]!;
    lookAt(r.sim, p, { x: bin.pos.x, y: 0, z: bin.pos.z + 1.4 }, { ...bin.pos, y: 0.6 });
    r.sim.act(p.id, { kind: 'grab' });
    expect(p.holding).not.toBeNull();
    r.round!.callMeeting(ids[0]!);
    expect(p.holding).toBeNull();
    for (const id of ids) {
      const at = r.sim.players.get(id)!.body.translation();
      const nearest = Math.min(
        ...r.level.meetingSeats.map((s) => Math.hypot(s.x - at.x, s.z - at.z)),
      );
      expect(nearest).toBeLessThan(0.05);
    }
  });
});

describe('voice through walls', () => {
  it('counts the walls and shut doors between two heads, not open air or players', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const head = (x: number, z: number) => ({ x, y: 1.5, z });
    // Across the open yard: nothing in between, even with a player standing there.
    sim.addPlayer({ spawn: { x: 0, y: 0, z: -8 } });
    run(sim, 2);
    expect(sim.wallsBetween(head(-3, -8), head(3, -8))).toBe(0);
    // Kitchen to living room through the wall between them (no doorway at this depth).
    expect(sim.wallsBetween(head(-6, 13), head(-2, 13))).toBe(1);
    // Kitchen to break room: two inner walls.
    expect(sim.wallsBetween(head(-6, 13), head(6, 13))).toBe(2);
    // From the yard into the kitchen through the front wall.
    expect(sim.wallsBetween(head(-6, 4), head(-6, 9))).toBe(1);
  });
});
