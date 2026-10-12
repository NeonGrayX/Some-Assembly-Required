import { BRICK_TYPES } from '../bricks.ts';
import type { BrickTypeId } from '../bricks.ts';
import type { Prints, TargetBuild } from '../builds/types.ts';
import { printKey } from '../builds/types.ts';
import { add, mulQuat, rotate, v3, yawQuat } from '../math.ts';
import type { Quat, Vec3 } from '../math.ts';

/** A static, axis-aligned box (walls, tables, crates). `pos` is the box centre. */
/** How thick walls are, on every map. */
export const WALL_T = 0.2;

export interface BoxDef {
  pos: Vec3;
  size: Vec3;
  colour: number;
  /** Tilt around the x axis in radians, for ramps. */
  tiltX?: number;
  /**
   * What the box is, if it is a piece of furniture: it is then drawn as one (a table with
   * legs, a sofa with cushions…) fitted to the box, while it still collides as the box.
   */
  model?: BoxModel;
  /** Which side of the box is its front, for models that have one. Default -z. */
  front?: '-z' | '+z' | '-x' | '+x';
  /** What a sign says. */
  label?: string;
  /** A railing round a stairwell, which players meet as a taller wall (see `Sim.railGuard`). */
  stairwell?: true;
}

export type BoxModel =
  | 'table'
  | 'counter'
  | 'sofa'
  | 'sofaBack'
  | 'bookshelf'
  | 'crate'
  | 'lampPost'
  | 'bed'
  | 'step'
  | 'rail'
  /** A chalkboard with `label` written on its front. */
  | 'sign'
  /** A slatted wooden ramp: give the box its `tiltX`. */
  | 'ramp'
  /** A planked wooden platform, solid to its top: the yard's ledge. */
  | 'platform'
  /** The basement's electrical panel: click it to fix the power when it has failed. */
  | 'panel'
  /** A wooden pallet (a step's height), on its own or in a stack. */
  | 'pallet'
  /** Steel pallet racking with stock on its shelves: a builders' merchant's aisle. */
  | 'rack'
  /** A forklift's body: its chassis, seat, overhead guard, mast and forks are all drawn from it. */
  | 'forklift'
  /** An air-conditioning unit on a roof. */
  | 'acUnit'
  /**
   * A roller shutter in a wall: a box filling the whole bay is a shutter rolled down, and a
   * box filling only the top of the bay (the header over the opening) is one rolled up, with
   * its guide rails drawn down the sides of the opening below it.
   */
  | 'shutter'
  /**
   * Drawn by another box's model (a forklift's mast and forks collide on their own): the box
   * collides, but nothing is drawn for it.
   */
  | 'collider'
  /** A log lying along the box's long side: a seat round a fire, or one of a woodpile. */
  | 'log'
  /** A tree stump standing on its end, rings on top. */
  | 'stump'
  /**
   * A pine tree: the box is its trunk, and its boughs are drawn above and around it, wider
   * than the box, so they stop nothing (a canopy is the one model that reaches out of its box).
   */
  | 'pine'
  /** Decking: planks across the box's short side on bearers, for a jetty, a veranda or a deck. */
  | 'deck'
  /** A rounded stone fitted to the box, for the kerb of a fire pit. */
  | 'rock'
  /** A round timber post standing on its end: a tower's leg, a gate post. */
  | 'post'
  /** A picnic table: the top with a bench fixed either side, the whole thing the box. */
  | 'picnicTable'
  /** A canoe lying upturned on the shore, its hull up, along the box's long side. */
  | 'canoe'
  /** A wheel on its axle, standing in the box with its axle along the box's thinnest side. */
  | 'wheel';

/** A coloured patch drawn on the floor, with no collision (room floors). */
export interface DecalDef {
  pos: Vec3;
  size: { x: number; z: number };
  colour: number;
}

/**
 * A mould on a mould rack: taken to a moulding machine, it makes that part. `pos` is the centre
 * of its bottom; there is one for every part, and taking it leaves it there for the next player.
 */
export interface MouldDef {
  id: number;
  /** Centre of its bottom. */
  pos: Vec3;
  type: BrickTypeId;
  /**
   * Which way its front looks, as a heading about +y (0: toward +z, the way racks face). Turned
   * half round for a rack facing -z, or in a rival team's copy of the level.
   */
  facing?: number;
  /** How far it tips forward (toward its front) about its bottom centre, in radians. */
  tilt?: number;
}

/**
 * The brick works' machines: an injection moulding machine (a mould and pellets in, parts
 * out), the pellet silo (fills a bucket with pellets of any colour), and the UV printer (prints
 * a picture on a part).
 */
export type MachineKind = 'press' | 'silo' | 'printer';

export interface MachineDef {
  id: number;
  kind: MachineKind;
  /** Centre of its foot on the floor. */
  pos: Vec3;
  /** Its box, before turning. */
  size: Vec3;
  /** 0: its front (where players stand to use it) faces +z; a half turn: -z. */
  facing: number;
}

export type HideoutKind =
  | 'drawer'
  | 'fridge'
  | 'locker'
  | 'cabinet'
  | 'cushion'
  | 'rug'
  | 'mailbox'
  | 'toolbox'
  | 'chest'
  /** A builders' skip: a big lidded bin (the chest's mechanics). */
  | 'skip'
  /** A camping cool box: a small lidded box (the toolbox's mechanics). */
  | 'coolbox'
  /** A tent: its door unzips down the middle and both halves roll up to the sides. */
  | 'tent'
  /** A berth's blanket on a bed, lifted like a cushion. */
  | 'berth'
  /** A portable toilet in a yard: a plastic cabin with a door (the locker's mechanics). */
  | 'portaloo'
  /** An office safe: a steel box with a door (the locker's mechanics) and a dial. */
  | 'safe'
  /** A paint tin on a shelf: a small round tin with a lid (the toolbox's mechanics). */
  | 'tin';

/**
 * Somewhere a page can be hidden out of sight: it only shows once someone opens it (or lifts
 * the rug). `pos` is the centre, `facing` the heading its front looks toward (0 = -z).
 */
export interface HideoutDef {
  id: number;
  kind: HideoutKind;
  pos: Vec3;
  size: Vec3;
  facing: number;
}

/**
 * A climbable ladder. `pos` is the centre of its foot; climbers go straight up. `facing` is the
 * way a climber faces: the ladder leans that way (against a wall, usually), and is climbed from
 * the other side.
 */
export interface LadderDef {
  pos: Vec3;
  width: number;
  /** Height up to which a climber's centre keeps climbing. */
  height: number;
  facing: number;
}

/**
 * A window centred on a wall, given by a point on the wall's centre line. It cuts a hole
 * through the wall that is drawn only: players still collide with the whole wall.
 */
export interface WindowDef {
  x: number;
  z: number;
  /** The floor it looks out from: 0 downstairs (the default) or `UPPER_FLOOR`. */
  y?: number;
  /** True when the wall runs along x (a north or south wall). */
  alongX: boolean;
}

/**
 * Which side of its wall a doorway's doors stand open on, given by a point in the doorway on
 * the wall's centre line. The doors are drawn only, swung flat against the wall either side of
 * the opening.
 */
export interface DoorDef {
  x: number;
  z: number;
  /** The floor the doorway is on: 0 downstairs (the default) or `UPPER_FLOOR`. */
  y?: number;
  /** +1 or -1: the side they open to, along z for a north or south wall, else along x. */
  opensTo: number;
  /**
   * What is drawn in the doorway: hinged doors with their casing (the default), or nothing
   * (`bare`) for an opening something else fills, like a roller shutter's bay.
   */
  finish?: 'doors' | 'bare';
}

/** How wide each of a doorway's two doors is (they cover the opening between them). */
export const doorLeaf = (doorwayWidth: number): number => Math.min(1, doorwayWidth / 2);

/**
 * A straight flight of stairs against a wall, one storey up: from the ground floor to
 * `UPPER_FLOOR`, or from the basement to the ground floor. Its steps are solid blocks standing
 * on the floor, and above its upper part the floor above has a stairwell, railed off on its
 * open side and at its lower end.
 */
export interface StairsDef {
  /**
   * The middle of the foot of the flight: the front edge of the first step, on the floor. Its
   * `y` is the floor it starts from (`BASEMENT_FLOOR` for the flight down to the basement).
   */
  pos: Vec3;
  /** The heading the flight climbs toward (0 = -z), a quarter turn. */
  facing: number;
  /** The side of the flight its wall is on, seen climbing: 1 for the right, -1 for the left. */
  wall: number;
}

/** The shape every flight has. */
export const STAIRS = {
  width: 1.4,
  /** Steps below the upper floor: the last climb is onto the floor itself. */
  steps: 13,
  rise: 0.2,
  tread: 0.3,
  /**
   * The stairwell opens above the flight from this step on. From the very first: the ceiling's
   * edge at the well's lower end would otherwise catch a climber's head on the way up, since
   * the step up onto the next tread lifts them before they are clear of it.
   */
  wellFrom: 0,
  railHeight: 0.95,
  railThickness: 0.06,
  /** Floor kept clear at the foot of the flight and at its top, to step on and off. */
  landing: 1,
};

