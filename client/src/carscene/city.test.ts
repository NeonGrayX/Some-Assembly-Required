import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CHEVRON_HALF } from './chevronLayout.ts';
import { buildCity } from './city.ts';

/**
 * The town round Chevron Street is scenery only, kept out of the map and cheap to draw: checked
 * on a level of one team and on a rival teams' level, its second copy across the line z = -16.
 */
describe('the town round Chevron Street', () => {
  const cities = { single: buildCity(null), rival: buildCity(-CHEVRON_HALF) };

  for (const [name, city] of Object.entries(cities)) {
    const meshes: THREE.Mesh[] = [];
    city.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });

    it(`${name}: casts and takes no shadows, and nothing aims at it`, () => {
      for (const m of meshes) {
        expect(m.castShadow || m.receiveShadow).toBe(false);
        const hits: THREE.Intersection[] = [];
        m.raycast(new THREE.Raycaster(), hits);
        expect(hits).toHaveLength(0);
      }
    });

    it(`${name}: is drawn in few calls and triangles`, () => {
      const triangles = meshes.reduce(
        (n, m) => n + (m.geometry.index?.count ?? m.geometry.attributes.position!.count) / 3,
        0,
      );
      expect(meshes.length).toBeLessThan(name === 'rival' ? 200 : 120);
      expect(triangles).toBeLessThan(name === 'rival' ? 900_000 : 600_000);
    });

    it(`${name}: stands nowhere in the map`, () => {
      // The map's squares: its one copy, or both either side of the dividing line.
      const maps = name === 'rival' ? [0, -2 * CHEVRON_HALF] : [0];
      const p = new THREE.Vector3();
      for (const m of meshes) {
        const pos = m.geometry.attributes.position!;
        for (let i = 0; i < pos.count; i++) {
          p.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          // (The ground's painted layers lie flat, their edges brushed out under the map's.)
          if (p.y < 0.01) continue;
          const inside = maps.some(
            (z) => Math.abs(p.x) < CHEVRON_HALF - 0.01 && Math.abs(p.z - z) < CHEVRON_HALF - 0.01,
          );
          if (inside) expect.fail(`${m.parent?.name} has a corner in the map at ${p.toArray()}`);
        }
      }
    });
  }

  it('keeps its painted textures within what every GPU takes', () => {
    const seen = new Set<THREE.Texture>();
    cities.rival.traverse((o) => {
      const m = (o as THREE.Mesh).material as
        (THREE.MeshStandardMaterial & Partial<THREE.ShaderMaterial>) | undefined;
      for (const t of [m?.map, m?.emissiveMap, m?.uniforms?.map?.value])
        if (t) seen.add(t as THREE.Texture);
    });
    for (const t of seen) {
      const { width, height } = t.image as { width: number; height: number };
      expect(Math.max(width, height)).toBeLessThanOrEqual(4096);
    }
  });
});
