import * as THREE from 'three';
import { group, rng } from './kit.ts';
import { painted } from './paint.ts';
import {
  IRON,
  WOOD,
  WOOD_DARK,
  WOOD_PALE,
  bracketLantern,
  cornerPlate,
  hangingLantern,
  ironCap,
  lashing,
  latticeWindow,
  nextSeed,
  pennant,
  plankDoor,
  put,
  rivet,
  shingleSlope,
  timber,
} from './parts.ts';
import type { TimberOptions } from './parts.ts';
import { bottle } from './props.ts';
import { block, finish, rod } from './shape.ts';
import type { Solids } from './walk.ts';

/**
 * The island's two buildings, after the reference picture's chunky hand-painted style: the tall
 * house, each floor jettied out over the one below on massive timbers so it grows top-heavy,
 * every joint wrapped in riveted iron; plastered upper floors with glowing lattice windows; a
 * steep roof of chunky blue-violet shingles swept out at the eaves, its gable framed by thick
 * crossed barge boards and its ridge beam ending in a great rough block bound in iron, a lantern
 * hanging under it; a balcony reached by an outside stair. Beside it the shop, built the same
 * way with a red roof, a porthole and a double door.
 */

const up = new THREE.Vector3(0, 1, 0);

/** A timber `w × d` in section from `a` to `b` (its long axis along the line), `over` longer at each end. */
function strut(
  g: THREE.Object3D,
  a: THREE.Vector3,
  b: THREE.Vector3,
  w: number,
  d: number,
  o: TimberOptions & { over?: number; spin?: number } = {},
): THREE.Mesh {
  const dir = b.clone().sub(a);
  const len = dir.length() + 2 * (o.over ?? 0);
  const m = timber(g, 0, 0, 0, w, len, d, { grain: 1, ...o });
  m.position.copy(a).lerp(b, 0.5);
  m.quaternion.setFromUnitVectors(up, dir.normalize());
  if (o.spin) m.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(up, o.spin));
  return m;
}

/** A plastered panel `sx × sy × sz` at (`x`, `y`, `z`), its edges soft. */
function plaster(
  g: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
): void {
  put(
    g,
    block(sx, sy, sz, 'plaster', {
      edge: 0.15,
      shade: 0.28,
      wobble: 0.02,
      seed: nextSeed(),
      bevel: 0.04,
    }),
    painted('plaster', 0xffffff, { roughness: 0.95 }),
    x,
    y,
    z,
  );
}

/** A plastered triangle facing +z: `w` wide at `y0`, up to a point at `y1`, `t` thick, centred on z. */
function plasterGable(
  g: THREE.Object3D,
  z: number,
  y0: number,
  y1: number,
  w: number,
  t = 0.24,
): void {
  const shape = new THREE.Shape([
    new THREE.Vector2(-w / 2, y0),
    new THREE.Vector2(w / 2, y0),
    new THREE.Vector2(0, y1),
  ]);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
  geo.translate(0, 0, z - t / 2);
  put(
    g,
    finish(geo, 'plaster', { grain: 0, edge: 0, shade: 0.25, seed: nextSeed() }, 'none'),
    painted('plaster', 0xffffff, { roughness: 0.95 }),
  );
}

/** A box of greenery under a window, its middle at (`x`, `y`, `z`), `w` wide, facing +z. */
function windowBox(g: THREE.Object3D, x: number, y: number, z: number, w: number): void {
  const b = group(g, x, y, z);
  timber(b, 0, 0, 0, w, 0.3, 0.36, { tint: WOOD });
  for (const s of [-1, 1]) ironCap(b, (s * w) / 2.6, 0, 0, 0.1, 0.34, 0.4, { rivets: false });
  const r = rng(Math.round(x * 31 + z * 7 + y));
  const moss = painted('moss', 0xffffff, { roughness: 0.9 });
  for (let i = 0; i < 7; i++) {
    const rad = 0.16 + r() * 0.1;
    const geo = finish(
      new THREE.IcosahedronGeometry(rad, 1),
      'moss',
      { edge: 0, shade: 0.45, seed: nextSeed(), wobble: rad * 0.18 },
      'none',
    );
    put(b, geo, moss, (r() - 0.5) * (w - 0.2), 0.2 + r() * 0.1, (r() - 0.5) * 0.18);
  }
}

