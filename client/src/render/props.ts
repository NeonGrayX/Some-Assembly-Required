import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { BoxDef, HideoutDef, LevelDef } from '@sar/shared';
import { gardenLamp } from './garden.ts';
import { add, box, can, mat, metal } from './interiors.ts';

/**
 * Furniture drawn from plain level boxes: a box tagged with a `model` becomes a table with
 * legs, a counter with a worktop and sink, a sofa with arms and cushions, a filled bookshelf
 * or a slatted crate, fitted to whatever size the box has. It still collides as the box, so
 * the models never reach outside it by more than a soft cushion's sag.
 *
 * Models are built in a frame centred on the box with local -z its front, `w` wide (x),
 * `h` high and `d` deep (z).
 */

const FACING = { '-z': 0, '+z': Math.PI, '-x': Math.PI / 2, '+x': -Math.PI / 2 } as const;

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
): void {
  const worktop = 0.04;
  const kick = 0.1;
  const carcass = mat(colour, 0.6);
  // A recessed toe kick, the cupboards, and a worktop that overhangs the front a little.
  box(g, w, kick, d - 0.06, 0, -h / 2 + kick / 2, 0.03, mat(0x3d3a36, 0.8));
  box(g, w, h - kick - worktop, d, 0, -h / 2 + kick + (h - kick - worktop) / 2, 0, carcass);
  box(g, w + 0.02, worktop, d + 0.02, 0, h / 2 - worktop / 2, -0.01, mat(0x5f5a54, 0.35));
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
  // A sink and tap at the end with nothing set on it.
  if (w > 1.4) {
    const sx = -w / 2 + 0.45;
    const steel = metal(0xc4c9cd);
    box(g, 0.5, 0.004, 0.38, sx, h / 2 + 0.002, -0.01, steel);
    box(g, 0.44, 0.003, 0.32, sx, h / 2 + 0.0045, -0.01, metal(0x8d9398));
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
  soft(g, w - 0.02, h - feet, d, 0, -h / 2 + feet + (h - feet) / 2, 0, darker, 0.03);
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

/** Builds the model for a level box tagged with one, or `null` for a plain box. */
export function makeProp(b: BoxDef, level: LevelDef): THREE.Object3D | null {
  if (!b.model) return null;
  const g = new THREE.Group();
  const facing = FACING[b.front ?? '-z'];
  g.position.set(b.pos.x, b.pos.y, b.pos.z);
  g.rotation.y = facing;
  const sideways = b.front === '-x' || b.front === '+x';
  const w = sideways ? b.size.z : b.size.x;
  const d = sideways ? b.size.x : b.size.z;
  const h = b.size.y;
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
      counter(g, w, h, d, b.colour, hideouts);
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
  }
  return g;
}
