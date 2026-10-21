import { yawQuat } from '../../math.ts';
import type { Vec3 } from '../../math.ts';
import {
  MACHINES,
  TRASH_BIN_SIZE,
  VACUUM_FROM_WALL,
  isTrashBin,
  machineAt,
  trashBin,
} from '../house.ts';
import type {
  BoxDef,
  FloorRect,
  GadgetDef,
  HideoutDef,
  HideoutKind,
  InteriorDef,
  LevelDef,
  MachineDef,
  MachineKind,
  ParkingDef,
  MeshDef,
  SceneryDef,
} from '../house.ts';
import {
  DOG_CLEAR,
  WEST,
  addGroundPageSpots,
  clearWalk,
  dogNetwork,
  firstGoodLayout,
  gen,
  gridPoints,
  grow,
  rect,
  standTrashBins,
  tidy,
} from './common.ts';
import { RIVAL_WALL } from '../rival.ts';
import { CHEVRON_SCENE } from './chevronScene.ts';

export { CHEVRON_SCENE };

/**
 * Chevron Street: the car scene as a map, laid out as its plan has it. Along the north two
 * houses, the small one the site office with the quality inspector beside it; across the middle
 * a street closed at both ends for the build, marked out in parking bays, road works dug in one
 * lane by the crossing; along the south the build lot, the job site in its middle and the brick
 * works round it, a hoarding along its south edge. It is drawn with the car scene's own models (see `SceneryDef`); what is solid in them,
 * and where their hiding places and the stations are, is worked out from those models and kept
 * in `chevronScene.ts`, in the level's own axes. Every round the bus parks in one of the two long
 * bays, its door to the kerb, and the two cars in two of the three short ones, each facing one
 * way or the other; and a few of the cupboards are left empty. No bin stands in the road.
 * Brick Meetings are held in the bus, down its aisle.
 */

/** A box: its middle and its size, x y z each. */
export type SceneBox = [number, number, number, number, number, number];
/** A room: its floor's rectangle, x0 z0 x1 z1, and its floor's and ceiling's heights. */
export type SceneRoom = [number, number, number, number, number, number];
/** A parking bay's rectangle, x0 z0 x1 z1. */
export type SceneBay = [number, number, number, number];

/** What `chevronScene.ts` holds: the car scene's solids and places, in its own axes. */
export interface ChevronScene {
  /**
   * What is solid and stays put, roughly: what the map is laid out by (its pages, its bins, the
   * dog's walks). What is met is the models themselves (see `CHEVRON_MESH`).
   */
  boxes: SceneBox[];
  /** The houses' walls, full height and thin. */
  walls: SceneBox[];
  /** The big house's roof's slopes: boxes tilted about x, the tilt last. */
  roofs: [...SceneBox, number][];
  /** What of each vehicle the map is laid out by, as it parks, and the middle it is turned about. */
  vehicles: Record<'car' | 'sports', SceneVehicle> & {
    bus: SceneVehicle & { cabin: SceneRoom };
  };
  /**
   * The doors and lids that hide pages: their kind, middle, size and the way they face; and a
   * door's swing as drawn opening (0 for a lid or a cover), 1 if it is hung on its right, and
   * its leaf where it is smaller than the front (see `HideoutDef.door`): width, height, across
   * and up.
   */
  hideouts: [
    HideoutKind,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    [number, number, number, number]?,
  ][];
  /**
   * The scene's other things a click works (a lamp, a tap, the hob…), numbered from 1: for each
   * of its handles, the box it is clicked in as it starts and the one once it has been clicked.
   */
  gadgets: [number, ...SceneBox, ...SceneBox][];
  /**
   * The street's bins: each one's box, the way its front faces (a yaw, as the hiding places'),
   * and its colour.
   */
  bins: [...SceneBox, number, number][];
  /** The road between the kerbs, x0 z0 x1 z1: no bin stands on it. */
  road: SceneBay;
  /** The parking bays, x0 z0 x1 z1: the long ones the bus's, the short ones the cars'. */
  bays: { long: SceneBay[]; short: SceneBay[] };
  /** The power cabinet, which a saboteur cuts the power at. */
  panel: SceneBox;
  /** Inside the houses. */
  rooms: SceneRoom[];
  /**
   * The job site: the baseplate's corner, x y z; the Done button's and the bell's feet, x z; the
   * boards' middles, x y z, and the way each faces; and the inspector's pad, x z and its size.
   */
  site: {
    baseplate: [number, number, number];
    done: [number, number];
    bell: [number, number];
    boards: [number, number, number, number][];
    inspector: [number, number, number];
  };
  /** The brick works' machines, where they stand and the way they face. */
  machines: [MachineKind, number, number, number][];
  /** The ladder up the big house: its foot, x z, its height and the way it is climbed. */
  ladder: [number, number, number, number];
  /** Where players start. */
  start: [number, number];
  /** The treat jar, on the big house's kitchen island. */
  jar: [number, number, number];
}

