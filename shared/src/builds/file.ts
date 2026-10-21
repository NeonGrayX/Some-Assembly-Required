import { BRICK_TYPES, COLOURS } from '../bricks.ts';
import type { BrickTypeId, ColourId, Facing } from '../bricks.ts';
import { LDU_PER_PLATE, LDU_PER_STUD, ORIENTATIONS, orientationKey } from '../lattice.ts';
import { FACINGS, partBox } from '../parts.ts';
import { PRINT_SIDES } from './types.ts';
import type { PageLayout, PageView, PrintSide, Prints, TargetBrick, TargetBuild } from './types.ts';
import { seatSideways } from './seat.ts';
import { validateBuild } from './validate.ts';
import type { BinColours } from './variant.ts';

/*
 * Build files: a model and its instruction manual as one JSON file, so a build can be exported
 * and imported again. The format is described in docs/07-build-file-format.md.
 */

export const BUILD_FILE_FORMAT = 'some-assembly-required/build';
/**
 * Version 3 turns parts any of 24 ways (`orient`) and lets sideways parts sit anywhere on the
 * lattice, on the studs of other sideways parts. Version 2 puts sideways parts where real side
 * studs hold them (fractions of a plate up, half a plate in or out); its files are read as they
 * were, and a build that needs nothing new is still written as version 2. Version 1 files are
 * read too: their sideways parts are moved where version 2 puts them.
 */
export const BUILD_FILE_VERSION = 3;
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
  svgs: 32,
  svgLength: 32 * 1024,
};

export type BuildFileResult = { ok: true; build: TargetBuild } | { ok: false; problems: string[] };

const ID = new RegExp(`^[a-z][a-z0-9-]{0,${BUILD_FILE_LIMITS.idLength - 1}}$`);
/** Studs along each side of the baseplate: bricks sit in cells 0 up to one less. */
const STUDS = BRICK_TYPES.baseplate16.studsX;
/** The highest a brick's y may be: one plate under the top it may reach. */
const TOP_Y = BUILD_FILE_LIMITS.top - 1;
const kb = (bytes: number) => `${bytes / 1024} KB`;
/** An SVG document: an optional XML declaration and comments, then one `<svg>` element. */
const SVG = /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>][\s\S]*<\/svg>\s*$/;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
/** A multiple of `step` from `min` to `max`. */
const isStep = (v: unknown, step: number, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v / step) && v >= min && v <= max;
/** The orientations `orient` can name, by key. */
const ORIENTS = new Set(ORIENTATIONS.map(orientationKey));
/** A multiple of `1 / per` (one LDU) from `min` to `max`, give or take rounding. */
const onLattice = (v: unknown, per: number, min: number, max: number): v is number =>
  typeof v === 'number' &&
  Number.isFinite(v) &&
  Math.abs(v * per - Math.round(v * per)) < 1e-6 &&
  v >= min &&
  v <= max;
/** A whole number from `min` to `max`, or a fifth of a stud (half a plate) either side of one. */
const isSideAt = (v: unknown, min: number, max: number): v is number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  const cell = Math.round(v);
  const off = Math.abs(v - cell);
  return cell >= min && cell <= max && (off < 1e-9 || Math.abs(off - 0.2) < 1e-9);
};

/**
 * Reads a build file and checks it can be played with these bins. Returns the build, or every
 * problem of the first group of rules that fails, as "page N, brick M: message".
 */
export function parseBuildFile(text: string, bins: BinColours): BuildFileResult {
  if (text.length > BUILD_FILE_LIMITS.bytes)
    return fail(`the file is bigger than ${kb(BUILD_FILE_LIMITS.bytes)}`);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fail('the file is not JSON');
  }
  return parseBuildData(data, bins);
}

/** `parseBuildFile` for a file already read as JSON (a build file bundled with the game). */
export function parseBuildData(data: unknown, bins: BinColours): BuildFileResult {
  const shaped = readShape(data);
  if (!shaped.ok) return shaped;
  const problems = buildProblems(shaped.build, bins);
  return problems.length ? { ok: false, problems } : shaped;
}

/** The file for a build, as text: fields in the documented order, one brick per line. */
export function stringifyBuildFile(build: TargetBuild): string {
  return stringifyBuildFileWithMap(build).text;
}

/** A build file's text, and where its bricks are in it. */
export interface BuildFileText {
  text: string;
  /**
   * The line (from 0) each brick is on, in file order: page by page, the bricks of each page in
   * order. Each brick has a line to itself.
   */
  brickLines: number[];
}

