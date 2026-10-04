import type RAPIER from '@dimforge/rapier3d-compat';
import type {
  Collider,
  ColliderDesc,
  KinematicCharacterController,
  RigidBody,
  World,
} from '@dimforge/rapier3d-compat';
import { BRICK_TYPES, PLATE_H, STUD, footprint } from '../bricks.ts';
import type { BrickTypeId, ColourId, Rotation } from '../bricks.ts';
import { planBreaks } from '../breaking.ts';
import type { Connection, Placement, PlacedBrick } from '../grid.ts';
import { BrickGrid, localCentre } from '../grid.ts';
import { computeSnap } from '../snap.ts';
import { BIN_SIZE, BUTTON_SIZE } from '../content/sandbox.ts';
import type { LevelDef } from '../content/sandbox.ts';
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
const JUMP_SPEED = 5;
const GRAVITY = 15;
const REACH = 2.6;

// Camera (shared so the server can reproduce the client's aim ray)
export const CAMERA_DISTANCE = 2.6;
export const CAMERA_SHOULDER = 0.75;
export const CAMERA_LIFT = 0.3;

// Bricks
const BRICK_DENSITY = 300;
const COLLIDER_INSET = 0.003;
/** A held brick floats in front of the player, below and right of the crosshair. */
const HOLD_OFFSET = { forward: 0.85, right: 0.3, up: -0.28 };
const THROW_SPEED = 7;
/** Ticks after an assembly is created during which impacts do not break it. */
const BREAK_GRACE_TICKS = 20;
/** Bricks below this height are deleted. */
const KILL_Y = -20;

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
  yaw: number;
  pitch: number;
  firstPerson: boolean;
}

