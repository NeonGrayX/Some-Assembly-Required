import type { Vec3 } from '../math.ts';
import { BRICK_TYPES, STUD } from '../bricks.ts';
import type { BoxDef, DogDef, FloorRect, LevelDef, SiteDef } from './house.ts';

/**
 * The wall between the two teams' yards in rival mode: low enough to see the other team over,
 * with a gate in the middle, since anyone may walk over (and only act on their own side).
 */
export const RIVAL_WALL = { height: 1.0, thickness: 0.3, gate: 3 };
/** The copy's bins and hiding places get ids from here on, past the base's. */
export const RIVAL_ID_OFFSET = 1000;

const FLIP_FRONT: Record<NonNullable<BoxDef['front']>, NonNullable<BoxDef['front']>> = {
  '-z': '+z',
  '+z': '-z',
  '-x': '+x',
  '+x': '-x',
};

/**
 * The level for rival teams: `base` and a copy of it turned half round about the middle of
 * the base's south fence, so the two yards face each other across that line, which becomes a
 * low wall with a gate. The copy is a second job site with its own house, bins, inspector,
 * Done button, bell, corkboard, pages' hiding spots and treat jar; there is one dog, whose
 * walks join through the gate, and the base's broom and catapult.
 */
export function rivalLevel(base: LevelDef): LevelDef {
  const half = base.floorSize / 2;
  /** The dividing line: the base yard's south fence. */
  const zm = -half;
  const T = (p: Vec3): Vec3 => ({ x: -p.x, y: p.y, z: 2 * zm - p.z });
  const turn = (facing: number) => facing + Math.PI;
  const rect = (r: FloorRect): FloorRect => ({
    x0: -r.x1,
    x1: -r.x0,
    z0: 2 * zm - r.z1,
    z1: 2 * zm - r.z0,
  });
  const isFence = (b: BoxDef) =>
    !b.model && Math.abs(b.pos.z - zm) < 0.5 && b.size.x >= base.floorSize - 1;
  const fence = base.boxes.find(isFence);
  const kept = base.boxes.filter((b) => !isFence(b));
  const copyBox = (b: BoxDef): BoxDef => ({
    ...b,
    pos: T(b.pos),
    ...(b.tiltX ? { tiltX: -b.tiltX } : {}),
    ...(b.front ? { front: FLIP_FRONT[b.front] } : {}),
  });
  // The dividing wall: two low pieces either side of the gate.
  const inner = RIVAL_WALL.gate / 2;
  const wall: BoxDef[] = [-1, 1].map((s) => ({
    pos: { x: (s * (inner + half)) / 2, y: RIVAL_WALL.height / 2, z: zm },
    size: { x: half - inner, y: RIVAL_WALL.height, z: RIVAL_WALL.thickness },
    colour: fence?.colour ?? 0xd8cfc0,
  }));
  const n = base.dog.points.length;
  const gate = nearest(base.dog.points, { x: 0, y: 0, z: zm });
  const dog: DogDef = {
    points: [...base.dog.points, ...base.dog.points.map(T)],
    links: [
      ...base.dog.links,
      ...base.dog.links.map(([a, b]) => [a + n, b + n] as [number, number]),
      // Through the gate to the other yard.
      [gate, gate + n],
    ],
    start: base.dog.start,
    treatJar: base.dog.treatJar,
    treatJars: [...(base.dog.treatJars ?? []), T(base.dog.treatJar)],
  };
  const plate = BRICK_TYPES.baseplate16.studsX * STUD;
  const corner = T(base.baseplate);
  const site: SiteDef = {
    // The plate's far corner lands where its near corner was: back off by its size.
    baseplate: { x: corner.x - plate, y: corner.y, z: corner.z - plate },
    inspector: { pos: T(base.inspector.pos), size: base.inspector.size },
    doneButton: T(base.doneButton),
    bell: T(base.bell),
    board: { pos: T(base.board.pos), facing: turn(base.board.facing) },
    ...(base.moreBoards
      ? { moreBoards: base.moreBoards.map((b) => ({ pos: T(b.pos), facing: turn(b.facing) })) }
      : {}),
    spawn: T(base.spawn),
  };
  const holes = base.groundHoles ?? (base.groundHole ? [base.groundHole] : []);
  const level: LevelDef = {
    ...base,
    floor: { x0: -half, x1: half, z0: 2 * zm - half, z1: half },
    boxes: [...kept, ...wall, ...kept.map(copyBox)],
    decals: [...base.decals, ...base.decals.map((d) => ({ ...d, pos: T(d.pos) }))],
    bins: [
      ...base.bins,
      ...base.bins.map((b) => ({
        ...b,
        id: b.id + RIVAL_ID_OFFSET,
        pos: T(b.pos),
        // Turned half round with the copy, so a rack's bins still face out of their rack.
        ...(b.tilt || b.facing ? { facing: turn(b.facing ?? 0) } : {}),
      })),
    ],
    pageSpots: [...base.pageSpots, ...base.pageSpots.map(T)],
    ...(base.printShelves
      ? {
          printShelves: [
            ...base.printShelves,
            ...base.printShelves.map((places) =>
              places.map((p) => ({ ...p, pos: T(p.pos), facing: turn(p.facing ?? 0) })),
            ),
          ],
        }
      : {}),
    hideouts: [
      ...base.hideouts,
      ...base.hideouts.map((h) => ({
        ...h,
        id: h.id + RIVAL_ID_OFFSET,
        pos: T(h.pos),
        facing: turn(h.facing),
      })),
    ],
    ladders: [
      ...base.ladders,
      ...base.ladders.map((l) => ({ ...l, pos: T(l.pos), facing: turn(l.facing) })),
    ],
    lights: [...base.lights, ...base.lights.map(T)],
    dog,
    sites: [...(base.sites ?? []), site],
    divide: { z: zm },
    groundHoles: [...holes, ...holes.map(rect)],
  };
  if (base.water) level.water = [...base.water, ...base.water.map(rect)];
  delete level.groundHole;
  if (base.windows) {
    level.windows = [
      ...base.windows,
      ...base.windows.map((w) => ({ ...w, x: -w.x, z: 2 * zm - w.z })),
    ];
  }
  if (base.doors) {
    level.doors = [
      ...base.doors,
      ...base.doors.map((d) => ({ ...d, x: -d.x, z: 2 * zm - d.z, opensTo: -d.opensTo })),
    ];
  }
  if (base.stairs) {
    level.stairs = [
      ...base.stairs,
      ...base.stairs.map((s) => ({ ...s, pos: T(s.pos), facing: turn(s.facing) })),
    ];
  }
  return level;
}

/** Index of the point closest to `to`. */
function nearest(points: Vec3[], to: Vec3): number {
  let best = 0;
  let bestD = Infinity;
  points.forEach((p, i) => {
    const d = Math.hypot(p.x - to.x, p.z - to.z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** Which side of a rival level a point is on (0 above the line, 1 below), or null if undivided. */
export function sideOf(level: LevelDef, p: Vec3): 0 | 1 | null {
  if (!level.divide) return null;
  return p.z > level.divide.z ? 0 : 1;
}
