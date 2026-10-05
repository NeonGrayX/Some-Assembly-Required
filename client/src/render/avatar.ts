import type RAPIER from '@dimforge/rapier3d-compat';
import type { ImpulseJoint, RigidBody, World } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Vec3 } from '@sar/shared';

// A player is a little builder: torso, head with visor and hard hat, two arms and two legs.
// Positions are relative to the centre of the player's collision capsule (feet at -0.85).
const TORSO = { r: 0.25, len: 0.3, y: 0.05 };
const HEAD = { r: 0.2, y: 0.62 };
const ARM = { r: 0.07, len: 0.34, x: 0.33, y: 0.33 };
const LEG = { r: 0.09, len: 0.3, x: 0.12, y: -0.3 };
/** Distance from a shoulder or hip to the middle of the limb hanging from it. */
const ARM_DROP = (ARM.len + 2 * ARM.r) / 2;
const LEG_DROP = (LEG.len + 2 * LEG.r) / 2;

export interface Avatar {
  group: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Group;
  hat: THREE.Mesh;
  /** Limbs hang from pivots at the shoulders and hips, so swinging is a rotation. */
  arms: [THREE.Group, THREE.Group];
  legs: [THREE.Group, THREE.Group];
  /** Walk cycle, advanced by how far the player moved. */
  phase: number;
  last: THREE.Vector3 | null;
}

const capsule = (r: number, len: number, mat: THREE.Material) => {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 12), mat);
  m.castShadow = true;
  return m;
};

export function makeAvatar(colour: number, nameTag: THREE.Object3D | null): Avatar {
  const group = new THREE.Group();
  if (nameTag) group.add(nameTag);
  const cloth = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.6 });
  const darker = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colour).multiplyScalar(0.7),
    roughness: 0.7,
  });

  const torso = capsule(TORSO.r, TORSO.len, cloth);
  torso.position.y = TORSO.y;
  group.add(torso);

  const head = new THREE.Group();
  head.position.y = HEAD.y;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(HEAD.r, 16, 12), cloth);
  skull.castShadow = true;
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.1, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.2 }),
  );
  visor.position.set(0, 0.02, -0.15);
  const hat = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.25, 0.13, 16),
    new THREE.MeshStandardMaterial({ color: 0xf5c518, roughness: 0.5 }),
  );
  hat.position.y = HEAD.r * 0.8;
  hat.castShadow = true;
  head.add(skull, visor, hat);
  group.add(head);

  const limb = (
    x: number,
    y: number,
    r: number,
    len: number,
    drop: number,
    mat: THREE.Material,
  ) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const m = capsule(r, len, mat);
    m.position.y = -drop;
    pivot.add(m);
    group.add(pivot);
    return pivot;
  };
  const arms: [THREE.Group, THREE.Group] = [
    limb(-ARM.x, ARM.y, ARM.r, ARM.len, ARM_DROP, cloth),
    limb(ARM.x, ARM.y, ARM.r, ARM.len, ARM_DROP, cloth),
  ];
  const legs: [THREE.Group, THREE.Group] = [
    limb(-LEG.x, LEG.y, LEG.r, LEG.len, LEG_DROP, darker),
    limb(LEG.x, LEG.y, LEG.r, LEG.len, LEG_DROP, darker),
  ];
  return { group, torso, head, hat, arms, legs, phase: 0, last: null };
}

/**
 * Swings arms and legs by how far the avatar moved since the last frame. Limping makes one
 * leg drag and the body dip on every other step. Carrying holds the arms out in front.
 */
export function animateAvatar(a: Avatar, limping: boolean, carrying: boolean): void {
  const pos = a.group.position;
  const moved = a.last ? Math.hypot(pos.x - a.last.x, pos.z - a.last.z) : 0;
  a.last = (a.last ?? new THREE.Vector3()).copy(pos);
  // Teleports (a meeting) are not steps.
  if (moved < 0.5) a.phase += moved * 7;
  const swing = Math.sin(a.phase) * Math.min(1, moved * 40);
  a.legs[0].rotation.x = swing * 0.7;
  a.legs[1].rotation.x = -swing * (limping ? 0.25 : 0.7);
  a.arms[0].rotation.x = carrying ? -1.3 : -swing * 0.6;
  a.arms[1].rotation.x = carrying ? -1.3 : swing * 0.6;
  const dip = limping ? Math.max(0, Math.sin(a.phase)) * 0.06 * Math.min(1, moved * 40) : 0;
  a.torso.position.y = TORSO.y - dip;
  a.head.position.y = HEAD.y - dip;
}

// Ragdoll parts only collide with the level and bricks (group 1), never with players or
// each other.
const RAGDOLL_GROUPS = (0x8 << 16) | 0x1;

interface Part {
  body: RigidBody;
  mesh: THREE.Object3D;
}

