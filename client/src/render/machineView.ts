import * as THREE from 'three';
import type { MachineDef } from '@sar/shared';
import { MachineLook } from './machineLook.ts';
import { span } from './machineParts.ts';

/**
 * A machine of the brick works in the game's own models: what is in it shown, the moulding
 * machine's mould and pellets, the part on the printer's bed, and what waits in its output area
 * for someone to take it. Each kind of machine is a class of its own (see `machineView`).
 */
export abstract class MachineView extends MachineLook {
  /** The start button (or key), pushed in as it is pressed, and where it stands out at rest. */
  protected button: THREE.Object3D | null = null;
  private buttonRest = 0;

  constructor(def: MachineDef) {
    super(def);
    this.group.position.set(def.pos.x, def.pos.y, def.pos.z);
    this.group.rotation.y = def.facing;
  }

  /** Called once the model is built: the start button's rest, and the layers that change. */
  protected built(): void {
    this.buttonRest = this.button?.position.z ?? 0;
    this.addLayers();
  }

  /** Has the start button pushed in by a finger, all the way in `t` = 0 (and out again). */
  protected pushButton(t: number): void {
    if (!this.button) return;
    const k = span(t, -0.1, 0) - span(t, 0.06, 0.17);
    this.button.position.z = this.buttonRest - 0.008 * k;
  }
}
