import type RAPIER from '@dimforge/rapier3d-compat';
import type { ImpulseJoint, RigidBody, World } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { lerpAngle } from '@sar/shared';
import type { LadderDef, Vec3 } from '@sar/shared';
import { BUS } from '../carscene/bus.ts';
import { CAR } from '../carscene/car.ts';
import { cbox, glow, mat, rbox } from '../carscene/kit.ts';
import type { MatOptions } from '../carscene/kit.ts';
import { SPORT } from '../carscene/sportscar.ts';

// A player is the toy mechanic of car-test.html, in the cars' style, the same for everyone: a
// teal jacket piped in the cars' cyan light, charcoal trousers and gloves, red lacquered
// trainers on white soles, a yellow tool pouch on the back of the belt, a red cap, and a dark
// visor whose strip across the eyes glows in the player's colour, like the cars' lamps. The body
// is a torso, a head and four limbs, so the walk cycle, the grip and the ragdoll see the parts.
//
// The mechanic is drawn 1.8 m tall to the top of its cap (see `carscene/player.ts`), and here at
// `FIGURE` of that, to stand in the player's collision capsule. Positions are relative to the
// centre of that capsule. The character controller keeps it a skin width (0.02) off the floor,
// so the legs reach `FEET` below the centre, a little into the floor: a foot only just touching
// the floor hangs a hair above it, and the shadow maps' offsets let light in under there,
// ringing each foot. Sunk in, the foot's shadow starts right at it.
//
// Nothing pokes through anything else, in any pose (see `avatar-clipping.test.ts`): the arms
// hang a little out from the body so the hands clear the belt.
/** How much of the mechanic's size the figure is drawn at. */
const FIGURE = 0.92;
/** How far below the capsule's centre the soles are. */
const FEET = 0.885;
/** Where `y` metres up the mechanic (as `carscene/player.ts` draws it) is, from the centre. */
const up = (y: number) => y * FIGURE - FEET;
const TORSO = { r: 0.14 * FIGURE, len: 0.26 * FIGURE, y: up(1.2) };
const HEAD = { r: 0.135 * FIGURE, y: up(1.67) };
/** From the shoulder to the elbow, and from the elbow to the middle of the hand. */
const UPPER_ARM = 0.28 * FIGURE;
const FOREARM = 0.29 * FIGURE;
/** How far up the arm's end the middle of the hand sits. */
const HAND_IN = 0.03;
const ARM = {
  r: 0.07 * FIGURE,
  len: UPPER_ARM + FOREARM + HAND_IN - 0.14 * FIGURE,
  x: 0.32 * FIGURE,
  y: up(1.42),
};
const LEG = { r: 0.085 * FIGURE, len: 0.73 * FIGURE, x: 0.12 * FIGURE, y: up(0.9) };
/** Where the cap's origin (its brow line) sits in the head's space. */
const CAP_Y = 0.07 * FIGURE;
/** Distance from a shoulder or hip to the middle of the limb hanging from it. */
const ARM_DROP = (ARM.len + 2 * ARM.r) / 2;
const LEG_DROP = (LEG.len + 2 * LEG.r) / 2;
/** How far (radians) the arms hang out from the body at rest, so the hands clear the belt. */
const ARM_OUT = 0.08;

export interface Avatar {
  group: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Group;
  /** The cap, a child of the head, and what stands in for it flying off a ragdoll. */
  hat: THREE.Object3D;
  hatCollider: HatCollider;
  /** A dog biscuit in the right hand, shown while holding a treat. */
  treat: THREE.Mesh;
  /** A page sticking out of the chest pocket, shown while one is in it. */
  page: THREE.Mesh;
  /** Limbs hang from pivots at the shoulders and hips, so swinging is a rotation. */
  arms: [THREE.Group, THREE.Group];
  /** Each forearm hangs from its elbow, which bends it forward (about x). */
  elbows: [THREE.Group, THREE.Group];
  /** The gloved hands, at the ends of the forearms. */
  hands: [THREE.Mesh, THREE.Mesh];
  legs: [THREE.Group, THREE.Group];
  /** Each shin hangs from its knee, in the middle of the leg, which folds it back (about x). */
  knees: [THREE.Group, THREE.Group];
  /** The domed toe of each boot, at the end of its leg (worn gear caps it in steel). */
  toes: [THREE.Mesh, THREE.Mesh];
  /**
   * Walk cycle, advanced by how far the player moved, and how big the swing is (0..1, all of it
   * from a brisk walk on). `pace` is how fast the avatar goes (m/s), smoothed.
   */
  phase: number;
  amp: number;
  pace: number;
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
  /** How far the head is turned ahead of the body into a turn (radians, + to the left), smoothed. */
  glance: number;
  /** How far into squeezing side-on through a gap (0..1). */
  squeeze: number;
}

