import * as THREE from 'three';
import { BUCKET_SHOTS, MAKE_SECONDS, MOULD_TYPES } from '@sar/shared';
import type { BrickTypeId, ColourId, MachineDef, MachineState } from '@sar/shared';
import { batchStatic } from '../carscene/batch.ts';
import {
  BUTTON_GREEN,
  FLAP_REST,
  LIVE_PARTS,
  MACHINE_MODELS,
  PAD,
  PRESS,
  PRINTER,
  SILO,
  STACK_LAMPS,
  VENDOR,
  machinePad,
} from '../carscene/machines.ts';
import { glow, mat } from '../carscene/kit.ts';
import {
  MachineLook,
  bedPart,
  bucket,
  clamp01,
  ease,
  lyingPart,
  mouldBlock,
  ownMesh,
  pelletFill,
  pelletHeap,
  pelletStream,
  span,
} from './brickworks.ts';
import type { Job, MachineEvent } from './brickworks.ts';
import { brickMaterial } from './bricks.ts';

/**
 * The brick works' machines drawn with the car scene's models (see `carscene/machines.ts`), on
 * the levels laid out with its scenery, working as the game's own do (`MachineView`): the same
 * events and state played out on the car models' own moving parts. A player putting something
 * in sees it go in (a mould slid into the press between its platens, pellets poured into its
 * hopper under its lid, a part laid on the printer's bed, a mould handed back into the vendor's
 * hatch); starting a machine presses its green button in, lit; while it works its progress bar
 * fills and it does its thing (the press's clamp shuts and its heater bands glow as it injects,
 * then opens to drop the part down its chute; the silo's valve opens and its auger turns as the
 * pellets pour; the vendor's picker fetches the mould off a shelf; the printer's gantry and head
 * sweep the bed in UV light); and what it makes comes out where the game has it waiting (see
 * `outputSlots`), the hatch's flap or the bay's guard swinging as it lands and as it is taken.
 * Without power its lights go dim and it does nothing; jammed, its button glows red.
 */

/** How much of their glow the machines' lights keep without power. */
const UNPOWERED_GLOW = 0.08;
/** The red a jammed machine's button glows. */
const JAMMED = 0xff2a20;
/** How far a start button goes in as it is pressed. */
const PUSH = 0.008;
/** How long a start button takes to go in and come out again, in seconds. */
const PRESS_TIME = 0.28;
/** How far the moulding machine's hopper lid swings up to open. */
const LID_OPEN = 1.6;
/** How far the vendor's flap swings out as a mould is taken, beyond where it rests. */
const FLAP_OPEN = 1.2;
/** How far the press's bay guard swings out as a part is taken. */
const GUARD_OPEN = 0.9;
/** How big the vendor's picker carries a mould, to its size in the hatch. */
const PICKED = 0.3;

/** Where everything that moves is posed this frame, made up anew each frame from the jobs. */
interface Pose {
  /** How far the start button is in (0 out, 1 in) and how brightly lit (0 to 1). */
  button: number;
  buttonLit: number;
  /** How full the progress bar is, or null to hide it. */
  progress: number | null;
  /** How much brighter than at rest the screen glows (a flicker as it works). */
  screen: number;
  /** How much brighter the lit strips glow. */
  strip: number;
  /** The press's clamp, how far open (0 to 1), and how it shudders. */
  clamp: number;
  shake: number;
  /** The press's safety door, how far open; its hopper lid; its bay's guard. */
  door: number;
  lid: number;
  guard: number;
  /** How far out of its place the press's mould is, sliding in (0 home, 1 out at the front). */
  mouldOut: number;
  /** How much the press's heater bands glow over their rest (0 to 1). */
  heat: number;
  /** Which of the stack light's lamps flashes, or -1 for them as the machine's state has them. */
  flash: number;
  /** The silo's valve, how far it is turned open; its auger, how far it has turned. */
  valve: number;
  auger: number;
  /** The vendor's flap, how far it swings out beyond its rest. */
  flap: number;
  /** The vendor's picker: where along its rail, and how far its arm reaches down. */
  picker: { x: number; reach: number } | null;
  /** The printer's gantry, how far forward of its parking place, and its head, where across. */
  gantry: { z: number; x: number } | null;
  /** How brightly the printer's UV lamp shines over its rest. */
  uv: number;
  /** How brightly the light by the output area shines (0 to 1), something waiting there. */
  outLight: number;
}

