import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUCKET_SHOTS, HOUSE, MACHINE_SIZE } from '@sar/shared';
import type { MachineDef, MachineKind, MachineState } from '@sar/shared';
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

const state = (def: MachineDef, full: boolean): MachineState => ({
  def,
  mould: full ? '2x4' : null,
  colour: full ? 'red' : null,
  shots: full ? BUCKET_SHOTS : 0,
  part: full ? { type: '2x4', colour: 'blue' } : null,
  jammed: false,
  fixer: null,
  progress: 0,
});

describe('the brick works', () => {
  it('keeps every machine inside its box, empty and full', () => {
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

  it('shows each machine at work, and puts it back as it was after', () => {
    const work: [MachineKind, Parameters<MachineView['play']>[0]][] = [
      ['silo', { kind: 'fill', colour: 'red' }],
      ['dispenser', { kind: 'toolUp', mould: 'slope2x2' }],
      ['press', { kind: 'mouldIn', mould: '2x4' }],
      ['press', { kind: 'pour', colour: 'red' }],
      ['press', { kind: 'moulded', mould: '2x4', colour: 'red' }],
    ];
    for (const [kind, e] of work) {
      const def = DEFS.find((m) => m.kind === kind)!;
      const view = new MachineView(def);
      view.update(state(def, true), {});
      const pose = () => {
        const out: number[] = [];
        view.group.updateMatrixWorld(true);
        view.group.traverse((o) => out.push(...o.matrixWorld.elements));
        return out;
      };
      const before = pose();
      view.play(e, 10);
      expect(view.working, e.kind).toBe(true);
      let moved = false;
      for (let t = 10; t < 13; t += 0.05) {
        view.tick(t);
        if (view.working && pose().length !== before.length) moved = true;
        if (view.working && pose().some((v, i) => Math.abs(v - before[i]!) > 1e-6)) moved = true;
      }
      expect(moved, e.kind).toBe(true);
      expect(view.working, e.kind).toBe(false);
      expect(pose(), e.kind).toEqual(before);
    }
    // Not for a machine of another kind, or without what it needs to show.
    const silo = new MachineView(DEFS.find((m) => m.kind === 'silo')!);
    silo.play({ kind: 'moulded', mould: '2x4', colour: 'red' }, 0);
    silo.play({ kind: 'fill' }, 0);
    expect(silo.working).toBe(false);
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
