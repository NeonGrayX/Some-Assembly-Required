import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { add, box, mat, metal } from './interiors.ts';
import { bevelCylinder } from './shapes.ts';

/**
 * The camp's caravans' own parts: the rounded roof and the A-frame at the front. The body is
 * a room like any other, dressed by livery strips (see `camp.ts`). Built like the other props
 * (see `props.ts`): centred on the box, local -z its front, `w` wide, `h` high and `d` deep.
 */

/**
 * A caravan's roof: one moulded piece with rounded edges overhanging the walls, and a
 * rooflight in the middle.
 */
export function caravanRoof(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
): void {
  const shell = mat(colour, 0.45);
  const bodyH = h - 0.08;
  add(
    g,
    new RoundedBoxGeometry(w, bodyH, d, 3, Math.min(0.1, bodyH / 2 - 0.01)),
    shell,
    0,
    -h / 2 + bodyH / 2,
    0,
  );
  // The rooflight: a smoked dome in a white frame.
  const top = -h / 2 + bodyH;
  const long = Math.max(w, d);
  const alongX = w >= d;
  const lw = alongX ? Math.min(0.7, long * 0.18) : 0.55;
  const ld = alongX ? 0.55 : Math.min(0.7, long * 0.18);
  box(g, lw + 0.08, 0.03, ld + 0.08, 0, top + 0.015, 0, mat(0xf2f2f2, 0.4));
  add(g, new RoundedBoxGeometry(lw, 0.07, ld, 2, 0.03), mat(0x5a6a74, 0.15, 0.2), 0, top + 0.04, 0);
}

/**
 * The A-frame at a caravan's front, from the end wall (+z, the box's back) out to the hitch
 * (-z): two drawbars meeting at the coupling head, the jockey wheel wound down to the grass,
 * the gas locker on the frame, and the corner steady under it.
 */
export function towHitch(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const steel = mat(colour, 0.5, 0.3);
  const galv = metal(0xb0b6bc);
  const bottom = -h / 2;
  const barY = bottom + 0.42;
  const head = { x: 0, z: -d / 2 + 0.12 };
  // The drawbars, from the corners of the chassis at the wall to the head.
  for (const s of [-1, 1]) {
    const from = new THREE.Vector3(s * (w / 2 - 0.06), barY, d / 2 - 0.04);
    const to = new THREE.Vector3(head.x + s * 0.05, barY, head.z + 0.1);
    const len = from.distanceTo(to);
    const bar = box(g, 0.06, 0.08, len, 0, 0, 0, steel);
    bar.position.copy(from).add(to).multiplyScalar(0.5);
    bar.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
  }
  // The coupling head with its handle, and the breakaway cable.
  box(g, 0.12, 0.1, 0.22, head.x, barY + 0.02, head.z, galv);
  const handle = box(g, 0.05, 0.03, 0.2, head.x, barY + 0.08, head.z + 0.08, galv);
  handle.rotation.x = -0.3;
  // The jockey wheel: its tube clamped to the frame, the handle on top and the wheel below.
  const jz = head.z + 0.32;
  const jx = 0.12;
  add(g, new THREE.CylinderGeometry(0.03, 0.03, 0.6, 10), galv, jx, bottom + 0.35, jz);
  box(g, 0.03, 0.03, 0.14, jx, bottom + 0.66, jz - 0.07, galv);
  const wheel = add(
    g,
    bevelCylinder(0.07, 0.07, 0.05, 14),
    mat(0x1c1c1e, 0.9),
    jx,
    bottom + 0.07,
    jz,
  );
  wheel.rotation.z = Math.PI / 2;
  // The gas locker on the frame against the wall, with its lid and a vent.
  const locker = { w: w - 0.22, d: 0.34, h: 0.28 };
  const lz = d / 2 - locker.d / 2 - 0.02;
  add(
    g,
    new RoundedBoxGeometry(locker.w, locker.h, locker.d, 2, 0.03),
    mat(0xf2f2f2, 0.45),
    0,
    barY + 0.04 + locker.h / 2,
    lz,
  );
  box(
    g,
    locker.w * 0.5,
    0.02,
    0.01,
    0,
    barY + 0.04 + locker.h * 0.6,
    lz - locker.d / 2 - 0.004,
    mat(0x3b4046, 0.6),
  );
  // The corner steadies, wound down under the chassis at the wall.
  for (const s of [-1, 1])
    box(
      g,
      0.05,
      barY - bottom - 0.04,
      0.05,
      s * (w / 2 - 0.06),
      (bottom + barY - 0.04) / 2,
      d / 2 - 0.06,
      steel,
    );
}
