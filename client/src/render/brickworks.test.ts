import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BUCKET_SHOTS,
  HOUSE,
  MACHINE_SIZE,
  MAKE_SECONDS,
  OUTPUT_ROOM,
  outputSlots,
} from '@sar/shared';
import type { MachineDef, MachineKind, MachineState, Made, OutputSlot } from '@sar/shared';
import { MachineView, makeHeldTool } from './brickworks.ts';

beforeAll(() => {
  // Signs are drawn on canvases: a stand-in that draws nothing will do.
  const ctx = new Proxy({}, { get: () => () => ({ addColorStop() {}, width: 100 }) });
  Object.assign(globalThis, {
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) },
  });
});

/** How far a model may reach past its box. */
const SLACK = 0.03;

/** The bounds of an object in its own frame, whatever its own place and turn. */
function localBounds(o: THREE.Object3D): THREE.Box3 {
  const pos = o.position.clone();
  const quat = o.quaternion.clone();
  o.position.set(0, 0, 0);
  o.quaternion.identity();
  o.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(o, true);
  o.position.copy(pos);
  o.quaternion.copy(quat);
  return b;
}

function expectInside(b: THREE.Box3, min: THREE.Vector3, max: THREE.Vector3): void {
  for (const a of ['x', 'y', 'z'] as const) {
    expect(b.min[a], `min ${a}`).toBeGreaterThanOrEqual(min[a] - SLACK);
    expect(b.max[a], `max ${a}`).toBeLessThanOrEqual(max[a] + SLACK);
  }
}

/** A machine of every kind, at its own size, standing somewhere turned some way. */
const DEFS: MachineDef[] = (Object.keys(MACHINE_SIZE) as MachineKind[]).map((kind, i) => ({
  id: i + 1,
  kind,
  pos: { x: 3 * i, y: 0, z: -2 },
  size: { ...MACHINE_SIZE[kind] },
  facing: (i * Math.PI) / 2,
}));

/** A machine of a kind standing at the origin, facing +z: its own frame is the world's. */
const atOrigin = (kind: MachineKind): MachineDef => ({
  id: 1,
  kind,
  pos: { x: 0, y: 0, z: 0 },
  size: { ...MACHINE_SIZE[kind] },
  facing: 0,
});

/**
 * What a machine of a kind leaves in a place in its output area: for a moulding machine, the
 * tallest part, the widest and a round one.
 */
const made = (kind: MachineKind, slot: number): Made =>
  kind === 'silo'
    ? { kind: 'bucket', colour: 'yellow' }
    : kind === 'dispenser'
      ? { kind: 'mould', type: 'slope2x2' }
      : { kind: 'part', type: (['1x1', '2x2', 'round2x2'] as const)[slot % 3]!, colour: 'blue' };

/** How long a machine of a kind takes to make what it makes. */
const MAKING: Record<MachineKind, number> = {
  silo: MAKE_SECONDS.bucket,
  dispenser: MAKE_SECONDS.mould,
  press: MAKE_SECONDS.part,
  printer: 0,
};

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
function pose(view: MachineView): number[] {
  const out: number[] = [];
  view.group.updateMatrixWorld(true);
  view.group.traverse((o) => out.push(...o.matrixWorld.elements));
  return out;
}

/**
 * How many meshes are drawn in a place in the output area of a machine standing at the origin
 * (see `atOrigin`): those in sight whose middles are in the box a click on it lands in.
 */
