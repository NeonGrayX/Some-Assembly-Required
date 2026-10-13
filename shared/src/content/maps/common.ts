import { BASEPLATE_SIZE } from '../../bricks.ts';
import { makeRng } from '../../math.ts';
import type { Vec3 } from '../../math.ts';
import { DOG_RADIUS } from '../../sim/dog.ts';
import {
  BOARD_SIZE,
  CATAPULT,
  floorRect,
  levelSites,
  machineAt,
  machineFront,
  machinePose,
  MACHINES,
  MACHINE_SIZE,
  TRASH_BIN_SIZE,
  WALL_T,
  YARD_HALF,
  isTrashBin,
  trashBin,
} from '../house.ts';
import type {
  BoxDef,
  DecalDef,
  DogDef,
  InteriorDef,
  FloorRect,
  HideoutDef,
  HideoutKind,
  LevelDef,
  MachineDef,
  TrashBinModel,
} from '../house.ts';
import {
  DRAWER_PROUD,
  boxesOverlap,
  hasDoor,
  hasLid,
  hideoutBody,
  hideoutPartInWorld,
  inWorld,
  isSoft,
  openingIn,
} from '../hideouts.ts';
import type { PartPose } from '../hideouts.ts';
import { RIVAL_WALL } from '../rival.ts';
import { IDENTITY, add, v3, yawQuat } from '../../math.ts';

/**
 * What the map generators share: a seeded random source, boxes for walls, rooms, roofs and
 * fences, hiding places in their usual sizes, bins laid along a line, a dog network found
 * from candidate points, and the checks a finished level must pass.
 */

// ---------------------------------------------------------------- random

export interface Gen {
  rng: () => number;
  pick<T>(xs: readonly T[]): T;
  shuffle<T>(xs: readonly T[]): T[];
  chance(p: number): boolean;
  /** An integer from `lo` to `hi` inclusive. */
  int(lo: number, hi: number): number;
  /** A number from `lo` to `hi`. */
  range(lo: number, hi: number): number;
}

export function gen(seed: number): Gen {
  const rng = makeRng(seed >>> 0);
  return {
    rng,
    pick: (xs) => xs[Math.floor(rng() * xs.length)]!,
    shuffle: (xs) => {
      const out = [...xs];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
    chance: (p) => rng() < p,
    int: (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1)),
    range: (lo, hi) => lo + rng() * (hi - lo),
  };
}

// ---------------------------------------------------------------- geometry

export const FENCE = 0xd8cfc0;
export const WALL_H = 3;

/** A heading that looks from a point towards `(dx, dz)` (0 looks along -z). */
export const facingToward = (dx: number, dz: number): number => Math.atan2(-dx, -dz);
export const NORTH = facingToward(0, 1);
export const SOUTH = 0;
export const EAST = facingToward(1, 0);
export const WEST = facingToward(-1, 0);

export const tidy = (n: number): number => Math.round(n * 1000) / 1000;

export function box(
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  colour: number,
  extra: Partial<BoxDef> = {},
): BoxDef {
  return {
    pos: { x: tidy(cx), y: tidy(cy), z: tidy(cz) },
    size: { x: tidy(sx), y: tidy(sy), z: tidy(sz) },
    colour,
    ...extra,
  };
}

/** A box standing on the floor `y0`, given its footprint rectangle and height. */
export function standing(
  r: FloorRect,
  h: number,
  colour: number,
  y0 = 0,
  extra: Partial<BoxDef> = {},
): BoxDef {
  return box(
    (r.x0 + r.x1) / 2,
    y0 + h / 2,
    (r.z0 + r.z1) / 2,
    r.x1 - r.x0,
    h,
    r.z1 - r.z0,
    colour,
    extra,
  );
}

export const rect = (x0: number, z0: number, x1: number, z1: number): FloorRect => ({
  x0,
  z0,
  x1,
  z1,
});
export const centre = (r: FloorRect): { x: number; z: number } => ({
  x: (r.x0 + r.x1) / 2,
  z: (r.z0 + r.z1) / 2,
});
export const inRect = (r: FloorRect, x: number, z: number): boolean =>
  x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
export const grow = (r: FloorRect, by: number): FloorRect => ({
  x0: r.x0 - by,
  x1: r.x1 + by,
  z0: r.z0 - by,
  z1: r.z1 + by,
});

/**
 * The four fences round a square yard, as the house has them (the south one is the rival line).
 * The north and south runs go the whole width and the east and west ones fit between them, so
 * the corners are square and no two fences pass through each other.
 */
export function fences(half = YARD_HALF, colour = FENCE): BoxDef[] {
  const t = 0.3;
  const len = half * 2;
  return [
    box(0, 1, -half, len, 2, t, colour),
    box(0, 1, half, len, 2, t, colour),
    box(-half, 1, 0, t, 2, len - t, colour),
    box(half, 1, 0, t, 2, len - t, colour),
  ];
}

/** A gap in a room's wall: a doorway or an open shutter. `at` is the coordinate along the wall. */
export interface Gap {
  side: 'n' | 's' | 'e' | 'w';
  at: number;
  width: number;
}

/**
 * The walls round a room, `h` high and `WALL_T` thick, centred on the rectangle's edges, with
 * gaps where doorways are. Rooms sharing an edge share a wall: give the shared wall to one of
 * them only, and skip it in the other, whose own walls then stop at the shared wall's face
 * instead of running through it.
 */
export function roomWalls(
  r: FloorRect,
  h: number,
  colour: number,
  gaps: Gap[] = [],
  opts: { y0?: number; skip?: Gap['side'][] } = {},
): BoxDef[] {
  const y0 = opts.y0 ?? 0;
  const out: BoxDef[] = [];
  const t = WALL_T;
  for (const side of ['n', 's', 'e', 'w'] as const) {
    if (opts.skip?.includes(side)) continue;
    const alongX = side === 'n' || side === 's';
    const line = side === 'n' ? r.z1 : side === 's' ? r.z0 : side === 'e' ? r.x1 : r.x0;
    // A north or south wall runs out over the end walls' thickness, unless an end wall is
    // another room's: then it stops at that wall's inner face.
    const [from, to] = alongX
      ? [
          opts.skip?.includes('w') ? r.x0 + t / 2 : r.x0 - t / 2,
          opts.skip?.includes('e') ? r.x1 - t / 2 : r.x1 + t / 2,
        ]
      : [r.z0 + t / 2, r.z1 - t / 2];
    const cuts = gaps
      .filter((g) => g.side === side)
      .map((g) => [g.at - g.width / 2, g.at + g.width / 2] as const)
      .sort((a, b) => a[0] - b[0]);
    let start = from;
    const pieces: [number, number][] = [];
    for (const [a, b] of cuts) {
      if (a > start) pieces.push([start, a]);
      start = Math.max(start, b);
    }
    if (to > start) pieces.push([start, to]);
    for (const [a, b] of pieces) {
      if (b - a < 0.05) continue;
      out.push(
        alongX
          ? box((a + b) / 2, y0 + h / 2, line, b - a, h, t, colour)
          : box(line, y0 + h / 2, (a + b) / 2, t, h, b - a, colour),
      );
    }
  }
  return out;
}

/**
 * The wall left over each doorway in `gaps`, from the opening's top (`gap.height`, or
 * `doorH`) up to the top of the wall: without one, a doorway is as tall as the wall and its
 * doors are drawn that tall too. The pieces are as thick as the wall and sit on its line.
 */
