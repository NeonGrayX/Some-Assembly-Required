import * as THREE from 'three';
import { VACUUM_DOCK, VACUUM_LEAN } from '@sar/shared';
import { CAR } from './car.ts';
import { bentPath, cbox, glow, mat, put, rbox, tube } from './kit.ts';

/**
 * The vacuum's dock, in the cars' style: where the game's vacuum is kept, a charging station
 * fixed to the site office's side wall. A charcoal backplate on the wall over the house's plinth
 * with a teal panel, its cyan light showing it is powered and a green one that it is charged; a
 * cradle at hand height, an arm out from the plate with a rubber pad and a steel fork, that the
 * vacuum's wand rests in, leaning back; a low base on the floor behind its head, up against the
 * plinth, with the charging contacts and a cyan strip on its front, its cable running to a
 * socket on the plinth; and either side clips holding the crevice tool and the dusting brush.
 *
 * Built in the vacuum's own frame as it leans there (see `vacuumRestPose`): the origin on the
 * floor under the middle of its head, its front (the way its bristles face) toward -z and the
 * wall behind it toward +z (see `VACUUM_DOCK`).
 */

const TEAL = 0x2c6670;
const paint = () =>
  mat(TEAL, {
    mottle: 'paint',
    roughness: 0.42,
    metalness: 0.2,
    envMapIntensity: 1.4,
    clearcoat: 0.8,
    clearcoatRoughness: 0.25,
  });
const charcoal = () => mat(CAR.trim, { mottle: 'plastic', roughness: 0.6 });
const polished = () =>
  mat(0xdde2e6, { mottle: 'metal', roughness: 0.3, metalness: 0.7, envMapIntensity: 2.4 });
const dark = () => mat(0x15181a, { mottle: 'none', roughness: 0.9 });
const rubber = () => mat(0x1c1d20, { mottle: 'plastic', roughness: 0.95 });

/** The backplate: half its width, its thickness and how high it reaches; the cradle's height. */
const PLATE = { half: 0.085, thick: 0.014, top: 1.12 };
const CRADLE = 1.0;

