import * as THREE from 'three';
import { BUS } from './bus.ts';
import { CAR } from './car.ts';
import { paint as wallPaint, paintedBox, seam } from './house.ts';
import { cbox, glow, mat, put, rbox } from './kit.ts';
import { litSign, paintedSign } from './lettering.ts';
import { SPORT } from './sportscar.ts';

/**
 * The quality inspector in the cars' style: a pad of dark ribbed steel framed in yellow, where a
 * build is set down to be scanned; a teal arch over it carrying a bar of cyan scanning light and
 * two amber lamps; behind the pad a big screen on charcoal legs showing the report, a printer at
 * its foot with the last report curling out of it; and behind that a short wall of the houses'
 * painted panels, which keeps the inspector apart from the street.
 *
 * Built standing on the origin, the pad's middle there, the side a build is carried in from +x:
 * the screen faces +x from behind the pad, the wall behind the screen.
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
const gunmetal = () =>
  mat(0x3a3f44, { mottle: 'metal', roughness: 0.4, metalness: 0.8, envMapIntensity: 1.8 });
const screenGlass = () =>
  mat(0x0e1418, { mottle: 'none', roughness: 0.08, metalness: 0.2, envMapIntensity: 2.2 });
const cyan = (k = 1.8) => glow(CAR.blue, k);

/** The pad: the game's size for it (`inspector.size`), and its height. */
export const INSPECTOR_PAD = { size: 2.4, height: 0.05 };

/** The arch's height to the underside of its beam, and how far its legs stand out from the pad. */
const ARCH = { clear: 2.3, out: 0.16 };

/** The screen: its middle behind the pad, its size, and how high its middle is. */
const SCREEN = { x: -INSPECTOR_PAD.size / 2 - 0.45, w: 1.9, h: 1.1, y: 1.55 };

/** The wall behind it all: where it runs, how long, high and thick. */
const WALL = { x: SCREEN.x - 0.75, length: 3.6, height: 1.05, thick: 0.2 };

/**
 * The pad: dark steel ribbed across, a yellow frame round its edge with charcoal hazard chevrons
 * along the side a build comes in from, and cyan light under its lip.
 */
function pad(g: THREE.Group): void {
  const { size, height } = INSPECTOR_PAD;
  cbox(g, charcoal(), 0, height / 2, 0, size, height, size, 0.012);
  const ribs = 14;
  for (let k = 0; k < ribs; k++) {
    const z = -size / 2 + 0.2 + ((size - 0.4) * (k + 0.5)) / ribs;
    cbox(g, gunmetal(), 0, height + 0.004, z, size - 0.4, 0.008, 0.05, 0.003);
  }
  const yellow = paint(BUS.yellow);
  const w = 0.12;
  for (const s of [-1, 1]) {
    cbox(g, yellow, (s * (size - w)) / 2, height + 0.002, 0, w, 0.004, size, 0.002);
    cbox(g, yellow, 0, height + 0.002, (s * (size - w)) / 2, size - 2 * w, 0.004, w, 0.002);
  }
  for (let z = -size / 2 + 0.2; z < size / 2 - 0.1; z += 0.22) {
    const bar = cbox(g, charcoal(), size / 2 - w / 2, height + 0.005, z, 0.1, 0.002, 0.045, 0.001);
    bar.rotation.y = 0.7;
  }
  for (const s of [-1, 1]) {
    cbox(
      g,
      cyan(1.4),
      (s * size) / 2 + s * 0.002,
      height - 0.015,
      0,
      0.006,
      0.01,
      size - 0.1,
      0.002,
    );
    cbox(
      g,
      cyan(1.4),
      0,
      height - 0.015,
      (s * size) / 2 + s * 0.002,
      size - 0.1,
      0.01,
      0.006,
      0.002,
    );
  }
}

/**
 * The arch over the pad, its legs either side (±z) on bolted feet: a teal lacquered frame, the
 * beam across the top charcoal underneath with a bar of cyan light the length of it, an amber
 * lamp on each leg's head, and SCAN lettered on the beam's face.
 */
