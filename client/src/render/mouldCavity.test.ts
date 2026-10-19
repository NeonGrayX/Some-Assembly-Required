import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { brickGeometry } from './bricks.ts';
import { mouldTop, posedInMould } from './mouldCavity.ts';

/** How deep the cavity's floor is under (`x`, `z`) on the face, looking straight down into it. */
function depthAt(top: ReturnType<typeof mouldTop>, x: number, z: number): number {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 1, z), new THREE.Vector3(0, -1, 0));
  const hits = ray.intersectObjects([
    new THREE.Mesh(top.face, new THREE.MeshBasicMaterial()),
    new THREE.Mesh(top.cavity, new THREE.MeshBasicMaterial()),
  ]);
  return -hits[0]!.point.y;
}

describe('a mould', () => {
  const part = posedInMould(brickGeometry('2x4'), 0.3, 0.1, 0.3);
  part.computeBoundingBox();
  const size = part.boundingBox!.getSize(new THREE.Vector3());
  const top = mouldTop(part, 0.4, 0.4, 0.12);

  it('poses a brick upright, as big as fits', () => {
    expect(size.y).toBeCloseTo(0.1, 5);
    expect(Math.max(size.x, size.z)).toBeLessThanOrEqual(0.3);
  });

  it('sinks the part into its face as deep as the part is tall, its studs as holes', () => {
    expect(top.depth).toBeCloseTo(size.y, 3);
    // Flat round the cavity, down at its floor, and further down in a stud's hole.
    expect(depthAt(top, 0.19, 0.19)).toBeCloseTo(0, 5);
    const k = size.y / brickGeometry('2x4').boundingBox!.getSize(new THREE.Vector3()).y;
    const [studX, studZ] = size.x > size.z ? [0.15 * k, 0.05 * k] : [0.05 * k, 0.15 * k];
    const floor = depthAt(top, 0, 0);
    expect(floor).toBeGreaterThan(0.05);
    expect(depthAt(top, studX, studZ)).toBeGreaterThan(floor + 0.005);
  });
});
