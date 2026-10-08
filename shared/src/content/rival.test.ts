import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { HOUSE, floorRect, groundPieces, levelSites } from './house.ts';
import { houseLayout } from './layout.ts';
import { RIVAL_ID_OFFSET, RIVAL_WALL, rivalLevel, sideOf } from './rival.ts';
import { DOG_HALF_HEIGHT, DOG_RADIUS } from '../sim/dog.ts';
import { Sim } from '../sim/sim.ts';

beforeAll(async () => {
  await RAPIER.init();
});

describe('the rival teams level', () => {
  const level = rivalLevel(HOUSE);

  it('is the house and yard twice, facing each other across a low wall with a gate', () => {
    expect(floorRect(level)).toEqual({ x0: -16, x1: 16, z0: -48, z1: 16 });
    const fences = HOUSE.boxes.filter(
      (b) => !b.model && b.size.x >= 31 && Math.abs(b.pos.z + 16) < 0.5,
    );
    expect(fences).toHaveLength(1);
    // Everything but that fence, twice, plus the two halves of the wall.
    expect(level.boxes).toHaveLength((HOUSE.boxes.length - 1) * 2 + 2);
    const wall = level.boxes.filter(
      (b) => Math.abs(b.pos.z + 16) < 0.01 && b.size.y === RIVAL_WALL.height,
    );
    expect(wall).toHaveLength(2);
    for (const w of wall)
      expect(Math.min(...[-1, 1].map((s) => Math.abs(w.pos.x + (s * w.size.x) / 2)))).toBeCloseTo(
        RIVAL_WALL.gate / 2,
      );
    // The copy of the job site sits straight across the wall from the original.
    const [a, b] = levelSites(level);
    // Its 1.6 m plate spans -32.8 to -31.2: centred on (0, -32), straight across from (0, 0).
    expect(b!.baseplate).toEqual({ x: -0.8, y: 0, z: -32.8 });
    expect(b!.inspector.pos).toEqual({ x: -a!.inspector.pos.x, y: 0, z: -32 - a!.inspector.pos.z });
    expect(b!.board.facing).toBeCloseTo(a!.board.facing + Math.PI);
    expect(sideOf(level, a!.spawn)).toBe(0);
    expect(sideOf(level, b!.spawn)).toBe(1);
    expect(sideOf(HOUSE, a!.spawn)).toBeNull();
  });

  it('gives the copy its own bins, hiding places, pages\u2019 spots, lights, windows and jar', () => {
    expect(level.bins).toHaveLength(HOUSE.bins.length * 2);
    expect(new Set(level.bins.map((b) => b.id)).size).toBe(level.bins.length);
    expect(level.hideouts).toHaveLength(HOUSE.hideouts.length * 2);
    expect(new Set(level.hideouts.map((h) => h.id)).size).toBe(level.hideouts.length);
    expect(level.hideouts.at(-1)!.id).toBeGreaterThanOrEqual(RIVAL_ID_OFFSET);
    expect(level.pageSpots).toHaveLength(HOUSE.pageSpots.length * 2);
    expect(level.lights).toHaveLength(HOUSE.lights.length * 2);
    expect(level.dog.treatJars).toHaveLength(1);
    expect(level.hideouts.filter((h) => sideOf(level, h.pos) === 1)).toHaveLength(
      HOUSE.hideouts.length,
    );
    expect(level.pageSpots.filter((p) => sideOf(level, p) === 1)).toHaveLength(
      HOUSE.pageSpots.length,
    );
    // The ground covers both yards but for the two basements.
    const area = groundPieces(level).reduce((s, q) => s + (q.x1 - q.x0) * (q.z1 - q.z0), 0);
    const holes = (level.groundHoles ?? []).reduce((s, q) => s + (q.x1 - q.x0) * (q.z1 - q.z0), 0);
    expect(level.groundHoles).toHaveLength(HOUSE.groundHole ? 2 : 0);
    expect(area).toBeCloseTo(32 * 64 - holes, 5);
  });

  it('lets the dog walk every link, through the gate to the other yard and back', () => {
    const shape = new RAPIER.Capsule(DOG_HALF_HEIGHT, DOG_RADIUS);
    const flags =
      RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC |
      RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC |
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    const layout = houseLayout(3);
    for (const [base, lvl] of [
      [HOUSE, level],
      [layout, rivalLevel(layout)],
    ] as const) {
      const sim = new Sim(RAPIER, lvl);
      sim.step();
      const { points, links } = lvl.dog;
      expect(links).toHaveLength(base.dog.links.length * 2 + 1);
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
      // Both yards' points can be reached from where the dog starts.
      const seen = new Set([lvl.dog.start]);
      const todo = [lvl.dog.start];
      while (todo.length) {
        const p = todo.pop()!;
        for (const [a, b] of links) {
          for (const [u, v] of [
            [a, b],
            [b, a],
          ] as const) {
            if (u === p && !seen.has(v)) {
              seen.add(v);
              todo.push(v);
            }
          }
        }
      }
      expect(seen.size).toBe(points.length);
    }
  });
});
