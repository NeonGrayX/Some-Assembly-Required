import * as THREE from 'three';
import { ACT_TIMES, MAKE_SECONDS } from '@sar/shared';
import type { MachineAct, MachineKind } from '@sar/shared';

/*
 * Operating the brick works' machines move by move: what a player's body and hands do for each
 * act (see `MachineAct`) on the real parts of the machine they work, as the look that draws it
 * has them (`MachineControls`): the hand goes to the start button and presses it in, an empty
 * bucket is lifted off the silo's stack by its rim and set down on the grate under the tap, a
 * bucket of pellets is lifted up over the moulding machine's hopper from the step that slides
 * out under it and tipped in, the safety door is slid aside by its handle and the mould pushed
 * in between the platens, and so on. Everything is in the machine's own frame (its foot's
 * middle the origin, its front +z), which turned to face the machine is the avatar's own too.
 * The machine itself does its part of each act (see `HANDLED`) from the moment the hands set it
 * going (`Move.contact`), so the two meet.
 */

/** A bucket's size: how tall, and how wide its bottom and its rim are (radii). */
export const BUCKET = { height: 0.26, bottom: 0.1, top: 0.125 };

/** How high the step that slides out under a moulding machine's hopper stands. */
export const HOPPER_STEP = 0.4;
/** How wide and deep its tread is, and how far it slides out of the machine's bed. */
export const HOPPER_STEP_SIZE = { w: 0.5, d: 0.34, run: 0.34 };

/**
 * Where the parts of a machine a player works with their hands are, in its own frame, as the
 * look that draws it has them.
 */
export interface MachineControls {
  /** The face of the button (or key) that starts it, which faces +z. */
  button: THREE.Vector3;
  /** Its display: its middle, how wide and how tall it is; its face toward +z. */
  screen: { at: THREE.Vector3; w: number; h: number };
  /** The moulding machine's hopper: the middle of its mouth, and how wide it is (radius). */
  hopper?: { at: THREE.Vector3; r: number };
  /**
   * The moulding machine's mould: its middle where it is clamped, where it is held to slide it
   * in (before the open door), how wide it is across (x), and how a mould block (see
   * `mouldBlock`) is turned and scaled to look like it there.
   */
  mould?: {
    home: THREE.Vector3;
    out: THREE.Vector3;
    width: number;
    quat: THREE.Quaternion;
    scale?: number;
  };
  /** Its safety door's handle while it is shut, and how far the door slides open (along +x). */
  door?: { handle: THREE.Vector3; slide: number };
  /** The silo: where the foot of the top bucket on its stack of empty ones is. */
  stack?: THREE.Vector3;
  /** The printer: where the foot of a part lies on its bed. */
  bed?: THREE.Vector3;
}

/** A machine as a move sees it. */
export interface Stage {
  kind: MachineKind;
  /** Its box: its front is half its depth out along +z. */
  size: { x: number; y: number; z: number };
  controls: MachineControls;
  /** Where what lies in each place of its output area rests (the middle of its bottom). */
  places: THREE.Vector3[];
  /** Where the sim has the player stand to work it (on its floor). */
  station: THREE.Vector3;
  /** How high the avatar's middle stands over the soles of its feet. */
  height: number;
  /** The place in the output area the move takes from (`take`), -1 for the printer's bed. */
  slot: number;
  /** How wide (x), tall and deep the part the move lays or takes is. */
  part: THREE.Vector3;
}

/** Where something is held: its origin, its turn and its size. */
export interface Held {
  at: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: number;
}

/** What a move has the body, the hands and what they hold do at a moment. */
export interface Frame {
  /** Where the body stands, on the floor (x, z), and how far up it is (y: on the step). */
  stand: THREE.Vector3;
  /** How far it turns from facing the machine (radians, + to its left). */
  turn: number;
  /** Where each hand goes; null leaves it hanging free. */
  hands: [THREE.Vector3 | null, THREE.Vector3 | null];
  /** Where the head looks. */
  look: THREE.Vector3 | null;
  /** The move's own prop in the hands (see `Move.prop`), where it is; null: not shown. */
  prop: Held | null;
  /** What was taken (`take`, `print`), where it is once the hands have it; null till then. */
  taken: Held | null;
  /** How far out the step under the hopper has slid (0..1). */
  step: number;
  /** Pellets pour from here, out of the bucket's lip; and how full the bucket is (0..1). */
  pour: THREE.Vector3 | null;
  level: number;
  /** How far the bucket's handle is swung up from lying back (0..1), to hold it by. */
  bail: number;
}