/**
 * A knocked-over player: the avatar's parts as physics bodies joined at the neck, shoulders
 * and hips, thrown the way the player fell. The hat comes off on its own. Lives in the
 * client's copy of the world, which steps it along with everything else.
 */
export class Ragdoll {
  readonly group = new THREE.Group();
  private readonly parts: Part[] = [];
  private readonly joints: ImpulseJoint[] = [];

  constructor(
    R: typeof RAPIER,
    private readonly world: World,
    avatar: Avatar,
    /** Which way the player fell. */
    fall: Vec3,
  ) {
    avatar.group.updateMatrixWorld(true);
    /** A copy of a part of the standing avatar, placed where that part is in the world. */
    const worldCopy = (obj: THREE.Object3D) => {
      const copy = obj.clone();
      obj.getWorldPosition(copy.position);
      obj.getWorldQuaternion(copy.quaternion);
      copy.traverse((o) => (o.castShadow = true));
      return copy;
    };
    const add = (mesh: THREE.Object3D, shape: RAPIER.ColliderDesc, push: Vec3, spin = 0) => {
      const p = mesh.position;
      const body = this.world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(p.x, p.y, p.z)
          .setRotation(mesh.quaternion)
          .setLinvel(push.x, push.y, push.z)
          .setAngvel({ x: -fall.z * spin, y: 0, z: fall.x * spin })
          .setLinearDamping(0.3)
          .setAngularDamping(1.5)
          .setCcdEnabled(true),
      );
      this.world.createCollider(
        shape.setCollisionGroups(RAGDOLL_GROUPS).setDensity(400).setFriction(0.9),
        body,
      );
      this.group.add(mesh);
      this.parts.push({ body, mesh });
      return body;
    };
    const dir = new THREE.Vector3(fall.x, 0, fall.z);
    const speed = dir.length();
    if (speed > 1e-3) dir.multiplyScalar(1 / speed);
    // Unit `dir` is a direction; spin about the axis across it tips the body over forward.
    fall = { x: dir.x, y: 0, z: dir.z };
    const push = (k: number, up: number) => ({ x: dir.x * k, y: up, z: dir.z * k });

    const torso = add(
      worldCopy(avatar.torso),
      R.ColliderDesc.capsule(TORSO.len / 2, TORSO.r),
      push(1.6, 0.5),
      3,
    );
    // The head without its hat, which flies off on its own.
    const headCopy = worldCopy(avatar.head);
    headCopy.remove(headCopy.children[avatar.head.children.indexOf(avatar.hat)]!);
    const head = add(headCopy, R.ColliderDesc.ball(HEAD.r), push(2, 0.8), 4);
    const limbBodies = [...avatar.arms, ...avatar.legs].map((pivot, i) => {
      const isArm = i < 2;
      const [r, len] = isArm ? [ARM.r, ARM.len] : [LEG.r, LEG.len];
      // The body sits at the middle of the limb, where its mesh is.
      return add(
        worldCopy(pivot.children[0]!),
        R.ColliderDesc.capsule(len / 2, r),
        push(isArm ? 2 : 1.2, 0.6),
      );
    });
    add(worldCopy(avatar.hat), R.ColliderDesc.cylinder(0.065, 0.22), push(2.6, 2.4), 6);

    // Joints: anchors in each body's own frame.
    const joint = (a: RigidBody, anchorA: Vec3, b: RigidBody, anchorB: Vec3) => {
      const j = this.world.createImpulseJoint(R.JointData.spherical(anchorA, anchorB), a, b, true);
      j.setContactsEnabled(false);
      this.joints.push(j);
    };
    const torsoTop = HEAD.y - HEAD.r - TORSO.y + 0.03;
    joint(torso, { x: 0, y: torsoTop, z: 0 }, head, { x: 0, y: -HEAD.r - 0.03, z: 0 });
    for (const [i, side] of [-1, 1].entries()) {
      joint(torso, { x: side * ARM.x, y: ARM.y - TORSO.y, z: 0 }, limbBodies[i]!, {
        x: 0,
        y: ARM_DROP,
        z: 0,
      });
      joint(torso, { x: side * LEG.x, y: LEG.y - TORSO.y, z: 0 }, limbBodies[2 + i]!, {
        x: 0,
        y: LEG_DROP,
        z: 0,
      });
    }
    this.sync();
  }

  /** Where the ragdoll's chest is, for the camera of the player lying there. */
  get focus(): Vec3 {
    return this.parts[0]!.body.translation();
  }

  /** Moves the meshes to where the bodies are; call every frame. */
  sync(): void {
    for (const { body, mesh } of this.parts) {
      const t = body.translation();
      const r = body.rotation();
      mesh.position.set(t.x, t.y, t.z);
      mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  dispose(): void {
    for (const { body } of this.parts) {
      if (this.world.bodies.contains(body.handle)) this.world.removeRigidBody(body);
    }
    this.group.removeFromParent();
  }
}