export function headersOver(
  r: FloorRect,
  wallH: number,
  colour: number,
  gaps: (Gap & { height?: number })[],
  doorH = 2.2,
  y0 = 0,
): BoxDef[] {
  const out: BoxDef[] = [];
  for (const g of gaps) {
    const top = g.height ?? doorH;
    if (wallH - top < 0.05) continue;
    const alongX = g.side === 'n' || g.side === 's';
    const line = g.side === 'n' ? r.z1 : g.side === 's' ? r.z0 : g.side === 'e' ? r.x1 : r.x0;
    const y = y0 + (top + wallH) / 2;
    out.push(
      alongX
        ? box(g.at, y, line, g.width, wallH - top, WALL_T, colour)
        : box(line, y, g.at, WALL_T, wallH - top, g.width, colour),
    );
  }
  return out;
}

/** A flat roof over a rectangle: a thin box whose underside is at `y`, reaching over the walls. */
export function roofOver(r: FloorRect, y: number, colour: number, over = WALL_T / 2): BoxDef {
  return standing(grow(r, over), 0.2, colour, y);
}

/**
 * The inside of a room under a flat roof whose underside is at `h` (see `roofOver`): from its
 * floor up to the roof, out to the outer faces of its walls.
 */
export function interiorOf(r: FloorRect, h: number, y0 = 0): InteriorDef {
  return { rect: grow(r, WALL_T / 2), y0, y1: y0 + h };
}

/** A room's floor: the decal the renderers and the dog read the room from. */
export function floorOf(r: FloorRect, colour: number, y = 0): DecalDef {
  const c = centre(r);
  return { pos: { x: c.x, y, z: c.z }, size: { x: r.x1 - r.x0, z: r.z1 - r.z0 }, colour };
}

/**
 * How far a ladder's height goes past the top of what it climbs to. A climber rises until
 * their centre is at the ladder's height, so that has to put their feet (a player's centre is
 * 0.85 m up) a little above the deck or roof they step onto.
 */
export const LADDER_CLEAR = 0.95;

export function lampPost(x: number, z: number, h = 3): BoxDef {
  return box(x, h / 2, z, 0.3, h, 0.3, 0x2f3336, { model: 'lampPost' });
}

/** A pallet's footprint and the height of one: a stack of them is climbed a pallet at a time. */
export const PALLET = { x: 1.2, y: 0.28, z: 1.0 };

/** A climbable stack: `n` pallets, as steps. */
export function pallets(x: number, z: number, n: number, colour = 0xa98a5c): BoxDef[] {
  const out: BoxDef[] = [];
  for (let i = 0; i < n; i++)
    out.push(
      box(x, PALLET.y / 2 + i * PALLET.y, z, PALLET.x, PALLET.y, PALLET.z, colour, {
        model: 'pallet',
      }),
    );
  return out;
}

// ---------------------------------------------------------------- hiding places

/** The usual size of each kind of hiding place. */
export const HIDEOUT_SIZE: Record<HideoutKind, Vec3> = {
  fridge: { x: 0.8, y: 1.8, z: 0.7 },
  locker: { x: 0.6, y: 2, z: 0.8 },
  cabinet: { x: 1.2, y: 0.7, z: 0.5 },
  drawer: { x: 0.9, y: 0.22, z: 0.1 },
  chest: { x: 0.8, y: 0.6, z: 0.6 },
  toolbox: { x: 0.7, y: 0.3, z: 0.35 },
  mailbox: { x: 0.24, y: 0.3, z: 0.5 },
  rug: { x: 1.4, y: 0.02, z: 1 },
  cushion: { x: 1.2, y: 0.1, z: 0.7 },
  skip: { x: 2.4, y: 1.2, z: 1.6 },
  coolbox: { x: 0.7, y: 0.45, z: 0.45 },
  tent: { x: 1.6, y: 1.5, z: 2.2 },
  berth: { x: 1.8, y: 0.1, z: 0.7 },
  portaloo: { x: 1.1, y: 2.3, z: 1.1 },
  safe: { x: 0.8, y: 0.9, z: 0.7 },
  tin: { x: 0.3, y: 0.3, z: 0.3 },
};

/**
 * A hiding place of `kind` standing with its base at `y0` (its centre is half its height up),
 * or lying on something for rugs, cushions and berths, which are given the height they lie at.
 */
export function hideout(
  id: number,
  kind: HideoutKind,
  x: number,
  z: number,
  facing: number,
  y0 = 0,
  size: Vec3 = HIDEOUT_SIZE[kind],
): HideoutDef {
  const flat = kind === 'rug' || kind === 'cushion' || kind === 'berth';
  const y = flat ? y0 + size.y / 2 : y0 + size.y / 2;
  return { id, kind, pos: { x: tidy(x), y: tidy(y), z: tidy(z) }, size, facing };
}

/** How high a letterbox stands: the top of the post it sits on. */
export const MAILBOX_POST = 0.9;

/**
 * A letterbox on its post, as the house's stands by its gate: the box at `x, z` looking
 * `facing`, and a dark timber post from the ground up under the middle of it.
 */
export function mailboxOnPost(
  id: number,
  x: number,
  z: number,
  facing: number,
): [HideoutDef, BoxDef] {
  return [
    hideout(id, 'mailbox', x, z, facing, MAILBOX_POST),
    box(x, MAILBOX_POST / 2, z, 0.08, MAILBOX_POST, 0.08, 0x5a4330, { model: 'post' }),
  ];
}

/**
 * A drawer in the front of a counter or desk box: `box` is the counter, `along` where along
 * its front (local x, from the centre) the drawer sits.
 */
export function drawerIn(id: number, counter: BoxDef, along: number, height = 0.62): HideoutDef {
  const front = counter.front ?? '-z';
  const sx = counter.size.x;
  const sz = counter.size.z;
  const depth = front === '-z' || front === '+z' ? sz : sx;
  const facing = { '-z': SOUTH, '+z': NORTH, '-x': WEST, '+x': EAST }[front];
  const out = { x: -Math.sin(facing), z: -Math.cos(facing) };
  const right = { x: Math.cos(facing), z: -Math.sin(facing) };
  // Its front stands proud of the counter's (`DRAWER_PROUD`).
  const inset = HIDEOUT_SIZE.drawer.z / 2 - DRAWER_PROUD;
  const x = counter.pos.x + out.x * (depth / 2 - inset) + right.x * along;
  const z = counter.pos.z + out.z * (depth / 2 - inset) + right.z * along;
  return {
    id,
    kind: 'drawer',
    pos: { x: tidy(x), y: tidy(counter.pos.y - counter.size.y / 2 + height), z: tidy(z) },
    size: HIDEOUT_SIZE.drawer,
    facing,
  };
}

// ---------------------------------------------------------------- bins

/**
 * The ground a new thing must keep off, as rectangles: everything standing on it (even what a
 * player steps over), with a margin, the swing of every door and lid, water, holes, ladders,
 * page spots on the ground, the spawn, and the first job site with its inspector's pad.
 */
function takenGround(level: LevelDef, boards = true): FloorRect[] {
  return [
    // Everything on the ground, even what a player steps over: a rack cannot stand on it.
    ...groundObstacles(level, 0, boards).map((r) => grow(r, 0.25)),
    ...claimedGround(level),
  ];
}

/**
 * The ground kept for what players do there, as rectangles: the swing of every door and lid,
 * water, holes, ladders, page spots on the ground, the spawn, the gate between rival yards,
 * and the first job site with its inspector's pad.
 */
