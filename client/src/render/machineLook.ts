import * as THREE from 'three';
import { outputSlots, printKey } from '@sar/shared';
import type {
  Made,
  MachineDef,
  MachinePart,
  MachineState,
  OutputSlot,
  SimEvent,
} from '@sar/shared';
import { random } from '../clock.ts';
import { KEEP_SEPARATE } from './merge.ts';
import { MachineScreen, SCREEN_OFF, screenStatus } from './machineScreen.ts';
import type { Doing } from './machineScreen.ts';
import type { MachineControls } from './operate.ts';
import { madeModel } from './carried.ts';
import { bedPart } from './machineParts.ts';

/** What a brick works event says, as far as a machine's view shows it. */
export type MachineEvent = Pick<SimEvent, 'kind' | 'mould' | 'colour' | 'slot'>;

/**
 * How long (seconds) what was taken out of a machine is still drawn where it lay, for the hands
 * that took it to get there (see `MachineLook.release`).
 */
const KEEP_SECONDS = 4.5;

/** What was taken out of a place in a machine (or off the printer's bed), drawn there a while. */
type Kept = { made: Made; part?: undefined } | { made?: undefined; part: MachinePart };

/**
 * A machine of the brick works as it is drawn, standing at its foot and turned to face its way,
 * with what is in it shown and what it does played out: what every look of the machines has
 * alike (the game's own models, `MachineView`, and the car scene's, `CarMachineView`). What the
 * machine is doing is kept as jobs, each of which poses the model as it goes and leaves what it
 * made at rest in its place in the output area when it ends; what is in the machine and what
 * waits in its output area are drawn again from its state when that changes.
 */
export abstract class MachineLook {
  /** What changes with the machine's state: rebuilt only when that changes. */
  protected readonly dynamic = new THREE.Group();
  private key = '';
  protected last: { m: MachineState; svgs: Record<string, string>; powered: boolean } | null = null;
  /** The places in its output area (see `outputSlots`). */
  protected readonly places: OutputSlot[];
  /** When a jammed machine next puffs smoke, in seconds. */
  private nextSmoke = 0;
  /** The work under way, and what is drawn for it. */
  protected readonly fx = new THREE.Group();
  protected jobs: Job[] = [];
  /**
   * Jobs that have ended with what they made at rest in the output area before the machine's
   * state says it is there: drawn as they left it until it does (see `update`).
   */
  private resting: Job[] = [];
  /**
   * The brick works' events a player's hands are yet to bring about (see `expect`): what is in
   * the machine is drawn as it was before them till then.
   */
  protected readonly expecting = new Map<SimEvent['kind'], number>();
  /**
   * What was taken out of each place of its output area (-1: off the printer's bed), drawn
   * where it lay till the hands that took it get there (see `release`), and till when at most.
   */
  private readonly kept = new Map<number, Kept & { until: number }>();
  /**
   * What was in it when last drawn: a copy, as the replica changes its machine's state in place
   * (see `Replication.replicaFurniture`), to tell what has gone from it since.
   */
  private seen: MachineState | null = null;
  /** When it was last moved on to (seconds; see `tick`). */
  protected clock = 0;
  /** How far the step under a moulding machine's hopper is slid out (0..1), for whoever is on it. */
  step = 0;
  /** Its display (see `MachineScreen`), once it has one. */
  private screen: MachineScreen | null = null;
  /** The part on the printer's bed is being printed on, its print not on it yet (see `inked`). */
  private inking = false;

  readonly group = new THREE.Group();

  constructor(readonly def: MachineDef) {
    this.places = outputSlots(def.kind, def.size);
  }

  /**
   * Puts the layers of what changes on the model, over what it is built of: called once the
   * model is built, so that they come last among its children.
   */
  protected addLayers(): void {
    // Its display, a hair proud of its screen.
    const { at, w, h } = this.controls().screen;
    this.screen = new MachineScreen(w, h);
    this.screen.mesh.position.set(at.x, at.y, at.z + 0.002);
    this.screen.mesh.userData[KEEP_SEPARATE] = true;
    this.group.add(this.screen.mesh);
    this.fx.userData[KEEP_SEPARATE] = true;
    this.fx.name = 'fx';
    this.dynamic.name = 'contents';
    this.group.add(this.fx, this.dynamic);
  }

  /** Where the parts a player works with their hands are (see `MachineControls`). */
  abstract controls(): MachineControls;