/** The mechanic's jacket and skin, the same for everyone. */
const TEAL = 0x2c6670;
const SKIN = 0xe2b496;

/**
 * The car scene's materials (see `carscene/kit.ts`), each the avatar's own: the car scene's are
 * shared, and an avatar's go when it does.
 */
const own = (colour: number, o: MatOptions = {}) => mat(colour, o).clone();
const charcoal = () => own(CAR.trim, { mottle: 'plastic', roughness: 0.7 });
const lacquer = () =>
  own(SPORT.red, {
    mottle: 'paint',
    roughness: 0.4,
    metalness: 0.15,
    envMapIntensity: 1.4,
    clearcoat: 1,
    clearcoatRoughness: 0.2,
  });
const steel = () =>
  own(0xc8ced2, { mottle: 'metal', roughness: 0.3, metalness: 0.75, envMapIntensity: 2.2 });
const plain = (colour: number, roughness = 0.6) => own(colour, { mottle: 'plastic', roughness });
const lit = (colour: number, k = 2) => glow(colour, k).clone();

/**
 * A rounded box (crisp-edged if `crisp`) on `parent`, sized and placed as the mechanic has it
 * (see `carscene/player.ts`), at the figure's size, named `name`.
 */
function part(
  parent: THREE.Object3D,
  material: THREE.Material,
  [x, y, z]: [number, number, number],
  [sx, sy, sz]: [number, number, number],
  r: number,
  name = '',
  crisp = false,
): THREE.Mesh {
  const k = FIGURE;
  const m = (crisp ? cbox : rbox)(
    parent,
    material,
    x * k,
    y * k,
    z * k,
    sx * k,
    sy * k,
    sz * k,
    r * k,
  );
  m.name = name;
  return m;
}

/** How far out from the middle of a gloved hand what it holds is kept (its cuff is wider). */
const HAND_R = 0.09 * FIGURE;

/** A cylinder (half height, radius) centred `y` above the cap's origin, for it flying off. */
export interface HatCollider {
  halfHeight: number;
  radius: number;
  y: number;
}

/**
 * The mechanic's red lacquered cap, on the head: a rounded crown snug on it, a short peak out
 * front, a charcoal button on top. Its origin is on the brow line, under the crown.
 */
function cap(head: THREE.Group): { group: THREE.Group; collider: HatCollider } {
  const group = new THREE.Group();
  group.position.y = CAP_Y;
  head.add(group);
  const red = lacquer();
  const below = CAP_Y / FIGURE;
  part(group, red, [0, 0.13 - below, 0], [0.285, 0.1, 0.285], 0.05, 'crown');
  part(group, red, [0, 0.095 - below, -0.17], [0.24, 0.025, 0.12], 0.012, 'peak');
  part(group, charcoal(), [0, 0.19 - below, 0], [0.05, 0.02, 0.05], 0.008, 'button');
  return { group, collider: { halfHeight: 0.06, radius: 0.14, y: 0.06 } };
}

/**
 * Builds a player: car-test's mechanic, their `colour` lit in the visor's strip across their
 * eyes, with `nameTag` over their head (none for your own).
 */
