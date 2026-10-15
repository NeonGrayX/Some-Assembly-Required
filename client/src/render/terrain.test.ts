import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { groundHeight, levelFor, rivalLevel, terrainTriangles } from '@sar/shared';
import { NO_MERGE } from './merge.ts';
import {
  GROUND_ATTRIBUTE,
  ROCK_FACES,
  SHORE_MAP,
  SHORE_RANGE,
  Surface,
  rockFace,
  surfaceOf,
} from './styles.ts';
import type { RockFaces, ShoreMap } from './styles.ts';
import {
  TERRAIN,
  distanceTransform,
  landRect,
  seaMeshes,
  shoreField,
  terrainMesh,
} from './terrain.ts';

const island = levelFor('island', 1);

/** How far (`x`, `z`) is out from the shore, as a shore map has it (to within a few cm). */
function distanceIn(field: ShoreMap, x: number, z: number): number {
  const { data, width, height } = field.texture.image as {
    data: Uint8Array;
    width: number;
    height: number;
  };
  const { rect } = field;
  const i = Math.floor(((x - rect.x0) / (rect.x1 - rect.x0)) * width);
  const j = Math.floor(((z - rect.z0) / (rect.z1 - rect.z0)) * height);
  const red = data[(j * width + i) * 2]! / 255;
  return red * red * SHORE_RANGE;
}

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

  it('turns each face of its rock its own way, for the shader to light it flat', () => {
    const mesh = terrainMesh(island);
    const faces = (mesh.material as THREE.Material).userData[ROCK_FACES] as RockFaces;
    const { data, width, height } = faces.texture.image as {
      data: Uint8Array;
      width: number;
      height: number;
    };
    expect([width, height]).toEqual([faces.size.x * faces.size.y, faces.size.z]);
    // The face each of the rockiest points is on has a way, turned out of the rock.
    const pos = mesh.geometry.attributes.position!;
    const normal = mesh.geometry.attributes.normal!;
    const ground = mesh.geometry.attributes[GROUND_ATTRIBUTE]!;
    const wayOf = (i: number) => {
      const [a, b, c] = rockFace(pos.getX(i), pos.getY(i), pos.getZ(i));
      const k = (c - faces.from.z) * width + (a - faces.from.x) + (b - faces.from.y) * faces.size.x;
      const [x, y, z, rock] = data.slice(k * 4, k * 4 + 4);
      expect(rock).toBe(255);
      return new THREE.Vector3(x!, y!, z!).divideScalar(127.5).subScalar(1);
    };
    const ways = new Set<string>();
    let rocky = 0;
    for (let i = 0; i < pos.count; i++) {
      if (ground.getY(i) < 0.9) continue;
      rocky++;
      const way = wayOf(i);
      expect(way.length()).toBeCloseTo(1, 1);
      expect(way.dot(new THREE.Vector3().fromBufferAttribute(normal, i))).toBeGreaterThan(0);
      ways.add(way.toArray().join());
    }
    expect(rocky).toBeGreaterThan(100);
    expect(ways.size).toBeGreaterThan(10);
  });
});

describe('the sea', () => {
  it('measures each point of it from the nearest shore', () => {
    const field = shoreField(island)!;
    // On the island's top, and far out to sea.
    expect(groundHeight(island, 0, 0)).toBeGreaterThan(island.sea!);
    expect(distanceIn(field, 0, 0)).toBe(0);
    expect(distanceIn(field, -29, 0)).toBeGreaterThan(5);
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
      const step = distanceIn(field, x + 1, 3) - distanceIn(field, x, 3);
      expect(Math.abs(step)).toBeLessThanOrEqual(1.05);
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
      // The near sea's edge out past the shore map's, where its depth has run up to the most,
      // so it is painted as opaque there as the far sea is.
      expect(nearBox.min.x).toBeLessThan(field!.rect.x0);
      expect(nearBox.max.z).toBeGreaterThan(field!.rect.z1);
      field?.texture.dispose();
    }
  });
});