/** What a player carries for a move: a bucket (full, or the empty `pail`), a mould, or a part. */
export type Prop = 'bucket' | 'pail' | 'mould' | 'part' | null;

/** An act played out on a machine, `t` seconds after the player got there. */
export interface Move {
  readonly act: MachineAct;
  /** How long it lasts (seconds). */
  readonly length: number;
  /** When the hands set the machine going on what it was asked: it shows it from then on. */
  readonly contact: number;
  /** When the hands take hold of what is taken (-1 for none). */
  readonly grab: number;
  /** When the prop is let go of where it is left lying (the empty bucket; -1 for none). */
  readonly drop: number;
  /** What the hands carry for it, shown as the prop. */
  readonly prop: Prop;
  frame(t: number): Frame;
}

/**
 * The machine's own part of each act, from when the hands set it going (seconds): the silo's
 * button pressed and its valve opened and shut over the bucket on the grate; the moulding
 * machine's hopper lid open while the pellets go in and rise in it; its door slid open, the
 * clamp open and the mould pushed in so far by hand (`pushed` of the way out) before it is
 * drawn home; the mould pushed in through the dispenser's hatch from `from` out of it; a part
 * set down on the printer's bed; the printer's head run over it.
 */
export const HANDLED = {
  fill: { press: 0.25, valve: [0.35, 0.55], pour: [0.5, 1.6], shut: [1.55, 1.75] },
  pour: { lid: [0, 0.3], rise: [0.4, 1.0], close: [1.1, 1.4], length: 1.5 },
  mould: {
    open: [0, 0.35],
    clamp: [0.1, 0.4],
    push: [0.7, 1.1],
    pushed: 0.4,
    seat: [1.1, 1.35],
    shut: [1.35, 1.55],
    close: [1.65, 2.0],
    length: 2.0,
  },
  return: { from: 0.25, push: [0, 0.35], away: [0.45, 0.75], length: 0.9 },
  lay: { from: new THREE.Vector3(0, 0.05, 0.04), down: [0, 0.25] },
  print: { length: MAKE_SECONDS.print },
} as const;

/** How big a hand is (radius): it rests this far off what it holds. */
const HAND_R = 0.083;
/** Where a hanging hand is, from the middle of the body (the avatar's own space). */
const REST_HAND = { x: 0.32, y: -0.1, z: 0.02 };
/** Where something carried in both hands is held, from the middle of the body. */
const CARRY = { y: 0.05, z: -0.42 };
/** How far out from where the hands meet a bucket's rim (at its front corners) they hold it. */
const RIM = new THREE.Vector3(0.14, BUCKET.height + 0.02, 0.14);
/** A bucket's lugs, its handle's ends, where it is held to lift it up high and tip it. */
const LUG = { x: BUCKET.top + 0.075, y: BUCKET.height - 0.04 };
/** Where the hand holds a bucket by its handle, swung up: over its foot. */
const BAIL_GRIP = BUCKET.height - 0.04 + BUCKET.top + 0.008 + 0.03;
/** How far the bucket tips to pour (radians), toward the back. */
const TIP = 1.95;
/** How big a mould is in the hands, to its size in a machine (see `makeHeldTool`). */
const HELD_MOULD = 0.75;
/** How big a mould is in the dispenser's hatch (see `madeModel`). */
const HATCH_MOULD = 0.5;
/** A mould block's size. */
const MOULD = { x: 0.4, y: 0.2, z: 0.4 };

const V = THREE.Vector3;
const Q = THREE.Quaternion;
const X = new V(1, 0, 0);

/** Eased in and out. */
function ease(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

/** How far `t` is from `a` to `b`, eased. */
function along(t: number, [a, b]: readonly [number, number]): number {
  return ease((t - a) / (b - a));
}

/** A value from key to key, eased between them: before the first, the first; after the last, the last. */
function keyed(t: number, keys: readonly (readonly [number, number])[]): number {
  if (t <= keys[0]![0]) return keys[0]![1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i]!;
    const [t0, v0] = keys[i - 1]!;
    if (t <= t1) return v0 + (v1 - v0) * ease((t - t0) / Math.max(1e-6, t1 - t0));
  }
  return keys[keys.length - 1]![1];
}

