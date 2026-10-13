import type { BrickTypeId, ColourId } from '../bricks.ts';
import { machineFront, machinePose } from '../content/house.ts';
import type { MachineKind } from '../content/house.ts';
import { add, rotate, v3, yawQuat } from '../math.ts';
import type { Vec3 } from '../math.ts';
import { BUCKET_SHOTS } from './sim.ts';
import type { MachineState, Sim } from './sim.ts';

/**
 * For tests: the first machine of a kind (on the given side, for rival teams), and where to
 * stand in front of it and look to use it.
 */
export function machine(
  sim: Sim,
  kind: MachineKind,
  side?: number,
): { m: MachineState; stand: Vec3; target: Vec3 } {
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
): { m: MachineState; stand: Vec3; target: Vec3 } {
  const press = machine(sim, 'press', side);
  Object.assign(press.m, { mould: type, colour, shots: BUCKET_SHOTS });
  return press;
}

/** For tests: steps the sim until the machine the player used has handed them what it made. */
export function awaitHandout(sim: Sim, playerId: number): void {
  while (sim.handingOut(playerId)) sim.step();
}