/**
 * The great rough block a ridge beam ends in: chunky, cut askew, pale where it was sawn, bound
 * round its middle by an iron band. Its middle at (`x`, `y`, `z`).
 */
function ridgeBlock(
  g: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  s: number,
  seed: number,
): THREE.Group {
  const r = rng(seed);
  const c = group(g, x, y, z);
  c.rotation.set((r() - 0.5) * 0.2, (r() - 0.5) * 0.3, (r() - 0.5) * 0.24);
  timber(c, 0, 0, 0, s * 1.15, s * 0.95, s * 1.05, {
    tint: WOOD_PALE,
    bevel: s * 0.16,
    wobble: s * 0.05,
    edge: 0.4,
    grain: 2,
  });
  // A second, smaller block on its top, turned, as the reference's caps are piled.
  timber(c, 0, s * 0.55, -s * 0.05, s * 0.8, s * 0.32, s * 0.85, {
    tint: WOOD,
    bevel: s * 0.1,
    ry: 0.25,
    wobble: s * 0.04,
  });
  ironCap(c, 0, -s * 0.05, 0, s * 1.2, s * 0.26, s * 1.1);
  return c;
}

/**
 * A gable's heavy barge boards facing +z at `z`, in `g`'s space: one up each edge of the roof
 * from its eave at (±`halfW`, `eaveY`) to the apex at (0, `apexY`), crossing there, swept up at
 * their feet, iron at their ends.
 */
function bargeBoards(
  g: THREE.Object3D,
  z: number,
  halfW: number,
  eaveY: number,
  apexY: number,
  size = 0.5,
): void {
  for (const s of [-1, 1]) {
    const foot = new THREE.Vector3(s * halfW, eaveY, z);
    const top = new THREE.Vector3(-s * 0.28, apexY + 0.32, z);
    strut(g, foot, top, size, size * 1.05, {
      over: 0.1,
      tint: s > 0 ? WOOD : WOOD_DARK,
      edge: 0.6,
    });
    // The swept-up foot: a short block kicked out flatter beyond the eave, capped in iron.
    const kick = group(g, s * (halfW + 0.35), eaveY - 0.1, z);
    kick.rotation.z = s * 0.38;
    timber(kick, 0, 0, 0, 0.95, size * 0.95, size * 1.1, { tint: WOOD });
    ironCap(kick, s * 0.34, 0, 0, 0.26, size + 0.08, size * 1.1 + 0.08);
  }
}

/**
 * The tall house, its ground floor's middle at (`x`, `y`, `z`), turned `yaw`, its front (with
 * the balcony and the outside stair on its right) facing its own +z.
 */
