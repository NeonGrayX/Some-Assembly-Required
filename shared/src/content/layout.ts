import { makeRng, v3 } from '../math.ts';
import type { Vec3 } from '../math.ts';
import { PLAYER_RADIUS } from '../sim/sim.ts';
import { DOG_RADIUS } from '../sim/dog.ts';
import { dropSpot, hasDoor, hasLid, openingIn } from './hideouts.ts';
import { HOUSE } from './house.ts';
import type { BoxDef, DogDef, HideoutDef, LevelDef } from './house.ts';

/**
 * Furnishes the house differently for every round. The walls, doorways, windows, lamps and the
 * whole yard stay as they are; each room's furniture (and the hiding places and page spots that
 * come with it) is moved to a new spot in the same room, picked from a seed. The server sends
 * only the seed, so every client builds the same house from it.
 *
 * The furniture itself is the hand-made house's: each piece is cut out of `HOUSE` with
 * everything standing on it or in it, so changing the house changes the pieces too.
 */

/** An axis-aligned rectangle on the floor. */
export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Quarter turns about the vertical, 0 to 3. A piece turned by `t` has its front facing `FACING[t]`. */
type Turn = number;
const FACING = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
/** Fronts of boxes by quarter turn, matching `FACING`: heading 0 faces -z, π/2 faces -x. */
const FRONTS = ['-z', '-x', '+z', '+x'] as const;

/** The rooms, as the floor inside their walls. */
export const ROOMS: Rect[] = HOUSE.decals.map((d) => ({
  x0: d.pos.x - d.size.x / 2,
  x1: d.pos.x + d.size.x / 2,
  z0: d.pos.z - d.size.z / 2,
  z1: d.pos.z + d.size.z / 2,
}));

/**
 * Floor kept clear of furniture so nobody's way is blocked: in front of the front door and
 * both sides of each inner doorway. Rugs may lie here; nothing else.
 */
export const DOORWAY_CLEARANCE: Rect[] = [
  { x0: -1.4, x1: 1.4, z0: 6.1, z1: 7.6 },
  { x0: -5.6, x1: -4.1, z0: 8.6, z1: 11.4 },
  { x0: -3.9, x1: -2.4, z0: 8.6, z1: 11.4 },
  { x0: 2.4, x1: 3.9, z0: 8.6, z1: 11.4 },
  { x0: 4.1, x1: 5.6, z0: 8.6, z1: 11.4 },
];

/** Windows: a point on the middle of their wall, and whether that wall runs along x. */
export const WINDOWS = [
  { x: -8, z: 6, alongX: true },
  { x: 7.5, z: 6, alongX: true },
  { x: -8, z: 15, alongX: true },
  { x: 0, z: 15, alongX: true },
  { x: 8, z: 15, alongX: true },
  { x: -12, z: 10, alongX: false },
  { x: 12, z: 9.5, alongX: false },
];
/** Half a window's width, plus a little frame: tall furniture keeps out of this much wall. */
const WINDOW_HALF = 0.8;
/** Furniture taller than this would stand in front of a window. */
const BELOW_SILL = 1.2;

/** How a piece of furniture may be placed. */
type Placing = 'wall' | 'free' | 'rug';

interface PieceSpec {
  room: number;
  /** Where it stands in `HOUSE`: everything below the roof centred inside belongs to it. */
  from: Rect;
  /** Which way its front faces in `HOUSE`. */
  turn: Turn;
  place: Placing;
}

