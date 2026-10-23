import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { batchStatic } from './batch.ts';
import { buildCarScene } from './scene.ts';

const meshes = (root: THREE.Object3D) => {
  let n = 0;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) n++;
  });
  return n;
};

const { root } = buildCarScene();

describe('baking the car scene together', () => {
  it('draws it in far fewer meshes, in the same place, its doors still apart', () => {
    const before = meshes(root);
    const bounds = new THREE.Box3().setFromObject(root);
    const doorMeshes = root.getObjectsByProperty('name', 'door').map(meshes);
    const taken = batchStatic(root, (o) => o.name === 'door');
    expect(taken).toBeGreaterThan(before * 0.9);
    expect(meshes(root)).toBeLessThan(before / 4);
    const after = new THREE.Box3().setFromObject(root);
    expect(after.min.distanceTo(bounds.min)).toBeLessThan(1e-3);
    expect(after.max.distanceTo(bounds.max)).toBeLessThan(1e-3);
    expect(root.getObjectsByProperty('name', 'door').map(meshes)).toEqual(doorMeshes);
  });
});