export const emptyInput = (): PlayerInput => ({
  forward: 0,
  right: 0,
  jump: false,
  sprint: false,
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
  | { kind: 'dropPage' };

export interface Holding {
  assemblyId: number;
  /** Quarter turns relative to the player's heading (single bricks). */
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
}

/** An instruction page lying in the world (body set) or in someone's pocket (body null). */
export interface PageItem {
  id: number;
  /** 0-based build step this page explains. */
  step: number;
  body: RigidBody | null;
  carriedBy: number | null;
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
  | { kind: 'static' };

export interface SimEvent {
  kind: 'snap' | 'break' | 'grab' | 'drop' | 'page' | 'button' | 'anchor';
  pos: Vec3;
  /** Which button was pressed, for `button` events. */
  buttonId?: string;
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
  placement: Placement;
  /** World pose of the brick's centre, for drawing a ghost. */
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

/**
 * The authoritative physics world: assemblies of bricks, players, bins and the level.
 * Rendering-agnostic so the same code can run in the browser now and on the server later.
 */
export class Sim {
  readonly world: World;
  readonly assemblies = new Map<number, Assembly>();
  readonly players = new Map<number, Player>();
  readonly pages = new Map<number, PageItem>();
  /** The assembly holding the job-site baseplate: the build the team is making. */
  buildId = 0;
  /** Things that happened since the last drain, for sounds and effects. */
  events: SimEvent[] = [];
  tick = 0;

  private nextId = 1;
  private readonly owners = new Map<number, ColliderOwner>();
  private readonly rng: () => number;

  constructor(
    private readonly R: Rapier,
    readonly level: LevelDef,
    seed = 1,
  ) {
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
  ): Assembly {
    const { R } = this;
    const desc = anchored
      ? R.RigidBodyDesc.fixed()
      : R.RigidBodyDesc.dynamic().setCcdEnabled(true).setLinvel(linvel.x, linvel.y, linvel.z);
    desc.setTranslation(pos.x, pos.y, pos.z).setRotation(rot);
    const a: Assembly = {
      id: this.newId(),
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
    if (!anchored) a.body.setAngvel(angvel, true);
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

  addPlayer(): Player {
    const { R, world, level } = this;
    const body = world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(
        level.spawn.x,
        level.spawn.y + PLAYER_HALF_HEIGHT + PLAYER_RADIUS,
        level.spawn.z,
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
      id: this.newId(),
      body,
      collider,
      controller,
      input: emptyInput(),
      vy: 0,
      grounded: false,
      holding: null,
      page: null,
    };
    this.owners.set(collider.handle, { kind: 'player', playerId: p.id });
    this.players.set(p.id, p);
    return p;
  }

  eye(p: Player): Vec3 {
    return add(p.body.translation(), v3(0, EYE_OFFSET, 0));
  }

  private heldAssembly(p: Player): Assembly | undefined {
    return p.holding ? this.assemblies.get(p.holding.assemblyId) : undefined;
  }

  private movePlayer(p: Player): void {
    const i = p.input;
    const held = this.heldAssembly(p);
    const load = held && held.grid.size > 1 ? held.body.mass() : 0;
    const speed = (i.sprint && !load ? SPRINT_SPEED : WALK_SPEED) / (1 + load / 40);
    const f = v3(-Math.sin(i.yaw), 0, -Math.cos(i.yaw));
    const r = v3(Math.cos(i.yaw), 0, -Math.sin(i.yaw));
    let move = add(scale(f, i.forward), scale(r, i.right));
    const len = length(move);
    if (len > 1) move = scale(move, 1 / len);
    move = scale(move, speed);

    if (p.grounded && i.jump) p.vy = JUMP_SPEED;
    p.vy -= GRAVITY * DT;
    const desired = v3(move.x * DT, p.vy * DT, move.z * DT);
    p.controller.computeColliderMovement(p.collider, desired, undefined, PLAYER_GROUPS);
    const m = p.controller.computedMovement();
    p.grounded = p.controller.computedGrounded();
    if (p.grounded && p.vy < 0) p.vy = 0;
    // Bumped our head.
    if (p.vy > 0 && m.y < desired.y * 0.5) p.vy = 0;
    p.body.setNextKinematicTranslation(add(p.body.translation(), m));
  }

  /** What the player is aiming at, within reach. */
  aim(p: Player): AimHit | null {
    const eye = this.eye(p);
    const cam = cameraPosition(eye, p.input);
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
        return !(o?.kind === 'brick' && o.assemblyId === heldId);
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

  private holdTarget(p: Player, h: Holding, a: Assembly | null): { pos: Vec3; rot: Quat } {
    const eye = this.eye(p);
    const yaw = p.input.yaw;
    if (!a || a.grid.size === 1) {
      const fwd = scale(viewDir(yaw, p.input.pitch), HOLD_OFFSET.forward);
      const right = scale(v3(Math.cos(yaw), 0, -Math.sin(yaw)), HOLD_OFFSET.right);
      const up = scale(viewDir(yaw, p.input.pitch + QUARTER), HOLD_OFFSET.up);
      return { pos: add(eye, add(fwd, add(right, up))), rot: yawQuat(yaw + h.rot * QUARTER) };
    }
    const f = v3(-Math.sin(yaw), 0, -Math.cos(yaw));
    return {
      pos: add(eye, add(scale(f, PLAYER_RADIUS + h.reach), v3(0, -0.6, 0))),
      rot: yawQuat(yaw + h.yawOffset),
    };
  }

  /** Steers a held assembly toward its hold point. Single bricks follow tightly, builds wobble. */
  private applyHold(p: Player): void {
    const a = this.heldAssembly(p);
    if (!a || !p.holding) return;
    const target = this.holdTarget(p, p.holding, a);
    const single = a.grid.size === 1;
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
    if (!p) return;
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
    this.events.push({ kind: 'grab', pos: com });
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
    this.events.push({ kind: 'anchor', pos: home });
  }

  // ---------------------------------------------------------------- pages

  spawnPage(step: number, pos: Vec3, yaw = 0): PageItem {
    const page: PageItem = { id: this.newId(), step, body: null, carriedBy: null };
    this.pages.set(page.id, page);
    this.placePage(page, pos, yawQuat(yaw));
    return page;
  }

  private placePage(page: PageItem, pos: Vec3, rot: Quat, linvel: Vec3 = v3()): void {
    const { R } = this;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
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
  }

  private takePage(p: Player, page: PageItem): void {
    if (!page.body) return;
    if (p.page !== null) this.dropPage(p);
    const pos = page.body.translation();
    this.owners.delete(page.body.collider(0).handle);
    this.world.removeRigidBody(page.body);
    page.body = null;
    page.carriedBy = p.id;
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
    this.hold(p, loose);
    // Keep the brick's heading relative to the player so it does not spin in the hand.
    p.holding!.rot = (((Math.round((yawOf(pose.rot) - p.input.yaw) / QUARTER) % 4) + 4) %
      4) as Rotation;
  }

  /** Where the held brick would snap right now, if anywhere. */
  snapPreview(p: Player): SnapPreview | null {
    const held = this.heldAssembly(p);
    if (!held || !p.holding || held.grid.size !== 1) return null;
    const hit = this.aim(p);
    if (hit?.owner.kind !== 'brick') return null;
    const t = this.assemblies.get(hit.owner.assemblyId);
    if (!t || t === held || t.heldBy !== null) return null;
    const tRot = t.body.rotation();
    if (rotate(tRot, v3(0, 1, 0)).y < 0.9) return null; // target is tipped over
    const inv = conj(tRot);
    const local = rotate(inv, sub(hit.point, t.body.translation()));
    const normal = rotate(inv, hit.normal);
    const rel = p.input.yaw + p.holding.rot * QUARTER - yawOf(tRot);
    const rot = (((Math.round(rel / QUARTER) % 4) + 4) % 4) as Rotation;
    const brick = held.grid.bricks.values().next().value!;
    const placement = computeSnap(t.grid, local, normal, brick.type, rot);
    if (!placement) return null;
    return { targetId: t.id, placement, ...this.brickPose(t, placement) };
  }

  private place(p: Player): void {
    if (this.interact(p, this.aim(p))) return;
    const preview = this.snapPreview(p);
    const held = this.heldAssembly(p);
    if (!preview || !held) return this.setDown(p);
    const target = this.assemblies.get(preview.targetId)!;
    const brick = held.grid.bricks.values().next().value!;
    this.removeAssembly(held);
    const placed: PlacedBrick = { ...preview.placement, id: brick.id, colour: brick.colour };
    if (!target.grid.add(placed).ok) return;
    this.addCollider(target, placed);
    target.version++;
    target.body.wakeUp();
    this.events.push({ kind: 'snap', pos: preview.pos });
  }

  /** Lets go of a single brick, or starts lowering a build to the ground. */
  private setDown(p: Player): void {
    const a = this.heldAssembly(p);
    if (a && p.holding && a.grid.size > 1) p.holding.settingDown ??= 0;
    else this.release(p);
  }

  private release(p: Player): void {
    const a = this.heldAssembly(p);
    p.holding = null;
    if (!a) return;
    this.setHeld(a, null);
    this.events.push({ kind: 'drop', pos: a.body.worldCom() });
  }

  private throwHeld(p: Player): void {
    const a = this.heldAssembly(p);
    if (!a) return;
    this.release(p);
    const push = THROW_SPEED / Math.max(1, a.body.mass() / 5);
    a.body.setLinvel(scale(viewDir(p.input.yaw, p.input.pitch), push), true);
  }

  // ---------------------------------------------------------------- step

  step(): void {
    for (const p of this.players.values()) {
      this.movePlayer(p);
      this.applyHold(p);
    }
    for (const a of this.assemblies.values()) {
      if (a.anchored) continue;
      a.prevLinvel = a.body.linvel();
      a.prevAngvel = a.body.angvel();
    }
    this.world.step();
    this.tick++;
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
      if (pieces.length > 0) this.events.push({ kind: 'break', pos: a.body.worldCom() });
      // A piece that broke off a held build falls; only the main piece stays in hand.
    }
  }
}
