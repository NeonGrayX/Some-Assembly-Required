import { BRICK_TYPES } from '../bricks.ts';
import type { BrickTypeId } from '../bricks.ts';
import type { Prints, TargetBuild } from '../builds/types.ts';
import { printKey } from '../builds/types.ts';
import { add, rotate, v3, yawQuat } from '../math.ts';
import type { Quat, Vec3 } from '../math.ts';
import type { TerrainDef } from './terrain.ts';

/**
 * What a box or a floor is made of, which the client's painted style draws it as. Given where
 * its colour alone would not tell (the client guesses from the colour otherwise).
 */
export type SurfaceName =
  | 'wall'
  | 'wood'
  | 'planks'
  | 'tiles'
  | 'fabric'
  | 'dirt'
  | 'grass'
  | 'roof'
  | 'concrete'
  | 'metal'
  | 'masonry'
  | 'paving';

/** A colour to build with, and what it is made of: spread into a box or a floor. */
export interface Paint {
  colour: number;
  surface: SurfaceName;
}

/** A static, axis-aligned box (walls, tables, crates). `pos` is the box centre. */
/** How thick walls are, on every map. */
export const WALL_T = 0.2;

/**
 * The vacuum: from the floor to the top of its grip, across its head, and how far its motor and
 * the cord wound on its back stand out behind the handle (lying on its back, it rests on them).
 */
export const VACUUM = { length: 1.35, width: 0.34, depth: 0.105 };
/** How far a vacuum kept against a wall leans back from upright, in radians. */
export const VACUUM_LEAN = 0.2;
/**
 * How far from a wall's face a vacuum leaning on it stands its head: the top of its handle (and
 * the cap on it, 2 cm round) just touches the wall instead of going into it.
 */
export const VACUUM_FROM_WALL = VACUUM.length * Math.sin(VACUUM_LEAN) + 0.025;

