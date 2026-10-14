import * as THREE from 'three';
import { BASEMENT_FLOOR, UPPER_FLOOR, doorLeaf, groundHeight } from '@sar/shared';
import type { BoxDef, LevelDef } from '@sar/shared';
import { OUTSIDE_HALF } from './furniture.ts';
import { bevelBox, bevelFor } from './shapes.ts';
import { madeAs } from './styles.ts';

/**
 * Trim that makes the house read as a house: baseboards, framed doorways with their doors
 * swung open against the wall, and glazed windows the sun shines in through. All of it is drawn
 * only, with nothing added to the physics, so nobody can trip on a baseboard and every doorway
 * stays as wide as it was. The window holes are only drawn too: the glass still stops players.
 *
 * Rooms are the level's floor decals and walls are the full-height boxes around them, so the
 * baseboards and doorways follow the walls by themselves if the layout changes. Upstairs
 * rooms are decals up on the upper floor, with walls standing on it.
 */

/** Boxes at least this tall, standing on the floor (either floor), count as walls. */
const WALL_MIN_HEIGHT = 2.4;
/** Gaps in a wall at least this wide are doorways. */
const MIN_DOORWAY = 0.6;
const EPS = 0.01;

const BASEBOARD = { height: 0.1, depth: 0.02 };
const CASING = { width: 0.09, depth: 0.025 };
/** How far the head casing's ledge sticks out past the casing, and how tall it is. */
const LEDGE = { overhang: 0.03, height: 0.04 };
const DOOR = { thickness: 0.045 };
const WINDOW = { width: 1.3, height: 1, sill: 1.25, frame: 0.06, depth: 0.04 };
/** How far the roof reaches out past the walls, and the gap it leaves round a ladder's top. */
const EAVE = { overhang: 0.3, ladderGap: 0.1 };
/**
 * Flat boxes on top of the walls, at most this thick, are roofs (and the upper floor, which
 * is the roof of the rooms under it). Those at one height make one roof together.
 */
const ROOF_MAX_THICKNESS = 0.25;
const ROOF_MIN_SPAN = 4;
/** How tall a room is, floor to ceiling, give or take. */
const ROOM_HEIGHT = 2.7;

/** One side of a room: the line of the wall's inner face and which way the room lies. */
export interface RoomSide {
  /** The height of the room's floor. */
  floor: number;
  /** True when the side runs along x (a north or south wall). */
  alongX: boolean;
  /** The wall face's coordinate across the side (z when `alongX`, else x). */
  face: number;
  /** +1 or -1: the direction from the wall into the room. */
  normal: number;
  /** Extent of the room along the side. */
  from: number;
  to: number;
  /** Wall sections on this side, clipped to the room. */
  walls: { from: number; to: number; thickness: number }[];
  /** Openings between them wide enough to walk through, up to the header over them (its height above the floor). */
  doorways: { from: number; to: number; thickness: number; height: number }[];
}

/** Where a box stands: its bottom. */
const bottomOf = (b: BoxDef) => b.pos.y - b.size.y / 2;

const isWall = (b: BoxDef, floors: number[]) =>
  !b.model &&
  !b.tiltX &&
  b.size.y >= WALL_MIN_HEIGHT &&
  floors.some((floor) => Math.abs(bottomOf(b) - floor) < EPS);

/** The floors walls stand on: the house's, and any room's floor (a caravan's, up off the grass). */
const floorsOf = (level: LevelDef) => [
  ...new Set([0, UPPER_FLOOR, BASEMENT_FLOOR, ...level.decals.map((d) => d.pos.y)]),
];

/** The hole a window leaves in its wall, which the sun shines in through. */
export interface WindowOpening {
  wall: BoxDef;
  alongX: boolean;
  /** The wall's centre line across it (z when `alongX`, else x), and its thickness. */
  centre: number;
  thickness: number;
  /** Extent of the hole along the wall, and its bottom and top. */
  from: number;
  to: number;
  bottom: number;
  top: number;
}

/** Where each window of the level cuts through its wall. Windows off every wall are skipped. */
export function windowOpenings(level: LevelDef): WindowOpening[] {
  const floors = floorsOf(level);
  const walls = level.boxes.filter((b) => isWall(b, floors));
  const openings: WindowOpening[] = [];
  for (const w of level.windows ?? []) {
    const floor = w.y ?? 0;
    const wall = walls.find(
      (b) =>
        Math.abs(bottomOf(b) - floor) < EPS &&
        Math.abs(w.x - b.pos.x) <= b.size.x / 2 + EPS &&
        Math.abs(w.z - b.pos.z) <= b.size.z / 2 + EPS,
    );
    if (!wall) continue;
    const along = w.alongX ? w.x : w.z;
    openings.push({
      wall,
      alongX: w.alongX,
      centre: w.alongX ? wall.pos.z : wall.pos.x,
      thickness: w.alongX ? wall.size.z : wall.size.x,
      from: along - WINDOW.width / 2,
      to: along + WINDOW.width / 2,
      bottom: floor + WINDOW.sill,
      top: floor + WINDOW.sill + WINDOW.height,
    });
  }
  return openings;
}