/** A point from key to key, eased between them. */
function path(t: number, keys: readonly (readonly [number, THREE.Vector3])[]): THREE.Vector3 {
  if (t <= keys[0]![0]) return keys[0]![1].clone();
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i]!;
    const [t0, v0] = keys[i - 1]!;
    if (t <= t1) return new V().lerpVectors(v0, v1, ease((t - t0) / Math.max(1e-6, t1 - t0)));
  }
  return keys[keys.length - 1]![1].clone();
}

const upright = (): THREE.Quaternion => new Q();
const tipped = (k: number): THREE.Quaternion => new Q().setFromAxisAngle(X, -TIP * k);

/** Where a hand hangs, from where the body stands. */
function rest(i: 0 | 1, stand: THREE.Vector3, height: number): THREE.Vector3 {
  const side = i === 0 ? -1 : 1;
  return new V(stand.x + side * REST_HAND.x, stand.y + height + REST_HAND.y, stand.z + REST_HAND.z);
}

/** Where something carried in both hands is held (its middle), from where the body stands. */
function carried(stand: THREE.Vector3, height: number): THREE.Vector3 {
  return new V(stand.x, stand.y + height + CARRY.y, stand.z + CARRY.z);
}

/** The hands on a bucket's rim at its front corners, its foot at `foot`, turned `quat`. */
function rimGrips(foot: THREE.Vector3, quat: THREE.Quaternion): [THREE.Vector3, THREE.Vector3] {
  return [
    new V(-RIM.x, RIM.y, RIM.z).applyQuaternion(quat).add(foot),
    new V(RIM.x, RIM.y, RIM.z).applyQuaternion(quat).add(foot),
  ];
}

/** The hands on a bucket's lugs, its foot at `foot`, turned `quat`. */
function lugGrips(foot: THREE.Vector3, quat: THREE.Quaternion): [THREE.Vector3, THREE.Vector3] {
  return [
    new V(-LUG.x, LUG.y, 0).applyQuaternion(quat).add(foot),
    new V(LUG.x, LUG.y, 0).applyQuaternion(quat).add(foot),
  ];
}

/** The hands either side of something `w` wide, its middle at `mid`. */
function sides(mid: THREE.Vector3, w: number): [THREE.Vector3, THREE.Vector3] {
  const x = w / 2 + HAND_R - 0.01;
  return [mid.clone().add(new V(-x, 0, 0)), mid.clone().add(new V(x, 0, 0))];
}

/** Blends a hand from one target to another by `k`. */
function blend(a: THREE.Vector3, b: THREE.Vector3, k: number): THREE.Vector3 {
  return new V().lerpVectors(a, b, ease(k));
}

/** The bottom of a mould block of `scale` whose middle is at `mid`, turned `quat`. */
function mouldFoot(mid: THREE.Vector3, quat: THREE.Quaternion, scale: number): THREE.Vector3 {
  return new V(0, (-MOULD.y * scale) / 2, 0).applyQuaternion(quat).add(mid);
}

/**
 * The move for `act` on the machine `stage` describes, or null for an act played out the old way
 * (clearing a jam with the wrench, and anything else).
 */
export function moveFor(act: MachineAct, stage: Stage): Move | null {
  switch (act) {
    case 'start':
      return pressStart(stage);
    case 'fill':
      return fillBucket(stage);
    case 'pour':
      return pourPellets(stage);
    case 'mould':
      return putMouldIn(stage);
    case 'return':
      return returnMould(stage);
    case 'take':
      return takeOut(stage);
    case 'lay':
      return layPart(stage);
    case 'print':
      return printPart(stage);
    default:
      return null;
  }
}

/** A frame with nothing held, standing at `stand`. */
function bare(stand: THREE.Vector3): Frame {
  return {
    stand,
    turn: 0,
    hands: [null, null],
    look: null,
    prop: null,
    taken: null,
    step: 0,
    pour: null,
    level: 1,
    bail: 0,
  };
}

/**
 * The right hand going to the button, pressing it in at `at` and coming away again; the hand's
 * place at `t`, from where it hangs (`from`). Blends in from `at - 0.45` and back out by
 * `at + 0.5`.
 */
