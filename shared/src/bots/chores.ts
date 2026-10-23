import { levelBoards } from '../content/house.ts';
import { add, length, sub, v3 } from '../math.ts';
import type { Bot, Job } from './bot.ts';

/**
 * A bot's small jobs: putting away or binning what it holds, clearing loose bricks off the
 * build, feeding the dog, fixing the electrical panel or a jammed machine, and pocketing a page.
 */
export class Chores {
  constructor(private readonly bot: Bot) {}

  *putAway(): Job {
    yield* this.bot.free();
    this.bot.act({ kind: 'drop' });
    yield;
    yield;
    return true;
  }

  /**
   * A loose piece lying on (or right by) the baseplate, the nearest no other bot is seeing to.
   * Two bots at most clear at once, so the rest go on building.
   */
  debris(): number | null {
    const sim = this.bot.squad.game.sim;
    const clearing = this.bot.squad.clearing;
    const others = [...clearing].filter(([b]) => b !== this.bot.id);
    if (others.length >= 2) return null;
    const taken = new Set(others.map(([, a]) => a));
    const me = this.bot.feet();
    let best: { id: number; d: number } | null = null;
    for (const a of sim.assemblies.values()) {
      if (a.heldBy !== null || a.frozen || a.anchored || sim.isBuild(a.id) || taken.has(a.id))
        continue;
      if (this.bot.avoided(`debris|${a.id}`)) continue;
      const at = a.body.worldCom();
      if (!this.bot.overPlate(at.x, at.y, at.z)) continue;
      const d = length(sub(at, me));
      if (!best || d < best.d) best = { id: a.id, d };
    }
    return best?.id ?? null;
  }

  /** Picks a piece up off the baseplate and puts it on if it goes on now, else takes it off. */
  *clearDebris(id: number): Job {
    const sim = this.bot.squad.game.sim;
    this.bot.squad.clearing.set(this.bot.id, id);
    try {
      if (this.bot.me()!.holding) yield* this.throwAway();
      const ok = yield* this.bot.use(
        {
          key: `debris|${id}`,
          point: () => {
            const a = sim.assemblies.get(id);
            return a && a.heldBy === null ? a.body.worldCom() : null;
          },
          ok: (o) => o.kind === 'brick' && o.assemblyId === id,
        },
        { kind: 'grab' },
        0.9,
      );
      if (!ok || this.bot.me()?.holding?.assemblyId !== id) {
        this.bot.failed(`debris|${id}`, 20);
        return false;
      }
    } finally {
      this.bot.squad.clearing.delete(this.bot.id);
    }
    const fits = this.bot
      .plan()
      .ready.find((b) => this.bot.building.holds(b.type, b.colour, b.prints));
    if (fits) return yield* this.bot.building.buildOne(fits);
    yield* this.throwAway();
    return true;
  }

  /** Puts down whatever is in hand, away from the build so nobody steps on it there. */
  *letGo(): Job {
    yield* this.bot.free();
    const p = this.bot.me()!;
    const sim = this.bot.squad.game.sim;
    const held = p.holding ? sim.assemblies.get(p.holding.assemblyId) : undefined;
    if (held && sim.isBuild(held.id)) {
      // A build in the arms: set it down where it can be worked on.
      this.bot.act({ kind: 'drop' });
      for (let k = 0; k < 90 && this.bot.me()?.holding; k++) yield;
      return true;
    }
    yield* this.throwAway();
    return true;
  }

  /** Throws what it holds away, well clear of the build and facing away from it. */
  *throwAway(): Job {
    const sim = this.bot.squad.game.sim;
    const nav = this.bot.squad.nav;
    const centre = sim.buildCentre(sim.build(this.bot.site));
    const flat = (x: number, z: number): number => Math.hypot(x - centre.x, z - centre.z);
    let me = this.bot.feet();
    if (flat(me.x, me.z) < 3.4) {
      const spots = nav
        .around(centre, 5, 1, 1)
        .filter((n) => flat(nav.xs[n]!, nav.zs[n]!) > 3.6)
        .sort(
          (a, b) =>
            Math.hypot(nav.xs[a]! - me.x, nav.zs[a]! - me.z) -
            Math.hypot(nav.xs[b]! - me.x, nav.zs[b]! - me.z),
        );
      if (spots.length) yield* this.bot.walk(spots.slice(0, 4), undefined, 15);
      me = this.bot.feet();
    }
    this.bot.halt();
    yield;
    // Turn away from the build first, smoothly (a sudden turn swings what is in hand, and it
    // would fly off sideways, into the build as like as not), then throw.
    const yaw = Math.atan2(-(me.x - centre.x), -(me.z - centre.z));
    yield* this.bot.face(yaw, 0.3);
    this.bot.act({ kind: 'throw' }, yaw, 0.3);
    yield;
    yield;
    return true;
  }

