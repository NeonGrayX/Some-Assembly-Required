import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DOG_HALF_HEIGHT, DOG_RADIUS } from '@sar/shared';
import type { Dog } from '@sar/shared';

const FUR = 0xb07a45;
const DARK = 0x5b3a1e;
/** Its muzzle, chest and paws. */
const PALE = 0xe0bf8c;
/** Leg cycle per metre: one step of each leg about every 0.9 m. */
const STRIDE = 7;

const material = (colour: number, roughness = 0.85) =>
  new THREE.MeshStandardMaterial({ color: colour, roughness });
const FUR_M = material(FUR);
const DARK_M = material(DARK);
const PALE_M = material(PALE);
const BLACK_M = material(0x111111, 0.35);
/** Fur, dark or pale, in the vertices' colours: what `fuse` makes of them. */
const COAT_M = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.85,
  vertexColors: true,
});

const part = (geometry: THREE.BufferGeometry, m: THREE.Material, shadow = true) => {
  const mesh = new THREE.Mesh(geometry, m);
  mesh.castShadow = shadow;
  return mesh;
};
/**
 * Bakes the fur parts that move together into one mesh, their colours into its vertices, so
 * the dog is a handful of draw calls (and as many in the shadow map) rather than dozens.
 */
const fuse = (...parts: THREE.Mesh[]) => {
  const geometries = parts.map((p) => {
    p.updateMatrix();
    const g = p.geometry.clone().applyMatrix4(p.matrix);
    const c = (p.material as THREE.MeshStandardMaterial).color;
    const colours = new Float32Array(g.attributes.position!.count * 3);
    for (let i = 0; i < colours.length; i += 3) colours.set([c.r, c.g, c.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    return g;
  });
  return part(mergeGeometries(geometries)!, COAT_M);
};
/** A rounded bar `length` long along z, `r` thick. */
const capsule = (r: number, length: number, m: THREE.Material) =>
  part(
    new THREE.CapsuleGeometry(r, Math.max(0.001, length - 2 * r), 4, 10).rotateX(Math.PI / 2),
    m,
  );
const ball = (r: number, m: THREE.Material, sx = 1, sy = 1, sz = 1) =>
  part(new THREE.SphereGeometry(r, 12, 8).scale(sx, sy, sz), m);

/**
 * The house dog: a rounded, short-haired dog with a paler muzzle, chest and paws, floppy ears,
 * a red collar with a tag, a tail and four legs that move as it walks. It
 * sits on its haunches when it sits or begs, rears up on its hind legs when it jumps at the
 * corkboard, wags when begging or following, and carries a page sideways in its mouth. Being
 * patted, it sits, wags hard, shuts its eyes, folds its ears back and tilts its head into the
 * hand. Front is -z, like players.
 */
export class DogView {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private readonly tail: THREE.Group;
  private readonly page: THREE.Mesh;
  private readonly head = new THREE.Group();
  private readonly ears: THREE.Mesh[] = [];
  private readonly eyes: THREE.Mesh[] = [];
  private phase = 0;
  private last: THREE.Vector3 | null = null;
  private sit = 0;
  /** How far it is up on its hind legs, 0 to 1. */
  private rear = 0;
  private amp = 0;
  /** How much it leans into being patted (0..1). */
  private bliss = 0;

  constructor() {
    // Paws on the floor: the body's centre is this far below the collider's.
    this.group.add(this.body);
    this.body.position.y = -(DOG_RADIUS + DOG_HALF_HEIGHT);
    // The body, deeper at the chest, with a pale chest in front and the haunches behind.
    const torso = capsule(0.12, 0.54, FUR_M);
    torso.scale.set(1.05, 0.95, 1);
    torso.position.y = 0.37;
    const chest = ball(0.12, FUR_M, 1.05, 1.1, 1);
    chest.position.set(0, 0.35, -0.16);
    const bib = ball(0.09, PALE_M, 1, 1.2, 0.8);
    bib.position.set(0, 0.33, -0.235);
    const haunch = ball(0.12, FUR_M, 1.1, 1.05, 1);
    haunch.position.set(0, 0.37, 0.17);
    // The neck, up and forward to the head.
    const neck = part(new THREE.CylinderGeometry(0.075, 0.095, 0.2, 10), FUR_M);
    neck.position.set(0, 0.46, -0.24);
    neck.rotation.x = -0.6;
    const collar = part(new THREE.TorusGeometry(0.085, 0.016, 6, 16), material(0xc0392b, 0.5));
    collar.position.set(0, 0.45, -0.235);
    collar.rotation.x = Math.PI / 2 - 0.6;
    const brass = material(0xd4af37, 0.3);
    brass.metalness = 0.8;
    const tag = part(new THREE.CylinderGeometry(0.022, 0.022, 0.006, 10), brass);
    tag.position.set(0, 0.385, -0.29);
    tag.rotation.x = Math.PI / 2 - 0.3;
    this.body.add(fuse(torso, chest, bib, haunch, neck), collar, tag);

    const head = this.head;
    head.position.set(0, 0.54, -0.3);
    const skull = ball(0.105, FUR_M, 1, 0.92, 1.05);
    // The muzzle, paler, tapering to a rounded end and the nose.
    const snout = part(
      new THREE.CylinderGeometry(0.045, 0.065, 0.13, 10).rotateX(Math.PI / 2),
      PALE_M,
    );
    snout.position.set(0, -0.035, -0.12);
    const muzzleEnd = ball(0.046, PALE_M, 1, 0.95, 0.7);
    muzzleEnd.position.set(0, -0.035, -0.185);
    const jaw = ball(0.05, PALE_M, 1, 0.6, 1.3);
    jaw.position.set(0, -0.07, -0.1);
    const nose = ball(0.026, BLACK_M, 1.2, 0.85, 1);
    nose.position.set(0, -0.012, -0.21);
    head.add(fuse(skull, snout, muzzleEnd, jaw), nose);
    for (const side of [-1, 1]) {
      // Floppy ears hanging from the top of the head, turning about where they hang from.
      const ear = part(
        new THREE.SphereGeometry(0.06, 10, 8).scale(0.35, 1.25, 0.9).translate(0, -0.065, 0),
        DARK_M,
      );
      ear.position.set(side * 0.09, 0.06, 0.01);
      ear.rotation.z = side * 0.25;
      head.add(ear);
      this.ears.push(ear);
      const eye = part(new THREE.SphereGeometry(0.019, 10, 8), BLACK_M, false);
      eye.position.set(side * 0.048, 0.025, -0.088);
      head.add(eye);
      this.eyes.push(eye);
    }
    this.page = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.008, 0.21),
      new THREE.MeshStandardMaterial({ color: 0xfbf8f0, roughness: 0.9 }),
    );
    // Held at the tip of the snout, sticking out on both sides.
    this.page.position.set(0, -0.07, -0.26);
    this.page.rotation.x = 0.15;
    this.page.castShadow = true;
    head.add(this.page);
    this.body.add(head);
    for (const [x, z] of [
      [-0.075, -0.2],
      [0.075, -0.2],
      [-0.075, 0.2],
      [0.075, 0.2],
    ] as const) {
      const hip = new THREE.Group();
      hip.position.set(x, 0.3, z);
      // A thicker thigh at the top, the leg, and a pale paw on the floor.
      const back = z > 0;
      const thigh = ball(0.055, FUR_M, 0.9, 1.4, 1.1);
      thigh.position.y = back ? -0.02 : -0.03;
      const leg = part(new THREE.CylinderGeometry(0.034, 0.04, 0.26, 8), FUR_M);
      leg.position.y = -0.14;
      const paw = ball(0.038, PALE_M, 1, 0.6, 1.3);
      paw.position.set(0, -0.278, -0.012);
      hip.add(fuse(thigh, leg, paw));
      this.body.add(hip);
      this.legs.push(hip);
    }
    this.tail = new THREE.Group();
    this.tail.position.set(0, 0.43, 0.28);
    const tail = part(new THREE.CylinderGeometry(0.014, 0.03, 0.24, 8).rotateX(Math.PI / 2), FUR_M);
    tail.position.z = 0.11;
    const tip = ball(0.016, PALE_M);
    tip.position.z = 0.23;
    this.tail.add(fuse(tail, tip));
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
    // Sitting (or begging, or being patted) lowers the back end, smoothly.
    const patted = dog.mode === 'pat' && dog.patBy !== null;
    const sitting = dog.mode === 'sit' || dog.mode === 'beg' || patted;
    this.sit += ((sitting && walking < 0.2 ? 1 : 0) - this.sit) * Math.min(1, dt * 6);
    // Jumping at the corkboard: up on its hind legs, front paws tucked, snout up at the pages.
    this.rear += ((dog.mode === 'jump' ? 1 : 0) - this.rear) * Math.min(1, dt * 10);
    this.body.rotation.x = this.sit * 0.45 + this.rear * 1.0;
    // Turned about the hind paws rather than the middle, and off the ground a little.
    this.body.position.y = -(DOG_RADIUS + DOG_HALF_HEIGHT) + this.rear * 0.32;
    this.body.position.z = this.rear * 0.09;
    this.legs[0]!.rotation.x += this.rear * 0.9;
    this.legs[1]!.rotation.x += this.rear * 0.9;
    this.legs[2]!.rotation.x -= this.sit * 1.2;
    this.legs[3]!.rotation.x -= this.sit * 1.2;
    const happy = dog.mode === 'beg' || dog.mode === 'follow';
    this.bliss += ((patted ? 1 : 0) - this.bliss) * Math.min(1, dt * 5);
    const wag = happy ? 0.6 : 0.2 + 0.55 * this.bliss;
    this.tail.rotation.y = Math.sin(time * (happy ? 15 : 4 + 14 * this.bliss)) * wag;
    // Tail up while wagging for joy.
    this.tail.rotation.x = -0.5 - 0.35 * this.bliss;
    // Sitting already lifts its head; it bows it a little into the hand, tilted to one side,
    // nuzzling.
    this.head.rotation.x = -0.2 * this.bliss;
    this.head.rotation.z = (0.32 + 0.07 * Math.sin(time * 3.2)) * this.bliss;
    this.ears.forEach((ear, i) => (ear.rotation.x = 0.6 * this.bliss * (i === 0 ? 1 : 1.1)));
    for (const eye of this.eyes) eye.scale.y = 1 - 0.8 * this.bliss;
    this.page.visible = dog.page !== null;
  }

  /** The top of its head in the world, where a patting hand goes. */
  headTop(out: THREE.Vector3): THREE.Vector3 {
    this.group.updateMatrixWorld(true);
    return this.head.localToWorld(out.set(0, 0.15, 0));
  }
}
