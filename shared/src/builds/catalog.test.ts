import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { BIN_SIZE, HOUSE } from '../content/house.ts';
import { houseLayout } from '../content/layout.ts';
import { BrickGrid } from '../grid.ts';
import { makeRng } from '../math.ts';
import type { Vec3 } from '../math.ts';
import { Round } from '../round.ts';
import { Sim } from '../sim/sim.ts';
import { BUILDS, buildById } from './catalog.ts';
import { LIGHTHOUSE } from './lighthouse.ts';
import { matchBuild } from './match.ts';
import { allBricks } from './types.ts';
import type { TargetBrick } from './types.ts';
import { BRICK_TYPES, footprint } from '../bricks.ts';
import { validateBuild } from './validate.ts';
import { binColours, colourVariant } from './variant.ts';

beforeAll(async () => {
  await RAPIER.init();
});

const brickCount = (id: string) => allBricks(buildById(id)!).length;

/** The studs a brick covers, as "x,z". */
function studs(b: TargetBrick): Set<string> {
  const { w, d } = footprint(b.type, b.rot);
  const out = new Set<string>();
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) out.add(`${b.x + i},${b.z + j}`);
  return out;
}

describe('the builds', () => {
  it('have their own ids and names', () => {
    const ids = BUILDS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(BUILDS.map((b) => b.name)).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(10);
  });

  it('take about as long as the lighthouse, or are big builds of up to 16 pages', () => {
    for (const build of BUILDS) {
      if (build.steps.length === LIGHTHOUSE.steps.length) {
        expect(Math.abs(brickCount(build.id) - brickCount('lighthouse')), build.id).toBeLessThan(5);
      } else {
        expect(build.steps.length, build.id).toBeGreaterThan(LIGHTHOUSE.steps.length);
        expect(build.steps.length, build.id).toBeLessThanOrEqual(16);
        expect(brickCount(build.id), build.id).toBeGreaterThan(2.5 * brickCount('lighthouse'));
      }
    }
  });

  it('include a castle that covers the whole baseplate on 16 pages', () => {
    const castle = buildById('castle')!;
    expect(castle.steps).toHaveLength(16);
    const xs = allBricks(castle).flatMap((b) => [b.x, b.x + footprint(b.type, b.rot).w - 1]);
    const zs = allBricks(castle).flatMap((b) => [b.z, b.z + footprint(b.type, b.rot).d - 1]);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]).toEqual([
      0, 15, 0, 15,
    ]);
  });

  it('can be built from bricks that sit on something below them', () => {
    // Nothing has to be pushed on from underneath, which the snapping cannot do.
    for (const build of BUILDS) {
      const placed: TargetBrick[] = [];
      for (const b of allBricks(build)) {
        const cells = studs(b);
        const resting =
          b.y === 1 ||
          placed.some(
            (p) =>
              p.y + BRICK_TYPES[p.type].plates === b.y && [...studs(p)].some((c) => cells.has(c)),
          );
        expect(resting, `${build.id} ${JSON.stringify(b)}`).toBe(true);
        placed.push(b);
      }
    }
  });

  it('fit an instruction page: at most four kinds of brick on any page', () => {
    for (const build of BUILDS) {
      for (const step of build.steps) {
        const kinds = new Set(step.bricks.map((b) => `${b.type}|${b.colour}`));
        expect(kinds.size, build.id).toBeLessThanOrEqual(4);
      }
    }
  });

  it('stand their bins clear of each other and of the furniture in every layout', () => {
    const half = (x: number, z: number, facing = 0) =>
      Math.abs(Math.sin(facing)) > 0.5 ? { x: z / 2, z: x / 2 } : { x: x / 2, z: z / 2 };
    for (let seed = 1; seed <= 25; seed++) {
      const level = houseLayout(seed);
      const solid = [
        ...level.boxes.map((x) => ({
          pos: x.pos,
          h: half(x.size.x, x.size.z),
          y: x.pos.y - x.size.y / 2,
        })),
        ...level.hideouts.map((x) => ({
          pos: x.pos,
          h: half(x.size.x, x.size.z, x.facing),
          y: x.pos.y,
        })),
      ].filter((x) => x.y < BIN_SIZE.y);
      level.bins.forEach((bin, i) => {
        const h = half(BIN_SIZE.x, BIN_SIZE.z);
        const hits = (pos: Vec3, o: { x: number; z: number }) =>
          Math.abs(pos.x - bin.pos.x) < h.x + o.x && Math.abs(pos.z - bin.pos.z) < h.z + o.z;
        for (const other of level.bins.slice(i + 1)) {
          if (other.pos.y === bin.pos.y)
            expect(hits(other.pos, h), `bins ${bin.id} and ${other.id}`).toBe(false);
        }
        if (bin.pos.y > 0) return; // up on a table or the ledge
        for (const x of solid)
          expect(hits(x.pos, x.h), `bin ${bin.id} at ${JSON.stringify(x.pos)}`).toBe(false);
      });
    }
  });

  for (const build of BUILDS) {
    describe(build.name, () => {
      it('can be built step by step on the baseplate', () => {
        expect(validateBuild(build)).toEqual([]);
      });

      it('can be finished from the bins in every round, whatever its colours', () => {
        for (let seed = 1; seed <= 25; seed++) {
          const level = houseLayout(seed);
          const variant = colourVariant(build, binColours(level), makeRng(seed));
          expect(validateBuild(variant)).toEqual([]);
          const sim = new Sim(RAPIER, level, seed);
          new Round(sim, variant, { seed });
          // Take every brick out of the bin that hands it out, then snap it on.
          const grid = BrickGrid.from([
            { id: 0, type: 'baseplate16', colour: 'baseplate-green', x: 0, y: 0, z: 0, rot: 0 },
          ]);
          allBricks(variant).forEach((b, i) => {
            const bin = level.bins.find((x) => x.type === b.type && x.colour === b.colour);
            expect(bin, `${b.colour} ${b.type}`).toBeDefined();
            const left = sim.binStock.get(bin!.id)!;
            expect(left, `${b.colour} ${b.type}`).toBeGreaterThan(0);
            sim.setStock(bin!.id, left - 1);
            expect(grid.add({ ...b, id: i + 1 }).ok).toBe(true);
          });
          const r = matchBuild(variant, grid);
          expect(r.passed).toBe(true);
          expect(r.counts.correct).toBe(allBricks(variant).length);
          // The spare is still there, so one dropped brick does not lose the round.
          for (const bin of level.bins) expect(sim.binStock.get(bin.id)).toBeGreaterThan(0);
        }
      });
    });
  }

  it('leave some bins unused in every round, so the decoy counts have bins to hide', () => {
    for (const build of BUILDS) {
      const used = new Set(allBricks(build).map((b) => `${b.type}|${b.colour}`));
      expect(HOUSE.bins.filter((b) => !used.has(`${b.type}|${b.colour}`)).length).toBeGreaterThan(
        5,
      );
    }
  });
});
