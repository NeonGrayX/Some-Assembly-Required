import { BRICK_TYPES } from '../bricks.ts';
import { machineFront } from '../content/house.ts';
import { add, length, scale, sub, v3 } from '../math.ts';
import type { Vec3 } from '../math.ts';
import type { SabotageTool } from '../round.ts';
import type { Bot, Job, Target } from './bot.ts';

/**
 * A saboteur bot's tricks: when nobody is looking, it swaps a brick's colour, forges or hides a
 * page, trips someone up, sets a trap or jams a machine.
 */
export class Sabotage {
  constructor(private readonly bot: Bot) {}

  private cooldown(tool: SabotageTool): number {
    return this.bot.squad.game.round!.cooldown(this.bot.id, tool);
  }

  /** A saboteur's next trick, if now is the moment for one; otherwise it helps out like anyone. */
  mischief(): Job | null {
    const round = this.bot.squad.game.round!;
    const sim = this.bot.squad.game.sim;
    const p = this.bot.me()!;
    const mood = this.bot.skill.mischief;
    // Not in the first half minute: everyone is still finding their feet.
    if (this.bot.roundTicks < 30 * 60) return null;
    if (p.page !== null) {
      const page = sim.pages.get(p.page);
      const printed = page?.printed;
      if (
        printed &&
        this.bot.watchers(p.body.translation()) === 0 &&
        this.bot.random() < 0.85 * mood
      ) {
        return this.bot.named('hide a page', this.hidePage());
      }
      if (printed && printed.step >= 0 && this.cooldown('forge') === 0) {
        return this.bot.named('forge a page', this.forge());
      }
      return null;
    }
    const build = sim.build(this.bot.site);
    const centre = sim.buildCentre(build);
    const bricks = build.grid.size - 1;
    const late = round.timeLeft < 150;
    // Tripping into the build leaves no tell, so it is worth most once there is a lot to break.
    const charges = round.chargesLeft(this.bot.id, 'clumsy') ?? 0;
    const tall =
      bricks >= Math.max(20, 0.4 * round.target.steps.reduce((n, s) => n + s.bricks.length, 0));
    const people = round.onSite.some(
      (id) => round.role(id) !== 'saboteur' && !this.bot.squad.game.clients.get(id)?.bot,
    );
    const trip = late ? 0.5 : people ? this.bot.skill.tripVsPeople : this.bot.skill.trip;
    // One trip while it builds up; the last is kept for the end.
    if (
      charges > 0 &&
      bricks >= 10 &&
      (late || (tall && charges > 1)) &&
      this.bot.random() < trip * mood
    ) {
      return this.bot.named('trip into the build', this.clumsy(centre));
    }
    if (bricks >= 4 && this.cooldown('swap') === 0 && this.bot.random() < Math.min(1, 0.6 * mood)) {
      return this.bot.named('swap a brick', this.swap());
    }
    if (this.cooldown('trap') === 0 && this.bot.random() < 0.3 * mood) {
      return this.bot.named('drop a trap', this.trap());
    }
    if (this.cooldown('tamper') === 0 && this.bot.random() < 0.3 * mood) {
      return this.bot.named('tamper', this.tamper());
    }
    // Pages pinned on the board: take one away to hide it.
    const pinned = [...sim.pages.values()].filter((pg) => pg.pinned !== null && pg.body);
    if (pinned.length && this.bot.random() < 0.35 * mood) {
      const pg = pinned[Math.floor(this.bot.random() * pinned.length)]!;
      return this.bot.named('take a page', this.takePinned(pg.id));
    }
    return null;
  }

  /** Now and then, after a swap, blames whoever has been about the build most (a person to fool). */
  private frame(): void {
    const round = this.bot.squad.game.round!;
    if (this.bot.random() > 0.3 * this.bot.skill.mischief) return;
    const near = [...this.bot.squad.nearBuild]
      .filter(([id, t]) => t > 2 && id !== this.bot.id && round.onSite.includes(id))
      .filter(([id]) => !round.partners(this.bot.id).includes(id))
      .sort((a, b) => b[1] - a[1])[0];
    if (near)
      this.bot.reply(
        `Did anyone else see ${this.bot.nameOf(near[0])} fiddling with the build?`,
        20,
      );
  }

