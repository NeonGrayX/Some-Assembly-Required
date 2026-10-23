import type { RigidBody } from '@dimforge/rapier3d-compat';
import type { BrickTypeId, ColourId } from '../bricks.ts';
import { DT, seconds } from './time.ts';
import { machinePose, machineOutputs, MOULD_TYPES } from '../content/house.ts';
import type { MachineDef } from '../content/house.ts';
import { makeableColours } from '../builds/variant.ts';
import { rotate, sub, v3, yawQuat } from '../math.ts';
import { NOT_PLAYER_GROUPS, isLooseBrick, REACH } from './body.ts';
import type {
  Sim,
  Holding,
  Player,
  Tool,
  Made,
  MachinePart,
  MachineState,
  SimEvent,
} from './sim.ts';

/** Seconds of work at a machine a saboteur tampered with to get it going again. */
export const UNJAM_SECONDS = 4;
/** How many parts one bucket of pellets makes. */
export const BUCKET_SHOTS = 10;
/**
 * How long (seconds) the brick works take to make a mould, a bucket of pellets or a part and
 * put it in the machine's output area: as long as the machine's animation runs (see
 * `MachineView` on the client, which plays them for exactly this long), so it is there to take
 * just as it comes to rest. The UV printer prints on the part on its bed for `print`.
 */
export const MAKE_SECONDS = { mould: 1.6, bucket: 1.8, part: 2.4, print: 2.4 } as const;
/** `MAKE_SECONDS` in simulation steps. */
export const MAKE_TICKS = {
  mould: seconds(MAKE_SECONDS.mould),
  bucket: seconds(MAKE_SECONDS.bucket),
  part: seconds(MAKE_SECONDS.part),
  print: seconds(MAKE_SECONDS.print),
};
/** A made thing's mould and colour, as the brick works' events tell them. */
function madeFields(made: Made): { mould?: BrickTypeId; colour?: ColourId } {
  if (made.kind === 'mould') return { mould: made.type };
  if (made.kind === 'bucket') return { colour: made.colour };
  return { mould: made.type, colour: made.colour };
}

/**
 * The brick works at work: machines set making moulds, buckets of pellets, parts and prints,
 * what they make put out in their output areas and taken from there, jams cleared, and the
 * tools (a mould, a bucket) players carry between them. The machines' state stays on the `Sim`
 * (`Sim.machines`); this is what changes it. Part of the `Sim`.
 */
export class BrickWorks {
  constructor(private readonly sim: Sim) {}

  addMachine(def: MachineDef, body: RigidBody): void {
    const { centre, half, rot } = machinePose(def);
    const desc = this.sim.R.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setTranslation(centre.x, centre.y, centre.z)
      .setRotation(rot)
      .setFriction(0.8);
    const c = this.sim.world.createCollider(desc, body);
    this.sim.owners.set(c.handle, { kind: 'machine', machineId: def.id });
    // The places in its output area: only there to click while something lies in them (see
    // `setOut`), and never in anyone's way (players' movement meets sensors too, unless their
    // groups keep them apart).
    const slots = machineOutputs(def).map((o, slot) => {
      const sensor = this.sim.world.createCollider(
        this.sim.R.ColliderDesc.cuboid(o.half.x, o.half.y, o.half.z)
          .setTranslation(o.centre.x, o.centre.y, o.centre.z)
          .setRotation(o.rot)
          .setSensor(true)
          .setCollisionGroups(NOT_PLAYER_GROUPS)
          .setEnabled(false),
        body,
      );
      this.sim.owners.set(sensor.handle, { kind: 'output', machineId: def.id, slot });
      return sensor;
    });
    this.sim.outputColliders.set(def.id, slots);
    this.sim.machines.set(def.id, {
      def,
      mould: null,
      colour: null,
      shots: 0,
      part: null,
      jammed: false,
      fixer: null,
      progress: 0,
      out: slots.map(() => null),
      making: null,
    });
  }

