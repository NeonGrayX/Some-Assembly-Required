import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { BIN_SIZE, HOUSE, RACK_TILT, binPose, binSize, stockPrintShelf } from '../content/house.ts';
import { MANGA_SHOP } from './mangashop.ts';
import { boxesOverlap } from '../content/hideouts.ts';
import { houseLayout } from '../content/layout.ts';
import { BrickGrid } from '../grid.ts';
import { makeRng, v3 } from '../math.ts';
import type { Vec3 } from '../math.ts';
import { Round } from '../round.ts';
import { Sim } from '../sim/sim.ts';
import { BUILDS, buildById } from './catalog.ts';
import { LIGHTHOUSE } from './lighthouse.ts';
import { matchBuild } from './match.ts';
import { allBricks } from './types.ts';
import { footprint } from '../bricks.ts';
import { validateBuild } from './validate.ts';
import { binColours, colourVariant } from './variant.ts';
import { BUILD_FILE_LIMITS, buildProblems } from './file.ts';

beforeAll(async () => {
  await RAPIER.init();
});

const brickCount = (id: string) => allBricks(buildById(id)!).length;

describe('the builds', () => {
  it('have their own ids and names', () => {
    const ids = BUILDS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(BUILDS.map((b) => b.name)).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(10);
  });

  it('take about as long as the lighthouse, or are big builds of up to 32 pages', () => {
    for (const build of BUILDS) {
      if (build.steps.length === LIGHTHOUSE.steps.length) {
        expect(Math.abs(brickCount(build.id) - brickCount('lighthouse')), build.id).toBeLessThan(5);
      } else {
        expect(build.steps.length, build.id).toBeGreaterThan(LIGHTHOUSE.steps.length);
        expect(build.steps.length, build.id).toBeLessThanOrEqual(BUILD_FILE_LIMITS.pages);
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

  it('follow every rule a build file does, with the bricks the bins of the house hand out', () => {
    // At most 20 kinds of brick on a page, buildable in order, nothing pushed on from
    // underneath, and every brick in a bin.
    const bins = binColours(HOUSE);
    for (const build of BUILDS) expect(buildProblems(build, bins), build.id).toEqual([]);
  });

  it('keep every bin on a rack, clear of the rack and everything else', () => {
    // The specialty shelf stocked too, as for the build with the most printed parts.
    const level = stockPrintShelf(HOUSE, MANGA_SHOP);
    expect(level.bins.length).toBeGreaterThan(HOUSE.bins.length);
    const tiltQuat = (t: number) => ({ x: Math.sin(t / 2), y: 0, z: 0, w: Math.cos(t / 2) });
    for (const bin of level.bins) {
      // Tipped forward with its shelf.
      expect(bin.tilt, `bin ${bin.id}`).toBe(RACK_TILT);
      const pose = binPose(bin);
      const { centre, half } = pose;
      for (const box of HOUSE.boxes) {
        const other = {
          centre: box.pos,
          half: v3(box.size.x / 2, box.size.y / 2, box.size.z / 2),
          rot: tiltQuat(box.tiltX ?? 0),
        };
        expect(
          boxesOverlap(pose, other),
          `bin ${bin.id} and the box at ${JSON.stringify(box.pos)}`,
        ).toBe(false);
      }
      // Resting on a shelf: just above one, right under its middle.
      const below = v3(centre.x, centre.y - half.y - 0.01, centre.z);
      const shelf = HOUSE.boxes.find(
        (b) =>
          b.tiltX === RACK_TILT &&
          boxesOverlap(
            { centre: below, half: v3(0.005, 0.005, 0.005), rot: pose.rot },
            {
              centre: b.pos,
              half: v3(b.size.x / 2, b.size.y / 2, b.size.z / 2),
              rot: tiltQuat(RACK_TILT),
            },
            0,
          ),
      );
      expect(shelf, `bin ${bin.id} stands on a shelf`).toBeDefined();
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
        const size = binSize(bin);
        const h = half(size.x, size.z);
        const hits = (pos: Vec3, o: { x: number; z: number }) =>
          Math.abs(pos.x - bin.pos.x) < h.x + o.x && Math.abs(pos.z - bin.pos.z) < h.z + o.z;
        for (const other of level.bins.slice(i + 1)) {
          const os = binSize(other);
          if (other.pos.y < bin.pos.y + size.y && bin.pos.y < other.pos.y + os.y)
            expect(hits(other.pos, half(os.x, os.z)), `bins ${bin.id} and ${other.id}`).toBe(false);
        }
        // Up on a table or the ledge; parts drawers stand on their rack's shelves.
        if (bin.pos.y > 0 || bin.small) return;
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
          // Every brick comes from a bin that hands it out; snap it on.
          const grid = BrickGrid.from([
            { id: 0, type: 'baseplate16', colour: 'baseplate-green', x: 0, y: 0, z: 0, rot: 0 },
          ]);
          allBricks(variant).forEach((b, i) => {
            const bin = level.bins.find((x) => x.type === b.type && x.colour === b.colour);
            expect(bin, `${b.colour} ${b.type}`).toBeDefined();
            expect(grid.add({ ...b, id: i + 1 }).ok).toBe(true);
          });
          const r = matchBuild(variant, grid);
          expect(r.passed).toBe(true);
          expect(r.counts.correct).toBe(allBricks(variant).length);
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
