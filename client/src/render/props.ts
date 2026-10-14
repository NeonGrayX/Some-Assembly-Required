import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DRAWER_BOX, DRAWER_TRAY, STAIRS, UPPER_FLOOR, floorLevel } from '@sar/shared';
import type { BoxDef, HideoutDef, LevelDef, StairsDef } from '@sar/shared';
import { rectMinusHoles } from './details.ts';
import { trashBinModel } from './bins.ts';
import { gardenLamp } from './garden.ts';
import { add, box, can, mat, metal } from './interiors.ts';
import { KEEP_SEPARATE } from './merge.ts';
import { Surface, madeOf, madeOfBox } from './styles.ts';
import { propFile } from './propFiles.ts';
import { caravanRoof, towHitch } from './caravan.ts';
import {
  axleUnit,
  ballast,
  carriageRoof,
  flue,
  gangway,
  livery,
  locomotive,
  stove,
  tankSpout,
  trackRail,
  wagon,
  waterTank,
} from './railway.ts';
import { acUnit, forklift, pallet, rack, shutter } from './warehouse.ts';

/** What `makeProp` hands back of a model besides the model itself, for the view to animate. */
export interface PropParts {
  /** The electrical panel's status light, which `PanelView` lights up. */
  led?: THREE.Mesh;
}

/**
 * Furniture drawn from plain level boxes: a box tagged with a `model` becomes a table with
 * legs, a counter with a worktop and sink, a sofa with arms and cushions, a filled bookshelf
 * or a slatted crate, fitted to whatever size the box has, and outdoors a log, a stump, a
 * stone, decking, a post, a picnic table, a canoe or a wheel. It still collides as the box, so
 * the models never reach outside it by more than a soft cushion's sag; the one exception is
 * the pine, whose boughs spread far beyond its trunk's box and stop nothing.
 *
 * Models are built in a frame centred on the box with local -z its front, `w` wide (x),
 * `h` high and `d` deep (z).
 */

/** The yaw that turns a model's front (local -z) to each side of its box. */
export const FACING = { '-z': 0, '+z': Math.PI, '-x': Math.PI / 2, '+x': -Math.PI / 2 } as const;

/** A shade of `colour`: `f` < 1 darker, > 1 lighter. */
const shade = (colour: number, f: number) => new THREE.Color(colour).multiplyScalar(f).getHex();

/** Same pseudo-random numbers on every client, from a position. */
function hashRng(x: number, z: number): () => number {
  let s = Math.floor(Math.abs(x * 7919 + z * 104729 + 17)) % 2147483647 || 1;
  return () => (s = (s * 48271) % 2147483647) / 2147483647;
}

const soft = (
  parent: THREE.Object3D,
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
  radius = 0.04,
) =>
  add(
    parent,
    new RoundedBoxGeometry(sx, sy, sz, 2, Math.min(radius, sx / 2, sy / 2, sz / 2)),
    material,
    x,
    y,
    z,
  );

/** A hiding place in the model's frame, so models can leave room for it. */
interface LocalHideout {
  def: HideoutDef;
  min: THREE.Vector3;
  max: THREE.Vector3;
}

/** The gap round a drawer's tray in the opening it slides out of. */
const REVEAL = 0.004;

/**
 * A solid block `w` wide, from `y0` up to `y1`, from the model's front (-z, at `-d / 2`) back
 * `d`, with an opening in its front for each drawer set into it: as big as the drawer's tray
 * with a narrow gap round it, which the drawer's front, standing on the block's front, covers.
 * The tray slides out of a pocket as deep as itself, dark at the back, rather than through
 * the solid front.
 */
function blockWithDrawers(
  g: THREE.Object3D,
  w: number,
  y0: number,
  y1: number,
  d: number,
  material: THREE.Material,
  hideouts: LocalHideout[],
): void {
  const front = -d / 2;
  const pockets = hideouts
    .filter((hd) => hd.def.kind === 'drawer' && Math.abs(hd.min.z - front) < 0.15)
    .map((hd) => {
      // Only as big as the tray, which the drawer's front covers.
      const [cx, cy] = [(hd.min.x + hd.max.x) / 2, (hd.min.y + hd.max.y) / 2];
      const hw = ((hd.max.x - hd.min.x) * DRAWER_BOX.w) / 2 + REVEAL;
      const hh = ((hd.max.y - hd.min.y) * DRAWER_BOX.h) / 2 + REVEAL;
      return {
        u0: cx - hw,
        u1: cx + hw,
        v0: Math.max(y0, cy - hh),
        v1: Math.min(y1, cy + hh),
        // Back to where the shut tray ends, and a little more.
        back: Math.min(d / 2 - 0.02, hd.max.z + DRAWER_TRAY + 0.01),
      };
    })
    .filter((p) => p.v1 - p.v0 > 0.01 && p.back > front + 0.02);
  if (pockets.length === 0) {
    box(g, w, y1 - y0, d, 0, (y0 + y1) / 2, 0, material);
    return;
  }
  // Solid behind the deepest pocket; in front of that, the front cut round the openings.
  const deepest = Math.max(...pockets.map((p) => p.back));
  box(g, w, y1 - y0, d / 2 - deepest, 0, (y0 + y1) / 2, (deepest + d / 2) / 2, material);
  const slab = deepest - front;
  for (const r of rectMinusHoles({ u0: -w / 2, u1: w / 2, v0: y0, v1: y1 }, pockets))
    box(
      g,
      r.u1 - r.u0,
      r.v1 - r.v0,
      slab,
      (r.u0 + r.u1) / 2,
      (r.v0 + r.v1) / 2,
      front + slab / 2,
      material,
    );
  const dark = mat(0x26221e, 0.95);
  for (const p of pockets) {
    const [pw, ph] = [p.u1 - p.u0, p.v1 - p.v0];
    const [x, y] = [(p.u0 + p.u1) / 2, (p.v0 + p.v1) / 2];
    // The back of the pocket, dark, and solid behind it up to the rest.
    box(g, pw, ph, deepest - p.back + 0.004, x, y, (p.back - 0.004 + deepest) / 2, dark);
  }
}

function table(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const top = 0.05;
  const wood = mat(colour, 0.7);
  box(g, w, top, d, 0, h / 2 - top / 2, 0, wood);
  const leg = 0.07;
  const inset = 0.06;
  const legH = h - top;
  const dark = mat(shade(colour, 0.8), 0.75);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * (w / 2 - inset - leg / 2);
      const z = sz * (d / 2 - inset - leg / 2);
      box(g, leg, legH, leg, x, -h / 2 + legH / 2, z, dark);
    }
  // The apron under the top, between the legs.
  const apron = 0.09;
  const ay = h / 2 - top - apron / 2;
  for (const s of [-1, 1]) {
    box(g, w - 2 * inset - leg, apron, 0.025, 0, ay, s * (d / 2 - inset - leg / 2), dark);
    box(g, 0.025, apron, d - 2 * inset - leg, s * (w / 2 - inset - leg / 2), ay, 0, dark);
  }
}

