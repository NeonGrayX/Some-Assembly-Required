import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { HOUSE } from '../content/house.ts';
import { houseLayout } from '../content/layout.ts';
import { BrickGrid } from '../grid.ts';
import { makeRng } from '../math.ts';
import { Round } from '../round.ts';
import { Sim } from '../sim/sim.ts';
import { BUILDS, buildById } from './catalog.ts';
import { LIGHTHOUSE } from './lighthouse.ts';
import { matchBuild } from './match.ts';
import { allBricks } from './types.ts';
import { validateBuild } from './validate.ts';
import { binColours, colourVariant } from './variant.ts';

beforeAll(async () => {
  await RAPIER.init();
});

const brickCount = (id: string) => allBricks(buildById(id)!).length;

describe('the builds', () => {
  it('have their own ids and include the rocket and the giant duck', () => {
    const ids = BUILDS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['lighthouse', 'rocket', 'giant-duck']);
  });

  it('take about as long as the lighthouse: 8 pages and a similar number of bricks', () => {
    for (const build of BUILDS) {
      expect(build.steps, build.id).toHaveLength(LIGHTHOUSE.steps.length);
      expect(Math.abs(brickCount(build.id) - brickCount('lighthouse')), build.id).toBeLessThan(5);
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
