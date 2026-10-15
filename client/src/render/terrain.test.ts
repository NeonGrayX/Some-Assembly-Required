import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { groundHeight, levelFor, rivalLevel, terrainTriangles } from '@sar/shared';
import type { LevelDef } from '@sar/shared';
import { GLOW_POOL, tagged } from './daynight.ts';
import { NO_MERGE } from './merge.ts';
import { GROUND_ATTRIBUTE, SHORE_MAP, SHORE_RANGE, Surface, surfaceOf } from './styles.ts';
import type { ShoreMap } from './styles.ts';
import {
  TERRAIN,
  distanceTransform,
  landRect,
  paintGround,
  seaMeshes,
  shoreField,
  terrainMesh,
  waterline,
  wornAt,
  wornGround,
} from './terrain.ts';

const island = levelFor('island', 1);

/**
 * How far (`x`, `z`) is out from the shore, as a shore map has it (to within a few cm): from the
 * ground's (its red), or from whatever stands in the sea (its blue, `channel` 2).
 */
function distanceIn(field: ShoreMap, x: number, z: number, channel = 0): number {
  const { data, width, height } = field.texture.image as {
    data: Uint8Array;
    width: number;
    height: number;
  };
  const { rect } = field;
  const i = Math.floor(((x - rect.x0) / (rect.x1 - rect.x0)) * width);
  const j = Math.floor(((z - rect.z0) / (rect.z1 - rect.z0)) * height);
  const value = data[(j * width + i) * 4 + channel]! / 255;
  return value * value * SHORE_RANGE;
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
    let [underwater, dry, sandy, tops, grassyTops] = [0, 0, 0, 0, 0];
    for (let i = 0; i < ground.count; i++) {
      const [grass, rock] = [ground.getX(i), ground.getY(i)];
      expect(grass).toBeGreaterThanOrEqual(0);
      expect(grass).toBeLessThanOrEqual(1);
      expect(rock).toBeGreaterThanOrEqual(0);
      expect(rock).toBeLessThanOrEqual(1);
      const above = pos.getY(i) - island.sea!;
      // Nothing grows under the sea, nor on the beach just above it.
      if (above < 0.4) expect(grass).toBeLessThan(0.5);
      if (above < 0) {
        underwater++;
        expect(grass).toBe(0);
        continue;
      }
      dry++;
      if (grass < 0.5 && rock < 0.5) sandy++;
      // The hilltops' ground (not their rock) grassy.
      if (above > 3 && rock < 0.5) {
        tops++;
        if (grass > 0.5) grassyTops++;
      }
    }
    expect(underwater).toBeGreaterThan(1000);
    // Mostly warm sand, as an island in a painting is, with the grass up on its heights.
    expect(sandy).toBeGreaterThan(dry * 0.6);
    expect(tops).toBeGreaterThan(100);
    expect(grassyTops).toBeGreaterThan(tops * 0.75);
  });

  it("casts the sun's shadow from only its faces turned away from the sun", () => {
    const mesh = terrainMesh(island);
    const geometry = mesh.geometry;
    const triangles = (from: number, to: number) => {
      const index = geometry.index!;
      const out: string[] = [];
      for (let t = from * 3; t < to * 3; t += 3) {
        // Each as its corners from the least, so the same triangle reads the same.
        const [i, j, k] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
        const m = Math.min(i, j, k);
        out.push(m === i ? `${i},${j},${k}` : m === j ? `${j},${k},${i}` : `${k},${i},${j}`);
      }
      return out.sort();
    };
    const all = geometry.index!.count / 3;
    const before = triangles(0, all);
    // The sun as the view has it, and its shadow camera looking from it.
    const sun = new THREE.Vector3(10, 8, 7.5);
    const camera = new THREE.OrthographicCamera();
    camera.position.copy(sun);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const renderer = { shadowMap: { type: THREE.PCFShadowMap } } as THREE.WebGLRenderer;
    // (Stand-ins for the scene and the group three.js passes, which the terrain does not use.)
    const [scene, group] = [new THREE.Scene(), new THREE.Group()];
    const material = mesh.material as THREE.Material;
    const shadow = (cam: THREE.Camera) =>
      mesh.onBeforeShadow(renderer, scene, cam, cam, geometry, material, group);
    shadow(camera);
    const drawn = geometry.drawRange.count / 3;
    // Every face turned from the sun is drawn into its map, and none turned toward it.
    const toSun = sun.clone().normalize();
    faces(geometry).forEach((n, t) => {
      const facing = n.dot(toSun) / n.length();
      if (t < drawn) expect(facing).toBeLessThan(0.03);
      else expect(facing).toBeGreaterThan(0);
    });
    // Only its steepest banks, turned from the sun, out of its 19 thousand.
    expect(drawn).toBeGreaterThan(50);
    expect(drawn).toBeLessThan(all * 0.1);
    // The same triangles, each turned as it was, only in another order; and all drawn by the
    // camera.
    expect(triangles(0, all)).toEqual(before);
    mesh.onAfterShadow(renderer, scene, camera, camera, geometry, material, group);
    expect(geometry.drawRange.count).toBe(Infinity);
    // A lamp's shadow (seen through a perspective camera) has every one of them.
    shadow(new THREE.PerspectiveCamera());
    expect(geometry.drawRange.count).toBe(Infinity);
  });

  it('is rocky only where it is steep, and leaves the rock to the rocks standing on it', () => {
    const mesh = terrainMesh(island);
    const pos = mesh.geometry.attributes.position!;
    const normal = mesh.geometry.attributes.normal!;
    const ground = mesh.geometry.attributes[GROUND_ATTRIBUTE]!;
    let rocky = 0;
    for (let i = 0; i < pos.count; i++) {
      const ny = normal.getY(i);
      // The ground's rise over its run there.
      const slope = Math.sqrt(1 - ny * ny) / ny;
      const rock = ground.getY(i);
      const at = `at ${pos.getX(i)}, ${pos.getZ(i)}`;
      if (rock > 0.5) {
        rocky++;
        expect(slope, at).toBeGreaterThan(0.75);
      }
      if (slope < 0.6) expect(rock, at).toBe(0);
    }
    expect(rocky).toBeGreaterThan(100);
  });
});

