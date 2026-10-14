import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { groundHeight, levelFor, rivalLevel, terrainTriangles } from '@sar/shared';
import { NO_MERGE } from './merge.ts';
import { GROUND_ATTRIBUTE, SHORE_MAP, Surface, surfaceOf } from './styles.ts';
import {
  TERRAIN,
  distanceTransform,
  landRect,
  seaMeshes,
  shoreField,
  terrainMesh,
} from './terrain.ts';

const island = levelFor('island', 1);

/** Each triangle's normal, unnormalised, from the mesh's index. */
function faces(geometry: THREE.BufferGeometry): THREE.Vector3[] {
  const pos = geometry.attributes.position!;
  const index = geometry.index;
  const count = index ? index.count : pos.count;
  const at = (k: number) => new THREE.Vector3().fromBufferAttribute(pos, index ? index.getX(k) : k);
  const out: THREE.Vector3[] = [];
  for (let k = 0; k < count; k += 3) {
    const [a, b, c] = [at(k), at(k + 1), at(k + 2)];
    out.push(b.sub(a).cross(c.sub(a)));
  }
  return out;
}

describe('the terrain', () => {
  it('is drawn as the very triangles the physics walks on, and the sea bed round them', () => {
    const mesh = terrainMesh(island);
    const pos = mesh.geometry.attributes.position!;
    let n = 0;
    for (const t of island.terrain!) {
      const { vertices } = terrainTriangles(t);
      for (let i = 0; i < vertices.length; i++, n++) {
        expect(pos.array[n]).toBe(vertices[i]);
      }
    }
    // Every face up, the bed's as well as the ground's.
    expect(faces(mesh.geometry).every((f) => f.y > 0)).toBe(true);
    // The bed runs on out past the land, under the sea.
    const land = landRect(island);
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    expect(box.min.x).toBeLessThan(land.x0 - 100);
    expect(box.min.y).toBeCloseTo(island.sea! - 6, 3);
  });

  it('is painted from its own ground, shadowed, and never merged', () => {
    const mesh = terrainMesh(island);
    const material = mesh.material as THREE.MeshStandardMaterial;
    expect(surfaceOf(material)).toBe(Surface.Terrain);
    expect(mesh.castShadow && mesh.receiveShadow).toBe(true);
    expect(mesh.userData[NO_MERGE]).toBe(true);
    expect(mesh.userData[TERRAIN]).toBe(true);
    const ground = mesh.geometry.attributes[GROUND_ATTRIBUTE]!;
    const pos = mesh.geometry.attributes.position!;
    let grassy = 0;
    let underwater = 0;
    for (let i = 0; i < ground.count; i++) {
      const [grass, rock] = [ground.getX(i), ground.getY(i)];
      expect(grass).toBeGreaterThanOrEqual(0);
      expect(grass).toBeLessThanOrEqual(1);
      expect(rock).toBeGreaterThanOrEqual(0);
      expect(rock).toBeLessThanOrEqual(1);
      if (grass > 0.5) grassy++;
      // Nothing grows under the sea.
      if (pos.getY(i) < island.sea!) {
        underwater++;
        expect(grass).toBe(0);
      }
    }
    expect(grassy).toBeGreaterThan(1000);
    expect(underwater).toBeGreaterThan(1000);
  });
});

describe('the sea', () => {
  it('measures each point of it from the nearest shore', () => {
    const field = shoreField(island)!;
    // On the island's top, and far out to sea.
    expect(groundHeight(island, 0, 0)).toBeGreaterThan(island.sea!);
    expect(field.distance(0, 0)).toBe(0);
    expect(field.distance(-29, 0)).toBeGreaterThan(5);
    // It saturates by the map's edges, as the shader reads past them.
    const image = field.texture.image as { data: Uint8Array; width: number; height: number };
    const { data, width, height } = image;
    for (let i = 0; i < width; i++) {
      for (const j of [0, height - 1]) {
        expect(data[(j * width + i) * 2]).toBe(255);
        expect(data[(j * width + i) * 2 + 1]).toBe(255);
      }
    }
    // Sloping off steadily: never more than a metre further a metre further out.
    for (let x = -28; x < -20; x += 0.5) {
      expect(Math.abs(field.distance(x + 1, 3) - field.distance(x, 3))).toBeLessThanOrEqual(1.01);
    }
    field.texture.dispose();
  });

  it('works distances out exactly', () => {
    const [w, h] = [9, 7];
    const seeds = [
      [1, 1],
      [7, 2],
      [4, 6],
    ];
    const f = new Float64Array(w * h).fill(1e12);
    for (const [i, j] of seeds) f[j! * w + i!] = 0;
    distanceTransform(f, w, h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const nearest = Math.min(...seeds.map(([a, b]) => (a! - i) ** 2 + (b! - j) ** 2));
        expect(f[j * w + i]).toBe(nearest);
      }
    }
  });

  it('is see-through near the land and opaque out to the horizon, overlapping between', () => {
    for (const level of [island, rivalLevel(island)]) {
      const field = shoreField(level);
      const [near, far] = seaMeshes(level, field);
      const nearMaterial = near!.material as THREE.MeshStandardMaterial;
      const farMaterial = far!.material as THREE.MeshStandardMaterial;
      expect(nearMaterial.transparent).toBe(true);
      expect(farMaterial.transparent).toBe(false);
      expect(nearMaterial.userData[SHORE_MAP]).toBe(field);
      expect(near!.receiveShadow).toBe(true);
      expect(faces(near!.geometry).every((f) => f.y > 0)).toBe(true);
      expect(faces(far!.geometry).every((f) => f.y > 0)).toBe(true);
      // Flat at the sea's level.
      for (const mesh of [near!, far!]) {
        const pos = mesh.geometry.attributes.position!;
        for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBe(level.sea);
      }
      // The far sea reaches in under the near one's edge, and on out past the camera's range.
      near!.geometry.computeBoundingBox();
      const nearBox = near!.geometry.boundingBox!;
      const farPos = far!.geometry.attributes.position!;
      let innerX = Infinity;
      let outerX = 0;
      for (let i = 0; i < farPos.count; i++) {
        innerX = Math.min(innerX, Math.abs(farPos.getX(i)));
        outerX = Math.max(outerX, Math.abs(farPos.getX(i)));
      }
      expect(innerX).toBeLessThan(nearBox.max.x);
      expect(outerX).toBeGreaterThan(250);
      // The near sea opaque all round its edge, where the far one goes on.
      const colour = near!.geometry.attributes.color!;
      const pos = near!.geometry.attributes.position!;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getX(i) === nearBox.min.x || pos.getZ(i) === nearBox.max.z) {
          expect(colour.getW(i)).toBe(1);
        }
      }
      field?.texture.dispose();
    }
  });
});
