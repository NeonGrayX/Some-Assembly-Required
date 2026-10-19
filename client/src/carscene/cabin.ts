import * as THREE from 'three';
import { CAR } from './car.ts';
import { cbox, glow, mat, put, rbox } from './kit.ts';

/**
 * What the vehicles have inside, seen through their tinted glass: seats, a steering wheel on its
 * column, and a dashboard whose screens glow the cars' cyan, so the cabin reads through the tint.
 * Each vehicle faces +x, its right side toward +z; everything here faces the same way.
 */

/** A seat's leather, in `colour`. */
export const leather = (colour: number) => mat(colour, { mottle: 'plastic', roughness: 0.7 });
/** The dashboard's and the column's soft black plastic. */
export const dashPlastic = () => mat(0x1a1614, { mottle: 'plastic', roughness: 0.75 });

/** How a seat is made: its width, how tall its back is, and whether it has a headrest. */
export interface SeatShape {
  /** Across, along z. */
  w: number;
  /** Its back, from the cushion up. */
  back: number;
  /** Leaning back from upright, in radians. */
  recline?: number;
  headrest?: boolean;
}

/**
 * A seat facing +x, its cushion's top at `y` over its middle (`x`, `z`), on a dark base down to
 * `floor`: a cushion between two bolsters, its back leaning back from the cushion's rear edge
 * with bolsters of its own, and a headrest on two posts. Returns it, to turn it about.
 */
export function seat(
  parent: THREE.Object3D,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  floor: number,
  shape: SeatShape,
): THREE.Group {
  const { w, back, recline = 0.22, headrest = true } = shape;
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  const depth = 0.46;
  rbox(g, material, 0, -0.06, 0, depth, 0.12, w - 0.1, 0.05);
  for (const s of [-1, 1])
    rbox(g, material, -0.02, -0.04, s * (w / 2 - 0.05), depth - 0.04, 0.16, 0.1, 0.045);
  if (y - 0.12 > floor + 0.01)
    cbox(
      g,
      dashPlastic(),
      0,
      (floor - y - 0.12) / 2,
      0,
      depth - 0.1,
      y - 0.12 - floor,
      w - 0.16,
      0.02,
    );
  // The back, leaning from the cushion's rear edge.
  const rest = new THREE.Group();
  rest.position.set(-depth / 2 + 0.04, -0.06, 0);
  rest.rotation.z = recline;
  g.add(rest);
  rbox(rest, material, -0.06, back / 2, 0, 0.12, back, w - 0.1, 0.05);
  for (const s of [-1, 1])
    rbox(rest, material, -0.03, back * 0.45, s * (w / 2 - 0.05), 0.16, back * 0.8, 0.1, 0.045);
  if (headrest) {
    for (const s of [-1, 1])
      cbox(rest, dashPlastic(), -0.07, back + 0.04, s * 0.07, 0.02, 0.08, 0.02, 0.006);
    rbox(rest, material, -0.07, back + 0.15, 0, 0.1, 0.16, Math.min(0.3, w * 0.6), 0.045);
  }
  return g;
}

/**
 * A steering wheel at (`x`, `y`, `z`), facing back and up at its driver, its top tipped forward
 * away from them by `tilt`: a rim, three spokes to a hub, and its column running forward and down
 * into the dashboard, `column` long.
 */
export function steeringWheel(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  r: number,
  tilt: number,
  column = 0.3,
): void {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.z = -tilt;
  parent.add(g);
  const plastic = dashPlastic();
  const rim = new THREE.TorusGeometry(r, 0.022, 10, 36);
  rim.rotateY(Math.PI / 2);
  put(g, rim, plastic);
  const hub = new THREE.CylinderGeometry(0.05, 0.055, 0.05, 20);
  hub.rotateZ(Math.PI / 2);
  put(g, hub, plastic, 0.01, 0, 0);
  // A ringed badge on the hub, lit as the cars' lamps are.
  const badge = new THREE.CircleGeometry(0.022, 20);
  badge.rotateY(-Math.PI / 2);
  put(g, badge, glow(CAR.blue, 1.6), -0.016, 0, 0);
  for (const a of [Math.PI / 2, Math.PI + 0.5, -0.5]) {
    const spoke = cbox(g, plastic, 0.005, 0, 0, 0.02, r - 0.03, 0.03, 0.008);
    spoke.position.set(0.005, (Math.sin(a) * r) / 2, (Math.cos(a) * r) / 2);
    spoke.rotation.x = Math.PI / 2 - a;
  }
  const col = new THREE.CylinderGeometry(0.03, 0.035, column, 14);
  col.rotateZ(Math.PI / 2);
  put(g, col, plastic, 0.03 + column / 2, 0, 0);
}

/**
 * A screen on the dashboard's back face at (`x`, `y`, `z`), facing back at the seats, `w` across
 * and `h` tall, in a dark bezel, its top tipped forward by `tilt`: glowing cyan, with a brighter
 * band across it as a readout.
 */
export function dashScreen(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  tilt = 0,
): void {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.z = -tilt;
  parent.add(g);
  cbox(g, dashPlastic(), 0.01, 0, 0, 0.02, h + 0.03, w + 0.03, 0.006);
  cbox(g, glow(CAR.blue, 0.9), 0, 0, 0, 0.004, h, w, 0.003);
  cbox(g, glow(CAR.blue, 2.2), -0.003, h * 0.15, 0, 0.002, h * 0.12, w * 0.7, 0.001);
}
