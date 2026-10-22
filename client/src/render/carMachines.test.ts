import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUCKET_SHOTS, MACHINE_SIZE, MAKE_SECONDS, OUTPUT_ROOM, outputSlots } from '@sar/shared';
import type { MachineDef, MachineKind, MachineState, Made, OutputSlot } from '@sar/shared';
import { MACHINE_MODELS } from '../carscene/machines.ts';
import type { MachineEvent } from './brickworks.ts';
import { CarMachineView } from './carMachines.ts';

beforeAll(() => {
  // The game's signs are drawn on canvases: a stand-in that draws nothing will do.
  const ctx = new Proxy({}, { get: () => () => ({ addColorStop() {}, width: 100 }) });
  Object.assign(globalThis, {
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) },
  });
});

const KINDS = Object.keys(MACHINE_SIZE) as MachineKind[];

/** A machine of a kind standing at the origin, facing +z: its own frame is the world's. */
const atOrigin = (kind: MachineKind): MachineDef => ({
  id: 1,
  kind,
  pos: { x: 0, y: 0, z: 0 },
  size: { ...MACHINE_SIZE[kind] },
  facing: 0,
});

/** What a machine of a kind leaves in a place in its output area. */
const made = (kind: MachineKind, slot: number): Made =>
  kind === 'silo'
    ? { kind: 'bucket', colour: 'yellow' }
    : kind === 'dispenser'
      ? { kind: 'mould', type: 'slope2x2' }
      : { kind: 'part', type: (['1x1', '2x2', 'round2x2'] as const)[slot % 3]!, colour: 'blue' };

const state = (def: MachineDef, full: boolean): MachineState => ({
  def,
  mould: full ? '2x4' : null,
  colour: full ? 'red' : null,
  shots: full ? BUCKET_SHOTS : 0,
  part: full ? { type: '2x4', colour: 'blue' } : null,
  jammed: false,
  fixer: null,
  progress: 0,
  out: Array.from({ length: OUTPUT_ROOM[def.kind] }, (_, i) => (full ? made(def.kind, i) : null)),
  making: null,
});

/** Where everything in a view is, as one list of numbers. */
function pose(view: CarMachineView): number[] {
  const out: number[] = [];
  view.group.updateMatrixWorld(true);
  view.group.traverse((o) => out.push(...o.matrixWorld.elements));
  return out;
}

/** The meshes in sight whose middles are in the box a click on a place lands in. */
function drawnIn(view: CarMachineView, place: OutputSlot): number {
  const { centre: c, half: h } = place;
  const box = new THREE.Box3(
    new THREE.Vector3(c.x - h.x, c.y - h.y, c.z - h.z),
    new THREE.Vector3(c.x + h.x, c.y + h.y, c.z + h.z),
  );
  view.group.updateMatrixWorld(true);
  let n = 0;
  view.group.traverseVisible((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (box.containsPoint(new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()))) n++;
  });
  return n;
}

/** The named part of a view's model. */
const part = (view: CarMachineView, name: string) => view.group.getObjectByName(name)!;

