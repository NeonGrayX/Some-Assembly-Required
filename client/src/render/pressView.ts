import * as THREE from 'three';
import { BUCKET_SHOTS, MAKE_SECONDS, PRESS_BAY } from '@sar/shared';
import type { BrickTypeId, ColourId, MachineDef, MachineState } from '@sar/shared';
import { brickMaterial } from './bricks.ts';
import { mat } from './interiors.ts';
import { bevelFor } from './shapes.ts';
import { HANDLED, HOPPER_STEP, HOPPER_STEP_SIZE } from './operate.ts';
import { MOULD_SIZE, bucket, mouldBlock, pelletStream } from './carried.ts';
import type { Job, MachineEvent } from './machineLook.ts';
import {
  block,
  boxBetween,
  chalkSign,
  clamp01,
  clear,
  collar,
  darkMetal,
  disposeOwn,
  ease,
  lamp,
  lyingPart,
  machineGrey,
  ownMesh,
  panelGrey,
  pelletHeap,
  rod,
  rodZ,
  screen,
  span,
  steel,
  teal,
  tealDark,
  upright,
} from './machineParts.ts';
import type { Corner, Span } from './machineParts.ts';
import { MachineView } from './machineView.ts';
import type { MachineControls } from './operate.ts';

/** How far the moulding machine's safety door slides to open: its frame clear of the mould. */
const DOOR_SLIDE = 0.68;
/** How high the mouth of the moulding machine's chute stands on its bed, under the door's rail. */
const CHUTE_TOP = 0.63;

/** The moulding machine's moving parts: the ram and moving platen, the door, the heater bands. */
interface PressParts {
  clamp: THREE.Object3D;
  door: THREE.Object3D;
  heat: THREE.MeshStandardMaterial;
  /** The mould clamped in it, if one is. */
  mould: THREE.Object3D | null;
  /** The step that slides out of its bed under the hopper. */
  step: THREE.Object3D;
  /** The hopper's lid, hinged at its back. */
  lid: THREE.Object3D;
}

/** The injection moulding machine. */
export class PressView extends MachineView {
  /** What moves when it works (see `play`). */
  private readonly parts: PressParts;
  /**
   * The moulding machine's stack light: green when it can mould a part (a mould and pellets in
   * it, and room in its tray), amber when it has either in it but cannot (half loaded, or its
   * tray full), red when it has neither or is jammed, and dark without power.
   */
  private lights: THREE.Mesh[] = [];
  /** Which of the stack lights are lit, between flashes. */
  private lit = [false, false, true];
  /**
   * How far open the jobs posed so far this frame want the moulding machine's clamp (see
   * `clamp`): back to shut before they are posed each frame, or cut short.
   */
  private clampOpen = 0;
  /** Pellets going into the hopper, drawn by the pour as they rise; and what was in it before. */
  private pouring = false;
  private beforePour: { colour: ColourId | null; shots: number } = { colour: null, shots: 0 };

  constructor(def: MachineDef) {
    super(def);
    const { x: w, y: h, z: d } = def.size;
    this.parts = this.press(w, h, d);
    this.built();
  }

  controls(): MachineControls {
    const { x: w, z: d } = this.def.size;
    const [hw, hd] = [w / 2, d / 2];
    const V = THREE.Vector3;
    const { mx, my, hx, cz, hx0, hopper } = this.pressLayout(w, d);
    const px = (hx0 + hw - 0.04) / 2;
    // The mould stands on its edge between the platens, its cavity toward the door.
    const quat = new THREE.Quaternion().setFromAxisAngle(new V(1, 0, 0), Math.PI / 2);
    const home = new V(mx, my, hd - 0.1 - MOULD_SIZE.y / 2);
    return {
      button: new V(px - 0.15, 0.8, hd - 0.015),
      screen: { at: new V(px, 0.97, hd - 0.024), w: 0.3, h: 0.14 },
      hopper: { at: new V(hx, hopper.top + 0.03, cz), r: hopper.r },
      mould: { home, out: home.clone().add(new V(0, 0.1, 0.3)), width: MOULD_SIZE.x, quat },
      door: { handle: new V(mx - 0.34, my, hd - 0.01), slide: DOOR_SLIDE },
    };
  }