  /** Waits until nobody but fellow saboteurs is close (up to `seconds`); returns whether it got its moment. */
  private *alone(seconds: number, at?: Vec3): Job {
    const end = this.bot.squad.tick + seconds * 60;
    while (this.bot.squad.tick < end) {
      const me = this.bot.me()!.body.translation();
      if (this.bot.watchers(me) === 0 && (!at || this.bot.watchers(at) === 0)) return true;
      yield;
    }
    return false;
  }

  /** Puts the page in its pocket into a hiding place nobody is near. */
  private *hidePage(): Job {
    const sim = this.bot.squad.game.sim;
    const me = this.bot.feet();
    const options = [...sim.hideouts.values()]
      .filter(
        (h) =>
          !h.locked && (sim.sideOf(h.def.pos) === null || sim.sideOf(h.def.pos) === this.bot.site),
      )
      .filter((h) => this.bot.watchers(h.def.pos) === 0 && !this.bot.avoided(`hideout|${h.def.id}`))
      .map((h) => ({ h, d: length(sub(h.def.pos, me)) }))
      // Not right where it was found, and not across the map either.
      .filter(({ d }) => d > 2 && d < 14)
      .sort((a, b) => a.d - b.d);
    const pick = options[Math.floor(this.bot.random() * Math.min(3, options.length))];
    if (!pick) return false;
    const id = pick.h.def.id;
    const centre = pick.h.def.pos;
    const ok = yield* this.bot.use(
      {
        key: `hideout|${id}`,
        point: () => centre,
        ok: (o) => o.kind === 'hideout' && o.hideoutId === id,
      },
      { kind: 'grab' },
    );
    return ok && this.bot.me()?.page === null;
  }

  private *forge(): Job {
    if (!(yield* this.alone(10))) return false;
    this.bot.act({ kind: 'sabotage', tool: 'forge' });
    yield;
    yield;
    const p = this.bot.me()!;
    const page = p.page === null ? undefined : this.bot.squad.game.sim.pages.get(p.page);
    // Tells the others what the forgery says, as if it were the real page.
    if (page?.printed) this.bot.team.tell(page.printed, this.bot.id);
    return yield* this.bot.chores.pocketPage();
  }

  /** Swaps a brick of the build for its look-alike while nobody is watching. */
  private *swap(): Job {
    const sim = this.bot.squad.game.sim;
    const build = sim.build(this.bot.site);
    const centre = sim.buildCentre(build);
    const stands = this.bot.squad.nav
      .around(centre, 1.9, 1.5, 0.5)
      .filter(
        (n) =>
          Math.hypot(this.bot.squad.nav.xs[n]! - centre.x, this.bot.squad.nav.zs[n]! - centre.z) >
          1.1,
      );
    if (!stands.length) return false;
    const goal = stands[Math.floor(this.bot.random() * stands.length)]!;
    yield* this.bot.walk([goal], undefined, 25);
    if (!(yield* this.alone(8))) return false;
    // A brick in view that has a look-alike colour; one of the earlier steps, already checked.
    const bricks = [...build.grid.bricks.values()].filter((b) => !BRICK_TYPES[b.type].fixture);
    const order = this.bot.skill.cunning
      ? // Low down first (a little shuffled): the higher bricks have to come off to fix it.
        bricks
          .map((b) => ({ b, k: b.y + this.bot.random() * 4 }))
          .sort((x, y) => x.k - y.k)
          .map(({ b }) => b)
      : bricks.sort(() => this.bot.random() - 0.5);
    for (const b of order.slice(0, 12)) {
      const at = sim.brickPose(build, b).pos;
      const sol = this.bot.aim(
        at,
        (o) => o.kind === 'brick' && o.assemblyId === build.id && o.brickId === b.id,
      );
      if (!sol) continue;
      // The tell shows where the brick is, which can be in sight of someone who cannot see it.
      if (!(yield* this.alone(4, at))) return false;
      this.bot.act({ kind: 'sabotage', tool: 'swap' }, sol.yaw, sol.pitch);
      yield;
      yield;
      this.frame();
      return true;
    }
    return false;
  }

