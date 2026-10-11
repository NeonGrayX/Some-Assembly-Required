import { describe, expect, it } from 'vitest';
import clockTower from '../../../builds/clock-tower.sarbuild.json';
import cornerCafe from '../../../builds/corner-cafe.sarbuild.json';
import diner from '../../../builds/diner.sarbuild.json';
import fireStation from '../../../builds/fire-station.sarbuild.json';
import iceCreamShop from '../../../builds/ice-cream-shop.sarbuild.json';
import izakaya from '../../../builds/izakaya.sarbuild.json';
import mangaShop from '../../../builds/manga-shop.sarbuild.json';
import observatory from '../../../builds/observatory.sarbuild.json';
import pagoda from '../../../builds/pagoda.sarbuild.json';
import pirateShip from '../../../builds/pirate-ship.sarbuild.json';
import trainStation from '../../../builds/train-station.sarbuild.json';
import treehouse from '../../../builds/treehouse.sarbuild.json';
import { parseBuildFile } from './file.ts';
import { allBins } from './variant.ts';

/** The build files shipped in the repo's builds/ folder, by file name. */
const FILES: Record<string, unknown> = {
  'clock-tower.sarbuild.json': clockTower,
  'corner-cafe.sarbuild.json': cornerCafe,
  'diner.sarbuild.json': diner,
  'fire-station.sarbuild.json': fireStation,
  'ice-cream-shop.sarbuild.json': iceCreamShop,
  'izakaya.sarbuild.json': izakaya,
  'manga-shop.sarbuild.json': mangaShop,
  'observatory.sarbuild.json': observatory,
  'pagoda.sarbuild.json': pagoda,
  'pirate-ship.sarbuild.json': pirateShip,
  'train-station.sarbuild.json': trainStation,
  'treehouse.sarbuild.json': treehouse,
};

describe('build files in builds/', () => {
  for (const [file, data] of Object.entries(FILES)) {
    // Checked the way the build editor imports them: every rule but which bins the house has.
    it(`${file} imports into the build editor without problems`, () => {
      const r = parseBuildFile(JSON.stringify(data), allBins());
      expect(r.ok ? [] : r.problems).toEqual([]);
      if (!r.ok) return;
      expect(file).toBe(`${r.build.id}.sarbuild.json`);
    });
  }
});