  protected jobFor(e: MachineEvent, slot: number, handled: boolean): Omit<Job, 'start'> | null {
    const p = this.parts;
    return e.kind === 'mouldIn'
      ? this.mouldInJob(p, handled)
      : e.kind === 'pour' && e.colour
        ? this.pourJob(p, e.colour, handled)
        : e.kind === 'moulded' && e.mould && e.colour
          ? this.mouldJob(p, e.mould, e.colour, slot, handled)
          : null;
  }

  protected override changed(was: MachineState | null, m: MachineState): void {
    // What was in the hopper before a bucket of pellets went in (see `pourJob`).
    const poured = m.colour !== null && m.shots === BUCKET_SHOTS;
    if (was && poured && (was.colour !== m.colour || was.shots !== m.shots))
      this.beforePour = { colour: was.colour, shots: was.shots };
  }

  override tick(now: number): void {
    super.tick(now);
    // The step under the hopper, slid out as far as whoever is on it has it.
    this.parts.step.position.z = HOPPER_STEP_SIZE.run * ease(this.step);
  }

  protected override beforePose(): void {
    this.clampOpen = 0;
  }

  /**
   * Where the press's parts are, worked out from its size: the clamp at its left end, the
   * injection unit with its hopper in the middle and the housing with the controls at the right.
   */
  private pressLayout(w: number, d: number) {
    const hw = w / 2;
    const hd = d / 2;
    const mx = -hw + 0.9;
    const hx = mx + 0.85;
    return {
      hw,
      hd,
      /** The mould's middle across, its height, and how far forward the clamp's axis is. */
      mx,
      my: 0.95,
      cz: hd - 0.415,
      /** The hopper's place, and where the housing begins. */
      hx,
      hx0: hx + 0.35,
      hopper: { r: 0.17, neck: 0.92, cone: 1.02, cyl: 1.16, top: 1.46 },
    };
  }

