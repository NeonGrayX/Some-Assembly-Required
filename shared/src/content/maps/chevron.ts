import type { Vec3 } from '../../math.ts';
import { MACHINES, TRASH_BIN_SIZE, VACUUM_FROM_WALL, machineAt, trashBin } from '../house.ts';
import type {
  BoxDef,
  FloorRect,
  HideoutDef,
  HideoutKind,
  InteriorDef,
  LevelDef,
  MachineDef,
  MachineKind,
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
import { CHEVRON_SCENE } from './chevronScene.ts';

/**
 * Chevron Street: the car scene as a map. A street closed at both ends for the build, two houses
 * on it, the vehicles parked by the job site, and the brick works round the job site on the lot
 * across from the small house, which is the inspector's office. It is drawn with the car scene's
 * own models (see `SceneryDef`); what is solid in them, and where their hiding places and the
 * stations are, is worked out from those models and kept in `chevronScene.ts`, in the scene's
 * own axes. Every round the vehicles park facing one way or the other, and a few of the
 * cupboards are left empty.
 */

/** A box: its middle and its size, x y z each. */
export type SceneBox = [number, number, number, number, number, number];
/** A room: its floor's rectangle, x0 z0 x1 z1, and its floor's and ceiling's heights. */
export type SceneRoom = [number, number, number, number, number, number];

/** What `chevronScene.ts` holds: the car scene's solids and places, in its own axes. */
export interface ChevronScene {
  /** What is solid and stays put. */
  boxes: SceneBox[];
  /** The houses' walls, full height and thin. */
  walls: SceneBox[];
  /** The big house's roof's slopes: boxes tilted about x, the tilt last. */
  roofs: [...SceneBox, number][];
  /** What is solid of each vehicle as it parks, and the middle it is turned about. */
  vehicles: Record<'car' | 'sports', SceneVehicle> & {
    bus: SceneVehicle & { cabin: SceneRoom };
  };
  /** The doors and lids that hide pages: their kind, middle, size and the way they face. */
  hideouts: [HideoutKind, number, number, number, number, number, number, number][];
  /** The street's litter bins. */
  bins: SceneBox[];
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

/** Where the car scene's own origin lies in the level: its middle on the level's. */
export const CHEVRON_ORIGIN = { x: 2, z: 13.5 };
/** Half the map's side. */
export const CHEVRON_HALF = 19;
/** How high the walls nobody sees round the map's edge stand. */
const EDGE_HIGH = 9;

const COLLIDER = 0x808080;
/** How many of the cupboards hide nothing in a round. */
const EMPTY_CUPBOARDS = 3;
/** How much narrower than its door a cupboard's hiding place is, on its hinge's side. */
const HINGE_ROOM = 0.1;

/** The vehicles, in the order their turns are drawn. */
const VEHICLES = ['car', 'sports', 'bus'] as const;

/** Where the meetings stand: two rows of five on the lot before the bus stop. */
const SEATS: [number, number][] = [-3.5, -2.8].flatMap((z) =>
  [0.3, 1.0, 1.7, 2.4, 3.1].map((x) => [x, z] as [number, number]),
);

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
    ...extra,
  });
  const roomRect = (r: SceneRoom): FloorRect => rect(r[0] + ox, r[1] + oz, r[2] + ox, r[3] + oz);

  const turned = VEHICLES.filter(() => g.chance(0.5));
  const boxes: BoxDef[] = [
    ...S.boxes.map((b) => solid(b)),
    ...S.walls.map((b): BoxDef => ({
      pos: at(b[0], b[1], b[2]),
      size: { x: b[3], y: b[4], z: b[5] },
      colour: COLLIDER,
      role: 'wall',
    })),
    ...S.roofs.map((b) => solid(b, { tiltX: b[6] })),
    ...S.bins.map((b) => solid(b, { model: 'litterBin', scenery: true })),
    solid(S.panel, { model: 'panel' }),
  ];
  // The vehicles, each turned end for end about its middle this round or not.
  const interiors: InteriorDef[] = S.rooms.map((r) => ({
    rect: roomRect(r),
    y0: r[4],
    y1: r[5],
  }));
  for (const name of VEHICLES) {
    const v = S.vehicles[name];
    const flip = turned.includes(name);
    const [mx, mz] = v.middle;
    for (const b of v.boxes) {
      const [x, z] = flip ? [2 * mx - b[0], 2 * mz - b[2]] : [b[0], b[2]];
      boxes.push(solid([x, b[1], z, b[3], b[4], b[5]]));
    }
    if (name === 'bus') {
      const c = S.vehicles.bus.cabin;
      const r = flip
        ? ([2 * mx - c[2], 2 * mz - c[3], 2 * mx - c[0], 2 * mz - c[1], c[4], c[5]] as SceneRoom)
        : c;
      interiors.push({ rect: roomRect(r), y0: r[4], y1: r[5] });
    }
  }
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

  // The doors stand in runs, side by side: each one's hiding place a little narrower than it is
  // and away from its hinge (on its left), so the door swings clear of the one beside it. A few
  // of the cupboards hide nothing this round.
  const cupboards = S.hideouts.flatMap((h, i) => (h[0] === 'cabinet' ? [i] : []));
  const empty = new Set(g.shuffle(cupboards).slice(0, EMPTY_CUPBOARDS));
  const hideouts: HideoutDef[] = S.hideouts.flatMap(([kind, x, y, z, sx, sy, sz, facing], i) => {
    if (empty.has(i)) return [];
    const door = kind === 'cabinet' || kind === 'fridge' || kind === 'locker';
    const [cut, right] = door
      ? [HINGE_ROOM, { x: Math.cos(facing), z: -Math.sin(facing) }]
      : [0, { x: 0, z: 0 }];
    return [
      {
        id: i + 1,
        kind,
        pos: at(x + (right.x * cut) / 2, y, z + (right.z * cut) / 2),
        size: { x: tidy(sx - cut), y: sy, z: sz },
        facing,
      },
    ];
  });

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
  // The vacuum leans on the small house's back wall, in the alley behind it.
  const office = S.rooms[0]!;
  const vacuumAt = at(office[0] - 0.3 - VACUUM_FROM_WALL, 0, (office[1] + office[3]) / 2 + 0.6);

  const level: LevelDef = {
    floorSize: 2 * H,
    scenery: { kind: 'chevron', x: ox, z: oz, turned: [...turned] } satisfies SceneryDef,
    boxes,
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
    ladders: [{ pos: at(lx, 0, lz), width: 0.5, height: lh, facing: lf }],
    meetingSeats: SEATS.map(([x, z]) => at(x, 0, z)),
    lights: [],
    interiors,
    spawn: at(S.start[0], 1, S.start[1]),
    dog: { points: [], links: [], start: 0, treatJar: jar },
    vacuum: { pos: vacuumAt, facing: WEST },
  };
  // The dog's walks over the open ground, from its kennel in the alley behind the small house.
  const kennel = at(office[0] - 1.6, 0, office[1] - 1.2);
  level.dog = dogNetwork(level, gridPoints(grow(rect(-H, -H, H, H), -0.6), 1.4), kennel, jar);
  addGroundPageSpots(level);
  // A pedal bin in each house where one fits, on its raised floor, which the bins below take
  // for solid. The small house's kitchen is too full for one.
  const [indoorTeal, indoorCream] = [0x2c6670, 0xd9d4c7];
  standHouseBin(level, roomRect(S.rooms[0]!), S.rooms[0]![4], indoorTeal);
  standHouseBin(level, roomRect(S.rooms[1]!), S.rooms[1]![4], indoorCream);
  // Bins for unwanted bricks besides the street's: wheelie bins out on the lot and the yards,
  // pedal bins in the houses, in the cars' teal and charcoal.
  standTrashBins(level, {
    outdoor: { model: 'wheelieBin', colours: [0x2c6670, 0x2a2d31] },
    indoor: { model: 'pedalBin', colours: [indoorTeal, indoorCream] },
  });
  return level;
}

/**
 * Stands a pedal bin on a room's floor, `y0` high: against one of its walls, as near the middle
 * of it as it is free, facing in, with room in front to stand and off the dog's walks; or none
 * if nowhere will do.
 */
function standHouseBin(level: LevelDef, room: FloorRect, y0: number, colour: number): void {
  const size = TRASH_BIN_SIZE.pedalBin;
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
    const b = trashBin('pedalBin', tidy(s.x), tidy(s.z), s.front, colour, y0);
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

export function chevronLayout(seed: number): LevelDef {
  return firstGoodLayout('Chevron Street', seed, chevronTry);
}
