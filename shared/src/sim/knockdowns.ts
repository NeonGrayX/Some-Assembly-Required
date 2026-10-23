import type { Collider } from '@dimforge/rapier3d-compat';
import { BRICK_TYPES } from '../bricks.ts';
import type { BrickTypeId, ColourId } from '../bricks.ts';
import { planBreaks } from '../breaking.ts';
import { DT, TICK_RATE } from './time.ts';
import { add, length, scale, sub, v3, yawQuat } from '../math.ts';
import type { Vec3 } from '../math.ts';
import {
  PLAYER_RADIUS,
  PLAYER_FEET,
  viewDir,
  isLooseBrick,
  assemblyMass,
  collidersOf,
} from './body.ts';
import type { Sim, Player } from './sim.ts';

/** How long a trip or a hit keeps a player on the ground. */
export const DOWN_TICKS = Math.round(2.5 * TICK_RATE);
/** Hits from assemblies at least this heavy (kg) and fast (m/s) knock a player over. */
const HIT_MASS = 5;
const HIT_SPEED = 3.5;
/** Chance per second to trip while sprinting with a build, per kg it weighs. */
const TRIP_CHANCE_PER_KG = 0.012;
/** How fast someone slides along the floor when they fall (m/s), losing speed quickly. */
const FALL_SLIDE = 2.2;
/** Limping after stepping on a brick: slower, and no sprinting. */
export const LIMP_TICKS = 10 * TICK_RATE;
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

/**
 * Players knocked off their feet: by a heavy enough piece hitting them, tripping over what they
 * carry, stumbling clumsily, stepping on a brick (and limping after), or a trap of bricks
 * dropped in their way; and pulling a fallen one back up. Part of the `Sim`.
 */
export class KnockDowns {
  constructor(private readonly sim: Sim) {}

  /**
   * Knocks a player over: what they carry keeps flying the way they fell, they slide a little
   * along `push` and lie there for `ticks`. Returns false if they were already down.
   */
  knockDown(p: Player, push: Vec3, ticks = DOWN_TICKS): boolean {
    if (p.down > 0 || this.sim.replica) return false;
    const held = this.sim.heldAssembly(p);
    this.sim.placing.release(p);
    this.sim.vacuuming.putVacuumDown(p);
    if (held) held.body.setLinvel(add(held.body.linvel(), scale(push, 2)), true);
    const flat = v3(push.x, 0, push.z);
    const len = length(flat);
    p.slide = len > 1e-3 ? scale(flat, FALL_SLIDE / len) : v3();
    p.fling = v3();
    p.vel = v3();
    p.down = ticks;
    p.knocks++;
    this.sim.events.push({ kind: 'trip', pos: this.sim.eye(p), playerId: p.id, dir: p.slide });
    return true;
  }

  /** Sprinting with a build in your arms: the heavier it is, the likelier a trip. */
  maybeTrip(p: Player): void {
    const held = this.sim.heldAssembly(p);
    if (!held || isLooseBrick(held) || p.down > 0 || !p.grounded) return;
    const i = p.input;
    if (p.gear.has('brace')) return;
    if (!i.sprint || i.careful || (i.forward === 0 && i.right === 0)) return;
    if (this.sim.rng() < TRIP_CHANCE_PER_KG * assemblyMass(held) * DT) {
      this.knockDown(p, viewDir(i.yaw, 0));
    }
  }

  /**
   * The saboteur's clumsy mode: a trip like any other, except that whatever is just in front
   * takes the stumble. Loose builds get shoved; the job-site build loses what its weaker joints
   * held. Returns where it happened, or null if the player is already down.
   */
  clumsyTrip(p: Player): Vec3 | null {
    if (p.down > 0 || this.sim.replica) return null;
    const fwd = viewDir(p.input.yaw, 0);
    const feet = sub(p.body.translation(), v3(0, PLAYER_FEET, 0));
    const front = add(feet, scale(fwd, CLUMSY_REACH));
    this.knockDown(p, fwd);
    for (const a of [...this.sim.assemblies.values()]) {
      if (a.heldBy !== null) continue;
      const inReach = [...a.grid.bricks.values()].some((b) => {
        const t = this.sim.brickPose(a, b).pos;
        return Math.hypot(t.x - front.x, t.z - front.z) < CLUMSY_REACH && t.y < feet.y + 1.4;
      });
      if (!inReach) continue;
      const shove = add(scale(fwd, 2.2), v3(0, 1, 0));
      if (a.anchored) {
        const pieces = this.sim.resplit(a, planBreaks(a.grid, CLUMSY_SEVERITY, this.sim.rng));
        for (const piece of pieces) piece.body.setLinvel(shove, true);
        if (pieces.length)
          this.sim.events.push({ kind: 'break', pos: front, count: pieces.length });
      } else {
        a.body.setLinvel(add(a.body.linvel(), shove), true);
      }
    }
    return feet;
  }