interface SceneVehicle {
  middle: [number, number];
  boxes: SceneBox[];
}

/** Where the car scene's own origin lies in the level: on the level's. */
export const CHEVRON_ORIGIN = { x: 0, z: 0 };
/** Half the map's side. */
export const CHEVRON_HALF = 16;
/** How high the walls nobody sees round the map's edge stand. */
const EDGE_HIGH = 9;

const COLLIDER = 0x808080;
/** How many of the cupboards hide nothing in a round. */
const EMPTY_CUPBOARDS = 3;
/** How near a parked vehicle a hiding place is buried, and hides nothing. */
const BURIED = 0.4;

/**
 * The meeting places: down the bus's aisle in single file, from its tail, each this far along
 * from the one behind.
 */
const AISLE = { tail: 0.33, step: 0.55, seats: 10 };

/**
 * The vacuum's dock on the site office's side wall, where it is kept (see `vacuumDock` in the
 * client), in the vacuum's own frame, its back toward the wall: how far behind its head the
 * wall's face is (it stands 0.3 m out from the inside of the wall, 0.16 thick, and the lean on
 * top of that), and the house's plinth along the wall's foot, how high it is and how far it
 * stands out from it; and the dock's base on the floor, up against the plinth, which is solid:
 * how wide it is, how far behind the head its front is, and how high.
 */
export const VACUUM_DOCK = {
  wall: Math.round((0.3 - 0.16 + VACUUM_FROM_WALL) * 1000) / 1000,
  plinth: { high: 0.3, out: 0.1 },
  width: 0.36,
  from: 0.1,
  height: 0.045,
};

/** The dock's base, solid, for a vacuum kept leaning at `at` facing `facing`. */
function dockBase(at: Vec3, facing: number): BoxDef {
  const { wall, plinth, width, from, height } = VACUUM_DOCK;
  const depth = wall - plinth.out - from;
  const [s, c] = [Math.sin(facing), Math.cos(facing)];
  const back = from + depth / 2;
  return {
    pos: { x: tidy(at.x + s * back), y: tidy(at.y + height / 2), z: tidy(at.z + c * back) },
    size: {
      x: tidy(Math.abs(c) * width + Math.abs(s) * depth),
      y: height,
      z: tidy(Math.abs(s) * width + Math.abs(c) * depth),
    },
    colour: COLLIDER,
    model: 'collider',
  };
}

/** The side a box faces whose front looks along yaw `facing`, to the nearest quarter. */
function frontFacing(facing: number): NonNullable<BoxDef['front']> {
  const q = ((Math.round(facing / (Math.PI / 2)) % 4) + 4) % 4;
  return (['-z', '-x', '+z', '+x'] as const)[q]!;
}

const middleOf = (b: SceneBay): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

/** How high a step the dog takes, with room to spare (it climbs 0.2 m: see `Dog`). */
const DOG_STEP = 0.16;