function counter(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  hideouts: LocalHideout[],
  jars: THREE.Vector3[] = [],
): void {
  const worktop = 0.04;
  const kick = 0.1;
  const carcass = mat(colour, 0.6);
  const under = h / 2 - worktop;
  // A sink and tap at an end with nothing set on it (no treat jar, which would stand in it): a
  // steel basin sunk into the worktop and the cupboard under it, above any drawer's opening.
  const sx = [-w / 2 + 0.45, w / 2 - 0.45].find((x) => jars.every((j) => Math.abs(j.x - x) > 0.4));
  const pocketTop = Math.max(
    -h / 2,
    ...hideouts
      .filter((hd) => hd.def.kind === 'drawer')
      .map((hd) => (hd.min.y + hd.max.y) / 2 + ((hd.max.y - hd.min.y) * DRAWER_BOX.h) / 2 + REVEAL),
  );
  const depth = Math.min(0.16, under - pocketTop - 0.01);
  const sink =
    w > 1.4 && sx !== undefined && depth > 0.06
      ? { u0: sx - 0.22, u1: sx + 0.22, v0: -0.17, v1: 0.15, depth }
      : null;
  // A recessed toe kick, the cupboards, and a worktop that overhangs the front a little.
  box(g, w, kick, d - 0.06, 0, -h / 2 + kick / 2, 0.03, mat(0x3d3a36, 0.8));
  const top = sink ? under - sink.depth : under;
  blockWithDrawers(g, w, -h / 2 + kick, top, d, carcass, hideouts);
  const stone = mat(0x5f5a54, 0.35);
  const holes = sink ? [sink] : [];
  // Over the drawers, the cupboard round the basin.
  if (sink)
    for (const r of rectMinusHoles({ u0: -w / 2, u1: w / 2, v0: -d / 2, v1: d / 2 }, holes))
      box(
        g,
        r.u1 - r.u0,
        sink.depth,
        r.v1 - r.v0,
        (r.u0 + r.u1) / 2,
        top + sink.depth / 2,
        (r.v0 + r.v1) / 2,
        carcass,
      );
  for (const r of rectMinusHoles(
    { u0: -w / 2 - 0.01, u1: w / 2 + 0.01, v0: -d / 2 - 0.02, v1: d / 2 },
    holes,
  ))
    box(
      g,
      r.u1 - r.u0,
      worktop,
      r.v1 - r.v0,
      (r.u0 + r.u1) / 2,
      h / 2 - worktop / 2,
      (r.v0 + r.v1) / 2,
      stone,
    );
  // A shadow line where the doors of the cupboards below would meet, without handles: only
  // real hiding places open.
  const panel = 0.6;
  const count = Math.max(1, Math.round(w / panel));
  const line = mat(shade(colour, 0.7), 0.8);
  for (let i = 1; i < count; i++) {
    const x = -w / 2 + (i * w) / count;
    const y0 = -h / 2 + kick;
    const y1 = h / 2 - worktop;
    // Stop short of any drawer set into the front.
    const below = hideouts
      .filter((hd) => hd.min.x < x + 0.01 && hd.max.x > x - 0.01 && hd.min.z < -d / 2 + 0.02)
      .reduce((top, hd) => Math.min(top, hd.min.y - 0.02), y1);
    if (below - y0 > 0.05)
      box(g, 0.006, below - y0, 0.004, x, (y0 + below) / 2, -d / 2 - 0.002, line);
  }
  if (sink && sx !== undefined) {
    const steel = metal(0xc4c9cd);
    const inner = metal(0x8d9398);
    const wall = 0.01;
    const [bw, bd] = [sink.u1 - sink.u0, sink.v1 - sink.v0];
    const bz = (sink.v0 + sink.v1) / 2;
    const bottom = h / 2 - sink.depth;
    // The basin: its floor with the drain, and its four sides up to the worktop's top.
    box(g, bw, wall, bd, sx, bottom + wall / 2, bz, inner);
    add(
      g,
      new THREE.CylinderGeometry(0.03, 0.03, 0.003, 14),
      madeOf(mat(0x2b2d30, 0.4), Surface.Metal),
      sx,
      bottom + wall + 0.0015,
      bz,
    );
    for (const s of [-1, 1]) {
      box(
        g,
        wall,
        sink.depth - wall,
        bd,
        sx + s * (bw / 2 - wall / 2),
        bottom + wall + (sink.depth - wall) / 2,
        bz,
        inner,
      );
      box(
        g,
        bw - 2 * wall,
        sink.depth - wall,
        wall,
        sx,
        bottom + wall + (sink.depth - wall) / 2,
        bz + s * (bd / 2 - wall / 2),
        inner,
      );
    }
    // The rim, a lip over the worktop round the basin.
    const lip = 0.03;
    for (const s of [-1, 1]) {
      box(g, bw + 2 * lip, 0.004, lip, sx, h / 2 + 0.002, bz + s * (bd / 2 + lip / 2), steel);
      box(g, lip, 0.004, bd, sx + s * (bw / 2 + lip / 2), h / 2 + 0.002, bz, steel);
    }
    can(g, 0.02, 0.22, sx, h / 2, d / 2 - 0.08, steel);
    const spout = add(
      g,
      new THREE.CylinderGeometry(0.014, 0.014, 0.16, 8),
      steel,
      sx,
      h / 2 + 0.22,
      d / 2 - 0.15,
    );
    spout.rotation.x = Math.PI / 2;
  }
}

function sofa(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  hideouts: LocalHideout[],
): void {
  const fabric = mat(colour, 0.95);
  const darker = mat(shade(colour, 0.8), 0.95);
  const feet = 0.06;
  const arm = 0.18;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      box(
        g,
        0.05,
        feet,
        0.05,
        sx * (w / 2 - 0.08),
        -h / 2 + feet / 2,
        sz * (d / 2 - 0.08),
        mat(0x2b2118, 0.6),
      );
  // A centimetre shy of the arms' fronts and backs, which would otherwise lie in its own.
  soft(g, w - 0.02, h - feet, d - 0.02, 0, -h / 2 + feet + (h - feet) / 2, 0, darker, 0.03);
  // Arms at both ends, rising a little above the seat.
  for (const s of [-1, 1]) soft(g, arm, h + 0.12, d, s * (w / 2 - arm / 2), 0.06, 0, fabric, 0.07);
  // Seat cushions wherever no hiding-place cushion lies on the seat.
  const cushion = 0.1;
  const taken = hideouts
    .filter((hd) => Math.abs(hd.min.y - h / 2) < 0.06 && hd.def.kind === 'cushion')
    .map((hd) => [hd.min.x - 0.02, hd.max.x + 0.02] as const)
    .sort((a, b) => a[0] - b[0]);
  let from = -w / 2 + arm;
  const free: [number, number][] = [];
  for (const [a, b] of taken) {
    if (a > from) free.push([from, a]);
    from = Math.max(from, b);
  }
  if (w / 2 - arm > from) free.push([from, w / 2 - arm]);
  for (const [a, b] of free) {
    const n = Math.max(1, Math.round((b - a) / 1.3));
    const each = (b - a) / n;
    if (each < 0.25) continue;
    for (let i = 0; i < n; i++) {
      const x = a + each * (i + 0.5);
      soft(g, each - 0.02, cushion, d - 0.2, x, h / 2 + cushion / 2, -0.09, fabric, 0.04);
    }
  }
}

function sofaBack(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const fabric = mat(colour, 0.95);
  const roll = Math.min(0.1, d / 2);
  soft(g, w, h - roll, d, 0, -roll / 2, 0, mat(shade(colour, 0.85), 0.95), 0.03);
  const top = add(
    g,
    new THREE.CylinderGeometry(roll, roll, w - 0.02, 14),
    fabric,
    0,
    h / 2 - roll,
    0,
  );
  top.rotation.z = Math.PI / 2;
  // Back cushions leaning on it, above the seat.
  const n = Math.max(1, Math.round((w - 0.4) / 1.3));
  const each = (w - 0.4) / n;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 0.2 + each * (i + 0.5);
    const c = soft(
      g,
      each - 0.03,
      h * 0.42,
      0.12,
      x,
      h / 2 - roll - h * 0.21,
      -d / 2 - 0.03,
      fabric,
      0.05,
    );
    c.rotation.x = -0.12;
  }
}

