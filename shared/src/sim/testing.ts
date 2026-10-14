import type { BrickTypeId, ColourId } from '../bricks.ts';
import { machineFront, machineOutputs, machinePose } from '../content/house.ts';
import type { MachineKind } from '../content/house.ts';
import { add, rotate, v3, yawQuat } from '../math.ts';
import type { Vec3 } from '../math.ts';
import { BUCKET_SHOTS } from './sim.ts';
import type { MachineState, Player, Sim } from './sim.ts';

/**
 * For tests: the first machine of a kind (on the given side, for rival teams), where to stand
 * in front of it and look to use it, and where to look to take what lies in each place in its
 * output area.
 */
export function machine(
  sim: Sim,
  kind: MachineKind,
  side?: number,
): { m: MachineState; stand: Vec3; target: Vec3; outs: Vec3[] } {
  const m = [...sim.machines.values()].find(
    (x) => x.def.kind === kind && (side === undefined || sim.sideOf(x.def.pos) === side),
  )!;
  const turn = yawQuat(m.def.facing);
  const front = machineFront(m.def);
  const height = Math.min(1, machinePose(m.def).half.y * 1.6);
  return {
    m,
    stand: add(front, rotate(turn, v3(0, 0, 1.1))),
    target: add(front, rotate(turn, v3(0, height, -0.05))),
    outs: machineOutputs(m.def).map((o) => o.aim),
  };
}

/**
 * For tests: a moulding machine with a mould and a bucket of pellets in it already, ready to
 * make parts of this type and colour.
 */
export function loadedPress(
  sim: Sim,
  type: BrickTypeId = '2x4',
  colour: ColourId = 'red',
  side?: number,
): ReturnType<typeof machine> {
  const press = machine(sim, 'press', side);
  Object.assign(press.m, { mould: type, colour, shots: BUCKET_SHOTS });
  return press;
}

/** For tests: steps the sim until the machine has finished what it is making, if anything. */
export function awaitMachine(sim: Sim, m: MachineState): void {
  while (m.making) sim.step();
}

/** For tests: points the player's first-person view at `target` from where they stand. */
export function aimAt(sim: Sim, p: Player, target: Vec3): void {
  const eye = sim.eye(p);
  p.input.firstPerson = true;
  p.input.yaw = Math.atan2(-(target.x - eye.x), -(target.z - eye.z));
  p.input.pitch = Math.atan2(target.y - eye.y, Math.hypot(target.x - eye.x, target.z - eye.z));
}

/**
 * For tests: once a machine has finished what it is making, has a player in reach of it take
 * what lies in a place in its output area (the one it was making something for, else the first
 * one with something in it, unless `slot` says), as a player does it: aiming at it and
 * clicking. Their view goes back to where it was. Returns whether there was anything there.
 */
export function takeOut(
  sim: Sim,
  p: Player,
  at: ReturnType<typeof machine>,
  slot = at.m.making?.slot ?? at.m.out.findIndex((x) => x !== null),
): boolean {
  awaitMachine(sim, at.m);
  if (slot < 0 || !at.m.out[slot]) return false;
  const { yaw, pitch, firstPerson } = p.input;
  aimAt(sim, p, at.outs[slot]!);
  sim.act(p.id, { kind: 'grab' });
  Object.assign(p.input, { yaw, pitch, firstPerson });
  return true;
}
