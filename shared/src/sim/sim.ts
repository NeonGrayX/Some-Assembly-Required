import type RAPIER from '@dimforge/rapier3d-compat';
import type {
  Collider,
  ColliderDesc,
  KinematicCharacterController,
  RigidBody,
  World,
} from '@dimforge/rapier3d-compat';
import { BASEPLATE_SIZE, BRICK_TYPES, PLATE_H, STUD, footprint } from '../bricks.ts';
import type { BrickTypeId, ColourId, Rotation } from '../bricks.ts';
import type { GearId } from '../gear.ts';
import type { FurnitureState } from '../net/protocol.ts';
import type { SabotageTool } from '../round.ts';
import { planBreaks } from '../breaking.ts';
import {
  BRICK_DENSITY,
  CONTROLLER_OFFSET,
  EYE_OFFSET,
  G_PLAYER,
  HELD_GROUPS,
  MAX_CLIMB,
  NOT_PLAYER_GROUPS,
  PLAYER_FEET,
  PLAYER_GROUPS,
  PLAYER_HALF_HEIGHT,
  PLAYER_ONLY_GROUPS,
  PLAYER_RADIUS,
  SQUEEZE,
  STEP_UP,
  WORLD_GROUPS,
  groups,
  isLooseBrick,
  QUARTER,
  collidersOf,
  PAGE_SIZE,
  GEAR_SIZE,
  MAX_LOOSE_BRICKS,
  restingOn,
} from './body.ts';
import { DOG_RADIUS, Dog } from './dog.ts';
import { Carrying } from './carrying.ts';
import { DogWorld } from './dogworld.ts';
import { GearHunt } from './gearhunt.ts';
import { HidingPlaces } from './hiding.ts';
import { BrickWorks, UNJAM_SECONDS } from './brickworks.ts';
import { DOWN_TICKS, KnockDowns } from './knockdowns.ts';
import { Movement } from './movement.ts';
import { Pages } from './pages.ts';
import { Placing } from './placing.ts';
import { Sight } from './sight.ts';
import { REPAIR_SECONDS, Working } from './working.ts';
import { Sabotage } from './sabotage.ts';
import { SUCK_TICKS, VacuumCleaner } from './vacuum.ts';
import type { MachineAct } from './operate.ts';
import { DT } from './time.ts';
import type { StealTarget, WreckTarget } from './dog.ts';
import type { Connection, Placement, PlacedBrick } from '../grid.ts';
import { BrickGrid, localCentre } from '../grid.ts';
import { canFlip } from '../snap.ts';
import type { SnapLayer } from '../snap.ts';
import { partBox, partQuat, placedColliders } from '../parts.ts';
import type { PrintedPage } from '../builds/forgery.ts';
import type { Prints, TargetBuild } from '../builds/types.ts';
import {
  printJobs,
  BOARD_SIZE,
  BUTTON_SIZE,
  groundPieces,
  CATAPULT,
  catapultSolids,
  isTrashBin,
  trashBinMouth,
  levelSites,
} from '../content/house.ts';
import type {
  BoxDef,
  FloorRect,
  GadgetDef,
  HideoutDef,
  LevelDef,
  MachineDef,
  MachineKind,
  PrintJob,
  SiteDef,
  CarDoorDef,
  MeshDef,
  SlidingDoorDef,
  SolidDef,
} from '../content/house.ts';
import { meshOf } from '../content/maps/meshes.ts';
import { sideOf } from '../content/rival.ts';
import { groundHeight, groundSlope, terrainTriangles } from '../content/terrain.ts';
import { hideoutBody, hideoutPartInWorld, inWorld, openingIn } from '../content/hideouts.ts';
import type { PartPose } from '../content/hideouts.ts';
import {
  IDENTITY,
  add,
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

export { DT, TICK_RATE, catchUp } from './time.ts';
export { TUG_CLICKS } from './carrying.ts';
export { DOG_STEEPEST } from './dogworld.ts';
export { DOWN_TICKS, LIMP_TICKS } from './knockdowns.ts';
export { STAIRS_MARGIN, STAIRS_SLIDE, WALK_SPEED } from './movement.ts';
export { VACUUM_CAPACITY, vacuumRestPose } from './vacuum.ts';
export { CAMERA_DISTANCE, CAMERA_LIFT, CAMERA_SHOULDER, cameraPosition } from './sight.ts';
export { REPAIR_SECONDS, WORK_STANDOFF, WORK_TICKS } from './working.ts';
export { BUCKET_SHOTS, MAKE_SECONDS, MAKE_TICKS, UNJAM_SECONDS } from './brickworks.ts';
export {
  GEAR_SIZE,
  MAX_LOOSE_BRICKS,
  PAGE_SIZE,
  TIRED_DROP_TICKS,
  TIRED_TICKS,
  tiredFactor,
  PLAYER_RADIUS,
  PLAYER_HALF_HEIGHT,
  PLAYER_FEET,
  EYE_OFFSET,
  CONTROLLER_OFFSET,
  MAX_CLIMB,
  PLAYER_GROUPS,
  viewDir,
  isLooseBrick,
  assemblyMass,
} from './body.ts';

/** What bricks, pages and the rest fall by; players and the dog fall by their own (`GRAVITY`). */
const WORLD_GRAVITY = 9.81;

// Working a machine
/** The brick works' events that set a machine making something, once a player's hands start it. */
const MAKES: SimEvent['kind'][] = ['fill', 'dispense', 'moulded', 'print'];

/**
 * What a player may still do while they work a machine (see `Sim.act`): turn or flip what they
 * hold, drop their page, take gear off.
 */
const HANDS_FREE: Action['kind'][] = ['rotate', 'flip', 'dropPage', 'unequip'];

/**
 * What a player does at a machine (see `MachineAct`), by what it did for them (`done`, the
 * brick works' event their click raised there, if any), the place in its output area they
 * clicked (`slot`, -1 for none): the place they take from, for `take`, and whether they took
 * something into their hands (`took`: off the printer's bed).
 */
function actOf(
  done: SimEvent | undefined,
  slot: number,
  kind: MachineKind | undefined,
  took: boolean,
): { act: MachineAct; at: number } {
  switch (done?.kind) {
    case 'fill':
      return { act: 'fill', at: -1 };
    case 'dispense':
    case 'moulded':
      return { act: 'start', at: -1 };
    case 'print':
      return { act: 'print', at: -1 };
    case 'pour':
      return { act: 'pour', at: -1 };
    case 'mouldIn':
      return { act: 'mould', at: -1 };
    case 'toolDown':
      return { act: 'return', at: -1 };
    case 'printerIn':
      return { act: 'lay', at: -1 };
    case 'fixing':
      return { act: 'fix', at: -1 };
    case 'toolUp':
      return { act: 'take', at: done.slot ?? slot };
  }
  // A part taken out of a moulding machine's bay, or off the printer's bed unprinted.
  if (slot >= 0) return { act: 'take', at: slot };
  return kind === 'printer' && took ? { act: 'take', at: -1 } : { act: 'work', at: -1 };
}

// Knock-downs
/**
 * How far over a guarded railing (round a stairwell or a roof) players meet a wall they cannot
 * see. At the top of a jump (1.3 m up) a player steps onto anything up to `STEP_UP` higher,
 * railings included: perched on one, head in the ceiling, they were stuck there, and off a roof
 * they went over it.
 */
const RAIL_GUARD = 1;

/** What a floor or a ceiling is, for the camera: a box no thicker than this, and this wide both ways. */
const SLAB = { thick: 0.6, wide: 1.5 };

// Sliding doors, and the vehicles' doors
/** How near (m, across the ground) anyone comes to a sliding door before it opens. */
export const DOOR_NEAR = 1.7;
/** How long (s) a door takes to open or shut. */
const DOOR_TIME = 0.6;
/** How much of its way a door that stands out first (a bus's) spends standing out. */
const DOOR_OUT = 0.3;

/** Eased from 0 at `a` to 1 at `b` (smootherstep), as the models' doors are drawn moving. */
function eased(t: number, a: number, b: number): number {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** Where a vehicle's door's mesh stands (see `CarDoorDef`), `t` of the way open (0 to 1). */
export function carDoorPose(door: CarDoorDef, t: number): { at: Vec3; turn: Quat } {
  const { at, turn = IDENTITY } = door.mesh;
  if (door.slide) {
    const { out, along } = door.slide;
    const by = add(scale(out, eased(t, 0, DOOR_OUT)), scale(along, eased(t, DOOR_OUT, 1)));
    return { at: add(at, by), turn };
  }
  const { at: hinge, axis, angle } = door.hinge!;
  const half = (angle * eased(t, 0, 1)) / 2;
  const q = { ...scale(axis, Math.sin(half)), w: Math.cos(half) };
  return { at: add(hinge, rotate(q, sub(at, hinge))), turn: mulQuat(q, turn) };
}

/** How far `door` has moved from shut, `t` of the way open (0 to 1). */
export function doorOffset(door: SlidingDoorDef, t: number): Vec3 {
  const { out, along } = door;
  const split = out.x || out.y || out.z ? DOOR_OUT : 0;
  return add(scale(out, split ? eased(t, 0, split) : 0), scale(along, eased(t, split, 1)));
}

/**
 * A held brick sits in front of the player's chest, between the hands: `up` above the middle
 * of the body, its near face `front` ahead of it. Where the player looks does not move it.
 */
const HOLD = { up: 0.15, front: 0.27 };
/** Room left between the player's collision capsule and the near side of a carried build. */
const BUILD_HOLD_GAP = 0.06;
/** Fastest a held item's hold point is followed outright, so a teleport does not fling it. */
const MAX_HOLD_FOLLOW = 20;
/** Ticks after an assembly is created during which impacts do not break it. */
const BREAK_GRACE_TICKS = 20;
/** A loose piece losing at least this much speed in one step has landed on something. */
const LAND_SPEED = 1.2;
/** Ticks between one piece's landing sounds, so a tumble is not a drum roll. */
const LAND_GAP_TICKS = 8;
/** Bricks below this height are deleted. */
const KILL_Y = -20;
/**
 * How far above a rubbish bin's rim a loose piece's centre may be and still go in (a brick
 * resting across the opening has its centre this low), and how far below it (a piece falling
 * fast passes the rim between two steps).
 */
const BIN_CATCH = 0.45;
const BIN_DEPTH = 0.3;

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
   * Working a machine (or the broken electrical panel) they clicked, as patting the dog: walking
   * up to it to stand before where they clicked, then working it there with their hands a while
   * (see `Work`), or with a wrench till it is fixed. At a machine they stay till they are done,
   * whatever they press (see `movePlayer`); at the panel, moving off ends it.
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

/** A player working a machine or the electrical panel (see `Player.work`). */
export interface Work {
  /** Which time this is that they set to work (see `Player.works`). */
  n: number;
  /** The machine they work, or null for the electrical panel. */
  machineId: number | null;
  /**
   * What they do there (see `MachineAct`), and for `take` which place in its output area they
   * take from (-1 for the printer's bed, and for every other act).
   */
  act: MachineAct;
  slot: number;
  /**
   * Where they stand to work it (their station for the act: see `actStation`), and where they
   * clicked it, which they face.
   */
  spot: Vec3;
  hand: Vec3;
  /** The tick they set to work, and whether the machine waits for their hands to start it. */
  since: number;
  delays: boolean;
  /**
   * The place in its output area (-1: the printer's bed) where what their hands set the machine
   * making comes out, if they did: once done with their hands they stand by it (`wait`) till it
   * is made, and then take it (see `collect`).
   */
  awaits: number | null;
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
 * What a machine is making: the thing, the place in its output area it goes in when done (the
 * UV printer: -1, printing on the part on its bed), and the tick it is done (the server's).
 */
export interface Making {
  made: Made;
  slot: number;
  at: number;
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
  /** A vehicle's door, bonnet or boot, which a click opens and shuts (see `CarDoorDef`). */
  | { kind: 'carDoor'; group: number }
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

/** The collider for a shape of a level's models (see `SolidDef`), placed by `place`. */
export function solidDesc(R: typeof RAPIER, s: SolidDef, place: MeshDef): ColliderDesc {
  const [r, half] = [s.r ?? 0, (s.h ?? 0) / 2];
  const size = s.size ?? { x: 0, y: 0, z: 0 };
  const round = (d: number) => Math.max(1e-4, d / 2 - r);
  const desc =
    s.shape === 'hull'
      ? R.ColliderDesc.convexHull(new Float32Array(s.points!))!
      : s.shape === 'box'
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
  const shapeDescs = shapes.map((s) => solidDesc(R, s, place));
  // A mesh made wholly of shapes has no triangles left, and an empty trimesh can't be made.
  if (!indices.length) return shapeDescs;
  return [
    ...shapeDescs,
    R.ColliderDesc.trimesh(vertices, indices)
      .setTranslation(at.x, at.y, at.z)
      .setRotation(place.turn ?? IDENTITY),
  ];
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
  /** The vehicles' doors (see `LevelDef.carDoors`), each with how far it is open (0 to 1). */
  private readonly carDoors: { def: CarDoorDef; body: RigidBody; open: number }[] = [];
  /** The groups of the vehicles' doors clicked open. */
  private readonly carDoorsClicked = new Set<number>();
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
  catapultCooldown = 0;
  tick = 0;
  /** The clickable places in each machine's output area, by machine id: on while full. */
  readonly outputColliders = new Map<number, Collider[]>();
  /** The house dog (on a client, only where the server says it is). */
  readonly dog: Dog;
  vacuum: VacuumState;

  /** How players move (see `Movement`). */
  private readonly movement: Movement;
  /** The brick works at work (see `BrickWorks`). */
  readonly works: BrickWorks;
  /** What players see and aim at (see `Sight`). */
  readonly sight: Sight;
  /** Putting down what players hold (see `Placing`). */
  readonly placing: Placing;
  /** The vacuum cleaner at work (see `VacuumCleaner`). */
  readonly vacuuming: VacuumCleaner;
  /** Players knocked down and pulled up (see `KnockDowns`). */
  readonly knocks: KnockDowns;
  /** The world as the dog meets it (see `DogWorld`). */
  private readonly dogWorld: DogWorld;
  /** The round's pages (see `Pages`). */
  readonly pageWork: Pages;
  /** The hiding places and the scenery's gadgets (see `HidingPlaces`). */
  readonly hiding: HidingPlaces;
  /** The gear of a gear hunt (see `GearHunt`). */
  readonly gearHunt: GearHunt;
  /** Picking things up and carrying them (see `Carrying`). */
  readonly carrying: Carrying;
  /** Players at work, and the power (see `Working`). */
  readonly working: Working;
  readonly sabotage: Sabotage;

  readonly replica: boolean;
  /** Whether the job site has its meeting bell. */
  readonly bell: boolean;

  private nextId = 1;
  readonly owners = new Map<number, ColliderOwner>();
  /** The ground's colliders, and the level's floors and ceilings: no camera looks through them. */
  readonly floors = new Set<number>();
  readonly rng: () => number;
  /** The level, with the round's pictures for the UV printer once a round is under way. */
  level: LevelDef;

  constructor(
    readonly R: Rapier,
    level: LevelDef,
    seed = 1,
    opts: SimOptions = {},
  ) {
    this.level = level;
    this.replica = opts.replica ?? false;
    this.sites = levelSites(level);
    this.bell = opts.bell ?? true;
    this.world = new R.World({ x: 0, y: -WORLD_GRAVITY, z: 0 });
    this.world.timestep = DT;
    this.movement = new Movement(this);
    this.works = new BrickWorks(this);
    this.sight = new Sight(this);
    this.placing = new Placing(this);
    this.knocks = new KnockDowns(this);
    this.dogWorld = new DogWorld(this);
    this.pageWork = new Pages(this);
    this.hiding = new HidingPlaces(this);
    this.gearHunt = new GearHunt(this);
    this.carrying = new Carrying(this);
    this.working = new Working(this);
    this.sabotage = new Sabotage(this);
    this.rng = makeRng(seed);
    const fixed = this.buildLevel();
    this.dog = new Dog(this.dogWorld.dogHost(), level.dog, PLAYER_GROUPS);
    this.owners.set(this.dog.collider.handle, { kind: 'dog' });
    this.vacuuming = new VacuumCleaner(this, fixed);
    this.vacuum = {
      heldBy: null,
      pos: level.vacuum.pos,
      yaw: level.vacuum.facing,
      leaning: true,
      sucked: -SUCK_TICKS,
      load: 0,
    };
    this.vacuuming.poseVacuum();
    // A replica receives the baseplates (and everything else) from the server.
    if (!this.replica) this.buildIds = this.placeBaseplates();
  }

  // ---------------------------------------------------------------- level

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
    // And each of the vehicles' doors, moved as a click opens or shuts it.
    for (const def of level.carDoors ?? []) {
      const { at, turn } = def.mesh;
      const body = world.createRigidBody(
        R.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(at.x, at.y, at.z)
          .setRotation(turn ?? IDENTITY),
      );
      for (const desc of meshDescs(R, { mesh: def.mesh.mesh, at: v3() })) {
        const c = world.createCollider(desc.setFriction(0.8), body);
        this.owners.set(c.handle, { kind: 'carDoor', group: def.group });
      }
      this.carDoors.push({ def, body, open: 0 });
    }
    for (const machine of level.machines) this.works.addMachine(machine, fixed);
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
      this.hiding.setOpen(h, false);
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
    this.pageWork.boards.forEach((b, i) => {
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

  newId(): number {
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

  addCollider(a: Assembly, b: PlacedBrick): void {
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
  collidersChanged(a: Assembly): void {
    if (a.anchored || this.replica) return;
    const { RigidBodyType } = this.R;
    const linvel = a.body.linvel();
    const angvel = a.body.angvel();
    a.body.setBodyType(RigidBodyType.Fixed, false);
    a.body.setBodyType(RigidBodyType.Dynamic, true);
    a.body.setLinvel(linvel, true);
    a.body.setAngvel(angvel, true);
  }

  removeCollider(a: Assembly, brickId: number): void {
    const cs = a.colliders.get(brickId);
    if (!cs) return;
    for (const c of cs) {
      this.owners.delete(c.handle);
      this.world.removeCollider(c, true);
    }
    a.colliders.delete(brickId);
  }

  removeAssembly(a: Assembly): void {
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
  resplit(a: Assembly, broken: Connection[] = [], main?: number): Assembly[] {
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

  setHeld(a: Assembly, playerId: number | null): void {
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
      this.placing.release(p);
      this.works.putToolAway(p);
      this.vacuuming.putVacuumDown(p);
      this.pageWork.dropPage(p);
      for (const kind of [...p.gear]) this.gearHunt.dropGear(p, kind);
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

  heldAssembly(p: Player): Assembly | undefined {
    return p.holding ? this.assemblies.get(p.holding.assemblyId) : undefined;
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
        this.placing.release(p);
        return;
      }
    }
    const err = sub(target.pos, com);
    if (length(err) > 2.5) {
      this.placing.release(p);
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
    // up, or they set about clearing its jam), or the broken panel they set about fixing: they
    // go up to it and work it.
    const hit = this.sight.aim(p);
    // Working a machine, their hands are busy with it: they may do no more than it (and turn
    // or flip what they hold) till they are done.
    const w = p.work;
    const on = hit?.owner.kind === 'machine' || hit?.owner.kind === 'output' ? hit.owner : null;
    if (w?.machineId != null && !HANDS_FREE.includes(action.kind) && on?.machineId !== w.machineId)
      return;
    const [events, version] = [this.events.length, this.furnitureVersion];
    this.doAct(p, action);
    const did = this.events.length !== events || this.furnitureVersion !== version;
    if (did && (hit?.owner.kind === 'machine' || hit?.owner.kind === 'output')) {
      const { machineId } = hit.owner;
      const slot = hit.owner.kind === 'output' ? hit.owner.slot : -1;
      const raised = this.events.slice(events);
      const done = raised.find((e) => e.machineId === machineId);
      const took = raised.some((e) => e.kind === 'grab');
      const { act, at } = actOf(done, slot, this.machines.get(machineId)?.def.kind, took);
      // (Nothing the machine did for them, as putting a tool away in front of it: no work.)
      if (act !== 'work') this.working.startWork(p, machineId, hit, act, at);
      // What it makes is only begun once their hands set it going, and they wait for it there.
      if (p.work && done && MAKES.includes(done.kind)) {
        p.work.delays = true;
        p.work.awaits = done.slot ?? -1;
      }
    } else if (did && hit?.owner.kind === 'panel' && this.power.fixer === p.id)
      this.working.startWork(p, null, hit, 'fix');
  }

  private doAct(p: Player, action: Action): void {
    switch (action.kind) {
      case 'grab':
        return this.carrying.grab(p, action.output === true);
      case 'suck':
        return p.handsOff || this.vacuum.heldBy !== p.id ? undefined : this.vacuuming.suck(p, true);
      case 'pull':
        return p.handsOff ? undefined : this.knocks.pull(p);
      case 'place':
        return p.handsOff ? undefined : this.placing.place(p, action.output === true);
      case 'drop':
      case 'throw':
        if (this.vacuum.heldBy === p.id) return this.vacuuming.putVacuumDown(p);
        if (p.tool) return this.works.putToolAway(p);
        return action.kind === 'drop' ? this.placing.setDown(p) : this.placing.throwHeld(p);
      case 'rotate':
        if (!p.holding) return;
        if (action.step === 'quarter') p.holding.rot = ((p.holding.rot + 1) % 4) as Rotation;
        else if (action.step === 'eighth') p.holding.eighth = !p.holding.eighth;
        // A part in hand that would hang on one stud alone turns 45° a step, else a quarter.
        else if (!p.holding.eighth && this.placing.snap(p, { eighth: true })?.preview.turned45)
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
        return this.pageWork.dropPage(p);
      case 'unequip':
        return this.gearHunt.dropGear(p, action.gear);
      case 'fill':
        return p.handsOff ? undefined : this.works.fillBucket(p, action.colour);
      case 'mould':
        return p.handsOff ? undefined : this.works.dispenseMould(p, action.type);
      case 'print':
        return p.handsOff ? undefined : this.works.printPart(p, action.job);
      case 'sabotage':
        return;
    }
  }

  /** Pages and buttons work whether or not the player has their hands full. */
  interact(p: Player, hit: AimHit | null): boolean {
    // The other team's side: look, but do not touch.
    if (hit && !this.mayUse(p, hit.point)) return true;
    if (hit?.owner.kind === 'page') {
      const page = this.pages.get(hit.owner.pageId);
      if (page) this.pageWork.takePage(p, page);
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
      this.hiding.toggleHideout(hit.owner.hideoutId, p.id);
      return true;
    }
    if (hit?.owner.kind === 'gadget') {
      const g = this.gadgets.get(hit.owner.gadgetId);
      if (g) this.hiding.setUsed(g, !g.used);
      return true;
    }
    if (hit?.owner.kind === 'carDoor') {
      this.clickCarDoor(hit.owner.group);
      return true;
    }
    if (hit?.owner.kind === 'player') {
      this.carrying.pickpocket(p, hit.owner.playerId);
      return true;
    }
    if (hit?.owner.kind === 'gear') {
      const item = this.gear.get(hit.owner.gearId);
      if (item) this.gearHunt.takeGear(p, item);
      return true;
    }
    if (hit?.owner.kind === 'dog') {
      if (p.gear.has('leash') && !this.dog.leashed) this.gearHunt.leashDog(p);
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
      if (p.page !== null) this.pageWork.pinPocketPage(p, hit.owner.board, hit.point);
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
      if (!p.holding && !p.tool && !p.handsOff && this.vacuum.heldBy === null)
        this.vacuuming.takeVacuum(p);
      return true;
    }
    if (hit?.owner.kind === 'trashBin') {
      // What is in hand goes in the bin, or what is in the vacuum; with nothing in hand a click
      // on a bin does nothing.
      const held = this.heldAssembly(p);
      if (held && !this.isBuild(held.id)) this.throwAway(held, hit.owner.bin, p.id);
      else if (this.vacuum.heldBy === p.id) this.vacuuming.emptyVacuum(hit.owner.bin, p.id);
      return true;
    }
    return false;
  }

  setAnchored(a: Assembly, anchored: boolean): void {
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
  tidyLooseBricks(): void {
    const lying = [...this.assemblies.values()].filter((a) => isLooseBrick(a) && a.heldBy === null);
    // The map keeps insertion order, so the first ones have lain there longest.
    for (const a of lying.slice(0, Math.max(0, lying.length - this.looseLimit))) {
      this.removeAssembly(a);
    }
  }

  // ---------------------------------------------------------------- meetings

  /** Lets go of whatever the player holds (bricks fall, the pocketed page stays). */
  dropHeld(p: Player): void {
    this.placing.release(p);
    this.vacuuming.putVacuumDown(p);
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
    p.work = null;
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
    const page = this.pages.get(id) ?? this.pageWork.newPage(printed, id);
    // A page first seen unread (in someone's pocket) learns which it is once it can be read.
    if (printed) page.step = printed.step;
    // Which hiding place it is in is never told, only that it is in one.
    page.hideout = null;
    if (where.pinned !== null) {
      page.printed = printed;
      page.carriedBy = null;
      page.hidden = false;
      this.pageWork.pinPage(page, where.pinned);
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
    if (carriedBy === null && !where.hidden && !where.dog) this.pageWork.placePage(page, pos, rot);
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
    const item = this.gear.get(id) ?? this.gearHunt.newGear(kind, id);
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
      if (!this.dog.leashed) this.dog.leash(this.gearHunt.dogPole());
      return;
    }
    item.placed = false;
    item.wornBy = wornBy;
    if (wornBy === null && !where.hidden) this.gearHunt.placeGear(item, pos, rot);
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
      carDoors: [...this.carDoorsClicked],
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
      this.hiding.setOpen(h, f.open.includes(h.def.id));
      h.locked = f.locked.includes(h.def.id);
    }
    for (const g of this.gadgets.values()) this.hiding.setUsed(g, f.used.includes(g.def.id));
    this.carDoorsClicked.clear();
    for (const group of f.carDoors ?? []) this.carDoorsClicked.add(group);
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

  /** How far each of the level's sliding doors is open (0 to 1), in the level's order. */
  doorsOpen(): number[] {
    return this.doors.map((d) => d.open);
  }

  /** How far each of the vehicles' doors is open (0 to 1), in the level's order. */
  carDoorsOpen(): number[] {
    return this.carDoors.map((d) => d.open);
  }

  /** What a click on a vehicle's door of `group` does: `open the door`, `shut the bonnet`… */
  carDoorHint(group: number): string {
    const what = this.carDoors.find((d) => d.def.group === group)?.def.what ?? 'door';
    return `${this.carDoorsClicked.has(group) ? 'shut' : 'open'} the ${what}`;
  }

  /** Opens a vehicle's door of `group` (and those that open with it), or shuts it. */
  private clickCarDoor(group: number): void {
    if (!this.carDoorsClicked.delete(group)) this.carDoorsClicked.add(group);
    this.furnitureVersion++;
  }

  /**
   * Slides each sliding door on toward open while anyone (a player or the dog) is by it, else
   * shut; and each of the vehicles' doors toward open or shut, as it was last clicked.
   */
  private slideDoors(): void {
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
    for (const d of this.carDoors) {
      const step = ((this.carDoorsClicked.has(d.def.group) ? 1 : -1) * DT) / DOOR_TIME;
      const open = Math.min(1, Math.max(0, d.open + step));
      if (open === d.open) continue;
      d.open = open;
      const { at, turn } = carDoorPose(d.def, open);
      d.body.setNextKinematicTranslation(at);
      d.body.setNextKinematicRotation(turn);
    }
  }

  /**
   * `world.step()` without what it does afterwards: walking every body and collider through
   * JavaScript callbacks to pick up any the step itself created or removed. Ours never are:
   * they are created and removed through the world, which keeps its lookup tables up to date.
   * That walk made ~5 KB of garbage per step, twice per tick in a solo game (server and
   * client), and the garbage collection it caused showed up as a hitch every few seconds.
   */
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
        this.movement.movePlayer(p, [p.input]);
        this.placing.trackSnapLock(p);
        this.carrying.tire(p);
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
      if (inputs.length) this.movement.movePlayer(p, inputs);
      this.applyHold(p);
      this.placing.trackSnapLock(p);
      this.carrying.tire(p);
      this.knocks.maybeTrip(p);
      this.knocks.stepOnBricks(p);
    }
    this.dog.update();
    this.working.updatePower();
    this.works.updateJams();
    this.works.updateMaking();
    for (const a of this.assemblies.values()) {
      if (a.anchored) continue;
      a.prevLinvel = a.body.linvel();
      a.prevAngvel = a.body.angvel();
    }
    this.slideDoors();
    this.stepWorld();
    this.tick++;
    this.knocks.knockDownHitPlayers();
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
  aboveGround(at: Vec3, lift: number, reach = 0): Vec3 {
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

  /**
   * Where the player's camera is: behind their shoulder, pulled in where it would be in
   * something (see `sightline`). Aiming starts here, so clicks land on the crosshair.
   */
  camera(p: Player, eye: Vec3 = this.eye(p), input: PlayerInput = p.input): Vec3 {
    return this.sight.camera(p, eye, input);
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
    return this.sight.sightline(p, from, to, radius);
  }

  /** What the player is aiming at, within reach (or would aim at with the view `ask`). */
  aim(p: Player, ask?: ViewAsk): AimHit | null {
    return this.sight.aim(p, ask);
  }

  /**
   * Where the held brick, or the held piece of bricks clutched together, would snap right now,
   * if anywhere. A build with the baseplate in it is never snapped onto anything. While a layer
   * is locked (Shift), the bricks keep to it for as long as they still clutch something there.
   */
  snapPreview(p: Player, ask?: ViewAsk): SnapPreview | null {
    return this.placing.snapPreview(p, ask);
  }

  /**
   * Where the head of the vacuum a player carries rests: on the floor where their crosshair
   * meets it, kept within reach in front of them. Looking up or far off, it goes as far out as
   * it reaches.
   */
  vacuumHead(p: Player): Vec3 {
    return this.vacuuming.vacuumHead(p);
  }

  /** Mirrors who carries the vacuum, or where it stands or lies, and how full it is. */
  replicaVacuum(
    heldBy: number | null,
    pos: Vec3,
    yaw: number,
    leaning: boolean,
    load: number,
  ): void {
    return this.vacuuming.replicaVacuum(heldBy, pos, yaw, leaning, load);
  }

  /**
   * Knocks a player over: what they carry keeps flying the way they fell, they slide a little
   * along `push` and lie there for `ticks`. Returns false if they were already down.
   */
  knockDown(p: Player, push: Vec3, ticks = DOWN_TICKS): boolean {
    return this.knocks.knockDown(p, push, ticks);
  }

  /**
   * The saboteur's clumsy mode: a trip like any other, except that whatever is just in front
   * takes the stumble. Loose builds get shoved; the job-site build loses what its weaker joints
   * held. Returns where it happened, or null if the player is already down.
   */
  clumsyTrip(p: Player): Vec3 | null {
    return this.knocks.clumsyTrip(p);
  }

  /** The saboteur's barefoot trap: a few small bricks spilled on the floor in front. */
  dropTrap(p: Player): Vec3 | null {
    return this.knocks.dropTrap(p);
  }

  /**
   * Whether nothing solid (walls, furniture, bins) lies between two points, for the dog; with
   * `wide`, across its whole width too, so a gap a thin line slips through but the dog does not,
   * a post it would walk into, or a corner it would brush, does not count as clear.
   */
  clearForDog(a: Vec3, b: Vec3, wide = false): boolean {
    return this.dogWorld.clearForDog(a, b, wide);
  }

  /**
   * Where the hungry dog stands to wreck the build: just off one side of the baseplate, the side
   * with the most bricks in its reach (the one nearest `from` if several tie), and clear of bins.
   */
  wreckTarget(from: Vec3): WreckTarget | null {
    return this.dogWorld.wreckTarget(from);
  }

  /**
   * The hungry dog's paws on the build: every brick in its reach comes off whatever holds it
   * up (taking what sits on it along), and is knocked away from the dog.
   */
  dogWreck(at: WreckTarget): boolean {
    return this.dogWorld.dogWreck(at);
  }

  /**
   * Where a page pinned to `slot` hangs: two rows of four on each face of a board, the front
   * (the side its `facing` looks toward) first, board after board.
   */
  slotPose(slot: number): { pos: Vec3; rot: Quat } {
    return this.pageWork.slotPose(slot);
  }

  /**
   * Pages the dog can jump up and take: those in the bottom row of either face (the top row is
   * out of its reach), with the spot on the floor in front of each where it stands to jump.
   */
  stealTargets(): StealTarget[] {
    return this.pageWork.stealTargets();
  }

  /**
   * Demo mode: pins a page straight to a corkboard slot, wherever it is (lying about, in a
   * pocket or shut in a hiding place). Whatever already hangs in that slot is left where it is.
   */
  pinToBoard(page: PageItem, slot: number): void {
    return this.pageWork.pinToBoard(page, slot);
  }

  /** Puts a printed page (step -1 is the master index) into the world, lying at `pos`. */
  spawnPage(printed: PrintedPage | null, pos: Vec3, yaw = 0, id = this.newId()): PageItem {
    return this.pageWork.spawnPage(printed, pos, yaw, id);
  }

  /** Puts a printed page straight into a hiding place, shut. */
  spawnPageInHideout(printed: PrintedPage | null, hideoutId: number): PageItem {
    return this.pageWork.spawnPageInHideout(printed, hideoutId);
  }

  /** Opens a hiding place (whatever is inside comes out) or shuts it again. */
  toggleHideout(id: number, playerId?: number): void {
    return this.hiding.toggleHideout(id, playerId);
  }

  /** Padlocks a hiding place (Gear Hunt), until someone with the key ring opens it. */
  lockHideout(id: number): void {
    return this.hiding.lockHideout(id);
  }

  /** Tucks a piece of gear into a hiding place and shuts it. */
  hideGearInHideout(item: GearItem, id: number): void {
    return this.hiding.hideGearInHideout(item, id);
  }

  /** Tucks a page into a hiding place and shuts it, out of everyone's sight. */
  hideInHideout(page: PageItem, id: number): void {
    return this.hiding.hideInHideout(page, id);
  }

  /** Puts a piece of gear into the world (Gear Hunt), lying at `pos`. */
  spawnGear(kind: GearId, pos: Vec3, yaw = 0, id = this.newId()): GearItem {
    return this.gearHunt.spawnGear(kind, pos, yaw, id);
  }

  /** Puts a piece of gear straight into a hiding place, shut. */
  spawnGearInHideout(kind: GearId, hideoutId: number): GearItem {
    return this.gearHunt.spawnGearInHideout(kind, hideoutId);
  }

  /** Takes a piece of gear off and drops it at the player's feet, for someone else. */
  dropGear(p: Player, kind: GearId): void {
    return this.gearHunt.dropGear(p, kind);
  }

  /** Where the dog's pole stands: by its kennel, at its starting point. */
  dogPole(): Vec3 {
    return this.gearHunt.dogPole();
  }

  /**
   * The leash's wearer clicked the dog: the leash goes on the pole with the dog at the end of
   * it, for the rest of the round. Returns false if the dog is leashed already.
   */
  leashDog(p: Player): boolean {
    return this.gearHunt.leashDog(p);
  }

  /**
   * Scatters a gear hunt's litter: small loose bricks around every dog point, which between
   * them cover every path through the yard and house. Returns how many were put down.
   */
  spawnLitter(perPoint: number, rng: () => number): number {
    return this.gearHunt.spawnLitter(perPoint, rng);
  }

  /** Whether the build is too heavy for this player to carry at more than a careful pace. */
  heavyFor(p: Player): boolean {
    return this.carrying.heavyFor(p);
  }

  /** Whether player `id` is fixing something: clearing a jammed machine, or the panel. */
  fixing(id: number): boolean {
    return this.working.fixing(id);
  }

  /** Who is fixing machine `machineId` (null: the electrical panel), if anyone. */
  fixerOf(machineId: number | null): number | null {
    return this.working.fixerOf(machineId);
  }

  /** The electrical panel breaks down: the lights stay out until someone fixes it. */
  breakPower(): void {
    return this.working.breakPower();
  }

  /**
   * The panel dies for the round (a gear hunt): the lights go out for good, and the brick
   * works run on a circuit of their own.
   */
  killPower(): void {
    return this.working.killPower();
  }

  /** The power comes back without anyone fixing the panel. */
  restorePower(): void {
    return this.working.restorePower();
  }

  /**
   * Whether the brick works' machines have power: they stop while the panel is out, but run on
   * a circuit of their own while it is dead for the round (`PowerState.dead`).
   */
  get machinesPowered(): boolean {
    return this.working.machinesPowered;
  }
}