function restPose(): Pose {
  return {
    button: 0,
    buttonLit: 0,
    progress: null,
    screen: 0,
    strip: 0,
    clamp: 0,
    shake: 0,
    door: 0,
    lid: 0,
    guard: 0,
    mouldOut: 0,
    heat: 0,
    flash: -1,
    valve: 0,
    auger: 0,
    flap: 0,
    picker: null,
    gantry: null,
    uv: 0,
    outLight: 0,
  };
}

/** A lit material of this machine's own, and how brightly it glows at rest. */
interface Glow {
  material: THREE.MeshStandardMaterial;
  rest: number;
}

/** A start button pressed and released, `t` seconds after it was: how far in it is. */
function pushed(t: number): number {
  return span(t, 0, PRESS_TIME * 0.3) - span(t, PRESS_TIME * 0.6, PRESS_TIME);
}

export class CarMachineView extends MachineLook {
  private readonly model: THREE.Object3D;
  /** Every lit material of the model, its own (so this machine's lights go on and off alone). */
  private readonly glows: Glow[] = [];
  /** The lit materials of the meshes so named, the model's own (see `glows`). */
  private readonly lit = new Map<string, Glow[]>();
  /** The start button's cap's paint, the model's own: green, or red while jammed. */
  private readonly cap: THREE.MeshStandardMaterial | null = null;
  /** The press's stack light's lamps, and which of them its state lights. */
  private readonly lamps: THREE.Mesh[] = [];
  private lampsLit = [false, false, false];
  /** This frame's pose, made up as the jobs are posed (see `tick`). */
  private pose = restPose();
  /** Whether something waits in its output area, or is on its way there. */
  private waits = false;
  /** Whether a part is being laid on the printer's bed: drawn by its job, not as it lies. */
  private laying = false;
  /** Where the start button stands at rest, along its face's outward line. */
  private readonly buttonRest: number;
  /** When it was last moved on to (see `tick`), in seconds: when what its state says happens. */
  private now = 0;
  /** The model's parts that move, by name (see `part`). */
  private readonly parts = new Map<string, THREE.Object3D | undefined>();

