import { BRICK_TYPES, COLOURS } from '../bricks.ts';
import type { BrickTypeId, ColourId, Facing } from '../bricks.ts';
import { FACINGS, partBox } from '../parts.ts';
import type { PageLayout, PageView, TargetBrick, TargetBuild } from './types.ts';
import { validateBuild } from './validate.ts';
import type { BinColours } from './variant.ts';

/*
 * Build files: a model and its instruction manual as one JSON file, so a build can be exported
 * and imported again. The format is described in docs/07-build-file-format.md.
 */

export const BUILD_FILE_FORMAT = 'some-assembly-required/build';
export const BUILD_FILE_VERSION = 1;
/** File name ending, after the build's id. */
export const BUILD_FILE_EXTENSION = '.sarbuild.json';

export const BUILD_FILE_LIMITS = {
  bytes: 256 * 1024,
  pages: 32,
  bricks: 400,
  /** Highest plate a brick's top may reach. */
  top: 48,
  kindsPerPage: 20,
  idLength: 32,
  nameLength: 20,
  authorLength: 40,
  descriptionLength: 200,
  noteLength: 60,
};

export type BuildFileResult = { ok: true; build: TargetBuild } | { ok: false; problems: string[] };

const ID = /^[a-z][a-z0-9-]{0,31}$/;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/**
 * Reads a build file and checks it can be played with these bins. Returns the build, or every
 * problem of the first group of rules that fails, as "page N, brick M: message".
 */
export function parseBuildFile(text: string, bins: BinColours): BuildFileResult {
  if (text.length > BUILD_FILE_LIMITS.bytes) return fail('the file is bigger than 256 KB');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fail('the file is not JSON');
  }
  const shaped = readShape(data);
  if (!shaped.ok) return shaped;
  const problems = buildProblems(shaped.build, bins);
  return problems.length ? { ok: false, problems } : shaped;
}

/** The file for a build, as text: fields in the documented order, one brick per line. */
export function stringifyBuildFile(build: TargetBuild): string {
  const view = (v: PageView | undefined) => {
    const out: PageView = {};
    if (v?.turn) out.turn = v.turn;
    if (v?.zoom !== undefined && v.zoom !== 1) out.zoom = v.zoom;
    return Object.keys(out).length ? out : undefined;
  };
  const head: Record<string, unknown> = { id: build.id, name: build.name };
  if (build.author) head.author = build.author;
  if (build.description) head.description = build.description;
  const cover = view(build.cover);
  const pages = build.steps.map((step, i) => {
    const layout = build.pages?.[i];
    const page: Record<string, unknown> = {};
    if (layout?.note) page.note = layout.note;
    const v = view(layout?.view);
    if (v) page.view = v;
    page.bricks = step.bricks.map((b) => ({
      type: b.type,
      colour: b.colour,
      x: b.x,
      y: b.y,
      z: b.z,
      rot: b.rot,
      ...(b.face ? { face: b.face } : {}),
    }));
    return page;
  });
  const file = {
    format: BUILD_FILE_FORMAT,
    version: BUILD_FILE_VERSION,
    build: head,
    manual: { ...(cover ? { cover: { view: cover } } : {}), pages },
  };
  // Pretty-printed with 2-space indents, then each brick folded back onto one line.
  return (
    JSON.stringify(file, null, 2).replace(/\{\n\s+"type"[^}]*\}/g, (brick) => {
      const fields = Object.entries(JSON.parse(brick) as Record<string, unknown>);
      return `{ ${fields.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }`;
    }) + '\n'
  );
}

function fail(...problems: string[]): BuildFileResult {
  return { ok: false, problems };
}