/** As `stringifyBuildFile`, with the line each brick went on. */
export function stringifyBuildFileWithMap(build: TargetBuild): BuildFileText {
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
      ...(b.orient ? { orient: b.orient } : {}),
      ...(b.prints && Object.keys(b.prints).length ? { prints: printsInOrder(b.prints) } : {}),
    }));
    return page;
  });
  const file: Record<string, unknown> = {
    format: BUILD_FILE_FORMAT,
    version: build.steps.some((s) => s.bricks.some((b) => !fitsVersion2(b)))
      ? BUILD_FILE_VERSION
      : 2,
    build: head,
    manual: { ...(cover ? { cover: { view: cover } } : {}), pages },
  };
  if (build.svgs && Object.keys(build.svgs).length) file.svgs = build.svgs;
  // Pretty-printed with 2-space indents, then each brick folded back onto one line.
  const inline = (v: unknown): string =>
    typeof v === 'object' && v !== null
      ? `{ ${Object.entries(v)
          .map(([k, w]) => `${JSON.stringify(k)}: ${inline(w)}`)
          .join(', ')} }`
      : JSON.stringify(v);
  const pretty = JSON.stringify(file, null, 2);
  const brickLines: number[] = [];
  // Lines the bricks folded so far took up before folding, less the one each keeps.
  let folded = 0;
  let row = 0;
  let scanned = 0;
  const text = pretty.replace(
    /\{\n\s+"type"(?:[^{}]|\{[^{}]*\})*\}/g,
    (brick: string, at: number) => {
      row += lineBreaks(pretty, scanned, at);
      scanned = at;
      brickLines.push(row - folded);
      folded += lineBreaks(brick, 0, brick.length);
      return inline(JSON.parse(brick));
    },
  );
  return { text: text + '\n', brickLines };
}

/** Whether a version 2 file can say where the brick is: not turned, and sideways as side studs hold it. */
function fitsVersion2(b: TargetBrick): boolean {
  if (b.orient) return false;
  if (!b.face) return true;
  const sideX = b.face === '+x' || b.face === '-x';
  return (
    isStep(b.y, 0.5, 0.5, TOP_Y) &&
    (sideX ? isSideAt(b.x, 0, STUDS - 1) : isInt(b.x, 0, STUDS - 1)) &&
    (sideX ? isInt(b.z, 0, STUDS - 1) : isSideAt(b.z, 0, STUDS - 1))
  );
}

/** How many line breaks `text` has from `from` up to `to`. */
function lineBreaks(text: string, from: number, to: number): number {
  let n = 0;
  for (let i = text.indexOf('\n', from); i >= 0 && i < to; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

/** A brick's prints with the sides in the documented order. */
function printsInOrder(prints: Prints): Prints {
  const out: Prints = {};
  for (const side of PRINT_SIDES) if (prints[side]) out[side] = prints[side];
  return out;
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
  if (data.version !== 3 && data.version !== 2 && data.version !== 1)
    return fail(`unknown version ${String(data.version)}`);
  const version = data.version;

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
    problems.push(
      `build id must be a-z, 0-9 and "-", up to ${BUILD_FILE_LIMITS.idLength} characters, starting with a letter`,
    );
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
          problems.push(`${where}: note must be up to ${BUILD_FILE_LIMITS.noteLength} characters`);
        else if (raw.note) layout.note = raw.note;
      }
      pages.push(layout);
      steps.push({ bricks: readBricks(raw.bricks, where, problems, version) });
    });
  }
  const svgs = readSvgs(data.svgs, problems);
  if (problems.length) return { ok: false, problems };
  if (data.version === 1) seatSideways(steps);
  checkPrints(steps, svgs, problems);
  if (problems.length) return { ok: false, problems };

  const build: TargetBuild = { id: id as string, name: name!, steps };
  if (author) build.author = author;
  if (description) build.description = description;
  if (cover) build.cover = cover;
  if (pages.some((l) => l.view || l.note)) build.pages = pages;
  if (svgs) build.svgs = svgs;
  return { ok: true, build };
}

