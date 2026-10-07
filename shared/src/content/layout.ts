import { makeRng, v3 } from '../math.ts';
import type { Vec3 } from '../math.ts';
import { PLAYER_RADIUS } from '../sim/sim.ts';
import { DOG_RADIUS } from '../sim/dog.ts';
import { dropSpot, hasDoor, hasLid, openingIn } from './hideouts.ts';
import {
  BASEMENT_FLOOR,
  HOUSE,
  HOUSE_STAIRWAYS,
  STAIRS,
  UPPER_FLOOR,
  doorLeaf,
  floorLevel,
  stairsPlan,
  upperFloor,
} from './house.ts';
import type {
  BoxDef,
  DogDef,
  DoorDef,
  HideoutDef,
  LevelDef,
  StairsDef,
  WindowDef,
} from './house.ts';

/**
 * Furnishes the house differently for every round. The walls, doorways, lamps and the whole
 * yard stay as they are; the stairs up to the upper floor go along a wall of the kitchen or the
 * living room, the stairs down to the basement along one of the break room's, each room's furniture (and the hiding places and page spots that come with it)
 * is moved to a new spot in the same room, picked from a seed, and the room's windows then go
 * wherever the outside walls are free of tall furniture and the stairs. The server sends only
 * the seed, so every client builds the same house from it.
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

/** A rectangle of floor on one of the house's floors: `y` is the floor's height. */
export interface FloorArea extends Rect {
  y: number;
}

/**
 * The rooms, as the floor inside their walls: the kitchen, living room and break room
 * downstairs, then the bedroom (over the kitchen) and the study (over the living room), and
 * the basement (under the break room).
 */
export const ROOMS: FloorArea[] = HOUSE.decals.map((d) => ({
  x0: d.pos.x - d.size.x / 2,
  x1: d.pos.x + d.size.x / 2,
  z0: d.pos.z - d.size.z / 2,
  z1: d.pos.z + d.size.z / 2,
  y: d.pos.y,
}));

/** The rooms the stairs up may go in, and the room each one comes out in upstairs. */
const STAIR_ROOMS = [
  { below: 0, above: 3 },
  { below: 1, above: 4 },
];
/** The stairs down go from the basement up into the break room. */
const BASEMENT_STAIR_ROOMS = [{ below: 5, above: 2 }];

/**
 * Floor kept clear of furniture so nobody's way is blocked: in front of the front door and
 * both sides of each inner doorway, on both floors. Rugs may lie here; nothing else.
 */
export const DOORWAY_CLEARANCE: FloorArea[] = [
  { x0: -1.4, x1: 1.4, z0: 6.1, z1: 7.6, y: 0 },
  { x0: -5.6, x1: -4.1, z0: 8.6, z1: 11.4, y: 0 },
  { x0: -3.9, x1: -2.4, z0: 8.6, z1: 11.4, y: 0 },
  { x0: 2.4, x1: 3.9, z0: 8.6, z1: 11.4, y: 0 },
  { x0: 4.1, x1: 5.6, z0: 8.6, z1: 11.4, y: 0 },
  // Upstairs: either side of the doorway between the bedroom and the study, and inside the
  // door out onto the roof.
  { x0: -5.6, x1: -4.1, z0: 8.6, z1: 11.4, y: UPPER_FLOOR },
  { x0: -3.9, x1: -2.4, z0: 8.6, z1: 11.4, y: UPPER_FLOOR },
  { x0: 2.4, x1: 3.9, z0: 8.6, z1: 11.4, y: UPPER_FLOOR },
];

/** How many windows each room has. */
const WINDOWS_PER_ROOM = [3, 1, 3, 2, 2, 0];
/** A window's width (the client draws it this wide). */
export const WINDOW_WIDTH = 1.3;
/** Wall kept clear on each side of a window: of corners, doors, ladders and other windows. */
const WINDOW_MARGIN = 0.3;
/** Furniture taller than this would stand in front of a window. */
export const BELOW_SILL = 1.2;

/** The house's doorways: the line down the middle of their wall, and the opening along it. */
export const DOORWAYS = [
  { alongX: true, line: 6, from: -1, to: 1, y: 0 },
  { alongX: false, line: -4, from: 9, to: 11, y: 0 },
  { alongX: false, line: 4, from: 9, to: 11, y: 0 },
  { alongX: false, line: -4, from: 9, to: 11, y: UPPER_FLOOR },
  { alongX: false, line: 4, from: 9, to: 11, y: UPPER_FLOOR },
];
/** Half a wall's thickness. */
const WALL_HALF = 0.1;

