import * as THREE from 'three';
import { MAKE_SECONDS, MOULD_TYPES } from '@sar/shared';
import type { BrickTypeId, MachineDef, MachineState } from '@sar/shared';
import { mat } from './interiors.ts';
import { HANDLED } from './operate.ts';
import { MOULD_SIZE, madeModel, mouldBlock } from './carried.ts';
import type { Job, MachineEvent } from './machineLook.ts';
import {
  block,
  chalkSign,
  clear,
  darkMetal,
  ease,
  lamp,
  machineGrey,
  panelGrey,
  rodZ,
  smoked,
  span,
  steel,
  teal,
} from './machineParts.ts';
import { MachineView } from './machineView.ts';
import type { MachineControls } from './operate.ts';

/** How far back from upright the dispenser's moulds lean on its shelves, to show their cavities. */
const SHELF_LEAN = 1.0;

/** The parts the mould dispenser shows on its shelves: a spread of all there are. */
const SHOWN_MOULDS = Array.from(
  { length: 9 },
  (_, i) => MOULD_TYPES[Math.floor((i * MOULD_TYPES.length) / 9)]!,
);

/** How far the dispenser's hatch flap hangs open at rest. */
const FLAP_REST = -0.12;
/** How brightly the dispenser's screen glows while a mould waits in its hatch (1 otherwise). */
const WAITING_GLOW = 2;
/** The colour of the lamp over the dispenser's hatch. */
const HATCH_LAMP = 0xf2a530;

/** The dispenser's: the hatch's flap, the screen and the lamp over the hatch. */
interface DispenserParts {
  flap: THREE.Object3D;
  screen: THREE.MeshStandardMaterial;
  hatchLamp: THREE.Mesh;
}

/** The mould dispenser. */
export class DispenserView extends MachineView {
  /** What moves when it works (see `play`). */
  private readonly parts: DispenserParts;
  constructor(def: MachineDef) {
    super(def);
    const { x: w, y: h, z: d } = def.size;
    this.parts = this.dispenser(w, h, d);
    this.built();
  }

  controls(): MachineControls {
    const { x: w, y: h, z: d } = this.def.size;
    const [hw, hd] = [w / 2, d / 2];
    const V = THREE.Vector3;
    const front = hd - 0.04;
    const gy1 = Math.min(h - 0.32, 1.7);
    const cx = (hw - 0.06 - 0.42 + hw - 0.06) / 2;
    return {
      button: new V(cx + 0.12, gy1 - 0.45, front + 0.015),
      screen: { at: new V(cx, gy1 - 0.2, front + 0.016), w: 0.25, h: 0.16 },
    };
  }

  protected jobFor(e: MachineEvent, slot: number, handled: boolean): Omit<Job, 'start'> | null {
    const p = this.parts;
    return e.kind === 'dispense' && e.mould
      ? this.dispenseJob(p, e.mould, slot, handled)
      : e.kind === 'toolUp'
        ? this.flapJob(p)
        : e.kind === 'toolDown'
          ? this.returnJob(p, e.mould ?? '2x4', handled)
          : null;
  }

  /** Nothing in it changes with its state but what waits in its output area. */
  protected contents(): void {}

  protected override waiting(m: MachineState, busy: Set<number | undefined>): void {
    // The dispenser's screen glows brighter, and a lamp lights the hatch, while a mould waits.
    const waiting = !!m.out[0] || busy.has(0);
    this.parts.screen.emissiveIntensity = waiting ? WAITING_GLOW : 1;
    this.parts.hatchLamp.material = lamp(HATCH_LAMP, waiting);
  }