/** The `svgs` section: SVG documents by name. */
function readSvgs(raw: unknown, problems: string[]): Record<string, string> | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) {
    problems.push('svgs must be an object of SVG images by name');
    return undefined;
  }
  const entries = Object.entries(raw);
  if (entries.length > BUILD_FILE_LIMITS.svgs)
    problems.push(`the file has ${entries.length} svgs, at most ${BUILD_FILE_LIMITS.svgs} fit`);
  const out: Record<string, string> = {};
  for (const [name, svg] of entries) {
    if (!ID.test(name))
      problems.push(
        `svg "${name}": names are a-z, 0-9 and "-", up to ${BUILD_FILE_LIMITS.idLength} characters`,
      );
    else if (typeof svg !== 'string' || !SVG.test(svg))
      problems.push(`svg "${name}": must be the text of one SVG image, <svg ...>...</svg>`);
    else if (svg.length > BUILD_FILE_LIMITS.svgLength)
      problems.push(`svg "${name}": bigger than ${kb(BUILD_FILE_LIMITS.svgLength)}`);
    else out[name] = svg;
  }
  return out;
}

/**
 * Every print must name one of the file's svgs. A file without an `svgs` section is the clean
 * version of its build: its prints are dropped and the bricks stay plain.
 */
function checkPrints(
  steps: TargetBuild['steps'],
  svgs: Record<string, string> | undefined,
  problems: string[],
): void {
  steps.forEach((s, p) =>
    s.bricks.forEach((b, i) => {
      if (!b.prints) return;
      if (!svgs) {
        delete b.prints;
        return;
      }
      for (const name of Object.values(b.prints))
        if (!(name in svgs)) problems.push(`page ${p + 1}, brick ${i + 1}: no svg named "${name}"`);
    }),
  );
}

function readPrints(raw: unknown, at: string, problems: string[]): Prints | undefined {
  if (!isObject(raw)) {
    problems.push(`${at}: prints must be an object of svg names by side`);
    return undefined;
  }
  const out: Prints = {};
  for (const [side, name] of Object.entries(raw)) {
    if (!PRINT_SIDES.includes(side as PrintSide)) {
      problems.push(`${at}: "${side}" is not a side (${PRINT_SIDES.join(', ')})`);
      return undefined;
    }
    if (typeof name !== 'string' || !ID.test(name)) {
      problems.push(`${at}: the ${side} print must name an svg`);
      return undefined;
    }
    out[side as PrintSide] = name;
  }
  return Object.keys(out).length ? out : undefined;
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
    bricks: readBricks(isObject(s) ? s.bricks : undefined, `page ${p + 1}`, problems, 0),
  }));
  if (!problems.length) seatSideways(steps);
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

/** A file's bricks, by the rules of its `version` (0 for an editor file). */
function readBricks(
  raw: unknown,
  where: string,
  problems: string[],
  version: number,
): TargetBrick[] {
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
      COLOURS[b.colour as ColourId].fixture
    )
      return problems.push(`${at}: unknown colour "${String(b.colour)}"`);
    if (version >= 3 && (b.orient !== undefined || b.face !== undefined)) {
      const brick = readLatticeBrick(b, at, problems);
      if (brick) out.push(brick);
      return;
    }
    if (b.orient !== undefined) return problems.push(`${at}: orient needs a version 3 file`);
    // An upright part may sit half a stud off the grid, both ways at once.
    const half =
      b.face === undefined &&
      isInt((b.x as number) - 0.5, 0, STUDS - 2) &&
      isInt((b.z as number) - 0.5, 0, STUDS - 2);
    // A sideways part's coordinate along its face may be half a plate in or out of its cell.
    const sideX = b.face === '+x' || b.face === '-x';
    const sideZ = b.face === '+z' || b.face === '-z';
    const xOk = sideX ? isSideAt(b.x, 0, STUDS - 1) : isInt(b.x, 0, STUDS - 1);
    const zOk = sideZ ? isSideAt(b.z, 0, STUDS - 1) : isInt(b.z, 0, STUDS - 1);
    if (!half && (!xOk || !zOk))
      return problems.push(
        b.face
          ? `${at}: x and z must be whole numbers from 0 to ${STUDS - 1}, the one along its face 0.2 either side of one`
          : `${at}: x and z must both be whole numbers from 0 to ${STUDS - 1}, or both half way between (0.5 to ${STUDS - 1.5})`,
      );
    if (b.face !== undefined && FACINGS.includes(b.face as Facing)) {
      if (!isStep(b.y, 0.5, 0.5, TOP_Y))
        return problems.push(`${at}: y must be a whole or half number from 0.5 to ${TOP_Y}`);
    } else if (!isInt(b.y, 1, TOP_Y))
      return problems.push(`${at}: y must be a whole number from 1 to ${TOP_Y}`);
    if (!isInt(b.rot, 0, 3)) return problems.push(`${at}: rot must be 0, 1, 2 or 3`);
    if (b.face !== undefined) {
      if (!FACINGS.includes(b.face as Facing))
        return problems.push(`${at}: face must be "+x", "-x", "+z" or "-z"`);
    }
    const brick: TargetBrick = {
      type: b.type as BrickTypeId,
      colour: b.colour as ColourId,
      x: b.x as number,
      y: b.y,
      z: b.z as number,
      rot: b.rot as TargetBrick['rot'],
    };
    if (b.face !== undefined) brick.face = b.face as Facing;
    if (b.prints !== undefined) {
      const prints = readPrints(b.prints, at, problems);
      if (prints) brick.prints = prints;
      else if (problems.length) return;
    }
    const box = partBox(brick);
    if (box.x0 < 0 || box.z0 < 0 || box.x1 > STUDS || box.z1 > STUDS)
      return problems.push(`${at}: sticks out past the baseplate`);
    if (box.y0 < 1) return problems.push(`${at}: below the baseplate`);
    out.push(brick);
  });
  return out;
}