  /**
   * The job that shows event `e`, if this machine shows it at all: as a player's hands do their
   * part of it (`handled`, see `HANDLED`), or as it does it all by itself.
   */
  protected abstract jobFor(
    e: MachineEvent,
    slot: number,
    handled: boolean,
  ): Omit<Job, 'start'> | null;

  /** Draws what is in the machine into `dynamic`, bar what waits in its output area. */
  protected abstract contents(
    m: MachineState,
    svgs: Record<string, string>,
    powered: boolean,
  ): void;

  /** Shows whether something waits in its output area or is on its way there (`busy`). */
  protected waiting(_m: MachineState, _busy: Set<number | undefined>): void {}

  /** Before the jobs under way are posed for a frame (or cut short). */
  protected beforePose(): void {}

  /** What it does by itself every frame, whatever its jobs; `now` in seconds. */
  protected idle(_now: number): void {}

  /** What the machine's state was (`was`, null at first) and is now (`m`), as it changes. */
  protected changed(_was: MachineState | null, _m: MachineState): void {}

  /**
   * Shows the machine doing what a player just had it do: the silo filling a bucket on its
   * grate, the dispenser dropping a mould into its hatch, the moulding machine taking a mould or
   * a bucket of pellets, or moulding a part and dropping it into its bay; what it makes comes to
   * rest in the place in its output area the event says (`slot`). `now` in seconds.
   */
  play(e: MachineEvent, now: number, handled = false): void {
    const waited = this.expecting.get(e.kind) ?? 0;
    if (waited > 1) this.expecting.set(e.kind, waited - 1);
    else this.expecting.delete(e.kind);
    const job = this.jobFor(e, e.slot ?? 0, handled);
    if (job) this.start(job, now);
    else if (waited && this.last) this.rebuild();
  }

  /**
   * Shows the machine as it was before event `e` until a player's hands bring it about (see
   * `play`): the mould not yet in, the pellets not yet poured, the part not yet on the bed, and
   * nothing begun.
   */
  expect(e: MachineEvent): void {
    this.expecting.set(e.kind, (this.expecting.get(e.kind) ?? 0) + 1);
    if (this.last) this.rebuild();
  }

  /** Whether an event of this kind is yet to be brought about (see `expect`). */
  protected awaits(kind: SimEvent['kind']): boolean {
    return this.expecting.has(kind);
  }

  /**
   * What was taken out of place `slot` (-1: off the printer's bed) is no longer drawn there:
   * the hands that took it have it. The machine shows it go (see `taken`).
   */
  release(slot: number): void {
    if (!this.kept.delete(slot)) return;
    this.taken(slot);
    if (this.last) this.rebuild();
  }

  /** A new model of what is still drawn in place `slot` (-1: the printer's bed), if anything. */
  keptModel(slot: number): THREE.Object3D | null {
    const k = this.kept.get(slot);
    if (!k) return null;
    if (k.made) return madeModel(k.made);
    return bedPart(k.part, this.last?.svgs ?? {}, { ...this.bedRoom(), top: 0, x: 0, z: 0 });
  }

  /** What is in the machine as its state last said, if it has said yet. */
  state(): MachineState | null {
    return this.last?.m ?? null;
  }

  /**
   * A new model of the part on the printer's bed (or that was, until the hands take it), its
   * origin the middle of its foot, if there is one.
   */
  bedModel(): THREE.Object3D | null {
    const part = this.last?.m.part ?? this.kept.get(-1)?.part;
    if (!part) return null;
    return bedPart(part, this.last?.svgs ?? {}, { ...this.bedRoom(), top: 0, x: 0, z: 0 });
  }

  /** Where a part lies on the printer's bed, and how much room it has there. */
  protected bedRoom(): { top: number; x: number; z: number; w: number; d: number; room: number } {
    return { top: 0.8, x: 0, z: 0, w: 0.5, d: 0.4, room: 0.12 };
  }

  /**
   * What lies on the printer's bed as drawn: what is on it, or was until the hands take it; its
   * print only once the print is done (see `inked`).
   */
  protected onBed(m: MachineState): MachinePart | null {
    if (m.part) {
      if (this.awaits('printerIn')) return null;
      const blank = this.awaits('print') || this.inking;
      return blank ? { type: m.part.type, colour: m.part.colour } : m.part;
    }
    return this.kept.get(-1)?.part ?? null;
  }

