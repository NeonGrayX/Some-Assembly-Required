import { BASEPLATE_SIZE, BRICK_TYPES, STUD, footprint } from '../bricks.ts';
import { conj } from '../math.ts';
import type { Vec3 } from '../math.ts';
import { isLooseBrick } from '../sim/sim.ts';
import { overPlate } from './nav.ts';
import type { PathCosts, Plate, Waypoint } from './nav.ts';
import type { Bot, Job } from './bot.ts';

/**
 * A bot finding its way: along the squad's walking map to where it is going, round loose
 * bricks and builds, over the job site's plates, up ladders, and back onto the map when it
 * has strayed off it.
 */
export class Walking {
  constructor(private readonly bot: Bot) {}

  /** The job sites' baseplates as `platesNow` last found them, and on which tick. */
  private plates: { tick: number; list: (Plate | null)[] } | null = null;

  /**
   * Walks to the nearest of `goals` (nodes), or until `done` says it is close enough. Returns
   * whether it got there.
   */
  *walk(goals: number[], done?: () => boolean, seconds = 45): Job {
    yield* this.bot.free();
    const nav = this.bot.squad.nav;
    let start = nav.locate(this.bot.feet());
    if (start === null || !nav.reachable(start)) {
      // Somewhere the map cannot lead from (up on a pushed crate, say): head for the map.
      if (!(yield* this.backOnMap())) return false;
      start = nav.locate(this.bot.feet());
    }
    if (start === null || !goals.length) return false;
    let path: Waypoint[] | null = nav.path(start, goals, this.costs());
    if (!path) return false;
    let i = 0;
    let stuck = 0;
    let from = this.bot.feet();
    // Up on something the map does not know (a crate pushed into the way): get down off it.
    if (from.y - nav.ys[start]! > 0.45) {
      this.block(nav.around(from, 0.7, 2, 0.5), 30);
      path = nav.path(start, goals, this.costs());
      if (!path) return false;
      while (
        i < path.length - 1 &&
        Math.hypot(path[i]!.pos.x - from.x, path[i]!.pos.z - from.z) < 0.8
      )
        i++;
    }
    let checkAt = this.bot.squad.tick + 30;
    const end = this.bot.squad.tick + seconds * 60;
    while (this.bot.squad.tick < end) {
      if (!this.bot.me()) return false;
      if (done && this.bot.squad.tick % 4 === 0 && done()) {
        this.bot.halt();
        return true;
      }
      const feet = this.bot.feet();
      // Past the farthest waypoint it is at now (cutting corners skips some), up to a ladder.
      for (let j = Math.min(path.length - 1, i + 14); j >= i; j--) {
        let ladder = false;
        for (let w = i; w <= j && !ladder; w++) ladder = !!path[w]!.ladder;
        if (ladder) continue;
        if (reached(feet, path[j]!.pos)) {
          i = j + 1;
          break;
        }
      }
      if (i >= path.length) {
        this.bot.halt();
        return true;
      }
      const wp = path[i]!;
      if (wp.ladder) {
        if (!(yield* this.climb(wp))) return false;
        i++;
        from = this.bot.feet();
        checkAt = this.bot.squad.tick + 30;
        continue;
      }
      // Cut straight across to the farthest waypoint in a clear line.
      let to = wp.pos;
      for (let j = i + 1; j < Math.min(path.length, i + 12); j++) {
        const w = path[j]!;
        if (
          w.ladder ||
          !nav.straight(feet, w.pos) ||
          nav.crossesPlate(this.platesNow(), feet, w.pos)
        )
          break;
        to = w.pos;
      }
      const dx = to.x - feet.x;
      const dz = to.z - feet.z;
      this.bot.ctl.yaw = Math.atan2(-dx, -dz);
      this.bot.ctl.pitch = -0.25;
      this.bot.ctl.forward = 1;
      this.bot.ctl.right = 0;
      const p = this.bot.me()!;
      const carrying = p.holding !== null && !this.bot.building.holdingBrick();
      const left = path.length - i;
      // A build lifted off its job site (to the inspector, say) is loose: one knock and it
      // breaks, so nobody runs about it.
      const gently = this.nearLooseBuild(feet);
      this.bot.ctl.sprint = this.bot.skill.sprint && !carrying && left > 6 && !gently;
      this.bot.ctl.careful =
        !carrying &&
        (gently || (this.bot.skill.careful && this.looseAhead(feet, this.bot.ctl.yaw)));
      if (this.bot.ctl.careful) this.bot.ctl.sprint = false;
      if (this.bot.squad.tick >= checkAt) {
        const moved = Math.hypot(feet.x - from.x, feet.z - from.z);
        if (moved < 0.25 && p.limp === 0) {
          stuck++;
          this.bot.ctl.jump = true;
          if (stuck % 3 === 0) {
            // Something is in the way: step aside, then find a way round it from here.
            this.bot.ctl.right = this.bot.random() < 0.5 ? 1 : -1;
            const ahead = path[i]!.pos;
            if (Math.hypot(ahead.x - feet.x, ahead.z - feet.z) < 1.2) {
              this.block(nav.around(ahead, 0.4, 0.5, 0.5), 20);
            }
            const again = nav.locate(feet);
            path = again === null ? null : nav.path(again, goals, this.costs());
            if (!path) return false;
            i = 0;
          }
          if (stuck >= 9) return false;
        } else stuck = Math.max(0, stuck - 1);
        from = feet;
        checkAt = this.bot.squad.tick + 30;
      }
      yield;
    }
    this.bot.halt();
    return false;
  }

