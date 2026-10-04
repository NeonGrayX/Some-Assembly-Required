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
import { BIN_SIZE } from '../content/sandbox.ts';
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
  | { kind: 'rotate' };

export interface Holding {
  assemblyId: number;
  /** Quarter turns relative to the player's heading (single bricks). */
  rot: Rotation;
  /** Heading of the carried build relative to the player, kept from the moment of grabbing. */
  yawOffset: number;
  /** How far in front of the player a carried build is held. */
  reach: number;
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
}

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
  | { kind: 'static' };

export interface SimEvent {
  kind: 'snap' | 'break' | 'grab' | 'drop';
  pos: Vec3;
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
      level.baseplate,
      IDENTITY,
      true,
    );
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
    let keep = 0;
    if (a.anchored) {
      const i = parts.findIndex((ids) =>
        ids.some((id) => BRICK_TYPES[a.grid.bricks.get(id)!.type].fixture),
      );
      if (i >= 0) keep = i;
    }
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
        return this.release(p);
      case 'throw':
        return this.throwHeld(p);
      case 'rotate':
        if (p.holding) p.holding.rot = ((p.holding.rot + 1) % 4) as Rotation;
        return;
    }
  }

  private hold(p: Player, a: Assembly): void {
    const com = a.body.worldCom();
    let reach = 0.2;
    for (const c of a.colliders.values()) {
      const t = c.translation();
      reach = Math.max(reach, Math.hypot(t.x - com.x, t.z - com.z) + 0.15);
    }
    p.holding = {
      assemblyId: a.id,
      rot: 0,
      yawOffset: yawOf(a.body.rotation()) - p.input.yaw,
      reach,
    };
    this.setHeld(a, p.id);
    this.events.push({ kind: 'grab', pos: com });
  }

  private grab(p: Player): void {
    if (p.holding) return;
    const hit = this.aim(p);
    if (!hit) return;
    if (hit.owner.kind === 'bin') {
      const binId = hit.owner.binId;
      const bin = this.level.bins.find((b) => b.id === binId)!;
      const h: Holding = { assemblyId: 0, rot: 0, yawOffset: 0, reach: 0 };
      const target = this.holdTarget(p, h, null);
      const a = this.spawnBrick(bin.type, bin.colour, target.pos, target.rot);
      this.hold(p, a);
      return;
    }
    if (hit.owner.kind !== 'brick') return;
    const a = this.assemblies.get(hit.owner.assemblyId);
    if (!a || a.heldBy !== null) return;
    // Builds fixed to the job site cannot be lifted; take the brick off instead.
    if (a.anchored) return this.pull(p);
    this.hold(p, a);
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
    const preview = this.snapPreview(p);
    const held = this.heldAssembly(p);
    if (!preview || !held) return this.release(p);
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
    for (const a of [...this.assemblies.values()]) {
      if (a.body.translation().y < KILL_Y) this.removeAssembly(a);
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
