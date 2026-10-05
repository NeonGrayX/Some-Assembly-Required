import * as THREE from 'three';
import type { BoxDef, LevelDef, WindowDef } from '@sar/shared';

/**
 * Trim that makes the house read as a house: baseboards, framed doorways with their doors
 * swung open against the wall, and glazed windows the sun shines in through. All of it is drawn
 * only, with nothing added to the physics, so nobody can trip on a baseboard and every doorway
 * stays as wide as it was. The window holes are only drawn too: the glass still stops players.
 *
 * Rooms are the level's floor decals and walls are the full-height boxes around them, so the
 * baseboards and doorways follow the walls by themselves if the layout changes.
 */

/** Boxes at least this tall, standing on the floor, count as walls. */
const WALL_MIN_HEIGHT = 2.4;
/** Gaps in a wall at least this wide are doorways. */
const MIN_DOORWAY = 0.6;
const EPS = 0.01;

const BASEBOARD = { height: 0.1, depth: 0.02 };
const CASING = { width: 0.09, depth: 0.025 };
/** How far the head casing's ledge sticks out past the casing, and how tall it is. */
const LEDGE = { overhang: 0.03, height: 0.04 };
const DOOR = { thickness: 0.045, maxWidth: 1 };
const WINDOW = { width: 1.3, height: 1, sill: 1.25, frame: 0.06, depth: 0.04 };

/** One side of a room: the line of the wall's inner face and which way the room lies. */
export interface RoomSide {
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
  /** Openings between them wide enough to walk through, up to the header over them. */
  doorways: { from: number; to: number; thickness: number; height: number }[];
}

/** The house's default windows, for levels that name none: kept clear of the counter, sofa, fridge, lockers and the ladder. */
export const HOUSE_WINDOWS: WindowDef[] = [
  // South wall, either side of the front door.
  { x: -8, z: 6, alongX: true },
  { x: 7.5, z: 6, alongX: true },
  // North wall: over the kitchen counter, over the sofa, in the break room.
  { x: -8, z: 15, alongX: true },
  { x: 0, z: 15, alongX: true },
  { x: 8, z: 15, alongX: true },
  // End walls.
  { x: -12, z: 10, alongX: false },
  { x: 12, z: 9.5, alongX: false },
];

const isWall = (b: BoxDef) =>
  !b.tiltX && b.size.y >= WALL_MIN_HEIGHT && Math.abs(b.pos.y - b.size.y / 2) < EPS;

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

/** Where each window cuts through its wall. Windows off every wall are skipped. */
export function windowOpenings(level: LevelDef, windows: WindowDef[]): WindowOpening[] {
  const walls = level.boxes.filter(isWall);
  const openings: WindowOpening[] = [];
  for (const w of windows) {
    const wall = walls.find(
      (b) =>
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
      bottom: WINDOW.sill,
      top: WINDOW.sill + WINDOW.height,
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
  const walls = level.boxes.filter(isWall);
  const sides: RoomSide[] = [];
  for (const room of level.decals) {
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
          height: headerHeight(level, alongX, line, (a.to + b.from) / 2),
        });
      }
      sides.push({ alongX, face, normal, from, to, walls: onSide, doorways });
    }
  }
  return sides;
}

/** Bottom of the header box over a doorway, or the top of the walls if it has none. */
function headerHeight(level: LevelDef, alongX: boolean, line: number, mid: number): number {
  let height = Infinity;
  let top = 0;
  for (const b of level.boxes) {
    const across = Math.abs((alongX ? b.pos.z : b.pos.x) - line);
    const along = Math.abs((alongX ? b.pos.x : b.pos.z) - mid);
    if (across > EPS || along > (alongX ? b.size.x : b.size.z) / 2) continue;
    const bottom = b.pos.y - b.size.y / 2;
    if (bottom > 1.5) height = Math.min(height, bottom);
    top = Math.max(top, b.pos.y + b.size.y / 2);
  }
  return Number.isFinite(height) ? height : top;
}

type Size3 = [number, number, number];

/**
 * Adds a box laid out against a wall: `along` and `size[0]` run along the wall, `out` is how
 * far its centre sits from the face line into the room, `size[1]` its depth away from the wall.
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
  [w, d, h]: Size3,
  shadows = false,
): THREE.Mesh {
  const geometry = alongX ? new THREE.BoxGeometry(w, h, d) : new THREE.BoxGeometry(d, h, w);
  const m = new THREE.Mesh(geometry, material);
  const across = face + normal * out;
  m.position.set(alongX ? along : across, y, alongX ? across : along);
  m.receiveShadow = true;
  m.castShadow = shadows;
  parent.add(m);
  return m;
}

/** Is this point on the floor inside one of the rooms? */
function inRoom(level: LevelDef, x: number, z: number): boolean {
  return level.decals.some(
    (d) => Math.abs(x - d.pos.x) < d.size.x / 2 && Math.abs(z - d.pos.z) < d.size.z / 2,
  );
}

