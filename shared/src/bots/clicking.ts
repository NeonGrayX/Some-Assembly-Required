import { add, length, scale, sub, v3 } from '../math.ts';
import type { Vec3 } from '../math.ts';
import { EYE_OFFSET } from '../sim/sim.ts';
import type { Action, ColliderOwner } from '../sim/sim.ts';
import { FEET } from './nav.ts';
import { JUMP_LIFT, MAX_PITCH, REACH } from './common.ts';
import type { Bot, Job } from './bot.ts';

/** Something to click on: where it is, and what the aim must land on. */
export interface Target {
  key: string;
  point(): Vec3 | null;
  ok(o: ColliderOwner): boolean;
}

/**
 * A bot aiming and clicking: finding where to stand and how to look so a click lands on what
 * it wants, trying the aim before it clicks, jumping for what is out of reach.
 */
export class Clicking {
  constructor(private readonly bot: Bot) {}

  /**
   * The view angles that put the crosshair on `point` (or near it, nudged the way a player
   * nudges the mouse) with the aim landing on what `ok` wants, from where the bot stands now.
   */
  aim(point: Vec3, ok: (o: ColliderOwner) => boolean): { yaw: number; pitch: number } | null {
    const p = this.bot.me();
    if (!p) return null;
    const sim = this.bot.squad.game.sim;
    const eye = sim.eye(p);
    if (length(sub(point, eye)) > REACH + 0.3) return null;
    const nudges = [v3()];
    for (const d of [0.04, 0.08, 0.14]) {
      nudges.push(v3(d, 0, 0), v3(-d, 0, 0), v3(0, d, 0), v3(0, -d, 0), v3(0, 0, d), v3(0, 0, -d));
    }
    for (const n of nudges) {
      const d = sub(add(point, n), eye);
      const yaw = Math.atan2(-d.x, -d.z);
      const pitch = Math.max(
        -MAX_PITCH,
        Math.min(MAX_PITCH, Math.atan2(d.y, Math.hypot(d.x, d.z))),
      );
      const hit = sim.sight.aim(p, { eye, yaw, pitch, firstPerson: true });
      if (hit && ok(hit.owner)) return { yaw, pitch };
    }
    return null;
  }

  /** Nodes to stand on to reach `point`, best first: in reach, in view, not too close. */
  stands(point: Vec3, ok: (o: ColliderOwner) => boolean, near = 1.1, lift = 0): number[] {
    const nav = this.bot.squad.nav;
    const sim = this.bot.squad.game.sim;
    const R = this.bot.squad.rapier;
    const me = this.bot.feet();
    const eyeUp = FEET + EYE_OFFSET + lift;
    const scored = nav
      .around(point, 2.2, 2.6, 0.8)
      .map((n) => {
        const eye = v3(nav.xs[n]!, nav.ys[n]! + eyeUp, nav.zs[n]!);
        const reach = length(sub(point, eye));
        const flat = Math.hypot(nav.xs[n]! - point.x, nav.zs[n]! - point.z);
        const fromMe = Math.hypot(nav.xs[n]! - me.x, nav.zs[n]! - me.z);
        return {
          n,
          eye,
          reach,
          score: Math.abs(flat - near) + 0.08 * fromMe + (flat < 0.45 ? 2 : 0),
        };
      })
      .filter((s) => s.reach < REACH)
      .sort((a, b) => a.score - b.score);
    const out: number[] = [];
    for (const s of scored.slice(0, 40)) {
      const d = sub(point, s.eye);
      const dist = length(d);
      const hit = sim.world.castRay(
        new R.Ray(s.eye, scale(d, 1 / dist)),
        dist + 0.1,
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        (c) => {
          const o = sim.ownerOf(c);
          return o !== undefined && o.kind !== 'player' && (o.kind !== 'dog' || ok(o));
        },
      );
      const o = hit ? sim.ownerOf(hit.collider) : undefined;
      if (o && ok(o)) out.push(s.n);
      if (out.length >= 6) break;
    }
    return out;
  }

