import * as THREE from 'three';
import { VACUUM, vacuumRestPose } from '@sar/shared';
import type { VacuumState } from '@sar/shared';
import type { Grip } from './avatar.ts';

/** How long one pull of the vacuum takes on screen. */
const STROKE_SECONDS = 0.35;
/**
 * Carried: where the hands hold the handle and where the head rests on the floor, in the
 * avatar's own space (forward is -z, the feet at -0.85).
 */
const HANDS = new THREE.Vector3(0.02, 0.14, -0.42);
const HEAD = new THREE.Vector3(0.14, -0.85, -0.8);
/** Where along the handle, from the hands, each hand grips: left above, right below. */
const GRIP_ALONG = [0.13, -0.13];
/** The see-through dust bin on the handle: its height, and how far up the handle it sits. */
const BIN_HEIGHT = 0.26;
const BIN_AT = 0.32;

const UP = new THREE.Vector3(0, 1, 0);
const _head = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

/**
 * An upright vacuum: a wide red floor head on a grey handle, with a see-through dust bin that
 * fills up as it sucks bricks in. Its origin is the middle of the head's underside, the handle
 * runs up +y, and the nozzle faces -z.
 */
export class VacuumView {
  readonly group = new THREE.Group();
  private stroke: { by: number; at: number } | null = null;
  /** The handle, dust bin and grip, hidden in first person where they would stand up into the view. */
  private readonly upper: THREE.Object3D[];
  /** The bricks in the dust bin, scaled to how full it is. */
  private readonly fill: THREE.Mesh;

  constructor() {
    const plastic = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.45 });
    const grey = new THREE.MeshStandardMaterial({ color: 0x6b7178, roughness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.8 });
    const clear = new THREE.MeshStandardMaterial({
      color: 0xd8e6ee,
      roughness: 0.1,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    const rubble = new THREE.MeshStandardMaterial({ color: 0xd9a33a, roughness: 0.6 });
    const head = new THREE.Mesh(new THREE.BoxGeometry(VACUUM.width, 0.07, 0.16), plastic);
    head.position.set(0, 0.045, 0.02);
    // The rubber lip along the front of the nozzle.
    const lip = new THREE.Mesh(new THREE.BoxGeometry(VACUUM.width - 0.01, 0.02, 0.02), dark);
    lip.position.set(0, 0.012, -0.055);
    const wheels = [-1, 1].map((side) => {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12), dark);
      w.rotation.z = Math.PI / 2;
      w.position.set(side * (VACUUM.width / 2 + 0.005), 0.03, 0.07);
      return w;
    });
    const handleLength = VACUUM.length - 0.1;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, handleLength, 10), grey);
    handle.position.y = 0.08 + handleLength / 2;
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, BIN_HEIGHT, 16), clear);
    bin.position.y = BIN_AT + BIN_HEIGHT / 2;
    bin.renderOrder = 1;
    const caps = [BIN_AT, BIN_AT + BIN_HEIGHT].map((y) => {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.025, 16), plastic);
      c.position.y = y;
      return c;
    });
    this.fill = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1, 12), rubble);
    this.fill.visible = false;
    bin.add(this.fill);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.03), dark);
    grip.position.y = VACUUM.length;
    for (const m of [head, handle, ...caps, grip]) m.castShadow = true;
    this.group.add(head, lip, ...wheels, handle, bin, ...caps, grip);
    this.upper = [handle, bin, ...caps, grip];
  }

  /** Starts a pull for whoever just used it. */
  sucked(playerId: number): void {
    this.stroke = { by: playerId, at: performance.now() / 1000 };
  }

  /** Shows `load` bricks' worth in the dust bin, out of `capacity`. */
  setLoad(load: number, capacity: number): void {
    const k = Math.min(1, load / capacity);
    this.fill.visible = k > 0;
    const h = Math.max(0.001, k * (BIN_HEIGHT - 0.03));
    this.fill.scale.y = h;
    this.fill.position.y = -BIN_HEIGHT / 2 + 0.015 + h / 2;
  }

  /** Puts the vacuum where it leans or lies while nobody carries it. */
  rest(b: VacuumState): void {
    for (const o of this.upper) o.visible = true;
    const { pos, rot } = vacuumRestPose(b);
    // The rest pose is of the vacuum's middle; this group's origin is the head's underside.
    const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    const down = new THREE.Vector3(0, -VACUUM.length / 2, 0).applyQuaternion(q);
    this.group.position.set(pos.x + down.x, pos.y + down.y, pos.z + down.z);
    this.group.quaternion.copy(q);
  }

  /**
   * Puts the vacuum in the hands of the avatar drawn by `avatar` (already placed and turned),
   * mid-pull if they just used it, and returns where its hands go. Seen through the carrier's
   * own eyes only its head shows, on the floor ahead.
   */
  carry(avatar: THREE.Object3D, playerId: number, firstPerson: boolean): Grip {
    for (const o of this.upper) o.visible = !firstPerson;
    let k = 0;
    if (this.stroke?.by === playerId) {
      k = (performance.now() / 1000 - this.stroke.at) / STROKE_SECONDS;
      if (k >= 1 || k < 0) {
        this.stroke = null;
        k = 0;
      }
    }
    // A pull: the head pushed out along the floor and drawn back.
    const push = Math.sin(Math.PI * k);
    _head.copy(HEAD);
    _head.z -= push * 0.25;
    _dir.copy(HANDS).sub(_head).normalize();
    _q.setFromUnitVectors(UP, _dir);
    // In avatar space first, then into the world.
    avatar.updateMatrixWorld(true);
    _m.compose(_head, _q, new THREE.Vector3(1, 1, 1)).premultiply(avatar.matrixWorld);
    _m.decompose(this.group.position, this.group.quaternion, this.group.scale);
    const grip = (along: number) => HANDS.clone().addScaledVector(_dir, along);
    return [grip(GRIP_ALONG[0]!), grip(GRIP_ALONG[1]!)];
  }
}
