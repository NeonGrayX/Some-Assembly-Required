import * as THREE from 'three';
import { BASEPLATE_SIZE, BOARD_SIZE, BUTTON_SIZE } from '@sar/shared';
import { BUS } from './bus.ts';
import { CAR } from './car.ts';
import { bentPath, cbox, glow, mat, put, rbox, rng, tube } from './kit.ts';
import { MOVING, Press, addGadget } from './gadgets.ts';
import { litSign } from './lettering.ts';
import { brickMaterial } from '../render/bricks.ts';
import { addBrickMesh } from '../render/pages.ts';
import { SPORT } from './sportscar.ts';

/**
 * The job site in the cars' style: the team's baseplate on a concrete pad framed in yellow,
 * cyan light along the pad's edges, and beside it the Done button and the meeting bell, each on
 * a teal lacquered pedestal with its name lit in its face. The baseplate is the game's own part,
 * so it reads as what the build goes on.
 *
 * Built round the baseplate's middle at the origin, the pedestals out along +x.
 */

const TEAL = 0x2c6670;

const paint = (colour: number) =>
  mat(colour, {
    mottle: 'paint',
    roughness: 0.4,
    metalness: 0.15,
    envMapIntensity: 1.4,
    clearcoat: 1,
    clearcoatRoughness: 0.2,
  });
const charcoal = () => mat(CAR.trim, { mottle: 'plastic', roughness: 0.6 });
const steel = () =>
  mat(0xc8ced2, { mottle: 'metal', roughness: 0.3, metalness: 0.75, envMapIntensity: 2.2 });
const polished = () =>
  mat(0xdde2e6, { mottle: 'metal', roughness: 0.22, metalness: 0.9, envMapIntensity: 2.6 });
const concrete = () => mat(0x9a9c9c, { mottle: 'plastic', roughness: 0.85 });
const cyan = (k = 1.8) => glow(CAR.blue, k);

/** The pad's size and thickness, and the yellow frame's margin round the baseplate. */
export const SITE_PAD = { size: 3.0, height: 0.04, margin: 0.35 };

/** The corkboards: the side of the pad they stand on (-x), how far out, and how high. */
export const SITE_BOARDS = { x: -(SITE_PAD.size / 2 + 0.9), gap: 0.12, y: 1.45 };

/** Where the Done button and the bell stand, from the baseplate's middle. */
export const SITE_BUTTONS = {
  done: { x: SITE_PAD.size / 2 + 0.38, z: 0.5 },
  bell: { x: SITE_PAD.size / 2 + 0.38, z: -0.5 },
};

/**
 * The pad: concrete a few centimetres thick with a strip of cyan light under its lip all round,
 * a yellow frame painted round the baseplate's place, a charcoal cross in each corner outside
 * that, and the game's green baseplate on it.
 */
function pad(g: THREE.Group): void {
  const { size, height, margin } = SITE_PAD;
  cbox(g, concrete(), 0, height / 2, 0, size, height, size, 0.012);
  const lip = (x: number, z: number, sx: number, sz: number) =>
    cbox(g, cyan(1.4), x, height - 0.012, z, sx, 0.008, sz, 0.002);
  for (const s of [-1, 1]) {
    lip((s * size) / 2 + s * 0.002, 0, 0.006, size - 0.1);
    lip(0, (s * size) / 2 + s * 0.002, size - 0.1, 0.006);
  }
  // The yellow frame round the baseplate, as the game paints round its own.
  const side = BASEPLATE_SIZE + 2 * margin;
  const w = 0.07;
  const yellow = paint(BUS.yellow);
  for (const s of [-1, 1]) {
    cbox(g, yellow, (s * (side - w)) / 2, height + 0.001, 0, w, 0.002, side, 0.001);
    cbox(g, yellow, 0, height + 0.001, (s * (side - w)) / 2, side - 2 * w, 0.002, w, 0.001);
  }
  // A charcoal cross in each of the pad's corners.
  for (const [a, b] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]) {
    const c = size / 2 - 0.2;
    for (const k of [0, 1]) {
      const bar = cbox(g, charcoal(), a! * c, height + 0.0015, b! * c, 0.22, 0.002, 0.06, 0.001);
      bar.rotation.y = (k ? 1 : -1) * Math.PI * 0.25 + (a! * b! > 0 ? 0 : Math.PI / 2);
    }
  }
  // The baseplate itself, from its corner, on the pad (in a round, the build's own).
  const plate = new THREE.Group();
  plate.name = 'baseplate';
  plate.position.set(-BASEPLATE_SIZE / 2, height, -BASEPLATE_SIZE / 2);
  g.add(plate);
  addBrickMesh(
    plate,
    { type: 'baseplate16', x: 0, y: 0, z: 0, rot: 0, colour: 'baseplate-green' },
    brickMaterial('baseplate-green'),
  );
}