export function makeAvatar(colour: number, nameTag: THREE.Object3D | null): Avatar {
  const group = new THREE.Group();
  if (nameTag) group.add(nameTag);
  const jacket = own(TEAL, {
    mottle: 'paint',
    roughness: 0.55,
    metalness: 0.05,
    envMapIntensity: 1.2,
    clearcoat: 0.4,
    clearcoatRoughness: 0.4,
  });
  const trousers = charcoal();
  const skin = plain(SKIN);
  const cyan = lit(CAR.blue);
  const band = lit(CAR.blue, 1.4);

  // The jacket: a rounded block over the chest (the torso, its middle the origin of what is
  // worn on it), its hem below, a charcoal collar and belt with a steel buckle, a yellow tool
  // pouch on the back of the belt (out of the way of the hands and legs), cyan piping down its
  // zip and across the chest, a lime badge, a back panel and two steel rivets on the shoulders.
  const torso = part(group, jacket, [0, 0, 0], [0.5, 0.5, 0.3], 0.09, 'jacket');
  torso.position.y = TORSO.y;
  part(torso, jacket, [0, -0.2, 0], [0.44, 0.14, 0.27], 0.06, 'hem');
  part(torso, trousers, [0, -0.26, 0], [0.42, 0.1, 0.25], 0.03, 'belt', true);
  part(torso, steel(), [0, -0.26, -0.128], [0.09, 0.06, 0.012], 0.008, 'buckle', true);
  const yellow = own(BUS.yellow, { mottle: 'paint', roughness: 0.45, envMapIntensity: 1.3 });
  part(torso, yellow, [0.12, -0.22, 0.155], [0.16, 0.12, 0.06], 0.02, 'pouch');
  part(torso, trousers, [0.12, -0.17, 0.187], [0.15, 0.04, 0.008], 0.004, 'flap', true);
  part(torso, trousers, [0, 0.25, 0.01], [0.3, 0.06, 0.24], 0.025, 'collar', true);
  part(torso, cyan, [0, -0.04, -0.151], [0.018, 0.46, 0.008], 0.004, 'zip', true);
  part(torso, band, [0, 0.13, -0.149], [0.44, 0.016, 0.008], 0.004, 'piping', true);
  const lime = own(CAR.lime, { mottle: 'paint', roughness: 0.45 });
  part(torso, lime, [-0.13, 0.05, -0.153], [0.08, 0.06, 0.008], 0.004, 'badge', true);
  part(torso, jacket, [0.13, 0.03, -0.152], [0.11, 0.1, 0.012], 0.004, 'pocket', true);
  part(torso, trousers, [0, 0.02, 0.152], [0.32, 0.3, 0.012], 0.006, 'back panel', true);
  for (const s of [-1, 1])
    part(torso, steel(), [s * 0.2, 0.23, -0.06], [0.035, 0.035, 0.035], 0.015, 'rivet');

  // The head: a rounded toy head with ears, the neck down into the collar, the dark visor
  // with its strip lit in the player's colour, and the cap.
  const head = new THREE.Group();
  head.position.y = HEAD.y;
  const skull = part(head, skin, [0, 0, 0], [0.27, 0.28, 0.27], 0.1, 'skull');
  for (const s of [-1, 1]) part(skull, skin, [s * 0.14, 0, 0.01], [0.03, 0.07, 0.05], 0.015, 'ear');
  part(head, skin, [0, -0.17, 0], [0.12, 0.08, 0.12], 0.04, 'neck');
  const glass = own(0x0e1418, {
    mottle: 'none',
    roughness: 0.08,
    metalness: 0.2,
    envMapIntensity: 2.2,
  });
  part(head, glass, [0, 0.02, -0.12], [0.25, 0.075, 0.06], 0.03, 'visor');
  part(head, lit(colour, 2.4), [0, 0.02, -0.152], [0.2, 0.014, 0.006], 0.004, 'strip', true);
  const hat = cap(head);
  group.add(head);

  // An arm bends at the elbow: the upper arm hangs from the shoulder, the forearm from the
  // elbow, with the cuff and the gloved hand at its end. The arm as a whole (what a ragdoll
  // throws about) is the group under the shoulder's pivot, centred where a straight arm's
  // middle would be.
  const drop = ARM_DROP / FIGURE;
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
    part(arm, jacket, [0, drop - 0.12, 0], [0.14, 0.36, 0.15], 0.06, 'upper arm');
    const elbow = new THREE.Group();
    elbow.name = 'elbow';
    elbow.position.y = ARM_DROP - UPPER_ARM;
    arm.add(elbow);
    elbows.push(elbow);
    part(elbow, jacket, [0, -0.1, 0], [0.13, 0.22, 0.14], 0.055, 'forearm');
    part(elbow, trousers, [0, -0.21, 0], [0.135, 0.04, 0.145], 0.012, 'cuff', true);
    hands.push(part(elbow, trousers, [0, -0.29, 0], [0.11, 0.13, 0.12], 0.05, 'hand'));
    return pivot;
  }) as [THREE.Group, THREE.Group];

  // A leg bends at the knee: the trouser leg hangs from the hip to it, and from the knee on the
  // shin to the cuff, a cyan reflective band round it, and a trainer, a red lacquered upper on a
  // thick white sole. The leg as a whole (what a ragdoll throws about) is the group under the
  // hip's pivot, centred at the leg's middle, which is where the knee is.
  const sole = plain(0xeceae4, 0.5);
  const red = lacquer();
  const toes: THREE.Mesh[] = [];
  const knees: THREE.Group[] = [];
  const legs = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * LEG.x, LEG.y, 0);
    const leg = new THREE.Group();
    leg.name = 'leg';
    leg.position.y = -LEG_DROP;
    pivot.add(leg);
    group.add(pivot);
    part(leg, trousers, [0, 0.25, 0], [0.17, 0.5, 0.19], 0.06, 'thigh');
    const knee = new THREE.Group();
    knee.name = 'knee';
    leg.add(knee);
    knees.push(knee);
    part(knee, trousers, [0, -0.18, 0], [0.155, 0.4, 0.175], 0.055, 'shin');
    part(knee, band, [0, -0.23, 0], [0.162, 0.03, 0.182], 0.01, 'band', true);
    part(knee, sole, [0, -0.42, -0.04], [0.16, 0.06, 0.3], 0.025, 'sole');
    part(knee, red, [0, -0.35, 0.02], [0.15, 0.1, 0.2], 0.045, 'trainer');
    toes.push(part(knee, red, [0, -0.365, -0.115], [0.15, 0.07, 0.1], 0.035, 'toe'));
    part(knee, sole, [0, -0.32, -0.14], [0.1, 0.012, 0.05], 0.005, 'lace', true);
    return pivot;
  }) as [THREE.Group, THREE.Group];
  const treat = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.04, 0.05),
    new THREE.MeshStandardMaterial({ color: 0xa0632e, roughness: 0.9 }),
  );
  treat.position.set(0, -FOREARM - 0.02, -0.05);
  treat.visible = false;
  treat.castShadow = true;
  elbows[1]!.add(treat);
  // Folded, half out of the chest pocket, a little askew: whoever has a page shows it.
  const page = new THREE.Mesh(
    new THREE.BoxGeometry(0.075, 0.07, 0.004),
    new THREE.MeshStandardMaterial({ color: 0xf6f1e3, roughness: 0.9 }),
  );
  page.position.set(0.13 * FIGURE, 0.09 * FIGURE, -0.162 * FIGURE);
  page.rotation.z = 0.12;
  page.visible = false;
  page.name = 'pocketPage';
  torso.add(page);
  return {
    group,
    torso,
    head,
    hat: hat.group,
    hatCollider: hat.collider,
    treat,
    page,
    arms,
    elbows: elbows as [THREE.Group, THREE.Group],
    hands: hands as [THREE.Mesh, THREE.Mesh],
    legs,
    knees: knees as [THREE.Group, THREE.Group],
    toes: toes as [THREE.Mesh, THREE.Mesh],
    phase: 0,
    amp: 0,
    pace: 0,
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
    glance: 0,
    squeeze: 0,
  };
}