/** How thick the floor a flight comes out on is. */
const SLAB = 0.2;

/** An axis-aligned rectangle on the floor. */
export interface FloorRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/**
 * The air inside a building, as a box: everything over `rect` from height `y0` up to (but not
 * including) `y1`. A building of several parts (a lower wing, a cellar under one end) is
 * several of these.
 */
export interface InteriorDef {
  rect: FloorRect;
  y0: number;
  y1: number;
}

/** Where a flight of stairs stands and what it needs, as rectangles on the floor. */
export interface StairsPlan {
  /** Under the steps. */
  flight: FloorRect;
  /** The hole in the upper floor above it. */
  well: FloorRect;
  /** The well with its railings round it: nothing upstairs may stand there. */
  railed: FloorRect;
  /** Floor kept clear at its foot, downstairs. */
  foot: FloorRect;
  /** Floor kept clear where it comes out at the top, upstairs. */
  top: FloorRect;
  /** The steps and railings, as boxes. */
  boxes: BoxDef[];
}

const FRONT_BY_TURN = ['-z', '-x', '+z', '+x'] as const;

/** The way a flight climbs (`along`) and the climber's right (`across`), as unit vectors on the floor. */
export function stairsAxes(s: StairsDef): {
  along: { x: number; z: number };
  across: { x: number; z: number };
} {
  return {
    along: { x: -Math.round(Math.sin(s.facing)), z: -Math.round(Math.cos(s.facing)) },
    across: { x: Math.round(Math.cos(s.facing)), z: -Math.round(Math.sin(s.facing)) },
  };
}

/** Works out a flight's steps, railings and the floor it needs. */
export function stairsPlan(s: StairsDef): StairsPlan {
  const { width: W, steps, rise, tread, wellFrom, railHeight: RH, railThickness: RT } = STAIRS;
  const turnIndex = ((Math.round(s.facing / (Math.PI / 2)) % 4) + 4) % 4;
  // Climbing along `f`; `r` points to the climber's right.
  const { along: f, across: r } = stairsAxes(s);
  /** A floor rectangle given along the flight (from its foot) and across it (to the right). */
  const rect = (a0: number, a1: number, c0: number, c1: number): FloorRect => {
    const xs = [a0, a1].flatMap((a) => [c0, c1].map((c) => s.pos.x + f.x * a + r.x * c));
    const zs = [a0, a1].flatMap((a) => [c0, c1].map((c) => s.pos.z + f.z * a + r.z * c));
    return {
      x0: tidy(Math.min(...xs)),
      x1: tidy(Math.max(...xs)),
      z0: tidy(Math.min(...zs)),
      z1: tidy(Math.max(...zs)),
    };
  };
  const box = (q: FloorRect, y0: number, y1: number, b: Omit<BoxDef, 'pos' | 'size'>): BoxDef => ({
    ...b,
    pos: { x: tidy((q.x0 + q.x1) / 2), y: tidy((y0 + y1) / 2), z: tidy((q.z0 + q.z1) / 2) },
    size: { x: tidy(q.x1 - q.x0), y: tidy(y1 - y0), z: tidy(q.z1 - q.z0) },
  });
  const run = steps * tread;
  const half = W / 2;
  const open = -s.wall;
  const base = s.pos.y;
  const top = tidy(base + UPPER_FLOOR);
  const boxes: BoxDef[] = [];
  for (let i = 0; i < steps; i++)
    boxes.push(
      box(rect(i * tread, (i + 1) * tread, -half, half), base, tidy(base + (i + 1) * rise), {
        colour: STEP,
        model: 'step',
        // The riser faces down the flight.
        front: FRONT_BY_TURN[(turnIndex + 2) % 4],
      }),
    );
  const wellStart = wellFrom * tread;
  const across = (c: number) => [Math.min(c, c + open * RT), Math.max(c, c + open * RT)] as const;
  const [s0, s1] = across(open * half);
  // Along the open side of the well, and across its lower end from that rail to the wall.
  const side = rect(wellStart, run, s0, s1);
  const end = rect(wellStart - RT, wellStart, Math.min(-half, s0), Math.max(half, s1));
  for (const q of [side, end])
    boxes.push(box(q, top, top + RH, { colour: DARK_WOOD, model: 'rail', stairwell: true }));
  const well = rect(wellStart, run, -half, half);
  return {
    flight: rect(0, run, -half, half),
    well,
    railed: {
      x0: Math.min(well.x0, side.x0, end.x0),
      x1: Math.max(well.x1, side.x1, end.x1),
      z0: Math.min(well.z0, side.z0, end.z0),
      z1: Math.max(well.z1, side.z1, end.z1),
    },
    foot: rect(-STAIRS.landing, 0, -half, half),
    top: rect(run, run + STAIRS.landing, -half, half),
    boxes,
  };
}

/** Rounds away float dust, so plans print and compare cleanly. */
const tidy = (x: number) => Math.round(x * 1e6) / 1e6;

/** The upper floor's slab over the kitchen and living room, walls and all. */
export const UPPER_SLAB: FloorRect = { x0: -12.1, x1: 4.1, z0: 5.9, z1: 15.1 };
/** The break room's floor, over the basement, walls and all: the ground has a hole here. */
export const BASEMENT_SLAB: FloorRect = { x0: 3.9, x1: 12.1, z0: 5.9, z1: 15.1 };

/**
 * The slab of the floor a flight comes out on, with a stairwell cut out of it, and the flight's
 * steps and railings: everything in a level that changes with where the stairs are.
 */
export function upperFloor(s: StairsDef): BoxDef[] {
  const plan = stairsPlan(s);
  const down = s.pos.y < 0;
  const { x0, x1, z0, z1 } = down ? BASEMENT_SLAB : UPPER_SLAB;
  const y = tidy(s.pos.y + UPPER_FLOOR - SLAB / 2);
  const w = plan.well;
  const pieces: FloorRect[] = [
    { x0, x1, z0, z1: w.z0 },
    { x0, x1, z0: w.z1, z1 },
    { x0, x1: w.x0, z0: w.z0, z1: w.z1 },
    { x0: w.x1, x1, z0: w.z0, z1: w.z1 },
  ].filter((q) => q.x1 - q.x0 > 1e-6 && q.z1 - q.z0 > 1e-6);
  return [
    ...pieces.map((q) => ({
      pos: { x: tidy((q.x0 + q.x1) / 2), y, z: tidy((q.z0 + q.z1) / 2) },
      size: { x: tidy(q.x1 - q.x0), y: SLAB, z: tidy(q.z1 - q.z0) },
      colour: down ? CONCRETE : ROOF,
    })),
    ...plan.boxes,
  ];
}

/**
 * Whether a point is inside one of the level's buildings (any storey, a cellar included)
 * rather than out in the open or up on a roof.
 */
export function indoors(level: LevelDef, pos: Vec3): boolean {
  return level.interiors.some(
    ({ rect: r, y0, y1 }) =>
      pos.x >= r.x0 && pos.x <= r.x1 && pos.z >= r.z0 && pos.z <= r.z1 && pos.y >= y0 && pos.y < y1,
  );
}

/** The floor something at height `y` stands on: the basement's, the ground floor's or the upper floor's. */
export const floorLevel = (y: number): number =>
  y >= UPPER_FLOOR - 0.15 ? UPPER_FLOOR : y < -0.15 ? BASEMENT_FLOOR : 0;

/**
 * The ground as rectangles: the whole floor of the level, but for the holes over the
 * basements (whose own floors and the break rooms' slabs over them are boxes).
 */
export function groundPieces(level: LevelDef): FloorRect[] {
  const holes = level.groundHoles ?? (level.groundHole ? [level.groundHole] : []);
  let pieces = [floorRect(level)];
  for (const hole of holes) {
    // Cut round the hole along whole metres first, then the strips left up to its edge: the
    // big pieces players run about on then have sizes floats hold exactly, and the physics
    // engine's single-precision maths gives the very same movement on them as on the whole
    // ground.
    const frame = {
      x0: Math.floor(hole.x0),
      x1: Math.ceil(hole.x1),
      z0: Math.floor(hole.z0),
      z1: Math.ceil(hole.z1),
    };
    pieces = pieces.flatMap((q) => (overlaps(q, frame) ? around(q, frame) : [q]));
    pieces.push(...around(frame, hole));
  }
  return pieces;
}

function overlaps(a: FloorRect, b: FloorRect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
}

/** What is left of `r` once `hole` is cut out of it, as up to four rectangles. */
function around(r: FloorRect, hole: FloorRect): FloorRect[] {
  return [
    { x0: r.x0, x1: r.x1, z0: r.z0, z1: hole.z0 },
    { x0: r.x0, x1: r.x1, z0: hole.z1, z1: r.z1 },
    { x0: r.x0, x1: hole.x0, z0: hole.z0, z1: hole.z1 },
    { x0: hole.x1, x1: r.x1, z0: hole.z0, z1: hole.z1 },
  ].filter((q) => q.x1 - q.x0 > 1e-6 && q.z1 - q.z0 > 1e-6);
}

