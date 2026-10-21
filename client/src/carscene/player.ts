import * as THREE from 'three';
import { gameNow } from '../clock.ts';
import { BUS } from './bus.ts';
import { CAR } from './car.ts';
import { cbox, glow, mat, rbox } from './kit.ts';
import { SPORT } from './sportscar.ts';

/**
 * The player on the car test map: a chunky toy mechanic in the cars' style. A teal jacket piped
 * in the cars' cyan light, charcoal trousers and gloves, red lacquered trainers on white soles, a
 * red cap, a yellow tool pouch at the belt, and a visor that glows cyan like the cars' lamps.
 *
 * Built standing on the origin, facing -z (as the walker's heading counts), 1.8 m to the top of
 * the cap. Its limbs hang from pivots at the hips, knees, shoulders and elbows, which
 * `animatePlayer` swings.
 */

const TEAL = 0x2c6670;
const SKIN = 0xe2b496;

const jacket = () =>
  mat(TEAL, {
    mottle: 'paint',
    roughness: 0.55,
    metalness: 0.05,
    envMapIntensity: 1.2,
    clearcoat: 0.4,
    clearcoatRoughness: 0.4,
  });
const charcoal = () => mat(CAR.trim, { mottle: 'plastic', roughness: 0.7 });
const red = () =>
  mat(SPORT.red, {
    mottle: 'paint',
    roughness: 0.4,
    metalness: 0.15,
    envMapIntensity: 1.4,
    clearcoat: 1,
    clearcoatRoughness: 0.2,
  });
const sole = () => mat(0xeceae4, { mottle: 'plastic', roughness: 0.5 });
const skin = () => mat(SKIN, { mottle: 'plastic', roughness: 0.6 });
const steel = () =>
  mat(0xc8ced2, { mottle: 'metal', roughness: 0.3, metalness: 0.75, envMapIntensity: 2.2 });
const yellow = () => mat(BUS.yellow, { mottle: 'paint', roughness: 0.45, envMapIntensity: 1.3 });
const visorGlass = () =>
  mat(0x0e1418, { mottle: 'none', roughness: 0.08, metalness: 0.2, envMapIntensity: 2.2 });
const cyan = (k = 2) => glow(CAR.blue, k);

/** Where the limbs hang from, over the feet. */
const HIP = { y: 0.9, x: 0.12 };
const KNEE = 0.44;
const SHOULDER = { y: 1.42, x: 0.29 };
const ELBOW = 0.28;

export interface Player {
  root: THREE.Group;
  /** Everything above the feet, bobbed as they step. */
  body: THREE.Group;
  hips: [THREE.Group, THREE.Group];
  knees: [THREE.Group, THREE.Group];
  shoulders: [THREE.Group, THREE.Group];
  elbows: [THREE.Group, THREE.Group];
  head: THREE.Group;
  /** How far through its stride it is (radians), and how much it is striding (0 to 1). */
  phase: number;
  stride: number;
  /**
   * Side-on: how far through a sidestep it is (radians), how much it is side-on (0 to 1), and
   * which way it last edged (1 to its right, -1 to its left).
   */
  shuffle: number;
  side: number;
  lead: number;
}

