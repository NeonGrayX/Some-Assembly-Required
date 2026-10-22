import * as THREE from 'three';
import { ACT_STAND, PLAYER_FEET, actStation, outputSlots } from '@sar/shared';
import type { MachineAct, Player, SimEvent } from '@sar/shared';
import { HANDLE_BACK, bucket, mouldBlock, pelletFill, pelletStream } from './brickworks.ts';
import type { MachineLook } from './brickworks.ts';
import { moveFor } from './operate.ts';
import type { Frame, Move, Stage } from './operate.ts';

/**
 * Players operating the brick works' machines move by move (see `operate.ts`), as everyone sees
 * them: once a player is at the machine they work, their body steps where the move has it,
 * their hands go to the machine's real parts, and what they carry is drawn in their hands; the
 * machine shows what their click had it do (its brick works event, held back till then) from
 * the moment their hands set it going, and what they take out stays where it lay till their
 * hands take hold of it.
 */

/** The brick works' events a player's hands bring about, and the act each is part of. */
const ACT_OF: Partial<Record<SimEvent['kind'], MachineAct>> = {
  fill: 'fill',
  dispense: 'start',
  moulded: 'start',
  print: 'print',
  pour: 'pour',
  mouldIn: 'mould',
  toolDown: 'return',
  printerIn: 'lay',
  toolUp: 'take',
};

/** The acts that bring something to the machine, carried in the hands on the way there. */
const BRINGS: MachineAct[] = ['pour', 'mould', 'return', 'lay'];

/**
 * How long an event waits for the player's hands at most (seconds): as long as they could take
 * to walk up to the machine, and then some; then the machine shows it by itself.
 */
const WAIT = 2.6;
/** How far from where the sim has them a body may step for a move, at most (m). */
export const STRAY = 0.85;
/** How long the empty bucket stays where it was set down (seconds), and how long it shrinks. */
const LEFT = { stay: 3, shrink: 0.4 };
/** Where something carried in both hands is held (its middle), from the middle of the body. */
const CARRY = new THREE.Vector3(0, 0.05, -0.42);
/** How big a mould is carried, to its size in a machine (see `makeHeldTool`). */
const HELD_MOULD = 0.75;

/** What a player's body does this frame for a move, in world space (see `Operating.pose`). */
export interface OpPose {
  /** Where the avatar's middle goes, and which way it faces; null: as the sim has it. */
  at: THREE.Vector3 | null;
  heading: number | null;
  /** Where the hands go and the head looks, while the move is under way; else null. */
  hands: [THREE.Vector3 | null, THREE.Vector3 | null] | null;
  look: THREE.Vector3 | null;
  /** What the hands carry up to the machine, to grip, before the move begins (see `carry`). */
  carry: THREE.Object3D | null;
  /** The bucket or mould the sim has in their hands, or the part, is drawn by the move. */
  hideTool: boolean;
  hideHeld: boolean;
}

/** A model the move draws, and how big it is drawn at its own size. */
interface Drawn {
  object: THREE.Object3D;
  scale: number;
}

/** A move under way (or about to be) by one player at one machine. */
interface Op {
  playerId: number;
  machineId: number;
  look: MachineLook;
  act: MachineAct;
  /** Which time this is the player set to work (see `Work.n`), once their work says. */
  n: number | null;
  /** The place in its output area taken from (`take`), -1 for none or the printer's bed. */
  slot: number;
  /** Set once they are there: the move and when it began (seconds). */
  move: Move | null;
  stage: Stage | null;
  start: number;
  /** Their events held till their hands bring them about. */
  events: SimEvent[];
  contacted: boolean;
  grabbed: boolean;
  done: boolean;
  /** What is drawn for it, in the machine's frame. */
  group: THREE.Group;
  prop: Drawn | null;
  taken: Drawn | null;
  level: ((l: number) => void) | null;
  stream: ((t: number | null) => void) | null;
  lip: THREE.Vector3;
}

/** A held event let go of (see `Operating.takeReleased`). */
export interface Released {
  e: SimEvent;
  handled: boolean;
}

/** An event held till a player's hands bring it about, and till when at most. */
interface Waiting {
  e: SimEvent;
  until: number;
}

export class Operating {
  private readonly ops = new Map<number, Op>();
  private waiting: Waiting[] = [];
  private released: Released[] = [];
  /** Empty buckets set down on the floor, till when they stay there. */
  private left: { object: THREE.Object3D; until: number }[] = [];

  constructor(private readonly looks: () => Map<number, MachineLook>) {}

