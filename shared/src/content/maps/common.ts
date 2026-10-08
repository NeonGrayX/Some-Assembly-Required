import { makeRng } from '../../math.ts';
import type { Vec3 } from '../../math.ts';
import { DOG_RADIUS } from '../../sim/dog.ts';
import { BIN_SIZE, BOARD_SIZE, HOUSE, floorRect } from '../house.ts';
import type {
  BinDef,
  BoxDef,
  DecalDef,
  DogDef,
  FloorRect,
  HideoutDef,
  HideoutKind,
  LevelDef,
} from '../house.ts';
import {
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
export const WALL_T = 0.2;

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

/** The four fences round a square yard, as the house has them (the south one is the rival line). */
export function fences(half = 16, colour = FENCE): BoxDef[] {
  const t = 0.3;
  const len = half * 2;
  // The north and south fences run the whole width; the east and west ones fit between them.
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
 * them only (`skip` it in the other), and `butt` that side in the other room too, so its own
 * walls stop at the shared wall's face instead of running on into it.
 */
export function roomWalls(
  r: FloorRect,
  h: number,
  colour: number,
  gaps: Gap[] = [],
  opts: { y0?: number; skip?: Gap['side'][]; butt?: Gap['side'][] } = {},
): BoxDef[] {
  const y0 = opts.y0 ?? 0;
  const out: BoxDef[] = [];
  const t = WALL_T;
  const butt = (side: Gap['side']) => (opts.butt?.includes(side) ? t / 2 : -t / 2);
  for (const side of ['n', 's', 'e', 'w'] as const) {
    if (opts.skip?.includes(side)) continue;
    const alongX = side === 'n' || side === 's';
    const line = side === 'n' ? r.z1 : side === 's' ? r.z0 : side === 'e' ? r.x1 : r.x0;
    // Walls along x run round the corners (so the ends butt against them), unless butted.
    const [from, to] = alongX ? [r.x0 + butt('w'), r.x1 - butt('e')] : [r.z0 + t / 2, r.z1 - t / 2];
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

/** A room's floor: the decal the renderers and the dog read the room from. */
export function floorOf(r: FloorRect, colour: number, y = 0): DecalDef {
  const c = centre(r);
  return { pos: { x: c.x, y, z: c.z }, size: { x: r.x1 - r.x0, z: r.z1 - r.z0 }, colour };
}

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
  const x = counter.pos.x + out.x * (depth / 2 - 0.05) + right.x * along;
  const z = counter.pos.z + out.z * (depth / 2 - 0.05) + right.z * along;
  return {
    id,
    kind: 'drawer',
    pos: { x: tidy(x), y: tidy(counter.pos.y - counter.size.y / 2 + height), z: tidy(z) },
    size: HIDEOUT_SIZE.drawer,
    facing,
  };
}

// ---------------------------------------------------------------- bins

/** A straight run with bins on it, from one point to another, every `every` metres. */
export interface BinRun {
  from: { x: number; z: number };
  to: { x: number; z: number };
  every?: number;
}

/**
 * The house's bins (every brick type and colour the builds use), laid along `runs` in order,
 * and whatever does not fit on them at `spare` spots. Ids follow the house's.
 */
export function binsAlong(runs: BinRun[], spare: { x: number; z: number }[] = []): BinDef[] {
  const spots: { x: number; z: number }[] = [];
  for (const r of runs) {
    const every = r.every ?? BIN_SIZE.x + 0.4;
    const len = Math.hypot(r.to.x - r.from.x, r.to.z - r.from.z);
    const n = Math.max(1, Math.floor(len / every + 1e-6) + 1);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      spots.push({
        x: tidy(r.from.x + (r.to.x - r.from.x) * t),
        z: tidy(r.from.z + (r.to.z - r.from.z) * t),
      });
    }
  }
  spots.push(...spare);
  if (spots.length < HOUSE.bins.length)
    throw new Error(`only ${spots.length} bin spots for ${HOUSE.bins.length} bins`);
  return HOUSE.bins.map((b, i) => ({
    id: b.id,
    type: b.type,
    colour: b.colour,
    pos: { x: spots[i]!.x, y: 0, z: spots[i]!.z },
  }));
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
    Pick<LevelDef, 'bins' | 'baseplate' | 'doneButton' | 'bell' | 'board' | 'catapult' | 'sites'>
  >;

/**
 * The footprints on the ground floor a player or the dog cannot walk through: boxes at body
 * height, hiding places, bins, the job sites' plates, buttons and boards, and the catapult.
 * `stepOver` is how high a thing may be and still be walked over: a player's step, or the
 * dog's much lower one.
 */
export function groundObstacles(level: Solid, stepOver = 0.3): FloorRect[] {
  const out: FloorRect[] = [];
  for (const b of level.boxes) {
    const bottom = b.pos.y - b.size.y / 2;
    const top = b.pos.y + b.size.y / 2;
    // Low enough to step onto, or high enough to walk under: not in the way.
    if (b.tiltX || bottom > 1.2 || top <= stepOver) continue;
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
    if (h.kind === 'rug' || isSoft(h) || h.pos.y - h.size.y / 2 > 1.2) continue;
    out.push(turned(h.pos.x, h.pos.z, h.size.x, h.size.z, h.facing));
  }
  for (const b of level.bins ?? []) out.push(turned(b.pos.x, b.pos.z, BIN_SIZE.x, BIN_SIZE.z, 0));
  const sites = [
    ...(level.baseplate && level.doneButton && level.bell && level.board
      ? [
          {
            baseplate: level.baseplate,
            doneButton: level.doneButton,
            bell: level.bell,
            board: level.board,
          },
        ]
      : []),
    ...(level.sites ?? []),
  ];
  for (const st of sites) {
    out.push(rect(st.baseplate.x, st.baseplate.z, st.baseplate.x + 1.6, st.baseplate.z + 1.6));
    for (const b of [st.doneButton, st.bell]) out.push(turned(b.x, b.z, 0.4, 0.4, 0));
    out.push(turned(st.board.pos.x, st.board.pos.z, 1.7, 0.3, st.board.facing));
  }
  if (level.catapult) {
    const c = level.catapult;
    const mid = { x: -Math.sin(c.facing) * 0.6, z: -Math.cos(c.facing) * 0.6 };
    out.push(turned(c.pos.x + mid.x, c.pos.z + mid.z, 1.2, 3.6, c.facing));
  }
  return out;
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
  const free = new Uint8Array(nx * nz);
  for (let i = 0; i < nx; i++)
    for (let k = 0; k < nz; k++) {
      const x = f.x0 + (i + 0.5) * cell;
      const z = f.z0 + (k + 0.5) * cell;
      free[i * nz + k] = solid.every((r) => distTo(r, x, z) >= radius) ? 1 : 0;
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
 * cannot be reached or hardly open, page spots, the jar, the stations or the broom out of
 * reach, and a south fence missing for rival teams. Empty when it is fit to play.
 */
export function mapProblems(level: LevelDef): string[] {
  const problems: string[] = [];
  if (level.pageSpots.length + level.hideouts.length < 25)
    problems.push('too few places for pages');
  if (level.meetingSeats.length < 10) problems.push('too few meeting seats');
  const ids = level.hideouts.map((h) => h.id);
  if (new Set(ids).size !== ids.length) problems.push('hiding place ids repeat');
  const binIds = level.bins.map((b) => b.id);
  if (new Set(binIds).size !== binIds.length) problems.push('bin ids repeat');
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
  for (const b of level.bins)
    if (!near(b.pos, USE + BIN_SIZE.x / 2)) problems.push(`bin ${b.id} out of reach`);
  const site = { x: level.baseplate.x + 0.8, z: level.baseplate.z + 0.8 };
  if (!near(site, 2)) problems.push('job site out of reach');
  if (!near(level.inspector.pos, 2.5)) problems.push('inspector out of reach');
  if (!near(level.doneButton, USE)) problems.push('Done button out of reach');
  if (!near(level.bell, USE)) problems.push('bell out of reach');
  if (!near(level.board.pos, USE + 1)) problems.push('corkboard out of reach');
  if (!near(level.broom.pos, USE)) problems.push('broom out of reach');
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
    out.push({
      name: `${b.model ?? 'box'} at ${at(b.pos)}`,
      pose: { ...poseOf(b.pos, b.size), rot: yawQuat(0) },
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
  for (const b of level.bins)
    out.push({
      name: `bin ${b.id} at ${at(b.pos)}`,
      pose: poseOf(add(b.pos, v3(0, BIN_SIZE.y / 2, 0)), BIN_SIZE),
      wall: false,
    });
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