  /** Takes a treat from the nearest jar and gives it to the dog. */
  *feedDog(): Job {
    const sim = this.bot.squad.game.sim;
    const me = this.bot.feet();
    const jars = [sim.level.dog.treatJar, ...(sim.level.dog.treatJars ?? [])].sort(
      (a, b) => length(sub(a, me)) - length(sub(b, me)),
    );
    for (const jar of jars) {
      if (this.bot.me()?.treat) break;
      const at = add(jar, v3(0, 0.09, 0));
      yield* this.bot.use(
        { key: `treats|${jar.x}|${jar.z}`, point: () => at, ok: (o) => o.kind === 'treats' },
        { kind: 'grab' },
      );
    }
    if (!this.bot.me()?.treat) return false;
    for (let tries = 0; tries < 4 && this.bot.me()?.treat; tries++) {
      yield* this.bot.use(
        {
          key: 'dog',
          point: () => add(sim.dog.body.translation(), v3(0, 0.1, 0)),
          ok: (o) => o.kind === 'dog',
        },
        { kind: 'grab' },
        0.9,
      );
    }
    return !this.bot.me()?.treat;
  }

  *fixPanel(): Job {
    const sim = this.bot.squad.game.sim;
    const panel = sim.panel!;
    const ok = yield* this.bot.use(
      { key: 'panel', point: () => panel, ok: (o) => o.kind === 'panel' },
      { kind: 'grab' },
    );
    if (ok) {
      // Stays on the job until the lights come on.
      for (let k = 0; k < 5 * 60 && !sim.power.on; k++) yield;
      if (sim.power.on) this.bot.say('Power is back on.');
    }
    return ok;
  }

  /** Clears the jam in a machine a saboteur tampered with, staying on it until it is done. */
  *clearJam(id: number): Job {
    const m = this.bot.squad.game.sim.machines.get(id)!;
    const ok = yield* this.bot.use(this.bot.making.machineTarget(id), { kind: 'grab' });
    if (!ok) return false;
    for (let k = 0; k < 6 * 60 && m.jammed && m.fixer === this.bot.id; k++) yield;
    if (!m.jammed) this.bot.say('Cleared the jam, the machine works again.');
    return !m.jammed;
  }

  /** The page in its pocket: reads it, tells the others, and pins it on the board. */
  *pocketPage(): Job {
    const sim = this.bot.squad.game.sim;
    const round = this.bot.squad.game.round!;
    const p = this.bot.me()!;
    const page = p.page === null ? undefined : sim.pages.get(p.page);
    if (!page) return false;
    const printed = round.canRead(this.bot.id) ? page.printed : null;
    if (printed) this.bot.remember(printed);
    if (printed && !this.bot.saboteur) {
      const doubted = this.bot.spotted(printed);
      this.bot.team.tell(printed, this.bot.id, doubted);
      if (doubted) {
        this.bot.say(`Page ${printed.step + 1} has the wrong stamp: it is forged.`);
      }
    }
    if (printed && this.bot.saboteur && !round.partners(this.bot.id).length)
      this.bot.team.tell(printed, this.bot.id);
    // Pin it where everyone can read it.
    const boards = levelBoards(sim.level).filter((b) => b.site === this.bot.site);
    for (const b of boards) {
      const ok = yield* this.bot.use(
        {
          key: `board|${b.pos.x}|${b.pos.z}`,
          point: () => add(b.pos, v3(0, -0.15, 0)),
          ok: (o) => o.kind === 'board',
        },
        { kind: 'grab' },
        1.2,
      );
      if (ok && this.bot.me()?.page === null) return true;
    }
    this.bot.act({ kind: 'dropPage' });
    yield;
    return false;
  }
}
