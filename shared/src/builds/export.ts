import { BRICK_TYPES } from '../bricks.ts';
import { BrickGrid } from '../grid.ts';
import type { PlacedBrick } from '../grid.ts';
import { BUILD_FILE_LIMITS } from './file.ts';
import type { TargetBrick, TargetBuild } from './types.ts';
import { attachOrder } from './validate.ts';

/** Fewest bricks a page of an exported build gets, so a small build is not one brick a page. */
const MIN_BRICKS_PER_PAGE = 4;

/**
 * A build as it stands on a job site (or anywhere on a baseplate grid), as a build with a
 * manual: every brick in an order it can be built in, cut into pages. The pages are as even as
 * the 32-page limit allows, at least a few bricks each, and a page ends early rather than list
 * more kinds of brick than fit on it. Prints keep their pictures when `svgs` has them.
 *
 * What a build file cannot hold (too many bricks, a part hanging off the plate, one that never
 * attaches) is kept as it is: `buildProblems` says what, and the editor can fix it.
 */
export function buildFromGrid(
  grid: BrickGrid,
  head: Pick<TargetBuild, 'id' | 'name' | 'author' | 'description' | 'svgs'>,
): TargetBuild {
  const plate = [...grid.bricks.values()].filter((b) => BRICK_TYPES[b.type].fixture);
  const bricks = [...grid.bricks.values()].filter((b) => !BRICK_TYPES[b.type].fixture);
  const order = attachOrder(BrickGrid.from(plate), bricks);
  const perPage = Math.max(MIN_BRICKS_PER_PAGE, Math.ceil(order.length / BUILD_FILE_LIMITS.pages));
  const steps: { bricks: TargetBrick[] }[] = [];
  let page: TargetBrick[] = [];
  let kinds = new Set<string>();
  for (const b of order) {
    const kind = `${b.type}|${b.colour}`;
    const full =
      page.length >= perPage || (!kinds.has(kind) && kinds.size >= BUILD_FILE_LIMITS.kindsPerPage);
    if (full) {
      steps.push({ bricks: page });
      page = [];
      kinds = new Set();
    }
    page.push(targetBrick(b, head.svgs));
    kinds.add(kind);
  }
  if (page.length) steps.push({ bricks: page });
  const used = new Set(
    steps.flatMap((s) => s.bricks.flatMap((b) => Object.values(b.prints ?? {}))),
  );
  const svgs = Object.fromEntries(
    Object.entries(head.svgs ?? {}).filter(([name]) => used.has(name)),
  );
  const out: TargetBuild = { id: head.id, name: head.name, steps };
  if (head.author) out.author = head.author;
  if (head.description) out.description = head.description;
  if (Object.keys(svgs).length) out.svgs = svgs;
  return out;
}

/** A placed brick as a manual lists it; prints only where their pictures are known. */
function targetBrick(b: PlacedBrick, svgs: Record<string, string> | undefined): TargetBrick {
  const out: TargetBrick = { type: b.type, colour: b.colour, x: b.x, y: b.y, z: b.z, rot: b.rot };
  if (b.face) out.face = b.face;
  const prints = Object.fromEntries(
    Object.entries(b.prints ?? {}).filter(([, name]) => name && svgs?.[name] !== undefined),
  );
  if (Object.keys(prints).length) out.prints = prints;
  return out;
}

/**
 * A build file id and name from what a player typed: lower case words joined by dashes for
 * the id, the name cut to fit the page header. Falls back to `fallback` for either.
 */
export function buildFileNames(typed: string, fallback: string): { id: string; name: string } {
  const name = typed.trim().slice(0, BUILD_FILE_LIMITS.nameLength).trim() || fallback;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+|-+$/g, '')
    .slice(0, BUILD_FILE_LIMITS.idLength)
    .replace(/-+$/, '');
  const fallbackId = fallback.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return { id: slug || fallbackId, name };
}