/** In the order they are placed: the biggest first, rugs last. */
const PIECES: PieceSpec[] = [
  // Break room: the meeting table with its seats, the lockers, a rug.
  { room: 2, from: { x0: 5.8, x1: 10.2, z0: 8.9, z1: 12.1 }, turn: 0, place: 'free' },
  { room: 2, from: { x0: 11.1, x1: 11.95, z0: 12.1, z1: 14.1 }, turn: 1, place: 'wall' },
  { room: 2, from: { x0: 5.3, x1: 6.7, z0: 7, z1: 8 }, turn: 0, place: 'rug' },
  // Kitchen: counter with its drawers and the treat jar, fridge, table, rug.
  { room: 0, from: { x0: -9.7, x1: -6.3, z0: 14.1, z1: 14.95 }, turn: 0, place: 'wall' },
  { room: 0, from: { x0: -11.95, x1: -11, z0: 13.3, z1: 14.3 }, turn: 3, place: 'wall' },
  { room: 0, from: { x0: -8.9, x1: -7.1, z0: 8.9, z1: 10.1 }, turn: 0, place: 'free' },
  { room: 0, from: { x0: -7, x1: -5.4, z0: 7.4, z1: 8.6 }, turn: 0, place: 'rug' },
  // Living room: sofa with its cushion, TV cabinet, bookshelf, rug.
  { room: 1, from: { x0: -1.6, x1: 1.6, z0: 13.7, z1: 14.95 }, turn: 0, place: 'wall' },
  { room: 1, from: { x0: -3.8, x1: -2.4, z0: 14.2, z1: 14.95 }, turn: 0, place: 'wall' },
  { room: 1, from: { x0: 2.6, x1: 3.8, z0: 14.3, z1: 14.95 }, turn: 0, place: 'wall' },
  { room: 1, from: { x0: -1.4, x1: 1.4, z0: 9, z1: 11 }, turn: 0, place: 'rug' },
];

/** Dog points inside the house that are made anew for each layout (the rest stay). */
const DOG_INDOORS = (p: Vec3) =>
  ROOMS.some((r) => inRect(r, p.x, p.z)) && !DOORWAY_CLEARANCE.some((r) => inRect(r, p.x, p.z));
/** New dog points per room. */
const DOG_POINTS_PER_ROOM = [3, 2, 4];

/** Gap left between furniture and the wall behind it. */
const WALL_GAP = 0.02;
/** Room to stand in front of a piece and open what it holds. */
const ACCESS_DEPTH = 0.9;
/** Room to walk around a table. */
const AROUND_FREE = 0.8;
/** Doors and lids must open at least this far (radians) to see inside. */
export const MIN_SWING = 1.2;
/** Positions are snapped to this, so layouts stay tidy. */
const SNAP = 0.05;

// ---------------------------------------------------------------- geometry