  private press(w: number, h: number, d: number): PressParts {
    const g = this.group;
    const { hw, hd, mx, my, cz, hx, hx0, hopper } = this.pressLayout(w, d);
    // Feet, the bed, and a stripe along its front.
    for (const x of [-hw + 0.2, 0, hw - 0.2])
      for (const z of [-hd + 0.15, hd - 0.15]) block(g, 0.12, 0.1, 0.12, x, 0.05, z, darkMetal);
    // The bed has a bay in its front under the mould, which the parts it makes drop into and
    // wait in (see `PRESS_BAY`). It is built of blocks round the bay, each reaching into the
    // next by twice its bevel: their bevels where they meet are out of sight inside each other,
    // so only its outer edges show them, as one block's would. The blocks over and under the
    // bay are too thin for so deep a bevel and get less (see `BevelBoxGeometry`): the chute's
    // mouth covers the front edge of the one over it, and the one under it stands back from the
    // front by the bevel, so that its edges stay inside the bed's to either side of the bay,
    // out of sight behind the tray's lip, which comes down to the bed's foot.
    const bevel = bevelFor(w - 0.08, 0.52, d - 0.1);
    const bed = { x0: -hw + 0.04, x1: hw - 0.04, y0: 0.1, y1: 0.62, z0: -hd + 0.03, z1: hd - 0.07 };
    const bay = {
      x0: mx - 1.5 * PRESS_BAY.step,
      x1: mx + 1.5 * PRESS_BAY.step,
      y0: PRESS_BAY.floor,
      y1: PRESS_BAY.top,
      z0: bed.z1 - PRESS_BAY.depth,
    };
    const tray = 0.01;
    const [left, right, back] = [bay.x0 - 2 * bevel, bay.x1 + 2 * bevel, bay.z0 - 2 * bevel];
    const grey = (a: Corner, b: Corner) => boxBetween(g, a, b, machineGrey, bevel);
    grey([bed.x0, bed.y0, bed.z0], [bay.x0, bed.y1, bed.z1]);
    grey([bay.x1, bed.y0, bed.z0], [bed.x1, bed.y1, bed.z1]);
    // Behind the bay, over it, and under it (and the tray along its floor).
    grey([left, bed.y0, bed.z0], [right, bed.y1, bay.z0]);
    grey([left, bay.y1, back], [right, bed.y1, bed.z1]);
    grey([left, bed.y0, back], [right, bay.y0 - tray, bed.z1 - bevel]);
    // The stripe stops where the bed's bevelled edges turn away, at its ends and over it. Over
    // the bay it is its top edge, and fills the bevel along the bottom of the block over it.
    const stripe = w - 0.08 - 2 * bevel;
    const sy = bed.y1 - bevel - 0.035;
    block(g, stripe, 0.06, 0.01, 0, sy, hd - 0.065, teal);
    const [sx0, sx1] = [bay.x0 - bevel, bay.x1 + bevel];
    boxBetween(g, [sx0, sy - 0.03, bed.z1 - bevel], [sx1, sy + 0.03, bed.z1], teal, 0);
    // The bay's inside is dark, so the parts in it stand out: its back, its sides as far as the
    // bevels at its mouth, and its ceiling, where the chute from the mould comes out. A tray
    // along its floor runs out into those bevels, and its lip at the front is a plate down to
    // the bed's foot, over the block under the bay.
    const sheet = 0.006;
    const mouth = bed.z1 - bevel;
    boxBetween(g, [bay.x0, bay.y0, bay.z0], [bay.x1, bay.y1, bay.z0 + sheet], darkMetal);
    for (const x of [bay.x0, bay.x1 - sheet])
      boxBetween(g, [x, bay.y0, bay.z0 + sheet], [x + sheet, bay.y1, mouth], darkMetal);
    const ceiling: Corner = [bay.x0 + sheet, bay.y1 - 0.004, bay.z0 + sheet];
    boxBetween(g, ceiling, [bay.x1 - sheet, bay.y1, mouth], darkMetal);
    boxBetween(g, [sx0, bay.y0 - tray, bay.z0], [sx1, bay.y0, bed.z1 - 0.01], panelGrey);
    const lip: Corner = [sx0, bed.y0, bed.z1 - 0.01];
    boxBetween(g, lip, [sx1, bay.y0 + 0.015, bed.z1 + 0.003], panelGrey);
    // The clamp: its cylinder housing at the end, the ram, the moving and fixed platens and
    // four tie bars between.
    block(g, 0.32, 0.64, d - 0.2, -hw + 0.22, 0.94, -0.03, teal);
    // The ram and the moving platen slide together (see `clamp`).
    const clampParts = new THREE.Group();
    g.add(clampParts);
    rod(clampParts, 0.07, -hw + 0.36, mx - 0.28, my, cz, steel);
    block(clampParts, 0.1, 0.62, 0.64, mx - 0.25, my, cz, tealDark);
    block(g, 0.14, 0.62, 0.64, mx + 0.27, my, cz, tealDark);
    for (const y of [my - 0.25, my + 0.25])
      for (const z of [-0.26, 0.26]) rod(g, 0.035, -hw + 0.36, mx + 0.36, y, cz + z, steel);
    // The mouth of the chute down to the bay, on the bed in front of the mould's face, over
    // the stripe and along the block over the bay.
    const chute: Corner = [left, sy + 0.03, bed.z1 - 0.075];
    boxBetween(g, chute, [right, CHUTE_TOP, bed.z1 + 0.002], darkMetal);
    // A guard sheet behind the mould and the safety door in front of it: a glass pane in a
    // frame with a handle.
    block(g, 0.84, 0.62, 0.01, mx, my, cz - 0.345, panelGrey);
    // The door hangs from a rail along its top and slides along it to the right, clear of the
    // mould but short of the control panel (see `door`).
    const doorZ = hd - 0.05;
    const [dx0, dx1, dy0, dy1] = [mx - 0.42, mx + 0.42, 0.66, 1.2];
    const bar = 0.03;
    const door = new THREE.Group();
    door.position.set(0, dy1, doorZ);
    g.add(door);
    block(door, dx1 - dx0, bar, bar, mx, dy0 + bar / 2 - dy1, 0, panelGrey);
    block(door, dx1 - dx0, bar, bar, mx, -bar / 2, 0, panelGrey);
    for (const x of [dx0 + bar / 2, dx1 - bar / 2])
      block(door, bar, dy1 - dy0 - 2 * bar, bar, x, (dy0 + dy1) / 2 - dy1, 0, panelGrey);
    const glass = block(
      door,
      dx1 - dx0 - 2 * bar,
      dy1 - dy0 - 2 * bar,
      0.008,
      mx,
      (dy0 + dy1) / 2 - dy1,
      0,
      clear,
    );
    glass.castShadow = false;
    block(door, 0.025, 0.22, 0.02, dx0 + 0.08, my - dy1, hd - 0.02 - doorZ, steel);
    for (const y of [my - 0.09, my + 0.09])
      block(door, 0.02, 0.02, 0.02, dx0 + 0.08, y - dy1, hd - 0.04 - doorZ, steel);
    // The rail it hangs from and the guide its foot runs in, long enough for it open.
    const rx1 = dx1 + DOOR_SLIDE;
    block(g, rx1 - dx0, 0.024, 0.04, (dx0 + rx1) / 2, dy1 + 0.012, doorZ, darkMetal);
    block(g, rx1 - dx0, 0.02, 0.04, (dx0 + rx1) / 2, dy0 - 0.02, doorZ, darkMetal);
    // The sign over the door, on posts standing on the platens.
    for (const x of [mx - 0.25, mx + 0.27])
      block(g, 0.03, 0.2, 0.03, x, my + 0.41, hd - 0.12, darkMetal);
    chalkSign(g, 1.1, 0.2, mx, my + 0.44, hd - 0.105, 'Moulding machine');
    // The injection unit: the barrel with its heater bands on a carriage, the hopper over it,
    // and the housing with the motor and controls.
    block(g, hx0 - (mx + 0.34), 0.16, 0.3, (hx0 + mx + 0.34) / 2, 0.7, cz, tealDark);
    rod(g, 0.075, mx + 0.34, hx0, 0.85, cz, steel);
    // The heater bands glow while it moulds: a material of this machine's own.
    const heat = new THREE.MeshStandardMaterial({
      color: 0x8a4b2a,
      roughness: 0.5,
      metalness: 0.3,
      emissive: 0xff5a1f,
      emissiveIntensity: 0,
    });
    for (const x of [mx + 0.5, mx + 0.68, hx + 0.2])
      rod(g, 0.085, x - 0.03, x + 0.03, 0.85, cz, heat);
    upright(g, 0.05, 0.05, hopper.neck, hopper.cone, hx, cz, steel, 12);
    upright(g, 0.05, hopper.r, hopper.cone, hopper.cyl, hx, cz, clear, 20, true).castShadow = false;
    upright(g, hopper.r, hopper.r, hopper.cyl, hopper.top, hx, cz, clear, 20, true).castShadow =
      false;
    // A ring round the clear hopper where its cone meets its drum, open in the middle so the
    // last of the pellets in the cone can be seen; and its lid with a vent pipe.
    const { r, cyl, top: lid } = hopper;
    collar(g, r - 0.012, r + 0.01, cyl - 0.01, cyl + 0.01, hx, cz, panelGrey, 20);
    // The lid hinges up at the back to pour pellets in (see `pourJob`); its vent a stub on it.
    const lidHinge = new THREE.Group();
    lidHinge.name = 'hopperLid';
    lidHinge.position.set(hx, lid, cz - r - 0.012);
    g.add(lidHinge);
    upright(lidHinge, r + 0.012, r + 0.012, 0, 0.03, 0, r + 0.012, panelGrey, 20);
    upright(lidHinge, 0.03, 0.03, 0.03, 0.11, 0, r + 0.012, darkMetal, 10);
    const top = 1.25;
    const [x1, front] = [hw - 0.04, hd - 0.11];
    block(g, x1 - hx0, top - 0.62, d - 0.16, (hx0 + x1) / 2, (top + 0.62) / 2, -0.03, teal);
    // The cover plate on its top, inside its bevelled edges.
    const inset = 2 * bevelFor(x1 - hx0, top - 0.62, d - 0.16);
    block(
      g,
      x1 - hx0 - inset,
      0.02,
      d - 0.16 - inset,
      (hx0 + x1) / 2,
      top + 0.01,
      -0.03,
      machineGrey,
    );
    // The control panel with its screen and buttons on the housing's front, vents over it.
    const px = (hx0 + x1) / 2;
    block(g, 0.5, 0.36, 0.09, px, 0.88, hd - 0.075, panelGrey);
    block(g, 0.3, 0.14, 0.006, px, 0.97, hd - 0.027, screen);
    for (const [i, c] of [0x3bb54a, 0xf2c230, 0x3a7bd5].entries()) {
      const b = rodZ(g, 0.018, hd - 0.03, hd - 0.015, px - 0.15 + i * 0.07, 0.8, mat(c, 0.4));
      b.castShadow = false;
      // The green one starts it.
      if (i === 0) this.button = b;
    }
    rodZ(g, 0.03, hd - 0.03, hd - 0.012, px + 0.15, 0.8, mat(0xd32f2f, 0.4));
    for (let i = 0; i < 3; i++)
      block(g, 0.4, 0.02, 0.006, px, 1.09 + i * 0.04, front + 0.003, darkMetal);
    // The stack light on top of the housing (lit by `contents`).
    const lx = hw - 0.22;
    upright(g, 0.015, 0.015, top + 0.02, top + 0.08, lx, -0.1, darkMetal, 8);
    this.lights = [0x3bb54a, 0xf2a530, 0xd32f2f].map((c, i) =>
      upright(
        g,
        0.04,
        0.04,
        top + 0.08 + i * 0.08,
        top + 0.155 + i * 0.08,
        lx,
        -0.1,
        lamp(c, false),
        12,
      ),
    );
    upright(g, 0.042, 0.042, top + 0.32, top + 0.34, lx, -0.1, darkMetal, 12);
    return {
      clamp: clampParts,
      door,
      heat,
      mould: null,
      step: this.hopperStep(hx, bed.z1),
      lid: lidHinge,
    };
  }