describe('the ground worn bare', () => {
  it('lies round where players come and go, and along the ways between', () => {
    const { patches, ways } = wornGround(island);
    // Round the job site, its spawn, the decks, the doorways, the ladders' feet and the
    // catapult, joined up by as many ways as it takes.
    expect(patches.length).toBeGreaterThan(8);
    expect(ways).toHaveLength(patches.length - 1);
    const bare = (x: number, z: number) => {
      expect(wornAt(island, x, z), `at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBe(1);
      // Worn back to sand.
      const out = { grass: 0, rock: 0 };
      paintGround(island, x, groundHeight(island, x, z), z, 1, out);
      expect(out.grass).toBe(0);
    };
    for (const { r } of patches) bare((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
    for (const w of ways) bare((w.ax + w.bx) / 2, (w.az + w.bz) / 2);
    for (const l of island.ladders) {
      if (l.pos.y - groundHeight(island, l.pos.x, l.pos.z) < 0.3) bare(l.pos.x, l.pos.z);
    }
    // Well away from all of them, as it was.
    const along = (w: (typeof ways)[number], x: number, z: number) => {
      const [dx, dz] = [w.bx - w.ax, w.bz - w.az];
      const t = Math.min(1, Math.max(0, ((x - w.ax) * dx + (z - w.az) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(x - w.ax - dx * t, z - w.az - dz * t);
    };
    let away = 0;
    for (let x = -24; x <= 24; x += 1.5) {
      for (let z = -24; z <= 24; z += 1.5) {
        const near =
          patches.some(({ r }) => {
            const out = Math.hypot(
              Math.max(r.x0 - x, 0, x - r.x1),
              Math.max(r.z0 - z, 0, z - r.z1),
            );
            return out < 2.5;
          }) || ways.some((w) => along(w, x, z) < 2.5);
        if (near) continue;
        away++;
        expect(wornAt(island, x, z)).toBe(0);
      }
    }
    expect(away).toBeGreaterThan(100);
  });

  it('is only on terrain', () => {
    const flat = { ...island, terrain: undefined } as LevelDef;
    for (const [x, z] of [
      [0, 0],
      [-1.6, -3.2],
    ])
      expect(wornAt(flat, x!, z!)).toBe(0);
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
        for (let c = 0; c < 4; c++) expect(data[(j * width + i) * 4 + c]).toBe(255);
      }
    }
    // Sloping off steadily: never more than a metre further a metre further out.
    for (let x = -28; x < -20; x += 0.5) {
      const step = distanceIn(field, x + 1, 3) - distanceIn(field, x, 3);
      expect(Math.abs(step)).toBeLessThanOrEqual(1.05);
    }
    field.texture.dispose();
  });

  it('rings what stands in the sea by its own outline, apart from the shore', () => {
    // A mooring post out in the sea, with something wholly above the water by it.
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 3, 24));
    post.position.set(-26, island.sea!, 0);
    const above = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    above.position.set(-26, island.sea! + 2, 4);
    const plain = shoreField(island, [])!;
    const field = shoreField(island, [post, above])!;
    expect(distanceIn(field, -26, 0)).toBeGreaterThan(2.5);
    // Its foam round its foot, and none round the thing above the water.
    expect(distanceIn(field, -26 + 0.3, 0, 2)).toBeLessThan(0.1);
    // To within a texel or so.
    expect(Math.abs(distanceIn(field, -26, 1.3, 2) - 1)).toBeLessThan(0.15);
    expect(distanceIn(field, -26, 4, 2)).toBeGreaterThan(3);
    // The shore's own distances as they were.
    for (const [x, z] of [
      [-26, 0],
      [-27, 2],
      [-29, 0],
    ])
      expect(distanceIn(field, x!, z!)).toBe(distanceIn(plain, x!, z!));
    // With nothing standing in it, nothing to ring.
    const image = plain.texture.image as { data: Uint8Array };
    expect(image.data.filter((_, k) => k % 4 === 2).every((b) => b === 255)).toBe(true);
    field.texture.dispose();
    plain.texture.dispose();
  });

  it("rings the level's rocks and posts in the sea without their models", () => {
    const field = shoreField(island)!;
    const { data } = field.texture.image as { data: Uint8Array };
    expect(data.filter((_, k) => k % 4 === 2).some((b) => b === 0)).toBe(true);
    field.texture.dispose();
  });

  it('finds where a mesh crosses the waterline', () => {
    const group = new THREE.Group();
    group.position.set(2, 0, 3);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2, 16));
    post.scale.set(2, 1, 1);
    group.add(post);
    const high = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    high.position.y = 5;
    group.add(high);
    const marks: [number, number][] = [];
    waterline(group, 0.2, (x, z) => marks.push([x, z]));
    expect(marks.length).toBeGreaterThan(32);
    const sectors = new Set<number>();
    for (const [x, z] of marks) {
      // On the stretched post's outline, an oval a metre along x and half one along z.
      const r = Math.hypot((x - 2) / 1, (z - 3) / 0.5);
      expect(r).toBeGreaterThan(0.97);
      expect(r).toBeLessThanOrEqual(1.0001);
      sectors.add(Math.floor(((Math.atan2(z - 3, x - 2) + Math.PI) / (2 * Math.PI)) * 16) % 16);
    }
    // All the way round it.
    expect(sectors.size).toBe(16);
    // And nothing where it does not reach.
    const none: unknown[] = [];
    waterline(group, 4, () => none.push(1));
    expect(none).toHaveLength(0);
  });

  it("passes over a lantern's pool of light draped down under the water", () => {
    const group = new THREE.Group();
    // A pool tilted across the waterline, as one lies over a shore shelving into the sea.
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 6, 12, 12).rotateX(-Math.PI / 2).rotateZ(0.2),
      tagged(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }), GLOW_POOL),
    );
    group.add(pool);
    const none: unknown[] = [];
    waterline(group, 0, () => none.push(1));
    expect(none).toHaveLength(0);
    // Solid, the same would be ringed with foam.
    pool.material = new THREE.MeshBasicMaterial();
    waterline(group, 0, () => none.push(1));
    expect(none.length).toBeGreaterThan(0);
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