/** A rectangle: `u` runs along a wall or face, `v` up it (or across, on a roof). */
export interface Rect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/** Splits `rect` into rectangles covering it all except the `holes`. */
export function rectMinusHoles(rect: Rect, holes: Rect[]): Rect[] {
  const inside = holes.filter(
    (h) => h.u1 > rect.u0 && h.u0 < rect.u1 && h.v1 > rect.v0 && h.v0 < rect.v1,
  );
  if (inside.length === 0) return [rect];
  const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
  // Columns between the holes' sides, each cut into bands between the holes crossing it.
  const us = [rect.u0, rect.u1, ...inside.flatMap((h) => [h.u0, h.u1])]
    .map((u) => clamp(u, rect.u0, rect.u1))
    .sort((a, b) => a - b);
  const out: Rect[] = [];
  for (let i = 1; i < us.length; i++) {
    const [u0, u1] = [us[i - 1]!, us[i]!];
    if (u1 - u0 < EPS) continue;
    const across = inside
      .filter((h) => h.u0 < u1 - EPS && h.u1 > u0 + EPS)
      .sort((a, b) => a.v0 - b.v0);
    let v = rect.v0;
    for (const h of across) {
      const v0 = clamp(h.v0, rect.v0, rect.v1);
      if (v0 - v > EPS) out.push({ u0, u1, v0: v, v1: v0 });
      v = Math.max(v, clamp(h.v1, rect.v0, rect.v1));
    }
    if (rect.v1 - v > EPS) out.push({ u0, u1, v0: v, v1: rect.v1 });
  }
  return out;
}

/** The pieces of wall `box` left around the window openings in it: just the box if it has none. */
export function cutWindows(box: BoxDef, openings: WindowOpening[]): BoxDef[] {
  const holes = openings.filter((o) => o.wall === box);
  if (holes.length === 0) return [box];
  const alongX = holes[0]!.alongX;
  const half = (alongX ? box.size.x : box.size.z) / 2;
  const mid = alongX ? box.pos.x : box.pos.z;
  const bottom = box.pos.y - box.size.y / 2;
  const pieces = rectMinusHoles(
    { u0: mid - half, u1: mid + half, v0: bottom, v1: bottom + box.size.y },
    holes.map((h) => ({ u0: h.from, u1: h.to, v0: h.bottom, v1: h.top })),
  );
  return pieces.map((r) => {
    const along = (r.u0 + r.u1) / 2;
    const length = r.u1 - r.u0;
    return {
      ...box,
      pos: {
        x: alongX ? along : box.pos.x,
        y: (r.v0 + r.v1) / 2,
        z: alongX ? box.pos.z : along,
      },
      size: {
        x: alongX ? length : box.size.x,
        y: r.v1 - r.v0,
        z: alongX ? box.size.z : length,
      },
    };
  });
}

/** Works out the four sides of every room: where the walls are and where the doorways are. */
export function roomSides(level: LevelDef): RoomSide[] {
  const floors = floorsOf(level);
  const walls = level.boxes.filter((b) => isWall(b, floors));
  const sides: RoomSide[] = [];
  for (const room of level.decals) {
    const floor = room.pos.y;
    const x0 = room.pos.x - room.size.x / 2;
    const x1 = room.pos.x + room.size.x / 2;
    const z0 = room.pos.z - room.size.z / 2;
    const z1 = room.pos.z + room.size.z / 2;
    for (const [alongX, face, normal] of [
      [true, z0, 1],
      [true, z1, -1],
      [false, x0, 1],
      [false, x1, -1],
    ] as const) {
      const [from, to] = alongX ? [x0, x1] : [z0, z1];
      const onSide = walls
        .filter((b) => {
          if (Math.abs(bottomOf(b) - floor) > EPS) return false;
          const c = alongX ? b.pos.z : b.pos.x;
          const half = (alongX ? b.size.z : b.size.x) / 2;
          return Math.abs(c + normal * half - face) < EPS;
        })
        .map((b) => {
          const c = alongX ? b.pos.x : b.pos.z;
          const half = (alongX ? b.size.x : b.size.z) / 2;
          return {
            from: Math.max(from, c - half),
            to: Math.min(to, c + half),
            thickness: alongX ? b.size.z : b.size.x,
          };
        })
        .filter((w) => w.to - w.from > EPS)
        .sort((a, b) => a.from - b.from);
      if (onSide.length === 0) continue; // an open side: no wall to trim
      const doorways: RoomSide['doorways'] = [];
      for (let i = 1; i < onSide.length; i++) {
        const a = onSide[i - 1]!;
        const b = onSide[i]!;
        if (b.from - a.to < MIN_DOORWAY) continue;
        const thickness = Math.min(a.thickness, b.thickness);
        const line = face - (normal * thickness) / 2;
        doorways.push({
          from: a.to,
          to: b.from,
          thickness,
          height: headerHeight(level, floor, alongX, line, (a.to + b.from) / 2),
        });
      }
      sides.push({ floor, alongX, face, normal, from, to, walls: onSide, doorways });
    }
  }
  return sides;
}

/** The most a doorway's casing outside is lifted onto what lies against the wall there. */
const STEP_MAX = 0.5;

/**
 * How far above a doorway's floor the top of what lies against the wall outside it stands under
 * its casing there (a porch's deck laid up to the wall, say), or 0 where nothing does.
 */