  /** The saboteur's barefoot trap: a few small bricks spilled on the floor in front. */
  dropTrap(p: Player): Vec3 | null {
    if (p.down > 0 || this.sim.replica) return null;
    const fwd = viewDir(p.input.yaw, 0);
    const right = v3(-fwd.z, 0, fwd.x);
    const feet = sub(p.body.translation(), v3(0, PLAYER_FEET, 0));
    TRAP_BRICKS.forEach(({ type, colour }, i) => {
      const at = add(feet, add(scale(fwd, 0.7 + 0.25 * (i % 2)), scale(right, (i - 1) * 0.3)));
      this.sim.spawnBrick(type, colour, add(at, v3(0, 0.15, 0)), yawQuat(this.sim.rng() * Math.PI));
    });
    // They clatter as they land, not as they appear.
    return add(feet, scale(fwd, 0.8));
  }

  /**
   * Someone walking onto a loose brick lying on the floor (anyone's, not only a trap's)
   * yelps and limps for a while; sprinting onto one sends them flying. The brick skids away.
   */
  stepOnBricks(p: Player): void {
    // Walking carefully, you step over them; in steel-toe boots they do not hurt.
    if (p.down > 0 || p.limp > 0 || !p.grounded || p.input.careful) return;
    if (p.gear.has('boots')) return;
    if (p.input.forward === 0 && p.input.right === 0) return;
    const centre = p.body.translation();
    const feetY = centre.y - PLAYER_FEET;
    for (const a of this.sim.assemblies.values()) {
      if (!isLooseBrick(a) || a.heldBy !== null) continue;
      const t = a.body.worldCom();
      if (t.y > feetY + STEP_HEIGHT || t.y < feetY - 0.3) continue;
      if (Math.hypot(t.x - centre.x, t.z - centre.z) > PLAYER_RADIUS * 0.9) continue;
      p.limp = LIMP_TICKS;
      this.sim.events.push({ kind: 'ouch', pos: this.sim.eye(p), playerId: p.id });
      const away = Math.atan2(t.x - centre.x, t.z - centre.z);
      a.body.setLinvel({ x: Math.sin(away) * 2, y: 1, z: Math.cos(away) * 2 }, true);
      if (p.input.sprint) this.knockDown(p, viewDir(p.input.yaw, 0));
      return;
    }
  }

  /** Players hit by a fast, heavy assembly (a thrown or falling build) go down. */
  knockDownHitPlayers(): void {
    for (const a of this.sim.assemblies.values()) {
      if (a.anchored || a.heldBy !== null) continue;
      // The velocity from before this step: the hit itself has already slowed it down.
      const v = length(a.prevLinvel) > length(a.body.linvel()) ? a.prevLinvel : a.body.linvel();
      const speed = length(v);
      if (speed < HIT_SPEED || assemblyMass(a) < HIT_MASS) continue;
      for (const c of collidersOf(a)) {
        this.sim.world.contactPairsWith(c, (other) => {
          const o = this.sim.owners.get(other.handle);
          if (o?.kind !== 'player') return;
          const p = this.sim.players.get(o.playerId);
          if (p && this.touching(c, other)) this.knockDown(p, scale(v, 1 / speed));
        });
      }
    }
  }

  /** Whether two colliders actually touch, rather than only having overlapping bounds. */
  touching(a: Collider, b: Collider): boolean {
    let hit = false;
    this.sim.world.contactPair(a, b, (m) => {
      for (let i = 0; i < m.numContacts(); i++) if (m.contactDist(i) < 0.03) hit = true;
    });
    return hit;
  }

  pull(p: Player): void {
    if (p.holding || this.sim.vacuum.heldBy === p.id) return;
    const hit = this.sim.sight.aim(p);
    if (hit?.owner.kind !== 'brick' || !this.sim.mayUse(p, hit.point)) return;
    const a = this.sim.assemblies.get(hit.owner.assemblyId);
    if (!a || a.heldBy !== null || a.frozen) return;
    const b = a.grid.bricks.get(hit.owner.brickId)!;
    if (BRICK_TYPES[b.type].fixture) return;
    if (a.grid.size === 1) return this.sim.carrying.hold(p, a);
    const pose = this.sim.brickPose(a, b);
    this.sim.removeCollider(a, b.id);
    a.grid.remove(b.id);
    this.sim.collidersChanged(a);
    a.version++;
    this.sim.resplit(a);
    // The same brick, prints and all, now loose.
    const loose = this.sim.spawnBrick(
      b.type,
      b.colour,
      pose.pos,
      pose.rot,
      undefined,
      b.id,
      b.prints,
    );
    // Like any brick picked up, it turns to sit straight across the hands.
    this.sim.carrying.hold(p, loose);
  }
}