export interface BoxDef {
  pos: Vec3;
  size: Vec3;
  colour: number;
  /** What it is made of, if its colour does not tell (see `SurfaceName`). */
  surface?: SurfaceName;
  /** Tilt around the x axis in radians, for ramps. */
  tiltX?: number;
  /**
   * What the box is, if it is a piece of furniture: it is then drawn as one (a table with
   * legs, a sofa with cushions…) fitted to the box, while it still collides as the box.
   */
  model?: BoxModel;
  /**
   * A model file to draw instead of `model`: the name of a .glb in `client/src/assets/props/`
   * (`'couch'` for `couch.glb`), standing on the middle of the box's bottom at its own size.
   * Without the file, or without `model`, the box is drawn as it would be without it. See
   * docs/09-prop-files.md.
   */
  asset?: string;
  /** Which side of the box is its front, for models that have one. Default -z. */
  front?: '-z' | '+z' | '-x' | '+x';
  /** What a sign says. */
  label?: string;
  /**
   * A pine's bare trunk: how far above its foot its lowest boughs start. Left out, they start
   * a little under half way up, as a wild pine's do.
   */
  boughs?: number;
  /** A railing round a stairwell, which players meet as a taller wall (see `Sim.railGuard`). */
  stairwell?: true;
  /**
   * What the box is to the map's own checks, where its size and place alone would only be a
   * guess: a plain wall of a building (walls may meet and overlap at a corner), the yard's
   * south fence (where rival teams' yards meet), or the slats of a shutter let down.
   */
  role?: 'wall' | 'southFence' | 'shutterSlats';
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
  | 'wheel'
  /**
   * A tank engine, drawn round the box of its frames (its chimney end towards +x): wheels,
   * boiler, tanks, cab and buffers. Its other parts collide as boxes of their own (`collider`).
   */
  | 'locomotive'
  /** A carriage's running gear for one axle on one side: the wheel, its W-iron and spring. */
  | 'axle'
  /** A carriage's arched roof with its gutters and ventilators. */
  | 'carriageRoof'
  /** The canvas gangway over the joint between two carriages. */
  | 'gangway'
  /** A painted strip along a carriage's side: lining, a band of livery or the valance. */
  | 'livery'
  /**
   * An open goods wagon, drawn round the box of its body: the load on top, its wheels, frames
   * and buffers below it down to the rails.
   */
  | 'wagon'
  /** A railway track's bed: ballast with sloping shoulders and the sleepers bedded in its top. */
  | 'ballast'
  /** A rail on a track's sleepers: its foot, web and head. */
  | 'trackRail'
  /** The water tower's round iron tank with its lid. */
  | 'waterTank'
  /** The pipe and hose of the water tower's spout. */
  | 'tankSpout'
  /** A pot-bellied iron stove. */
  | 'stove'
  /** A stove's round flue pipe. */
  | 'flue'
  /** A caravan's rounded roof with its rooflight. */
  | 'caravanRoof'
  /** A caravan's A-frame: the hitch, the jockey wheel and the gas locker. */
  | 'towHitch'
  /**
   * A palm: the box is its trunk, leaning and ringed, and its fronds are drawn out over the top
   * of it, wider than the box (like a pine's boughs, they stop nothing).
   */
  | 'palm'
  /** A great grey boulder, chunky and faceted, fitted to the box: its foot sunk in the ground. */
  | 'boulder'
  /** A wooden barrel bound with iron hoops, standing on its end. */
  | 'barrel'
  /** An iron cannon on its wooden carriage, its muzzle to the box's front. */
  | 'cannon'
  /** A rope railing along the box's long side: posts at its ends, a rope slung between. */
  | 'ropeRail'
  /**
   * A ship's hull fitted to the box, its bow to the box's front: planked sides curving in to
   * the keel, a gunwale round its deck, which is the box's top.
   */
  | 'hull'
  /** A ship's mast: the box is the pole, and its yards and striped sails are drawn out round it. */
  | 'mast'
  /** A flagpole, the box, with a pirate flag flying from its top out beyond the box. */
  | 'flagpole'
  /**
   * A pitched roof of planks over a building: the box from the eaves up to the ridge, which
   * runs along the box's long side, with gable ends.
   */
  | 'gableRoof'
  /** A fence of posts with a thick rope slung between them, along the box's long side. */
  | 'ropeFence'
  /**
   * An old mooring post standing in the sea, weathered and a little askew, with a turn of rope
   * round it: the box is the post, its foot down in the sea bed.
   */
  | 'piling'
  /**
   * The upper storey of a building, over the walls of its room and jutting out past them a
   * little all round: timber framing with cream plaster between, windows with shutters and
   * iron brackets under the jetty. Its front, the box's, looks the way the door below does. The
   * box is solid; nobody goes up there.
   */
  | 'storey'
  /**
   * A ship's lantern on a timber post: the box is the post, and an arm from its top carries an
   * iron lantern hung out beyond the box, where the light is.
   */
  | 'lanternPost'
  /** A coil of thick rope lying on its side in the box, its loose end trailing off. */
  | 'ropeCoil'
  /** An old iron anchor lying on its side in the box, its ring and a length of chain by it. */
  | 'anchor'
  | TrashBinModel;

/**
 * Rubbish bins for bricks nobody needs, one look per kind of place: a wheelie bin with its lid
 * flipped right back, a kitchen pedal bin, an office wire basket, a round litter bin on a
 * station platform, an oil drum at a campsite and an open wooden barrel on an island. All are
 * open at the top: a brick dropped or thrown in, or clicked onto the bin from the hands, is gone
 * for good (see `Sim`).
 */
export type TrashBinModel =
  'wheelieBin' | 'pedalBin' | 'basketBin' | 'litterBin' | 'drumBin' | 'barrelBin';

/** Each bin's box with its front (the side a player throws in from) facing -z. */
export const TRASH_BIN_SIZE: Record<TrashBinModel, Vec3> = {
  wheelieBin: { x: 0.6, y: 1.0, z: 0.8 },
  pedalBin: { x: 0.4, y: 0.62, z: 0.4 },
  basketBin: { x: 0.36, y: 0.42, z: 0.36 },
  litterBin: { x: 0.52, y: 0.9, z: 0.52 },
  drumBin: { x: 0.6, y: 0.9, z: 0.6 },
  barrelBin: { x: 0.62, y: 0.86, z: 0.62 },
};

/** Whether a level box is a rubbish bin. */
export const isTrashBin = (b: BoxDef): boolean =>
  b.model !== undefined && Object.hasOwn(TRASH_BIN_SIZE, b.model);

/**
 * A bin standing on the floor `y0` at (`x`, `z`), its front facing `front` (the box stays
 * axis-aligned, so a bin turned sideways is as wide in z as it is deep in x).
 */
export function trashBin(
  model: TrashBinModel,
  x: number,
  z: number,
  front: NonNullable<BoxDef['front']>,
  colour: number,
  y0 = 0,
): BoxDef {
  const s = TRASH_BIN_SIZE[model];
  const sideways = front === '-x' || front === '+x';
  return {
    pos: { x, y: y0 + s.y / 2, z },
    size: { x: sideways ? s.z : s.x, y: s.y, z: sideways ? s.x : s.z },
    colour,
    model,
    front,
  };
}

/**
 * The open top of a bin, where what falls in goes: the top of its box, less its rim and, for a
 * wheelie bin, the flipped-back lid hanging down its back.
 */
export function trashBinMouth(b: BoxDef): FloorRect & { y: number } {
  const rim = 0.04;
  const lid = b.model === 'wheelieBin' ? 0.08 : 0;
  const back = {
    '-z': [0, 0, 0, lid],
    '+z': [0, 0, lid, 0],
    '-x': [0, lid, 0, 0],
    '+x': [lid, 0, 0, 0],
  }[b.front ?? '-z'] as [number, number, number, number];
  return {
    x0: b.pos.x - b.size.x / 2 + rim + back[0],
    x1: b.pos.x + b.size.x / 2 - rim - back[1],
    z0: b.pos.z - b.size.z / 2 + rim + back[2],
    z1: b.pos.z + b.size.z / 2 - rim - back[3],
    y: b.pos.y + b.size.y / 2,
  };
}

/** A coloured patch drawn on the floor, with no collision (room floors). */
export interface DecalDef {
  pos: Vec3;
  size: { x: number; z: number };
  colour: number;
  /** What the floor is made of, if its colour does not tell (see `SurfaceName`). */
  surface?: SurfaceName;
}

/**
 * The brick works' machines: an injection moulding machine (a mould and pellets in, parts
 * out), the pellet silo (fills a bucket with pellets of any colour), the mould dispenser (hands
 * out the mould for any part) and the UV printer (prints a picture on a part).
 */
export type MachineKind = 'press' | 'silo' | 'dispenser' | 'printer';

export interface MachineDef {
  id: number;
  kind: MachineKind;
  /** Centre of its foot on the floor. */
  pos: Vec3;
  /** Its box, before turning. */
  size: Vec3;
  /**
   * Which way its front (where players stand to use it) looks, as a heading about +y: 0 toward
   * +z, a quarter turn toward +x, and so on; always a whole number of quarter turns.
   */
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
  /**
   * When the flight down to the basement runs under the flight up, in one stairwell: `over`
   * for the flight up, whose steps are treads with room to walk under them and whose open side
   * is left open below them, `under` for the flight down, which comes up past the treads' high
   * end and has no railing round its well (the flight up runs along over it).
   */
  stacked?: 'over' | 'under';
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
/** How deep a tread of a flight over another is, its front to its underside (two rises). */
const OVER_TREAD = 0.4;
/** How far past its steps' side the floor beside a flight over another is kept clear. */
const PANEL_GAP = 0.01;

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
  // Solid blocks from the floor up, or over another flight treads with room under them.
  const under = (i: number) =>
    s.stacked === 'over' ? Math.max(base, tidy(base + (i + 1) * rise - OVER_TREAD)) : base;
  for (let i = 0; i < steps; i++)
    boxes.push(
      box(rect(i * tread, (i + 1) * tread, -half, half), under(i), tidy(base + (i + 1) * rise), {
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
  // Over the flight down, the open side is left open under the treads, as the flight down
  // shows through it; it needs no railing round its well on the floor above, then.
  const [p0, p1] = across(open * (half + PANEL_GAP));
  if (s.stacked !== 'under')
    for (const q of [side, end])
      boxes.push(box(q, top, top + RH, { colour: DARK_WOOD, model: 'rail', stairwell: true }));
  const well = rect(wellStart, run, -half, half);
  return {
    flight: rect(0, run, -half, half),
    well,
    // Under another flight, the well and a strip along its open side, kept clear.
    railed: bounds(s.stacked === 'under' ? [well, rect(0, run, p0, p1)] : [well, side, end]),
    foot: rect(-STAIRS.landing, 0, -half, half),
    top: rect(run, run + STAIRS.landing, -half, half),
    boxes,
  };
}

/** The smallest rectangle round all of `qs`. */
const bounds = (qs: FloorRect[]): FloorRect => ({
  x0: Math.min(...qs.map((q) => q.x0)),
  x1: Math.max(...qs.map((q) => q.x1)),
  z0: Math.min(...qs.map((q) => q.z0)),
  z1: Math.max(...qs.map((q) => q.z1)),
});

/** Rounds away float dust, so plans print and compare cleanly. */
const tidy = (x: number) => Math.round(x * 1e6) / 1e6;

/** The upper floor's slab over the kitchen and living room, walls and all. */
export const UPPER_SLAB: FloorRect = { x0: -12.1, x1: 4.1, z0: 5.9, z1: 15.1 };
/** The break room's floor, over the basement, walls and all: the ground has a hole here. */
export const BASEMENT_SLAB: FloorRect = { x0: 3.9, x1: 12.1, z0: 5.9, z1: 15.1 };

/**
 * The slab of the floor a flight comes out on, with a stairwell cut out of it, and the flight's
 * steps and railings: everything in a level that changes with where the stairs are. A flight
 * down comes out on the floor over the basement (`basement`, the break room's unless it lies
 * under another room).
 */
export function upperFloor(s: StairsDef, basement: FloorRect = BASEMENT_SLAB): BoxDef[] {
  const plan = stairsPlan(s);
  const down = s.pos.y < 0;
  const { x0, x1, z0, z1 } = down ? basement : UPPER_SLAB;
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
      ...(down ? CONCRETE : ROOF),
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
 * basements (whose own floors and the break rooms' slabs over them are boxes). None on a map
 * whose ground is terrain.
 */
export function groundPieces(level: LevelDef): FloorRect[] {
  // Terrain is ground of its own (see `TerrainDef`), with nothing flat under it.
  if (level.terrain?.length) return [];
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
  /** What that ground is, if not trodden earth or gravel (the house's yard is paved). */
  groundSurface?: SurfaceName;
  /** Water: players wade slowly through it (and the dog keeps out). */
  water?: FloorRect[];
  /**
   * Ground that rises and falls (see `TerrainDef`), in place of the flat ground at y = 0: one
   * piece, or two for rival teams' doubled level. Read it through `groundHeight`.
   */
  terrain?: TerrainDef[];
  /**
   * The sea's level, round an island: wherever the terrain lies below it is water, waded
   * through slowly like `water` (see `inSea`), and drawn out to the horizon.
   */
  sea?: number;
  boxes: BoxDef[];
  decals: DecalDef[];
  /**
   * The brick works: moulding machines, the pellet silo, the mould dispenser and the UV
   * printer, every site's.
   */
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
  /** The windows in the level's walls (they may move with the layout); none if left out. */
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
   * Where the vacuum is kept, leaning against a basement wall: the spot on the floor its head
   * rests on, and the way its bristles face (away from the wall), as a yaw.
   */
  vacuum: { pos: Vec3; facing: number };
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
 * The catapult's solid parts besides its frame, as boxes in its own space tilted about x by
 * `tiltX`: the two uprights, the axle between them, the arm at rest (stopping short of the
 * bucket, which is stepped into), and the counterweight. Nobody walks through them.
 */
export function catapultSolids(): { centre: Vec3; half: Vec3; tiltX: number }[] {
  const { frame, axle, arm, bucket } = CATAPULT;
  const up = axle.y - frame.size.y;
  /** A point on the arm, `along` it from the axle (back positive) and `down` below its line. */
  const onArm = (along: number, down: number): Vec3 => ({
    x: 0,
    y: axle.y - down * Math.cos(arm.rest) - along * Math.sin(arm.rest),
    z: axle.z - down * Math.sin(arm.rest) + along * Math.cos(arm.rest),
  });
  const armTo = arm.back - bucket.radius;
  return [
    ...[-0.5, 0.5].map((x) => ({
      centre: { x, y: frame.size.y + up / 2, z: axle.z },
      half: { x: 0.07, y: up / 2, z: 0.07 },
      tiltX: 0,
    })),
    {
      centre: { x: 0, y: axle.y, z: axle.z },
      half: { x: frame.size.x / 2 + 0.05, y: 0.05, z: 0.05 },
      tiltX: 0,
    },
    {
      centre: onArm((armTo - arm.front) / 2, 0),
      half: { x: 0.07, y: 0.06, z: (armTo + arm.front) / 2 },
      tiltX: arm.rest,
    },
    { centre: onArm(-arm.front, 0.3), half: { x: 0.25, y: 0.25, z: 0.25 }, tiltX: arm.rest },
  ];
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

/** The yard fences' colour. */
export const FENCE = 0xd8cfc0;
const WALL: Paint = { colour: 0xece4d4, surface: 'wall' };
const WOOD = 0x9a6b43;
const DARK_WOOD = 0x6b4a2f;
const ROOF: Paint = { colour: 0x8c4b3a, surface: 'roof' };
const LAMP_POST = 0x2f3336;
const SOFA = 0x4f6d8f;
const BLANKET = 0x5f7f6a;
const STEP = 0xe9e1d0;
const CONCRETE: Paint = { colour: 0x8d8a84, surface: 'concrete' };
const BASEMENT_WALL: Paint = { colour: 0xbdb6a8, surface: 'concrete' };
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
  {
    pos: { x: -6.55, y: HEIGHT / 2, z: 6 },
    size: { x: 11.1, y: HEIGHT, z: T },
    ...WALL,
    role: 'wall',
  },
  {
    pos: { x: 6.55, y: HEIGHT / 2, z: 6 },
    size: { x: 11.1, y: HEIGHT, z: T },
    ...WALL,
    role: 'wall',
  },
  {
    pos: { x: 0, y: HEIGHT / 2, z: 15 },
    size: { x: 24.2, y: HEIGHT, z: T },
    ...WALL,
    role: 'wall',
  },
  {
    pos: { x: -12, y: HEIGHT / 2, z: 10.5 },
    size: { x: T, y: HEIGHT, z: 9 - T },
    ...WALL,
    role: 'wall',
  },
  {
    pos: { x: 12, y: HEIGHT / 2, z: 10.5 },
    size: { x: T, y: HEIGHT, z: 9 - T },
    ...WALL,
    role: 'wall',
  },
  // The inner walls run from the front wall's inner face to the back wall's, either side of
  // their doorways.
  ...[-4, 4].flatMap((x): BoxDef[] => [
    {
      pos: { x, y: HEIGHT / 2, z: 7.55 },
      size: { x: T, y: HEIGHT, z: 2.9 },
      ...WALL,
      role: 'wall',
    },
    {
      pos: { x, y: HEIGHT / 2, z: 12.95 },
      size: { x: T, y: HEIGHT, z: 3.9 },
      ...WALL,
      role: 'wall',
    },
  ]),
  // Headers over the front door and the two inner doorways.
  { pos: { x: 0, y: HEIGHT - HEADER / 2, z: 6 }, size: { x: 2, y: HEADER, z: T }, ...WALL },
  ...[-4, 4].map((x) => ({
    pos: { x, y: HEIGHT - HEADER / 2, z: 10 },
    size: { x: T, y: HEADER, z: 2 },
    ...WALL,
  })),
  // Flat roof over the break room you can walk on (reach it by the ladder on the south wall,
  // or out of the upper floor's door).
  { pos: { x: 8.1, y: HEIGHT + 0.1, z: 10.5 }, size: { x: 8, y: 0.2, z: 9.2 }, ...ROOF },
  ...roofRailing(),
  // The upper floor over the kitchen and living room: the same walls again, standing on its
  // slab (see `upperFloor`), with a doorway between its two rooms and one out onto that roof.
  {
    pos: { x: -4, y: UP + HEIGHT / 2, z: 6 },
    size: { x: 16.2, y: HEIGHT, z: T },
    ...WALL,
    role: 'wall',
  },
  {
    pos: { x: -4, y: UP + HEIGHT / 2, z: 15 },
    size: { x: 16.2, y: HEIGHT, z: T },
    ...WALL,
    role: 'wall',
  },
  {
    pos: { x: -12, y: UP + HEIGHT / 2, z: 10.5 },
    size: { x: T, y: HEIGHT, z: 9 - T },
    ...WALL,
    role: 'wall',
  },
  ...[-4, 4].flatMap((x): BoxDef[] => [
    {
      pos: { x, y: UP + HEIGHT / 2, z: 7.55 },
      size: { x: T, y: HEIGHT, z: 2.9 },
      ...WALL,
      role: 'wall',
    },
    {
      pos: { x, y: UP + HEIGHT / 2, z: 12.95 },
      size: { x: T, y: HEIGHT, z: 3.9 },
      ...WALL,
      role: 'wall',
    },
    {
      pos: { x, y: UP + HEIGHT - HEADER / 2, z: 10 },
      size: { x: T, y: HEADER, z: 2 },
      ...WALL,
    },
  ]),
  // And its own flat roof.
  {
    pos: { x: -4, y: UP + HEIGHT + 0.1, z: 10.5 },
    size: { x: 16.2, y: 0.2, z: 9.2 },
    ...ROOF,
  },
  // The basement under the break room: a concrete floor and four walls up to the break room's
  // floor (see `upperFloor`), the same lines as the walls above.
  {
    pos: { x: 8, y: DOWN - 0.1, z: 10.5 },
    size: { x: 8.2, y: 0.2, z: 9.2 },
    ...CONCRETE,
  },
  ...[6, 15].map((z): BoxDef => ({
    pos: { x: 8, y: DOWN + HEIGHT / 2, z },
    size: { x: 8.2, y: HEIGHT, z: T },
    ...BASEMENT_WALL,
    role: 'wall',
  })),
  ...[4, 12].map((x): BoxDef => ({
    pos: { x, y: DOWN + HEIGHT / 2, z: 10.5 },
    size: { x: T, y: HEIGHT, z: 9 - T },
    ...BASEMENT_WALL,
    role: 'wall',
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
 * The brick works, about the yard south of the job site: two injection moulding machines, the
 * pellet silo, the mould dispenser and the UV printer, each standing on its own. A mould from
 * the dispenser goes into a moulding machine, a bucket of coloured pellets from the silo goes
 * into its hopper, and the machine makes that part in that colour; the printer prints a picture
 * on a part that carries one.
 */

/** Each machine's box, before turning: its front is the +z face. */
export const MACHINE_SIZE: Record<MachineKind, Vec3> = {
  press: { x: 2.8, y: 1.6, z: 1.1 },
  silo: { x: 1.5, y: 3.2, z: 1.5 },
  dispenser: { x: 1.5, y: 2.0, z: 0.8 },
  printer: { x: 1.5, y: 1.05, z: 0.8 },
};

/** Every part the moulding machines make, in the catalogue's order: the dispenser has a mould for each. */
export const MOULD_TYPES: BrickTypeId[] = (Object.keys(BRICK_TYPES) as BrickTypeId[]).filter(
  (t) => !BRICK_TYPES[t].fixture,
);

/** The machines of a brick works, in the order maps stand them, with their ids. */
export const MACHINES: { kind: MachineKind; id: number }[] = [
  { kind: 'silo', id: 2 },
  { kind: 'press', id: 1 },
  { kind: 'dispenser', id: 5 },
  { kind: 'press', id: 3 },
  { kind: 'printer', id: 4 },
];

/** A machine standing with its foot centred on (`x`, `z`), its front turned `facing`. */
export function machineAt(
  kind: MachineKind,
  id: number,
  x: number,
  z: number,
  facing: number,
): MachineDef {
  return { id, kind, pos: { x, y: 0, z }, size: { ...MACHINE_SIZE[kind] }, facing };
}

const QUARTER = Math.PI / 2;

/**
 * The house's: the silo in the south-west corner of the yard with a moulding machine along the
 * west fence beside it and one against the south fence, the dispenser out in the yard south of
 * the inspector, and the printer by the yard table, all turned toward where players come from.
 */
const HOUSE_MACHINES: MachineDef[] = [
  machineAt('silo', 2, -12.8, -14.4, 0),
  machineAt('press', 1, -3.6, -14.6, 0),
  machineAt('dispenser', 5, -9.2, -9.6, QUARTER),
  machineAt('press', 3, -14.85, -10.6, QUARTER),
  machineAt('printer', 4, 8.4, -7.4, -QUARTER),
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
 * Points spread over the yard on a 3 m grid, kept well clear of posts, machines and walls (and
 * out of the corner behind the silo), so the dog roams all of it rather than a ring round the
 * fence; and every clear walk of up to
 * 4.3 m that joins them to each other and to the hand-placed points in the yard (they follow
 * those, from 23 on).
 */
const YARD_DOG_POINTS: Vec3[] = [
  { x: -14.5, y: 0, z: -5.5 },
  { x: -14.5, y: 0, z: -2.5 },
  { x: -14.5, y: 0, z: 0.5 },
  { x: -14.5, y: 0, z: 3.5 },
  { x: -11.5, y: 0, z: -11.5 },
  { x: -11.5, y: 0, z: -8.5 },
  { x: -11.5, y: 0, z: -5.5 },
  { x: -11.5, y: 0, z: -2.5 },
  { x: -11.5, y: 0, z: 0.5 },
  { x: -11.5, y: 0, z: 3.5 },
  { x: -8.5, y: 0, z: -14.5 },
  { x: -8.5, y: 0, z: -11.5 },
  { x: -8.5, y: 0, z: 3.5 },
  { x: -5.5, y: 0, z: -11.5 },
  { x: -5.5, y: 0, z: -8.5 },
  { x: -5.5, y: 0, z: -2.5 },
  { x: -5.5, y: 0, z: 0.5 },
  { x: -2.5, y: 0, z: -11.5 },
  { x: -2.5, y: 0, z: -8.5 },
  { x: -2.5, y: 0, z: -5.5 },
  { x: -2.5, y: 0, z: -2.5 },
  { x: -2.5, y: 0, z: 0.5 },
  { x: 0.5, y: 0, z: -14.5 },
  { x: 0.5, y: 0, z: -11.5 },
  { x: 0.5, y: 0, z: -8.5 },
  { x: 0.5, y: 0, z: -5.5 },
  { x: 0.5, y: 0, z: -2.5 },
  { x: 0.5, y: 0, z: 3.5 },
  { x: 3.5, y: 0, z: -8.5 },
  { x: 3.5, y: 0, z: -2.5 },
  { x: 3.5, y: 0, z: 0.5 },
  { x: 3.5, y: 0, z: 3.5 },
  { x: 6.5, y: 0, z: -11.5 },
  { x: 6.5, y: 0, z: -8.5 },
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
];
const YARD_DOG_LINKS: [number, number][] = [
  [0, 13],
  [0, 50],
  [0, 54],
  [13, 44],
  [13, 50],
  [14, 32],
  [14, 35],
  [14, 39],
  [15, 27],
  [15, 28],
  [15, 34],
  [16, 40],
  [16, 45],
  [16, 46],
  [16, 47],
  [17, 61],
  [17, 66],
  [17, 67],
  [18, 22],
  [18, 58],
  [18, 59],
  [18, 64],
  [18, 65],
  [19, 24],
  [19, 25],
  [19, 26],
  [19, 30],
  [19, 31],
  [19, 32],
  [21, 23],
  [21, 28],
  [21, 29],
  [22, 54],
  [22, 58],
  [22, 59],
  [22, 65],
  [23, 24],
  [23, 28],
  [23, 29],
  [23, 30],
  [24, 25],
  [24, 29],
  [24, 30],
  [24, 31],
  [25, 30],
  [25, 31],
  [25, 32],
  [26, 31],
  [26, 32],
  [27, 28],
  [27, 34],
  [28, 29],
  [29, 30],
  [30, 31],
  [31, 32],
  [31, 35],
  [32, 35],
  [33, 34],
  [33, 36],
  [34, 36],
  [34, 37],
  [35, 39],
  [36, 37],
  [36, 40],
  [36, 41],
  [37, 40],
  [37, 41],
  [38, 39],
  [38, 42],
  [38, 43],
  [38, 44],
  [39, 43],
  [39, 44],
  [40, 41],
  [40, 45],
  [40, 46],
  [40, 47],
  [41, 42],
  [41, 46],
  [41, 47],
  [41, 48],
  [42, 43],
  [42, 48],
  [42, 49],
  [43, 44],
  [43, 48],
  [43, 49],
  [45, 46],
  [46, 47],
  [46, 51],
  [47, 48],
  [47, 51],
  [48, 49],
  [48, 51],
  [48, 52],
  [49, 52],
  [49, 53],
  [50, 54],
  [51, 55],
  [51, 56],
  [52, 53],
  [52, 57],
  [52, 58],
  [53, 54],
  [53, 57],
  [53, 58],
  [53, 59],
  [54, 58],
  [54, 59],
  [55, 56],
  [55, 60],
  [55, 61],
  [56, 61],
  [57, 58],
  [57, 62],
  [57, 63],
  [58, 59],
  [58, 64],
  [58, 65],
  [59, 64],
  [59, 65],
  [60, 61],
  [60, 66],
  [60, 67],
  [61, 66],
  [61, 67],
  [62, 63],
  [63, 64],
  [63, 68],
  [64, 65],
  [64, 68],
  [65, 69],
  [66, 67],
  [68, 69],
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
 * Half the yard's width: the fences stand this far out from the middle, which leaves a path
 * round the back of the house a few metres wide.
 */
export const YARD_HALF = 18;

/**
 * The yard and the house. The job site, bins, inspector and a ramp to a ledge are in the yard;
 * the house to the north has a kitchen, a living room and the break room where meetings are
 * held, full of drawers and rugs to hide pages in, and a roof reached by a ladder.
 */
export const HOUSE: LevelDef = {
  floorSize: 2 * YARD_HALF,
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
      { x: -12.5, y: 0, z: -12 }, // 15: yard, south-west, by the silo
      { x: 0, y: 0, z: -12 }, // 16: yard, south
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
    {
      pos: { x: 0, y: 1, z: -YARD_HALF },
      size: { x: 2 * YARD_HALF, y: 2, z: 0.3 },
      colour: FENCE,
      role: 'southFence',
    },
    { pos: { x: 0, y: 1, z: YARD_HALF }, size: { x: 2 * YARD_HALF, y: 2, z: 0.3 }, colour: FENCE },
    // The east and west fences fit between the other two, so no corner is drawn twice.
    {
      pos: { x: -YARD_HALF, y: 1, z: 0 },
      size: { x: 0.3, y: 2, z: 2 * YARD_HALF - 0.3 },
      colour: FENCE,
    },
    {
      pos: { x: YARD_HALF, y: 1, z: 0 },
      size: { x: 0.3, y: 2, z: 2 * YARD_HALF - 0.3 },
      colour: FENCE,
    },
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
    // Ramp up to a ledge in the east of the yard, its top meeting the ledge's at its high end.
    {
      pos: { x: 13.5, y: 0.39, z: -4 },
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
  vacuum: { pos: { x: 11.9 - VACUUM_FROM_WALL, y: DOWN, z: 13.5 }, facing: Math.PI / 2 },
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
    { x: -12.4, y: 0, z: -12 }, // between the silo and the press beside it
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
  // Kept clear of the counter, sofa, fridge, lockers, stairs and the ladder.
  windows: [
    // South wall, either side of the front door (past the stairs in the kitchen).
    { x: -10.9, z: 6, alongX: true },
    { x: 7.5, z: 6, alongX: true },
    // North wall: over the kitchen counter, over the sofa, in the break room.
    { x: -8, z: 15, alongX: true },
    { x: 0, z: 15, alongX: true },
    { x: 8, z: 15, alongX: true },
    // End walls.
    { x: -12, z: 10, alongX: false },
    { x: 12, z: 9.5, alongX: false },
    // Upstairs: the bedroom over the stairs and at its west end, the study front and back.
    { x: -8, z: 6, y: UP, alongX: true },
    { x: -12, z: 11.5, y: UP, alongX: false },
    { x: 0, z: 6, y: UP, alongX: true },
    { x: 0, z: 15, y: UP, alongX: true },
  ],
  machines: HOUSE_MACHINES,
};
