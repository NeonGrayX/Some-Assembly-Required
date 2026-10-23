import * as THREE from 'three';
import { COLOURS, MAKE_SECONDS } from '@sar/shared';
import type { ColourId, MachineDef } from '@sar/shared';
import { brickMaterial } from './bricks.ts';
import { mat, metal } from './interiors.ts';
import { KEEP_SEPARATE } from './merge.ts';
import { HANDLED } from './operate.ts';
import { bucket, pelletFill, pelletStream } from './carried.ts';
import type { Job, MachineEvent } from './machineLook.ts';
import {
  block,
  chalkSign,
  darkMetal,
  ease,
  panelGrey,
  rodZ,
  screen,
  span,
  steel,
  upright,
} from './machineParts.ts';
import type { Span } from './machineParts.ts';
import { MachineView } from './machineView.ts';
import type { MachineControls } from './operate.ts';

/**
 * The silo's control panel, on a post by its tap: its middle, how far back from the silo's
 * front its face is, and its screen and start button on that face.
 */
const SILO_PANEL = {
  x: 0.21,
  y: 0.98,
  z: 0.1,
  w: 0.17,
  h: 0.26,
  screen: { x: 0.21, y: 1.04 },
  button: { x: 0.21, y: 0.91, z: 0.03 },
};

/** The silo's: the valve's handle, the spout's tip and the stack of buckets. */
interface SiloParts {
  wheel: THREE.Object3D;
  spout: THREE.Vector3;
  stack: THREE.Vector3;
}

/** The pellet silo. */
export class SiloView extends MachineView {
  /** What moves when it works (see `play`). */
  private readonly parts: SiloParts;
  constructor(def: MachineDef) {
    super(def);
    const { x: w, y: h, z: d } = def.size;
    this.parts = this.silo(w, h, d);
    this.built();
  }

  controls(): MachineControls {
    const hd = this.def.size.z / 2;
    const V = THREE.Vector3;
    const { button, screen } = SILO_PANEL;
    return {
      button: new V(button.x, button.y, hd - SILO_PANEL.z + button.z),
      screen: { at: new V(screen.x, screen.y, hd - SILO_PANEL.z + 0.012), w: 0.13, h: 0.08 },
      stack: new V(this.def.size.x / 2 - 0.27, 0.122, hd - 0.16),
    };
  }

  protected jobFor(e: MachineEvent, slot: number, handled: boolean): Omit<Job, 'start'> | null {
    return e.kind === 'fill' && e.colour ? this.fillJob(this.parts, e.colour, slot, handled) : null;
  }

  /** Nothing in it changes with its state but what waits in its output area. */
  protected contents(): void {}