function stepOutside(level: LevelDef, s: RoomSide, d: RoomSide['doorways'][number]): number {
  const across = s.face - s.normal * (d.thickness + CASING.depth / 2);
  let step = 0;
  for (const b of level.boxes) {
    const top = b.pos.y + b.size.y / 2 - s.floor;
    if (top <= step + EPS || top > STEP_MAX) continue;
    for (const along of [d.from - CASING.width / 2, d.to + CASING.width / 2]) {
      const x = s.alongX ? along : across;
      const z = s.alongX ? across : along;
      if (Math.abs(x - b.pos.x) < b.size.x / 2 && Math.abs(z - b.pos.z) < b.size.z / 2) step = top;
    }
  }
  return step;
}

/**
 * Bottom of the header box over a doorway on the floor at `floor`, or the top of the walls if
 * it has none, as a height above that floor.
 */
function headerHeight(
  level: LevelDef,
  floor: number,
  alongX: boolean,
  line: number,
  mid: number,
): number {
  let height = Infinity;
  let top = 0;
  for (const b of level.boxes) {
    const across = Math.abs((alongX ? b.pos.z : b.pos.x) - line);
    const along = Math.abs((alongX ? b.pos.x : b.pos.z) - mid);
    if (across > EPS || along > (alongX ? b.size.x : b.size.z) / 2) continue;
    const bottom = bottomOf(b) - floor;
    if (bottom < -EPS || bottom > ROOM_HEIGHT) continue;
    if (bottom > 1.5) height = Math.min(height, bottom);
    top = Math.max(top, bottom + b.size.y);
  }
  return Number.isFinite(height) ? height : top;
}

type Size3 = [number, number, number];
/** A box's size as `placeOn` takes it, for a box with its edges bevelled (see `bevelBox`). */
interface Rounded {
  rounded: Size3;
}

/**
 * Adds a box laid out against a wall: `along` and `shape[0]` run along the wall, `out` is how
 * far its centre sits from the face line into the room, `shape[1]` its depth away from the
 * wall. Its edges are square, to meet the wall and the trim round it flush, unless given as
 * `{ rounded: size }` (a door, a sill). A geometry given as `shape` (a door knob's sphere) is
 * placed as it is, unturned.
 */
function placeOn(
  parent: THREE.Object3D,
  material: THREE.Material,
  alongX: boolean,
  face: number,
  normal: number,
  along: number,
  out: number,
  y: number,
  shape: Size3 | Rounded | THREE.BufferGeometry,
  shadows = false,
): THREE.Mesh {
  const box = (s: Size3, radius = 0) => {
    const [w, d, h] = s;
    return alongX ? bevelBox(w, h, d, radius) : bevelBox(d, h, w, radius);
  };
  const geometry =
    shape instanceof THREE.BufferGeometry
      ? shape
      : 'rounded' in shape
        ? box(shape.rounded, bevelFor(...shape.rounded))
        : box(shape);
  const m = new THREE.Mesh(geometry, material);
  const across = face + normal * out;
  m.position.set(alongX ? along : across, y, alongX ? across : along);
  m.receiveShadow = true;
  m.castShadow = shadows;
  parent.add(m);
  return m;
}

/** Is this point on the floor at `floor` inside one of the rooms? */
function inRoom(level: LevelDef, x: number, z: number, floor: number): boolean {
  return level.decals.some(
    (d) =>
      Math.abs(d.pos.y - floor) < EPS &&
      Math.abs(x - d.pos.x) < d.size.x / 2 &&
      Math.abs(z - d.pos.z) < d.size.z / 2,
  );
}

/**
 * Where things stand on the floor right against a room's side, as stretches along it: steps,
 * cupboards, sofas, beds, railings and closed hiding places, which the baseboard stops behind
 * rather than run through. Tables and desks stand on legs set in from their edges, so the
 * baseboard runs on behind them.
 */
function standingAgainst(level: LevelDef, s: RoomSide): Rect[] {
  const reach = BASEBOARD.depth + 0.01;
  const out: Rect[] = [];
  const add = (x0: number, x1: number, z0: number, z1: number, bottom: number) => {
    if (Math.abs(bottom - s.floor) > 0.15) return;
    const [lo, hi, a0, a1] = s.alongX ? [z0, z1, x0, x1] : [x0, x1, z0, z1];
    // The side of the footprint nearest the wall, measured into the room.
    const near = s.normal > 0 ? lo - s.face : s.face - hi;
    if (near > reach || near < -0.3) return;
    out.push({ u0: a0 - 0.005, u1: a1 + 0.005, v0: 0, v1: 1 });
  };
  for (const b of level.boxes) {
    if (!b.model || b.model === 'table' || b.model === 'lampPost' || b.tiltX) continue;
    add(
      b.pos.x - b.size.x / 2,
      b.pos.x + b.size.x / 2,
      b.pos.z - b.size.z / 2,
      b.pos.z + b.size.z / 2,
      bottomOf(b),
    );
  }
  for (const h of level.hideouts) {
    if (h.kind === 'rug' || h.kind === 'drawer' || h.kind === 'cushion' || h.kind === 'berth')
      continue;
    const turned = Math.round(Math.abs(h.facing) / (Math.PI / 2)) % 2 === 1;
    const [w, d] = turned ? [h.size.z, h.size.x] : [h.size.x, h.size.z];
    add(h.pos.x - w / 2, h.pos.x + w / 2, h.pos.z - d / 2, h.pos.z + d / 2, h.pos.y - h.size.y / 2);
  }
  return out;
}