/**
 * The walk and the run are car-test.html's mechanic's (see `carscene/player.ts`). The cycle goes
 * round about once every 1.4 m at a walk, further at a run (radians a metre at `pace` m/s).
 * The swing is all there from `FULL_PACE` (m/s) on: the legs swing `swing` radians at the hip,
 * `run` more from `RUN_PACE` on, the knee of the leg swinging through folds `knee` radians, the
 * body bobs up `bob` metres as the legs pass, the chest leans `lean` radians into the walk and
 * the head nods `nod` back up.
 */
const cycleRate = (pace: number) => Math.PI / (1.1 + pace * 0.08);
const FULL_PACE = 4;
const RUN_PACE = 5.5;
const WALK = { swing: 0.55, run: 0.15, knee: 1.1, bob: 0.04, lean: 0.06, nod: 0.04 };
/** Side steps are shorter: a step out and a step in every 1.2 m. */
const SIDE_STRIDE = (2 * Math.PI) / 1.2;
/** How far the legs open (radians at the hip) at the widest of a side step at a full swing. */
const SIDE_SPREAD = 0.5;
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
/** How far the knees fold in the air (radians), the leading leg's and the trailing one's. */
const JUMP_KNEES = { up: { lead: -1.25, trail: -0.6 }, down: { lead: -0.45, trail: -0.3 } };
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
const ELBOW = { rest: 0.25, run: 0.35, carry: 0.25, air: 0.35, climb: 0.3 };
/**
 * Radians of climb cycle per metre climbed: a hand over hand every 1.2 m, about two a second
 * at climbing speed (the climb is quick, so the hands skip rungs).
 */
const RUNG_STRIDE = (2 * Math.PI) / 1.2;
/** How long standing up from the floor takes. */
export const GET_UP_SECONDS = 0.6;
/**
 * Turning to face a new way (see `Gait.turn`): standing, the feet shuffle round as if walking a
 * circle this wide (m, about the hips' width) at the speed the body turns. The head looks round
 * first, by this much of what is left of the turn and at most `HEAD_TURN` (radians), and on the
 * move the body leans into the turn by `LEAN` radians per radian a second at a full swing, at
 * most `MAX_LEAN`.
 */