function bookshelf(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
): void {
  const wood = mat(colour, 0.7);
  const t = 0.03;
  box(g, w, t, d, 0, h / 2 - t / 2, 0, wood);
  box(g, w, 0.08, d, 0, -h / 2 + 0.04, 0, wood);
  for (const s of [-1, 1]) box(g, t, h, d, s * (w / 2 - t / 2), 0, 0, wood);
  box(
    g,
    w - 2 * t,
    h - t - 0.08,
    0.01,
    0,
    0.04 - t / 2,
    d / 2 - 0.005,
    mat(shade(colour, 0.7), 0.8),
  );
  const bottom = -h / 2 + 0.08;
  const top = h / 2 - t;
  const rows = Math.max(1, Math.round((top - bottom) / 0.38));
  const step = (top - bottom) / rows;
  const colours = [
    0x8b2f2f, 0x2e4a7d, 0xd9b44a, 0x3b6e4a, 0x6a4c93, 0xc76a2c, 0x2b2b2b, 0x9c8c74, 0xe8e0cc,
  ];
  const inner = w / 2 - t;
  const depth = Math.min(0.24, d - 0.06);
  const z = d / 2 - 0.01 - depth / 2 - 0.01;
  for (let r = 0; r < rows; r++) {
    const floor = bottom + r * step;
    if (r > 0) box(g, w - 2 * t, 0.02, d - 0.01, 0, floor, -0.005, wood);
    const base = floor + 0.01;
    let x = -inner + 0.02;
    const room = step - 0.06;
    while (x < inner - 0.05) {
      const pick = seed();
      if (pick < 0.12 && x < inner - 0.25) {
        // A gap, or a short stack lying flat.
        if (seed() < 0.5) {
          for (let k = 0; k < 3; k++) {
            box(
              g,
              0.2,
              0.035,
              depth * 0.85,
              x + 0.11,
              base + 0.0175 + k * 0.036,
              z,
              mat(colours[Math.floor(seed() * colours.length)]!, 0.8),
            );
          }
        }
        x += 0.24;
        continue;
      }
      const thick = 0.025 + seed() * 0.025;
      const tall = Math.min(room, 0.2 + seed() * 0.1);
      box(
        g,
        thick,
        tall,
        depth * (0.8 + seed() * 0.2),
        x + thick / 2,
        base + tall / 2,
        z,
        mat(colours[Math.floor(seed() * colours.length)]!, 0.8),
      );
      x += thick + 0.003;
    }
  }
}

/** A chalkboard in a thin frame, with `label` chalked on its front (-z). */
function sign(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  label: string,
): void {
  box(g, w, h, d, 0, 0, 0, mat(colour, 0.95));
  // The chalk is drawn on a canvas, which only a browser has.
  if (typeof document === 'undefined') return;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = Math.round((1024 * h) / w);
  const x = c.getContext('2d')!;
  x.fillStyle = '#e9eef0';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = `italic ${c.height * 0.6}px "Segoe Script", "Bradley Hand", "Comic Sans MS", cursive`;
  x.fillText(label, c.width / 2, c.height * 0.52, c.width * 0.9);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  const chalk = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 1 }),
  );
  chalk.rotation.y = Math.PI;
  chalk.position.z = -d / 2 - 0.002;
  chalk.userData[KEEP_SEPARATE] = true;
  g.add(chalk);
}

function crate(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const plank = mat(colour, 0.85);
  const frame = mat(shade(colour, 0.75), 0.85);
  // The dark inside, seen between the slats.
  box(g, w - 0.04, h - 0.04, d - 0.04, 0, 0, 0, mat(0x2a1d12, 0.95));
  const e = 0.05;
  // The edges.
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) box(g, e, h, e, sx * (w / 2 - e / 2), 0, sz * (d / 2 - e / 2), frame);
  for (const sy of [-1, 1])
    for (const s of [-1, 1]) {
      box(g, w - 2 * e, e, e, 0, sy * (h / 2 - e / 2), s * (d / 2 - e / 2), frame);
      box(g, e, e, d - 2 * e, s * (w / 2 - e / 2), sy * (h / 2 - e / 2), 0, frame);
    }
  // Slats on the sides, with gaps, and boards across the top.
  const slats = Math.max(2, Math.round((h - 2 * e) / 0.12));
  const pitch = (h - 2 * e) / slats;
  for (let i = 0; i < slats; i++) {
    const y = -h / 2 + e + pitch * (i + 0.5);
    for (const s of [-1, 1]) {
      box(g, w - 2 * e, pitch * 0.7, 0.015, 0, y, s * (d / 2 - 0.0075), plank);
      box(g, 0.015, pitch * 0.7, d - 2 * e, s * (w / 2 - 0.0075), y, 0, plank);
    }
  }
  const boards = Math.max(2, Math.round(d / 0.14));
  const bp = (d - 2 * e) / boards;
  for (let i = 0; i < boards; i++) {
    box(g, w - 2 * e, 0.015, bp * 0.8, 0, h / 2 - 0.0075, -d / 2 + e + bp * (i + 0.5), plank);
  }
}

/** A bed: a wooden frame, mattress and blanket, with a headboard against the wall behind. */
function bed(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  hideouts: LocalHideout[],
): void {
  const wood = mat(0x7a5236, 0.7);
  const frame = 0.22;
  // The frame round the bottom, on short legs, with any drawer under the bed set into it.
  blockWithDrawers(g, w, -h / 2 + 0.08, -h / 2 + 0.08 + frame, d, wood, hideouts);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      box(g, 0.07, 0.08, 0.07, sx * (w / 2 - 0.05), -h / 2 + 0.04, sz * (d / 2 - 0.05), wood);
  // The mattress, and the blanket over its front two thirds, hanging over the sides.
  const top = -h / 2 + 0.08 + frame;
  const mattress = h / 2 - top - 0.04;
  soft(g, w - 0.06, mattress, d - 0.1, 0, top + mattress / 2, 0.02, mat(0xf2efe6, 0.9), 0.05);
  const cover = d * 0.66;
  soft(
    g,
    w - 0.02,
    0.05,
    cover,
    0,
    h / 2 - 0.025,
    -d / 2 + cover / 2 + 0.03,
    mat(colour, 0.95),
    0.025,
  );
  // The sides hang down behind the footboard, not through it.
  const drape = cover - 0.03;
  for (const s of [-1, 1])
    box(
      g,
      0.02,
      mattress * 0.8,
      drape,
      s * (w / 2 - 0.01),
      h / 2 - mattress * 0.4,
      -d / 2 + 0.06 + drape / 2,
      mat(colour, 0.95),
    );
  // The headboard rises above it against the wall, and a low footboard.
  box(g, w, h + 0.45, 0.06, 0, 0.225, d / 2 - 0.03, wood);
  box(g, w, 0.12, 0.05, 0, top + 0.06, -d / 2 + 0.025, wood);
}

/** One step of a flight of stairs: a painted block with a wooden tread on top. */
function step(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const tread = 0.035;
  box(g, w, h - tread, d, 0, -tread / 2, 0, mat(colour, 0.8));
  // The tread's nose sticks out a little over the riser below it.
  box(g, w, tread, d + 0.025, 0, h / 2 - tread / 2, -0.0125, mat(0x8a5f3c, 0.6));
}

/**
 * The electrical panel: a steel cabinet with its door shut, a warning sticker, vents, a conduit
 * up into the ceiling and a status light (see `PanelView`), which it returns. `ceiling` is how
 * far above its middle the ceiling is.
 */
function panel(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  ceiling: number,
): THREE.Mesh {
  const steel = metal(colour);
  box(g, w, h, d - 0.02, 0, 0, 0.01, steel);
  box(g, w - 0.04, h - 0.04, 0.02, 0, 0, -d / 2 + 0.01, metal(shade(colour, 1.12)));
  // Hinges on the left, the handle on the right.
  for (const y of [-h / 3, h / 3]) box(g, 0.02, 0.07, 0.02, -w / 2 + 0.01, y, -d / 2, steel);
  box(g, 0.03, 0.12, 0.03, w / 2 - 0.07, 0, -d / 2 - 0.01, mat(0x2b2b2b, 0.5));
  // A yellow warning sticker with a black bolt across it.
  box(g, 0.13, 0.12, 0.004, 0, h / 2 - 0.15, -d / 2 - 0.002, mat(0xf2c230, 0.6));
  const bolt = box(g, 0.02, 0.08, 0.004, 0, h / 2 - 0.15, -d / 2 - 0.004, mat(0x1d1d1d, 0.6));
  bolt.rotation.z = 0.5;
  // Vents near the bottom.
  for (let i = 0; i < 4; i++)
    box(g, w * 0.5, 0.012, 0.004, 0, -h / 2 + 0.07 + i * 0.03, -d / 2 - 0.002, mat(0x3a3f42));
  // The conduit up into the ceiling.
  const up = ceiling - h / 2;
  if (up > 0.02)
    add(g, new THREE.CylinderGeometry(0.025, 0.025, up, 10), steel, -w / 4, h / 2 + up / 2, 0.02);
  // The status light: green, or red while the power is out (see `PanelView`).
  const led = add(
    g,
    new THREE.SphereGeometry(0.022, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0x3ad35a }),
    -w / 2 + 0.09,
    h / 2 - 0.09,
    -d / 2 - 0.012,
  );
  led.castShadow = false;
  led.userData[KEEP_SEPARATE] = true;
  return led;
}