  /**
   * A steel cabinet like a vending machine: a window on the left showing shelves of moulds, and
   * on the right a column with a screen, a keypad and the hatch at hand height the chosen mould
   * comes out of. The sign over the window says what it is.
   */
  private dispenser(w: number, h: number, d: number): DispenserParts {
    const g = this.group;
    const hw = w / 2;
    const hd = d / 2;
    const side = 0.06;
    const back = -hd + 0.04;
    // The cabinet's front face, a little back from its box so the hatch can stand out, and
    // how thick the front panels are.
    const front = hd - 0.04;
    const skin = 0.04;
    const [y0, y1] = [0.08, h - 0.05];
    const [xa, xb] = [-hw + side, hw - side - 0.42];
    const [gy0, gy1] = [0.48, Math.min(h - 0.32, 1.7)];
    // The plinth, then the cabinet: its sides, top, bottom and back.
    block(g, w - 0.1, y0, d - 0.12, 0, y0 / 2, -0.02, darkMetal);
    for (const s of [-1, 1])
      block(g, side, h - y0, d - 0.04, s * (hw - side / 2), (y0 + h) / 2, -0.02, teal);
    block(g, w - 2 * side, h - y1, d - 0.04, 0, (y1 + h) / 2, -0.02, teal);
    block(g, w - 2 * side, 0.06, d - 0.04, 0, y0 + 0.03, -0.02, teal);
    block(g, w - 2 * side, y1 - y0 - 0.06, 0.04, 0, (y0 + 0.06 + y1) / 2, -hd + 0.02, panelGrey);
    // The front: panels under and over the window, and the control column to its right, all
    // one sheet; a divider behind, between the window and the column.
    const fz = front - skin / 2;
    const panel = mat(0xd9dcdf, 0.45);
    const lo = y0 + 0.06;
    // Its pieces are cut from the one sheet: square-edged, meeting as one.
    block(g, xb - xa, gy0 - lo, skin, (xa + xb) / 2, (lo + gy0) / 2, fz, panel, 0);
    block(g, xb - xa, y1 - gy1, skin, (xa + xb) / 2, (gy1 + y1) / 2, fz, panel, 0);
    // The control column's sheet, round the hatch (see below), which is open.
    const [hy, hh, hwid] = [0.95, 0.22, 0.28];
    const cx = (xb + hw - side) / 2;
    const cw = hw - side - xb;
    const [hy0, hy1] = [hy - hh / 2, hy + hh / 2];
    // Under the hatch, only down to the steel lip along its bottom (below).
    const lip = hy0 - 0.025;
    block(g, cw, lip - lo, skin, cx, (lo + lip) / 2, fz, panel, 0);
    block(g, cw, y1 - hy1, skin, cx, (hy1 + y1) / 2, fz, panel, 0);
    for (const s of [-1, 1])
      block(
        g,
        (cw - hwid) / 2,
        hy1 - lip,
        skin,
        cx + (s * (cw + hwid)) / 4,
        (lip + hy1) / 2,
        fz,
        panel,
        0,
      );
    block(
      g,
      0.02,
      gy1 - gy0,
      front - skin - back,
      xb + 0.01,
      (gy0 + gy1) / 2,
      (front - skin + back) / 2,
      panelGrey,
    );
    // Steel trim round the window, and the glass.
    const t = 0.025;
    const tz = front + 0.005;
    block(g, xb - xa + 2 * t, t, 0.01, (xa + xb) / 2, gy0 - t / 2, tz, steel);
    block(g, xb - xa + 2 * t, t, 0.01, (xa + xb) / 2, gy1 + t / 2, tz, steel);
    for (const x of [xa - t / 2, xb + t / 2])
      block(g, t, gy1 - gy0, 0.01, x, (gy0 + gy1) / 2, tz, steel);
    const glass = block(
      g,
      xb - xa,
      gy1 - gy0,
      0.008,
      (xa + xb) / 2,
      (gy0 + gy1) / 2,
      front - 0.012,
      clear,
    );
    glass.castShadow = false;
    // Inside: three shelves of moulds, three to a shelf, under a strip light.
    const inner = front - skin - back;
    const iz = (front - skin + back) / 2;
    const gap = (gy1 - gy0) / 3;
    const k = Math.min(0.7, (xb - xa - 0.1) / 3 / MOULD_SIZE.x, (gap - 0.1) / MOULD_SIZE.y);
    const md = MOULD_SIZE.z * k;
    for (let i = 0; i < 3; i++) {
      const sy = gy0 + 0.01 + i * gap;
      block(g, xb - xa, 0.02, inner, (xa + xb) / 2, sy - 0.01, iz, machineGrey);
      // A price strip along the shelf's edge.
      block(
        g,
        xb - xa - 0.02,
        0.033,
        0.004,
        (xa + xb) / 2,
        sy - 0.0085,
        front - skin + 0.004,
        panelGrey,
      );
      // Each leant back on a stand, its cavity toward the window.
      for (let j = 0; j < 3; j++) {
        const x = xa + ((xb - xa) * (j + 0.5)) / 3;
        const mould = mouldBlock(SHOWN_MOULDS[i * 3 + j]!);
        mould.scale.setScalar(k);
        mould.rotation.x = SHELF_LEAN;
        mould.position.set(x, sy + (md / 2) * Math.sin(SHELF_LEAN), iz + 0.06);
        g.add(mould);
        const rise = md * Math.sin(SHELF_LEAN);
        const backZ = iz + 0.06 - (md / 2) * Math.cos(SHELF_LEAN);
        block(g, MOULD_SIZE.x * k * 0.6, rise, 0.04, x, sy + rise / 2, backZ - 0.02, panelGrey);
      }
    }
    block(g, xb - xa, 0.02, inner, (xa + xb) / 2, gy1 - 0.01, iz, machineGrey);
    block(
      g,
      xb - xa - 0.1,
      0.012,
      0.03,
      (xa + xb) / 2,
      gy1 - 0.026,
      front - skin - 0.06,
      mat(0xffffff, 0.4, 0, 0xdde8f0),
    );
    // The control column: a screen in its bezel, a keypad, and the hatch the mould comes out
    // of at hand height, with a smoked flap and a tray, and a lamp over it; vents at its foot.
    // The screen lights up while it dispenses a mould, and glows brighter while one waits in
    // the hatch: a material of this machine's own.
    block(g, 0.3, 0.22, 0.01, cx, gy1 - 0.2, front + 0.005, panelGrey);
    const lcd = new THREE.MeshStandardMaterial({
      color: 0x4fc3f7,
      roughness: 0.3,
      emissive: 0x1e6fb5,
    });
    block(g, 0.25, 0.16, 0.006, cx, gy1 - 0.2, front + 0.013, lcd);
    for (let i = 0; i < 9; i++) {
      const b = rodZ(
        g,
        0.016,
        front,
        front + 0.012,
        cx - 0.06 + (i % 3) * 0.06,
        gy1 - 0.4 - Math.floor(i / 3) * 0.05,
        steel,
      );
      b.castShadow = false;
    }
    this.button = rodZ(g, 0.024, front, front + 0.015, cx + 0.12, gy1 - 0.45, mat(0x3bb54a, 0.4));
    this.button.castShadow = false;
    // The hatch: a dark box set into the column, deep enough for a mould to drop into.
    const deep = 0.26;
    const back0 = front - deep;
    block(g, hwid, hh, 0.01, cx, hy, back0 + 0.005, darkMetal);
    block(g, hwid, 0.01, deep - skin, cx, hy0 + 0.005, (back0 + front - skin) / 2, darkMetal);
    block(g, hwid, 0.01, deep - skin, cx, hy1 - 0.005, (back0 + front - skin) / 2, darkMetal);
    for (const s of [-1, 1])
      block(
        g,
        0.01,
        hh,
        deep - skin,
        cx + s * (hwid / 2 - 0.005),
        hy,
        (back0 + front - skin) / 2,
        darkMetal,
      );
    block(g, hwid + 0.04, 0.03, 0.035, cx, hy + hh / 2 + 0.015, front + 0.0175, steel);
    for (const s of [-1, 1])
      block(g, 0.02, hh, 0.035, cx + s * (hwid / 2 + 0.01), hy, front + 0.0175, steel);
    block(g, hwid + 0.04, 0.025, 0.065, cx, hy - hh / 2 - 0.0125, front + 0.0025, steel);
    block(g, hwid + 0.04, 0.04, 0.01, cx, hy - hh / 2 + 0.005, front + 0.03, steel);
    // The flap hangs from its top edge, a little open at the bottom, and swings up as a mould
    // is taken out (see `flapJob`).
    const flapHinge = new THREE.Group();
    flapHinge.position.set(cx, hy1 - 0.01, front - 0.004);
    flapHinge.rotation.x = FLAP_REST;
    g.add(flapHinge);
    const flap = block(flapHinge, hwid - 0.01, hh - 0.04, 0.006, 0, -(hh - 0.04) / 2, 0, smoked);
    flap.castShadow = false;
    // The lamp, between the hatch's trim and the keypad, lit while a mould waits in the hatch.
    const ly = (hy1 + 0.03 + gy1 - 0.5 - 0.016) / 2;
    const hatchLamp = rodZ(g, 0.016, front, front + 0.012, cx, ly, lamp(HATCH_LAMP, false));
    hatchLamp.castShadow = false;
    for (let i = 0; i < 4; i++)
      block(g, 0.24, 0.015, 0.004, cx, 0.22 + i * 0.04, front + 0.002, darkMetal);
    chalkSign(g, 0.9, 0.18, 0, (gy1 + y1) / 2 + 0.01, front, 'Moulds');
    return { flap: flapHinge, screen: lcd, hatchLamp };
  }