  private *clumsy(centre: Vec3): Job {
    const nav = this.bot.squad.nav;
    const stands = nav
      .around(centre, 1.7, 1.5, 0.5)
      .filter((n) => Math.hypot(nav.xs[n]! - centre.x, nav.zs[n]! - centre.z) > 1.0);
    if (!stands.length) return false;
    yield* this.bot.walk(stands.slice(0, 4), undefined, 20);
    // A trip looks like anyone's: only a careless saboteur waits to be alone for it.
    if (!this.bot.skill.bold && !(yield* this.alone(6))) return false;
    const f = this.bot.feet();
    this.bot.ctl.yaw = Math.atan2(-(centre.x - f.x), -(centre.z - f.z));
    this.bot.ctl.pitch = -0.3;
    yield;
    this.bot.act({ kind: 'sabotage', tool: 'clumsy' });
    yield;
    return true;
  }

  /** Spills a few bricks on the busy way between the brick works and the build. */
  private *trap(): Job {
    const sim = this.bot.squad.game.sim;
    const presses = this.bot.making
      .machinesOf('press')
      .map((id) => machineFront(sim.machines.get(id)!.def));
    if (!presses.length) return false;
    const centre = sim.buildCentre(sim.build(this.bot.site));
    const press = presses[Math.floor(this.bot.random() * presses.length)]!;
    const mid = add(centre, scale(sub(press, centre), 0.35 + this.bot.random() * 0.3));
    const n = this.bot.squad.nav.closest(v3(mid.x, centre.y - 0.3, mid.z), 1.5, 1);
    if (n === null) return false;
    yield* this.bot.walk([n], undefined, 20);
    if (!(yield* this.alone(5))) return false;
    this.bot.ctl.yaw = Math.atan2(-(centre.x - mid.x), -(centre.z - mid.z));
    this.bot.act({ kind: 'sabotage', tool: 'trap' });
    yield;
    return true;
  }

  /**
   * Tampers with a moulding machine, or now and then the electrical panel (the lights and
   * every machine go off with it), while nobody is watching.
   */
  private *tamper(): Job {
    const sim = this.bot.squad.game.sim;
    const panel = sim.power.on && sim.panel && this.bot.random() < 0.35 ? sim.panel : null;
    let target: Target;
    if (panel) {
      target = { key: 'panel', point: () => panel, ok: (o) => o.kind === 'panel' };
    } else {
      const presses = this.bot.making
        .machinesOf('press')
        .filter((id) => !sim.machines.get(id)!.jammed);
      const id = presses[Math.floor(this.bot.random() * presses.length)];
      if (id === undefined) return false;
      target = this.bot.making.machineTarget(id);
    }
    const at = target.point()!;
    const goals = this.bot.stands(at, target.ok);
    if (!goals.length) return false;
    yield* this.bot.walk(goals.slice(0, 3), () => !!this.bot.aim(at, target.ok), 25);
    if (!(yield* this.alone(8, at))) return false;
    const sol = this.bot.aim(at, target.ok);
    if (!sol) return false;
    this.bot.act({ kind: 'sabotage', tool: 'tamper' }, sol.yaw, sol.pitch);
    yield;
    yield;
    return true;
  }

  private *takePinned(id: number): Job {
    const sim = this.bot.squad.game.sim;
    const page = sim.pages.get(id);
    if (!page?.body) return false;
    const at = page.body.translation();
    if (this.bot.watchers(at) > 0) return false;
    return yield* this.bot.use(
      {
        key: `page|${id}`,
        point: () => {
          const pg = sim.pages.get(id);
          return pg?.body && pg.pinned !== null ? pg.body.translation() : null;
        },
        ok: (o) => o.kind === 'page' && o.pageId === id,
      },
      { kind: 'grab' },
      0.9,
    );
  }
}