export function bigHouse(
  parent: THREE.Object3D,
  solids: Solids,
  x: number,
  y: number,
  z: number,
  yaw: number,
): THREE.Group {
  const g = group(parent, x, y, z, yaw);
  const W0 = 4.6; // the ground floor
  const D0 = 5.0;
  const W1 = 6.0; // the jettied first floor
  const D1 = 6.4;
  const Y1 = 2.7; // the first floor's sill
  const Y2 = 5.5; // its head, and the eaves
  const RW = W1 / 2 + 0.8; // the roof's half width at its eaves
  const AY = Y2 + 4.1; // its apex
  const pitch = Math.atan2(AY - Y2, RW);
  const FL = Y1 + 0.23; // the first floor's (and balcony's) top
  const front1 = D1 / 2;
  const P = 0.6;

  // The ground floor: thick leaning posts, iron at their feet and heads, rough board walls.
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const px = (sx * W0) / 2;
      const pz = (sz * D0) / 2;
      timber(g, px, (Y1 - 0.2) / 2, pz, 0.62, Y1 - 0.2, 0.62, {
        tint: WOOD_DARK,
        rz: -sx * 0.025,
        rx: sz * 0.02,
        grain: 1,
      });
      ironCap(g, px, 0.2, pz, 0.72, 0.4, 0.72);
      ironCap(g, px, Y1 - 0.6, pz, 0.72, 0.36, 0.72);
      if (sz > 0) lashing(g, px, 1.35, pz, 0.28);
    }
  const boardWall = (bx: number, bz: number, sx: number, sz: number) =>
    timber(g, bx, (Y1 - 0.2) / 2, bz, sx, Y1 - 0.2, sz, {
      paint: 'boards',
      grain: 1,
      tint: WOOD,
      edge: 0.3,
      wobble: 0.015,
    });
  boardWall(0, D0 / 2 - 0.1, W0 - 0.3, 0.16);
  boardWall(0, -D0 / 2 + 0.1, W0 - 0.3, 0.16);
  for (const s of [-1, 1]) boardWall((s * W0) / 2 - s * 0.1, 0, 0.16, D0 - 0.3);
  // A rail round the ground floor at its middle.
  timber(g, 0, 1.0, D0 / 2 + 0.02, W0 - 0.2, 0.22, 0.2, { tint: WOOD });
  plankDoor(g, -0.75, 0, D0 / 2 + 0.02, 1.15, 2.05);
  latticeWindow(g, 1.15, 1.6, D0 / 2 + 0.02, 0.8, 0.85);
  bracketLantern(g, 0.3, 2.0, D0 / 2 + 0.05, 0.55);

  // The jetty: joists out over the ground floor's front and sides, their ends capped in iron,
  // braced from the posts below.
  for (const jx of [-2.2, -1.1, 0, 1.1, 2.2]) {
    timber(g, jx, Y1 - 0.42, (D0 / 2 + front1) / 2 + 0.05, 0.3, 0.3, front1 - D0 / 2 + 0.6, {
      tint: WOOD_DARK,
      grain: 2,
    });
    ironCap(g, jx, Y1 - 0.42, front1 + 0.32, 0.36, 0.36, 0.14, { rivets: false });
  }
  for (const s of [-1, 1])
    for (const jz of [-1.8, 0, 1.8]) {
      timber(
        g,
        s * ((W0 / 2 + W1 / 2) / 2 + 0.05),
        Y1 - 0.42,
        jz,
        W1 / 2 - W0 / 2 + 0.6,
        0.3,
        0.3,
        { tint: WOOD_DARK, grain: 0 },
      );
      ironCap(g, s * (W1 / 2 + 0.32), Y1 - 0.42, jz, 0.14, 0.36, 0.36, { rivets: false });
    }
  for (const sx of [-1, 1]) {
    strut(
      g,
      new THREE.Vector3((sx * W0) / 2, Y1 - 1.25, D0 / 2 + 0.15),
      new THREE.Vector3((sx * W0) / 2, Y1 - 0.45, front1 - 0.05),
      0.24,
      0.26,
      { tint: WOOD },
    );
    strut(
      g,
      new THREE.Vector3((sx * W0) / 2 + sx * 0.15, Y1 - 1.25, D0 / 2),
      new THREE.Vector3((sx * W1) / 2 - sx * 0.05, Y1 - 0.45, D0 / 2),
      0.24,
      0.26,
      { tint: WOOD },
    );
  }

  // The first floor's frame: sills, leaning corner posts, heads, all of massive timber.
  const sill = { tint: WOOD, edge: 0.6 };
  timber(g, 0, Y1, front1, W1 + 0.5, P, P, { ...sill, grain: 0 });
  timber(g, 0, Y1, -front1, W1 + 0.5, P, P, { ...sill, grain: 0 });
  for (const s of [-1, 1])
    timber(g, (s * W1) / 2, Y1, 0, P, P, D1 + 0.5, { ...sill, grain: 2, tint: WOOD_DARK });
  const postH = Y2 - Y1 - P;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const px = (sx * W1) / 2;
      const pz = sz * front1;
      timber(g, px, (Y1 + Y2) / 2, pz, P, postH + 0.05, P, {
        tint: WOOD_DARK,
        rz: -sx * 0.03,
        grain: 1,
      });
      ironCap(g, px, Y1 + P / 2 + 0.22, pz, P + 0.1, 0.42, P + 0.1);
      ironCap(g, px, Y2 - P / 2 - 0.22, pz, P + 0.1, 0.42, P + 0.1);
    }
  timber(g, 0, Y2, front1 + 0.02, W1 + 0.7, 0.64, 0.64, { tint: WOOD, grain: 0 });
  timber(g, 0, Y2, -front1, W1 + 0.7, 0.64, 0.64, { tint: WOOD, grain: 0 });
  for (const s of [-1, 1])
    timber(g, (s * W1) / 2, Y2, 0, 0.64, 0.64, D1 + 0.7, { tint: WOOD_DARK, grain: 2 });
  // Iron plates where the corner posts meet the sill and the head, on the front.
  for (const s of [-1, 1]) {
    cornerPlate(g, (s * (W1 - P)) / 2, Y1 + 0.02, front1 + P / 2 + 0.02, -s, 1, 0.8, 0.3);
    cornerPlate(g, (s * (W1 - P)) / 2, Y2 - 0.02, front1 + 0.34 + 0.02, -s, -1, 0.8, 0.3);
  }
  // The walls between: plaster set well back, a middle post on the front, a brace in each side.
  const wallH = Y2 - Y1 - 0.4;
  plaster(g, 0, (Y1 + Y2) / 2, front1 - 0.12, W1 - 0.3, wallH, 0.2);
  plaster(g, 0, (Y1 + Y2) / 2, -front1 + 0.12, W1 - 0.3, wallH, 0.2);
  for (const s of [-1, 1])
    plaster(g, (s * W1) / 2 - s * 0.12, (Y1 + Y2) / 2, 0, 0.2, wallH, D1 - 0.3);
  timber(g, -0.2, (Y1 + Y2) / 2, front1, 0.46, postH, 0.46, { tint: WOOD, grain: 1 });
  ironCap(g, -0.2, Y1 + 0.6, front1, 0.56, 0.34, 0.56);
  for (const s of [-1, 1]) {
    strut(
      g,
      new THREE.Vector3((s * W1) / 2 + s * 0.05, Y1 + 0.3, -front1 + 0.4),
      new THREE.Vector3((s * W1) / 2 + s * 0.05, Y2 - 0.3, -0.6),
      0.3,
      0.26,
      { tint: WOOD_DARK },
    );
    latticeWindow(g, (s * W1) / 2 + s * 0.05, Y1 + 1.5, 1.4, 0.75, 0.95, (s * Math.PI) / 2);
  }
  latticeWindow(g, -1.45, Y1 + 1.45, front1 + 0.03, 1.15, 1.3);
  windowBox(g, -1.45, Y1 + 0.55, front1 + 0.35, 1.5);
  plankDoor(g, 1.25, FL, front1 + 0.02, 1.0, 1.95);
  bracketLantern(g, -0.2, Y1 + 2.05, front1 + 0.2, 0.55);

  // The gable: a tie beam jutting out, plaster above it, a king post and a small window, all
  // under thick crossed barge boards; then the roof.
  const gz = front1 + 0.45;
  timber(g, 0, Y2 + 0.5, gz, W1 + 1.2, 0.66, 0.66, { tint: WOOD, grain: 0 });
  for (const s of [-1, 1])
    ironCap(g, (s * (W1 + 1.2)) / 2 - s * 0.14, Y2 + 0.5, gz, 0.36, 0.76, 0.76);
  for (const s of [-1, 1])
    timber(g, (s * W1) / 2, Y2 + 0.45, (gz + front1) / 2, 0.4, 0.4, gz - front1 + 0.4, {
      tint: WOOD_DARK,
      grain: 2,
    });
  const gy0 = Y2 + 0.72;
  const gTop = AY - 0.35;
  plasterGable(g, gz - 0.1, gy0, gTop, 2 * ((gTop - gy0) / Math.tan(pitch)) + 0.2);
  timber(g, 0, (gy0 + gTop) / 2 + 0.7, gz, 0.36, gTop - gy0 - 1.2, 0.36, {
    tint: WOOD_DARK,
    grain: 1,
  });
  timber(g, 0, Y2 + 2.45, gz + 0.02, 2.6, 0.32, 0.34, { tint: WOOD, grain: 0 });
  for (const s of [-1, 1]) cornerPlate(g, s * 0.2, Y2 + 2.45, gz + 0.2, s, 1, 0.5, 0.2);
  latticeWindow(g, 0, Y2 + 1.55, gz + 0.04, 0.6, 0.85);
  bargeBoards(g, gz + 0.55, RW + 0.05, Y2 - 0.25, AY, 0.62);
  // The back gable, plainer.
  plasterGable(
    g,
    -front1 - 0.05,
    Y2 + 0.25,
    gTop,
    2 * ((gTop - Y2 - 0.25) / Math.tan(pitch)) + 0.2,
  );
  bargeBoards(g, -front1 - 0.45, RW + 0.05, Y2 - 0.25, AY, 0.42);

  // The roof: boards under, chunky shingles over, swept out at the eaves.
  const slope = Math.hypot(RW + 0.4, AY - Y2 + 0.3);
  const tints = [0x645f96, 0x7069a2, 0x55517f, 0x7c76ae];
  for (const s of [-1, 1] as const) {
    strut(
      g,
      new THREE.Vector3(s * (RW - 0.3), Y2 + 0.05, (gz - front1 - 0.4) / 2),
      new THREE.Vector3(0, AY - 0.05, (gz - front1 - 0.4) / 2),
      0.14,
      D1 + 1.2,
      { tint: WOOD_DARK, spin: 0, edge: 0.2 },
    ).rotateY(0);
    shingleSlope(
      g,
      AY + 0.12,
      pitch,
      0.32,
      slope,
      -front1 - 0.55,
      gz + 0.35,
      s,
      tints,
      100 + s,
      'stone',
    );
  }
  // The ridge beam, and its great end blocks.
  timber(g, 0, AY + 0.2, (gz - front1) / 2 + 0.2, 0.62, 0.62, D1 + 2.4, {
    tint: WOOD_DARK,
    grain: 2,
  });
  for (const zz of [-1.0, 1.4]) ironCap(g, 0, AY + 0.2, zz, 0.7, 0.7, 0.24);
  const cap = ridgeBlock(g, 0, AY + 0.3, gz + 1.15, 1.25, 7);
  hangingLantern(cap, 0.1, -0.62, 0.15, 1.15, 0.3);
  ridgeBlock(g, 0, AY + 0.15, -front1 - 1.1, 0.95, 9);

  // A dormer on the left slope: its own small gable, shingles and block.
  {
    const d = group(g, -RW * 0.45, Y2 + 1.7, 0.6, -Math.PI / 2);
    const dw = 1.9;
    const dh = 1.3;
    plaster(d, 0, dh / 2, 0, dw - 0.2, dh, 0.2);
    for (const s of [-1, 1])
      timber(d, (s * dw) / 2, dh / 2, 0.05, 0.3, dh + 0.1, 0.3, { tint: WOOD_DARK, grain: 1 });
    timber(d, 0, 0, 0.08, dw + 0.4, 0.32, 0.32, { tint: WOOD });
    latticeWindow(d, 0, dh * 0.52, 0.12, 0.65, 0.7);
    const dp = 0.85;
    plasterGable(d, -0.02, dh, dh + 1.1, dw);
    for (const s of [-1, 1] as const)
      shingleSlope(d, dh + 1.25, dp, 0.15, 1.55, -1.6, 0.35, s, tints, 130 + s, 'stone');
    bargeBoards(d, 0.25, dw / 2 + 0.35, dh - 0.05, dh + 1.1, 0.3);
    ridgeBlock(d, 0, dh + 1.3, 0.6, 0.6, 11);
  }

  // The balcony on the front's right, over the jetty, its floor level with the first floor's.
  const bx0 = 0.35;
  const bx1 = W1 / 2 + 1.55;
  const bz0 = front1 + 0.2;
  const bz1 = front1 + 1.45;
  const bmid = (bx0 + bx1) / 2;
  timber(g, bmid, FL - 0.08, (bz0 + bz1) / 2, bx1 - bx0, 0.16, bz1 - bz0, {
    paint: 'boards',
    grain: 0,
    edge: 0.3,
  });
  for (const bxj of [0.6, 1.9, 3.2])
    timber(g, bxj, FL - 0.32, (bz0 + bz1) / 2 - 0.2, 0.28, 0.3, bz1 - bz0 + 0.8, {
      tint: WOOD_DARK,
      grain: 2,
    });
  timber(g, bmid, FL - 0.32, bz1 - 0.1, bx1 - bx0 + 0.2, 0.32, 0.3, { tint: WOOD, grain: 0 });
  // A post under its far corner, down to the sand.
  timber(g, bx1 - 0.2, (FL - 0.3) / 2, bz1 - 0.15, 0.36, FL - 0.3, 0.36, {
    tint: WOOD_DARK,
    grain: 1,
  });
  ironCap(g, bx1 - 0.2, 0.2, bz1 - 0.15, 0.44, 0.3, 0.44);
  ironCap(g, bx1 - 0.2, FL - 0.55, bz1 - 0.15, 0.44, 0.3, 0.44);
  lashing(g, bx1 - 0.2, 1.3, bz1 - 0.15, 0.18);
  // The railing: posts with iron caps, a heavy rail, turned balusters.
  const railY = FL + 1.0;
  const railZ = bz1 - 0.08;
  for (const px of [bx0 + 0.1, 1.75, bx1 - 0.2]) {
    timber(g, px, FL + 0.6, railZ, 0.24, 1.2, 0.24, { tint: WOOD_DARK, grain: 1 });
    ironCap(g, px, FL + 1.1, railZ, 0.3, 0.16, 0.3, { rivets: false });
  }
  timber(g, bmid, railY, railZ, bx1 - bx0, 0.15, 0.2, { tint: WOOD, grain: 0 });
  timber(g, bmid, FL + 0.12, railZ, bx1 - bx0, 0.1, 0.16, { tint: WOOD, grain: 0 });
  timber(g, bx0 + 0.1, railY, (bz0 + bz1) / 2, 0.2, 0.15, bz1 - bz0, { tint: WOOD, grain: 2 });
  const baluster = (px: number, pz: number) =>
    put(
      g,
      rod(0.055, 0.055, 0.85, 'wood', { seed: nextSeed(), sides: 8 }),
      painted('wood', WOOD_PALE),
      px,
      FL + 0.6,
      pz,
    );
  for (let px = bx0 + 0.35; px < bx1 - 0.3; px += 0.3) baluster(px, railZ);
  for (let pz = bz0 + 0.25; pz < bz1 - 0.2; pz += 0.3) baluster(bx0 + 0.1, pz);
  bracketLantern(g, bx1 - 0.2, FL + 1.05, railZ + 0.1, 0.45, 0, 0.9);
  for (const [bxx, h] of [
    [0.9, 0.3],
    [1.15, 0.26],
  ] as const)
    bottle(g, bxx, railY + 0.08, railZ, h);

  // The outside stair up the right side to the balcony's end.
  const sx0 = W1 / 2 + 0.42;
  const sx1 = sx0 + 1.1;
  const smid = (sx0 + sx1) / 2;
  const top = bz0 + 0.05;
  const foot = top - 4.0;
  const steps = 12;
  const run = (top - foot) / steps;
  for (let i = 0; i < steps; i++) {
    const sy = ((i + 1) * FL) / steps;
    timber(g, smid, sy - 0.07, foot + (i + 0.5) * run, 1.15, 0.14, run + 0.06, {
      tint: i % 2 ? WOOD : WOOD_PALE,
      grain: 0,
      edge: 0.5,
    });
  }
  for (const s of [sx0 - 0.05, sx1 + 0.05])
    strut(
      g,
      new THREE.Vector3(s, 0.05, foot - 0.1),
      new THREE.Vector3(s, FL - 0.15, top),
      0.16,
      0.42,
      { tint: WOOD_DARK, spin: Math.PI / 2 },
    );
  for (const pz of [foot + 0.2, (foot + top) / 2, top - 0.1]) {
    const h = ((pz - foot) / (top - foot)) * FL;
    timber(g, sx1 + 0.12, (h + 1.0) / 2, pz, 0.22, h + 1.0, 0.22, { tint: WOOD_DARK, grain: 1 });
    ironCap(g, sx1 + 0.12, h + 0.95, pz, 0.28, 0.14, 0.28, { rivets: false });
  }
  strut(
    g,
    new THREE.Vector3(sx1 + 0.12, 1.0, foot + 0.2),
    new THREE.Vector3(sx1 + 0.12, FL + 1.0, top - 0.1),
    0.14,
    0.18,
    { tint: WOOD, over: 0.1 },
  );

  // What stands in the way, and what can be stood on.
  solids.box(g, 0, -0.5, 0, W1 + 0.3, AY + 1, D1 + 0.3);
  solids.box(g, bmid, FL - 0.2, (bz0 + bz1) / 2, bx1 - bx0, 0.2, bz1 - bz0 + 0.1);
  solids.box(g, bmid, FL, railZ + 0.05, bx1 - bx0, 1.1, 0.18);
  solids.box(g, bx0 + 0.05, FL, (bz0 + bz1) / 2, 0.18, 1.1, bz1 - bz0);
  solids.post(g, bx1 - 0.2, bz1 - 0.15, 0.2, 0, FL - 0.3);
  solids.ramp(g, smid, (foot + top) / 2, sx1 - sx0, top - foot, 0, FL);
  solids.box(g, sx1 + 0.12, 0, (foot + top) / 2, 0.18, FL + 1, top - foot);
  g.userData.stairFoot = new THREE.Vector3(smid, 0, foot - 0.8);
  g.userData.landing = new THREE.Vector3(smid - 0.15, FL, (bz0 + bz1) / 2);
  g.userData.balcony = new THREE.Vector3(1.6, FL, (bz0 + bz1) / 2);
  return g;
}

