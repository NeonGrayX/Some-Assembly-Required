import type { BrickTypeId, ColourId } from '../bricks.ts';
import { printKey } from '../builds/types.ts';
import type { Prints } from '../builds/types.ts';
import { machineFront, machineOutputs, machinePose } from '../content/house.ts';
import { add, length, rotate, sub, v3, yawQuat } from '../math.ts';
import { isLooseBrick } from '../sim/sim.ts';
import type { Action, ColliderOwner, MachineState, Made } from '../sim/sim.ts';
import type { Bot, Job, Target } from './bot.ts';

/**
 * Whether two things the brick works make are the same: moulds for the same part, buckets of
 * pellets of the same colour, or the same part in the same colour.
 */
function sameMade(a: Made, b: Made): boolean {
  if (a.kind === 'mould') return b.kind === 'mould' && a.type === b.type;
  if (a.kind === 'bucket') return b.kind === 'bucket' && a.colour === b.colour;
  return b.kind === 'part' && a.type === b.type && a.colour === b.colour;
}

/**
 * How long a bot leaves what someone else had a machine of the brick works make, for them to
 * come for (s from when it landed): it does not take it for itself, nor a person's out of the
 * way.
 */
const ORDER_GRACE_SECONDS = 20;

/**
 * A bot at the brick works: fetching a brick it needs, made from scratch if need be (a mould
 * and a bucket of pellets into a moulding machine, the part through the UV printer), and taking
 * what the machines made out of their output areas.
 */
export class BrickMaking {
  constructor(private readonly bot: Bot) {}

  /** Gets this part into its hands: one lying about, or out of the brick works. */
  *fetch(type: BrickTypeId, colour: ColourId, prints?: Prints): Job {
    if (this.bot.building.holds(type, colour, prints)) return true;
    if (this.bot.me()!.holding) yield* this.bot.throwAway();
    const sim = this.bot.squad.game.sim;
    // A loose one close by (off a broken build, say).
    const me = this.bot.feet();
    const loose = [...sim.assemblies.values()]
      .filter(
        (a) =>
          isLooseBrick(a) && a.heldBy === null && !a.frozen && !this.bot.avoided(`loose|${a.id}`),
      )
      .filter((a) => {
        const b = a.grid.bricks.values().next().value!;
        return b.type === type && b.colour === colour && printKey(b.prints) === printKey(prints);
      })
      .filter(
        (a) =>
          length(sub(a.body.worldCom(), me)) < 9 && sim.mayUse(this.bot.me()!, a.body.worldCom()),
      )
      .sort((a, b) => length(sub(a.body.worldCom(), me)) - length(sub(b.body.worldCom(), me)))[0];
    if (loose) {
      const id = loose.id;
      const ok = yield* this.bot.use(
        {
          key: `loose|${id}`,
          point: () => {
            const a = sim.assemblies.get(id);
            return a && a.heldBy === null ? a.body.worldCom() : null;
          },
          ok: (o) => o.kind === 'brick' && o.assemblyId === id,
        },
        { kind: 'grab' },
        0.9,
      );
      if (ok && this.bot.building.holds(type, colour, prints)) return true;
      this.bot.failed(`loose|${id}`, 30);
    }
    if (prints) {
      if (!(yield* this.mould(type, colour))) return false;
      return yield* this.print(type, prints);
    }
    return yield* this.mould(type, colour);
  }

  /** A moulding machine's front, as somewhere to click. */
  machineTarget(id: number): Target {
    const sim = this.bot.squad.game.sim;
    const m = sim.machines.get(id)!;
    const turn = yawQuat(m.def.facing);
    const height = Math.min(1, machinePose(m.def).half.y * 1.6);
    const point = add(machineFront(m.def), rotate(turn, v3(0, height, -0.05)));
    return {
      key: `machine|${id}`,
      point: () => point,
      ok: (o) => o.kind === 'machine' && o.machineId === id,
    };
  }

  machinesOf(kind: string): number[] {
    const sim = this.bot.squad.game.sim;
    const p = this.bot.me()!;
    return [...sim.machines.values()]
      .filter((m) => m.def.kind === kind && sim.mayUse(p, m.def.pos))
      .map((m) => m.def.id);
  }