  /**
   * The printer's print (see `printJob`) is under way (`done` false), the part on its bed drawn
   * without it; or it is on the part now (`done`), drawn with it.
   */
  protected inked(done: boolean): void {
    if (this.inking === !done) return;
    this.inking = !done;
    if (this.last) this.rebuild();
  }

  /** Shows what was in place `slot` (-1: the printer's bed) being taken out of it. */
  protected taken(_slot: number): void {}

  /** What the machine shows itself doing, and how far along, for its display. */
  protected doing(): Doing | null {
    const job = this.jobs.find((j) => j.slot !== undefined || j.lane === 'print');
    if (job) return { progress: Math.min(1, (this.clock - job.start) / job.length) };
    const m = this.last?.m;
    // Making something with no job showing it: on its way, how far unknown.
    if (m?.making && !this.expecting.size) return { progress: (this.clock * 0.4) % 1 };
    return null;
  }

  /** Sets a job going from `now` (in seconds). */
  protected start(job: Omit<Job, 'start'>, now: number): void {
    // Making something and loading the machine (or taking out what it made) go on side by
    // side, as a mould can go in while a part is moulded; otherwise one thing at a time, and
    // whatever was under way jumps to its end.
    const keep = this.jobs.filter((j) => laneOf(j) !== laneOf(job));
    const under = this.jobs.filter((j) => !keep.includes(j));
    this.jobs = keep;
    this.beforePose();
    for (const j of under) this.finish(j, true);
    // What an earlier job left in this place makes way for what this one brings.
    if (job.slot !== undefined) this.settle((j) => j.slot === job.slot);
    this.jobs = [...keep, { ...job, start: now }];
    // Whatever is drawn waiting in its place goes while it is under way.
    if (job.slot !== undefined && this.last) this.rebuild();
    this.tick(now);
  }

  /** Moves the work under way along to `now` (in seconds); call every frame. */
  tick(now: number): void {
    this.clock = now;
    // What was taken out is drawn where it lay only so long.
    for (const [slot, k] of this.kept) if (now >= k.until) this.release(slot);
    this.showStatus();
    if (!this.expecting.size) this.idle(now);
    if (!this.jobs.length) return;
    const done = this.jobs.filter((j) => now - j.start >= j.length);
    this.jobs = this.jobs.filter((j) => !done.includes(j));
    // What ended is put away first: that redraws what waits in the output area, which would
    // otherwise undo this frame's pose of the work still under way.
    for (const j of done) this.finish(j);
    this.beforePose();
    for (const j of this.jobs) j.step(now - j.start);
  }

  /** Whether a job is bringing something to place `slot`, or has brought it and it rests there. */
  protected showing(slot: number): boolean {
    return [...this.jobs, ...this.resting].some((j) => j.slot === slot);
  }

  /** Whether the machine is busy showing something. */
  get working(): boolean {
    return this.jobs.length > 0;
  }

  /**
   * Ends a job (no longer among `jobs`). What it made stays at rest where it left it until the
   * machine's state says it is there (the server may say so a moment later than it ends here),
   * and from then on is drawn with the rest of what waits in the output area. Cut short
   * (`early`), it had not got there yet: it is drawn there only once the state says it is.
   */
  private finish(j: Job, early = false): void {
    j.step(j.length);
    j.end();
    if (j.slot === undefined) {
      this.fx.remove(j.group);
      return;
    }
    if (!early && this.last?.m.making?.slot === j.slot) this.resting.push(j);
    else this.fx.remove(j.group);
    if (this.last) this.rebuild();
  }

  /** Stops drawing what the resting jobs that `done` picks out left behind. */
  private settle(done: (j: Job) => boolean): boolean {
    const settled = this.resting.filter(done);
    for (const j of settled) this.fx.remove(j.group);
    this.resting = this.resting.filter((j) => !settled.includes(j));
    return settled.length > 0;
  }

