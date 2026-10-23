import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { describe, expect, it } from 'vitest';
import { MOVING, Press, Toggle, gadgetsIn } from './gadgets.ts';
import { CHEVRON_LAYOUT } from './chevronLayout.ts';
import { buildCarScene } from './scene.ts';
import { noteWhereAdded, where } from './whereAdded.ts';

/**
 * What opens on the map swings through the room about it: a cupboard door through the one
 * beside it, an oven door into the shelf across from it, a lever into the wall. This works
 * everything that moves through its swing, all together and every other one alone (so that each
 * meets its neighbours both open and shut), and finds every part it passes through. What a part
 * is already set into where it stands (a button in its box, a cap on its hydrant) it stays in,
 * and is not counted.
 */

/** Steps of a swing, far enough apart that the slowest gadget is through it in nine. */
const STEP = 0.15;
const STEPS = 9;

/** A mesh that stands in the way: solid, not water drawn over things. */
function solid(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as THREE.Mesh;
  if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh) return false;
  return (m.material as THREE.Material).depthWrite;
}

function shown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/** Every pair of a moving part's mesh and a mesh it passes through, as the report reads it. */
function clashes(root: THREE.Object3D): string[] {
  root.updateMatrixWorld(true);
  // Each moving part (its outermost group named so), and its meshes.
  const part = new Map<THREE.Mesh, THREE.Object3D>();
  root.traverse((o) => {
    if (o.name !== MOVING) return;
    for (let p = o.parent; p; p = p.parent) if (p.name === MOVING) return;
    o.traverse((m) => {
      if (solid(m)) part.set(m, o);
    });
  });
  const movers = [...part.keys()];
  const fixed: THREE.Mesh[] = [];
  root.traverseVisible((o) => {
    if (solid(o) && !part.has(o)) fixed.push(o);
  });
  const fixedBox = fixed.map((m) => new THREE.Box3().setFromObject(m));
  const trees = new Map<THREE.BufferGeometry, MeshBVH>();
  const toB = new THREE.Matrix4();
  const meets = (a: THREE.Mesh, b: THREE.Mesh) => {
    let tree = trees.get(b.geometry);
    if (!tree) trees.set(b.geometry, (tree = new MeshBVH(b.geometry)));
    toB.copy(b.matrixWorld).invert().multiply(a.matrixWorld);
    return tree.intersectsGeometry(a.geometry, toB);
  };
  // The pairs meeting as things stand now.
  const now = () => {
    root.updateMatrixWorld(true);
    const out = new Set<[THREE.Mesh, THREE.Mesh]>();
    const boxes = movers.map((m) => (shown(m) ? new THREE.Box3().setFromObject(m) : null));
    movers.forEach((a, i) => {
      const box = boxes[i];
      if (!box) return;
      fixed.forEach((b, j) => {
        if (box.intersectsBox(fixedBox[j]!) && meets(a, b)) out.add([a, b]);
      });
      movers.forEach((b, j) => {
        if (j <= i || part.get(a) === part.get(b) || !boxes[j]?.intersectsBox(box)) return;
        if (meets(a, b)) out.add([a, b]);
      });
    });
    return out;
  };
  const key = ([a, b]: [THREE.Mesh, THREE.Mesh]) => `${a.uuid} ${b.uuid}`;
  const atRest = new Set([...now()].map(key));
  const gadgets = gadgetsIn(root).filter((g) => g instanceof Toggle || g instanceof Press);
  const started = gadgets.map((g) => g instanceof Toggle && g.on);
  const found = new Map<string, string>();
  for (const pass of ['all', 'even', 'odd'] as const) {
    gadgets.forEach((g, i) => {
      const go = pass === 'all' || (i % 2 === 0) === (pass === 'even');
      if (g instanceof Toggle ? go && g.on === started[i] : go) g.use();
    });
    for (let s = 0; s < STEPS; s++) {
      for (const g of gadgets) g.update(STEP);
      for (const pair of now())
        if (!atRest.has(key(pair)) && !found.has(key(pair)))
          found.set(key(pair), `${pass}, step ${s + 1}:\n  ${where(pair[0])}\n  ${where(pair[1])}`);
    }
    // Back as they began.
    gadgets.forEach((g, i) => {
      if (g instanceof Toggle && g.on !== started[i]) g.use();
    });
    for (let s = 0; s < STEPS; s++) for (const g of gadgets) g.update(STEP);
  }
  return [...found.values()];
}

describe('the car scene, as Chevron Street lays it out', () => {
  it('opens its doors, lids and levers without passing through anything', () => {
    const restore = noteWhereAdded();
    const root = buildCarScene({ layout: CHEVRON_LAYOUT }).root;
    restore();
    expect(clashes(root)).toEqual([]);
  }, 300_000);
});
