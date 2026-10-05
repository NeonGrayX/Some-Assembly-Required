import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HOUSE } from '@sar/shared';
import { HOUSE_WINDOWS, addHouseDetails, roomSides } from './details.ts';

describe('house details', () => {
  it('finds the front door and both inner doorways, and trims every room on four sides', () => {
    const sides = roomSides(HOUSE);
    expect(sides).toHaveLength(12);
    const doorways = sides.flatMap((s) =>
      s.doorways.map((d) => `${s.alongX ? 'z' : 'x'}=${s.face} ${d.from}..${d.to}`),
    );
    expect(doorways.sort()).toEqual([
      'x=-3.9 9..11',
      'x=-4.1 9..11',
      'x=3.9 9..11',
      'x=4.1 9..11',
      'z=6.1 -1..1',
    ]);
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
      // Nothing reaches into the walkable part of a doorway (lining boards are 2 cm thin).
      const blocksFront = bounds.max.x > -0.98 && bounds.min.x < 0.98 && bounds.min.z < 6.1;
      const blocksInner =
        Math.abs(bounds.min.x) < 4.15 &&
        Math.abs(bounds.max.x) > 3.85 &&
        bounds.max.z > 9.02 &&
        bounds.min.z < 10.98;
      expect(blocksFront && bounds.max.z > 5.9).toBe(false);
      expect(blocksInner).toBe(false);
    });
    // Seven windows are seven glass panes on each side of their wall.
    let panes = 0;
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh && (o.material as THREE.MeshStandardMaterial).emissive.getHex())
        panes++;
    });
    expect(panes).toBe(HOUSE_WINDOWS.length * 2);
    expect(meshes).toBeGreaterThan(0);
  });
});
