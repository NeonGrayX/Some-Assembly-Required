import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { KEEP_SEPARATE, mergeStatic } from './merge.ts';

const box = (colour: number, x: number) => {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: colour, roughness: 0.8 }),
  );
  m.position.x = x;
  m.castShadow = true;
  return m;
};

describe('mergeStatic', () => {
  it('bakes plain meshes into one, keeping colours, places and what must stay separate', () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    group.position.set(0, 2, 0);
    group.add(box(0xff0000, 5));
    scene.add(box(0x0000ff, -5), group);
    const door = new THREE.Group();
    door.userData[KEEP_SEPARATE] = true;
    door.add(box(0x00ff00, 0));
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ map: new THREE.Texture() }),
    );
    scene.add(door, screen);

    mergeStatic(scene);
    const meshes: THREE.Mesh[] = [];
    scene.traverse((o) => o instanceof THREE.Mesh && meshes.push(o));
    // The two plain boxes became one; the door and the textured screen are untouched.
    expect(meshes).toHaveLength(3);
    const merged = meshes.find((m) => m.geometry.attributes.color)!;
    expect(merged.castShadow).toBe(true);
    merged.geometry.computeBoundingBox();
    const bounds = merged.geometry.boundingBox!;
    expect(bounds.min.x).toBeCloseTo(-5.5);
    expect(bounds.max.x).toBeCloseTo(5.5);
    expect(bounds.max.y).toBeCloseTo(2.5);
    const colours = merged.geometry.attributes.color!;
    const reds = new Set<number>();
    for (let i = 0; i < colours.count; i++) reds.add(colours.getX(i));
    expect([...reds].sort()).toEqual([0, 1]);
    expect(door.children[0]).toBeInstanceOf(THREE.Mesh);
    expect(screen.parent).toBe(scene);
  });
});