function claimedGround(level: LevelDef): FloorRect[] {
  const site = levelSites(level)[0]!;
  const home = {
    x: site.baseplate.x + BASEPLATE_SIZE / 2,
    z: site.baseplate.z + BASEPLATE_SIZE / 2,
  };
  return [
    // Doors and lids swing out, and drawers slide.
    ...level.hideouts.map((h) =>
      turned(h.pos.x, h.pos.z, h.size.x + 1.4, h.size.z + 1.4, h.facing),
    ),
    ...(level.water ?? []).map((w) => grow(w, 0.4)),
    ...(level.groundHoles ?? (level.groundHole ? [level.groundHole] : [])).map((r) => grow(r, 0.4)),
    ...level.ladders.map((l) => rect(l.pos.x - 1.2, l.pos.z - 1.2, l.pos.x + 1.2, l.pos.z + 1.2)),
    ...level.pageSpots
      .filter((p) => p.y < 0.6)
      .map((p) => rect(p.x - 0.6, p.z - 0.6, p.x + 0.6, p.z + 0.6)),
    rect(level.spawn.x - 1.5, level.spawn.z - 1.5, level.spawn.x + 1.5, level.spawn.z + 1.5),
    // The way through the gate in the wall between rival teams' yards, in the south fence.
    rect(
      -RIVAL_WALL.gate / 2 - 1,
      floorRect(level).z0,
      RIVAL_WALL.gate / 2 + 1,
      floorRect(level).z0 + 3,
    ),
    grow(
      rect(
        home.x - BASEPLATE_SIZE / 2,
        home.z - BASEPLATE_SIZE / 2,
        home.x + BASEPLATE_SIZE / 2,
        home.z + BASEPLATE_SIZE / 2,
      ),
      1.5,
    ),
    grow(
      rect(
        site.inspector.pos.x - site.inspector.size.x / 2,
        site.inspector.pos.z - site.inspector.size.z / 2,
        site.inspector.pos.x + site.inspector.size.x / 2,
        site.inspector.pos.z + site.inspector.size.z / 2,
      ),
      0.5,
    ),
  ];
}

/**
 * Stands a second corkboard beside the level's own one, so a manual of 32 pages fits on them:
 * along the first board's length, on whichever side there is room for it and for players in
 * front of both its faces. Call it once the rest of the level is in place, before the racks.
 */
export function standSecondBoard(level: LevelDef): void {
  // The first board is left out: the second stands beside it, its room in front shared.
  const blocked = takenGround(level, false);
  const { pos, facing } = level.board;
  const along = { x: Math.cos(facing), z: -Math.sin(facing) };
  // As close beside it as there is room, a little apart at the least.
  const steps = Array.from({ length: 51 }, (_, i) => 2 + i / 10).flatMap((d) => [d, -d]);
  for (const step of steps) {
    const at = { x: tidy(pos.x + along.x * step), y: pos.y, z: tidy(pos.z + along.z * step) };
    // The board and a player's room in front of each face.
    const room = turned(at.x, at.z, BOARD_SIZE.x + 0.2, 2.4, facing);
    const floor = grow(floorRect(level), -0.3);
    const inside =
      room.x0 >= floor.x0 && room.x1 <= floor.x1 && room.z0 >= floor.z0 && room.z1 <= floor.z1;
    const first = grow(turned(pos.x, pos.z, BOARD_SIZE.x, 0.3, facing), 0.1);
    const clear = [first, ...blocked].every(
      (b) => b.x1 <= room.x0 || b.x0 >= room.x1 || b.z1 <= room.z0 || b.z0 >= room.z1,
    );
    if (inside && clear) {
      level.moreBoards = [{ pos: at, facing }];
      return;
    }
  }
  throw new Error('no room for a second corkboard');
}

/** The most pages a round lays out: a 32-step manual and the index. */
const MOST_PAGES = 32 + 1;
/** Of those, how many go into hiding places at the most (about half, see `Round`). */
const MOST_HIDDEN = Math.ceil(MOST_PAGES / 2);
/** Room for the gear of a gear hunt, and a few to spare. */
const SPARE_SPOTS = 8;

/**
 * Lays more page spots on the open ground, where a page lies in plain sight, until the level
 * holds the longest manual a build file can have, every page of it, with the gear
 * of a gear hunt: each new one as far as it can be from the others. Call it last, once the
 * racks stand.
 */
export function addGroundPageSpots(level: LevelDef): void {
  const hidden = Math.min(level.hideouts.length, MOST_HIDDEN);
  const want = MOST_PAGES - hidden + SPARE_SPOTS;
  if (level.pageSpots.length >= want) return;
  const blocked = takenGround(level).map((r) => grow(r, 0.2));
  const floor = grow(floorRect(level), -0.8);
  const walk = walkableGround(level);
  const free: { x: number; z: number }[] = [];
  for (let x = floor.x0; x <= floor.x1; x += 0.5)
    for (let z = floor.z0; z <= floor.z1; z += 0.5) {
      if (blocked.some((b) => inRect(b, x, z))) continue;
      if (!walk(x, z)) continue;
      free.push({ x: tidy(x), z: tidy(z) });
    }
  const spots = [...level.pageSpots];
  // How far each free point is from the nearest spot, brought up to date as spots are added.
  const far = free.map((p) => Math.min(...spots.map((q) => Math.hypot(q.x - p.x, q.z - p.z))));
  while (spots.length < want) {
    let best: { x: number; z: number } | undefined;
    let bestD = 2;
    for (const [i, p] of free.entries()) {
      const d = far[i]!;
      if (d > bestD) [best, bestD] = [p, d];
    }
    if (!best) throw new Error('no room left on the ground for page spots');
    spots.push({ x: best.x, y: 0, z: best.z });
    for (const [i, p] of free.entries())
      far[i] = Math.min(far[i]!, Math.hypot(best.x - p.x, best.z - p.z));
  }
  level.pageSpots = spots;
}

/** Room in front of a machine for a player to stand and use it. */
const MACHINE_STANDING = 1.3;
/** How far the machines keep from each other and everything else, beyond where players stand. */
const MACHINE_GAP = 0.6;

/**
 * Stands the brick works in a level (`MACHINES`): each machine on its own about the job site,
 * not in a row. Each goes where it fits best: its own way round the site from the others, a few
 * metres out, its front turned toward the site with room to stand there, clear of everything
 * players and the dog use. Call it once the rest of the level is in place, before its dog
 * network is worked out.
 */
export function standBrickWorks(level: LevelDef): void {
  const site = levelSites(level)[0]!;
  const home = {
    x: site.baseplate.x + BASEPLATE_SIZE / 2,
    z: site.baseplate.z + BASEPLATE_SIZE / 2,
  };
  const blocked = takenGround(level);
  const floor = grow(floorRect(level), -0.3);
  const free = (r: FloorRect) =>
    r.x0 >= floor.x0 &&
    r.x1 <= floor.x1 &&
    r.z0 >= floor.z0 &&
    r.z1 <= floor.z1 &&
    blocked.every((b) => b.x1 <= r.x0 || b.x0 >= r.x1 || b.z1 <= r.z0 || b.z0 >= r.z1);
  /** A machine's footprint and the ground in front of it where players stand. */
  const ground = (m: MachineDef) => {
    const at = turned(m.pos.x, m.pos.z, m.size.x, m.size.z, m.facing);
    const fx = Math.round(Math.sin(m.facing));
    const fz = Math.round(Math.cos(m.facing));
    const stand =
      fz > 0
        ? rect(at.x0, at.z1, at.x1, at.z1 + MACHINE_STANDING)
        : fz < 0
          ? rect(at.x0, at.z0 - MACHINE_STANDING, at.x1, at.z0)
          : fx > 0
            ? rect(at.x1, at.z0, at.x1 + MACHINE_STANDING, at.z1)
            : rect(at.x0 - MACHINE_STANDING, at.z0, at.x0, at.z1);
    return { at, stand };
  };
  const bearings: number[] = [];
  for (const [i, { kind, id }] of MACHINES.entries()) {
    const size = MACHINE_SIZE[kind];
    // Each a little further out than the last, so they do not stand in a ring either.
    const want = 4.5 + 1.1 * i;
    let best: { m: MachineDef; score: number } | null = null;
    for (let x = Math.ceil(floor.x0); x <= floor.x1; x += 0.5)
      for (let z = Math.ceil(floor.z0); z <= floor.z1; z += 0.5) {
        const away = Math.hypot(x - home.x, z - home.z);
        if (away < size.x / 2 + 2.5) continue;
        const bearing = Math.atan2(x - home.x, z - home.z);
        // Turned the quarter that faces the site best.
        const facing =
          Math.round(Math.atan2(home.x - x, home.z - z) / (Math.PI / 2)) * (Math.PI / 2);
        const m = machineAt(kind, id, x, z, facing + 0);
        const { at, stand } = ground(m);
        if (!free(grow(at, MACHINE_GAP)) || !free(stand)) continue;
        // Away from where the others went round the site.
        const crowd = bearings.reduce((c, b) => {
          const d = Math.abs(Math.atan2(Math.sin(bearing - b), Math.cos(bearing - b)));
          return c + Math.max(0, 1.2 - d);
        }, 0);
        const score = Math.abs(away - want) + 3 * crowd;
        if (!best || score < best.score) best = { m, score };
      }
    if (!best) throw new Error(`nowhere to stand the ${kind}`);
    const { at, stand } = ground(best.m);
    blocked.push(grow(at, MACHINE_GAP), stand);
    bearings.push(Math.atan2(best.m.pos.x - home.x, best.m.pos.z - home.z));
    level.machines.push(best.m);
  }
}