/**
 * The floor under a doorway's open doors, flat against the wall on the side they open to
 * either side of the opening, with a little to spare: nothing may stand there.
 */
export function doorLeaves(door: DoorDef): FloorArea[] {
  const y = door.y ?? 0;
  const d = DOORWAYS.find(
    (w) =>
      w.y === y &&
      (w.alongX
        ? Math.abs(door.z - w.line) < 0.3 && door.x > w.from && door.x < w.to
        : Math.abs(door.x - w.line) < 0.3 && door.z > w.from && door.z < w.to),
  );
  if (!d) return [];
  const leaf = doorLeaf(d.to - d.from);
  const face = d.line + door.opensTo * WALL_HALF;
  const [c0, c1] = [face, face + door.opensTo * 0.15].sort((a, b) => a - b) as [number, number];
  return [
    [d.from - leaf - 0.05, d.from],
    [d.to, d.to + leaf + 0.05],
  ].map(([a0, a1]) =>
    d.alongX ? { x0: a0!, x1: a1!, z0: c0, z1: c1, y } : { x0: c0, x1: c1, z0: a0!, z1: a1!, y },
  );
}

/** How a piece of furniture may be placed. */
type Placing = 'wall' | 'free' | 'rug';

interface PieceSpec {
  room: number;
  /** Where it stands in `HOUSE`: everything on its floor centred inside belongs to it. */
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
  { room: 2, from: { x0: 4.9, x1: 6.3, z0: 12.9, z1: 13.9 }, turn: 0, place: 'rug' },
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
  // Bedroom: the bed with its pillow, the nightstand, a chest, a rug.
  { room: 3, from: { x0: -9.25, x1: -7.75, z0: 12.7, z1: 14.95 }, turn: 0, place: 'wall' },
  { room: 3, from: { x0: -10.35, x1: -9.65, z0: 14.3, z1: 14.95 }, turn: 0, place: 'wall' },
  { room: 3, from: { x0: -11.6, x1: -10.8, z0: 9.5, z1: 10.5 }, turn: 3, place: 'free' },
  { room: 3, from: { x0: -9.1, x1: -6.9, z0: 9.7, z1: 11.3 }, turn: 0, place: 'rug' },
  // Study: the desk, the bookshelf, a toolbox, a rug.
  { room: 4, from: { x0: -2.25, x1: -0.75, z0: 14.1, z1: 14.95 }, turn: 0, place: 'wall' },
  { room: 4, from: { x0: 1.85, x1: 2.95, z0: 14.4, z1: 14.95 }, turn: 0, place: 'wall' },
  { room: 4, from: { x0: 3.1, x1: 3.7, z0: 6.7, z1: 7.7 }, turn: 1, place: 'free' },
  { room: 4, from: { x0: -1.3, x1: 1.3, z0: 9.6, z1: 11.4 }, turn: 0, place: 'rug' },
  // Basement: the electrical panel, the bookshelf, the chest.
  { room: 5, from: { x0: 8.2, x1: 9, z0: 14.7, z1: 14.95 }, turn: 0, place: 'wall' },
  { room: 5, from: { x0: 4.1, x1: 4.6, z0: 11.3, z1: 12.7 }, turn: 3, place: 'wall' },
  { room: 5, from: { x0: 10, x1: 11, z0: 10.6, z1: 11.4 }, turn: 2, place: 'free' },
];

/** Whether `p` is something standing in a piece of furniture where it stands in `HOUSE`. */
function inPieceSpec(spec: PieceSpec, p: Vec3): boolean {
  const floor = ROOMS[spec.room]!.y;
  return p.y > floor - 0.05 && p.y < floor + 2.5 && inRect(spec.from, p.x, p.z);
}

/** Dog points inside the house that are made anew for each layout (the rest stay). */
const DOG_INDOORS = (p: Vec3) =>
  ROOMS.some((r) => inRect(r, p.x, p.z)) &&
  !DOORWAY_CLEARANCE.some((r) => r.y === 0 && inRect(r, p.x, p.z));
/** New dog points per room downstairs (it never goes up the stairs). */
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
  /** Height of its tallest part above its floor. */
  top: number;
}