  /**
   * The step under the hopper, in the bed's front at `x` (its front at `z`), slid in out of the
   * way: a tread on two cheeks, its front edge striped, to slide out and stand on.
   */
  private hopperStep(x: number, z: number): THREE.Object3D {
    const step = new THREE.Group();
    step.name = 'hopperStep';
    this.group.add(step);
    const { w, d } = HOPPER_STEP_SIZE;
    const top = HOPPER_STEP;
    // (Its front a hair inside the bed's, slid in, but for the stripe along it.)
    const z0 = z - 0.004 - d;
    block(step, w, 0.04, d, x, top - 0.02, z0 + d / 2, darkMetal);
    for (const s of [-1, 1])
      block(
        step,
        0.03,
        top - 0.04,
        d,
        x + s * (w / 2 - 0.015),
        (top - 0.04) / 2,
        z0 + d / 2,
        darkMetal,
      );
    block(step, w - 0.06, 0.012, 0.03, x, top + 0.006, z - 0.03, mat(0xf2c230, 0.5));
    block(step, w, 0.03, 0.012, x, top - 0.02, z, mat(0xf2c230, 0.5));
    return step;
  }

  protected contents(m: MachineState, _svgs: Record<string, string>, powered: boolean): void {
    const parts = this.parts;
    const { hd, mx, my } = this.pressLayout(this.def.size.x, this.def.size.z);
    const ready =
      !!m.mould &&
      !!m.colour &&
      m.shots > 0 &&
      !m.jammed &&
      // A place free for the next part: not the one the part being moulded drops into.
      m.out.some((x, i) => x === null && m.making?.slot !== i);
    const half = !ready && !m.jammed && (!!m.mould || (!!m.colour && m.shots > 0));
    // Without power the stack light is dark; jammed, it shows red.
    this.lit = powered ? [ready, half, !ready && !half] : [false, false, false];
    this.showLights();
    parts.mould = null;
    if (m.mould) {
      // Clamped between the platens, its cavity face toward the door.
      const mould = mouldBlock(m.mould);
      mould.rotation.x = Math.PI / 2;
      mould.position.set(mx, my, hd - 0.1 - MOULD_SIZE.y);
      this.dynamic.add(mould);
      parts.mould = mould;
    }
    // Pellets in the hopper as far as there are shots left: as they were before a bucket the
    // hands are yet to pour in, and drawn by the pour itself while it goes in.
    const pellets = this.awaits('pour') ? this.beforePour : m;
    if (pellets.colour && pellets.shots > 0 && !this.pouring)
      this.dynamic.add(this.hopperPellets(pellets.colour, pellets.shots / BUCKET_SHOTS));
  }