describe('the car-style brick works', { timeout: 60_000 }, () => {
  it('has its output areas where the game has them', () => {
    for (const kind of KINDS) {
      const model = MACHINE_MODELS[kind]();
      model.updateMatrixWorld(true);
      outputSlots(kind, MACHINE_SIZE[kind]).forEach((slot, i) => {
        const at = model.getObjectByName(`out${i}`)!.getWorldPosition(new THREE.Vector3());
        expect(
          at.distanceTo(new THREE.Vector3(slot.rest.x, slot.rest.y, slot.rest.z)),
          kind,
        ).toBeCloseTo(0);
      });
      expect(model.getObjectByName(`out${OUTPUT_ROOM[kind]}`)).toBeUndefined();
    }
  });

  it('keeps each machine inside its box, bar what stands proud of it', () => {
    for (const kind of KINDS) {
      const def = atOrigin(kind);
      const view = new CarMachineView(def, undefined, false);
      view.update(state(def, true), {});
      const b = new THREE.Box3().setFromObject(view.group, true);
      const { x, y, z } = def.size;
      expect(b.min.y, kind).toBeGreaterThan(-0.001);
      expect(b.max.y, kind).toBeLessThan(y + 0.25);
      expect(b.max.x - b.min.x, kind).toBeLessThan(x + 0.12);
      // Nothing out past its front, where players stand, but a lip of a centimetre or two (and
      // over their heads the bricks on the vendor's sign, standing on its ledge).
      expect(b.max.z, kind).toBeLessThan(z / 2 + (kind === 'dispenser' ? 0.075 : 0.03));
      expect(b.min.z, kind).toBeGreaterThan(-z / 2 - 0.04);
    }
  });

  it('stands where the game has it, turned its way, on a pad sunk all but a centimetre', () => {
    const def = { ...atOrigin('press'), pos: { x: 3, y: 0, z: -2 }, facing: Math.PI / 2 };
    const view = new CarMachineView(def);
    view.group.updateMatrixWorld(true);
    const at = view.group.getObjectByName('out1')!.getWorldPosition(new THREE.Vector3());
    const rest = outputSlots('press', def.size)[1]!.rest;
    // A quarter turn takes its +z to +x.
    expect(at.x).toBeCloseTo(3 + rest.z, 6);
    expect(at.z).toBeCloseTo(-2 - rest.x, 6);
    const pad = new THREE.Box3().setFromObject(view.group.getObjectByName('pad')!);
    expect(pad.max.y).toBeGreaterThan(0.005);
    expect(pad.max.y).toBeLessThan(0.02);
  });

  it('shows what waits in each place in its output area, and what is in it', () => {
    for (const kind of ['silo', 'dispenser', 'press'] as const) {
      const def = atOrigin(kind);
      const view = new CarMachineView(def);
      const empty = state(def, false);
      view.update(empty, {});
      const places = outputSlots(kind, def.size);
      const bare = places.map((p) => drawnIn(view, p));
      view.update({ ...empty, out: empty.out.map((_, i) => made(kind, i)) }, {});
      places.forEach((p, i) => expect(drawnIn(view, p), `${kind} ${i}`).toBeGreaterThan(bare[i]!));
      expect(view.outItems().map((o) => o.userData.slot)).toEqual(places.map((_, i) => i));
    }
    const press = new CarMachineView(atOrigin('press'));
    press.update(state(press['def'], false), {});
    expect(part(press, 'mould').visible).toBe(false);
    press.update(state(press['def'], true), {});
    expect(part(press, 'mould').visible).toBe(true);
    const printer = new CarMachineView(atOrigin('printer'));
    printer.update(state(printer['def'], false), {});
    const before = printer.group.getObjectByName('contents')!.children.length;
    printer.update(state(printer['def'], true), {});
    expect(printer.group.getObjectByName('contents')!.children.length).toBe(before + 1);
  });

  it('shows each machine at work, its button pressed, and leaves it as it was', () => {
    const work: [MachineKind, MachineEvent, boolean][] = [
      ['silo', { kind: 'fill', colour: 'yellow', slot: 0 }, true],
      ['dispenser', { kind: 'dispense', mould: 'slope2x2', slot: 0 }, true],
      ['dispenser', { kind: 'toolDown' }, false],
      ['press', { kind: 'mouldIn', mould: '2x4' }, false],
      ['press', { kind: 'pour', colour: 'red' }, false],
      ['press', { kind: 'moulded', mould: '2x2', colour: 'blue', slot: 1 }, true],
      ['printer', { kind: 'printerIn' }, false],
      ['printer', { kind: 'print' }, true],
    ];
    for (const [kind, e, starts] of work) {
      const def = atOrigin(kind);
      const slot = e.slot ?? 0;
      const full = state(def, true);
      const without = { ...full, out: full.out.map((x, i) => (i === slot ? null : x)) };
      const making = { ...without, making: { made: made(kind, slot), slot, at: 0 } };
      const [before, after] = e.slot !== undefined ? [making, full] : [full, full];
      const view = new CarMachineView(def);
      view.update(before, {});
      const still = pose(view);
      const button = part(view, 'button');
      const rest = button.position.z;
      view.play(e, 10);
      expect(view.working, e.kind).toBe(true);
      let moved = false;
      let pressed = false;
      for (let t = 10; t < 13; t += 0.02) {
        view.tick(t);
        const now = pose(view);
        if (view.working && now.length !== still.length) moved = true;
        if (view.working && now.some((v, i) => Math.abs(v - still[i]!) > 1e-6)) moved = true;
        if (button.position.z < rest - 0.005) pressed = true;
      }
      expect(moved, e.kind).toBe(true);
      expect(pressed, e.kind).toBe(starts);
      expect(view.working, e.kind).toBe(false);
      // Once the machine says it is done, it is drawn just as one that had it all along.
      view.update(after, {});
      const fresh = new CarMachineView(def);
      fresh.update(after, {});
      expect(pose(view), e.kind).toEqual(pose(fresh));
    }
  });

  it('hands what it made over to its output area, never drawn twice or not at all', () => {
    const work: [MachineKind, MachineEvent][] = [
      ['silo', { kind: 'fill', colour: 'yellow', slot: 0 }],
      ['dispenser', { kind: 'dispense', mould: 'slope2x2', slot: 0 }],
      ['press', { kind: 'moulded', mould: '2x2', colour: 'blue', slot: 1 }],
    ];
    const length = { silo: MAKE_SECONDS.bucket, dispenser: MAKE_SECONDS.mould, press: 2.4 };
    for (const [kind, e] of work) {
      const def = atOrigin(kind);
      const slot = e.slot!;
      const place = outputSlots(kind, def.size)[slot]!;
      const empty = state(def, false);
      const making = { ...empty, making: { made: made(kind, slot), slot, at: 0 } };
      const done = {
        ...empty,
        out: empty.out.map((_, i) => (i === slot ? made(kind, slot) : null)),
      };
      const once = new CarMachineView(def);
      once.update(done, {});
      const drawn = drawnIn(once, place);
      const late = new CarMachineView(def);
      late.update(making, {});
      late.play(e, 0);
      late.tick(length[kind as keyof typeof length] - 0.01);
      expect(drawnIn(late, place), kind).toBe(drawn);
      late.tick(length[kind as keyof typeof length] + 0.5);
      late.update(done, {});
      expect(drawnIn(late, place), kind).toBe(drawn);
    }
  });

  it('swings the flap or guard over its output area as the hands take what waits there', () => {
    for (const [kind, name] of [
      ['dispenser', 'flap'],
      ['press', 'bayFlap'],
    ] as const) {
      const def = atOrigin(kind);
      const view = new CarMachineView(def);
      const full = state(def, true);
      view.update(full, {});
      view.tick(1);
      const shut = part(view, name).rotation.x;
      view.update({ ...full, out: full.out.map((x, i) => (i === 0 ? null : x)) }, {});
      // As the hands that took it take hold of it.
      view.release(0);
      view.tick(1.15);
      expect(part(view, name).rotation.x, kind).toBeLessThan(shut - 0.5);
      view.tick(2);
      expect(part(view, name).rotation.x, kind).toBeCloseTo(shut, 6);
    }
  });

  it('works by itself while it makes something no event showed it start', () => {
    const def = atOrigin('silo');
    const view = new CarMachineView(def);
    const empty = state(def, false);
    view.update({ ...empty, making: { made: made('silo', 0), slot: 0, at: 0 } }, {});
    view.tick(1);
    const a = part(view, 'auger').rotation.z;
    view.tick(1.2);
    expect(part(view, 'auger').rotation.z).not.toBe(a);
    // Without power, it stands still.
    view.update({ ...empty, making: { made: made('silo', 0), slot: 0, at: 0 } }, {}, false);
    view.tick(1.4);
    const b = part(view, 'auger').rotation.z;
    view.tick(1.6);
    expect(part(view, 'auger').rotation.z).toBe(b);
  });

  it('dims its lights without power, and lights its button red when jammed', () => {
    /** How brightly the machine's lit parts glow, all told. */
    const glowing = (view: CarMachineView) => {
      let k = 0;
      view.group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const m = o.material as THREE.MeshStandardMaterial;
          if (m.emissive && m.emissive.getHex() !== 0) k += m.emissiveIntensity;
        }
      });
      return k;
    };
    const def = atOrigin('press');
    const view = new CarMachineView(def);
    view.update(state(def, true), {});
    const on = glowing(view);
    view.update(state(def, true), {}, false);
    expect(glowing(view)).toBeLessThan(on * 0.2);
    view.update({ ...state(def, true), jammed: true }, {});
    const cap = (part(view, 'buttonCap') as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(cap.emissive.getHex()).toBe(0xff2a20);
    expect(cap.emissiveIntensity).toBeGreaterThan(0);
    // Each machine's lights its own: the other press's are as they were.
    const other = new CarMachineView({ ...def, id: 2 });
    other.update(state(def, true), {});
    expect(glowing(other)).toBeCloseTo(on, 6);
  });

  it('lights its stack light green only when it can mould a part', () => {
    const def = atOrigin('press');
    const lit = (m: MachineState) => {
      const view = new CarMachineView(def);
      view.update(m, {});
      return [0, 1, 2].filter((i) => {
        const q = (part(view, `lamp${i}`) as THREE.Mesh).material as THREE.MeshStandardMaterial;
        return q.emissiveIntensity > 0 && q.emissive.getHex() !== 0;
      });
    };
    const full = state(def, true);
    expect(lit({ ...full, out: [null, null, null] })).toEqual([0]);
    expect(lit(full)).toEqual([1]);
    expect(lit(state(def, false))).toEqual([2]);
    expect(lit({ ...full, jammed: true })).toEqual([2]);
  });
});