function press(t: number, at: number, button: THREE.Vector3, from: THREE.Vector3): THREE.Vector3 {
  const near = button.clone().add(new V(0, -0.01, HAND_R + 0.06));
  const touch = button.clone().add(new V(0, -0.01, HAND_R - 0.008));
  const reach = keyed(t, [
    [at - 0.45, 0],
    [at - 0.12, 1],
    [at + 0.17, 1],
    [at + 0.5, 0],
  ]);
  const push = keyed(t, [
    [at - 0.12, 0],
    [at, 1],
    [at + 0.06, 1],
    [at + 0.17, 0],
  ]);
  return blend(from, blend(near, touch, push), reach);
}

/** Where the body stands to press a button with the right hand. */
function beforeButton(s: Stage): THREE.Vector3 {
  const b = s.controls.button;
  return new V(b.x - 0.22, 0, Math.max(b.z, s.size.z / 2 - 0.1) + 0.42);
}

/**
 * Pressing the start button: the moulding machine moulding a part, the dispenser's key (or the
 * printer's, for `print`).
 */
function pressStart(s: Stage, act: 'start' | 'print' = 'start'): Move {
  const { seconds: length, lead } = ACT_TIMES[act];
  const b = s.controls.button;
  const there = beforeButton(s);
  return {
    act,
    length,
    contact: lead,
    grab: -1,
    drop: -1,
    prop: null,
    frame: (t) => {
      const stand = path(t, [
        [0, s.station],
        [0.3, there],
        [length - 0.25, there],
        [length, s.station],
      ]);
      const f = bare(stand);
      f.hands[1] = press(t, lead, b, rest(1, stand, s.height));
      f.look = t < lead + 0.3 ? b : s.controls.screen.at;
      return f;
    },
  };
}

/**
 * Filling a bucket at the silo: a step over to the stack of empty buckets, down for the top one
 * by its rim and up out of the stack with it, over to the grate and down, sliding it in under the
 * spout (the hands set the silo going as they let go), then the start button; and watching it
 * fill.
 */
function fillBucket(s: Stage): Move {
  const { seconds: length, lead } = ACT_TIMES.fill;
  const front = s.size.z / 2;
  const stack = s.controls.stack ?? s.places[0]!;
  const grate = s.places[0]!;
  const button = s.controls.button;
  const atStack = new V(stack.x, 0, front + 0.18);
  const atGrate = new V(grate.x, 0, front + 0.2);
  const back = new V(grate.x + 0.05, 0, front + 0.32);
  const grab = 0.5;
  const out = stack.clone().add(new V(0, 0.12, 0.04));
  const under = grate.clone().add(new V(0, 0.03, 0.22));
  const press0 = lead + HANDLED.fill.press;
  return {
    act: 'fill',
    length,
    contact: lead,
    grab: -1,
    drop: -1,
    prop: 'pail',
    frame: (t) => {
      const stand = path(t, [
        [0, s.station],
        [0.4, atStack],
        [0.65, atStack],
        [1.0, atGrate],
        [lead + 0.1, atGrate],
        [lead + 0.55, back],
      ]);
      const f = bare(stand);
      const quat = upright();
      // The bucket: off the stack, out of it, at the chest, before the grate and in under the tap.
      const chest = carried(stand, s.height).add(new V(0, -BUCKET.height / 2, 0));
      const foot = path(t, [
        [grab, stack],
        [0.65, out],
        [1.0, chest],
        [1.2, under],
        [lead, grate],
      ]);
      const held = t >= grab && t < lead;
      if (held) f.prop = { at: foot, quat, scale: 1 };
      const grips = rimGrips(foot, quat);
      const reachIn = keyed(t, [
        [0.05, 0],
        [grab, 1],
        [lead, 1],
        [lead + 0.25, 0],
      ]);
      for (const i of [0, 1] as const) {
        // Over the rim just before, and off it after.
        const off = grips[i].clone().add(new V(0, 0.05, 0.06));
        const on = keyed(t, [
          [grab - 0.12, 0],
          [grab, 1],
          [lead, 1],
          [lead + 0.12, 0],
        ]);
        f.hands[i] = blend(rest(i, stand, s.height), blend(off, grips[i], on), reachIn);
      }
      f.hands[1] = blend(
        f.hands[1]!,
        press(t, press0, button, rest(1, stand, s.height)),
        keyed(t, [
          [lead, 0],
          [lead + 0.1, 1],
        ]),
      );
      f.look = t < 0.65 ? stack : t < lead + 0.05 ? grate : t < press0 + 0.15 ? button : grate;
      return f;
    },
  };
}