/**
 * Adds the house trim to `scene`, as one group, and returns it. Nothing in it moves, so
 * `mergeStatic` bakes it in.
 */
export function addHouseDetails(scene: THREE.Object3D, level: LevelDef): THREE.Group {
  const trim = new THREE.MeshStandardMaterial({ color: 0x7d5a3c, roughness: 0.7 });
  const door = new THREE.MeshStandardMaterial({ color: 0xa8774c, roughness: 0.7 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x956840, roughness: 0.7 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.7, roughness: 0.3 });
  const frame = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.6 });
  const timber = madeAs(
    new THREE.MeshStandardMaterial({ color: FRAME.colour, roughness: 0.85 }),
    'wood',
  );
  // Clear enough to see the yard through, and casting no shadow, so the sun comes in.
  const glass = new THREE.MeshStandardMaterial({
    color: 0xd8ecf7,
    roughness: 0.05,
    metalness: 0.1,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });
  const group = new THREE.Group();
  const doorways = new Set<string>();

  for (const s of roomSides(level)) {
    const put = (
      material: THREE.Material,
      along: number,
      out: number,
      y: number,
      size: Size3 | Rounded | THREE.BufferGeometry,
      shadows = false,
      normal = s.normal,
      face = s.face,
    ) => placeOn(group, material, s.alongX, face, normal, along, out, s.floor + y, size, shadows);

    // Baseboards: stop at doorways (the casing covers the cut end) and behind whatever stands
    // against the wall. The north and south ones run into the corners; the east and west ones
    // stop at those, so no two meet face to face.
    const behind = standingAgainst(level, s);
    for (const w of s.walls) {
      const from = w.from + (!s.alongX && w.from - s.from < EPS ? BASEBOARD.depth : 0);
      const to = w.to - (!s.alongX && s.to - w.to < EPS ? BASEBOARD.depth : 0);
      for (const r of rectMinusHoles({ u0: from, u1: to, v0: 0, v1: 1 }, behind))
        put(trim, (r.u0 + r.u1) / 2, BASEBOARD.depth / 2, BASEBOARD.height / 2, [
          r.u1 - r.u0,
          BASEBOARD.depth,
          BASEBOARD.height,
        ]);
    }

    for (const d of s.doorways) {
      // An opening something else fills (a roller shutter's bay) gets no casing or doors.
      const centre = (d.from + d.to) / 2;
      const middle = s.face - (s.normal * d.thickness) / 2;
      const bare = level.doors?.some(
        (o) =>
          o.finish === 'bare' &&
          Math.abs(o.x - (s.alongX ? centre : middle)) < 0.3 &&
          Math.abs(o.z - (s.alongX ? middle : centre)) < 0.3 &&
          Math.abs((o.y ?? 0) - s.floor) < EPS,
      );
      if (bare) continue;
      const height = d.height;
      // Wall face on the far side of this doorway, and whether that side is outdoors.
      const farFace = s.face - s.normal * d.thickness;
      const mid = (d.from + d.to) / 2;
      const beyond = farFace - s.normal * 0.4;
      const outdoors = !inRoom(level, s.alongX ? mid : beyond, s.alongX ? beyond : mid, s.floor);
      // Casing on this face, and on the outside too since no room will add one there, standing
      // on whatever the doorway opens onto outside (a porch's deck), not down in it.
      const step = outdoors ? stepOutside(level, s, d) : 0;
      const faces: [number, number, number][] = [[s.face, s.normal, 0]];
      if (outdoors) faces.push([farFace, -s.normal, step]);
      const span = d.to - d.from + 2 * CASING.width;
      for (const [face, normal, foot] of faces) {
        for (const edge of [d.from - CASING.width / 2, d.to + CASING.width / 2]) {
          put(
            trim,
            edge,
            CASING.depth / 2,
            (foot + height) / 2,
            [CASING.width, CASING.depth, height - foot],
            false,
            normal,
            face,
          );
        }
        // Head casing across the top, with a little ledge resting on it, its edges rounded.
        const head = height + CASING.width / 2;
        put(
          trim,
          mid,
          CASING.depth / 2,
          head,
          [span, CASING.depth, CASING.width],
          false,
          normal,
          face,
        );
        const ledgeDepth = CASING.depth + LEDGE.overhang;
        put(
          trim,
          mid,
          ledgeDepth / 2,
          height + CASING.width + LEDGE.height / 2,
          { rounded: [span + 2 * LEDGE.overhang, ledgeDepth, LEDGE.height] },
          false,
          normal,
          face,
        );
      }

      // The rest is shared by both rooms of an inner doorway, so only the first one adds it.
      const line = s.face - (s.normal * d.thickness) / 2;
      const key = `${s.floor}:${s.alongX}:${line.toFixed(2)}:${mid.toFixed(2)}`;
      if (doorways.has(key)) continue;
      doorways.add(key);
      // The doors stand open on the side the level says (into this room if it says nothing).
      const at = s.alongX ? { x: mid, z: line } : { x: line, z: mid };
      const set = level.doors?.find(
        (o) =>
          Math.abs(o.x - at.x) < 0.3 &&
          Math.abs(o.z - at.z) < 0.3 &&
          Math.abs((o.y ?? 0) - s.floor) < EPS,
      );
      const opensTo = set?.opensTo ?? s.normal;
      const doorFace = opensTo === s.normal ? s.face : farFace;

      // Jamb linings over the cut ends of the wall, and under the header, flush with the casings
      // either side: the outer casing's depth of them from the step outside up.
      const lining = d.thickness + 2 * CASING.depth;
      for (const edge of [d.from + 0.01, d.to - 0.01]) {
        if (step === 0) {
          put(trim, edge, -d.thickness / 2, height / 2, [0.02, lining, height]);
          continue;
        }
        const inner = d.thickness + CASING.depth;
        put(trim, edge, CASING.depth - inner / 2, height / 2, [0.02, inner, height]);
        put(trim, edge, -d.thickness - CASING.depth / 2, (step + height) / 2, [
          0.02,
          CASING.depth,
          height - step,
        ]);
      }
      put(trim, mid, -d.thickness / 2, height - 0.01, [d.to - d.from, lining, 0.02]);

      // Double doors, swung open flat against the wall on that side.
      const leaf = doorLeaf(d.to - d.from);
      const putDoor = (
        material: THREE.Material,
        along: number,
        out: number,
        y: number,
        size: Size3 | Rounded | THREE.BufferGeometry,
        shadows = false,
      ) => put(material, along, out, y, size, shadows, opensTo, doorFace);
      for (const [hinge, dir] of [
        [d.from, -1],
        [d.to, 1],
      ] as const) {
        const centre = hinge + (dir * leaf) / 2;
        const out = CASING.depth + DOOR.thickness / 2;
        // As tall as the opening, less a small gap at the floor and under the lining.
        const tall = height - 0.04;
        putDoor(
          door,
          centre,
          out,
          0.01 + tall / 2,
          { rounded: [leaf, DOOR.thickness, tall] },
          true,
        );
        // Two raised panels on the face that shows, and a knob near the free edge.
        const panelOut = out + DOOR.thickness / 2 + 0.006;
        const lower = 0.75;
        const upper = tall - lower - 0.4;
        putDoor(panel, centre, panelOut, 0.15 + lower / 2, [leaf - 0.26, 0.012, lower]);
        putDoor(panel, centre, panelOut, tall - 0.15 - upper / 2, [leaf - 0.26, 0.012, upper]);
        putDoor(
          brass,
          hinge + dir * (leaf - 0.09),
          panelOut + 0.03,
          1.0,
          new THREE.SphereGeometry(0.035, 10, 6),
        );
      }
    }
  }

  for (const o of windowOpenings(level)) {
    // Framed in dark timber in a plank wall (the island's), else painted white.
    const edge = o.wall.surface === 'planks' ? timber : frame;
    const along = (o.from + o.to) / 2;
    const { width: W, height: H, frame: F, depth: D } = WINDOW;
    const y = (o.bottom + o.top) / 2;
    const put = (
      material: THREE.Material,
      a: number,
      out: number,
      yy: number,
      size: Size3 | Rounded,
      normal: number,
      shadows = false,
    ) => placeOn(group, material, o.alongX, o.centre, normal, a, out, yy, size, shadows);
    // A pane in the middle of the hole, crossed by glazing bars that shade the patch of sun.
    put(glass, along, 0, y, [W, 0.008, H], 1);
    put(edge, along, 0, y, [0.035, 0.03, H], 1, true);
    put(edge, along, 0, y, [W, 0.03, 0.035], 1, true);
    // Linings over the cut edges of the wall all round the hole.
    const L = 0.015;
    put(edge, along, 0, o.top - L / 2, [W, o.thickness, L], 1);
    put(edge, along, 0, o.bottom + L / 2, [W, o.thickness, L], 1);
    put(edge, o.from + L / 2, 0, y, [L, o.thickness, H - 2 * L], 1);
    put(edge, o.to - L / 2, 0, y, [L, o.thickness, H - 2 * L], 1);
    // The same frame and sill on both faces of the wall.
    for (const normal of [1, -1]) {
      const face = o.thickness / 2;
      put(edge, along, face + D / 2, y + H / 2 + F / 2, [W + 2 * F, D, F], normal);
      put(edge, along, face + D / 2, y - H / 2 - F / 2, [W + 2 * F, D, F], normal);
      put(edge, along - W / 2 - F / 2, face + D / 2, y, [F, D, H], normal);
      put(edge, along + W / 2 + F / 2, face + D / 2, y, [F, D, H], normal);
      // The sill, its edges rounded.
      const sill: Size3 = [W + 2 * F + 0.1, 0.1, 0.04];
      put(edge, along, face + 0.05, y - H / 2 - F - 0.02, { rounded: sill }, normal);
    }
  }

  addEaves(group, level);
  addTimberFrames(group, level);
  scene.add(group);
  return group;
}

