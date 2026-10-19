import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CAR_DOOR } from './doors.ts';
import { CLEAR, followCamera } from './followCam.ts';
import { HOUSE_BODY } from './house.ts';
import { MeshWalker } from './meshWalk.ts';
import { HOUSE_PLACE, INSPECTOR, buildCarScene } from './scene.ts';
import { carWalk, insidePart } from './walk.ts';

await RAPIER.init();
const scene = buildCarScene();
const walk = carWalk(scene);
const walker = new MeshWalker(
  RAPIER,
  [
    scene.car.root,
    scene.sports.root,
    scene.bus.root,
    scene.house,
    scene.bigHouse,
    scene.street,
    scene.machines,
    scene.site,
    ...scene.cones,
  ],
  (o) => o.name === CAR_DOOR || o.name === 'door',
);
const follower = followCamera(walk, walker);

/** Where (`x`, `y`, `z`) in the inspector's own axes is in the world (it stands unturned). */
const atInspector = (x: number, y: number, z: number) =>
  new THREE.Vector3(INSPECTOR.x + x, y, INSPECTOR.z + z);

/** Where (`x`, `y`, `z`) in the small house's own axes is in the world. */
function inHouse(x: number, y: number, z: number): THREE.Vector3 {
  const [c, s] = [Math.cos(HOUSE_PLACE.heading), Math.sin(HOUSE_PLACE.heading)];
  return new THREE.Vector3(HOUSE_PLACE.x + x * c + z * s, y, HOUSE_PLACE.z - x * s + z * c);
}

/** Whether the camera would clip at `p`: in a prop's part or touching a model's triangles. */
const clips = (p: THREE.Vector3) =>
  walk.props.some((part) => insidePart(part, p)) || walker.touches(p, CLEAR * 0.9);

const room = walk.rooms.find((r) => r.frame === scene.house)!;
const inRoom = (p: THREE.Vector3) =>
  room.box.containsPoint(p.clone().applyMatrix4(room.frame.matrixWorld.clone().invert()));

describe('the following camera on the car test map', () => {
  it('stays out behind the inspector’s arch when nothing is where it is', () => {
    // Beside the pad, the camera back under the arch's beam, between its legs, past the screen.
    const head = atInspector(1.5, 1.7, -1.0);
    const end = atInspector(-1.0, 2.0, 2.5);
    const dir = end.clone().sub(head).normalize();
    const far = end.distanceTo(head);
    expect(clips(end)).toBe(false);
    expect(follower.back(head, dir, far)).toBeCloseTo(far, 5);
  });

  it('comes in only as far as to be out of the arch’s leg, when it would be in it', () => {
    const head = atInspector(2.0, 1.6, 1.36);
    const dir = new THREE.Vector3(-1, 0, 0);
    const d = follower.back(head, dir, 2.0);
    expect(d).toBeLessThan(1.9);
    expect(d).toBeGreaterThan(1.4);
    expect(clips(head.clone().addScaledVector(dir, d))).toBe(false);
  });

  it('stays out behind a car between it and the player', () => {
    const box = new THREE.Box3().setFromObject(scene.car.root);
    const c = box.getCenter(new THREE.Vector3());
    const head = new THREE.Vector3(c.x, 1.6, box.min.z - 1.0);
    const dir = new THREE.Vector3(0, 0, 1);
    const far = box.max.z - box.min.z + 2.2;
    expect(clips(head.clone().addScaledVector(dir, far))).toBe(false);
    expect(follower.back(head, dir, far)).toBeCloseTo(far, 5);
  });

  it('stays inside the house with a player inside it, and outside with one outside', () => {
    const inside = inHouse(0.5, HOUSE_BODY.plinth + 1.55, 0.3);
    const along = new THREE.Vector3(
      Math.cos(HOUSE_PLACE.heading),
      -0.2,
      -Math.sin(HOUSE_PLACE.heading),
    );
    along.normalize();
    expect(inRoom(inside)).toBe(true);
    const d = follower.back(inside, along, 4.5);
    expect(d).toBeLessThan(4.5);
    expect(inRoom(inside.clone().addScaledVector(along, d))).toBe(true);
    // Out past the gable, looking at the house: the camera stays out of it.
    const outside = inHouse(HOUSE_BODY.depth + 2.5, 1.7, 0.3);
    const back = along.clone().negate();
    expect(inRoom(outside)).toBe(false);
    const e = follower.back(outside, back, 4.5);
    expect(e).toBeLessThan(4.5);
    expect(inRoom(outside.clone().addScaledVector(back, e))).toBe(false);
  });
});