/** What a map's rubbish bins look like: a model, and colours the bins take in turn. */
export interface BinLook {
  model: TrashBinModel;
  colours: number[];
}

/** Room in front of a bin for a player to stand and throw in. */
const BIN_STANDING = 0.9;
/** How far a bin keeps from the ends of the wall it stands against: doorways, corners, gaps. */
const BIN_FROM_END = 0.7;
/** Bins out in the open stand at least this far apart. */
const BIN_SPACING = 4.5;
/** Ground for each bin: about one for every this many square metres of the map. */
const GROUND_PER_BIN = 65;
/** A room bigger than this (square metres) is a hall, with two bins in its outdoor look. */
const HALL_AREA = 100;

/**
 * Stands rubbish bins about a level, for bricks nobody needs (see `isTrashBin`): one close to
 * the job site, where offcuts pile up, one in every room on the ground floor (two in a hall),
 * and the rest spread out over the open ground, each its own way from the others. A bin backs
 * onto a wall, a fence or a counter, away from the wall's ends (where doorways and corners
 * are), or out in the open stands clear all round; either way with room in front to stand,
 * cutting nothing off and clear of the dog's walks. `rooms` are the rooms on the ground floor,
 * if the level's interiors take in several at once, and `keep` more ground to keep clear. Rooms get the `indoor` look, halls and the
 * outdoors the `outdoor` one. Call it last, once the page spots and the dog's network are
 * worked out: the bins keep off both.
 */
