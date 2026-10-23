import * as THREE from 'three';
import type { MachineDef, MachineState } from '@sar/shared';
import { mat } from './interiors.ts';
import { bevelFor } from './shapes.ts';
import { HANDLED } from './operate.ts';
import type { Job, MachineEvent } from './machineLook.ts';
import {
  bedPart,
  block,
  chalkSign,
  darkMetal,
  ease,
  panelGrey,
  rodZ,
  screen,
  span,
  upright,
} from './machineParts.ts';
import { MachineView } from './machineView.ts';
import type { MachineControls } from './operate.ts';

/** How long a print takes, as the printer shows it (as long as the sim takes to print). */
const PRINT_SECONDS = HANDLED.print.length;

/** The printer's: its print head, which runs along the gantry, and its UV lamp. */
interface PrinterParts {
  head: THREE.Object3D;
  uv: THREE.MeshStandardMaterial;
}

/** The UV printer. */
export class PrinterView extends MachineView {
  /** What moves when it works (see `play`). */
  private readonly parts: PrinterParts;
  /** A part being laid on the printer's bed, drawn by its job till it lies there. */
  private laying = false;

  constructor(def: MachineDef) {
    super(def);
    const { x: w, y: h, z: d } = def.size;
    this.parts = this.printer(w, h, d);
    this.built();
  }

  controls(): MachineControls {
    const { x: w, z: d } = this.def.size;
    const [hw, hd] = [w / 2, d / 2];
    const V = THREE.Vector3;
    const bed = this.printerBed();
    return {
      button: new V(hw - 0.4, 0.62, hd - 0.018),
      screen: { at: new V(hw - 0.17, 0.89, hd - 0.024), w: 0.16, h: 0.1 },
      bed: new V(bed.x, bed.top, bed.z),
    };
  }

  protected jobFor(e: MachineEvent, _slot: number, handled: boolean): Omit<Job, 'start'> | null {
    return e.kind === 'printerIn'
      ? this.layJob(handled)
      : e.kind === 'print'
        ? this.printJob(this.parts, handled)
        : null;
  }

  protected override bedRoom() {
    return this.printerBed();
  }

  /** Where the part goes on the printer's bed: the bed's top, the part's middle and its room. */
  private printerBed() {
    const hw = this.def.size.x / 2;
    return { top: 0.8, x: -0.1, z: 0.05, w: 2 * (hw - 0.47), d: 0.5, room: 0.12 };
  }