/**
 * The little shop: posts and plaster over a board skirt, a red shingle roof gable-on to the
 * front with a porthole in its gable, a double door between lanterns, a shelf of bottles, a
 * hanging sign, and a flagpole flying a red pennant. Its foot's middle at (`x`, `y`, `z`).
 */
export function shop(
  parent: THREE.Object3D,
  solids: Solids,
  x: number,
  y: number,
  z: number,
  yaw: number,
): THREE.Group {
  const g = group(parent, x, y, z, yaw);
  const W = 4.4;
  const D = 4.8;
  const H = 3.0;
  const P = 0.42;
  const RW = W / 2 + 0.75;
  const AY = H + 3.0;
  const pitch = Math.atan2(AY - H, RW);
  const fz = D / 2;

  // Skirt of boards, plaster above, a frame of massive timber with iron at its joints.
  for (const s of [-1, 1]) {
    timber(g, 0, 0.7, s * (fz - 0.1), W - 0.3, 1.4, 0.18, { paint: 'boards', grain: 1, edge: 0.3 });
    timber(g, s * (W / 2 - 0.1), 0.7, 0, 0.18, 1.4, D - 0.3, {
      paint: 'boards',
      grain: 1,
      edge: 0.3,
    });
    plaster(g, 0, (1.4 + H) / 2, s * (fz - 0.12), W - 0.3, H - 1.4, 0.2);
    plaster(g, s * (W / 2 - 0.12), (1.4 + H) / 2, 0, 0.2, H - 1.4, D - 0.3);
  }
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      timber(g, (sx * W) / 2, H / 2, sz * fz, P, H, P, {
        tint: WOOD_DARK,
        rz: -sx * 0.03,
        grain: 1,
      });
      ironCap(g, (sx * W) / 2, 0.22, sz * fz, P + 0.1, 0.36, P + 0.1);
      ironCap(g, (sx * W) / 2, H - 0.35, sz * fz, P + 0.1, 0.36, P + 0.1);
    }
  timber(g, 0, 1.4, fz + 0.02, W, 0.3, 0.3, { tint: WOOD, grain: 0 });
  timber(g, 0, H, fz + 0.05, W + 0.6, 0.46, 0.46, { tint: WOOD, grain: 0 });
  timber(g, 0, H, -fz, W + 0.6, 0.46, 0.46, { tint: WOOD, grain: 0 });
  for (const s of [-1, 1]) {
    timber(g, (s * W) / 2, H, 0, 0.46, 0.46, D + 0.6, { tint: WOOD_DARK, grain: 2 });
    ironCap(g, (s * (W + 0.6)) / 2 - s * 0.1, H, fz + 0.05, 0.28, 0.54, 0.54);
  }

  plankDoor(g, 0, 0, fz + 0.04, 1.5, 2.25, 0, true);
  for (const s of [-1, 1]) bracketLantern(g, s * 1.35, 2.35, fz + 0.12, 0.45);
  // A shelf of bottles beside the door.
  const shelf = group(g, -1.55, 1.75, fz + 0.2);
  timber(shelf, 0, 0, 0, 0.8, 0.08, 0.26, { tint: WOOD_PALE });
  for (const s of [-1, 1])
    ironCap(shelf, s * 0.3, -0.12, -0.02, 0.05, 0.22, 0.24, { rivets: false });
  for (const [bx, h] of [
    [-0.25, 0.3],
    [0, 0.26],
    [0.24, 0.34],
  ] as const)
    bottle(shelf, bx, 0.04, 0, h);

  // The gable: tie beam, plaster, the porthole, barge boards, a red roof and a ridge block.
  const gz = fz + 0.3;
  timber(g, 0, H + 0.42, gz, W + 0.7, 0.42, 0.44, { tint: WOOD, grain: 0 });
  plasterGable(
    g,
    gz - 0.05,
    H + 0.62,
    AY - 0.3,
    2 * ((AY - 0.3 - H - 0.62) / Math.tan(pitch)) + 0.2,
  );
  plasterGable(g, -fz, H + 0.25, AY - 0.3, 2 * ((AY - 0.3 - H - 0.25) / Math.tan(pitch)) + 0.2);
  {
    const ph = group(g, 0, H + 1.55, gz + 0.12);
    const iron = painted('iron', IRON, { roughness: 0.5, metalness: 0.15 });
    put(
      ph,
      new THREE.CircleGeometry(0.42, 20),
      new THREE.MeshStandardMaterial({
        color: 0xffc35a,
        emissive: 0xff9d2e,
        emissiveIntensity: 1.6,
      }),
      0,
      0,
      0.02,
    ).castShadow = false;
    put(
      ph,
      finish(
        new THREE.TorusGeometry(0.47, 0.11, 8, 24),
        'iron',
        { edge: 0, shade: 0.2, seed: nextSeed() },
        'none',
      ),
      iron,
      0,
      0,
      0.08,
    );
    for (const a of [0, Math.PI / 2])
      put(
        ph,
        block(0.84, 0.06, 0.05, 'iron', { seed: nextSeed(), edge: 0.6 }),
        iron,
        0,
        0,
        0.06,
        0,
        0,
        a,
      );
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      rivet(
        ph,
        new THREE.Vector3(Math.cos(a) * 0.47, Math.sin(a) * 0.47, 0.18),
        new THREE.Vector3(0, 0, 1),
        0.035,
      );
    }
  }
  bargeBoards(g, gz + 0.35, RW + 0.05, H - 0.3, AY, 0.42);
  bargeBoards(g, -fz - 0.35, RW + 0.05, H - 0.3, AY, 0.36);
  const slope = Math.hypot(RW + 0.35, AY - H + 0.3);
  const reds = [0xffa080, 0xf08a6c, 0xffb894, 0xe07a60];
  for (const s of [-1, 1] as const) {
    strut(
      g,
      new THREE.Vector3(s * (RW - 0.3), H + 0.05, 0.1),
      new THREE.Vector3(0, AY - 0.05, 0.1),
      0.14,
      D + 1.0,
      { tint: WOOD_DARK },
    );
    shingleSlope(g, AY + 0.1, pitch, 0.3, slope, -fz - 0.45, gz + 0.25, s, reds, 200 + s, 'wood');
  }
  timber(g, 0, AY + 0.18, 0.15, 0.5, 0.5, D + 1.6, { tint: WOOD_DARK, grain: 2 });
  ridgeBlock(g, 0, AY + 0.25, gz + 0.85, 0.95, 21);
  ridgeBlock(g, 0, AY + 0.15, -fz - 0.85, 0.8, 23);

  // A hanging sign on an iron arm off the front right post.
  {
    const s = group(g, W / 2 + 0.25, 2.5, fz + 0.2);
    const iron = painted('iron', IRON, { roughness: 0.5, metalness: 0.15 });
    put(s, block(1.0, 0.07, 0.07, 'iron', { seed: nextSeed() }), iron, 0.45, 0, 0);
    for (const sx of [0.15, 0.75])
      put(s, rod(0.012, 0.012, 0.22, 'iron', { sides: 4, edge: 0 }), iron, sx, -0.12, 0);
    timber(s, 0.45, -0.5, 0, 0.85, 0.55, 0.09, { tint: WOOD_PALE, rz: 0.05, grain: 0 });
    ironCap(s, 0.45, -0.25, 0, 0.92, 0.07, 0.11, { rivets: false, rz: 0.05 });
  }

  // The flagpole off the back right corner, with its pennant.
  {
    const px = W / 2 + 0.1;
    const pz = -fz + 0.1;
    put(
      g,
      rod(0.1, 0.07, 6.2, 'wood', { seed: nextSeed() }),
      painted('wood', WOOD_DARK),
      px,
      AY - 3.0 + 3.1,
      pz,
    );
    ironCap(g, px, AY - 2.6, pz, 0.24, 0.2, 0.24, { rivets: false });
    put(
      g,
      finish(new THREE.SphereGeometry(0.13, 8, 6), 'iron', { edge: 0, seed: nextSeed() }),
      painted('iron', IRON, { metalness: 0.15, roughness: 0.45 }),
      px,
      AY + 3.2,
      pz,
    );
    pennant(g, px + 0.05, AY + 3.0, pz, 1.4, 0.55, 0xd14a3a, 0.3);
  }

  solids.box(g, 0, -0.5, 0, W + 0.5, AY + 1, D + 0.5);
  return g;
}
