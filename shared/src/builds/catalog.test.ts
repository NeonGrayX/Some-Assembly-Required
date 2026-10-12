import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { HOUSE, MOULD_TYPES, machinePose, printJobs } from '../content/house.ts';
import { boxesOverlap } from '../content/hideouts.ts';
import { houseLayout } from '../content/layout.ts';
import { BrickGrid } from '../grid.ts';
import { makeRng, v3 } from '../math.ts';
import { Round } from '../round.ts';
import { Sim } from '../sim/sim.ts';
import { BUILDS, buildById } from './catalog.ts';
import { matchBuild } from './match.ts';
import { allBricks, printKey } from './types.ts';
import { pageHides } from './visible.ts';
import { footprint } from '../bricks.ts';
import { validateBuild } from './validate.ts';
import { binColours, colourVariant, makeableColours } from './variant.ts';
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

  it('are quick builds of 10 to 16 pages, or big builds of up to 32 pages', () => {
    for (const build of BUILDS) {
      const pages = build.steps.length;
      if (pages <= 16) {
        expect(pages, build.id).toBeGreaterThanOrEqual(10);
        expect(brickCount(build.id), build.id).toBeLessThanOrEqual(12 * pages);
      } else {
        expect(pages, build.id).toBeLessThanOrEqual(BUILD_FILE_LIMITS.pages);
      }
      // A page adds a handful of parts, never a pile nobody could follow.
      for (const step of build.steps) expect(step.bricks.length, build.id).toBeLessThanOrEqual(20);
    }
  });

  it('show every part a page adds in its picture', () => {
    // The Manga Shop's manual keeps three its original hides, like a floor plate in its walls.
    for (const build of BUILDS.filter((b) => b.id !== 'manga-shop'))
      expect(pageHides(build), build.id).toEqual([]);
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

  it('follow every rule a build file does, with the bricks the brick works make', () => {
    // At most 20 kinds of brick on a page, buildable in order, nothing pushed on from
    // underneath, and every brick one the machines make.
    const bins = binColours(HOUSE);
    for (const build of BUILDS) expect(buildProblems(build, bins), build.id).toEqual([]);
  });

  it('stand the machines clear of the yard and each other', () => {
    const tiltQuat = (t: number) => ({ x: Math.sin(t / 2), y: 0, z: 0, w: Math.cos(t / 2) });
    HOUSE.machines.forEach((m, i) => {
      const pose = machinePose(m);
      for (const box of HOUSE.boxes) {
        const other = {
          centre: box.pos,
          half: v3(box.size.x / 2, box.size.y / 2, box.size.z / 2),
          rot: tiltQuat(box.tiltX ?? 0),
        };
        expect(
          boxesOverlap(pose, other),
          `${m.kind} and the box at ${JSON.stringify(box.pos)}`,
        ).toBe(false);
      }
      for (const other of HOUSE.machines.slice(i + 1))
        expect(boxesOverlap(pose, machinePose(other)), `${m.kind}, ${other.kind}`).toBe(false);
    });
  });

  it('stand the machines clear of the furniture in every layout', () => {
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
      ].filter((x) => x.y < 0.3);
      for (const m of level.machines) {
        const h = half(m.size.x, m.size.z, m.facing);
        for (const x of solid) {
          const hits =
            Math.abs(x.pos.x - m.pos.x) < h.x + x.h.x - 0.001 &&
            Math.abs(x.pos.z - m.pos.z) < h.z + x.h.z - 0.001;
          expect(hits, `${m.kind} ${m.id} and ${JSON.stringify(x.pos)}`).toBe(false);
        }
      }
    }
  });

  for (const build of BUILDS) {
    describe(build.name, () => {
      it('can be built step by step on the baseplate', () => {
        expect(validateBuild(build)).toEqual([]);
      });

      // 25 whole rounds set up and built: slow for the biggest builds on a busy machine.
      it('can be finished from the brick works in every round, whatever its colours', () => {
        for (let seed = 1; seed <= 25; seed++) {
          const level = houseLayout(seed);
          const variant = colourVariant(build, binColours(level), makeRng(seed));
          expect(validateBuild(variant)).toEqual([]);
          const sim = new Sim(RAPIER, level, seed);
          new Round(sim, variant, { seed });
          // Every brick is one the machines make (and the printer prints); snap it on.
          const jobs = printJobs(variant);
          const grid = BrickGrid.from([
            { id: 0, type: 'baseplate16', colour: 'baseplate-green', x: 0, y: 0, z: 0, rot: 0 },
          ]);
          allBricks(variant).forEach((b, i) => {
            expect(MOULD_TYPES, b.type).toContain(b.type);
            expect(makeableColours(), b.colour).toContain(b.colour);
            if (b.prints)
              expect(
                jobs.some((j) => j.type === b.type && printKey(j.prints) === printKey(b.prints)),
              ).toBe(true);
            expect(grid.add({ ...b, id: i + 1 }).ok).toBe(true);
          });
          const r = matchBuild(variant, grid);
          expect(r.passed).toBe(true);
          expect(r.counts.correct).toBe(allBricks(variant).length);
        }
      }, 30_000);
    });
  }
});