function drawnIn(view: MachineView, place: OutputSlot): number {
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

describe('the brick works', () => {
  it('keeps every machine inside its box, empty and full, its output area too', () => {
    const kinds = new Set<string>();
    for (const def of [...DEFS, ...HOUSE.machines]) {
      kinds.add(def.kind);
      const view = new MachineView(def);
      for (const full of [false, true]) {
        view.update(state(def, full), {});
        const { x, y, z } = def.size;
        expectInside(
          localBounds(view.group),
          new THREE.Vector3(-x / 2, 0, -z / 2),
          new THREE.Vector3(x / 2, y, z / 2),
        );
        // Nothing at all out of the front, where players stand.
        expect(localBounds(view.group).max.z, `${def.kind} front`).toBeLessThanOrEqual(z / 2);
      }
    }
    expect([...kinds].sort()).toEqual(['dispenser', 'press', 'printer', 'silo']);
  });

  it('shows each machine at work, and leaves what it made at rest in its output area', () => {
    const work: [MachineKind, Parameters<MachineView['play']>[0]][] = [
      ['silo', { kind: 'fill', colour: 'yellow', slot: 0 }],
      ['dispenser', { kind: 'dispense', mould: 'slope2x2', slot: 0 }],
      ['dispenser', { kind: 'toolUp', mould: 'slope2x2', slot: 0 }],
      ['press', { kind: 'mouldIn', mould: '2x4' }],
      ['press', { kind: 'pour', colour: 'red' }],
      ['press', { kind: 'moulded', mould: '2x2', colour: 'blue', slot: 1 }],
    ];
    for (const [kind, e] of work) {
      const def = DEFS.find((m) => m.kind === kind)!;
      const slot = e.slot ?? 0;
      const full = state(def, true);
      const without = { ...full, out: full.out.map((x, i) => (i === slot ? null : x)) };
      // Making something, its place is empty until the machine is done: then it lies there.
      // Taken out (`toolUp`), it is gone before the machine shows it go.
      const making = { ...without, making: { made: made(kind, slot), slot, at: 0 } };
      const [before, after] =
        e.kind === 'toolUp'
          ? [without, without]
          : e.slot !== undefined
            ? [making, full]
            : [full, full];
      const view = new MachineView(def);
      view.update(before, {});
      const still = pose(view);
      view.play(e, 10);
      expect(view.working, e.kind).toBe(true);
      let moved = false;
      for (let t = 10; t < 13; t += 0.05) {
        view.tick(t);
        const now = pose(view);
        if (view.working && now.length !== still.length) moved = true;
        if (view.working && now.some((v, i) => Math.abs(v - still[i]!) > 1e-6)) moved = true;
      }
      expect(moved, e.kind).toBe(true);
      expect(view.working, e.kind).toBe(false);
      // Once the machine says it is done, it is drawn just as one that had it all along, with
      // nothing left of the work.
      view.update(after, {});
      const fresh = new MachineView(def);
      fresh.update(after, {});
      expect(pose(view), e.kind).toEqual(pose(fresh));
      if (before === after) expect(pose(view), e.kind).toEqual(still);
    }
    // Not for a machine of another kind, or without what it needs to show.
    const silo = new MachineView(DEFS.find((m) => m.kind === 'silo')!);
    silo.play({ kind: 'moulded', mould: '2x4', colour: 'red' }, 0);
    silo.play({ kind: 'fill' }, 0);
    silo.play({ kind: 'toolUp', colour: 'red', slot: 0 }, 0);
    expect(silo.working).toBe(false);
  });

  it('hands what it made over to its output area, never drawn twice or not at all', () => {
    const work: [MachineKind, Parameters<MachineView['play']>[0]][] = [
      ['silo', { kind: 'fill', colour: 'yellow', slot: 0 }],
      ['dispenser', { kind: 'dispense', mould: 'slope2x2', slot: 0 }],
      ['press', { kind: 'moulded', mould: '2x2', colour: 'blue', slot: 1 }],
    ];
    for (const [kind, e] of work) {
      const def = atOrigin(kind);
      const slot = e.slot!;
      const place = outputSlots(kind, def.size)[slot]!;
      const length = MAKING[kind];
      const empty = state(def, false);
      const making = { ...empty, making: { made: made(kind, slot), slot, at: 0 } };
      const done = {
        ...empty,
        out: empty.out.map((_, i) => (i === slot ? made(kind, slot) : null)),
      };
      const once = new MachineView(def);
      once.update(done, {});
      const drawn = drawnIn(once, place);
      expect(drawn, kind).toBeGreaterThan(drawnIn(new MachineView(def), place));
      // The server says it is done a moment after the work ends here: it stays where it came
      // to rest until then.
      const late = new MachineView(def);
      late.update(making, {});
      late.play(e, 0);
      late.tick(length - 0.01);
      expect(drawnIn(late, place), kind).toBe(drawn);
      late.tick(length + 0.5);
      expect(drawnIn(late, place), kind).toBe(drawn);
      late.update(done, {});
      expect(drawnIn(late, place), kind).toBe(drawn);
      expect(pose(late), kind).toEqual(pose(once));
      // Or a moment before.
      const early = new MachineView(def);
      early.update(making, {});
      early.play(e, 0);
      early.tick(length / 2);
      early.update(done, {});
      early.tick(length - 0.01);
      expect(drawnIn(early, place), kind).toBe(drawn);
      early.tick(length);
      expect(drawnIn(early, place), kind).toBe(drawn);
      expect(pose(early), kind).toEqual(pose(once));
    }
  });

  it('rebuilds what is in a machine only when that changes', () => {
    const def = DEFS.find((m) => m.kind === 'press')!;
    const view = new MachineView(def);
    const svgs = {};
    view.update(state(def, true), svgs);
    const count = () => {
      let n = 0;
      view.group.traverse(() => n++);
      return n;
    };
    const before = count();
    const first = view.group.children.at(-1)!.children[0];
    view.update(state(def, true), svgs);
    expect(view.group.children.at(-1)!.children[0]).toBe(first);
    view.update({ ...state(def, true), shots: 3 }, svgs);
    expect(view.group.children.at(-1)!.children[0]).not.toBe(first);
    view.update(state(def, false), svgs);
    expect(count()).toBeLessThan(before);
  });

  it('shows what waits in each place in its output area, rebuilt only when that changes', () => {
    for (const kind of ['silo', 'dispenser', 'press'] as const) {
      const def = atOrigin(kind);
      const places = outputSlots(kind, def.size);
      expect(places.length).toBe(OUTPUT_ROOM[kind]);
      const view = new MachineView(def);
      const svgs = {};
      const empty = state(def, false);
      view.update(empty, svgs);
      const bare = places.map((p) => drawnIn(view, p));
      const full = { ...empty, out: empty.out.map((_, i) => made(kind, i)) };
      view.update(full, svgs);
      places.forEach((p, i) => expect(drawnIn(view, p), `${kind} ${i}`).toBeGreaterThan(bare[i]!));
      // Told the same again, or only what it is making now, it is left as it is.
      const first = view.group.children.at(-1)!.children[0];
      view.update({ ...full, out: [...full.out] }, svgs);
      view.update({ ...full, making: { made: made(kind, 0), slot: 0, at: 99 } }, svgs);
      expect(view.group.children.at(-1)!.children[0], kind).toBe(first);
      // Taken, it goes.
      view.update({ ...full, out: full.out.map((x, i) => (i === 0 ? null : x)) }, svgs);
      expect(view.group.children.at(-1)!.children[0], kind).not.toBe(first);
      expect(drawnIn(view, places[0]!), kind).toBe(bare[0]);
    }
  });

  it('sizes the tools for two hands', () => {
    const mould = localBounds(makeHeldTool({ kind: 'mould', type: '2x4' }));
    expect(mould.getSize(new THREE.Vector3()).x).toBeCloseTo(0.3, 2);
    expect(Math.abs(mould.getCenter(new THREE.Vector3()).y)).toBeLessThan(0.02);
    const bucket = localBounds(makeHeldTool({ kind: 'bucket', colour: 'yellow' }));
    const size = bucket.getSize(new THREE.Vector3());
    expect(size.y).toBeGreaterThan(0.25);
    expect(size.y).toBeLessThan(0.4);
    expect(size.x).toBeLessThan(0.3);
  });
});