/** Whether a box of the scene is a broad step up off the ground: a pavement or a pad. */
const isStep = (b: readonly number[]) =>
  b[1]! - b[4]! / 2 < 0.01 && b[1]! + b[4]! / 2 <= DOG_STEP && Math.min(b[3]!, b[5]!) >= 1;

export function chevronTry(seed: number): LevelDef {
  const g = gen(seed);
  const S = CHEVRON_SCENE;
  const { x: ox, z: oz } = CHEVRON_ORIGIN;
  const at = (x: number, y: number, z: number): Vec3 => ({
    x: tidy(x + ox),
    y: tidy(y),
    z: tidy(z + oz),
  });
  const solid = (b: readonly number[], extra: Partial<BoxDef> = {}): BoxDef => ({
    pos: at(b[0]!, b[1]!, b[2]!),
    size: { x: b[3]!, y: b[4]!, z: b[5]! },
    colour: COLLIDER,
    model: 'collider',
    // The pavements and pads: the dog steps up onto them as the players do.
    ...(isStep(b) ? { step: true as const } : {}),
    ...extra,
  });
  const roomRect = (r: SceneRoom): FloorRect => rect(r[0] + ox, r[1] + oz, r[2] + ox, r[3] + oz);

  // The parking shuffle: the bus in one of the long bays with its door to the kerb (as the
  // scene first parks it in the first, turned in the other), and the cars in two of the short
  // ones each turned either way; the rest stand empty.
  const shorts = g.shuffle([...S.bays.short]);
  const bus = g.int(0, S.bays.long.length - 1);
  const [busX, busZ] = middleOf(S.bays.long[bus]!);
  const park = (vehicle: ParkingDef['vehicle'], b: SceneBay): ParkingDef => {
    const [x, z] = middleOf(b);
    return { vehicle, x, z, turned: g.chance(0.5) };
  };
  const parked: ParkingDef[] = [
    park('car', shorts[0]!),
    park('sports', shorts[1]!),
    { vehicle: 'bus', x: busX, z: busZ, turned: bus !== 0 },
  ];
  // The scene's models, met as they are drawn (see `CHEVRON_MESH`); the rough boxes round them,
  // the houses' walls and the big house's roof among them, only lay the map out.
  const meshes: MeshDef[] = [{ mesh: 'chevron', at: at(0, 0, 0) }];
  const boxes: BoxDef[] = [
    ...S.boxes.map((b) => solid(b, { rough: true })),
    ...S.walls.map((b): BoxDef => ({
      pos: at(b[0], b[1], b[2]),
      size: { x: b[3], y: b[4], z: b[5] },
      colour: COLLIDER,
      role: 'wall',
      rough: true,
    })),
    ...S.roofs.map((b) => solid(b, { tiltX: b[6], rough: true })),
    // The street's bins, drawn as the car scene draws them (as all the bins here are).
    ...S.bins.map((b) =>
      solid(b, { model: 'streetBin', scenery: true, front: frontFacing(b[6]), colour: b[7] }),
    ),
    solid(S.panel, { model: 'panel' }),
  ];
  const interiors: InteriorDef[] = S.rooms.map((r) => ({
    rect: roomRect(r),
    y0: r[4],
    y1: r[5],
  }));
  // The vehicles where they park: what is solid of them, in the scene's axes.
  const parkedBoxes: SceneBox[] = [];
  const seats: Vec3[] = [];
  for (const p of parked) {
    const v = S.vehicles[p.vehicle];
    const [mx, mz] = v.middle;
    const s = p.turned ? -1 : 1;
    /** Where (`x`, `z`) on the vehicle as the scene parks it is, parked here. */
    const to = (x: number, z: number) => [p.x + s * (x - mx), p.z + s * (z - mz)] as const;
    for (const b of v.boxes) {
      const [x, z] = to(b[0], b[2]);
      parkedBoxes.push([tidy(x), b[1], tidy(z), b[3], b[4], b[5]]);
    }
    // Its mesh is as the scene parks it: moved, or turned end for end about its middle.
    meshes.push({
      mesh: `chevron ${p.vehicle}`,
      at: at(p.x + s * -mx, 0, p.z + s * -mz),
      ...(p.turned && { turn: yawQuat(Math.PI) }),
    });
    if (p.vehicle === 'bus') {
      const c = S.vehicles.bus.cabin;
      const [a, b] = [to(c[0], c[1]), to(c[2], c[3])];
      const r: SceneRoom = [
        Math.min(a[0], b[0]),
        Math.min(a[1], b[1]),
        Math.max(a[0], b[0]),
        Math.max(a[1], b[1]),
        c[4],
        c[5],
      ];
      interiors.push({ rect: roomRect(r), y0: r[4], y1: r[5] });
      // The meeting places down its aisle, from its tail (its -x as the scene parks it).
      for (let k = 0; k < AISLE.seats; k++) {
        const [x, z] = to(c[0] + AISLE.tail + k * AISLE.step, (c[1] + c[3]) / 2);
        seats.push(at(x, c[4], z));
      }
    }
  }
  boxes.push(...parkedBoxes.map((b) => solid(b, { rough: true })));
  /** Whether (`x`, `z`) lies under a parked vehicle, or right by one. */
  const buried = (x: number, z: number) =>
    parkedBoxes.some(
      (b) => Math.abs(x - b[0]) < b[3] / 2 + BURIED && Math.abs(z - b[2]) < b[5] / 2 + BURIED,
    );
  // Walls nobody sees round the edge, the south one where rival teams' halves meet.
  const H = CHEVRON_HALF;
  const edge = (x: number, z: number, sx: number, sz: number, role?: BoxDef['role']): BoxDef => ({
    pos: { x, y: EDGE_HIGH / 2, z },
    size: { x: sx, y: EDGE_HIGH, z: sz },
    colour: COLLIDER,
    model: 'collider',
    ...(role ? { role } : {}),
  });
  boxes.push(
    edge(0, -H - 0.15, 2 * H, 0.3, 'southFence'),
    edge(0, H + 0.15, 2 * H, 0.3),
    edge(-H - 0.15, 0, 0.3, 2 * H),
    edge(H + 0.15, 0, 0.3, 2 * H),
  );

  // Each door is the drawn one, hung where it is drawn hung and swinging as far: a click on the
  // door, shut or open, is a click on the hiding place. A few of the cupboards hide nothing
  // this round, nor does a manhole a car parks over.
  const cupboards = S.hideouts.flatMap((h, i) => (h[0] === 'cabinet' ? [i] : []));
  const empty = new Set(g.shuffle(cupboards).slice(0, EMPTY_CUPBOARDS));
  const hideouts: HideoutDef[] = S.hideouts.flatMap(
    ([kind, x, y, z, sx, sy, sz, facing, swing, right, leaf], i) => {
      if (empty.has(i) || buried(x, z)) return [];
      const door =
        swing > 0
          ? {
              swing,
              ...(right ? { hinge: 'right' as const } : {}),
              ...(leaf && { leaf: { w: leaf[0], h: leaf[1], x: leaf[2], y: leaf[3] } }),
            }
          : null;
      return [
        {
          id: i + 1,
          kind,
          pos: at(x, y, z),
          size: { x: sx, y: sy, z: sz },
          facing,
          ...(door && { door }),
        },
      ];
    },
  );

  // The scene's lamps, taps and the rest a click works, their handles in place.
  const gadgets: GadgetDef[] = [];
  for (const [id, ...b] of S.gadgets) {
    const box = (k: number) => ({
      pos: at(b[k]!, b[k + 1]!, b[k + 2]!),
      size: { x: b[k + 3]!, y: b[k + 4]!, z: b[k + 5]! },
    });
    const handle = { box: box(0), used: box(6) };
    const known = gadgets.find((d) => d.id === id);
    if (known) known.handles.push(handle);
    else gadgets.push({ id, handles: [handle] });
  }

  // The machines where the car scene stands its brick works, each turned the quarter that faces
  // the job site best, with the game's ids for its kind.
  const ids = [...MACHINES];
  const quarter = Math.PI / 2;
  const machines: MachineDef[] = S.machines.map(([kind, x, z, facing]) => {
    const i = ids.findIndex((m) => m.kind === kind);
    const { id } = ids.splice(i, 1)[0]!;
    const p = at(x, 0, z);
    return machineAt(kind, id, p.x, p.z, Math.round(facing / quarter) * quarter);
  });

  const site = S.site;
  const [bx, by, bz] = site.baseplate;
  const board = (b: [number, number, number, number]) => ({
    pos: at(b[0], b[1], b[2]),
    facing: b[3],
  });
  const [ix, iz, isize] = site.inspector;
  const [lx, lz, lh, lf] = S.ladder;
  const [jx, jy, jz] = S.jar;
  const jar = at(jx, jy, jz);
  // The vacuum is kept on the site office's side wall, in the alley, in its dock (drawn with the
  // scene), whose base on the floor behind its head is solid.
  const office = S.rooms[0]!;
  const bigHouse = S.rooms[1]!;
  const vacuumAt = at(office[0] - 0.3 - VACUUM_FROM_WALL, 0, (office[1] + office[3]) / 2 + 0.6);
  boxes.push(dockBase(vacuumAt, WEST));

  const level: LevelDef = {
    floorSize: 2 * H,
    scenery: { kind: 'chevron', x: ox, z: oz, parked } satisfies SceneryDef,
    boxes,
    meshes,
    decals: [],
    machines,
    baseplate: at(bx, by, bz),
    inspector: { pos: at(ix, 0, iz), size: { x: isize, z: isize } },
    doneButton: at(site.done[0], 0, site.done[1]),
    bell: at(site.bell[0], 0, site.bell[1]),
    board: board(site.boards[0]!),
    moreBoards: site.boards.slice(1).map(board),
    pageSpots: [],
    hideouts,
    gadgets,
    ladders: [{ pos: at(lx, 0, lz), width: 0.5, height: lh, facing: lf }],
    meetingSeats: seats,
    lights: [],
    interiors,
    spawn: at(S.start[0], 1, S.start[1]),
    dog: { points: [], links: [], start: 0, treatJar: jar },
    vacuum: { pos: vacuumAt, facing: WEST },
  };
  addGroundPageSpots(level);
  // Every bin here is the street's own, as the car scene draws it: one in each house where one
  // fits, on its raised floor, which the bins below take for solid (the small house's kitchen
  // is too full for one).
  const [teal, yellow, cream] = [0x2c6670, 0xf0bd1c, 0xd9d4c7];
  standHouseBin(level, roomRect(S.rooms[0]!), S.rooms[0]![4], teal);
  standHouseBin(level, roomRect(S.rooms[1]!), S.rooms[1]![4], cream);
  // And more besides the street's, out on the lot and the yards and in the houses, in the
  // street's teal and the bus's yellow; none in the hoarding's gateway, where a rival team's lot
  // meets this one, nor in the road.
  const gate = RIVAL_WALL.gate / 2 + 1;
  standTrashBins(level, {
    outdoor: { model: 'streetBin', colours: [teal, yellow] },
    indoor: { model: 'streetBin', colours: [teal, cream] },
    keep: [rect(-gate, -H, gate, -H + 3), chevronRoad()],
  });
  // All drawn with the scene (see `SceneryDef`).
  for (const b of level.boxes) if (isTrashBin(b)) b.scenery = true;
  // The dog's walks over the open ground round them all, the street and both pavements, from
  // its kennel in the alley between the houses: it roams the whole map, so the bins are stood
  // first and it walks round them.
  const kennel = at((office[2] + bigHouse[0]) / 2 + 1, 0, (office[1] + office[3]) / 2);
  level.dog = dogNetwork(level, gridPoints(grow(rect(-H, -H, H, H), -0.6), 1.4), kennel, jar);
  return level;
}

