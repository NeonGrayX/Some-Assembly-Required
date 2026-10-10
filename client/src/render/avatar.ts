import type RAPIER from '@dimforge/rapier3d-compat';
import type { ImpulseJoint, RigidBody, World } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { DEFAULT_LOOK, lerpAngle } from '@sar/shared';
import type { FaceId, LadderDef, Look, ShirtId, Vec3 } from '@sar/shared';
import { makeHat } from './hats.ts';
import type { HatCollider } from './hats.ts';

// A player is a little builder, a toy figure: a round head on a short neck, a shirt in their
// colour under dungarees with a bib, a pocket, straps and brass buttons, a tool belt with a
// pouch and a tape measure, work gloves with cuffs, turned-up trouser legs over chunky boots,
// a face, and a hat of their choosing (a hard hat unless they picked another; a mop of hair
// for those who picked none). The body is still a torso, a head and four limbs, each dressed
// with smaller shapes, so the walk cycle, the grip and the ragdoll see the same parts.
// Positions are relative to the centre of the player's collision capsule (feet at -0.85).
// The character controller keeps the capsule a skin width (0.02) off the floor, so the legs
// reach 0.87 below the centre to stand on the floor rather than hover above it, and on 1.5 cm
// into it: a round foot only just touching the floor hangs a hair above it for a few
// centimetres around, and the shadow maps' offsets let light in under there, ringing each
// foot. Sunk in, the foot meets the floor at a steep angle and its shadow starts right there.
//
// Nothing pokes through anything else, in any pose (see `avatar-clipping.test.ts`): the arms
// hang a little out from the body so the hands clear the belt, the straps and the collar
// stay clear of the head, and whatever a shirt adds lies flat on the body.
const TORSO = { r: 0.25, len: 0.3, y: 0.05 };
const HEAD = { r: 0.2, y: 0.65 };
const ARM = { r: 0.068, len: 0.4, x: 0.33, y: 0.3 };
const LEG = { r: 0.09, len: 0.39, x: 0.12, y: -0.315 };
/** Where a hat's origin (its brow line) sits in the head's space. */
const HAT_Y = HEAD.r * 0.5;
/** Distance from a shoulder or hip to the middle of the limb hanging from it. */
const ARM_DROP = (ARM.len + 2 * ARM.r) / 2;
const LEG_DROP = (LEG.len + 2 * LEG.r) / 2;
/** How far (radians) the arms hang out from the body at rest, so the hands clear the belt. */
const ARM_OUT = 0.1;

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
  /** Each forearm hangs from its elbow, which bends it forward (about x). */
  elbows: [THREE.Group, THREE.Group];
  /** The gloved hands, at the ends of the forearms. */
  hands: [THREE.Mesh, THREE.Mesh];
  legs: [THREE.Group, THREE.Group];
  /** Walk cycle, advanced by how far the player moved, and how big the swing is (0..1). */
  phase: number;
  amp: number;
  /**
   * How much of the step goes sideways rather than ahead or back, relative to where the avatar
   * faces: -1 straight to its left, 1 straight to its right. Smoothed, and kept while standing.
   */
  side: number;
  last: THREE.Vector3 | null;
  /** How far into the patting pose (0..1), where the hand strokes, and the stroke's cycle. */
  pat: number;
  patAt: THREE.Vector3;
  stroke: number;
  /** How far into the climbing pose (0..1), and the ladder it is on (kept while letting go). */
  climb: number;
  ladder: LadderDef | null;
  /**
   * How far each pose is blended in (0..1), easing towards the gait so that changing from one
   * way of moving to another never snaps: carrying, walking carefully, limping and being in the
   * air. `rise` is how fast the avatar was last going up (negative: down), smoothed, and `land`
   * the squat of a landing, fading out.
   */
  carry: number;
  careful: number;
  limp: number;
  air: number;
  rise: number;
  land: number;
}

const capsule = (r: number, len: number, mat: THREE.Material) => {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 16), mat);
  m.castShadow = true;
  return m;
};

/** The figure's skin: a warm toy yellow, the same for everyone, the player's colour being on their clothes. */
const SKIN = 0xf2c94c;
const GLOVE = 0xe8dcc0;
const CUFF = 0xd6c8a2;
const BOOT = 0x5a3b26;
const SOLE = 0x2a1d14;
const LEATHER = 0x6b4a2b;
const TAPE = 0xf5c518;
const FACE = 0x1b1d22;

