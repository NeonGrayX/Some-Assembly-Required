import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  DRAWER_BOX,
  DRAWER_TRAY,
  STAIRS,
  UPPER_FLOOR,
  floorLevel,
  groundHeight,
} from '@sar/shared';
import type { BoxDef, HideoutDef, LevelDef, StairsDef } from '@sar/shared';
import { rectMinusHoles } from './details.ts';
import { trashBinModel } from './bins.ts';
import { gardenLamp } from './garden.ts';
import { groundAt } from './stations.ts';
import { add, box, can, mat, metal, sharpBox } from './interiors.ts';
import { KEEP_SEPARATE } from './merge.ts';
import { Surface, madeOf, madeOfBox } from './styles.ts';
import { propFile } from './propFiles.ts';
import { bevelBox, bevelCylinder } from './shapes.ts';
import { caravanRoof, towHitch } from './caravan.ts';
import { boulderModel, logModel, palmModel, pineModel, rockModel, stumpModel } from './nature.ts';
import {
  anchorModel,
  barrelModel,
  cannonModel,
  flagpoleModel,
  gableRoofModel,
  hullModel,
  lanternPostModel,
  mastModel,
  pilingModel,
  ropeCoilModel,
  ropeFence,
  storeyModel,
} from './pirate.ts';
import type { HullFittings, LashedPost, RoofWalls, ShipLine, StoreyBelow } from './pirate.ts';
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
 * the solid front. Cut round openings, its pieces are square-edged, to meet as one block;
 * whole, its edges are rounded unless `square`.
 */
