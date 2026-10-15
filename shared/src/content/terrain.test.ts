import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeRng } from '../math.ts';
import { CONTROLLER_OFFSET, PLAYER_FEET, Sim } from '../sim/sim.ts';
import type { LevelDef } from './house.ts';
import { islandLayout } from './maps/island.ts';
import { rivalLevel } from './rival.ts';
import {
  groundHeight,
  groundSlope,
  groundSpan,
  inSea,
  sampleTerrain,
  terrainHeight,
  terrainRect,
  terrainTriangles,
  turnedTerrain,
} from './terrain.ts';
import type { TerrainDef } from './terrain.ts';

beforeAll(async () => {
  await RAPIER.init();
});

/** A small bumpy terrain to try things on. */
const BUMPS: TerrainDef = sampleTerrain(
  { x0: -3, z0: -2, x1: 3, z1: 4 },
  0.5,
  (x, z) => Math.sin(x * 1.3) * 0.8 + Math.cos(z * 0.9) * 0.5 - 0.2,
);

describe('terrain', () => {
  it('passes through its samples, and is flat in between along each triangle', () => {
    for (let i = 0; i < BUMPS.nx; i++)
      for (let k = 0; k < BUMPS.nz; k++)
        expect(terrainHeight(BUMPS, BUMPS.x0 + i * 0.5, BUMPS.z0 + k * 0.5)).toBeCloseTo(
          BUMPS.heights[i * BUMPS.nz + k]!,
          9,
        );
    // Halfway along the diagonal each cell is split on, the two triangles agree.
    const h10 = BUMPS.heights[1 * BUMPS.nz + 0]!;
    const h01 = BUMPS.heights[0 * BUMPS.nz + 1]!;
    expect(terrainHeight(BUMPS, BUMPS.x0 + 0.25, BUMPS.z0 + 0.25)).toBeCloseTo((h10 + h01) / 2, 9);
    // Off the grid, the height at its nearest edge.
    expect(terrainHeight(BUMPS, -10, -2)).toBeCloseTo(BUMPS.heights[0]!, 9);
  });

  it('is drawn as two triangles a cell, facing up', () => {
    const { vertices, indices } = terrainTriangles(BUMPS);
    expect(vertices.length).toBe(BUMPS.nx * BUMPS.nz * 3);
    expect(indices.length).toBe((BUMPS.nx - 1) * (BUMPS.nz - 1) * 6);
    for (let j = 0; j < indices.length; j += 3) {
      const [a, b, c] = [indices[j]!, indices[j + 1]!, indices[j + 2]!].map((n) => [
        vertices[n * 3]!,
        vertices[n * 3 + 1]!,
        vertices[n * 3 + 2]!,
      ]) as [number[], number[], number[]];
      const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
      const v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
      // The normal's y, (u × v).y, points up.
      expect(u[2]! * v[0]! - u[0]! * v[2]!).toBeGreaterThan(0);
    }
  });

  it('finds the lowest and highest ground under a rectangle', () => {
    const level = { terrain: [BUMPS] };
    const r = { x0: -1.2, z0: 0.3, x1: 1.7, z1: 2.1 };
    const span = groundSpan(level, r);
    const rand = makeRng(5);
    for (let n = 0; n < 500; n++) {
      const x = r.x0 + rand() * (r.x1 - r.x0);
      const z = r.z0 + rand() * (r.z1 - r.z0);
      const h = groundHeight(level, x, z);
      expect(h).toBeGreaterThanOrEqual(span.min - 1e-9);
      expect(h).toBeLessThanOrEqual(span.max + 1e-9);
    }
    // Flat ground is at 0, and level.
    expect(groundSpan({}, r)).toEqual({ min: 0, max: 0 });
    expect(groundSlope({}, 1, 1)).toBe(0);
  });

  it('turns half round about a point, the same surface turned', () => {
    const zm = -5;
    const turned = turnedTerrain(BUMPS, zm);
    const r = terrainRect(BUMPS);
    const t = terrainRect(turned);
    expect(t).toEqual({ x0: -r.x1, z0: 2 * zm - r.z1, x1: -r.x0, z1: 2 * zm - r.z0 });
    const rand = makeRng(9);
    for (let n = 0; n < 500; n++) {
      const x = r.x0 + rand() * (r.x1 - r.x0);
      const z = r.z0 + rand() * (r.z1 - r.z0);
      expect(terrainHeight(turned, -x, 2 * zm - z)).toBeCloseTo(terrainHeight(BUMPS, x, z), 9);
    }
  });

  it('is under the sea where it lies below the sea level', () => {
    const level = { terrain: [BUMPS], sea: 0 };
    const rand = makeRng(3);
    for (let n = 0; n < 200; n++) {
      const x = -3 + rand() * 6;
      const z = -2 + rand() * 6;
      expect(inSea(level, x, z)).toBe(groundHeight(level, x, z) < -0.05);
    }
    expect(inSea({ terrain: [BUMPS] }, 0, 0)).toBe(false);
  });

  it('is walked on just where it is drawn, the island and its rival copy alike', () => {
    for (const level of [islandLayout(1), rivalLevel(islandLayout(2))] as LevelDef[]) {
      const sim = new Sim(RAPIER, level);
      sim.step();
      const down = { x: 0, y: -1, z: 0 };
      const rand = makeRng(11);
      for (const t of level.terrain!) {
        const r = terrainRect(t);
        for (let n = 0; n < 300; n++) {
          const x = r.x0 + rand() * (r.x1 - r.x0);
          const z = r.z0 + rand() * (r.z1 - r.z0);
          const hit = sim.world.castRay(
            new RAPIER.Ray({ x, y: 50, z }, down),
            100,
            true,
            undefined,
            undefined,
            undefined,
            undefined,
            (c) => sim.ownerOf(c)?.kind === 'ground',
          );
          expect(hit, `ground at ${x}, ${z}`).toBeTruthy();
          expect(50 - hit!.timeOfImpact).toBeCloseTo(groundHeight(level, x, z), 3);
        }
      }
    }
  });

  it('stands a player who has slipped into it back on it, not over it', () => {
    const level = islandLayout(1);
    const sim = new Sim(RAPIER, level);
    const p = sim.addPlayer();
    for (let i = 0; i < 10; i++) sim.step();
    /** How high the player's feet are over the ground under them. */
    const over = () => {
      const at = p.body.translation();
      return at.y - PLAYER_FEET - CONTROLLER_OFFSET - groundHeight(level, at.x, at.z);
    };
    // Sunk from a little to most of their height: their middle may still be over the ground.
    for (const sunk of [0.3, 0.6, 0.9]) {
      const at = p.body.translation();
      p.body.setTranslation({ x: at.x, y: at.y - over() - sunk, z: at.z }, true);
      sim.step();
      expect(over(), `sunk ${sunk}`).toBeCloseTo(0, 2);
    }
  });
});
