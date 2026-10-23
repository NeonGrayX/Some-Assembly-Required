import { BRICK_TYPES } from '../bricks.ts';
import { planBreaks } from '../breaking.ts';
import { TICK_RATE } from './time.ts';
import { v3, yawOf } from '../math.ts';
import type { Vec3 } from '../math.ts';
import { isLooseBrick, TIRED_TICKS, TIRED_DROP_TICKS } from './body.ts';
import type { Sim, Player, Assembly } from './sim.ts';

/** Clicks on a build someone else carries that tug it out of their hands. */
export const TUG_CLICKS = 6;
/** The most time between two clicks of one tug before it starts over. */
const TUG_GAP_TICKS = Math.round(0.5 * TICK_RATE);
/** The knock (velocity change, m/s) a build takes when it is picked up. */
const LIFT_SEVERITY = 1;
/** One tug of war (see `Carrying.tugged`): who tugs whom, how many clicks so far, and when the last. */
interface Tug {
  by: number;
  from: number;
  clicks: number;
  tick: number;
}

/**
 * Picking things up and carrying them: grabbing a brick, a build or what a machine put out,
 * tugging a carried build out of someone's hands or a page out of their pocket, and the arms
 * tiring under a build. Part of the `Sim`.
 */
export class Carrying {
  /** Tugs going on at carried builds (by assembly id) and at pockets (by player id). */
  private readonly buildTugs = new Map<number, Tug>();
  private readonly pocketTugs = new Map<number, Tug>();

  constructor(private readonly sim: Sim) {}

  hold(p: Player, a: Assembly): void {
    const com = a.body.worldCom();
    p.holding = {
      assemblyId: a.id,
      rot: 0,
      yawOffset: yawOf(a.body.rotation()) - p.input.yaw,
      last: null,
      settingDown: null,
    };
    this.sim.setHeld(a, p.id);
    this.sim.events.push({ kind: 'grab', pos: com, count: a.grid.bricks.size });
  }

  /** A click with the hands free (or a tool in them); `output` as in `Action`. */
  grab(p: Player, output = false): void {
    const hit = this.sim.sight.aim(p);
    if (this.sim.interact(p, hit)) return;
    if (p.handsOff) return;
    if (this.sim.vacuum.heldBy === p.id) return this.sim.vacuuming.suck(p);
    if (!hit || !this.sim.mayUse(p, hit.point)) return;
    if (hit.owner.kind === 'machine') {
      return output ? undefined : this.sim.works.useMachine(p, hit.owner.machineId);
    }
    if (hit.owner.kind === 'output')
      return this.sim.works.takeOut(p, hit.owner.machineId, hit.owner.slot);
    if (p.holding || p.tool) return;
    if (hit.owner.kind !== 'brick') return;
    const a = this.sim.assemblies.get(hit.owner.assemblyId);
    if (!a) return;
    if (a.heldBy !== null) return this.tug(p, a);
    if (a.frozen) return;
    if (a.anchored) {
      // Grabbing the baseplate itself lifts the whole build off the job site (to carry it to
      // the inspector). Grabbing any other brick of it takes just that brick.
      const brick = a.grid.bricks.get(hit.owner.brickId)!;
      if (!BRICK_TYPES[brick.type].fixture) return this.sim.knocks.pull(p);
    }
    if (this.tooTiredFor(p, a, hit.point)) return;
    if (a.anchored) {
      // A gear hunt's build is heavy: without the back brace it only lifts for someone walking
      // carefully (and they keep to that pace with it, see `movePlayer`).
      if (this.heavyFor(p) && !p.input.careful) {
        this.sim.events.push({ kind: 'heavy', pos: hit.point, playerId: p.id });
        return;
      }
      this.sim.setAnchored(a, false);
    }
    this.liftJolt(a, hit.owner.brickId);
    this.hold(p, a);
  }