  /**
   * Holds a brick works event a player's hands are to bring about, until they do: the machine
   * shows the state before it till then. Returns whether it was held.
   */
  hold(e: SimEvent, now: number): boolean {
    const act = e.kind ? ACT_OF[e.kind] : undefined;
    if (!act || e.playerId === undefined || e.machineId === undefined) return false;
    const look = this.looks().get(e.machineId);
    if (!look) return false;
    // A mould taken back by the dispenser; the moulding machine's taking one is `mouldIn`.
    if (e.kind === 'toolDown' && look.def.kind !== 'dispenser') return false;
    look.expect(e);
    const op = this.ops.get(e.playerId);
    if (op && !op.done && op.machineId === e.machineId && !op.contacted) op.events.push(e);
    else {
      this.waiting.push({ e, until: now + WAIT });
      // Nothing yet says they are on their way: the event does, for what they bring.
      if (!op || op.done || op.machineId !== e.machineId) {
        if (op) this.end(op, false);
        this.begin(e.playerId, look, act, null, act === 'take' ? (e.slot ?? 0) : -1);
      }
    }
    return true;
  }

  /**
   * The held events let go of since last asked, to be heard: those the hands brought about
   * (`handled`) shown on their machine already; the rest (the player never got there) yet to
   * be shown, as any other.
   */
  takeReleased(): Released[] {
    const out = this.released;
    this.released = [];
    return out;
  }

  /** Lets held events whose wait is up go, and tidies away the buckets left on the floor. */
  tick(now: number): void {
    const due = this.waiting.filter((w) => now >= w.until);
    if (due.length) {
      this.waiting = this.waiting.filter((w) => !due.includes(w));
      for (const w of due) this.released.push({ e: w.e, handled: false });
    }
    for (const l of this.left) {
      const k = Math.min(1, Math.max(0, (l.until - now) / LEFT.shrink));
      l.object.scale.setScalar(Math.max(0.001, k));
      if (now >= l.until) l.object.removeFromParent();
    }
    this.left = this.left.filter((l) => now < l.until);
  }

