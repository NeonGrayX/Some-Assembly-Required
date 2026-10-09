import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { decode, encode } from '../net/protocol.ts';
import type { ServerMsg } from '../net/protocol.ts';
import { Room } from '../net/room.ts';
import { DOG_HALF_HEIGHT, DOG_RADIUS } from '../sim/dog.ts';
import { PLAYER_HALF_HEIGHT, PLAYER_RADIUS, Sim } from '../sim/sim.ts';
import type { Player } from '../sim/sim.ts';
import { hasDoor, hasLid, openingIn } from './hideouts.ts';
import {
  BASEMENT_FLOOR,
  BASEMENT_SLAB,
  HOUSE,
  STAIRS,
  UPPER_FLOOR,
  UPPER_SLAB,
  floorLevel,
  stairsPlan,
} from './house.ts';
import type { BoxDef, LevelDef, StairsDef } from './house.ts';
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
/** The room a spot on the floor at height `y` is in (-1 for none). */
const roomOf = (x: number, z: number, y = 0) =>
  ROOMS.findIndex((r) => r.y === floorLevel(y) && inRect(r, x, z));
/** The upper floor's slab pieces, which move with the stairwell. */
const isSlab = (b: BoxDef) =>
  !b.model &&
  b.size.y === 0.2 &&
  Math.abs(b.pos.y - (UPPER_FLOOR - 0.1)) < 1e-9 &&
  b.pos.x < UPPER_SLAB.x1;
/** The break room's floor over the basement, which moves with the stairwell down. */
const isCellarSlab = (b: BoxDef) => !b.model && b.size.y === 0.2 && Math.abs(b.pos.y + 0.1) < 1e-9;
/** The floor a flight comes out on. */
const topOf = (s: StairsDef) => s.pos.y + UPPER_FLOOR;
const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
/** Whether two rectangles overlap by more than float dust. */
const overlaps = (a: Rect, b: Rect) =>
  a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6 && a.z0 < b.z1 - 1e-6 && b.z0 < a.z1 - 1e-6;
const centre = (r: Rect): [number, number] => [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2];
const turned = (facing: number) => Math.round(Math.abs(facing) / (Math.PI / 2)) % 2 === 1;

/**
 * The floor under each piece of furniture and closed hiding place in the house (not the stairs),
 * with the floor it stands on and its height above that floor.
 */
