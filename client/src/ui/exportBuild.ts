import {
  BUILD_FILE_EXTENSION,
  binColours,
  buildFileNames,
  buildFromGrid,
  buildProblems,
  stringifyBuildFile,
} from '@sar/shared';
import type { ClientGame } from '../net/game.ts';

/** The name an exported build gets when nobody typed one: the player's own. */
export function defaultBuildName(g: ClientGame): string {
  const mine = `${g.nameOf(g.myId)}'s build`;
  return mine.length <= 20 ? mine : 'Free build';
}

/**
 * Saves what stands on your job site as a build file (docs/07-build-file-format.md), with a
 * manual cut into pages, so it can be imported in the demo panel or the build editor. Returns
 * a line saying what was saved, and whether the file will import as it is.
 */
export function exportJobSite(g: ClientGame, typedName: string): string {
  const { id, name } = buildFileNames(typedName, defaultBuildName(g));
  const build = buildFromGrid(g.sim.build(g.mySite).grid, {
    id,
    name,
    author: g.nameOf(g.myId).slice(0, 40),
    svgs: g.sim.level.svgs,
  });
  if (!build.steps.length) return 'Nothing to export yet: put some bricks on the baseplate first.';
  const blob = new Blob([stringifyBuildFile(build)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${build.id}${BUILD_FILE_EXTENSION}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  const bricks = build.steps.reduce((n, s) => n + s.bricks.length, 0);
  const problems = buildProblems(build, binColours(g.sim.level));
  const saved = `Saved ${bricks} bricks on ${build.steps.length} pages to ${a.download}.`;
  return problems.length
    ? `${saved} It needs fixing in the build editor before it can be played: ${problems[0]}.`
    : `${saved} Import it in the demo panel or the build editor.`;
}