  /**
   * The car model of `def`'s kind, standing where `def` says and turned its way, on its pad
   * (unless `pad` is false), its still parts baked together; or `model`, the scene's own model of
   * it, as it stands, to work as it is (car-test.html's).
   */
  constructor(def: MachineDef, model?: THREE.Object3D, pad = true) {
    super(def, (model as THREE.Group | undefined) ?? new THREE.Group());
    if (model) {
      // Worked by one view at a time: whatever an earlier one drew in it goes.
      this.model = model;
      for (const old of model.children.filter((o) => o.name === 'fx' || o.name === 'contents'))
        old.removeFromParent();
    } else {
      this.group.name = def.kind;
      this.group.position.set(def.pos.x, def.pos.y, def.pos.z);
      this.group.rotation.y = def.facing;
      this.model = MACHINE_MODELS[def.kind]();
      this.group.add(this.model);
      if (pad) {
        // Sunk into the ground all but a centimetre, so that players stand on it as on the
        // ground round it.
        const p = machinePad(def.size);
        p.position.y = PAD_RISE - PAD;
        this.group.add(p);
      }
    }
    // Its lights its own, so they go on and off with it alone.
    const owned = new Map<THREE.Material, Glow>();
    this.model.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || /^lamp\d$/.test(o.name)) return;
      const m = o.material as THREE.MeshStandardMaterial;
      if (!m.emissive || (m.emissive.getHex() === 0 && o.name !== 'buttonCap')) return;
      let own = owned.get(m);
      if (!own) {
        // (Its glow at rest kept with it, should another view take the model over.)
        const rest = (m.userData.glowRest as number | undefined) ?? m.emissiveIntensity;
        own = { material: m.clone(), rest };
        own.material.userData.glowRest = rest;
        owned.set(m, own);
        this.glows.push(own);
      }
      o.material = own.material;
      if (!o.name) return;
      const list = this.lit.get(o.name) ?? [];
      if (!list.includes(own)) list.push(own);
      this.lit.set(o.name, list);
    });
    this.cap = this.lit.get('buttonCap')?.[0]?.material ?? null;
    const button = this.model.getObjectByName('button');
    this.buttonRest = button
      ? ((button.userData.rest as number | undefined) ?? button.position.z)
      : 0;
    if (button) button.userData.rest = this.buttonRest;
    for (let i = 0; i < 3; i++) {
      const lamp = this.model.getObjectByName(`lamp${i}`);
      if (lamp instanceof THREE.Mesh) this.lamps.push(lamp);
    }
    // What the model shows for itself that the game draws as it is: the press's pellets, and
    // the silo's stack of buckets (the game's own buckets, as are the ones it fills).
    const pellets = this.model.getObjectByName('pellets');
    if (pellets) pellets.visible = false;
    const stack = this.model.getObjectByName('stack');
    if (stack) {
      stack.clear();
      for (let i = 0; i < 3; i++) {
        const b = bucket(null);
        b.position.set(SILO.stack.x, 0.002 + i * STACK_STEP, SILO.stack.z);
        stack.add(b);
      }
    }
    // A draw call per material for what stays still; the scene's own model is baked with it.
    if (!model) batchStatic(this.model, (o) => LIVE_PARTS.includes(o.name));
    this.addLayers();
    this.apply();
  }

  /** The model's part named `name`, if it has one (each found once). */
  private part(name: string): THREE.Object3D | undefined {
    if (!this.parts.has(name)) this.parts.set(name, this.model.getObjectByName(name));
    return this.parts.get(name);
  }

  // -- What it shows of its state --

  protected contents(m: MachineState, svgs: Record<string, string>, powered: boolean): void {
    const kind = this.def.kind;
    if (kind === 'press') this.pressContents(m, powered);
    if (kind === 'printer' && m.part && !this.laying)
      this.dynamic.add(bedPart(m.part, svgs, this.bedRoom()));
    this.apply();
  }

  protected override waiting(m: MachineState, busy: Set<number | undefined>): void {
    this.waits = m.out.some((x) => x !== null) || [...busy].some((s) => s !== undefined);
  }

  private pressContents(m: MachineState, powered: boolean): void {
    const ready =
      !!m.mould &&
      !!m.colour &&
      m.shots > 0 &&
      !m.jammed &&
      m.out.some((x, i) => x === null && m.making?.slot !== i);
    const half = !ready && !m.jammed && (!!m.mould || (!!m.colour && m.shots > 0));
    // Without power the stack light is dark; jammed, it shows red.
    this.lampsLit = powered ? [ready, half, !ready && !half] : [false, false, false];
    const mould = this.part('mould');
    if (mould) mould.visible = !!m.mould;
    if (m.colour && m.shots > 0) this.dynamic.add(hopperPellets(m.colour, m.shots));
  }

  /** Something taken out of its output area shows it go (see `takenJob`). */
  protected override changed(was: MachineState | null, m: MachineState): void {
    if (!was) return;
    const taken = was.out.some((x, i) => x !== null && m.out[i] === null);
    if (taken) this.start(this.takenJob(), this.now);
  }

  // -- What it does --

  protected jobFor(e: MachineEvent, slot: number): Omit<Job, 'start'> | null {
    const kind = this.def.kind;
    if (kind === 'silo' && e.kind === 'fill' && e.colour) return this.fillJob(e.colour, slot);
    if (kind === 'dispenser' && e.kind === 'dispense' && e.mould)
      return this.dispenseJob(e.mould, slot);
    if (kind === 'dispenser' && e.kind === 'toolDown') return this.returnJob(e.mould ?? '2x4');
    if (kind === 'press' && e.kind === 'mouldIn') return this.mouldInJob();
    if (kind === 'press' && e.kind === 'pour' && e.colour) return this.pourJob(e.colour);
    if (kind === 'press' && e.kind === 'moulded' && e.mould && e.colour)
      return this.mouldJob(e.mould, e.colour, slot);
    if (kind === 'printer' && e.kind === 'printerIn') return this.layJob();
    if (kind === 'printer' && e.kind === 'print') return this.printJob();
    return null;
  }

  override tick(now: number): void {
    this.now = now;
    this.pose = restPose();
    super.tick(now);
    this.apply();
  }

  protected override idle(now: number): void {
    // Making something with no job showing it (its event missed, or the game joined while it
    // was under way): it works on by itself until it is done.
    const m = this.last?.m;
    if (!m?.making || this.showing(m.making.slot)) return;
    if (!this.last!.powered || m.jammed) return;
    const p = this.pose;
    p.buttonLit = 1;
    p.progress = (now * 0.5) % 1;
    p.screen = 0.3 * Math.sin(now * 30);
    p.strip = 0.5 + 0.5 * Math.sin(now * 12);
    p.heat = 0.8;
    p.auger = now * 9;
    p.valve = 1;
    p.flash = Math.floor(now * 6) % 2 ? 1 : 0;
  }

  /** Has the start button pressed `t` seconds into a job, and lit while it works till `end`. */
  private started(t: number, end: number): void {
    const p = this.pose;
    p.button = Math.max(p.button, pushed(t));
    p.buttonLit = Math.max(p.buttonLit, span(t, 0, 0.06) - span(t, end - 0.1, end));
  }

  /** Fills the progress bar from `a` to `b` seconds in, `t` seconds in. */
  private progress(t: number, a: number, b: number): void {
    this.pose.progress = t >= a && t < b + 0.15 ? span(t, a, b) : this.pose.progress;
  }

  // -- The silo --

  /**
   * Fills a bucket: the button is pressed, an empty one comes off the stack onto the grate, the
   * valve turns on and the auger turns as the pellets pour in until it is full, and the valve
   * turns off, leaving it full on the grate for someone to take.
   */
  private fillJob(colour: ColourId, slot: number): Omit<Job, 'start'> {
    const group = this.jobGroup();
    const pail = bucket(null);
    group.add(pail);
    const grate = this.restAt(slot);
    const stack = new THREE.Vector3(SILO.stack.x, 0.002 + 3 * STACK_STEP, SILO.stack.z);
    // Before the grate, a little over it, clear of the spout.
    const before = grate.clone().add(new THREE.Vector3(0, 0.008, 0.24));
    const fill = pelletFill(pail, colour);
    const spout = new THREE.Vector3(0, SILO.spout.y, SILO.spout.z);
    const stream = pelletStream(group, colour, spout, grate.y + 0.05);
    const length = MAKE_SECONDS.bucket;
    return {
      length,
      slot,
      group,
      step: (t) => {
        this.started(t, length);
        const p = this.pose;
        // Lifted off the stack and over to before the grate, then slid in under the spout.
        const over = ease(span(t, 0.08, 0.36));
        if (over < 1) {
          pail.position.lerpVectors(stack, before, over);
          pail.position.y += Math.sin(over * Math.PI) * 0.15;
        } else pail.position.lerpVectors(before, grate, ease(span(t, 0.36, 0.5)));
        fill(span(t, 0.55, 1.6));
        stream(t >= 0.5 && t < 1.6 ? t : null);
        p.valve = Math.max(p.valve, ease(span(t, 0.35, 0.55)) - ease(span(t, 1.55, 1.75)));
        // The auger turns faster as it gets going, and slows to a stop.
        const run = span(t, 0.45, 0.7) - span(t, 1.45, 1.65);
        p.auger += run * t * 14;
        p.strip = Math.max(p.strip, run * (0.6 + 0.4 * Math.sin(t * 14)));
        p.outLight = Math.max(p.outLight, span(t, 1.6, 1.8));
      },
      end: () => {},
    };
  }

  // -- The mould vendor --

  /** The shelf and the column on it the vendor's picker fetches a mould for `type` from. */
  private shelfOf(type: BrickTypeId): { y: number; x: number } {
    const i = Math.max(0, MOULD_TYPES.indexOf(type));
    return { y: VENDOR.shelf(i % 3), x: VENDOR.column(Math.floor(i / 3) % 3) };
  }

  /**
   * Dispenses a mould: the green key is pressed, the screen flickers as the picker runs along
   * its rail to the mould's shelf, reaches down and takes it, and carries it back up and over to
   * the column, and the mould drops into the hatch, the flap swinging as it lands and the lamp
   * over it lighting, for someone to take it.
   */
  private dispenseJob(type: BrickTypeId, slot: number): Omit<Job, 'start'> {
    const group = this.jobGroup();
    const { picker } = VENDOR;
    const at = this.shelfOf(type);
    // Down to just over the moulds' tops on the shelf, which lean back off it.
    const reach = picker.y - (at.y + 0.26);
    // Carried standing in its grip, its cavity out to the window.
    const carried = mouldBlock(type);
    carried.scale.setScalar(PICKED);
    carried.rotation.x = Math.PI / 2;
    const held = new THREE.Group();
    held.add(carried);
    carried.position.set(0, 0, (-0.4 * PICKED) / 2);
    group.add(held);
    const mould = mouldBlock(type);
    mould.scale.setScalar(HATCH_MOULD_SCALE);
    group.add(mould);
    const hatch = this.restAt(slot);
    const top = hatch.clone().add(new THREE.Vector3(0, 0.26, 0));
    const length = MAKE_SECONDS.mould;
    return {
      length,
      slot,
      group,
      step: (t) => {
        this.started(t, 1.2);
        this.progress(t, 0, 1.3);
        const p = this.pose;
        p.screen = Math.max(p.screen, t > 0.1 && t < 1.05 ? 0.4 * Math.sin(t * 40) : 0);
        const out = ease(span(t, 0.08, 0.4)) - ease(span(t, 0.8, 1.05));
        const down = ease(span(t, 0.4, 0.58)) - ease(span(t, 0.62, 0.8));
        const x = picker.park + (at.x - picker.park) * out;
        p.picker = { x, reach: picker.reach + (reach - picker.reach) * down };
        // Taken at the bottom of its reach, and gone into the column at the end of the rail.
        held.visible = t >= 0.6 && t < 1.05;
        held.position.set(x, picker.y - p.picker.reach - 0.045 - 0.4 * PICKED * 0.5, picker.z);
        p.strip = Math.max(p.strip, out * 0.5);
        const drop = span(t, 1.05, 1.3);
        mould.visible = t >= 1.05;
        mould.position.lerpVectors(top, hatch, drop * drop);
        mould.position.y +=
          t < 1.5 ? Math.max(0, Math.sin(span(t, 1.3, 1.5) * Math.PI)) * 0.025 : 0;
        p.flap = Math.max(p.flap, 0.25 * Math.sin(span(t, 1.28, 1.55) * Math.PI));
        p.outLight = Math.max(p.outLight, t >= 1.3 ? 1 : 0);
      },
      end: () => {},
    };
  }

  /**
   * Takes a mould back: the flap swings out, the mould is pushed in through the hatch and the
   * flap falls back, and the mould slides away into the cabinet out of sight.
   */
  private returnJob(type: BrickTypeId): Omit<Job, 'start'> {
    const group = this.jobGroup();
    const mould = mouldBlock(type);
    mould.scale.setScalar(HATCH_MOULD_SCALE);
    group.add(mould);
    const hatch = this.restAt(0);
    const from = hatch.clone().add(new THREE.Vector3(0, 0.03, 0.4));
    const away = hatch.clone().add(new THREE.Vector3(0, 0, -0.1));
    return {
      length: 1,
      group,
      step: (t) => {
        this.pose.flap = Math.max(this.pose.flap, ease(span(t, 0, 0.2)) - ease(span(t, 0.45, 0.7)));
        if (t < 0.5) mould.position.lerpVectors(from, hatch, ease(span(t, 0.1, 0.45)));
        else mould.position.lerpVectors(hatch, away, ease(span(t, 0.55, 0.85)));
        mould.visible = t < 0.85;
      },
      end: () => {},
    };
  }

  // -- The brick press --

  /**
   * Puts a mould in: the safety door slides aside, the clamp opens, the mould slides in between
   * the platens and the clamp shuts on it, and the door shuts.
   */
  private mouldInJob(): Omit<Job, 'start'> {
    return {
      length: 1.5,
      group: this.jobGroup(),
      step: (t) => {
        const p = this.pose;
        p.door = Math.max(p.door, span(t, 0, 0.3) - span(t, 1.15, 1.5));
        p.clamp = Math.max(p.clamp, span(t, 0, 0.3) - span(t, 0.95, 1.15));
        p.mouldOut = Math.max(p.mouldOut, 1 - ease(span(t, 0.25, 0.95)));
      },
      end: () => {},
    };
  }

  /** Pours pellets in: the hopper's lid swings up, a bucket tips over it and empties in. */
  private pourJob(colour: ColourId): Omit<Job, 'start'> {
    const { x: hx, y: hy } = PRESS.hopper;
    const z = PRESS.axis.z;
    const rim = hy + 0.5;
    const group = this.jobGroup();
    const pail = bucket(colour);
    group.add(pail);
    const lip = new THREE.Vector3(hx + 0.05, rim + 0.14, z);
    const stream = pelletStream(group, colour, lip, hy + 0.3);
    return {
      length: 1.5,
      group,
      step: (t) => {
        this.pose.lid = Math.max(this.pose.lid, ease(span(t, 0, 0.25)) - ease(span(t, 1.15, 1.45)));
        // From beside the hopper, tipped toward it, then put down out of the way.
        const tip = ease(span(t, 0.15, 0.45)) - ease(span(t, 1.05, 1.35));
        pail.position.set(hx + 0.32 - 0.08 * tip, rim + 0.1 + 0.08 * tip, z);
        pail.rotation.z = 1.9 * tip;
        pail.scale.setScalar(Math.max(0.001, 1 - span(t, 1.2, 1.4)));
        stream(t >= 0.4 && t < 1.05 ? t : null);
      },
      end: () => {},
    };
  }

  /**
   * Moulds a part: the green button is pressed; the clamp shuts tight and shudders, the heater
   * bands glow while the plastic goes in, and the progress bar fills; the clamp opens and the
   * part drops from between the mould's halves into the chute under it, out of which it falls
   * into its place in the bay in the bed's front, the guard swinging as it lands, to wait there
   * to be taken.
   */
  private mouldJob(type: BrickTypeId, colour: ColourId, slot: number): Omit<Job, 'start'> {
    const { mx, axis, bed, bay } = PRESS;
    const group = this.jobGroup();
    const part = lyingPart(type, colour);
    const turned = part.children[0]!;
    const half = turned.position.y;
    group.add(part);
    // From against the fixed half's face, once the clamp is open, down through the gap.
    const face = mx - 0.04;
    const rest = this.restAt(slot);
    const length = MAKE_SECONDS.part;
    return {
      length,
      slot,
      group,
      step: (t) => {
        this.started(t, 2.3);
        this.progress(t, 0, 2.2);
        const p = this.pose;
        // A shudder while it injects; open to let the part go; shut again.
        p.shake = t > 0.25 && t < 0.9 ? Math.sin(t * 90) * 0.002 : 0;
        p.clamp = Math.max(p.clamp, span(t, 1.0, 1.2) - span(t, 2.0, 2.3));
        p.heat = Math.max(p.heat, span(t, 0.15, 0.4) - span(t, 0.9, 1.6));
        p.flash = Math.floor(t * 6) % 2 ? 1 : 0;
        p.guard = Math.max(p.guard, 0.18 * Math.sin(span(t, 1.9, 2.25) * Math.PI));
        p.outLight = Math.max(p.outLight, span(t, 1.9, 2.1));
        part.visible = t >= 1.15 && (t < 1.5 || t >= 1.75);
        if (t < 1.75) {
          // Standing on edge against the face, then falling and turning flat as it goes.
          const fall = span(t, 1.25, 1.5);
          part.position.set(face, axis.y - half - (axis.y - bed.y1) * fall * fall, axis.z);
          turned.rotation.set(0, 0, (Math.PI / 2) * (1 - fall));
        } else {
          // Out of the bay's ceiling, landing flat with a little bounce, and at rest.
          const fall = span(t, 1.75, 1.95);
          const bounce = t < 2.15 ? Math.sin(span(t, 1.95, 2.15) * Math.PI) * 0.012 : 0;
          part.position.copy(rest);
          part.position.y += (1 - fall * fall) * (bay.y1 - half - rest.y) + bounce;
          turned.rotation.set(0.35 * (1 - fall), 0, 0.25 * (1 - fall));
        }
      },
      end: () => {},
    };
  }

  // -- The UV printer --

  /** Lays a part on the bed: it comes down onto it, and the gantry runs over it to find it. */
  private layJob(): Omit<Job, 'start'> {
    const group = this.jobGroup();
    this.laying = true;
    const { bed, gantry } = PRINTER;
    const lay = new THREE.Group();
    group.add(lay);
    const on = new THREE.Vector3(bed.part.x, bed.y + 0.006, bed.part.z);
    const from = on.clone().add(new THREE.Vector3(0, 0.22, 0.35));
    if (this.last) this.rebuild();
    return {
      length: 1.2,
      group,
      step: (t) => {
        // The part as the machine's state has it, once it does (it may say so a moment after).
        const part = this.last?.m.part;
        if (part && !lay.children.length)
          lay.add(bedPart(part, this.last!.svgs, { ...this.bedRoom(), top: 0, x: 0, z: 0 }));
        const down = ease(span(t, 0, 0.45));
        lay.position.lerpVectors(from, on, down);
        lay.position.y += Math.sin(down * Math.PI) * 0.05;
        const scan = Math.sin(span(t, 0.5, 1.2) * Math.PI);
        this.pose.gantry = { z: gantry.reach * 0.7 * scan, x: gantry.park };
        this.pose.uv = Math.max(this.pose.uv, -0.6 * scan);
      },
      end: () => {
        this.laying = false;
        if (this.last) this.rebuild();
      },
    };
  }

  /** Where a part lies on the printer's bed, and how much room it has there. */
  private bedRoom() {
    const { bed } = PRINTER;
    return {
      top: bed.y + 0.006,
      x: bed.part.x,
      z: bed.part.z,
      w: bed.x1 - bed.x0 - 0.1,
      d: bed.z1 - bed.z0 - 0.1,
      room: 0.1,
    };
  }

  /**
   * Prints: the green button is pressed, and the gantry runs forward over the bed and back, its
   * head sweeping across it to and fro under its UV lamp, glowing bright, the progress bar filling.
   */
  private printJob(): Omit<Job, 'start'> {
    const { gantry, bed } = PRINTER;
    const across = (bed.x1 - bed.x0) / 2 - 0.12;
    return {
      length: 1.6,
      lane: 'print',
      group: this.jobGroup(),
      step: (t) => {
        this.started(t, 1.5);
        this.progress(t, 0.1, 1.4);
        const run = span(t, 0.2, 1.3);
        const z = gantry.reach * ease(run) * (1 - ease(span(t, 1.3, 1.55)));
        const x =
          t < 0.3
            ? gantry.park + (-across - gantry.park) * ease(span(t, 0, 0.3))
            : t < 1.3
              ? -across * Math.cos((t - 0.3) * Math.PI * 4)
              : gantry.park + (-across - gantry.park) * (1 - ease(span(t, 1.3, 1.55)));
        this.pose.gantry = { z, x };
        this.pose.uv = Math.max(this.pose.uv, 1.5 * (span(t, 0.25, 0.35) - span(t, 1.25, 1.35)));
      },
      end: () => {},
    };
  }

  // -- Taken out --

  /**
   * What it made taken out of it: the vendor's flap swings up out of the way and falls back, the
   * press's bay guard likewise; the light by the silo's grate blinks.
   */
  private takenJob(): Omit<Job, 'start'> {
    return {
      length: 0.6,
      lane: 'out',
      group: this.jobGroup(),
      step: (t) => {
        const p = this.pose;
        const up = ease(span(t, 0, 0.15)) - ease(span(t, 0.25, 0.6));
        p.flap = Math.max(p.flap, up);
        p.guard = Math.max(p.guard, up);
        p.outLight = Math.max(p.outLight, t < 0.3 ? (Math.floor(t * 20) % 2 ? 1 : 0) : 0);
      },
      end: () => {},
    };
  }

  // -- Posing it --

  /** Poses every moving part, and lights every light, as this frame's pose says. */
  private apply(): void {
    const p = this.pose;
    const powered = this.last?.powered ?? true;
    const jammed = this.last?.m.jammed ?? false;
    const name = (n: string) => this.part(n);
    const button = name('button');
    if (button) button.position.z = this.buttonRest - PUSH * p.button;
    const bar = name('progress');
    if (bar) {
      bar.visible = p.progress !== null && powered;
      bar.scale.x = Math.max(0.001, p.progress ?? 0);
    }
    // The press.
    const { open, door } = PRESS;
    const clamp = name('clamp');
    const opened = -open * ease(clamp01(p.clamp)) + p.shake;
    if (clamp) clamp.position.x = opened;
    const half = name('mouldA');
    if (half) half.position.x = opened;
    const mould = name('mould');
    if (mould) mould.position.set(0, 0.12 * p.mouldOut, 0.5 * p.mouldOut);
    const safety = name('safetyDoor');
    if (safety) safety.position.x = door.slide * ease(clamp01(p.door));
    const lid = name('lid');
    if (lid) lid.rotation.x = -LID_OPEN * clamp01(p.lid);
    const guard = name('bayFlap');
    if (guard) guard.rotation.x = -GUARD_OPEN * clamp01(p.guard);
    // The silo.
    const valve = name('valve');
    if (valve) valve.rotation.y = 1.6 * ease(clamp01(p.valve));
    const auger = name('auger');
    if (auger) auger.rotation.z = p.auger;
    // The vendor.
    const flap = name('flap');
    if (flap) flap.rotation.x = FLAP_REST - FLAP_OPEN * p.flap;
    const picker = name('picker');
    if (picker) {
      const { park, reach } = VENDOR.picker;
      const at = p.picker ?? { x: park, reach };
      picker.position.x = at.x;
      const arm = name('arm');
      const grip = name('grip');
      if (arm) arm.scale.y = at.reach;
      if (grip) grip.position.y = -at.reach;
    }
    // The printer.
    const rig = name('gantry');
    if (rig) {
      const { z, park } = PRINTER.gantry;
      const at = p.gantry ?? { z: 0, x: park };
      rig.position.z = z + at.z;
      const head = name('head');
      if (head) head.position.x = at.x;
      const beam = name('uvBeam');
      if (beam) beam.visible = p.uv > 0.3 && powered;
    }
    // The lights: dim all over without power; the button red while jammed.
    const k = powered ? 1 : UNPOWERED_GLOW;
    for (const g of this.glows) g.material.emissiveIntensity = g.rest * k;
    const boost = (n: string, by: number) => {
      for (const g of this.lit.get(n) ?? []) g.material.emissiveIntensity = g.rest * k * (1 + by);
    };
    boost('screen', p.screen + (this.waits && this.def.kind === 'dispenser' ? 0.5 : 0));
    boost('strip', p.strip);
    boost('heat', p.heat * 1.2 - 0.6);
    boost('uv', p.uv);
    const out = Math.max(p.outLight, this.waits ? 1 : 0);
    boost('hatchLamp', -1 + out);
    boost('outLight', out * 2);
    if (this.cap) {
      this.cap.emissive.setHex(jammed ? JAMMED : BUTTON_GREEN);
      this.cap.emissiveIntensity = jammed ? 1.6 * k : 2.2 * k * clamp01(p.buttonLit);
    }
    STACK_LAMPS.forEach((colour, i) => {
      const lamp = this.lamps[i];
      if (!lamp) return;
      const on = powered && (p.flash >= 0 ? i === p.flash : this.lampsLit[i]!);
      lamp.material = on ? glow(colour, 2.4) : DIM_LAMPS[i]!;
    });
  }
}

