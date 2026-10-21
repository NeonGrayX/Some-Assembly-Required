import type RAPIER from '@dimforge/rapier3d-compat';
import type {
  Collider,
  ColliderDesc,
  KinematicCharacterController,
  Shape,
  RigidBody,
  World,
} from '@dimforge/rapier3d-compat';
import { BASEPLATE_SIZE, BRICK_TYPES, COLOURS, PLATE_H, STUD, footprint } from '../bricks.ts';
import type { BrickTypeId, ColourId, Rotation } from '../bricks.ts';
import type { GearId } from '../gear.ts';
import type { FurnitureState } from '../net/protocol.ts';
import type { SabotageTool } from '../round.ts';
import { planBreaks } from '../breaking.ts';
import { DOG_RADIUS, Dog } from './dog.ts';
import { DT, TICK_RATE, seconds } from './time.ts';
import type { DogHost, StealTarget, WreckTarget } from './dog.ts';
import type { Connection, Placement, PlacedBrick } from '../grid.ts';
import { BrickGrid, localCentre } from '../grid.ts';
import {
  canFlip,
  computeGroupSnap,
  computeLayerSnap,
  latticeSnap,
  sideSnap,
  spinSnap,
  snapLayer,
} from '../snap.ts';
import type { SnapLayer } from '../snap.ts';
import { partBox, partQuat, placedColliders } from '../parts.ts';
import { frameQuat, unframeMetres, unframeTurn } from '../frames.ts';
import type { Frame } from '../frames.ts';
import type { PrintedPage } from '../builds/forgery.ts';
import type { Prints, TargetBuild } from '../builds/types.ts';
import {
  VACUUM,
  VACUUM_LEAN,
  machinePose,
  machineOutputs,
  outputSlots,
  printJobs,
  MOULD_TYPES,
  BOARD_FACE_SLOTS,
  BOARD_SIZE,
  BOARD_SLOTS,
  BUTTON_SIZE,
  STAIRS,
  UPPER_FLOOR,
  groundPieces,
  indoors,
  CATAPULT,
  catapultBucket,
  catapultSolids,
  isTrashBin,
  levelBoards,
  trashBinMouth,
  levelSites,
  stairsAxes,
} from '../content/house.ts';
import type {
  BoxDef,
  FloorRect,
  GadgetDef,
  HideoutDef,
  LadderDef,
  LevelDef,
  MachineDef,
  OutputSlot,
  PrintJob,
  SiteDef,
  MeshDef,
  SlidingDoorDef,
  SolidDef,
} from '../content/house.ts';
import { meshOf } from '../content/maps/meshes.ts';
import { makeableColours } from '../builds/variant.ts';
import { sideOf } from '../content/rival.ts';
import { groundHeight, groundSlope, inSea, terrainTriangles } from '../content/terrain.ts';
import {
  hideoutBody,
  hideoutPartInWorld,
  inWorld,
  dropSpot,
  openingIn,
} from '../content/hideouts.ts';
import type { PartPose } from '../content/hideouts.ts';
import {
  IDENTITY,
  add,
  conj,
  dot,
  length,
  makeRng,
  mulQuat,
  rotate,
  rotationError,
  scale,
  sub,
  v3,
  yawOf,
  yawQuat,
} from '../math.ts';
import type { Quat, Vec3 } from '../math.ts';

type Rapier = typeof RAPIER;

export { DT, TICK_RATE } from './time.ts';

// Player
export const PLAYER_RADIUS = 0.3;
export const PLAYER_HALF_HEIGHT = 0.55;
/** How far below the centre of a player's capsule their feet are. */
export const PLAYER_FEET = PLAYER_HALF_HEIGHT + PLAYER_RADIUS;
/** Eye height above the capsule centre. */
export const EYE_OFFSET = 0.6;
/** The gap the character controller keeps between a player and what they stand on or touch. */
export const CONTROLLER_OFFSET = 0.02;
/**
 * How players move, as they walk about car-test.html: at once at the pace asked for, on the
 * ground and in the air alike (m/s).
 */
export const WALK_SPEED = 4.2;
const SPRINT_SPEED = 7.5;
const CAREFUL_SPEED = 1.3;
const JUMP_SPEED = 6.2;
const CLIMB_SPEED = 2.4;
/**
 * How high a player steps up without jumping (m), no higher than there is room overhead; held
 * up on the ground, they try stepping up by each of `CLIMB_TRIES` in turn (see `climb`).
 */
const STEP_UP = 0.45;
const CLIMB_TRIES = [0.2, 0.32, STEP_UP];
/**
 * How far round their middle a player's feet stand (m), and how far below them the ground may
 * be there for them to stand: the capsule's round foot reaches out past theirs, and can rest on
 * an edge their feet are well clear of, which they slip off at `SLIP_SPEED` (m/s).
 */
const FOOT = 0.16;
const UNDERFOOT = 0.05;
const SLIP_SPEED = 2.5;
/**
 * Squeezing through a gap narrower than their shoulders: how far their shoulders reach out to
 * each side, how deep they are side-on (half of it), how fast they edge along (m/s), and how far
 * before and behind them a gap's sides are looked for (m).
 */
const SQUEEZE = { shoulder: 0.37, slim: 0.17, edge: 1.4, reach: 0.3 };
/** A ladder is taken from the ground when facing within this (as a cosine: about 70°) of it. */
const LADDER_FACING_COS = 0.35;
/**
 * How much further out to the sides and back from a ladder a player stepping backwards off
 * whatever it reaches is still caught by it, so backing off the top at an angle climbs down
 * rather than missing it and dropping to the ground.
 */
const LADDER_CATCH = 0.6;
/**
 * How much further out to either side of a ladder a player walking into it from the
 * ground still takes hold of it (and is drawn onto it), so it need not be met dead centre.
 */
const LADDER_REACH = 0.3;
/** How far in past a ladder's top a player pushing on is still taken straight in off it. */
const LADDER_TOP_IN = 0.8;
/** How straight at a ladder (as a cosine: about 45°) that takes walking. */
const LADDER_INTO = 0.7;
/** How fast (per second, of the distance left) a caught climber is drawn onto the ladder. */
const LADDER_PULL = 8;
/** What players fall by: their own gravity, not the physics world's (`WORLD_GRAVITY`). */
const GRAVITY = 15;
const WORLD_GRAVITY = 9.81;
const REACH = 2.6;
/** Seconds of work at the electrical panel to get the power back on. */
export const REPAIR_SECONDS = 3;
/** Seconds of work at a machine a saboteur tampered with to get it going again. */
export const UNJAM_SECONDS = 4;

// Working a machine
/** How far out from where they click a machine a player stands to work it (m). */
export const WORK_STANDOFF = 0.55;
/** Near enough to where they stand to work a machine to stop walking there (m). */
const WORK_CLOSE = 0.08;
/** How long they walk up to a machine at most before working it where they are. */
const WORK_WALK_TICKS = seconds(1.5);
/** How long they stay at a machine working it, once there (clearing a jam: till it is clear). */
export const WORK_TICKS = seconds(1.1);

// Knock-downs
/** How long a trip or a hit keeps a player on the ground. */
export const DOWN_TICKS = Math.round(2.5 * TICK_RATE);
/** A hard landing (jumping off the roof) keeps them down for less. */
const LANDING_DOWN_TICKS = Math.round(1.4 * TICK_RATE);
/** Falling faster than this (m/s) when landing knocks a player over. */
const HARD_LANDING_SPEED = 8.5;
/** Hits from assemblies at least this heavy (kg) and fast (m/s) knock a player over. */
const HIT_MASS = 5;
const HIT_SPEED = 3.5;
/** Chance per second to trip while sprinting with a build, per kg it weighs. */
const TRIP_CHANCE_PER_KG = 0.012;
/** How fast someone slides along the floor when they fall (m/s), losing speed quickly. */
const FALL_SLIDE = 2.2;
/** Limping after stepping on a brick: slower, and no sprinting. */
export const LIMP_TICKS = 10 * TICK_RATE;
const LIMP_FACTOR = 0.45;
/**
 * Carry fatigue: after this long carrying a build (not a single brick) arms tire and the
 * carrier slows down, at `TIRED_DROP_TICKS` they set it down, and a tired player cannot lift a
 * build again until rested below the first mark. Rest takes as long as the carrying did.
 */
export const TIRED_TICKS = 45 * TICK_RATE;
export const TIRED_DROP_TICKS = 60 * TICK_RATE;
/** Speed at the drop mark, against fresh arms. */
const TIRED_SPEED = 0.5;
/** Clicks on a build someone else carries that tug it out of their hands. */
export const TUG_CLICKS = 6;
/** The most time between two clicks of one tug before it starts over. */
const TUG_GAP_TICKS = Math.round(0.5 * TICK_RATE);
/** How hard a clumsy stumble knocks the build in front (velocity change, m/s). */
const CLUMSY_SEVERITY = 4.2;
/** How far in front of a stumbling player things get caught (m). */
const CLUMSY_REACH = 1.0;
/** How far out from the baseplate's edge the hungry dog stands to wreck the build. */
const WRECK_STAND_OUT = 0.25;
/**
 * Bricks whose middle is this close to where it stands (flat), and this low, it knocks off: about
 * the near half of the baseplate.
 */
const WRECK_REACH = 1.1;
const WRECK_HEIGHT = 0.95;
/** Loose bricks lower than this above the floor under a player's feet hurt to step on. */
const STEP_HEIGHT = 0.2;
/**
 * On a flight of stairs a player is kept this far in from either edge of the steps (to the
 * handrail on the open side), and brought back in by at most `STAIRS_SLIDE` a tick.
 */
export const STAIRS_MARGIN = 0.08;
export const STAIRS_SLIDE = 0.05;
/**
 * How far over a guarded railing (round a stairwell or a roof) players meet a wall they cannot
 * see. At the top of a jump (1.3 m up) a player steps onto anything up to `STEP_UP` higher,
 * railings included: perched on one, head in the ceiling, they were stuck there, and off a roof
 * they went over it.
 */
const RAIL_GUARD = 1;
/**
 * The vacuum's head goes where the crosshair meets the floor, kept between this near and this
 * far ahead of the player and no further than this to either side; a pull sucks up what lies
 * on the floor this close round it. One pull at most this often.
 */
const SUCK_NEAR = 0.4;
const SUCK_REACH = 1.3;
const SUCK_ASIDE = 0.7;
const SUCK_RADIUS = 0.45;
const SUCK_TICKS = Math.round(0.4 * TICK_RATE);
/** How many bricks the vacuum holds before it has to be emptied into a rubbish bin. */
export const VACUUM_CAPACITY = 10;
/** Size of a piece of gear lying about (its collider, and about what the client draws). */
export const GEAR_SIZE = { x: 0.3, y: 0.14, z: 0.3 };
/** The litter of a gear hunt: small bricks scattered around every dog point, this far out. */
const LITTER_SPREAD = 1.1;
const LITTER_TYPES: BrickTypeId[] = ['1x1', '1x2', 'plate1x2'];
/** The colours litter comes in: the everyday ones. */
const LITTER_COLOURS: ColourId[] = ['red', 'white', 'yellow', 'blue', 'light-grey', 'black'];
/** How many parts one bucket of pellets makes. */
export const BUCKET_SHOTS = 10;
/**
 * How long (seconds) the brick works take to make a mould, a bucket of pellets or a part and
 * put it in the machine's output area: as long as the machine's animation runs (see
 * `MachineView` on the client, which plays them for exactly this long), so it is there to take
 * just as it comes to rest.
 */
export const MAKE_SECONDS = { mould: 1.6, bucket: 1.8, part: 2.4 } as const;
/** `MAKE_SECONDS` in simulation steps. */
export const MAKE_TICKS = {
  mould: seconds(MAKE_SECONDS.mould),
  bucket: seconds(MAKE_SECONDS.bucket),
  part: seconds(MAKE_SECONDS.part),
};
/**
 * How far past where the aim meets a machine it may still find a thing lying in the machine's
 * output area (m), seen through the opening in the machine's front (`OutputSlot.mouth`):
 * enough to see to the back of the press's bay from in front and above.
 */
const OUTPUT_SEE_THROUGH = 0.35;
/** How far round the edge of an output area's opening the aim may pass, for its bevelled lip. */
const MOUTH_SLACK = 0.035;
/** The small bricks a barefoot trap spills. */
const TRAP_BRICKS: { type: BrickTypeId; colour: ColourId }[] = [
  { type: '1x1', colour: 'red' },
  { type: '1x2', colour: 'yellow' },
  { type: '1x1', colour: 'white' },
];

// Camera (shared so the server can reproduce the client's aim ray)
export const CAMERA_DISTANCE = 2.6;
export const CAMERA_SHOULDER = 0.75;
export const CAMERA_LIFT = 0.3;
/** How near the camera's lens reaches round it (m): anything nearer it would cut through. */
const CAMERA_LENS = 0.1;
/** What a floor or a ceiling is, for the camera: a box no thicker than this, and this wide both ways. */
const SLAB = { thick: 0.6, wide: 1.5 };

// Sliding doors
/** How near (m, across the ground) anyone comes to a sliding door before it opens. */
export const DOOR_NEAR = 1.7;
/** How long (s) a sliding door takes to open or shut. */
const DOOR_TIME = 0.6;
/** How much of its way a door that stands out first (a bus's) spends standing out. */
const DOOR_OUT = 0.3;