  /**
   * Hands what a machine just made for player `p` over to them, out of place `slot` of its
   * output area (-1: the printed part off the printer's bed), and they take it out (`take`);
   * if their hands are not free for it, it waits there for anyone, and they are done.
   */
  collect(p: Player, m: MachineState, slot: number): void {
    p.work = null;
    if (p.handsOff) return;
    if (slot < 0) this.handOver(p, m);
    else this.takeOut(p, m.def.id, slot);
    if (slot < 0 ? m.part !== null : m.out[slot] !== null) return;
    const point = slot < 0 ? machinePose(m.def).centre : machineOutputs(m.def)[slot]!.rest;
    const normal = rotate(yawQuat(m.def.facing), v3(0, 0, 1));
    this.sim.working.startWork(p, m.def.id, { point, normal }, 'take', slot);
  }

  /** Whoever is clearing a jammed machine gets on with it, as long as they stay there on their feet. */
  updateJams(): void {
    for (const m of this.sim.machines.values()) {
      if (m.fixer === null) continue;
      const p = this.sim.players.get(m.fixer);
      if (!p || p.down > 0 || !this.nearMachine(p, m)) {
        Object.assign(m, { fixer: null, progress: 0 });
        this.sim.furnitureVersion++;
        continue;
      }
      m.progress += DT / UNJAM_SECONDS;
      if (m.progress < 1) continue;
      Object.assign(m, { jammed: false, fixer: null, progress: 0 });
      this.sim.furnitureVersion++;
      const pos = machinePose(m.def).centre;
      this.sim.events.push({ kind: 'unjammed', pos, playerId: p.id, machineId: m.def.id });
    }
  }

  /** Whether a player's eye is within reach of a machine's sides. */
  private nearMachine(p: Player, m: MachineState): boolean {
    const { centre, half } = machinePose(m.def);
    const d = sub(this.sim.eye(p), centre);
    // The pose's box is turned with the machine; its longer side is a fair bound either way.
    const side = Math.max(half.x, half.z);
    return Math.hypot(d.x, d.z) <= REACH + side + 0.4;
  }

  /** Puts a fresh part in the player's hands, as if they had just taken it. */
  private handPart(p: Player, part: MachinePart): void {
    const h: Holding = { assemblyId: 0, rot: 0, yawOffset: 0, last: null, settingDown: null };
    const target = this.sim.holdTarget(p, h, null);
    const a = this.sim.spawnBrick(
      part.type,
      part.colour,
      target.pos,
      target.rot,
      undefined,
      undefined,
      part.prints,
    );
    this.sim.carrying.hold(p, a);
    this.sim.tidyLooseBricks();
  }

  /**
   * Sets a machine making something, done in `ticks` (as long as it shows making it), for the
   * first free place in its output area. It makes one thing at a time, and nothing while its
   * output area is full. Returns the place, or -1 if it cannot make it now.
   */
  private startMaking(m: MachineState, made: Made, ticks: number): number {
    const slot = m.out.indexOf(null);
    if (m.making || slot < 0) return -1;
    m.making = { made, slot, at: this.sim.tick + ticks };
    this.sim.furnitureVersion++;
    return slot;
  }

  /** Puts what the machines have finished making in their output areas, to take from there. */
  updateMaking(): void {
    for (const m of this.sim.machines.values()) {
      const job = m.making;
      if (!job || this.sim.tick < job.at) continue;
      m.making = null;
      // The printer's print is on the part on its bed already: it is only done now.
      if (job.slot < 0) this.sim.furnitureVersion++;
      else {
        this.setOut(m, job.slot, job.made);
        this.sim.events.push({
          kind: 'ready',
          pos: machineOutputs(m.def)[job.slot]!.rest,
          machineId: m.def.id,
          slot: job.slot,
          ...madeFields(job.made),
        });
      }
      // Whoever waits by it for it takes it.
      for (const p of this.sim.players.values()) {
        const w = p.work;
        if (w?.act === 'wait' && w.machineId === m.def.id && w.awaits === job.slot)
          this.collect(p, m, job.slot);
      }
    }
  }

