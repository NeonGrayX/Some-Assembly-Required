import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LAMP_FIXTURE } from './daynight.ts';
import { KEEP_SEPARATE, mergeStatic } from './merge.ts';
import { SURFACE_ATTRIBUTE, SURFACE_PER_VERTEX, Surface, madeOf } from './styles.ts';

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
    const plastic = box(0xff0000, 5);
    madeOf(plastic.material, Surface.Plastic);
    group.add(plastic);
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
    // What each box was made of, for the visual styles' textures.
    const surfaces = merged.geometry.attributes[SURFACE_ATTRIBUTE]!;
    expect(new Set(Array.from(surfaces.array)).size).toBe(2);
    expect(Array.from(surfaces.array)).toContain(Surface.Plastic);
    expect((merged.material as THREE.Material).userData[SURFACE_PER_VERTEX]).toBe(true);
    expect(door.children[0]).toBeInstanceOf(THREE.Mesh);
    expect(screen.parent).toBe(scene);
  });

  it('keeps a lamp apart from what is merged around it, still marked as a lamp', () => {
    const scene = new THREE.Scene();
    const lamp = box(0x0000ff, 2);
    lamp.userData[LAMP_FIXTURE] = true;
    scene.add(box(0x0000ff, -2), box(0x0000ff, 0), lamp);

    mergeStatic(scene);
    const meshes = scene.children as THREE.Mesh[];
    expect(meshes).toHaveLength(2);
    expect(meshes.filter((m) => m.userData[LAMP_FIXTURE])).toHaveLength(1);
  });
});
