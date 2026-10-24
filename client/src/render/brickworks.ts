import type { MachineDef } from '@sar/shared';
import { DispenserView } from './dispenserView.ts';
import type { MachineView } from './machineView.ts';
import { PressView } from './pressView.ts';
import { PrinterView } from './printerView.ts';
import { SiloView } from './siloView.ts';

/**
 * The brick works in the game's own models. The moulds and pellet buckets players carry are in
 * `carried.ts`, what every machine is built of in `machineParts.ts`, what every look of the
 * machines has alike in `machineLook.ts`, and each of the four machines (an injection moulding
 * machine, the pellet silo, the mould dispenser and the UV printer) in a class of its own,
 * built to fill its own box, whatever size that is.
 *
 * Unlike the props in `props.ts`, everything here is built with local +z its front, the way
 * the machines face. Pellets and parts are drawn in `brickMaterial`, which goes grey
 * with the rest of the bricks without the colour goggles.
 */

/** A machine of the brick works, in the model of its kind. */
export function machineView(def: MachineDef): MachineView {
  switch (def.kind) {
    case 'press':
      return new PressView(def);
    case 'silo':
      return new SiloView(def);
    case 'dispenser':
      return new DispenserView(def);
    case 'printer':
      return new PrinterView(def);
  }
}