/**
 * Pouring a bucket of pellets into a moulding machine's hopper: the step slides out under it,
 * up onto it, the bucket up high over the hopper's mouth by its lugs (the lid opening as it
 * comes), tipped in and emptied as the pellets rise in the hopper, righted and brought down;
 * down off the step, and the empty bucket set down on the floor.
 */
function pourPellets(s: Stage): Move {
  const { seconds: length, lead } = ACT_TIMES.pour;
  const front = s.size.z / 2;
  const hopper = s.controls.hopper ?? { at: new V(0, 1.5, 0), r: 0.17 };
  const h = hopper.at;
  const below = new V(h.x, 0, front + 0.42);
  const up = new V(h.x, HOPPER_STEP, front + 0.13);
  const down = new V(h.x - 0.05, 0, front + 0.48);
  // Its lugs over the front of the mouth, its lip over the middle once tipped.
  const over = new V(h.x, h.y + 0.2, h.z + 0.12);
  // Set down before the feet, by the handle, clear of the step slid back in.
  const floor = new V(down.x + 0.25, 0, front + 0.16);
  const tip: [number, number] = [0.8, 0.98];
  const pour: [number, number] = [0.95, 1.55];
  const drop = 2.8;
  return {
    act: 'pour',
    length,
    contact: lead,
    grab: -1,
    drop,
    prop: 'bucket',
    frame: (t) => {
      const stand = path(t, [
        [0, s.station],
        [0.25, below],
        [0.6, up],
        [2.1, up],
        [2.4, down],
      ]);
      const f = bare(stand);
      f.step = keyed(t, [
        [0, 0],
        [0.3, 1],
        [2.35, 1],
        [2.65, 0],
      ]);
      const k = along(t, tip) - along(t, [1.55, 1.75]);
      const quat = tipped(k);
      // The lugs' middle: at the chest, up over the hopper, tipped about and back down.
      const chest = carried(stand, s.height).add(new V(0, LUG.y - BUCKET.height / 2, 0));
      const lugs = path(t, [
        [0.4, chest],
        [0.8, over],
        [1.75, over],
        [2.1, chest],
      ]);
      let foot = new V(0, -LUG.y, 0).applyQuaternion(quat).add(lugs);
      // Down off the step, the right hand takes it by its handle, swung up, and sets it down on
      // the floor before the feet, and lets go.
      if (t >= 2.4) {
        foot = path(t, [
          [2.55, foot],
          [drop, floor],
        ]);
      }
      f.bail = keyed(t, [
        [2.4, 0],
        [2.55, 1],
        [drop, 1],
        [drop + 0.2, 0],
      ]);
      f.level = 1 - along(t, pour);
      f.prop = { at: t < drop ? foot : floor, quat, scale: 1 };
      const grips = lugGrips(foot, quat);
      const handle = foot.clone().add(new V(0, BAIL_GRIP, 0));
      const right = blend(
        blend(
          grips[1],
          handle,
          keyed(t, [
            [2.4, 0],
            [2.55, 1],
          ]),
        ),
        rest(1, stand, s.height),
        keyed(t, [
          [drop, 0],
          [length - 0.05, 1],
        ]),
      );
      const left = blend(
        grips[0],
        rest(0, stand, s.height),
        keyed(t, [
          [2.4, 0],
          [2.65, 1],
        ]),
      );
      f.hands = [left, right];
      // The lowest point of its rim, tipped: where the pellets fall from.
      if (t > pour[0] && t < pour[1]) {
        f.pour = new V(0, BUCKET.height, -BUCKET.top).applyQuaternion(quat).add(foot);
      }
      f.look = t < 0.4 ? up : t < 1.8 ? h : floor;
      return f;
    },
  };
}

/**
 * Putting a mould in a moulding machine: the mould in the right hand, the left slides the safety
 * door open by its handle (the clamp opening); both bring the mould to the opening and push it
 * in between the platens (which draw it home); the left slides the door shut again.
 */