  /**
   * Makes a part at a moulding machine, setting one up for it if none makes it already: the
   * machine that needs the fewest trips (a new mould keeps the pellets in it), and not one
   * making something another bot is fetching. With both machines busy being set up, it fetches
   * the mould meanwhile and waits for one. A part like it lying in a machine's tray already, that
   * nobody else waits for or ordered lately, it just takes.
   */
  private *mould(type: BrickTypeId, colour: ColourId): Job {
    const sim = this.bot.squad.game.sim;
    const part: Made = { kind: 'part', type, colour };
    const presses = (): MachineState[] => {
      const me = this.bot.feet();
      return this.machinesOf('press')
        .map((id) => sim.machines.get(id)!)
        .sort((a, b) => length(sub(a.def.pos, me)) - length(sub(b.def.pos, me)));
    };
    for (const m of presses()) {
      const slot = this.lying(m, part);
      if (slot >= 0 && (yield* this.takeOut(m.def.id, slot)))
        return this.bot.building.holds(type, colour);
    }
    const makes = (m: MachineState): boolean =>
      m.mould === type && m.colour === colour && m.shots > 0;
    const free = (m: MachineState): boolean => {
      const by = this.bot.squad.presses.get(m.def.id);
      return by === undefined || by === this.bot.id || !this.bot.squad.bots.has(by);
    };
    let press = presses().find(makes);
    for (let wait = 0; !press && wait < 2; wait++) {
      const wanted = new Set(
        [...this.bot.squad.claims]
          .filter(([id]) => id !== this.bot.id)
          .map(([, c]) => `${c.brick.type}|${c.brick.colour}`),
      );
      const trips = (m: MachineState): number =>
        (m.mould === type ? 0 : 1) +
        (m.colour === colour && m.shots > 0 ? 0 : 1) +
        (m.shots > 0 && wanted.has(`${m.mould}|${m.colour}`) ? 3 : 0);
      const choice = presses()
        .filter(free)
        .sort((a, b) => trips(a) - trips(b))[0];
      if (!choice) {
        // Both being set up: get the mould meanwhile, then wait by the machines for one.
        if (!(yield* this.getMould(type))) return false;
        const near = presses()[0];
        if (near)
          yield* this.bot.walk(
            this.bot.stands(this.machineTarget(near.def.id).point()!, () => true, 1.6).slice(0, 3),
            undefined,
            20,
          );
        for (let k = 0; k < 20 * 60 && !presses().some((m) => free(m) || makes(m)); k += 10) {
          for (let t = 0; t < 10; t++) yield;
        }
        press = presses().find(makes);
        continue;
      }
      this.bot.squad.presses.set(choice.def.id, this.bot.id);
      try {
        if (choice.mould !== type) {
          if (!(yield* this.getMould(type))) return false;
          if (!(yield* this.bot.use(this.machineTarget(choice.def.id), { kind: 'grab' })))
            return false;
          if (choice.mould !== type) return false;
        }
        if (choice.colour !== colour || choice.shots <= 0) {
          if (!(yield* this.getPellets(colour))) return false;
          if (!(yield* this.bot.use(this.machineTarget(choice.def.id), { kind: 'grab' })))
            return false;
          if (choice.colour !== colour) return false;
        }
      } finally {
        this.bot.squad.presses.delete(choice.def.id);
      }
      press = choice;
    }
    if (!press || !makes(press)) return false;
    return yield* this.collect(press.def.id, part, { kind: 'grab' });
  }

  /** Gets the mould for a part out of the dispenser. */
  private *getMould(type: BrickTypeId): Job {
    const id = this.machinesOf('dispenser')[0];
    if (id === undefined) return false;
    return yield* this.collect(id, { kind: 'mould', type }, { kind: 'mould', type });
  }

  /** Gets a bucket of pellets of a colour out of the silo. */
  private *getPellets(colour: ColourId): Job {
    const id = this.machinesOf('silo')[0];
    if (id === undefined) return false;
    return yield* this.collect(id, { kind: 'bucket', colour }, { kind: 'fill', colour });
  }

