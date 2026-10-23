import type { Collider, RigidBody } from '@dimforge/rapier3d-compat';
import { TICK_RATE } from './time.ts';
import { VACUUM, VACUUM_LEAN } from '../content/house.ts';
import { groundHeight } from '../content/terrain.ts';
import { add, length, mulQuat, rotate, scale, sub, v3, yawQuat } from '../math.ts';
import type { Quat, Vec3 } from '../math.ts';
import { PLAYER_FEET, viewDir } from './body.ts';
import type { Sim, Player, Assembly, VacuumState } from './sim.ts';

/**
 * The vacuum's head goes where the crosshair meets the floor, kept between this near and this
 * far ahead of the player and no further than this to either side; a pull sucks up what lies
 * on the floor this close round it. One pull at most this often.
 */
const SUCK_NEAR = 0.4;
const SUCK_REACH = 1.3;
const SUCK_ASIDE = 0.7;
const SUCK_RADIUS = 0.45;
export const SUCK_TICKS = Math.round(0.4 * TICK_RATE);
/** How many bricks the vacuum holds before it has to be emptied into a rubbish bin. */
export const VACUUM_CAPACITY = 10;
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

/**
 * The vacuum cleaner: picked up and put down, sucking up loose bricks where its head meets the
 * floor ahead of whoever carries it, and emptied into a rubbish bin. Its state stays on the
 * `Sim` (`Sim.vacuum`). Part of the `Sim`.
 */
export class VacuumCleaner {
  /** Clicking it picks the vacuum up; only there while nobody carries it. */
  private readonly vacuumCollider: Collider;

  constructor(
    private readonly sim: Sim,
    fixed: RigidBody,
  ) {
    // Not solid: players and bricks pass through it, clicks find it.
    this.vacuumCollider = sim.world.createCollider(
      sim.R.ColliderDesc.cuboid(VACUUM.width / 2, VACUUM.length / 2, 0.06).setSensor(true),
      fixed,
    );
    sim.owners.set(this.vacuumCollider.handle, { kind: 'vacuum' });
  }

  /** Sets where the vacuum is, and puts its clickable shape there (none while carried). */
  private setVacuum(b: VacuumState): void {
    this.sim.vacuum = b;
    this.poseVacuum();
  }

  /** Puts the vacuum's clickable shape where it rests, or takes it away while it is carried. */
  poseVacuum(): void {
    const b = this.sim.vacuum;
    this.vacuumCollider.setEnabled(b.heldBy === null);
    if (b.heldBy !== null) return;
    const { pos, rot } = vacuumRestPose(b);
    this.vacuumCollider.setTranslationWrtParent(pos);
    this.vacuumCollider.setRotationWrtParent(rot);
  }

  takeVacuum(p: Player): void {
    const at = vacuumRestPose(this.sim.vacuum).pos;
    this.setVacuum({ ...this.sim.vacuum, heldBy: p.id });
    this.sim.events.push({ kind: 'vacuumUp', pos: at, playerId: p.id });
  }

  /** Lays the vacuum on the floor in front of whoever carries it, if they do. */
  putVacuumDown(p: Player): void {
    if (this.sim.vacuum.heldBy !== p.id) return;
    const fwd = viewDir(p.input.yaw, 0);
    const centre = p.body.translation();
    const feet = v3(centre.x, centre.y - PLAYER_FEET, centre.z);
    // Head out in front, handle back toward the player's feet.
    const pos = this.onFloorAhead(feet, add(feet, scale(fwd, 0.9)));
    this.setVacuum({ ...this.sim.vacuum, heldBy: null, pos, yaw: p.input.yaw, leaning: false });
    this.sim.events.push({ kind: 'vacuumDown', pos, playerId: p.id });
  }

  /**
   * One pull of the vacuum: loose bricks and small loose pieces lying on the floor in a strip
   * in front of the player get sucked up, nearest first, as long as they fit in what room is
   * left. The team's build and anything held stay put. Full, it takes nothing more until it is
   * emptied into a rubbish bin. A `held` pull (the click kept down) says nothing when it is
   * full: the first pull already did.
   */
  suck(p: Player, held = false): void {
    const v = this.sim.vacuum;
    if (this.sim.tick - v.sucked < SUCK_TICKS) return;
    v.sucked = this.sim.tick;
    const head = this.vacuumHead(p);
    if (v.load >= VACUUM_CAPACITY) {
      if (!held) this.sim.events.push({ kind: 'vacuumFull', pos: head, playerId: p.id });
      return;
    }
    const near: { a: Assembly; d: number }[] = [];
    for (const a of this.sim.assemblies.values()) {
      if (a.anchored || a.frozen || a.heldBy !== null || this.sim.isBuild(a.id)) continue;
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
      this.sim.removeAssembly(a);
    }
    this.sim.events.push({ kind: 'suck', pos: head, playerId: p.id, count });
    if (count > 0 && v.load >= VACUUM_CAPACITY) {
      this.sim.events.push({ kind: 'vacuumFull', pos: head, playerId: p.id });
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
    const { origin, dir } = this.sim.sight.aimRay(p);
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
    if (!this.sim.level.terrain?.length) return at;
    if (Math.abs(feet.y - groundHeight(this.sim.level, feet.x, feet.z)) > 0.25) return at;
    return v3(at.x, groundHeight(this.sim.level, at.x, at.z), at.z);
  }

  /** Empties the vacuum into rubbish bin `bin`: what it sucked up is gone for good. */
  emptyVacuum(bin: number, playerId: number): void {
    const v = this.sim.vacuum;
    if (v.load === 0) return;
    const m = this.sim.trashBins[bin]!;
    this.sim.events.push({
      kind: 'binned',
      pos: v3((m.x0 + m.x1) / 2, m.y, (m.z0 + m.z1) / 2),
      count: v.load,
      emptied: true,
      playerId,
    });
    v.load = 0;
  }

  /** Mirrors who carries the vacuum, or where it stands or lies, and how full it is. */
  replicaVacuum(
    heldBy: number | null,
    pos: Vec3,
    yaw: number,
    leaning: boolean,
    load: number,
  ): void {
    const b = this.sim.vacuum;
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
}
