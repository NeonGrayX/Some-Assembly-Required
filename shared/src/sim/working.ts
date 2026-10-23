import { ACT_STAND, ACT_TIMES, actStation } from './operate.ts';
import type { MachineAct } from './operate.ts';
import { DT, seconds } from './time.ts';
import { add, length, rotate, scale, sub, v3, yawQuat } from '../math.ts';
import { REACH } from './body.ts';
import type { Sim, Player, Work, AimHit } from './sim.ts';

/** Seconds of work at the electrical panel to get the power back on. */
export const REPAIR_SECONDS = 3;
/** How far out from where they click a machine a player stands to work it (m). */
export const WORK_STANDOFF = 0.55;
/** How long they walk up to a machine at most before working it where they are. */
const WORK_WALK_TICKS = seconds(1.5);
/** How long they stay at a machine working it, once there (clearing a jam: till it is clear). */
export const WORK_TICKS = seconds(1.1);
/**
 * How long a player waiting by a machine for what it makes them (see `Work.awaits`) waits on
 * once it no longer shows making it: on a client, for the server to say they took it.
 */
const WAIT_TICKS = seconds(0.5);

/**
 * Players at work: walking up to a machine or the electrical panel, working it with their
 * hands for as long as the job takes, and what comes of it; and the power, which breaks down,
 * is fixed at the panel and is dead for a gear hunt. Its state stays on the `Sim` (`Sim.power`,
 * `Player.work`). Part of the `Sim`.
 */
export class Working {
  constructor(private readonly sim: Sim) {}

  /**
   * They have got to where they work (or as near as they could): what the machine was asked to
   * make is begun as their hands set it going (see `ACT_TIMES`), and done that much later.
   */
  arrive(w: Work): void {
    w.there = true;
    const m = w.machineId === null ? undefined : this.sim.machines.get(w.machineId);
    if (!w.delays || !m?.making) return;
    m.making.at += this.sim.tick - w.since + seconds(ACT_TIMES[w.act].lead);
    this.sim.furnitureVersion++;
  }

  /**
   * They are done with their hands at the machine: they stand by it while it makes what they set
   * it making (see `Work.awaits`), and once it is done take it (on the server, which says so:
   * see `collect`); otherwise they are done.
   */
  workDone(p: Player, w: Work): void {
    const m = w.machineId === null || w.awaits === null ? null : this.sim.machines.get(w.machineId);
    if (!m || w.awaits === null) {
      p.work = null;
      return;
    }
    const making = m.making?.slot === w.awaits;
    if (!making && w.act === 'wait') p.work = null;
    else if (!making && !this.sim.replica) this.sim.works.collect(p, m, w.awaits);
    else Object.assign(w, { act: 'wait', slot: w.awaits, ticks: WAIT_TICKS });
  }

  /** Whether player `id` is fixing something: clearing a jammed machine, or the panel. */
  fixing(id: number): boolean {
    if (this.sim.power.fixer === id) return true;
    for (const m of this.sim.machines.values()) if (m.fixer === id) return true;
    return false;
  }

  /** Who is fixing machine `machineId` (null: the electrical panel), if anyone. */
  fixerOf(machineId: number | null): number | null {
    return machineId === null
      ? this.sim.power.fixer
      : (this.sim.machines.get(machineId)?.fixer ?? null);
  }

  /**
   * Walks `p` up to the machine (null: the electrical panel) they clicked at `hit`, to do `act`
   * there (see `Player.work`): to their station for it before the machine, or where they
   * clicked it.
   */
  startWork(
    p: Player,
    machineId: number | null,
    hit: Pick<AimHit, 'point' | 'normal'>,
    act: MachineAct = 'work',
    slot = -1,
  ): void {
    const at = p.body.translation();
    // Out from the face they clicked; off a top, back the way they came.
    let out = v3(hit.normal.x, 0, hit.normal.z);
    if (length(out) < 0.3) out = v3(at.x - hit.point.x, 0, at.z - hit.point.z);
    out = length(out) > 1e-6 ? scale(out, 1 / length(out)) : v3(0, 0, 1);
    let spot = add(v3(hit.point.x, at.y, hit.point.z), scale(out, WORK_STANDOFF));
    const def = machineId === null ? undefined : this.sim.machines.get(machineId)?.def;
    const x = def ? actStation(def.kind, act) : null;
    if (def && x !== null) {
      const station = rotate(yawQuat(def.facing), v3(x, 0, def.size.z / 2 + ACT_STAND));
      spot = v3(def.pos.x + station.x, at.y, def.pos.z + station.z);
    }
    const ticks = act === 'fix' ? WORK_TICKS : seconds(ACT_TIMES[act].seconds);
    p.work = {
      n: ++p.works,
      machineId,
      act,
      slot,
      spot,
      hand: hit.point,
      since: this.sim.tick,
      delays: false,
      awaits: null,
      there: false,
      walk: WORK_WALK_TICKS,
      ticks,
    };
  }

  /** The electrical panel breaks down: the lights stay out until someone fixes it. */
  breakPower(): void {
    if (!this.sim.power.on || !this.sim.panel) return;
    Object.assign(this.sim.power, { on: false, fixer: null, progress: 0 });
    this.sim.furnitureVersion++;
    this.sim.events.push({ kind: 'powerOut', pos: this.sim.panel });
  }

  /**
   * The panel dies for the round (a gear hunt): the lights go out for good, and the brick
   * works run on a circuit of their own.
   */
  killPower(): void {
    if (this.sim.power.dead) return;
    this.sim.power.dead = true;
    this.sim.furnitureVersion++;
    this.breakPower();
  }

  /** The power comes back without anyone fixing the panel. */
  restorePower(): void {
    if (this.sim.power.on || !this.sim.panel) return;
    Object.assign(this.sim.power, { on: true, fixer: null, progress: 0 });
    this.sim.furnitureVersion++;
    this.sim.events.push({ kind: 'powerOn', pos: this.sim.panel });
  }

  /**
   * Whether the brick works' machines have power: they stop while the panel is out, but run on
   * a circuit of their own while it is dead for the round (`PowerState.dead`).
   */
  get machinesPowered(): boolean {
    return this.sim.power.on || this.sim.power.dead;
  }

  /** Whoever is fixing the panel gets on with it, as long as they stay there on their feet. */
  updatePower(): void {
    const power = this.sim.power;
    if (power.fixer === null || !this.sim.panel) return;
    const p = this.sim.players.get(power.fixer);
    if (!p || p.down > 0 || length(sub(this.sim.eye(p), this.sim.panel)) > REACH + 0.4) {
      power.fixer = null;
      power.progress = 0;
      this.sim.furnitureVersion++;
      return;
    }
    power.progress += DT / REPAIR_SECONDS;
    if (power.progress < 1) return;
    Object.assign(power, { on: true, fixer: null, progress: 0 });
    this.sim.furnitureVersion++;
    this.sim.events.push({ kind: 'powerOn', pos: this.sim.panel, playerId: p.id });
  }
}
