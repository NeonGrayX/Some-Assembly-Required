import file from '../../../builds/manga-shop.sarbuild.json';
import { parseBuildFile } from './file.ts';
import type { TargetBuild } from './types.ts';
import { allBins } from './variant.ts';

/**
 * The Manga Shop, after the Lumibricks 17016 manual: 31 pages of tiles, slopes, round parts,
 * window frames, side-stud bricks, brackets, prints and see-through parts. It lives in the
 * build file in builds/, so the file people can import and the built-in build are one.
 */
function load(): TargetBuild {
  const r = parseBuildFile(JSON.stringify(file), allBins());
  if (!r.ok) throw new Error(`builds/manga-shop.sarbuild.json: ${r.problems.join('; ')}`);
  return r.build;
}

export const MANGA_SHOP: TargetBuild = load();
