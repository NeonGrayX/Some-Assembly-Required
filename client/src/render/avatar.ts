import type RAPIER from '@dimforge/rapier3d-compat';
import type { ImpulseJoint, RigidBody, World } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { DEFAULT_HAT } from '@sar/shared';
import type { HatId, Vec3 } from '@sar/shared';
import { makeHat } from './hats.ts';
import type { HatCollider } from './hats.ts';

// A player is a little builder: torso, head with visor and a hat of their choosing (a hard
// hat unless they picked another), two arms and two legs.
// Positions are relative to the centre of the player's collision capsule (feet at -0.85).
// The character controller keeps the capsule a skin width (0.02) off the floor, so the legs
// reach 0.87 below the centre to stand on the floor rather than hover above it, and on 1.5 cm
// into it: a round foot only just touching the floor hangs a hair above it for a few
// centimetres around, and the shadow maps' offsets let light in under there, ringing each
// foot. Sunk in, the foot meets the floor at a steep angle and its shadow starts right there.
const TORSO = { r: 0.25, len: 0.3, y: 0.05 };
const HEAD = { r: 0.2, y: 0.62 };
const ARM = { r: 0.07, len: 0.34, x: 0.33, y: 0.33 };
const LEG = { r: 0.09, len: 0.39, x: 0.12, y: -0.315 };
/** Where a hat's origin (its brow line) sits in the head's space. */
const HAT_Y = HEAD.r * 0.5;
/** Distance from a shoulder or hip to the middle of the limb hanging from it. */
const ARM_DROP = (ARM.len + 2 * ARM.r) / 2;
const LEG_DROP = (LEG.len + 2 * LEG.r) / 2;

export interface Avatar {
  group: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Group;
  /** The hat, a child of the head, or null for a bare head. */
  hat: THREE.Object3D | null;
  hatCollider: HatCollider | null;
  /** A hat part that spins as the player moves (the propeller beanie's propeller). */
  spinner: THREE.Object3D | null;
  /** A dog biscuit in the right hand, shown while holding a treat. */
  treat: THREE.Mesh;
  /** Limbs hang from pivots at the shoulders and hips, so swinging is a rotation. */
  arms: [THREE.Group, THREE.Group];
  legs: [THREE.Group, THREE.Group];
  /** Walk cycle, advanced by how far the player moved, and how big the swing is (0..1). */
  phase: number;
  amp: number;
  last: THREE.Vector3 | null;
  /** How far into the patting pose (0..1), where the hand strokes, and the stroke's cycle. */
  pat: number;
  patAt: THREE.Vector3;
  stroke: number;
}

const capsule = (r: number, len: number, mat: THREE.Material) => {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 12), mat);
  m.castShadow = true;
  return m;
};

export function makeAvatar(
  colour: number,
  nameTag: THREE.Object3D | null,
  hatId: HatId = DEFAULT_HAT,
): Avatar {
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
  head.add(skull, visor);
  const hatModel = makeHat(hatId, colour);
  const hat = hatModel?.group ?? null;
  if (hat) {
    hat.position.y = HAT_Y;
    head.add(hat);
  }
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
  const treat = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.04, 0.05),
    new THREE.MeshStandardMaterial({ color: 0xa0632e, roughness: 0.9 }),
  );
  treat.position.set(0, -ARM_DROP * 2, -0.04);
  treat.visible = false;
  arms[1].add(treat);
  return {
    group,
    torso,
    head,
    hat,
    hatCollider: hatModel?.collider ?? null,
    spinner: hatModel?.spinner ?? null,
    treat,
    arms,
    legs,
    phase: 0,
    amp: 0,
    last: null,
    pat: 0,
    patAt: new THREE.Vector3(),
    stroke: 0,
  };
}

/** Radians of walk cycle per metre: about one stride per 1.5 m. */
const STRIDE = 4.2;
/** How long standing up from the floor takes. */
export const GET_UP_SECONDS = 0.6;

export interface Gait {
  limping: boolean;
  carrying: boolean;
  careful: boolean;
  /** Where the hands hold what the player carries, if the arms should reach for it. */
  grip?: Grip | null;
  /** The top of the dog's head being patted, in the avatar's own space. */
  pat?: THREE.Vector3 | null;
}

/** Left and right hand positions, in the avatar's own space (forward is -z). */
export type Grip = [THREE.Vector3, THREE.Vector3];

/** From a shoulder pivot to the middle of the hand at the end of the arm. */
const HAND_REACH = ARM.len + ARM.r;
/** Hands rest this far off the item's surface (the arm's own thickness). */
const HAND_GAP = ARM.r - 0.01;
/** How far apart the hands sit when they cannot go round an item and hold its front or tray. */
const NARROW_X = 0.17;

