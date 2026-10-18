import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BIG_HOUSE_BODY } from './bighouse.ts';
import { BODY } from './car.ts';
import { HOUSE_BODY } from './house.ts';
import { buildCarScene } from './scene.ts';

const scene = buildCarScene();
scene.root.updateMatrixWorld(true);

const boxOf = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);

/** `o`'s bounds in `frame`'s own axes, exact whatever way `frame` is turned. */
function boxIn(o: THREE.Object3D, frame: THREE.Object3D): THREE.Box3 {
  const toFrame = frame.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  o.traverse((m) => {
    const mesh = m as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.computeBoundingBox();
    const local = toFrame.clone().multiply(mesh.matrixWorld);
    box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(local));
  });
  return box;
}

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

  it('parks the sports car on its wheels beside the off-roader, clear of it', () => {
    for (const w of scene.sports.wheels) expect(boxOf(w).min.y).toBeCloseTo(0, 3);
    expect(boxOf(scene.sports.root).min.y).toBeGreaterThan(-0.005);
    expect(boxOf(scene.sports.root).intersectsBox(boxOf(scene.car.root))).toBe(false);
  });

  it('parks the bus on its wheels beyond the sports car, clear of both cars', () => {
    for (const w of scene.bus.wheels) expect(boxOf(w).min.y).toBeCloseTo(0, 3);
    expect(boxOf(scene.bus.root).min.y).toBeGreaterThan(-0.005);
    expect(boxOf(scene.bus.root).intersectsBox(boxOf(scene.sports.root))).toBe(false);
    expect(boxOf(scene.bus.root).intersectsBox(boxOf(scene.car.root))).toBe(false);
  });

  it('stands the house on the ground behind the cars, clear of them all', () => {
    expect(boxOf(scene.house).min.y).toBeGreaterThan(-0.01);
    expect(boxOf(scene.house).min.y).toBeLessThan(0.01);
    for (const v of [scene.car, scene.sports, scene.bus])
      expect(boxOf(scene.house).intersectsBox(boxOf(v.root))).toBe(false);
  });

  it('stands the big house on the ground across the street, clear of everything', () => {
    const big = boxOf(scene.bigHouse);
    expect(big.min.y).toBeGreaterThan(-0.01);
    expect(big.min.y).toBeLessThan(0.01);
    for (const v of [scene.car, scene.sports, scene.bus])
      expect(big.intersectsBox(boxOf(v.root))).toBe(false);
    expect(big.intersectsBox(boxOf(scene.house))).toBe(false);
    for (const prop of scene.street.children.filter((c) => c.name === 'prop'))
      expect(big.intersectsBox(boxOf(prop))).toBe(false);
  });

  it("keeps both houses' furniture inside their walls, standing on their floors", () => {
    for (const [house, body] of [
      [scene.house, HOUSE_BODY],
      [scene.bigHouse, BIG_HOUSE_BODY],
    ] as const) {
      const pieces = house.children.filter((c) => c.name === 'furniture');
      expect(pieces.length).toBeGreaterThan(8);
      for (const piece of pieces) {
        const box = boxIn(piece, house);
        expect(Math.max(-box.min.x, box.max.x)).toBeLessThan(body.depth - body.wall + 0.02);
        expect(Math.max(-box.min.z, box.max.z)).toBeLessThan(body.half - body.wall + 0.02);
        expect(box.min.y).toBeGreaterThan(body.plinth - 0.005);
        expect(box.max.y).toBeLessThan(body.eave);
      }
    }
  });

  it('lays the street on the ground, its props on the pavement, clear of the vehicles', () => {
    expect(boxOf(scene.street).min.y).toBeGreaterThan(-0.01);
    expect(boxOf(scene.street).min.y).toBeLessThan(0.01);
    const props = scene.street.children.filter((c) => c.name === 'prop');
    expect(props.length).toBeGreaterThan(15);
    for (const prop of props) {
      expect(boxOf(prop).min.y).toBeCloseTo(prop.position.y, 2);
      for (const v of [scene.car, scene.sports, scene.bus])
        expect(boxOf(prop).intersectsBox(boxOf(v.root))).toBe(false);
      expect(boxOf(prop).intersectsBox(boxOf(scene.house))).toBe(false);
    }
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