  /**
   * Shows what is in the machine, what waits in its output area, and whether it is jammed or
   * without power; cheap when that has not changed.
   */
  update(m: MachineState, svgs: Record<string, string>, powered = true): void {
    const p = m.part;
    const key = [
      m.mould ?? '',
      m.colour ?? '',
      m.shots,
      p ? `${p.type}:${p.colour}:${printKey(p.prints)}` : '',
      m.jammed,
      powered,
      JSON.stringify(m.out),
    ].join('|');
    // Once the machine is no longer making what a job left at rest, it lies in the output area
    // (unless taken already), drawn there from now on.
    const settled = this.settle((j) => m.making?.slot !== j.slot);
    if (key === this.key && svgs === this.last?.svgs && !settled) return;
    this.key = key;
    const was = this.seen;
    this.seen = { ...m, out: [...m.out] };
    this.last = { m, svgs, powered };
    // What was taken is drawn where it lay a while yet, for the hands that took it.
    if (was) {
      was.out.forEach((made, slot) => {
        if (made && m.out[slot] === null)
          this.kept.set(slot, { made, until: this.clock + KEEP_SECONDS });
      });
      if (was.part && !m.part)
        this.kept.set(-1, { part: was.part, until: this.clock + KEEP_SECONDS });
    }
    this.changed(was, m);
    this.rebuild();
  }

  /** Shows on its display what it is doing, or what it has in it and waits for. */
  private showStatus(): void {
    const last = this.last;
    if (!this.screen || !last) return;
    if (!last.powered) return this.screen.show(SCREEN_OFF);
    this.screen.show(screenStatus(this.def.kind, last.m, this.doing()));
  }

  /** Whether a jammed machine is due another puff of smoke at `now` (in seconds). */
  smokeDue(now: number): boolean {
    if (now < this.nextSmoke) return false;
    this.nextSmoke = now + 0.9 + random() * 0.6;
    return true;
  }

  /** Builds what is in the machine again, as when the colour goggles go on or off. */
  refreshColours(): void {
    if (this.last) this.rebuild();
  }

  protected rebuild(): void {
    // Shared geometries stay; those made for this machine alone go.
    this.dynamic.traverse((o) => {
      if (o instanceof THREE.Mesh && (o.userData.own || o.userData.decoration))
        o.geometry.dispose();
    });
    this.dynamic.clear();
    const { m, svgs, powered } = this.last!;
    this.contents(m, svgs, powered);
    this.outContents(m);
    this.dynamic.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.userData[KEEP_SEPARATE] = true;
      }
    });
  }

  /**
   * What waits in the output area, each thing at rest in its place: but not where a job is
   * bringing something, or has just brought it, which draws it there itself until it is done.
   */
  private outContents(m: MachineState): void {
    const busy = new Set([...this.jobs, ...this.resting].map((j) => j.slot));
    m.out.forEach((there, slot) => {
      const place = this.places[slot];
      const made = there ?? this.kept.get(slot)?.made;
      if (!made || !place || busy.has(slot)) return;
      const thing = madeModel(made);
      thing.position.set(place.rest.x, place.rest.y, place.rest.z);
      thing.userData.slot = slot;
      this.dynamic.add(thing);
    });
    this.waiting(m, busy);
  }

  /** What lies in each place in the output area as drawn, each with its place as `slot`. */
  outItems(): THREE.Object3D[] {
    return this.dynamic.children.filter((o) => o.userData.slot !== undefined);
  }

  /** Where what is made comes to rest in place `slot` of the output area. */
  protected restAt(slot: number): THREE.Vector3 {
    const { rest } = this.places[slot] ?? this.places[0]!;
    return new THREE.Vector3(rest.x, rest.y, rest.z);
  }

  /** A group of its own for one job's models. */
  protected jobGroup(): THREE.Group {
    const g = new THREE.Group();
    this.fx.add(g);
    return g;
  }
}

/** Which jobs go on side by side: one at a time in each lane (see `Job.lane`). */
function laneOf(j: Omit<Job, 'start'>): string {
  return j.lane ?? (j.slot === undefined ? 'load' : 'make');
}

/** Something a machine is showing itself do, from `start` (seconds) for `length`. */
export interface Job {
  start: number;
  length: number;
  /** The place in the output area it brings what it makes to, if it makes something. */
  slot?: number;
  /**
   * What it is busy with, if not making something (`make`, a job with a `slot`) or loading the
   * machine (`load`, one without): jobs go on side by side but for two in the same lane, where
   * the later cuts the earlier short.
   */
  lane?: string;
  /** What is drawn for it alone, gone when it ends. */
  group: THREE.Group;
  /** Poses everything `t` seconds in. */
  step(t: number): void;
  /** Puts the machine back as it was, bar what it made, left at rest where it brought it. */
  end(): void;
}
