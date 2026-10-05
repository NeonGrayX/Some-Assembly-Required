import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { decode, encode } from '../net/protocol.ts';
import type { ServerMsg } from '../net/protocol.ts';
import { Room } from '../net/room.ts';
import { DOG_HALF_HEIGHT, DOG_RADIUS } from '../sim/dog.ts';
import { PLAYER_HALF_HEIGHT, PLAYER_RADIUS, Sim } from '../sim/sim.ts';
import { hasDoor, hasLid, openingIn } from './hideouts.ts';
import { HOUSE } from './house.ts';
import type { LevelDef } from './house.ts';
import {
  DOORWAY_CLEARANCE,
  MIN_SWING,
  ROOMS,
  WINDOW_WIDTH,
  houseLayout,
  layoutProblems,
  walkable,
} from './layout.ts';
import type { Rect } from './layout.ts';

beforeAll(async () => {
  await RAPIER.init();
});

const SEEDS = Array.from({ length: 40 }, (_, i) => (i * 2654435761 + 17) >>> 0);

const inRect = (r: Rect, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
const roomOf = (x: number, z: number) => ROOMS.findIndex((r) => inRect(r, x, z));
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
const centre = (r: Rect): [number, number] => [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2];
const turned = (facing: number) => Math.round(Math.abs(facing) / (Math.PI / 2)) % 2 === 1;

/** The floor under each piece of furniture and closed hiding place in the house. */
function footprints(level: LevelDef): { name: string; rect: Rect; top: number; rug: boolean }[] {
  const indoors = (x: number, z: number) => roomOf(x, z) >= 0;
  return [
    ...level.boxes
      .filter((b) => b.model && indoors(b.pos.x, b.pos.z))
      .map((b) => ({
        name: b.model!,
        rect: {
          x0: b.pos.x - b.size.x / 2,
          x1: b.pos.x + b.size.x / 2,
          z0: b.pos.z - b.size.z / 2,
          z1: b.pos.z + b.size.z / 2,
        },
        top: b.pos.y + b.size.y / 2,
        rug: false,
      })),
    ...level.hideouts
      .filter((h) => h.kind !== 'cushion' && indoors(h.pos.x, h.pos.z))
      .map((h) => {
        const [w, d] = turned(h.facing) ? [h.size.z, h.size.x] : [h.size.x, h.size.z];
        return {
          name: `${h.kind} #${h.id}`,
          rect: {
            x0: h.pos.x - w / 2,
            x1: h.pos.x + w / 2,
            z0: h.pos.z - d / 2,
            z1: h.pos.z + d / 2,
          },
          top: h.pos.y + h.size.y / 2,
          rug: h.kind === 'rug',
        };
      }),
  ];
}

/** Moves the furniture about, comparing only where things stand. */
const where = (level: LevelDef) =>
  JSON.stringify([level.boxes, level.hideouts, level.pageSpots, level.dog]);

describe('house layouts', () => {
  const layouts = SEEDS.map(houseLayout);

  it('are the same for the same seed and differ between seeds', () => {
    expect(where(houseLayout(SEEDS[3]!))).toBe(where(layouts[3]!));
    const distinct = new Set(layouts.map(where));
    expect(distinct.size).toBe(SEEDS.length);
    // Never the hand-made house, which is only the fallback.
    expect(layouts).not.toContain(HOUSE);
  });

  it('keep all 29 hiding spots, the seats and the same walls', () => {
    const walls = (l: LevelDef) => JSON.stringify(l.boxes.filter((b) => !b.model));
    for (const level of layouts) {
      expect(level.hideouts.map((h) => h.id)).toEqual(HOUSE.hideouts.map((h) => h.id));
      expect(level.pageSpots.length + level.hideouts.length).toBe(29);
      expect(level.meetingSeats).toHaveLength(HOUSE.meetingSeats.length);
      expect(walls(level)).toBe(walls(HOUSE));
      expect(level.lights).toEqual(HOUSE.lights);
      expect(level.spawn).toEqual(HOUSE.spawn);
    }
  });

  it('keep furniture in its own room, apart, and out of doorways and windows', () => {
    const original = footprints(HOUSE);
    for (const [n, level] of layouts.entries()) {
      const things = footprints(level);
      expect(things).toHaveLength(original.length);
      for (const [i, a] of things.entries()) {
        const at = `${a.name} in layout ${SEEDS[n]}`;
        const r = roomOf(...centre(a.rect));
        const room = ROOMS[r]!;
        // In a room it stood in in the hand-made house (there are two tables), wholly inside.
        const was = original.filter((o) => o.name === a.name).map((o) => roomOf(...centre(o.rect)));
        expect(was, at).toContain(r);
        expect(a.rect.x0 >= room.x0 && a.rect.x1 <= room.x1, at).toBe(true);
        expect(a.rect.z0 >= room.z0 && a.rect.z1 <= room.z1, at).toBe(true);
        if (a.rug) continue;
        for (const d of DOORWAY_CLEARANCE) expect(overlaps(a.rect, d), at).toBe(false);
        for (const s of level.meetingSeats) {
          const gap = Math.hypot(
            Math.max(a.rect.x0 - s.x, 0, s.x - a.rect.x1),
            Math.max(a.rect.z0 - s.z, 0, s.z - a.rect.z1),
          );
          expect(gap, `${at} by a seat`).toBeGreaterThan(PLAYER_RADIUS);
        }
        if (a.top > 1.2)
          for (const w of level.windows!) {
            const half = WINDOW_WIDTH / 2;
            const span = w.alongX
              ? { x0: w.x - half, x1: w.x + half, z0: w.z - 0.4, z1: w.z + 0.4 }
              : { x0: w.x - 0.4, x1: w.x + 0.4, z0: w.z - half, z1: w.z + half };
            expect(overlaps(a.rect, span), `${at} in front of a window`).toBe(false);
          }
        for (const b of things.slice(i + 1)) {
          // Drawers sit in the counter's front and the backrest on the seat, by design.
          const parts = [a.name, b.name].sort().join();
          if (b.rug || /drawer/.test(parts) || parts === 'sofa,sofaBack') continue;
          expect(overlaps(a.rect, b.rect), `${at} and ${b.name}`).toBe(false);
        }
      }
    }
  });

  it('move the windows about the outside walls, clear of each other, doors and the ladder', () => {
    const half = WINDOW_WIDTH / 2;
    const spots = new Set<string>();
    for (const level of layouts) {
      const windows = level.windows!;
      expect(windows).toHaveLength(7);
      for (const w of windows) spots.add(`${w.x},${w.z}`);
      // Three in the kitchen, one in the living room, three in the break room.
      const room = (w: { x: number; z: number }) =>
        roomOf(Math.max(-11.8, Math.min(11.8, w.x)), Math.max(6.2, Math.min(14.8, w.z)));
      expect(windows.map(room).sort()).toEqual([0, 0, 0, 1, 2, 2, 2]);
      for (const [i, w] of windows.entries()) {
        // On an outside wall, away from the corners.
        if (w.alongX) {
          expect([6, 15]).toContain(w.z);
          const r = ROOMS[room(w)]!;
          expect(w.x - half).toBeGreaterThanOrEqual(r.x0 + 0.29);
          expect(w.x + half).toBeLessThanOrEqual(r.x1 - 0.29);
        } else {
          expect([-12, 12]).toContain(w.x);
          expect(w.z - half).toBeGreaterThanOrEqual(6.1 + 0.29);
          expect(w.z + half).toBeLessThanOrEqual(14.9 - 0.29);
        }
        if (w.alongX && w.z === 6) {
          // Not over the front door or behind the ladder.
          expect(Math.abs(w.x)).toBeGreaterThan(1 + half);
          for (const l of HOUSE.ladders)
            expect(Math.abs(w.x - l.pos.x)).toBeGreaterThan(l.width / 2 + half);
        }
        for (const v of windows.slice(i + 1))
          if (v.alongX === w.alongX && (w.alongX ? v.z === w.z : v.x === w.x))
            expect(Math.abs(w.alongX ? w.x - v.x : w.z - v.z)).toBeGreaterThanOrEqual(WINDOW_WIDTH);
      }
    }
    // They really do move.
    expect(spots.size).toBeGreaterThan(50);
  });

  it('keep every hiding spot, the treat jar and every doorway in reach', () => {
    for (const [n, level] of layouts.entries()) {
      expect(layoutProblems(level), `layout ${SEEDS[n]}`).toEqual([]);
      for (const h of level.hideouts)
        if (hasDoor(h) || hasLid(h)) expect(openingIn(level, h)).toBeGreaterThanOrEqual(MIN_SWING);
    }
  });

  it('only count floor as walkable where a player really fits', () => {
    const shape = new RAPIER.Capsule(PLAYER_HALF_HEIGHT, PLAYER_RADIUS);
    const flags =
      RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC |
      RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC |
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    for (const level of layouts.slice(0, 8)) {
      const sim = new Sim(RAPIER, level);
      sim.step();
      const walk = walkable(level);
      for (let x = -11.8; x < 11.8; x += 0.2)
        for (let z = 6.2; z < 14.8; z += 0.2) {
          if (!walk(x, z)) continue;
          // Standing just above the rugs.
          const at = { x, y: 0.05 + PLAYER_RADIUS + PLAYER_HALF_HEIGHT, z };
          const hit = sim.world.intersectionWithShape(at, { x: 0, y: 0, z: 0, w: 1 }, shape, flags);
          expect(hit, `walkable at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBeFalsy();
        }
    }
  });

  it('give the dog clear walks through every room', () => {
    const shape = new RAPIER.Capsule(DOG_HALF_HEIGHT, DOG_RADIUS);
    const flags =
      RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC |
      RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC |
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    for (const level of layouts) {
      const sim = new Sim(RAPIER, level);
      sim.step();
      const { points, links } = level.dog;
      for (const [a, b] of links) {
        const [from, to] = [points[a]!, points[b]!];
        const steps = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.1);
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const at = {
            x: from.x + (to.x - from.x) * t,
            y: 0.08 + DOG_RADIUS + DOG_HALF_HEIGHT,
            z: from.z + (to.z - from.z) * t,
          };
          const hit = sim.world.intersectionWithShape(at, { x: 0, y: 0, z: 0, w: 1 }, shape, flags);
          expect(hit, `link ${a}-${b} blocked`).toBeFalsy();
        }
      }
      // Every point can be walked to from where the dog starts.
      const seen = new Set([level.dog.start]);
      const todo = [level.dog.start];
      while (todo.length) {
        const p = todo.pop()!;
        for (const [a, b] of links)
          for (const [u, v] of [
            [a, b],
            [b, a],
          ] as const)
            if (u === p && !seen.has(v)) {
              seen.add(v);
              todo.push(v);
            }
      }
      expect(seen.size).toBe(points.length);
      // Every room has somewhere for the dog to go.
      for (const room of ROOMS) expect(points.some((p) => inRect(room, p.x, p.z))).toBe(true);
    }
  });
});

describe('a room', () => {
  it('furnishes the house anew for every round and tells everyone how', () => {
    const inbox: ServerMsg[] = [];
    const room = new Room(RAPIER, {
      code: 'L',
      send: (_, msg) => inbox.push(decode<ServerMsg>(encode(msg))),
    });
    const { id } = room.join('P') as { id: number };
    room.handle(id, { t: 'settings', saboteurs: 0 });
    const seen: number[] = [];
    for (let round = 0; round < 3; round++) {
      room.handle(id, { t: 'start' });
      const world = inbox.filter((m) => m.t === 'world').at(-1)!;
      expect(world.layout).toBe(room.layout);
      // A client builds the very same house from the seed.
      expect(where(houseLayout(world.layout!))).toBe(where(room.level));
      expect(room.sim.level).toBe(room.level);
      seen.push(world.layout!);
      room.phase = 'lobby';
    }
    expect(new Set(seen).size).toBe(3);
  });

  it('keeps a level it was given', () => {
    const room = new Room(RAPIER, { code: 'L', send: () => {}, level: HOUSE });
    const { id } = room.join('P') as { id: number };
    room.handle(id, { t: 'start' });
    expect(room.level).toBe(HOUSE);
    expect(room.layout).toBeNull();
  });
});