function blockWithDrawers(
  g: THREE.Object3D,
  w: number,
  y0: number,
  y1: number,
  d: number,
  material: THREE.Material,
  hideouts: LocalHideout[],
  square = false,
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
    (square ? sharpBox : box)(g, w, y1 - y0, d, 0, (y0 + y1) / 2, 0, material);
    return;
  }
  // Solid behind the deepest pocket; in front of that, the front cut round the openings.
  const deepest = Math.max(...pockets.map((p) => p.back));
  sharpBox(g, w, y1 - y0, d / 2 - deepest, 0, (y0 + y1) / 2, (deepest + d / 2) / 2, material);
  const slab = deepest - front;
  for (const r of rectMinusHoles({ u0: -w / 2, u1: w / 2, v0: y0, v1: y1 }, pockets))
    sharpBox(
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
    sharpBox(g, pw, ph, deepest - p.back + 0.004, x, y, (p.back - 0.004 + deepest) / 2, dark);
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
  // Square-edged, between the worktop and the kick, with the doors' lines down its front.
  blockWithDrawers(g, w, -h / 2 + kick, top, d, carcass, hideouts, true);
  const stone = mat(0x5f5a54, 0.35);
  const holes = sink ? [sink] : [];
  // Over the drawers, the cupboard round the basin; and the worktop, cut round the basin too,
  // its pieces square-edged where it is, to meet as one.
  if (sink)
    for (const r of rectMinusHoles({ u0: -w / 2, u1: w / 2, v0: -d / 2, v1: d / 2 }, holes))
      sharpBox(
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
    (sink ? sharpBox : box)(
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
  const top = add(g, bevelCylinder(roll, roll, w - 0.02, 14), fabric, 0, h / 2 - roll, 0);
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
            sharpBox(
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
      // Books square-edged: there are hundreds, and a bevel on them hardly shows.
      sharpBox(
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
  // The dark inside, seen between the slats: square, filling the frame out to its corners.
  sharpBox(g, w - 0.04, h - 0.04, d - 0.04, 0, 0, 0, mat(0x2a1d12, 0.95));
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
  // The block square-edged, so a flight's steps stand as one; the tread's nose rounded.
  sharpBox(g, w, h - tread, d, 0, -tread / 2, 0, mat(colour, 0.8));
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
  sharpBox(g, w - 2 * inset, h - 0.04, d - 2 * inset, 0, -0.02, 0, core);
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
    // of the other. Square-edged: on spindles this thin a bevel would hardly show, and there
    // are hundreds.
    sharpBox(
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
  const handrail = add(g, bevelBox(0.06, 0.06, length), wood, x, (y0 + y1) / 2, -(a0 + a1) / 2);
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

const fenceMaterials = new Map<number, THREE.Material>();
/** The boards of a fence of `colour`, painted on (see `Surface.Fence`). */
function fenceBoards(colour: number): THREE.Material {
  let m = fenceMaterials.get(colour);
  if (!m) {
    m = madeOf(new THREE.MeshStandardMaterial({ color: colour, roughness: 0.9 }), Surface.Fence);
    fenceMaterials.set(colour, m);
  }
  return m;
}

/** Whether a plain level box is a garden fence or a low wall like one, to draw as boards. */
export function isFence(b: BoxDef, level?: LevelDef): boolean {
  if (b.model || b.tiltX || b.colour !== FENCE_COLOUR) return false;
  const thin = Math.min(b.size.x, b.size.z);
  const long = Math.max(b.size.x, b.size.z);
  const ground = level ? groundHeight(level, b.pos.x, b.pos.z) : 0;
  return (
    thin <= 0.35 && long >= 1 && b.size.y <= 2.1 && Math.abs(b.pos.y - b.size.y / 2 - ground) < 0.01
  );
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
  const cap = 0.04;
  // The posts, each end and every couple of metres between.
  const bays = Math.max(1, Math.round(L / 2));
  const postW = Math.min(0.12, T * 0.6);
  for (let i = 0; i <= bays; i++) {
    const x = Math.min(L / 2 - postW / 2, Math.max(-L / 2 + postW / 2, -L / 2 + (i * L) / bays));
    box(g, postW, H - cap, postW, x, -cap / 2, 0, post);
  }
  // Two rails behind the boards, and the boards on their front, standing on a gravel board
  // along the bottom.
  const board = 0.02;
  const railD = Math.max(0.03, Math.min(0.06, T / 2 - postW / 2));
  for (const y of [-H / 2 + 0.3, H / 2 - cap - 0.3])
    box(g, L - 0.02, 0.09, railD, 0, y, railD / 2 + board / 2, rail);
  const gravel = 0.15;
  box(g, L - 0.02, gravel, board + 0.01, 0, -H / 2 + gravel / 2, 0, post);
  // The boards are one flat sheet, with each board and the joints between them painted on (see
  // `Surface.Fence`). Built as hundreds of boards with gaps of a few millimetres between them,
  // the gaps were narrower than a pixel a few metres off: the shading in corners, worked out
  // from the screen a pixel at a time, caught them in some pixels and missed them in the next,
  // and drew each joint as a broken, dashed dark line.
  const boardsH = H - cap - gravel;
  sharpBox(
    g,
    L - 0.02,
    boardsH,
    board,
    0,
    -H / 2 + gravel + boardsH / 2,
    -0.002,
    fenceBoards(colour),
  );
  // The capping rail along the top.
  box(g, L, cap, Math.min(T, 0.16), 0, H / 2 - cap / 2, 0, post);
  return g;
}

// ---------------------------------------------------------------- the camp's models

/** A log along the box's x: bark round, sawn ends, resting on the box's bottom. */
function log(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
): void {
  logModel(g, w, h, d, colour, seed);
}

/** A stump standing on its end, with rings on the sawn top. */
function stump(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
): void {
  stumpModel(g, w, h, d, colour, seed);
}

/** How far a pine's lowest boughs spread round its trunk, for its height. */
export { PINE_BOUGHS } from './nature.ts';

/**
 * A pine: the box is the trunk, and tiers of boughs sit on it from `boughs` up, spreading well
 * outside the box (see `pineModel`).
 */
function pine(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
  boughs?: number,
): void {
  pineModel(g, w, h, d, colour, seed, boughs);
}

/**
 * Where a deck is built round a pine's trunk (decking up off the ground with a hole round the
 * trunk), what fixes it to the tree, drawn in the pine's frame: a collar of blocking filling
 * the hole round the trunk, a beam bolted to each side of the trunk under it, running out
 * under the deck to its edges, and knee braces from the trunk lower down up under the beams.
 */
function treeDeckFixings(g: THREE.Object3D, b: BoxDef, level: LevelDef): void {
  const decks = level.boxes.filter((o) => {
    if (o.model !== 'deck' || o.pos.y - groundHeight(level, o.pos.x, o.pos.z) < 1) return false;
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

/** A stone, a little irregular, fitted to the box (see `rockModel`). */
function rock(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
): void {
  rockModel(g, w, h, d, colour, seed);
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
  const cheeks = !!slot && slot.width / 2 < rc * 0.9;
  // Its rims rounded, unless cheeks stand on its top, which must meet it flush.
  add(
    g,
    cheeks ? new THREE.CylinderGeometry(rc, r, h, 12) : bevelCylinder(rc, r, h),
    wood,
    0,
    0,
    0,
  );
  if (!slot || !cheeks) return;
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
  const tyre = add(g, bevelCylinder(r, r, thick - 0.02, 20), mat(colour, 0.9), 0, 0, 0);
  const hub = add(g, bevelCylinder(r * 0.55, r * 0.55, thick, 16), metal(0xb9bec4), 0, 0, 0);
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
  if (b.model === 'ramp') return makeRamp(b, level);
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
      gardenLamp(g, h, level.terrain?.length ? floorAround(b, level, facing) : undefined);
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
      log(g, w, h, d, b.colour, hashRng(b.pos.x, b.pos.y * 31 + b.pos.z));
      break;
    case 'stump':
      stump(g, w, h, d, b.colour, hashRng(b.pos.x, b.pos.z));
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
    case 'palm':
      palmModel(g, w, h, d, b.colour, hashRng(b.pos.x, b.pos.z));
      break;
    case 'boulder':
      boulderModel(
        g,
        w,
        h,
        d,
        b.colour,
        hashRng(b.pos.x, b.pos.z),
        level.sea === undefined ? null : level.sea - b.pos.y,
      );
      break;
    case 'barrel':
      barrelModel(g, w, h, d, b.colour, hashRng(b.pos.x, b.pos.y * 31 + b.pos.z));
      break;
    case 'cannon':
      cannonModel(g, w, h, d, b.colour);
      break;
    case 'ropeFence':
      ropeFence(g, w, h, d, b.colour, hashRng(b.pos.x, b.pos.z));
      break;
    case 'piling':
      pilingModel(
        g,
        w,
        h,
        d,
        b.colour,
        hashRng(b.pos.x, b.pos.z),
        level.sea === undefined ? null : level.sea - b.pos.y,
        lashedTo(b, level, toLocal),
      );
      break;
    case 'lanternPost':
      lanternPostModel(
        g,
        w,
        h,
        d,
        b.colour,
        hashRng(b.pos.x, b.pos.z),
        level.terrain?.length ? floorAround(b, level, facing) : undefined,
      );
      break;
    case 'ropeCoil':
      ropeCoilModel(
        g,
        w,
        h,
        d,
        b.colour,
        hashRng(b.pos.x, b.pos.y * 31 + b.pos.z),
        level.terrain?.length ? terrainAround(b, level, facing) : undefined,
      );
      break;
    case 'anchor':
      anchorModel(
        g,
        w,
        h,
        d,
        b.colour,
        hashRng(b.pos.x, b.pos.z),
        level.terrain?.length ? terrainAround(b, level, facing) : undefined,
      );
      break;
    case 'storey':
      storeyModel(g, w, h, d, b.colour, hashRng(b.pos.x, b.pos.z), storeyBelow(b, level, toLocal));
      break;
    case 'ropeRail':
      ropeFence(g, w, h, d, b.colour, hashRng(b.pos.x, b.pos.z), {
        rise: nextRail(b, level, toLocal),
      });
      break;
    case 'hull':
      hullModel(g, w, h, d, b.colour, hashRng(b.pos.x, b.pos.z), hullFittings(b, level, toLocal));
      break;
    case 'mast':
      mastModel(g, w, h, d, b.colour, hashRng(b.pos.x, b.pos.z), shipLine(b, level, toLocal));
      break;
    case 'flagpole':
      flagpoleModel(g, w, h, d, b.colour, hashRng(b.pos.x, b.pos.z));
      break;
    case 'gableRoof':
      gableRoofModel(g, w, h, d, b.colour, hashRng(b.pos.x, b.pos.z), roofWalls(b, level, toLocal));
      break;
    case 'wheelieBin':
    case 'pedalBin':
    case 'basketBin':
    case 'litterBin':
    case 'drumBin':
    case 'barrelBin':
      trashBinModel(g, b.model, w, h, d, b.colour);
      break;
    default: {
      // Every model has its case: a new one fails to compile here until it is drawn.
      const undrawn: never = b.model;
      void undrawn;
    }
  }
  madeOfBox(g, b);
  return g;
}

/**
 * The floor round a box (the ground, or decking laid on it) as a height in the frame of its
 * model, turned `facing`, from a point given in that frame.
 */
function floorAround(b: BoxDef, level: LevelDef, facing: number) {
  const [c, s] = [Math.cos(facing), Math.sin(facing)];
  return (x: number, z: number) =>
    groundAt(level, b.pos.x + x * c + z * s, b.pos.z - x * s + z * c) - b.pos.y;
}

/**
 * The ground's own height round a box (not decking, nor the box itself) in the frame of its
 * model, turned `facing`, from a point given in that frame.
 */
function terrainAround(b: BoxDef, level: LevelDef, facing: number) {
  const [c, s] = [Math.cos(facing), Math.sin(facing)];
  return (x: number, z: number) =>
    groundHeight(level, b.pos.x + x * c + z * s, b.pos.z - x * s + z * c) - b.pos.y;
}

/** Which way each side a box's front can face points, in the world. */
const FRONT_WAY = {
  '-z': new THREE.Vector3(0, 0, -1),
  '+z': new THREE.Vector3(0, 0, 1),
  '-x': new THREE.Vector3(-1, 0, 0),
  '+x': new THREE.Vector3(1, 0, 0),
} as const;

/** Where a box's top is. */
const topOf = (b: BoxDef) => b.pos.y + b.size.y / 2;

/** The boxes standing on `b`'s top (their feet within a few centimetres of it) over it. */
function standingOn(b: BoxDef, level: LevelDef): BoxDef[] {
  return level.boxes.filter(
    (o) =>
      o !== b &&
      Math.abs(o.pos.y - o.size.y / 2 - topOf(b)) < 0.05 &&
      Math.abs(o.pos.x - b.pos.x) < b.size.x / 2 + 0.05 &&
      Math.abs(o.pos.z - b.pos.z) < b.size.z / 2 + 0.05,
  );
}

/** A box's footprint in a model's frame (`toLocal`, see `makeProp`). */
function footprintIn(o: BoxDef, toLocal: THREE.Matrix4): RoofWalls {
  const a = new THREE.Vector3(o.pos.x - o.size.x / 2, 0, o.pos.z - o.size.z / 2);
  const c = new THREE.Vector3(o.pos.x + o.size.x / 2, 0, o.pos.z + o.size.z / 2);
  a.applyMatrix4(toLocal);
  c.applyMatrix4(toLocal);
  return {
    x0: Math.min(a.x, c.x),
    x1: Math.max(a.x, c.x),
    z0: Math.min(a.z, c.z),
    z1: Math.max(a.z, c.z),
  };
}

/** Which way a box's front points in a model's frame. */
const frontIn = (o: BoxDef, toLocal: THREE.Matrix4) =>
  FRONT_WAY[o.front ?? '-z'].clone().transformDirection(toLocal);

/**
 * How much higher the next length of a rope rail stands, the one going on from the end of this
 * one (+x or +z in its frame, where the ropes run to), or null if this is the last.
 */
function nextRail(b: BoxDef, level: LevelDef, toLocal: THREE.Matrix4): number | null {
  const sideways = b.front === '-x' || b.front === '+x';
  const L = Math.max(b.size.x, b.size.z);
  const alongX = (sideways ? b.size.z : b.size.x) >= (sideways ? b.size.x : b.size.z);
  for (const o of level.boxes) {
    if (o === b || o.model !== 'ropeRail') continue;
    const c = new THREE.Vector3(o.pos.x, o.pos.y, o.pos.z).applyMatrix4(toLocal);
    const [along, across] = alongX ? [c.x, c.z] : [c.z, c.x];
    const reach = (L + Math.max(o.size.x, o.size.z)) / 2;
    if (Math.abs(across) < 0.05 && Math.abs(along - reach) < 0.05) return c.y;
  }
  return null;
}

/** The mooring posts lashed to one (those standing right beside it), in its frame. */
function lashedTo(b: BoxDef, level: LevelDef, toLocal: THREE.Matrix4): LashedPost[] {
  return level.boxes
    .filter(
      (o) =>
        o !== b && o.model === 'piling' && Math.hypot(o.pos.x - b.pos.x, o.pos.z - b.pos.z) < 0.65,
    )
    .map((o) => {
      const c = new THREE.Vector3(o.pos.x, o.pos.y + o.size.y / 2, o.pos.z).applyMatrix4(toLocal);
      return { x: c.x, z: c.z, top: c.y, half: Math.min(o.size.x, o.size.z) / 2 };
    });
}

/**
 * What stands on a hull's deck that its bulwarks are drawn round, in its frame: the colliders
 * along its sides and across its ends (gaps in them stay open), the cannons looking out over a
 * side (each through a gun port, the bulwark cut down to its sill across the gap the cannon's
 * muzzle is in) and the masts.
 */
function hullFittings(b: BoxDef, level: LevelDef, toLocal: THREE.Matrix4): HullFittings {
  const fit: HullFittings = {
    sides: { [-1]: [], [1]: [] },
    stern: false,
    front: false,
    ports: [],
    masts: [],
  };
  const on = standingOn(b, level);
  for (const o of on) {
    if (o.model !== 'collider') continue;
    const r = footprintIn(o, toLocal);
    if (r.x1 - r.x0 < r.z1 - r.z0) {
      fit.sides[Math.sign(r.x0 + r.x1)]?.push([r.z0, r.z1]);
    } else if (r.z0 + r.z1 > 0) fit.stern = true;
    else fit.front = true;
  }
  const tallest = Math.max(0, ...on.filter((o) => o.model === 'mast').map((o) => o.size.y));
  for (const o of on) {
    if (o.model === 'mast') {
      const z = new THREE.Vector3(o.pos.x, o.pos.y, o.pos.z).applyMatrix4(toLocal).z;
      fit.masts.push({ z, main: o.size.y === tallest });
      continue;
    }
    if (o.model !== 'cannon') continue;
    const way = frontIn(o, toLocal);
    if (Math.abs(way.x) < 0.7) continue;
    const side = Math.sign(way.x);
    const z = new THREE.Vector3(o.pos.x, o.pos.y, o.pos.z).applyMatrix4(toLocal).z;
    // The gap in the bulwark either side of it, if there is one.
    const spans = fit.sides[side] ?? [];
    const before = Math.max(...spans.map(([, z1]) => z1).filter((z1) => z1 <= z));
    const after = Math.min(...spans.map(([z0]) => z0).filter((z0) => z0 >= z));
    fit.ports.push(
      after - before < 1.2
        ? { side, z: (before + after) / 2, width: after - before }
        : { side, z, width: 0.5 },
    );
  }
  return fit;
}

/**
 * The ship a mast stands on (see `ShipLine`): its hull's frame in the mast's, the hull's box and
 * what stands on it, where on it the mast stands, whether it is the tallest of its masts, and
 * the next one forward of it.
 */
function shipLine(b: BoxDef, level: LevelDef, toLocal: THREE.Matrix4): ShipLine | null {
  const foot = b.pos.y - b.size.y / 2;
  const hull = level.boxes.find(
    (o) =>
      o.model === 'hull' &&
      Math.abs(topOf(o) - foot) < 0.05 &&
      Math.abs(o.pos.x - b.pos.x) < o.size.x / 2 &&
      Math.abs(o.pos.z - b.pos.z) < o.size.z / 2,
  );
  if (!hull) return null;
  const hullToWorld = new THREE.Matrix4()
    .makeRotationY(FACING[hull.front ?? '-z'])
    .setPosition(hull.pos.x, hull.pos.y, hull.pos.z);
  const hullToLocal = hullToWorld.clone().invert();
  const sideways = hull.front === '-x' || hull.front === '+x';
  const fit = hullFittings(hull, level, hullToLocal);
  const at = new THREE.Vector3(b.pos.x, foot, b.pos.z).applyMatrix4(hullToLocal);
  const masts = standingOn(hull, level).filter((o) => o.model === 'mast' && o !== b);
  const top = Math.max(b.size.y, ...masts.map((o) => o.size.y));
  // The nearest mast forward of it, toward the bow (the hull's -z).
  let ahead: ShipLine['ahead'] = null;
  for (const o of masts) {
    const z = new THREE.Vector3(o.pos.x, o.pos.y, o.pos.z).applyMatrix4(hullToLocal).z;
    if (z < at.z - 0.1 && (!ahead || z > ahead.z))
      ahead = { z, h: o.size.y, main: o.size.y === top };
  }
  return {
    frame: toLocal.clone().multiply(hullToWorld),
    hull: {
      w: sideways ? hull.size.z : hull.size.x,
      h: hull.size.y,
      d: sideways ? hull.size.x : hull.size.z,
    },
    fit,
    foot: at,
    main: b.size.y === top,
    ahead,
  };
}

/**
 * The plain boxes whose tops are at `b`'s foot under it: the walls (and the headers over their
 * doorways) a roof or an upper storey stands on.
 */
function wallsUnder(b: BoxDef, level: LevelDef, storeys = false): BoxDef[] {
  const foot = b.pos.y - b.size.y / 2;
  return level.boxes.filter(
    (o) =>
      (!o.model || (storeys && o.model === 'storey')) &&
      Math.abs(topOf(o) - foot) < 0.05 &&
      Math.abs(o.pos.x - b.pos.x) < b.size.x / 2 &&
      Math.abs(o.pos.z - b.pos.z) < b.size.z / 2,
  );
}

/** The outer faces round boxes' footprints in a model's frame (`toLocal`). */
function outline(boxes: BoxDef[], toLocal: THREE.Matrix4): RoofWalls {
  const rs = boxes.map((o) => footprintIn(o, toLocal));
  return {
    x0: Math.min(...rs.map((r) => r.x0)),
    x1: Math.max(...rs.map((r) => r.x1)),
    z0: Math.min(...rs.map((r) => r.z0)),
    z1: Math.max(...rs.map((r) => r.z1)),
  };
}

/**
 * The walls a roof stands on in its frame (the outer faces of the plain boxes, or the upper
 * storey, whose tops are at its foot, under it), or null if it stands on none.
 */
function roofWalls(b: BoxDef, level: LevelDef, toLocal: THREE.Matrix4): RoofWalls | null {
  const walls = wallsUnder(b, level, true);
  return walls.length === 0 ? null : outline(walls, toLocal);
}

/** A box's bounds, in a model's frame (`toLocal`). */
function boundsIn(o: BoxDef, toLocal: THREE.Matrix4): THREE.Box3 {
  const half = new THREE.Vector3(o.size.x / 2, o.size.y / 2, o.size.z / 2);
  const c = new THREE.Vector3(o.pos.x, o.pos.y, o.pos.z);
  return new THREE.Box3(c.clone().sub(half), c.clone().add(half)).applyMatrix4(toLocal);
}

/**
 * What an upper storey stands on, in its frame: the walls under it, and where nothing may come
 * down them under its jetty: round their doorways (the headers over them, and the doors swung
 * open against the wall either side), round their windows, and wherever anything else stands
 * up against them there (a porch's roof, a lamp).
 */
function storeyBelow(b: BoxDef, level: LevelDef, toLocal: THREE.Matrix4): StoreyBelow | null {
  const under = wallsUnder(b, level);
  if (under.length === 0) return null;
  const floor = Math.min(...under.map((o) => o.pos.y - o.size.y / 2));
  const foot = b.pos.y - b.size.y / 2;
  const keepOut: THREE.Box3[] = [];
  for (const o of under) {
    if (o.pos.y - o.size.y / 2 < floor + 0.5) continue;
    // A header: the doorway under it, and the doors either side.
    const leaf = Math.min(o.size.x, o.size.z) < 0.5 ? Math.max(o.size.x, o.size.z) / 2 + 0.2 : 0.2;
    const r = boundsIn(o, toLocal);
    const alongX = Math.abs(r.max.x - r.min.x) >= Math.abs(r.max.z - r.min.z);
    keepOut.push(r.expandByVector(new THREE.Vector3(alongX ? leaf : 0.6, 0, alongX ? 0.6 : leaf)));
  }
  for (const win of level.windows ?? []) {
    if (Math.abs((win.y ?? 0) - floor) > 0.05) continue;
    const half = new THREE.Vector3(win.alongX ? 0.9 : 0.6, 0, win.alongX ? 0.6 : 0.9);
    const c = new THREE.Vector3(win.x, foot, win.z);
    keepOut.push(
      new THREE.Box3(c.clone().sub(half).setY(floor), c.clone().add(half)).applyMatrix4(toLocal),
    );
  }
  // Anything else up against the walls under the jetty.
  const reach = new THREE.Box3(
    new THREE.Vector3(b.pos.x - b.size.x / 2 - 0.1, foot - 1, b.pos.z - b.size.z / 2 - 0.1),
    new THREE.Vector3(b.pos.x + b.size.x / 2 + 0.1, foot - 0.01, b.pos.z + b.size.z / 2 + 0.1),
  );
  for (const o of level.boxes) {
    if (o === b || under.includes(o)) continue;
    const half = new THREE.Vector3(o.size.x / 2, o.size.y / 2, o.size.z / 2);
    const c = new THREE.Vector3(o.pos.x, o.pos.y, o.pos.z);
    const box = new THREE.Box3(c.clone().sub(half), c.clone().add(half));
    if (box.intersectsBox(reach)) keepOut.push(boundsIn(o, toLocal));
  }
  // Plank walls are framed in timber outside (see `addHouseDetails`).
  const framed = under.some((o) => !o.model && o.surface === 'planks');
  return { walls: outline(under, toLocal), keepOut, framed };
}

/**
 * A ramp: the slatted board tilted as its box is, and a pair of legs under its high end down to
 * the ground (it rests on the ground at its low end).
 */
function makeRamp(b: BoxDef, level: LevelDef): THREE.Object3D {
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
    for (const s of [-1, 1]) {
      const x = s * (b.size.x / 2 - 0.04);
      const foot = groundHeight(level, b.pos.x + x, b.pos.z + along(z));
      if (top - foot < 0.35) continue;
      box(g, 0.08, top - foot, 0.08, x, (top + foot) / 2 - b.pos.y, along(z), leg);
    }
  }
  return g;
}