const TURN_STEP = 0.16;
const HEAD_LEAD = 0.5;
const HEAD_TURN = 0.6;
const LEAN = 0.012;
const MAX_LEAN = 0.12;

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
  /**
   * How steeply the ground the player stands on rises ahead of them and to their right (rise per
   * metre run), on sloping ground: their feet reach for it, and their strides shorten.
   */
  slope?: { ahead: number; right: number } | null;
  /**
   * Turning to face a new way: how fast the body turns (radians a second, + to its left) and how
   * far it still has to go (radians, + to its left).
   */
  turn?: { spin: number; lead: number } | null;
  /** Side-on, edging through a gap too narrow to walk through. */
  squeeze?: boolean;
}

/**
 * Left and right hand positions, in the avatar's own space (forward is -z). A hand that is null
 * holds nothing and swings free, as the left one does carrying the vacuum.
 */
export type Grip = [THREE.Vector3 | null, THREE.Vector3 | null];

/** From a shoulder pivot to the middle of the hand at the end of the arm. */
const HAND_REACH = 2 * ARM_DROP - HAND_IN;
/** Hands rest this far off the item's surface: the glove just touching it. */
const HAND_GAP = HAND_R + 0.004;
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
export function gripPoints(
  a: Avatar,
  item: THREE.Object3D,
  tray: boolean,
): [THREE.Vector3, THREE.Vector3] | null {
  a.group.updateMatrixWorld(true);
  item.updateMatrixWorld(true);
  _inv.copy(a.group.matrixWorld).invert();
  _box.makeEmpty();
  item.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    // An instanced mesh (a build's bricks of one kind) spans all its copies.
    let box = o instanceof THREE.InstancedMesh ? o.boundingBox : o.geometry.boundingBox;
    if (!box) {
      if (o instanceof THREE.InstancedMesh) o.computeBoundingBox();
      else o.geometry.computeBoundingBox();
      box = o instanceof THREE.InstancedMesh ? o.boundingBox : o.geometry.boundingBox;
    }
    _toAvatar.multiplyMatrices(_inv, o.matrixWorld);
    _box.union(_part.copy(box!).applyMatrix4(_toAvatar));
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
/**
 * On a slope: how much shorter the strides are (by the rise per metre ahead), and how far the
 * body may come down and a leg be drawn up into it, to keep the feet on the ground.
 */
const SLOPE_STRIDE = 0.6;
const SLOPE_REACH = { down: 0.12, up: 0.2 };

/**
 * How the legs keep their feet on sloping ground (`slope`, see `Gait`), as they stand now: each
 * foot is over ground higher or lower than the ground under the middle, by the slope and how
 * far it is out ahead or to the side. The body comes down (`down`) until the foot over the
 * lowest ground reaches it, and each leg is drawn up (`up`) by as much higher as the ground
 * under it is from there, each only so far: the leg's top then goes up inside the body.
 */
function footing(
  a: Avatar,
  slope: Gait['slope'],
  knee: [number, number],
): { down: number; up: [number, number] } {
  if (!slope) return { down: 0, up: [0, 0] };
  // Where each foot is, from its hip (a leg turns about x, then z; the shin turns on about x
  // at the knee): ahead of the middle (-z) and to its right (+x). A shin folded back carries
  // its foot back over the ground behind, and up by as much as it folds.
  const shin = HIP_HEIGHT - LEG_DROP;
  const lift = [0, 0];
  const rise = a.legs.map((leg, i) => {
    const { x: rx, z: rz } = leg.rotation;
    const bent = rx + knee[i]!;
    lift[i] = shin * (Math.cos(rx) - Math.cos(bent));
    const right = (i === 0 ? -LEG.x : LEG.x) + HIP_HEIGHT * Math.sin(rz);
    const ahead = Math.cos(rz) * (LEG_DROP * Math.sin(rx) + shin * Math.sin(bent));
    return slope.ahead * ahead + slope.right * right;
  });
  const down = Math.min(SLOPE_REACH.down, Math.max(0, -Math.min(...rise)));
  const up = rise.map((r, i) => Math.min(SLOPE_REACH.up, Math.max(0, r + down - lift[i]!)));
  return { down, up: up as [number, number] };
}
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
/**
 * Squeezing side-on through a gap (see `Gait.squeeze`): how far the arms come forward and in
 * (radians at the shoulder, from hanging out at `ARM_OUT`), how much more the elbows bend, and
 * how far the head turns the way they edge.
 */
const SQUEEZE_ARMS = { forward: 0.2, out: 0.02, bend: 0.9 };
const SQUEEZE_LOOK = 0.8;
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
 * Swings arms and legs by how fast the avatar moved since the last frame, as car-test.html's
 * mechanic walks and runs: the knee of the leg swinging through folds, the body bobs as the legs
 * pass and leans into the walk, and a run swings further. Walking carefully crouches a little on
 * bent knees with the arms out. Moving sideways (strafing) side-steps instead, the leading leg
 * stepping out and the other closing up to it, blending into the walk for a diagonal; squeezing
 * side-on through a gap, the arms come in, the hands up before the chest, and the head looks
 * the way they edge. Limping hurries over the sore right leg,
 * which barely swings, and drops and leans onto it with every other step. The elbows bend a
 * little standing and more at a run. Carrying holds both arms out in front, the hands on the
 * item's grip points when there are some (the elbows bending to put them there). Patting the dog
 * drops into a lunge, leans over and strokes the dog's head with the right hand. Climbing turns
 * to the ladder, steps back off its plane and goes up it hand over hand, each knee coming up
 * with the other hand. Jumping brings a knee and the arms up, the knees bent, coming down
 * reaches for the ground with the arms spread, and the landing squats on bent knees by how hard
 * it came down. Every one of
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
  // Turning on the spot steps the feet round; walking, the steps are the walk's.
  const pivot = gait.climb || gait.airborne ? 0 : Math.abs(gait.turn?.spin ?? 0) * dt * TURN_STEP;
  const stepped = Math.max(step, pivot);
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
  const speed = (gait.climb ? rung : stepped) / Math.max(dt, 1e-3);
  // Every pose eases in and out at the same rate, so moving from one to another (picking
  // something up while limping, jumping out of a careful walk) is one smooth change.
  const ease = Math.min(1, dt * BLEND);
  if (!airborne) a.pace += (speed - a.pace) * ease;
  if (gait.climb) a.phase += rung * RUNG_STRIDE;
  else if (!airborne) a.phase += stepped * (cycleRate(a.pace) * ahead + SIDE_STRIDE * sideways);
  /** How much of a run's longer swing there is. */
  const run = Math.min(1, Math.max(0, a.pace - RUN_PACE + 0.5));
  a.carry += ((gait.carrying ? 1 : 0) - a.carry) * ease;
  a.careful += ((gait.careful ? 1 : 0) - a.careful) * ease;
  a.limp += ((gait.limping ? 1 : 0) - a.limp) * ease;
  // Into the air quickly (a jump is short), back out as quickly on landing.
  a.air += ((airborne ? 1 : 0) - a.air) * Math.min(1, dt * 20);
  const w = { carry: a.carry, careful: a.careful * (1 - a.carry), limp: a.limp, air: a.air };
  // How much each arm holds something: a hand left free by the grip swings as if empty.
  const hold = [0, 1].map((i) => (gait.grip && !gait.grip[i] ? 0 : w.carry)) as [number, number];
  // How big the swing is follows the speed, smoothed so frame hitches do not twitch it. A limp
  // is slow but makes big, lurching steps on the good leg.
  // Up or down a slope the strides are shorter.
  const steep = 1 + SLOPE_STRIDE * Math.abs(gait.slope?.ahead ?? 0);
  const target = Math.min(1, (speed / (gait.climb ? 2 : FULL_PACE)) * (1 + w.limp)) / steep;
  a.amp += (target - a.amp) * ease;
  // A limp hurries through the half of the cycle with the weight on the sore leg (sin > 0).
  const cycle = a.phase - LIMP_HURRY * w.limp * Math.sin(a.phase);
  const swing = Math.sin(cycle) * a.amp * (WALK.swing + WALK.run * run);
  const sore = 1 + (LIMP_LEG_SWING - 1) * w.limp;
  a.legs[0].rotation.x = swing * ahead;
  a.legs[1].rotation.x = -swing * sore * ahead;
  // The knee of the leg swinging through folds, and straightens again to take the weight.
  const fold = WALK.knee * a.amp * ahead;
  const knee: [number, number] = [
    -Math.max(0, Math.cos(cycle)) * fold,
    -Math.max(0, -Math.cos(cycle)) * fold * (1 - 0.7 * w.limp),
  ];
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
  // Side-stepping, a knee bends as its leg opens out.
  knee[0] -= Math.abs(a.legs[0].rotation.z) * 0.45;
  knee[1] -= Math.abs(a.legs[1].rotation.z) * 0.45;
  // Legs apart, the hips come down to keep both feet on the floor.
  const spread = Math.max(Math.abs(a.legs[0].rotation.z), Math.abs(a.legs[1].rotation.z));
  const straddle = HIP_HEIGHT * (1 - Math.cos(spread));
  // Arms: forward to hold something (rotating +x swings a hanging arm to the front, -z),
  // out to the sides for balance when careful, otherwise swinging against the legs. Limping,
  // the arm on the sore side stays stiff; side-stepping, the arms open a little with the legs.
  const balance = 0.55 * w.careful;
  const armSwing = (i: 0 | 1) => swing * 0.9 * ahead * (1 - hold[i]);
  const stiff = 0.12 * w.limp * (1 - hold[1]);
  a.arms[0].rotation.set(
    1.35 * hold[0] - armSwing(0),
    0,
    -(ARM_OUT + balance + 0.5 * Math.abs(a.legs[0].rotation.z)),
  );
  a.arms[1].rotation.set(
    1.35 * hold[1] + armSwing(1) * (1 - 0.6 * w.limp),
    0,
    ARM_OUT + balance + 0.5 * Math.abs(a.legs[1].rotation.z) + stiff,
  );
  // Elbows: a little bent at rest, more the faster the avatar goes, and the sore side's arm held
  // stiff.
  const bend: [number, number] = [0, 0];
  for (const i of [0, 1] as const) {
    bend[i] =
      (ELBOW.rest + ELBOW.run * a.amp * ahead + ELBOW.carry * hold[i]) *
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
    const kneePose = [
      mix(JUMP_KNEES.up.lead, JUMP_KNEES.down.lead),
      mix(JUMP_KNEES.up.trail, JUMP_KNEES.down.trail),
    ];
    for (const [i, leg] of a.legs.entries()) {
      const want = legPose[i === lead ? 0 : 1]!;
      leg.rotation.x += (want - leg.rotation.x) * w.air;
      knee[i] = knee[i]! + (kneePose[i === lead ? 0 : 1]! - knee[i]!) * w.air;
    }
    // Arms up and out, unless they hold something.
    const up = mix(JUMP_UP.arms, JUMP_DOWN.arms);
    const out = mix(JUMP_UP.out, JUMP_DOWN.out);
    for (const [i, arm] of a.arms.entries()) {
      const side = i === 0 ? -1 : 1;
      const free = w.air * (1 - hold[i]!);
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
  knee[0] *= 1 - k;
  knee[1] *= 1 - k;
  // Crouching (walking carefully, the squat of a landing), the hips come down over the feet on
  // bent knees: each thigh forward, its shin back twice as far.
  const sit = Math.acos(Math.max(-1, 1 - crouch / HIP_HEIGHT));
  for (const i of [0, 1] as const) {
    a.legs[i].rotation.x += sit;
    knee[i] -= 2 * sit;
  }
  // Walking, the whole body bobs up as the legs pass each other, as the mechanic's does.
  const bob = Math.abs(Math.cos(cycle)) * WALK.bob * a.amp * ahead * (1 - w.air) * (1 - k);
  a.legs[0].position.y = a.legs[1].position.y = LEG.y - low - straddle - crouch + bob;
  // On a slope, the body comes down for the foot over the lower ground to reach it, and the leg
  // over the higher ground is drawn up into it (see `footing`).
  const tread = footing(a, gait.slope, knee);
  a.legs[0].position.y += tread.up[0] - tread.down;
  a.legs[1].position.y += tread.up[1] - tread.down;
  // Leaning over: the shoulders come forward with the chest, the head looks down at the dog.
  const lean = Math.sin(PAT_LEAN * k);
  const stride = a.amp * ahead * (1 - w.air) * (1 - k);
  a.torso.rotation.x = -PAT_LEAN * k - WALK.lean * stride;
  a.head.rotation.x = -0.4 * k + WALK.nod * stride;
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
  const drop = dip + crouch + low + straddle + tread.down - bob;
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
    arm.rotation.z += list * (1 - hold[i]!);
  }
  // Squeezing side-on through a gap, as the mechanic does: the arms drawn in, the hands up before
  // the chest (unless they hold something), and the head turned the way they edge.
  a.squeeze += ((gait.squeeze ? 1 : 0) - a.squeeze) * ease;
  if (a.squeeze < 1e-3) a.squeeze = 0;
  const q = a.squeeze * (1 - c);
  for (const [i, arm] of a.arms.entries()) {
    const free = q * (1 - hold[i]!);
    if (free === 0) continue;
    arm.rotation.x += SQUEEZE_ARMS.forward * free;
    arm.rotation.z += ((i === 0 ? -1 : 1) * SQUEEZE_ARMS.out - arm.rotation.z) * free;
    bend[i] = bend[i]! + SQUEEZE_ARMS.bend * free;
  }
  // Reaching in front of the body for what the hands hold, the shoulders come forward and in
  // (the further in the hand goes, the more), so the arms go round the chest rather than
  // through it. Then each hand goes to its grip, and the patting hand to the dog.
  if (gait.grip) {
    for (const [i, arm] of a.arms.entries()) {
      const at = gait.grip[i];
      if (!at) continue;
      const side = i === 0 ? -1 : 1;
      const inward = Math.min(1, Math.max(0, (ARM.x - side * at.x) / PROTRACT.span));
      arm.position.x -= side * PROTRACT.x * inward * w.carry;
      arm.position.z -= PROTRACT.z * inward * w.carry;
      // A hand just out of reach gets there by the shoulder reaching after it.
      _dir.subVectors(at, arm.position);
      const short = Math.min(PROTRACT.reach, _dir.length() - HAND_REACH + 1e-3);
      if (short > 0) arm.position.addScaledVector(_dir.normalize(), short * w.carry);
      _walk.copy(arm.quaternion);
      const b = reachFor(a, i as 0 | 1, at);
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
        const up = CLIMB_ARM.mid - side * Math.sin(cycle) * a.amp * CLIMB_ARM.span;
        arm.rotation.set(arm.rotation.x * (1 - c) + up * c, 0, arm.rotation.z * (1 - c));
        bend[i] = bend[i]! + (ELBOW.climb - bend[i]!) * c;
      }
    }
    for (const [i, side] of [-1, 1].entries()) {
      const leg = a.legs[i]!;
      const up = CLIMB_LEG.mid + side * Math.sin(cycle) * a.amp * CLIMB_LEG.span;
      leg.rotation.x = leg.rotation.x * (1 - c) + up * c;
      // The shin hangs down from the raised knee to the rung.
      knee[i] = knee[i]! * (1 - c) - up * c;
    }
    a.head.rotation.x += CLIMB_LOOK_UP * c;
    // Facing the ladder, a step back from its plane and centred between its rails.
    _stance.set(0, 0, CLIMB_STANDOFF).applyAxisAngle(UP, l.facing);
    pos.x += (l.pos.x + _stance.x - pos.x) * c;
    pos.z += (l.pos.z + _stance.z - pos.z) * c;
    a.group.rotation.y = lerpAngle(a.group.rotation.y, l.facing, c);
  }
  // Into a turn the head looks round first and the body follows; on the move it leans in.
  const turn = gait.climb ? null : gait.turn;
  const glance = Math.max(-HEAD_TURN, Math.min(HEAD_TURN, (turn?.lead ?? 0) * HEAD_LEAD));
  a.glance += (glance - a.glance) * Math.min(1, dt * 20);
  a.head.rotation.y = a.glance * (1 - c) * (1 - q) - Math.sign(a.side || 1) * SQUEEZE_LOOK * q;
  const into = (turn?.spin ?? 0) * a.amp * LEAN * (1 - w.air);
  a.group.rotation.z = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, into)) * (1 - c);
  a.elbows[0].rotation.x = bend[0];
  a.elbows[1].rotation.x = bend[1];
  a.knees[0].rotation.x = knee[0];
  a.knees[1].rotation.x = knee[1];
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