/** Eased from 0 at `a` to 1 at `b` (smootherstep), as the models' doors are drawn moving. */
function eased(t: number, a: number, b: number): number {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** How far `door` has moved from shut, `t` of the way open (0 to 1). */
export function doorOffset(door: SlidingDoorDef, t: number): Vec3 {
  const { out, along } = door;
  const split = out.x || out.y || out.z ? DOOR_OUT : 0;
  return add(scale(out, split ? eased(t, 0, split) : 0), scale(along, eased(t, split, 1)));
}

// Bricks
const BRICK_DENSITY = 300;
/**
 * A held brick sits in front of the player's chest, between the hands: `up` above the middle
 * of the body, its near face `front` ahead of it. Where the player looks does not move it.
 */
const HOLD = { up: 0.15, front: 0.27 };
/** Room left between the player's collision capsule and the near side of a carried build. */
const BUILD_HOLD_GAP = 0.06;
/** Fastest a held item's hold point is followed outright, so a teleport does not fling it. */
const MAX_HOLD_FOLLOW = 20;
const THROW_SPEED = 7;
/** The knock (velocity change, m/s) a build takes when it is picked up. */
const LIFT_SEVERITY = 1;
/** Ticks after an assembly is created during which impacts do not break it. */
const BREAK_GRACE_TICKS = 20;
/** Half the thickness of the plank `clearForDog` sweeps across the dog's width. */
const DOG_PLANK = 0.005;
/** The steepest slope a player walks up (in radians): steeper ground they slide back down. */
export const MAX_CLIMB = (50 * Math.PI) / 180;
/** How long the pieces are that `clearForDog` follows the terrain in. */
const DOG_PIECE = 0.75;
/** The steepest ground the dog is sent over, as its rise over its run (about 38°). */
export const DOG_STEEPEST = 0.78;
/** A loose piece losing at least this much speed in one step has landed on something. */
const LAND_SPEED = 1.2;
/** Ticks between one piece's landing sounds, so a tumble is not a drum roll. */
const LAND_GAP_TICKS = 8;
/** Bricks below this height are deleted. */
const KILL_Y = -20;
/** What the dog cannot walk or see through. */
const DOG_SOLID: ReadonlySet<ColliderOwner['kind']> = new Set<ColliderOwner['kind']>([
  'static',
  'hideout',
  'machine',
  'board',
  'button',
  'catapult',
]);
/**
 * The machines never run out of moulds or pellets, so this keeps the world from filling up:
 * past this many single bricks lying loose, making one tidies away the one that has lain there
 * longest.
 */
export const MAX_LOOSE_BRICKS = 200;
/**
 * How far above a rubbish bin's rim a loose piece's centre may be and still go in (a brick
 * resting across the opening has its centre this low), and how far below it (a piece falling
 * fast passes the rim between two steps).
 */
const BIN_CATCH = 0.45;
const BIN_DEPTH = 0.3;

// Collision groups: membership in the high 16 bits, filter in the low 16 bits.
const G_WORLD = 0x1;
const G_PLAYER = 0x2;
const G_HELD = 0x4;
const groups = (member: number, filter: number) => (member << 16) | filter;
const WORLD_GROUPS = groups(G_WORLD, 0xffff);
export const PLAYER_GROUPS = groups(G_PLAYER, G_WORLD | G_PLAYER);
const HELD_GROUPS = groups(G_HELD, G_WORLD | G_HELD);
/** In the way of players (and the dog), and nothing else; and of everything else but them. */
const PLAYER_ONLY_GROUPS = groups(G_WORLD, G_PLAYER);
const NOT_PLAYER_GROUPS = groups(G_WORLD, 0xffff & ~G_PLAYER);

const UP = v3(0, 1, 0);
const DOWN = v3(0, -1, 0);

/** One tug of war (see `Sim.tugged`): who tugs whom, how many clicks so far, and when the last. */
interface Tug {
  by: number;
  from: number;
  clicks: number;
  tick: number;
}

/** A flight of stairs as `keepOnStairs` sees it: its foot, the way it climbs and its extent. */
interface Flight {
  pos: Vec3;
  /** Unit vectors on the floor: the way the flight climbs, and the climber's right. */
  along: { x: number; z: number };
  across: { x: number; z: number };
  /** How far the flight runs, and the height of the floor it comes out on. */
  run: number;
  top: number;
  /** Players with their centre this far out past the edge of the steps still count as on them. */
  reach: number;
}

export interface PlayerInput {
  /** -1..1, positive is forward. */
  forward: number;
  /** -1..1, positive is right. */
  right: number;
  jump: boolean;
  sprint: boolean;
  /** Walking carefully: slowly, and over loose bricks without stepping on them. */
  careful: boolean;
  yaw: number;
  pitch: number;
  firstPerson: boolean;
}

export const emptyInput = (): PlayerInput => ({
  forward: 0,
  right: 0,
  jump: false,
  sprint: false,
  careful: false,
  yaw: 0,
  pitch: 0,
  firstPerson: false,
});

export type Action =
  /**
   * Pick up an aimed loose brick or build, use a machine, or take what lies in its output area.
   * `output`: the player saw something lying in an output area under the crosshair. If it is
   * gone by the time the click arrives (someone took it first, or their own click just before
   * did), the click does nothing rather than work the machine behind it.
   */
  | { kind: 'grab'; output?: boolean }
  | { kind: 'suck' } // left click still held with the vacuum: pull again, whatever is aimed at
  | { kind: 'pull' } // pull the aimed brick off whatever it is attached to
  /** Snap the held brick, or drop it if there is no valid spot (`output` as for `grab`). */
  | { kind: 'place'; output?: boolean }
  | { kind: 'drop' }
  | { kind: 'throw' }
  /**
   * Turn what is in hand one step (R): 45° where the part would hang on one stud alone, else a
   * quarter. A `step` says which, whatever it would hang on: a quarter turn keeping any 45° on,
   * or the 45° on or off.
   */
  | { kind: 'rotate'; step?: 'quarter' | 'eighth' }
  /** Flip the part in hand to go on by its other hole, or back (see `canFlip`). */
  | { kind: 'flip' }
  | { kind: 'dropPage' }
  /** At the silo: fill a bucket with pellets of this colour, under its tap, to take from there. */
  | { kind: 'fill'; colour: ColourId }
  /** At the mould dispenser: drop the mould for this part into its hatch, to take from there. */
  | { kind: 'mould'; type: BrickTypeId }
  /**
   * At the UV printer: print print job `job` (an index into `Sim.printJobs`) on the part on
   * its bed and take it out, or with -1 take it out as it is.
   */
  | { kind: 'print'; job: number }
  /** Take a piece of gear off and drop it (Gear Hunt). */
  | { kind: 'unequip'; gear: GearId }
  /** Saboteur tools; the round checks who may use them and runs them. */
  | { kind: 'sabotage'; tool: SabotageTool };

export interface Holding {
  assemblyId: number;
  /** Quarter turns relative to the player's heading (single bricks), or added to a build's. */
  rot: Rotation;
  /**
   * The single part in hand is flipped to go on by its other hole (a headlight brick by its
   * back, see `canFlip`), until it is placed, dropped or flipped back.
   */
  flip?: boolean;
  /**
   * The single part in hand is turned 45° on from `rot`: it goes on so where it hangs on one
   * stud alone, and square (at `rot`) anywhere else.
   */
  eighth?: boolean;
  /** Heading of the carried build relative to the player, kept from the moment of grabbing. */
  yawOffset: number;
  /**
   * The player's eye and heading last tick, so what they hold moves along with them, and how
   * fast that carried it along.
   */
  last: { eye: Vec3; yaw: number; follow: Vec3; spin: number } | null;
  /** A build being lowered to the ground before letting go, so it does not shatter. */
  settingDown: number | null;
}

export interface Player {
  id: number;
  body: RigidBody;
  collider: Collider;
  controller: KinematicCharacterController;
  input: PlayerInput;
  vy: number;
  /** Horizontal velocity (m/s, y always 0): what momentum carries them along by. */
  vel: Vec3;
  grounded: boolean;
  /** Slipping off an edge their feet are not on: the way off it (x, z, a unit long), till they land. */
  slip: { x: number; z: number } | null;
  /**
   * Squeezing side-on through a gap narrower than their shoulders: the way along it (x, z, a unit
   * long), else null. They move as `slim` then, edging along it only.
   */
  squeeze: { x: number; z: number } | null;
  /** Their shape side-on, as thin as they are deep: what moves while they squeeze. */
  slim: Collider;
  /**
   * Working a machine they clicked, as patting the dog: walking up to it to stand before where
   * they clicked, then working it there with their hands a while (see `Work`). Moving off ends it.
   */
  work: Work | null;
  /** How many times they have set to work, so a client takes up each once (see `Work.n`). */
  works: number;
  /**
   * The ladder (an index into the level's `ladders`) they are up, feet off the ground (hanging
   * on counts; standing at its foot or on the roof at its top does not), or null. Snapshots
   * carry it, so clients can pose the climb on the right ladder.
   */
  ladder: number | null;
  holding: Holding | null;
  /** The instruction page in the player's pocket, if any. */
  page: number | null;
  /** Ticks left lying on the ground after a trip or a hit (0: on their feet). */
  down: number;
  /** Carried along through the air after the catapult threw them (m/s), until they land. */
  fling: Vec3;
  /** May not take, pull or place bricks, nor the vacuum (the reader in blind build mode). */
  handsOff: boolean;
  /** Rival teams: the side (job site) this player belongs to and may act on; null otherwise. */
  team: number | null;
  /** Ticks left limping after stepping on a brick. */
  limp: number;
  /** How the player slides along the floor while down. */
  slide: Vec3;
  /** Counts knock-downs, so clients start exactly one ragdoll for each. */
  knocks: number;
  /** Ticks of carry fatigue (see `TIRED_TICKS`): up while carrying a build, down otherwise. */
  fatigue: number;
  /** Holding a dog treat from the jar in the kitchen. */
  treat: boolean;
  /** A mould or a bucket of pellets in the hands (they are full then, as with a brick). */
  tool: Tool | null;
  /** Gear worn (Gear Hunt): all of it works at once. */
  gear: Set<GearId>;
  /** Moved by someone else's simulation (a remote player on a client); `step` leaves it alone. */
  replicated: boolean;
  /**
   * The inputs to move by in the next step, one tick each, in order. The server fills this with
   * the inputs that actually arrived (none: the player stands still rather than move on a
   * guess). Null means "one tick of the current input", for local play and tests.
   */
  pendingInputs: PlayerInput[] | null;
  /**
   * While Shift (the sprint key) is held with something in hand: the layer of a build that
   * snapping keeps to, taken from where it snapped when the key went down (see `trackSnapLock`).
   */
  snapLock: (SnapLayer & { targetId: number }) | null;
  /** Shift was down with something in hand at the last step, to lock only as it goes down. */
  snapLockKey: boolean;
}

/** A player working a machine (see `Player.work`). */
export interface Work {
  /** Which time this is that they set to work (see `Player.works`). */
  n: number;
  machineId: number;
  /** Where they stand to work it, and where their hands go: where they clicked it. */
  spot: Vec3;
  hand: Vec3;
  /** Got there (or as near as they could), and working. */
  there: boolean;
  /** Ticks left walking up to it, then working it once there. */
  walk: number;
  ticks: number;
}

/** The brick works as clients are told it (see `MachineT`). */
export interface BrickWorksState {
  machines: [
    id: number,
    mould: BrickTypeId | null,
    colour: ColourId | null,
    shots: number,
    part: MachinePart | null,
    jammed: boolean,
    fixer: number | null,
    out: (Made | null)[],
    making: Making | null,
  ][];
  tools: [playerId: number, tool: Tool][];
}

/** What a player carries to the machines: a mould, or a bucket of coloured pellets. */
export type Tool = { kind: 'mould'; type: BrickTypeId } | { kind: 'bucket'; colour: ColourId };

/**
 * What a machine of the brick works makes and leaves in its output area for anyone to take: a
 * mould from the dispenser, a bucket of pellets from the silo, or a part from a moulding machine.
 */
export type Made = Tool | { kind: 'part'; type: BrickTypeId; colour: ColourId };

/**
 * What a machine is making: the thing, the place in its output area it goes in when done, and
 * the tick it is done (the server's).
 */
export interface Making {
  made: Made;
  slot: number;
  at: number;
}

/** A made thing's mould and colour, as the brick works' events tell them. */
function madeFields(made: Made): { mould?: BrickTypeId; colour?: ColourId } {
  if (made.kind === 'mould') return { mould: made.type };
  if (made.kind === 'bucket') return { colour: made.colour };
  return { mould: made.type, colour: made.colour };
}

/** A part as it lies on the UV printer's bed. */
export interface MachinePart {
  type: BrickTypeId;
  colour: ColourId;
  prints?: Prints;
}

/** A machine of the brick works and what is in it. */
export interface MachineState {
  def: MachineDef;
  /** A moulding machine's mould, once one is put in. */
  mould: BrickTypeId | null;
  /** A moulding machine's pellets: their colour, and how many more parts they make. */
  colour: ColourId | null;
  shots: number;
  /** The part on the UV printer's bed. */
  part: MachinePart | null;
  /** Tampered with or broken down: it makes nothing until someone clears the jam. */
  jammed: boolean;
  /** Who is clearing the jam, if anyone, and how far along they are (0 to 1). */
  fixer: number | null;
  progress: number;
  /**
   * What lies in its output area, place by place (see `OUTPUT_ROOM`), until someone takes it;
   * null for an empty place.
   */
  out: (Made | null)[];
  /** What it is making, if anything: one thing at a time. */
  making: Making | null;
}

/**
 * An instruction page (or the master index): lying in the world or pinned to a corkboard (body
 * set), or out of it (body null) in someone's pocket, tucked into a hiding place, or in the
 * dog's mouth (which only the dog knows: see `Dog.page`).
 */
export interface PageItem {
  id: number;
  /** 0-based build step this page explains, or -1 for the master index. */
  step: number;
  /** What is printed on it. A forgery prints something slightly different. */
  printed: PrintedPage | null;
  body: RigidBody | null;
  /** The player with it in their pocket. */
  carriedBy: number | null;
  /** Tucked into a closed hiding place, out of sight. */
  hidden: boolean;
  /**
   * Which hiding place it is tucked into, where that is known: on the server always while
   * `hidden`; a client is only told that it is hidden, so there it stays null.
   */
  hideout: number | null;
  /** Corkboard slot it is pinned to (body fixed there). */
  pinned: number | null;
  /** Bumped when the page changes hands or content, so it gets sent again. */
  version: number;
}

/**
 * A piece of gear (Gear Hunt): lying in the world (body set), worn by a player, tucked into a
 * hiding place, or (the leash) on the dog's pole.
 */
export interface GearItem {
  id: number;
  kind: GearId;
  body: RigidBody | null;
  wornBy: number | null;
  /** Tucked into a closed hiding place, out of sight. */
  hidden: boolean;
  /** Which hiding place it is tucked into, where that is known (see `PageItem.hideout`). */
  hideout: number | null;
  /** The leash once it is on the pole, holding the dog. */
  placed: boolean;
  /** Bumped when it changes hands or place, so it gets sent again. */
  version: number;
}

/** A hiding place's state: open or shut, padlocked or not, and what is tucked inside. */
export interface HideoutState {
  def: HideoutDef;
  open: boolean;
  /** Padlocked (Gear Hunt): only opens for someone wearing the key ring, then stays unlocked. */
  locked: boolean;
  contents: number[];
  /** Gear tucked inside, by id. */
  gear: number[];
  /** The door, drawer, lid, rug or cushion: solid while shut, walk-through while open. */
  part: Collider;
  /** The part that stays put, if any. Clicking it opens the hiding place, but not shuts it. */
  body: Collider | null;
  /** How far it opens before it would hit something: radians, or metres for a drawer. */
  opening: number;
}

/**
 * One of the scenery's things a click works (see `GadgetDef`): whether it has been clicked (an
 * odd number of times), and its handles' click boxes, where they are for that.
 */
export interface GadgetState {
  def: GadgetDef;
  used: boolean;
  handles: Collider[];
}

export const PAGE_SIZE = { x: 0.3, y: 0.008, z: 0.42 };

/**
 * Where the middle of something `size.y` tall goes to rest on a surface at `at` (just clear of
 * it, so it never starts out stuck in it): pages and gear are placed by their middle.
 */
function restingOn(at: Vec3, size: { y: number }): Vec3 {
  return v3(at.x, at.y + size.y / 2 + 0.01, at.z);
}

export interface Assembly {
  id: number;
  grid: BrickGrid;
  body: RigidBody;
  /** Each brick's colliders: one box, or a few for a part with a hole another part fits in. */
  colliders: Map<number, Collider[]>;
  /** Fixed in place (the job-site baseplate and everything attached to it). */
  anchored: boolean;
  /** Handed in (rival teams): nothing can be added, taken off or lifted any more. */
  frozen: boolean;
  heldBy: number | null;
  /** Bumped whenever the set of bricks changes, so renderers know to rebuild. */
  version: number;
  bornTick: number;
  prevLinvel: Vec3;
  prevAngvel: Vec3;
  /** When it last landed on something (see `handleImpacts`), so one landing sounds once. */
  lastDropTick: number;
}

export type ColliderOwner =
  | { kind: 'brick'; assemblyId: number; brickId: number }
  | { kind: 'machine'; machineId: number }
  /** A place in a machine's output area, there to click while something lies in it. */
  | { kind: 'output'; machineId: number; slot: number }
  | { kind: 'player'; playerId: number }
  | { kind: 'page'; pageId: number }
  | { kind: 'button'; buttonId: string; site: number }
  | { kind: 'catapult' }
  | { kind: 'gear'; gearId: number }
  | { kind: 'hideout'; hideoutId: number }
  /** A handle of one of the scenery's things a click works (see `GadgetDef`). */
  | { kind: 'gadget'; gadgetId: number }
  | { kind: 'board'; board: number; site: number }
  | { kind: 'dog' }
  | { kind: 'treats' }
  | { kind: 'panel' }
  | { kind: 'vacuum' }
  | { kind: 'trashBin'; bin: number }
  | { kind: 'static' }
  /** A map's terrain (see `TerrainDef`): solid like the rest, but the dog sees over its rises. */
  | { kind: 'ground' };

/** The house's electricity: off once the electrical panel breaks, until someone fixes it. */
export interface PowerState {
  on: boolean;
  /**
   * The panel is dead for the round (a gear hunt's): nobody can fix it or tamper with it, and
   * the brick works run on a circuit of their own.
   */
  dead: boolean;
  /** Who is at the panel fixing it, if anyone. */
  fixer: number | null;
  /** How far along their fix is, 0 to 1. */
  progress: number;
}

export interface SimEvent {
  kind:
    | 'snap'
    | 'break'
    | 'grab'
    | 'drop'
    | 'page'
    | 'button'
    | 'anchor'
    /** Rival teams: a team handed its build in (`site` says which). */
    | 'handIn'
    | 'swap'
    | 'forge'
    | 'hide'
    | 'meeting'
    | 'sentHome'
    | 'open'
    | 'close'
    | 'pin'
    | 'trip'
    | 'ouch'
    | 'bark'
    | 'yelp'
    | 'crunch'
    | 'pat'
    | 'treat'
    | 'powerOut'
    | 'fixing'
    | 'powerOn'
    | 'tamper'
    | 'breakdown'
    | 'unjammed'
    | 'vacuumUp'
    | 'vacuumDown'
    | 'suck'
    | 'vacuumFull'
    | 'catapult'
    | 'gearOn'
    | 'gearOff'
    | 'locked'
    | 'unlock'
    | 'leash'
    | 'heavy'
    | 'toolUp'
    | 'toolDown'
    | 'mouldIn'
    | 'pour'
    | 'fill'
    | 'dispense'
    | 'moulded'
    /** Something a machine made has come to rest in its output area, there to take. */
    | 'ready'
    | 'printerIn'
    | 'print'
    | 'binned'
    | 'tug'
    | 'tugged'
    | 'pick'
    | 'picked'
    | 'tired';
  pos: Vec3;
  /** Which piece of gear, for `gearOn`, `gearOff` and `leash` events. */
  gear?: GearId;
  /** Which way someone fell, for `trip` events. */
  dir?: Vec3;
  /** Only players within this many metres notice it (saboteur tells). */
  witnessRange?: number;
  /** Which hiding place, for `open` and `close` events. */
  hideoutId?: number;
  /** Which machine, for the brick works' events. */
  machineId?: number;
  /**
   * The brick works' events: the mould being dispensed, taken out, put in or moulded with
   * (`dispense`, `toolUp`, `mouldIn`, `moulded`, `ready`) and the pellets' colour (`fill`,
   * `toolUp`, `pour`, `moulded`, `ready`), so a machine can show it happening; and the colour
   * of what was thrown in a bin (`binned`), so the bin can.
   */
  mould?: BrickTypeId;
  colour?: ColourId;
  /**
   * The place in a machine's output area something is being made for (`fill`, `dispense`,
   * `moulded`), has come to rest in (`ready`) or was taken from (`toolUp`; a part taken out
   * raises a plain `grab`, without it or `machineId`).
   */
  slot?: number;
  /** Which button was pressed, for `button` events, and which job site's (and `handIn`'s). */
  buttonId?: string;
  site?: number;
  /** How many bricks were involved (picked up, set down, broken off), so big builds sound bigger. */
  count?: number;
  /** For `binned`: what went in was emptied out of the vacuum, not thrown away. */
  emptied?: true;
  /** How hard something landed (m/s lost on impact), for `drop` events. */
  speed?: number;
  playerId?: number;
  /** Who a build or page was tugged from, for `tug`, `tugged`, `pick` and `picked` events. */
  fromId?: number;
}

/** The vacuum: in someone's hands, leaning where it is kept, or lying on the floor. */
export interface VacuumState {
  heldBy: number | null;
  /** While nobody carries it: the spot on the floor its head rests on, and its heading. */
  pos: Vec3;
  yaw: number;
  /** Leaning against the wall where it is kept, rather than lying on the floor. */
  leaning: boolean;
  /** The tick of the carrier's last pull. */
  sucked: number;
  /** How many bricks are inside, up to `VACUUM_CAPACITY`. */
  load: number;
}

/**
 * Where the middle of a vacuum that nobody carries is, and how it is turned: its local +y runs
 * up the handle from the head, and its bristles face local -z.
 */
export function vacuumRestPose(b: VacuumState): { pos: Vec3; rot: Quat } {
  const tilt = b.leaning ? VACUUM_LEAN : Math.PI / 2;
  const rot = mulQuat(yawQuat(b.yaw), { x: Math.sin(tilt / 2), y: 0, z: 0, w: Math.cos(tilt / 2) });
  const foot = b.leaning
    ? v3(b.pos.x, b.pos.y, b.pos.z)
    : v3(b.pos.x, b.pos.y + VACUUM.depth, b.pos.z);
  return { pos: add(foot, rotate(rot, v3(0, VACUUM.length / 2, 0))), rot };
}

export interface AimHit {
  point: Vec3;
  normal: Vec3;
  distance: number;
  owner: ColliderOwner;
}

export interface SnapPreview {
  targetId: number;
  /** Where each held brick would go in the target's grid, one for a single brick. */
  bricks: { id: number; placement: Placement; pos: Vec3; rot: Quat }[];
  /** The single brick hangs on one stud alone there, turned 45° (see `Holding.eighth`). */
  turned45?: boolean;
  /** World pose of the first brick's centre. */
  pos: Vec3;
  rot: Quat;
}

const QUARTER = Math.PI / 2;

/** The collider for a shape of a level's models (see `SolidDef`), placed by `place`. */
export function solidDesc(R: typeof RAPIER, s: SolidDef, place: MeshDef): ColliderDesc {
  const [r, half] = [s.r ?? 0, (s.h ?? 0) / 2];
  const size = s.size ?? { x: 0, y: 0, z: 0 };
  const round = (d: number) => Math.max(1e-4, d / 2 - r);
  const desc =
    s.shape === 'box'
      ? R.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
      : s.shape === 'roundBox'
        ? R.ColliderDesc.roundCuboid(round(size.x), round(size.y), round(size.z), r)
        : s.shape === 'ball'
          ? R.ColliderDesc.ball(r)
          : s.shape === 'can'
            ? R.ColliderDesc.cylinder(half, r)
            : s.shape === 'cone'
              ? R.ColliderDesc.cone(half, r)
              : R.ColliderDesc.capsule(half, r);
  const turn = place.turn ?? IDENTITY;
  const at = add(rotate(turn, s.at), place.at);
  return desc.setTranslation(at.x, at.y, at.z).setRotation(mulQuat(turn, s.turn ?? IDENTITY));
}

/** The colliders a level's mesh (see `MeshDef`) is met as: its shapes, and the rest as triangles. */
export function meshDescs(R: typeof RAPIER, place: MeshDef): ColliderDesc[] {
  const { shapes, vertices, indices } = meshOf(place.mesh);
  const { at } = place;
  return [
    ...shapes.map((s) => solidDesc(R, s, place)),
    R.ColliderDesc.trimesh(vertices, indices)
      .setTranslation(at.x, at.y, at.z)
      .setRotation(place.turn ?? IDENTITY),
  ];
}

/** Direction the player is looking. Yaw 0 looks down -z, positive pitch looks up. */
export function viewDir(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return v3(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
}

/** Camera position for a player, before any wall clipping the client may add. */
export function cameraPosition(
  eye: Vec3,
  input: Pick<PlayerInput, 'yaw' | 'pitch' | 'firstPerson'>,
): Vec3 {
  if (input.firstPerson) return eye;
  const dir = viewDir(input.yaw, input.pitch);
  const right = v3(Math.cos(input.yaw), 0, -Math.sin(input.yaw));
  return add(
    add(eye, scale(dir, -CAMERA_DISTANCE)),
    add(scale(right, CAMERA_SHOULDER), v3(0, CAMERA_LIFT, 0)),
  );
}

/**
 * A view to ask about in place of the player's own, for "what if" questions (a bot trying aims
 * before it turns): another eye, other view angles, the brick in hand turned another way, or
 * another layer locked with Shift. Whatever is left out is the player's own.
 */
export interface ViewAsk {
  eye?: Vec3;
  yaw?: number;
  pitch?: number;
  firstPerson?: boolean;
  /** Quarter turns of the brick in hand. */
  rot?: Rotation;
  /** Whether the brick in hand is flipped (see `Holding.flip`). */
  flip?: boolean;
  /** Whether the brick in hand is turned 45° on from `rot` (see `Holding.eighth`). */
  eighth?: boolean;
  /** The layer locked with Shift; null for none. */
  lock?: Player['snapLock'];
}

export interface SimOptions {
  /**
   * A client-side copy of a server's world. Bricks and pages become kinematic bodies posed
   * from snapshots; only non-replicated players (the local one) are simulated, for prediction.
   * Actions do nothing: they go to the server instead.
   */
  replica?: boolean;
  /** Whether the job site has its meeting bell (not in a gear hunt). */
  bell?: boolean;
}

/** How fast tired arms let a player go (1: not tired), from `TIRED_TICKS` down to the drop. */
export function tiredFactor(p: Player): number {
  if (p.fatigue <= TIRED_TICKS) return 1;
  const t = Math.min(1, (p.fatigue - TIRED_TICKS) / (TIRED_DROP_TICKS - TIRED_TICKS));
  return 1 - (1 - TIRED_SPEED) * t;
}

/**
 * A single loose brick, carried in the hands. A baseplate on its own is still a build: it is
 * carried in front, set down gently and goes back on the job site.
 */
export function isLooseBrick(a: Assembly): boolean {
  if (a.grid.size !== 1) return false;
  const only = a.grid.bricks.values().next().value!;
  return !BRICK_TYPES[only.type].fixture;
}

/** Mass of an assembly computed from its bricks, so client and server agree on it. */
export function assemblyMass(a: Assembly): number {
  let volume = 0;
  for (const b of a.grid.bricks.values()) {
    const t = BRICK_TYPES[b.type];
    volume += t.studsX * t.studsZ * STUD * STUD * t.plates * PLATE_H;
  }
  return volume * BRICK_DENSITY;
}

/** All of an assembly's colliders. */
function* collidersOf(a: Assembly): Generator<Collider> {
  for (const cs of a.colliders.values()) yield* cs;
}

/**
 * How far an assembly reaches back from its centre of mass toward whoever carries it, when it
 * is turned by `turn` from the way they face: the hold point goes at least this far out.
 */
export function nearSide(a: Assembly, turn: number): number {
  const com = a.body.localCom();
  const q = yawQuat(turn);
  let back = 0;
  for (const b of a.grid.bricks.values()) {
    const box = partBox(b);
    for (const x of [box.x0, box.x1]) {
      for (const z of [box.z0, box.z1]) {
        // The player faces -z in their own frame, so the side toward them is +z.
        back = Math.max(back, rotate(q, v3(x * STUD - com.x, 0, z * STUD - com.z)).z);
      }
    }
  }
  return back;
}

/**
 * The physics world: assemblies of bricks, players, bins and the level. Rendering-agnostic:
 * the server runs it as the authority, clients run a replica of it.
 */
export class Sim {
  readonly world: World;
  readonly assemblies = new Map<number, Assembly>();
  readonly players = new Map<number, Player>();
  readonly pages = new Map<number, PageItem>();
  /** The gear of a gear hunt, by id. */
  readonly gear = new Map<number, GearItem>();
  /**
   * The troubles of a gear hunt that are on: the key ring opens padlocks and the leash holds
   * the dog whatever this says, and the dead panel is `power.dead`, but the build is only
   * heavy while its trouble is on.
   */
  readonly hazards = new Set<GearId>();
  /** Past this many single bricks lying loose, making one tidies the oldest away. */
  looseLimit = MAX_LOOSE_BRICKS;
  readonly hideouts = new Map<number, HideoutState>();
  /** The level's sliding doors (see `LevelDef.slidingDoors`), each with how far it is open (0 to 1). */
  private readonly doors: { def: SlidingDoorDef; body: RigidBody; open: number }[] = [];
  /** The scenery's things a click works, by id. */
  readonly gadgets = new Map<number, GadgetState>();
  /**
   * Bumped when a hiding place opens or closes, a gadget is clicked, the power changes, or the
   * brick works do.
   */
  furnitureVersion = 0;
  /** The brick works' machines, by id. */
  readonly machines = new Map<number, MachineState>();
  /** What the UV printer can print this round: the printed parts of the round's build. */
  printJobs: PrintJob[] = [];
  /** On a client: who carries what, as last told, for players who appear later too. */
  private replicaTools = new Map<number, Tool>();
  /** The lights: on unless the electrical panel has broken down. */
  readonly power: PowerState = { on: true, dead: false, fixer: null, progress: 0 };
  /** Where the electrical panel is, if the level has one. */
  panel: Vec3 | null = null;
  /** The open tops of the level's rubbish bins (see `trashBinMouth`), by bin. */
  readonly trashBins: (FloorRect & { y: number })[] = [];
  /** The job-site builds (the assemblies holding the baseplates), one per site. */
  buildIds: number[] = [];
  /** The job sites: one, or two for rival teams. */
  readonly sites: SiteDef[];
  /**
   * Whether the hungry dog may wreck the build: set by the room each tick, only while a round
   * is being built and not in its last 90 seconds.
   */
  dogMayWreck = false;
  /** Things that happened since the last drain, for sounds and effects. */
  events: SimEvent[] = [];
  /** Whether the catapult throws (between rounds only; the room and the client set this). */
  catapultArmed = false;
  private catapultCooldown = 0;
  tick = 0;
  /** Tugs going on at carried builds (by assembly id) and at pockets (by player id). */
  private readonly buildTugs = new Map<number, Tug>();
  private readonly pocketTugs = new Map<number, Tug>();
  /** The clickable places in each machine's output area, by machine id: on while full. */
  private readonly outputColliders = new Map<number, Collider[]>();
  /** The house dog (on a client, only where the server says it is). */
  readonly dog: Dog;
  vacuum: VacuumState;

  /** Clicking it picks the vacuum up; only there while nobody carries it. */
  private readonly vacuumCollider: Collider;

  readonly replica: boolean;
  /** Whether the job site has its meeting bell. */
  readonly bell: boolean;

  private nextId = 1;
  private readonly owners = new Map<number, ColliderOwner>();
  /** The ground's colliders, and the level's floors and ceilings: no camera looks through them. */
  private readonly floors = new Set<number>();
  private readonly rng: () => number;
  /** The level, with the round's pictures for the UV printer once a round is under way. */
  level: LevelDef;
  /** The level's flights of stairs, as `keepOnStairs` sees them. */
  private readonly flights: Flight[];
  /** Every corkboard, site by site (see `levelBoards`): slots run board by board. */
  private readonly boards: { site: number; pos: Vec3; facing: number }[];

  constructor(
    private readonly R: Rapier,
    level: LevelDef,
    seed = 1,
    opts: SimOptions = {},
  ) {
    this.level = level;
    this.replica = opts.replica ?? false;
    this.sites = levelSites(level);
    this.boards = levelBoards(level);
    this.bell = opts.bell ?? true;
    this.world = new R.World({ x: 0, y: -WORLD_GRAVITY, z: 0 });
    this.world.timestep = DT;
    this.rng = makeRng(seed);
    this.flights = (level.stairs ?? []).map((s) => ({
      ...stairsAxes(s),
      pos: s.pos,
      run: STAIRS.steps * STAIRS.tread,
      top: s.pos.y + UPPER_FLOOR,
      // Stepping onto the first step from the side, say, still counts (`keepOnStairs`).
      reach: PLAYER_RADIUS + 0.1,
    }));
    const fixed = this.buildLevel();
    this.dog = new Dog(this.dogHost(), level.dog, PLAYER_GROUPS);
    this.owners.set(this.dog.collider.handle, { kind: 'dog' });
    // Not solid: players and bricks pass through it, clicks find it.
    this.vacuumCollider = this.world.createCollider(
      R.ColliderDesc.cuboid(VACUUM.width / 2, VACUUM.length / 2, 0.06).setSensor(true),
      fixed,
    );
    this.owners.set(this.vacuumCollider.handle, { kind: 'vacuum' });
    this.vacuum = {
      heldBy: null,
      pos: level.vacuum.pos,
      yaw: level.vacuum.facing,
      leaning: true,
      sucked: -SUCK_TICKS,
      load: 0,
    };
    this.poseVacuum();
    // A replica receives the baseplates (and everything else) from the server.
    if (!this.replica) this.buildIds = this.placeBaseplates();
  }

  // ---------------------------------------------------------------- level

  private addMachine(def: MachineDef, body: RigidBody): void {
    const { centre, half, rot } = machinePose(def);
    const desc = this.R.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setTranslation(centre.x, centre.y, centre.z)
      .setRotation(rot)
      .setFriction(0.8);
    const c = this.world.createCollider(desc, body);
    this.owners.set(c.handle, { kind: 'machine', machineId: def.id });
    // The places in its output area: only there to click while something lies in them (see
    // `setOut`), and never in anyone's way (players' movement meets sensors too, unless their
    // groups keep them apart).
    const slots = machineOutputs(def).map((o, slot) => {
      const sensor = this.world.createCollider(
        this.R.ColliderDesc.cuboid(o.half.x, o.half.y, o.half.z)
          .setTranslation(o.centre.x, o.centre.y, o.centre.z)
          .setRotation(o.rot)
          .setSensor(true)
          .setCollisionGroups(NOT_PLAYER_GROUPS)
          .setEnabled(false),
        body,
      );
      this.owners.set(sensor.handle, { kind: 'output', machineId: def.id, slot });
      return sensor;
    });
    this.outputColliders.set(def.id, slots);
    this.machines.set(def.id, {
      def,
      mould: null,
      colour: null,
      shots: 0,
      part: null,
      jammed: false,
      fixer: null,
      progress: 0,
      out: slots.map(() => null),
      making: null,
    });
  }

  /**
   * Gives the UV printer the round's build to print from: its printed parts, and their
   * pictures. The server does it when a round starts, and clients from the round's target.
   */
  loadPrints(build: TargetBuild | null): void {
    this.printJobs = printJobs(build);
    this.level = { ...this.level, svgs: build?.svgs ?? {} };
  }

  /** The level's fixed parts (the floor, walls, furniture, machines and so on): their body. */
  private buildLevel(): RigidBody {
    const { R, world, level } = this;
    const fixed = world.createRigidBody(R.RigidBodyDesc.fixed());
    // The ground, but for the hole over the basement.
    for (const q of groundPieces(level)) {
      const desc = R.ColliderDesc.cuboid((q.x1 - q.x0) / 2, 0.5, (q.z1 - q.z0) / 2);
      const c = this.addStatic(
        desc.setTranslation((q.x0 + q.x1) / 2, -0.5, (q.z0 + q.z1) / 2),
        fixed,
      );
      this.floors.add(c.handle);
    }
    // Or the terrain, as the triangles it is drawn with: a mesh rather than the engine's
    // heightfield, whose overlap tests miss what is sunk in it.
    for (const t of level.terrain ?? []) {
      const { vertices, indices } = terrainTriangles(t);
      const c = world.createCollider(
        R.ColliderDesc.trimesh(vertices, indices, R.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(
          0.8,
        ),
        fixed,
      );
      this.owners.set(c.handle, { kind: 'ground' });
      this.floors.add(c.handle);
    }
    for (const box of level.boxes) {
      if (box.rough) continue;
      const tilt = box.tiltX ?? 0;
      const desc = R.ColliderDesc.cuboid(box.size.x / 2, box.size.y / 2, box.size.z / 2)
        .setTranslation(box.pos.x, box.pos.y, box.pos.z)
        .setRotation({ x: Math.sin(tilt / 2), y: 0, z: 0, w: Math.cos(tilt / 2) });
      const c = this.addStatic(desc, fixed);
      if (box.size.y <= SLAB.thick && Math.min(box.size.x, box.size.z) >= SLAB.wide)
        this.floors.add(c.handle);
      // Players meet a guarded railing as its `railGuard` instead.
      if (box.guarded) {
        c.setCollisionGroups(NOT_PLAYER_GROUPS);
        this.railGuard(box, fixed);
      }
      if (box.model === 'panel') {
        this.panel = box.pos;
        this.owners.set(c.handle, { kind: 'panel' });
      }
      if (isTrashBin(box)) {
        this.owners.set(c.handle, { kind: 'trashBin', bin: this.trashBins.length });
        this.trashBins.push(trashBinMouth(box));
      }
    }
    // The level's models, met as they are drawn: their shapes, and the rest as triangles.
    for (const place of level.meshes ?? [])
      for (const desc of meshDescs(R, place)) this.addStatic(desc, fixed);
    // Each sliding door on a body of its own, moved as it opens.
    for (const def of level.slidingDoors ?? []) {
      const { at, turn } = def.mesh;
      const body = world.createRigidBody(
        R.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(at.x, at.y, at.z)
          .setRotation(turn ?? IDENTITY),
      );
      for (const desc of meshDescs(R, { mesh: def.mesh.mesh, at: v3() }))
        this.addStatic(desc, body);
      this.doors.push({ def, body, open: 0 });
    }
    for (const machine of level.machines) this.addMachine(machine, fixed);
    this.sites.forEach((site, i) => {
      for (const [at, buttonId] of [
        [site.doneButton, 'done'],
        [site.bell, 'bell'],
      ] as const) {
        if (buttonId === 'bell' && !this.bell) continue;
        const c = world.createCollider(
          R.ColliderDesc.cuboid(
            BUTTON_SIZE.x / 2,
            BUTTON_SIZE.y / 2,
            BUTTON_SIZE.z / 2,
          ).setTranslation(at.x, at.y + BUTTON_SIZE.y / 2, at.z),
          fixed,
        );
        this.owners.set(c.handle, { kind: 'button', buttonId, site: i });
      }
    });
    if (level.catapult) {
      // The frame is a low step, and the uprights, the arm and its counterweight stand in the
      // way; the bucket is only drawn, so it can be stepped into.
      const { size, centreZ } = CATAPULT.frame;
      const c = level.catapult;
      const centre = add(c.pos, rotate(yawQuat(c.facing), v3(0, size.y / 2, centreZ)));
      const frame = world.createCollider(
        R.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
          .setTranslation(centre.x, centre.y, centre.z)
          .setRotation(yawQuat(c.facing))
          .setFriction(0.8),
        fixed,
      );
      this.owners.set(frame.handle, { kind: 'catapult' });
      const yaw = yawQuat(c.facing);
      for (const part of catapultSolids()) {
        const at = add(c.pos, rotate(yaw, part.centre));
        const tilt = { x: Math.sin(part.tiltX / 2), y: 0, z: 0, w: Math.cos(part.tiltX / 2) };
        const solid = world.createCollider(
          R.ColliderDesc.cuboid(part.half.x, part.half.y, part.half.z)
            .setTranslation(at.x, at.y, at.z)
            .setRotation(mulQuat(yaw, tilt)),
          fixed,
        );
        this.owners.set(solid.handle, { kind: 'catapult' });
      }
    }
    for (const def of level.hideouts) {
      const box = (pose: PartPose) =>
        world.createCollider(
          R.ColliderDesc.cuboid(pose.half.x, pose.half.y, pose.half.z)
            .setTranslation(pose.centre.x, pose.centre.y, pose.centre.z)
            .setRotation(pose.rot)
            .setFriction(0.8),
          fixed,
        );
      const bodyPose = hideoutBody(def);
      const body = bodyPose ? box(inWorld(def, bodyPose)) : null;
      const part = box(hideoutPartInWorld(def, false));
      const h: HideoutState = {
        def,
        open: false,
        locked: false,
        contents: [],
        gear: [],
        part,
        body,
        opening: openingIn(level, def),
      };
      this.hideouts.set(def.id, h);
      this.setOpen(h, false);
    }
    // Clicked in, but not solid: the lamp, the tap, the hob are solid as the scenery's boxes.
    for (const def of level.gadgets ?? []) {
      const handles = def.handles.map(({ box }) =>
        world.createCollider(
          R.ColliderDesc.cuboid(box.size.x / 2, box.size.y / 2, box.size.z / 2)
            .setTranslation(box.pos.x, box.pos.y, box.pos.z)
            .setSensor(true),
          fixed,
        ),
      );
      for (const c of handles) this.owners.set(c.handle, { kind: 'gadget', gadgetId: def.id });
      this.gadgets.set(def.id, { def, used: false, handles });
    }
    this.boards.forEach((b, i) => {
      const board = world.createCollider(
        R.ColliderDesc.cuboid(BOARD_SIZE.x / 2, BOARD_SIZE.y / 2, BOARD_SIZE.z / 2)
          .setTranslation(b.pos.x, b.pos.y, b.pos.z)
          .setRotation(yawQuat(b.facing)),
        fixed,
      );
      this.owners.set(board.handle, { kind: 'board', board: i, site: b.site });
    });
    for (const jar of [level.dog.treatJar, ...(level.dog.treatJars ?? [])]) {
      const treats = world.createCollider(
        R.ColliderDesc.cylinder(0.09, 0.08).setTranslation(jar.x, jar.y + 0.09, jar.z),
        fixed,
      );
      this.owners.set(treats.handle, { kind: 'treats' });
    }
    return fixed;
  }

  /** The job sites' baseplates, each fixed in place as an empty build: their assemblies' ids. */
  private placeBaseplates(): number[] {
    return this.sites.map(
      (site) =>
        this.createAssembly(
          [
            {
              id: this.newId(),
              type: 'baseplate16',
              colour: 'baseplate-green',
              x: 0,
              y: 0,
              z: 0,
              rot: 0,
            },
          ],
          site.baseplate,
          IDENTITY,
          true,
        ).id,
    );
  }

  /** Whether `id` is one of the job-site builds. */
  isBuild(id: number): boolean {
    return this.buildIds.includes(id);
  }

  /** Which side of a divided (rival teams) level a point is on, or null when it is not divided. */
  sideOf(p: Vec3): 0 | 1 | null {
    return sideOf(this.level, p);
  }

  /** Whether a player may act on something at `at`: anywhere, unless they have a side. */
  mayUse(p: Player, at: Vec3): boolean {
    const side = this.sideOf(at);
    return side === null || p.team === null || side === p.team;
  }

  /** Rival teams: a handed-in build is done; nothing about it changes any more. */
  freezeBuild(site: number): void {
    const a = this.build(site);
    a.frozen = true;
    a.version++;
  }

  unfreezeBuild(site: number): void {
    const a = this.build(site);
    a.frozen = false;
    a.version++;
  }

  private addStatic(desc: ColliderDesc, body: RigidBody): Collider {
    const c = this.world.createCollider(desc.setFriction(0.8), body);
    this.owners.set(c.handle, { kind: 'static' });
    return c;
  }

  /**
   * What players meet of a guarded railing: one box, as long and thick as it and
   * `RAIL_GUARD` taller, so that there is no top edge to stand on within a jump. Owned by
   * nothing, so aim, camera and dog rays pass it by; the railing itself stops everything else.
   */
  private railGuard(rail: BoxDef, body: RigidBody): void {
    const height = rail.size.y + RAIL_GUARD;
    this.world.createCollider(
      this.R.ColliderDesc.cuboid(rail.size.x / 2, height / 2, rail.size.z / 2)
        .setTranslation(rail.pos.x, rail.pos.y - rail.size.y / 2 + height / 2, rail.pos.z)
        .setFriction(0.8)
        .setCollisionGroups(PLAYER_ONLY_GROUPS),
      body,
    );
  }

  private newId(): number {
    return this.nextId++;
  }

  // ---------------------------------------------------------------- assemblies

  private createAssembly(
    bricks: PlacedBrick[],
    pos: Vec3,
    rot: Quat,
    anchored: boolean,
    linvel: Vec3 = v3(),
    angvel: Vec3 = v3(),
    id = this.newId(),
  ): Assembly {
    const { R } = this;
    // Anchored builds are fixed everywhere, so the character controller treats them the same
    // on clients as on the server; anything that moves is posed from snapshots on clients.
    const desc = anchored
      ? R.RigidBodyDesc.fixed()
      : this.replica
        ? R.RigidBodyDesc.kinematicPositionBased()
        : R.RigidBodyDesc.dynamic().setCcdEnabled(true).setLinvel(linvel.x, linvel.y, linvel.z);
    desc.setTranslation(pos.x, pos.y, pos.z).setRotation(rot);
    const a: Assembly = {
      id,
      grid: new BrickGrid(),
      body: this.world.createRigidBody(desc),
      colliders: new Map(),
      anchored,
      frozen: false,
      heldBy: null,
      version: 0,
      bornTick: this.tick,
      prevLinvel: linvel,
      prevAngvel: angvel,
      lastDropTick: -Infinity,
    };
    for (const b of bricks) {
      a.grid.insert(b);
      this.addCollider(a, b);
    }
    if (!anchored && !this.replica) a.body.setAngvel(angvel, true);
    this.assemblies.set(a.id, a);
    return a;
  }

  private addCollider(a: Assembly, b: PlacedBrick): void {
    const colliders = placedColliders(b).map(({ centre, half, rot }) => {
      const desc = this.R.ColliderDesc.cuboid(half.x, half.y, half.z)
        .setTranslation(centre.x, centre.y, centre.z)
        .setRotation(rot)
        .setDensity(BRICK_DENSITY)
        .setFriction(0.9)
        .setRestitution(0.05)
        .setCollisionGroups(a.heldBy === null ? WORLD_GROUPS : HELD_GROUPS);
      const collider = this.world.createCollider(desc, a.body);
      this.owners.set(collider.handle, { kind: 'brick', assemblyId: a.id, brickId: b.id });
      return collider;
    });
    a.colliders.set(b.id, colliders);
  }

  /**
   * Call after adding colliders to an assembly or taking some off. Rapier lets a moving body
   * whose colliders change drift for a step as if nothing held it up: a loose build resting on
   * the floor sank into it a few millimetres with every brick snapped on (and rose with every
   * one taken off), and stayed there, until its baseplate was down under the inspector's pad.
   * What goes stale is its contacts, not its mass: recomputing the mass properties (or putting
   * it to sleep and waking it) leaves it sinking just the same, while anything that drops the
   * body's contacts (as switching it to fixed and back does) makes it start afresh from where
   * it is. Rapier has no call that only drops them.
   */
  private collidersChanged(a: Assembly): void {
    if (a.anchored || this.replica) return;
    const { RigidBodyType } = this.R;
    const linvel = a.body.linvel();
    const angvel = a.body.angvel();
    a.body.setBodyType(RigidBodyType.Fixed, false);
    a.body.setBodyType(RigidBodyType.Dynamic, true);
    a.body.setLinvel(linvel, true);
    a.body.setAngvel(angvel, true);
  }

  private removeCollider(a: Assembly, brickId: number): void {
    const cs = a.colliders.get(brickId);
    if (!cs) return;
    for (const c of cs) {
      this.owners.delete(c.handle);
      this.world.removeCollider(c, true);
    }
    a.colliders.delete(brickId);
  }

  private removeAssembly(a: Assembly): void {
    for (const c of collidersOf(a)) this.owners.delete(c.handle);
    this.world.removeRigidBody(a.body);
    this.assemblies.delete(a.id);
    if (a.heldBy !== null) {
      const p = this.players.get(a.heldBy);
      if (p) p.holding = null;
    }
  }

  /** Creates a single loose brick whose centre is at `centre`. */
  spawnBrick(
    type: BrickTypeId,
    colour: ColourId,
    centre: Vec3,
    rot: Quat = IDENTITY,
    linvel?: Vec3,
    id = this.newId(),
    prints?: Prints,
  ): Assembly {
    const b: PlacedBrick = {
      id,
      type,
      colour,
      x: 0,
      y: 0,
      z: 0,
      rot: 0,
      ...(prints ? { prints } : {}),
    };
    const pos = sub(this.aboveGround(centre, 0.07, 0.2), rotate(rot, localCentre(b)));
    return this.createAssembly([b], pos, rot, false, linvel);
  }

  /** Creates a loose build from bricks given in grid coordinates (fresh ids are assigned). */
  spawnBuild(bricks: Omit<PlacedBrick, 'id'>[], pos: Vec3, rot: Quat = IDENTITY): Assembly {
    return this.createAssembly(
      bricks.map((b) => ({ ...b, id: this.newId() })),
      pos,
      rot,
      false,
    );
  }

  /** Adds bricks to an existing assembly without snapping checks (level setup, tests). */
  addBricks(a: Assembly, bricks: Omit<PlacedBrick, 'id'>[]): PlacedBrick[] {
    const placed = bricks.map((b) => ({ ...b, id: this.newId() }));
    for (const b of placed) {
      a.grid.insert(b);
      this.addCollider(a, b);
    }
    this.collidersChanged(a);
    a.version++;
    return placed;
  }

  /** World pose of a placement's centre inside an assembly. */
  brickPose(a: Assembly, p: Placement): { pos: Vec3; rot: Quat } {
    const bodyRot = a.body.rotation();
    return {
      pos: add(a.body.translation(), rotate(bodyRot, localCentre(p))),
      rot: mulQuat(bodyRot, partQuat(p)),
    };
  }

  /**
   * Re-splits an assembly into connected pieces (optionally ignoring `broken` joints).
   * The piece holding part `main` (else the baseplate, else the largest piece) stays in `a`;
   * the others become new dynamic assemblies at the same pose and velocity.
   */
  private resplit(a: Assembly, broken: Connection[] = [], main?: number): Assembly[] {
    const parts = a.grid.components(broken);
    if (parts.length <= 1) return [];
    // The piece with the baseplate keeps the assembly, so the team's build keeps its id.
    const withMain = main === undefined ? -1 : parts.findIndex((ids) => ids.includes(main));
    const withFixture = parts.findIndex((ids) =>
      ids.some((id) => BRICK_TYPES[a.grid.bricks.get(id)!.type].fixture),
    );
    const keep = Math.max(0, withMain >= 0 ? withMain : withFixture);
    const pos = a.body.translation();
    const rot = a.body.rotation();
    const linvel = a.anchored ? v3() : a.body.linvel();
    const angvel = a.anchored ? v3() : a.body.angvel();
    const created: Assembly[] = [];
    parts.forEach((ids, i) => {
      if (i === keep) return;
      const bricks = ids.map((id) => {
        this.removeCollider(a, id);
        return a.grid.remove(id)!;
      });
      const piece = this.createAssembly(bricks, pos, rot, false, linvel, angvel);
      created.push(piece);
    });
    if (created.length) this.collidersChanged(a);
    a.version++;
    a.bornTick = this.tick;
    return created;
  }

  private setHeld(a: Assembly, playerId: number | null): void {
    a.heldBy = playerId;
    const g = playerId === null ? WORLD_GROUPS : HELD_GROUPS;
    for (const c of collidersOf(a)) c.setCollisionGroups(g);
    a.body.wakeUp();
  }

  // ---------------------------------------------------------------- players

  addPlayer(opts: { id?: number; replicated?: boolean; spawn?: Vec3 } = {}): Player {
    const { R, world } = this;
    const spawn = this.aboveGround(opts.spawn ?? this.level.spawn, 0);
    const body = world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(
        spawn.x,
        spawn.y + PLAYER_FEET,
        spawn.z,
      ),
    );
    const collider = world.createCollider(
      R.ColliderDesc.capsule(PLAYER_HALF_HEIGHT, PLAYER_RADIUS).setCollisionGroups(PLAYER_GROUPS),
      body,
    );
    // Side-on: a shape nothing meets but its own moves (see `squeeze`).
    const slim = world.createCollider(
      R.ColliderDesc.roundCylinder(PLAYER_FEET - 0.04, SQUEEZE.slim - 0.04, 0.04)
        .setTranslation(spawn.x, spawn.y + PLAYER_FEET, spawn.z)
        .setCollisionGroups(groups(G_PLAYER, 0)),
    );
    const controller = world.createCharacterController(CONTROLLER_OFFSET);
    controller.enableSnapToGround(STEP_UP);
    controller.setMaxSlopeClimbAngle(MAX_CLIMB);
    controller.setApplyImpulsesToDynamicBodies(true);
    controller.setCharacterMass(70);
    const p: Player = {
      id: opts.id ?? this.newId(),
      body,
      collider,
      controller,
      input: emptyInput(),
      vy: 0,
      vel: v3(),
      grounded: false,
      slip: null,
      squeeze: null,
      work: null,
      works: 0,
      slim,
      ladder: null,
      holding: null,
      page: null,
      down: 0,
      fling: v3(),
      handsOff: false,
      team: null,
      limp: 0,
      slide: v3(),
      knocks: 0,
      fatigue: 0,
      treat: false,
      tool: this.replicaTools.get(opts.id ?? -1) ?? null,
      gear: new Set(),
      replicated: opts.replicated ?? false,
      pendingInputs: null,
      snapLock: null,
      snapLockKey: false,
    };
    this.owners.set(collider.handle, { kind: 'player', playerId: p.id });
    this.players.set(p.id, p);
    return p;
  }

  /** Removes a player; whatever they held is dropped where they stood. */
  removePlayer(id: number): void {
    const p = this.players.get(id);
    if (!p) return;
    if (!this.replica) {
      this.release(p);
      this.putToolAway(p);
      this.putVacuumDown(p);
      this.dropPage(p);
      for (const kind of [...p.gear]) this.dropGear(p, kind);
    }
    this.owners.delete(p.collider.handle);
    this.world.removeCollider(p.slim, false);
    this.world.removeCharacterController(p.controller);
    this.world.removeRigidBody(p.body);
    this.players.delete(id);
  }

  /** What a collider belongs to, as clicks see it (undefined for what the sim does not own). */
  ownerOf(c: Collider): ColliderOwner | undefined {
    return this.owners.get(c.handle);
  }

  eye(p: Player): Vec3 {
    return add(p.body.translation(), v3(0, EYE_OFFSET, 0));
  }

  /**
   * How many walls, shut doors and pieces of furniture lie on the straight line between two
   * points, up to `max` (voice chat muffles voices through them). Players, the dog, bricks,
   * pages and open doors do not count.
   */
  wallsBetween(from: Vec3, to: Vec3, max = 3): number {
    const d = sub(to, from);
    const dist = length(d);
    if (dist < 0.3) return 0;
    const ray = new this.R.Ray(from, scale(d, 1 / dist));
    let walls = 0;
    this.world.intersectionsWithRay(
      ray,
      dist,
      true,
      () => ++walls < max,
      this.R.QueryFilterFlags.EXCLUDE_DYNAMIC |
        this.R.QueryFilterFlags.EXCLUDE_KINEMATIC |
        this.R.QueryFilterFlags.EXCLUDE_SENSORS,
      // Not the guards over the stairwells' railings, which are there for players only.
      WORLD_GROUPS,
    );
    return walls;
  }

  private heldAssembly(p: Player): Assembly | undefined {
    return p.holding ? this.assemblies.get(p.holding.assemblyId) : undefined;
  }

  /**
   * Moves a player one tick per input (several when the server catches up on a backlog). Each
   * tick is its own controller move with its own input, exactly like a client predicting one
   * tick at a time, so both end up in the same place.
   */
  private movePlayer(p: Player, inputs: PlayerInput[]): void {
    const held = this.heldAssembly(p);
    const load = held && !isLooseBrick(held) ? assemblyMass(held) : 0;
    const start = p.collider.translation();
    let total = v3();
    for (let k = 0; k < inputs.length; k++) {
      const i = inputs[k]!;
      const limping = p.limp > 0;
      // A gear hunt's heavy build keeps whoever carries it without the back brace to a careful pace.
      const careful = i.careful || (load > 0 && this.heavyFor(p));
      const pace = careful ? CAREFUL_SPEED : i.sprint && !limping ? SPRINT_SPEED : WALK_SPEED;
      const speed =
        (pace / (1 + load / 40)) * (limping && !careful ? LIMP_FACTOR : 1) * tiredFactor(p);
      const f = v3(-Math.sin(i.yaw), 0, -Math.cos(i.yaw));
      const r = v3(Math.cos(i.yaw), 0, -Math.sin(i.yaw));
      let move = add(scale(f, i.forward), scale(r, i.right));
      const len = length(move);
      if (len > 1) move = scale(move, 1 / len);
      // Working a machine: walking up to it unless they move off themselves, which ends it.
      const w = p.work;
      if (w && (len > 0 || i.jump || p.down > 0 || p.ladder !== null)) p.work = null;
      else if (w && !w.there) {
        const way = sub(w.spot, add(start, total));
        const off = Math.hypot(way.x, way.z);
        if (off < WORK_CLOSE || --w.walk <= 0) w.there = true;
        else move = scale(v3(way.x, 0, way.z), Math.min(1, off / (speed * DT)) / off);
      } else if (w && --w.ticks <= 0 && this.machines.get(w.machineId)?.fixer !== p.id) {
        p.work = null;
      }
      // At a ladder's top, pushing on more or less toward what it reaches takes them straight
      // in off it, whichever way they look, between its rails.
      const top = i.forward > 0 ? this.ladderTopAt(add(start, total)) : undefined;
      if (top) {
        const into = v3(-Math.sin(top.facing), 0, -Math.cos(top.facing));
        const k = length(move);
        if (k > 0 && (move.x * into.x + move.z * into.z) / k > LADDER_FACING_COS)
          move = scale(into, k);
      }
      /** The way they ask to go, up to a unit long. */
      const dir = move;
      // Wading: as slow as walking carefully.
      move = scale(move, this.inWater(add(start, total)) ? Math.min(speed, CAREFUL_SPEED) : speed);
      if (p.limp > 0) p.limp--;
      // Lying on the ground: no control, just the slide from the fall.
      const down = p.down > 0;
      if (down) {
        p.down--;
        move = p.slide;
        p.slide = scale(p.slide, 0.9);
      }
      // Standing in the catapult's bucket between rounds: off you go.
      if (this.catapultArmed && this.catapultCooldown === 0 && p.grounded && !down) {
        const c = this.level.catapult;
        if (c && this.inBucket(c, add(start, total))) {
          p.vy = CATAPULT.launch.up;
          p.fling = scale(viewDir(c.facing, 0), CATAPULT.launch.along);
          this.catapultCooldown = CATAPULT.rearmTicks;
          if (!this.replica) {
            this.events.push({ kind: 'catapult', pos: this.eye(p), playerId: p.id });
          }
        }
      }
      // Flung: carried along until landing, with a little steering.
      if (p.fling.x !== 0 || p.fling.z !== 0) move = add(scale(move, 0.4), p.fling);
      const at = add(start, total);
      // Walking straight into a ladder takes hold of it a little to one side of it too (and
      // keeps hold while drawn onto it), and backing off its top catches hold of it even further
      // to one side.
      const reached = p.grounded || p.ladder !== null ? this.ladderAt(at, 0, LADDER_REACH) : null;
      const ladderId = down
        ? null
        : (this.ladderAt(at) ??
          (i.forward < 0 && !p.grounded && p.vy <= 0
            ? this.ladderAt(at, LADDER_CATCH)
            : reached !== null && (p.ladder !== null || this.walksInto(dir, reached))
              ? reached
              : null));
      const ladder = ladderId === null ? undefined : this.level.ladders[ladderId];
      // Jumping lets go of the ladder. From the ground a ladder is taken only by walking into
      // it, more or less facing it, so walking past its foot does not start a climb.
      const facingIt = ladder !== undefined && Math.cos(i.yaw - ladder.facing) > LADDER_FACING_COS;
      // Pushing on up top, they let go as soon as there is room before them to stand on what
      // it reaches.
      const onLadder =
        ladder !== undefined &&
        !i.jump &&
        (!p.grounded || facingIt) &&
        !(i.forward > 0 && !p.grounded && this.offTheTop(p, ladder, at));
      // Lying down, flung or on a ladder moves exactly as told; otherwise they go at once the
      // way the input asks, on the ground and in the air.
      const climbing = onLadder && !p.grounded;
      const steered = !down && p.fling.x === 0 && p.fling.z === 0 && !climbing;
      if (steered) p.vel = v3(move.x, 0, move.z);
      // Squeezing and slipping are for walking: lying down, flung or climbing, they stop.
      if (!steered || onLadder) p.squeeze = p.slip = null;
      if (onLadder) {
        // On a ladder: forward climbs, back climbs down, otherwise hang on.
        p.vy = i.forward > 0 ? CLIMB_SPEED : i.forward < 0 ? -CLIMB_SPEED : 0;
        // Hands on the rungs: a climber off the ground goes up or down and nowhere else, so a
        // ladder standing clear of any wall (up to a deck or a treehouse) holds them as well
        // as one leaning on a house does. The top is where it lets go: past the ladder's
        // height they walk on, onto whatever it reaches.
        // Pushing on while climbing carries them on over the top, at a walk. Setting off up it
        // from its foot, they go onto it whichever way they look.
        if (climbing || (p.grounded && i.forward > 0)) {
          p.vel = v3(move.x, 0, move.z);
          move = this.ontoLadder(ladder, at);
        }
      } else if (p.grounded && i.jump && !down && !p.squeeze) p.vy = JUMP_SPEED;
      // Standing on something: no push into it (snap-to-ground keeps the feet down). Pushing
      // into the floor every tick makes the controller stall now and then.
      else if (p.grounded && p.vy <= 0) p.vy = 0;
      else p.vy -= GRAVITY * DT;
      // Side-on in a gap, they edge along it, whichever way they ask to go along it.
      const a = p.squeeze;
      const along = a ? Math.max(-1, Math.min(1, dir.x * a.x + dir.z * a.z)) : 0;
      const desired = a
        ? v3(a.x * along * SQUEEZE.edge * DT, p.vy * DT, a.z * along * SQUEEZE.edge * DT)
        : this.keepOnStairs(at, v3(move.x * DT, p.vy * DT, move.z * DT));
      // Slipping off an edge: off it, whichever way they ask to go.
      const slip = p.slip;
      if (slip) {
        const back = Math.min(0, desired.x * slip.x + desired.z * slip.z);
        desired.x += (SLIP_SPEED * DT - back) * slip.x;
        desired.z += (SLIP_SPEED * DT - back) * slip.z;
      }
      const c = a ? p.slim : p.collider;
      let m = this.walk(p, c, at, desired);
      const wasFalling = !p.grounded ? p.vy : 0;
      // Rising, they are not on the ground, whatever they brush against on the way up.
      p.grounded = p.controller.computedGrounded() && (onLadder || p.vy <= 0);
      // Held up on the ground: a step up, perhaps, that the controller would not take.
      const flat = Math.hypot(desired.x, desired.z);
      if (steered && !onLadder && p.grounded && flat > 1e-4 && Math.hypot(m.x, m.z) < flat * 0.9) {
        const up = this.climb(p, c, at, desired);
        if (up && up.x * desired.x + up.z * desired.z > m.x * desired.x + m.z * desired.z) m = up;
      }
      // On the ground only under the capsule's rim, nothing under their feet, and not getting
      // on onto it (as up a narrow step): they slip off.
      if (steered && !onLadder && p.grounded && !a) {
        const off = this.perched(p, add(at, m));
        p.slip = off && m.x * off.x + m.z * off.z > -0.005 ? off : null;
        if (p.slip) p.grounded = false;
      } else if (p.grounded) p.slip = null;
      // Into a gap narrower than their shoulders, they turn side-on to squeeze through; out of
      // it, they turn back.
      const asked = Math.hypot(dir.x, dir.z);
      if (a) m = add(m, this.edge(p, a, along, add(at, m), asked));
      else if (steered && !onLadder && p.grounded && asked > 0.5)
        this.wedged(p, add(at, m), dir.x / asked, dir.z / asked);
      p.ladder = onLadder && !p.grounded ? ladderId : null;
      if (p.grounded && wasFalling < -HARD_LANDING_SPEED && !this.replica) {
        this.knockDown(p, scale(f, 0.6), LANDING_DOWN_TICKS);
      }
      if (p.grounded && p.vy < 0) {
        p.vy = 0;
        p.fling = v3();
      }
      // Bumped our head.
      if (p.vy > 0 && m.y < desired.y * 0.5) p.vy = 0;
      // Flew into something: what got through is all the momentum left (sliding along a wall
      // keeps the part along it). Not on the ground, where steps and slopes turn some of the
      // walk into climbing and the input keeps it up anyway.
      if (steered && !p.grounded) {
        const got = v3(m.x / DT, 0, m.z / DT);
        if (length(got) < length(p.vel) - 1e-3) p.vel = got;
      } else if (!climbing) p.vel = down ? v3() : v3(move.x, 0, move.z);
      total = add(total, m);
      // Slide the collider along so the next tick's move starts from the right place (and put
      // back from wherever stepping up tried it).
      p.collider.setTranslation(add(start, total));
    }
    p.body.setNextKinematicTranslation(add(p.body.translation(), total));
  }

  /**
   * Moves `c` (a player's capsule, or side-on their slim shape) with its middle at `at` by
   * `delta` as far as it goes; how far it went. Stepping up no higher than there is room
   * overhead: the controller steps up only where it can rise the whole way, which under a
   * stair's upper flight or a low ceiling it could not.
   */
  private walk(p: Player, c: Collider, at: Vec3, delta: Vec3, step = true): Vec3 {
    c.setTranslation(at);
    if (!step) p.controller.disableAutostep();
    const over = !step
      ? null
      : this.world.castShape(
          at,
          IDENTITY,
          UP,
          c.shape,
          0,
          STEP_UP,
          false,
          this.R.QueryFilterFlags.EXCLUDE_SENSORS,
          PLAYER_GROUPS,
          p.collider,
        );
    const room = over ? over.time_of_impact - 0.01 : STEP_UP;
    if (step) p.controller.enableAutostep(Math.max(0.01, Math.min(STEP_UP, room)), 0.1, false);
    p.controller.computeColliderMovement(
      c,
      delta,
      undefined,
      PLAYER_GROUPS,
      (o) => o !== p.collider,
    );
    const m = p.controller.computedMovement();
    return v3(m.x, m.y, m.z);
  }

  /**
   * Moves `c` with its middle at `at` by `delta` (along the ground) up onto what holds it up, if
   * it can: lifted as little as gets it on (so that on a steep stair it is not lifted into the
   * flight over), on, and down onto it. How far it went, standing at the end; or null if it gets
   * no further on so.
   */
  private climb(p: Player, c: Collider, at: Vec3, delta: Vec3): Vec3 | null {
    const flat = Math.hypot(delta.x, delta.z);
    for (const h of CLIMB_TRIES) {
      const up = this.walk(p, c, at, v3(0, h, 0), false);
      if (up.y < h * 0.5) return null;
      const lifted = add(at, v3(0, up.y, 0));
      // Lifted already: no stepping up again on top of that.
      const on = this.walk(p, c, lifted, v3(delta.x, 0, delta.z), false);
      // On the way they go: slid back off a sloping face is no step up.
      if ((on.x * delta.x + on.z * delta.z) / flat < flat * 0.5) continue;
      const down = this.walk(p, c, add(lifted, on), v3(0, -up.y - on.y - 0.05, 0), false);
      if (!p.controller.computedGrounded()) continue;
      return v3(on.x, up.y + on.y + down.y, on.z);
    }
    return null;
  }

  /**
   * Standing with their middle at `centre` on nothing within their feet's reach (the capsule
   * resting on an edge out past them by its rim), the way off the edge (x, z, a unit long);
   * else null.
   */
  private perched(p: Player, centre: Vec3): { x: number; z: number } | null {
    const flags = this.R.QueryFilterFlags.EXCLUDE_SENSORS;
    const bottom = centre.y - PLAYER_FEET;
    // A thin disc as wide as their feet, from just over the capsule's foot down.
    const lift = 0.05;
    const under = this.world.castShape(
      v3(centre.x, bottom + lift, centre.z),
      IDENTITY,
      DOWN,
      new this.R.Cylinder(0.005, FOOT),
      0,
      lift + CONTROLLER_OFFSET + UNDERFOOT,
      true,
      flags,
      PLAYER_GROUPS,
      p.collider,
    );
    if (under) return null;
    // What the capsule rests on, and away from it.
    const rest = this.world.castShape(
      centre,
      IDENTITY,
      DOWN,
      p.collider.shape,
      0,
      CONTROLLER_OFFSET + 0.05,
      false,
      flags,
      PLAYER_GROUPS,
      p.collider,
    );
    const on =
      rest?.witness1 ??
      this.world.projectPoint(
        v3(centre.x, bottom + PLAYER_RADIUS, centre.z),
        true,
        flags,
        PLAYER_GROUPS,
        p.collider,
      )?.point;
    if (!on) return null;
    const [dx, dz] = [centre.x - on.x, centre.z - on.z];
    const d = Math.hypot(dx, dz);
    return d > 1e-3 ? { x: dx / d, z: dz / d } : null;
  }

  /** Whether a player could stand upright with their middle at `centre`, clear of everything. */
  private roomAt(p: Player, centre: Vec3): boolean {
    return !this.world.intersectionWithShape(
      v3(centre.x, centre.y + 0.05, centre.z),
      IDENTITY,
      p.collider.shape,
      this.R.QueryFilterFlags.EXCLUDE_SENSORS | this.R.QueryFilterFlags.EXCLUDE_DYNAMIC,
      PLAYER_GROUPS,
      p.collider,
    );
  }

  /**
   * Whether, with their middle at `centre` and going along (`ux`, `uz`), something is in the way
   * of their shoulders on both sides: over the height they step up and up to their head, out
   * past where the capsule keeps them from but within their shoulders' reach, and within
   * `SQUEEZE.reach` before or behind them (so that a gap across their way at a slant is found,
   * its sides one before the other); and nothing in the way between (as a wall before them would
   * be, rather than a gap).
   */
  private tight(p: Player, centre: Vec3, ux: number, uz: number): boolean {
    const turn = yawQuat(Math.atan2(-uz, ux));
    const inner = 0.1;
    const bottom = centre.y - PLAYER_FEET;
    const half = (2 * PLAYER_FEET - STEP_UP) / 2;
    const y = bottom + STEP_UP + half;
    const flags = this.R.QueryFilterFlags.EXCLUDE_SENSORS | this.R.QueryFilterFlags.EXCLUDE_DYNAMIC;
    const hits = (shape: Shape, out: number) =>
      !!this.world.intersectionWithShape(
        v3(centre.x - uz * out, y, centre.z + ux * out),
        turn,
        shape,
        flags,
        PLAYER_GROUPS,
        p.collider,
      );
    const side = new this.R.Cuboid(SQUEEZE.reach, half, (SQUEEZE.shoulder - inner) / 2);
    const between = new this.R.Cuboid(SQUEEZE.reach, half, inner * 0.8);
    return (
      [-1, 1].every((s) => hits(side, (s * (inner + SQUEEZE.shoulder)) / 2)) && !hits(between, 0)
    );
  }

  /**
   * Going along (`ux`, `uz`) from `centre` into a gap narrower than their shoulders (held up by
   * it, or only brushing it either side) where side-on they would get on, they turn side-on to
   * squeeze through.
   */
  private wedged(p: Player, centre: Vec3, ux: number, uz: number): void {
    if (!this.tight(p, v3(centre.x + ux * 0.1, centre.y, centre.z + uz * 0.1), ux, uz)) return;
    const on = this.walk(p, p.slim, centre, v3(ux * 0.06, 0, uz * 0.06));
    if (on.x * ux + on.z * uz >= 0.03) p.squeeze = { x: ux, z: uz };
  }

  /**
   * Edged `along` the gap `a` to `centre`, they turn back to walk on once there is room to stand
   * upright (shouldered a little aside, if need be: how far is what this returns) and their
   * shoulders are clear, there and a little further on the way they go; or, asking to go off
   * another way (`asked` that hard), once there is room where they stand.
   */
  private edge(
    p: Player,
    a: { x: number; z: number },
    along: number,
    centre: Vec3,
    asked: number,
  ): Vec3 {
    const aside = [0, 0.04, -0.04, 0.08, -0.08];
    const at = (s: number, k: number) =>
      v3(centre.x + a.x * s - a.z * k, centre.y, centre.z + a.z * s + a.x * k);
    const room = (s: number) => {
      for (const k of aside) {
        const q = at(s, k);
        if (this.roomAt(p, q) && !this.tight(p, q, a.x, a.z)) return q;
      }
      return null;
    };
    if (Math.abs(along) <= 0.3 && asked > 0.5) {
      // Off another way: as soon as they can stand upright.
      for (const k of aside) {
        const q = at(0, k);
        if (!this.roomAt(p, q)) continue;
        p.squeeze = null;
        return sub(q, centre);
      }
      return v3();
    }
    const here = room(0);
    if (!here) return v3();
    const out = Math.abs(along) > 0.3 ? room(Math.sign(along) * 0.1) : room(0.1) && room(-0.1);
    if (!out) return v3();
    p.squeeze = null;
    return sub(here, centre);
  }

  /**
   * Whether a climber at `centre` on `l` could step off it, on the way it is climbed: room for
   * them a little before them, a step above where their feet are, with something to stand on
   * no more than a step below that, up toward its top (not the ground round its foot, under a
   * deck it climbs to).
   */
  private offTheTop(p: Player, l: LadderDef, centre: Vec3): boolean {
    const out = PLAYER_RADIUS + 0.2;
    const ahead = v3(
      centre.x - Math.sin(l.facing) * out,
      centre.y + 0.1,
      centre.z - Math.cos(l.facing) * out,
    );
    if (centre.y - PLAYER_FEET < l.pos.y + l.height / 2 || !this.roomAt(p, ahead)) return false;
    return !!this.world.castShape(
      ahead,
      IDENTITY,
      DOWN,
      p.collider.shape,
      0,
      0.1 + STEP_UP,
      false,
      this.R.QueryFilterFlags.EXCLUDE_SENSORS,
      PLAYER_GROUPS,
      p.collider,
    );
  }

  /**
   * How a climber at `centre` moves across the ladder: not at all while they are on it, or back
   * onto it (between its rails, close to its plane) if they caught hold of it from one side.
   */
  private ontoLadder(l: LadderDef, centre: Vec3): Vec3 {
    const local = rotate(conj(yawQuat(l.facing)), sub(centre, l.pos));
    const rail = l.width / 2 - 0.05;
    const near = PLAYER_RADIUS + 0.2;
    const dx = Math.max(-rail, Math.min(rail, local.x)) - local.x;
    const dz = Math.max(-near, Math.min(near, local.z)) - local.z;
    if (dx === 0 && dz === 0) return v3();
    return rotate(yawQuat(l.facing), v3(dx * LADDER_PULL, 0, dz * LADDER_PULL));
  }

  /** Whether a player whose centre is at `centre` has their feet in the level's water. */
  private inWater(centre: Vec3): boolean {
    const feet = centre.y - PLAYER_FEET;
    // Out on the sea round an island: wherever the ground is under it and the feet are too.
    const { sea } = this.level;
    if (sea !== undefined && feet < sea + 0.15 && inSea(this.level, centre.x, centre.z))
      return true;
    const water = this.level.water;
    if (!water) return false;
    if (feet > 0.15) return false;
    return water.some(
      (w) => centre.x >= w.x0 && centre.x <= w.x1 && centre.z >= w.z0 && centre.z <= w.z1,
    );
  }

  /** Whether a player whose centre is at `centre` stands in the catapult's bucket. */
  private inBucket(c: NonNullable<LevelDef['catapult']>, centre: Vec3): boolean {
    const local = rotate(conj(yawQuat(c.facing)), sub(centre, c.pos));
    const bucket = catapultBucket();
    const feet = local.y - PLAYER_FEET;
    return (
      Math.hypot(local.x - bucket.x, local.z - bucket.z) < CATAPULT.bucket.radius &&
      feet > CATAPULT.frame.size.y - 0.15 &&
      feet < CATAPULT.frame.size.y + 0.4
    );
  }

  /**
   * Keeps a player on a flight of stairs between its handrail and its wall: the move `desired`
   * for a player with their centre at `at`, with its sideways part cut so that it leaves them
   * no further out than a hand's width in from either edge of the steps (and brings them back
   * in a little if they are out past that). Nothing solid does this. A player stepping up a
   * step while brushing against something solid beside them (the wall, or a railing that
   * collided) stalls now and then, as the physics engine's step up fails when its casts graze
   * whatever they touch, so there is nothing to brush against: the handrail is drawn only, and
   * at the limit the move is straight up the flight. That also keeps every part of them clear
   * of the edges of the ceiling beside the well and over the wall, which used to catch their
   * head and jam them there.
   */
  private keepOnStairs(at: Vec3, desired: Vec3): Vec3 {
    const feetY = at.y - PLAYER_FEET;
    for (const s of this.flights) {
      if (feetY < s.pos.y - 0.2 || feetY > s.top + 0.5) continue;
      const dx = at.x - s.pos.x;
      const dz = at.z - s.pos.z;
      const along = dx * s.along.x + dz * s.along.z;
      if (along < 0 || along > s.run) continue;
      const across = dx * s.across.x + dz * s.across.z;
      const half = STAIRS.width / 2;
      if (Math.abs(across) > half + s.reach) continue;
      // Beside the steps on the floor they start from is off them: walking along the flight or
      // away from it there is no business of the stairs.
      if (Math.abs(across) > half && feetY < s.pos.y + 0.05) continue;
      // Nor is beside the well on the floor it comes out on: held there, a player who walked up
      // to the railing could only slide along it, pulled back toward the steps.
      if (Math.abs(across) > half && feetY > s.top - 0.05) continue;
      const limit = half - PLAYER_RADIUS - STAIRS_MARGIN;
      const sideways = desired.x * s.across.x + desired.z * s.across.z;
      let want = across + sideways;
      if (want > limit) want = Math.max(limit, across - STAIRS_SLIDE);
      else if (want < -limit) want = Math.min(-limit, across + STAIRS_SLIDE);
      const d = want - across - sideways;
      return d === 0
        ? desired
        : v3(desired.x + s.across.x * d, desired.y, desired.z + s.across.z * d);
    }
    return desired;
  }

  /**
   * The ladder (its index in the level's `ladders`) a player's centre is on, if any; with
   * `slack`, one they are within that much of out from (not behind) it, and `side` to either
   * side of it (as much as `slack` unless given). They hold on till their feet are all but at
   * its top, so that pushing on they walk off onto what it reaches rather than up against its
   * edge (where, their feet over nothing, they would slip back off it).
   */
  private ladderAt(centre: Vec3, slack = 0, side = slack): number | null {
    const i = this.level.ladders.findIndex((l) => {
      const local = rotate(conj(yawQuat(l.facing)), sub(centre, l.pos));
      return (
        Math.abs(local.x) < l.width / 2 + side &&
        local.z > -(PLAYER_RADIUS + 0.25) &&
        local.z < PLAYER_RADIUS + 0.25 + slack &&
        local.y > 0 &&
        local.y - PLAYER_FEET < l.height - 0.05
      );
    });
    return i < 0 ? null : i;
  }

  /**
   * The ladder whose top a player with their middle at `centre` is at, if any: their feet about
   * level with it, over it or just off it onto what it reaches.
   */
  private ladderTopAt(centre: Vec3): LadderDef | undefined {
    return this.level.ladders.find((l) => {
      const local = rotate(conj(yawQuat(l.facing)), sub(centre, l.pos));
      const feet = local.y - PLAYER_FEET - l.height;
      return (
        Math.abs(local.x) < l.width / 2 + LADDER_REACH &&
        local.z > -LADDER_TOP_IN &&
        local.z < PLAYER_RADIUS + 0.25 &&
        feet > -0.5 &&
        feet < 0.6
      );
    });
  }

  /** Whether going the way `dir` asks (up to a unit long) is walking more or less straight into a ladder. */
  private walksInto(dir: Vec3, ladder: number): boolean {
    const { facing } = this.level.ladders[ladder]!;
    return -(dir.x * Math.sin(facing) + dir.z * Math.cos(facing)) > LADDER_INTO;
  }

  /**
   * Where the player's camera is: behind their shoulder, pulled in where it would be in
   * something (see `sightline`). Aiming starts here, so clicks land on the crosshair.
   */
  camera(p: Player, eye: Vec3 = this.eye(p), input: PlayerInput = p.input): Vec3 {
    return this.sightline(p, eye, cameraPosition(eye, input));
  }

  /**
   * Where on the way from `from` (somewhere the player sees from, like their eyes) to `to` a
   * camera can sit. It stays out at `to` whatever is between it and the player (a post, a
   * lamp, a machine), and comes in only where it would itself be in something: then to just
   * short of where the line goes into that. Two things it never sees through: the ground, a
   * floor or a ceiling; and the walls and windows between a building's inside and the outside,
   * so that it stays in with a player who is in, and out with one who is out. With a `radius`
   * the camera also keeps that much clear of what it would be in, so it slides along a surface
   * it approaches instead of jumping the moment it touches; the client's camera uses that to
   * ease in and out gently. Players, the dog and anything the sim does not own (a client's
   * ragdolls) are never in the way.
   */
  sightline(p: Player, from: Vec3, to: Vec3, radius = 0): Vec3 {
    const offset = sub(to, from);
    const dist = length(offset);
    if (dist < 1e-3) return to;
    const dir = scale(offset, 1 / dist);
    const held = p.holding ? this.assemblies.get(p.holding.assemblyId)?.body : undefined;
    const flags = this.R.QueryFilterFlags.EXCLUDE_SENSORS;
    const blocks = (c: Collider) => {
      const o = this.owners.get(c.handle);
      return o !== undefined && o.kind !== 'player' && o.kind !== 'dog';
    };
    const ray = new this.R.Ray(from, dir);
    /**
     * How far along the line the camera keeps out of what `only` picks, up to `far`: clear of
     * it by `radius` if it can be, else not looking through it; `far` if the line does not
     * meet it, and 0 if it starts in it.
     */
    const short = (far: number, only: (c: Collider) => boolean): number => {
      if (radius > 0) {
        const ball = new this.R.Ball(radius);
        const hit = this.world.castShape(
          from,
          IDENTITY,
          dir,
          ball,
          0,
          far,
          true,
          flags,
          undefined,
          p.collider,
          held,
          only,
        );
        if (!hit) return far;
        // Already touching it at the start (a low ceiling right over the head): there is no
        // clearance to keep, so settle for not looking through it.
        if (hit.time_of_impact > 0) return hit.time_of_impact;
      }
      const hit = this.world.castRay(ray, far, true, flags, undefined, p.collider, held, only);
      if (!hit) return far;
      return hit.timeOfImpact > 0 ? hit.timeOfImpact - 0.15 : 0;
    };
    const least = Math.min(0.2, dist);
    // Never under the ground, a floor or a ceiling, nor across between indoors and out.
    let d = short(dist, (c) => blocks(c) && this.floors.has(c.handle));
    d = Math.max(least, Math.min(d, this.sameSide(from, dir, d) - 0.15));
    // In something: in to where the line goes into it, and so on till it is clear.
    const lens = new this.R.Ball(Math.max(radius, CAMERA_LENS));
    for (let pass = 0; pass < 8 && d > least; pass++) {
      const at = add(from, scale(dir, d));
      const hit = this.world.intersectionWithShape(
        at,
        IDENTITY,
        lens,
        flags,
        undefined,
        p.collider,
        held,
        blocks,
      );
      if (!hit) break;
      const into = short(d, (c) => c.handle === hit.handle);
      // The player is in it themselves (a low ceiling right over the head): not in the way.
      if (into <= 0) break;
      d = Math.max(least, Math.min(into, d - 0.02));
    }
    return d >= dist ? to : add(from, scale(dir, d));
  }

  /**
   * How far along `dir` from `from` the line stays indoors if `from` is indoors, or out if it is
   * out (`indoors`): where it first crosses over, up to `far`; Infinity if it never does.
   */
  private sameSide(from: Vec3, dir: Vec3, far: number): number {
    const start = indoors(this.level, from);
    const crossings: number[] = [];
    for (const { rect, y0, y1 } of this.level.interiors) {
      let [t0, t1] = [0, far];
      for (const [o, d, lo, hi] of [
        [from.x, dir.x, rect.x0, rect.x1],
        [from.y, dir.y, y0, y1],
        [from.z, dir.z, rect.z0, rect.z1],
      ] as const) {
        if (Math.abs(d) < 1e-9) {
          if (o < lo || o > hi) t0 = Infinity;
          continue;
        }
        const [a, b] = [(lo - o) / d, (hi - o) / d];
        t0 = Math.max(t0, Math.min(a, b));
        t1 = Math.min(t1, Math.max(a, b));
      }
      if (t0 <= t1) crossings.push(t0, t1);
    }
    crossings.sort((a, b) => a - b);
    for (const t of crossings)
      if (t > 0 && t < far && indoors(this.level, add(from, scale(dir, t + 1e-4))) !== start)
        return t;
    return Infinity;
  }

  /** What the player is aiming at, within reach (or would aim at with the view `ask`). */
  aim(p: Player, ask?: ViewAsk): AimHit | null {
    const { origin, dir, skip } = this.aimRay(p, ask);
    const heldId = p.holding?.assemblyId;
    const hit = this.world.castRayAndGetNormal(
      new this.R.Ray(origin, dir),
      REACH + 0.4,
      true,
      undefined,
      undefined,
      p.collider,
      undefined,
      (c) => {
        const o = this.owners.get(c.handle);
        // Not the brick in hand, nor anything the sim does not own (a client's ragdolls), nor
        // an empty place in an output area (switched off, but only from the next step).
        if (o?.kind === 'output') return !!this.machines.get(o.machineId)?.out[o.slot];
        return o !== undefined && !(o.kind === 'brick' && o.assemblyId === heldId);
      },
    );
    if (!hit) return null;
    const owner = this.owners.get(hit.collider.handle) ?? { kind: 'static' as const };
    const seen =
      owner.kind === 'machine' || owner.kind === 'output'
        ? this.seenOutput(owner, origin, dir, hit.timeOfImpact)
        : owner.kind === 'static'
          ? this.buriedGadget(hit.collider, origin, dir)
          : null;
    const at = seen ?? { owner, toi: hit.timeOfImpact, normal: hit.normal };
    return {
      point: add(origin, scale(dir, at.toi)),
      normal: at.normal,
      distance: skip + at.toi,
      owner: at.owner,
    };
  }

  /**
   * A handle of the scenery's (see `GadgetDef`) inside the box the ray from `origin` met, which
   * it goes on to: a level's boxes are rough, a tap's or a hob's taking in the counter it is on,
   * but the handle is drawn on the counter's top, in plain sight. The nearest, if any.
   */
  private buriedGadget(
    box: Collider,
    origin: Vec3,
    dir: Vec3,
  ): { owner: ColliderOwner; toi: number; normal: Vec3 } | null {
    let best: { owner: ColliderOwner; toi: number; normal: Vec3 } | null = null;
    const ray = new this.R.Ray(origin, dir);
    for (const g of this.gadgets.values()) {
      for (const c of g.handles) {
        if (!box.containsPoint(c.translation())) continue;
        const toi = c.castRay(ray, REACH + 0.4, true);
        if (toi < 0 || (best && toi >= best.toi)) continue;
        best = { owner: { kind: 'gadget', gadgetId: g.def.id }, toi, normal: scale(dir, -1) };
      }
    }
    return best;
  }

  /**
   * Of what lies in a machine's output area, the thing a ray that met the machine (or a place
   * in its output area) `toi` along was aimed at, if any. The places sit in the machine's front,
   * behind the face of its collider, which is a plain box: the press's bay is a recess in its
   * bed, the silo's grate stands between its legs. So a ray on its way to a thing seen there
   * can meet the box first; and the press's places are side by side, so a slanting ray can
   * cross a corner of the next one first. A place counts if the ray met it, or goes in through
   * its opening and reaches it within `OUTPUT_SEE_THROUGH` past where it met the machine; of
   * those, the one whose thing lies nearest the ray in there.
   */
  private seenOutput(
    owner: { kind: 'machine' | 'output'; machineId: number; slot?: number },
    origin: Vec3,
    dir: Vec3,
    toi: number,
  ): { owner: ColliderOwner; toi: number; normal: Vec3 } | null {
    const { machineId } = owner;
    const m = this.machines.get(machineId);
    const clicks = this.outputColliders.get(machineId);
    if (!m || !clicks || m.out.every((x) => x === null)) return null;
    const ray = new this.R.Ray(origin, dir);
    const places = machineOutputs(m.def);
    const slots = outputSlots(m.def.kind, m.def.size);
    // The ray in the machine's own frame, to find where it crosses the machine's front.
    const unturn = conj(yawQuat(m.def.facing));
    const o = rotate(unturn, sub(origin, m.def.pos));
    const d = rotate(unturn, dir);
    const throughMouth = ({ z, x0, x1, y0, y1 }: OutputSlot['mouth']): boolean => {
      if (d.z >= 0) return false;
      const at = add(o, scale(d, (z - o.z) / d.z));
      const s = MOUTH_SLACK;
      return at.x >= x0 - s && at.x <= x1 + s && at.y >= y0 - s && at.y <= y1 + s;
    };
    let best: { owner: ColliderOwner; toi: number; normal: Vec3; off: number } | null = null;
    for (let slot = 0; slot < m.out.length; slot++) {
      if (!m.out[slot]) continue;
      const met = owner.kind === 'output' && owner.slot === slot;
      if (!met && !throughMouth(slots[slot]!.mouth)) continue;
      const at = clicks[slot]?.castRayAndGetNormal(ray, toi + OUTPUT_SEE_THROUGH, true);
      if (!at || at.timeOfImpact > REACH + 0.4) continue;
      // How far the thing lies from the ray where it passes through the place.
      const to = sub(places[slot]!.rest, origin);
      const along = Math.min(Math.max(dot(to, dir), at.timeOfImpact), at.timeOfImpact + 0.5);
      const off = length(sub(to, scale(dir, along)));
      if (best && best.off <= off) continue;
      const place = { kind: 'output' as const, machineId, slot };
      best = { owner: place, toi: at.timeOfImpact, normal: at.normal, off };
    }
    return best;
  }

  /** The ray `aim` casts: `skip` metres along from the camera, so it starts level with the player. */
  private aimRay(p: Player, ask?: ViewAsk): { origin: Vec3; dir: Vec3; skip: number } {
    const eye = ask?.eye ?? this.eye(p);
    const input = ask
      ? {
          ...p.input,
          yaw: ask.yaw ?? p.input.yaw,
          pitch: ask.pitch ?? p.input.pitch,
          firstPerson: ask.firstPerson ?? p.input.firstPerson,
        }
      : p.input;
    const cam = this.camera(p, eye, input);
    const dir = viewDir(input.yaw, input.pitch);
    // Start level with the player so things between the camera and the player are skipped.
    const skip = Math.max(0, dot(sub(eye, cam), dir) - 0.4);
    return { origin: add(cam, scale(dir, skip)), dir, skip };
  }

  /**
   * Where a held assembly's centre of mass is pulled toward, and how its body is turned. A
   * single brick may sit anywhere in its body (a piece broken off a build keeps its place in
   * the build's grid), so it is turned by its own heading to face `h.rot` across the hands.
   */
  holdTarget(
    p: Player,
    h: Holding,
    a: Assembly | null,
    yaw = p.input.yaw,
  ): { pos: Vec3; rot: Quat } {
    const eye = this.eye(p);
    const f = v3(-Math.sin(yaw), 0, -Math.cos(yaw));
    if (!a || isLooseBrick(a)) {
      const brick = a?.grid.bricks.values().next().value;
      const depth = brick ? footprint(brick.type, h.rot).d * STUD : 2 * STUD;
      const chest = add(p.body.translation(), v3(0, HOLD.up, 0));
      return {
        pos: add(chest, scale(f, HOLD.front + depth / 2)),
        rot: yawQuat(yaw + (h.rot - (brick?.rot ?? 0)) * QUARTER),
      };
    }
    // Far enough out that the build's near side, as it is turned in the hands, clears the body.
    const turn = h.yawOffset + h.rot * QUARTER;
    const ahead = PLAYER_RADIUS + BUILD_HOLD_GAP + nearSide(a, turn);
    return {
      pos: add(eye, add(scale(f, ahead), v3(0, -0.6, 0))),
      rot: yawQuat(yaw + turn),
    };
  }

  /**
   * Where the body of a held single brick goes so the brick itself sits on its hold point.
   * Clients use it to draw their own brick lag-free.
   */
  heldBrickPose(p: Player, h: Holding, a: Assembly): { pos: Vec3; rot: Quat } {
    const target = this.holdTarget(p, h, a);
    const brick = a.grid.bricks.values().next().value!;
    return { pos: sub(target.pos, rotate(target.rot, localCentre(brick))), rot: target.rot };
  }

  /**
   * How fast a hold point is carried along by the player's own moving this tick (at full pace
   * from the first, so a standing start does not leave it a tick behind, in their belly) and
   * turning since last tick: its velocity and the turn rate. Changes to the hold itself
   * (turning a build in the hands, setting it down) are left to the steering, so they never
   * jolt it.
   */
  private holdFollow(p: Player, h: Holding, target: Vec3): { follow: Vec3; spin: number } {
    const eye = this.eye(p);
    const yaw = p.input.yaw;
    const last = h.last;
    let moved = { follow: v3(), spin: 0 };
    if (last) {
      const turn = Math.atan2(Math.sin(yaw - last.yaw), Math.cos(yaw - last.yaw));
      const going = sub(p.body.nextTranslation(), p.body.translation());
      const before = sub(add(eye, rotate(yawQuat(-turn), sub(target, eye))), going);
      const follow = scale(sub(target, before), 1 / DT);
      // A teleport (to a meeting, say) is not a step to follow.
      if (length(follow) <= MAX_HOLD_FOLLOW) moved = { follow, spin: turn / DT };
    }
    h.last = { eye, yaw, ...moved };
    return moved;
  }

  /** Steers a held assembly toward its hold point. Single bricks follow tightly, builds wobble. */
  private applyHold(p: Player): void {
    const a = this.heldAssembly(p);
    if (!a || !p.holding) return;
    const target = this.holdTarget(p, p.holding, a);
    const single = isLooseBrick(a);
    const com = a.body.worldCom();
    if (p.holding.settingDown !== null) {
      p.holding.settingDown += DT * 0.9;
      target.pos.y -= p.holding.settingDown;
      // Once the build rests on something it cannot follow the hands down any further.
      if (com.y - target.pos.y > 0.12 || p.holding.settingDown > 2) {
        this.release(p);
        return;
      }
    }
    const err = sub(target.pos, com);
    if (length(err) > 2.5) {
      this.release(p);
      return;
    }
    // Move along with the player (running, turning) and steer out the rest of the error on
    // top: steering alone trails behind by speed / k, which runs a carried build into the belly.
    // The steering (and a build's wobble) works on the motion relative to the hands.
    const was = p.holding.last;
    const { follow, spin } = this.holdFollow(p, p.holding, target.pos);
    const [k, blend, kA, blendA, lift] = single ? [18, 0.6, 14, 0.6, 1] : [9, 0.2, 5, 0.12, 0.85];
    const lv = sub(a.body.linvel(), was?.follow ?? v3());
    const v = add(follow, add(lv, scale(sub(scale(err, k), lv), blend)));
    v.y += WORLD_GRAVITY * DT * lift;
    a.body.setLinvel(v, true);
    const av = sub(a.body.angvel(), v3(0, was?.spin ?? 0, 0));
    const rotErr = rotationError(a.body.rotation(), target.rot);
    const w = add(av, scale(sub(scale(rotErr, kA), av), blendA));
    a.body.setAngvel(add(w, v3(0, spin, 0)), true);
  }

  // ---------------------------------------------------------------- actions

  act(playerId: number, action: Action): void {
    const p = this.players.get(playerId);
    // Lying on the ground, nobody can do anything.
    if (!p || this.replica || p.down > 0) return;
    // A machine that did something for them (it took what they put in, made something, gave it
    // up, or they set about clearing its jam): they go up to it and work it.
    const hit = this.aim(p);
    const [events, version] = [this.events.length, this.furnitureVersion];
    this.doAct(p, action);
    const did = this.events.length !== events || this.furnitureVersion !== version;
    if (did && (hit?.owner.kind === 'machine' || hit?.owner.kind === 'output'))
      this.startWork(p, hit.owner.machineId, hit);
  }

  /** Walks `p` up to the machine they clicked at `hit`, to work it (see `Player.work`). */
  private startWork(p: Player, machineId: number, hit: AimHit): void {
    const at = p.body.translation();
    // Out from the face they clicked; off a top, back the way they came.
    let out = v3(hit.normal.x, 0, hit.normal.z);
    if (length(out) < 0.3) out = v3(at.x - hit.point.x, 0, at.z - hit.point.z);
    out = length(out) > 1e-6 ? scale(out, 1 / length(out)) : v3(0, 0, 1);
    const spot = add(v3(hit.point.x, at.y, hit.point.z), scale(out, WORK_STANDOFF));
    p.work = {
      n: ++p.works,
      machineId,
      spot,
      hand: hit.point,
      there: false,
      walk: WORK_WALK_TICKS,
      ticks: WORK_TICKS,
    };
  }

  private doAct(p: Player, action: Action): void {
    switch (action.kind) {
      case 'grab':
        return this.grab(p, action.output === true);
      case 'suck':
        return p.handsOff || this.vacuum.heldBy !== p.id ? undefined : this.suck(p, true);
      case 'pull':
        return p.handsOff ? undefined : this.pull(p);
      case 'place':
        return p.handsOff ? undefined : this.place(p, action.output === true);
      case 'drop':
      case 'throw':
        if (this.vacuum.heldBy === p.id) return this.putVacuumDown(p);
        if (p.tool) return this.putToolAway(p);
        return action.kind === 'drop' ? this.setDown(p) : this.throwHeld(p);
      case 'rotate':
        if (!p.holding) return;
        if (action.step === 'quarter') p.holding.rot = ((p.holding.rot + 1) % 4) as Rotation;
        else if (action.step === 'eighth') p.holding.eighth = !p.holding.eighth;
        // A part in hand that would hang on one stud alone turns 45° a step, else a quarter.
        else if (!p.holding.eighth && this.snap(p, { eighth: true })?.preview.turned45)
          p.holding.eighth = true;
        else {
          p.holding.eighth = false;
          p.holding.rot = ((p.holding.rot + 1) % 4) as Rotation;
        }
        return;
      case 'flip': {
        const held = this.heldAssembly(p);
        if (p.holding && held && isLooseBrick(held)) {
          const [b] = held.grid.bricks.values();
          if (canFlip(b!.type)) p.holding.flip = !p.holding.flip;
        }
        return;
      }
      case 'dropPage':
        return this.dropPage(p);
      case 'unequip':
        return this.dropGear(p, action.gear);
      case 'fill':
        return p.handsOff ? undefined : this.fillBucket(p, action.colour);
      case 'mould':
        return p.handsOff ? undefined : this.dispenseMould(p, action.type);
      case 'print':
        return p.handsOff ? undefined : this.printPart(p, action.job);
      case 'sabotage':
        return;
    }
  }

  private hold(p: Player, a: Assembly): void {
    const com = a.body.worldCom();
    p.holding = {
      assemblyId: a.id,
      rot: 0,
      yawOffset: yawOf(a.body.rotation()) - p.input.yaw,
      last: null,
      settingDown: null,
    };
    this.setHeld(a, p.id);
    this.events.push({ kind: 'grab', pos: com, count: a.grid.bricks.size });
  }

  /** Pages and buttons work whether or not the player has their hands full. */
  private interact(p: Player, hit: AimHit | null): boolean {
    // The other team's side: look, but do not touch.
    if (hit && !this.mayUse(p, hit.point)) return true;
    if (hit?.owner.kind === 'page') {
      const page = this.pages.get(hit.owner.pageId);
      if (page) this.takePage(p, page);
      return true;
    }
    if (hit?.owner.kind === 'button') {
      this.events.push({
        kind: 'button',
        pos: hit.point,
        buttonId: hit.owner.buttonId,
        playerId: p.id,
        site: hit.owner.site,
      });
      return true;
    }
    if (hit?.owner.kind === 'hideout') {
      this.toggleHideout(hit.owner.hideoutId, p.id);
      return true;
    }
    if (hit?.owner.kind === 'gadget') {
      const g = this.gadgets.get(hit.owner.gadgetId);
      if (g) this.setUsed(g, !g.used);
      return true;
    }
    if (hit?.owner.kind === 'player') {
      this.pickpocket(p, hit.owner.playerId);
      return true;
    }
    if (hit?.owner.kind === 'gear') {
      const item = this.gear.get(hit.owner.gearId);
      if (item) this.takeGear(p, item);
      return true;
    }
    if (hit?.owner.kind === 'dog') {
      if (p.gear.has('leash') && !this.dog.leashed) this.leashDog(p);
      else this.dog.clicked(p);
      return true;
    }
    if (hit?.owner.kind === 'treats') {
      if (!p.treat) {
        p.treat = true;
        this.events.push({ kind: 'treat', pos: hit.point, playerId: p.id });
      }
      return true;
    }
    if (hit?.owner.kind === 'board') {
      if (p.page !== null) this.pinPocketPage(p, hit.owner.board, hit.point);
      return true;
    }
    if (hit?.owner.kind === 'panel') {
      const power = this.power;
      // A panel dead for the round cannot be fixed: in a gear hunt the headlamp is the answer.
      if (power.dead) return true;
      if (!power.on && power.fixer === null) {
        power.fixer = p.id;
        power.progress = 0;
        this.furnitureVersion++;
        this.events.push({ kind: 'fixing', pos: hit.point, playerId: p.id });
      }
      return true;
    }
    if (hit?.owner.kind === 'vacuum') {
      if (!p.holding && !p.tool && !p.handsOff && this.vacuum.heldBy === null) this.takeVacuum(p);
      return true;
    }
    if (hit?.owner.kind === 'trashBin') {
      // What is in hand goes in the bin, or what is in the vacuum; with nothing in hand a click
      // on a bin does nothing.
      const held = this.heldAssembly(p);
      if (held && !this.isBuild(held.id)) this.throwAway(held, hit.owner.bin, p.id);
      else if (this.vacuum.heldBy === p.id) this.emptyVacuum(hit.owner.bin, p.id);
      return true;
    }
    return false;
  }

  /** The electrical panel breaks down: the lights stay out until someone fixes it. */
  breakPower(): void {
    if (!this.power.on || !this.panel) return;
    Object.assign(this.power, { on: false, fixer: null, progress: 0 });
    this.furnitureVersion++;
    this.events.push({ kind: 'powerOut', pos: this.panel });
  }

  /**
   * The panel dies for the round (a gear hunt): the lights go out for good, and the brick
   * works run on a circuit of their own.
   */
  killPower(): void {
    if (this.power.dead) return;
    this.power.dead = true;
    this.furnitureVersion++;
    this.breakPower();
  }

  /** The power comes back without anyone fixing the panel. */
  restorePower(): void {
    if (this.power.on || !this.panel) return;
    Object.assign(this.power, { on: true, fixer: null, progress: 0 });
    this.furnitureVersion++;
    this.events.push({ kind: 'powerOn', pos: this.panel });
  }

  /**
   * Whether the brick works' machines have power: they stop while the panel is out, but run on
   * a circuit of their own while it is dead for the round (`PowerState.dead`).
   */
  get machinesPowered(): boolean {
    return this.power.on || this.power.dead;
  }

  /** Whoever is fixing the panel gets on with it, as long as they stay there on their feet. */
  private updatePower(): void {
    const power = this.power;
    if (power.fixer === null || !this.panel) return;
    const p = this.players.get(power.fixer);
    if (!p || p.down > 0 || length(sub(this.eye(p), this.panel)) > REACH + 0.4) {
      power.fixer = null;
      power.progress = 0;
      this.furnitureVersion++;
      return;
    }
    power.progress += DT / REPAIR_SECONDS;
    if (power.progress < 1) return;
    Object.assign(power, { on: true, fixer: null, progress: 0 });
    this.furnitureVersion++;
    this.events.push({ kind: 'powerOn', pos: this.panel, playerId: p.id });
  }

  /** Whoever is clearing a jammed machine gets on with it, as long as they stay there on their feet. */
  private updateJams(): void {
    for (const m of this.machines.values()) {
      if (m.fixer === null) continue;
      const p = this.players.get(m.fixer);
      if (!p || p.down > 0 || !this.nearMachine(p, m)) {
        Object.assign(m, { fixer: null, progress: 0 });
        this.furnitureVersion++;
        continue;
      }
      m.progress += DT / UNJAM_SECONDS;
      if (m.progress < 1) continue;
      Object.assign(m, { jammed: false, fixer: null, progress: 0 });
      this.furnitureVersion++;
      const pos = machinePose(m.def).centre;
      this.events.push({ kind: 'unjammed', pos, playerId: p.id, machineId: m.def.id });
    }
  }

  /** Whether a player's eye is within reach of a machine's sides. */
  private nearMachine(p: Player, m: MachineState): boolean {
    const { centre, half } = machinePose(m.def);
    const d = sub(this.eye(p), centre);
    // The pose's box is turned with the machine; its longer side is a fair bound either way.
    const side = Math.max(half.x, half.z);
    return Math.hypot(d.x, d.z) <= REACH + side + 0.4;
  }

  /** A click with the hands free (or a tool in them); `output` as in `Action`. */
  private grab(p: Player, output = false): void {
    const hit = this.aim(p);
    if (this.interact(p, hit)) return;
    if (p.handsOff) return;
    if (this.vacuum.heldBy === p.id) return this.suck(p);
    if (!hit || !this.mayUse(p, hit.point)) return;
    if (hit.owner.kind === 'machine') {
      return output ? undefined : this.useMachine(p, hit.owner.machineId);
    }
    if (hit.owner.kind === 'output') return this.takeOut(p, hit.owner.machineId, hit.owner.slot);
    if (p.holding || p.tool) return;
    if (hit.owner.kind !== 'brick') return;
    const a = this.assemblies.get(hit.owner.assemblyId);
    if (!a) return;
    if (a.heldBy !== null) return this.tug(p, a);
    if (a.frozen) return;
    if (a.anchored) {
      // Grabbing the baseplate itself lifts the whole build off the job site (to carry it to
      // the inspector). Grabbing any other brick of it takes just that brick.
      const brick = a.grid.bricks.get(hit.owner.brickId)!;
      if (!BRICK_TYPES[brick.type].fixture) return this.pull(p);
    }
    if (this.tooTiredFor(p, a, hit.point)) return;
    if (a.anchored) {
      // A gear hunt's build is heavy: without the back brace it only lifts for someone walking
      // carefully (and they keep to that pace with it, see `movePlayer`).
      if (this.heavyFor(p) && !p.input.careful) {
        this.events.push({ kind: 'heavy', pos: hit.point, playerId: p.id });
        return;
      }
      this.setAnchored(a, false);
    }
    this.liftJolt(a, hit.owner.brickId);
    this.hold(p, a);
  }

  /**
   * A click on a build someone else carries: enough of them in quick succession pull it out of
   * their hands and into the tugger's. Everyone nearby sees and hears the struggle.
   */
  private tug(p: Player, a: Assembly): void {
    const holder = a.heldBy === null ? undefined : this.players.get(a.heldBy);
    if (!holder || holder.id === p.id || isLooseBrick(a)) return;
    const at = a.body.worldCom();
    if (this.tooTiredFor(p, a, at)) return;
    if (!this.tugged(this.buildTugs, a.id, p, holder)) {
      this.events.push({ kind: 'tug', pos: at, playerId: p.id, fromId: holder.id });
      return;
    }
    this.release(holder);
    this.hold(p, a);
    this.events.push({ kind: 'tugged', pos: at, playerId: p.id, fromId: holder.id });
  }

  /**
   * A click on another player: enough of them in quick succession pick the page out of their
   * pocket and into the picker's (whose own page, if any, drops). Everyone nearby sees it.
   */
  private pickpocket(p: Player, victimId: number): void {
    const victim = this.players.get(victimId);
    if (!victim || victim.id === p.id || victim.page === null) return;
    const page = this.pages.get(victim.page);
    if (!page) return;
    const at = this.eye(victim);
    if (!this.tugged(this.pocketTugs, victim.id, p, victim)) {
      this.events.push({ kind: 'pick', pos: at, playerId: p.id, fromId: victim.id });
      return;
    }
    if (p.page !== null) this.dropPage(p);
    victim.page = null;
    page.carriedBy = p.id;
    page.version++;
    p.page = page.id;
    this.events.push({ kind: 'picked', pos: at, playerId: p.id, fromId: victim.id });
  }

  /**
   * Counts one click of a tug at `key` of `tugs` (a build, or a player's pocket) by `p` against
   * `from`: true once there have been `TUG_CLICKS` of them, each soon enough after the one
   * before.
   */
  private tugged(tugs: Map<number, Tug>, key: number, p: Player, from: Player): boolean {
    const t = tugs.get(key);
    const clicks =
      t && t.by === p.id && t.from === from.id && this.tick - t.tick <= TUG_GAP_TICKS
        ? t.clicks + 1
        : 1;
    if (clicks < TUG_CLICKS) {
      tugs.set(key, { by: p.id, from: from.id, clicks, tick: this.tick });
      return false;
    }
    tugs.delete(key);
    return true;
  }

  /** Too tired to lift build `a` (a single brick is never too much): says so, and is true. */
  private tooTiredFor(p: Player, a: Assembly, at: Vec3): boolean {
    if (isLooseBrick(a) || p.fatigue < TIRED_TICKS) return false;
    this.events.push({ kind: 'tired', pos: at, playerId: p.id });
    return true;
  }

  /** Carry fatigue builds while carrying a build and wears off otherwise; at its limit, they set it down. */
  private tire(p: Player): void {
    const held = this.heldAssembly(p);
    if (!held || isLooseBrick(held)) {
      p.fatigue = Math.max(0, p.fatigue - 1);
      return;
    }
    p.fatigue++;
    if (this.replica || p.fatigue < TIRED_DROP_TICKS || p.holding?.settingDown != null) return;
    this.setDown(p);
    this.events.push({ kind: 'tired', pos: held.body.worldCom(), playerId: p.id });
  }

  /**
   * Picking a build up (by part `by`) jolts it: whatever holds on too weakly for even that (a
   * tall tower of round 1x1 bricks on one stud) comes off and topples over where it stood.
   */
  private liftJolt(a: Assembly, by: number): void {
    if (this.replica || a.grid.size < 2) return;
    const pieces = this.resplit(a, planBreaks(a.grid, LIFT_SEVERITY, this.rng, by), by);
    for (const piece of pieces) {
      const tip = this.rng() * 2 * Math.PI;
      piece.body.setAngvel(v3(Math.cos(tip) * 1.5, 0, Math.sin(tip) * 1.5), true);
    }
    if (pieces.length)
      this.events.push({ kind: 'break', pos: a.body.worldCom(), count: pieces.length });
  }

  /** Whether the build is too heavy for this player to carry at more than a careful pace. */
  heavyFor(p: Player): boolean {
    return this.hazards.has('brace') && !p.gear.has('brace');
  }

  private setAnchored(a: Assembly, anchored: boolean): void {
    const { RigidBodyType } = this.R;
    a.anchored = anchored;
    a.body.setBodyType(anchored ? RigidBodyType.Fixed : RigidBodyType.Dynamic, true);
    a.body.enableCcd(!anchored);
    a.bornTick = this.tick;
  }

  /**
   * Demo mode: makes the team's build exactly `target`, whatever was on it before. The
   * baseplate stays where it is (at home, carried or lying about).
   */
  finishBuild(target: TargetBuild, site = 0): void {
    const a = this.build(site);
    for (const b of [...a.grid.bricks.values()]) {
      if (BRICK_TYPES[b.type].fixture) continue;
      a.grid.remove(b.id);
      this.removeCollider(a, b.id);
    }
    this.addBricks(
      a,
      target.steps.flatMap((s) => s.bricks),
    );
    a.body.wakeUp();
  }

  /**
   * Demo mode: takes every loose brick and piece off the map, held ones too, leaving only the
   * teams' builds. Returns how many bricks were cleared.
   */
  clearLoose(): number {
    let cleared = 0;
    for (const a of [...this.assemblies.values()]) {
      if (this.isBuild(a.id)) continue;
      cleared += a.grid.size;
      this.removeAssembly(a);
    }
    return cleared;
  }

  /** Where a job site's baseplate centre sits when its build is at home. */
  private homeCentre(site: number): Vec3 {
    const b = this.sites[site]!.baseplate;
    return v3(b.x + BASEPLATE_SIZE / 2, b.y + PLATE_H / 2, b.z + BASEPLATE_SIZE / 2);
  }

  /** A team's build (the assembly holding its baseplate): the first site's by default. */
  build(site = 0): Assembly {
    return this.assemblies.get(this.buildIds[site]!)!;
  }

  /** Baseplate centre of a build (the first site's by default), wherever it is. */
  buildCentre(a: Assembly = this.build()): Vec3 {
    const plate = [...a.grid.bricks.values()].find((b) => BRICK_TYPES[b.type].fixture)!;
    return this.brickPose(a, plate).pos;
  }

  /** Puts builds set down at their job sites back in their fixed places, squared to the grid. */
  private reanchorBuild(): void {
    for (let site = 0; site < this.sites.length; site++) this.reanchorSite(site);
  }

  private reanchorSite(site: number): void {
    const a = this.build(site);
    if (a.anchored || a.heldBy !== null || this.tick - a.bornTick < BREAK_GRACE_TICKS) return;
    const home = this.homeCentre(site);
    const centre = this.buildCentre(a);
    const rot = a.body.rotation();
    if (Math.hypot(centre.x - home.x, centre.z - home.z) > 0.6) return;
    if (Math.abs(centre.y - home.y) > 0.15 || rotate(rot, v3(0, 1, 0)).y < 0.97) return;
    if (length(a.body.linvel()) > 0.2) return;
    const yaw = Math.round(yawOf(rot) / QUARTER) * QUARTER;
    const newRot = yawQuat(yaw);
    const plate = [...a.grid.bricks.values()].find((b) => BRICK_TYPES[b.type].fixture)!;
    this.setAnchored(a, true);
    a.body.setRotation(newRot, true);
    a.body.setTranslation(sub(home, rotate(newRot, localCentre(plate))), true);
    this.events.push({ kind: 'anchor', pos: home, count: a.grid.bricks.size });
  }

  // ---------------------------------------------------------------- the brick works

  /** Puts a fresh part in the player's hands, as if they had just taken it. */
  private handPart(p: Player, part: MachinePart): void {
    const h: Holding = { assemblyId: 0, rot: 0, yawOffset: 0, last: null, settingDown: null };
    const target = this.holdTarget(p, h, null);
    const a = this.spawnBrick(
      part.type,
      part.colour,
      target.pos,
      target.rot,
      undefined,
      undefined,
      part.prints,
    );
    this.hold(p, a);
    this.tidyLooseBricks();
  }

  /**
   * Sets a machine making something, done in `ticks` (as long as it shows making it), for the
   * first free place in its output area. It makes one thing at a time, and nothing while its
   * output area is full. Returns the place, or -1 if it cannot make it now.
   */
  private startMaking(m: MachineState, made: Made, ticks: number): number {
    const slot = m.out.indexOf(null);
    if (m.making || slot < 0) return -1;
    m.making = { made, slot, at: this.tick + ticks };
    this.furnitureVersion++;
    return slot;
  }

  /** Puts what the machines have finished making in their output areas, to take from there. */
  private updateMaking(): void {
    for (const m of this.machines.values()) {
      const job = m.making;
      if (!job || this.tick < job.at) continue;
      m.making = null;
      this.setOut(m, job.slot, job.made);
      this.events.push({
        kind: 'ready',
        pos: machineOutputs(m.def)[job.slot]!.rest,
        machineId: m.def.id,
        slot: job.slot,
        ...madeFields(job.made),
      });
    }
  }

  /** Puts something in a place in a machine's output area, or empties it (null). */
  private setOut(m: MachineState, slot: number, made: Made | null): void {
    m.out[slot] = made;
    this.outputColliders.get(m.def.id)?.[slot]?.setEnabled(made !== null);
    this.furnitureVersion++;
  }

  /**
   * Takes what lies in a place in a machine's output area, whoever had the machine make it: a
   * part with the hands free, a mould or a bucket with nothing in them but a mould or a bucket
   * of the same kind, which it takes the place of.
   */
  private takeOut(p: Player, machineId: number, slot: number): void {
    const m = this.machines.get(machineId);
    const made = m?.out[slot];
    if (!m || !made || p.holding || this.vacuum.heldBy === p.id) return;
    if (made.kind === 'part') {
      if (p.tool) return;
      this.setOut(m, slot, null);
      this.handPart(p, { type: made.type, colour: made.colour });
      return;
    }
    if (p.tool && p.tool.kind !== made.kind) return;
    this.setOut(m, slot, null);
    this.setTool(p, made);
    this.events.push({
      kind: 'toolUp',
      pos: machineOutputs(m.def)[slot]!.rest,
      playerId: p.id,
      machineId,
      slot,
      ...madeFields(made),
    });
  }

  private setTool(p: Player, tool: Tool | null): void {
    p.tool = tool;
    this.furnitureVersion++;
  }

  /**
   * At the mould dispenser: has it drop the mould for a part (it has one for every part there
   * is) into its hatch, for whoever wants it to take from there.
   */
  private dispenseMould(p: Player, type: BrickTypeId): void {
    if (typeof type !== 'string' || !MOULD_TYPES.includes(type)) return;
    const dispenser = this.aimedMachine(p, 'dispenser');
    if (!dispenser || !this.machinesPowered) return;
    const slot = this.startMaking(dispenser, { kind: 'mould', type }, MAKE_TICKS.mould);
    if (slot < 0) return;
    this.events.push({
      kind: 'dispense',
      pos: machinePose(dispenser.def).centre,
      playerId: p.id,
      machineId: dispenser.def.id,
      slot,
      mould: type,
    });
  }

  /** Puts the mould or bucket in the player's hands away. */
  private putToolAway(p: Player): void {
    if (!p.tool) return;
    this.setTool(p, null);
    this.events.push({ kind: 'toolDown', pos: this.eye(p), playerId: p.id });
  }

  /**
   * A click on a machine. A moulding machine takes the mould or the pellets in the player's
   * hands, or otherwise, if it has a mould and pellets, makes a part and drops it in the tray
   * in its output area. The UV printer takes the loose part in their hands onto its bed, or
   * gives back the part on it. The mould dispenser takes back the mould in their hands. The
   * silo fills buckets only through `fillBucket` once a colour is picked, and the dispenser
   * hands out moulds only through `dispenseMould` once a part is picked; what the machines
   * make waits in their output areas for someone to take it (`takeOut`).
   */
  private useMachine(p: Player, machineId: number): void {
    const m = this.machines.get(machineId);
    if (!m || this.vacuum.heldBy === p.id) return;
    const at = machinePose(m.def).centre;
    const event = (
      kind: SimEvent['kind'],
      what: { mould?: BrickTypeId; colour?: ColourId; slot?: number } = {},
    ): void => {
      this.events.push({ kind, pos: at, playerId: p.id, machineId, ...what });
    };
    // A jammed machine takes nothing and makes nothing: a click sets about clearing the jam.
    if (m.jammed) {
      if (m.fixer !== null) return;
      Object.assign(m, { fixer: p.id, progress: 0 });
      this.furnitureVersion++;
      return event('fixing');
    }
    if (m.def.kind === 'press') {
      if (p.tool?.kind === 'mould') {
        m.mould = p.tool.type;
        this.setTool(p, null);
        return event('mouldIn', { mould: m.mould });
      }
      if (p.tool?.kind === 'bucket') {
        m.colour = p.tool.colour;
        m.shots = BUCKET_SHOTS;
        this.setTool(p, null);
        return event('pour', { colour: m.colour });
      }
      if (!m.mould || !m.colour || m.shots <= 0 || !this.machinesPowered) return;
      const made = { kind: 'part' as const, type: m.mould, colour: m.colour };
      const slot = this.startMaking(m, made, MAKE_TICKS.part);
      if (slot < 0) return;
      m.shots--;
      if (m.shots === 0) m.colour = null;
      return event('moulded', { mould: made.type, colour: made.colour, slot });
    }
    if (m.def.kind === 'dispenser') {
      if (p.tool?.kind !== 'mould') return;
      this.setTool(p, null);
      return event('toolDown');
    }
    if (m.def.kind === 'printer') {
      if (p.tool) return;
      const held = this.heldAssembly(p);
      if (held) {
        if (m.part || !isLooseBrick(held)) return;
        const b = held.grid.bricks.values().next().value!;
        m.part = { type: b.type, colour: b.colour, ...(b.prints ? { prints: b.prints } : {}) };
        this.removeAssembly(held);
        this.furnitureVersion++;
        return event('printerIn');
      }
      // Without a print picked, the part comes back out as it went in.
      this.printPart(p, -1);
    }
  }

  /** The machine the player aims at, if it is one of this kind they may use. */
  private aimedMachine(p: Player, kind: MachineDef['kind']): MachineState | null {
    const hit = this.aim(p);
    if (hit?.owner.kind !== 'machine' || !this.mayUse(p, hit.point)) return null;
    const m = this.machines.get(hit.owner.machineId);
    return m?.def.kind === kind && !m.jammed ? m : null;
  }

  /**
   * At the silo: has it fill a bucket with pellets of this colour on the grate under its tap,
   * for whoever wants it to take from there.
   */
  private fillBucket(p: Player, colour: ColourId): void {
    if (typeof colour !== 'string' || !makeableColours().includes(colour)) return;
    const silo = this.aimedMachine(p, 'silo');
    if (!silo || !this.machinesPowered) return;
    const slot = this.startMaking(silo, { kind: 'bucket', colour }, MAKE_TICKS.bucket);
    if (slot < 0) return;
    this.events.push({
      kind: 'fill',
      pos: machinePose(silo.def).centre,
      playerId: p.id,
      machineId: silo.def.id,
      slot,
      colour,
    });
  }

  /**
   * At the UV printer, with empty hands: prints print job `job` on the part on its bed (only
   * one for a part of its type) and hands it over; -1 hands it over as it is.
   */
  private printPart(p: Player, job: number): void {
    if (!Number.isInteger(job) || job < -1 || job >= this.printJobs.length) return;
    if (p.holding || p.tool || this.vacuum.heldBy === p.id) return;
    const printer = this.aimedMachine(p, 'printer');
    const part = printer?.part;
    if (!printer || !part) return;
    const print = job >= 0 ? this.printJobs[job]! : null;
    // Without power the part still comes out, but nothing is printed on it.
    if (print && (print.type !== part.type || !this.machinesPowered)) return;
    printer.part = null;
    this.furnitureVersion++;
    this.handPart(p, print ? { ...part, prints: print.prints } : part);
    if (print) {
      this.events.push({
        kind: 'print',
        pos: machinePose(printer.def).centre,
        playerId: p.id,
        machineId: printer.def.id,
      });
    }
  }

  // ---------------------------------------------------------------- rubbish bins

  /** Throws a loose brick or piece away in rubbish bin `bin`: it is gone for good. */
  private throwAway(a: Assembly, bin: number, playerId?: number): void {
    const m = this.trashBins[bin]!;
    // Its colour (its first brick's), for the bin to show it going in.
    const first = a.grid.bricks.values().next().value;
    this.events.push({
      kind: 'binned',
      pos: v3((m.x0 + m.x1) / 2, m.y, (m.z0 + m.z1) / 2),
      count: a.grid.size,
      ...(first ? { colour: first.colour } : {}),
      ...(playerId !== undefined ? { playerId } : {}),
    });
    this.removeAssembly(a);
  }

  /**
   * A loose piece nobody holds that has dropped or been thrown into a bin's open top (its
   * centre over the opening, at the rim or just above it) goes in.
   */
  private binIfIn(a: Assembly): void {
    if (a.heldBy !== null || a.anchored || a.frozen || a.body.isSleeping()) return;
    const c = a.body.worldCom();
    const bin = this.trashBins.findIndex(
      (m) =>
        c.x > m.x0 &&
        c.x < m.x1 &&
        c.z > m.z0 &&
        c.z < m.z1 &&
        c.y > m.y - BIN_DEPTH &&
        c.y < m.y + BIN_CATCH,
    );
    if (bin >= 0) this.throwAway(a, bin);
  }

  /** Removes the longest-lying loose bricks while there are more than `MAX_LOOSE_BRICKS`. */
  private tidyLooseBricks(): void {
    const lying = [...this.assemblies.values()].filter((a) => isLooseBrick(a) && a.heldBy === null);
    // The map keeps insertion order, so the first ones have lain there longest.
    for (const a of lying.slice(0, Math.max(0, lying.length - this.looseLimit))) {
      this.removeAssembly(a);
    }
  }

  // ---------------------------------------------------------------- hiding places

  /** Opens a hiding place (whatever is inside comes out) or shuts it again. */
  toggleHideout(id: number, playerId?: number): void {
    const h = this.hideouts.get(id);
    if (!h) return;
    if (h.locked) {
      // A padlock rattles for everyone but the key ring's wearer, for whom it comes off.
      const p = playerId === undefined ? undefined : this.players.get(playerId);
      if (!p?.gear.has('keys')) {
        this.events.push({ kind: 'locked', pos: h.def.pos, playerId });
        return;
      }
      h.locked = false;
      this.furnitureVersion++;
      this.events.push({ kind: 'unlock', pos: h.def.pos, playerId });
    }
    this.setOpen(h, !h.open);
    this.events.push({
      kind: h.open ? 'open' : 'close',
      pos: h.def.pos,
      hideoutId: h.def.id,
      playerId,
    });
    if (!h.open) return;
    const drop = dropSpot(this.level, h.def);
    h.contents.forEach((pageId, i) => {
      const page = this.pages.get(pageId);
      if (!page) return;
      page.hidden = false;
      page.hideout = null;
      const at = add(drop, v3((i % 2) * 0.12, i * 0.02, 0));
      this.placePage(page, restingOn(at, PAGE_SIZE), yawQuat(h.def.facing));
      page.version++;
    });
    h.contents = [];
    h.gear.forEach((gearId, i) => {
      const item = this.gear.get(gearId);
      if (!item) return;
      item.hidden = false;
      item.hideout = null;
      const at = add(drop, v3(-0.1 - i * 0.15, 0.1, 0));
      this.placeGear(item, restingOn(at, GEAR_SIZE), yawQuat(h.def.facing));
      item.version++;
    });
    h.gear = [];
  }

  /** Padlocks a hiding place (Gear Hunt), until someone with the key ring opens it. */
  lockHideout(id: number): void {
    const h = this.hideouts.get(id);
    if (!h || h.locked) return;
    h.locked = true;
    this.furnitureVersion++;
  }

  /** Tucks a piece of gear into a hiding place and shuts it. */
  hideGearInHideout(item: GearItem, id: number): void {
    const h = this.hideouts.get(id);
    if (!h) return;
    this.detachGear(item);
    item.hidden = true;
    item.hideout = id;
    item.version++;
    h.gear.push(item.id);
    if (h.open) this.setOpen(h, false);
  }

  /** Tucks a page into a hiding place and shuts it, out of everyone's sight. */
  hideInHideout(page: PageItem, id: number): void {
    const h = this.hideouts.get(id);
    if (!h) return;
    this.detachPage(page);
    page.hidden = true;
    page.hideout = id;
    page.version++;
    h.contents.push(page.id);
    if (h.open) this.setOpen(h, false);
  }

  /** Clicks a gadget (or unclicks it): its handles' click boxes go where they are for that. */
  private setUsed(g: GadgetState, used: boolean): void {
    if (g.used === used) return;
    g.used = used;
    g.def.handles.forEach(({ box, used: moved }, i) => {
      const { pos, size } = used ? moved : box;
      const c = g.handles[i]!;
      c.setHalfExtents(scale(size, 0.5));
      c.setTranslationWrtParent(pos);
    });
    this.furnitureVersion++;
  }

  /** Moves the door (drawer, lid…) and makes only it clickable once open. */
  private setOpen(h: HideoutState, open: boolean): void {
    h.open = open;
    const pose = hideoutPartInWorld(h.def, open, h.opening);
    h.part.setHalfExtents(pose.half);
    h.part.setTranslationWrtParent(pose.centre);
    h.part.setRotationWrtParent(pose.rot);
    // An open door can be walked through, and pages fall past it.
    h.part.setSensor(open);
    const target: ColliderOwner = { kind: 'hideout', hideoutId: h.def.id };
    this.owners.set(h.part.handle, target);
    if (h.body) this.owners.set(h.body.handle, open ? { kind: 'static' } : target);
    this.furnitureVersion++;
  }

  // ---------------------------------------------------------------- corkboard

  /**
   * Where a page pinned to `slot` hangs: two rows of four on each face of a board, the front
   * (the side its `facing` looks toward) first, board after board.
   */
  slotPose(slot: number): { pos: Vec3; rot: Quat } {
    const b = this.boards[Math.floor(slot / BOARD_SLOTS)]!;
    const face = Math.floor(slot / BOARD_FACE_SLOTS) % 2;
    // Turned around for the back face, so that face is laid out just like the front.
    const rot = mulQuat(yawQuat(b.facing), yawQuat(face * Math.PI));
    const col = slot % 4;
    const row = Math.floor((slot % BOARD_FACE_SLOTS) / 4);
    const local = v3((col - 1.5) * 0.38, row === 0 ? 0.24 : -0.24, -(BOARD_SIZE.z / 2 + 0.01));
    // The page's printed face (+y) turned to face out of the board, with the top of the print
    // (the page's -z edge) up: turned end for end, then stood up.
    const standUp = { x: -Math.sin(Math.PI / 4), y: 0, z: 0, w: Math.cos(Math.PI / 4) };
    const faceOut = mulQuat(mulQuat(rot, standUp), yawQuat(Math.PI));
    return { pos: add(b.pos, rotate(rot, local)), rot: faceOut };
  }

  /**
   * Pages the dog can jump up and take: those in the bottom row of either face (the top row is
   * out of its reach), with the spot on the floor in front of each where it stands to jump.
   */
  stealTargets(): StealTarget[] {
    const targets: StealTarget[] = [];
    for (const page of this.pages.values()) {
      const slot = page.pinned;
      if (slot === null || !page.body || slot % BOARD_FACE_SLOTS < 4) continue;
      const b = this.boards[Math.floor(slot / BOARD_SLOTS)]!;
      const face = Math.floor(slot / BOARD_FACE_SLOTS) % 2;
      const out = rotate(yawQuat(b.facing + face * Math.PI), v3(0, 0, -1));
      const at = this.slotPose(slot).pos;
      const stand = v3(at.x + out.x * 0.45, 0, at.z + out.z * 0.45);
      targets.push({ page, stand: this.aboveGround(stand, 0) });
    }
    return targets;
  }

  /** Which face of a board a point is on: 0 for the front, 1 for the back. */
  private boardFace(board: number, at: Vec3): number {
    const b = this.boards[board]!;
    const local = rotate(conj(yawQuat(b.facing)), sub(at, b.pos));
    return local.z < 0 ? 0 : 1;
  }

  /**
   * Pins the page in the player's pocket to the free slot closest to where they clicked, on the
   * board and face they clicked.
   */
  private pinPocketPage(p: Player, board: number, at: Vec3): void {
    const page = p.page === null ? undefined : this.pages.get(p.page);
    if (!page) return;
    const face = this.boardFace(board, at);
    const taken = new Set([...this.pages.values()].map((x) => x.pinned));
    const first = board * BOARD_SLOTS + face * BOARD_FACE_SLOTS;
    const free = Array.from({ length: BOARD_FACE_SLOTS }, (_, i) => first + i).filter(
      (i) => !taken.has(i),
    );
    if (!free.length) return;
    const slot = free.sort(
      (a, b) => length(sub(this.slotPose(a).pos, at)) - length(sub(this.slotPose(b).pos, at)),
    )[0]!;
    p.page = null;
    this.pinPage(page, slot);
    this.events.push({ kind: 'pin', pos: at, playerId: p.id });
  }

  /**
   * Demo mode: pins a page straight to a corkboard slot, wherever it is (lying about, in a
   * pocket or shut in a hiding place). Whatever already hangs in that slot is left where it is.
   */
  pinToBoard(page: PageItem, slot: number): void {
    if (slot < 0 || slot >= this.boards.length * BOARD_SLOTS) return;
    if (page.hideout !== null) {
      const h = this.hideouts.get(page.hideout);
      if (h) h.contents = h.contents.filter((id) => id !== page.id);
    }
    page.hidden = false;
    page.hideout = null;
    this.pinPage(page, slot);
  }

  private pinPage(page: PageItem, slot: number): void {
    this.detachPage(page);
    const { pos, rot } = this.slotPose(slot);
    const body = this.world.createRigidBody(
      this.R.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z).setRotation(rot),
    );
    const c = this.world.createCollider(
      this.R.ColliderDesc.cuboid(PAGE_SIZE.x / 2, PAGE_SIZE.y / 2, PAGE_SIZE.z / 2),
      body,
    );
    this.owners.set(c.handle, { kind: 'page', pageId: page.id });
    page.body = body;
    page.pinned = slot;
    page.version++;
  }

  /** Takes a page out of the world (or off the board) without putting it anywhere yet. */
  private detachPage(page: PageItem): void {
    if (page.body) {
      this.owners.delete(page.body.collider(0).handle);
      this.world.removeRigidBody(page.body);
      page.body = null;
    }
    if (page.carriedBy !== null) {
      const holder = this.players.get(page.carriedBy);
      if (holder?.page === page.id) holder.page = null;
    }
    page.carriedBy = null;
    page.pinned = null;
  }

  // ---------------------------------------------------------------- pages

  /** Puts a printed page (step -1 is the master index) into the world, lying at `pos`. */
  spawnPage(printed: PrintedPage | null, pos: Vec3, yaw = 0, id = this.newId()): PageItem {
    const page = this.newPage(printed, id);
    this.placePage(page, restingOn(pos, PAGE_SIZE), yawQuat(yaw));
    return page;
  }

  /** Puts a printed page straight into a hiding place, shut. */
  spawnPageInHideout(printed: PrintedPage | null, hideoutId: number): PageItem {
    const page = this.newPage(printed, this.newId());
    this.hideInHideout(page, hideoutId);
    return page;
  }

  /** A page that is nowhere yet. */
  private newPage(printed: PrintedPage | null, id: number): PageItem {
    const page: PageItem = {
      id,
      step: printed?.step ?? -1,
      printed,
      body: null,
      carriedBy: null,
      hidden: false,
      hideout: null,
      pinned: null,
      version: 0,
    };
    this.pages.set(page.id, page);
    return page;
  }

  /** Puts a page into the world with its middle at `centre`. */
  private placePage(page: PageItem, at: Vec3, rot: Quat, linvel: Vec3 = v3()): void {
    const { R } = this;
    const centre = this.aboveGround(at, PAGE_SIZE.y / 2 + 0.01, PAGE_SIZE.z / 2);
    const body = this.world.createRigidBody(
      (this.replica ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.dynamic())
        .setTranslation(centre.x, centre.y, centre.z)
        .setRotation(rot)
        .setLinvel(linvel.x, linvel.y, linvel.z)
        .setLinearDamping(1.5)
        .setAngularDamping(3),
    );
    const c = this.world.createCollider(
      R.ColliderDesc.cuboid(PAGE_SIZE.x / 2, PAGE_SIZE.y / 2, PAGE_SIZE.z / 2)
        .setDensity(60)
        .setFriction(1),
      body,
    );
    this.owners.set(c.handle, { kind: 'page', pageId: page.id });
    page.body = body;
    page.carriedBy = null;
    page.pinned = null;
  }

  private takePage(p: Player, page: PageItem): void {
    if (!page.body) return;
    if (p.page !== null) this.dropPage(p);
    const pos = page.body.translation();
    this.detachPage(page);
    page.carriedBy = p.id;
    page.version++;
    p.page = page.id;
    this.events.push({ kind: 'page', pos, playerId: p.id });
  }

  private dropPage(p: Player): void {
    const page = p.page === null ? undefined : this.pages.get(p.page);
    p.page = null;
    if (!page) return;
    const yaw = p.input.yaw;
    const f = v3(-Math.sin(yaw), 0, -Math.cos(yaw));
    // Let go of a little below the hands.
    const pos = add(this.eye(p), add(scale(f, 0.5), v3(0, -0.4, 0)));
    this.placePage(page, restingOn(pos, PAGE_SIZE), yawQuat(yaw), scale(f, 1));
    page.version++;
  }

  // ---------------------------------------------------------------- gear

  /** Puts a piece of gear into the world (Gear Hunt), lying at `pos`. */
  spawnGear(kind: GearId, pos: Vec3, yaw = 0, id = this.newId()): GearItem {
    const item = this.newGear(kind, id);
    this.placeGear(item, restingOn(pos, GEAR_SIZE), yawQuat(yaw));
    return item;
  }

  /** Puts a piece of gear straight into a hiding place, shut. */
  spawnGearInHideout(kind: GearId, hideoutId: number): GearItem {
    const item = this.newGear(kind, this.newId());
    this.hideGearInHideout(item, hideoutId);
    return item;
  }

  /** A piece of gear that is nowhere yet. */
  private newGear(kind: GearId, id: number): GearItem {
    const item: GearItem = {
      id,
      kind,
      body: null,
      wornBy: null,
      hidden: false,
      hideout: null,
      placed: false,
      version: 0,
    };
    this.gear.set(item.id, item);
    return item;
  }

  /** Puts a piece of gear into the world with its middle at `centre`. */
  private placeGear(item: GearItem, at: Vec3, rot: Quat, linvel: Vec3 = v3()): void {
    const { R } = this;
    const centre = this.aboveGround(at, GEAR_SIZE.y / 2 + 0.01, GEAR_SIZE.x / 2);
    const body = this.world.createRigidBody(
      (this.replica ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.dynamic())
        .setTranslation(centre.x, centre.y, centre.z)
        .setRotation(rot)
        .setLinvel(linvel.x, linvel.y, linvel.z)
        .setLinearDamping(1.5)
        .setAngularDamping(3),
    );
    const c = this.world.createCollider(
      R.ColliderDesc.cuboid(GEAR_SIZE.x / 2, GEAR_SIZE.y / 2, GEAR_SIZE.z / 2)
        .setDensity(120)
        .setFriction(1),
      body,
    );
    this.owners.set(c.handle, { kind: 'gear', gearId: item.id });
    item.body = body;
    item.wornBy = null;
    item.placed = false;
  }

  /** Takes a piece of gear out of the world, and off whoever wears it. */
  private detachGear(item: GearItem): void {
    if (item.body) {
      this.owners.delete(item.body.collider(0).handle);
      this.world.removeRigidBody(item.body);
      item.body = null;
    }
    if (item.wornBy !== null) this.players.get(item.wornBy)?.gear.delete(item.kind);
    item.wornBy = null;
    item.placed = false;
  }

  /** Picking gear up puts it on: it works at once, and shows on the builder. */
  private takeGear(p: Player, item: GearItem): void {
    if (!item.body || p.gear.has(item.kind)) return;
    const pos = item.body.translation();
    this.detachGear(item);
    item.wornBy = p.id;
    item.version++;
    p.gear.add(item.kind);
    this.events.push({ kind: 'gearOn', pos, playerId: p.id, gear: item.kind });
  }

  /** Takes a piece of gear off and drops it at the player's feet, for someone else. */
  dropGear(p: Player, kind: GearId): void {
    const item = [...this.gear.values()].find((g) => g.wornBy === p.id && g.kind === kind);
    if (!item) return;
    const yaw = p.input.yaw;
    const f = v3(-Math.sin(yaw), 0, -Math.cos(yaw));
    // Let go of a little below the hands.
    const pos = add(this.eye(p), add(scale(f, 0.5), v3(0, -0.5, 0)));
    this.detachGear(item);
    this.placeGear(item, restingOn(pos, GEAR_SIZE), yawQuat(yaw), scale(f, 0.8));
    item.version++;
    this.events.push({ kind: 'gearOff', pos, playerId: p.id, gear: kind });
  }

  /** Where the dog's pole stands: by its kennel, at its starting point. */
  dogPole(): Vec3 {
    return this.level.dog.points[this.level.dog.start]!;
  }

  /**
   * The leash's wearer clicked the dog: the leash goes on the pole with the dog at the end of
   * it, for the rest of the round. Returns false if the dog is leashed already.
   */
  leashDog(p: Player): boolean {
    const item = [...this.gear.values()].find((g) => g.wornBy === p.id && g.kind === 'leash');
    if (!item || this.dog.leashed) return false;
    this.detachGear(item);
    item.placed = true;
    item.version++;
    this.dog.leash(this.dogPole());
    this.events.push({ kind: 'leash', pos: this.dog.feet, playerId: p.id, gear: 'leash' });
    return true;
  }

  /**
   * Scatters a gear hunt's litter: small loose bricks around every dog point, which between
   * them cover every path through the yard and house. Returns how many were put down.
   */
  spawnLitter(perPoint: number, rng: () => number): number {
    const points = this.level.dog.points;
    let n = 0;
    for (const point of points) {
      for (let i = 0; i < perPoint; i++) {
        const type = LITTER_TYPES[Math.floor(rng() * LITTER_TYPES.length)]!;
        const colour = LITTER_COLOURS[Math.floor(rng() * LITTER_COLOURS.length)]!;
        const angle = rng() * Math.PI * 2;
        const out = 0.3 + rng() * LITTER_SPREAD;
        const at = add(point, v3(Math.cos(angle) * out, 0.12, Math.sin(angle) * out));
        this.spawnBrick(type, colour, at, yawQuat(rng() * Math.PI));
        n++;
      }
    }
    this.looseLimit = MAX_LOOSE_BRICKS + n;
    return n;
  }

  // ---------------------------------------------------------------- sabotage

  /**
   * Swaps the aimed brick for its look-alike colour, in place. Returns where it happened, or
   * null if there was nothing to swap.
   */
  swapBrick(p: Player): Vec3 | null {
    const hit = this.aim(p);
    if (hit?.owner.kind !== 'brick') return null;
    const a = this.assemblies.get(hit.owner.assemblyId);
    const b = a?.grid.bricks.get(hit.owner.brickId);
    if (!a || !b || BRICK_TYPES[b.type].fixture) return null;
    const near = COLOURS[b.colour].nearMiss[0];
    if (!near) return null;
    b.colour = near;
    a.version++;
    return hit.point;
  }

  /**
   * Tampers with the aimed machine (it jams until someone clears it) or the electrical panel
   * (the power goes out). Returns where it happened, or null if there was nothing to tamper with.
   */
  tamper(p: Player): Vec3 | null {
    const hit = this.aim(p);
    if (!hit || !this.mayUse(p, hit.point)) return null;
    if (hit.owner.kind === 'panel') {
      if (!this.power.on || this.power.dead) return null;
      this.breakPower();
      return hit.point;
    }
    if (hit.owner.kind !== 'machine') return null;
    const m = this.machines.get(hit.owner.machineId);
    if (!m || m.jammed) return null;
    Object.assign(m, { jammed: true, fixer: null, progress: 0 });
    this.furnitureVersion++;
    return hit.point;
  }

  /**
   * A machine breaks down by itself: it jams just as if a saboteur had tampered with it, but
   * with a clunk everyone close by hears. Returns false if it is jammed already.
   */
  breakMachine(id: number): boolean {
    const m = this.machines.get(id);
    if (!m || m.jammed) return false;
    Object.assign(m, { jammed: true, fixer: null, progress: 0 });
    this.furnitureVersion++;
    this.events.push({ kind: 'breakdown', pos: machinePose(m.def).centre, machineId: id });
    return true;
  }

  /** Replaces what is printed on the page in the player's pocket. */
  reprintPocketPage(p: Player, printed: PrintedPage): boolean {
    const page = p.page === null ? undefined : this.pages.get(p.page);
    if (!page || !page.printed) return false;
    page.printed = printed;
    page.version++;
    return true;
  }

  /** The hiding place the player aims at, if they have a page in their pocket to put in it. */
  hideoutForPocketPage(p: Player): number | null {
    if (p.page === null || !this.pages.has(p.page)) return null;
    const hit = this.aim(p);
    return hit?.owner.kind === 'hideout' ? hit.owner.hideoutId : null;
  }

  /**
   * Puts the page in the player's pocket into the hiding place they aim at and shuts it. Returns
   * where it happened, or null if they aim at no hiding place or have no page.
   */
  hidePocketPage(p: Player): Vec3 | null {
    const id = this.hideoutForPocketPage(p);
    const page = p.page === null ? undefined : this.pages.get(p.page);
    if (id === null || !page) return null;
    const h = this.hideouts.get(id)!;
    this.hideInHideout(page, id);
    this.events.push({ kind: 'close', pos: h.def.pos, hideoutId: id, playerId: p.id });
    return h.def.pos;
  }

  // ---------------------------------------------------------------- meetings

  /** Lets go of whatever the player holds (bricks fall, the pocketed page stays). */
  dropHeld(p: Player): void {
    this.release(p);
    this.putVacuumDown(p);
  }

  // ---------------------------------------------------------------- the vacuum

  /** Sets where the vacuum is, and puts its clickable shape there (none while carried). */
  private setVacuum(b: VacuumState): void {
    this.vacuum = b;
    this.poseVacuum();
  }

  /** Puts the vacuum's clickable shape where it rests, or takes it away while it is carried. */
  private poseVacuum(): void {
    const b = this.vacuum;
    this.vacuumCollider.setEnabled(b.heldBy === null);
    if (b.heldBy !== null) return;
    const { pos, rot } = vacuumRestPose(b);
    this.vacuumCollider.setTranslationWrtParent(pos);
    this.vacuumCollider.setRotationWrtParent(rot);
  }

  private takeVacuum(p: Player): void {
    const at = vacuumRestPose(this.vacuum).pos;
    this.setVacuum({ ...this.vacuum, heldBy: p.id });
    this.events.push({ kind: 'vacuumUp', pos: at, playerId: p.id });
  }

  /** Lays the vacuum on the floor in front of whoever carries it, if they do. */
  private putVacuumDown(p: Player): void {
    if (this.vacuum.heldBy !== p.id) return;
    const fwd = viewDir(p.input.yaw, 0);
    const centre = p.body.translation();
    const feet = v3(centre.x, centre.y - PLAYER_FEET, centre.z);
    // Head out in front, handle back toward the player's feet.
    const pos = this.onFloorAhead(feet, add(feet, scale(fwd, 0.9)));
    this.setVacuum({ ...this.vacuum, heldBy: null, pos, yaw: p.input.yaw, leaning: false });
    this.events.push({ kind: 'vacuumDown', pos, playerId: p.id });
  }

  /**
   * One pull of the vacuum: loose bricks and small loose pieces lying on the floor in a strip
   * in front of the player get sucked up, nearest first, as long as they fit in what room is
   * left. The team's build and anything held stay put. Full, it takes nothing more until it is
   * emptied into a rubbish bin. A `held` pull (the click kept down) says nothing when it is
   * full: the first pull already did.
   */
  private suck(p: Player, held = false): void {
    const v = this.vacuum;
    if (this.tick - v.sucked < SUCK_TICKS) return;
    v.sucked = this.tick;
    const head = this.vacuumHead(p);
    if (v.load >= VACUUM_CAPACITY) {
      if (!held) this.events.push({ kind: 'vacuumFull', pos: head, playerId: p.id });
      return;
    }
    const near: { a: Assembly; d: number }[] = [];
    for (const a of this.assemblies.values()) {
      if (a.anchored || a.frozen || a.heldBy !== null || this.isBuild(a.id)) continue;
      const t = a.body.worldCom();
      if (t.y > head.y + 0.3 || t.y < head.y - 0.2) continue;
      const d = Math.hypot(t.x - head.x, t.z - head.z);
      if (d <= SUCK_RADIUS) near.push({ a, d });
    }
    near.sort((x, y) => x.d - y.d);
    let count = 0;
    for (const { a } of near) {
      if (v.load + a.grid.size > VACUUM_CAPACITY) continue;
      v.load += a.grid.size;
      count += a.grid.size;
      this.removeAssembly(a);
    }
    this.events.push({ kind: 'suck', pos: head, playerId: p.id, count });
    if (count > 0 && v.load >= VACUUM_CAPACITY) {
      this.events.push({ kind: 'vacuumFull', pos: head, playerId: p.id });
    }
  }

  /**
   * Where the head of the vacuum a player carries rests: on the floor where their crosshair
   * meets it, kept within reach in front of them. Looking up or far off, it goes as far out as
   * it reaches.
   */
  vacuumHead(p: Player): Vec3 {
    const centre = p.body.translation();
    const feetY = centre.y - PLAYER_FEET;
    const fwd = viewDir(p.input.yaw, 0);
    const right = v3(-fwd.z, 0, fwd.x);
    const { origin, dir } = this.aimRay(p);
    let ahead = SUCK_REACH;
    let aside = 0;
    if (dir.y < -1e-3) {
      const t = (feetY - origin.y) / dir.y;
      const off = sub(add(origin, scale(dir, t)), centre);
      ahead = Math.min(SUCK_REACH, Math.max(SUCK_NEAR, off.x * fwd.x + off.z * fwd.z));
      aside = Math.min(SUCK_ASIDE, Math.max(-SUCK_ASIDE, off.x * right.x + off.z * right.z));
    }
    const feet = v3(centre.x, feetY, centre.z);
    return this.onFloorAhead(feet, add(feet, add(scale(fwd, ahead), scale(right, aside))));
  }

  /**
   * `at`, a little way ahead of someone standing at `feet`, brought down onto the floor there:
   * the floor they stand on, carried on level, except out on a map's terrain, where the ground
   * ahead may be higher or lower than under their feet.
   */
  private onFloorAhead(feet: Vec3, at: Vec3): Vec3 {
    if (!this.level.terrain?.length) return at;
    if (Math.abs(feet.y - groundHeight(this.level, feet.x, feet.z)) > 0.25) return at;
    return v3(at.x, groundHeight(this.level, at.x, at.z), at.z);
  }

  /** Empties the vacuum into rubbish bin `bin`: what it sucked up is gone for good. */
  private emptyVacuum(bin: number, playerId: number): void {
    const v = this.vacuum;
    if (v.load === 0) return;
    const m = this.trashBins[bin]!;
    this.events.push({
      kind: 'binned',
      pos: v3((m.x0 + m.x1) / 2, m.y, (m.z0 + m.z1) / 2),
      count: v.load,
      emptied: true,
      playerId,
    });
    v.load = 0;
  }

  // ---------------------------------------------------------------- the dog

  /** What the dog may do to the world: carry pages, and look around for walls. */
  private dogHost(): DogHost {
    return {
      R: this.R,
      world: this.world,
      players: this.players,
      pages: this.pages,
      emit: (e) => this.events.push(e),
      random: () => this.rng(),
      stealTargets: () => this.stealTargets(),
      mayWreck: () => this.dogMayWreck,
      wreckTarget: (from) => this.wreckTarget(from),
      wreck: (at) => this.dogWreck(at),
      pickPageUp: (page) => {
        this.detachPage(page);
        page.version++;
      },
      putPageDown: (page, pos, yaw) => {
        this.placePage(page, restingOn(pos, PAGE_SIZE), yawQuat(yaw));
        page.version++;
      },
      clearLine: (a, b, wide) => this.clearForDog(a, b, wide),
      floorUnder: (x, z, y) => (this.level.terrain?.length ? groundHeight(this.level, x, z) : y),
    };
  }

  /**
   * Whether nothing solid (walls, furniture, bins) lies between two points, for the dog; with
   * `wide`, across its whole width too, so a gap a thin line slips through but the dog does not,
   * a post it would walk into, or a corner it would brush, does not count as clear.
   */
  clearForDog(a: Vec3, b: Vec3, wide = false): boolean {
    if (!this.level.terrain?.length) return this.clearStraight(a, b, wide);
    // Over terrain, the line follows the ground at the height it starts and ends over it, in
    // short pieces, so a rise between the two points neither blocks it (the dog sees and walks
    // over a hump) nor lets it float over what stands in a hollow; and walking, the ground
    // must not be too steep for the dog anywhere on the way.
    const ga = groundHeight(this.level, a.x, a.z);
    const gb = groundHeight(this.level, b.x, b.z);
    const pieces = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / DOG_PIECE));
    let from = a;
    let groundFrom = ga;
    for (let i = 1; i <= pieces; i++) {
      const t = i / pieces;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const ground = groundHeight(this.level, x, z);
      const to = v3(x, ground + (a.y - ga) * (1 - t) + (b.y - gb) * t, z);
      const run = Math.hypot(x - from.x, z - from.z);
      if (wide && Math.abs(ground - groundFrom) > run * DOG_STEEPEST) return false;
      if (!this.clearStraight(from, to, wide)) return false;
      from = to;
      groundFrom = ground;
    }
    return true;
  }

  /** `clearForDog` along one straight line. */
  private clearStraight(a: Vec3, b: Vec3, wide: boolean): boolean {
    const d = sub(b, a);
    const dist = length(d);
    if (dist < 1e-3) return true;
    const dir = scale(d, 1 / dist);
    const flat = Math.hypot(dir.x, dir.z);
    // Walking, the job sites' builds are in the way too: it goes round them, not into them.
    const builds = wide
      ? new Set(
          this.sites
            .map((_, i) => this.build(i))
            .filter((a) => a.anchored)
            .map((a) => a.id),
        )
      : null;
    const solid = (c: Collider) => {
      const o = this.owners.get(c.handle);
      if (!o) return false;
      if (o.kind === 'brick') return builds?.has(o.assemblyId) ?? false;
      return DOG_SOLID.has(o.kind);
    };
    if (!wide || flat < 1e-3)
      return !this.world.castRay(
        new this.R.Ray(a, dir),
        dist,
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        solid,
      );
    // A thin plank as wide as the dog, square across the way it goes, swept along it: every
    // line its body would follow at once, at the height of the points.
    // Its long side (x) turned square across `dir`.
    const across = Math.atan2(dir.x, dir.z);
    return !this.world.castShape(
      a,
      yawQuat(across),
      dir,
      new this.R.Cuboid(DOG_RADIUS, DOG_PLANK, DOG_PLANK),
      0,
      dist,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      solid,
    );
  }

  /** A job-site build's bricks the dog could knock off, with where each one is. */
  private wreckableBricks(site: number): { id: number; pos: Vec3 }[] {
    const a = this.build(site);
    if (!a.anchored || a.heldBy !== null || a.frozen) return [];
    return [...a.grid.bricks.values()]
      .filter((b) => !BRICK_TYPES[b.type].fixture)
      .map((b) => ({ id: b.id, pos: this.brickPose(a, b).pos }))
      .filter((b) => b.pos.y < this.sites[site]!.baseplate.y + WRECK_HEIGHT);
  }

  /**
   * Where the hungry dog stands to wreck the build: just off one side of the baseplate, the side
   * with the most bricks in its reach (the one nearest `from` if several tie), and clear of bins.
   */
  wreckTarget(from: Vec3): WreckTarget | null {
    let best: { at: WreckTarget; n: number; d: number } | null = null;
    for (let site = 0; site < this.sites.length; site++) {
      const found = this.siteWreckTarget(site, from);
      if (found && (!best || found.n > best.n || (found.n === best.n && found.d < best.d))) {
        best = found;
      }
    }
    return best?.at ?? null;
  }

  private siteWreckTarget(
    site: number,
    from: Vec3,
  ): { at: WreckTarget; n: number; d: number } | null {
    const bricks = this.wreckableBricks(site);
    if (!bricks.length) return null;
    const c = this.buildCentre(this.build(site));
    const out = BASEPLATE_SIZE / 2 + WRECK_STAND_OUT;
    const floor = this.sites[site]!.baseplate.y;
    let best: { at: WreckTarget; n: number; d: number } | null = null;
    for (let k = 0; k < 4; k++) {
      const dir = v3(Math.sin((k * Math.PI) / 2), 0, Math.cos((k * Math.PI) / 2));
      const stand = v3(c.x + dir.x * out, floor, c.z + dir.z * out);
      const beyond = add(stand, scale(dir, 0.3));
      const up = (p: Vec3) => v3(p.x, floor + 0.25, p.z);
      if (!this.clearForDog(up(c), up(beyond))) continue;
      const reach = bricks.filter(
        (b) => Math.hypot(b.pos.x - stand.x, b.pos.z - stand.z) < WRECK_REACH,
      );
      if (!reach.length) continue;
      const look = scale(
        reach.reduce((s, b) => add(s, b.pos), v3()),
        1 / reach.length,
      );
      const d = Math.hypot(stand.x - from.x, stand.z - from.z);
      if (!best || reach.length > best.n || (reach.length === best.n && d < best.d)) {
        best = { at: { stand, look, site }, n: reach.length, d };
      }
    }
    return best;
  }

  /**
   * The hungry dog's paws on the build: every brick in its reach comes off whatever holds it
   * up (taking what sits on it along), and is knocked away from the dog.
   */
  dogWreck(at: WreckTarget): boolean {
    const a = this.build(at.site);
    const near = new Set(
      this.wreckableBricks(at.site)
        .filter((b) => Math.hypot(b.pos.x - at.stand.x, b.pos.z - at.stand.z) < WRECK_REACH)
        .map((b) => b.id),
    );
    if (!near.size) return false;
    const broken = a.grid.connections().filter((c) => near.has(c.upper));
    const pieces = this.resplit(a, broken);
    const away = sub(at.look, at.stand);
    const len = Math.hypot(away.x, away.z) || 1;
    const push = v3((away.x / len) * 1.2, 1, (away.z / len) * 1.2);
    for (const piece of pieces) piece.body.setLinvel(push, true);
    if (pieces.length) this.events.push({ kind: 'break', pos: at.look });
    return pieces.length > 0;
  }

  // ---------------------------------------------------------------- knock-downs

  /**
   * Knocks a player over: what they carry keeps flying the way they fell, they slide a little
   * along `push` and lie there for `ticks`. Returns false if they were already down.
   */
  knockDown(p: Player, push: Vec3, ticks = DOWN_TICKS): boolean {
    if (p.down > 0 || this.replica) return false;
    const held = this.heldAssembly(p);
    this.release(p);
    this.putVacuumDown(p);
    if (held) held.body.setLinvel(add(held.body.linvel(), scale(push, 2)), true);
    const flat = v3(push.x, 0, push.z);
    const len = length(flat);
    p.slide = len > 1e-3 ? scale(flat, FALL_SLIDE / len) : v3();
    p.fling = v3();
    p.vel = v3();
    p.down = ticks;
    p.knocks++;
    this.events.push({ kind: 'trip', pos: this.eye(p), playerId: p.id, dir: p.slide });
    return true;
  }

  /** Sprinting with a build in your arms: the heavier it is, the likelier a trip. */
  private maybeTrip(p: Player): void {
    const held = this.heldAssembly(p);
    if (!held || isLooseBrick(held) || p.down > 0 || !p.grounded) return;
    const i = p.input;
    if (p.gear.has('brace')) return;
    if (!i.sprint || i.careful || (i.forward === 0 && i.right === 0)) return;
    if (this.rng() < TRIP_CHANCE_PER_KG * assemblyMass(held) * DT) {
      this.knockDown(p, viewDir(i.yaw, 0));
    }
  }

  /**
   * The saboteur's clumsy mode: a trip like any other, except that whatever is just in front
   * takes the stumble. Loose builds get shoved; the job-site build loses what its weaker joints
   * held. Returns where it happened, or null if the player is already down.
   */
  clumsyTrip(p: Player): Vec3 | null {
    if (p.down > 0 || this.replica) return null;
    const fwd = viewDir(p.input.yaw, 0);
    const feet = sub(p.body.translation(), v3(0, PLAYER_FEET, 0));
    const front = add(feet, scale(fwd, CLUMSY_REACH));
    this.knockDown(p, fwd);
    for (const a of [...this.assemblies.values()]) {
      if (a.heldBy !== null) continue;
      const inReach = [...a.grid.bricks.values()].some((b) => {
        const t = this.brickPose(a, b).pos;
        return Math.hypot(t.x - front.x, t.z - front.z) < CLUMSY_REACH && t.y < feet.y + 1.4;
      });
      if (!inReach) continue;
      const shove = add(scale(fwd, 2.2), v3(0, 1, 0));
      if (a.anchored) {
        const pieces = this.resplit(a, planBreaks(a.grid, CLUMSY_SEVERITY, this.rng));
        for (const piece of pieces) piece.body.setLinvel(shove, true);
        if (pieces.length) this.events.push({ kind: 'break', pos: front, count: pieces.length });
      } else {
        a.body.setLinvel(add(a.body.linvel(), shove), true);
      }
    }
    return feet;
  }

  /** The saboteur's barefoot trap: a few small bricks spilled on the floor in front. */
  dropTrap(p: Player): Vec3 | null {
    if (p.down > 0 || this.replica) return null;
    const fwd = viewDir(p.input.yaw, 0);
    const right = v3(-fwd.z, 0, fwd.x);
    const feet = sub(p.body.translation(), v3(0, PLAYER_FEET, 0));
    TRAP_BRICKS.forEach(({ type, colour }, i) => {
      const at = add(feet, add(scale(fwd, 0.7 + 0.25 * (i % 2)), scale(right, (i - 1) * 0.3)));
      this.spawnBrick(type, colour, add(at, v3(0, 0.15, 0)), yawQuat(this.rng() * Math.PI));
    });
    // They clatter as they land, not as they appear.
    return add(feet, scale(fwd, 0.8));
  }

  /**
   * Someone walking onto a loose brick lying on the floor (anyone's, not only a trap's)
   * yelps and limps for a while; sprinting onto one sends them flying. The brick skids away.
   */
  private stepOnBricks(p: Player): void {
    // Walking carefully, you step over them; in steel-toe boots they do not hurt.
    if (p.down > 0 || p.limp > 0 || !p.grounded || p.input.careful) return;
    if (p.gear.has('boots')) return;
    if (p.input.forward === 0 && p.input.right === 0) return;
    const centre = p.body.translation();
    const feetY = centre.y - PLAYER_FEET;
    for (const a of this.assemblies.values()) {
      if (!isLooseBrick(a) || a.heldBy !== null) continue;
      const t = a.body.worldCom();
      if (t.y > feetY + STEP_HEIGHT || t.y < feetY - 0.3) continue;
      if (Math.hypot(t.x - centre.x, t.z - centre.z) > PLAYER_RADIUS * 0.9) continue;
      p.limp = LIMP_TICKS;
      this.events.push({ kind: 'ouch', pos: this.eye(p), playerId: p.id });
      const away = Math.atan2(t.x - centre.x, t.z - centre.z);
      a.body.setLinvel({ x: Math.sin(away) * 2, y: 1, z: Math.cos(away) * 2 }, true);
      if (p.input.sprint) this.knockDown(p, viewDir(p.input.yaw, 0));
      return;
    }
  }

  /** Players hit by a fast, heavy assembly (a thrown or falling build) go down. */
  private knockDownHitPlayers(): void {
    for (const a of this.assemblies.values()) {
      if (a.anchored || a.heldBy !== null) continue;
      // The velocity from before this step: the hit itself has already slowed it down.
      const v = length(a.prevLinvel) > length(a.body.linvel()) ? a.prevLinvel : a.body.linvel();
      const speed = length(v);
      if (speed < HIT_SPEED || assemblyMass(a) < HIT_MASS) continue;
      for (const c of collidersOf(a)) {
        this.world.contactPairsWith(c, (other) => {
          const o = this.owners.get(other.handle);
          if (o?.kind !== 'player') return;
          const p = this.players.get(o.playerId);
          if (p && this.touching(c, other)) this.knockDown(p, scale(v, 1 / speed));
        });
      }
    }
  }

  /** Whether two colliders actually touch, rather than only having overlapping bounds. */
  private touching(a: Collider, b: Collider): boolean {
    let hit = false;
    this.world.contactPair(a, b, (m) => {
      for (let i = 0; i < m.numContacts(); i++) if (m.contactDist(i) < 0.03) hit = true;
    });
    return hit;
  }

  /** Moves a player somewhere instantly (to the meeting table). */
  teleportPlayer(p: Player, feet: Vec3): void {
    const centre = add(this.aboveGround(feet, 0), v3(0, PLAYER_FEET + CONTROLLER_OFFSET, 0));
    p.body.setTranslation(centre, true);
    p.collider.setTranslation(centre);
    p.vy = 0;
    p.vel = v3();
    p.down = 0;
    p.limp = 0;
    p.slide = v3();
    p.slip = p.squeeze = null;
  }

  private pull(p: Player): void {
    if (p.holding || this.vacuum.heldBy === p.id) return;
    const hit = this.aim(p);
    if (hit?.owner.kind !== 'brick' || !this.mayUse(p, hit.point)) return;
    const a = this.assemblies.get(hit.owner.assemblyId);
    if (!a || a.heldBy !== null || a.frozen) return;
    const b = a.grid.bricks.get(hit.owner.brickId)!;
    if (BRICK_TYPES[b.type].fixture) return;
    if (a.grid.size === 1) return this.hold(p, a);
    const pose = this.brickPose(a, b);
    this.removeCollider(a, b.id);
    a.grid.remove(b.id);
    this.collidersChanged(a);
    a.version++;
    this.resplit(a);
    // The same brick, prints and all, now loose.
    const loose = this.spawnBrick(b.type, b.colour, pose.pos, pose.rot, undefined, b.id, b.prints);
    // Like any brick picked up, it turns to sit straight across the hands.
    this.hold(p, loose);
  }

  /**
   * Where the held brick, or the held piece of bricks clutched together, would snap right now,
   * if anywhere. A build with the baseplate in it is never snapped onto anything. While a layer
   * is locked (Shift), the bricks keep to it for as long as they still clutch something there.
   */
  snapPreview(p: Player, ask?: ViewAsk): SnapPreview | null {
    return this.snap(p, ask)?.preview ?? null;
  }

  private snap(p: Player, ask?: ViewAsk): { preview: SnapPreview; layer: SnapLayer | null } | null {
    const held = this.heldAssembly(p);
    if (!held || !p.holding) return null;
    const bricks = [...held.grid.bricks.values()];
    if (bricks.some((b) => BRICK_TYPES[b.type].fixture)) return null;
    // Flipped, it goes on by its other hole only, never onto a locked layer.
    const flip = isLooseBrick(held) && (ask?.flip ?? p.holding.flip ?? false);
    const lock = ask?.lock !== undefined ? ask.lock : p.snapLock;
    const locked = lock && this.assemblies.get(lock.targetId);
    if (lock && locked && !flip && this.snapsOnto(held, locked)) {
      const ray = this.aimRay(p, ask);
      const inv = conj(locked.body.rotation());
      const origin = rotate(inv, sub(ray.origin, locked.body.translation()));
      const dir = rotate(inv, ray.dir);
      const { group, rot } = this.snapGroup(p, held, locked, ask);
      const placements = computeLayerSnap(locked.grid, origin, dir, group, rot, lock, REACH + 0.4);
      const preview = placements && this.snapPreviewOf(locked, bricks, placements);
      if (preview && this.mayUse(p, preview.pos)) return { preview, layer: lock };
    }
    const hit = this.aim(p, ask);
    if (hit?.owner.kind !== 'brick') return null;
    const t = this.assemblies.get(hit.owner.assemblyId);
    if (!t || !this.snapsOnto(held, t)) return null;
    if (!this.mayUse(p, hit.point)) return null;
    const inv = conj(t.body.rotation());
    // On the lattice of the part aimed at: turned 45° off the grid, if it is.
    const frame = t.grid.bricks.get(hit.owner.brickId)?.frame;
    const onGrid = rotate(inv, sub(hit.point, t.body.translation()));
    const local = frame ? unframeMetres(frame, onGrid) : onGrid;
    const normal = frame ? unframeTurn(frame, rotate(inv, hit.normal)) : rotate(inv, hit.normal);
    const { group, rot } = this.snapGroup(p, held, t, ask, frame);
    // A single part aimed at the side of a build clips onto the side studs there; failing
    // that or a top or bottom, it goes onto whatever studs face out there, turned to take them.
    const single = isLooseBrick(held);
    const sideways = single && Math.abs(normal.y) < 0.3;
    const type = bricks[0]!.type;
    let placements = flip
      ? [latticeSnap(t.grid, local, normal, type, rot, true, frame)].filter((x) => x !== null)
      : sideways
        ? [sideSnap(t.grid, local, normal, type, rot, frame)].filter((x) => x !== null)
        : computeGroupSnap(t.grid, local, normal, group, rot, frame);
    if (!placements?.length && single && !flip)
      placements = [latticeSnap(t.grid, local, normal, type, rot, false, frame)].filter(
        (x) => x !== null,
      );
    if (!placements?.length) return null;
    // Turned 45° on, where it hangs on one stud alone.
    const spun =
      single && (ask?.eighth ?? p.holding.eighth) ? spinSnap(t.grid, placements[0]!) : null;
    if (spun) placements = [spun];
    const preview = this.snapPreviewOf(t, bricks, placements);
    if (spun) preview.turned45 = true;
    const square = !sideways && !flip && !spun && !frame && !placements[0]!.orient;
    return { preview, layer: square ? snapLayer(local, normal) : null };
  }

  /** Whether something held may snap onto `t`: not itself, not held, not frozen, upright. */
  private snapsOnto(held: Assembly, t: Assembly): boolean {
    if (t === held || t.heldBy !== null || t.frozen) return false;
    return rotate(t.body.rotation(), v3(0, 1, 0)).y >= 0.9; // not tipped over
  }

  /** The held bricks in their own grid, and how they turn to go onto `t`. */
  private snapGroup(
    p: Player,
    held: Assembly,
    t: Assembly,
    ask?: ViewAsk,
    frame?: Frame,
  ): { group: Placement[]; rot: Rotation } {
    // Turned as the lattice it goes on is.
    const tRot = frame ? mulQuat(t.body.rotation(), frameQuat(frame)) : t.body.rotation();
    const bricks = [...held.grid.bricks.values()];
    // A single brick goes on at the heading it has in the hands; a piece keeps its own bricks'
    // headings, turned by how its hold point is turned against the target.
    const single = isLooseBrick(held);
    const yaw = ask?.yaw ?? p.input.yaw;
    const turn = ask?.rot ?? p.holding!.rot;
    const rel = single
      ? yaw + turn * QUARTER - yawOf(tRot)
      : yawOf(this.holdTarget(p, { ...p.holding!, rot: turn }, held, yaw).rot) - yawOf(tRot);
    const rot = (((Math.round(rel / QUARTER) % 4) + 4) % 4) as Rotation;
    const group = single
      ? [{ ...bricks[0]!, x: 0, y: 0, z: 0, rot: 0 as Rotation, face: undefined }]
      : bricks;
    return { group, rot };
  }

  private snapPreviewOf(t: Assembly, bricks: PlacedBrick[], placements: Placement[]): SnapPreview {
    const out = placements.map((placement, i) => ({
      id: bricks[i]!.id,
      placement: {
        type: placement.type,
        x: placement.x,
        y: placement.y,
        z: placement.z,
        rot: placement.rot,
        ...(placement.face ? { face: placement.face } : {}),
        ...(placement.orient ? { orient: placement.orient } : {}),
        ...(placement.frame ? { frame: placement.frame } : {}),
      },
      ...this.brickPose(t, placement),
    }));
    return { targetId: t.id, bricks: out, pos: out[0]!.pos, rot: out[0]!.rot };
  }

  /**
   * Holding Shift (the sprint key) with something in hand locks snapping to the layer it snaps
   * to as the key goes down; letting go of the key, or of what is held, unlocks it.
   */
  private trackSnapLock(p: Player): void {
    const pressed = p.input.sprint && p.holding !== null;
    if (!pressed) p.snapLock = null;
    else if (!p.snapLockKey) {
      const s = this.snap(p);
      p.snapLock = s?.layer ? { ...s.layer, targetId: s.preview.targetId } : null;
    }
    p.snapLockKey = pressed;
  }

  /** A click with something in hand; `output` as in `Action`. */
  private place(p: Player, output = false): void {
    const hit = this.aim(p);
    if (this.interact(p, hit)) return;
    // Machines work with a click whatever is in hand; what is in their output areas is only
    // taken with the hands free for it, and nothing is dropped there instead.
    if (hit?.owner.kind === 'machine') {
      if (!output && this.mayUse(p, hit.point)) this.useMachine(p, hit.owner.machineId);
      return;
    }
    if (hit?.owner.kind === 'output') {
      if (this.mayUse(p, hit.point)) this.takeOut(p, hit.owner.machineId, hit.owner.slot);
      return;
    }
    if (p.tool) return;
    const preview = this.snapPreview(p);
    const held = this.heldAssembly(p);
    if (!preview || !held) return this.setDown(p);
    const target = this.assemblies.get(preview.targetId)!;
    const placed: PlacedBrick[] = preview.bricks.map((b) => {
      const { colour, prints } = held.grid.bricks.get(b.id)!;
      return { ...b.placement, id: b.id, colour, ...(prints ? { prints } : {}) };
    });
    this.removeAssembly(held);
    // The preview checked the bricks as a whole: none overlaps, and the piece clutches on.
    for (const b of placed) {
      target.grid.insert(b);
      this.addCollider(target, b);
    }
    this.collidersChanged(target);
    target.version++;
    target.body.wakeUp();
    this.events.push({ kind: 'snap', pos: preview.pos });
  }

  /** Lets go of a single brick, or starts lowering a build to the ground. */
  private setDown(p: Player): void {
    const a = this.heldAssembly(p);
    if (a && p.holding && !isLooseBrick(a)) p.holding.settingDown ??= 0;
    else this.release(p);
  }

  private release(p: Player): void {
    const a = this.heldAssembly(p);
    p.holding = null;
    if (!a) return;
    this.setHeld(a, null);
    // Something let go of in the air sounds when it lands (see `handleImpacts`); something
    // already resting on the ground, set down gently, just settles.
    if (length(a.body.linvel()) < 0.5 && this.resting(a)) {
      a.lastDropTick = this.tick;
      this.events.push({ kind: 'drop', pos: a.body.worldCom(), count: a.grid.size, speed: 0.5 });
    }
  }

  /** Whether `a` rests against anything that is not part of it. */
  private resting(a: Assembly): boolean {
    for (const c of collidersOf(a)) {
      let rests = false;
      this.world.contactPairsWith(c, (other) => {
        const o = this.owners.get(other.handle);
        if (o?.kind === 'brick' && o.assemblyId === a.id) return;
        if (this.touching(c, other)) rests = true;
      });
      if (rests) return true;
    }
    return false;
  }

  private throwHeld(p: Player): void {
    const a = this.heldAssembly(p);
    if (!a) return;
    this.release(p);
    const push = THROW_SPEED / Math.max(1, assemblyMass(a) / 5);
    a.body.setLinvel(scale(viewDir(p.input.yaw, p.input.pitch), push), true);
  }

  // ---------------------------------------------------------------- replica

  /** Creates or replaces an assembly exactly as the server describes it. */
  replicaAssembly(
    id: number,
    bricks: PlacedBrick[],
    anchored: boolean,
    heldBy: number | null,
    version: number,
    pos: Vec3,
    rot: Quat,
  ): Assembly {
    const old = this.assemblies.get(id);
    if (old) this.replicaRemove(old);
    const a = this.createAssembly(bricks, pos, rot, anchored, undefined, undefined, id);
    a.version = version;
    if (heldBy !== null) this.setHeld(a, heldBy);
    return a;
  }

  /** Changes who holds an assembly without rebuilding it. */
  replicaHeld(a: Assembly, heldBy: number | null, anchored: boolean): void {
    if (a.heldBy !== heldBy) this.setHeld(a, heldBy);
    if (a.anchored !== anchored) {
      const { RigidBodyType } = this.R;
      a.body.setBodyType(
        anchored ? RigidBodyType.Fixed : RigidBodyType.KinematicPositionBased,
        true,
      );
    }
    a.anchored = anchored;
  }

  replicaRemoveAssembly(id: number): void {
    const a = this.assemblies.get(id);
    if (a) this.replicaRemove(a);
  }

  private replicaRemove(a: Assembly): void {
    for (const c of collidersOf(a)) this.owners.delete(c.handle);
    this.world.removeRigidBody(a.body);
    this.assemblies.delete(a.id);
  }

  /**
   * Creates, moves into a pocket, hides, pins or puts back an instruction page: lying with its
   * middle at `pos` unless it is carried (by a player, or in the dog's mouth), hidden or pinned.
   */
  replicaPage(
    id: number,
    printed: PrintedPage | null,
    carriedBy: number | null,
    where: { hidden: boolean; pinned: number | null; dog: boolean },
    pos: Vec3,
    rot: Quat,
  ): void {
    const page = this.pages.get(id) ?? this.newPage(printed, id);
    // A page first seen unread (in someone's pocket) learns which it is once it can be read.
    if (printed) page.step = printed.step;
    // Which hiding place it is in is never told, only that it is in one.
    page.hideout = null;
    if (where.pinned !== null) {
      page.printed = printed;
      page.carriedBy = null;
      page.hidden = false;
      this.pinPage(page, where.pinned);
      return;
    }
    page.hidden = where.hidden;
    page.printed = printed;
    page.version++;
    if (page.body) {
      this.owners.delete(page.body.collider(0).handle);
      this.world.removeRigidBody(page.body);
      page.body = null;
    }
    page.carriedBy = carriedBy;
    page.pinned = null;
    if (carriedBy === null && !where.hidden && !where.dog) this.placePage(page, pos, rot);
  }

  /**
   * Creates, hands over, hides or puts back a piece of gear: lying with its middle at `pos`
   * unless it is worn, hidden or (the leash) on the dog's pole.
   */
  replicaGear(
    id: number,
    kind: GearId,
    wornBy: number | null,
    where: { hidden: boolean; placed: boolean },
    pos: Vec3,
    rot: Quat,
  ): void {
    const item = this.gear.get(id) ?? this.newGear(kind, id);
    if (item.body) {
      this.owners.delete(item.body.collider(0).handle);
      this.world.removeRigidBody(item.body);
      item.body = null;
    }
    item.version++;
    item.hidden = where.hidden;
    item.hideout = null;
    if (where.placed) {
      item.placed = true;
      item.wornBy = null;
      if (!this.dog.leashed) this.dog.leash(this.dogPole());
      return;
    }
    item.placed = false;
    item.wornBy = wornBy;
    if (wornBy === null && !where.hidden) this.placeGear(item, pos, rot);
  }

  /** Mirrors who carries the vacuum, or where it stands or lies, and how full it is. */
  replicaVacuum(
    heldBy: number | null,
    pos: Vec3,
    yaw: number,
    leaning: boolean,
    load: number,
  ): void {
    const b = this.vacuum;
    b.load = load;
    if (
      b.heldBy === heldBy &&
      b.leaning === leaning &&
      b.yaw === yaw &&
      length(sub(b.pos, pos)) < 1e-4
    )
      return;
    this.setVacuum({ ...b, heldBy, pos, yaw, leaning });
  }

  /**
   * Which hiding places stand open and which are padlocked, the power, and the brick works, as
   * clients are told it (`replicaFurniture` on their side).
   */
  furnitureState(): FurnitureState {
    const hideouts = [...this.hideouts.values()];
    const { on, fixer, dead } = this.power;
    return {
      open: hideouts.filter((h) => h.open).map((h) => h.def.id),
      locked: hideouts.filter((h) => h.locked).map((h) => h.def.id),
      used: [...this.gadgets.values()].filter((g) => g.used).map((g) => g.def.id),
      power: { on, fixer, dead },
      ...this.brickWorks(),
    };
  }

  /** Mirrors the hiding places, the power and the brick works as the server tells them. */
  replicaFurniture(f: FurnitureState): void {
    for (const [id, mould, colour, shots, part, jammed, fixer, out, making] of f.machines) {
      const m = this.machines.get(id);
      if (!m) continue;
      if (fixer !== m.fixer) m.progress = 0;
      Object.assign(m, { mould, colour, shots, part, jammed, fixer, making });
      const clicks = this.outputColliders.get(id) ?? [];
      m.out.forEach((_, slot) => {
        m.out[slot] = out[slot] ?? null;
        clicks[slot]?.setEnabled(m.out[slot] !== null);
      });
    }
    this.replicaTools = new Map(f.tools);
    for (const p of this.players.values()) p.tool = this.replicaTools.get(p.id) ?? null;
    for (const h of this.hideouts.values()) {
      this.setOpen(h, f.open.includes(h.def.id));
      h.locked = f.locked.includes(h.def.id);
    }
    for (const g of this.gadgets.values()) this.setUsed(g, f.used.includes(g.def.id));
    if (f.power.fixer !== this.power.fixer) this.power.progress = 0;
    this.power.on = f.power.on;
    this.power.fixer = f.power.fixer;
    this.power.dead = f.power.dead;
  }

  /**
   * The brick works as clients are told it: what is in each machine, what it is making and what
   * waits in its output area, and who carries what.
   */
  brickWorks(): BrickWorksState {
    return {
      machines: [...this.machines.values()].map((m) => [
        m.def.id,
        m.mould,
        m.colour,
        m.shots,
        m.part,
        m.jammed,
        m.fixer,
        [...m.out],
        m.making,
      ]),
      tools: [...this.players.values()].flatMap((p) =>
        p.tool ? [[p.id, p.tool] as [number, Tool]] : [],
      ),
    };
  }

  /** Poses a replicated body for the next step. */
  setPose(body: RigidBody, pos: Vec3, rot: Quat): void {
    body.setNextKinematicTranslation(pos);
    body.setNextKinematicRotation(rot);
  }

  // ---------------------------------------------------------------- step

  /**
   * `world.step()` without what it does afterwards: walking every body and collider through
   * JavaScript callbacks to pick up any the step itself created or removed. Ours never are:
   * they are created and removed through the world, which keeps its lookup tables up to date.
   * That walk made ~5 KB of garbage per step, twice per tick in a solo game (server and
   * client), and the garbage collection it caused showed up as a hitch every few seconds.
   */
  /** How far each of the level's sliding doors is open (0 to 1), in the level's order. */
  doorsOpen(): number[] {
    return this.doors.map((d) => d.open);
  }

  /** Slides each door on toward open while anyone (a player or the dog) is by it, else shut. */
  private slideDoors(): void {
    if (!this.doors.length) return;
    const by: Vec3[] = [...this.players.values()].map((p) => {
      const at = p.body.translation();
      return v3(at.x, at.y - PLAYER_FEET, at.z);
    });
    const dog = this.dog.body.translation();
    by.push(v3(dog.x, dog.y - DOG_RADIUS, dog.z));
    for (const d of this.doors) {
      const { at } = d.def;
      const near = by.some(
        (f) => Math.hypot(at.x - f.x, at.z - f.z) < DOOR_NEAR && Math.abs(at.y - (f.y + 1)) < 1.5,
      );
      const open = Math.min(1, Math.max(0, d.open + ((near ? 1 : -1) * DT) / DOOR_TIME));
      if (open === d.open) continue;
      d.open = open;
      d.body.setNextKinematicTranslation(add(d.def.mesh.at, doorOffset(d.def, open)));
    }
  }

  private stepWorld(): void {
    const w = this.world;
    w.physicsPipeline.step(
      w.gravity,
      w.integrationParameters,
      w.islands,
      w.broadPhase,
      w.narrowPhase,
      w.bodies,
      w.colliders,
      w.softBodies,
      w.impulseJoints,
      w.multibodyJoints,
      w.ccdSolver,
    );
  }

  step(): void {
    if (this.catapultCooldown > 0) this.catapultCooldown--;
    if (this.replica) {
      for (const p of this.players.values()) {
        if (p.replicated) continue;
        this.movePlayer(p, [p.input]);
        this.trackSnapLock(p);
        this.tire(p);
      }
      // The server says when the fix is done; until then it only looks like it is coming along.
      if (this.power.fixer !== null)
        this.power.progress = Math.min(1, this.power.progress + DT / REPAIR_SECONDS);
      for (const m of this.machines.values())
        if (m.fixer !== null) m.progress = Math.min(1, m.progress + DT / UNJAM_SECONDS);
      this.slideDoors();
      this.stepWorld();
      this.tick++;
      return;
    }
    for (const p of this.players.values()) {
      const inputs = p.pendingInputs ?? [p.input];
      p.pendingInputs = null;
      if (inputs.length) this.movePlayer(p, inputs);
      this.applyHold(p);
      this.trackSnapLock(p);
      this.tire(p);
      this.maybeTrip(p);
      this.stepOnBricks(p);
    }
    this.dog.update();
    this.updatePower();
    this.updateJams();
    this.updateMaking();
    for (const a of this.assemblies.values()) {
      if (a.anchored) continue;
      a.prevLinvel = a.body.linvel();
      a.prevAngvel = a.body.angvel();
    }
    this.slideDoors();
    this.stepWorld();
    this.tick++;
    this.knockDownHitPlayers();
    this.handleImpacts();
    this.reanchorBuild();
    // Removing the one the loop is on is safe while walking a Map.
    for (const a of this.assemblies.values()) {
      if (this.isBuild(a.id)) continue;
      if (a.body.translation().y < KILL_Y) this.removeAssembly(a);
      else this.binIfIn(a);
    }
    for (const page of this.pages.values()) {
      if (page.body && page.body.translation().y < KILL_Y) {
        const at = this.aboveGround(restingOn(this.level.spawn, PAGE_SIZE), 0.02);
        page.body.setTranslation(at, true);
        page.body.setLinvel(v3(), true);
      }
    }
    for (const item of this.gear.values()) {
      if (item.body && item.body.translation().y < KILL_Y) {
        const at = this.aboveGround(restingOn(this.level.spawn, GEAR_SIZE), 0.08);
        item.body.setTranslation(at, true);
        item.body.setLinvel(v3(), true);
      }
    }
    // Nobody falls for ever (off the edge of an island's terrain, say): back to the spawn.
    for (const p of this.players.values())
      if (!p.replicated && p.body.translation().y < KILL_Y)
        this.teleportPlayer(p, this.level.spawn);
    if (this.level.terrain?.length) this.keepAboveGround();
  }

  /**
   * Lifts back onto the terrain anything loose that has gone through it: the terrain is a skin
   * of triangles with nothing under it, so a page or a brick that starts or ends a step a
   * little inside it would otherwise fall on through it for ever.
   */
  private keepAboveGround(): void {
    // Judged by its centre of mass: an assembly's origin is a corner of it, which may well be
    // below the ground beside it while it lies on a slope.
    const lift = (body: RigidBody, depth: number) => {
      const at = body.worldCom();
      const ground = groundHeight(this.level, at.x, at.z);
      if (at.y > ground - depth) return;
      const o = body.translation();
      body.setTranslation(v3(o.x, o.y + ground + depth + 0.02 - at.y, o.z), true);
      const v = body.linvel();
      body.setLinvel(v3(v.x, Math.max(0, v.y), v.z), true);
    };
    for (const page of this.pages.values())
      if (page.body && page.carriedBy === null && page.pinned === null) lift(page.body, 0.05);
    for (const item of this.gear.values()) if (item.body && !item.wornBy) lift(item.body, 0.1);
    for (const a of this.assemblies.values())
      if (!a.anchored && a.heldBy === null && a.body.isDynamic()) lift(a.body, 0.1);
    // And a player who has slipped into it (a step put down a little inside a slope).
    for (const p of this.players.values()) {
      if (p.replicated) continue;
      const at = p.body.translation();
      const feet = at.y - PLAYER_FEET - CONTROLLER_OFFSET;
      // (Put down by their feet, which `teleportPlayer` lifts onto the ground.)
      if (feet < groundHeight(this.level, at.x, at.z) - 0.25)
        this.teleportPlayer(p, v3(at.x, feet, at.z));
    }
  }

  /**
   * `at` lifted, if need be, to stand `lift` over the terrain under it, and more on a slope,
   * for something reaching `reach` out from its middle: put down on a hillside, a page, a brick
   * or a player's feet would start sunk in the uphill side and fall through. Only on a map
   * whose ground is terrain: the flat maps' basements are below 0.
   */
  private aboveGround(at: Vec3, lift: number, reach = 0): Vec3 {
    if (!this.level.terrain?.length) return at;
    const ground = groundHeight(this.level, at.x, at.z);
    const slope = reach ? groundSlope(this.level, at.x, at.z) * reach : 0;
    return v3(at.x, Math.max(at.y, ground + lift + slope), at.z);
  }

  /**
   * Breaks builds that took a hard knock, and sounds loose pieces landing. Severity is the
   * sudden change in velocity during this step; a moving piece that hits an anchored build
   * passes part of the knock on to it.
   */
  private handleImpacts(): void {
    const hits = new Map<Assembly, number>();
    const bump = (a: Assembly, s: number) => hits.set(a, Math.max(hits.get(a) ?? 0, s));
    for (const a of this.assemblies.values()) {
      if (a.anchored || a.body.isSleeping()) continue;
      const slowed = length(sub(a.body.linvel(), a.prevLinvel));
      // A dropped or thrown piece hitting the floor, a wall or another piece: the sound of
      // it landing plays now, where it hit, as hard as it hit.
      if (
        a.heldBy === null &&
        slowed >= LAND_SPEED &&
        this.tick - a.lastDropTick > LAND_GAP_TICKS
      ) {
        a.lastDropTick = this.tick;
        this.events.push({
          kind: 'drop',
          pos: a.body.worldCom(),
          count: a.grid.size,
          speed: slowed,
        });
      }
      if (this.tick - a.bornTick < BREAK_GRACE_TICKS) continue;
      const dv = slowed + 0.2 * length(sub(a.body.angvel(), a.prevAngvel));
      if (dv < 1) continue;
      if (a.grid.size > 1) bump(a, dv);
      const share = dv * Math.min(1, a.body.mass() / 6);
      for (const c of collidersOf(a)) {
        this.world.contactPairsWith(c, (other) => {
          const o = this.owners.get(other.handle);
          if (o?.kind !== 'brick' || o.assemblyId === a.id) return;
          const t = this.assemblies.get(o.assemblyId);
          if (t?.anchored && this.tick - t.bornTick >= BREAK_GRACE_TICKS) bump(t, share);
        });
      }
    }
    for (const [a, severity] of hits) {
      if (!this.assemblies.has(a.id)) continue;
      const broken = planBreaks(a.grid, severity, this.rng);
      if (broken.length === 0) continue;
      const pieces = this.resplit(a, broken);
      if (pieces.length > 0)
        this.events.push({ kind: 'break', pos: a.body.worldCom(), count: pieces.length });
      // A piece that broke off a held build falls; only the main piece stays in hand.
    }
  }
}