/**
 * A plank building's timber frame: how wide its posts are, how deep its beams, how far they
 * stand proud of the walls, and the iron straps and bolts at their joints.
 */
const FRAME = {
  colour: 0x4f321c,
  post: 0.26,
  beam: 0.2,
  proud: 0.06,
  strap: { length: 0.3, height: 0.1 },
};
/** How thick the iron straps are, and the bolt heads on them. */
const IRON = { strap: 0.012, bolt: 0.018 };

/** One outside face of a plank building, for its timber frame. */
interface FramedSide {
  /** True when the face runs along x (a north or south wall). */
  alongX: boolean;
  /** The face's coordinate across it (z when `alongX`, else x), and which way is out. */
  outer: number;
  out: number;
  /** Its corners along it. */
  from: number;
  to: number;
  /** The floor the walls stand on, and their tops. */
  floor: number;
  top: number;
}

/**
 * The outside faces of the plank-walled buildings (the walls painted as planks that stand on one
 * floor and touch, taken together as one building): the four sides of the rectangle round them.
 */
function framedSides(level: LevelDef): FramedSide[] {
  const walls = level.boxes.filter(
    (b) => !b.model && b.surface === 'planks' && b.size.y >= WALL_MIN_HEIGHT,
  );
  const slabs = new Map<Slab, BoxDef>(
    walls.map((b) => [
      {
        x0: b.pos.x - b.size.x / 2,
        x1: b.pos.x + b.size.x / 2,
        z0: b.pos.z - b.size.z / 2,
        z1: b.pos.z + b.size.z / 2,
      },
      b,
    ]),
  );
  const sides: FramedSide[] = [];
  for (const building of roofClusters([...slabs.keys()])) {
    const boxes = building.map((r) => slabs.get(r)!);
    const floor = Math.min(...boxes.map(bottomOf));
    const top = Math.max(...boxes.map((b) => b.pos.y + b.size.y / 2));
    const x0 = Math.min(...building.map((r) => r.x0));
    const x1 = Math.max(...building.map((r) => r.x1));
    const z0 = Math.min(...building.map((r) => r.z0));
    const z1 = Math.max(...building.map((r) => r.z1));
    sides.push(
      { alongX: true, outer: z0, out: -1, from: x0, to: x1, floor, top },
      { alongX: true, outer: z1, out: 1, from: x0, to: x1, floor, top },
      { alongX: false, outer: x0, out: -1, from: z0, to: z1, floor, top },
      { alongX: false, outer: x1, out: 1, from: z0, to: z1, floor, top },
    );
  }
  return sides;
}

