import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { HOUSE } from '@sar/shared';
import type { BoxDef } from '@sar/shared';
import { addPropFile, exportGlb } from './propFiles.ts';
import { makeProp } from './props.ts';

beforeAll(() => {
  // The exporter reads its output through a FileReader, which Node lacks.
  class FileReader {
    result: ArrayBuffer | string | null = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(b: Blob) {
      void b.arrayBuffer().then((r) => {
        this.result = r;
        this.onloadend?.();
      });
    }
    readAsDataURL(b: Blob) {
      void b.arrayBuffer().then((r) => {
        this.result = `data:${b.type};base64,${Buffer.from(r).toString('base64')}`;
        this.onloadend?.();
      });
    }
  }
  Object.assign(globalThis, { FileReader });
});

const seat = HOUSE.boxes.find((b) => b.model === 'sofa')!;
const bounds = (o: THREE.Object3D) => {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o, true);
};
const meshes = (o: THREE.Object3D) => {
  let n = 0;
  o.traverse((m) => (n += m instanceof THREE.Mesh ? 1 : 0));
  return n;
};
const expectSame = (got: THREE.Box3, want: THREE.Box3) => {
  for (const k of ['x', 'y', 'z'] as const) {
    expect(got.min[k]).toBeCloseTo(want.min[k], 4);
    expect(got.max[k]).toBeCloseTo(want.max[k], 4);
  }
};

describe('prop files', () => {
  it('saves a prop as a .glb standing on the origin', async () => {
    const glb = await exportGlb([makeProp(seat, HOUSE)!], 'sofa');
    expect(new TextDecoder().decode(new Uint8Array(glb, 0, 4))).toBe('glTF');
  });

  it('draws a prop saved on its box and named again just as it was', async () => {
    const coded = makeProp(seat, HOUSE)!;
    await addPropFile('couch', await exportGlb([coded], 'couch', -seat.size.y / 2));
    const file = makeProp({ ...seat, asset: 'couch' }, HOUSE)!;
    expect(meshes(file)).toBe(meshes(coded));
    expectSame(bounds(file), bounds(coded));
  });

  it('keeps the front of a model where the box says its front is', async () => {
    // A block with a knob on its front (-z), as a coded prop is built.
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    const knob = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2));
    knob.position.z = -0.6;
    g.add(knob);
    const glb = await exportGlb([g]);
    // In the file it faces +z, as glTF models do.
    const saved = (await new GLTFLoader().parseAsync(glb, '')).scene;
    expect(bounds(saved).max.z).toBeCloseTo(0.7, 4);
    expect(bounds(saved).min.y).toBeCloseTo(0, 4);
    await addPropFile('knob', glb);
    const box: BoxDef = {
      pos: { x: 5, y: 1, z: -3 },
      size: { x: 2, y: 2, z: 2 },
      colour: 0,
      model: 'crate',
      asset: 'knob',
    };
    for (const [front, axis, sign] of [
      ['-z', 'z', -1],
      ['+z', 'z', 1],
      ['-x', 'x', -1],
      ['+x', 'x', 1],
    ] as const) {
      const b = { ...box, front };
      const prop = makeProp(b, HOUSE)!;
      // Standing on the box's bottom.
      expect(bounds(prop).min.y).toBeCloseTo(b.pos.y - b.size.y / 2, 4);
      // The knob is the small mesh: its centre is out towards the front.
      let knobAt = 0;
      prop.traverse((m) => {
        if (!(m instanceof THREE.Mesh)) return;
        const c = bounds(m).getCenter(new THREE.Vector3());
        if (bounds(m).getSize(new THREE.Vector3()).y < 0.5) knobAt = c[axis] - b.pos[axis];
      });
      expect(Math.sign(knobAt)).toBe(sign);
    }
  });

  it('draws its own model when the file is missing', () => {
    const coded = makeProp(seat, HOUSE)!;
    const fallback = makeProp({ ...seat, asset: 'no-such-file' }, HOUSE)!;
    expect(meshes(fallback)).toBe(meshes(coded));
  });
});