/** A shape as part of a bigger one: placed on it, casting a shadow like it. */
const dress = (
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  name = '',
) => {
  const m = new THREE.Mesh(geometry, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.name = name;
  parent.add(m);
  return m;
};

/** How big the gloved hands are, and how far up the arm's end their middle sits. */
const HAND_R = 0.078;
const HAND_IN = 0.03;
/** How much longer than wide a glove is: its furthest reach from its middle is HAND_R times this. */
const HAND_LONG = 1.05;
/** From the shoulder to the elbow, and from the elbow to the middle of the hand. */
const UPPER_ARM = 0.245;
const FOREARM = 2 * ARM_DROP - HAND_IN - UPPER_ARM;
/** The boots: sole, then the upper on it, the toe a dome at the front. */
const SOLE_H = 0.035;
const BOOT_H = 0.085;
const BOOT_W = 0.19;

const HAIR = 0x4a3222;
/** The way a flat shape (a circle) faces before it is turned. */
const FORWARD = new THREE.Vector3(0, 0, 1);
const RED = 0xc91a1a;
const HI_VIS = 0xd7f400;
const REFLECTIVE = 0xb8bec4;

/**
 * The face, on the front of the head: eyes and a mouth, with glasses, a moustache or a beard
 * for those who picked one.
 */
function dressFace(head: THREE.Group, id: FaceId): void {
  const ink = new THREE.MeshStandardMaterial({ color: FACE, roughness: 0.4 });
  const hair = new THREE.MeshStandardMaterial({ color: HAIR, roughness: 0.8 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.9 });
  const blush = new THREE.MeshStandardMaterial({ color: 0xf08a5d, roughness: 0.9 });
  const big = id === 'surprised';
  // Rosy cheeks under the eyes, flat on the head.
  if (id !== 'beard') {
    for (const side of [-1, 1]) {
      const cheek = dress(head, new THREE.CircleGeometry(0.026, 12), blush, 0, 0, 0, 'cheek');
      cheek.position.setFromSphericalCoords(
        HEAD.r + 0.001,
        Math.PI / 2 + 0.2,
        Math.PI + side * 0.6,
      );
      cheek.quaternion.setFromUnitVectors(FORWARD, cheek.position.clone().normalize());
    }
  }
  const eye = (side: -1 | 1) => {
    if (id === 'wink' && side > 0) {
      const lid = dress(
        head,
        new THREE.TorusGeometry(0.026, 0.008, 6, 10, Math.PI),
        ink,
        side * 0.07,
        0.025,
        -0.187,
      );
      lid.rotation.x = -0.35;
      return;
    }
    const r = big ? 0.034 : 0.028;
    const e = dress(head, new THREE.SphereGeometry(r, 12, 8), ink, side * 0.07, 0.03, -0.184);
    e.scale.set(1, big ? 1.1 : 1.35, 0.55);
    // A glint, so the eyes look alive.
    dress(head, new THREE.SphereGeometry(0.008, 6, 4), cream, side * 0.07 + 0.01, 0.045, -0.198);
  };
  eye(-1);
  eye(1);
  /** An arc of a mouth, curving up, `r` wide at `y`. */
  const smile = (r: number, y: number, z = -0.185) => {
    const m = dress(head, new THREE.TorusGeometry(r, 0.012, 6, 12, Math.PI), ink, 0, y, z);
    m.rotation.set(0.35, 0, Math.PI);
    return m;
  };
  switch (id) {
    case 'smile':
    case 'wink':
      smile(0.055, -0.05);
      break;
    case 'grin':
      smile(0.07, -0.045);
      dress(head, new THREE.BoxGeometry(0.1, 0.025, 0.012), cream, 0, -0.055, -0.188);
      break;
    case 'calm':
      smile(0.035, -0.065).scale.y = 0.5;
      break;
    case 'surprised': {
      const o = dress(head, new THREE.TorusGeometry(0.034, 0.014, 6, 14), ink, 0, -0.06, -0.192);
      o.rotation.x = 0.2;
      break;
    }
    case 'glasses': {
      smile(0.055, -0.05);
      for (const side of [-1, 1]) {
        const rim = dress(
          head,
          new THREE.TorusGeometry(0.05, 0.008, 6, 16),
          ink,
          side * 0.07,
          0.03,
          -0.19,
        );
        rim.rotation.x = 0.15;
        // The arms of the glasses, back over the sides of the head to the ears.
        const arm = dress(
          head,
          new THREE.BoxGeometry(0.008, 0.008, 0.15),
          ink,
          side * 0.168,
          0.035,
          -0.1,
        );
        arm.rotation.y = side * 0.55;
      }
      dress(head, new THREE.BoxGeometry(0.045, 0.008, 0.008), ink, 0, 0.035, -0.196);
      break;
    }
    case 'moustache':
      smile(0.045, -0.075);
      for (const side of [-1, 1]) {
        const half = dress(
          head,
          new THREE.CapsuleGeometry(0.014, 0.05, 4, 8),
          hair,
          side * 0.033,
          -0.025,
          -0.19,
        );
        half.rotation.z = Math.PI / 2 + side * 0.3;
      }
      break;
    case 'beard': {
      const beard = dress(head, new THREE.SphereGeometry(0.13, 16, 10), hair, 0, -0.1, -0.12);
      beard.scale.set(1, 0.75, 0.55);
      smile(0.045, -0.04, -0.196);
      break;
    }
  }
}

/**
 * What is worn with the dungarees, on the torso (in its own space, the capsule's centre at
 * the origin) and the arms (each arm mesh's own space). Everything lies close on the body,
 * so the arms swinging past it never touch it.
 */
function dressShirt(torso: THREE.Mesh, arms: [THREE.Group, THREE.Group], id: ShirtId): void {
  const hug = TORSO.r + 0.006;
  const half = TORSO.len / 2;
  const cream = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.9 });
  const red = new THREE.MeshStandardMaterial({ color: RED, roughness: 0.7 });
  switch (id) {
    case 'plain':
      return;
    case 'stripes': {
      // Rings round the body where the bib does not cover them, and round the sleeves.
      const start = -Math.PI / 2 + 0.78;
      for (const y of [-0.09, 0, 0.09]) {
        const ring = dress(
          torso,
          new THREE.TorusGeometry(hug, 0.011, 6, 32, Math.PI * 2 - 1.56),
          cream,
          0,
          y,
          0,
          'stripe',
        );
        ring.rotateX(Math.PI / 2);
        ring.rotateZ(start);
      }
      for (const arm of arms) {
        for (const name of ['upper arm', 'forearm']) {
          const ring = dress(
            arm.getObjectByName(name)!,
            new THREE.TorusGeometry(ARM.r + 0.002, 0.01, 6, 16),
            cream,
            0,
            0,
            0,
          );
          ring.rotation.x = Math.PI / 2;
        }
      }
      return;
    }
    case 'hivis': {
      // A vest over everything: a sleeve round the body with two reflective bands and
      // shoulder straps.
      const vest = new THREE.MeshStandardMaterial({
        color: HI_VIS,
        roughness: 0.7,
        side: THREE.DoubleSide,
      });
      const tape = new THREE.MeshStandardMaterial({ color: REFLECTIVE, roughness: 0.3 });
      const over = hug + 0.009;
      dress(
        torso,
        new THREE.CylinderGeometry(over, over, TORSO.len, 32, 1, true),
        vest,
        0,
        0,
        0,
        'vest',
      );
      for (const y of [-0.06, 0.06]) {
        const band = dress(torso, new THREE.TorusGeometry(over, 0.005, 6, 32), tape, 0, y, 0);
        band.rotation.x = Math.PI / 2;
        band.name = 'vest band';
      }
      // Over the dungarees' straps, wholly covering them: side by side, the two met in the
      // same place and flickered through each other.
      for (const x of STRAP_X) {
        const strap = dress(
          torso,
          new THREE.TorusGeometry(strapRadius(x) + 0.006, 0.026, 8, 20, Math.PI),
          vest,
          x,
          half,
          0,
          'vest strap',
        );
        strap.rotation.y = -Math.PI / 2;
      }
      return;
    }
    case 'bowtie': {
      // At the collar, under the chin.
      const y = half + 0.2;
      const z = -Math.sqrt(TORSO.r * TORSO.r - 0.2 * 0.2) - 0.018;
      for (const side of [-1, 1]) {
        const wing = dress(
          torso,
          new THREE.ConeGeometry(0.03, 0.06, 4),
          red,
          side * 0.032,
          y,
          z,
          'bow',
        );
        wing.rotation.set(0.5, 0, (side * Math.PI) / 2);
      }
      dress(torso, new THREE.SphereGeometry(0.016, 8, 6), red, 0, y, z - 0.004, 'knot');
      return;
    }
    case 'scarf': {
      // Wound round the neck on the shoulders, one end hanging down the front.
      const wrap = dress(
        torso,
        new THREE.TorusGeometry(0.15, 0.04, 10, 24),
        red,
        0,
        half + 0.2,
        0,
        'scarf',
      );
      wrap.rotation.x = Math.PI / 2;
      const end = dress(
        torso,
        new THREE.BoxGeometry(0.07, 0.17, 0.025),
        red,
        0.08,
        half + 0.1,
        -0.21,
        'scarf end',
      );
      end.rotation.x = 0.55;
      return;
    }
  }
}