  /**
   * A click on a build someone else carries: enough of them in quick succession pull it out of
   * their hands and into the tugger's. Everyone nearby sees and hears the struggle.
   */
  private tug(p: Player, a: Assembly): void {
    const holder = a.heldBy === null ? undefined : this.sim.players.get(a.heldBy);
    if (!holder || holder.id === p.id || isLooseBrick(a)) return;
    const at = a.body.worldCom();
    if (this.tooTiredFor(p, a, at)) return;
    if (!this.tugged(this.buildTugs, a.id, p, holder)) {
      this.sim.events.push({ kind: 'tug', pos: at, playerId: p.id, fromId: holder.id });
      return;
    }
    this.sim.placing.release(holder);
    this.hold(p, a);
    this.sim.events.push({ kind: 'tugged', pos: at, playerId: p.id, fromId: holder.id });
  }

  /**
   * A click on another player: enough of them in quick succession pick the page out of their
   * pocket and into the picker's (whose own page, if any, drops). Everyone nearby sees it.
   */
  pickpocket(p: Player, victimId: number): void {
    const victim = this.sim.players.get(victimId);
    if (!victim || victim.id === p.id || victim.page === null) return;
    const page = this.sim.pages.get(victim.page);
    if (!page) return;
    const at = this.sim.eye(victim);
    if (!this.tugged(this.pocketTugs, victim.id, p, victim)) {
      this.sim.events.push({ kind: 'pick', pos: at, playerId: p.id, fromId: victim.id });
      return;
    }
    if (p.page !== null) this.sim.pageWork.dropPage(p);
    victim.page = null;
    page.carriedBy = p.id;
    page.version++;
    p.page = page.id;
    this.sim.events.push({ kind: 'picked', pos: at, playerId: p.id, fromId: victim.id });
  }

  /**
   * Counts one click of a tug at `key` of `tugs` (a build, or a player's pocket) by `p` against
   * `from`: true once there have been `TUG_CLICKS` of them, each soon enough after the one
   * before.
   */
  private tugged(tugs: Map<number, Tug>, key: number, p: Player, from: Player): boolean {
    const t = tugs.get(key);
    const clicks =
      t && t.by === p.id && t.from === from.id && this.sim.tick - t.tick <= TUG_GAP_TICKS
        ? t.clicks + 1
        : 1;
    if (clicks < TUG_CLICKS) {
      tugs.set(key, { by: p.id, from: from.id, clicks, tick: this.sim.tick });
      return false;
    }
    tugs.delete(key);
    return true;
  }

  /** Too tired to lift build `a` (a single brick is never too much): says so, and is true. */
  private tooTiredFor(p: Player, a: Assembly, at: Vec3): boolean {
    if (isLooseBrick(a) || p.fatigue < TIRED_TICKS) return false;
    this.sim.events.push({ kind: 'tired', pos: at, playerId: p.id });
    return true;
  }

  /** Carry fatigue builds while carrying a build and wears off otherwise; at its limit, they set it down. */
  tire(p: Player): void {
    const held = this.sim.heldAssembly(p);
    if (!held || isLooseBrick(held)) {
      p.fatigue = Math.max(0, p.fatigue - 1);
      return;
    }
    p.fatigue++;
    if (this.sim.replica || p.fatigue < TIRED_DROP_TICKS || p.holding?.settingDown != null) return;
    this.sim.placing.setDown(p);
    this.sim.events.push({ kind: 'tired', pos: held.body.worldCom(), playerId: p.id });
  }

  /**
   * Picking a build up (by part `by`) jolts it: whatever holds on too weakly for even that (a
   * tall tower of round 1x1 bricks on one stud) comes off and topples over where it stood.
   */
  private liftJolt(a: Assembly, by: number): void {
    if (this.sim.replica || a.grid.size < 2) return;
    const pieces = this.sim.resplit(a, planBreaks(a.grid, LIFT_SEVERITY, this.sim.rng, by), by);
    for (const piece of pieces) {
      const tip = this.sim.rng() * 2 * Math.PI;
      piece.body.setAngvel(v3(Math.cos(tip) * 1.5, 0, Math.sin(tip) * 1.5), true);
    }
    if (pieces.length)
      this.sim.events.push({ kind: 'break', pos: a.body.worldCom(), count: pieces.length });
  }

  /** Whether the build is too heavy for this player to carry at more than a careful pace. */
  heavyFor(p: Player): boolean {
    return this.sim.hazards.has('brace') && !p.gear.has('brace');
  }
}
