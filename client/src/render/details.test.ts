import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HOUSE } from '@sar/shared';
import type { LevelDef } from '@sar/shared';
import {
  HOUSE_WINDOWS,
  addHouseDetails,
  cutWindows,
  levelWindows,
  rectMinusHoles,
  roomSides,
  windowOpenings,
} from './details.ts';

describe('house details', () => {
  it('finds the front door and every inner doorway, and trims every room on four sides', () => {
    const sides = roomSides(HOUSE);
    // Four sides to each of the six rooms, the basement's with no doorway.
    expect(sides).toHaveLength(24);
    const doorways = sides.flatMap((s) =>
      s.doorways.map(
        (d) => `${s.floor ? 'upstairs ' : ''}${s.alongX ? 'z' : 'x'}=${s.face} ${d.from}..${d.to}`,
      ),
    );
    expect(doorways.sort()).toEqual([
      'upstairs x=-3.9 9..11',
      'upstairs x=-4.1 9..11',
      // Out onto the roof.
      'upstairs x=3.9 9..11',
      'x=-3.9 9..11',
      'x=-4.1 9..11',
      'x=3.9 9..11',
      'x=4.1 9..11',
      'z=6.1 -1..1',
    ]);
    // Every doorway is as tall as the gap under the header over it.
    expect(new Set(sides.flatMap((s) => s.doorways.map((d) => d.height)))).toEqual(new Set([2.2]));
  });

  it('places every window on a wall and leaves the doorways clear', () => {
    const scene = new THREE.Scene();
    addHouseDetails(scene, HOUSE, HOUSE_WINDOWS);
    const bounds = new THREE.Box3();
    let meshes = 0;
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      meshes++;
      bounds.setFromObject(o);
      // Nothing reaches into the walkable part of a doorway, below its header (lining boards
      // are 2 cm thin). The basement under the break room has none.
      if (bounds.min.y > 2.15 || bounds.max.y < 0) return;
      const blocksFront = bounds.max.x > -0.98 && bounds.min.x < 0.98 && bounds.min.z < 6.1;
      const blocksInner =
        Math.abs(bounds.min.x) < 4.15 &&
        Math.abs(bounds.max.x) > 3.85 &&
        bounds.max.z > 9.02 &&
        bounds.min.z < 10.98;
      expect(blocksFront && bounds.max.z > 5.9).toBe(false);
      expect(blocksInner).toBe(false);
    });
    // Seven windows are seven see-through panes, which let the sun by.
    let panes = 0;
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh && (o.material as THREE.MeshStandardMaterial).transparent) {
        panes++;
        expect(o.castShadow).toBe(false);
      }
    });
    expect(panes).toBe(HOUSE_WINDOWS.length);
    expect(meshes).toBeGreaterThan(0);
  });

  it('cuts a hole through the wall behind every window, and leaves the rest of the wall', () => {
    const openings = windowOpenings(HOUSE, HOUSE_WINDOWS);
    expect(openings).toHaveLength(HOUSE_WINDOWS.length);
    const volume = (b: { size: { x: number; y: number; z: number } }) =>
      b.size.x * b.size.y * b.size.z;
    for (const wall of new Set(openings.map((o) => o.wall))) {
      const holes = openings.filter((o) => o.wall === wall);
      const pieces = cutWindows(wall, openings);
      const removed = holes.reduce((v, o) => v + (o.to - o.from) * (o.top - o.bottom), 0);
      const thickness = holes[0]!.thickness;
      expect(pieces.reduce((v, p) => v + volume(p), 0)).toBeCloseTo(
        volume(wall) - removed * thickness,
      );
      // No piece reaches into a hole.
      for (const p of pieces)
        for (const o of holes) {
          const along = o.alongX ? p.pos.x : p.pos.z;
          const half = (o.alongX ? p.size.x : p.size.z) / 2;
          const overlaps =
            along - half < o.to - 1e-6 &&
            along + half > o.from + 1e-6 &&
            p.pos.y - p.size.y / 2 < o.top - 1e-6 &&
            p.pos.y + p.size.y / 2 > o.bottom + 1e-6;
          expect(overlaps).toBe(false);
        }
    }
    // Walls without windows stay whole.
    const plain = HOUSE.boxes.find((b) => !openings.some((o) => o.wall === b))!;
    expect(cutWindows(plain, openings)).toEqual([plain]);
  });

  it('covers a rectangle except its holes', () => {
    const rect = { u0: 0, u1: 10, v0: 0, v1: 4 };
    const holes = [
      { u0: 2, u1: 3, v0: 1, v1: 2 },
      { u0: 6, u1: 8, v0: 1.5, v1: 5 },
    ];
    const pieces = rectMinusHoles(rect, holes);
    const area = (r: typeof rect) => (r.u1 - r.u0) * (r.v1 - r.v0);
    expect(pieces.reduce((a, r) => a + area(r), 0)).toBeCloseTo(40 - 1 - 2 * 2.5);
    expect(rectMinusHoles(rect, [])).toEqual([rect]);
  });

  it("takes the level's own windows over the default ones", () => {
    expect(levelWindows(HOUSE)).toBe(HOUSE_WINDOWS);
    const moved = { ...HOUSE, windows: [{ x: -2, z: 15, alongX: true }] };
    const [o, ...rest] = windowOpenings(moved, levelWindows(moved));
    expect(rest).toHaveLength(0);
    expect([o!.from, o!.to, o!.centre]).toEqual([-2.65, -1.35, 15]);
  });

  it('stands the doors open on the side the level says', () => {
    // Where the door panels (and nothing else of the trim) are drawn, by colour.
    const doorsOf = (level: LevelDef) => {
      const scene = new THREE.Scene();
      addHouseDetails(scene, level, []);
      scene.updateMatrixWorld(true);
      const boxes: THREE.Box3[] = [];
      scene.traverse((o) => {
        if (
          o instanceof THREE.Mesh &&
          (o.material as THREE.MeshStandardMaterial).color.getHex() === 0xa8774c
        )
          boxes.push(new THREE.Box3().setFromObject(o));
      });
      return boxes;
    };
    const centre = (b: THREE.Box3) => b.getCenter(new THREE.Vector3());
    // By default into the house: the front doors inside, north of the wall.
    const front = (bs: THREE.Box3[]) => bs.filter((b) => Math.abs(centre(b).z - 6) < 0.3);
    expect(front(doorsOf(HOUSE)).map((b) => centre(b).z > 6)).toEqual([true, true]);
    const turned = doorsOf({
      ...HOUSE,
      doors: [
        { x: 0, z: 6, opensTo: -1 },
        { x: -4, z: 10, opensTo: 1 },
        { x: 4, z: 10, opensTo: -1 },
      ],
    });
    // Upstairs, the doorways' doors stand open into the rooms, as the level says nothing.
    expect(turned.filter((b) => centre(b).y > 2.8)).toHaveLength(4);
    turned.splice(0, turned.length, ...turned.filter((b) => centre(b).y < 2.8));
    expect(turned).toHaveLength(6);
    // Out into the yard, and into the living room through both inner doorways.
    expect(front(turned).map((b) => centre(b).z < 6)).toEqual([true, true]);
    const inner = turned.filter((b) => Math.abs(centre(b).z - 6) >= 0.3);
    for (const b of inner) expect(Math.abs(centre(b).x)).toBeLessThan(4);
    // Flat against the wall, beside the opening, never in it.
    for (const b of inner) expect(b.max.z <= 9.01 || b.min.z >= 10.99).toBe(true);
  });
});