export function vacuumDock(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'vacuum dock';
  const { wall, plinth, width, from, height } = VACUUM_DOCK;
  /** How far back from the head the wand is at height `y`, leaning toward the wall. */
  const wand = (y: number) => y * Math.tan(VACUUM_LEAN);
  const face = wall - PLATE.thick;
  const foot = wall - plinth.out;

  // The backplate on the wall, standing on the plinth, its panel and its lights.
  const high = PLATE.top - plinth.high;
  const mid = plinth.high + high / 2;
  rbox(g, charcoal(), 0, mid, wall - PLATE.thick / 2, 2 * PLATE.half, high, PLATE.thick, 0.012);
  rbox(g, paint(), 0, mid - 0.04, face - 0.003, 0.13, high - 0.2, 0.006, 0.003);
  for (const x of [-1, 1])
    for (const y of [plinth.high + 0.04, PLATE.top - 0.04]) {
      const screw = new THREE.CylinderGeometry(0.008, 0.008, 0.004, 12);
      screw.rotateX(Math.PI / 2);
      put(g, screw, polished(), x * (PLATE.half - 0.02), y, face - 0.0015);
    }
  cbox(g, glow(CAR.blue, 2.2), 0, CRADLE + 0.06, face - 0.002, 0.08, 0.012, 0.004, 0.002);
  const charged = new THREE.CircleGeometry(0.008, 14);
  charged.rotateY(Math.PI);
  put(g, charged, glow(0x2fe07a, 2.2), 0, CRADLE + 0.095, face - 0.0008);

  // The cradle: an arm out from the plate to just behind the wand, a rubber pad on its end, and
  // a steel fork either side of the wand, curling in before it.
  const at = wand(CRADLE);
  const pad = at + 0.015 + 0.0055;
  const arm = face - pad - 0.005;
  cbox(g, charcoal(), 0, CRADLE, face - arm / 2, 0.07, 0.05, arm, 0.012);
  cbox(g, rubber(), 0, CRADLE, pad + 0.003, 0.05, 0.035, 0.006, 0.002);
  // Its brace, from under the arm's end back down to the plate.
  const brace = bentPath(
    [new THREE.Vector3(0, CRADLE - 0.02, pad + 0.05), new THREE.Vector3(0, CRADLE - 0.16, face)],
    0.01,
  );
  tube(g, brace, 0.012, charcoal());
  for (const s of [-1, 1]) {
    const fork = bentPath(
      [
        new THREE.Vector3(s * 0.03, CRADLE, pad + 0.03),
        new THREE.Vector3(s * 0.03, CRADLE, at - 0.01),
        new THREE.Vector3(s * 0.014, CRADLE, at - 0.023),
      ],
      0.012,
    );
    tube(g, fork, 0.007, polished());
    const tip = new THREE.SphereGeometry(0.008, 12, 8);
    put(g, tip, polished(), s * 0.014, CRADLE, at - 0.023);
  }

  // The base on the floor behind the head, up against the plinth and rising up its face: the
  // contacts the vacuum charges on, and a strip of light along its front.
  const depth = foot - from;
  rbox(g, charcoal(), 0, height / 2, from + depth / 2, width, height, depth, 0.015);
  rbox(g, charcoal(), 0, plinth.high / 2, foot - 0.015, 0.22, plinth.high - 0.02, 0.03, 0.012);
  for (const x of [-0.06, 0.06])
    cbox(g, polished(), x, 0.022, from - 0.002, 0.04, 0.012, 0.006, 0.002);
  cbox(g, glow(CAR.blue, 1.8), 0, height - 0.008, from - 0.001, width - 0.08, 0.005, 0.004, 0.002);
  // Its cable, out of the base's corner and along the foot of the plinth to the socket on it.
  const socket = { x: 0.3, y: 0.17 };
  rbox(g, charcoal(), socket.x, socket.y, foot - 0.014, 0.08, 0.08, 0.028, 0.01);
  cbox(g, dark(), socket.x, socket.y, foot - 0.029, 0.04, 0.04, 0.004, 0.002);
  const cable = bentPath(
    [
      new THREE.Vector3(width / 2 - 0.02, 0.02, foot - 0.02),
      new THREE.Vector3(socket.x, 0.02, foot - 0.02),
      new THREE.Vector3(socket.x, socket.y - 0.04, foot - 0.02),
    ],
    0.05,
  );
  tube(g, cable, 0.008, dark());

  // The clips beside it on the wall, the crevice tool in one and the dusting brush in the other.
  for (const s of [-1, 1]) {
    rbox(g, charcoal(), s * 0.17, 0.72, wall - 0.02, 0.05, 0.06, 0.04, 0.01);
    cbox(g, polished(), s * 0.17, 0.72, wall - 0.041, 0.054, 0.012, 0.004, 0.002);
  }
  const crevice = new THREE.CylinderGeometry(0.016, 0.01, 0.3, 14);
  put(g, crevice, dark(), 0.17, 0.6, wall - 0.045);
  put(g, new THREE.CylinderGeometry(0.019, 0.019, 0.05, 14), charcoal(), 0.17, 0.74, wall - 0.045);
  put(g, new THREE.CylinderGeometry(0.03, 0.03, 0.05, 18), charcoal(), -0.17, 0.66, wall - 0.05);
  put(
    g,
    new THREE.CylinderGeometry(0.027, 0.022, 0.04, 18),
    mat(0xf2b134, { mottle: 'plastic', roughness: 0.9 }),
    -0.17,
    0.615,
    wall - 0.05,
  );
  put(g, new THREE.CylinderGeometry(0.019, 0.019, 0.08, 14), charcoal(), -0.17, 0.72, wall - 0.05);
  return g;
}