/**
 * A wooden ramp, in its own tilted frame: two stringers along its length, slats across them
 * with gaps between, and a board under them so it is not hollow seen from below.
 */
function ramp(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const stringer = mat(shade(colour, 0.75), 0.8);
  const slat = 0.04;
  for (const s of [-1, 1]) box(g, 0.08, h - slat, d, s * (w / 2 - 0.04), -slat / 2, 0, stringer);
  box(g, w - 0.16, 0.02, d, 0, -h / 2 + 0.01, 0, stringer);
  const n = Math.max(2, Math.round(d / 0.22));
  const pitch = d / n;
  const rng = hashRng(w * 13 + d, h * 7);
  for (let i = 0; i < n; i++) {
    const tone = mat(shade(colour, 0.92 + rng() * 0.16), 0.85);
    box(g, w, slat, pitch - 0.025, 0, h / 2 - slat / 2, -d / 2 + pitch * (i + 0.5), tone);
  }
}

/**
 * A planked wooden platform: boards along its length on top, horizontal boards round its
 * sides, and posts at the corners. It is solid right down, like the box it is drawn in.
 */
function platform(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const core = mat(shade(colour, 0.55), 0.9);
  const post = mat(shade(colour, 0.8), 0.8);
  // The core comes right out to the back of the cladding, so the gaps between boards show
  // it, not the sky through to the far side.
  const inset = 0.02;
  box(g, w - 2 * inset, h - 0.04, d - 2 * inset, 0, -0.02, 0, core);
  const rng = hashRng(w * 31 + h, d * 11);
  // Boards on top, along its length.
  const boards = Math.max(2, Math.round(w / 0.16));
  const pitch = w / boards;
  for (let i = 0; i < boards; i++) {
    const tone = mat(shade(colour, 0.92 + rng() * 0.16), 0.85);
    box(g, pitch - 0.012, 0.04, d, -w / 2 + pitch * (i + 0.5), h / 2 - 0.02, 0, tone);
  }
  // Cladding round the sides, a board above another, under the top's overhang.
  const rows = Math.max(1, Math.round((h - 0.04) / 0.16));
  const rise = (h - 0.04) / rows;
  for (let r = 0; r < rows; r++) {
    const y = -h / 2 + rise * (r + 0.5);
    const tone = mat(shade(colour, 0.85 + rng() * 0.12), 0.85);
    for (const s of [-1, 1]) {
      // A hair in from the corner posts' faces, which would otherwise share their plane.
      // Their ends stop inside the corner posts.
      box(g, w - 0.1, rise - 0.012, 0.02, 0, y, s * (d / 2 - inset / 2 - 0.003), tone);
      box(g, 0.02, rise - 0.012, d - 0.1, s * (w / 2 - inset / 2 - 0.003), y, 0, tone);
    }
  }
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      // Their tops a little under the core's, under the boards.
      box(g, 0.07, h - 0.045, 0.07, sx * (w / 2 - 0.035), -0.0225, sz * (d / 2 - 0.035), post);
}

/** A railing round the stairwell: a top rail, a bottom rail and balusters between. */
function rail(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const wood = mat(colour, 0.6);
  const light = mat(0xf4f1ea, 0.7);
  const long = Math.max(w, d);
  const alongX = w >= d;
  const bar = (length: number, y: number, thick: number) =>
    box(g, alongX ? length : thick, thick, alongX ? thick : length, 0, y, 0, wood);
  bar(long, h / 2 - 0.03, Math.min(w, d));
  // The bottom rail down on the floor or deck it stands on (a hair above, out of its plane).
  bar(long, -h / 2 + 0.025, 0.04);
  const n = Math.max(2, Math.round(long / 0.13));
  for (let i = 0; i <= n; i++) {
    const at = -long / 2 + 0.02 + ((long - 0.04) * i) / n;
    // Thinner than the rails and with their ends in them, so no face of one lies in a face
    // of the other.
    box(
      g,
      0.024,
      h - 0.06,
      0.024,
      alongX ? at : 0,
      -0.01,
      alongX ? 0 : at,
      i === 0 || i === n ? wood : light,
    );
  }
}

/**
 * The handrail up the open side of a flight of stairs, with a post at its foot and a baluster
 * on every step. Drawn only: the sim slides anyone on the steps back in from the edge (see
 * `Sim`), rather than have them collide with it, which trips up the physics on the steps.
 */
export function makeHandrail(s: StairsDef): THREE.Object3D {
  const g = new THREE.Group();
  g.position.set(s.pos.x, s.pos.y, s.pos.z);
  g.rotation.y = s.facing;
  const { width, steps, rise, tread } = STAIRS;
  const wood = mat(0x6b4a2f, 0.6);
  const light = mat(0xf4f1ea, 0.7);
  // Local -z climbs the flight, +x is the climber's right: the rail runs on the open side.
  const x = -s.wall * (width / 2 - 0.05);
  const above = 0.9;
  const a0 = tread / 2;
  const a1 = steps * tread;
  const y0 = above + rise;
  const y1 = UPPER_FLOOR + STAIRS.railHeight - 0.03;
  const length = Math.hypot(a1 - a0, y1 - y0);
  const handrail = add(
    g,
    new THREE.BoxGeometry(0.06, 0.06, length),
    wood,
    x,
    (y0 + y1) / 2,
    -(a0 + a1) / 2,
  );
  handrail.rotation.x = Math.atan2(y1 - y0, a1 - a0);
  // The newel post at the foot, standing on the first tread, a little taller than the rail.
  box(g, 0.09, y0 + 0.12 - rise, 0.09, x, (y0 + 0.12 + rise) / 2, -a0, wood);
  for (let i = 1; i < steps; i++) {
    const a = i * tread + tread / 2;
    const foot = (i + 1) * rise;
    const top = y0 + (a - a0) * ((y1 - y0) / (a1 - a0));
    box(g, 0.03, top - foot, 0.03, x, (foot + top) / 2, -a, light);
  }
  return g;
}

/** The colour plain fences are given (see `fences`): a box of it, low and thin, is a fence. */
const FENCE_COLOUR = 0xd8cfc0;

/** Whether a plain level box is a garden fence or a low wall like one, to draw as boards. */
export function isFence(b: BoxDef): boolean {
  if (b.model || b.tiltX || b.colour !== FENCE_COLOUR) return false;
  const thin = Math.min(b.size.x, b.size.z);
  const long = Math.max(b.size.x, b.size.z);
  return thin <= 0.35 && long >= 1 && b.size.y <= 2.1 && Math.abs(b.pos.y - b.size.y / 2) < 0.01;
}

/**
 * A close-boarded garden fence filling a fence box: posts every two metres or so, two rails
 * between them, upright boards edge to edge on the rails, and a capping rail along the top. It
 * stays inside its box, which is what players bump into.
 */