  /** Pellets of `colour` in the hopper, from its narrow bottom up to `f` (0..1) of it full. */
  private hopperPellets(colour: ColourId, f: number): THREE.Group {
    const { cz, hx, hopper } = this.pressLayout(this.def.size.x, this.def.size.z);
    const r = hopper.r - 0.008;
    const bottom = hopper.cone + 0.005;
    const level = bottom + Math.min(1, f) * (hopper.top - 0.04 - bottom);
    const plastic = brickMaterial(colour);
    const coneTop = Math.min(level, hopper.cyl);
    const rAt = 0.045 + ((r - 0.045) * (coneTop - bottom)) / (hopper.cyl - bottom);
    const g = new THREE.Group();
    g.position.set(hx, 0, cz);
    g.add(
      ownMesh(
        new THREE.CylinderGeometry(rAt, 0.045, coneTop - bottom, 20),
        plastic,
        (bottom + coneTop) / 2,
      ),
    );
    if (level > hopper.cyl)
      g.add(
        ownMesh(
          new THREE.CylinderGeometry(r, r, level - hopper.cyl, 20),
          plastic,
          (hopper.cyl + level) / 2,
        ),
      );
    const heap = new THREE.Mesh(pelletHeap(level > hopper.cyl ? r : rAt), plastic);
    heap.position.y = level;
    heap.userData.own = true;
    g.add(heap);
    return g;
  }