/**
 * A job site: the team's baseplate and what goes with it. The level's own fields describe the
 * first; a rival-teams level adds a second in `sites`.
 */
export interface SiteDef {
  /** World position of the job-site baseplate's minimum corner. */
  baseplate: Vec3;
  inspector: { pos: Vec3; size: { x: number; z: number } };
  doneButton: Vec3;
  bell: Vec3;
  board: { pos: Vec3; facing: number };
  /** More corkboards beside `board`, for manuals longer than one board holds. */
  moreBoards?: { pos: Vec3; facing: number }[];
  spawn: Vec3;
}

export interface LevelDef {
  /** Side length of the square floor, in metres (see `floor` for a floor that is not square). */
  floorSize: number;
  /** The floor's rectangle when it is not the square centred on the origin (two yards). */
  floor?: FloorRect;
  /** Further job sites (rival teams): the level's own fields are site 0. */
  sites?: SiteDef[];
  /**
   * Rival teams: the line between the two sides. Side 0 is z above it, side 1 below; a player
   * only acts on their own side.
   */
  divide?: { z: number };
  /** The ground's colour, if not the house's sandy yard. */
  groundColour?: number;
  /** Water: players wade slowly through it (and the dog keeps out). */
  water?: FloorRect[];
  boxes: BoxDef[];
  decals: DecalDef[];
  /** A mould for every part, on the mould racks. */
  moulds: MouldDef[];
  /** The brick works: moulding machines, the pellet silo and the UV printer, every site's. */
  machines: MachineDef[];
  /** The pictures the UV printer prints, by name: the round's build's (see `Sim.loadPrints`). */
  svgs?: Record<string, string>;
  /** World position of the job-site baseplate's minimum corner. */
  baseplate: Vec3;
  /** Quality inspector pad: centre on the floor and size. A build resting on it is scanned. */
  inspector: { pos: Vec3; size: { x: number; z: number } };
  /** Base of the "Done" button pedestal next to the job site. */
  doneButton: Vec3;
  /** Base of the meeting bell next to the job site. */
  bell: Vec3;
  /** Two-sided corkboard for pinning pages where everyone can see them: its centre. */
  board: { pos: Vec3; facing: number };
  /** More corkboards beside `board`, for manuals longer than one board holds (site 0's). */
  moreBoards?: { pos: Vec3; facing: number }[];
  /** Open surfaces where instruction pages can lie. */
  pageSpots: Vec3[];
  /** Closed hiding places for pages. */
  hideouts: HideoutDef[];
  ladders: LadderDef[];
  /** Where players stand during a Brick Meeting. */
  meetingSeats: Vec3[];
  /** Where ceiling lamps hang inside: the glowing underside of each shade. */
  lights: Vec3[];
  /**
   * Inside the level's buildings: every room under a roof, on any storey, cellars included,
   * but not the roofs themselves or open shelters such as a canopy on posts. In a gear hunt's
   * power cut it is too dark in here to read (see `indoors`).
   */
  interiors: InteriorDef[];
  /** The house's windows, if not the client's default ones (they may move with the layout). */
  windows?: WindowDef[];
  /** Which side each doorway's doors open to, if not the client's default (into the house). */
  doors?: DoorDef[];
  /**
   * Flights of stairs: up to the upper floor, then down to the basement (their steps and
   * railings are in `boxes`).
   */
  stairs?: StairsDef[];
  /** Where the ground has a hole for the basement under the house, if it has one. */
  groundHole?: FloorRect;
  /** Several holes (a doubled level): takes the place of `groundHole`. */
  groundHoles?: FloorRect[];
  spawn: Vec3;
  dog: DogDef;
  /**
   * Where the broom is kept, leaning against a basement wall: the spot on the floor its head
   * rests on, and the way its bristles face (away from the wall), as a yaw.
   */
  broom: { pos: Vec3; facing: number };
  /**
   * A catapult in the yard, for the lobby: where its frame stands and the yaw it throws along
   * (its own -z, like a player's forward). Whoever steps into the bucket between rounds flies.
   */
  catapult?: { pos: Vec3; facing: number };
}

/**
 * The catapult's shape, shared by the simulation (the frame to stand on, the bucket to step
 * into, the throw) and the client (what it looks like, how the arm swings). In its own space:
 * x across, y up, -z the way it throws. The arm pivots on the axle, its bucket end `back`
 * behind, its counterweight `front` in front, resting tilted down by `rest` so the bucket
 * sits on the frame, and swinging forward by `swing` when it fires.
 */
export const CATAPULT = {
  frame: { size: { x: 1.2, y: 0.25, z: 3.6 }, centreZ: 0.6 },
  axle: { y: 1.0, z: -0.3 },
  arm: { back: 2.0, front: 0.6, rest: 0.305, swing: 2.0 },
  bucket: { radius: 0.5, height: 0.3 },
  /**
   * Up and along the throw, in m/s. Under the game's gravity (15 m/s²) that is 1.6 s in the
   * air, 4.8 m up at the top and 14 m downrange: from the south yard over the bins to the job
   * site, landing hard enough to go down.
   */
  launch: { up: 12, along: 9 },
  /** Ticks before it can throw again. */
  rearmTicks: 3 * 60,
};

/** Where the bucket's middle sits at rest, in the catapult's own space. */
export function catapultBucket(): Vec3 {
  const { axle, arm, bucket } = CATAPULT;
  return {
    x: 0,
    y: axle.y - arm.back * Math.sin(arm.rest) + bucket.height / 2,
    z: axle.z + arm.back * Math.cos(arm.rest),
  };
}

/**
 * Where the dog can go: points on the floor and the straight, clear walks between them. It
 * starts at `points[start]`. The treat jar hands out dog treats.
 */
export interface DogDef {
  points: Vec3[];
  links: [number, number][];
  start: number;
  treatJar: Vec3;
  /** Further treat jars (the other team's kitchen). */
  treatJars?: Vec3[];
}

/** The level's job sites: its own first, then any more it has. */
export function levelSites(level: LevelDef): SiteDef[] {
  const own: SiteDef = {
    baseplate: level.baseplate,
    inspector: level.inspector,
    doneButton: level.doneButton,
    bell: level.bell,
    board: level.board,
    ...(level.moreBoards ? { moreBoards: level.moreBoards } : {}),
    spawn: level.spawn,
  };
  return [own, ...(level.sites ?? [])];
}

/** The floor's rectangle: the square of `floorSize` unless the level says otherwise. */
export function floorRect(level: LevelDef): FloorRect {
  if (level.floor) return level.floor;
  const h = level.floorSize / 2;
  return { x0: -h, x1: h, z0: -h, z1: h };
}

/** A mould: a small steel block. */
export const MOULD_SIZE = { x: 0.4, y: 0.2, z: 0.4 };

/** A mould's box: its centre, half its size, and its turn and tilt. */
export function mouldPose(mould: MouldDef): { centre: Vec3; half: Vec3; rot: Quat } {
  const size = MOULD_SIZE;
  const tilt = mould.tilt ?? 0;
  // Turned to face its way, then tipped forward about its own x axis.
  const rot = mulQuat(yawQuat(mould.facing ?? 0), {
    x: Math.sin(tilt / 2),
    y: 0,
    z: 0,
    w: Math.cos(tilt / 2),
  });
  return {
    centre: add(mould.pos, rotate(rot, v3(0, size.y / 2, 0))),
    half: { x: size.x / 2, y: size.y / 2, z: size.z / 2 },
    rot,
  };
}

/** A machine's box: its centre, half its size, and its turn. */
export function machinePose(m: MachineDef): { centre: Vec3; half: Vec3; rot: Quat } {
  return {
    centre: add(m.pos, v3(0, m.size.y / 2, 0)),
    half: { x: m.size.x / 2, y: m.size.y / 2, z: m.size.z / 2 },
    rot: yawQuat(m.facing),
  };
}

/** The middle of a machine's front, on the floor: where its user stands. */
export function machineFront(m: MachineDef): Vec3 {
  return add(m.pos, rotate(yawQuat(m.facing), v3(0, 0, m.size.z / 2)));
}

export const BUTTON_SIZE = { x: 0.4, y: 0.9, z: 0.4 };
export const BOARD_SIZE = { x: 1.7, y: 1.1, z: 0.06 };
/** Pin slots on each face of a corkboard: two rows of four. */
export const BOARD_FACE_SLOTS = 8;
/** Slots on one whole board: the front face's first, then the back's. */
export const BOARD_SLOTS = 2 * BOARD_FACE_SLOTS;

/** A job site's corkboards: its own first, then the ones beside it. */
export function siteBoards(site: SiteDef): { pos: Vec3; facing: number }[] {
  return [site.board, ...(site.moreBoards ?? [])];
}

/**
 * Every corkboard of a level, site by site, with the site it belongs to. Pin slots run board by
 * board in this order, `BOARD_SLOTS` to a board.
 */
export function levelBoards(level: LevelDef): { site: number; pos: Vec3; facing: number }[] {
  return levelSites(level).flatMap((s, site) => siteBoards(s).map((b) => ({ site, ...b })));
}

/** Pin slots on a job site's corkboards together (the first site's by default). */
export function boardSlots(level: LevelDef, site = 0): number {
  return siteBoards(levelSites(level)[site]!).length * BOARD_SLOTS;
}