  /** Walks (and jumps) straight for the nearest place on the map that leads anywhere. */
  private *backOnMap(): Job {
    const nav = this.bot.squad.nav;
    for (let tries = 0; tries < 3; tries++) {
      const feet = this.bot.feet();
      const near = nav
        .around(feet, 3, 3, 0.4)
        .sort(
          (a, b) =>
            Math.hypot(nav.xs[a]! - feet.x, nav.zs[a]! - feet.z) -
            Math.hypot(nav.xs[b]! - feet.x, nav.zs[b]! - feet.z),
        );
      const to = near.find(
        (n) => Math.hypot(nav.xs[n]! - feet.x, nav.zs[n]! - feet.z) > 0.6 + 0.4 * tries,
      );
      if (to === undefined) return false;
      for (let k = 0; k < 60; k++) {
        const f = this.bot.feet();
        const n = nav.locate(f);
        if (n !== null && nav.reachable(n) && Math.abs(nav.ys[n]! - f.y) < 0.3) {
          this.bot.halt();
          return true;
        }
        this.bot.ctl.yaw = Math.atan2(-(nav.xs[to]! - f.x), -(nav.zs[to]! - f.z));
        this.bot.ctl.forward = 1;
        if (k === 20) this.bot.ctl.jump = true;
        yield;
      }
    }
    this.bot.halt();
    return false;
  }

  /** Keeps off these nodes for a while (something the map does not know of is in the way). */
  private block(nodes: number[], seconds: number): void {
    const until = this.bot.squad.tick + seconds * 60;
    for (const n of nodes) this.bot.blocked.set(n, until);
  }

  /** Whether a spot is on (or right by) a job site's baseplate. */
  overPlate(x: number, y: number, z: number): boolean {
    return overPlate(this.platesNow(), x, y, z);
  }

  /** The job sites' baseplates where they are this tick. */
  private platesNow(): readonly (Plate | null)[] {
    const sim = this.bot.squad.game.sim;
    if (this.plates?.tick !== this.bot.squad.tick) {
      const list = sim.sites.map((_, site) => {
        const build = sim.build(site);
        const plate = [...build.grid.bricks.values()].find((b) => BRICK_TYPES[b.type].fixture);
        if (!plate) return null;
        const { w, d } = footprint(plate.type, plate.rot);
        return {
          centre: sim.buildCentre(build),
          inv: conj(build.body.rotation()),
          hw: (w * STUD) / 2 + 0.3,
          hd: (d * STUD) / 2 + 0.3,
        };
      });
      this.plates = { tick: this.bot.squad.tick, list };
    }
    return this.plates.list;
  }

  /** Whether a spot is within a couple of metres of a build that is off its job site, unheld. */
  private nearLooseBuild(at: Vec3): boolean {
    const sim = this.bot.squad.game.sim;
    for (let site = 0; site < sim.sites.length; site++) {
      const build = sim.build(site);
      if (build.anchored || build.heldBy !== null) continue;
      const c = sim.buildCentre(build);
      if (Math.abs(at.y - c.y) < 2 && Math.hypot(at.x - c.x, at.z - c.z) < 2 + BASEPLATE_SIZE * 0.7)
        return true;
    }
    return false;
  }

