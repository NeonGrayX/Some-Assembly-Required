import type RAPIER from '@dimforge/rapier3d-compat';
import type {
  Collider,
  ColliderDesc,
  KinematicCharacterController,
  RigidBody,
  World,
} from '@dimforge/rapier3d-compat';
import { BRICK_TYPES, COLOURS, PLATE_H, STUD, footprint } from '../bricks.ts';
import type { BrickTypeId, ColourId, Rotation } from '../bricks.ts';
import { planBreaks } from '../breaking.ts';
import { DOG_ID, Dog } from './dog.ts';
import type { DogHost, StealTarget } from './dog.ts';
import type { Connection, Placement, PlacedBrick } from '../grid.ts';
import { BrickGrid, localCentre } from '../grid.ts';
import { computeGroupSnap } from '../snap.ts';
import type { PrintedPage } from '../builds/forgery.ts';
import type { TargetBuild } from '../builds/types.ts';
import {
  BIN_SIZE,
  BOARD_FACE_SLOTS,
  BOARD_SIZE,
  BOARD_SLOTS,
  BUTTON_SIZE,
} from '../content/house.ts';
import type { HideoutDef, LadderDef, LevelDef } from '../content/house.ts';
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

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

// Player
export const PLAYER_RADIUS = 0.3;
export const PLAYER_HALF_HEIGHT = 0.55;
/** Eye height above the capsule centre. */
export const EYE_OFFSET = 0.6;
const WALK_SPEED = 3.5;
const SPRINT_SPEED = 6;
const CAREFUL_SPEED = 1.3;
const JUMP_SPEED = 5;
const CLIMB_SPEED = 2.4;
const GRAVITY = 15;
const REACH = 2.6;

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
/** How hard a clumsy stumble knocks the build in front (velocity change, m/s). */
const CLUMSY_SEVERITY = 4.2;
/** How far in front of a stumbling player things get caught (m). */
const CLUMSY_REACH = 1.0;
/** Loose bricks lower than this above the floor under a player's feet hurt to step on. */
const STEP_HEIGHT = 0.2;
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

// Bricks
const BRICK_DENSITY = 300;
const COLLIDER_INSET = 0.003;
/**
 * A held brick sits in front of the player's chest, between the hands: `up` above the middle
 * of the body, its near face `front` ahead of it. Where the player looks does not move it.
 */
const HOLD = { up: 0.15, front: 0.27 };
const THROW_SPEED = 7;
/** Ticks after an assembly is created during which impacts do not break it. */
const BREAK_GRACE_TICKS = 20;
/** Bricks below this height are deleted. */
const KILL_Y = -20;
/**
 * Bins never run out, so this keeps the world from filling up: past this many single bricks
 * lying loose, taking one from a bin tidies away the one that has lain there longest.
 */
export const MAX_LOOSE_BRICKS = 200;

// Collision groups: membership in the high 16 bits, filter in the low 16 bits.
const G_WORLD = 0x1;
const G_PLAYER = 0x2;
const G_HELD = 0x4;
const groups = (member: number, filter: number) => (member << 16) | filter;
const WORLD_GROUPS = groups(G_WORLD, 0xffff);
const PLAYER_GROUPS = groups(G_PLAYER, G_WORLD | G_PLAYER);
const HELD_GROUPS = groups(G_HELD, G_WORLD | G_HELD);

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
  | { kind: 'grab' } // pick up an aimed loose brick or build, or take a brick from a bin
  | { kind: 'pull' } // pull the aimed brick off whatever it is attached to
  | { kind: 'place' } // snap the held brick, or drop it if there is no valid spot
  | { kind: 'drop' }
  | { kind: 'throw' }
  | { kind: 'rotate' }
  | { kind: 'dropPage' }
  /** Saboteur tools; the round checks who may use them and runs them. */
  | { kind: 'sabotage'; tool: 'swap' | 'forge' | 'hide' | 'clumsy' | 'trap' };

export interface Holding {
  assemblyId: number;
  /** Quarter turns relative to the player's heading (single bricks), or added to a build's. */
  rot: Rotation;
  /** Heading of the carried build relative to the player, kept from the moment of grabbing. */
  yawOffset: number;
  /** How far in front of the player a carried build is held. */
  reach: number;
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
  grounded: boolean;
  holding: Holding | null;
  /** The instruction page in the player's pocket, if any. */
  page: number | null;
  /** Ticks left lying on the ground after a trip or a hit (0: on their feet). */
  down: number;
  /** Ticks left limping after stepping on a brick. */
  limp: number;
  /** How the player slides along the floor while down. */
  slide: Vec3;
  /** Counts knock-downs, so clients start exactly one ragdoll for each. */
  knocks: number;
  /** Holding a dog treat from the jar in the kitchen. */
  treat: boolean;
  /** Moved by someone else's simulation (a remote player on a client); `step` leaves it alone. */
  replicated: boolean;
  /**
   * The inputs to move by in the next step, one tick each, in order. The server fills this with
   * the inputs that actually arrived (none: the player stands still rather than move on a
   * guess). Null means "one tick of the current input", for local play and tests.
   */
  pendingInputs: PlayerInput[] | null;
}

/**
 * An instruction page (or the master index) lying in the world (body set) or in someone's
 * pocket (body null).
 */
export interface PageItem {
  id: number;
  /** 0-based build step this page explains, or -1 for the master index. */
  step: number;
  /** What is printed on it. A forgery prints something slightly different. */
  printed: PrintedPage | null;
  body: RigidBody | null;
  carriedBy: number | null;
  /** The closed hiding place it is tucked into, out of sight (body null). */
  hideout: number | null;
  /** Corkboard slot it is pinned to (body fixed there). */
  pinned: number | null;
  /** Bumped when the page changes hands or content, so it gets sent again. */
  version: number;
}

