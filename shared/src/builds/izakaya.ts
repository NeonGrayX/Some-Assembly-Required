import file from '../../../builds/izakaya.sarbuild.json';
import { parseBuildFile } from './file.ts';
import type { TargetBuild } from './types.ts';
import { allBins } from './variant.ts';

/**
 * The Izakaya, the Manga Shop's neighbour in the Lumibricks 17016 set, after its second manual:
 * 26 pages of lattice windows, round corners, a crab on the street stall, a torii and a spire.
 * It lives in the build file in builds/, so the file people can import and the built-in build
 * are one.
 */
function load(): TargetBuild {
  const r = parseBuildFile(JSON.stringify(file), allBins());
  if (!r.ok) throw new Error(`builds/izakaya.sarbuild.json: ${r.problems.join('; ')}`);
  return r.build;
}

export const IZAKAYA: TargetBuild = load();