export function makeFence(b: BoxDef): THREE.Object3D {
  const g = new THREE.Group();
  g.position.set(b.pos.x, b.pos.y, b.pos.z);
  const alongX = b.size.x >= b.size.z;
  if (!alongX) g.rotation.y = Math.PI / 2;
  const L = alongX ? b.size.x : b.size.z;
  const T = alongX ? b.size.z : b.size.x;
  const H = b.size.y;
  const colour = b.colour;
  const post = mat(shade(colour, 0.78), 0.85);
  const rail = mat(shade(colour, 0.86), 0.85);
  const rng = hashRng(b.pos.x * 3 + L, b.pos.z * 5 + H);
  const cap = 0.04;
  // The posts, each end and every couple of metres between.
  const bays = Math.max(1, Math.round(L / 2));
  const postW = Math.min(0.12, T * 0.6);
  for (let i = 0; i <= bays; i++) {
    const x = Math.min(L / 2 - postW / 2, Math.max(-L / 2 + postW / 2, -L / 2 + (i * L) / bays));
    box(g, postW, H - cap, postW, x, -cap / 2, 0, post);
  }
  // Two rails behind the boards, and the boards on their front, standing on a gravel board
  // along the bottom. A darker backing behind them shows in the joints, so the fence reads as
  // solid, as it is to anyone walking into it.
  const board = 0.02;
  const railD = Math.max(0.03, Math.min(0.06, T / 2 - postW / 2));
  for (const y of [-H / 2 + 0.3, H / 2 - cap - 0.3])
    box(g, L - 0.02, 0.09, railD, 0, y, railD / 2 + board / 2, rail);
  const gravel = 0.15;
  box(g, L - 0.02, gravel, board + 0.01, 0, -H / 2 + gravel / 2, 0, post);
  const boardsH = H - cap - gravel;
  box(g, L - 0.02, boardsH, 0.004, 0, -H / 2 + gravel + boardsH / 2, board / 2 + 0.002, rail);
  const width = 0.14;
  const n = Math.max(1, Math.round(L / width));
  const pitch = L / n;
  for (let i = 0; i < n; i++) {
    const tone = mat(shade(colour, 0.94 + rng() * 0.1), 0.9);
    const tall = boardsH - rng() * 0.02;
    const x = -L / 2 + pitch * (i + 0.5);
    box(g, pitch - 0.008, tall, board, x, -H / 2 + gravel + tall / 2, -0.002, tone);
  }
  // The capping rail along the top.
  box(g, L, cap, Math.min(T, 0.16), 0, H / 2 - cap / 2, 0, post);
  return g;
}

// ---------------------------------------------------------------- the camp's models

/** A side material and a lighter end-grain material for a sawn log. */
const grain = (colour: number) => mat(shade(colour, 1.9), 0.9);

/** A log along the box's x: bark round, sawn ends, resting on the box's bottom. */
function log(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const r = Math.min(h, d) / 2;
  const bark = mat(colour, 0.95);
  // On its side along x, resting on its lowest edge (a flat of the 14 sides, a little inside
  // its radius), not hovering over the ground.
  const geometry = new THREE.CylinderGeometry(r, r, w - 0.02, 14).rotateZ(Math.PI / 2);
  geometry.computeBoundingBox();
  const m = new THREE.Mesh(geometry, [bark, grain(colour), grain(colour)]);
  m.position.y = -h / 2 - geometry.boundingBox!.min.y;
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  // A couple of knots along it.
  for (const [x, a] of [
    [-w * 0.22, 0.9],
    [w * 0.3, 2.4],
  ] as const) {
    const knot = add(
      g,
      new THREE.SphereGeometry(r * 0.22, 8, 6),
      mat(shade(colour, 0.7), 0.95),
      x,
      -h / 2 + r + r * 0.92 * Math.sin(a),
      -r * 0.92 * Math.cos(a),
    );
    knot.scale.set(1.4, 1, 1);
  }
}

/** A stump standing on its end, with rings on the sawn top. */
function stump(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const r = Math.min(w, d) / 2;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.96, r, h, 16), [
    mat(colour, 0.95),
    grain(colour),
    mat(colour, 0.95),
  ]);
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  const ring = mat(shade(colour, 1.3), 0.9);
  for (const f of [0.3, 0.55, 0.78]) {
    const ringMesh = add(
      g,
      new THREE.RingGeometry(r * f - 0.006, r * f + 0.006, 24),
      ring,
      0,
      h / 2 + 0.001,
      0,
    );
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.castShadow = false;
  }
}

/** How far a pine's lowest boughs spread round its trunk, for its height. */
export const PINE_BOUGHS = 0.22;

/**
 * A pine: the box is the trunk, and five ragged tiers of boughs sit on it from `boughs` up (its
 * box's `boughs`, or a little under half way), spreading `PINE_BOUGHS` of its height round it
 * and so well outside the box. Nothing collides with them, which is how a tree's
 * foliage should be. The trunk rises into the lowest tier.
 */
function pine(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
  boughs = h * 0.42,
): void {
  const r = Math.min(w, d) / 2;
  const trunkTop = h * 0.66;
  const trunk = add(
    g,
    new THREE.CylinderGeometry(r * 0.6, r, trunkTop, 10),
    mat(colour, 0.95),
    0,
    -h / 2 + trunkTop / 2,
    0,
  );
  trunk.castShadow = trunk.receiveShadow = true;
  const green = new THREE.Color(0x3f6b3a).offsetHSL(seed() * 0.04 - 0.02, 0, seed() * 0.08 - 0.04);
  const needles = mat(green.getHex(), 0.95);
  // Each tier a shade lighter than the one under it, as the top gets more sun.
  const lighter = mat(green.clone().offsetHSL(0.01, 0.02, 0.035).getHex(), 0.95);
  const R = h * PINE_BOUGHS;
  // The tiers fill from the lowest boughs to a tenth over the trunk's top, closer together
  // over a long bare trunk, each narrower than the one under it.
  const span = h * 1.1 - boughs;
  const tiers = 5;
  const tier = span * 0.34;
  for (let i = 0; i < tiers; i++) {
    const f = i / (tiers - 1);
    const cone = add(
      g,
      bough(R * (1 - 0.74 * f), tier * (1 - 0.25 * f), seed),
      i < 2 ? needles : lighter,
      0,
      -h / 2 + boughs + f * (span - tier) + (tier * (1 - 0.25 * f)) / 2,
      0,
    );
    cone.rotation.y = seed() * Math.PI * 2;
    cone.castShadow = cone.receiveShadow = true;
  }
}

/**
 * One tier of a pine's boughs: a cone whose rim is ragged with branch tips, the hollows between
 * them tucked in and up, and hollowed underneath so the tier above does not show through as a flat lid.
 */
function bough(r: number, h: number, seed: () => number): THREE.BufferGeometry {
  const sides = 10;
  const geo = new THREE.ConeGeometry(r, h, sides, 1);
  const pos = geo.attributes.position!;
  const tips = Array.from({ length: sides + 1 }, (_, k) =>
    k % 2 === 0 ? 0.94 + seed() * 0.06 : 0.76 + seed() * 0.08,
  );
  tips[sides] = tips[0]!;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k);
    const y = pos.getY(k);
    const z = pos.getZ(k);
    const across = Math.hypot(x, z);
    if (y < -h / 2 + 1e-6 && across < 1e-6) {
      // The middle of the underside, pushed up into the cone.
      pos.setY(k, -h / 2 + h * 0.4);
      continue;
    }
    if (across < 1e-6) continue;
    const a = Math.atan2(z, x);
    const at = Math.round(((a < 0 ? a + Math.PI * 2 : a) / (Math.PI * 2)) * sides);
    const out = tips[at]!;
    if (y < -h / 2 + 1e-6) {
      // The rim: the tips reach out as far as the cone, the hollows between them tuck in and
      // up (never out past the tier or down under it, where a deck may be built round it).
      pos.setXYZ(k, x * out, y + (1 - out) * h * 0.5, z * out);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Where a deck is built round a pine's trunk (decking up off the ground with a hole round the
 * trunk), what fixes it to the tree, drawn in the pine's frame: a collar of blocking filling
 * the hole round the trunk, a beam bolted to each side of the trunk under it, running out
 * under the deck to its edges, and knee braces from the trunk lower down up under the beams.
 */
