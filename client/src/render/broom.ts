import * as THREE from 'three';
import { BROOM, broomRestPose } from '@sar/shared';
import type { BroomState } from '@sar/shared';
import type { Grip } from './avatar.ts';

/** How long one stroke of the broom takes on screen. */
const STROKE_SECONDS = 0.35;
/**
 * Carried: where the hands hold the handle and where the head sweeps the floor, in the
 * avatar's own space (forward is -z, the feet at -0.85).
 */
const HANDS = new THREE.Vector3(0.02, 0.14, -0.42);
const HEAD = new THREE.Vector3(0.14, -0.85, -0.8);
/** Where along the handle, from the hands, each hand grips: left above, right below. */
const GRIP_ALONG = [0.13, -0.13];

const UP = new THREE.Vector3(0, 1, 0);
const _head = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

/**
 * A push broom: a wooden handle into a red block with a fringe of straw-coloured bristles. Its
 * origin is the middle of the bristles' tips, the handle runs up +y, and the bristles face -z.
 */
export class BroomView {
  readonly group = new THREE.Group();
  private stroke: { by: number; at: number } | null = null;
  /** The handle and its cap, hidden in first person where they would stand up into the view. */
  private readonly upper: THREE.Object3D[];

  constructor() {
    const wood = new THREE.MeshStandardMaterial({ color: 0xb98a55, roughness: 0.7 });
    const plastic = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.45 });
    const straw = new THREE.MeshStandardMaterial({ color: 0xd9b45a, roughness: 0.95 });
    const block = new THREE.Mesh(new THREE.BoxGeometry(BROOM.width, 0.05, BROOM.depth), plastic);
    block.position.y = 0.1;
    const bristles = new THREE.Mesh(
      new THREE.BoxGeometry(BROOM.width - 0.01, 0.08, BROOM.depth - 0.015),
      straw,
    );
    bristles.position.y = 0.04;
    // A ragged fringe, so the bristles read as bristles rather than a block.
    const tufts = new THREE.Group();
    for (let i = 0; i < 12; i++) {
      const tuft = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.03, BROOM.depth - 0.01), straw);
      tuft.position.set(-BROOM.width / 2 + 0.02 + i * ((BROOM.width - 0.04) / 11), 0, 0);
      tuft.rotation.z = (i % 2 ? 1 : -1) * 0.12;
      tufts.add(tuft);
    }
    tufts.position.y = 0.01;
    const handleLength = BROOM.length - 0.12;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, handleLength, 10), wood);
    handle.position.y = 0.12 + handleLength / 2;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), plastic);
    cap.position.y = BROOM.length;
    for (const m of [block, bristles, handle, cap]) m.castShadow = true;
    this.group.add(block, bristles, tufts, handle, cap);
    this.upper = [handle, cap];
  }

  /** Starts a stroke for whoever just swept. */
  swept(playerId: number): void {
    this.stroke = { by: playerId, at: performance.now() / 1000 };
  }

  /** Puts the broom where it leans or lies while nobody carries it. */
  rest(b: BroomState): void {
    for (const o of this.upper) o.visible = true;
    const { pos, rot } = broomRestPose(b);
    // The rest pose is of the broom's middle; this group's origin is the bristles' tips.
    const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    const down = new THREE.Vector3(0, -BROOM.length / 2, 0).applyQuaternion(q);
    this.group.position.set(pos.x + down.x, pos.y + down.y, pos.z + down.z);
    this.group.quaternion.copy(q);
  }

  /**
   * Puts the broom in the hands of the avatar drawn by `avatar` (already placed and turned),
   * mid-stroke if they just swept, and returns where its hands go. Seen through the carrier's
   * own eyes only its head shows, sweeping the floor ahead.
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
    // A stroke: the head swings across from the right to the left and out in front, lifting
    // a little on the way back.
    const swing = k > 0 ? Math.cos(Math.PI * k) * 0.45 : 0;
    const push = Math.sin(Math.PI * k);
    _head.copy(HEAD).sub(HANDS).applyAxisAngle(UP, swing);
    _head.z -= push * 0.18;
    _head.add(HANDS);
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