  /** Puts something in a place in a machine's output area, or empties it (null). */
  private setOut(m: MachineState, slot: number, made: Made | null): void {
    m.out[slot] = made;
    this.sim.outputColliders.get(m.def.id)?.[slot]?.setEnabled(made !== null);
    this.sim.furnitureVersion++;
  }

  /**
   * Takes what lies in a place in a machine's output area, whoever had the machine make it: a
   * part with the hands free, a mould or a bucket with nothing in them but a mould or a bucket
   * of the same kind, which it takes the place of.
   */
  takeOut(p: Player, machineId: number, slot: number): void {
    const m = this.sim.machines.get(machineId);
    const made = m?.out[slot];
    if (!m || !made || p.holding || this.sim.vacuum.heldBy === p.id) return;
    if (made.kind === 'part') {
      if (p.tool) return;
      this.setOut(m, slot, null);
      this.handPart(p, { type: made.type, colour: made.colour });
      return;
    }
    if (p.tool && p.tool.kind !== made.kind) return;
    this.setOut(m, slot, null);
    this.setTool(p, made);
    this.sim.events.push({
      kind: 'toolUp',
      pos: machineOutputs(m.def)[slot]!.rest,
      playerId: p.id,
      machineId,
      slot,
      ...madeFields(made),
    });
  }

  private setTool(p: Player, tool: Tool | null): void {
    p.tool = tool;
    this.sim.furnitureVersion++;
  }

  /**
   * At the mould dispenser: has it drop the mould for a part (it has one for every part there
   * is) into its hatch, for whoever wants it to take from there.
   */
  dispenseMould(p: Player, type: BrickTypeId): void {
    if (typeof type !== 'string' || !MOULD_TYPES.includes(type)) return;
    const dispenser = this.aimedMachine(p, 'dispenser');
    if (!dispenser || !this.sim.working.machinesPowered) return;
    const slot = this.startMaking(dispenser, { kind: 'mould', type }, MAKE_TICKS.mould);
    if (slot < 0) return;
    this.sim.events.push({
      kind: 'dispense',
      pos: machinePose(dispenser.def).centre,
      playerId: p.id,
      machineId: dispenser.def.id,
      slot,
      mould: type,
    });
  }

  /** Puts the mould or bucket in the player's hands away. */
  putToolAway(p: Player): void {
    if (!p.tool) return;
    this.setTool(p, null);
    this.sim.events.push({ kind: 'toolDown', pos: this.sim.eye(p), playerId: p.id });
  }

  /**
   * A click on a machine. A moulding machine takes the mould or the pellets in the player's
   * hands, or otherwise, if it has a mould and pellets, makes a part and drops it in the tray
   * in its output area. The UV printer takes the loose part in their hands onto its bed, or
   * gives back the part on it. The mould dispenser takes back the mould in their hands. The
   * silo fills buckets only through `fillBucket` once a colour is picked, and the dispenser
   * hands out moulds only through `dispenseMould` once a part is picked; what the machines
   * make waits in their output areas for someone to take it (`takeOut`).
   */
  useMachine(p: Player, machineId: number): void {
    const m = this.sim.machines.get(machineId);
    if (!m || this.sim.vacuum.heldBy === p.id) return;
    const at = machinePose(m.def).centre;
    const event = (
      kind: SimEvent['kind'],
      what: { mould?: BrickTypeId; colour?: ColourId; slot?: number } = {},
    ): void => {
      this.sim.events.push({ kind, pos: at, playerId: p.id, machineId, ...what });
    };
    // A jammed machine takes nothing and makes nothing: a click sets about clearing the jam.
    if (m.jammed) {
      if (m.fixer !== null) return;
      Object.assign(m, { fixer: p.id, progress: 0 });
      this.sim.furnitureVersion++;
      return event('fixing');
    }
    if (m.def.kind === 'press') {
      if (p.tool?.kind === 'mould') {
        m.mould = p.tool.type;
        this.setTool(p, null);
        return event('mouldIn', { mould: m.mould });
      }
      if (p.tool?.kind === 'bucket') {
        m.colour = p.tool.colour;
        m.shots = BUCKET_SHOTS;
        this.setTool(p, null);
        return event('pour', { colour: m.colour });
      }
      if (!m.mould || !m.colour || m.shots <= 0 || !this.sim.working.machinesPowered) return;
      const made = { kind: 'part' as const, type: m.mould, colour: m.colour };
      const slot = this.startMaking(m, made, MAKE_TICKS.part);
      if (slot < 0) return;
      m.shots--;
      if (m.shots === 0) m.colour = null;
      return event('moulded', { mould: made.type, colour: made.colour, slot });
    }
    if (m.def.kind === 'dispenser') {
      if (p.tool?.kind !== 'mould') return;
      const mould = p.tool.type;
      this.setTool(p, null);
      return event('toolDown', { mould });
    }
    if (m.def.kind === 'printer') {
      if (p.tool) return;
      const held = this.sim.heldAssembly(p);
      if (held) {
        if (m.part || !isLooseBrick(held)) return;
        const b = held.grid.bricks.values().next().value!;
        m.part = { type: b.type, colour: b.colour, ...(b.prints ? { prints: b.prints } : {}) };
        this.sim.removeAssembly(held);
        this.sim.furnitureVersion++;
        return event('printerIn');
      }
      // Without a print picked, the part comes back out as it went in.
      this.printPart(p, -1);
    }
  }

