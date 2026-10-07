import { describe, expect, it } from 'vitest';
import mangaShop from '../../../builds/manga-shop.sarbuild.json';
import { HOUSE } from '../content/house.ts';
import { parseBuildFile } from './file.ts';
import { binColours } from './variant.ts';

/** The build files shipped in the repo's builds/ folder, by file name. */
const FILES: Record<string, unknown> = { 'manga-shop.sarbuild.json': mangaShop };

const bins = binColours(HOUSE);

describe('build files in builds/', () => {
  for (const [file, data] of Object.entries(FILES)) {
    it(`${file} imports without problems`, () => {
      const r = parseBuildFile(JSON.stringify(data), bins);
      expect(r.ok ? [] : r.problems).toEqual([]);
      if (!r.ok) return;
      expect(file).toBe(`${r.build.id}.sarbuild.json`);
    });
  }
});