  private showLights(flash = -1): void {
    for (const [i, c] of [0x3bb54a, 0xf2a530, 0xd32f2f].entries())
      this.lights[i]!.material = lamp(c, i === flash || (flash < 0 && this.lit[i]!));
  }

  /**
   * Puts a mould in: the door slides aside, the clamp opens, the mould slides in and it shuts.
   * Done by hand (`handled`), the door is slid open by its handle, the mould pushed in so far
   * from where the hands hold it before the opening, and drawn home by the clamp (see
   * `HANDLED.mould`).
   */
  private mouldInJob(p: PressParts, handled: boolean): Omit<Job, 'start'> {
    const { home, out } = this.controls().mould!;
    // A mould block's origin is the middle of its bottom, which stood on its edge faces +z.
    const origin = new THREE.Vector3(0, 0, -MOULD_SIZE.y / 2);
    const at = (o: number) => new THREE.Vector3().lerpVectors(home, out, o).add(origin);
    if (!handled) {
      const from = home.clone().add(new THREE.Vector3(0, 0.12, 0.6));
      return {
        length: 1.5,
        group: this.jobGroup(),
        step: (t) => {
          this.door(p, span(t, 0, 0.3) - span(t, 1.15, 1.5));
          this.clamp(p, span(t, 0, 0.3) - span(t, 0.95, 1.15));
          p.mould?.position.lerpVectors(from.clone().add(origin), at(0), ease(span(t, 0.25, 0.95)));
        },
        end: () => p.mould?.position.copy(at(0)),
      };
    }
    const H = HANDLED.mould;
    return {
      length: H.length,
      group: this.jobGroup(),
      step: (t) => {
        this.door(p, ease(span(t, ...H.open)) - ease(span(t, ...H.close)));
        this.clamp(p, span(t, ...H.clamp) - span(t, ...H.shut));
        // In the hands till they bring it to the opening (see `putMouldIn`).
        if (p.mould) p.mould.visible = t >= H.push[0];
        const o =
          t < H.push[1]
            ? 1 - (1 - H.pushed) * ease(span(t, ...H.push))
            : H.pushed * (1 - ease(span(t, ...H.seat)));
        p.mould?.position.copy(at(o));
      },
      end: () => {
        if (!p.mould) return;
        p.mould.visible = true;
        p.mould.position.copy(at(0));
      },
    };
  }