  /**
   * Dispenses a mould: the screen lights up and flickers while it finds the one asked for, and
   * the mould drops into the hatch and the lamp over it lights, for someone to take it.
   */
  private dispenseJob(
    { screen: lcd, hatchLamp }: DispenserParts,
    type: BrickTypeId,
    slot: number,
    handled: boolean,
  ): Omit<Job, 'start'> {
    const group = this.jobGroup();
    const mould = madeModel({ kind: 'mould', type });
    group.add(mould);
    const hatch = this.restAt(slot);
    // From the cabinet over the hatch, out of sight until it drops through the hatch's top.
    const top = hatch.clone().add(new THREE.Vector3(0, 0.3, 0));
    return {
      length: MAKE_SECONDS.mould,
      slot,
      group,
      step: (t) => {
        if (handled) this.pushButton(t);
        const flicker = t > 0.15 && t < 1.05 ? 0.3 * Math.sin(t * 40) : 0;
        lcd.emissiveIntensity =
          1 + 1.5 * span(t, 0, 0.15) - (2.5 - WAITING_GLOW) * span(t, 1.05, 1.3) + flicker;
        const drop = span(t, 1.0, 1.3);
        mould.position.lerpVectors(top, hatch, drop * drop);
        // A little bounce as it lands.
        mould.position.y +=
          t < 1.5 ? Math.max(0, Math.sin(span(t, 1.3, 1.5) * Math.PI)) * 0.025 : 0;
        hatchLamp.material = lamp(HATCH_LAMP, t >= 1.3);
      },
      end: () => {
        lcd.emissiveIntensity = WAITING_GLOW;
        hatchLamp.material = lamp(HATCH_LAMP, true);
        this.pushButton(1);
      },
    };
  }