export function standTrashBins(
  level: LevelDef,
  looks: { outdoor: BinLook; indoor: BinLook; rooms?: FloorRect[]; keep?: FloorRect[] },
): void {
  const site = levelSites(level)[0]!;
  const home = {
    x: site.baseplate.x + BASEPLATE_SIZE / 2,
    z: site.baseplate.z + BASEPLATE_SIZE / 2,
  };
  const floor = grow(floorRect(level), -0.2);
  /** Under a roof on the ground floor. */
  const inside = level.interiors.filter((i) => i.y0 <= 0.05 && i.y1 > 1).map((i) => i.rect);
  const rooms = (looks.rooms ?? inside).filter((r) => r.x1 - r.x0 > 1.5 && r.z1 - r.z0 > 1.5);
  const hall = (r: FloorRect) => (r.x1 - r.x0) * (r.z1 - r.z0) > HALL_AREA;
  const roomAt = (x: number, z: number) => rooms.find((r) => inRect(r, x, z));
  const indoors = (x: number, z: number) => inside.some((r) => inRect(r, x, z));
  /** Everything on the ground, however low: a bin may not stand in or on any of it. */
  const solid = groundObstacles(level, 0);
  /** Ground players need: claimed, and in front of the machines, boards and the vacuum. */
  const around = (p: { x: number; z: number }, r: number) =>
    rect(p.x - r, p.z - r, p.x + r, p.z + r);
  const kept = [
    ...claimedGround(level),
    ...(looks.keep ?? []),
    ...level.machines.map((m) => around(machineFront(m), 1.2)),
    ...[level.board, ...(level.moreBoards ?? [])].map((b) =>
      turned(b.pos.x, b.pos.z, BOARD_SIZE.x + 0.6, 3, b.facing),
    ),
    ...(level.doors ?? []).filter((d) => (d.y ?? 0) === 0).map((d) => around(d, 1.6)),
    ...level.meetingSeats.map((p) => around(p, 0.6)),
    around(level.vacuum.pos, 1),
    // The way up onto anything a player climbs by steps: pallet stairs, a footbridge's flight.
    ...level.boxes
      .filter((b) => !b.tiltX && b.pos.y + b.size.y / 2 > 0.1 && b.pos.y + b.size.y / 2 <= 0.6)
      .map((b) => grow(turned(b.pos.x, b.pos.z, b.size.x, b.size.z, 0), 1)),
    // And up a ramp, from its foot.
    ...level.boxes
      .filter((b) => b.tiltX)
      .map((b) => grow(turned(b.pos.x, b.pos.z, b.size.x, b.size.z, 0), 1.5)),
    ...(level.catapult ? [around(level.catapult.pos, 3)] : []),
  ];
  const hits = (r: FloorRect, rs: FloorRect[]) =>
    rs.some((b) => b.x0 < r.x1 && r.x0 < b.x1 && b.z0 < r.z1 && r.z0 < b.z1);
  const walk = walkableGround(level);
  /** How many cells of ground a player can walk on: a bin must not cut any of it off. */
  const walkable = (w: (x: number, z: number) => boolean) => {
    let n = 0;
    for (let x = floor.x0; x < floor.x1; x += 0.2)
      for (let z = floor.z0; z < floor.z1; z += 0.2) if (w(x, z)) n++;
    return n;
  };
  const ground = walkable(walk);
  /** Whether a bin standing here would be in the dog's way, on one of its walks. */
  const dogClear = DOG_RADIUS + 0.12;
  const inDogsWay = (r: FloorRect) =>
    level.dog.points.some((p) => distTo(r, p.x, p.z) < dogClear) ||
    level.dog.links.some(
      ([a, b]) => !clearWalk([r], level.dog.points[a]!, level.dog.points[b]!, dogClear),
    );
  /** Cells the bins stood so far may take: each the ground under it and round its edge. */
  let mayLose = 0;

  /** Somewhere a bin could stand. */
  interface Spot {
    x: number;
    z: number;
    front: NonNullable<BoxDef['front']>;
    /** The room it is in, if any. */
    room: FloorRect | undefined;
    /** Whether it backs onto something. */
    backed: boolean;
    /** The ground it takes: the bin, room in front to stand and a little either side. */
    takes: FloorRect;
    /** The bin's own footprint. */
    bin: FloorRect;
  }
  const FRONTS = [
    { front: '+x', dx: 1, dz: 0 },
    { front: '-x', dx: -1, dz: 0 },
    { front: '+z', dx: 0, dz: 1 },
    { front: '-z', dx: 0, dz: -1 },
  ] as const;
  const lookAt = (x: number, z: number) => {
    const room = roomAt(x, z);
    return room && !hall(room) ? looks.indoor : looks.outdoor;
  };
  /** A bin at (`x`, `z`) facing `dir`, if it could stand there. */
  const spot = (
    x: number,
    z: number,
    dir: (typeof FRONTS)[number],
    backed: boolean,
  ): Spot | null => {
    const { dx, dz } = dir;
    const size = TRASH_BIN_SIZE[lookAt(x, z).model];
    const bin = turned(x, z, size.x, size.z, dx ? Math.PI / 2 : 0);
    if (bin.x0 < floor.x0 || bin.x1 > floor.x1 || bin.z0 < floor.z0 || bin.z1 > floor.z1)
      return null;
    const room = roomAt(x, z);
    if (roomAt(bin.x0, bin.z0) !== room || roomAt(bin.x1, bin.z1) !== room) return null;
    if (!room && (indoors(bin.x0, bin.z0) || indoors(bin.x1, bin.z1))) return null;
    // Backed onto something, it may stand right against it; in the open, it keeps clear.
    if (hits(grow(bin, backed ? 0.01 : 0.6), solid)) return null;
    const side = backed ? 0.25 : 0.6;
    const takes = rect(
      Math.min(bin.x0, bin.x0 + dx * BIN_STANDING) - (dz ? side : 0),
      Math.min(bin.z0, bin.z0 + dz * BIN_STANDING) - (dx ? side : 0),
      Math.max(bin.x1, bin.x1 + dx * BIN_STANDING) + (dz ? side : 0),
      Math.max(bin.z1, bin.z1 + dz * BIN_STANDING) + (dx ? side : 0),
    );
    if (hits(takes, solid) || hits(takes, kept)) return null;
    const depth = (dx ? bin.x1 - bin.x0 : bin.z1 - bin.z0) / 2;
    if (!walk(x + dx * (depth + 0.5), z + dz * (depth + 0.5))) return null;
    return { x, z, front: dir.front, room, backed, takes, bin };
  };

  const spots: Spot[] = [];
  // Against the sides of walls, fences, counters and platforms, facing out from them.
  const backs = level.boxes.filter(
    (b) =>
      !b.tiltX &&
      b.pos.y - b.size.y / 2 < 0.05 &&
      b.pos.y + b.size.y / 2 >= 0.7 &&
      (!b.model || b.model === 'counter' || b.model === 'platform'),
  );
  for (const wall of backs) {
    const hx = wall.size.x / 2;
    const hz = wall.size.z / 2;
    for (const dir of FRONTS) {
      const { dx, dz } = dir;
      // Along the face, keeping off both its ends.
      const lo = dx ? wall.pos.z - hz : wall.pos.x - hx;
      const hi = dx ? wall.pos.z + hz : wall.pos.x + hx;
      const face = dx ? wall.pos.x + dx * hx : wall.pos.z + dz * hz;
      for (let u = lo + BIN_FROM_END + 0.3; u <= hi - BIN_FROM_END - 0.3; u += 0.25) {
        // How far out its middle stands depends on its look, and so on where it is.
        const probe = face + (dx || dz) * 0.4;
        const look = dx ? lookAt(probe, u) : lookAt(u, probe);
        const off = 0.03 + TRASH_BIN_SIZE[look.model].z / 2;
        const out = tidy(face + (dx || dz) * off);
        const s = dx ? spot(out, tidy(u), dir, true) : spot(tidy(u), out, dir, true);
        if (s) spots.push(s);
      }
    }
  }
  // Out in the open, turned toward the job site.
  for (let x = Math.ceil(floor.x0); x <= floor.x1; x += 0.5)
    for (let z = Math.ceil(floor.z0); z <= floor.z1; z += 0.5) {
      if (roomAt(x, z) || indoors(x, z)) continue;
      const tx = home.x - x;
      const tz = home.z - z;
      const dir = FRONTS[Math.abs(tx) > Math.abs(tz) ? (tx > 0 ? 0 : 1) : tz > 0 ? 2 : 3];
      const s = spot(x, z, dir, false);
      if (s) spots.push(s);
    }

  const placed: { x: number; z: number; takes: FloorRect }[] = [];
  const colourOf = { indoor: 0, outdoor: 0 };
  const nearest = (s: Spot) =>
    Math.min(Infinity, ...placed.map((p) => Math.hypot(p.x - s.x, p.z - s.z)));
  /** Stands a bin on the best free spot by `score` (lowest first); false if none will do. */
  const stand = (pool: Spot[], score: (s: Spot) => number): boolean => {
    const taken = placed.map((p) => p.takes);
    const ranked = pool
      .filter((s) => !hits(s.takes, taken))
      .map((s) => ({ s, score: score(s) }))
      .sort((a, b) => a.score - b.score);
    let tries = 6;
    for (const { s } of ranked) {
      if (inDogsWay(s.bin)) continue;
      if (tries-- === 0) break;
      const look = lookAt(s.x, s.z);
      const which = look === looks.indoor ? 'indoor' : 'outdoor';
      const colour = look.colours[colourOf[which] % look.colours.length]!;
      const b = trashBin(look.model, s.x, s.z, s.front, colour);
      level.boxes.push(b);
      // Only the ground under the bin and round its edge may be lost, nothing cut off (a bin
      // out in the open, clear all round, cuts nothing off).
      const loses = ((b.size.x + 0.8) * (b.size.z + 0.8)) / 0.04;
      if (!s.backed || ground - walkable(walkableGround(level)) <= mayLose + loses) {
        mayLose += loses;
        colourOf[which]++;
        placed.push({ x: s.x, z: s.z, takes: grow(s.takes, 0.3) });
        return true;
      }
      level.boxes.pop();
    }
    return false;
  };
  /** Backed onto something is the better place for a bin, by about this many metres. */
  const backing = (s: Spot) => (s.backed ? -1.5 : 0);
  const outdoors = spots.filter((s) => !s.room);
  // By the job site, where the offcuts are.
  const homeAway = (s: Spot) => Math.hypot(s.x - home.x, s.z - home.z);
  stand(
    outdoors.filter((s) => homeAway(s) >= 2.5 && homeAway(s) <= 11),
    (s) => Math.abs(homeAway(s) - 4.5) + backing(s) / 3,
  );
  // One in every room, two in a hall, each as far from the rest as it can be.
  for (const r of rooms)
    for (let i = 0; i < (hall(r) ? 2 : 1); i++)
      stand(
        spots.filter((s) => s.room === r),
        (s) => -nearest(s) + backing(s),
      );
  // The rest about the open ground, spread out.
  const want = Math.round(((floor.x1 - floor.x0) * (floor.z1 - floor.z0)) / GROUND_PER_BIN);
  while (placed.length < want) {
    const far = outdoors.filter((s) => nearest(s) >= BIN_SPACING);
    if (!stand(far, (s) => -Math.min(nearest(s), 12) + backing(s))) break;
  }
}

/** `n` seats evenly round a circle. */
export function ring(cx: number, cz: number, r: number, n: number, y = 0, start = 0): Vec3[] {
  return Array.from({ length: n }, (_, i) => {
    const a = start + (i / n) * Math.PI * 2;
    return { x: tidy(cx + Math.cos(a) * r), y, z: tidy(cz + Math.sin(a) * r) };
  });
}

// ---------------------------------------------------------------- walking and the dog

/** The axis-aligned footprint of a `w` by `d` thing turned by `yaw`. */
function turned(x: number, z: number, w: number, d: number, yaw: number): FloorRect {
  const c = Math.abs(Math.cos(yaw));
  const sn = Math.abs(Math.sin(yaw));
  const hx = (w / 2) * c + (d / 2) * sn;
  const hz = (w / 2) * sn + (d / 2) * c;
  return rect(x - hx, z - hz, x + hx, z + hz);
}

type Solid = Pick<LevelDef, 'boxes' | 'hideouts'> &
  Partial<
    Pick<
      LevelDef,
      | 'machines'
      | 'baseplate'
      | 'doneButton'
      | 'bell'
      | 'board'
      | 'moreBoards'
      | 'catapult'
      | 'sites'
      | 'groundHoles'
    >
  >;

