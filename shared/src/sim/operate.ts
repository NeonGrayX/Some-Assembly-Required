import type { MachineKind } from '../content/house.ts';

/**
 * What a player does at a machine of the brick works with their hands once they have walked up
 * to it (see `Work`), each a move of its own that the clients play out on the machine's real
 * parts: pressing its start button (`start`: the moulding machine moulding a part, the mould
 * dispenser's key), lifting an empty bucket off the silo's stack onto the grate under its tap
 * and starting it (`fill`), lifting a bucket of pellets up over a moulding machine's hopper and
 * pouring it in (`pour`), sliding its safety door open and pushing a mould in between its
 * platens (`mould`), pushing a mould back in through the dispenser's hatch (`return`), taking
 * what waits in a place in an output area or on the printer's bed (`take`), laying a part on
 * the printer's bed (`lay`), starting a print and taking the printed part off the bed
 * (`print`), clearing a jam with the wrench (`fix`), or anything else (`work`).
 */
export const MACHINE_ACTS = [
  'work',
  'start',
  'fill',
  'pour',
  'mould',
  'return',
  'take',
  'lay',
  'print',
  'fix',
] as const;
export type MachineAct = (typeof MACHINE_ACTS)[number];

/**
 * How long (seconds) each act takes once they are there, and how far into it (`lead`) their
 * hands set the machine going on what it was asked: the bucket is on the grate, the button is
 * pressed. What the machine makes is done that much later than it takes to make it (see
 * `MAKE_SECONDS`), as it only starts then. Clearing a jam takes till it is clear.
 */
export const ACT_TIMES: Record<MachineAct, { seconds: number; lead: number }> = {
  work: { seconds: 1.1, lead: 0 },
  start: { seconds: 1.2, lead: 0.45 },
  fill: { seconds: 3.3, lead: 1.35 },
  pour: { seconds: 3.0, lead: 0.55 },
  mould: { seconds: 2.7, lead: 0.35 },
  return: { seconds: 1.3, lead: 0.45 },
  take: { seconds: 1.0, lead: 0.3 },
  lay: { seconds: 1.3, lead: 0.5 },
  print: { seconds: 2.9, lead: 0.45 },
  fix: { seconds: 1.1, lead: 0 },
};

/**
 * How far out from a machine's front (m) a player stands to work it at their station: clear of
 * it with what they carry. Their hands may bring them closer for a moment (see the clients).
 */
export const ACT_STAND = 0.55;

/**
 * Where along the front of a machine of this kind (x in its own frame, its front +z) a player
 * stands to do `act` (at the place `slot` of its output area, for `take`): before its start
 * button, its hopper, its mould, its hatch, the grate, the bay or the printer's bed. Null
 * where they stand before where they clicked it (clearing a jam, and anything else).
 */
export function actStation(kind: MachineKind, act: MachineAct, slot: number): number | null {
  if (act === 'fix' || act === 'work') return null;
  if (kind === 'press') {
    // The control panel at its right end, the hopper over the barrel, the mould and the bay
    // under it at its left.
    if (act === 'start') return 0.95;
    if (act === 'pour') return 0.55;
    if (act === 'take') return -0.5 + 0.16 * (Math.max(0, slot) - 1) * 0.5;
    return -0.5;
  }
  // The dispenser's column, with its keypad over its hatch, at its right.
  if (kind === 'dispenser') return 0.48;
  // The printer's bed, and its start button at its right.
  if (kind === 'printer') return act === 'print' ? 0.2 : 0;
  // The silo's grate under its tap.
  return 0;
}