/** A hiding place's state: open or shut, and the pages tucked inside. */
export interface HideoutState {
  def: HideoutDef;
  open: boolean;
  contents: number[];
  /** The door, drawer, lid, rug or cushion: solid while shut, walk-through while open. */
  part: Collider;
  /** The part that stays put, if any. Clicking it opens the hiding place, but not shuts it. */
  body: Collider | null;
  /** How far it opens before it would hit something: radians, or metres for a drawer. */
  opening: number;
}

export const PAGE_SIZE = { x: 0.3, y: 0.008, z: 0.42 };

export interface Assembly {
  id: number;
  grid: BrickGrid;
  body: RigidBody;
  colliders: Map<number, Collider>;
  /** Fixed in place (the job-site baseplate and everything attached to it). */
  anchored: boolean;
  heldBy: number | null;
  /** Bumped whenever the set of bricks changes, so renderers know to rebuild. */
  version: number;
  bornTick: number;
  prevLinvel: Vec3;
  prevAngvel: Vec3;
}

export type ColliderOwner =
  | { kind: 'brick'; assemblyId: number; brickId: number }
  | { kind: 'bin'; binId: number }
  | { kind: 'player'; playerId: number }
  | { kind: 'page'; pageId: number }
  | { kind: 'button'; buttonId: string }
  | { kind: 'hideout'; hideoutId: number }
  | { kind: 'board' }
  | { kind: 'dog' }
  | { kind: 'treats' }
  | { kind: 'static' };

export interface SimEvent {
  kind:
    | 'snap'
    | 'break'
    | 'grab'
    | 'drop'
    | 'page'
    | 'button'
    | 'anchor'
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
    | 'treat';
  pos: Vec3;
  /** Which way someone fell, for `trip` events. */
  dir?: Vec3;
  /** Only players within this many metres notice it (saboteur tells). */
  witnessRange?: number;
  /** Which button was pressed, for `button` events. */
  buttonId?: string;
  /** How many bricks were involved (picked up, set down, broken off), so big builds sound bigger. */
  count?: number;
  playerId?: number;
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
  /** World pose of the first brick's centre. */
  pos: Vec3;
  rot: Quat;
}

const QUARTER = Math.PI / 2;