function arch(g: THREE.Group): void {
  const half = INSPECTOR_PAD.size / 2 + ARCH.out;
  const leg = 0.14;
  const top = ARCH.clear + 0.22;
  const teal = paint(TEAL);
  for (const s of [-1, 1]) {
    const z = s * half;
    rbox(g, charcoal(), 0, 0.04, z, 0.4, 0.08, 0.3, 0.025);
    rbox(g, teal, 0, (top + 0.04) / 2, z, leg, top - 0.04, leg, 0.04);
    // A strip of cyan light up each leg's inner face.
    cbox(g, cyan(2), 0, 1.2, z - s * (leg / 2 + 0.002), 0.02, 1.6, 0.004, 0.002);
    rbox(g, charcoal(), 0, top + 0.06, z, 0.2, 0.12, 0.2, 0.03);
    const lamp = new THREE.CylinderGeometry(0.045, 0.05, 0.08, 20);
    put(g, lamp, glow(CAR.amber, 2.4), 0, top + 0.16, z);
    const cap = new THREE.SphereGeometry(0.045, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    put(g, cap, charcoal(), 0, top + 0.2, z);
  }
  // The beam, from leg to leg.
  rbox(g, teal, 0, ARCH.clear + 0.11, 0, 0.24, 0.22, 2 * half + leg, 0.05);
  cbox(g, charcoal(), 0, ARCH.clear + 0.01, 0, 0.18, 0.03, 2 * half - leg, 0.01);
  cbox(g, cyan(3), 0, ARCH.clear - 0.006, 0, 0.05, 0.008, 2 * half - leg - 0.1, 0.003);
  for (const s of [-1, 1]) {
    const sign = paintedSign('SCAN', 0xf4f2ea, TEAL, 0.42);
    sign.position.set(s * 0.122, ARCH.clear + 0.11, 0);
    sign.rotation.y = (s * Math.PI) / 2;
    g.add(sign);
  }
}

/**
 * The report screen: a big charcoal-framed screen on two legs, facing +x, showing the report's
 * head in cyan, a score in green and a line in red, as the game's report reads; a printer on its
 * own foot below it with the last report curling out.
 */
function screen(g: THREE.Group): void {
  const { x, w, h, y } = SCREEN;
  for (const s of [-1, 1]) {
    rbox(g, charcoal(), x, 0.04, s * (w / 2 - 0.15), 0.34, 0.08, 0.22, 0.025);
    rbox(g, gunmetal(), x - 0.02, (y + 0.08) / 2, s * (w / 2 - 0.15), 0.07, y - 0.08, 0.07, 0.02);
  }
  rbox(g, charcoal(), x, y, 0, 0.1, h + 0.12, w + 0.12, 0.04);
  cbox(g, screenGlass(), x + 0.052, y, 0, 0.006, h, w, 0.004);
  cbox(g, cyan(2), x + 0.05, y - h / 2 - 0.045, 0, 0.004, 0.01, w - 0.2, 0.002);
  const face = new THREE.Group();
  face.position.set(x + 0.056, y, 0);
  face.rotation.y = Math.PI / 2;
  g.add(face);
  const lines: [string, number, number, number][] = [
    ['QUALITY CHECK', CAR.blue, 0.84, 0.36],
    ['98% CORRECT', 0x2fe07a, 0.62, 0.12],
    ['1 WRONG BRICK', SPORT.tail, 0.62, -0.08],
    ['2 MISSING', CAR.amber, 0.44, -0.26],
  ];
  for (const [text, colour, width, at] of lines) {
    const line = litSign(text, colour, width, 2.2);
    line.position.set(-w / 2 + 0.12 + width / 2, at, 0);
    face.add(line);
  }
  // A bar of how much is right, lit green over most of its length.
  cbox(
    face,
    mat(0x1d2326, { mottle: 'none', roughness: 0.4 }),
    0.42,
    0.12,
    0,
    0.6,
    0.07,
    0.004,
    0.002,
  );
  cbox(face, glow(0x2fe07a, 2.2), 0.41, 0.12, 0.002, 0.56, 0.05, 0.004, 0.002);
  // The printer: a small charcoal box on its own leg, a teal lid, the report curling out.
  const px = x + 0.25;
  const pz = w / 2 - 0.3;
  rbox(g, gunmetal(), px, 0.42, pz, 0.06, 0.84, 0.06, 0.02);
  rbox(g, charcoal(), px, 0.9, pz, 0.34, 0.14, 0.32, 0.03);
  cbox(g, paint(TEAL), px, 0.98, pz, 0.32, 0.03, 0.3, 0.01);
  cbox(g, cyan(2), px + 0.172, 0.9, pz, 0.004, 0.012, 0.2, 0.002);
  const paper = new THREE.CylinderGeometry(0.06, 0.06, 0.2, 20, 1, true, 0, Math.PI * 1.2);
  paper.rotateX(Math.PI / 2);
  const roll = put(
    g,
    paper,
    mat(0xf6f4ee, { mottle: 'none', roughness: 0.8, side: THREE.DoubleSide }),
    px + 0.2,
    0.86,
    pz,
  );
  roll.rotation.z = -0.6;
}

/**
 * The short wall behind the screen: the houses' painted panels on a charcoal plinth, seams
 * between them, a charcoal coping with cyan light under its edge, and a red inspection sign.
 */
function wall(g: THREE.Group): void {
  const { x, length, height, thick } = WALL;
  rbox(g, charcoal(), x, 0.08, 0, thick + 0.06, 0.16, length + 0.06, 0.03);
  const panels = 3;
  const pw = length / panels;
  for (let k = 0; k < panels; k++) {
    const z = -length / 2 + pw * (k + 0.5);
    const h = height - 0.24;
    put(g, paintedBox(thick, h, pw - 0.02, 0.03), wallPaint(), x, 0.16 + h / 2, z);
    if (k > 0)
      cbox(
        g,
        seam(),
        x,
        0.16 + (height - 0.24) / 2,
        z - pw / 2,
        thick + 0.004,
        height - 0.26,
        0.016,
        0.004,
      );
  }
  rbox(g, charcoal(), x, height - 0.04, 0, thick + 0.1, 0.08, length + 0.1, 0.03);
  for (const s of [-1, 1])
    cbox(
      g,
      cyan(1.6),
      x + s * (thick / 2 + 0.052),
      height - 0.085,
      0,
      0.004,
      0.01,
      length - 0.1,
      0.002,
    );
  const sign = paintedSign(['QUALITY', 'INSPECTOR'], 0xf4f2ea, SPORT.red, 0.7);
  sign.position.set(x - thick / 2 - 0.003, 0.58, 0.6);
  sign.rotation.y = -Math.PI / 2;
  g.add(sign);
}

/**
 * The inspector: the pad (named 'pad', a step up), and the arch, the screen and the wall, each
 * named 'prop' so that it is solid to its outline.
 */
export function buildInspector(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'inspector';
  const base = new THREE.Group();
  base.name = 'pad';
  root.add(base);
  pad(base);
  for (const make of [arch, screen, wall]) {
    const g = new THREE.Group();
    g.name = 'prop';
    root.add(g);
    make(g);
  }
  return root;
}