/** Group 1: the shape and ranges of every field. Editor files (no `format`) are version 0. */
function readShape(data: unknown): BuildFileResult {
  if (!isObject(data)) return fail('the file does not hold a build');
  if (data.format === undefined && Array.isArray(data.steps)) return readVersion0(data);
  if (data.format !== BUILD_FILE_FORMAT) return fail('the file is not a build file');
  if (typeof data.version === 'number' && data.version > BUILD_FILE_VERSION)
    return fail('the file was made with a newer version of the game');
  if (data.version !== BUILD_FILE_VERSION) return fail(`unknown version ${String(data.version)}`);

  const problems: string[] = [];
  const head = isObject(data.build) ? data.build : {};
  if (!isObject(data.build)) problems.push('"build" is missing');
  const text = (key: string, max: number, required: boolean): string | undefined => {
    const v = head[key];
    if (v === undefined && !required) return undefined;
    if (typeof v !== 'string' || (required && v.length === 0) || v.length > max) {
      problems.push(`build ${key} must be ${required ? '1' : '0'} to ${max} characters`);
      return undefined;
    }
    return v;
  };
  const id = head.id;
  if (typeof id !== 'string' || !ID.test(id))
    problems.push('build id must be a-z, 0-9 and "-", up to 32 characters, starting with a letter');
  const name = text('name', BUILD_FILE_LIMITS.nameLength, true);
  const author = text('author', BUILD_FILE_LIMITS.authorLength, false);
  const description = text('description', BUILD_FILE_LIMITS.descriptionLength, false);

  const manual = isObject(data.manual) ? data.manual : {};
  if (!isObject(data.manual)) problems.push('"manual" is missing');
  let cover: PageView | undefined;
  if (manual.cover !== undefined) {
    if (!isObject(manual.cover)) problems.push('cover must be an object');
    else cover = readView(manual.cover.view, 'cover', problems);
  }
  const rawPages = manual.pages;
  const steps: TargetBuild['steps'] = [];
  const pages: PageLayout[] = [];
  if (!Array.isArray(rawPages) || rawPages.length === 0) {
    problems.push('the manual needs at least one page');
  } else if (rawPages.length > BUILD_FILE_LIMITS.pages) {
    problems.push(
      `the manual has ${rawPages.length} pages, at most ${BUILD_FILE_LIMITS.pages} fit`,
    );
  } else {
    rawPages.forEach((raw, p) => {
      const where = `page ${p + 1}`;
      if (!isObject(raw)) return problems.push(`${where}: not an object`);
      const layout: PageLayout = {};
      const view = readView(raw.view, where, problems);
      if (view) layout.view = view;
      if (raw.note !== undefined) {
        if (typeof raw.note !== 'string' || raw.note.length > BUILD_FILE_LIMITS.noteLength)
          problems.push(`${where}: note must be up to 60 characters`);
        else if (raw.note) layout.note = raw.note;
      }
      pages.push(layout);
      steps.push({ bricks: readBricks(raw.bricks, where, problems) });
    });
  }
  if (problems.length) return { ok: false, problems };

  const build: TargetBuild = { id: id as string, name: name!, steps };
  if (author) build.author = author;
  if (description) build.description = description;
  if (cover) build.cover = cover;
  if (pages.some((l) => l.view || l.note)) build.pages = pages;
  return { ok: true, build };
}

/** A bare `TargetBuild` as the build editor writes it. */
function readVersion0(data: Record<string, unknown>): BuildFileResult {
  const problems: string[] = [];
  const id = typeof data.id === 'string' && ID.test(data.id) ? data.id : 'build';
  const name =
    typeof data.name === 'string' && data.name.trim()
      ? data.name.trim().slice(0, BUILD_FILE_LIMITS.nameLength)
      : 'Imported build';
  const raw = data.steps as unknown[];
  if (raw.length === 0) problems.push('the build has no steps');
  if (raw.length > BUILD_FILE_LIMITS.pages)
    problems.push(`the build has ${raw.length} steps, at most ${BUILD_FILE_LIMITS.pages} fit`);
  if (problems.length) return { ok: false, problems };
  const steps = raw.map((s, p) => ({
    bricks: readBricks(isObject(s) ? s.bricks : undefined, `page ${p + 1}`, problems),
  }));
  return problems.length ? { ok: false, problems } : { ok: true, build: { id, name, steps } };
}

function readView(raw: unknown, where: string, problems: string[]): PageView | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) {
    problems.push(`${where}: view must be an object`);
    return undefined;
  }
  const view: PageView = {};
  if (raw.turn !== undefined) {
    if (!isInt(raw.turn, 0, 3)) problems.push(`${where}: view turn must be 0 to 3`);
    else if (raw.turn) view.turn = raw.turn;
  }
  if (raw.zoom !== undefined) {
    if (typeof raw.zoom !== 'number' || !(raw.zoom >= 0.5 && raw.zoom <= 2))
      problems.push(`${where}: view zoom must be 0.5 to 2`);
    else if (raw.zoom !== 1) view.zoom = raw.zoom;
  }
  return Object.keys(view).length ? view : undefined;
}