/**
 * The footprints on the ground floor a player or the dog cannot walk through: boxes at body
 * height, hiding places, bins, the job sites' plates, buttons and boards, the catapult, and
 * the holes in the ground nothing is laid over level with it (a railway cutting, but not the
 * floor over a basement or a carriage's over the rails). `stepOver` is how high a thing may be
 * and still be walked over: a player's step, or the dog's much lower one.
 */
export function groundObstacles(level: Solid, stepOver = 0.3, boards = true): FloorRect[] {
  const out: FloorRect[] = [];
  for (const b of level.boxes) {
    const bottom = b.pos.y - b.size.y / 2;
    const top = b.pos.y + b.size.y / 2;
    // Low enough to step onto, or high enough to walk under: not in the way. A ramp is walked
    // up by players, but the dog's step is too low for it. A track's bed and the rails on it
    // are each a step up from what they stand on, which the dog takes too.
    if ((b.tiltX && stepOver >= 0.2) || bottom > 1.2 || top <= stepOver) continue;
    if (stepOver > 0 && (b.model === 'ballast' || b.model === 'trackRail')) continue;
    out.push(
      rect(
        b.pos.x - b.size.x / 2,
        b.pos.z - b.size.z / 2,
        b.pos.x + b.size.x / 2,
        b.pos.z + b.size.z / 2,
      ),
    );
  }
  for (const h of level.hideouts) {
    const bottom = h.pos.y - h.size.y / 2;
    const top = h.pos.y + h.size.y / 2;
    // Rugs and cushions are walked over; what stands upstairs or down in a basement is not
    // on this floor at all.
    if (h.kind === 'rug' || isSoft(h) || bottom > 1.2 || top <= stepOver) continue;
    out.push(turned(h.pos.x, h.pos.z, h.size.x, h.size.z, h.facing));
  }
  for (const m of level.machines ?? [])
    out.push(turned(m.pos.x, m.pos.z, m.size.x, m.size.z, m.facing));
  const sites = [
    ...(level.baseplate && level.doneButton && level.bell && level.board
      ? [
          {
            baseplate: level.baseplate,
            doneButton: level.doneButton,
            bell: level.bell,
            board: level.board,
            moreBoards: level.moreBoards,
          },
        ]
      : []),
    ...(level.sites ?? []),
  ];
  for (const st of sites) {
    out.push(rect(st.baseplate.x, st.baseplate.z, st.baseplate.x + 1.6, st.baseplate.z + 1.6));
    for (const b of [st.doneButton, st.bell]) out.push(turned(b.x, b.z, 0.4, 0.4, 0));
    if (boards)
      for (const b of [st.board, ...(st.moreBoards ?? [])])
        out.push(turned(b.pos.x, b.pos.z, 1.7, 0.3, b.facing));
  }
  for (const hole of level.groundHoles ?? []) {
    const covers = level.boxes
      .filter((b) => Math.abs(b.pos.y + b.size.y / 2) < 0.03 && b.pos.y - b.size.y / 2 < -0.01)
      .map((b) =>
        rect(
          b.pos.x - b.size.x / 2,
          b.pos.z - b.size.z / 2,
          b.pos.x + b.size.x / 2,
          b.pos.z + b.size.z / 2,
        ),
      );
    out.push(...uncovered(hole, covers));
  }
  if (level.catapult) {
    // Its frame, which stands behind its middle (local +z, as the simulation has it).
    const c = level.catapult;
    const { size, centreZ } = CATAPULT.frame;
    const mid = { x: Math.sin(c.facing) * centreZ, z: Math.cos(c.facing) * centreZ };
    out.push(turned(c.pos.x + mid.x, c.pos.z + mid.z, size.x, size.z, c.facing));
  }
  return out;
}

/** What of `r` none of `covers` lies over, as rectangles. */
function uncovered(r: FloorRect, covers: FloorRect[]): FloorRect[] {
  let left = [r];
  for (const c of covers)
    left = left.flatMap((q) => {
      if (!(q.x0 < c.x1 && c.x0 < q.x1 && q.z0 < c.z1 && c.z0 < q.z1)) return [q];
      const cut = {
        x0: Math.max(q.x0, c.x0),
        x1: Math.min(q.x1, c.x1),
        z0: Math.max(q.z0, c.z0),
        z1: Math.min(q.z1, c.z1),
      };
      return [
        { x0: q.x0, x1: q.x1, z0: q.z0, z1: cut.z0 },
        { x0: q.x0, x1: q.x1, z0: cut.z1, z1: q.z1 },
        { x0: q.x0, x1: cut.x0, z0: cut.z0, z1: cut.z1 },
        { x0: cut.x1, x1: q.x1, z0: cut.z0, z1: cut.z1 },
      ].filter((p) => p.x1 - p.x0 > 1e-6 && p.z1 - p.z0 > 1e-6);
    });
  return left;
}

const distTo = (r: FloorRect, x: number, z: number): number => {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
};

/** Whether a straight walk keeps `clear` metres from every obstacle. */
export function clearWalk(solid: FloorRect[], a: Vec3, b: Vec3, clear: number): boolean {
  const span = grow(
    rect(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z)),
    clear,
  );
  const near = solid.filter(
    (r) => r.x0 < span.x1 && span.x0 < r.x1 && r.z0 < span.z1 && span.z0 < r.z1,
  );
  if (!near.length) return true;
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05);
  for (let i = 0; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps;
    const z = a.z + ((b.z - a.z) * i) / steps;
    if (near.some((r) => distTo(r, x, z) < clear)) return false;
  }
  return true;
}

/**
 * Where a player can walk on the ground floor, as a function of a point: a flood fill over a
 * grid from the spawn, through cells where a player standing touches nothing. Water counts as
 * walkable (slowly).
 */
export function walkableGround(
  level: LevelDef,
  radius = 0.32,
  stepOver = 0.3,
): (x: number, z: number) => boolean {
  const f = floorRect(level);
  const cell = 0.2;
  const nx = Math.ceil((f.x1 - f.x0) / cell);
  const nz = Math.ceil((f.z1 - f.z0) / cell);
  const solid = groundObstacles(level, stepOver);
  // Each obstacle blocks the cells within `radius` of it. Only the cells around it are tested:
  // testing every cell against every obstacle took seconds per layout.
  const free = new Uint8Array(nx * nz).fill(1);
  const first = (v: number, n: number) => Math.max(0, Math.min(n, Math.floor(v / cell - 0.5)));
  const last = (v: number, n: number) => Math.max(-1, Math.min(n - 1, Math.ceil(v / cell - 0.5)));
  for (const r of solid) {
    const i1 = last(r.x1 + radius - f.x0, nx);
    const k0 = first(r.z0 - radius - f.z0, nz);
    const k1 = last(r.z1 + radius - f.z0, nz);
    for (let i = first(r.x0 - radius - f.x0, nx); i <= i1; i++)
      for (let k = k0; k <= k1; k++) {
        const n = i * nz + k;
        if (free[n] && distTo(r, f.x0 + (i + 0.5) * cell, f.z0 + (k + 0.5) * cell) < radius)
          free[n] = 0;
      }
  }
  const seen = new Uint8Array(nx * nz);
  const at = (x: number, z: number) =>
    [Math.floor((x - f.x0) / cell), Math.floor((z - f.z0) / cell)] as const;
  const [si, sk] = at(level.spawn.x, level.spawn.z);
  const todo: number[] = [];
  const push = (i: number, k: number) => {
    if (i < 0 || k < 0 || i >= nx || k >= nz) return;
    const n = i * nz + k;
    if (!free[n] || seen[n]) return;
    seen[n] = 1;
    todo.push(n);
  };
  push(si, sk);
  while (todo.length) {
    const n = todo.pop()!;
    const i = Math.floor(n / nz);
    const k = n % nz;
    push(i + 1, k);
    push(i - 1, k);
    push(i, k + 1);
    push(i, k - 1);
  }
  return (x, z) => {
    const [i, k] = at(x, z);
    return i >= 0 && k >= 0 && i < nx && k < nz && seen[i * nz + k] === 1;
  };
}

