import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BODY } from './car.ts';
import { buildCarScene } from './scene.ts';

const scene = buildCarScene();
scene.root.updateMatrixWorld(true);

const boxOf = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);

describe('the car test map', () => {
  it('builds every mesh with sound geometry', () => {
    const broken: string[] = [];
    scene.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const pos = mesh.geometry.attributes.position!.array;
      if (pos.length === 0 || Array.from(pos).some((v) => !Number.isFinite(v)))
        broken.push(`${mesh.parent?.name ?? ''}/${mesh.geometry.type}`);
    });
    expect(broken).toEqual([]);
  });

  it('stands the car on its wheels, on the ground', () => {
    for (const w of scene.car.wheels) expect(boxOf(w).min.y).toBeCloseTo(0, 3);
    // Nothing of the body hangs below the wheels.
    expect(boxOf(scene.car.root).min.y).toBeGreaterThan(-0.005);
  });

  it('keeps the cargo on the roof, above the glasshouse', () => {
    const cargo = scene.car.root.getObjectByName('cargo')!;
    expect(boxOf(cargo).min.y).toBeGreaterThan(BODY.roof);
  });

  it('stands the cones on the ground, the knocked-over one lying on its side', () => {
    for (const cone of scene.cones) expect(boxOf(cone).min.y).toBeCloseTo(0, 2);
    const fallen = boxOf(scene.cones[scene.cones.length - 1]!);
    const size = fallen.getSize(new THREE.Vector3());
    // Longer along the ground than it is tall.
    expect(Math.max(size.x, size.z)).toBeGreaterThan(size.y * 1.5);
  });
});