/** Where the dungarees' straps run over the shoulders (left and right of the middle). */
const STRAP_X = [-0.11, 0.11];
/** The radius of a strap's arc, from the top of the torso's cylinder over the shoulder. */
const strapRadius = (x: number) => Math.sqrt(TORSO.r * TORSO.r - x * x) + 0.008;

/** A mop of hair for a bare head: a cap over the top and back, a fringe at the front. */
function dressHair(head: THREE.Group): void {
  const hair = new THREE.MeshStandardMaterial({ color: HAIR, roughness: 0.85 });
  const cap = dress(
    head,
    new THREE.SphereGeometry(HEAD.r + 0.012, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.56),
    hair,
    0,
    0,
    0,
    'hair',
  );
  // Tipped back, so it covers the back of the head down to the neck and leaves the forehead.
  cap.rotation.x = 0.55;
  for (const [x, a] of [
    [-0.06, 0.3],
    [0.0, 0],
    [0.06, -0.3],
  ] as const) {
    const lock = dress(
      head,
      new THREE.SphereGeometry(0.05, 10, 8),
      hair,
      x,
      HEAD.r * 0.68,
      -0.135,
      'fringe',
    );
    lock.scale.set(1, 0.55, 0.6);
    lock.rotation.set(-0.7, 0, a);
  }
}

