import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUCKET_SHOTS, HOUSE, MOULD_SIZE, MOULD_TYPES } from '@sar/shared';
import type { MachineDef, MachineState } from '@sar/shared';
import { MachineView, makeHeldTool, makeMould } from './brickworks.ts';

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

const state = (def: MachineDef, full: boolean): MachineState => ({
  def,
  mould: full ? '2x4' : null,
  colour: full ? 'red' : null,
  shots: full ? BUCKET_SHOTS : 0,
  part: full ? { type: '2x4', colour: 'blue' } : null,
});

describe('the brick works', () => {
  it('keeps every machine inside its box, empty and full', () => {
    const kinds = new Set<string>();
    for (const def of HOUSE.machines) {
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
    expect([...kinds].sort()).toEqual(['press', 'printer', 'silo']);
  });

  it('rebuilds what is in a machine only when that changes', () => {
    const def = HOUSE.machines.find((m) => m.kind === 'press')!;
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

  it('keeps every mould inside its box', () => {
    const { x, y, z } = MOULD_SIZE;
    for (const type of MOULD_TYPES) {
      const g = makeMould({ id: 1, pos: { x: 3, y: 1, z: -2 }, type, facing: 1, tilt: 0.3 });
      expectInside(
        localBounds(g),
        new THREE.Vector3(-x / 2, 0, -z / 2),
        new THREE.Vector3(x / 2, y, z / 2),
      );
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