const _box = new THREE.Box3();
const _part = new THREE.Box3();
const _toAvatar = new THREE.Matrix4();
const _inv = new THREE.Matrix4();

/**
 * Where the hands go to hold `item`. A single brick is held by its left and right ends, the
 * arms closing in as far as it is wide; one too wide to reach round is held by its near face.
 * A build (or the baseplate) is carried like a tray, hands underneath its near edge. Each hand
 * slides along the item's surface to where the arm can reach, or points at it if none can.
 */
export function gripPoints(a: Avatar, item: THREE.Object3D, tray: boolean): Grip | null {
  a.group.updateMatrixWorld(true);
  item.updateMatrixWorld(true);
  _inv.copy(a.group.matrixWorld).invert();
  _box.makeEmpty();
  item.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    _toAvatar.multiplyMatrices(_inv, o.matrixWorld);
    _box.union(_part.copy(o.geometry.boundingBox!).applyMatrix4(_toAvatar));
  });
  if (_box.isEmpty()) return null;
  const { min, max } = _box;
  const mid = _box.getCenter(new THREE.Vector3());
  const hand = (side: -1 | 1): THREE.Vector3 => {
    const shoulder = a.arms[side < 0 ? 0 : 1].position;
    // Solves the one free coordinate so the hand lands at arm's length from the shoulder,
    // kept between `near` and `far`; null if the arm cannot reach anywhere along that line.
    const reach = (u: number, v: number, near: number, far: number): number | null => {
      const rest = HAND_REACH * HAND_REACH - u * u - v * v;
      if (rest < 0) return null;
      const w = -Math.sqrt(rest);
      return w > near ? null : Math.max(far, w);
    };
    const narrowX = side * Math.min(NARROW_X, (max.x - min.x) / 2) + mid.x;
    if (tray) {
      // Underneath, as far in from the near edge as the arm reaches.
      const x = narrowX;
      const y = min.y - HAND_GAP;
      const z = reach(x - shoulder.x, y - shoulder.y, max.z - 0.03, Math.max(mid.z, min.z));
      return new THREE.Vector3(x, y, z ?? max.z - 0.03);
    }
    const x = side < 0 ? min.x - HAND_GAP : max.x + HAND_GAP;
    const z = reach(x - shoulder.x, mid.y - shoulder.y, max.z - 0.03, mid.z);
    if (z !== null) return new THREE.Vector3(x, mid.y, z);
    // Too wide to reach round: palms on the near face, low enough for the arm to get there.
    const fz = max.z + HAND_GAP;
    const rest = HAND_REACH ** 2 - (narrowX - shoulder.x) ** 2 - (fz - shoulder.z) ** 2;
    const y = rest > 0 ? shoulder.y - Math.sqrt(rest) : mid.y;
    return new THREE.Vector3(narrowX, Math.min(max.y, Math.max(min.y, y)), fz);
  };
  return [hand(-1), hand(1)];
}

/** From a hip to the floor: the straight leg's length. */
const HIP_HEIGHT = 2 * LEG_DROP;
/** How far down the body goes to pat the dog, and how far forward it leans. */
const PAT_CROUCH = 0.28;
const PAT_LEAN = 0.4;
/** Strokes per second, and how far the hand travels along the dog's head. */
const STROKE_RATE = 1.4;
const STROKE_LENGTH = 0.1;

const DOWN = new THREE.Vector3(0, -1, 0);
const _dir = new THREE.Vector3();
const _walk = new THREE.Quaternion();
const _hand = new THREE.Vector3();
/** Points an arm, which hangs along -y from its shoulder, at a point in the avatar's space. */
function reachFor(arm: THREE.Group, target: THREE.Vector3): void {
  _dir.subVectors(target, arm.position).normalize();
  arm.quaternion.setFromUnitVectors(DOWN, _dir);
}

/**
 * Swings arms and legs by how fast the avatar moved since the last frame: a stroll at walking
 * pace, a full swing at a sprint, tiptoeing with the arms out when walking carefully. Limping
 * drags one leg and dips on every other step. Carrying holds both arms out in front, reaching
 * for the item's grip points when there are some. Patting the dog drops into a lunge, leans
 * over and strokes the dog's head with the right hand.
 */