  /**
   * Pours pellets in: the hopper's lid opens and the pellets rise in it as they go in, poured
   * from a bucket held over it by hand (`handled`, see `HANDLED.pour`), or by itself from a
   * bucket tipping over it.
   */
  private pourJob(p: PressParts, colour: ColourId, handled: boolean): Omit<Job, 'start'> {
    const { hx, cz, hopper } = this.pressLayout(this.def.size.x, this.def.size.z);
    const group = this.jobGroup();
    const H: Record<'lid' | 'rise' | 'close', Span> & { length: number } = handled
      ? HANDLED.pour
      : { lid: [0, 0.3], rise: [0.35, 1.05], close: [1.1, 1.4], length: 1.4 };
    // What was in it before; drawn by this job from now on as the pellets rise.
    const was = this.beforePour.colour === colour ? this.beforePour.shots / BUCKET_SHOTS : 0;
    this.pouring = true;
    if (this.last) this.rebuild();
    const pellets = new THREE.Group();
    group.add(pellets);
    let drawn = -1;
    let pail: THREE.Object3D | null = null;
    let stream: ((t: number | null) => void) | null = null;
    if (!handled) {
      pail = bucket(colour);
      group.add(pail);
      const lip = new THREE.Vector3(hx, hopper.top + 0.1, cz);
      stream = pelletStream(group, colour, lip, hopper.top - 0.15);
    }
    return {
      length: H.length,
      group,
      step: (t) => {
        p.lid.rotation.x = -1.9 * (ease(span(t, ...H.lid)) - ease(span(t, ...H.close)));
        // The level, in a dozen steps (each drawn anew).
        const level = Math.round(12 * (was + (1 - was) * ease(span(t, ...H.rise)))) / 12;
        if (level !== drawn) {
          drawn = level;
          disposeOwn(pellets);
          pellets.clear();
          if (level > 0) pellets.add(this.hopperPellets(colour, level));
        }
        if (pail) {
          // From over the hopper's side, tipped toward it, then put down out of the way.
          const tip = ease(span(t, 0, 0.35)) - ease(span(t, 1.05, 1.4));
          pail.position.set(hx + 0.28 - 0.06 * tip, hopper.top + 0.12 + 0.06 * tip, cz);
          pail.rotation.z = 1.9 * tip;
          pail.scale.setScalar(1 - span(t, 1.15, 1.4));
          stream?.(t >= 0.3 && t < 1.05 ? t : null);
        }
      },
      end: () => {
        p.lid.rotation.x = 0;
        disposeOwn(pellets);
        this.pouring = false;
        if (this.last) this.rebuild();
      },
    };
  }