/**
 * Plank walls (the island's buildings) framed outside in heavy dark timber, as in a storybook
 * pirate town: a post wrapped round each outside corner from the ground to the eaves and a beam
 * along the top of each wall, over its doorways too, each corner strapped with iron plates held
 * by bolts at the top and the foot. Drawn only, and stopped short of whatever stands against a
 * wall outside (a porch's deck and roof), so nothing passes through anything.
 */
function addTimberFrames(parent: THREE.Object3D, level: LevelDef): void {
  const wood = madeAs(
    new THREE.MeshStandardMaterial({ color: FRAME.colour, roughness: 0.85 }),
    'wood',
  );
  const iron = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.5, metalness: 0.6 });
  const T = FRAME.proud;
  // The boxes a piece of the frame would run into: anything but the walls it is fixed to.
  const inTheWay = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) =>
    level.boxes.filter((b) => {
      const h = { x: b.size.x / 2, y: b.size.y / 2, z: b.size.z / 2 };
      return (
        b.pos.x - h.x < x1 - EPS &&
        b.pos.x + h.x > x0 + EPS &&
        b.pos.y - h.y < y1 - EPS &&
        b.pos.y + h.y > y0 + EPS &&
        b.pos.z - h.z < z1 - EPS &&
        b.pos.z + h.z > z0 + EPS
      );
    });
  for (const s of framedSides(level)) {
    const { outer, out, top } = s;
    // A piece `[u0, u1]` along the side, `[o0, o1]` out from the wall's outer face and `[y0,
    // y1]` high, as a box in the world.
    const span = (u0: number, u1: number, o0: number, o1: number) => {
      const [a, b] = [outer + out * o0, outer + out * o1].sort((p, q) => p - q) as [number, number];
      return s.alongX ? { x0: u0, x1: u1, z0: a, z1: b } : { x0: a, x1: b, z0: u0, z1: u1 };
    };
    const piece = (
      material: THREE.Material,
      u0: number,
      u1: number,
      o0: number,
      o1: number,
      y0: number,
      y1: number,
    ) => {
      const r = span(u0, u1, o0, o1);
      const m = new THREE.Mesh(
        bevelBox(r.x1 - r.x0, y1 - y0, r.z1 - r.z0, material === wood ? 0.012 : 0.003),
        material,
      );
      m.position.set((r.x0 + r.x1) / 2, (y0 + y1) / 2, (r.z0 + r.z1) / 2);
      m.castShadow = material === wood;
      m.receiveShadow = true;
      parent.add(m);
    };

    // The corner posts. The sides along x wrap theirs round the corner; the others stop at it.
    const wrap = s.alongX ? T : 0;
    for (const [end, dir] of [
      [s.from, 1],
      [s.to, -1],
    ] as const) {
      const [u0, u1] = [end - dir * wrap, end + dir * FRAME.post].sort((p, q) => p - q) as [
        number,
        number,
      ];
      const r = span(u0, u1, 0, T);
      // From a little into the ground (or the floor, if the ground is higher), up to the eaves,
      // stopped short of a deck below it or a roof over it.
      const ground = groundHeight(level, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
      let y0 = Math.max(s.floor - 0.6, Math.min(s.floor, ground) - 0.04);
      let y1 = top;
      for (const b of inTheWay(r.x0, r.x1, y0, y1, r.z0, r.z1)) {
        const [b0, b1] = [bottomOf(b), b.pos.y + b.size.y / 2];
        if (b1 < (y0 + y1) / 2) y0 = Math.max(y0, b1);
        else if (b0 > (y0 + y1) / 2) y1 = Math.min(y1, b0);
        else y1 = y0;
      }
      if (y1 - y0 < 0.5) continue;
      piece(wood, u0, u1, 0, T, y0, y1);
      // Iron straps across it near its top and its foot, round the corner, each held by bolts.
      const { length: L, height: H } = FRAME.strap;
      const S = IRON.strap;
      // (Round the corner over the end of the post along x there, on the sides along z.)
      const [s0, s1] = [end - dir * (T + S), end + dir * (L - wrap)].sort((p, q) => p - q) as [
        number,
        number,
      ];
      for (const y of [y1 - FRAME.beam - 0.06 - H / 2, y0 + 0.3 + H / 2]) {
        if (y - H / 2 < y0 + 0.05) continue;
        piece(iron, s0, s1, T, T + S, y - H / 2, y + H / 2);
        for (const k of [0.45, 0.8]) {
          const u = end + dir * (L * k - wrap);
          const bolt = new THREE.CylinderGeometry(IRON.bolt, IRON.bolt * 1.15, 0.016, 8);
          const m = new THREE.Mesh(
            s.alongX ? bolt.rotateX(Math.PI / 2) : bolt.rotateZ(Math.PI / 2),
            iron,
          );
          const at = outer + out * (T + S + 0.006);
          m.position.set(s.alongX ? u : at, y, s.alongX ? at : u);
          parent.add(m);
        }
      }
    }

    // The beam along the top, between the posts, a little less proud than they are; cut
    // round what stands against the wall up there.
    const u0 = s.from + FRAME.post;
    const u1 = s.to - FRAME.post;
    const [y0, y1] = [top - FRAME.beam, top];
    const r = span(u0, u1, 0, T * 0.8);
    const holes = inTheWay(r.x0, r.x1, y0, y1, r.z0, r.z1).map((b) => {
      const c = s.alongX ? b.pos.x : b.pos.z;
      const h = (s.alongX ? b.size.x : b.size.z) / 2;
      return { u0: c - h, u1: c + h, v0: 0, v1: 1 };
    });
    for (const p of rectMinusHoles({ u0, u1, v0: 0, v1: 1 }, holes))
      if (p.u1 - p.u0 > 0.3) piece(wood, p.u0, p.u1, 0, T * 0.8, y0, y1);
  }
}