/** Adds the house trim to `scene`. Nothing in it moves, so `mergeStatic` bakes it in. */
export function addHouseDetails(
  scene: THREE.Object3D,
  level: LevelDef,
  windows: WindowDef[],
): void {
  const trim = new THREE.MeshStandardMaterial({ color: 0x7d5a3c, roughness: 0.7 });
  const door = new THREE.MeshStandardMaterial({ color: 0xa8774c, roughness: 0.7 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x956840, roughness: 0.7 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.7, roughness: 0.3 });
  const frame = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.6 });
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
      size: Size3,
      shadows = false,
      normal = s.normal,
      face = s.face,
    ) => placeOn(group, material, s.alongX, face, normal, along, out, y, size, shadows);

    // Baseboards: run into the corners, stop at doorways (the casing covers the cut end).
    for (const w of s.walls) {
      const from = w.from - (w.from - s.from < EPS ? BASEBOARD.depth : 0);
      const to = w.to + (s.to - w.to < EPS ? BASEBOARD.depth : 0);
      put(trim, (from + to) / 2, BASEBOARD.depth / 2, BASEBOARD.height / 2, [
        to - from,
        BASEBOARD.depth,
        BASEBOARD.height,
      ]);
    }

    for (const d of s.doorways) {
      const height = d.height;
      // Wall face on the far side of this doorway, and whether that side is outdoors.
      const farFace = s.face - s.normal * d.thickness;
      const mid = (d.from + d.to) / 2;
      const beyond = farFace - s.normal * 0.4;
      const outdoors = !inRoom(level, s.alongX ? mid : beyond, s.alongX ? beyond : mid);
      // Casing on this face, and on the outside too since no room will add one there.
      const faces: [number, number][] = [[s.face, s.normal]];
      if (outdoors) faces.push([farFace, -s.normal]);
      const span = d.to - d.from + 2 * CASING.width;
      for (const [face, normal] of faces) {
        for (const edge of [d.from - CASING.width / 2, d.to + CASING.width / 2]) {
          put(
            trim,
            edge,
            CASING.depth / 2,
            height / 2,
            [CASING.width, CASING.depth, height],
            false,
            normal,
            face,
          );
        }
        // Head casing across the top, with a little ledge resting on it.
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
          [span + 2 * LEDGE.overhang, ledgeDepth, LEDGE.height],
          false,
          normal,
          face,
        );
      }

      // The rest is shared by both rooms of an inner doorway, so only the first one adds it.
      const key = `${s.alongX}:${(s.face - (s.normal * d.thickness) / 2).toFixed(2)}:${mid.toFixed(2)}`;
      if (doorways.has(key)) continue;
      doorways.add(key);

      // Jamb linings over the cut ends of the wall, and under the header.
      const lining = d.thickness + 2 * CASING.depth;
      for (const edge of [d.from + 0.01, d.to - 0.01]) {
        put(trim, edge, -d.thickness / 2, height / 2, [0.02, lining, height]);
      }
      put(trim, mid, -d.thickness / 2, height - 0.01, [d.to - d.from, lining, 0.02]);

      // Double doors, swung open flat against the wall on this side.
      const leaf = Math.min(DOOR.maxWidth, (d.to - d.from) / 2);
      for (const [hinge, dir] of [
        [d.from, -1],
        [d.to, 1],
      ] as const) {
        const centre = hinge + (dir * leaf) / 2;
        const out = CASING.depth + DOOR.thickness / 2;
        // As tall as the opening, less a small gap at the floor and under the lining.
        const tall = height - 0.04;
        put(door, centre, out, 0.01 + tall / 2, [leaf, DOOR.thickness, tall], true);
        // Two raised panels on the face that shows, and a knob near the free edge.
        const panelOut = out + DOOR.thickness / 2 + 0.006;
        const lower = 0.75;
        const upper = tall - lower - 0.4;
        put(panel, centre, panelOut, 0.15 + lower / 2, [leaf - 0.26, 0.012, lower]);
        put(panel, centre, panelOut, tall - 0.15 - upper / 2, [leaf - 0.26, 0.012, upper]);
        const knob = put(
          brass,
          hinge + dir * (leaf - 0.09),
          panelOut + 0.03,
          1.0,
          [0.05, 0.05, 0.05],
        );
        knob.geometry.dispose();
        knob.geometry = new THREE.SphereGeometry(0.035, 10, 6);
      }
    }
  }

  for (const o of windowOpenings(level, windows)) {
    const along = (o.from + o.to) / 2;
    const { width: W, height: H, frame: F, depth: D } = WINDOW;
    const y = (o.bottom + o.top) / 2;
    const put = (
      material: THREE.Material,
      a: number,
      out: number,
      yy: number,
      size: Size3,
      normal: number,
      shadows = false,
    ) => placeOn(group, material, o.alongX, o.centre, normal, a, out, yy, size, shadows);
    // A pane in the middle of the hole, crossed by glazing bars that shade the patch of sun.
    put(glass, along, 0, y, [W, 0.008, H], 1);
    put(frame, along, 0, y, [0.035, 0.03, H], 1, true);
    put(frame, along, 0, y, [W, 0.03, 0.035], 1, true);
    // Linings over the cut edges of the wall all round the hole.
    const L = 0.015;
    put(frame, along, 0, o.top - L / 2, [W, o.thickness, L], 1);
    put(frame, along, 0, o.bottom + L / 2, [W, o.thickness, L], 1);
    put(frame, o.from + L / 2, 0, y, [L, o.thickness, H - 2 * L], 1);
    put(frame, o.to - L / 2, 0, y, [L, o.thickness, H - 2 * L], 1);
    // The same frame and sill on both faces of the wall.
    for (const normal of [1, -1]) {
      const face = o.thickness / 2;
      put(frame, along, face + D / 2, y + H / 2 + F / 2, [W + 2 * F, D, F], normal);
      put(frame, along, face + D / 2, y - H / 2 - F / 2, [W + 2 * F, D, F], normal);
      put(frame, along - W / 2 - F / 2, face + D / 2, y, [F, D, H], normal);
      put(frame, along + W / 2 + F / 2, face + D / 2, y, [F, D, H], normal);
      put(frame, along, face + 0.05, y - H / 2 - F - 0.02, [W + 2 * F + 0.1, 0.1, 0.04], normal);
    }
  }

  scene.add(group);
}

/** The windows `level` has: its own if it names them, otherwise the house's default ones. */
export const levelWindows = (level: LevelDef): WindowDef[] => level.windows ?? HOUSE_WINDOWS;