/**
 * Stands a street bin on a room's floor, `y0` high: against one of its walls, as near the middle
 * of it as it is free, facing in, with room in front to stand and off the dog's walks; or none
 * if nowhere will do.
 */
function standHouseBin(level: LevelDef, room: FloorRect, y0: number, colour: number): void {
  const size = TRASH_BIN_SIZE.streetBin;
  const standing = 0.7;
  const solid = level.boxes
    .filter((b) => b.pos.y + b.size.y / 2 > y0 + 0.01 && b.pos.y - b.size.y / 2 < y0 + 1.8)
    .map((b) =>
      rect(
        b.pos.x - b.size.x / 2,
        b.pos.z - b.size.z / 2,
        b.pos.x + b.size.x / 2,
        b.pos.z + b.size.z / 2,
      ),
    );
  const free = (r: FloorRect) =>
    !solid.some((b) => b.x0 < r.x1 && r.x0 < b.x1 && b.z0 < r.z1 && r.z0 < b.z1);
  const { points, links } = level.dog;
  const spots: { x: number; z: number; front: NonNullable<BoxDef['front']>; off: number }[] = [];
  const back = 0.03 + size.z / 2;
  const mx = (room.x0 + room.x1) / 2;
  const mz = (room.z0 + room.z1) / 2;
  for (let u = 0; u <= 1; u += 0.01) {
    const x = room.x0 + 0.5 + u * (room.x1 - room.x0 - 1);
    const z = room.z0 + 0.5 + u * (room.z1 - room.z0 - 1);
    spots.push(
      { x, z: room.z0 + back, front: '+z', off: Math.abs(x - mx) },
      { x, z: room.z1 - back, front: '-z', off: Math.abs(x - mx) },
      { x: room.x0 + back, z, front: '+x', off: Math.abs(z - mz) },
      { x: room.x1 - back, z, front: '-x', off: Math.abs(z - mz) },
    );
  }
  spots.sort((a, b) => a.off - b.off);
  for (const s of spots) {
    const b = trashBin('streetBin', tidy(s.x), tidy(s.z), s.front, colour, y0);
    const hx = b.size.x / 2;
    const hz = b.size.z / 2;
    const bin = rect(b.pos.x - hx, b.pos.z - hz, b.pos.x + hx, b.pos.z + hz);
    const [dx, dz] = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] }[s.front];
    const takes = rect(
      Math.min(bin.x0, bin.x0 + dx! * standing) - (dz ? 0.15 : 0),
      Math.min(bin.z0, bin.z0 + dz! * standing) - (dx ? 0.15 : 0),
      Math.max(bin.x1, bin.x1 + dx! * standing) + (dz ? 0.15 : 0),
      Math.max(bin.z1, bin.z1 + dz! * standing) + (dx ? 0.15 : 0),
    );
    if (!free(grow(bin, 0.01)) || !free(takes)) continue;
    // A wall right behind it all along, so not in a doorway nor by one.
    const behind = (u: number) => {
      const x = b.pos.x - dx! * (hx + 0.1) + dz! * u;
      const z = b.pos.z - dz! * (hz + 0.1) + dx! * u;
      return !free(rect(x - 0.02, z - 0.02, x + 0.02, z + 0.02));
    };
    if (![-1, -0.5, 0, 0.5, 1].every(behind)) continue;
    const near = points.some((p) => Math.hypot(p.x - b.pos.x, p.z - b.pos.z) < DOG_CLEAR + hx + hz);
    if (near || links.some(([i, j]) => !clearWalk([bin], points[i]!, points[j]!, DOG_CLEAR)))
      continue;
    level.boxes.push(b);
    return;
  }
}

/** The road between the kerbs, in the level, where no bin stands. */
export function chevronRoad(): FloorRect {
  const [x0, z0, x1, z1] = CHEVRON_SCENE.road;
  const { x, z } = CHEVRON_ORIGIN;
  return rect(x0 + x, z0 + z, x1 + x, z1 + z);
}

export function chevronLayout(seed: number): LevelDef {
  return firstGoodLayout('Chevron Street', seed, chevronTry);
}
