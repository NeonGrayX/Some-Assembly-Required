import * as THREE from 'three';
import { add, box, mat } from '../interiors.ts';
import { hex, painted, put } from '../nature.ts';
import { Surface } from '../styles.ts';
import { PLASTER, Quads, TIMBER, coloured, iron, made, slab, times } from './kit.ts';

/** The steep shingled roofs of the tavern and the captain's hut. */

/** The walls a roof stands on, in its own frame: the outer faces of their footprint. */
export interface RoofWalls {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/**
 * A steep pitched roof over a building, the box from the eaves up to the ridge, which runs along
 * its long side: rows of chunky shingles in `colour`, each its own shade, a little askew, each
 * row lying over the one under it; heavy timber barge boards down the gable ends, shod with
 * iron, a ridge beam along the top, and the rafters' ends out under the overhang. Each gable is
 * cream plaster in a frame of dark timber with a round window, standing a little proud of the
 * end wall under it, and along the eaves wall plates close the gap over the side walls. Tie
 * beams cross the room under it. `walls` (their outer faces) are where the overhang begins.
 */
export function gableRoofModel(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
  walls: RoofWalls | null,
): void {
  // Built with the ridge along x, and turned a quarter if it runs along z: then the frame's x is
  // the box's -z, and its z the box's x.
  const alongX = w >= d;
  const frame = new THREE.Group();
  frame.rotation.y = alongX ? 0 : Math.PI / 2;
  g.add(frame);
  const L = alongX ? w : d;
  const D = alongX ? d : w;
  const H = h;
  const inner = walls
    ? alongX
      ? walls
      : { x0: -walls.z1, x1: -walls.z0, z0: walls.x0, z1: walls.x1 }
    : { x0: -L / 2 + 0.4, x1: L / 2 - 0.4, z0: -D / 2 + 0.4, z1: D / 2 - 0.4 };
  const bargeT = 0.13;
  const tab = 0.05;
  const sark = 0.04;
  const cap = 0.16;
  // The roof's outer line (the shingles' top): from the eaves, high enough over the box's foot
  // for the layers under it, up to the ridge beam.
  const yRidge = H / 2 - cap * 0.5;
  const guess = Math.cos(Math.atan2(H, D / 2));
  const yEave = -H / 2 + (tab + sark) / guess + 0.01;
  const slope = Math.atan2(yRidge - yEave, D / 2);
  const cos = Math.cos(slope);
  const outerY = (z: number) => yEave + (D / 2 - Math.abs(z)) * Math.tan(slope);
  // The underside of the boards under the shingles.
  const underY = (z: number) => Math.max(-H / 2, outerY(z) - (tab + sark) / cos);
  const timber = made(TIMBER, Surface.Auto, 0.8);
  const beams = mat(TIMBER, 0.8);
  // The boards, a slab down each slope between the barge boards.
  const sx0 = -L / 2 + bargeT;
  const sx1 = L / 2 - bargeT;
  for (const s of [-1, 1]) {
    const e = (s * D) / 2;
    const outline: [number, number][] = [
      [e, outerY(e) - tab / cos],
      [0, outerY(0) - tab / cos],
      [0, underY(0)],
      [e, underY(e)],
    ];
    add(frame, slab(outline, sx0, sx1), mat(0x7a5232, 0.8), 0, 0, 0);
  }
  // The shingles, row upon row from the eaves to the ridge, each row's foot kicked up onto the
  // row under it, the joints of every other row halfway along the ones under them. There are
  // several hundred on a roof, so each is drawn as only what of it shows: its face, its butt
  // end toward the eaves with the edge between them taken off (its normals turning from the one
  // to the other, as a bevelled box's do), and its sides in the gaps between them; its back end
  // lies under the next row up (or the ridge beam), its underside on the boards. They cast no
  // shadow: the boards under them cast the roof's.
  const base = hex(colour);
  const S = D / 2 / cos;
  const rows = Math.max(3, Math.round(S / 0.25));
  const step = S / rows;
  const kick = Math.atan2(tab * 0.9, step * 1.3);
  const toRoof = new THREE.Matrix4();
  const toNormal = new THREE.Matrix3();
  for (const s of [-1, 1]) {
    const q = new Quads();
    for (let k = 0; k < rows; k++) {
      const a0 = k * step;
      const length = Math.min(step * 1.35, S - a0 - 0.02);
      const widths: number[] = [];
      let left = sx1 - sx0 - 0.02;
      if (k % 2) widths.push(0.16 + seed() * 0.06);
      left -= widths[0] ?? 0;
      while (left > 1e-6) {
        const wide = 0.3 + seed() * 0.12;
        widths.push(left - wide < 0.14 ? left : wide);
        left -= widths[widths.length - 1]!;
      }
      let x = sx0 + 0.01;
      for (const wide of widths) {
        // Each a little askew, but for the bottom row, which lies flat on the boards (askew by
        // a hair, its underside would all but lie in the plane of theirs).
        const tilt = slope - (k === 0 ? 0 : kick + (seed() - 0.5) * 0.03);
        const z = s * (D / 2 - (a0 + length / 2) * cos);
        const y = outerY(z) - tab / 2 / cos + (k === 0 ? 0 : tab * 0.45);
        // Lighter up the slope, where the sun has bleached them.
        const shade = (0.78 + seed() * 0.34) * (0.86 + 0.18 * (k / rows));
        const c = base
          .clone()
          .offsetHSL((seed() - 0.5) * 0.03, 0, 0)
          .multiplyScalar(shade);
        // In its own frame, a box `2a` by `2t` by `2l` with its face up (+y) and its butt
        // toward the eaves (+z), turned down the slope; on the far side, turned over, its face
        // is its -y.
        toRoof.makeRotationX(s > 0 ? tilt : Math.PI - tilt).setPosition(x + wide / 2, y, z);
        toNormal.getNormalMatrix(toRoof);
        const P = (px: number, py: number, pz: number) =>
          new THREE.Vector3(px, py, pz).applyMatrix4(toRoof);
        const N = (nx: number, ny: number, nz: number) =>
          new THREE.Vector3(nx, ny, nz).applyMatrix3(toNormal).normalize();
        const [a, t, l, e] = [(wide - 0.012) / 2, (s * tab) / 2, length / 2, 0.012];
        const face = N(0, s, 0);
        const butt = N(0, 0, 1);
        const cs = [c, c, c, c];
        q.quad(
          [P(-a, t, -l), P(a, t, -l), P(a, t, l - e), P(-a, t, l - e)],
          [face, face, face, face],
          cs,
        );
        q.quad(
          [P(-a, t, l - e), P(a, t, l - e), P(a, t - s * e, l), P(-a, t - s * e, l)],
          [face, face, butt, butt],
          cs,
        );
        q.quad(
          [P(-a, t - s * e, l), P(a, t - s * e, l), P(a, -t, l), P(-a, -t, l)],
          [butt, butt, butt, butt],
          cs,
        );
        for (const end of [-1, 1]) {
          const out = N(end, 0, 0);
          q.quad(
            [P(end * a, -t, -l), P(end * a, t, -l), P(end * a, t, l), P(end * a, -t, l)],
            [out, out, out, out],
            cs,
          );
        }
        x += wide;
      }
    }
    put(frame, q.geometry(), Surface.Auto, false);
  }
  // The ridge beam along the top, over the top rows' heads.
  box(frame, L - 0.02, cap, cap * 1.2, 0, H / 2 - cap / 2, 0, beams);
  // The barge boards: down each gable from the ridge to the eaves, standing over the shingles,
  // with an iron shoe at each foot and a strap over the peak.
  const depth = 0.24;
  for (const end of [-1, 1]) {
    const x0 = end < 0 ? -L / 2 : L / 2 - bargeT;
    for (const s of [-1, 1]) {
      const e = (s * D) / 2;
      const outline: [number, number][] = [
        [e, Math.max(-H / 2, outerY(e) + 0.04 - depth)],
        [e, outerY(e) + 0.04],
        [0, outerY(0) + 0.04],
        [0, outerY(0) + 0.04 - depth],
      ];
      add(frame, slab(outline, x0, x0 + bargeT, 0.02), timber, 0, 0, 0);
      const foot = e - s * 0.12;
      const y = Math.max(-H / 2 + 0.08, outerY(foot) - 0.06);
      box(frame, bargeT + 0.016, 0.16, 0.16, x0 + bargeT / 2, y, foot, iron());
    }
    box(frame, bargeT + 0.016, 0.12, 0.3, x0 + bargeT / 2, outerY(0) - 0.12, 0, iron());
  }
  // The gables, standing on the end walls a little proud of them: cream plaster in a frame of
  // dark timber, with a round window.
  const plaster = made(PLASTER, Surface.Wall, 0.9);
  const { z0: zw0, z1: zw1 } = inner;
  const peak = underY(0);
  const tall = peak + H / 2;
  const jetty = 0.03;
  const gableT = 0.16;
  for (const end of [-1, 1]) {
    const x0 = end < 0 ? inner.x0 - jetty : inner.x1 + jetty - gableT;
    const outline: [number, number][] = [
      [zw0, -H / 2],
      [zw1, -H / 2],
      [zw1, underY(zw1)],
      [0, peak],
      [zw0, underY(zw0)],
    ];
    add(frame, slab(outline, x0, x0 + gableT), plaster, 0, 0, 0);
    // The timbers on its outside: a tie beam along its foot, a king post up its middle and a
    // strut out from it either side.
    const face = end < 0 ? x0 : x0 + gableT;
    const proud = (o: [number, number][]) =>
      add(
        frame,
        coloured(
          slab(o, Math.min(face, face + end * 0.035), Math.max(face, face + end * 0.035)),
          times(hex(TIMBER), 0.95),
        ),
        painted(Surface.Auto),
        0,
        0,
        0,
      );
    const beam = -H / 2 + 0.16;
    proud([
      [zw0, -H / 2],
      [zw1, -H / 2],
      [zw1, beam],
      [zw0, beam],
    ]);
    // The round window, up between the struts, the king post stopping under it and going on
    // over it.
    const wy = beam + tall * 0.42;
    const wr = Math.min(0.2, tall * 0.11);
    const post = (y0: number, y1: number) =>
      y1 - y0 > 0.05 &&
      proud([
        [-0.07, y0],
        [0.07, y0],
        [0.07, y1],
        [-0.07, y1],
      ]);
    if (wr > 0.08) {
      post(beam, wy - wr - 0.07);
      post(wy + wr + 0.07, peak - 0.03);
      // Half sunk in the plaster, so its back is hidden in it.
      const disc = new THREE.CylinderGeometry(wr, wr, 0.02, 14).rotateZ(Math.PI / 2);
      add(frame, disc, made(0x2f3d4c, Surface.Auto, 0.35), face, wy, 0);
      const ring = new THREE.TorusGeometry(wr, 0.035, 5, 14).rotateY(Math.PI / 2);
      add(frame, ring, beams, face + end * 0.012, wy, 0);
    } else post(beam, peak - 0.03);
    for (const s of [-1, 1]) {
      const zs = s * Math.abs(s > 0 ? zw1 : zw0) * 0.62;
      const ys = underY(zs) - 0.03;
      const from = beam + tall * 0.1;
      proud([
        [s * 0.07, from],
        [s * 0.07, from + 0.13],
        [zs, ys],
        [zs - s * 0.1, ys - 0.1],
      ]);
    }
  }
  // Over the side walls, wall plates up to the boards; and out under the overhang, the rafters'
  // ends.
  for (const s of [-1, 1]) {
    const zw = s > 0 ? zw1 : zw0;
    const top = underY(zw);
    // Between the gables' inner faces.
    const span = inner.x1 - inner.x0 + 2 * (jetty - gableT);
    box(
      frame,
      span,
      top + H / 2,
      0.18,
      (inner.x0 + inner.x1) / 2,
      (top - H / 2) / 2,
      zw - s * 0.1,
      beams,
    );
    const count = Math.max(2, Math.round((sx1 - sx0) / 0.7));
    const e = s * (D / 2 - 0.04);
    for (let i = 0; i <= count; i++) {
      const x = sx0 + 0.08 + ((sx1 - sx0 - 0.16) * i) / count;
      const outline: [number, number][] = [
        [zw, underY(zw)],
        [e, underY(e)],
        [e, Math.max(-H / 2, underY(e) - 0.08)],
        [zw, Math.max(-H / 2, underY(zw) - 0.12)],
      ];
      add(frame, slab(outline, x - 0.045, x + 0.045, 0.01), timber, 0, 0, 0);
    }
  }
  // Tie beams across the room, from wall plate to wall plate: one over its middle, where a lamp
  // hangs from it.
  for (const f of [-1 / 3, 0, 1 / 3]) {
    const x = (inner.x0 + inner.x1) / 2 + f * (inner.x1 - inner.x0);
    box(frame, 0.14, 0.16, zw1 - zw0 - 0.38, x, -H / 2 + 0.08, (zw0 + zw1) / 2, beams);
  }
}