  /** The hatch's flap swinging up as a mould is taken out of it, and falling back. */
  private flapJob({ flap }: DispenserParts): Omit<Job, 'start'> {
    return {
      length: 0.6,
      group: this.jobGroup(),
      step: (t) => {
        flap.rotation.x = FLAP_REST - 1.3 * (ease(span(t, 0, 0.15)) - ease(span(t, 0.25, 0.6)));
      },
      end: () => {
        flap.rotation.x = FLAP_REST;
      },
    };
  }

  /**
   * A mould put back: pushed in through the hatch's flap from before it, by hand (`handled`,
   * see `HANDLED.return`) or by itself, and drawn on back into the cabinet out of sight.
   */
  private returnJob(
    { flap }: DispenserParts,
    type: BrickTypeId,
    handled: boolean,
  ): Omit<Job, 'start'> {
    const H = HANDLED.return;
    const group = this.jobGroup();
    const mould = madeModel({ kind: 'mould', type });
    group.add(mould);
    const hatch = this.restAt(0);
    const from = hatch.clone().add(new THREE.Vector3(0, 0.02, handled ? H.from : 0.12));
    const away = hatch.clone().add(new THREE.Vector3(0, 0.02, -0.3));
    return {
      length: H.length,
      group,
      step: (t) => {
        mould.position.lerpVectors(from, hatch, ease(span(t, ...H.push)));
        if (t > H.away[0]) mould.position.lerpVectors(hatch, away, ease(span(t, ...H.away)));
        mould.visible = t < H.away[1];
        flap.rotation.x = FLAP_REST - 1.1 * (ease(span(t, 0, 0.12)) - ease(span(t, 0.4, 0.7)));
      },
      end: () => {
        flap.rotation.x = FLAP_REST;
      },
    };
  }
}