function putMouldIn(s: Stage): Move {
  const { seconds: length, lead } = ACT_TIMES.mould;
  const front = s.size.z / 2;
  const m = s.controls.mould ?? {
    home: new V(0, 1, 0),
    out: new V(0, 1.1, front),
    width: 0.4,
    quat: new Q(),
  };
  const door = s.controls.door ?? { handle: new V(0, 1, front), slide: 0 };
  const H = HANDLED.mould;
  const shut = door.handle.clone().add(new V(0, 0, HAND_R));
  const open = shut.clone().add(new V(door.slide, 0, 0));
  const handleAt = (t: number): THREE.Vector3 => {
    const k = along(t - lead, H.open) - along(t - lead, H.close);
    return blend(shut, open, k);
  };
  const byDoor = (t: number) => new V(handleAt(t).x + 0.18, 0, front + 0.42);
  const atMould = new V(m.out.x, 0, m.out.z + 0.42);
  const inMould = new V(m.out.x, 0, m.out.z + 0.32);
  const handOver = lead + H.push[0];
  const full = m.scale ?? 1;
  const letGo = lead + H.seat[0] + 0.1;
  return {
    act: 'mould',
    length,
    contact: lead,
    grab: -1,
    drop: -1,
    prop: 'mould',
    frame: (t) => {
      // At the door, over to the mould with it open and in toward it; back to the door, and
      // along with it as it shuts.
      let stand: THREE.Vector3;
      if (t < lead + H.open[1]) stand = blend(s.station, byDoor(t), t / 0.3);
      else if (t < letGo)
        stand = path(t, [
          [lead + H.open[1], byDoor(t)],
          [handOver, atMould],
          [lead + H.push[1], inMould],
        ]);
      else stand = blend(inMould, byDoor(t), (t - letGo) / 0.4);
      stand = blend(stand, s.station, (t - (length - 0.35)) / 0.35);
      const f = bare(stand);
      // The mould: at the right hip, then out before the opening; once in the machine, where
      // the machine has it.
      const scale = HELD_MOULD + (full - HELD_MOULD) * along(t, [lead + 0.35, handOver]);
      const hip = new V(stand.x + 0.2, stand.y + s.height - 0.12, stand.z - 0.3);
      const mid = path(t, [
        [lead + 0.35, hip],
        [handOver, m.out],
      ]);
      const quat = new Q().slerpQuaternions(new Q(), m.quat, along(t, [lead + 0.35, handOver]));
      if (t < handOver) f.prop = { at: mouldFoot(mid, quat, scale), quat, scale };
      // In the machine: pushed in so far, then drawn home by the clamp.
      const o =
        t < lead + H.push[1]
          ? 1 - (1 - H.pushed) * along(t - lead, H.push)
          : H.pushed * (1 - along(t - lead, H.seat));
      // (The hands push it in so far, and let the clamp draw it on home.)
      const inside = new V().lerpVectors(m.home, m.out, Math.max(o, H.pushed));
      const width = t < handOver ? MOULD.x * scale : m.width;
      const grips = sides(t < handOver ? mid : inside, width);
      // The right hand holds it all along (but for its last push home); the left goes for the
      // door, then to the mould with the right, then back to the door.
      const both = keyed(t, [
        [lead + H.open[1], 0],
        [lead + 0.6, 1],
        [letGo, 1],
        [letGo + 0.2, 0],
      ]);
      const left = blend(handleAt(t), grips[0], both);
      f.hands[0] = blend(
        rest(0, stand, s.height),
        left,
        keyed(t, [
          [0, 0],
          [lead, 1],
          [length - 0.3, 1],
          [length, 0],
        ]),
      );
      f.hands[1] = blend(
        grips[1],
        rest(1, stand, s.height),
        keyed(t, [
          [letGo, 0],
          [letGo + 0.35, 1],
        ]),
      );
      f.look = t < lead + H.open[1] ? door.handle : t < letGo ? m.home : open;
      return f;
    },
  };
}

/**
 * Putting a mould back in the dispenser: brought up before its hatch and pushed in through the
 * flap with the right hand, the machine taking it from there.
 */
