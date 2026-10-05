import * as THREE from 'three';
import { atNight } from './daynight.ts';
import type { BoxDef, LevelDef } from '@sar/shared';

/**
 * Trim that makes the house read as a house: baseboards, framed doorways with their doors
 * swung open against the wall, and windows. All of it is drawn only, with nothing added to the
 * physics, so nobody can trip on a baseboard and every doorway stays as wide as it was.
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

/** A window centred on a wall, given by a point on the wall's centre line. */
export interface WindowDef {
  x: number;
  z: number;
  alongX: boolean;
}

/** Windows of the house: kept clear of the counter, sofa, fridge, lockers and the ladder. */
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
  // The glass shows a bright sky by day and goes dark at night.
  const glass = atNight(
    new THREE.MeshStandardMaterial({
      color: 0xb9d8ee,
      emissive: 0x5d86a6,
      roughness: 0.15,
      metalness: 0.2,
    }),
    0.05,
  );
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

  const walls = level.boxes.filter(isWall);
  for (const w of windows) {
    const wall = walls.find(
      (b) =>
        Math.abs(w.x - b.pos.x) <= b.size.x / 2 + EPS &&
        Math.abs(w.z - b.pos.z) <= b.size.z / 2 + EPS,
    );
    if (!wall) continue;
    const thickness = w.alongX ? wall.size.z : wall.size.x;
    const along = w.alongX ? w.x : w.z;
    const centre = w.alongX ? w.z : w.x;
    const { width: W, height: H, frame: F, depth: D } = WINDOW;
    const y = WINDOW.sill + H / 2;
    // The same window on both faces of the wall.
    for (const normal of [1, -1]) {
      const face = centre + (normal * thickness) / 2;
      const put = (material: THREE.Material, a: number, out: number, yy: number, size: Size3) =>
        placeOn(group, material, w.alongX, face, normal, a, out, yy, size);
      put(glass, along, 0.004, y, [W, 0.008, H]);
      // Frame, then a cross of glazing bars.
      put(frame, along, D / 2, y + H / 2 + F / 2, [W + 2 * F, D, F]);
      put(frame, along, D / 2, y - H / 2 - F / 2, [W + 2 * F, D, F]);
      put(frame, along - W / 2 - F / 2, D / 2, y, [F, D, H]);
      put(frame, along + W / 2 + F / 2, D / 2, y, [F, D, H]);
      put(frame, along, D / 4, y, [0.035, D / 2, H]);
      put(frame, along, D / 4, y, [W, D / 2, 0.035]);
      // Sill under it.
      put(frame, along, 0.05, y - H / 2 - F - 0.02, [W + 2 * F + 0.1, 0.1, 0.04]);
    }
  }

  scene.add(group);
}