  /**
   * Draws what player `id` carries up to the machine before their chest, as their avatar
   * (`avatar`, posed for this frame) stands: see `OpPose.carry`.
   */
  carry(id: number, avatar: THREE.Object3D): void {
    const op = this.ops.get(id);
    const d = op?.prop;
    if (!op || op.move || !d?.object.visible) return;
    const o = d.object;
    o.scale.setScalar(d.scale * (op.act === 'mould' || op.act === 'return' ? HELD_MOULD : 1));
    // Turned as they face, its middle where carried things are held.
    avatar.updateMatrixWorld(true);
    const parent = op.group;
    parent.updateMatrixWorld(true);
    const q = new THREE.Quaternion();
    avatar.getWorldQuaternion(q);
    o.quaternion.copy(parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));
    o.position.set(0, 0, 0);
    o.updateMatrixWorld(true);
    const mid = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
    const want = avatar.localToWorld(CARRY.clone());
    o.position.copy(
      parent.worldToLocal(want.sub(mid).add(parent.localToWorld(new THREE.Vector3()))),
    );
  }

  /** Forgets a player who left. */
  forget(id: number): void {
    const op = this.ops.get(id);
    if (op) this.end(op, false);
    this.ops.delete(id);
  }

  /**
   * What player `p`'s body does this frame for the move they make at a machine, if they make
   * one: `at` is where the sim has them (the avatar's middle), `now` in seconds.
   */
  pose(p: Player, at: THREE.Vector3, now: number): OpPose | null {
    const w = p.work;
    let op = this.ops.get(p.id) ?? null;
    const act = w?.act;
    const moving = !!w && w.machineId !== null && !!act && act !== 'fix' && act !== 'work';
    if (w && moving) {
      const look = this.looks().get(w.machineId!);
      // A new act: the one before (if any) is over.
      if (
        op &&
        (op.machineId !== w.machineId || op.act !== act || (op.n !== null && op.n !== w.n))
      ) {
        this.end(op, false);
        op = null;
      }
      if (!op && look) op = this.begin(p.id, look, act, w.n, w.slot);
      if (op && op.n === null) {
        op.n = w.n;
        op.slot = w.slot;
      }
    } else if (op && !op.move && op.n !== null) {
      // Gone off before getting there.
      this.end(op, false);
      op = null;
    }
    if (!op || op.done) return null;
    // Down, or carried off, the move is over.
    if (p.down > 0) {
      this.end(op, false);
      return null;
    }
    if (!op.move && w?.there && moving) this.arrive(op, now);
    if (!op.move) {
      // On the way: carrying what they bring (once the sim has taken it from their hands), and
      // not yet what they are to take.
      const carry = BRINGS.includes(op.act) && !p.tool && !p.holding ? this.carried(op) : null;
      if (op.prop) op.prop.object.visible = !!carry;
      const taking = op.act === 'take' || op.act === 'print';
      return {
        at: null,
        heading: null,
        hands: null,
        look: null,
        carry,
        hideTool: taking,
        hideHeld: taking,
      };
    }
    const t = now - op.start;
    if (t >= op.move.length) {
      this.end(op, true);
      return null;
    }
    return this.frame(op, op.move.frame(t), t, at, now);
  }

  /** Begins following a player's act at a machine (on their way to it, until they arrive). */
  private begin(
    playerId: number,
    look: MachineLook,
    act: MachineAct,
    n: number | null,
    slot: number,
  ): Op {
    const group = new THREE.Group();
    group.name = 'operating';
    look.group.add(group);
    const op: Op = {
      playerId,
      machineId: look.def.id,
      look,
      act,
      n,
      slot,
      move: null,
      stage: null,
      start: 0,
      events: [],
      contacted: false,
      grabbed: false,
      done: false,
      group,
      prop: null,
      taken: null,
      level: null,
      stream: null,
      lip: new THREE.Vector3(),
    };
    // Their events held already are this act's.
    const mine = this.waiting.filter(
      (w) => w.e.playerId === playerId && w.e.machineId === op.machineId,
    );
    this.waiting = this.waiting.filter((w) => !mine.includes(w));
    op.events = mine.map((w) => w.e);
    this.ops.set(playerId, op);
    return op;
  }

  /** They are there: the move begins. */
  private arrive(op: Op, now: number): void {
    const { look } = op;
    const taken = op.act === 'take' || op.act === 'print' ? look.keptModel(op.slot) : null;
    const stage = stageOf(
      look,
      op.act,
      op.slot,
      taken ?? (op.act === 'lay' ? look.bedModel() : null),
    );
    op.stage = stage;
    op.move = moveFor(op.act, stage);
    op.start = now;
    if (!op.move) {
      this.end(op, false);
      return;
    }
    // What they carried up is the move's own from now on.
    if (!op.prop) op.prop = this.propFor(op);
    if (op.prop) op.prop.object.visible = false;
    const colour = op.events[0]?.colour ?? look.state()?.colour;
    const hopper = stage.controls.hopper;
    if (op.act === 'pour' && colour && hopper) {
      // Pellets falling from the bucket's lip into the hopper's mouth (the lip a little over
      // it: see `frame`).
      op.lip.copy(hopper.at).add(new THREE.Vector3(0, 0.2, 0));
      op.stream = pelletStream(op.group, colour, op.lip, hopper.at.y - 0.12);
      op.stream(null);
    }
    if (taken) {
      op.taken = drawn(taken, 1);
      op.taken.object.visible = false;
      op.group.add(taken);
    }
  }

  /** The model of what the move carries, made once. */
  private propFor(op: Op): Drawn | null {
    const kind = op.move?.prop ?? defaultProp(op.act);
    const e = op.events[0];
    const m = op.look.state();
    let object: THREE.Object3D | null = null;
    let scale = 1;
    if (kind === 'pail') object = bucket(null);
    else if (kind === 'bucket') {
      const colour = e?.colour ?? m?.colour;
      const pail = bucket(null);
      if (colour) {
        op.level = pelletFill(pail, colour);
        op.level(1);
      }
      object = pail;
    } else if (kind === 'mould') {
      const type = e?.mould ?? m?.mould;
      if (type) object = mouldBlock(type);
      scale = 1;
    } else if (kind === 'part') object = op.look.bedModel();
    if (!object) return null;
    object.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    op.group.add(object);
    return drawn(object, scale);
  }

  /** What they carry up to the machine, made the first time it is needed. */
  private carried(op: Op): THREE.Object3D | null {
    if (!op.prop) op.prop = this.propFor(op);
    return op.prop?.object ?? null;
  }

  /** Poses what the move draws at `t`, and says where the body and hands go, in world space. */
  private frame(op: Op, f: Frame, t: number, sim: THREE.Vector3, now: number): OpPose {
    const { look, move } = op;
    const g = look.group;
    g.updateMatrixWorld(true);
    // The machine sets about what was asked once the hands set it going; and what is taken
    // goes from where it lay once they take hold of it.
    if (!op.contacted && t >= move!.contact) {
      op.contacted = true;
      for (const e of op.events) {
        look.play(e, now, true);
        this.released.push({ e, handled: true });
      }
      op.events = [];
    }
    if (!op.grabbed && move!.grab >= 0 && t >= move!.grab) {
      op.grabbed = true;
      look.release(op.slot);
    }
    if (op.stage?.kind === 'press') look.step = f.step;
    // What they carry, and what they took.
    place(op.prop, f.prop);
    place(op.taken, f.taken);
    op.level?.(f.level);
    const handle = op.prop?.object.getObjectByName('handle');
    if (handle) handle.rotation.x = HANDLE_BACK * (1 - f.bail);
    if (f.pour) op.lip.copy(f.pour);
    op.stream?.(f.pour ? t : null);
    const world = (v: THREE.Vector3 | null) => (v ? g.localToWorld(v.clone()) : null);
    const stand = g.localToWorld(f.stand.clone().setY(0));
    // Where the body goes: no further than so far from where the sim has it.
    const off = new THREE.Vector3(stand.x - sim.x, 0, stand.z - sim.z);
    if (off.length() > STRAY) off.setLength(STRAY);
    const at = new THREE.Vector3(sim.x + off.x, sim.y + f.stand.y, sim.z + off.z);
    const q = new THREE.Quaternion();
    g.getWorldQuaternion(q);
    const heading = new THREE.Euler().setFromQuaternion(q, 'YXZ').y + f.turn;
    return {
      at,
      heading,
      hands: [world(f.hands[0]), world(f.hands[1])],
      look: world(f.look),
      carry: null,
      hideTool: true,
      hideHeld: op.act === 'take' || op.act === 'print',
    };
  }

  /**
   * Ends a move (`finished`: it played out; otherwise cut short): held events still waiting are
   * shown by the machine by itself, what it drew goes (but an empty bucket set down, a while).
   */
  private end(op: Op, finished: boolean): void {
    if (op.done) {
      if (!finished) this.ops.delete(op.playerId);
      return;
    }
    op.done = true;
    for (const e of op.events) this.released.push({ e, handled: false });
    op.events = [];
    if (!op.grabbed && op.move && op.move.grab >= 0) op.look.release(op.slot);
    if (op.stage?.kind === 'press') op.look.step = 0;
    const now = op.start + (op.move?.length ?? 0);
    if (finished && op.move && op.move.drop >= 0 && op.prop) {
      // The empty bucket stays on the floor where it was set down, a while.
      const object = op.prop.object;
      op.group.remove(object);
      op.look.group.add(object);
      this.left.push({ object, until: now + LEFT.stay });
    }
    op.group.removeFromParent();
    if (!finished || this.ops.get(op.playerId) !== op) this.ops.delete(op.playerId);
  }
}