const inRect = (r: Rect, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

const overlaps = (a: Rect, b: Rect, margin = 0) =>
  a.x0 < b.x1 + margin && b.x0 < a.x1 + margin && a.z0 < b.z1 + margin && b.z0 < a.z1 + margin;

const inside = (inner: Rect, outer: Rect) =>
  inner.x0 >= outer.x0 - 1e-9 &&
  inner.x1 <= outer.x1 + 1e-9 &&
  inner.z0 >= outer.z0 - 1e-9 &&
  inner.z1 <= outer.z1 + 1e-9;

const grow = (r: Rect, by: number): Rect => ({
  x0: r.x0 - by,
  x1: r.x1 + by,
  z0: r.z0 - by,
  z1: r.z1 + by,
});

/** Distance from a point to a rectangle (0 inside it). */
const distTo = (r: Rect, x: number, z: number) =>
  Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

/** Turns a flat offset by `t` quarter turns, the way `yawQuat(FACING[t])` turns it. */
function turn(t: Turn, x: number, z: number): { x: number; z: number } {
  switch (((t % 4) + 4) % 4) {
    case 1:
      return { x: z, z: -x };
    case 2:
      return { x: -x, z: -z };
    case 3:
      return { x: -z, z: x };
    default:
      return { x, z };
  }
}

const turnOf = (facing: number) => ((Math.round(facing / (Math.PI / 2)) % 4) + 4) % 4;

/** A rectangle of half size `hx` × `hz` centred at `x`, `z`, turned by `t`. */
function rectAt(x: number, z: number, hx: number, hz: number, t: Turn): Rect {
  const [ax, az] = t % 2 ? [hz, hx] : [hx, hz];
  return { x0: x - ax, x1: x + ax, z0: z - az, z1: z + az };
}

// ---------------------------------------------------------------- pieces

/** A piece of furniture in its own frame: centred on its footprint, front facing -z. */
interface Piece {
  spec: PieceSpec;
  boxes: BoxDef[];
  hideouts: HideoutDef[];
  pageSpots: Vec3[];
  seats: Vec3[];
  treatJar: Vec3 | null;
  /** Half the footprint's width (x) and depth (z). */
  hx: number;
  hz: number;
  /** Height of its tallest part. */
  top: number;
}

/** Moves a point from `HOUSE` into the frame of a piece centred at `cx`, `cz` and turned by `t`. */
const toLocal = (p: Vec3, cx: number, cz: number, t: Turn): Vec3 => {
  const f = turn(-t, p.x - cx, p.z - cz);
  return v3(f.x, p.y, f.z);
};

function cutPiece(spec: PieceSpec): Piece {
  const { from } = spec;
  const has = (p: Vec3) => p.y < 2.5 && inRect(from, p.x, p.z);
  const boxes = HOUSE.boxes.filter((b) => b.model && has(b.pos));
  const hideouts = HOUSE.hideouts.filter((h) => has(h.pos));
  const pageSpots = HOUSE.pageSpots.filter(has);
  const seats = HOUSE.meetingSeats.filter(has);
  const jar = has(HOUSE.dog.treatJar) ? HOUSE.dog.treatJar : null;
  // The footprint: every box and hiding place, turned so the piece's front faces -z.
  const t = spec.turn;
  const rects = [
    ...boxes.map((b) => rectAt(b.pos.x, b.pos.z, b.size.x / 2, b.size.z / 2, 0)),
    ...hideouts.map((h) => rectAt(h.pos.x, h.pos.z, h.size.x / 2, h.size.z / 2, turnOf(h.facing))),
  ];
  if (!rects.length) throw new Error('A piece of furniture with nothing in it');
  const r: Rect = {
    x0: Math.min(...rects.map((q) => q.x0)),
    x1: Math.max(...rects.map((q) => q.x1)),
    z0: Math.min(...rects.map((q) => q.z0)),
    z1: Math.max(...rects.map((q) => q.z1)),
  };
  const top = Math.max(
    ...boxes.map((b) => b.pos.y + b.size.y / 2),
    ...hideouts.map((h) => h.pos.y + h.size.y / 2),
  );
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  const half = turn(-t, (r.x1 - r.x0) / 2, (r.z1 - r.z0) / 2);
  return {
    spec,
    boxes: boxes.map((b) => {
      const front = (FRONTS.indexOf(b.front ?? '-z') - t + 4) % 4;
      const size = t % 2 ? v3(b.size.z, b.size.y, b.size.x) : b.size;
      return { ...b, pos: toLocal(b.pos, cx, cz, t), size, front: FRONTS[front] };
    }),
    hideouts: hideouts.map((h) => ({
      ...h,
      pos: toLocal(h.pos, cx, cz, t),
      facing: FACING[(turnOf(h.facing) - t + 4) % 4]!,
    })),
    pageSpots: pageSpots.map((p) => toLocal(p, cx, cz, t)),
    seats: seats.map((p) => toLocal(p, cx, cz, t)),
    treatJar: jar && toLocal(jar, cx, cz, t),
    hx: Math.abs(half.x),
    hz: Math.abs(half.z),
    top,
  };
}

let pieces: Piece[] | null = null;
const allPieces = () => (pieces ??= PIECES.map(cutPiece));

/** A piece put somewhere in a room. */
interface Placed {
  piece: Piece;
  x: number;
  z: number;
  t: Turn;
  /** What it stands on: nothing else may overlap it. */
  solid: Rect;
  /** Floor kept clear in front of it (or around it) to reach it and open what it holds. */
  access: Rect;
}

function place(piece: Piece, x: number, z: number, t: Turn): Placed {
  const solid = rectAt(x, z, piece.hx, piece.hz, t);
  let access: Rect;
  if (piece.spec.place === 'rug') access = solid;
  else if (piece.spec.place === 'free') {
    access = grow(solid, AROUND_FREE);
    // Seats need room for whoever stands on them too.
    for (const s of piece.seats) {
      const w = turn(t, s.x, s.z);
      const seat = grow(
        { x0: x + w.x, x1: x + w.x, z0: z + w.z, z1: z + w.z },
        PLAYER_RADIUS + 0.2,
      );
      access = {
        x0: Math.min(access.x0, seat.x0),
        x1: Math.max(access.x1, seat.x1),
        z0: Math.min(access.z0, seat.z0),
        z1: Math.max(access.z1, seat.z1),
      };
    }
  } else {
    // A strip in front, as wide as the piece.
    const c = turn(t, 0, -piece.hz - ACCESS_DEPTH / 2);
    access = rectAt(x + c.x, z + c.z, piece.hx, ACCESS_DEPTH / 2, t);
  }
  return { piece, x, z, t, solid, access };
}

/** Whether `p` can go in `room` next to what is already there. */
function fits(p: Placed, room: Rect, others: Placed[]): boolean {
  const kind = p.piece.spec.place;
  if (!inside(p.solid, room)) return false;
  if (kind === 'rug') {
    if (!inside(grow(p.solid, 0.15), room)) return false;
    return others.every((o) => !overlaps(p.solid, o.solid, 0.05));
  }
  if (!inside(p.access, room)) return false;
  if (DOORWAY_CLEARANCE.some((d) => overlaps(p.solid, d))) return false;
  for (const o of others) {
    if (overlaps(p.solid, o.solid, 0.05)) return false;
    if (o.piece.spec.place === 'rug') continue;
    if (overlaps(p.solid, o.access) || overlaps(p.access, o.solid)) return false;
  }
  if (kind === 'wall' && p.piece.top > BELOW_SILL) {
    for (const w of WINDOWS) {
      const span = w.alongX
        ? { x0: w.x - WINDOW_HALF, x1: w.x + WINDOW_HALF, z0: w.z - 0.3, z1: w.z + 0.3 }
        : { x0: w.x - 0.3, x1: w.x + 0.3, z0: w.z - WINDOW_HALF, z1: w.z + WINDOW_HALF };
      if (overlaps(p.solid, span)) return false;
    }
  }
  return true;
}

const snap = (x: number) => Math.round(x / SNAP) * SNAP;

/** A random spot for a piece in a room: against one of its walls, or anywhere for the rest. */
function candidate(piece: Piece, room: Rect, rng: () => number): Placed {
  const along = (lo: number, hi: number) => snap(lo + (hi - lo) * rng());
  if (piece.spec.place === 'wall') {
    const t = Math.floor(rng() * 4);
    const { hx, hz } = piece;
    const back = hz + WALL_GAP;
    // The wall behind a piece turned by `t`: its front faces into the room.
    if (t === 0) return place(piece, along(room.x0 + hx, room.x1 - hx), room.z1 - back, t);
    if (t === 2) return place(piece, along(room.x0 + hx, room.x1 - hx), room.z0 + back, t);
    if (t === 1) return place(piece, room.x1 - back, along(room.z0 + hx, room.z1 - hx), t);
    return place(piece, room.x0 + back, along(room.z0 + hx, room.z1 - hx), t);
  }
  const t = Math.floor(rng() * 4);
  const [ax, az] = t % 2 ? [piece.hz, piece.hx] : [piece.hx, piece.hz];
  return place(piece, along(room.x0 + ax, room.x1 - ax), along(room.z0 + az, room.z1 - az), t);
}

// ---------------------------------------------------------------- the level

/** Moves a piece's contents into the house where it was placed. */
function furnish(level: LevelDef, p: Placed): void {
  const { piece, x, z, t } = p;
  const at = (q: Vec3) => {
    const w = turn(t, q.x, q.z);
    return v3(snapTiny(x + w.x), q.y, snapTiny(z + w.z));
  };
  for (const b of piece.boxes) {
    const front = FRONTS[(FRONTS.indexOf(b.front ?? '-z') + t) % 4];
    const size = t % 2 ? v3(b.size.z, b.size.y, b.size.x) : b.size;
    level.boxes.push({ ...b, pos: at(b.pos), size, front });
  }
  for (const h of piece.hideouts) {
    level.hideouts.push({ ...h, pos: at(h.pos), facing: FACING[(turnOf(h.facing) + t) % 4]! });
  }
  level.pageSpots.push(...piece.pageSpots.map(at));
  level.meetingSeats.push(...piece.seats.map(at));
  if (piece.treatJar) level.dog.treatJar = at(piece.treatJar);
}

/** Rounds away float dust (−0.30000000000000004), so layouts print and compare cleanly. */
const snapTiny = (x: number) => Math.round(x * 1e6) / 1e6;

/** Everything solid on the floor of the house: walls and furniture, as rectangles. */
function obstacles(level: LevelDef): Rect[] {
  const rects: Rect[] = [];
  for (const b of level.boxes) {
    if (b.tiltX || b.pos.y - b.size.y / 2 > 1) continue;
    rects.push(rectAt(b.pos.x, b.pos.z, b.size.x / 2, b.size.z / 2, 0));
  }
  for (const h of level.hideouts) {
    if (h.kind === 'rug' || h.kind === 'cushion') continue;
    rects.push(rectAt(h.pos.x, h.pos.z, h.size.x / 2, h.size.z / 2, turnOf(h.facing)));
  }
  return rects;
}

/** The floor of the house and the step outside the front door, on a grid. */
const GRID = { x0: -12, z0: 4.5, cell: 0.1, nx: 240, nz: 105 };

/**
 * Where a player can walk to from outside the front door, as a grid over the house: a cell is
 * walkable if a player standing on it touches nothing.
 */
export function walkable(level: LevelDef): (x: number, z: number) => boolean {
  const { x0, z0, cell, nx, nz } = GRID;
  const solid = obstacles(level).filter((r) =>
    overlaps(r, { x0, x1: x0 + nx * cell, z0, z1: z0 + nz * cell }, 1),
  );
  const free = new Uint8Array(nx * nz);
  const reached = new Uint8Array(nx * nz);
  for (let i = 0; i < nx; i++)
    for (let k = 0; k < nz; k++) {
      const x = x0 + (i + 0.5) * cell;
      const z = z0 + (k + 0.5) * cell;
      // With room to spare for anywhere in the cell, not just its middle.
      free[i + k * nx] = solid.every((r) => distTo(r, x, z) > PLAYER_RADIUS + 0.08) ? 1 : 0;
    }
  const start = Math.floor((0 - x0) / cell) + Math.floor((5 - z0) / cell) * nx;
  const queue = [start];
  reached[start] = 1;
  while (queue.length) {
    const c = queue.pop()!;
    const i = c % nx;
    const k = (c - i) / nx;
    for (const [di, dk] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const ni = i + di;
      const nk = k + dk;
      if (ni < 0 || nk < 0 || ni >= nx || nk >= nz) continue;
      const n = ni + nk * nx;
      if (free[n] && !reached[n]) {
        reached[n] = 1;
        queue.push(n);
      }
    }
  }
  return (x, z) => {
    const i = Math.floor((x - x0) / cell);
    const k = Math.floor((z - z0) / cell);
    return i >= 0 && k >= 0 && i < nx && k < nz && reached[i + k * nx] === 1;
  };
}

/** Whether a walkable spot lies within `r` of `x`, `z`. */
export function reachableNear(
  walk: (x: number, z: number) => boolean,
  x: number,
  z: number,
  r: number,
): boolean {
  for (let dx = -r; dx <= r + 1e-9; dx += GRID.cell)
    for (let dz = -r; dz <= r + 1e-9; dz += GRID.cell)
      if (dx * dx + dz * dz <= r * r && walk(x + dx, z + dz)) return true;
  return false;
}

/** How close a player has to get to something to use it (well inside their reach). */
export const USE_DISTANCE = 1.2;

/**
 * Whether every hiding place opens far enough and can be reached, along with what comes out
 * of it, every page spot and the treat jar, and every doorway can be walked through.
 */
export function layoutProblems(level: LevelDef): string[] {
  const walk = walkable(level);
  const problems: string[] = [];
  for (const [x, z] of [
    [0, 7],
    [-3, 10],
    [-5, 10],
    [3, 10],
    [5, 10],
  ] as const)
    if (!walk(x, z)) problems.push(`doorway at ${x}, ${z}`);
  const indoors = (p: Vec3) => ROOMS.some((r) => inRect(r, p.x, p.z));
  for (const h of level.hideouts.filter((h) => indoors(h.pos))) {
    const name = `${h.kind} #${h.id}`;
    if ((hasDoor(h) || hasLid(h)) && openingIn(level, h) < MIN_SWING)
      problems.push(`${name} opening`);
    if (!reachableNear(walk, h.pos.x, h.pos.z, USE_DISTANCE + Math.max(h.size.x, h.size.z) / 2))
      problems.push(`${name} out of reach`);
    const drop = dropSpot(level, h);
    if (!reachableNear(walk, drop.x, drop.z, USE_DISTANCE)) problems.push(`${name} drop spot`);
  }
  for (const p of level.pageSpots)
    if (p.y < 2.5 && indoors(p) && !reachableNear(walk, p.x, p.z, USE_DISTANCE))
      problems.push(`page spot ${p.x}, ${p.z}`);
  const jar = level.dog.treatJar;
  if (!reachableNear(walk, jar.x, jar.z, USE_DISTANCE)) problems.push('treat jar');
  return problems;
}

/** Whether the dog fits through a straight walk from `a` to `b`. */
function clearWalk(solid: Rect[], a: Vec3, b: Vec3): boolean {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05);
  for (let i = 0; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps;
    const z = a.z + ((b.z - a.z) * i) / steps;
    if (solid.some((r) => distTo(r, x, z) < DOG_RADIUS + 0.08)) return false;
  }
  return true;
}