function returnMould(s: Stage): Move {
  const { seconds: length, lead } = ACT_TIMES.return;
  const front = s.size.z / 2;
  const rest0 = s.places[0]!;
  const there = new V(rest0.x - 0.08, 0, front + 0.4);
  const from = rest0.clone().add(new V(0, 0.02, HANDLED.return.from));
  return {
    act: 'return',
    length,
    contact: lead,
    grab: -1,
    drop: -1,
    prop: 'mould',
    frame: (t) => {
      const stand = path(t, [
        [0, s.station],
        [0.35, there],
        [length - 0.3, there],
        [length, s.station],
      ]);
      const f = bare(stand);
      const scale = HELD_MOULD + (HATCH_MOULD - HELD_MOULD) * along(t, [0.1, lead]);
      const chest = carried(stand, s.height);
      const mid = path(t, [
        [0, chest],
        [lead, from.clone().add(new V(0, (MOULD.y * HATCH_MOULD) / 2, 0))],
      ]);
      const quat = upright();
      if (t < lead) f.prop = { at: mouldFoot(mid, quat, scale), quat, scale };
      // Then the hatch pushes it in: the right hand behind it, the left let go.
      const pushed = blend(from, rest0, (t - lead) / HANDLED.return.push[1]);
      const back = pushed.clone().add(new V(0, 0.05, (MOULD.z * HATCH_MOULD) / 2 + HAND_R));
      const grips = sides(mid, MOULD.x * scale);
      const right = t < lead ? grips[1] : back;
      const out = keyed(t, [
        [lead + 0.4, 0],
        [lead + 0.75, 1],
      ]);
      f.hands[1] = blend(right, rest(1, stand, s.height), out);
      f.hands[0] = blend(grips[0], rest(0, stand, s.height), (t - lead + 0.05) / 0.3);
      f.look = rest0;
      return f;
    },
  };
}

/** How the hands take hold of what lies in a place of an output area, and where they lift it. */
interface Taking {
  /** The hands on it, from where it lies (`foot`). */
  grips(foot: THREE.Vector3, quat: THREE.Quaternion): [THREE.Vector3 | null, THREE.Vector3];
  /** Where it is drawn out to before it is brought up to the chest. */
  out: THREE.Vector3;
  /** How far before it the body stands, and how much to the side of it. */
  gap: number;
  across: number;
}

/** How the hands take what lies at `foot` in a machine of `s`'s kind. */
function taking(s: Stage, foot: THREE.Vector3): Taking {
  const part = s.part;
  if (s.kind === 'silo') {
    return {
      grips: (at, quat) => rimGrips(at, quat),
      out: foot.clone().add(new V(0, 0.06, 0.2)),
      gap: 0.2,
      across: 0,
    };
  }
  if (s.kind === 'dispenser') {
    // In through the flap with the right hand, its fingers over the mould's front.
    return {
      grips: (at) => [
        null,
        at.clone().add(new V(0, (MOULD.y * HATCH_MOULD) / 2 + 0.03, (MOULD.z * HATCH_MOULD) / 2)),
      ],
      out: foot.clone().add(new V(0, 0.04, 0.32)),
      gap: 0.4,
      across: -0.08,
    };
  }
  if (s.kind === 'press') {
    // Into the bay with the right hand, low down, fingers round the part.
    return {
      grips: (at) => [null, at.clone().add(new V(0, part.y / 2 + 0.035, part.z / 2 + 0.03))],
      out: foot.clone().add(new V(0, 0.08, 0.3)),
      gap: 0.26,
      across: -0.1,
    };
  }
  // Off the printer's bed in both hands, either side of it.
  return {
    grips: (at) => {
      const [l, r] = sides(at.clone().add(new V(0, part.y / 2, 0)), part.x);
      return [l, r];
    },
    out: foot.clone().add(new V(0, 0.12, 0.12)),
    gap: 0.3,
    across: 0,
  };
}

/**
 * Taking something out over `[from, from + 1]`: reaching in for it, taking hold of it at
 * `grab`, drawing it out and bringing it up to the chest, where it is carried. The hands' places,
 * and where it is (null till taken), at `t`.
 */