function readBricks(raw: unknown, where: string, problems: string[]): TargetBrick[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.push(`${where}: needs at least one brick`);
    return [];
  }
  const out: TargetBrick[] = [];
  raw.forEach((b, i) => {
    const at = `${where}, brick ${i + 1}`;
    if (!isObject(b)) return problems.push(`${at}: not an object`);
    const type = BRICK_TYPES[b.type as BrickTypeId];
    if (typeof b.type !== 'string' || !type || type.fixture)
      return problems.push(`${at}: unknown brick type "${String(b.type)}"`);
    if (
      typeof b.colour !== 'string' ||
      !COLOURS[b.colour as ColourId] ||
      b.colour === 'baseplate-green'
    )
      return problems.push(`${at}: unknown colour "${String(b.colour)}"`);
    if (!isInt(b.x, 0, 15) || !isInt(b.z, 0, 15))
      return problems.push(`${at}: x and z must be whole numbers from 0 to 15`);
    if (!isInt(b.y, 1, BUILD_FILE_LIMITS.top - 1))
      return problems.push(`${at}: y must be a whole number from 1 to 47`);
    if (!isInt(b.rot, 0, 3)) return problems.push(`${at}: rot must be 0, 1, 2 or 3`);
    if (b.face !== undefined) {
      if (!FACINGS.includes(b.face as Facing))
        return problems.push(`${at}: face must be "+x", "-x", "+z" or "-z"`);
      if (!type.mountable) return problems.push(`${at}: a ${b.type} cannot be clipped on sideways`);
    }
    const brick: TargetBrick = {
      type: b.type as BrickTypeId,
      colour: b.colour as ColourId,
      x: b.x,
      y: b.y,
      z: b.z,
      rot: b.rot as TargetBrick['rot'],
    };
    if (b.face !== undefined) brick.face = b.face as Facing;
    const box = partBox(brick);
    if (box.x0 < 0 || box.z0 < 0 || box.x1 > 16 || box.z1 > 16)
      return problems.push(`${at}: sticks out past the baseplate`);
    if (box.y0 < 1) return problems.push(`${at}: below the baseplate`);
    out.push(brick);
  });
  return out;
}

/** Groups 2 to 6: the rules that need the bricks laid out on the baseplate. */
export function buildProblems(build: TargetBuild, bins: BinColours): string[] {
  const groups: (() => string[])[] = [
    // Every page's parts list fits on the paper.
    () =>
      build.steps.flatMap((s, p) => {
        const kinds = new Set(s.bricks.map((b) => `${b.type}|${b.colour}`)).size;
        return kinds > BUILD_FILE_LIMITS.kindsPerPage
          ? [
              `page ${p + 1}: ${kinds} kinds of brick, at most ${BUILD_FILE_LIMITS.kindsPerPage} fit on a page`,
            ]
          : [];
      }),
    () => {
      const out: string[] = [];
      const count = build.steps.reduce((n, s) => n + s.bricks.length, 0);
      if (count > BUILD_FILE_LIMITS.bricks)
        out.push(`the build has ${count} bricks, at most ${BUILD_FILE_LIMITS.bricks} are allowed`);
      build.steps.forEach((s, p) =>
        s.bricks.forEach((b, i) => {
          if (partBox(b).y1 > BUILD_FILE_LIMITS.top)
            out.push(`page ${p + 1}, brick ${i + 1}: higher than plate ${BUILD_FILE_LIMITS.top}`);
        }),
      );
      return out;
    },
    () =>
      validateBuild(build).map((x) =>
        x.brick < 0
          ? `page ${x.step + 1}: ${x.message}`
          : `page ${x.step + 1}, brick ${x.brick + 1}: ${x.message}`,
      ),
    () => restingProblems(build),
    () => {
      const out: string[] = [];
      const seen = new Set<string>();
      build.steps.forEach((s, p) =>
        s.bricks.forEach((b, i) => {
          const key = `${b.type}|${b.colour}`;
          if (seen.has(key) || bins.get(b.type)?.has(b.colour)) return;
          seen.add(key);
          out.push(
            `page ${p + 1}, brick ${i + 1}: no bin hands out ${b.colour} ${b.type}, so it can't be built`,
          );
        }),
      );
      return out;
    },
  ];
  for (const group of groups) {
    const problems = group();
    if (problems.length) return problems;
  }
  return [];
}

/**
 * Bricks that would have to be pushed on from underneath, which the snapping cannot do. A
 * sideways part is clipped on from the side, so it only needs its side studs (checked by
 * `validateBuild`), and nothing sits on it.
 */
function restingProblems(build: TargetBuild): string[] {
  const studs = (b: TargetBrick) => {
    const box = partBox(b);
    const out = new Set<string>();
    for (let x = box.x0; x < box.x1; x++)
      for (let z = box.z0; z < box.z1; z++) out.add(`${x},${z}`);
    return out;
  };
  const placed: { top: number; studs: Set<string> }[] = [];
  const out: string[] = [];
  build.steps.forEach((s, p) =>
    s.bricks.forEach((b, i) => {
      if (b.face) return;
      const cells = studs(b);
      const resting =
        b.y === 1 || placed.some((q) => q.top === b.y && [...q.studs].some((c) => cells.has(c)));
      if (!resting) out.push(`page ${p + 1}, brick ${i + 1}: does not sit on anything below it`);
      placed.push({ top: partBox(b).y1, studs: cells });
    }),
  );
  return out;
}