export function animateAvatar(a: Avatar, gait: Gait, dt: number): void {
  const pos = a.group.position;
  const moved = a.last ? Math.hypot(pos.x - a.last.x, pos.z - a.last.z) : 0;
  a.last = (a.last ?? new THREE.Vector3()).copy(pos);
  // Teleports (a meeting) are not steps.
  const step = moved < 0.5 ? moved : 0;
  a.phase += step * STRIDE;
  const speed = step / Math.max(dt, 1e-3);
  // How big the swing is follows the speed, smoothed so frame hitches do not twitch it.
  const target = Math.min(1, speed / 6);
  a.amp += (target - a.amp) * Math.min(1, dt * 8);
  const swing = Math.sin(a.phase) * a.amp;
  // A propeller idles slowly and whirs when the player runs.
  if (a.spinner) a.spinner.rotation.y += dt * (3 + a.amp * 30);
  a.legs[0].rotation.x = swing * 0.9;
  a.legs[1].rotation.x = -swing * (gait.limping ? 0.3 : 0.9);
  // Arms: forward to hold something (rotating +x swings a hanging arm to the front, -z),
  // out to the sides for balance when careful, otherwise swinging against the legs.
  const balance = gait.careful && !gait.carrying ? 0.55 : 0;
  a.arms[0].rotation.set(gait.carrying ? 1.35 : -swing * 0.7, 0, -balance);
  a.arms[1].rotation.set(gait.carrying ? 1.35 : swing * 0.7, 0, balance);
  if (gait.grip) {
    reachFor(a.arms[0], gait.grip[0]);
    reachFor(a.arms[1], gait.grip[1]);
  }
  const crouch = gait.careful ? 0.05 : 0;
  const dip = gait.limping ? Math.max(0, Math.sin(a.phase)) * 0.06 * Math.min(1, a.amp * 3) : 0;

  // Patting: eases in and out, the hand going on to where the dog was until it is back down.
  if (gait.pat) a.patAt.copy(gait.pat);
  a.pat += ((gait.pat ? 1 : 0) - a.pat) * Math.min(1, dt * 6);
  if (a.pat < 1e-3) a.pat = 0;
  const k = a.pat * a.pat * (3 - 2 * a.pat);
  const low = PAT_CROUCH * k;
  // A lunge: the hips go down and the straight legs splay forward and back to stay on the floor.
  const splay = Math.acos((HIP_HEIGHT - low) / HIP_HEIGHT);
  a.legs[0].rotation.x = a.legs[0].rotation.x * (1 - k) + splay;
  a.legs[1].rotation.x = a.legs[1].rotation.x * (1 - k) - splay;
  a.legs[0].position.y = a.legs[1].position.y = LEG.y - low;
  // Leaning over: the shoulders come forward with the chest, the head looks down at the dog.
  const lean = Math.sin(PAT_LEAN * k);
  a.torso.rotation.x = -PAT_LEAN * k;
  a.head.rotation.x = -0.4 * k;
  a.head.position.z = -(HEAD.y - TORSO.y) * lean;
  for (const arm of a.arms)
    arm.position.set(arm.position.x, ARM.y - low, -(ARM.y - TORSO.y) * lean);
  if (k > 0) {
    // One hand strokes the dog's head front to back (whichever side it sits on); the other
    // rests on the front knee.
    const [rest, pat] = a.patAt.x < 0 ? [a.arms[1], a.arms[0]] : a.arms;
    rest.rotation.x = rest.rotation.x * (1 - k) + 0.55 * k;
    rest.rotation.z *= 1 - k;
    a.stroke += dt * STROKE_RATE * Math.PI * 2;
    const s = Math.sin(a.stroke);
    _hand.copy(a.patAt);
    _hand.z += s * STROKE_LENGTH;
    _hand.y += (1 - Math.abs(s)) * 0.02;
    _walk.copy(pat.quaternion);
    reachFor(pat, _hand);
    pat.quaternion.slerpQuaternions(_walk, pat.quaternion, k);
  } else a.stroke = 0;
  a.torso.position.y = TORSO.y - dip - crouch - low;
  a.head.position.y = HEAD.y - dip - crouch - low;
}

// Ragdoll parts only collide with the level and bricks (group 1), never with players or
// each other.
const RAGDOLL_GROUPS = (0x8 << 16) | 0x1;

interface Part {
  body: RigidBody | null;
  mesh: THREE.Object3D;
  /** The part of the standing avatar this is a copy of: where it goes when getting up. */
  source: THREE.Object3D;
  /** How far into getting up (0..1) this part starts moving back. */
  lag: number;
  /** Where the mesh was when getting up started. */
  from?: { pos: THREE.Vector3; rot: THREE.Quaternion };
}