  /**
   * Goes to where it can click on a target and clicks (or does all of `actions` there, in
   * order). Returns whether it got to click.
   */
  *use(t: Target, actions: Action | Action[], near?: number): Job {
    const list = Array.isArray(actions) ? actions : [actions];
    if (this.bot.avoided(t.key)) return false;
    yield* this.bot.free();
    const point = t.point();
    if (!point) return false;
    const tried = new Set<number>();
    for (let attempt = 0; attempt < 3; attempt++) {
      const at = t.point();
      if (!at) return false;
      let sol = this.aim(at, t.ok);
      if (!sol) {
        const goals = this.stands(at, t.ok, near).filter((n) => !tried.has(n));
        if (!goals.length) {
          // Out of sight from the floor (on a high shelf): jump and click at the top.
          if (yield* this.jumpUse(t, list, near)) return true;
          this.bot.squad.trace?.(
            this.bot.id,
            `no place to stand for ${t.key} (attempt ${attempt})`,
          );
          break;
        }
        for (const g of goals) tried.add(g);
        const there = yield* this.bot.walking.walk(goals.slice(0, 3), () => {
          const now = t.point();
          return !!now && !!this.aim(now, t.ok);
        });
        const now = t.point();
        if (!now) return false;
        sol = this.aim(now, t.ok);
        if (!sol && !there) {
          const f = this.bot.feet();
          this.bot.squad.trace?.(
            this.bot.id,
            `walk to ${t.key} failed at ${f.x.toFixed(1)},${f.y.toFixed(1)},${f.z.toFixed(1)}`,
          );
          continue;
        }
      }
      if (!sol) {
        // Standing there, but the aim does not land: look again from a step closer.
        for (let k = 0; k < 10; k++) yield;
        const now = t.point();
        sol = now ? this.aim(now, t.ok) : null;
        if (!sol) {
          const f = this.bot.feet();
          const hit =
            this.bot.me() && now ? this.bot.squad.game.sim.sight.aim(this.bot.me()!) : null;
          this.bot.squad.trace?.(
            this.bot.id,
            `no aim on ${t.key} from ${f.x.toFixed(1)},${f.y.toFixed(1)},${f.z.toFixed(1)} (${hit?.owner.kind})`,
          );
          continue;
        }
      }
      if (this.bot.credits < list.length) {
        yield* this.bot.afford(list.length);
        const now = t.point();
        sol = now ? this.aim(now, t.ok) : null;
        if (!sol) continue;
      }
      this.bot.ctl.yaw = sol.yaw;
      this.bot.ctl.pitch = sol.pitch;
      for (const a of list) this.bot.act(a, sol.yaw, sol.pitch);
      yield;
      yield;
      return true;
    }
    this.bot.failed(t.key);
    this.bot.squad.trace?.(this.bot.id, `could not use ${t.key}`);
    return false;
  }

  /** Clicks on something only in sight mid-jump: walks under it, jumps, clicks near the top. */
  private *jumpUse(t: Target, list: Action[], near?: number): Job {
    const at = t.point();
    if (!at) return false;
    const goals = this.stands(at, t.ok, near, JUMP_LIFT);
    if (!goals.length) return false;
    for (let tries = 0; tries < 3; tries++) {
      yield* this.bot.walking.walk(goals.slice(0, 3), undefined, 30);
      this.bot.halt();
      for (let k = 0; k < 6; k++) yield;
      this.bot.ctl.jump = true;
      for (let k = 0; k < 45; k++) {
        yield;
        const now = t.point();
        if (!now) return false;
        const sol = this.aim(now, t.ok);
        if (sol) {
          this.bot.ctl.yaw = sol.yaw;
          this.bot.ctl.pitch = sol.pitch;
          for (const a of list) this.bot.act(a, sol.yaw, sol.pitch);
          yield;
          yield;
          return true;
        }
      }
    }
    return false;
  }
}
