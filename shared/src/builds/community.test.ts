import { describe, expect, it } from 'vitest';
import mangaShop from '../../../builds/manga-shop.sarbuild.json';
import { parseBuildFile } from './file.ts';
import { allBins } from './variant.ts';

/** The build files shipped in the repo's builds/ folder, by file name. */
const FILES: Record<string, unknown> = { 'manga-shop.sarbuild.json': mangaShop };

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