export function makeAvatar(
  colour: number,
  nameTag: THREE.Object3D | null,
  look: Look = DEFAULT_LOOK,
): Avatar {
  const group = new THREE.Group();
  if (nameTag) group.add(nameTag);
  const cloth = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.65 });
  // The dungarees: a darker, duller shade of the shirt, so the two read apart.
  const denim = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colour).multiplyScalar(0.55).lerp(new THREE.Color(0x2b3442), 0.25),
    roughness: 0.8,
  });
  const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.45 });
  const leather = new THREE.MeshStandardMaterial({ color: LEATHER, roughness: 0.8 });
  const glove = new THREE.MeshStandardMaterial({ color: GLOVE, roughness: 0.9 });
  const cuff = new THREE.MeshStandardMaterial({ color: CUFF, roughness: 0.9 });
  const boot = new THREE.MeshStandardMaterial({ color: BOOT, roughness: 0.7 });
  const sole = new THREE.MeshStandardMaterial({ color: SOLE, roughness: 0.9 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.3, metalness: 0.4 });

  const torso = capsule(TORSO.r, TORSO.len, cloth);
  torso.position.y = TORSO.y;
  group.add(torso);
  // The torso is a capsule: a cylinder of TORSO.len between two half-balls. The bib hugs
  // the front of the cylinder and on up the top half-ball, with a pocket on it; the straps run
  // from its top over the shoulders to the back; the belt rings the bottom of the cylinder,
  // with a pouch on the right hip and a tape measure on the left; a collar rings the neck. All
  // in the torso's own space, whose origin is the capsule's centre.
  const hug = TORSO.r + 0.006;
  const half = TORSO.len / 2;
  const bibWidth = 1.5;
  const bibTop = 0.75;
  dress(
    torso,
    new THREE.CylinderGeometry(hug, hug, TORSO.len, 16, 1, true, Math.PI - bibWidth / 2, bibWidth),
    denim,
    0,
    0,
    0,
    'bib',
  );
  dress(
    torso,
    new THREE.SphereGeometry(
      hug,
      16,
      8,
      1.5 * Math.PI - bibWidth / 2,
      bibWidth,
      bibTop,
      Math.PI / 2 - bibTop,
    ),
    denim,
    0,
    half,
    0,
    'bib',
  );
  // The bib's pocket, stitched on its middle.
  dress(
    torso,
    new THREE.CylinderGeometry(hug + 0.006, hug + 0.006, 0.08, 8, 1, true, Math.PI - 0.25, 0.5),
    new THREE.MeshStandardMaterial({
      color: (denim.color as THREE.Color).clone().multiplyScalar(1.18),
      roughness: 0.8,
    }),
    0,
    0.05,
    0,
    'pocket',
  );
  const stitch = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.6 });
  dress(
    torso,
    new THREE.CylinderGeometry(hug + 0.007, hug + 0.007, 0.006, 8, 1, true, Math.PI - 0.25, 0.5),
    stitch,
    0,
    0.087,
    0,
    'stitch',
  );
  for (const x of STRAP_X) {
    const onCap = strapRadius(x);
    const strap = dress(
      torso,
      new THREE.TorusGeometry(onCap, 0.016, 6, 20, Math.PI),
      denim,
      x,
      half,
      0,
      'strap',
    );
    strap.rotation.y = -Math.PI / 2;
    // A button where the strap meets the bib.
    const at = Math.PI / 2 - bibTop + 0.08;
    const button = dress(
      torso,
      new THREE.CylinderGeometry(0.02, 0.02, 0.012, 10),
      brass,
      x,
      half + onCap * Math.cos(at),
      -onCap * Math.sin(at) - 0.012,
      'button',
    );
    button.rotation.x = Math.PI / 2 - at;
  }
  // The belt: a band round the waist, a buckle at the front.
  dress(
    torso,
    new THREE.CylinderGeometry(hug + 0.008, hug + 0.008, 0.045, 32, 1, true),
    new THREE.MeshStandardMaterial({ color: LEATHER, roughness: 0.8, side: THREE.DoubleSide }),
    0,
    -half,
    0,
    'belt',
  );
  const buckle = dress(
    torso,
    new THREE.TorusGeometry(0.026, 0.008, 6, 4),
    brass,
    0,
    -half,
    -hug - 0.012,
    'buckle',
  );
  buckle.rotation.z = Math.PI / 4;
  buckle.scale.set(1.2, 0.9, 1);
  // The pouch on the right hip, its flap a shade darker.
  const pouch = dress(
    torso,
    new THREE.BoxGeometry(0.1, 0.09, 0.07),
    leather,
    0.2,
    -half - 0.055,
    -0.11,
    'pouch',
  );
  pouch.rotation.y = 1;
  dress(
    pouch,
    new THREE.BoxGeometry(0.104, 0.03, 0.074),
    new THREE.MeshStandardMaterial({ color: 0x4f3620, roughness: 0.8 }),
    0,
    0.032,
    0,
    'flap',
  );
  // The tape measure on the left hip.
  const tape = dress(
    torso,
    new THREE.CylinderGeometry(0.035, 0.035, 0.03, 14),
    new THREE.MeshStandardMaterial({ color: TAPE, roughness: 0.5 }),
    -0.2,
    -half - 0.03,
    -0.11,
    'tape measure',
  );
  tape.rotation.set(0, -0.5, Math.PI / 2);
  // The collar, round the neck.
  const collar = dress(
    torso,
    new THREE.TorusGeometry(0.088, 0.024, 8, 20),
    cloth,
    0,
    HEAD.y - HEAD.r - TORSO.y - 0.02,
    0,
    'collar',
  );
  collar.rotation.x = Math.PI / 2;

  const head = new THREE.Group();
  head.position.y = HEAD.y;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(HEAD.r, 24, 16), skin);
  skull.castShadow = true;
  skull.name = 'skull';
  head.add(skull);
  // The neck, down into the collar.
  dress(
    head,
    new THREE.CylinderGeometry(0.07, 0.075, 0.14, 14),
    skin,
    0,
    -HEAD.r - 0.02,
    0,
    'neck',
  );
  dressFace(head, look.face);
  const hatModel = makeHat(look.hat, colour);
  const hat = hatModel?.group ?? null;
  if (hat) {
    hat.position.y = HAT_Y;
    head.add(hat);
  } else dressHair(head);
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
  // An arm bends at the elbow: the upper arm hangs from the shoulder, the forearm from the
  // elbow, with the hand at its end. The arm as a whole (what a ragdoll throws about) is the
  // group under the shoulder's pivot, centred where a straight arm's middle would be.
  const elbows: THREE.Group[] = [];
  const hands: THREE.Mesh[] = [];
  const arms = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * ARM.x, ARM.y, 0);
    pivot.rotation.z = side * ARM_OUT;
    const arm = new THREE.Group();
    arm.position.y = -ARM_DROP;
    pivot.add(arm);
    group.add(pivot);
    const upper = capsule(ARM.r, UPPER_ARM, cloth);
    upper.name = 'upper arm';
    upper.position.y = ARM_DROP - UPPER_ARM / 2;
    arm.add(upper);
    // A round shoulder joins the arm to the body.
    dress(arm, new THREE.SphereGeometry(ARM.r + 0.016, 20, 14), cloth, 0, ARM_DROP, 0, 'shoulder');
    const elbow = new THREE.Group();
    elbow.name = 'elbow';
    elbow.position.y = ARM_DROP - UPPER_ARM;
    arm.add(elbow);
    elbows.push(elbow);
    const fore = capsule(ARM.r, FOREARM - ARM.r + HAND_IN, cloth);
    fore.name = 'forearm';
    fore.position.y = -(FOREARM - ARM.r + HAND_IN) / 2;
    elbow.add(fore);
    // The gloved hand at the end, with a cuff and a thumb.
    const hand = dress(
      elbow,
      new THREE.SphereGeometry(HAND_R, 20, 14),
      glove,
      0,
      -FOREARM,
      0,
      'hand',
    );
    hand.scale.set(0.95, HAND_LONG, 0.9);
    hands.push(hand);
    dress(
      elbow,
      new THREE.CylinderGeometry(ARM.r + 0.012, ARM.r + 0.004, 0.05, 14),
      cuff,
      0,
      -FOREARM + 0.055,
      0,
      'cuff',
    );
    const thumb = dress(
      elbow,
      new THREE.CapsuleGeometry(0.022, 0.02, 4, 8),
      glove,
      -side * 0.04,
      -FOREARM + 0.01,
      -0.045,
      'thumb',
    );
    thumb.rotation.set(-0.5, 0, -side * 0.3);
    return pivot;
  }) as [THREE.Group, THREE.Group];
  const legs: [THREE.Group, THREE.Group] = [
    limb(-LEG.x, LEG.y, LEG.r, LEG.len, LEG_DROP, denim),
    limb(LEG.x, LEG.y, LEG.r, LEG.len, LEG_DROP, denim),
  ];
  dressShirt(torso, arms, look.shirt);
  // Boots (toes forward) at the ends of the legs, under a turned-up hem, in each leg mesh's own
  // space so they swing with it.
  for (const leg of legs) {
    const m = leg.children[0]!;
    const bottom = -LEG_DROP;
    // The sole is the boot's bottom: the BoxGeometry worn gear (steel toe caps) finds.
    const b = dress(
      m,
      new THREE.BoxGeometry(BOOT_W, SOLE_H, 0.27),
      sole,
      0,
      bottom + SOLE_H / 2,
      -0.035,
      'sole',
    );
    dress(
      b,
      new THREE.BoxGeometry(BOOT_W - 0.008, BOOT_H, 0.2),
      boot,
      0,
      SOLE_H / 2 + BOOT_H / 2,
      0.035,
      'boot',
    );
    const toe = dress(
      b,
      new THREE.SphereGeometry((BOOT_W - 0.008) / 2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      boot,
      0,
      SOLE_H / 2,
      -0.045,
      'toe',
    );
    toe.scale.set(1, (BOOT_H * 0.95) / ((BOOT_W - 0.008) / 2), 0.95);
    const hem = dress(
      m,
      new THREE.TorusGeometry(LEG.r + 0.004, 0.018, 8, 18),
      denim,
      0,
      bottom + SOLE_H + BOOT_H + 0.015,
      0,
      'hem',
    );
    hem.rotation.x = Math.PI / 2;
  }
  const treat = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.04, 0.05),
    new THREE.MeshStandardMaterial({ color: 0xa0632e, roughness: 0.9 }),
  );
  treat.position.set(0, -FOREARM - 0.02, -0.05);
  treat.visible = false;
  treat.castShadow = true;
  elbows[1]!.add(treat);
  return {
    group,
    torso,
    head,
    hat,
    hatCollider: hatModel?.collider ?? null,
    spinner: hatModel?.spinner ?? null,
    treat,
    arms,
    elbows: elbows as [THREE.Group, THREE.Group],
    hands: hands as [THREE.Mesh, THREE.Mesh],
    legs,
    phase: 0,
    amp: 0,
    side: 0,
    last: null,
    pat: 0,
    patAt: new THREE.Vector3(),
    stroke: 0,
    climb: 0,
    ladder: null,
    carry: 0,
    careful: 0,
    limp: 0,
    air: 0,
    rise: 0,
    land: 0,
  };
}