/** How far apart the silo's empty buckets stack. */
const STACK_STEP = 0.04;
/** How far the pad stands up out of the ground under a car machine. */
const PAD_RISE = 0.012;
/** How big a mould is in the vendor's hatch, to its size in a player's hands (see `madeModel`). */
const HATCH_MOULD_SCALE = 0.5;

/** The stack light's lamps unlit: their glass dull. */
const DIM_LAMPS = STACK_LAMPS.map((c) =>
  mat(c, { mottle: 'none', roughness: 0.3, transparent: true, opacity: 0.6 }),
);

/**
 * Pellets of `colour` in the press's clear hopper, from its narrow foot up as far as there are
 * `shots` left in them, heaped on top.
 */
function hopperPellets(colour: ColourId, shots: number): THREE.Group {
  const { x: hx, y: hy } = PRESS.hopper;
  const f = Math.min(1, shots / BUCKET_SHOTS);
  // The hopper's cone from hy + 0.05 (6 cm across) up to hy + 0.25 (17 cm), its drum on up to
  // hy + 0.49: the pellets a little inside them.
  const [cone0, cone1, top] = [hy + 0.07, hy + 0.25, hy + 0.46];
  const rCone = (y: number) => 0.06 + ((y - (hy + 0.05)) / 0.2) * 0.11 - 0.008;
  const r = 0.17 - 0.008;
  const level = cone0 + f * (top - cone0);
  const plastic = brickMaterial(colour);
  const g = new THREE.Group();
  g.position.set(hx, 0, PRESS.axis.z);
  const coneTop = Math.min(level, cone1);
  g.add(
    ownMesh(
      new THREE.CylinderGeometry(rCone(coneTop), rCone(cone0), coneTop - cone0, 20),
      plastic,
      (cone0 + coneTop) / 2,
    ),
  );
  if (level > cone1)
    g.add(
      ownMesh(new THREE.CylinderGeometry(r, r, level - cone1, 20), plastic, (cone1 + level) / 2),
    );
  const heap = new THREE.Mesh(pelletHeap(level > cone1 ? r : rCone(coneTop)), plastic);
  heap.position.y = level;
  g.add(heap);
  return g;
}