/** How far a ragdoll's part may sink under sloping ground before it is put back up on it. */
const SUNK = 0.1;

/**
 * A knocked-over player: the avatar's parts as physics bodies joined at the neck, shoulders
 * and hips, thrown the way the player fell. The cap comes off on its own. Lives in the
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
    /** The height of the level's ground, where it rises and falls (see `sync`). */
    private readonly ground?: (x: number, z: number) => number,
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
    headCopy.remove(headCopy.children[avatar.head.children.indexOf(avatar.hat)]!);
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
    const { halfHeight, radius, y } = avatar.hatCollider;
    add(
      avatar.hat,
      worldCopy(avatar.hat),
      R.ColliderDesc.cylinder(halfHeight, radius).setTranslation(0, y, 0),
      push(2.6, 2.4),
      6,
      0.35,
    );

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

  /**
   * Moves the meshes to where the bodies are; call every frame while lying there. A part that
   * has slipped through sloping ground (between its triangles, tumbling down a steep bank) is
   * put back up onto it, no longer falling.
   */
  sync(): void {
    for (const { body, mesh } of this.parts) {
      if (!body) continue;
      const t = body.translation();
      const floor = this.ground?.(t.x, t.z);
      if (floor !== undefined && t.y < floor - SUNK) {
        t.y = floor + SUNK;
        body.setTranslation(t, true);
        const v = body.linvel();
        if (v.y < 0) body.setLinvel({ x: v.x, y: 0, z: v.z }, true);
      }
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