  private printer(w: number, h: number, d: number): PrinterParts {
    const g = this.group;
    const hw = w / 2;
    const hd = d / 2;
    const white = mat(0xe8e8e4, 0.5);
    const bed = this.printerBed();
    // The stand: legs, feet and a shelf.
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        block(g, 0.05, 0.43, 0.05, sx * (hw - 0.12), 0.235, sz * (hd - 0.06), darkMetal);
        block(g, 0.09, 0.02, 0.09, sx * (hw - 0.12), 0.01, sz * (hd - 0.06), panelGrey);
      }
    block(g, w - 0.3, 0.02, d - 0.14, 0, 0.14, 0, darkMetal);
    // The cabinet, a stripe and the bed on top, ruled with a grid. The cabinet's edges are
    // rounded only a little, for the stripe along the top of its front (over the sign), which
    // stops where they turn away.
    const round = 0.015;
    block(g, w - 0.1, 0.33, d - 0.04, 0, 0.615, 0, white, round);
    block(g, w - 0.1 - 2 * round, 0.03, 0.006, 0, 0.75, hd - 0.017, panelGrey);
    block(g, w - 0.7, 0.02, d - 0.1, 0, bed.top - 0.01, 0, mat(0x26292c, 0.8));
    // The towers at the ends, the gantry over the back of the bed and the print head parked
    // on it, its UV lamp glowing underneath.
    for (const s of [-1, 1]) block(g, 0.24, 0.2, d - 0.06, s * (hw - 0.17), 0.88, 0, white);
    const gz = -0.12;
    block(g, w - 0.5, 0.07, 0.08, 0, 0.975, gz, panelGrey);
    block(g, 0.02, 0.08, 0.09, -(hw - 0.32), 0.975, gz, darkMetal);
    // The head runs along the gantry as it prints (see `printJob`), its lamp a material of its own.
    const head = new THREE.Group();
    head.name = 'printHead';
    head.position.set(hw - 0.43, 0, gz + 0.095);
    g.add(head);
    const uv = new THREE.MeshStandardMaterial({
      color: 0x9a6cff,
      roughness: 0.3,
      emissive: 0x7c4dff,
    });
    block(head, 0.2, 0.12, 0.13, 0, 0.97, 0, white);
    block(head, 0.2 - 2 * bevelFor(0.12), 0.02, 0.006, 0, 0.99, 0.068, mat(0x7a52d1, 0.5));
    block(head, 0.16, 0.012, 0.09, 0, 0.904, 0, uv);
    // Ink bottles on the left tower and a little screen on the right one.
    for (const [i, c] of [0x00a3e0, 0xe0218a, 0xf6d300, 0x222222, 0xffffff].entries())
      upright(g, 0.018, 0.018, 0.98, 1.04, -(hw - 0.08) + i * 0.045, -0.05, mat(c, 0.4), 10);
    block(g, 0.16, 0.1, 0.006, hw - 0.17, 0.89, hd - 0.027, screen);
    for (const [i, c] of [0x3bb54a, 0xd32f2f].entries()) {
      const b = rodZ(g, 0.015, hd - 0.03, hd - 0.018, hw - 0.4 + i * 0.06, 0.62, mat(c, 0.4));
      b.castShadow = false;
      if (i === 0) this.button = b;
    }
    chalkSign(g, 0.8, 0.2, -0.15, 0.615, hd - 0.024, 'UV printer');
    return { head, uv };
  }

  protected contents(m: MachineState, svgs: Record<string, string>): void {
    const part = this.onBed(m);
    if (part && !this.laying) this.dynamic.add(bedPart(part, svgs, this.printerBed()));
  }

  /**
   * A part laid on the bed: set down on it from over it, by hand (`handled`, from where the
   * hands bring it, see `HANDLED.lay`) or by itself.
   */
  private layJob(handled: boolean): Omit<Job, 'start'> {
    const group = this.jobGroup();
    const part = this.last?.m.part;
    const bed = this.printerBed();
    const lying = part ? bedPart(part, this.last!.svgs, bed) : null;
    if (lying) group.add(lying);
    const rest = lying?.position.clone() ?? new THREE.Vector3();
    const from = handled ? HANDLED.lay.from : new THREE.Vector3(0, 0.12, 0.05);
    this.laying = true;
    if (this.last) this.rebuild();
    return {
      length: HANDLED.lay.down[1],
      group,
      step: (t) => {
        lying?.position.copy(rest).addScaledVector(from, 1 - ease(span(t, ...HANDLED.lay.down)));
      },
      end: () => {
        lying?.geometry.dispose();
        this.laying = false;
        if (this.last) this.rebuild();
      },
    };
  }

  /**
   * A print: its button pressed (by hand, `handled`), the head runs along the gantry over the
   * part on the bed and back, laying the print on it on its first pass and its lamp curing the
   * ink as it goes.
   */
  private printJob({ head, uv }: PrinterParts, handled: boolean): Omit<Job, 'start'> {
    const park = head.position.x;
    const { x, w } = this.printerBed();
    const [a, b] = [x + w / 2 - 0.1, x - w / 2 + 0.1];
    this.inked(false);
    return {
      length: PRINT_SECONDS,
      lane: 'print',
      group: this.jobGroup(),
      step: (t) => {
        if (handled) this.pushButton(t);
        // Over to the bed, across it and back twice, and home.
        const pass = span(t, 0.25, PRINT_SECONDS - 0.25) * 4;
        if (pass >= 1) this.inked(true);
        const k = Math.abs(((pass + 1) % 2) - 1);
        head.position.x =
          t < 0.25
            ? park + (a - park) * ease(span(t, 0, 0.25))
            : t > PRINT_SECONDS - 0.25
              ? a + (park - a) * ease(span(t, PRINT_SECONDS - 0.25, PRINT_SECONDS))
              : a + (b - a) * ease(k);
        uv.emissiveIntensity = t > 0.2 && t < PRINT_SECONDS - 0.2 ? 3 + Math.sin(t * 50) * 0.4 : 1;
      },
      end: () => {
        head.position.x = park;
        uv.emissiveIntensity = 1;
        this.pushButton(1);
        this.inked(true);
      },
    };
  }
}
