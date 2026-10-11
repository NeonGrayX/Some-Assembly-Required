import cafe from '../../../builds/corner-cafe.sarbuild.json';
import clockTower from '../../../builds/clock-tower.sarbuild.json';
import diner from '../../../builds/diner.sarbuild.json';
import fireStation from '../../../builds/fire-station.sarbuild.json';
import iceCream from '../../../builds/ice-cream-shop.sarbuild.json';
import observatory from '../../../builds/observatory.sarbuild.json';
import pagoda from '../../../builds/pagoda.sarbuild.json';
import pirateShip from '../../../builds/pirate-ship.sarbuild.json';
import trainStation from '../../../builds/train-station.sarbuild.json';
import treehouse from '../../../builds/treehouse.sarbuild.json';
import { parseBuildFile } from './file.ts';
import type { TargetBuild } from './types.ts';
import { allBins } from './variant.ts';

/*
 * The detailed builds that live as build files in builds/, as the Manga Shop and the Izakaya
 * do, so the file people can import and the built-in build are one. See builds/README.md.
 */

function load(file: unknown): TargetBuild {
  const r = parseBuildFile(JSON.stringify(file), allBins());
  if (!r.ok) throw new Error(`builds/: ${r.problems.join('; ')}`);
  return r.build;
}

export const FIRE_STATION: TargetBuild = load(fireStation);
export const DINER: TargetBuild = load(diner);
export const PAGODA: TargetBuild = load(pagoda);
export const CLOCK_TOWER: TargetBuild = load(clockTower);
export const CORNER_CAFE: TargetBuild = load(cafe);
export const ICE_CREAM_SHOP: TargetBuild = load(iceCream);
export const TREEHOUSE: TargetBuild = load(treehouse);
export const PIRATE_SHIP: TargetBuild = load(pirateShip);
export const OBSERVATORY: TargetBuild = load(observatory);
export const TRAIN_STATION: TargetBuild = load(trainStation);
