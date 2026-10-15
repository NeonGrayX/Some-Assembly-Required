import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { levelFor } from '@sar/shared';
import { buildLevelScene } from './scene.ts';

/**
 * What the island's still scene costs to draw: every triangle of it is drawn each frame, and
 * every one that casts the sun's shadow is drawn again into the shadow map. Measured on its
 * models as built, before the view merges them; the other maps draw a third to a half as many.
 */
function cost(seed: number): { triangles: number; casting: number } {
  const { root } = buildLevelScene(levelFor('island', seed));
  let triangles = 0;
  let casting = 0;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (let v: THREE.Object3D | null = o; v; v = v.parent) if (!v.visible) return;
    const g = o.geometry as THREE.BufferGeometry;
    const n =
      ((g.index ?? g.attributes.position!).count / 3) *
      (o instanceof THREE.InstancedMesh ? o.count : 1);
    triangles += n;
    if (o.castShadow) casting += n;
  });
  return { triangles, casting };
}

describe("the island's still scene", () => {
  // Signs and lantern glows are drawn on canvases: a stand-in that draws nothing will do.
  const before = (globalThis as { document?: unknown }).document;
  beforeAll(() => {
    const ctx = new Proxy({}, { get: () => () => ({ addColorStop() {}, width: 100 }) });
    Object.assign(globalThis, {
      document: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) },
    });
  });
  afterAll(() => {
    Object.assign(globalThis, { document: before });
  });

  // About 310 thousand triangles, 146 thousand of them casting (from 425 and 350 thousand, when
  // every barnacle and bolt cast its own shadow, the big leaves and ferns cast from both their
  // faces and shingles were bevelled boxes): a tenth more of either is a model grown heavier
  // than it looks.
  it.each([1, 7])('stays in its budget laid out for seed %i', { timeout: 60_000 }, (seed) => {
    const { triangles, casting } = cost(seed);
    expect(triangles).toBeLessThan(340_000);
    expect(casting).toBeLessThan(160_000);
  });
});