function treeDeckFixings(g: THREE.Object3D, b: BoxDef, level: LevelDef): void {
  const decks = level.boxes.filter((o) => {
    if (o.model !== 'deck' || o.pos.y < 1) return false;
    const dx = Math.max(0, Math.abs(o.pos.x - b.pos.x) - o.size.x / 2);
    const dz = Math.max(0, Math.abs(o.pos.z - b.pos.z) - o.size.z / 2);
    return Math.max(dx, dz) < 1;
  });
  if (!decks.length) return;
  const deck = decks[0]!;
  // How far the hole reaches from the trunk's middle, and the deck out to its edge.
  let hole = Infinity;
  let reach = 0;
  for (const o of decks) {
    const dx = Math.max(0, Math.abs(o.pos.x - b.pos.x) - o.size.x / 2);
    const dz = Math.max(0, Math.abs(o.pos.z - b.pos.z) - o.size.z / 2);
    hole = Math.min(hole, Math.max(dx, dz));
    reach = Math.max(reach, Math.abs(o.pos.x - b.pos.x) + o.size.x / 2);
  }
  const y0 = b.pos.y;
  const under = deck.pos.y - deck.size.y / 2;
  const wood = mat(shade(deck.colour, 0.85), 0.85);
  // The collar: solid round the trunk, which passes through it.
  box(g, 2 * hole, deck.size.y, 2 * hole, 0, deck.pos.y - y0, 0, wood);
  // The trunk's radius at a height, as `pine` tapers it.
  const r = Math.min(b.size.x, b.size.z) / 2;
  const foot = b.pos.y - b.size.y / 2;
  const trunkTop = b.size.y * 0.66;
  const rAt = (y: number) => r - (0.4 * r * (y - foot)) / trunkTop;
  const beamH = 0.16;
  const beamT = 0.08;
  const beamY = under - beamH / 2;
  const span = reach - 0.05;
  const bolt = metal(0x6b6f73);
  for (const side of [-1, 1]) {
    // Against the trunk's side, just touching it.
    const z = side * (rAt(beamY) + beamT / 2);
    box(g, 2 * span, beamH, beamT, 0, beamY - y0, z, wood);
    const head = add(
      g,
      new THREE.CylinderGeometry(0.025, 0.025, 0.02, 8),
      bolt,
      0,
      beamY - y0,
      z + side * (beamT / 2 + 0.01),
    );
    head.rotation.x = Math.PI / 2;
    // The knee braces, from the trunk a metre under the beam up to it towards each end.
    for (const dir of [-1, 1]) {
      const from = { x: 0, y: under - 1 };
      const to = { x: dir * (span - 0.2), y: beamY - beamH / 2 };
      const len = Math.hypot(to.x - from.x, to.y - from.y);
      const zb = side * (rAt(from.y) + 0.035);
      const brace = box(
        g,
        0.07,
        len,
        0.07,
        (from.x + to.x) / 2,
        (from.y + to.y) / 2 - y0,
        zb,
        wood,
      );
      brace.rotation.z = -Math.atan2(to.x - from.x, to.y - from.y);
    }
  }
}

/**
 * Decking: planks across the box's short side, on bearers running its long side. Where it
 * stands on posts (`posts`, where they are under it in its own frame), the bearers run over
 * them, with joists across over them too, so every post's top meets the frame.
 */
function deck(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  posts: { x: number; z: number }[] = [],
): void {
  const alongX = w >= d;
  const long = Math.max(w, d);
  const short = Math.min(w, d);
  const plankT = Math.min(0.04, h / 2);
  const plank = 0.14;
  const gap = 0.015;
  const n = Math.max(1, Math.floor((long + gap) / (plank + gap)));
  const pitch = long / n;
  const planks = mat(colour, 0.85);
  const dark = mat(shade(colour, 0.75), 0.85);
  for (let i = 0; i < n; i++) {
    const at = -long / 2 + pitch * (i + 0.5);
    const len = short - 0.01;
    // Every so often a plank a shade off, as weathered boards are.
    const material = i % 5 === 2 ? mat(shade(colour, 0.92), 0.85) : planks;
    box(
      g,
      alongX ? pitch - gap : len,
      plankT,
      alongX ? len : pitch - gap,
      alongX ? at : 0,
      h / 2 - plankT / 2,
      alongX ? 0 : at,
      material,
    );
  }
  // Bearers under the planks: over the posts, or else a little in from the edges.
  const bearerH = h - plankT;
  if (bearerH <= 0.005) return;
  const distinct = (xs: number[]) =>
    xs.sort((a, b) => a - b).filter((x, i, all) => i === 0 || x - all[i - 1]! > 0.05);
  const onShort = distinct(posts.map((p) => (alongX ? p.z : p.x)));
  const onLong = distinct(posts.map((p) => (alongX ? p.x : p.z)));
  const edges =
    short > 1.2
      ? [-(short / 2 - 0.12), 0, short / 2 - 0.12]
      : [-(short / 2 - 0.1), short / 2 - 0.1];
  // (One row of posts down its middle still wants bearers at the edges.)
  const across = onShort.length > 1 ? onShort : distinct([...edges, ...onShort]);
  for (const a of across)
    box(
      g,
      alongX ? long - 0.02 : 0.08,
      bearerH,
      alongX ? 0.08 : long - 0.02,
      alongX ? 0 : a,
      -h / 2 + bearerH / 2,
      alongX ? a : 0,
      dark,
    );
  // The joists across over the posts, between the bearers and a little shallower, so their
  // undersides are not the bearers'.
  const joistH = bearerH - 0.01;
  for (const a of onLong)
    box(
      g,
      alongX ? 0.08 : short - 0.02,
      joistH,
      alongX ? short - 0.02 : 0.08,
      alongX ? a : 0,
      h / 2 - plankT - joistH / 2,
      alongX ? 0 : a,
      dark,
    );
}

/** The posts a deck stands on: those whose tops meet its underside, in its own frame. */
function postsUnder(b: BoxDef, level: LevelDef): { x: number; z: number }[] {
  if (b.front || b.tiltX) return [];
  const bottom = b.pos.y - b.size.y / 2;
  return level.boxes
    .filter(
      (o) =>
        o.model === 'post' &&
        Math.abs(o.pos.y + o.size.y / 2 - bottom) < 0.01 &&
        Math.abs(o.pos.x - b.pos.x) < b.size.x / 2 &&
        Math.abs(o.pos.z - b.pos.z) < b.size.z / 2,
    )
    .map((o) => ({ x: o.pos.x - b.pos.x, z: o.pos.z - b.pos.z }));
}

/** A stone, a little irregular, fitted to the box. */
function rock(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
): void {
  // A lumpy, faceted stone: a round one pushed in and out in broad bumps, its bottom flattened
  // where it sits in the ground, turned about its upright only.
  const geo = new THREE.IcosahedronGeometry(0.5, 1);
  const waves = Array.from({ length: 5 }, () => ({
    k: new THREE.Vector3(seed() - 0.5, seed() - 0.5, seed() - 0.5)
      .normalize()
      .multiplyScalar(2.5 + seed() * 4),
    phase: seed() * Math.PI * 2,
    amp: 0.07 + seed() * 0.08,
  }));
  const pos = geo.attributes.position!;
  const v = new THREE.Vector3();
  for (let k = 0; k < pos.count; k++) {
    v.fromBufferAttribute(pos, k);
    let r = 1;
    for (const w of waves) r += w.amp * Math.sin(v.dot(w.k) + w.phase);
    v.multiplyScalar(r);
    v.y = Math.max(v.y, -0.22);
    pos.setXYZ(k, v.x, v.y, v.z);
  }
  geo.rotateY(seed() * Math.PI);
  // Moss and lichen on the parts facing up, weathered paler there, darker underneath.
  geo.computeVertexNormals();
  const normals = geo.attributes.normal!;
  const colours: number[] = [];
  // Weathered paler than the stone's own colour, which reads near black in the shade.
  const base = new THREE.Color(colour).lerp(new THREE.Color(0xb3ada3), 0.45);
  const moss = new THREE.Color(0x5d7a3a);
  const c = new THREE.Color();
  const mossy = 0.3 + seed() * 0.4;
  for (let k = 0; k < pos.count; k += 3) {
    // One colour a face, as the facets are flat-shaded.
    let up = 0;
    for (let n = 0; n < 3; n++) up += normals.getY(k + n) / 3;
    const y = (pos.getY(k) + pos.getY(k + 1) + pos.getY(k + 2)) / 3;
    const speckle = 0.9 + (Math.abs(Math.sin(k * 12.9898) * 43758.5453) % 0.2);
    c.copy(base).multiplyScalar(speckle * (0.95 + 0.35 * Math.max(0, up)));
    if (up > 0.55 && y > -0.1 && Math.abs(Math.sin(k * 78.233)) < mossy) c.lerp(moss, 0.45);
    for (let n = 0; n < 3; n++) colours.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  // Stretched to just fill the box, standing on the ground.
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const size = bb.getSize(new THREE.Vector3());
  geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  geo.scale((w * 0.98) / size.x, (h * 0.98) / size.y, (d * 0.98) / size.z);
  const m = new THREE.Mesh(
    geo,
    madeOf(
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }),
      Surface.Concrete,
    ),
  );
  m.position.y = -h / 2;
  m.castShadow = m.receiveShadow = true;
  g.add(m);
}