  /**
   * One round silo on braced legs toward the back of its box, every colour banded down its
   * sight strip; under it a pipe out to the tap at the front, where a bucket stands on a grate
   * to be filled, with the colour chart on one side and spare buckets on the other.
   */
  private silo(w: number, h: number, d: number): SiloParts {
    const hw = w / 2;
    const hd = d / 2;
    const r = Math.min(hw - 0.2, hd - 0.2, 0.6);
    // The silo itself is built about its own axis, set back from the front.
    const cz = -hd + r + 0.13;
    const g = new THREE.Group();
    g.position.z = cz;
    this.group.add(g);
    const shell = metal(0xc9ced3);
    const frame = mat(0xe0a526, 0.5);
    const ids = Object.keys(COLOURS) as ColourId[];
    const [cone0, body0, body1] = [1.05, 1.45, h - 0.25];
    // Legs braced together, holding a ring under the silo: in from its edge, so their tops
    // are under the ring.
    const l = (r - 0.05) / Math.SQRT2;
    // Each leg on a foot plate bolted down to the floor.
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        block(g, 0.07, body0 - 0.02, 0.07, sx * l, 0.02 + (body0 - 0.02) / 2, sz * l, frame);
        block(g, 0.17, 0.02, 0.17, sx * l, 0.01, sz * l, darkMetal);
        for (const k of [-1, 1])
          upright(g, 0.012, 0.012, 0.02, 0.032, sx * l + k * 0.06, sz * l + k * 0.06, steel, 6);
      }
    for (const s of [-1, 1]) {
      block(g, 2 * l - 0.07, 0.05, 0.04, 0, 0.45, s * l, frame);
      block(g, 0.04, 0.05, 2 * l - 0.07, s * l, 0.45, 0, frame);
    }
    upright(g, r + 0.015, r + 0.015, body0 - 0.03, body0, 0, 0, frame, 32);
    // The cone, the tall body with its stiffening rings, the roof and a vent.
    upright(g, 0.06, r, cone0, body0 - 0.03, 0, 0, shell, 32);
    upright(g, r, r, body0, body1, 0, 0, shell, 32);
    for (const y of [body0 + 0.45, body0 + 0.9, body1 - 0.1])
      upright(g, r + 0.01, r + 0.01, y, y + 0.03, 0, 0, metal(0xa9b0b7), 32);
    upright(g, r, 0.08, body1, body1 + 0.15, 0, 0, shell, 32);
    upright(g, 0.06, 0.06, body1 + 0.15, h - 0.03, 0, 0, darkMetal, 12);
    upright(g, 0.08, 0.08, h - 0.03, h, 0, 0, darkMetal, 12);
    // A sight strip down its front, banded with the colours it holds.
    const [s0, s1] = [body0 + 0.08, body0 + 0.86];
    block(g, 0.11, s1 - s0 + 0.03, 0.012, 0, (s0 + s1) / 2, r + 0.004, darkMetal);
    const band = (s1 - s0) / ids.length;
    for (const [j, c] of ids.entries()) {
      const m = block(
        g,
        0.08,
        band - 0.004,
        0.008,
        0,
        s0 + band * (j + 0.5),
        r + 0.014,
        brickMaterial(c),
      );
      m.userData[KEEP_SEPARATE] = true;
    }
    chalkSign(g, 0.6, 0.2, 0, body1 - 0.32, r + 0.003, 'Pellet silo');
    // A ladder up its side on feet of its own, held off the body by brackets up its height
    // and tied in to the legs' frame low down, and hooked over the top ring.
    const lx = Math.min(r + 0.07, hw - 0.03);
    for (const z of [-0.16, 0.16]) {
      block(g, 0.04, body1 - 0.07, 0.04, lx, 0.02 + (body1 - 0.07) / 2, z, frame);
      block(g, 0.08, 0.02, 0.08, lx, 0.01, z, darkMetal);
      // Brackets from the rail back to the shell (the rail stands 5 cm off it).
      const gap = lx - 0.02 - Math.sqrt(r * r - z * z);
      for (const y of [body0 + 0.25, body0 + 0.9, body1 - 0.2])
        block(g, gap + 0.01, 0.03, 0.03, lx - 0.02 - gap / 2, y, z, frame);
      // The tie to the legs' brace bar, out at `l`.
      block(g, lx - 0.02 - l, 0.03, 0.03, (lx - 0.02 + l) / 2, 0.45, z, frame);
    }
    for (let y = 0.3; y < body1 - 0.1; y += 0.3) rodZ(g, 0.012, -0.14, 0.14, lx, y, darkMetal);
    // Its outlet, an elbow and the pipe out to the tap at the front: a valve wheel on top and
    // the spout down to the bucket.
    const zs = hd - 0.1;
    upright(g, 0.03, 0.03, 1.0, cone0 + 0.01, 0, 0, steel, 10);
    upright(g, 0.05, 0.05, 0.92, 1.0, 0, 0, steel, 12);
    rodZ(this.group, 0.04, cz + 0.04, zs, 0, 0.96, steel);
    upright(this.group, 0.05, 0.05, 0.92, 1.0, 0, zs, steel, 12);
    upright(this.group, 0.03, 0.022, 0.81, 0.92, 0, zs, steel, 12);
    upright(this.group, 0.06, 0.06, 1.0, 1.015, 0, zs, mat(0xd32f2f, 0.4), 12);
    // A bar across the valve wheel to turn it by: it turns while a bucket fills.
    const wheel = new THREE.Group();
    wheel.position.set(0, 1.022, zs);
    block(wheel, 0.13, 0.014, 0.018, 0, 0, 0, mat(0xd32f2f, 0.4));
    this.group.add(wheel);
    const spout = new THREE.Vector3(0, 0.81, zs);
    // A grate to stand a bucket on under it, on a post: the silo's output area (see
    // `outputSlots`).
    block(this.group, 0.32, 0.025, 0.28, 0, 0.5, hd - 0.16, darkMetal);
    block(this.group, 0.05, 0.4875, 0.05, 0, 0.24375, hd - 0.27, darkMetal);
    // The colour chart on one side, every colour there is, on a post.
    const cx = -(hw - 0.27);
    block(this.group, 0.05, 0.75, 0.05, cx, 0.375, hd - 0.08, darkMetal);
    block(this.group, 0.46, 0.46, 0.02, cx, 0.98, hd - 0.045, mat(0xf2f2ee, 0.7));
    const cols = Math.ceil(Math.sqrt(ids.length));
    const rows = Math.ceil(ids.length / cols);
    const cell = 0.4 / Math.max(cols, rows);
    for (const [i, c] of ids.entries()) {
      const m = block(
        this.group,
        cell * 0.8,
        cell * 0.8,
        0.004,
        cx - (cols * cell) / 2 + cell * ((i % cols) + 0.5),
        0.98 + (rows * cell) / 2 - cell * (Math.floor(i / cols) + 0.5),
        hd - 0.033,
        brickMaterial(c),
      );
      m.castShadow = false;
      m.userData[KEEP_SEPARATE] = true;
    }
    // Its control panel on a post by the tap: a screen over the start button.
    const panel = SILO_PANEL;
    const pz = hd - panel.z;
    block(
      this.group,
      0.04,
      panel.y - panel.h / 2,
      0.04,
      panel.x,
      (panel.y - panel.h / 2) / 2,
      pz - 0.04,
      darkMetal,
    );
    block(this.group, panel.w, panel.h, 0.07, panel.x, panel.y, pz - 0.035, panelGrey);
    block(this.group, 0.15, 0.1, 0.006, panel.screen.x, panel.screen.y, pz + 0.003, screen);
    rodZ(this.group, 0.03, pz, pz + 0.008, panel.button.x, panel.button.y, darkMetal);
    this.button = rodZ(
      this.group,
      0.022,
      pz,
      pz + panel.button.z,
      panel.button.x,
      panel.button.y,
      mat(0x3bb54a, 0.4),
    );
    this.button.castShadow = false;
    // A stack of empty buckets on the other.
    for (let i = 0; i < 3; i++) {
      const b = bucket(null);
      b.position.set(hw - 0.27, 0.002 + i * 0.04, hd - 0.16);
      this.group.add(b);
    }
    return { wheel, spout, stack: new THREE.Vector3(hw - 0.27, 0.122, hd - 0.16) };
  }

  /**
   * Fills a bucket: an empty one comes off the stack onto the grate, the valve turns and the
   * pellets pour in until it is full, and the valve turns off, leaving it full on the grate for
   * someone to take. Done by hand (`handled`), the bucket is already on the grate and the
   * button is pressed to start it (see `HANDLED.fill`).
   */
  private fillJob(
    { wheel, spout, stack }: SiloParts,
    colour: ColourId,
    slot: number,
    handled: boolean,
  ): Omit<Job, 'start'> {
    const group = this.jobGroup();
    const pail = bucket(null);
    group.add(pail);
    const grate = this.restAt(slot);
    const fill = pelletFill(pail, colour);
    const stream = pelletStream(group, colour, spout, grate.y + 0.05);
    const H: Record<'valve' | 'pour' | 'shut', Span> & { press: number } = handled
      ? HANDLED.fill
      : { press: -1, valve: [0.3, 0.5], pour: [0.45, 1.6], shut: [1.5, 1.7] };
    return {
      length: MAKE_SECONDS.bucket,
      slot,
      group,
      step: (t) => {
        if (handled) {
          pail.position.copy(grate);
          this.pushButton(t - H.press);
        } else {
          const move = ease(span(t, 0, 0.35));
          pail.position.lerpVectors(stack, grate, move);
          pail.position.y += move < 1 ? Math.sin(move * Math.PI) * 0.25 : 0;
        }
        fill(span(t, ...H.pour));
        stream(t >= H.pour[0] - 0.05 && t < H.pour[1] ? t : null);
        wheel.rotation.y = ease(span(t, ...H.valve)) * 1.6 - ease(span(t, ...H.shut)) * 1.6;
      },
      end: () => {
        wheel.rotation.y = 0;
        this.pushButton(1);
      },
    };
  }
}
