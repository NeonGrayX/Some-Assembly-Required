import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MAPS, groundHeight, levelFor, makeRng } from '@sar/shared';
import { greenery, rockModel } from './nature.ts';
import { Surface, surfaceOf } from './styles.ts';
import { wornAt } from './terrain.ts';

const island = levelFor('island', 1);

const meshesOf = (g: THREE.Group) => g.children as THREE.Mesh[];

/** The island's greenery, built once (it takes a while), for the tests that only look at it. */
let built: THREE.Mesh[] | undefined;
const islandGreenery = () => (built ??= meshesOf(greenery(island)));

/** Long enough to build a map's greenery or two on a busy machine. */
const SLOW = { timeout: 60_000 };

describe('greenery', () => {
  it('grows lush plants and strews stones only on hills', SLOW, () => {
    for (const map of MAPS) {
      const meshes = map.id === 'island' ? islandGreenery() : meshesOf(greenery(map.layout(1)));
      // Tufts, bushes and flowers everywhere; big leaves and ferns (their tops and undersides),
      // and stones, on the island's hills alone.
      expect(meshes.length, map.id).toBe(map.id === 'island' ? 6 : 3);
    }
  });

  it("keeps the island's plants out of the sea and off the ground worn bare", SLOW, () => {
    const [, , , leaves] = islandGreenery();
    expect(surfaceOf(leaves!.material as THREE.Material)).toBe(Surface.Grass);
    const pos = leaves!.geometry.attributes.position!;
    expect(pos.count).toBeGreaterThan(3000);
    for (let i = 0; i < pos.count; i++) {
      const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      expect(y).toBeGreaterThan(island.sea!);
      expect(wornAt(island, x, z)).toBeLessThan(1);
    }
  });

  it("casts the island's big leaves' and ferns' shadows from their undersides alone", SLOW, () => {
    // As tall as the bushes and wider, their shadows fall well out beside them.
    const [, , , tops, undersides] = islandGreenery();
    expect(tops!.castShadow).toBe(false);
    expect(undersides!.castShadow).toBe(true);
    // Cast whichever way each face is turned to the sun, through every point of the leaves.
    expect((undersides!.material as THREE.Material).shadowSide).toBe(THREE.DoubleSide);
    expect(surfaceOf(undersides!.material as THREE.Material)).toBe(Surface.Grass);
    const points = (m: THREE.Mesh) => {
      const a = m.geometry.attributes.position!.array;
      const out: string[] = [];
      for (let i = 0; i < a.length; i += 3) out.push(`${a[i]},${a[i + 1]},${a[i + 2]}`);
      return out.sort();
    };
    expect(points(undersides!)).toEqual(points(tops!));
  });

  it('gathers round the feet of lantern posts as of lamp posts', SLOW, () => {
    const [tufts] = islandGreenery();
    const pos = tufts!.geometry.attributes.position!;
    const posts = island.boxes.filter(
      (b) =>
        b.model === 'lanternPost' &&
        Math.abs(b.pos.y - b.size.y / 2 - groundHeight(island, b.pos.x, b.pos.z)) < 0.3 &&
        groundHeight(island, b.pos.x, b.pos.z) > island.sea! + 0.5,
    );
    expect(posts.length).toBeGreaterThan(2);
    for (const b of posts) {
      let near = 0;
      for (let i = 0; i < pos.count; i++)
        if (Math.hypot(pos.getX(i) - b.pos.x, pos.getZ(i) - b.pos.z) < 0.5) near++;
      expect(near, `at ${b.pos.x}, ${b.pos.z}`).toBeGreaterThan(0);
    }
  });

  it('is built the same every time', SLOW, () => {
    const a = islandGreenery();
    const b = meshesOf(greenery(island));
    expect(a.map((m) => m.geometry.attributes.position!.array)).toEqual(
      b.map((m) => m.geometry.attributes.position!.array),
    );
  });
});

describe('rockModel', () => {
  it("paints a camp stone's worn bevels for the size of its box, as it always has", () => {
    // The sums of a stone's vertex colours, as the camp's stones were painted before the island
    // came. Telling the worn bevels by the size of the stone, a hair inside its box, instead
    // paints some of its facets another shade.
    const painted = { 1: 473.3484, 5: 412.1651, 9: 471.3518, 12: 445.4239 };
    for (const [seed, sum] of Object.entries(painted)) {
      const g = new THREE.Group();
      rockModel(g, 0.6, 0.28, 0.54, 0x8a8a80, makeRng(Number(seed)));
      const colours = (g.children[0] as THREE.Mesh).geometry.attributes.color!.array;
      const total = Array.from(colours).reduce((a, c) => a + c, 0);
      expect(total, `seed ${seed}`).toBeCloseTo(sum, 3);
    }
  });
});