/**
 * A knocked-over player: the avatar's parts as physics bodies joined at the neck, shoulders
 * and hips, thrown the way the player fell. The hat (if any) comes off on its own. Lives in the
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
    const add = (
      source: THREE.Object3D,
      mesh: THREE.Object3D,
      shape: RAPIER.ColliderDesc,
      push: Vec3,
      spin = 0,
      lag = 0.1,
    ) => {
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
      this.parts.push({ body, mesh, source, lag });
      return body;
    };
    const dir = new THREE.Vector3(fall.x, 0, fall.z);
    const speed = dir.length();
    if (speed > 1e-3) dir.multiplyScalar(1 / speed);
    // Unit `dir` is a direction; spin about the axis across it tips the body over forward.
    fall = { x: dir.x, y: 0, z: dir.z };
    const push = (k: number, up: number) => ({ x: dir.x * k, y: up, z: dir.z * k });

    const torso = add(
      avatar.torso,
      worldCopy(avatar.torso),
      R.ColliderDesc.capsule(TORSO.len / 2, TORSO.r),
      push(1.6, 0.5),
      3,
      0,
    );
    // The head without its hat, which flies off on its own.
    const headCopy = worldCopy(avatar.head);
    if (avatar.hat) headCopy.remove(headCopy.children[avatar.head.children.indexOf(avatar.hat)]!);
    const head = add(avatar.head, headCopy, R.ColliderDesc.ball(HEAD.r), push(2, 0.8), 4, 0.15);
    const limbBodies = [...avatar.arms, ...avatar.legs].map((pivot, i) => {
      const isArm = i < 2;
      const [r, len] = isArm ? [ARM.r, ARM.len] : [LEG.r, LEG.len];
      // The body sits at the middle of the limb, where its mesh is.
      return add(
        pivot.children[0]!,
        worldCopy(pivot.children[0]!),
        R.ColliderDesc.capsule(len / 2, r),
        push(isArm ? 2 : 1.2, 0.6),
      );
    });
    if (avatar.hat && avatar.hatCollider) {
      const { halfHeight, radius, y } = avatar.hatCollider;
      add(
        avatar.hat,
        worldCopy(avatar.hat),
        R.ColliderDesc.cylinder(halfHeight, radius).setTranslation(0, y, 0),
        push(2.6, 2.4),
        6,
        0.35,
      );
    }

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
    return this.parts[0]!.mesh.position;
  }

  /** Getting back up: physics off, every part on its way to the standing pose. */
  get standing(): boolean {
    return this.getUp !== null;
  }

  private getUp: number | null = null;

  /** Moves the meshes to where the bodies are; call every frame while lying there. */
  sync(): void {
    for (const { body, mesh } of this.parts) {
      if (!body) continue;
      const t = body.translation();
      const r = body.rotation();
      mesh.position.set(t.x, t.y, t.z);
      mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  /** Starts getting up: the bodies go, and the parts start moving back into place. */
  standUp(): void {
    if (this.getUp !== null) return;
    this.getUp = 0;
    for (const part of this.parts) {
      part.from = { pos: part.mesh.position.clone(), rot: part.mesh.quaternion.clone() };
      if (part.body && this.world.bodies.contains(part.body.handle)) {
        this.world.removeRigidBody(part.body);
      }
      part.body = null;
    }
  }

  /**
   * One frame of getting up: each part eases from where it lay to where it belongs on the
   * standing avatar (which must be posed already). The torso leads, the head and limbs follow
   * just after, and the hat flies back on last. Returns true when done.
   */
  updateGetUp(dt: number): boolean {
    if (this.getUp === null) return false;
    this.getUp = Math.min(1, this.getUp + dt / GET_UP_SECONDS);
    const to = new THREE.Vector3();
    const toRot = new THREE.Quaternion();
    for (const part of this.parts) {
      const { lag } = part;
      const t = Math.min(1, Math.max(0, (this.getUp! - lag) / (1 - lag)));
      const e = t * t * (3 - 2 * t);
      part.source.getWorldPosition(to);
      part.source.getWorldQuaternion(toRot);
      // Up in an arc rather than sliding along the floor.
      part.mesh.position.lerpVectors(part.from!.pos, to, e);
      part.mesh.position.y += Math.sin(e * Math.PI) * 0.15;
      part.mesh.quaternion.slerpQuaternions(part.from!.rot, toRot, e);
    }
    return this.getUp >= 1;
  }

  dispose(): void {
    for (const { body } of this.parts) {
      if (body && this.world.bodies.contains(body.handle)) this.world.removeRigidBody(body);
    }
    this.group.removeFromParent();
  }
}