/**
 * The dog's points and walks for a layout: those outside the rooms stay as they are, and each
 * room gets new points spread out over its free floor, each joined to the rest by clear walks.
 */
function dogPaths(level: LevelDef): DogDef | null {
  const old = HOUSE.dog;
  const kept = old.points.map((p, i) => ({ p, i })).filter(({ p }) => !DOG_INDOORS(p));
  const index = new Map(kept.map(({ i }, n) => [i, n]));
  const points = kept.map(({ p }) => p);
  const links: [number, number][] = old.links.flatMap(([a, b]) =>
    index.has(a) && index.has(b) ? [[index.get(a)!, index.get(b)!] as [number, number]] : [],
  );
  const solid = obstacles(level);
  // The walks kept from the hand-made house must still be clear past the moved furniture.
  const indoors = (p: Vec3) => ROOMS.some((r) => inRect(r, p.x, p.z));
  for (const [a, b] of links) {
    const [p, q] = [points[a]!, points[b]!];
    if ((indoors(p) || indoors(q)) && !clearWalk(solid, p, q)) return null;
  }
  let start = -1;
  for (const [r, room] of ROOMS.entries()) {
    const mine = points.flatMap((p, i) => (inRect(room, p.x, p.z) ? [i] : []));
    const free: Vec3[] = [];
    for (let x = room.x0 + 0.5; x < room.x1 - 0.4; x += 0.5)
      for (let z = room.z0 + 0.5; z < room.z1 - 0.4; z += 0.5) {
        const p = v3(snapTiny(x), 0, snapTiny(z));
        if (solid.every((s) => distTo(s, p.x, p.z) > DOG_RADIUS + 0.15)) free.push(p);
      }
    for (let n = 0; n < DOG_POINTS_PER_ROOM[r]!; n++) {
      // The free spot farthest from every point so far that a clear walk joins to one.
      let best: Vec3 | null = null;
      let bestDist = 0.8;
      for (const p of free) {
        const d = Math.min(...mine.map((i) => Math.hypot(points[i]!.x - p.x, points[i]!.z - p.z)));
        if (d > bestDist && mine.some((i) => clearWalk(solid, points[i]!, p))) {
          best = p;
          bestDist = d;
        }
      }
      if (!best) break;
      const at = points.push(best) - 1;
      // Joined to every point in the room it can walk straight to, nearest first, up to three.
      const near = mine
        .filter((i) => clearWalk(solid, points[i]!, best))
        .sort(
          (a, b) =>
            Math.hypot(points[a]!.x - best.x, points[a]!.z - best.z) -
            Math.hypot(points[b]!.x - best.x, points[b]!.z - best.z),
        )
        .slice(0, 3);
      for (const i of near) links.push([i, at]);
      mine.push(at);
      if (r === 1 && start < 0) start = at;
    }
  }
  if (start < 0) return null;
  return { points, links, start, treatJar: level.dog.treatJar };
}