  /**
   * Gets `wanted` out of a machine of the brick works: one lying in its output area already
   * (anyone may take anything, but it leaves what someone else waits for or ordered lately), or
   * else one it has the machine make with a click (`order`), waits for and takes out. A machine
   * makes one thing at a time, and nothing while its output area is full, so it waits its turn
   * there, and takes out of the way what nobody comes for. Every wait has an end, and if the
   * machine cannot make it, or someone else takes what it had made first, it gives up, to try
   * again later.
   */
  private *collect(id: number, wanted: Made, order: Action): Job {
    const sim = this.bot.squad.game.sim;
    const m = sim.machines.get(id);
    if (!m) return false;
    // Whether the machine can make it now. Jammed or without power, it makes nothing (and a click
    // on a jammed one would set about clearing the jam instead); a moulding machine makes what is
    // in it.
    const able = (): boolean =>
      !m.jammed &&
      sim.working.machinesPowered &&
      (wanted.kind !== 'part' ||
        (m.mould === wanted.type && m.colour === wanted.colour && m.shots > 0));
    for (let tries = 0; tries < 3; tries++) {
      if (this.has(wanted)) return true;
      const there = this.lying(m, wanted);
      if (there >= 0) {
        if (yield* this.takeOut(id, there)) return this.has(wanted);
        continue;
      }
      if (!able()) return false;
      // Waits at the machine, in reach of (the middle of) its output area too: there it sees who
      // comes to take what is in it, and takes out what it has made without another step.
      const front = this.machineTarget(id);
      const out = machineOutputs(m.def)[Math.floor(m.out.length / 2)]!.aim;
      const near = (o: ColliderOwner): boolean =>
        (o.kind === 'machine' || o.kind === 'output') && o.machineId === id;
      const inReach = (): boolean =>
        !!this.bot.aim(front.point()!, front.ok) && !!this.bot.aim(out, near);
      if (!inReach()) yield* this.bot.walk(this.bot.stands(out, near).slice(0, 3), inReach);
      if (!(yield* this.makeRoom(m, wanted, able)) || this.has(wanted)) continue;
      // Things change while it waits.
      if (!able()) return false;
      // A moulding machine takes a mould or a bucket in hand instead of making a part.
      if (wanted.kind === 'part' && this.bot.me()?.tool) yield* this.bot.putAway();
      if (!(yield* this.bot.use(front, order))) return false;
      const job = m.making;
      // It would not make it (no power, say).
      if (!job) return false;
      // Someone else had it make something first, or the same, clicking at the same time.
      const by = this.bot.squad.order(id, job.slot)?.by ?? this.bot.id;
      if (!sameMade(job.made, wanted) || by !== this.bot.id || this.awaited(id, job.slot)) continue;
      this.bot.squad.collecting.set(this.bot.id, { machine: id, slot: job.slot });
      try {
        for (let k = 0; k < 5 * 60 && m.making === job; k++) yield;
        // Standing by it for it, it takes it out itself once made and its hands are done.
        yield* this.bot.free();
        if (this.has(wanted)) return true;
        const made = m.out[job.slot];
        // Taken by someone else before it could.
        if (!made || !sameMade(made, wanted)) return false;
        return (yield* this.takeOut(id, job.slot)) && this.has(wanted);
      } finally {
        this.bot.squad.collecting.delete(this.bot.id);
      }
    }
    return this.has(wanted);
  }

  /**
   * Waits for a machine to be ready to make something: done with what it is making, with room
   * in its output area. When that stays full of things nobody comes for, it takes one out of the
   * way and gets rid of it (while the machine can still make what it wants, by `able`), unless
   * one is what it wants, to keep. It leaves what another bot waits for, and what a person still
   * in the game ordered, for `ORDER_GRACE_SECONDS`. Returns whether the machine is ready.
   */
  private *makeRoom(m: MachineState, wanted: Made, able: () => boolean): Job {
    const id = m.def.id;
    const ready = (): boolean => !m.making && m.out.includes(null);
    for (let k = 0; k < 5 * 60 && m.making; k++) yield;
    // Full: whoever had those made may be on their way.
    for (let k = 0; k < 3 * 60 && !ready() && !m.making; k++) yield;
    if (ready() || m.making) return ready();
    const spare = m.out.flatMap((x, s) => {
      const by = this.orderedBy(id, s);
      return x && !this.awaited(id, s) && (by === null || this.bot.squad.bots.has(by)) ? [s] : [];
    });
    const slot = spare.find((s) => sameMade(m.out[s]!, wanted)) ?? spare[0];
    if (slot === undefined) return false;
    const keep = sameMade(m.out[slot]!, wanted);
    if (!keep && !able()) return false;
    if (!(yield* this.takeOut(id, slot))) return false;
    if (!keep) yield* this.discard(m);
    return ready();
  }