  /** The machine the player aims at, if it is one of this kind they may use. */
  private aimedMachine(p: Player, kind: MachineDef['kind']): MachineState | null {
    const hit = this.sim.aim(p);
    if (hit?.owner.kind !== 'machine' || !this.sim.mayUse(p, hit.point)) return null;
    const m = this.sim.machines.get(hit.owner.machineId);
    return m?.def.kind === kind && !m.jammed ? m : null;
  }

  /**
   * At the silo: has it fill a bucket with pellets of this colour on the grate under its tap,
   * for whoever wants it to take from there.
   */
  fillBucket(p: Player, colour: ColourId): void {
    if (typeof colour !== 'string' || !makeableColours().includes(colour)) return;
    const silo = this.aimedMachine(p, 'silo');
    if (!silo || !this.sim.working.machinesPowered) return;
    const slot = this.startMaking(silo, { kind: 'bucket', colour }, MAKE_TICKS.bucket);
    if (slot < 0) return;
    this.sim.events.push({
      kind: 'fill',
      pos: machinePose(silo.def).centre,
      playerId: p.id,
      machineId: silo.def.id,
      slot,
      colour,
    });
  }

  /**
   * At the UV printer, with empty hands: prints print job `job` on the part on its bed (only
   * one for a part of its type), which stays there till it is printed (see `collect`); -1 hands
   * it over as it is.
   */
  printPart(p: Player, job: number): void {
    if (!Number.isInteger(job) || job < -1 || job >= this.sim.printJobs.length) return;
    if (p.holding || p.tool || this.sim.vacuum.heldBy === p.id) return;
    const printer = this.aimedMachine(p, 'printer');
    const part = printer?.part;
    if (!printer || !part || printer.making) return;
    if (job < 0) return this.handOver(p, printer);
    const print = this.sim.printJobs[job]!;
    // Without power nothing is printed.
    if (print.type !== part.type || !this.sim.working.machinesPowered) return;
    printer.part = { ...part, prints: print.prints };
    printer.making = {
      made: { kind: 'part', ...part },
      slot: -1,
      at: this.sim.tick + MAKE_TICKS.print,
    };
    this.sim.furnitureVersion++;
    this.sim.events.push({
      kind: 'print',
      pos: machinePose(printer.def).centre,
      playerId: p.id,
      machineId: printer.def.id,
    });
  }

  /** Hands the part on the printer's bed over to player `p`, if their hands are free for it. */
  private handOver(p: Player, printer: MachineState): void {
    const part = printer.part;
    if (!part || printer.making || p.holding || p.tool || this.sim.vacuum.heldBy === p.id) return;
    printer.part = null;
    this.sim.furnitureVersion++;
    this.handPart(p, part);
  }
}