/** Radians of walk cycle per metre: about one stride per 1.5 m. */
const STRIDE = 4.2;
/** Side steps are shorter: a step out and a step in every 1.2 m. */
const SIDE_STRIDE = (2 * Math.PI) / 1.2;
/** How far the legs open (radians at the hip) at the widest of a side step at a full swing. */
const SIDE_SPREAD = 0.7;
/** How far behind the leading leg the trailing one follows, in radians of the cycle. */
const SIDE_LAG = 0.9;
/**
 * Limping favours the right leg. Its steps are hurried (the cycle runs faster while the weight
 * is on it), it hardly swings, and the body drops and leans over it as it takes the weight.
 */
const LIMP_HURRY = 0.45;
const LIMP_LEG_SWING = 0.3;
const LIMP_DIP = 0.09;
const LIMP_LEAN = 0.16;
/**
 * In the air: going up, one knee comes up and the arms go up; coming down, the legs reach for
 * the ground and the arms spread out (radians at the shoulder and hip). The speed up (m/s) at
 * which it is all the way into going up, and down into coming down.
 */
const JUMP_UP = { lead: 0.8, trail: -0.4, arms: 2.7, out: 0.3 };
const JUMP_DOWN = { lead: 0.35, trail: 0.15, arms: 0.5, out: 1.1 };
const JUMP_TURN = 4;
/** How deep (m) a landing from the top of a full jump squats, and how fast it springs back. */
const LAND_SQUAT = 0.12;
const LAND_RECOVER = 5;
/** How fast (per second) one pose eases into another. */
const BLEND = 8;
/**
 * How far (radians) the elbows bend: a little standing, more at a run and the further forward
 * the arm swings (per radian), holding something up, in the air and up a ladder.
 */
const ELBOW = { rest: 0.15, run: 0.45, swing: 0.35, carry: 0.25, air: 0.35, climb: 0.3 };
/**
 * Radians of climb cycle per metre climbed: a hand over hand every 1.2 m, about two a second
 * at climbing speed (the climb is quick, so the hands skip rungs).
 */
const RUNG_STRIDE = (2 * Math.PI) / 1.2;
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
  /** The ladder the player is up, while climbing it. */
  climb?: LadderDef | null;
  /** Off the ground (jumping or falling), and not on a ladder. */
  airborne?: boolean;
}

/** Left and right hand positions, in the avatar's own space (forward is -z). */
export type Grip = [THREE.Vector3, THREE.Vector3];

/** From a shoulder pivot to the middle of the hand at the end of the arm. */
const HAND_REACH = 2 * ARM_DROP - HAND_IN;
/** Hands rest this far off the item's surface: the glove just touching it. */
const HAND_GAP = HAND_R * HAND_LONG + 0.004;
/** How far apart the hands sit when they cannot go round a brick and hold its front. */
const NARROW_X = 0.17;
/**
 * How far either side of the middle the hands hold a build, about shoulder width apart so the
 * arms reach straight out to it.
 */
const TRAY_X = 0.27;

const _box = new THREE.Box3();
const _part = new THREE.Box3();
const _toAvatar = new THREE.Matrix4();
const _inv = new THREE.Matrix4();

/**
 * Where the hands go to hold `item`. A single brick is held by its left and right ends, the
 * arms closing in as far as it is wide; one too wide to reach round is held by its near face.
 * A build (or the baseplate) is carried like a tray, hands underneath its near edge. Each hand
 * slides along the item's surface to where the arm can reach (bending at the elbow to hold it
 * nearer), or points at it if none can. The gloves rest on the surface, never in it.
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
      const w = shoulder.z - Math.sqrt(rest);
      return w > near ? null : Math.max(far, w);
    };
    const halfWidth = (max.x - min.x) / 2;
    const narrowX = side * Math.min(NARROW_X, halfWidth) + mid.x;
    /** Palms on the near face at `x`, as low as the arm reaches. */
    const nearFace = (x: number): THREE.Vector3 => {
      const fz = max.z + HAND_GAP;
      const rest = HAND_REACH ** 2 - (x - shoulder.x) ** 2 - (fz - shoulder.z) ** 2;
      const y = rest > 0 ? shoulder.y - Math.sqrt(rest) : mid.y;
      return new THREE.Vector3(x, Math.min(max.y, Math.max(min.y, y)), fz);
    };
    /** By its left or right end, as far along it as the arm reaches; null if it cannot. */
    const byEnd = (): THREE.Vector3 | null => {
      const x = side < 0 ? min.x - HAND_GAP : max.x + HAND_GAP;
      const z = reach(x - shoulder.x, mid.y - shoulder.y, max.z - 0.03, mid.z);
      return z === null ? null : new THREE.Vector3(x, mid.y, z);
    };
    if (tray) {
      // A build too narrow for the hands to go under it shoulder width apart is held by its
      // ends, like a brick; the arms would cross in front of the chest to get under it.
      if (halfWidth < TRAY_X) {
        const x = side < 0 ? min.x - HAND_GAP : max.x + HAND_GAP;
        return byEnd() ?? new THREE.Vector3(x, mid.y, max.z - 0.03);
      }
      // Underneath, as far in from the near edge as the arm reaches, or failing that (the
      // build hangs too low) on its near face.
      const x = mid.x + side * TRAY_X;
      const y = min.y - HAND_GAP;
      const z = reach(x - shoulder.x, y - shoulder.y, max.z - 0.03, Math.max(mid.z, min.z));
      return z === null ? nearFace(x) : new THREE.Vector3(x, y, z);
    }
    // Too wide to reach round: palms on the near face.
    return byEnd() ?? nearFace(narrowX);
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