const FENCE = 0xd8cfc0;
const WALL = 0xece4d4;
const WOOD = 0x9a6b43;
const DARK_WOOD = 0x6b4a2f;
const ROOF = 0x8c4b3a;
const LAMP_POST = 0x2f3336;
const SOFA = 0x4f6d8f;
const BLANKET = 0x5f7f6a;
const STEP = 0xe9e1d0;
const CONCRETE = 0x8d8a84;
const BASEMENT_WALL = 0xbdb6a8;
const PANEL = 0x8e979c;
const HEIGHT = 2.6;
const T = WALL_T;
/** Height of the upper floor, on top of the ground floor's walls and ceiling. */
export const UPPER_FLOOR = 2.8;
const UP = UPPER_FLOOR;
/** Height of the basement's floor, under the break room: a storey down. */
export const BASEMENT_FLOOR = -2.8;
const DOWN = BASEMENT_FLOOR;
/** Doorways are this tall, with a header box above them up to the roof. */
const DOOR_HEIGHT = 2.2;
const HEADER = HEIGHT - DOOR_HEIGHT;

/**
 * Garden lamp posts: by the front door, along the fence and around the job site, kept clear of
 * the bins, page spots and the dog's walks. A post collides as a thin box; its lantern sits on top.
 */
const gardenLamps: BoxDef[] = [
  [-1.5, 5.4],
  [1.5, 5.4],
  [-6, -14.8],
  [6, -14.8],
  [-14.8, 2],
  [14.8, 1],
  // Around the job site, so it is lit at night.
  [0, -7.5],
  [-8, 0.5],
  [8, -1],
].map(([x, z]) => ({
  pos: { x: x!, y: 1.1, z: z! },
  size: { x: 0.14, y: 2.2, z: 0.14 },
  colour: LAMP_POST,
  model: 'lampPost' as const,
}));

/** The ladder up the break room's south wall onto its roof. */
const LADDER: LadderDef = {
  pos: { x: 10, y: 0, z: 5.6 },
  width: 0.8,
  height: 3.75,
  facing: Math.PI,
};

/** Rail kept clear either side of the ladder's top, so a climber's shoulders get through. */
const LADDER_GAP = 0.4;
/**
 * How tall the roof's railing is: taller than the stairwells', which a player jumping at them
 * clears, since at the top of a jump (0.83 m) they step up onto anything up to 0.3 m higher.
 */
const ROOF_RAIL_HEIGHT = 1.3;

/**
 * A railing round the break room's roof, so nobody walks off it: along its south, east and
 * north edges (the west one is the upper floor's wall, with the door out), too tall to jump, and
 * open where the ladder comes up.
 */
const roofRailing = (): BoxDef[] => {
  const [RH, RT] = [ROOF_RAIL_HEIGHT, STAIRS.railThickness];
  const [x0, x1, z0, z1] = [4.1, 12.1, 5.9, 15.1];
  const gap0 = LADDER.pos.x - LADDER.width / 2 - LADDER_GAP;
  const gap1 = LADDER.pos.x + LADDER.width / 2 + LADDER_GAP;
  const rail = (q: FloorRect): BoxDef => ({
    pos: { x: tidy((q.x0 + q.x1) / 2), y: tidy(HEIGHT + 0.2 + RH / 2), z: tidy((q.z0 + q.z1) / 2) },
    size: { x: tidy(q.x1 - q.x0), y: RH, z: tidy(q.z1 - q.z0) },
    colour: DARK_WOOD,
    model: 'rail',
  });
  return [
    rail({ x0, x1: gap0, z0, z1: z0 + RT }),
    rail({ x0: gap1, x1, z0, z1: z0 + RT }),
    rail({ x0: x1 - RT, x1, z0: z0 + RT, z1: z1 - RT }),
    rail({ x0, x1, z0: z1 - RT, z1 }),
  ];
};

/** House walls: south wall with a front door, two inner walls with doorways. */
const houseWalls: BoxDef[] = [
  // The front and back walls run out to the end walls' outer faces and the end walls fit
  // between them, so each corner is square, with no notch and no overlapping faces.
  { pos: { x: -6.55, y: HEIGHT / 2, z: 6 }, size: { x: 11.1, y: HEIGHT, z: T }, colour: WALL },
  { pos: { x: 6.55, y: HEIGHT / 2, z: 6 }, size: { x: 11.1, y: HEIGHT, z: T }, colour: WALL },
  { pos: { x: 0, y: HEIGHT / 2, z: 15 }, size: { x: 24.2, y: HEIGHT, z: T }, colour: WALL },
  { pos: { x: -12, y: HEIGHT / 2, z: 10.5 }, size: { x: T, y: HEIGHT, z: 9 - T }, colour: WALL },
  { pos: { x: 12, y: HEIGHT / 2, z: 10.5 }, size: { x: T, y: HEIGHT, z: 9 - T }, colour: WALL },
  // The inner walls run from the front wall's inner face to the back wall's, either side of
  // their doorways.
  ...[-4, 4].flatMap((x) => [
    { pos: { x, y: HEIGHT / 2, z: 7.55 }, size: { x: T, y: HEIGHT, z: 2.9 }, colour: WALL },
    { pos: { x, y: HEIGHT / 2, z: 12.95 }, size: { x: T, y: HEIGHT, z: 3.9 }, colour: WALL },
  ]),
  // Headers over the front door and the two inner doorways.
  { pos: { x: 0, y: HEIGHT - HEADER / 2, z: 6 }, size: { x: 2, y: HEADER, z: T }, colour: WALL },
  ...[-4, 4].map((x) => ({
    pos: { x, y: HEIGHT - HEADER / 2, z: 10 },
    size: { x: T, y: HEADER, z: 2 },
    colour: WALL,
  })),
  // Flat roof over the break room you can walk on (reach it by the ladder on the south wall,
  // or out of the upper floor's door).
  { pos: { x: 8.1, y: HEIGHT + 0.1, z: 10.5 }, size: { x: 8, y: 0.2, z: 9.2 }, colour: ROOF },
  ...roofRailing(),
  // The upper floor over the kitchen and living room: the same walls again, standing on its
  // slab (see `upperFloor`), with a doorway between its two rooms and one out onto that roof.
  { pos: { x: -4, y: UP + HEIGHT / 2, z: 6 }, size: { x: 16.2, y: HEIGHT, z: T }, colour: WALL },
  { pos: { x: -4, y: UP + HEIGHT / 2, z: 15 }, size: { x: 16.2, y: HEIGHT, z: T }, colour: WALL },
  {
    pos: { x: -12, y: UP + HEIGHT / 2, z: 10.5 },
    size: { x: T, y: HEIGHT, z: 9 - T },
    colour: WALL,
  },
  ...[-4, 4].flatMap((x) => [
    { pos: { x, y: UP + HEIGHT / 2, z: 7.55 }, size: { x: T, y: HEIGHT, z: 2.9 }, colour: WALL },
    { pos: { x, y: UP + HEIGHT / 2, z: 12.95 }, size: { x: T, y: HEIGHT, z: 3.9 }, colour: WALL },
    {
      pos: { x, y: UP + HEIGHT - HEADER / 2, z: 10 },
      size: { x: T, y: HEADER, z: 2 },
      colour: WALL,
    },
  ]),
  // And its own flat roof.
  {
    pos: { x: -4, y: UP + HEIGHT + 0.1, z: 10.5 },
    size: { x: 16.2, y: 0.2, z: 9.2 },
    colour: ROOF,
  },
  // The basement under the break room: a concrete floor and four walls up to the break room's
  // floor (see `upperFloor`), the same lines as the walls above.
  {
    pos: { x: 8, y: DOWN - 0.1, z: 10.5 },
    size: { x: 8.2, y: 0.2, z: 9.2 },
    colour: CONCRETE,
  },
  ...[6, 15].map((z) => ({
    pos: { x: 8, y: DOWN + HEIGHT / 2, z },
    size: { x: 8.2, y: HEIGHT, z: T },
    colour: BASEMENT_WALL,
  })),
  ...[4, 12].map((x) => ({
    pos: { x, y: DOWN + HEIGHT / 2, z: 10.5 },
    size: { x: T, y: HEIGHT, z: 9 - T },
    colour: BASEMENT_WALL,
  })),
];

/** Where the stairs are in the hand-made house: along the kitchen's south wall, climbing west. */
const HOUSE_STAIRS: StairsDef = {
  pos: { x: -5.5, y: 0, z: 6.1 + STAIRS.width / 2 },
  facing: Math.PI / 2,
  wall: 1,
};

/**
 * Where the stairs down to the basement are in the hand-made house: along the break room's
 * south wall, from the basement climbing east.
 */
const HOUSE_BASEMENT_STAIRS: StairsDef = {
  pos: { x: 7, y: BASEMENT_FLOOR, z: 6.1 + STAIRS.width / 2 },
  facing: -Math.PI / 2,
  wall: -1,
};

/**
 * The hand-made house's upper floor slab and the break room's floor over the basement, with
 * both flights' steps and railings (layouts make their own).
 */