/**
 * A pedestal as the street's posts are: a bolted charcoal foot, a teal lacquered column with a
 * dark glass face either side lit with `label` in `colour`, a charcoal cap, and a cyan ring of
 * light under it. Returns the cap's top.
 */
function pedestal(g: THREE.Group, label: string, colour: number): number {
  const top = BUTTON_SIZE.y - 0.2;
  rbox(g, charcoal(), 0, 0.035, 0, 0.34, 0.07, 0.34, 0.025);
  for (const [a, b] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]) {
    const bolt = new THREE.CylinderGeometry(0.018, 0.018, 0.024, 8);
    put(g, bolt, polished(), a! * 0.13, 0.075, b! * 0.13);
  }
  rbox(g, paint(TEAL), 0, 0.07 + (top - 0.13) / 2, 0, 0.22, top - 0.13, 0.22, 0.05);
  rbox(g, charcoal(), 0, top - 0.035, 0, 0.26, 0.07, 0.26, 0.025);
  const ring = new THREE.CylinderGeometry(0.113, 0.113, 0.016, 32, 1, true);
  put(g, ring, cyan(2.2), 0, top - 0.08);
  for (const s of [-1, 1]) {
    const face = new THREE.Group();
    face.position.set(s * 0.111, top * 0.55, 0);
    face.rotation.y = (s * Math.PI) / 2;
    g.add(face);
    cbox(
      face,
      mat(0x0e1418, { mottle: 'none', roughness: 0.1, envMapIntensity: 2.2 }),
      0,
      0,
      -0.004,
      0.17,
      0.2,
      0.008,
      0.004,
    );
    const sign = litSign(label, colour, 0.15);
    sign.position.z = 0.001;
    face.add(sign);
  }
  return top;
}

/**
 * The Done button: a big red lacquered mushroom on a steel collar, a red ring of light round its
 * foot, on a pedestal lit DONE, which a click presses (its ring flashing). About `BUTTON_SIZE`
 * tall, standing on the origin.
 */