/**
 * A round post standing on its end. With a `slot` (a board sitting down in its top), its two
 * cheeks rise that `depth` on above its box either side of the board, as wide apart as the
 * board is thick and along it (`alongX`).
 */
function post(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  slot?: { depth: number; width: number; alongX: boolean },
): void {
  const r = Math.min(w, d) / 2;
  const wood = mat(colour, 0.9);
  const rc = r * 0.94;
  add(g, new THREE.CylinderGeometry(rc, r, h, 12), wood, 0, 0, 0);
  if (!slot || slot.width / 2 >= rc * 0.9) return;
  // Each cheek: the part of the post's round beyond the slot's side, stood up `depth` tall on
  // the post's top.
  const a = Math.asin(slot.width / 2 / rc);
  for (const side of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, rc, a, Math.PI - a, false);
    shape.closePath();
    const cheek = new THREE.ExtrudeGeometry(shape, {
      depth: slot.depth,
      bevelEnabled: false,
      curveSegments: 8,
    });
    // Drawn in x-y with the slot's side along x: stood up, and turned to its side.
    cheek.rotateX(-Math.PI / 2);
    const m = add(g, cheek, wood, 0, h / 2, 0);
    m.rotation.y = (slot.alongX ? 0 : Math.PI / 2) + (side > 0 ? Math.PI : 0);
    // (Beside the board, above the box the post collides as: the board's box is what stops you.)
    m.userData.besideBox = true;
  }
}

/**
 * The slot in a post's top for a board sitting on it across its middle, if one does: the
 * post's cheeks rise either side of the board, and the box it collides as stops under it.
 */
function postSlot(
  b: BoxDef,
  level: LevelDef,
): { depth: number; width: number; alongX: boolean } | undefined {
  const top = b.pos.y + b.size.y / 2;
  const r = Math.min(b.size.x, b.size.z) / 2;
  for (const o of level.boxes) {
    if (o === b || o.model || o.tiltX) continue;
    if (Math.abs(o.pos.y - o.size.y / 2 - top) > 0.01) continue;
    const alongX = o.size.x > o.size.z;
    const thin = alongX ? o.size.z : o.size.x;
    if (thin >= 2 * r * 0.8) continue;
    if (Math.abs(b.pos.x - o.pos.x) > o.size.x / 2 || Math.abs(b.pos.z - o.pos.z) > o.size.z / 2)
      continue;
    return { depth: Math.min(0.25, o.size.y * 0.6), width: thin + 0.004, alongX };
  }
  return undefined;
}

/** A picnic table: the top on A-frame legs with a bench fixed either side. */
function picnicTable(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const wood = mat(colour, 0.8);
  const dark = mat(shade(colour, 0.8), 0.85);
  const board = 0.04;
  const topD = Math.min(0.7, d * 0.45);
  const topY = h / 2 - board / 2;
  // The top: boards along it with a seam between.
  for (const z of [-topD / 4, topD / 4]) box(g, w, board, topD / 2 - 0.01, 0, topY, z, wood);
  // The benches, at seat height, out at the sides.
  const seatY = -h / 2 + 0.45 - board / 2;
  const seatD = Math.min(0.26, d * 0.16);
  for (const s of [-1, 1]) box(g, w - 0.1, board, seatD, 0, seatY, s * (d / 2 - seatD / 2), wood);
  // Two A-frames, each a pair of slanted legs with the bench rail across them.
  for (const x of [-(w / 2 - 0.3), w / 2 - 0.3]) {
    for (const s of [-1, 1]) {
      const top = { y: topY - board / 2, z: s * (topD / 2 - 0.06) };
      const foot = { y: -h / 2, z: s * (d / 2 - 0.08) };
      const len = Math.hypot(top.y - foot.y, top.z - foot.z);
      const leg = box(g, 0.06, len, 0.05, x, (top.y + foot.y) / 2, (top.z + foot.z) / 2, dark);
      // Turned about x so the leg's upper end points from its foot up to the top.
      leg.rotation.x = Math.atan2(top.z - foot.z, top.y - foot.y);
    }
    box(g, 0.06, 0.05, d - 0.16, x, seatY - board / 2 - 0.025, 0, dark);
    box(g, 0.06, 0.05, topD - 0.04, x, topY - board / 2 - 0.025, 0, dark);
  }
}

/** A canoe lying upturned: its hull along the box's long side, keel up, gunwale on the ground. */
function canoe(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const alongX = w >= d;
  const long = Math.max(w, d);
  const short = Math.min(w, d);
  const hull = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    mat(colour, 0.5),
  );
  // A hemisphere stretched to the hull's length, beam and depth, its flat side on the ground.
  hull.scale.set((alongX ? long : short) * 0.98, h * 1.96, (alongX ? short : long) * 0.98);
  hull.position.y = -h / 2;
  hull.castShadow = hull.receiveShadow = true;
  g.add(hull);
  const trim = mat(shade(colour, 0.55), 0.7);
  // The keel strip along the top, following the hull's curve down to the ground at both
  // ends (a straight bar's ends stood off the hull), and the gunwale where it meets the ground.
  const keel = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.014, 6, 40, Math.PI), trim);
  keel.scale.set(long * 0.98, h * 1.96, 1);
  keel.rotation.y = alongX ? 0 : Math.PI / 2;
  keel.position.y = -h / 2;
  keel.castShadow = keel.receiveShadow = true;
  g.add(keel);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.018, 6, 32), trim);
  rim.rotation.x = Math.PI / 2;
  rim.scale.set((alongX ? long : short) * 0.96, (alongX ? short : long) * 0.96, 1);
  rim.position.y = -h / 2 + 0.02;
  rim.castShadow = rim.receiveShadow = true;
  g.add(rim);
}

/** A wheel: a tyre round a lighter hub, its axle along the box's thinnest side. */
function wheel(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const axleX = w < d;
  const thick = Math.min(w, d);
  const r = Math.min(h, Math.max(w, d)) / 2;
  const tyre = add(
    g,
    new THREE.CylinderGeometry(r, r, thick - 0.02, 20),
    mat(colour, 0.9),
    0,
    0,
    0,
  );
  const hub = add(
    g,
    new THREE.CylinderGeometry(r * 0.55, r * 0.55, thick, 16),
    metal(0xb9bec4),
    0,
    0,
    0,
  );
  for (const m of [tyre, hub]) {
    m.rotation.z = axleX ? Math.PI / 2 : 0;
    m.rotation.x = axleX ? 0 : Math.PI / 2;
    m.castShadow = m.receiveShadow = true;
  }
}

const missing = new Set<string>();
/** Says once that a box names a model file the game does not have. */
function missingFile(name: string): void {
  if (missing.has(name)) return;
  missing.add(name);
  console.warn(`No prop file ${name}.glb in client/src/assets/props: drawing its box's own model.`);
}