function pivot(parent: THREE.Object3D, x: number, y: number, z = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/** A leg from the hip down: trouser to the knee, then to the cuff, and a trainer. */
function leg(body: THREE.Group, side: number): [THREE.Group, THREE.Group] {
  const hip = pivot(body, side * HIP.x, HIP.y);
  rbox(hip, charcoal(), 0, -KNEE / 2 + 0.02, 0, 0.17, KNEE + 0.06, 0.19, 0.06);
  const knee = pivot(hip, 0, -KNEE);
  rbox(knee, charcoal(), 0, -0.19, 0, 0.155, 0.4, 0.175, 0.055);
  // A cyan reflective band round the shin, as a work trouser's.
  cbox(knee, cyan(1.4), 0, -0.24, 0, 0.162, 0.03, 0.182, 0.01);
  // The trainer: a red lacquered upper on a thick white sole, its toe out front (-z).
  const foot = HIP.y - KNEE;
  rbox(knee, sole(), 0, -foot + 0.03, -0.04, 0.16, 0.06, 0.3, 0.025);
  rbox(knee, red(), 0, -foot + 0.1, -0.03, 0.15, 0.1, 0.27, 0.045);
  cbox(knee, sole(), 0, -foot + 0.13, -0.14, 0.1, 0.012, 0.05, 0.005);
  return [hip, knee];
}

/** An arm from the shoulder down: a teal sleeve, a charcoal cuff and glove. */
function arm(body: THREE.Group, side: number): [THREE.Group, THREE.Group] {
  const shoulder = pivot(body, side * SHOULDER.x, SHOULDER.y);
  shoulder.rotation.z = side * 0.08;
  rbox(shoulder, jacket(), 0, -ELBOW / 2 + 0.02, 0, 0.14, ELBOW + 0.08, 0.15, 0.06);
  const elbow = pivot(shoulder, 0, -ELBOW);
  rbox(elbow, jacket(), 0, -0.1, 0, 0.13, 0.22, 0.14, 0.055);
  cbox(elbow, charcoal(), 0, -0.21, 0, 0.135, 0.04, 0.145, 0.012);
  rbox(elbow, charcoal(), 0, -0.29, 0, 0.11, 0.13, 0.12, 0.05);
  return [shoulder, elbow];
}

export function buildPlayer(): Player {
  const root = new THREE.Group();
  root.name = 'player';
  const body = pivot(root, 0, 0);
  const [hipL, kneeL] = leg(body, -1);
  const [hipR, kneeR] = leg(body, 1);

  // The belt, its steel buckle, and a yellow tool pouch on one hip.
  cbox(body, charcoal(), 0, HIP.y + 0.04, 0, 0.42, 0.1, 0.25, 0.03);
  cbox(body, steel(), 0, HIP.y + 0.04, -0.128, 0.09, 0.06, 0.012, 0.008);
  rbox(body, yellow(), 0.24, HIP.y - 0.02, 0.02, 0.07, 0.16, 0.16, 0.025);
  cbox(body, charcoal(), 0.276, HIP.y + 0.03, 0.02, 0.012, 0.04, 0.12, 0.004);

  // The jacket: a rounded block over the chest, a charcoal collar, cyan piping down its zip
  // and across the chest, and a lime badge as on the off-roader.
  rbox(body, jacket(), 0, 1.2, 0, 0.5, 0.5, 0.3, 0.09);
  rbox(body, jacket(), 0, 1.0, 0, 0.44, 0.14, 0.27, 0.06);
  cbox(body, charcoal(), 0, 1.45, 0.01, 0.3, 0.06, 0.24, 0.025);
  cbox(body, cyan(), 0, 1.16, -0.151, 0.018, 0.46, 0.008, 0.004);
  cbox(body, cyan(1.4), 0, 1.33, -0.149, 0.44, 0.016, 0.008, 0.004);
  cbox(
    body,
    mat(CAR.lime, { mottle: 'paint', roughness: 0.45 }),
    -0.13,
    1.25,
    -0.153,
    0.08,
    0.06,
    0.008,
    0.004,
  );
  // A back panel and two steel rivets on the shoulders, as the cars' trim.
  cbox(body, charcoal(), 0, 1.22, 0.152, 0.32, 0.3, 0.012, 0.006);
  for (const s of [-1, 1]) rbox(body, steel(), s * 0.2, 1.43, -0.06, 0.035, 0.035, 0.035, 0.015);
  const [shL, elL] = arm(body, -1);
  const [shR, elR] = arm(body, 1);

  // The head: a neck, a rounded toy head, a dark visor with a cyan lamp strip, a red cap.
  rbox(body, skin(), 0, 1.5, 0, 0.12, 0.08, 0.12, 0.04);
  const head = pivot(body, 0, 1.53);
  rbox(head, skin(), 0, 0.14, 0, 0.27, 0.28, 0.27, 0.1);
  rbox(head, visorGlass(), 0, 0.16, -0.12, 0.25, 0.075, 0.06, 0.03);
  cbox(head, cyan(2.4), 0, 0.16, -0.152, 0.2, 0.014, 0.006, 0.004);
  rbox(head, red(), 0, 0.27, 0.0, 0.285, 0.1, 0.285, 0.05);
  cbox(head, red(), 0, 0.235, -0.17, 0.24, 0.025, 0.12, 0.012);
  rbox(head, charcoal(), 0, 0.33, 0, 0.05, 0.02, 0.05, 0.008);
  for (const s of [-1, 1]) rbox(head, skin(), s * 0.14, 0.14, 0.01, 0.03, 0.07, 0.05, 0.015);

  return {
    root,
    body,
    hips: [hipL, hipR],
    knees: [kneeL, kneeR],
    shoulders: [shL, shR],
    elbows: [elL, elR],
    head,
    phase: 0,
    stride: 0,
    shuffle: 0,
    side: 0,
    lead: 1,
  };
}

/**
 * Swings the limbs for one frame: a stride as long as the ground covered at `speed` (m/s), legs
 * tucked while `airborne`, and a slow breath standing still. Side-on, squeezing through a gap,
 * `sidestep` is how fast they edge along it (m/s, to their right if more than 0), else null.
 */
export function animatePlayer(
  p: Player,
  speed: number,
  airborne: boolean,
  dt: number,
  sidestep: number | null = null,
): void {
  const target = airborne ? 0 : Math.min(1, speed / 4);
  p.stride += (target - p.stride) * Math.min(1, dt * 10);
  // About 1.4 m to a stride at a walk, longer at a run.
  p.phase += (speed * dt * Math.PI) / (1.1 + speed * 0.08);
  const s = Math.sin(p.phase);
  const swing = 0.55 * p.stride + (speed > 5.5 ? 0.15 * p.stride : 0);
  const tuck = airborne ? 1 : 0;
  for (const [i, side] of [
    [0, 1],
    [1, -1],
  ] as const) {
    const leg = s * side;
    // Positive turns swing a limb forward (-z); a knee folds the other way, most as its leg
    // swings through, not while it bears the weight.
    p.hips[i].rotation.x = leg * swing + tuck * 0.6;
    p.knees[i].rotation.x = -Math.max(0, side * Math.cos(p.phase)) * 1.1 * p.stride - tuck * 1.1;
    p.shoulders[i].rotation.x = -leg * swing * 0.9 - tuck * 0.3;
    p.elbows[i].rotation.x = 0.25 + p.stride * 0.35 + tuck * 0.5;
  }
  const breath = Math.sin(gameNow() / 700) * 0.006 * (1 - p.stride);
  p.body.position.y = Math.abs(Math.cos(p.phase)) * 0.04 * p.stride + breath;
  p.body.rotation.x = -0.06 * p.stride;
  p.head.rotation.x = 0.04 * p.stride;

  // Side-on: the feet stepping apart and together along the gap, the leading one out first, the
  // arms drawn in with the hands up before the chest, and the head turned the way they edge.
  p.side += ((sidestep === null ? 0 : 1) - p.side) * Math.min(1, dt * 8);
  const edge = sidestep ?? 0;
  if (Math.abs(edge) > 0.05) p.lead = Math.sign(edge);
  // A step apart and together again about every 0.4 m.
  p.shuffle += (Math.abs(edge) * dt * Math.PI) / 0.4;
  const apart = Math.abs(Math.sin(p.shuffle)) * Math.min(1, Math.abs(edge) / 0.8) * p.side;
  for (const [i, out] of [
    [0, -1],
    [1, 1],
  ] as const) {
    // A positive turn about z swings a leg out to +x; the leading leg is the one on its side.
    const leads = out === p.lead;
    p.hips[i].rotation.z = out * apart * (leads ? 0.26 : 0.12);
    p.knees[i].rotation.x -= apart * (leads ? 0.3 : 0.15);
    p.shoulders[i].rotation.z = out * (0.08 - 0.06 * p.side);
    p.shoulders[i].rotation.x += 0.2 * p.side;
    p.elbows[i].rotation.x += 0.9 * p.side;
  }
  p.body.rotation.z = -p.lead * 0.04 * p.side;
  p.head.rotation.y = -p.lead * 0.8 * p.side;
}