/** A flat roof piece seen from above. */
export interface Slab {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** A strip of rim along a roof's edge: `at` is across the strip's middle, `from`..`to` along it. */
export interface RimStrip {
  alongX: boolean;
  at: number;
  from: number;
  to: number;
}

/** How close two slabs must come to be one roof, and how far past an edge to look for roof. */
const SLAB_TOUCH = 0.05;

/** Splits slabs into roofs: groups of slabs that touch or overlap one another. */
export function roofClusters(slabs: Slab[]): Slab[][] {
  const touching = (a: Slab, b: Slab) =>
    a.x0 <= b.x1 + SLAB_TOUCH &&
    b.x0 <= a.x1 + SLAB_TOUCH &&
    a.z0 <= b.z1 + SLAB_TOUCH &&
    b.z0 <= a.z1 + SLAB_TOUCH;
  const left = [...slabs];
  const clusters: Slab[][] = [];
  while (left.length) {
    const cluster = [left.shift()!];
    for (let i = 0; i < cluster.length; i++) {
      for (let j = left.length - 1; j >= 0; j--) {
        if (touching(cluster[i]!, left[j]!)) cluster.push(...left.splice(j, 1));
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

/** Cuts `[u0, u1]` out of each of the `spans`, keeping what is left either side. */
function cutSpans(spans: [number, number][], u0: number, u1: number): [number, number][] {
  return spans.flatMap(([a, b]) => {
    if (u0 >= b - EPS || u1 <= a + EPS) return [[a, b] as [number, number]];
    const out: [number, number][] = [];
    if (u0 - a > EPS) out.push([a, u0]);
    if (b - u1 > EPS) out.push([u1, b]);
    return out;
  });
}

/**
 * The rim round one roof (slabs that touch or overlap, see `roofClusters`), `over` wide: a
 * strip along every stretch of slab edge with nothing of the roof beyond it. Edges facing
 * another slab of the roof (round a stairwell, or where two pieces meet) get none. The strips
 * along x run round the outside corners, past the end by `over`, and the strips along z fit
 * between them; at an inside corner (where the roof is L-shaped) the strip along x stops at
 * the corner and the one along z stands back from it, so no two strips lie in the same place.
 */
export function roofRim(slabs: Slab[], over: number): RimStrip[] {
  const roofAt = (x: number, z: number) =>
    slabs.some((s) => x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1);
  // Every exposed stretch of edge, by the line it lies on and which way it faces, joined up
  // where two slabs' edges run on from each other so no stretch is covered twice.
  const lines = new Map<
    string,
    { alongX: boolean; at: number; normal: number; spans: [number, number][] }
  >();
  for (const s of slabs) {
    for (const alongX of [true, false]) {
      for (const normal of [-1, 1]) {
        const at = alongX ? (normal < 0 ? s.z0 : s.z1) : normal < 0 ? s.x0 : s.x1;
        let spans: [number, number][] = alongX ? [[s.x0, s.x1]] : [[s.z0, s.z1]];
        for (const c of slabs) {
          if (c === s) continue;
          // Anything of the roof beyond this edge's line covers the edge where it overlaps.
          const beyond = alongX
            ? normal < 0
              ? c.z0 < at - EPS
              : c.z1 > at + EPS
            : normal < 0
              ? c.x0 < at - EPS
              : c.x1 > at + EPS;
          if (beyond) spans = cutSpans(spans, alongX ? c.x0 : c.z0, alongX ? c.x1 : c.z1);
        }
        if (!spans.length) continue;
        const key = `${alongX ? 'x' : 'z'}:${at.toFixed(4)}:${normal}`;
        const line = lines.get(key) ?? { alongX, at, normal, spans: [] };
        line.spans.push(...spans);
        lines.set(key, line);
      }
    }
  }
  const strips: RimStrip[] = [];
  for (const { alongX, at, normal, spans } of lines.values()) {
    spans.sort((a, b) => a[0] - b[0]);
    const joined: [number, number][] = [];
    for (const span of spans) {
      const last = joined[joined.length - 1];
      if (last && span[0] <= last[1] + EPS) last[1] = Math.max(last[1], span[1]);
      else joined.push([...span]);
    }
    for (const [u0, u1] of joined) {
      // Past each end of the stretch, just outside the edge: roof there means an inside corner.
      const inside = (u: number, dir: number) =>
        alongX
          ? roofAt(u + dir * SLAB_TOUCH, at + normal * SLAB_TOUCH)
          : roofAt(at + normal * SLAB_TOUCH, u + dir * SLAB_TOUCH);
      const start = inside(u0, -1);
      const end = inside(u1, 1);
      const from = alongX ? (start ? u0 : u0 - over) : start ? u0 + over : u0;
      const to = alongX ? (end ? u1 : u1 + over) : end ? u1 - over : u1;
      if (to - from > EPS) strips.push({ alongX, at: at + (normal * over) / 2, from, to });
    }
  }
  return strips;
}

/**
 * The roof's eaves: a rim round each roof, as thick as it, reaching past the walls like a real
 * roof's. Drawn only, so the roof you walk on still ends at the walls and the ladder still
 * reaches it; the rim leaves a gap where a ladder's top comes up past it. The flat boxes at one
 * height that touch make one roof (the upper floor's pieces round the stairwell and the roof
 * over the break room run round the whole house together), and the rim goes round its outline:
 * see `roofRim`. Roofs standing apart at one height (a mirrored house, the tents of a camp, the
 * carriages of a train) each get their own.
 */
function addEaves(parent: THREE.Object3D, level: LevelDef): void {
  const O = EAVE.overhang;
  // (As high over the ground under them as walls are tall: on hills, over the ground there.)
  const flat = level.boxes.filter(
    (b) =>
      !b.model &&
      !b.tiltX &&
      b.size.y <= ROOF_MAX_THICKNESS &&
      bottomOf(b) - groundHeight(level, b.pos.x, b.pos.z) >= WALL_MIN_HEIGHT,
  );
  const heights = [...new Set(flat.map((b) => b.pos.y))];
  for (const y of heights) {
    const parts = flat.filter((b) => b.pos.y === y);
    const slabOf = new Map<Slab, BoxDef>(
      parts.map((b) => [
        {
          x0: b.pos.x - b.size.x / 2,
          x1: b.pos.x + b.size.x / 2,
          z0: b.pos.z - b.size.z / 2,
          z1: b.pos.z + b.size.z / 2,
        },
        b,
      ]),
    );
    for (const roof of roofClusters([...slabOf.keys()])) {
      const r = slabOf.get(roof[0]!)!;
      const x0 = Math.min(...roof.map((s) => s.x0));
      const x1 = Math.max(...roof.map((s) => s.x1));
      const z0 = Math.min(...roof.map((s) => s.z0));
      const z1 = Math.max(...roof.map((s) => s.z1));
      if (x1 - x0 < ROOF_MIN_SPAN || z1 - z0 < ROOF_MIN_SPAN) continue;
      const material = madeAs(
        new THREE.MeshStandardMaterial({ color: r.colour, roughness: 0.8 }),
        r.surface,
      );
      for (const s of roofRim(roof, O)) {
        const holes = level.ladders
          .filter(
            (l) =>
              Math.abs((s.alongX ? l.pos.z : l.pos.x) - s.at) <= O / 2 + EAVE.ladderGap &&
              l.pos.y + l.height > y,
          )
          .map((l) => {
            const along = s.alongX ? l.pos.x : l.pos.z;
            const half = l.width / 2 + EAVE.ladderGap;
            return { u0: along - half, u1: along + half, v0: 0, v1: 1 };
          });
        for (const piece of rectMinusHoles({ u0: s.from, u1: s.to, v0: 0, v1: 1 }, holes)) {
          const length = piece.u1 - piece.u0;
          const mid = (piece.u0 + piece.u1) / 2;
          const m = new THREE.Mesh(
            s.alongX
              ? new THREE.BoxGeometry(length, r.size.y, O)
              : new THREE.BoxGeometry(O, r.size.y, length),
            material,
          );
          m.position.set(s.alongX ? mid : s.at, y, s.alongX ? s.at : mid);
          m.castShadow = m.receiveShadow = true;
          // Lit like the outside of the roof it carries on from.
          m.userData[OUTSIDE_HALF] = true;
          parent.add(m);
        }
      }
    }
  }
}