/** Direction the player is looking. Yaw 0 looks down -z, positive pitch looks up. */
export function viewDir(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return v3(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
}

/** Camera position for a player, before any wall clipping the client may add. */
export function cameraPosition(eye: Vec3, input: PlayerInput): Vec3 {
  if (input.firstPerson) return eye;
  const dir = viewDir(input.yaw, input.pitch);
  const right = v3(Math.cos(input.yaw), 0, -Math.sin(input.yaw));
  return add(
    add(eye, scale(dir, -CAMERA_DISTANCE)),
    add(scale(right, CAMERA_SHOULDER), v3(0, CAMERA_LIFT, 0)),
  );
}

export interface SimOptions {
  /**
   * A client-side copy of a server's world. Bricks and pages become kinematic bodies posed
   * from snapshots; only non-replicated players (the local one) are simulated, for prediction.
   * Actions do nothing: they go to the server instead.
   */
  replica?: boolean;
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

/**
 * The physics world: assemblies of bricks, players, bins and the level. Rendering-agnostic:
 * the server runs it as the authority, clients run a replica of it.
 */
export class Sim {
  readonly world: World;
  readonly assemblies = new Map<number, Assembly>();
  readonly players = new Map<number, Player>();
  readonly pages = new Map<number, PageItem>();
  readonly hideouts = new Map<number, HideoutState>();
  /** Bumped when a hiding place opens or closes. */
  furnitureVersion = 0;
  /** The assembly holding the job-site baseplate: the build the team is making. */
  buildId = 0;
  /** Things that happened since the last drain, for sounds and effects. */
  events: SimEvent[] = [];
  tick = 0;
  /** The house dog (on a client, only where the server says it is). */
  dog!: Dog;

  readonly replica: boolean;

  private nextId = 1;
  private readonly owners = new Map<number, ColliderOwner>();
  private readonly rng: () => number;

  constructor(
    private readonly R: Rapier,
    readonly level: LevelDef,
    seed = 1,
    opts: SimOptions = {},
  ) {
    this.replica = opts.replica ?? false;
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = DT;
    this.rng = makeRng(seed);
    this.buildLevel();
  }

  // ---------------------------------------------------------------- level

  private buildLevel(): void {
    const { R, world, level } = this;
    const fixed = world.createRigidBody(R.RigidBodyDesc.fixed());
    const half = level.floorSize / 2;
    this.addStatic(R.ColliderDesc.cuboid(half, 0.5, half).setTranslation(0, -0.5, 0), fixed);
    for (const box of level.boxes) {
      const tilt = box.tiltX ?? 0;
      const desc = R.ColliderDesc.cuboid(box.size.x / 2, box.size.y / 2, box.size.z / 2)
        .setTranslation(box.pos.x, box.pos.y, box.pos.z)
        .setRotation({ x: Math.sin(tilt / 2), y: 0, z: 0, w: Math.cos(tilt / 2) });
      this.addStatic(desc, fixed);
    }
    for (const bin of level.bins) {
      const desc = R.ColliderDesc.cuboid(BIN_SIZE.x / 2, BIN_SIZE.y / 2, BIN_SIZE.z / 2)
        .setTranslation(bin.pos.x, bin.pos.y + BIN_SIZE.y / 2, bin.pos.z)
        .setFriction(0.8);
      const c = world.createCollider(desc, fixed);
      this.owners.set(c.handle, { kind: 'bin', binId: bin.id });
    }
    const btn = level.doneButton;
    const button = world.createCollider(
      R.ColliderDesc.cuboid(BUTTON_SIZE.x / 2, BUTTON_SIZE.y / 2, BUTTON_SIZE.z / 2).setTranslation(
        btn.x,
        btn.y + BUTTON_SIZE.y / 2,
        btn.z,
      ),
      fixed,
    );
    this.owners.set(button.handle, { kind: 'button', buttonId: 'done' });
    const bell = world.createCollider(
      R.ColliderDesc.cuboid(BUTTON_SIZE.x / 2, BUTTON_SIZE.y / 2, BUTTON_SIZE.z / 2).setTranslation(
        level.bell.x,
        level.bell.y + BUTTON_SIZE.y / 2,
        level.bell.z,
      ),
      fixed,
    );
    this.owners.set(bell.handle, { kind: 'button', buttonId: 'bell' });
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
        contents: [],
        part,
        body,
        opening: openingIn(level, def),
      };
      this.hideouts.set(def.id, h);
      this.setOpen(h, false);
    }
    const b = level.board;
    const board = world.createCollider(
      R.ColliderDesc.cuboid(BOARD_SIZE.x / 2, BOARD_SIZE.y / 2, BOARD_SIZE.z / 2)
        .setTranslation(b.pos.x, b.pos.y, b.pos.z)
        .setRotation(yawQuat(b.facing)),
      fixed,
    );
    this.owners.set(board.handle, { kind: 'board' });
    const jar = level.dog.treatJar;
    const treats = world.createCollider(
      R.ColliderDesc.cylinder(0.09, 0.08).setTranslation(jar.x, jar.y + 0.09, jar.z),
      fixed,
    );
    this.owners.set(treats.handle, { kind: 'treats' });
    this.dog = new Dog(this.dogHost(), level.dog, PLAYER_GROUPS, this.replica);
    this.owners.set(this.dog.collider.handle, { kind: 'dog' });
    // A replica receives the baseplate (and everything else) from the server.
    if (this.replica) return;
    this.buildId = this.createAssembly(
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
      level.baseplate,
      IDENTITY,
      true,
    ).id;
  }

  private addStatic(desc: ColliderDesc, body: RigidBody): void {
    const c = this.world.createCollider(desc.setFriction(0.8), body);
    this.owners.set(c.handle, { kind: 'static' });
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
      heldBy: null,
      version: 0,
      bornTick: this.tick,
      prevLinvel: linvel,
      prevAngvel: angvel,
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
    const { w, d } = footprint(b.type, b.rot);
    const h = BRICK_TYPES[b.type].plates;
    const c = localCentre(b);
    const desc = this.R.ColliderDesc.cuboid(
      (w * STUD) / 2 - COLLIDER_INSET,
      (h * PLATE_H) / 2 - COLLIDER_INSET,
      (d * STUD) / 2 - COLLIDER_INSET,
    )
      .setTranslation(c.x, c.y, c.z)
      .setDensity(BRICK_DENSITY)
      .setFriction(0.9)
      .setRestitution(0.05)
      .setCollisionGroups(a.heldBy === null ? WORLD_GROUPS : HELD_GROUPS);
    const collider = this.world.createCollider(desc, a.body);
    a.colliders.set(b.id, collider);
    this.owners.set(collider.handle, { kind: 'brick', assemblyId: a.id, brickId: b.id });
  }

  private removeCollider(a: Assembly, brickId: number): void {
    const c = a.colliders.get(brickId);
    if (!c) return;
    this.owners.delete(c.handle);
    this.world.removeCollider(c, true);
    a.colliders.delete(brickId);
  }

  private removeAssembly(a: Assembly): void {
    for (const c of a.colliders.values()) this.owners.delete(c.handle);
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
  ): Assembly {
    const b: PlacedBrick = { id, type, colour, x: 0, y: 0, z: 0, rot: 0 };
    const pos = sub(centre, rotate(rot, localCentre(b)));
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
    a.version++;
    return placed;
  }

  /** World pose of a placement's centre inside an assembly. */
  brickPose(a: Assembly, p: Placement): { pos: Vec3; rot: Quat } {
    const bodyRot = a.body.rotation();
    return {
      pos: add(a.body.translation(), rotate(bodyRot, localCentre(p))),
      rot: mulQuat(bodyRot, yawQuat(p.rot * QUARTER)),
    };
  }

  /**
   * Re-splits an assembly into connected pieces (optionally ignoring `broken` joints).
   * The piece holding the baseplate (or the largest piece) stays in `a`; the others
   * become new dynamic assemblies at the same pose and velocity.
   */
  private resplit(a: Assembly, broken: Connection[] = []): Assembly[] {
    const parts = a.grid.components(broken);
    if (parts.length <= 1) return [];
    // The piece with the baseplate keeps the assembly, so the team's build keeps its id.
    const withFixture = parts.findIndex((ids) =>
      ids.some((id) => BRICK_TYPES[a.grid.bricks.get(id)!.type].fixture),
    );
    const keep = Math.max(0, withFixture);
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
    a.version++;
    a.bornTick = this.tick;
    return created;
  }

  private setHeld(a: Assembly, playerId: number | null): void {
    a.heldBy = playerId;
    const g = playerId === null ? WORLD_GROUPS : HELD_GROUPS;
    for (const c of a.colliders.values()) c.setCollisionGroups(g);
    a.body.wakeUp();
  }

  // ---------------------------------------------------------------- players

  addPlayer(opts: { id?: number; replicated?: boolean; spawn?: Vec3 } = {}): Player {
    const { R, world } = this;
    const spawn = opts.spawn ?? this.level.spawn;
    const body = world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(
        spawn.x,
        spawn.y + PLAYER_HALF_HEIGHT + PLAYER_RADIUS,
        spawn.z,
      ),
    );
    const collider = world.createCollider(
      R.ColliderDesc.capsule(PLAYER_HALF_HEIGHT, PLAYER_RADIUS).setCollisionGroups(PLAYER_GROUPS),
      body,
    );
    const controller = world.createCharacterController(0.02);
    controller.enableAutostep(0.3, 0.15, true);
    controller.enableSnapToGround(0.3);
    controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    controller.setApplyImpulsesToDynamicBodies(true);
    controller.setCharacterMass(70);
    const p: Player = {
      id: opts.id ?? this.newId(),
      body,
      collider,
      controller,
      input: emptyInput(),
      vy: 0,
      grounded: false,
      holding: null,
      page: null,
      down: 0,
      limp: 0,
      slide: v3(),
      knocks: 0,
      treat: false,
      replicated: opts.replicated ?? false,
      pendingInputs: null,
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
      this.dropPage(p);
    }
    this.owners.delete(p.collider.handle);
    this.world.removeCharacterController(p.controller);
    this.world.removeRigidBody(p.body);
    this.players.delete(id);
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
      const pace = i.careful ? CAREFUL_SPEED : i.sprint && !limping ? SPRINT_SPEED : WALK_SPEED;
      const speed = (pace / (1 + load / 40)) * (limping && !i.careful ? LIMP_FACTOR : 1);
      const f = v3(-Math.sin(i.yaw), 0, -Math.cos(i.yaw));
      const r = v3(Math.cos(i.yaw), 0, -Math.sin(i.yaw));
      let move = add(scale(f, i.forward), scale(r, i.right));
      const len = length(move);
      if (len > 1) move = scale(move, 1 / len);
      move = scale(move, speed);
      if (p.limp > 0) p.limp--;
      // Lying on the ground: no control, just the slide from the fall.
      const down = p.down > 0;
      if (down) {
        p.down--;
        move = p.slide;
        p.slide = scale(p.slide, 0.9);
      }
      const ladder = down ? undefined : this.ladderAt(add(start, total));
      if (ladder && !i.jump) {
        // On a ladder: forward climbs, back climbs down, otherwise hang on.
        p.vy = i.forward > 0 ? CLIMB_SPEED : i.forward < 0 ? -CLIMB_SPEED : 0;
      } else if (p.grounded && i.jump && !down) p.vy = JUMP_SPEED;
      // Standing on something: no push into it (snap-to-ground keeps the feet down). Pushing
      // into the floor every tick makes the controller stall now and then.
      else if (p.grounded && p.vy <= 0) p.vy = 0;
      else p.vy -= GRAVITY * DT;
      const desired = v3(move.x * DT, p.vy * DT, move.z * DT);
      p.controller.computeColliderMovement(p.collider, desired, undefined, PLAYER_GROUPS);
      const m = p.controller.computedMovement();
      const wasFalling = !p.grounded ? p.vy : 0;
      p.grounded = p.controller.computedGrounded();
      if (p.grounded && wasFalling < -HARD_LANDING_SPEED && !this.replica) {
        this.knockDown(p, scale(f, 0.6), LANDING_DOWN_TICKS);
      }
      if (p.grounded && p.vy < 0) p.vy = 0;
      // Bumped our head.
      if (p.vy > 0 && m.y < desired.y * 0.5) p.vy = 0;
      total = add(total, m);
      // Slide the collider along so the next tick's move starts from the right place.
      if (k < inputs.length - 1) p.collider.setTranslation(add(start, total));
    }
    p.body.setNextKinematicTranslation(add(p.body.translation(), total));
  }

  /** The ladder a player's centre is on, if any. */
  private ladderAt(centre: Vec3): LadderDef | undefined {
    return this.level.ladders.find((l) => {
      const local = rotate(conj(yawQuat(l.facing)), sub(centre, l.pos));
      return (
        Math.abs(local.x) < l.width / 2 &&
        Math.abs(local.z) < PLAYER_RADIUS + 0.25 &&
        local.y > 0 &&
        local.y < l.height
      );
    });
  }

  /**
   * Where the player's camera is: behind their shoulder, pulled in front of walls and ceilings
   * so it never looks through them. Aiming starts here, so clicks land on the crosshair.
   */
  camera(p: Player, eye: Vec3 = this.eye(p), input: PlayerInput = p.input): Vec3 {
    const cam = cameraPosition(eye, input);
    const offset = sub(cam, eye);
    const dist = length(offset);
    if (dist < 1e-3) return cam;
    const dir = scale(offset, 1 / dist);
    const held = p.holding ? this.assemblies.get(p.holding.assemblyId)?.body : undefined;
    const hit = this.world.castRay(
      new this.R.Ray(eye, dir),
      dist,
      true,
      this.R.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      p.collider,
      held,
      // Players and anything the sim does not own (a client's ragdolls) do not block it.
      (c) => {
        const o = this.owners.get(c.handle);
        return o !== undefined && o.kind !== 'player' && o.kind !== 'dog';
      },
    );
    return hit ? add(eye, scale(dir, Math.max(0.2, hit.timeOfImpact - 0.15))) : cam;
  }

  /** What the player is aiming at, within reach. */
  aim(p: Player): AimHit | null {
    const eye = this.eye(p);
    const cam = this.camera(p, eye, p.input);
    const dir = viewDir(p.input.yaw, p.input.pitch);
    // Start level with the player so things between the camera and the player are skipped.
    const skip = Math.max(0, dot(sub(eye, cam), dir) - 0.4);
    const origin = add(cam, scale(dir, skip));
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
        // Not the brick in hand, nor anything the sim does not own (a client's ragdolls).
        return o !== undefined && !(o.kind === 'brick' && o.assemblyId === heldId);
      },
    );
    if (!hit) return null;
    const owner = this.owners.get(hit.collider.handle) ?? { kind: 'static' as const };
    return {
      point: add(origin, scale(dir, hit.timeOfImpact)),
      normal: hit.normal,
      distance: skip + hit.timeOfImpact,
      owner,
    };
  }

  /**
   * Where a held assembly's centre of mass is pulled toward, and how its body is turned. A
   * single brick may sit anywhere in its body (a piece broken off a build keeps its place in
   * the build's grid), so it is turned by its own heading to face `h.rot` across the hands.
   */
  holdTarget(p: Player, h: Holding, a: Assembly | null): { pos: Vec3; rot: Quat } {
    const eye = this.eye(p);
    const yaw = p.input.yaw;
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
    return {
      pos: add(eye, add(scale(f, PLAYER_RADIUS + h.reach), v3(0, -0.6, 0))),
      rot: yawQuat(yaw + h.yawOffset + h.rot * QUARTER),
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
    const [k, blend, kA, blendA, lift] = single ? [18, 0.6, 14, 0.6, 1] : [9, 0.2, 5, 0.12, 0.85];
    const lv = a.body.linvel();
    const v = add(lv, scale(sub(scale(err, k), lv), blend));
    v.y += 9.81 * DT * lift;
    a.body.setLinvel(v, true);
    const av = a.body.angvel();
    const rotErr = rotationError(a.body.rotation(), target.rot);
    a.body.setAngvel(add(av, scale(sub(scale(rotErr, kA), av), blendA)), true);
  }

  // ---------------------------------------------------------------- actions

  act(playerId: number, action: Action): void {
    const p = this.players.get(playerId);
    // Lying on the ground, nobody can do anything.
    if (!p || this.replica || p.down > 0) return;
    switch (action.kind) {
      case 'grab':
        return this.grab(p);
      case 'pull':
        return this.pull(p);
      case 'place':
        return this.place(p);
      case 'drop':
        return this.setDown(p);
      case 'throw':
        return this.throwHeld(p);
      case 'rotate':
        if (p.holding) p.holding.rot = ((p.holding.rot + 1) % 4) as Rotation;
        return;
      case 'dropPage':
        return this.dropPage(p);
      case 'sabotage':
        return;
    }
  }

  private hold(p: Player, a: Assembly): void {
    const com = a.body.worldCom();
    let reach = 0.2;
    for (const b of a.grid.bricks.values()) {
      const t = this.brickPose(a, b).pos;
      const { w, d } = footprint(b.type, b.rot);
      reach = Math.max(reach, Math.hypot(t.x - com.x, t.z - com.z) + (Math.max(w, d) * STUD) / 2);
    }
    p.holding = {
      assemblyId: a.id,
      rot: 0,
      yawOffset: yawOf(a.body.rotation()) - p.input.yaw,
      reach,
      settingDown: null,
    };
    this.setHeld(a, p.id);
    this.events.push({ kind: 'grab', pos: com, count: a.grid.bricks.size });
  }

  /** Pages and buttons work whether or not the player has their hands full. */
  private interact(p: Player, hit: AimHit | null): boolean {
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
      });
      return true;
    }
    if (hit?.owner.kind === 'hideout') {
      this.toggleHideout(hit.owner.hideoutId, p.id);
      return true;
    }
    if (hit?.owner.kind === 'dog') {
      this.dog.clicked(p);
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
      if (p.page !== null) this.pinPocketPage(p, hit.point);
      return true;
    }
    return false;
  }

  private grab(p: Player): void {
    const hit = this.aim(p);
    if (this.interact(p, hit) || p.holding || !hit) return;
    if (hit.owner.kind === 'bin') {
      const binId = hit.owner.binId;
      const bin = this.level.bins.find((b) => b.id === binId)!;
      const h: Holding = { assemblyId: 0, rot: 0, yawOffset: 0, reach: 0, settingDown: null };
      const target = this.holdTarget(p, h, null);
      const a = this.spawnBrick(bin.type, bin.colour, target.pos, target.rot);
      this.hold(p, a);
      this.tidyLooseBricks();
      return;
    }
    if (hit.owner.kind !== 'brick') return;
    const a = this.assemblies.get(hit.owner.assemblyId);
    if (!a || a.heldBy !== null) return;
    if (a.anchored) {
      // Grabbing the baseplate itself lifts the whole build off the job site (to carry it to
      // the inspector). Grabbing any other brick of it takes just that brick.
      const brick = a.grid.bricks.get(hit.owner.brickId)!;
      if (!BRICK_TYPES[brick.type].fixture) return this.pull(p);
      this.setAnchored(a, false);
    }
    this.hold(p, a);
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
  finishBuild(target: TargetBuild): void {
    const a = this.build();
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
   * team's build. Returns how many bricks were cleared.
   */
  clearLoose(): number {
    let cleared = 0;
    for (const a of [...this.assemblies.values()]) {
      if (a.id === this.buildId) continue;
      cleared += a.grid.size;
      this.removeAssembly(a);
    }
    return cleared;
  }

  /** Where the job-site baseplate's centre sits when the build is at home. */
  private homeCentre(): Vec3 {
    const b = this.level.baseplate;
    return v3(b.x + 0.8, b.y + PLATE_H / 2, b.z + 0.8);
  }

  /** The team's build (the assembly holding the baseplate). */
  build(): Assembly {
    return this.assemblies.get(this.buildId)!;
  }

  /** Baseplate centre of the team's build, wherever it is. */
  buildCentre(): Vec3 {
    const a = this.build();
    const plate = [...a.grid.bricks.values()].find((b) => BRICK_TYPES[b.type].fixture)!;
    return this.brickPose(a, plate).pos;
  }

  /** Puts a build set down at the job site back in its fixed place, squared to the grid. */
  private reanchorBuild(): void {
    const a = this.build();
    if (a.anchored || a.heldBy !== null || this.tick - a.bornTick < BREAK_GRACE_TICKS) return;
    const home = this.homeCentre();
    const centre = this.buildCentre();
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

  // ---------------------------------------------------------------- bins

  /** Puts a held single brick back into the bin it came from (same type and colour). */
  private returnToBin(p: Player, binId: number): boolean {
    const held = this.heldAssembly(p);
    const bin = this.level.bins.find((b) => b.id === binId);
    const brick = held?.grid.size === 1 ? held.grid.bricks.values().next().value : undefined;
    if (!held || !bin || !brick || brick.type !== bin.type || brick.colour !== bin.colour) {
      return false;
    }
    this.removeAssembly(held);
    this.events.push({ kind: 'drop', pos: add(bin.pos, v3(0, BIN_SIZE.y, 0)) });
    return true;
  }

  /** Removes the longest-lying loose bricks while there are more than `MAX_LOOSE_BRICKS`. */
  private tidyLooseBricks(): void {
    const lying = [...this.assemblies.values()].filter((a) => isLooseBrick(a) && a.heldBy === null);
    // The map keeps insertion order, so the first ones have lain there longest.
    for (const a of lying.slice(0, Math.max(0, lying.length - MAX_LOOSE_BRICKS))) {
      this.removeAssembly(a);
    }
  }

  // ---------------------------------------------------------------- hiding places

  /** Opens a hiding place (whatever is inside comes out) or shuts it again. */
  toggleHideout(id: number, playerId?: number): void {
    const h = this.hideouts.get(id);
    if (!h) return;
    this.setOpen(h, !h.open);
    this.events.push({ kind: h.open ? 'open' : 'close', pos: h.def.pos, playerId });
    if (!h.open) return;
    const drop = dropSpot(this.level, h.def);
    h.contents.forEach((pageId, i) => {
      const page = this.pages.get(pageId);
      if (!page) return;
      page.hideout = null;
      this.placePage(page, add(drop, v3((i % 2) * 0.12, i * 0.02, 0)), yawQuat(h.def.facing));
      page.version++;
    });
    h.contents = [];
  }

  /** Tucks a page into a hiding place and shuts it, out of everyone's sight. */
  hideInHideout(page: PageItem, id: number): void {
    const h = this.hideouts.get(id);
    if (!h) return;
    this.detachPage(page);
    page.hideout = id;
    page.version++;
    h.contents.push(page.id);
    if (h.open) this.setOpen(h, false);
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
   * Where a page pinned to `slot` hangs: two rows of four on each face of the board, the front
   * (the side its `facing` looks toward) first.
   */
  slotPose(slot: number): { pos: Vec3; rot: Quat } {
    const b = this.level.board;
    const face = Math.floor(slot / BOARD_FACE_SLOTS);
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
    const b = this.level.board;
    const targets: StealTarget[] = [];
    for (const page of this.pages.values()) {
      const slot = page.pinned;
      if (slot === null || !page.body || slot % BOARD_FACE_SLOTS < 4) continue;
      const face = Math.floor(slot / BOARD_FACE_SLOTS);
      const out = rotate(yawQuat(b.facing + face * Math.PI), v3(0, 0, -1));
      const at = this.slotPose(slot).pos;
      targets.push({ page, stand: v3(at.x + out.x * 0.45, 0, at.z + out.z * 0.45) });
    }
    return targets;
  }

  /** Which face of the board a point is on: 0 for the front, 1 for the back. */
  private boardFace(at: Vec3): number {
    const b = this.level.board;
    const local = rotate(conj(yawQuat(b.facing)), sub(at, b.pos));
    return local.z < 0 ? 0 : 1;
  }

  /**
   * Pins the page in the player's pocket to the free slot closest to where they clicked, on the
   * face they clicked.
   */
  private pinPocketPage(p: Player, at: Vec3): void {
    const page = p.page === null ? undefined : this.pages.get(p.page);
    if (!page) return;
    const face = this.boardFace(at);
    const taken = new Set([...this.pages.values()].map((x) => x.pinned));
    const free = Array.from({ length: BOARD_SLOTS }, (_, i) => i).filter(
      (i) => !taken.has(i) && Math.floor(i / BOARD_FACE_SLOTS) === face,
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
    if (slot < 0 || slot >= BOARD_SLOTS) return;
    if (page.hideout !== null) {
      const h = this.hideouts.get(page.hideout);
      if (h) h.contents = h.contents.filter((id) => id !== page.id);
      page.hideout = null;
    }
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

  /** Puts a printed page (step -1 is the master index) into the world. */
  spawnPage(printed: PrintedPage | null, pos: Vec3, yaw = 0, id = this.newId()): PageItem {
    const page: PageItem = {
      id,
      step: printed?.step ?? -1,
      printed,
      body: null,
      carriedBy: null,
      hideout: null,
      pinned: null,
      version: 0,
    };
    this.pages.set(page.id, page);
    this.placePage(page, pos, yawQuat(yaw));
    return page;
  }

  private placePage(page: PageItem, pos: Vec3, rot: Quat, linvel: Vec3 = v3()): void {
    const { R } = this;
    const body = this.world.createRigidBody(
      (this.replica ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.dynamic())
        .setTranslation(pos.x, pos.y + PAGE_SIZE.y / 2 + 0.01, pos.z)
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
    const pos = add(this.eye(p), add(scale(f, 0.5), v3(0, -0.4, 0)));
    this.placePage(page, pos, yawQuat(yaw), scale(f, 1));
    page.version++;
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
    const near = COLOURS[b.colour].nearMiss.filter((c) => c !== 'baseplate-green');
    if (!near.length) return null;
    b.colour = near[0]!;
    a.version++;
    return hit.point;
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
    this.events.push({ kind: 'close', pos: h.def.pos, playerId: p.id });
    return h.def.pos;
  }

  // ---------------------------------------------------------------- meetings

  /** Lets go of whatever the player holds (bricks fall, the pocketed page stays). */
  dropHeld(p: Player): void {
    this.release(p);
  }

  // ---------------------------------------------------------------- the dog

  /** What the dog may do to the world: carry pages, and look around for walls. */
  private dogHost(): DogHost {
    const solid = new Set(['static', 'hideout', 'bin', 'board', 'button']);
    return {
      R: this.R,
      world: this.world,
      players: this.players,
      pages: this.pages,
      emit: (e) => this.events.push(e),
      random: () => this.rng(),
      stealTargets: () => this.stealTargets(),
      pickPageUp: (page) => {
        this.detachPage(page);
        page.carriedBy = DOG_ID;
        page.version++;
      },
      putPageDown: (page, pos, yaw) => {
        this.placePage(page, pos, yawQuat(yaw));
        page.version++;
      },
      clearLine: (a, b) => {
        const d = sub(b, a);
        const dist = length(d);
        if (dist < 1e-3) return true;
        const hit = this.world.castRay(
          new this.R.Ray(a, scale(d, 1 / dist)),
          dist,
          true,
          undefined,
          undefined,
          undefined,
          undefined,
          (c) => solid.has(this.owners.get(c.handle)?.kind ?? ''),
        );
        return !hit;
      },
    };
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
    if (held) held.body.setLinvel(add(held.body.linvel(), scale(push, 2)), true);
    const flat = v3(push.x, 0, push.z);
    const len = length(flat);
    p.slide = len > 1e-3 ? scale(flat, FALL_SLIDE / len) : v3();
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
    const feet = sub(p.body.translation(), v3(0, PLAYER_HALF_HEIGHT + PLAYER_RADIUS, 0));
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
    const feet = sub(p.body.translation(), v3(0, PLAYER_HALF_HEIGHT + PLAYER_RADIUS, 0));
    TRAP_BRICKS.forEach(({ type, colour }, i) => {
      const at = add(feet, add(scale(fwd, 0.7 + 0.25 * (i % 2)), scale(right, (i - 1) * 0.3)));
      this.spawnBrick(type, colour, add(at, v3(0, 0.15, 0)), yawQuat(this.rng() * Math.PI));
    });
    const at = add(feet, scale(fwd, 0.8));
    this.events.push({ kind: 'drop', pos: at, count: TRAP_BRICKS.length });
    return at;
  }

  /**
   * Someone walking onto a loose brick lying on the floor (anyone's, not only a trap's)
   * yelps and limps for a while; sprinting onto one sends them flying. The brick skids away.
   */
  private stepOnBricks(p: Player): void {
    // Walking carefully, you step over them.
    if (p.down > 0 || p.limp > 0 || !p.grounded || p.input.careful) return;
    if (p.input.forward === 0 && p.input.right === 0) return;
    const centre = p.body.translation();
    const feetY = centre.y - PLAYER_HALF_HEIGHT - PLAYER_RADIUS;
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
      for (const c of a.colliders.values()) {
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
    const centre = add(feet, v3(0, PLAYER_HALF_HEIGHT + PLAYER_RADIUS + 0.02, 0));
    p.body.setTranslation(centre, true);
    p.collider.setTranslation(centre);
    p.vy = 0;
    p.down = 0;
    p.limp = 0;
    p.slide = v3();
  }

  private pull(p: Player): void {
    if (p.holding) return;
    const hit = this.aim(p);
    if (hit?.owner.kind !== 'brick') return;
    const a = this.assemblies.get(hit.owner.assemblyId);
    if (!a || a.heldBy !== null) return;
    const b = a.grid.bricks.get(hit.owner.brickId)!;
    if (BRICK_TYPES[b.type].fixture) return;
    if (a.grid.size === 1) return this.hold(p, a);
    const pose = this.brickPose(a, b);
    this.removeCollider(a, b.id);
    a.grid.remove(b.id);
    a.version++;
    this.resplit(a);
    const loose = this.spawnBrick(b.type, b.colour, pose.pos, pose.rot, undefined, b.id);
    // Like any brick picked up, it turns to sit straight across the hands.
    this.hold(p, loose);
  }

  /**
   * Where the held brick, or the held piece of bricks clutched together, would snap right now,
   * if anywhere. A build with the baseplate in it is never snapped onto anything.
   */
  snapPreview(p: Player): SnapPreview | null {
    const held = this.heldAssembly(p);
    if (!held || !p.holding) return null;
    const bricks = [...held.grid.bricks.values()];
    if (bricks.some((b) => BRICK_TYPES[b.type].fixture)) return null;
    const hit = this.aim(p);
    if (hit?.owner.kind !== 'brick') return null;
    const t = this.assemblies.get(hit.owner.assemblyId);
    if (!t || t === held || t.heldBy !== null) return null;
    const tRot = t.body.rotation();
    if (rotate(tRot, v3(0, 1, 0)).y < 0.9) return null; // target is tipped over
    const inv = conj(tRot);
    const local = rotate(inv, sub(hit.point, t.body.translation()));
    const normal = rotate(inv, hit.normal);
    // A single brick goes on at the heading it has in the hands; a piece keeps its own bricks'
    // headings, turned by how its hold point is turned against the target.
    const single = isLooseBrick(held);
    const rel = single
      ? p.input.yaw + p.holding.rot * QUARTER - yawOf(tRot)
      : yawOf(this.holdTarget(p, p.holding, held).rot) - yawOf(tRot);
    const rot = (((Math.round(rel / QUARTER) % 4) + 4) % 4) as Rotation;
    const group = single ? [{ ...bricks[0]!, x: 0, y: 0, z: 0, rot: 0 as Rotation }] : bricks;
    const placements = computeGroupSnap(t.grid, local, normal, group, rot);
    if (!placements) return null;
    const out = placements.map((placement, i) => ({
      id: bricks[i]!.id,
      placement: {
        type: placement.type,
        x: placement.x,
        y: placement.y,
        z: placement.z,
        rot: placement.rot,
      },
      ...this.brickPose(t, placement),
    }));
    return { targetId: t.id, bricks: out, pos: out[0]!.pos, rot: out[0]!.rot };
  }

  private place(p: Player): void {
    const hit = this.aim(p);
    if (this.interact(p, hit)) return;
    if (hit?.owner.kind === 'bin' && this.returnToBin(p, hit.owner.binId)) return;
    const preview = this.snapPreview(p);
    const held = this.heldAssembly(p);
    if (!preview || !held) return this.setDown(p);
    const target = this.assemblies.get(preview.targetId)!;
    const placed: PlacedBrick[] = preview.bricks.map((b) => ({
      ...b.placement,
      id: b.id,
      colour: held.grid.bricks.get(b.id)!.colour,
    }));
    this.removeAssembly(held);
    // The preview checked the bricks as a whole: none overlaps, and the piece clutches on.
    for (const b of placed) {
      target.grid.insert(b);
      this.addCollider(target, b);
    }
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
    this.events.push({ kind: 'drop', pos: a.body.worldCom(), count: a.grid.bricks.size });
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
    for (const c of a.colliders.values()) this.owners.delete(c.handle);
    this.world.removeRigidBody(a.body);
    this.assemblies.delete(a.id);
  }

  /** Creates, moves into a pocket, or puts back an instruction page. */
  replicaPage(
    id: number,
    printed: PrintedPage | null,
    carriedBy: number | null,
    pos: Vec3,
    rot: Quat,
    where: { hideout: number | null; pinned: number | null } = { hideout: null, pinned: null },
  ): void {
    let page = this.pages.get(id);
    if (!page) {
      page = {
        id,
        step: printed?.step ?? -1,
        printed,
        body: null,
        carriedBy: null,
        hideout: null,
        pinned: null,
        version: 0,
      };
      this.pages.set(id, page);
    }
    if (where.pinned !== null) {
      page.printed = printed;
      page.carriedBy = null;
      page.hideout = null;
      this.pinPage(page, where.pinned);
      return;
    }
    page.hideout = where.hideout;
    page.printed = printed;
    page.version++;
    if (page.body) {
      this.owners.delete(page.body.collider(0).handle);
      this.world.removeRigidBody(page.body);
      page.body = null;
    }
    page.carriedBy = carriedBy;
    page.pinned = null;
    if (carriedBy === null && where.hideout === null) {
      this.placePage(page, sub(pos, v3(0, PAGE_SIZE.y / 2 + 0.01, 0)), rot);
    }
  }

  /** Mirrors which hiding places are open. */
  replicaFurniture(open: number[]): void {
    for (const h of this.hideouts.values()) this.setOpen(h, open.includes(h.def.id));
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
    if (this.replica) {
      for (const p of this.players.values()) if (!p.replicated) this.movePlayer(p, [p.input]);
      this.stepWorld();
      this.tick++;
      return;
    }
    for (const p of this.players.values()) {
      const inputs = p.pendingInputs ?? [p.input];
      p.pendingInputs = null;
      if (inputs.length) this.movePlayer(p, inputs);
      this.applyHold(p);
      this.maybeTrip(p);
      this.stepOnBricks(p);
    }
    this.dog.update();
    for (const a of this.assemblies.values()) {
      if (a.anchored) continue;
      a.prevLinvel = a.body.linvel();
      a.prevAngvel = a.body.angvel();
    }
    this.stepWorld();
    this.tick++;
    this.knockDownHitPlayers();
    this.handleImpacts();
    this.reanchorBuild();
    for (const a of [...this.assemblies.values()]) {
      if (a.id !== this.buildId && a.body.translation().y < KILL_Y) this.removeAssembly(a);
    }
    for (const page of this.pages.values()) {
      if (page.body && page.body.translation().y < KILL_Y) {
        page.body.setTranslation(this.level.spawn, true);
        page.body.setLinvel(v3(), true);
      }
    }
  }

  /**
   * Breaks builds that took a hard knock. Severity is the sudden change in velocity during
   * this step; a moving piece that hits an anchored build passes part of the knock on to it.
   */
  private handleImpacts(): void {
    const hits = new Map<Assembly, number>();
    const bump = (a: Assembly, s: number) => hits.set(a, Math.max(hits.get(a) ?? 0, s));
    for (const a of this.assemblies.values()) {
      if (a.anchored || a.body.isSleeping() || this.tick - a.bornTick < BREAK_GRACE_TICKS) continue;
      const dv =
        length(sub(a.body.linvel(), a.prevLinvel)) +
        0.2 * length(sub(a.body.angvel(), a.prevAngvel));
      if (dv < 1) continue;
      if (a.grid.size > 1) bump(a, dv);
      const share = dv * Math.min(1, a.body.mass() / 6);
      for (const c of a.colliders.values()) {
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
