import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { MAP_IDS } from '../content/maps/index.ts';
import type { MapId } from '../content/maps/index.ts';
import { makeRng, v3, yawQuat } from '../math.ts';
import type { Vec3 } from '../math.ts';
import { Room } from '../net/room.ts';
import { NavGrid } from './nav.ts';
import type { PathCosts, Plate } from './nav.ts';
import { loadNavCore } from './navcore.ts';

/** Each map's walking map twice: worked out in JavaScript, and in WebAssembly. */
const grids = new Map<MapId, { js: NavGrid; wasm: NavGrid }>();

beforeAll(async () => {
  await RAPIER.init();
  const sims = MAP_IDS.map((map) => {
    const room = new Room(RAPIER, { code: 'NAV', send: () => {}, seed: 3 });
    room.map = map;
    room.addBot('normal');
    room.addBot('normal');
    room.startRound();
    // A first tick puts the world's colliders where the walking map looks for them.
    room.update();
    return [map, room.sim] as const;
  });
  // Made before the module is loaded, these search in JavaScript.
  const js = sims.map(([map, sim]) => [map, new NavGrid(RAPIER, sim)] as const);
  await loadNavCore();
  for (const [map, grid] of js) {
    grids.set(map, { js: grid, wasm: new NavGrid(RAPIER, sims.find((s) => s[0] === map)![1]) });
  }
}, 120_000);

describe('the walking map in WebAssembly', () => {
  it('is in use once loaded', () => {
    for (const { js, wasm } of grids.values()) {
      expect((js as unknown as { core: unknown }).core).toBeNull();
      expect((wasm as unknown as { core: unknown }).core).not.toBeNull();
    }
  });

  it.each(MAP_IDS)('finds the same ways, to the last bit, on the %s map', (map) => {
    const { js, wasm } = grids.get(map)!;
    const rand = makeRng(7);
    const pick = () => Math.floor(rand() * js.size);
    const near = (n: number, r: number): Vec3 => {
      const p = js.pos(n);
      return v3(p.x + (rand() - 0.5) * r, p.y + (rand() - 0.5) * 0.4, p.z + (rand() - 0.5) * r);
    };
    let found = 0;
    for (let i = 0; i < 60; i++) {
      const from = pick();
      const goals = Array.from({ length: 1 + Math.floor(rand() * 4) }, pick);
      const plates: (Plate | null)[] = [null];
      for (let k = 0; k < 3; k++) {
        plates.push({
          centre: near(pick(), 0),
          inv: yawQuat(rand() * Math.PI * 2),
          hw: 0.5 + rand() * 1.5,
          hd: 0.5 + rand() * 1.5,
        });
      }
      const costs: PathCosts | undefined =
        i % 5 === 0
          ? undefined
          : {
              blocked: Array.from({ length: Math.floor(rand() * 40) }, pick),
              others: Array.from({ length: Math.floor(rand() * 8) }, () => near(pick(), 1)),
              plates,
              loose: Array.from({ length: Math.floor(rand() * 60) }, () => near(pick(), 0.6)),
              trip: rand() < 0.5 ? 1 : 6,
            };
      const a = js.path(from, goals, costs);
      expect(wasm.path(from, goals, costs)).toEqual(a);
      if (a) found++;
      for (let k = 0; k < 10; k++) {
        const p = near(pick(), 0.3);
        const q = rand() < 0.5 ? near(pick(), 0.3) : near(from, 6);
        expect(wasm.straight(p, q)).toBe(js.straight(p, q));
        expect(wasm.crossesPlate(plates, p, q)).toBe(js.crossesPlate(plates, p, q));
      }
    }
    // Most of them lead somewhere, so the ways themselves were compared.
    expect(found).toBeGreaterThan(20);
  });
});