  /**
   * Moulds a part: the clamp shuts tight, the heater bands glow while the plastic goes in, the
   * clamp opens and the part is pushed off the mould's face and drops down the chute, out of
   * which it falls into its place in the bay in the bed's front, to wait there to be taken.
   */
  private mouldJob(
    p: PressParts,
    type: BrickTypeId,
    colour: ColourId,
    slot: number,
    handled: boolean,
  ): Omit<Job, 'start'> {
    const { hd, mx, my } = this.pressLayout(this.def.size.x, this.def.size.z);
    const group = this.jobGroup();
    const part = lyingPart(type, colour);
    const turned = part.children[0]!;
    const half = turned.position.y;
    group.add(part);
    // Where its middle goes: from in the mould's cavity out of its face, then down in front of
    // it into the chute's mouth. Out of sight in the chute it goes over its place in the bay,
    // and comes out of the bay's ceiling there.
    const cavity = new THREE.Vector3(mx, my, hd - 0.12);
    const off = new THREE.Vector3(mx, my, hd - 0.095);
    const rest = this.restAt(slot);
    const { heat } = p;
    return {
      length: MAKE_SECONDS.part,
      slot,
      group,
      step: (t) => {
        // Its button pressed by the finger that set it going.
        if (handled) this.pushButton(t);
        // A shudder while it injects; open to let the part go; shut again.
        const shake = t > 0.25 && t < 0.9 ? Math.sin(t * 90) * 0.002 : 0;
        this.clamp(p, span(t, 1.0, 1.2) - span(t, 2.0, 2.3), shake);
        heat.emissiveIntensity = 1.6 * (span(t, 0.15, 0.4) - span(t, 0.9, 1.6));
        this.showLights(Math.floor(t * 6) % 2 ? 1 : 0);
        part.visible = t >= 1.15 && (t < 1.5 || t >= 1.75);
        if (t < 1.75) {
          // Studs first off the face, then falling, turning in the plane of the door.
          const fall = span(t, 1.25, 1.5);
          part.position.lerpVectors(cavity, off, ease(span(t, 1.15, 1.25)));
          part.position.y += (CHUTE_TOP - 0.07 - my) * fall * fall - half;
          turned.rotation.set(Math.PI / 2, fall * 1.4, 0);
        } else {
          // Out of the ceiling, landing flat with a little bounce, and at rest.
          const fall = span(t, 1.75, 1.95);
          const bounce = t < 2.15 ? Math.sin(span(t, 1.95, 2.15) * Math.PI) * 0.012 : 0;
          part.position.copy(rest);
          part.position.y += (1 - fall * fall) * (PRESS_BAY.top - half - rest.y) + bounce;
          turned.rotation.set(0.35 * (1 - fall), 0, 0.25 * (1 - fall));
        }
      },
      end: () => {
        heat.emissiveIntensity = 0;
        this.showLights();
        this.clamp(p, 0);
        this.pushButton(1);
      },
    };
  }

  /** Slides the safety door aside along its rail by `open` (0 shut, 1 open). */
  private door(p: PressParts, open: number): void {
    p.door.position.x = DOOR_SLIDE * ease(clamp01(open));
  }

  /**
   * Draws the moving platen back by `open` (0 shut, 1 open), less any shudder. A part being
   * moulded while a mould goes in moves it for both: it is as far open as the most either
   * wants it this frame, so neither snaps it shut on the other.
   */
  private clamp(p: PressParts, open: number, shake = 0): void {
    this.clampOpen = Math.max(this.clampOpen, clamp01(open));
    p.clamp.position.x = -0.12 * ease(this.clampOpen) + shake;
  }
}