  /**
   * Takes what lies in a place in a machine's output area, with its hands ready for it: free for
   * a part; for a mould or a bucket, with no brick in them nor a tool of the other kind (one of
   * the same kind it takes the place of). Returns whether it got it.
   */
  private *takeOut(id: number, slot: number): Job {
    const made = this.bot.squad.game.sim.machines.get(id)?.out[slot];
    if (!made) return false;
    if (this.bot.me()?.holding) yield* this.bot.letGo();
    const tool = this.bot.me()?.tool;
    if (tool && (made.kind === 'part' || tool.kind !== made.kind)) yield* this.bot.putAway();
    if (!(yield* this.bot.use(this.outputTarget(id, slot), { kind: 'grab', output: true }))) {
      return false;
    }
    return this.has(made);
  }

  /**
   * Gets rid of something it took out of a machine's way: a mould or a bucket it puts away, and
   * a part it sets down on the floor, turned away from the machine, for anyone to use.
   */
  private *discard(m: MachineState): Job {
    if (this.bot.me()?.tool) return yield* this.bot.putAway();
    if (!this.bot.me()?.holding) return true;
    const out = rotate(yawQuat(m.def.facing), v3(0, 0, 1));
    const yaw = Math.atan2(-out.x, -out.z);
    yield* this.bot.face(yaw, -0.3);
    this.bot.act({ kind: 'drop' }, yaw, -0.3);
    yield;
    yield;
    return true;
  }

  /** A place in a machine's output area, as somewhere to click to take what lies there. */
  private outputTarget(id: number, slot: number): Target {
    const m = this.bot.squad.game.sim.machines.get(id)!;
    const point = machineOutputs(m.def)[slot]!.aim;
    return {
      key: `output|${id}|${slot}`,
      point: () => (m.out[slot] ? point : null),
      ok: (o) => o.kind === 'output' && o.machineId === id && o.slot === slot,
    };
  }

  /**
   * The place in a machine's output area where `wanted` lies for anyone to take: no other bot
   * waits to take it, nor did anyone else order it lately. Or -1.
   */
  private lying(m: MachineState, wanted: Made): number {
    const id = m.def.id;
    return m.out.findIndex(
      (x, slot) =>
        x !== null &&
        sameMade(x, wanted) &&
        !this.awaited(id, slot) &&
        this.orderedBy(id, slot) === null,
    );
  }

  /** Whether another bot had a machine make what is (or will be) in this place, to take it. */
  private awaited(id: number, slot: number): boolean {
    for (const [bot, c] of this.bot.squad.collecting) {
      if (bot !== this.bot.id && c.machine === id && c.slot === slot) return true;
    }
    return false;
  }

  /**
   * Who else, still in the game, had a machine make what lies in this place (or is being made
   * for it), if it landed there less than `ORDER_GRACE_SECONDS` ago: they may be on their way
   * for it. Or null.
   */
  private orderedBy(id: number, slot: number): number | null {
    const o = this.bot.squad.order(id, slot);
    if (!o || o.by === this.bot.id || !this.bot.squad.game.sim.players.has(o.by)) return null;
    const fresh = o.landed === null || this.bot.squad.tick - o.landed < ORDER_GRACE_SECONDS * 60;
    return fresh ? o.by : null;
  }

  /** Whether it has this in hand: the mould or the bucket, or the part. */
  private has(made: Made): boolean {
    if (made.kind === 'part') return this.bot.building.holds(made.type, made.colour);
    const tool = this.bot.me()?.tool;
    return !!tool && sameMade(tool, made);
  }

  /** Takes the part in hand to the UV printer and has these pictures printed on it. */
  private *print(type: BrickTypeId, prints: Prints): Job {
    const sim = this.bot.squad.game.sim;
    const job = sim.printJobs.findIndex(
      (j) => j.type === type && printKey(j.prints) === printKey(prints),
    );
    const id = this.machinesOf('printer')[0];
    if (job < 0 || id === undefined) return false;
    const printer = sim.machines.get(id)!;
    for (let k = 0; k < 240 && printer.part; k++) yield;
    if (printer.part) return false;
    yield* this.bot.use(this.machineTarget(id), { kind: 'grab' });
    if (!printer.part) return false;
    yield* this.bot.use(this.machineTarget(id), { kind: 'print', job });
    // It takes the part off the bed once it is printed.
    for (let k = 0; k < 10 * 60 && printer.part && !this.bot.building.holdingBrick(); k++) yield;
    return !!this.bot.building.holdingBrick();
  }
}