/** What an act carries if its move does not say (before the move is made). */
function defaultProp(act: MachineAct): 'bucket' | 'pail' | 'mould' | 'part' | null {
  return act === 'pour'
    ? 'bucket'
    : act === 'mould' || act === 'return'
      ? 'mould'
      : act === 'lay'
        ? 'part'
        : null;
}

/** A model the move draws, at `scale` of its own size. */
function drawn(object: THREE.Object3D, scale: number): Drawn {
  object.scale.setScalar(scale);
  return { object, scale };
}

/** Puts what a move draws where the frame has it, or hides it. */
function place(d: Drawn | null, h: Frame['prop']): void {
  if (!d) return;
  d.object.visible = !!h;
  if (!h) return;
  d.object.position.copy(h.at);
  d.object.quaternion.copy(h.quat);
  d.object.scale.setScalar(d.scale * h.scale);
}

/**
 * A machine as a move on it sees it (see `Stage`): `look` drawing it, for `act` at the place
 * `slot` of its output area, `part` what is laid or taken there (to size the hands' grip).
 */
export function stageOf(
  look: MachineLook,
  act: MachineAct,
  slot: number,
  part: THREE.Object3D | null,
): Stage {
  const def = look.def;
  const station = actStation(def.kind, act, slot) ?? 0;
  const size = part ? new THREE.Box3().setFromObject(part).getSize(new THREE.Vector3()) : null;
  return {
    kind: def.kind,
    size: def.size,
    controls: look.controls(),
    places: outputSlots(def.kind, def.size).map(
      (s) => new THREE.Vector3(s.rest.x, s.rest.y, s.rest.z),
    ),
    station: new THREE.Vector3(station, 0, def.size.z / 2 + ACT_STAND),
    height: PLAYER_FEET,
    slot,
    part: size ?? new THREE.Vector3(0.1, 0.06, 0.1),
  };
}