export const HOUSE_STAIRWAYS: BoxDef[] = [
  ...upperFloor(HOUSE_STAIRS),
  ...upperFloor(HOUSE_BASEMENT_STAIRS),
];

/*
 * The brick works: a row south of the job site, facing it. Two shelving units at the ends hold
 * a mould for every part, on forward-tipped shelves like a shop's display stand so the moulds
 * show. Between them stand two injection moulding machines with the pellet silo in the middle:
 * a mould goes into a machine, a bucket of coloured pellets from the silo goes into its hopper,
 * and the machine makes that part in that colour. The UV printer stands beside the job site,
 * for the parts that carry a picture.
 */
/** How far the shelves (and the moulds on them) tip forward, toward +z, in radians. */
export const RACK_TILT = 0.26;
const RACK_WIDTH = 4.6;
/** Between neighbouring racks' posts. */
const RACK_GAP = 0.15;
/** Where the row's shelves end at the front. */
const RACK_FRONT_Z = -9;
const SHELF = 0.03;
const LIP = 0.06;
const POST = 0.05;
const SIGN = 0.32;
const METAL = 0x2b2d30;
const MAPLE = 0xd6b47c;
const CHALKBOARD = 0x34383a;

interface RackKind {
  /** Shelf depth along its slope. */
  depth: number;
  /** Height of each shelf's top at its back. */
  shelves: number[];
  perShelf: number;
}
const MOULD_RACK: RackKind = {
  depth: 0.46,
  shelves: [0.45, 0.87, 1.29, 1.71, 2.13],
  perShelf: 11,
};
/** How much floor a moulding machine or the silo takes: as much as a big rack of bins did. */
const MACHINE_DEPTH = 0.86 * Math.cos(RACK_TILT);
/** How much floor the UV printer takes: a short rack's worth, beside the job site. */
const PRINTER_DEPTH = 0.46 * Math.cos(RACK_TILT);
const PRINTER_WIDTH = 2.3;

/** The machines' heights. */
export const MACHINE_HEIGHT: Record<MachineKind, number> = { press: 1.5, silo: 3.2, printer: 1.05 };

interface Rack {
  /** Centre along x. */
  x: number;
  /** Where its shelves end at the front. */
  front: number;
  width: number;
  kind: RackKind;
  label: string;
  /** 0 to face +z (the default), or a half turn to face -z, its back toward +z. */
  facing?: number;
}

/**
 * A rack facing -z is one facing +z turned half round about the middle of its front edge:
 * this turns what was worked out for +z the right way.
 */
function turnRack(rack: Pick<Rack, 'x' | 'front' | 'facing'>): {
  point: (p: Vec3) => Vec3;
  turned: boolean;
} {
  const turned = Math.abs(Math.cos(rack.facing ?? 0) + 1) < 1e-6;
  return {
    turned,
    point: (p) => (turned ? { x: 2 * rack.x - p.x, y: p.y, z: 2 * rack.front - p.z } : p),
  };
}

/** The row's spots, west to east, side by side: what stands at each. */
const ROW: ('moulds' | MachineKind)[] = ['moulds', 'press', 'silo', 'press', 'moulds'];
const ROW_X = ROW.map((_, i) => -10 + i * (RACK_WIDTH + 2 * POST + RACK_GAP));

/** Beside the job site, east of it. */
const PRINTER_SPOT: RackSpot = { x: 3.5, front: -3 };

const TILT_C = Math.cos(RACK_TILT);
const TILT_S = Math.sin(RACK_TILT);

/** A point `along` the slope from a shelf's back edge and `up` from its top, in the world. */
function onShelf(
  { front, kind }: Rack,
  shelf: number,
  along: number,
  up: number,
): { y: number; z: number } {
  const back = front - kind.depth * TILT_C;
  return {
    y: kind.shelves[shelf]! - along * TILT_S + up * TILT_C,
    z: back + along * TILT_C + up * TILT_S,
  };
}

function rackBoxes(rack: Rack): BoxDef[] {
  const { point, turned } = turnRack(rack);
  return facingBoxes(rack).map((b) =>
    turned
      ? {
          ...b,
          pos: point(b.pos),
          ...(b.tiltX ? { tiltX: -b.tiltX } : {}),
          ...(b.front ? { front: b.front === '+z' ? '-z' : '+z' } : {}),
        }
      : b,
  );
}

/** The rack's boxes as if it faced +z. */
function facingBoxes(rack: Rack): BoxDef[] {
  const { x, kind, width } = rack;
  const out: BoxDef[] = [];
  const back = rack.front - kind.depth * TILT_C;
  const height = kind.shelves[kind.shelves.length - 1]! + 0.3;
  kind.shelves.forEach((_, i) => {
    const shelf = onShelf(rack, i, kind.depth / 2, -SHELF / 2);
    out.push({
      pos: { x, ...shelf },
      size: { x: width, y: SHELF, z: kind.depth },
      colour: MAPLE,
      tiltX: RACK_TILT,
    });
    // A lip along the front, as on the display stand.
    const lip = onShelf(rack, i, kind.depth - 0.01, LIP / 2);
    out.push({
      pos: { x, ...lip },
      size: { x: width, y: LIP, z: 0.02 },
      colour: MAPLE,
      tiltX: RACK_TILT,
    });
    // Arms under its ends, out from the posts (the bottom shelf sits on the base instead).
    for (const side of i ? [-1, 1] : []) {
      const arm = onShelf(rack, i, kind.depth / 2, -SHELF - 0.02);
      out.push({
        pos: { x: x + side * (width / 2 - 0.02), ...arm },
        size: { x: 0.03, y: 0.04, z: kind.depth },
        colour: METAL,
        tiltX: RACK_TILT,
      });
    }
  });
  // A solid base under the bottom shelf, reaching half way into the gaps beside the rack, so
  // the row is a wall low down: nothing rolls under it and the dog sees no way through.
  const base = onShelf(rack, 0, kind.depth, -SHELF).y - 0.02;
  out.push({
    pos: { x, y: base / 2, z: back + (kind.depth * TILT_C) / 2 },
    size: { x: width + 2 * POST + RACK_GAP, y: base, z: kind.depth * TILT_C },
    colour: METAL,
  });
  // The posts stand on the base.
  for (const side of [-1, 1]) {
    out.push({
      pos: {
        x: x + side * (width / 2 + POST / 2),
        y: (base + height + SIGN) / 2,
        z: back + POST / 2,
      },
      size: { x: POST, y: height + SIGN - base, z: POST },
      colour: METAL,
    });
  }
  // The sign board on top, between the posts.
  out.push({
    pos: { x, y: height + SIGN / 2, z: back + POST / 2 },
    size: { x: width, y: SIGN, z: 0.03 },
    colour: CHALKBOARD,
    model: 'sign',
    front: '+z',
    label: rack.label,
  });
  return out;
}

/** The mould places on a rack: shelf by shelf from the bottom, left to right seen from in front. */
function rackSlots(rack: Rack): Pick<MouldDef, 'pos' | 'facing' | 'tilt'>[] {
  const { x, kind, width } = rack;
  const { point, turned } = turnRack(rack);
  const pitch = width / kind.perShelf;
  return kind.shelves.flatMap((_, shelf) =>
    Array.from({ length: kind.perShelf }, (_, i) => ({
      pos: point({
        x: x - width / 2 + pitch * (i + 0.5),
        ...onShelf(rack, shelf, 0.02 + MOULD_SIZE.z / 2, 0.001),
      }),
      tilt: RACK_TILT,
      ...(turned ? { facing: Math.PI } : {}),
    })),
  );
}

/** Every part the moulding machines make, in the catalogue's order: one mould each. */
export const MOULD_TYPES: BrickTypeId[] = (Object.keys(BRICK_TYPES) as BrickTypeId[]).filter(
  (t) => !BRICK_TYPES[t].fixture,
);

/** How many mould racks hold a mould for every part. */
export const MOULD_RACKS = Math.ceil(
  MOULD_TYPES.length / (MOULD_RACK.shelves.length * MOULD_RACK.perShelf),
);

/** Where a map stands a rack or machine: the centre of its front edge, and which way it faces. */
export interface RackSpot {
  x: number;
  front: number;
  /** 0 (toward +z) or a half turn. */
  facing?: number;
}

/**
 * One of the mould racks (`index` 0 to `MOULD_RACKS` - 1): its boxes and its moulds, the
 * catalogue's parts in order, a rack's worth each, with ids from 1 across the racks.
 */
export function mouldRack(spot: RackSpot, index: number): { boxes: BoxDef[]; moulds: MouldDef[] } {
  const rack: Rack = { width: RACK_WIDTH, kind: MOULD_RACK, label: 'Moulds', ...spot };
  const per = MOULD_RACK.shelves.length * MOULD_RACK.perShelf;
  const places = rackSlots(rack);
  return {
    boxes: rackBoxes(rack),
    moulds: MOULD_TYPES.slice(index * per, index * per + per).map((type, i) => ({
      id: index * per + i + 1,
      type,
      ...places[i]!,
    })),
  };
}