function footprints(
  level: LevelDef,
): { name: string; rect: Rect; y: number; top: number; rug: boolean }[] {
  const indoors = (x: number, z: number, y: number) => roomOf(x, z, y) >= 0;
  return [
    ...level.boxes
      .filter(
        (b) =>
          b.model && b.model !== 'step' && b.model !== 'rail' && indoors(b.pos.x, b.pos.z, b.pos.y),
      )
      .map((b) => ({
        name: b.model!,
        rect: {
          x0: b.pos.x - b.size.x / 2,
          x1: b.pos.x + b.size.x / 2,
          z0: b.pos.z - b.size.z / 2,
          z1: b.pos.z + b.size.z / 2,
        },
        y: floorLevel(b.pos.y),
        top: b.pos.y + b.size.y / 2 - floorLevel(b.pos.y),
        rug: false,
      })),
    ...level.hideouts
      .filter((h) => h.kind !== 'cushion' && indoors(h.pos.x, h.pos.z, h.pos.y))
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
          y: floorLevel(h.pos.y),
          top: h.pos.y + h.size.y / 2 - floorLevel(h.pos.y),
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

  it('lean the broom against a basement wall, somewhere new each time, within reach', () => {
    const basement = ROOMS.find((r) => r.y === BASEMENT_FLOOR)!;
    const spots = new Set<string>();
    for (const level of [HOUSE, ...layouts]) {
      const { pos, facing } = level.broom;
      const at = `broom ${JSON.stringify(level.broom)} in layout`;
      expect(pos.y, at).toBe(BASEMENT_FLOOR);
      expect(inRect(basement, pos.x, pos.z), at).toBe(true);
      // Its back to a wall, a little way out from it.
      const out = { x: -Math.sin(facing), z: -Math.cos(facing) };
      const wall = { x: pos.x - out.x * 0.35, z: pos.z - out.z * 0.35 };
      expect(inRect(basement, wall.x, wall.z), at).toBe(false);
      // Somewhere to stand and pick it up.
      const walk = walkable(level, BASEMENT_FLOOR);
      let near = false;
      for (let d = 0.4; d <= 1.0 && !near; d += 0.1)
        near = walk(pos.x + out.x * d, pos.z + out.z * d);
      expect(near, at).toBe(true);
      // Not in front of the stairs.
      const foot = stairsPlan(level.stairs!.find((st) => st.pos.y === BASEMENT_FLOOR)!).foot;
      expect(inRect(foot, pos.x, pos.z), at).toBe(false);
      spots.add(`${pos.x},${pos.z}`);
    }
    expect(spots.size).toBeGreaterThan(SEEDS.length / 2);
  });

  it('keep all their hiding spots, the seats and the same walls', () => {
    const walls = (l: LevelDef) =>
      JSON.stringify(l.boxes.filter((b) => !b.model && !isSlab(b) && !isCellarSlab(b)));
    for (const level of layouts) {
      expect(level.hideouts.map((h) => h.id)).toEqual(HOUSE.hideouts.map((h) => h.id));
      expect(level.pageSpots.length + level.hideouts.length).toBe(
        HOUSE.pageSpots.length + HOUSE.hideouts.length,
      );
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
        const r = roomOf(...centre(a.rect), a.y);
        const room = ROOMS[r]!;
        // In a room it stood in in the hand-made house (there are three tables), wholly inside.
        const was = original
          .filter((o) => o.name === a.name)
          .map((o) => roomOf(...centre(o.rect), o.y));
        expect(was, at).toContain(r);
        expect(a.rect.x0 >= room.x0 - 1e-9 && a.rect.x1 <= room.x1 + 1e-9, at).toBe(true);
        expect(a.rect.z0 >= room.z0 - 1e-9 && a.rect.z1 <= room.z1 + 1e-9, at).toBe(true);
        for (const s of level.stairs!) {
          const plan = stairsPlan(s);
          const [on, by] = same(a.y, s.pos.y)
            ? [plan.flight, plan.foot]
            : same(a.y, topOf(s))
              ? [plan.railed, plan.top]
              : [null, null];
          if (!on || !by) continue;
          // Never on the stairs or in their well, rugs included.
          expect(overlaps(a.rect, on), `${at} on the stairs`).toBe(false);
          // Nor where you step on and off them.
          if (!a.rug) expect(overlaps(a.rect, by), `${at} by the stairs`).toBe(false);
        }
        if (a.rug) continue;
        for (const d of DOORWAY_CLEARANCE)
          if (d.y === a.y) expect(overlaps(a.rect, d), at).toBe(false);
        for (const s of level.meetingSeats.filter((s) => floorLevel(s.y) === a.y)) {
          const gap = Math.hypot(
            Math.max(a.rect.x0 - s.x, 0, s.x - a.rect.x1),
            Math.max(a.rect.z0 - s.z, 0, s.z - a.rect.z1),
          );
          expect(gap, `${at} by a seat`).toBeGreaterThan(PLAYER_RADIUS);
        }
        if (a.top > 1.2)
          for (const w of level.windows!.filter((w) => (w.y ?? 0) === a.y)) {
            const half = WINDOW_WIDTH / 2;
            const span = w.alongX
              ? { x0: w.x - half, x1: w.x + half, z0: w.z - 0.4, z1: w.z + 0.4 }
              : { x0: w.x - 0.4, x1: w.x + 0.4, z0: w.z - half, z1: w.z + half };
            expect(overlaps(a.rect, span), `${at} in front of a window`).toBe(false);
          }
        for (const b of things.slice(i + 1)) {
          // Drawers sit in the counter's front and the backrest on the seat, by design.
          const parts = [a.name, b.name].sort().join();
          if (b.rug || b.y !== a.y || /drawer/.test(parts) || parts === 'sofa,sofaBack') continue;
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
      expect(windows).toHaveLength(11);
      for (const w of windows) spots.add(`${w.x},${w.y ?? 0},${w.z}`);
      // Three in the kitchen, one in the living room, three in the break room, two in each room
      // upstairs.
      const room = (w: { x: number; y?: number; z: number }) =>
        roomOf(
          Math.max(-11.8, Math.min(w.y ? 3.8 : 11.8, w.x)),
          Math.max(6.2, Math.min(14.8, w.z)),
          w.y ?? 0,
        );
      expect(windows.map(room).sort()).toEqual([0, 0, 0, 1, 2, 2, 2, 3, 3, 4, 4]);
      const plan = stairsPlan(level.stairs![0]!);
      for (const [i, w] of windows.entries()) {
        expect([0, UPPER_FLOOR]).toContain(w.y ?? 0);
        // On an outside wall, away from the corners.
        if (w.alongX) {
          expect([6, 15]).toContain(w.z);
          const r = ROOMS[room(w)]!;
          expect(w.x - half).toBeGreaterThanOrEqual(r.x0 + 0.29);
          expect(w.x + half).toBeLessThanOrEqual(r.x1 - 0.29);
        } else {
          expect(w.y ? [-12, 4] : [-12, 12]).toContain(w.x);
          expect(w.z - half).toBeGreaterThanOrEqual(6.1 + 0.29);
          expect(w.z + half).toBeLessThanOrEqual(14.9 - 0.29);
        }
        if (w.alongX && w.z === 6 && !w.y) {
          // Not over the front door or behind the ladder.
          expect(Math.abs(w.x)).toBeGreaterThan(1 + half);
          for (const l of HOUSE.ladders)
            expect(Math.abs(w.x - l.pos.x)).toBeGreaterThan(l.width / 2 + half);
        }
        // Upstairs, not by the door out onto the roof.
        if (!w.alongX && w.x === 4) expect(Math.abs(w.z - 10)).toBeGreaterThan(2 + half);
        // Downstairs, not behind the stairs.
        if (!w.y) {
          const span = w.alongX
            ? { x0: w.x - half, x1: w.x + half, z0: w.z - 0.4, z1: w.z + 0.4 }
            : { x0: w.x - 0.4, x1: w.x + 0.4, z0: w.z - half, z1: w.z + half };
          expect(overlaps(span, plan.flight), 'a window behind the stairs').toBe(false);
        }
        for (const v of windows.slice(i + 1))
          if (
            (v.y ?? 0) === (w.y ?? 0) &&
            v.alongX === w.alongX &&
            (w.alongX ? v.z === w.z : v.x === w.x)
          )
            expect(Math.abs(w.alongX ? w.x - v.x : w.z - v.z)).toBeGreaterThanOrEqual(WINDOW_WIDTH);
      }
    }
    // They really do move.
    expect(spots.size).toBeGreaterThan(50);
  });

  it("open each doorway's doors to either side, with nothing standing where they stand", () => {
    const sides = new Map<string, Set<number>>();
    for (const [n, level] of layouts.entries()) {
      const doors = level.doors!;
      expect(doors).toHaveLength(5);
      // The open doors: a metre of wall either side of the 2 m opening, on the side they open to.
      const leaves = doors.flatMap((d) => {
        const y = d.y ?? 0;
        const alongX = Math.abs(d.z - 6) < 0.01;
        const [mid, line] = alongX ? [d.x, d.z] : [d.z, d.x];
        const face = line + d.opensTo * 0.1;
        const [c0, c1] = [face, face + d.opensTo * 0.1].sort((a, b) => a - b) as [number, number];
        return [
          [mid - 2, mid - 1],
          [mid + 1, mid + 2],
        ].map(([a0, a1]) =>
          alongX
            ? { x0: a0!, x1: a1!, z0: c0, z1: c1, y }
            : { x0: c0, x1: c1, z0: a0!, z1: a1!, y },
        );
      });
      for (const d of doors) {
        const key = `${d.x},${d.y ?? 0},${d.z}`;
        sides.set(key, (sides.get(key) ?? new Set()).add(d.opensTo));
      }
      for (const leaf of leaves) {
        for (const a of footprints(level))
          if (a.y === leaf.y)
            expect(overlaps(a.rect, leaf), `${a.name} in a door in layout ${SEEDS[n]}`).toBe(false);
        // Nor the stairs, nor where you step on and off them.
        for (const s of level.stairs!) {
          const plan = stairsPlan(s);
          const stairs = same(leaf.y, s.pos.y)
            ? [plan.flight, plan.foot]
            : same(leaf.y, topOf(s))
              ? [plan.railed, plan.top]
              : [];
          for (const r of stairs) expect(overlaps(r, leaf), 'the stairs in a door').toBe(false);
        }
      }
      // Nor anything in the yard outside the front door, such as the lamp posts.
      for (const b of level.boxes.filter((b) => b.model)) {
        const r = {
          x0: b.pos.x - b.size.x / 2,
          x1: b.pos.x + b.size.x / 2,
          z0: b.pos.z - b.size.z / 2,
          z1: b.pos.z + b.size.z / 2,
        };
        for (const leaf of leaves)
          if (floorLevel(b.pos.y) === leaf.y)
            expect(overlaps(r, leaf), `${b.model} in a door`).toBe(false);
      }
      // No window behind the front door's doors, inside or out.
      for (const w of level.windows!)
        if (w.alongX && w.z === 6 && !w.y)
          expect(Math.abs(w.x)).toBeGreaterThan(2 + WINDOW_WIDTH / 2);
    }
    expect([...sides.keys()].sort()).toEqual([
      '-4,0,10',
      '-4,2.8,10',
      '0,0,6',
      '4,0,10',
      '4,2.8,10',
    ]);
    for (const seen of sides.values()) expect([...seen].sort()).toEqual([-1, 1]);
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
      // On every floor, with floor underfoot too (there is none over a stairwell). Standing
      // just above the rugs.
      const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
      for (const [y, x1] of [
        [0, 11.8],
        [UPPER_FLOOR, 3.8],
        [BASEMENT_FLOOR, 11.8],
      ] as const) {
        const walk = walkable(level, y);
        for (let x = y === BASEMENT_FLOOR ? 4.2 : -11.8; x < x1; x += 0.2)
          for (let z = 6.2; z < 14.8; z += 0.2) {
            if (!walk(x, z)) continue;
            const at = { x, y: y + 0.05 + PLAYER_RADIUS + PLAYER_HALF_HEIGHT, z };
            const where = `${x.toFixed(1)}, ${y}, ${z.toFixed(1)}`;
            const hit = sim.world.intersectionWithShape(
              at,
              { x: 0, y: 0, z: 0, w: 1 },
              shape,
              flags,
            );
            expect(hit, `walkable at ${where}`).toBeFalsy();
            ray.origin = { x, y: y + 0.5, z };
            expect(sim.world.castRay(ray, 0.6, true, flags), `floor at ${where}`).toBeTruthy();
          }
      }
    }
  });

  it('put the stairs along a wall of the kitchen or living room, with a well above them', () => {
    const where = new Set<string>();
    for (const [n, level] of layouts.entries()) {
      const at = `layout ${SEEDS[n]}`;
      expect(level.stairs, at).toHaveLength(2);
      const s = level.stairs![0]!;
      expect(s.pos.y, at).toBe(0);
      const plan = stairsPlan(s);
      const r = roomOf(...centre(plan.flight));
      expect([0, 1], at).toContain(r);
      const room = ROOMS[r]!;
      where.add(`${r},${s.facing},${s.wall}`);
      // Wholly inside the room, with room to step on and off, the upstairs room above it.
      for (const q of [plan.flight, plan.foot, plan.railed, plan.top]) {
        expect(q.x0 >= room.x0 - 1e-9 && q.x1 <= room.x1 + 1e-9, at).toBe(true);
        expect(q.z0 >= room.z0 - 1e-9 && q.z1 <= room.z1 + 1e-9, at).toBe(true);
      }
      expect(roomOf(...centre(plan.well), UPPER_FLOOR), at).toBe(r + 3);
      // Against a wall: one long side on the room's edge.
      const long = plan.flight.x1 - plan.flight.x0 > plan.flight.z1 - plan.flight.z0;
      const edges = long
        ? [plan.flight.z0 - room.z0, room.z1 - plan.flight.z1]
        : [plan.flight.x0 - room.x0, room.x1 - plan.flight.x1];
      expect(Math.min(...edges.map(Math.abs)), at).toBeLessThan(1e-6);
      for (const d of DOORWAY_CLEARANCE)
        expect(overlaps(d.y ? plan.railed : plan.flight, d), `${at} in a doorway`).toBe(false);
      // Thirteen steps, each a step higher, the last a step below the upper floor.
      const steps = level.boxes.filter((b) => b.model === 'step' && b.pos.y > 0);
      expect(steps).toHaveLength(STAIRS.steps);
      const tops = steps.map((b) => b.pos.y + b.size.y / 2).sort((a, b) => a - b);
      expect(tops.at(-1)! + STAIRS.rise).toBeCloseTo(UPPER_FLOOR);
      // The upper floor's slab covers it all but the well, which it leaves open.
      const slab = level.boxes.filter(isSlab);
      const area = (q: Rect) => (q.x1 - q.x0) * (q.z1 - q.z0);
      const covered = slab.reduce((sum, b) => sum + b.size.x * b.size.z, 0);
      expect(covered, at).toBeCloseTo(area(UPPER_SLAB) - area(plan.well), 6);
      for (const b of slab) {
        const q = {
          x0: b.pos.x - b.size.x / 2,
          x1: b.pos.x + b.size.x / 2,
          z0: b.pos.z - b.size.z / 2,
          z1: b.pos.z + b.size.z / 2,
        };
        expect(overlaps(q, plan.well), at).toBe(false);
      }
    }
    // Both rooms, and every way round.
    expect(new Set([...where].map((w) => w.split(',')[0]))).toEqual(new Set(['0', '1']));
    expect(where.size).toBeGreaterThan(6);
  });

  it('put the stairs down along a wall of the break room, from the basement under it', () => {
    const where = new Set<string>();
    for (const [n, level] of layouts.entries()) {
      const at = `layout ${SEEDS[n]}`;
      const s = level.stairs![1]!;
      expect(s.pos.y, at).toBe(BASEMENT_FLOOR);
      const plan = stairsPlan(s);
      where.add(`${s.pos.x},${s.pos.z},${s.facing},${s.wall}`);
      // In the basement, coming out in the break room, room to step on and off at both ends.
      const basement = ROOMS[roomOf(...centre(plan.flight), BASEMENT_FLOOR)]!;
      expect(basement.y, at).toBe(BASEMENT_FLOOR);
      expect(roomOf(...centre(plan.well)), at).toBe(2);
      for (const [q, room] of [
        [plan.flight, basement],
        [plan.foot, basement],
        [plan.railed, ROOMS[2]!],
        [plan.top, ROOMS[2]!],
      ] as const) {
        expect(q.x0 >= room.x0 - 1e-9 && q.x1 <= room.x1 + 1e-9, at).toBe(true);
        expect(q.z0 >= room.z0 - 1e-9 && q.z1 <= room.z1 + 1e-9, at).toBe(true);
      }
      for (const d of DOORWAY_CLEARANCE)
        if (d.y === 0) expect(overlaps(plan.railed, d), `${at} in a doorway`).toBe(false);
      // Thirteen steps, the last a step below the break room's floor.
      const steps = level.boxes.filter((b) => b.model === 'step' && b.pos.y < 0);
      expect(steps).toHaveLength(STAIRS.steps);
      const tops = steps.map((b) => b.pos.y + b.size.y / 2).sort((a, b) => a - b);
      expect(tops.at(-1)! + STAIRS.rise).toBeCloseTo(0);
      // The break room's floor covers the basement but for the well.
      const area = (q: Rect) => (q.x1 - q.x0) * (q.z1 - q.z0);
      const covered = level.boxes
        .filter(isCellarSlab)
        .reduce((sum, b) => sum + b.size.x * b.size.z, 0);
      expect(covered, at).toBeCloseTo(area(BASEMENT_SLAB) - area(plan.well), 6);
      // And the electrical panel is on one of the basement's walls.
      const panel = level.boxes.find((b) => b.model === 'panel')!;
      expect(floorLevel(panel.pos.y), at).toBe(BASEMENT_FLOOR);
      const edge = Math.min(
        panel.pos.x - basement.x0,
        basement.x1 - panel.pos.x,
        panel.pos.z - basement.z0,
        basement.z1 - panel.pos.z,
      );
      expect(edge, at).toBeLessThan(0.1);
    }
    expect(where.size).toBeGreaterThan(20);
  });

  it('can be walked up each flight of stairs and down again', () => {
    for (const [n, level] of layouts.slice(0, 6).entries()) {
      const sim = new Sim(RAPIER, level);
      const s = level.stairs![n % 2]!;
      const plan = stairsPlan(s);
      const foot = centre(plan.foot);
      const p = sim.addPlayer({ spawn: { x: foot[0], y: s.pos.y, z: foot[1] } });
      for (let i = 0; i < 30; i++) sim.step();
      const climb = (yaw: number, ticks: number) => {
        for (let i = 0; i < ticks; i++) {
          p.input = { ...p.input, yaw, forward: 1 };
          sim.step();
        }
      };
      climb(s.facing, 240);
      const feet = p.body.translation().y - PLAYER_HALF_HEIGHT - PLAYER_RADIUS;
      expect(feet, `up the stairs in layout ${JSON.stringify(s)}`).toBeGreaterThan(topOf(s) - 0.05);
      climb(s.facing + Math.PI, 240);
      const down = p.body.translation().y - PLAYER_HALF_HEIGHT - PLAYER_RADIUS;
      expect(down, 'back down').toBeLessThan(s.pos.y + 0.1);
    }
  });

  it('let players up and down each flight hugging either side, and along its side, unstuck', () => {
    const run = STAIRS.steps * STAIRS.tread;
    for (const level of layouts.slice(0, 8)) {
      for (const s of level.stairs!) {
        const open = -s.wall;
        // Along the flight (`a`, from its foot) and across it (`c`, toward its open side).
        const f = { x: -Math.round(Math.sin(s.facing)), z: -Math.round(Math.cos(s.facing)) };
        const r = { x: Math.round(Math.cos(s.facing)), z: -Math.round(Math.sin(s.facing)) };
        const at = (a: number, c: number) => ({
          x: s.pos.x + f.x * a + r.x * c * open,
          z: s.pos.z + f.z * a + r.z * c * open,
        });
        const along = (p: Player) => {
          const q = p.body.translation();
          return (q.x - s.pos.x) * f.x + (q.z - s.pos.z) * f.z;
        };
        const start = (a: number, c: number, y: number) => {
          const sim = new Sim(RAPIER, level);
          const w = at(a, c);
          const p = sim.addPlayer({ spawn: { x: w.x, y, z: w.z } });
          for (let i = 0; i < 5; i++) sim.step();
          return { sim, p };
        };
        const walk = (sim: Sim, p: Player, yaw: number, right: number, ticks: number) => {
          p.input = { ...p.input, yaw, forward: 1, right };
          for (let i = 0; i < ticks; i++) sim.step();
        };
        const where = (what: string) => `${what} on ${JSON.stringify(s)}`;
        // Pushing into the handrail or the wall on the way, square on or at an angle.
        for (const push of [0.3, -0.3, 1, -1]) {
          const up = start(-0.6, 0, s.pos.y);
          walk(up.sim, up.p, s.facing, push * open, 300);
          expect(along(up.p), where(`up pushing ${push}`)).toBeGreaterThan(run);
          const down = start(run + 0.6, 0, topOf(s));
          walk(down.sim, down.p, s.facing + Math.PI, -push * open, 300);
          expect(along(down.p), where(`down pushing ${push}`)).toBeLessThan(0);
        }
        // Walked into from the side, then along it either way.
        for (const a of [1.2, run / 2]) {
          for (const turn of [1, -1]) {
            const { sim, p } = start(a, 1.1, s.pos.y);
            walk(sim, p, s.facing + (open * Math.PI) / 2, 0, 60);
            const from = along(p);
            // Up or down it, still leaning in.
            walk(sim, p, s.facing + (turn < 0 ? Math.PI : 0) + turn * open * 0.3, 0, 20);
            expect(Math.abs(along(p) - from), where(`along its side from ${a}`)).toBeGreaterThan(
              0.5,
            );
          }
        }
      }
    }
  }, 60_000);

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
      // Every room downstairs has somewhere for the dog to go.
      for (const room of ROOMS.filter((r) => r.y === 0))
        expect(points.some((p) => inRect(room, p.x, p.z))).toBe(true);
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