/** Whether some walkable ground lies within `r` of a point. */
export function reachable(
  walk: (x: number, z: number) => boolean,
  x: number,
  z: number,
  r: number,
): boolean {
  for (let dx = -r; dx <= r + 1e-9; dx += 0.2)
    for (let dz = -r; dz <= r + 1e-9; dz += 0.2)
      if (dx * dx + dz * dz <= r * r + 1e-9 && walk(x + dx, z + dz)) return true;
  return false;
}

/**
 * The dog's network: the candidate points that are clear of obstacles (and out of the water),
 * joined by straight clear walks of up to `maxLink` metres, keeping only what the start can
 * reach. Null if fewer than half the candidates make it.
 */
export function dogNetwork(
  level: Pick<LevelDef, 'boxes' | 'hideouts' | 'water'>,
  candidates: Vec3[],
  start: Vec3,
  treatJar: Vec3,
  maxLink = 7,
): DogDef {
  const solid = groundObstacles(level, 0.08);
  const clear = DOG_RADIUS + 0.12;
  const wet = (p: Vec3) => (level.water ?? []).some((w) => inRect(grow(w, 0.3), p.x, p.z));
  const points = candidates
    .map((p) => ({ x: tidy(p.x), y: 0, z: tidy(p.z) }))
    .filter((p) => !wet(p) && solid.every((r) => distTo(r, p.x, p.z) >= clear));
  const links: [number, number][] = [];
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i]!;
      const b = points[j]!;
      if (Math.hypot(a.x - b.x, a.z - b.z) > maxLink) continue;
      if (clearWalk(solid, a, b, clear)) links.push([i, j]);
    }
  // Keep the part the start can reach.
  let s = 0;
  let best = Infinity;
  points.forEach((p, i) => {
    const d = Math.hypot(p.x - start.x, p.z - start.z);
    if (d < best) {
      best = d;
      s = i;
    }
  });
  const seen = new Set([s]);
  const todo = [s];
  while (todo.length) {
    const p = todo.pop()!;
    for (const [a, b] of links)
      for (const [u, v] of [
        [a, b],
        [b, a],
      ] as const)
        if (u === p && !seen.has(v)) {
          seen.add(v);
          todo.push(v);
        }
  }
  const keep = [...seen].sort((a, b) => a - b);
  const index = new Map(keep.map((old, i) => [old, i]));
  return {
    points: keep.map((i) => points[i]!),
    links: links
      .filter(([a, b]) => index.has(a) && index.has(b))
      .map(([a, b]) => [index.get(a)!, index.get(b)!]),
    start: index.get(s)!,
    treatJar,
  };
}

/**
 * A picture of a level's ground as the dog sees it, half a metre to a character, for working
 * on a map: `#` blocked, `~` water, `.` clear, and `o` for the dog's points. Print it from a
 * test when a layout will not come out walkable.
 */
export function groundPicture(level: LevelDef, stepOver = 0.08, clear = DOG_RADIUS + 0.12): string {
  const solid = groundObstacles(level, stepOver);
  const half = level.floorSize / 2;
  const rows: string[] = [];
  for (let z = half - 0.25; z > -half; z -= 0.5) {
    let row = `${z.toFixed(2).padStart(6)}`;
    for (let x = -half + 0.25; x < half; x += 0.5) {
      if (level.dog.points.some((p) => Math.abs(p.x - x) < 0.25 && Math.abs(p.z - z) < 0.25))
        row += 'o';
      else if ((level.water ?? []).some((w) => inRect(w, x, z))) row += '~';
      else row += solid.some((r) => distTo(r, x, z) < clear) ? '#' : '.';
    }
    rows.push(row);
  }
  return rows.join('\n');
}

/** Candidate dog points on a grid over a rectangle. */
export function gridPoints(r: FloorRect, step: number, y = 0): Vec3[] {
  const out: Vec3[] = [];
  for (let x = r.x0 + step / 2; x < r.x1; x += step)
    for (let z = r.z0 + step / 2; z < r.z1; z += step) out.push({ x: tidy(x), y, z: tidy(z) });
  return out;
}

// ---------------------------------------------------------------- checks

/** How close a player has to get to something to use it. */
const USE = 1.2;
const MIN_SWING = 1.0;

/**
 * How much of the ground the dog could walk on (what its start can reach, at its own step
 * height) lies within a few metres of one of its points: 1 when its network takes it
 * everywhere, less when parts of the level are cut off from it.
 */
export function dogRoaming(level: LevelDef, within = 3.5): number {
  const f = floorRect(level);
  const start = level.dog.points[level.dog.start] ?? level.spawn;
  const walk = walkableGround(
    { ...level, spawn: { x: start.x, y: 0, z: start.z } },
    DOG_RADIUS + 0.12,
    0.08,
  );
  let ground = 0;
  let covered = 0;
  for (let x = f.x0 + 0.3; x < f.x1; x += 0.6)
    for (let z = f.z0 + 0.3; z < f.z1; z += 0.6) {
      if (!walk(x, z)) continue;
      if ((level.water ?? []).some((w) => inRect(w, x, z))) continue;
      ground++;
      if (level.dog.points.some((p) => Math.hypot(p.x - x, p.z - z) <= within)) covered++;
    }
  return ground ? covered / ground : 1;
}

/**
 * What is wrong with a level for play: too few places for pages or seats, hiding places that
 * cannot be reached or hardly open, page spots, the jar, the stations or the vacuum out of
 * reach, and a south fence missing for rival teams. Empty when it is fit to play.
 */
export function mapProblems(level: LevelDef): string[] {
  const problems: string[] = [];
  if (level.pageSpots.length + level.hideouts.length < 25)
    problems.push('too few places for pages');
  if (level.meetingSeats.length < 10) problems.push('too few meeting seats');
  const ids = level.hideouts.map((h) => h.id);
  if (new Set(ids).size !== ids.length) problems.push('hiding place ids repeat');
  const machineIds = level.machines.map((m) => m.id);
  if (new Set(machineIds).size !== machineIds.length) problems.push('machine ids repeat');
  const walk = walkableGround(level);
  const near = (p: { x: number; z: number }, r: number) => reachable(walk, p.x, p.z, r);
  for (const h of level.hideouts) {
    if (h.pos.y - h.size.y / 2 > 1.2) continue; // up on something: reached by climbing
    const name = `${h.kind} #${h.id}`;
    if ((hasDoor(h) || hasLid(h)) && openingIn(level, h) < MIN_SWING)
      problems.push(`${name} hardly opens`);
    if (!near(h.pos, USE + Math.max(h.size.x, h.size.z) / 2)) problems.push(`${name} out of reach`);
  }
  for (const p of level.pageSpots)
    if (p.y < 1.5 && !near(p, USE)) problems.push(`page spot ${p.x}, ${p.z} out of reach`);
  if (!near(level.dog.treatJar, USE)) problems.push('treat jar out of reach');
  for (const jar of level.dog.treatJars ?? [])
    if (!near(jar, USE)) problems.push('a treat jar out of reach');
  for (const m of level.machines)
    if (!near(machineFront(m), USE)) problems.push(`${m.kind} ${m.id} out of reach`);
  const site = {
    x: level.baseplate.x + BASEPLATE_SIZE / 2,
    z: level.baseplate.z + BASEPLATE_SIZE / 2,
  };
  if (!near(site, 2)) problems.push('job site out of reach');
  if (!near(level.inspector.pos, 2.5)) problems.push('inspector out of reach');
  if (!near(level.doneButton, USE)) problems.push('Done button out of reach');
  if (!near(level.bell, USE)) problems.push('bell out of reach');
  for (const b of [level.board, ...(level.moreBoards ?? [])])
    if (!near(b.pos, USE + 1)) problems.push(`corkboard at ${b.pos.x}, ${b.pos.z} out of reach`);
  if (!near(level.vacuum.pos, USE)) problems.push('vacuum out of reach');
  for (const b of level.boxes.filter(isTrashBin))
    if (b.pos.y - b.size.y / 2 < 0.3 && !near(b.pos, USE + Math.max(b.size.x, b.size.z) / 2))
      problems.push(`bin at ${b.pos.x}, ${b.pos.z} out of reach`);
  if (level.catapult && !near(level.catapult.pos, 2.5)) problems.push('catapult out of reach');
  for (const s of level.meetingSeats)
    if (!walk(s.x, s.z)) problems.push(`seat ${s.x}, ${s.z} not on the floor`);
  // The dog's network has to take it round most of the ground it could walk on.
  const roam = dogRoaming(level);
  if (roam < 0.75) problems.push(`the dog can roam only ${Math.round(roam * 100)}% of the ground`);
  for (const l of level.ladders)
    if (!near(l.pos, USE)) problems.push(`ladder at ${l.pos.x}, ${l.pos.z} out of reach`);
  // A map's south fence is where rival teams' yards meet (a doubled level has the wall instead).
  const half = level.floorSize / 2;
  if (
    !level.divide &&
    !level.boxes.some(
      (b) => !b.model && Math.abs(b.pos.z + half) < 0.5 && b.size.x >= level.floorSize - 1,
    )
  )
    problems.push('no south fence for rival teams');
  return problems;
}