/**
 * Climbing. The player's capsule is pressed up to the wall with the ladder running through it,
 * so the avatar stands this far back off the ladder's plane: about an arm's reach, so the hands
 * (which swing on a circle round the shoulder) stay on the rungs from chest to eye level. The
 * arms go up and forward to the rungs (the middle of each hand's travel, and how far it goes
 * either way from there), the straight legs point their feet at the rungs likewise, and the
 * head looks up the ladder.
 */
const CLIMB_STANDOFF = 0.42;
const CLIMB_ARM = { mid: 1.85, span: 0.5 };
const CLIMB_LEG = { mid: 0.82, span: 0.22 };
const CLIMB_LOOK_UP = 0.35;

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const _dir = new THREE.Vector3();
const _stance = new THREE.Vector3();
const _walk = new THREE.Quaternion();
/**
 * Where a reaching arm points, apart from `arm.quaternion`: blending into it in place would
 * copy the walk over it first (`slerpQuaternions` copies its first argument into itself).
 */
const _aim = new THREE.Quaternion();
const _hand = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _upper = new THREE.Vector3();
const _fore = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _basis = new THREE.Matrix4();
/**
 * Which way a bent elbow points: out to the side, so the arms go round the body to whatever the
 * hands hold in front of it, and a little down and back.
 */
const ELBOW_POLE = { out: 1, down: 0.35, back: 0.1 };
/**
 * How far (m) the shoulders come forward and in when the hands reach in front of the body, how
 * far in (m) from a shoulder a hand goes before they come all the way, and how much further (m)
 * a shoulder goes after a hand just out of reach.
 */
const PROTRACT = { z: 0.12, x: 0, span: 0.3, reach: 0.06 };
/**
 * Puts arm `i`'s hand on a point in the avatar's space, bending the elbow (out to the side, as
 * an arm holding something in front does) when it is nearer than the arm is long, and
 * pointing the straight arm at it when it is out of reach. Returns how far (radians) the elbow
 * bends.
 */
function reachFor(a: Avatar, i: 0 | 1, target: THREE.Vector3): number {
  const arm = a.arms[i];
  _dir.subVectors(target, arm.position);
  const d = Math.max(_dir.length(), 0.1);
  _dir.normalize();
  if (d >= HAND_REACH - 1e-4) {
    arm.quaternion.setFromUnitVectors(DOWN, _dir);
    return 0;
  }
  // The triangle of upper arm, forearm and the line to the hand: the angle at the shoulder
  // between the upper arm and that line, and the one at the elbow.
  const U = UPPER_ARM;
  const F = FOREARM;
  const atShoulder = Math.acos(Math.min(1, (U * U + d * d - F * F) / (2 * U * d)));
  const atElbow = Math.acos(Math.max(-1, Math.min(1, (U * U + F * F - d * d) / (2 * U * F))));
  _pole.set(i === 0 ? -ELBOW_POLE.out : ELBOW_POLE.out, -ELBOW_POLE.down, ELBOW_POLE.back);
  _pole.addScaledVector(_dir, -_pole.dot(_dir)).normalize();
  _upper
    .copy(_dir)
    .multiplyScalar(Math.cos(atShoulder))
    .addScaledVector(_pole, Math.sin(atShoulder));
  // The forearm goes from the elbow to the hand; the arm's own -z is its bend's way, across it.
  _fore.copy(_dir).multiplyScalar(d).addScaledVector(_upper, -U).normalize();
  _fore.addScaledVector(_upper, -_fore.dot(_upper)).normalize();
  _y.copy(_upper).negate();
  const z = _fore.negate();
  _x.crossVectors(_y, z);
  arm.quaternion.setFromRotationMatrix(_basis.makeBasis(_x, _y, z));
  return Math.PI - atElbow;
}

/**
 * Swings arms and legs by how fast the avatar moved since the last frame: a stroll at walking
 * pace, a full swing at a sprint, tiptoeing with the arms out when walking carefully. Moving
 * sideways (strafing) side-steps instead, the leading leg stepping out and the other closing
 * up to it, blending into the walk for a diagonal. Limping hurries over the sore right leg,
 * which barely swings, and drops and leans onto it with every other step. The elbows bend a
 * little standing and more at a run. Carrying holds both arms out in front, the hands on the
 * item's grip points when there are some (the elbows bending to put them there). Patting the dog
 * drops into a lunge, leans over and strokes the dog's head with the right hand. Climbing turns
 * to the ladder, steps back off its plane and goes up it hand over hand, each knee coming up
 * with the other hand. Jumping brings a knee and the arms up, coming down reaches for the
 * ground with the arms spread, and the landing squats by how hard it came down. Every one of
 * these eases in and out, so they blend into each other as the player moves.
 *
 * The group's position and heading must be where the sim has the player (set before every
 * call): climbing moves the avatar off them, to the ladder.
 */
