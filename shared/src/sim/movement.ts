import type { Collider, Shape } from '@dimforge/rapier3d-compat';
import { GRAVITY } from './gravity.ts';
import { DT, TICK_RATE } from './time.ts';
import { STAIRS, UPPER_FLOOR, CATAPULT, catapultBucket, stairsAxes } from '../content/house.ts';
import type { LadderDef, LevelDef } from '../content/house.ts';
import { inSea } from '../content/terrain.ts';
import { IDENTITY, add, conj, length, rotate, scale, sub, v3, yawQuat } from '../math.ts';
import type { Vec3 } from '../math.ts';
import {
  PLAYER_RADIUS,
  PLAYER_HALF_HEIGHT,
  PLAYER_FEET,
  CONTROLLER_OFFSET,
  STEP_UP,
  CLIMB_TRIES,
  SQUEEZE,
  G_WORLD,
  G_PLAYER,
  groups,
  PLAYER_GROUPS,
  viewDir,
  isLooseBrick,
  assemblyMass,
  tiredFactor,
} from './body.ts';
import type { Sim, PlayerInput, Player } from './sim.ts';

/**
 * How fast players move: at once at the pace asked for, on the ground and in the air alike
 * (m/s).
 */
export const WALK_SPEED = 4.2;
const SPRINT_SPEED = 7.5;
const CAREFUL_SPEED = 1.3;
const JUMP_SPEED = 6.2;
const CLIMB_SPEED = 2.4;
/**
 * Caught inside something they walk into: how deep in it they are, at least (m), and how far off
 * a way out is looked for (m), nearest first, each way round them and then up (see `wayOut`).
 * Less deep than that, the controller sees to it (stepping up leaves them a little way in now
 * and then).
 */
const CAUGHT = 0.05;
const WAY_OUT = [0.04, 0.08, 0.12, 0.18, 0.25, 0.35];
const WAYS_OUT = [
  ...Array.from({ length: 8 }, (_, k) =>
    v3(Math.cos((k * Math.PI) / 4), 0, Math.sin((k * Math.PI) / 4)),
  ),
  v3(0, 1, 0),
];
/**
 * How far round their middle a player's feet stand (m), and how far below them the ground may
 * be there for them to stand: the capsule's round foot reaches out past theirs, and can rest on
 * an edge their feet are well clear of, which they slip off at `SLIP_SPEED` (m/s).
 */
const FOOT = 0.16;
const UNDERFOOT = 0.05;
const SLIP_SPEED = 2.5;
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
/** Near enough to where they stand to work a machine to stop walking there (m). */
const WORK_CLOSE = 0.08;
/** What a player presses while they work a machine, but for turning to look: none of it moves them. */
function stayPut(i: PlayerInput): PlayerInput {
  return { ...i, forward: 0, right: 0, jump: false, sprint: false };
}
/** A hard landing (jumping off the roof) keeps them down for less. */
const LANDING_DOWN_TICKS = Math.round(1.4 * TICK_RATE);
/** Falling faster than this (m/s) when landing knocks a player over. */
const HARD_LANDING_SPEED = 8.5;
/** How fast a limping player goes, against a sound one (see `LIMP_TICKS`). */
const LIMP_FACTOR = 0.45;
/**
 * On a flight of stairs a player is kept this far in from either edge of the steps (to the
 * handrail on the open side), and brought back in by at most `STAIRS_SLIDE` a tick.
 */
export const STAIRS_MARGIN = 0.08;
export const STAIRS_SLIDE = 0.05;
const UP = v3(0, 1, 0);
const DOWN = v3(0, -1, 0);
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

/**
 * How players move: walking, sprinting and jumping, stepping up and slipping off edges,
 * squeezing through gaps, climbing ladders and keeping to the stairs, a step at a time with the
 * character controller (see `movePlayer`). Part of the `Sim`.
 */
export class Movement {
  /**
   * A player's capsule, and their slim shape side-on, each `CAUGHT` in from its surface all
   * round: what is caught inside something overlaps it even so (see `wayOut`).
   */
  private readonly cores: { capsule: Shape; slim: Shape };
  /** The level's flights of stairs, as `keepOnStairs` sees them. */
  private readonly flights: Flight[];

  constructor(private readonly sim: Sim) {
    this.cores = {
      capsule: new sim.R.Capsule(PLAYER_HALF_HEIGHT, PLAYER_RADIUS - CAUGHT),
      slim: new sim.R.RoundCylinder(
        PLAYER_FEET - 0.04 - CAUGHT,
        SQUEEZE.slim - 0.04 - CAUGHT,
        0.04,
      ),
    };
    this.flights = (sim.level.stairs ?? []).map((s) => ({
      ...stairsAxes(s),
      pos: s.pos,
      run: STAIRS.steps * STAIRS.tread,
      top: s.pos.y + UPPER_FLOOR,
      // Stepping onto the first step from the side, say, still counts (`keepOnStairs`).
      reach: PLAYER_RADIUS + 0.1,
    }));
  }