export function doneButton(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'prop';
  const top = pedestal(g, 'DONE', SPORT.tail);
  const collar = new THREE.CylinderGeometry(0.075, 0.09, 0.05, 32);
  put(g, collar, steel(), 0, top + 0.025);
  const ring = new THREE.TorusGeometry(0.08, 0.009, 8, 32);
  ring.rotateX(Math.PI / 2);
  const flash = glow(SPORT.tail, 2.6).clone();
  put(g, ring, flash, 0, top + 0.052);
  // The button itself, which a press pushes down.
  const press = new THREE.Group();
  press.name = MOVING;
  g.add(press);
  const stem = new THREE.CylinderGeometry(0.05, 0.05, 0.05, 24);
  put(press, stem, charcoal(), 0, top + 0.075);
  const red = mat(SPORT.red, {
    mottle: 'paint',
    roughness: 0.3,
    metalness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
  });
  const r = 0.12;
  const cap = put(
    press,
    new THREE.SphereGeometry(r, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    red,
    0,
    top + 0.1,
  );
  cap.scale.y = 0.62;
  const rim = new THREE.TorusGeometry(r - 0.006, 0.012, 10, 40);
  rim.rotateX(Math.PI / 2);
  put(press, rim, red, 0, top + 0.1);
  const under = new THREE.CircleGeometry(r, 32);
  under.rotateX(Math.PI / 2);
  put(press, under, charcoal(), 0, top + 0.099);
  // A press: down and up again, the ring flashing a moment after.
  addGadget(
    g,
    new Press(
      [press],
      'press Done',
      (since) => {
        press.position.y = since < 0.3 ? -0.035 * Math.sin((since / 0.3) * Math.PI) : 0;
        const on = since < 1.6 ? Math.floor(since * 6) % 2 === 0 : true;
        flash.emissiveIntensity = on ? (since < 1.6 ? 4 : 2.6) : 0.3;
      },
      'ready',
    ),
  );
  return g;
}

/**
 * The meeting bell: a polished steel desk bell on a charcoal base ringed in cyan, its plunger up
 * through the dome, on a pedestal lit MEETING in amber, and an amber beacon on a short arm at
 * its side that glows, and flashes a while when a click rings the bell to call a meeting.
 */
export function meetingBell(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'prop';
  const top = pedestal(g, 'MEETING', CAR.amber);
  let y = top;
  const base = new THREE.CylinderGeometry(0.12, 0.13, 0.04, 32);
  put(g, base, charcoal(), 0, y + 0.02);
  y += 0.04;
  const ring = new THREE.CylinderGeometry(0.121, 0.121, 0.008, 32, 1, true);
  put(g, ring, cyan(2.2), 0, y - 0.016);
  const skirt = new THREE.CylinderGeometry(0.098, 0.105, 0.02, 32);
  put(g, skirt, steel(), 0, y + 0.01);
  y += 0.02;
  const dome = put(
    g,
    new THREE.SphereGeometry(0.1, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2),
    polished(),
    0,
    y,
    0,
  );
  dome.scale.y = 0.75;
  y += 0.075;
  // The plunger, which a press pushes down to ring it.
  const plunger = new THREE.Group();
  plunger.name = MOVING;
  g.add(plunger);
  const stem = new THREE.CylinderGeometry(0.008, 0.008, 0.04, 12);
  put(plunger, stem, steel(), 0, y + 0.015);
  const knob = put(plunger, new THREE.SphereGeometry(0.026, 20, 10), paint(SPORT.red), 0, y + 0.04);
  knob.scale.y = 0.5;
  // The beacon on its arm, out over the pedestal's side.
  const arm = bentPath(
    [
      new THREE.Vector3(0, top - 0.02, -0.12),
      new THREE.Vector3(0, top - 0.02, -0.2),
      new THREE.Vector3(0, top + 0.12, -0.2),
    ],
    0.04,
  );
  tube(g, arm, 0.012, charcoal());
  rbox(g, charcoal(), 0, top + 0.13, -0.2, 0.07, 0.025, 0.07, 0.01);
  const lamp = new THREE.CylinderGeometry(0.028, 0.032, 0.06, 20);
  const beacon = glow(CAR.amber, 2.4).clone();
  put(g, lamp, beacon, 0, top + 0.17, -0.2);
  // A ring: the plunger down and up, and the beacon flashing a while, a meeting called.
  addGadget(
    g,
    new Press(
      [plunger, dome],
      'ring the bell',
      (since) => {
        plunger.position.y = since < 0.2 ? -0.012 * Math.sin((since / 0.2) * Math.PI) : 0;
        const calling = since < 5;
        beacon.emissiveIntensity = calling ? (Math.floor(since * 4) % 2 ? 0.4 : 4) : 2.4;
      },
      'bell',
    ),
  );
  const lid = new THREE.SphereGeometry(0.028, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  put(g, lid, charcoal(), 0, top + 0.2, -0.2);
  return g;
}

/** The name of each of a corkboard's own pinned pages (a game pins its own over them). */
export const DEMO_PAGE = 'demo page';

/**
 * A two-sided corkboard on two legs, as the game's (`BOARD_SIZE`), its face along z: a teal
 * lacquered frame, cork either side with a few pages pinned to it, a charcoal visor over the top
 * with a strip of cyan light under it lighting the cork, and bolted charcoal feet. `seed` lays the
 * pages out.
 */
export function corkboard(seed: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'prop';
  const { x: w, y: h } = BOARD_SIZE;
  const y = SITE_BOARDS.y;
  const frame = 0.07;
  const thick = 0.09;
  const teal = paint(TEAL);
  for (const s of [-1, 1]) {
    const z = s * (w / 2 + frame / 2 - 0.01);
    rbox(g, charcoal(), 0, 0.035, z, 0.42, 0.07, 0.16, 0.025);
    rbox(g, teal, 0, (y + h / 2 + 0.07) / 2, z, 0.08, y + h / 2 - 0.07 + frame, frame, 0.03);
  }
  // The frame round the cork, and the cork itself either side of a dark core.
  rbox(g, teal, 0, y - h / 2 - frame / 2, 0, thick, frame, w + 2 * frame - 0.02, 0.025);
  rbox(g, teal, 0, y + h / 2 + frame / 2, 0, thick, frame, w + 2 * frame - 0.02, 0.025);
  cbox(g, charcoal(), 0, y, 0, thick - 0.03, h, w, 0.01);
  const cork = mat(0xae8256, { mottle: 'plastic', roughness: 0.95 });
  for (const s of [-1, 1])
    cbox(g, cork, s * (thick / 2 - 0.02), y, 0, 0.02, h - 0.02, w - 0.02, 0.006);
  // The visor over its top, lit underneath on both faces.
  rbox(g, charcoal(), 0, y + h / 2 + frame + 0.03, 0, 0.26, 0.05, w + 2 * frame + 0.04, 0.02);
  for (const s of [-1, 1])
    cbox(g, cyan(2.2), s * 0.11, y + h / 2 + frame + 0.004, 0, 0.012, 0.006, w, 0.002);
  // Pages pinned on, a few each side: white sheets with a picture and lines, a red pin each.
  const rand = rng(seed);
  const sheet = mat(0xf6f4ee, { mottle: 'none', roughness: 0.8 });
  const ink = mat(0x5b6870, { mottle: 'none', roughness: 0.8 });
  const pin = paint(SPORT.red);
  const bricks = [SPORT.red, BUS.yellow, 0x2f6fc0, 0x3f8f4a];
  for (const s of [-1, 1]) {
    const n = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const page = new THREE.Group();
      page.name = DEMO_PAGE;
      page.position.set(
        s * (thick / 2 + 0.003),
        y + 0.18 - (k % 2) * 0.48 + (rand() - 0.5) * 0.06,
        -w / 2 + 0.3 + (k * (w - 0.6)) / Math.max(1, n - 1),
      );
      page.rotation.set(0, (s * Math.PI) / 2, (rand() - 0.5) * 0.12);
      g.add(page);
      cbox(page, sheet, 0, 0, 0, 0.3, 0.4, 0.004, 0.002);
      // A little build in the picture, and lines of parts under it.
      for (let b = 0; b < 3; b++)
        cbox(
          page,
          mat(bricks[Math.floor(rand() * bricks.length)]!, { mottle: 'none', roughness: 0.5 }),
          -0.05 + b * 0.05,
          0.07 + (b % 2) * 0.03,
          0.003,
          0.045,
          0.03,
          0.003,
          0.001,
        );
      for (let l = 0; l < 3; l++)
        cbox(
          page,
          ink,
          -0.02 + (l % 2) * 0.02,
          -0.06 - l * 0.045,
          0.003,
          0.2 - (l % 2) * 0.06,
          0.012,
          0.002,
          0.001,
        );
      const head = put(page, new THREE.SphereGeometry(0.014, 12, 8), pin, 0, 0.17, 0.012);
      head.scale.z = 0.7;
    }
  }
  return g;
}

/**
 * The job site: the pad with the baseplate on it, the Done button and the bell on one side of it
 * and two corkboards side by side on the other. The pad is named 'pad' (a step up); the
 * pedestals and the boards 'prop', solid to their outlines.
 */
export function buildJobSite(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'jobSite';
  const base = new THREE.Group();
  base.name = 'pad';
  root.add(base);
  pad(base);
  const done = doneButton();
  done.position.set(SITE_BUTTONS.done.x, 0, SITE_BUTTONS.done.z);
  root.add(done);
  const bell = meetingBell();
  bell.position.set(SITE_BUTTONS.bell.x, 0, SITE_BUTTONS.bell.z);
  root.add(bell);
  for (const s of [-1, 1]) {
    const board = corkboard(s > 0 ? 7 : 13);
    board.position.set(SITE_BOARDS.x, 0, s * (BOARD_SIZE.x / 2 + 0.1 + SITE_BOARDS.gap / 2));
    root.add(board);
  }
  return root;
}