/**
 * Builds the model for a level box tagged with one (or the model file it names, if the game has
 * it), or `null` for a plain box. What of it the view animates is put in `parts`.
 */
export function makeProp(b: BoxDef, level: LevelDef, parts: PropParts = {}): THREE.Object3D | null {
  if (!b.model) return null;
  if (b.model === 'ramp') return makeRamp(b);
  const g = new THREE.Group();
  const facing = FACING[b.front ?? '-z'];
  g.position.set(b.pos.x, b.pos.y, b.pos.z);
  g.rotation.y = facing;
  const sideways = b.front === '-x' || b.front === '+x';
  const w = sideways ? b.size.z : b.size.x;
  const d = sideways ? b.size.x : b.size.z;
  const h = b.size.y;
  if (b.asset) {
    const file = propFile(b.asset, -h / 2);
    if (file) {
      g.add(file);
      return g;
    }
    missingFile(b.asset);
  }
  // Hiding places on or in this box, in the model's frame.
  const toLocal = new THREE.Matrix4()
    .makeRotationY(facing)
    .setPosition(b.pos.x, b.pos.y, b.pos.z)
    .invert();
  const hideouts: LocalHideout[] = [];
  for (const def of level.hideouts) {
    const c = new THREE.Vector3(def.pos.x, def.pos.y, def.pos.z).applyMatrix4(toLocal);
    const turn = def.facing - facing;
    const across = Math.abs(Math.cos(turn)) > 0.5;
    const hx = (across ? def.size.x : def.size.z) / 2;
    const hz = (across ? def.size.z : def.size.x) / 2;
    const half = new THREE.Vector3(hx, def.size.y / 2, hz);
    const min = c.clone().sub(half);
    const max = c.clone().add(half);
    const near = new THREE.Vector3(w / 2 + 0.05, h / 2 + 0.15, d / 2 + 0.05);
    if (
      max.x > -near.x &&
      min.x < near.x &&
      max.y > -near.y &&
      min.y < near.y &&
      max.z > -near.z &&
      min.z < near.z
    ) {
      hideouts.push({ def, min, max });
    }
  }
  switch (b.model) {
    case 'table':
      table(g, w, h, d, b.colour);
      break;
    case 'counter':
      counter(
        g,
        w,
        h,
        d,
        b.colour,
        hideouts,
        // The treat jars standing on it, in its frame.
        [level.dog.treatJar, ...(level.dog.treatJars ?? [])]
          .map((j) => new THREE.Vector3(j.x, j.y, j.z).applyMatrix4(toLocal))
          .filter(
            (j) => Math.abs(j.x) < w / 2 && Math.abs(j.z) < d / 2 && Math.abs(j.y - h / 2) < 0.05,
          ),
      );
      break;
    case 'sofa':
      sofa(g, w, h, d, b.colour, hideouts);
      break;
    case 'sofaBack':
      sofaBack(g, w, h, d, b.colour);
      break;
    case 'bookshelf':
      bookshelf(g, w, h, d, b.colour, hashRng(b.pos.x, b.pos.z));
      break;
    case 'crate':
      crate(g, w, h, d, b.colour);
      break;
    case 'lampPost':
      gardenLamp(g, h);
      break;
    case 'bed':
      bed(g, w, h, d, b.colour, hideouts);
      break;
    case 'step':
      step(g, w, h, d, b.colour);
      break;
    case 'rail':
      rail(g, w, h, d, b.colour);
      break;
    case 'sign':
      sign(g, w, h, d, b.colour, b.label ?? '');
      break;
    case 'platform':
      platform(g, w, h, d, b.colour);
      break;
    case 'panel':
      // The conduit runs up to the ceiling, a storey's walls above the floor it is on.
      parts.led = panel(g, w, h, d, b.colour, floorLevel(b.pos.y) + 2.6 - b.pos.y);
      break;
    case 'pallet':
      pallet(g, w, h, d, b.colour, hashRng(b.pos.x, b.pos.y * 31 + b.pos.z));
      break;
    case 'rack':
      rack(g, w, h, d, b.colour, hashRng(b.pos.x, b.pos.z));
      break;
    case 'forklift':
      forklift(g, w, h, d, b.colour);
      break;
    case 'acUnit':
      acUnit(g, w, h, d, b.colour);
      break;
    case 'shutter':
      shutter(g, w, h, d, b.colour);
      break;
    case 'collider':
      // Drawn by the box it belongs to (a forklift's mast and forks).
      break;
    case 'log':
      log(g, w, h, d, b.colour);
      break;
    case 'stump':
      stump(g, w, h, d, b.colour);
      break;
    case 'pine':
      pine(g, w, h, d, b.colour, hashRng(b.pos.x, b.pos.z), b.boughs);
      treeDeckFixings(g, b, level);
      break;
    case 'deck':
      deck(g, w, h, d, b.colour, postsUnder(b, level));
      break;
    case 'rock':
      rock(g, w, h, d, b.colour, hashRng(b.pos.x, b.pos.z));
      break;
    case 'post':
      post(g, w, h, d, b.colour, postSlot(b, level));
      break;
    case 'picnicTable':
      picnicTable(g, w, h, d, b.colour);
      break;
    case 'canoe':
      canoe(g, w, h, d, b.colour);
      break;
    case 'wheel':
      wheel(g, w, h, d, b.colour);
      break;
    case 'locomotive':
      locomotive(g, w, h, d, b.colour);
      break;
    case 'axle':
      axleUnit(g, w, h, d, b.colour);
      break;
    case 'carriageRoof':
      carriageRoof(g, w, h, d, b.colour);
      break;
    case 'gangway':
      gangway(g, w, h, d);
      break;
    case 'livery':
      livery(g, w, h, d, b.colour);
      break;
    case 'wagon':
      wagon(g, w, h, d, b.colour);
      break;
    case 'ballast':
      ballast(g, w, h, d, b.colour);
      break;
    case 'trackRail':
      trackRail(g, w, h, d, b.colour);
      break;
    case 'waterTank':
      waterTank(g, w, h, d, b.colour);
      break;
    case 'tankSpout':
      tankSpout(g, w, h);
      break;
    case 'stove':
      stove(g, w, h, d, b.colour);
      break;
    case 'flue':
      flue(g, w, h, d, b.colour);
      break;
    case 'caravanRoof':
      caravanRoof(g, w, h, d, b.colour);
      break;
    case 'towHitch':
      towHitch(g, w, h, d, b.colour);
      break;
    case 'wheelieBin':
    case 'pedalBin':
    case 'basketBin':
    case 'litterBin':
    case 'drumBin':
      trashBinModel(g, b.model, w, h, d, b.colour);
      break;
  }
  madeOfBox(g, b);
  return g;
}

/**
 * A ramp: the slatted board tilted as its box is, and a pair of legs under its high end down to
 * the ground (it rests on the ground at its low end).
 */
function makeRamp(b: BoxDef): THREE.Object3D {
  const g = new THREE.Group();
  g.position.set(b.pos.x, b.pos.y, b.pos.z);
  const tilt = b.tiltX ?? 0;
  const board = new THREE.Group();
  board.rotation.x = tilt;
  ramp(board, b.size.x, b.size.y, b.size.z, b.colour);
  g.add(board);
  // Under the board, the point at `z` along it (in its own frame) is this high above the ground
  // and this far along the ground from its middle: tilting about x lifts -z.
  const under = (z: number) => (-b.size.y / 2) * Math.cos(tilt) - z * Math.sin(tilt) + b.pos.y;
  const along = (z: number) => (-b.size.y / 2) * Math.sin(tilt) + z * Math.cos(tilt);
  const leg = mat(shade(b.colour, 0.75), 0.8);
  for (const z of [-b.size.z * 0.4, b.size.z * 0.4]) {
    const top = under(z);
    if (top < 0.35) continue;
    for (const s of [-1, 1])
      box(g, 0.08, top, 0.08, s * (b.size.x / 2 - 0.04), top / 2 - b.pos.y, along(z), leg);
  }
  return g;
}