/**
 * A turned or sideways brick of a version 3 file: anywhere on the lattice (x and z in
 * twentieths of a stud, y in eighths of a plate), so it can sit on the studs of other turned
 * and sideways parts. A turned brick's `rot` is 0, its `orient` says it all.
 */
function readLatticeBrick(
  b: Record<string, unknown>,
  at: string,
  problems: string[],
): TargetBrick | undefined {
  const fail = (message: string) => {
    problems.push(`${at}: ${message}`);
    return undefined;
  };
  if (b.orient !== undefined && b.face !== undefined)
    return fail('a part has orient or face, not both');
  if (b.orient !== undefined && (typeof b.orient !== 'string' || !ORIENTS.has(b.orient)))
    return fail('orient must name its up and x axes, like "-y+x" (see the file format)');
  if (b.face !== undefined && !FACINGS.includes(b.face as Facing))
    return fail('face must be "+x", "-x", "+z" or "-z"');
  if (
    !onLattice(b.x, LDU_PER_STUD, 0, STUDS) ||
    !onLattice(b.z, LDU_PER_STUD, 0, STUDS) ||
    !onLattice(b.y, LDU_PER_PLATE, 0.5, TOP_Y)
  )
    return fail(
      `x and z must be 0 to ${STUDS} in twentieths of a stud, y 0.5 to ${TOP_Y} in eighths of a plate`,
    );
  if (b.orient !== undefined ? b.rot !== 0 : !isInt(b.rot, 0, 3))
    return fail(b.orient !== undefined ? 'rot must be 0 with orient' : 'rot must be 0, 1, 2 or 3');
  const brick: TargetBrick = {
    type: b.type as BrickTypeId,
    colour: b.colour as ColourId,
    x: b.x,
    y: b.y,
    z: b.z,
    rot: b.rot as TargetBrick['rot'],
  };
  if (b.face !== undefined) brick.face = b.face as Facing;
  if (b.orient !== undefined) brick.orient = b.orient as string;
  if (b.prints !== undefined) {
    const before = problems.length;
    const prints = readPrints(b.prints, at, problems);
    if (prints) brick.prints = prints;
    else if (problems.length > before) return undefined;
  }
  const box = partBox(brick);
  if (box.x0 < 0 || box.z0 < 0 || box.x1 > STUDS || box.z1 > STUDS)
    return fail('sticks out past the baseplate');
  if (box.y0 < 1) return fail('below the baseplate');
  return brick;
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
            `page ${p + 1}, brick ${i + 1}: the brick works can't make ${b.colour} ${b.type}, so it can't be built`,
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
 * sideways or turned part is clipped on from the side or hung on, so it only needs the studs
 * that hold it (checked by `validateBuild`), and nothing sits on it this way.
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
      if (b.face || b.orient) return;
      const cells = studs(b);
      const resting =
        b.y === 1 || placed.some((q) => q.top === b.y && [...q.studs].some((c) => cells.has(c)));
      if (!resting) out.push(`page ${p + 1}, brick ${i + 1}: does not sit on anything below it`);
      placed.push({ top: partBox(b).y1, studs: cells });
    }),
  );
  return out;
}