/** Moves a point from `HOUSE` into the frame of a piece centred at `cx`, `cz` and turned by `t`. */
const toLocal = (p: Vec3, cx: number, cz: number, t: Turn): Vec3 => {
  const f = turn(-t, p.x - cx, p.z - cz);
  return v3(f.x, p.y, f.z);
};

function cutPiece(spec: PieceSpec): Piece {
  const has = (p: Vec3) => inPieceSpec(spec, p);
  const boxes = HOUSE.boxes.filter((b) => b.model && !HOUSE_STAIRWAYS.includes(b) && has(b.pos));
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
  const floor = ROOMS[spec.room]!.y;
  const top =
    Math.max(
      ...boxes.map((b) => b.pos.y + b.size.y / 2),
      ...hideouts.map((h) => h.pos.y + h.size.y / 2),
    ) - floor;
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

/** Floor something in a room takes up. */
interface Taken {
  room: number;
  /** What it stands on: nothing else may overlap it. */
  solid: Rect;
  /** Floor kept clear in front of it (or around it) to reach it and open what it holds. */
  access: Rect;
  /** Rugs may lie on other things' access, and other things' access on them. */
  rug: boolean;
  /** Height of its tallest part above the floor (tall things stand in front of windows). */
  top: number;
}

/** A piece put somewhere in a room. */
interface Placed extends Taken {
  piece: Piece;
  x: number;
  z: number;
  t: Turn;
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
  const { room, place: kind } = piece.spec;
  return { piece, x, z, t, solid, access, room, rug: kind === 'rug', top: piece.top };
}

/** The floor a flight of stairs takes up: under it and at its foot, and round its well above. */
function stairsTaken(s: StairsDef, room: number): Taken[] {
  const plan = stairsPlan(s);
  const above = [...STAIR_ROOMS, ...BASEMENT_STAIR_ROOMS].find((r) => r.below === room)!.above;
  return [
    { room, solid: plan.flight, access: plan.foot, rug: false, top: UPPER_FLOOR },
    { room: above, solid: plan.railed, access: plan.top, rug: false, top: STAIRS.railHeight },
  ];
}

/** Whether `p` can go in `room` next to what is already there. */
function fits(p: Taken, room: FloorArea, others: Taken[], doors: FloorArea[]): boolean {
  if (!inside(p.solid, room)) return false;
  if (doors.some((d) => d.y === room.y && overlaps(p.solid, d))) return false;
  if (p.rug) {
    if (!inside(grow(p.solid, 0.15), room)) return false;
    return others.every((o) => !overlaps(p.solid, o.solid, 0.05));
  }
  if (!inside(p.access, room)) return false;
  if (DOORWAY_CLEARANCE.some((d) => d.y === room.y && overlaps(p.solid, d))) return false;
  for (const o of others) {
    if (overlaps(p.solid, o.solid, 0.05)) return false;
    if (o.rug) continue;
    if (overlaps(p.solid, o.access) || overlaps(p.access, o.solid)) return false;
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

/**
 * Everything solid on one floor of the house (`BASEMENT_FLOOR`, 0 or `UPPER_FLOOR`): walls and
 * furniture, as rectangles. The stairwells in it count too: there is no floor to stand on there.
 */
function obstacles(level: LevelDef, floor = 0): Rect[] {
  const rects: Rect[] = [];
  for (const b of level.boxes) {
    const bottom = b.pos.y - b.size.y / 2;
    const top = b.pos.y + b.size.y / 2;
    if (b.tiltX || bottom > floor + 1 || top <= floor + 0.05) continue;
    rects.push(rectAt(b.pos.x, b.pos.z, b.size.x / 2, b.size.z / 2, 0));
  }
  for (const h of level.hideouts) {
    if (h.kind === 'rug' || h.kind === 'cushion' || floorLevel(h.pos.y) !== floor) continue;
    rects.push(rectAt(h.pos.x, h.pos.z, h.size.x / 2, h.size.z / 2, turnOf(h.facing)));
  }
  for (const s of level.stairs ?? []) if (topOf(s) === floor) rects.push(stairsPlan(s).well);
  return rects;
}

/** The floor a flight comes out on at its top. */
const topOf = (s: StairsDef) => snapTiny(s.pos.y + UPPER_FLOOR);

/**
 * Each floor of the house as a grid: the ground floor's with the step outside the front door,
 * the upper floor's with the roof outside its door.
 */
const GRIDS = {
  ground: { x0: -12, z0: 4.5, cell: 0.1, nx: 240, nz: 105 },
  upper: { x0: -12.1, z0: 5.9, cell: 0.1, nx: 242, nz: 92 },
  basement: { x0: 3.9, z0: 5.9, cell: 0.1, nx: 82, nz: 92 },
};
const GRID = GRIDS.ground;

/**
 * Where a player can walk to on a floor of the house: downstairs from outside the front door,
 * upstairs from the top of the stairs, in the basement from the foot of its stairs. A cell is
 * walkable if a player standing on it touches nothing.
 */
export function walkable(level: LevelDef, floor = 0): (x: number, z: number) => boolean {
  const grid =
    floor === UPPER_FLOOR ? GRIDS.upper : floor === BASEMENT_FLOOR ? GRIDS.basement : GRIDS.ground;
  const { x0, z0, cell, nx, nz } = grid;
  const solid = obstacles(level, floor).filter((r) =>
    overlaps(r, { x0, x1: x0 + nx * cell, z0, z1: z0 + nz * cell }, 1),
  );
  const free = new Uint8Array(nx * nz).fill(1);
  const reached = new Uint8Array(nx * nz);
  // With room to spare for anywhere in the cell, not just its middle.
  const clear = PLAYER_RADIUS + 0.08;
  // Each obstacle blocks the cells near it (much quicker than testing every cell against
  // every obstacle).
  for (const r of solid) {
    const i0 = Math.max(0, Math.floor((r.x0 - clear - x0) / cell) - 1);
    const i1 = Math.min(nx - 1, Math.ceil((r.x1 + clear - x0) / cell) + 1);
    const k0 = Math.max(0, Math.floor((r.z0 - clear - z0) / cell) - 1);
    const k1 = Math.min(nz - 1, Math.ceil((r.z1 + clear - z0) / cell) + 1);
    for (let i = i0; i <= i1; i++)
      for (let k = k0; k <= k1; k++)
        if (distTo(r, x0 + (i + 0.5) * cell, z0 + (k + 0.5) * cell) <= clear) free[i + k * nx] = 0;
  }
  // Floors other than the ground floor are reached by their stairs only.
  const starts: [number, number][] = floor === 0 ? [[0, 5]] : [];
  for (const s of level.stairs ?? []) {
    const { foot, top } = stairsPlan(s);
    if (s.pos.y === floor) starts.push([(foot.x0 + foot.x1) / 2, (foot.z0 + foot.z1) / 2]);
    if (topOf(s) === floor) starts.push([(top.x0 + top.x1) / 2, (top.z0 + top.z1) / 2]);
  }
  const queue: number[] = [];
  for (const [x, z] of starts) {
    const start = Math.floor((x - x0) / cell) + Math.floor((z - z0) / cell) * nx;
    if (!free[start] || reached[start]) continue;
    reached[start] = 1;
    queue.push(start);
  }
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

/** Whether a point is inside one of the rooms, on the floor it is on. */
const indoors = (p: Vec3) => ROOMS.some((r) => r.y === floorLevel(p.y) && inRect(r, p.x, p.z));

/**
 * Whether every hiding place opens far enough and can be reached, along with what comes out
 * of it, every page spot and the treat jar, every doorway can be walked through, and the stairs
 * can be walked onto at the bottom and off at the top.
 */
export function layoutProblems(level: LevelDef): string[] {
  const ground = walkable(level);
  const upper = walkable(level, UPPER_FLOOR);
  const basement = walkable(level, BASEMENT_FLOOR);
  const walkOn = (y: number) => {
    const floor = floorLevel(y);
    return floor === UPPER_FLOOR ? upper : floor === BASEMENT_FLOOR ? basement : ground;
  };
  const problems: string[] = [];
  for (const [x, z] of [
    [0, 7],
    [-3, 10],
    [-5, 10],
    [3, 10],
    [5, 10],
  ] as const)
    if (!ground(x, z)) problems.push(`doorway at ${x}, ${z}`);
  // Upstairs: the doorway between the rooms, and out onto the roof.
  for (const [x, z] of [
    [-5, 10],
    [-3, 10],
    [3, 10],
    [5, 10],
  ] as const)
    if (!upper(x, z)) problems.push(`upstairs doorway at ${x}, ${z}`);
  if (!level.stairs?.some((s) => s.pos.y === 0)) problems.push('no stairs up');
  if (!level.stairs?.some((s) => s.pos.y === BASEMENT_FLOOR)) problems.push('no stairs down');
  for (const s of level.stairs ?? []) {
    const { foot, top } = stairsPlan(s);
    if (!walkOn(s.pos.y)((foot.x0 + foot.x1) / 2, (foot.z0 + foot.z1) / 2))
      problems.push(`foot of stairs at ${s.pos.y}`);
    if (!walkOn(topOf(s))((top.x0 + top.x1) / 2, (top.z0 + top.z1) / 2))
      problems.push(`top of stairs at ${s.pos.y}`);
  }
  const panel = level.boxes.find((b) => b.model === 'panel');
  if (!panel) problems.push('no electrical panel');
  else if (!reachableNear(walkOn(panel.pos.y), panel.pos.x, panel.pos.z, USE_DISTANCE))
    problems.push('electrical panel out of reach');
  for (const h of level.hideouts.filter((h) => indoors(h.pos))) {
    const name = `${h.kind} #${h.id}`;
    const walk = walkOn(h.pos.y);
    if ((hasDoor(h) || hasLid(h)) && openingIn(level, h) < MIN_SWING)
      problems.push(`${name} opening`);
    if (!reachableNear(walk, h.pos.x, h.pos.z, USE_DISTANCE + Math.max(h.size.x, h.size.z) / 2))
      problems.push(`${name} out of reach`);
    const drop = dropSpot(level, h);
    if (!reachableNear(walkOn(drop.y), drop.x, drop.z, USE_DISTANCE))
      problems.push(`${name} drop spot`);
  }
  for (const p of level.pageSpots)
    if (indoors(p) && !reachableNear(walkOn(p.y), p.x, p.z, USE_DISTANCE))
      problems.push(`page spot ${p.x}, ${p.y}, ${p.z}`);
  const jar = level.dog.treatJar;
  if (!reachableNear(ground, jar.x, jar.z, USE_DISTANCE)) problems.push('treat jar');
  return problems;
}

/** Whether the dog fits through a straight walk from `a` to `b`. */
function clearWalk(solid: Rect[], a: Vec3, b: Vec3): boolean {
  const clear = DOG_RADIUS + 0.08;
  const span = {
    x0: Math.min(a.x, b.x),
    x1: Math.max(a.x, b.x),
    z0: Math.min(a.z, b.z),
    z1: Math.max(a.z, b.z),
  };
  const near = solid.filter((r) => overlaps(r, span, clear));
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
  for (const [a, b] of links) {
    const [p, q] = [points[a]!, points[b]!];
    if ((indoors(p) || indoors(q)) && !clearWalk(solid, p, q)) return null;
  }
  let start = -1;
  for (const [r, room] of ROOMS.entries()) {
    if (room.y !== 0) continue;
    const mine = points.flatMap((p, i) => (inRect(room, p.x, p.z) ? [i] : []));
    const inRoom = solid.filter((s) => overlaps(s, room, 1));
    const free: Vec3[] = [];
    for (let x = room.x0 + 0.5; x < room.x1 - 0.4; x += 0.5)
      for (let z = room.z0 + 0.5; z < room.z1 - 0.4; z += 0.5) {
        const p = v3(snapTiny(x), 0, snapTiny(z));
        if (inRoom.every((s) => distTo(s, p.x, p.z) > DOG_RADIUS + 0.15)) free.push(p);
      }
    for (let n = 0; n < DOG_POINTS_PER_ROOM[r]!; n++) {
      // The free spot farthest from every point so far that a clear walk joins to one (the
      // first of the farthest, as they were listed).
      const far = free
        .map((p, i) => ({
          p,
          i,
          d: Math.min(...mine.map((m) => Math.hypot(points[m]!.x - p.x, points[m]!.z - p.z))),
        }))
        .filter((c) => c.d > 0.8)
        .sort((a, b) => b.d - a.d || a.i - b.i);
      const best = far.find((c) => mine.some((i) => clearWalk(solid, points[i]!, c.p)))?.p;
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
    // Each doorway's doors open to either side of its wall.
    const doors: DoorDef[] = DOORWAYS.map((d) => {
      const mid = (d.from + d.to) / 2;
      const opensTo = rng() < 0.5 ? 1 : -1;
      const at = d.alongX ? { x: mid, z: d.line } : { x: d.line, z: mid };
      return { ...at, ...(d.y ? { y: d.y } : {}), opensTo };
    });
    const leaves = doors.flatMap(doorLeaves);
    const stairs = placeStairs(rng, leaves, STAIR_ROOMS, []);
    if (!stairs) continue;
    const up = stairsTaken(stairs.def, stairs.room);
    const cellar = placeStairs(rng, leaves, BASEMENT_STAIR_ROOMS, up);
    if (!cellar) continue;
    const taken = [...up, ...stairsTaken(cellar.def, cellar.room)];
    const placed = placeAll(rng, leaves, taken);
    if (!placed) continue;
    const inPiece = (p: Vec3) => PIECES.some((s) => inPieceSpec(s, p));
    const level: LevelDef = {
      ...HOUSE,
      boxes: [
        ...HOUSE.boxes.filter((b) => !HOUSE_STAIRWAYS.includes(b) && !(b.model && inPiece(b.pos))),
        ...upperFloor(stairs.def),
        ...upperFloor(cellar.def),
      ],
      hideouts: HOUSE.hideouts.filter((h) => !inPiece(h.pos)),
      pageSpots: HOUSE.pageSpots.filter((p) => !inPiece(p)),
      meetingSeats: HOUSE.meetingSeats.filter((p) => !inPiece(p)),
      dog: { ...HOUSE.dog },
      doors,
      stairs: [stairs.def, cellar.def],
    };
    for (const p of placed) furnish(level, p);
    level.hideouts.sort((a, b) => a.id - b.id);
    const windows = placeWindows([...placed, ...taken], rng);
    if (!windows) continue;
    level.windows = windows;
    if (layoutProblems(level).length) continue;
    const dog = dogPaths(level);
    if (!dog) continue;
    level.dog = dog;
    return level;
  }
  return null;
}

/**
 * A flight of stairs along a wall of one of `rooms` (below), climbing either way, with room to
 * step on at its foot and off at its top, clear of the doorways and open doors on both floors
 * and of what is already `taken`. Null if none turns up.
 */
function placeStairs(
  rng: () => number,
  doors: FloorArea[],
  rooms: { below: number; above: number }[],
  taken: Taken[],
): { def: StairsDef; room: number } | null {
  const run = STAIRS.steps * STAIRS.tread;
  const half = STAIRS.width / 2;
  for (let i = 0; i < 200; i++) {
    const { below, above } = rooms[Math.floor(rng() * rooms.length)]!;
    const room = ROOMS[below]!;
    const t = Math.floor(rng() * 4);
    const wall = rng() < 0.5 ? 1 : -1;
    const facing = FACING[t]!;
    // Climbing along `f`, with the wall on side `wall` of it.
    const f = turn(t, 0, -1);
    const side = turn(t, wall, 0);
    // Against that wall, with its foot somewhere it leaves room for the landings.
    const lo = (a: 'x' | 'z') => (a === 'x' ? room.x0 : room.z0);
    const hi = (a: 'x' | 'z') => (a === 'x' ? room.x1 : room.z1);
    const acrossAxis = side.x !== 0 ? 'x' : 'z';
    const alongAxis = acrossAxis === 'x' ? 'z' : 'x';
    const across =
      (side[acrossAxis] > 0 ? hi(acrossAxis) : lo(acrossAxis)) - side[acrossAxis] * half;
    const dir = f[alongAxis];
    // The foot, from a landing's length off one end to the flight and a landing off the other.
    const [a0, a1] =
      dir > 0
        ? [lo(alongAxis) + STAIRS.landing, hi(alongAxis) - run - STAIRS.landing]
        : [lo(alongAxis) + run + STAIRS.landing, hi(alongAxis) - STAIRS.landing];
    if (a1 < a0) continue;
    const along = snap(a0 + (a1 - a0) * rng());
    const pos = alongAxis === 'x' ? v3(along, 0, across) : v3(across, 0, along);
    const def: StairsDef = { pos: v3(snapTiny(pos.x), room.y, snapTiny(pos.z)), facing, wall };
    const [down, up] = stairsTaken(def, below);
    const others = (r: number) => taken.filter((t) => t.room === r);
    if (
      fits(down!, room, others(below), doors) &&
      fits(up!, ROOMS[above]!, others(above), doors) &&
      !doors.some(
        (d) =>
          (d.y === room.y && overlaps(down!.access, d)) ||
          (d.y === ROOMS[above]!.y && overlaps(up!.access, d)),
      )
    )
      return { def, room: below };
  }
  return null;
}

/** Places every piece in its room, clear of the stairs, or gives up if one finds no spot. */
function placeAll(rng: () => number, doors: FloorArea[], stairs: Taken[]): Placed[] | null {
  const placed: Placed[] = [];
  for (const piece of allPieces()) {
    const room = ROOMS[piece.spec.room]!;
    const others = [...stairs, ...placed].filter((p) => p.room === piece.spec.room);
    let spot: Placed | null = null;
    for (let i = 0; i < 80 && !spot; i++) {
      const c = candidate(piece, room, rng);
      if (fits(c, room, others, doors)) spot = c;
    }
    if (!spot) return null;
    placed.push(spot);
  }
  return placed;
}

/** A stretch of outside wall, as seen from inside a room. */
interface OutsideWall {
  alongX: boolean;
  /** The wall's centre line across it (z for `alongX`, else x). */
  line: number;
  /** Where its inner face is. */
  face: number;
  from: number;
  to: number;
}

/**
 * Windows for every room, on its outside walls where nothing tall stands against them (the
 * stairs included), clear of the corners, the doors out, the ladder and each other. Null if a
 * room has no room for them.
 */
function placeWindows(taken: Taken[], rng: () => number): WindowDef[] | null {
  const half = 0.1;
  const windows: WindowDef[] = [];
  for (const [r, room] of ROOMS.entries()) {
    const floor = ROOMS.filter((o) => o.y === room.y);
    const west = Math.min(...floor.map((o) => o.x0));
    const east = Math.max(...floor.map((o) => o.x1));
    const walls: OutsideWall[] = [
      { alongX: true, line: room.z0 - half, face: room.z0, from: room.x0, to: room.x1 },
      { alongX: true, line: room.z1 + half, face: room.z1, from: room.x0, to: room.x1 },
    ];
    if (room.x0 === west)
      walls.push({
        alongX: false,
        line: room.x0 - half,
        face: room.x0,
        from: room.z0,
        to: room.z1,
      });
    if (room.x1 === east)
      walls.push({
        alongX: false,
        line: room.x1 + half,
        face: room.x1,
        from: room.z0,
        to: room.z1,
      });
    // What each wall has to stay clear of, as stretches along it.
    const blocked = walls.map((w) => {
      const along: { from: number; to: number }[] = [];
      for (const p of taken) {
        if (p.room !== r || p.top <= BELOW_SILL) continue;
        const s = p.solid;
        const [lo, hi, a0, a1] = w.alongX ? [s.z0, s.z1, s.x0, s.x1] : [s.x0, s.x1, s.z0, s.z1];
        if (lo < w.face + 0.4 && hi > w.face - 0.4) along.push({ from: a0, to: a1 });
      }
      // Doors out of the house (the front door, the upper floor's door onto the roof), open
      // on either side of the wall.
      for (const d of DOORWAYS)
        if (d.y === room.y && d.alongX === w.alongX && Math.abs(d.line - w.line) < 0.01) {
          const leaf = doorLeaf(d.to - d.from);
          along.push({ from: d.from - leaf, to: d.to + leaf });
        }
      if (room.y === 0 && w.alongX && w.line < 6.5)
        for (const l of HOUSE.ladders)
          along.push({ from: l.pos.x - l.width / 2 - 0.1, to: l.pos.x + l.width / 2 + 0.1 });
      return along;
    });
    for (let n = 0; n < WINDOWS_PER_ROOM[r]!; n++) {
      const spots: { wall: number; at: number }[] = [];
      for (const [i, w] of walls.entries()) {
        const reach = WINDOW_WIDTH / 2 + WINDOW_MARGIN;
        for (let at = snap(w.from + reach + SNAP); at <= w.to - reach; at = snap(at + SNAP))
          if (blocked[i]!.every((b) => at + reach <= b.from || at - reach >= b.to))
            spots.push({ wall: i, at });
      }
      if (!spots.length) return null;
      const { wall, at } = spots[Math.floor(rng() * spots.length)]!;
      const w = walls[wall]!;
      const y = room.y ? { y: room.y } : {};
      windows.push(
        w.alongX
          ? { x: at, z: snapTiny(w.line), ...y, alongX: true }
          : { x: snapTiny(w.line), z: at, ...y, alongX: false },
      );
      // Another window on the same wall stands a little apart from this one.
      blocked[wall]!.push({ from: at - WINDOW_WIDTH / 2 - 0.3, to: at + WINDOW_WIDTH / 2 + 0.3 });
    }
  }
  return windows;
}