function takeFrom(
  s: Stage,
  t: number,
  from: number,
  foot: THREE.Vector3,
  stand: THREE.Vector3,
): { hands: Frame['hands']; taken: Held | null; look: THREE.Vector3 } {
  const how = taking(s, foot);
  const grab = from + 0.45;
  const quat = upright();
  const chest = carried(stand, s.height);
  // What it is held by is its foot: at the chest, its middle where carried things are.
  const lifted = chest.clone().add(new V(0, -0.08, 0));
  const at = path(t, [
    [grab, foot],
    [grab + 0.2, how.out],
    [from + 0.95, lifted],
  ]);
  const grips = how.grips(at, quat);
  const reach = keyed(t, [
    [from, 0],
    [grab, 1],
  ]);
  const hands: Frame['hands'] = [null, null];
  for (const i of [0, 1] as const) {
    const g = grips[i];
    // A hand not in on it at first takes hold once it is out, to carry it.
    const late = g
      ? 1
      : keyed(t, [
          [grab + 0.15, 0],
          [grab + 0.35, 1],
        ]);
    const side = sides(at.clone().add(new V(0, 0.05, 0)), 0.22)[i];
    const target = g ?? side;
    const before = target.clone().add(new V(0, 0.04, 0.08));
    const onto = t < grab ? blend(before, target, (t - grab + 0.12) / 0.12) : target;
    hands[i] = blend(rest(i, stand, s.height), onto, g ? reach : late);
  }
  return {
    hands,
    taken: t >= grab ? { at, quat, scale: 1 } : null,
    look: t < grab + 0.2 ? foot : lifted,
  };
}

/** Taking what waits in a place of a machine's output area, or a part off the printer's bed. */
function takeOut(s: Stage): Move {
  const length = ACT_TIMES.take.seconds;
  const foot = s.slot >= 0 ? s.places[s.slot]! : (s.controls.bed ?? s.places[0]!);
  const how = taking(s, foot);
  const there = new V(foot.x - how.across, 0, s.size.z / 2 + how.gap);
  return {
    act: 'take',
    length,
    contact: ACT_TIMES.take.lead,
    grab: 0.45,
    drop: -1,
    prop: null,
    frame: (t) => {
      const stand = path(t, [
        [0, s.station],
        [0.3, there],
        [0.6, there],
        [length, s.station],
      ]);
      const f = bare(stand);
      const took = takeFrom(s, t, 0, foot, stand);
      f.hands = took.hands;
      f.taken = took.taken;
      f.look = took.look;
      return f;
    },
  };
}

/** Laying a part on the printer's bed: brought down over it in both hands and set down on it. */
function layPart(s: Stage): Move {
  const { seconds: length, lead } = ACT_TIMES.lay;
  const bed = s.controls.bed ?? new V(0, 0.8, 0);
  const there = new V(bed.x, 0, s.size.z / 2 + 0.3);
  const over = bed.clone().add(HANDLED.lay.from);
  return {
    act: 'lay',
    length,
    contact: lead,
    grab: -1,
    drop: -1,
    prop: 'part',
    frame: (t) => {
      const stand = path(t, [
        [0, s.station],
        [0.35, there],
        [length - 0.3, there],
        [length, s.station],
      ]);
      const f = bare(stand);
      const foot = path(t, [
        [0, carried(stand, s.height).add(new V(0, -s.part.y / 2, 0))],
        [lead, over],
        [lead + HANDLED.lay.down[1], bed],
      ]);
      if (t < lead) f.prop = { at: foot, quat: upright(), scale: 1 };
      const grips = sides(foot.clone().add(new V(0, s.part.y / 2, 0)), s.part.x);
      const off = keyed(t, [
        [lead + HANDLED.lay.down[1], 0],
        [lead + 0.6, 1],
      ]);
      f.hands = [
        blend(grips[0], rest(0, stand, s.height), off),
        blend(grips[1], rest(1, stand, s.height), off),
      ];
      f.look = bed;
      return f;
    },
  };
}

/**
 * Printing: the start button pressed, then the part on the bed watched (they wait by it till the
 * print is done, then take it off: see `takeOut`).
 */
function printPart(s: Stage): Move {
  const move = pressStart(s, 'print');
  const bed = s.controls.bed ?? new V(0, 0.8, 0);
  return {
    ...move,
    frame: (t) => {
      const f = move.frame(t);
      if (t >= ACT_TIMES.print.lead + 0.3) f.look = bed;
      return f;
    },
  };
}
