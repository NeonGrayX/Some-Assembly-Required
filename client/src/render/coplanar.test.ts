import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { BRICK_TYPES, FACES, GEAR_IDS, HATS, HOUSE, MAPS, SHIRTS, houseLayout } from '@sar/shared';
import type { BrickTypeId, LevelDef } from '@sar/shared';

/**
 * Builds every model the way the view does, unmerged, and checks that no two surfaces that
 * look different lie on top of each other: two faces in one plane, facing the same way, flicker
 * through each other on screen as the camera moves ("z-fighting"). Faces that look the same
 * (one colour and finish) may meet in a plane, as where a shelf meets the side it stands in:
 * nothing shows.
 */

// Merged, a level is a few big meshes: kept apart, every piece can be told from the next.
vi.mock('./merge.ts', async (orig) => ({ ...(await orig<object>()), mergeStatic: () => {} }));

beforeAll(() => {
  // Signs and screens are drawn on canvases: a stand-in that draws nothing will do.
  const ctx = new Proxy({}, { get: () => () => ({ addColorStop() {}, width: 100 }) });
  Object.assign(globalThis, {
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) },
  });
});

const look = (m: THREE.Mesh) => {
  const q = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
  return `${q.color?.getHex()}/${q.roughness}/${q.metalness}`;
};

const where = (m: THREE.Mesh) => {
  const p = m.getWorldPosition(new THREE.Vector3());
  return `${m.geometry.type} at ${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`;
};

/** The pairs of differently drawn meshes with faces on top of each other. */
async function fightsIn(meshes: THREE.Mesh[], name: (m: THREE.Mesh) => string, ground?: number) {
  const { coplanarFights } = await import('./coplanar.ts');
  // A square centimetre or more: smaller patches only ever show as a stray pixel.
  return coplanarFights(meshes, { minArea: 1e-4, ground })
    .filter((f) => look(f.a) !== look(f.b))
    .map((f) => `${name(f.a)} (${where(f.a)}) and ${name(f.b)} (${where(f.b)})`);
}

const LEVELS: [string, () => LevelDef][] = [
  ['the hand-made house', () => HOUSE],
  ...[11, 222, 3333].map(
    (seed) =>
      [`the house furnished for seed ${seed}`, () => houseLayout(seed)] as [string, () => LevelDef],
  ),
  ...MAPS.filter((m) => m.id !== 'house').flatMap((m) =>
    [1, 7].map(
      (seed) =>
        [`${m.name} laid out for seed ${seed}`, () => m.layout(seed)] as [string, () => LevelDef],
    ),
  ),
];

describe('no two surfaces are drawn in one place', () => {
  it.each(LEVELS)('in %s, shut and open', { timeout: 120000 }, async (_, level) => {
    const { buildLevelModels } = await import('./scene.ts');
    const { solidMeshes } = await import('./coplanar.ts');
    const lm = buildLevelModels(level());
    for (const open of [0, 1]) {
      if (open) lm.open(open);
      // Undersides lying on the ground are never seen.
      const found = await fightsIn(solidMeshes(lm.root), lm.owner, 0);
      expect(found, open ? 'every hiding place open' : 'shut').toEqual([]);
    }
  });

  it('on the players, whatever they wear', { timeout: 120000 }, async () => {
    const { makeAvatar } = await import('./avatar.ts');
    const { wearGear } = await import('./gear.ts');
    const { solidMeshes } = await import('./coplanar.ts');
    const found: string[] = [];
    for (const hat of HATS)
      for (const face of FACES)
        for (const shirt of SHIRTS) {
          const a = makeAvatar(0x2e86de, null, { hat: hat.id, face: face.id, shirt: shirt.id });
          for (const g of GEAR_IDS) wearGear(a, g);
          const name = `${hat.id}, ${face.id}, ${shirt.id}`;
          found.push(...(await fightsIn(solidMeshes(a.group), () => name)));
        }
    expect(found).toEqual([]);
  });

  it('on the gear, the dog, the broom and the bricks', async () => {
    const { makeGearProp } = await import('./gear.ts');
    const { DogView } = await import('./dog.ts');
    const { BroomView } = await import('./broom.ts');
    const { brickGeometry, brickMaterial } = await import('./bricks.ts');
    const { solidMeshes } = await import('./coplanar.ts');
    const models: [string, THREE.Object3D][] = [
      ...GEAR_IDS.map((g) => [g, makeGearProp(g)] as [string, THREE.Object3D]),
      ['dog', new DogView().group],
      ['broom', new BroomView().group],
      ...(Object.keys(BRICK_TYPES) as BrickTypeId[]).map(
        (t) =>
          [`brick ${t}`, new THREE.Mesh(brickGeometry(t), brickMaterial('red'))] as [
            string,
            THREE.Object3D,
          ],
      ),
    ];
    const found: string[] = [];
    for (const [name, o] of models) found.push(...(await fightsIn(solidMeshes(o), () => name)));
    expect(found).toEqual([]);
  });

  it('notices two surfaces in one place', async () => {
    const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    const b = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xff0000 }),
    );
    // Its front face in the big box's front face.
    b.position.set(0, 0, 0.25);
    const g = new THREE.Group().add(a, b);
    const { solidMeshes } = await import('./coplanar.ts');
    expect(await fightsIn(solidMeshes(g), () => 'box')).toHaveLength(1);
    b.position.z = 0.26;
    expect(await fightsIn(solidMeshes(g), () => 'box')).toHaveLength(0);
  });
});
