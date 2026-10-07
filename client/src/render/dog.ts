import * as THREE from 'three';
import { DOG_HALF_HEIGHT, DOG_RADIUS } from '@sar/shared';
import type { Dog } from '@sar/shared';
import { CONTACT } from './graphics.ts';

const FUR = 0xb07a45;
const DARK = 0x5b3a1e;
/** Leg cycle per metre: one step of each leg about every 0.9 m. */
const STRIDE = 7;

const box = (x: number, y: number, z: number, colour: number) => {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(x, y, z),
    new THREE.MeshStandardMaterial({ color: colour, roughness: 0.85 }),
  );
  m.castShadow = true;
  return m;
};

/**
 * The house dog: a low-poly dog with ears, a tail and four legs that move as it walks. It
 * sits on its haunches when it sits or begs, wags when begging or following, and carries a
 * page sideways in its mouth. Front is -z, like players.
 */
export class DogView {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private readonly tail: THREE.Group;
  private readonly page: THREE.Mesh;
  private phase = 0;
  private last: THREE.Vector3 | null = null;
  private sit = 0;
  private amp = 0;

  constructor() {
    // Paws on the floor: the body's centre is this far below the collider's.
    this.group.add(this.body);
    this.body.position.y = -(DOG_RADIUS + DOG_HALF_HEIGHT);
    const torso = box(0.26, 0.22, 0.56, FUR);
    torso.position.y = 0.36;
    this.body.add(torso);
    const head = new THREE.Group();
    head.position.set(0, 0.52, -0.3);
    const skull = box(0.22, 0.2, 0.22, FUR);
    const snout = box(0.12, 0.1, 0.14, FUR);
    snout.position.set(0, -0.04, -0.15);
    const nose = box(0.05, 0.04, 0.03, 0x111111);
    nose.position.set(0, -0.01, -0.23);
    head.add(skull, snout, nose);
    for (const side of [-1, 1]) {
      const ear = box(0.05, 0.14, 0.09, DARK);
      ear.position.set(side * 0.12, 0.03, 0.02);
      ear.rotation.z = side * 0.25;
      head.add(ear);
    }
    this.page = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.008, 0.21),
      new THREE.MeshStandardMaterial({ color: 0xfbf8f0, roughness: 0.9 }),
    );
    // Held at the tip of the snout, sticking out on both sides.
    this.page.position.set(0, -0.07, -0.3);
    this.page.rotation.x = 0.15;
    this.page.castShadow = true;
    head.add(this.page);
    this.body.add(head);
    for (const [x, z] of [
      [-0.09, -0.2],
      [0.09, -0.2],
      [-0.09, 0.2],
      [0.09, 0.2],
    ] as const) {
      const hip = new THREE.Group();
      hip.position.set(x, 0.28, z);
      const leg = box(0.07, 0.28, 0.07, FUR);
      leg.position.y = -0.14;
      leg.userData[CONTACT] = { r: 0.05, y: -0.1 };
      hip.add(leg);
      this.body.add(hip);
      this.legs.push(hip);
    }
    this.tail = new THREE.Group();
    this.tail.position.set(0, 0.42, 0.27);
    const tail = box(0.04, 0.04, 0.22, DARK);
    tail.position.z = 0.1;
    this.tail.add(tail);
    this.tail.rotation.x = -0.5;
    this.body.add(this.tail);
  }

  /** Poses the dog where it is; call every frame. */
  update(dog: Dog, pos: { x: number; y: number; z: number }, dt: number, time: number): void {
    this.group.position.set(pos.x, pos.y, pos.z);
    this.group.rotation.y = dog.yaw;
    const moved = this.last ? Math.hypot(pos.x - this.last.x, pos.z - this.last.z) : 0;
    this.last = (this.last ?? new THREE.Vector3()).set(pos.x, pos.y, pos.z);
    if (moved < 0.5) this.phase += moved * STRIDE;
    // How far the legs swing follows the speed, smoothed so a late snapshot does not twitch it.
    const speed = moved / Math.max(dt, 1e-3);
    this.amp += (Math.min(1, speed / 4.6) - this.amp) * Math.min(1, dt * 5);
    const walking = Math.min(1, this.amp * 3);
    this.legs.forEach((leg, i) => {
      leg.rotation.x =
        Math.sin(this.phase + (i === 0 || i === 3 ? 0 : Math.PI)) *
        (0.25 + 0.4 * this.amp) *
        walking;
    });
    // Sitting (or begging) lowers the back end, smoothly.
    const sitting = dog.mode === 'sit' || dog.mode === 'beg';
    this.sit += ((sitting && walking < 0.2 ? 1 : 0) - this.sit) * Math.min(1, dt * 6);
    this.body.rotation.x = this.sit * 0.45;
    this.legs[2]!.rotation.x -= this.sit * 1.2;
    this.legs[3]!.rotation.x -= this.sit * 1.2;
    const happy = dog.mode === 'beg' || dog.mode === 'follow';
    this.tail.rotation.y = Math.sin(time * (happy ? 15 : 4)) * (happy ? 0.6 : 0.2);
    this.page.visible = dog.page !== null;
  }
}