  /**
   * Moves a player one tick per input (several when the server catches up on a backlog). Each
   * tick is its own controller move with its own input, exactly like a client predicting one
   * tick at a time, so both end up in the same place.
   */
  movePlayer(p: Player, inputs: PlayerInput[]): void {
    const held = this.sim.heldAssembly(p);
    const load = held && !isLooseBrick(held) ? assemblyMass(held) : 0;
    const start = p.collider.translation();
    let total = v3();
    for (let k = 0; k < inputs.length; k++) {
      // Working a machine, they stay put (but for walking where they work it) till they are done.
      const i = p.work?.machineId != null && p.down === 0 ? stayPut(inputs[k]!) : inputs[k]!;
      const limping = p.limp > 0;
      // A gear hunt's heavy build keeps whoever carries it without the back brace to a careful pace.
      const careful = i.careful || (load > 0 && this.sim.heavyFor(p));
      const pace = careful ? CAREFUL_SPEED : i.sprint && !limping ? SPRINT_SPEED : WALK_SPEED;
      const speed =
        (pace / (1 + load / 40)) * (limping && !careful ? LIMP_FACTOR : 1) * tiredFactor(p);
      const f = v3(-Math.sin(i.yaw), 0, -Math.cos(i.yaw));
      const r = v3(Math.cos(i.yaw), 0, -Math.sin(i.yaw));
      let move = add(scale(f, i.forward), scale(r, i.right));
      const len = length(move);
      if (len > 1) move = scale(move, 1 / len);
      // Working something: walking up to it unless they move off themselves (at the panel), which
      // ends it, as falling over does.
      const w = p.work;
      if (w && (len > 0 || i.jump || p.down > 0 || p.ladder !== null)) p.work = null;
      else if (w && !w.there) {
        const way = sub(w.spot, add(start, total));
        const off = Math.hypot(way.x, way.z);
        if (off < WORK_CLOSE || --w.walk <= 0) this.sim.arrive(w);
        else move = scale(v3(way.x, 0, way.z), Math.min(1, off / (speed * DT)) / off);
      } else if (w && --w.ticks <= 0 && this.sim.fixerOf(w.machineId) !== p.id) {
        this.sim.workDone(p, w);
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
      if (this.sim.catapultArmed && this.sim.catapultCooldown === 0 && p.grounded && !down) {
        const c = this.sim.level.catapult;
        if (c && this.inBucket(c, add(start, total))) {
          p.vy = CATAPULT.launch.up;
          p.fling = scale(viewDir(c.facing, 0), CATAPULT.launch.along);
          this.sim.catapultCooldown = CATAPULT.rearmTicks;
          if (!this.sim.replica) {
            this.sim.events.push({ kind: 'catapult', pos: this.sim.eye(p), playerId: p.id });
          }
        }
      }
      // Flung: carried along until landing, with a little steering.
      if (p.fling.x !== 0 || p.fling.z !== 0) move = add(scale(move, 0.4), p.fling);
      let at = add(start, total);
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
      const ladder = ladderId === null ? undefined : this.sim.level.ladders[ladderId];
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
      // Caught inside what they walk into (in among the triangles of a car's wheel arch, say):
      // out to the nearest place clear of it first. Started inside, the controller slides about
      // in there for every pass it makes, each pass going over every triangle round them, and a
      // wheel arch has thousands: most of a second a move.
      const out = this.wayOut(p, c, at);
      if (out) {
        at = add(at, out);
        total = add(total, out);
      }
      // Stuck fast (no way out): a single pass, and nothing more tried this tick (stepping up,
      // turning side-on), each a move as dear.
      const stuck = !out;
      let m = this.walk(p, c, at, desired, true, !stuck);
      const wasFalling = !p.grounded ? p.vy : 0;
      // Rising, they are not on the ground, whatever they brush against on the way up.
      p.grounded = p.controller.computedGrounded() && (onLadder || p.vy <= 0);
      // Held up on the ground: a step up, perhaps, that the controller would not take.
      const flat = Math.hypot(desired.x, desired.z);
      const heldUp = flat > 1e-4 && Math.hypot(m.x, m.z) < flat * 0.9;
      if (steered && !onLadder && p.grounded && heldUp && !stuck) {
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
      else if (steered && !onLadder && p.grounded && asked > 0.5 && !stuck)
        this.wedged(p, add(at, m), dir.x / asked, dir.z / asked);
      p.ladder = onLadder && !p.grounded ? ladderId : null;
      if (p.grounded && wasFalling < -HARD_LANDING_SPEED && !this.sim.replica) {
        this.sim.knocks.knockDown(p, scale(f, 0.6), LANDING_DOWN_TICKS);
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
   * stair's upper flight or a low ceiling it could not. Without `slide`, it stops at the first
   * thing in the way, in a single pass.
   */
  private walk(p: Player, c: Collider, at: Vec3, delta: Vec3, step = true, slide = true): Vec3 {
    c.setTranslation(at);
    if (!slide) p.controller.setSlideEnabled(false);
    if (!step) p.controller.disableAutostep();
    const over = !step
      ? null
      : this.sim.world.castShape(
          at,
          IDENTITY,
          UP,
          c.shape,
          0,
          STEP_UP,
          false,
          this.sim.R.QueryFilterFlags.EXCLUDE_SENSORS,
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
    if (!slide) p.controller.setSlideEnabled(true);
    const m = p.controller.computedMovement();
    return v3(m.x, m.y, m.z);
  }

  /**
   * How far `c` (a player's capsule, or side-on their slim shape) with its middle at `at` must go
   * not to be caught inside what they walk into (`CAUGHT` deep or more): nowhere if it is not,
   * else the nearest way out of those `WAY_OUT` and `WAYS_OUT` try; or null if none of those is.
   */
  private wayOut(p: Player, c: Collider, at: Vec3): Vec3 | null {
    const core = c === p.slim ? this.cores.slim : this.cores.capsule;
    const caught = (q: Vec3) =>
      !!this.sim.world.intersectionWithShape(
        q,
        IDENTITY,
        core,
        this.sim.R.QueryFilterFlags.EXCLUDE_SENSORS | this.sim.R.QueryFilterFlags.EXCLUDE_DYNAMIC,
        groups(G_PLAYER, G_WORLD),
        p.collider,
      );
    if (!caught(at)) return v3();
    for (const r of WAY_OUT) {
      for (const way of WAYS_OUT) {
        const out = scale(way, r);
        if (!caught(add(at, out))) return out;
      }
    }
    return null;
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
    const flags = this.sim.R.QueryFilterFlags.EXCLUDE_SENSORS;
    const bottom = centre.y - PLAYER_FEET;
    // A thin disc as wide as their feet, from just over the capsule's foot down.
    const lift = 0.05;
    const under = this.sim.world.castShape(
      v3(centre.x, bottom + lift, centre.z),
      IDENTITY,
      DOWN,
      new this.sim.R.Cylinder(0.005, FOOT),
      0,
      lift + CONTROLLER_OFFSET + UNDERFOOT,
      true,
      flags,
      PLAYER_GROUPS,
      p.collider,
    );
    if (under) return null;
    // What the capsule rests on, and away from it.
    const rest = this.sim.world.castShape(
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
      this.sim.world.projectPoint(
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
    return !this.sim.world.intersectionWithShape(
      v3(centre.x, centre.y + 0.05, centre.z),
      IDENTITY,
      p.collider.shape,
      this.sim.R.QueryFilterFlags.EXCLUDE_SENSORS | this.sim.R.QueryFilterFlags.EXCLUDE_DYNAMIC,
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
    const flags =
      this.sim.R.QueryFilterFlags.EXCLUDE_SENSORS | this.sim.R.QueryFilterFlags.EXCLUDE_DYNAMIC;
    const hits = (shape: Shape, out: number) =>
      !!this.sim.world.intersectionWithShape(
        v3(centre.x - uz * out, y, centre.z + ux * out),
        turn,
        shape,
        flags,
        PLAYER_GROUPS,
        p.collider,
      );
    const side = new this.sim.R.Cuboid(SQUEEZE.reach, half, (SQUEEZE.shoulder - inner) / 2);
    const between = new this.sim.R.Cuboid(SQUEEZE.reach, half, inner * 0.8);
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
    return !!this.sim.world.castShape(
      ahead,
      IDENTITY,
      DOWN,
      p.collider.shape,
      0,
      0.1 + STEP_UP,
      false,
      this.sim.R.QueryFilterFlags.EXCLUDE_SENSORS,
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
    const { sea } = this.sim.level;
    if (sea !== undefined && feet < sea + 0.15 && inSea(this.sim.level, centre.x, centre.z))
      return true;
    const water = this.sim.level.water;
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
    const i = this.sim.level.ladders.findIndex((l) => {
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
    return this.sim.level.ladders.find((l) => {
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
    const { facing } = this.sim.level.ladders[ladder]!;
    return -(dir.x * Math.sin(facing) + dir.z * Math.cos(facing)) > LADDER_INTO;
  }
}