export function animateAvatar(a: Avatar, gait: Gait, dt: number): void {
  const pos = a.group.position;
  const dx = a.last ? pos.x - a.last.x : 0;
  const dz = a.last ? pos.z - a.last.z : 0;
  const moved = Math.hypot(dx, dz);
  const risen = a.last ? Math.abs(pos.y - a.last.y) : 0;
  const lastY = a.last?.y ?? pos.y;
  const wasAir = a.air > 0.5;
  a.last = (a.last ?? new THREE.Vector3()).copy(pos);
  // Teleports (a meeting) are not steps.
  const step = moved < 0.5 ? moved : 0;
  const rung = risen < 0.5 ? risen : 0;
  // Which way the step went, against the avatar's right (+x turned by its heading).
  if (step > 1e-4 && !gait.climb) {
    const yaw = a.group.rotation.y;
    const side = (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / step;
    a.side += (side - a.side) * Math.min(1, dt * 10);
  }
  const sideways = Math.abs(a.side) * (1 - a.climb);
  const ahead = 1 - sideways;
  // Climbing eases in and out, kept on the last ladder until the avatar has let go of it. Up a
  // ladder the cycle goes by height gained rather than ground covered.
  if (gait.climb) a.ladder = gait.climb;
  a.climb += ((gait.climb ? 1 : 0) - a.climb) * Math.min(1, dt * 8);
  if (a.climb < 1e-3) a.climb = 0;
  const c = a.climb * a.climb * (3 - 2 * a.climb);
  // In the air the legs hold their pose rather than walk, and walk on from it on landing.
  const airborne = !!gait.airborne && !gait.climb;
  if (gait.climb) a.phase += rung * RUNG_STRIDE;
  else if (!airborne) a.phase += step * (STRIDE * ahead + SIDE_STRIDE * sideways);
  const speed = (gait.climb ? rung : step) / Math.max(dt, 1e-3);
  // Every pose eases in and out at the same rate, so moving from one to another (picking
  // something up while limping, jumping out of a careful walk) is one smooth change.
  const ease = Math.min(1, dt * BLEND);
  a.carry += ((gait.carrying ? 1 : 0) - a.carry) * ease;
  a.careful += ((gait.careful ? 1 : 0) - a.careful) * ease;
  a.limp += ((gait.limping ? 1 : 0) - a.limp) * ease;
  // Into the air quickly (a jump is short), back out as quickly on landing.
  a.air += ((airborne ? 1 : 0) - a.air) * Math.min(1, dt * 20);
  const w = { carry: a.carry, careful: a.careful * (1 - a.carry), limp: a.limp, air: a.air };
  // How big the swing is follows the speed, smoothed so frame hitches do not twitch it. A limp
  // is slow but makes big, lurching steps on the good leg.
  const target = Math.min(1, (speed / (gait.climb ? 2 : 6)) * (1 + w.limp));
  a.amp += (target - a.amp) * ease;
  // A limp hurries through the half of the cycle with the weight on the sore leg (sin > 0).
  const cycle = a.phase - LIMP_HURRY * w.limp * Math.sin(a.phase);
  const swing = Math.sin(cycle) * a.amp;
  // A propeller idles slowly and whirs when the player runs.
  if (a.spinner) a.spinner.rotation.y += dt * (3 + a.amp * 30);
  const sore = 0.9 + (LIMP_LEG_SWING - 0.9) * w.limp;
  a.legs[0].rotation.x = swing * 0.9 * ahead;
  a.legs[1].rotation.x = -swing * sore * ahead;
  // Side-stepping: the leg on the side the avatar goes opens out first and the other follows,
  // pushing off, then both close up. A leg rotating +z swings its foot to +x (the right).
  const toRight = a.side >= 0;
  const open = (leg: 0 | 1): number => {
    const leads = (leg === 1) === toRight;
    const t = cycle - (leads ? 0 : SIDE_LAG);
    const out = ((1 - Math.cos(t)) / 2) * SIDE_SPREAD * a.amp * sideways * (1 - w.air);
    return (leg === 0 ? -out : out) * (leg === 1 ? 1 - 0.5 * w.limp : 1);
  };
  a.legs[0].rotation.z = open(0);
  a.legs[1].rotation.z = open(1);
  // Legs apart, the hips come down to keep both feet on the floor.
  const spread = Math.max(Math.abs(a.legs[0].rotation.z), Math.abs(a.legs[1].rotation.z));
  const straddle = HIP_HEIGHT * (1 - Math.cos(spread));
  // Arms: forward to hold something (rotating +x swings a hanging arm to the front, -z),
  // out to the sides for balance when careful, otherwise swinging against the legs. Limping,
  // the arm on the sore side stays stiff; side-stepping, the arms open a little with the legs.
  const balance = 0.55 * w.careful;
  const armSwing = swing * 0.7 * ahead * (1 - w.carry);
  const stiff = 0.12 * w.limp * (1 - w.carry);
  a.arms[0].rotation.set(
    1.35 * w.carry - armSwing,
    0,
    -(ARM_OUT + balance + 0.5 * Math.abs(a.legs[0].rotation.z)),
  );
  a.arms[1].rotation.set(
    1.35 * w.carry + armSwing * (1 - 0.6 * w.limp),
    0,
    ARM_OUT + balance + 0.5 * Math.abs(a.legs[1].rotation.z) + stiff,
  );
  // Elbows: a little bent at rest, more the faster the avatar goes (bending most on the swing
  // forward), and the sore side's arm held stiff.
  const bend: [number, number] = [0, 0];
  for (const i of [0, 1] as const) {
    const forward = Math.max(0, a.arms[i].rotation.x);
    bend[i] =
      (ELBOW.rest + ELBOW.run * a.amp * ahead + ELBOW.swing * forward + ELBOW.carry * w.carry) *
      (i === 1 ? 1 - 0.7 * w.limp : 1);
  }

  // In the air: rising or falling by how fast the avatar goes up, smoothed against the frame
  // to frame jitter of a snapshot. The landing squats by how hard it came down.
  const vy = (pos.y - lastY) / Math.max(dt, 1e-3);
  if (airborne && Math.abs(vy) < 20) a.rise += (vy - a.rise) * Math.min(1, dt * 20);
  if (wasAir && !airborne && !gait.climb && a.rise < -1) {
    a.land = Math.max(a.land, Math.min(1, -a.rise / 7));
  }
  a.land = Math.max(0, a.land - dt * LAND_RECOVER);
  if (!airborne) a.rise *= 1 - ease;
  if (w.air > 1e-3) {
    // 0 going up, 1 coming down.
    const down = Math.min(1, Math.max(0, 0.5 - a.rise / (2 * JUMP_TURN)));
    const mix = (u: number, d: number) => u + (d - u) * down;
    // The leading leg is whichever was forward at take-off, so a running jump looks like a leap.
    const lead = Math.sin(cycle) >= 0 ? 0 : 1;
    const legPose = [mix(JUMP_UP.lead, JUMP_DOWN.lead), mix(JUMP_UP.trail, JUMP_DOWN.trail)];
    for (const [i, leg] of a.legs.entries()) {
      const want = legPose[i === lead ? 0 : 1]!;
      leg.rotation.x += (want - leg.rotation.x) * w.air;
    }
    // Arms up and out, unless they hold something.
    const up = mix(JUMP_UP.arms, JUMP_DOWN.arms);
    const out = mix(JUMP_UP.out, JUMP_DOWN.out);
    const free = w.air * (1 - w.carry);
    for (const [i, arm] of a.arms.entries()) {
      const side = i === 0 ? -1 : 1;
      arm.rotation.x += (up - arm.rotation.x) * free;
      arm.rotation.z += (side * out - arm.rotation.z) * free;
      bend[i] = bend[i]! + (ELBOW.air - bend[i]!) * free;
    }
  }
  const squat = LAND_SQUAT * Math.sin((a.land * Math.PI) / 2);
  const crouch = 0.05 * a.careful + squat;
  // Limping: as the sore leg takes the weight the body drops and leans over it.
  const favour = w.limp * Math.max(0, Math.sin(cycle)) * Math.min(1, a.amp * 3) * (1 - w.air);
  const dip = favour * LIMP_DIP;
  const list = -favour * LIMP_LEAN;
  // Patting: eases in and out, the hand going on to where the dog was until it is back down.
  if (gait.pat) a.patAt.copy(gait.pat);
  a.pat += ((gait.pat ? 1 : 0) - a.pat) * Math.min(1, dt * 6);
  if (a.pat < 1e-3) a.pat = 0;
  const k = a.pat * a.pat * (3 - 2 * a.pat);
  const low = PAT_CROUCH * k;
  /** The arm that strokes the dog, which reaches for it once the shoulders are in place. */
  let patting: 0 | 1 | null = null;
  // A lunge: the hips go down and the straight legs splay forward and back to stay on the floor.
  const splay = Math.acos((HIP_HEIGHT - low) / HIP_HEIGHT);
  a.legs[0].rotation.x = a.legs[0].rotation.x * (1 - k) + splay;
  a.legs[1].rotation.x = a.legs[1].rotation.x * (1 - k) - splay;
  a.legs[0].position.y = a.legs[1].position.y = LEG.y - low - straddle;
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
    const [r, p] = a.patAt.x < 0 ? ([1, 0] as const) : ([0, 1] as const);
    const rest = a.arms[r];
    patting = p;
    rest.rotation.x = rest.rotation.x * (1 - k) + 0.55 * k;
    rest.rotation.z = rest.rotation.z * (1 - k) + (r === 0 ? -ARM_OUT : ARM_OUT) * k;
    bend[r] = bend[r] + (ELBOW.rest - bend[r]) * k;
    a.stroke += dt * STROKE_RATE * Math.PI * 2;
    const s = Math.sin(a.stroke);
    _hand.copy(a.patAt);
    _hand.z += s * STROKE_LENGTH;
    _hand.y += (1 - Math.abs(s)) * 0.02;
  } else a.stroke = 0;
  const drop = dip + crouch + low + straddle;
  a.torso.position.y = TORSO.y - drop;
  a.head.position.y = HEAD.y - drop;
  // Leaning over the sore leg turns the upper body about the middle of the torso (+z tips it
  // to the left), the head tilting back a little against it. The arms go down and over with
  // the shoulders, and tip with them (unless they hold something), staying clear of the body.
  a.torso.rotation.z = list;
  a.head.rotation.z = -list * 0.5;
  a.head.position.x = -(HEAD.y - TORSO.y) * Math.sin(list);
  for (const [i, arm] of a.arms.entries()) {
    const x = i === 0 ? -ARM.x : ARM.x;
    const y = ARM.y - TORSO.y;
    arm.position.x = x * Math.cos(list) - y * Math.sin(list);
    arm.position.y = TORSO.y - drop + x * Math.sin(list) + y * Math.cos(list);
    arm.rotation.z += list * (1 - w.carry);
  }
  // Reaching in front of the body for what the hands hold, the shoulders come forward and in
  // (the further in the hand goes, the more), so the arms go round the chest rather than
  // through it. Then each hand goes to its grip, and the patting hand to the dog.
  if (gait.grip) {
    for (const [i, arm] of a.arms.entries()) {
      const side = i === 0 ? -1 : 1;
      const inward = Math.min(1, Math.max(0, (ARM.x - side * gait.grip[i]!.x) / PROTRACT.span));
      arm.position.x -= side * PROTRACT.x * inward * w.carry;
      arm.position.z -= PROTRACT.z * inward * w.carry;
      // A hand just out of reach gets there by the shoulder reaching after it.
      _dir.subVectors(gait.grip[i]!, arm.position);
      const short = Math.min(PROTRACT.reach, _dir.length() - HAND_REACH + 1e-3);
      if (short > 0) arm.position.addScaledVector(_dir.normalize(), short * w.carry);
      _walk.copy(arm.quaternion);
      const b = reachFor(a, i as 0 | 1, gait.grip[i]!);
      arm.quaternion.slerpQuaternions(_walk, _aim.copy(arm.quaternion), w.carry);
      bend[i] = bend[i]! + (b - bend[i]!) * w.carry;
    }
  }
  if (patting !== null) {
    const arm = a.arms[patting];
    _walk.copy(arm.quaternion);
    const b = reachFor(a, patting, _hand);
    arm.quaternion.slerpQuaternions(_walk, _aim.copy(arm.quaternion), k);
    bend[patting] = bend[patting] + (b - bend[patting]) * k;
  }

  if (c > 0 && a.ladder) {
    const l = a.ladder;
    // Hands up to the rungs, one over the other (unless they are full), the opposite knee
    // coming up with each hand, and a look up the ladder.
    if (!gait.carrying) {
      for (const [i, side] of [-1, 1].entries()) {
        const arm = a.arms[i]!;
        const up = CLIMB_ARM.mid - side * swing * CLIMB_ARM.span;
        arm.rotation.set(arm.rotation.x * (1 - c) + up * c, 0, arm.rotation.z * (1 - c));
        bend[i] = bend[i]! + (ELBOW.climb - bend[i]!) * c;
      }
    }
    for (const [i, side] of [-1, 1].entries()) {
      const leg = a.legs[i]!;
      const up = CLIMB_LEG.mid + side * swing * CLIMB_LEG.span;
      leg.rotation.x = leg.rotation.x * (1 - c) + up * c;
    }
    a.head.rotation.x += CLIMB_LOOK_UP * c;
    // Facing the ladder, a step back from its plane and centred between its rails.
    _stance.set(0, 0, CLIMB_STANDOFF).applyAxisAngle(UP, l.facing);
    pos.x += (l.pos.x + _stance.x - pos.x) * c;
    pos.z += (l.pos.z + _stance.z - pos.z) * c;
    a.group.rotation.y = lerpAngle(a.group.rotation.y, l.facing, c);
  }
  a.elbows[0].rotation.x = bend[0];
  a.elbows[1].rotation.x = bend[1];
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