  /**
   * Extra cost of each node: other players standing on it, something in the way, or a job
   * site's baseplate (walking over the build gets in the way of building it).
   */
  private costs(): PathCosts {
    const sim = this.bot.squad.game.sim;
    const tick = this.bot.squad.tick;
    const blocked: number[] = [];
    for (const [n, until] of this.bot.blocked) if (until > tick) blocked.push(n);
    const others = [...sim.players.values()]
      .filter((p) => p.id !== this.bot.id)
      .map((p) => p.body.translation());
    // Loose bricks on the floor (a saboteur's trap, say): stepping on one trips a player up.
    const loose: Vec3[] = [];
    for (const a of sim.assemblies.values()) {
      if (!isLooseBrick(a) || a.heldBy !== null) continue;
      loose.push(a.body.worldCom());
    }
    return {
      blocked,
      others,
      plates: this.platesNow(),
      loose,
      trip: this.bot.skill.careful ? 1 : 6,
    };
  }

  /** Whether a loose brick lies on the floor just ahead (one to step over carefully). */
  private looseAhead(feet: Vec3, yaw: number): boolean {
    // Underfoot, or anywhere in the next stride and a half at a run (bricks get kicked about).
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    for (const a of this.bot.squad.game.sim.assemblies.values()) {
      if (!isLooseBrick(a) || a.heldBy !== null) continue;
      const t = a.body.worldCom();
      if (Math.abs(t.y - feet.y) > 0.3) continue;
      const along = (t.x - feet.x) * dx + (t.z - feet.z) * dz;
      const across = Math.abs((t.x - feet.x) * dz - (t.z - feet.z) * dx);
      if (
        Math.hypot(t.x - feet.x, t.z - feet.z) < 0.7 ||
        (along > 0 && along < 1.6 && across < 0.6)
      )
        return true;
    }
    return false;
  }

  /** Up or down a ladder, from its foot or its top. */
  private *climb(wp: Waypoint): Job {
    const l = wp.ladder!;
    const yaw = l.def.facing;
    const end = this.bot.squad.tick + 8 * 60;
    let left = false;
    while (this.bot.squad.tick < end) {
      const p = this.bot.me();
      if (!p) return false;
      const feet = this.bot.feet();
      this.bot.ctl.yaw = yaw;
      this.bot.ctl.pitch = l.up ? 0.3 : -0.4;
      this.bot.ctl.sprint = false;
      this.bot.ctl.forward = l.up ? 1 : -1;
      if (p.ladder !== null) left = true;
      const there = Math.abs(feet.y - wp.pos.y) < 0.4 && p.grounded;
      if (left && there) {
        // Off the top: a few steps on, onto whatever it reaches.
        for (let k = 0; k < 20; k++) yield;
        this.bot.halt();
        return true;
      }
      if (!left && there && Math.hypot(feet.x - wp.pos.x, feet.z - wp.pos.z) < 0.4) {
        this.bot.halt();
        return true;
      }
      yield;
    }
    this.bot.halt();
    return false;
  }

  /** Waits about, out of the way near the build. */
  *loiter(): Job {
    const centre = this.bot.squad.game.sim.buildCentre(
      this.bot.squad.game.sim.build(this.bot.site),
    );
    if (this.bot.squad.tick > this.bot.wanderAt) {
      this.bot.wanderAt = this.bot.squad.tick + 600;
      const spots = this.bot.squad.nav.around(centre, 3.5, 1, 1).filter((n) => {
        const d = Math.hypot(
          this.bot.squad.nav.xs[n]! - centre.x,
          this.bot.squad.nav.zs[n]! - centre.z,
        );
        return d > 2.2;
      });
      if (spots.length) {
        const goal = spots[Math.floor(this.bot.random() * spots.length)]!;
        yield* this.walk([goal], undefined, 10);
      }
    }
    for (let i = 0; i < 40; i++) yield;
    return true;
  }
}

function reached(feet: Vec3, to: Vec3): boolean {
  return Math.hypot(feet.x - to.x, feet.z - to.z) < 0.3 && Math.abs(feet.y - to.y) < 0.6;
}