/** Layouts are built once per seed and shared (the server and solo play ask for the same one). */
const layouts = new Map<number, LevelDef>();

/**
 * The house furnished for `seed`. The same seed gives the same house everywhere. If no layout
 * that keeps everything reachable turns up (it always does in practice), it is the hand-made
 * house.
 */
export function houseLayout(seed: number): LevelDef {
  seed >>>= 0;
  const cached = layouts.get(seed);
  if (cached) return cached;
  const level = makeLayout(seed) ?? HOUSE;
  if (layouts.size > 16) layouts.delete(layouts.keys().next().value!);
  layouts.set(seed, level);
  return level;
}

function makeLayout(seed: number): LevelDef | null {
  const rng = makeRng(seed ^ 0x1a7047);
  for (let attempt = 0; attempt < 40; attempt++) {
    const placed = placeAll(rng);
    if (!placed) continue;
    const inPiece = (p: Vec3) => PIECES.some((s) => p.y < 2.5 && inRect(s.from, p.x, p.z));
    const level: LevelDef = {
      ...HOUSE,
      boxes: HOUSE.boxes.filter((b) => !(b.model && inPiece(b.pos))),
      hideouts: HOUSE.hideouts.filter((h) => !inPiece(h.pos)),
      pageSpots: HOUSE.pageSpots.filter((p) => !inPiece(p)),
      meetingSeats: HOUSE.meetingSeats.filter((p) => !inPiece(p)),
      dog: { ...HOUSE.dog },
    };
    for (const p of placed) furnish(level, p);
    level.hideouts.sort((a, b) => a.id - b.id);
    if (layoutProblems(level).length) continue;
    const dog = dogPaths(level);
    if (!dog) continue;
    level.dog = dog;
    return level;
  }
  return null;
}

/** Places every piece in its room, or gives up if one finds no spot. */
function placeAll(rng: () => number): Placed[] | null {
  const placed: Placed[] = [];
  for (const piece of allPieces()) {
    const room = ROOMS[piece.spec.room]!;
    const others = placed.filter((p) => p.piece.spec.room === piece.spec.room);
    let spot: Placed | null = null;
    for (let i = 0; i < 80 && !spot; i++) {
      const c = candidate(piece, room, rng);
      if (fits(c, room, others)) spot = c;
    }
    if (!spot) return null;
    placed.push(spot);
  }
  return placed;
}