/**
 * A machine standing at a spot: a moulding machine or the silo on a big rack's floor, the UV
 * printer on a short one's. Its front is the spot's front edge.
 */
export function machineAt(spot: RackSpot, kind: MachineKind, id: number): MachineDef {
  const printer = kind === 'printer';
  const width = (printer ? PRINTER_WIDTH : RACK_WIDTH) + 2 * POST + RACK_GAP;
  const depth = printer ? PRINTER_DEPTH : MACHINE_DEPTH;
  const { turned } = turnRack(spot);
  return {
    id,
    kind,
    pos: { x: spot.x, y: 0, z: spot.front + (turned ? depth / 2 : -depth / 2) },
    size: { x: width, y: MACHINE_HEIGHT[kind], z: depth },
    facing: turned ? Math.PI : 0,
  };
}

/** Ids of the machines in a row: the two moulding machines, the silo, and the printer. */
export const MACHINE_IDS = { press: [1, 3], silo: 2, printer: 4 };

/** The house's row: mould racks at the ends, the machines between them. */
const HOUSE_ROW = ROW.map((what, i) => ({ what, spot: { x: ROW_X[i]!, front: RACK_FRONT_Z } }));
const HOUSE_MOULD_RACKS = HOUSE_ROW.filter((r) => r.what === 'moulds').map((r, i) =>
  mouldRack(r.spot, i),
);
if (HOUSE_MOULD_RACKS.length < MOULD_RACKS) throw new Error('more moulds than places on the racks');
const RACK_BOXES: BoxDef[] = HOUSE_MOULD_RACKS.flatMap((r) => r.boxes);
const HOUSE_MOULDS: MouldDef[] = HOUSE_MOULD_RACKS.flatMap((r) => r.moulds);
const HOUSE_MACHINES: MachineDef[] = [
  ...HOUSE_ROW.flatMap((r, i) => (r.what === 'moulds' ? [] : [machineAt(r.spot, r.what, i)])),
  machineAt(PRINTER_SPOT, 'printer', MACHINE_IDS.printer),
];

/**
 * One print job of a build: a part type and the pictures on its sides. The UV printer offers
 * every one the round's build has, for a part of that type.
 */
export interface PrintJob {
  type: BrickTypeId;
  prints: Prints;
}

