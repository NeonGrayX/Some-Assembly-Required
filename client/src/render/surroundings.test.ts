import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MAPS, floorRect, levelFor, rivalLevel } from '@sar/shared';
import { MAX_SEA_ROCKS, SEA_ROCKS, patchStyle } from './styles.ts';
import type { SeaRock } from './styles.ts';
import { buildSurroundings, sceneryOf, untextured } from './surroundings.ts';
import { landRect, seabedHeight } from './terrain.ts';

const meshesOf = (g: THREE.Group) => {
  const out: THREE.Mesh[] = [];
  g.traverse((o) => o instanceof THREE.Mesh && out.push(o));
  return out;
};

describe('the country round a level', () => {
  it('is like the place each map is', () => {
    const kinds = MAPS.map((m) => sceneryOf(m.layout(1)));
    expect(kinds).toEqual(['suburb', 'industry', 'farmland', 'forest', 'sea']);
  });

  for (const map of MAPS) {
    it(`round the ${map.id} stays out past the fence, in a few cheap meshes`, () => {
      const level = map.layout(1);
      const group = buildSurroundings(level);
      const meshes = meshesOf(group);
      expect(meshes.length).toBeLessThanOrEqual(3);
      const triangles = meshes.reduce((n, m) => n + m.geometry.attributes.position!.count / 3, 0);
      expect(triangles).toBeLessThan(20000);
      const r = floorRect(level);
      for (const mesh of meshes) {
        expect(mesh.castShadow || mesh.receiveShadow).toBe(false);
        // Nothing to aim at.
        const hits: THREE.Intersection[] = [];
        mesh.raycast(new THREE.Raycaster(), hits);
        expect(hits).toHaveLength(0);
        // Nothing of it stands over the level.
        const pos = mesh.geometry.attributes.position!;
        for (let i = 0; i < pos.count; i++) {
          const [x, z] = [pos.getX(i), pos.getZ(i)];
          const inside = x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
          expect(inside, `${map.id} at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBe(false);
        }
      }
    });
  }

  it('notes the rocks standing out of the sea, nearest first, for the sea to ring with foam', () => {
    const island = levelFor('island', 1);
    const rocks = buildSurroundings(island).userData[SEA_ROCKS] as SeaRock[];
    expect(rocks.length).toBeGreaterThan(3);
    const r = floorRect(island);
    const [cx, cz] = [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2];
    let last = 0;
    for (const rock of rocks.slice(0, MAX_SEA_ROCKS)) {
      // Out past the level, in water deep enough for them.
      expect(rock.x < r.x0 || rock.x > r.x1 || rock.z < r.z0 || rock.z > r.z1).toBe(true);
      expect(seabedHeight(island, landRect(island), rock.x, rock.z)).toBeLessThan(island.sea! - 1);
      expect(rock.a).toBeGreaterThan(0.3);
      expect(rock.b).toBeGreaterThan(0.3);
      const d = Math.hypot(rock.x - cx, rock.z - cz);
      expect(d).toBeGreaterThanOrEqual(last - 1);
      last = d;
    }
    // None round a map without a sea.
    const house = buildSurroundings(MAPS[0]!.layout(1)).userData[SEA_ROCKS] as SeaRock[];
    expect(house ?? []).toHaveLength(0);
  });

  it("is painted plain, with the style's textures out of its shader", () => {
    const land = meshesOf(buildSurroundings(MAPS[0]!.layout(1)))[0]!.material as THREE.Material;
    // As three.js hands it to `onBeforeCompile`, styled as `graphics.ts` does.
    const { vertexShader, fragmentShader } = THREE.ShaderLib.physical;
    const shader = { vertexShader, fragmentShader, uniforms: {}, defines: {} } as never;
    patchStyle(shader, land);
    const styled = (shader as THREE.WebGLProgramParametersWithUniforms).fragmentShader;
    expect(styled).toMatch(/= styleDetail\(/);
    const plain = untextured(styled);
    expect(plain).not.toMatch(/= styleDetail\(/);
    expect(plain).toMatch(/StyleDetail styleD = StyleDetail\(/);
  });

  it('is built the same every time, and round both yards of a rival level', () => {
    const level = MAPS.find((m) => m.id === 'camp')!.layout(1);
    const a = meshesOf(buildSurroundings(level))[0]!.geometry.attributes.position!;
    const b = meshesOf(buildSurroundings(level))[0]!.geometry.attributes.position!;
    expect(a.array).toEqual(b.array);
    const rival = rivalLevel(level);
    const r = floorRect(rival);
    const pos = meshesOf(buildSurroundings(rival))[0]!.geometry.attributes.position!;
    for (let i = 0; i < pos.count; i += 7) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      expect(x <= r.x0 + 0.01 || x >= r.x1 - 0.01 || z <= r.z0 + 0.01 || z >= r.z1 - 0.01).toBe(
        true,
      );
    }
  });
});