// ---------------------------------------------------------------- intersections

/** A solid thing in a level, as the box it takes up, named for a report. */
interface Solid3 {
  name: string;
  pose: PartPose;
  /** A plain wall: walls meeting at a corner may overlap there. */
  wall: boolean;
  /** The hideout it is part of, if any (a hideout's own body and door never count). */
  hideout?: number;
  /** A drawer's tray sits inside its counter by design. */
  drawer?: boolean;
  /** A counter or desk (what a drawer sits in). */
  counter?: boolean;
}

const poseOf = (pos: Vec3, size: Vec3): PartPose => ({
  centre: pos,
  half: v3(size.x / 2, size.y / 2, size.z / 2),
  rot: IDENTITY,
});

/** Everything solid in a level, as boxes. */
function solids(level: LevelDef): Solid3[] {
  const out: Solid3[] = [];
  const at = (p: Vec3) => `${p.x}, ${p.y}, ${p.z}`;
  for (const b of level.boxes) {
    const wall = !b.model && !b.tiltX && b.size.y >= 2.4 && Math.min(b.size.x, b.size.z) <= 0.3;
    const tilt = b.tiltX ?? 0;
    out.push({
      name: `${b.model ?? 'box'} at ${at(b.pos)}`,
      pose: {
        ...poseOf(b.pos, b.size),
        rot: { x: Math.sin(tilt / 2), y: 0, z: 0, w: Math.cos(tilt / 2) },
      },
      wall,
      counter: b.model === 'counter',
    });
  }
  for (const h of level.hideouts) {
    const body = hideoutBody(h);
    const name = `${h.kind} #${h.id}`;
    if (body) out.push({ name, pose: inWorld(h, body), wall: false, hideout: h.id });
    out.push({
      name,
      pose: hideoutPartInWorld(h, false),
      wall: false,
      hideout: h.id,
      drawer: h.kind === 'drawer',
    });
  }
  for (const m of level.machines)
    out.push({ name: `${m.kind} ${m.id} at ${at(m.pos)}`, pose: machinePose(m), wall: false });
  out.push({
    name: 'corkboard',
    pose: { ...poseOf(level.board.pos, BOARD_SIZE), rot: yawQuat(level.board.facing) },
    wall: false,
  });
  for (const l of level.ladders)
    out.push({
      name: `ladder at ${at(l.pos)}`,
      pose: {
        centre: add(l.pos, v3(0, l.height / 2, 0)),
        half: v3(l.width / 2, l.height / 2, 0.03),
        rot: yawQuat(l.facing),
      },
      wall: false,
    });
  return out;
}

/**
 * Pairs of solid things in a level that run into each other (by more than a couple of
 * centimetres): a bin standing in a table, a pallet in a wall, a shutter buried inside the wall
 * it should fill. Walls meeting at a corner overlap there by design, as does a drawer's tray
 * in its counter and a hiding place's door on its body, so those are not reported. Empty when
 * nothing intersects.
 */
export function overlappingParts(level: LevelDef): string[] {
  const all = solids(level);
  const out: string[] = [];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]!;
      const b = all[j]!;
      if (a.wall && b.wall) continue;
      if (a.hideout !== undefined && a.hideout === b.hideout) continue;
      if ((a.drawer && b.counter) || (b.drawer && a.counter)) continue;
      if (boxesOverlap(a.pose, b.pose, 0.02)) out.push(`${a.name} runs into ${b.name}`);
    }
  return out;
}

// ---------------------------------------------------------------- climbing

/** A flat top a player can stand on. */
interface Top {
  rect: FloorRect;
  y: number;
}

/** How high a player gets up in one jump from a standing top, with a margin. */
const JUMP_UP = 0.55;
/** How wide a gap a player jumps between two tops, edge to edge. */
const JUMP_ACROSS = 0.5;

const gapBetween = (a: FloorRect, b: FloorRect): number =>
  Math.hypot(Math.max(a.x0 - b.x1, 0, b.x0 - a.x1), Math.max(a.z0 - b.z1, 0, b.z0 - a.z1));

/**
 * The page spots up high (too high to reach from the floor) that nobody could get to: a rack
 * top with no pallets leading up to it, a roof whose ladder is too short. Works from the tops
 * of boxes: a player gets from one top to another that is no more than a jump higher, across
 * a gap no wider than a hop, and up a ladder onto the tops about its own height.
 */
export function unreachableHighSpots(level: LevelDef): Vec3[] {
  const tops: Top[] = level.boxes
    .filter((b) => !b.tiltX && b.size.x >= 0.3 && b.size.z >= 0.3 && b.model !== 'collider')
    .map((b) => ({
      rect: rect(
        b.pos.x - b.size.x / 2,
        b.pos.z - b.size.z / 2,
        b.pos.x + b.size.x / 2,
        b.pos.z + b.size.z / 2,
      ),
      y: b.pos.y + b.size.y / 2,
    }));
  const got = new Set<number>();
  const todo: number[] = [];
  const reach = (i: number) => {
    if (got.has(i)) return;
    got.add(i);
    todo.push(i);
  };
  tops.forEach((t, i) => {
    if (t.y <= JUMP_UP) reach(i);
  });
  for (const l of level.ladders)
    tops.forEach((t, i) => {
      const foot = rect(l.pos.x, l.pos.z, l.pos.x, l.pos.z);
      if (t.y >= l.height - 1.2 && t.y <= l.height - 0.6 && gapBetween(t.rect, foot) < 1.1)
        reach(i);
    });
  while (todo.length) {
    const a = tops[todo.pop()!]!;
    tops.forEach((b, j) => {
      if (got.has(j) || b.y > a.y + JUMP_UP || gapBetween(a.rect, b.rect) > JUMP_ACROSS) return;
      reach(j);
    });
  }
  return level.pageSpots.filter(
    (p) =>
      p.y >= 1.5 &&
      !tops.some(
        (t, i) => got.has(i) && Math.abs(t.y - p.y) < 0.2 && inRect(grow(t.rect, 0.05), p.x, p.z),
      ),
  );
}