/** Every printed part a build uses (by type and prints, whatever its colour), in manual order. */
export function printJobs(build: TargetBuild | null): PrintJob[] {
  const out: PrintJob[] = [];
  const seen = new Set<string>();
  for (const b of build?.steps.flatMap((s) => s.bricks) ?? []) {
    if (!b.prints) continue;
    const key = `${b.type}|${printKey(b.prints)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: b.type, prints: b.prints });
  }
  return out;
}

/**
 * Points spread over the yard on a 3 m grid, kept well clear of posts, bin racks and walls, so
 * the dog roams all of it rather than a ring round the fence (with three more in the gap between
 * the backs of the bin racks and the catapult); and every clear walk of up to 4.3 m that joins
 * them to each other and to the hand-placed points in the yard (they follow those, from 23 on).
 */
const YARD_DOG_POINTS: Vec3[] = [
  { x: -14.5, y: 0, z: -14.5 },
  { x: -14.5, y: 0, z: -11.5 },
  { x: -14.5, y: 0, z: -8.5 },
  { x: -14.5, y: 0, z: -5.5 },
  { x: -14.5, y: 0, z: -2.5 },
  { x: -14.5, y: 0, z: 0.5 },
  { x: -14.5, y: 0, z: 3.5 },
  { x: -11.5, y: 0, z: -14.5 },
  { x: -11.5, y: 0, z: -11.5 },
  { x: -11.5, y: 0, z: -5.5 },
  { x: -11.5, y: 0, z: -2.5 },
  { x: -11.5, y: 0, z: 0.5 },
  { x: -11.5, y: 0, z: 3.5 },
  { x: -8.5, y: 0, z: -14.5 },
  { x: -8.5, y: 0, z: -11.5 },
  { x: -8.5, y: 0, z: 3.5 },
  { x: -5.5, y: 0, z: -11.5 },
  { x: -5.5, y: 0, z: -2.5 },
  { x: -5.5, y: 0, z: 0.5 },
  { x: -2.5, y: 0, z: -14.5 },
  { x: -2.5, y: 0, z: -11.5 },
  { x: -2.5, y: 0, z: -5.5 },
  { x: -2.5, y: 0, z: -2.5 },
  { x: -2.5, y: 0, z: 0.5 },
  { x: -2.5, y: 0, z: 3.5 },
  { x: 0.5, y: 0, z: -14.5 },
  { x: 0.5, y: 0, z: -11.5 },
  { x: 0.5, y: 0, z: -5.5 },
  { x: 0.5, y: 0, z: -2.5 },
  { x: 0.5, y: 0, z: 3.5 },
  { x: 3.5, y: 0, z: 0.5 },
  { x: 3.5, y: 0, z: 3.5 },
  { x: 6.5, y: 0, z: -11.5 },
  { x: 6.5, y: 0, z: -2.5 },
  { x: 6.5, y: 0, z: 0.5 },
  { x: 6.5, y: 0, z: 3.5 },
  { x: 9.5, y: 0, z: -14.5 },
  { x: 9.5, y: 0, z: -11.5 },
  { x: 9.5, y: 0, z: -5.5 },
  { x: 9.5, y: 0, z: -2.5 },
  { x: 9.5, y: 0, z: 0.5 },
  { x: 9.5, y: 0, z: 3.5 },
  { x: 12.5, y: 0, z: -14.5 },
  { x: 12.5, y: 0, z: -11.5 },
  { x: 12.5, y: 0, z: 0.5 },
  { x: 12.5, y: 0, z: 3.5 },
  { x: 0.5, y: 0, z: -10.34 },
  { x: 3, y: 0, z: -10.34 },
  { x: 5.5, y: 0, z: -10.34 },
];
const YARD_DOG_LINKS: [number, number][] = [
  [0, 13],
  [0, 47],
  [0, 52],
  [0, 54],
  [13, 46],
  [13, 47],
  [13, 52],
  [14, 35],
  [14, 38],
  [14, 41],
  [15, 23],
  [15, 24],
  [15, 25],
  [15, 30],
  [15, 31],
  [15, 37],
  [16, 42],
  [16, 43],
  [16, 48],
  [16, 49],
  [16, 69],
  [17, 60],
  [17, 65],
  [17, 66],
  [18, 22],
  [18, 57],
  [18, 58],
  [18, 63],
  [18, 64],
  [19, 27],
  [19, 28],
  [19, 29],
  [19, 33],
  [19, 34],
  [19, 35],
  [21, 24],
  [21, 25],
  [21, 26],
  [21, 32],
  [22, 54],
  [22, 57],
  [22, 58],
  [22, 64],
  [23, 24],
  [23, 30],
  [23, 31],
  [24, 25],
  [24, 30],
  [24, 31],
  [25, 26],
  [25, 31],
  [25, 32],
  [26, 27],
  [26, 32],
  [26, 33],
  [27, 28],
  [27, 32],
  [27, 33],
  [27, 34],
  [28, 33],
  [28, 34],
  [28, 35],
  [29, 34],
  [29, 35],
  [30, 31],
  [30, 36],
  [31, 37],
  [32, 33],
  [33, 34],
  [34, 35],
  [34, 38],
  [35, 38],
  [36, 37],
  [36, 39],
  [37, 39],
  [38, 41],
  [39, 42],
  [39, 43],
  [40, 41],
  [40, 44],
  [40, 45],
  [40, 46],
  [41, 45],
  [41, 46],
  [42, 43],
  [42, 48],
  [42, 49],
  [43, 48],
  [43, 49],
  [43, 69],
  [44, 45],
  [44, 50],
  [44, 51],
  [45, 46],
  [45, 50],
  [45, 51],
  [46, 47],
  [47, 52],
  [48, 49],
  [48, 69],
  [49, 69],
  [50, 51],
  [51, 53],
  [52, 54],
  [53, 54],
  [53, 56],
  [53, 57],
  [53, 58],
  [54, 57],
  [54, 58],
  [55, 59],
  [55, 60],
  [55, 71],
  [56, 57],
  [56, 61],
  [56, 62],
  [57, 58],
  [57, 63],
  [57, 64],
  [58, 63],
  [58, 64],
  [59, 60],
  [59, 65],
  [59, 66],
  [60, 65],
  [60, 66],
  [60, 71],
  [61, 62],
  [62, 63],
  [62, 67],
  [63, 64],
  [63, 67],
  [64, 68],
  [65, 66],
  [67, 68],
  [69, 70],
  [70, 71],
];

/**
 * The house's rooms by name, each as its floor inside its walls (in the colour it is drawn):
 * the kitchen, living room and break room downstairs, the bedroom over the kitchen and the
 * study over the living room, and the basement under the break room. These are the house's
 * floor decals, in this order; layouts and their checks refer to rooms by these names.
 */
export const HOUSE_ROOMS = {
  kitchen: { pos: { x: -8, y: 0, z: 10.5 }, size: { x: 7.8, z: 8.8 }, colour: 0xc8c2b4 },
  livingRoom: { pos: { x: 0, y: 0, z: 10.5 }, size: { x: 7.8, z: 8.8 }, colour: 0xa47a52 },
  breakRoom: { pos: { x: 8, y: 0, z: 10.5 }, size: { x: 7.8, z: 8.8 }, colour: 0x8e9aa6 },
  bedroom: { pos: { x: -8, y: UP, z: 10.5 }, size: { x: 7.8, z: 8.8 }, colour: 0xb7a58c },
  study: { pos: { x: 0, y: UP, z: 10.5 }, size: { x: 7.8, z: 8.8 }, colour: 0x8f9a7e },
  basement: { pos: { x: 8, y: DOWN, z: 10.5 }, size: { x: 7.8, z: 8.8 }, colour: 0x9c9890 },
} satisfies Record<string, DecalDef>;
export type HouseRoom = keyof typeof HOUSE_ROOMS;

/**
 * The yard and the house. The job site, bins, inspector and a ramp to a ledge are in the yard;
 * the house to the north has a kitchen, a living room and the break room where meetings are
 * held, full of drawers and rugs to hide pages in, and a roof reached by a ladder.
 */
export const HOUSE: LevelDef = {
  floorSize: 32,
  baseplate: { x: -0.8, y: 0, z: -0.8 },
  spawn: { x: 0, y: 1, z: 3.5 },
  dog: {
    points: [
      { x: 0, y: 0, z: 4.4 }, // 0: outside the front door
      { x: 0, y: 0, z: 7.2 }, // 1: just inside
      { x: 0, y: 0, z: 11.8 }, // 2: living room
      { x: -3, y: 0, z: 10 }, // 3: living room, by the kitchen door
      { x: -5.2, y: 0, z: 10 }, // 4: kitchen, by the door
      { x: -6, y: 0, z: 12.4 }, // 5: kitchen, between table and counter
      { x: -10.5, y: 0, z: 11.5 }, // 6: kitchen, by the fridge
      { x: -9.5, y: 0, z: 7.9 }, // 7: kitchen, south corner, past the foot of the stairs
      { x: 3, y: 0, z: 10 }, // 8: living room, by the break room door
      { x: 5.2, y: 0, z: 10 }, // 9: break room, by the door
      { x: 8, y: 0, z: 8 }, // 10: break room, south of the table
      { x: 10.6, y: 0, z: 12.6 }, // 11: break room, by the lockers
      { x: 6, y: 0, z: 13.4 }, // 12: break room, north of the table
      { x: -2.5, y: 0, z: 4.3 }, // 13: yard, by the house
      { x: -8, y: 0, z: 3.5 }, // 14: yard, west of the house front
      { x: -12.5, y: 0, z: -12 }, // 15: yard, south-west, behind the bin racks
      { x: 0, y: 0, z: -12 }, // 16: yard, south, behind the bin racks
      { x: 12.6, y: 0, z: -11.5 }, // 17: yard, south-east
      { x: 9.5, y: 0, z: 2 }, // 18: yard, east
      { x: -13, y: 0, z: 0 }, // 19: yard, far west
      { x: 10.5, y: 0, z: 8.5 }, // 20: break room, south-east
      { x: -14.5, y: 0, z: -8 }, // 21: yard, behind the inspector
      { x: 6, y: 0, z: 4.3 }, // 22: yard, north-east of the job site
      // 23 on: the yard, all over.
      ...YARD_DOG_POINTS,
    ],
    links: [
      [0, 1],
      [1, 2],
      [1, 3],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 7],
      [1, 8],
      [2, 8],
      [8, 9],
      [9, 10],
      [9, 12],
      [10, 20],
      [20, 11],
      [12, 11],
      ...YARD_DOG_LINKS,
    ],
    start: 2,
    treatJar: { x: -6.8, y: 0.9, z: 14.55 },
  },
  boxes: [
    // Yard fence.
    { pos: { x: 0, y: 1, z: -16 }, size: { x: 32, y: 2, z: 0.3 }, colour: FENCE },
    { pos: { x: 0, y: 1, z: 16 }, size: { x: 32, y: 2, z: 0.3 }, colour: FENCE },
    // The east and west fences fit between the other two, so no corner is drawn twice.
    { pos: { x: -16, y: 1, z: 0 }, size: { x: 0.3, y: 2, z: 31.7 }, colour: FENCE },
    { pos: { x: 16, y: 1, z: 0 }, size: { x: 0.3, y: 2, z: 31.7 }, colour: FENCE },
    // A short wall in the yard, between the job site and the inspector.
    { pos: { x: -8.5, y: 0.75, z: -4 }, size: { x: 0.3, y: 1.5, z: 5 }, colour: FENCE },
    // Yard table and crates.
    { pos: { x: 5, y: 0.4, z: -5 }, size: { x: 2, y: 0.8, z: 1.2 }, colour: WOOD, model: 'table' },
    {
      pos: { x: -5, y: 0.3, z: -6 },
      size: { x: 0.6, y: 0.6, z: 0.6 },
      colour: WOOD,
      model: 'crate',
    },
    {
      pos: { x: -4.2, y: 0.3, z: -6.3 },
      size: { x: 0.6, y: 0.6, z: 0.6 },
      colour: WOOD,
      model: 'crate',
    },
    // The mould racks: shelves, posts and signs (the moulds on them are `moulds`).
    ...RACK_BOXES,
    // Ramp up to a ledge in the east of the yard.
    {
      pos: { x: 13.5, y: 0.5, z: -4 },
      size: { x: 2, y: 0.2, z: 4 },
      colour: WOOD,
      tiltX: 0.26,
      model: 'ramp',
    },
    {
      pos: { x: 13.5, y: 0.5, z: -7.5 },
      size: { x: 2, y: 1, z: 3 },
      colour: WOOD,
      model: 'platform',
    },
    // Mailbox post.
    { pos: { x: 2.4, y: 0.375, z: 4.8 }, size: { x: 0.08, y: 0.75, z: 0.08 }, colour: DARK_WOOD },
    ...gardenLamps,
    ...houseWalls,
    ...HOUSE_STAIRWAYS,
    // Kitchen: counter (drawers in its front), table.
    {
      pos: { x: -8, y: 0.45, z: 14.6 },
      size: { x: 3.2, y: 0.9, z: 0.6 },
      colour: 0xd9d4c7,
      model: 'counter',
    },
    {
      pos: { x: -8, y: 0.4, z: 9.5 },
      size: { x: 1.6, y: 0.8, z: 1 },
      colour: WOOD,
      model: 'table',
    },
    // Living room: sofa seat and back, bookshelf.
    {
      pos: { x: 0, y: 0.225, z: 14.3 },
      size: { x: 3, y: 0.45, z: 0.9 },
      colour: SOFA,
      model: 'sofa',
    },
    {
      pos: { x: 0, y: 0.6, z: 14.75 },
      size: { x: 3, y: 0.8, z: 0.2 },
      colour: SOFA,
      model: 'sofaBack',
    },
    {
      pos: { x: 3.2, y: 1, z: 14.65 },
      size: { x: 1, y: 2, z: 0.4 },
      colour: DARK_WOOD,
      model: 'bookshelf',
    },
    // Break room table.
    {
      pos: { x: 8, y: 0.4, z: 10.5 },
      size: { x: 2.2, y: 0.8, z: 1.2 },
      colour: WOOD,
      model: 'table',
    },
    // Bedroom, upstairs over the kitchen: a bed against the north wall.
    {
      pos: { x: -8.5, y: UP + 0.25, z: 13.83 },
      size: { x: 1.4, y: 0.5, z: 2.1 },
      colour: BLANKET,
      model: 'bed',
    },
    // Study, upstairs over the living room: a desk and a bookshelf.
    {
      pos: { x: -1.5, y: UP + 0.375, z: 14.53 },
      size: { x: 1.4, y: 0.75, z: 0.7 },
      colour: WOOD,
      model: 'table',
    },
    {
      pos: { x: 2.4, y: UP + 1, z: 14.68 },
      size: { x: 1, y: 2, z: 0.4 },
      colour: DARK_WOOD,
      model: 'bookshelf',
    },
    // Basement: the electrical panel on the north wall, and an old bookshelf.
    {
      pos: { x: 8.6, y: DOWN + 1.5, z: 14.81 },
      size: { x: 0.6, y: 0.8, z: 0.14 },
      colour: PANEL,
      model: 'panel',
    },
    {
      pos: { x: 4.32, y: DOWN + 0.9, z: 12 },
      size: { x: 0.4, y: 1.8, z: 1.2 },
      colour: DARK_WOOD,
      model: 'bookshelf',
      front: '+x',
    },
  ],
  stairs: [HOUSE_STAIRS, HOUSE_BASEMENT_STAIRS],
  groundHole: BASEMENT_SLAB,
  // Up to a little under the top of each roof: two storeys over the kitchen and living room,
  // one over the break room, and the basement under it. On the roofs is outside.
  interiors: [
    { rect: UPPER_SLAB, y0: -0.3, y1: 2 * UP - 0.3 },
    { rect: BASEMENT_SLAB, y0: DOWN - 0.3, y1: UP - 0.3 },
  ],
  decals: Object.values(HOUSE_ROOMS),
  inspector: { pos: { x: -12, y: 0, z: -4 }, size: { x: 2.4, z: 2.4 } },
  doneButton: { x: -1.8, y: 0, z: 1.4 },
  bell: { x: 1.8, y: 0, z: 1.4 },
  board: { pos: { x: -4, y: 1.3, z: 3.2 }, facing: Math.PI },
  // A second board beside the first, so a manual of 32 pages fits on them.
  moreBoards: [{ pos: { x: -6.2, y: 1.3, z: 3.2 }, facing: Math.PI }],
  // Against the basement's east wall (each layout puts it somewhere else down there).
  broom: { pos: { x: 11.62, y: DOWN, z: 13.5 }, facing: Math.PI / 2 },
  // In the south of the yard, aimed over the bins at the job site.
  catapult: { pos: { x: 3, y: 0, z: -13.3 }, facing: Math.atan2(3, -13.3) },
  pageSpots: [
    { x: 5.6, y: 0.8, z: -4.7 }, // yard table
    { x: -5, y: 0.6, z: -6 }, // crates
    { x: -4.2, y: 0.6, z: -6.3 },
    { x: 12.9, y: 1, z: -6.6 }, // up on the ledge
    { x: -15, y: 0, z: -15 }, // yard corners
    { x: 15, y: 0, z: -15 },
    { x: -9.2, y: 0, z: -5 }, // behind the short wall
    { x: -14.5, y: 0, z: -1 },
    { x: 14.5, y: 0, z: 3 },
    { x: -14, y: 0, z: 4.5 },
    // More on the ground, out along the fences and beside the house, so a manual of 32 pages
    // still leaves room for the gear.
    { x: -11, y: 0, z: -15.2 },
    { x: 0, y: 0, z: -15.2 },
    { x: 11, y: 0, z: -15.2 },
    { x: -15.2, y: 0, z: -11.5 },
    { x: 15.2, y: 0, z: -11.5 },
    { x: 14.5, y: 0, z: 9 },
    { x: -14.5, y: 0, z: 12 },
    { x: 14.5, y: 0, z: 13.5 },
    // Lying on the ground about the yard, spread out, so the longest manual (32 pages and their
    // halves) leaves room for the gear.
    { x: -2.2, y: 0, z: 2.8 },
    { x: 6.8, y: 0, z: 2.8 },
    { x: 5.3, y: 0, z: -11.2 },
    { x: -8.7, y: 0, z: 1.3 },
    { x: -5.7, y: 0, z: -12.2 },
    { x: 0.3, y: 0, z: -2.7 },
    { x: 1.8, y: 0, z: 6.8 },
    { x: 10.8, y: 0, z: -1.2 },
    { x: 8, y: HEIGHT + 0.2, z: 12.5 }, // on the roof
    { x: -8, y: 0.8, z: 9.5 }, // kitchen table
    { x: 3.2, y: 2, z: 14.65 }, // top of the bookshelf
    { x: 8.6, y: 0.8, z: 10.3 }, // break room table
    { x: -8.1, y: UP + 0.5, z: 13.2 }, // on the bed
    { x: -1.2, y: UP + 0.75, z: 14.5 }, // the study's desk
    { x: 2.4, y: UP + 2, z: 14.68 }, // top of the study's bookshelf
    { x: 4.32, y: DOWN + 1.8, z: 12 }, // top of the basement's bookshelf
  ],
  hideouts: [
    // Kitchen.
    {
      id: 1,
      kind: 'fridge',
      pos: { x: -11.5, y: 0.9, z: 13.8 },
      size: { x: 0.8, y: 1.8, z: 0.7 },
      facing: -Math.PI / 2,
    },
    {
      id: 2,
      kind: 'drawer',
      pos: { x: -9.1, y: 0.62, z: 14.33 },
      size: { x: 0.9, y: 0.22, z: 0.1 },
      facing: 0,
    },
    {
      id: 3,
      kind: 'drawer',
      pos: { x: -8, y: 0.62, z: 14.33 },
      size: { x: 0.9, y: 0.22, z: 0.1 },
      facing: 0,
    },
    {
      id: 4,
      kind: 'drawer',
      pos: { x: -6.9, y: 0.62, z: 14.33 },
      size: { x: 0.9, y: 0.22, z: 0.1 },
      facing: 0,
    },
    {
      id: 5,
      kind: 'rug',
      pos: { x: -6.2, y: 0.01, z: 8 },
      size: { x: 1.4, y: 0.02, z: 1 },
      facing: 0,
    },
    // Living room.
    {
      id: 6,
      kind: 'cushion',
      pos: { x: 0.7, y: 0.5, z: 14.2 },
      size: { x: 1.2, y: 0.1, z: 0.7 },
      facing: 0,
    },
    {
      id: 7,
      kind: 'cabinet',
      pos: { x: -3.1, y: 0.35, z: 14.55 },
      size: { x: 1.2, y: 0.7, z: 0.5 },
      facing: 0,
    },
    {
      id: 8,
      kind: 'rug',
      pos: { x: 0, y: 0.01, z: 10 },
      size: { x: 2.6, y: 0.02, z: 1.8 },
      facing: 0,
    },
    // Break room.
    {
      id: 9,
      kind: 'locker',
      pos: { x: 11.48, y: 1, z: 12.6 },
      size: { x: 0.6, y: 2, z: 0.8 },
      facing: Math.PI / 2,
    },
    {
      id: 10,
      kind: 'locker',
      pos: { x: 11.48, y: 1, z: 13.6 },
      size: { x: 0.6, y: 2, z: 0.8 },
      facing: Math.PI / 2,
    },
    {
      id: 11,
      kind: 'rug',
      pos: { x: 5.6, y: 0.01, z: 13.4 },
      size: { x: 1.2, y: 0.02, z: 0.9 },
      facing: 0,
    },
    // Yard.
    {
      id: 12,
      kind: 'mailbox',
      pos: { x: 2.4, y: 0.9, z: 4.8 },
      size: { x: 0.24, y: 0.3, z: 0.5 },
      facing: 0,
    },
    {
      id: 13,
      kind: 'toolbox',
      pos: { x: -9.5, y: 0.15, z: -13 },
      size: { x: 0.7, y: 0.3, z: 0.35 },
      facing: Math.PI,
    },
    {
      id: 14,
      kind: 'chest',
      pos: { x: 11, y: 0.3, z: 2 },
      size: { x: 0.8, y: 0.6, z: 0.6 },
      facing: Math.PI / 2,
    },
    // Bedroom: under the pillow, the nightstand, a chest, a rug.
    {
      id: 15,
      kind: 'cushion',
      pos: { x: -8.5, y: UP + 0.55, z: 14.45 },
      size: { x: 1, y: 0.1, z: 0.5 },
      facing: 0,
    },
    {
      id: 16,
      kind: 'cabinet',
      pos: { x: -10, y: UP + 0.3, z: 14.63 },
      size: { x: 0.6, y: 0.6, z: 0.5 },
      facing: 0,
    },
    {
      id: 17,
      kind: 'chest',
      pos: { x: -11.2, y: UP + 0.3, z: 10 },
      size: { x: 0.8, y: 0.6, z: 0.6 },
      facing: -Math.PI / 2,
    },
    {
      id: 18,
      kind: 'rug',
      pos: { x: -8, y: UP + 0.01, z: 10.5 },
      size: { x: 2, y: 0.02, z: 1.4 },
      facing: 0,
    },
    // Study: a toolbox by the wall, a rug.
    {
      id: 19,
      kind: 'toolbox',
      pos: { x: 3.4, y: UP + 0.15, z: 7.2 },
      size: { x: 0.7, y: 0.3, z: 0.35 },
      facing: Math.PI / 2,
    },
    {
      id: 20,
      kind: 'rug',
      pos: { x: 0, y: UP + 0.01, z: 10.5 },
      size: { x: 2.4, y: 0.02, z: 1.6 },
      facing: 0,
    },
    // Basement: an old chest.
    {
      id: 21,
      kind: 'chest',
      pos: { x: 10.5, y: DOWN + 0.3, z: 11 },
      size: { x: 0.8, y: 0.6, z: 0.6 },
      facing: Math.PI,
    },
  ],
  ladders: [LADDER],
  meetingSeats: [
    ...[6.6, 7.6, 8.6, 9.6].map((x) => ({ x, y: 0, z: 9.25 })),
    ...[6.6, 7.6, 8.6, 9.6].map((x) => ({ x, y: 0, z: 11.75 })),
    { x: 6.2, y: 0, z: 10.5 },
    { x: 9.9, y: 0, z: 10.5 },
  ],
  lights: [
    { x: -8, y: 2.3, z: 10.5 },
    { x: 0, y: 2.3, z: 10.5 },
    { x: 8, y: 2.3, z: 10.5 },
    { x: -8, y: UP + 2.3, z: 10.5 },
    { x: 0, y: UP + 2.3, z: 10.5 },
    { x: 8, y: DOWN + 2.3, z: 10.5 },
  ],
  moulds: HOUSE_MOULDS,
  machines: HOUSE_MACHINES,
};
