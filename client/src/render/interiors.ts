import * as THREE from 'three';
import { DOOR_THICKNESS, DRAWER_TRAY, lidHeight } from '@sar/shared';
import type { HideoutDef } from '@sar/shared';

/**
 * What hiding places look like inside: hollow shells instead of solid boxes, with shelves and
 * the odd bit of clutter, so opening one shows a fridge, a locker or a drawer rather than a
 * door on a block. Only looks: the simulation still treats the shells as solid, and anything
 * hidden in one comes out in front when it is opened.
 *
 * Every builder works in the hiding place's own frame (centred on its `pos`, local -z its
 * front), like `hideoutPart` and `hideoutBody`.
 */

const materials = new Map<string, THREE.MeshStandardMaterial>();
/** Shared materials, so the scene merge sees few kinds of surface. */
export function mat(color: number, roughness = 0.7, metalness = 0, emissive = 0): THREE.Material {
  const key = [color, roughness, metalness, emissive].join();
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive });
    materials.set(key, m);
  }
  return m;
}

const METAL = { roughness: 0.35, metalness: 0.6 };
export const metal = (color: number) => mat(color, METAL.roughness, METAL.metalness);

export function add(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** A box of size `sx × sy × sz` centred at `x, y, z`. */
export const box = (
  parent: THREE.Object3D,
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
) => add(parent, new THREE.BoxGeometry(sx, sy, sz), material, x, y, z);

/** An upright cylinder standing on `y` (its base), centred on `x, z`. */
export const can = (
  parent: THREE.Object3D,
  r: number,
  h: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
) => add(parent, new THREE.CylinderGeometry(r, r, h, 10), material, x, y + h / 2, z);

/** The space inside a shell, as min and max corners. */
interface Space {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

/**
 * A box with its front (-z) left open, from `front` back to the back of the hiding place:
 * what sits behind a door. Returns the space inside.
 */
function frontOpenShell(
  g: THREE.Object3D,
  def: HideoutDef,
  wall: number,
  outside: THREE.Material,
  inside: THREE.Material,
): Space {
  const { x: w, y: h, z: d } = def.size;
  const front = -d / 2 + DOOR_THICKNESS;
  const depth = d / 2 - front;
  const mid = (front + d / 2) / 2;
  box(g, w, h, wall, 0, 0, d / 2 - wall / 2, outside);
  for (const s of [-1, 1]) {
    box(g, wall, h, depth, s * (w / 2 - wall / 2), 0, mid, outside);
    box(g, w - 2 * wall, wall, depth, 0, s * (h / 2 - wall / 2), mid, outside);
  }
  // A lining a shade off the outside, so the inside reads as inside.
  const lining = 0.004;
  box(g, w - 2 * wall, h - 2 * wall, lining, 0, 0, d / 2 - wall - lining / 2, inside);
  return {
    min: new THREE.Vector3(-w / 2 + wall, -h / 2 + wall, front),
    max: new THREE.Vector3(w / 2 - wall, h / 2 - wall, d / 2 - wall - lining),
  };
}

/** A box with its top left open, up to where the lid starts: what sits under a lid. */
function topOpenShell(
  g: THREE.Object3D,
  def: HideoutDef,
  wall: number,
  outside: THREE.Material,
  inside: THREE.Material,
): Space {
  const { x: w, y: h, z: d } = def.size;
  const top = h / 2 - lidHeight(def);
  const height = top + h / 2;
  const mid = (top - h / 2) / 2;
  box(g, w, wall, d, 0, -h / 2 + wall / 2, 0, outside);
  for (const s of [-1, 1]) {
    box(g, w, height - wall, wall, 0, mid + wall / 2, s * (d / 2 - wall / 2), outside);
    box(g, wall, height - wall, d - 2 * wall, s * (w / 2 - wall / 2), mid + wall / 2, 0, outside);
  }
  box(g, w - 2 * wall, 0.004, d - 2 * wall, 0, -h / 2 + wall + 0.002, 0, inside);
  return {
    min: new THREE.Vector3(-w / 2 + wall, -h / 2 + wall + 0.004, -d / 2 + wall),
    max: new THREE.Vector3(w / 2 - wall, top, d / 2 - wall),
  };
}

// ------------------------------------------------------------------ behind doors

function fridge(g: THREE.Object3D, def: HideoutDef, colour: number): void {
  // A faint glow inside, as if the light came on.
  const s = frontOpenShell(g, def, 0.035, mat(colour, 0.4), mat(0xf4fbfd, 0.5, 0, 0x2a3236));
  const glass = mat(0xd6eef3, 0.15, 0.1);
  // Shelves leave room at the front for the bins on the door.
  const shelfFront = s.min.z + 0.09;
  const shelfDepth = s.max.z - shelfFront;
  const shelfZ = (shelfFront + s.max.z) / 2;
  const width = s.max.x - s.min.x;
  const shelves = [-0.42, 0.05, 0.47];
  for (const y of shelves) box(g, width, 0.012, shelfDepth, 0, y, shelfZ, glass);

  // Two crisper drawers under the lowest shelf.
  const crisperH = shelves[0]! - 0.01 - s.min.y;
  for (const side of [-1, 1]) {
    const x = side * (width / 4 + 0.005);
    box(g, width / 2 - 0.02, crisperH, shelfDepth - 0.02, x, s.min.y + crisperH / 2, shelfZ, glass);
    box(
      g,
      width / 2 - 0.02,
      0.03,
      0.01,
      x,
      s.min.y + crisperH - 0.05,
      shelfFront - 0.001,
      metal(0xb9c2c6),
    );
  }

  // Lowest shelf: milk and juice.
  const on = (y: number) => y + 0.006;
  box(g, 0.09, 0.22, 0.09, -0.24, on(shelves[0]!) + 0.11, shelfZ - 0.05, mat(0xfafafa, 0.6));
  box(g, 0.09, 0.02, 0.09, -0.24, on(shelves[0]!) + 0.23, shelfZ - 0.05, mat(0x2f6fd6, 0.5));
  box(g, 0.08, 0.2, 0.08, -0.12, on(shelves[0]!) + 0.1, shelfZ + 0.04, mat(0xf29a1f, 0.6));
  can(g, 0.11, 0.1, 0.17, on(shelves[0]!), shelfZ, mat(0xc94b3a, 0.5));

  // Middle shelf: eggs, cheese and jam.
  box(g, 0.3, 0.07, 0.12, -0.15, on(shelves[1]!) + 0.035, shelfZ - 0.06, mat(0xb9ab92, 0.95));
  box(g, 0.12, 0.06, 0.09, 0.14, on(shelves[1]!) + 0.03, shelfZ - 0.08, mat(0xf2cf45, 0.6));
  can(g, 0.045, 0.11, 0.2, on(shelves[1]!), shelfZ + 0.08, mat(0x9c1f3a, 0.3));
  can(g, 0.047, 0.015, 0.2, on(shelves[1]!) + 0.11, shelfZ + 0.08, metal(0xd8b23a));

  // Top shelf: leftovers and a cake.
  box(g, 0.22, 0.09, 0.16, 0.12, on(shelves[2]!) + 0.045, shelfZ, mat(0xe9eef0, 0.3));
  box(g, 0.22, 0.015, 0.16, 0.12, on(shelves[2]!) + 0.098, shelfZ, mat(0x4aa3d6, 0.5));
  can(g, 0.1, 0.09, -0.18, on(shelves[2]!), shelfZ - 0.02, mat(0x6b3a22, 0.7));
  can(g, 0.1, 0.02, -0.18, on(shelves[2]!) + 0.09, shelfZ - 0.02, mat(0xfff4e8, 0.8));

  // Up top, the freezer box.
  const freezer = s.max.y - 0.2;
  box(g, width, 0.012, shelfDepth, 0, freezer, shelfZ, mat(0xdde6ea, 0.5));
  box(g, width - 0.02, 0.18, 0.012, 0, freezer + 0.1, shelfFront + 0.006, mat(0xc7e4ee, 0.2));
}

/** Bins on the inside of a fridge door: bottles at the bottom, sauces above. */
function fridgeDoor(part: THREE.Object3D, def: HideoutDef): void {
  const w = def.size.x - 0.14;
  const inner = DOOR_THICKNESS / 2;
  const bins = [-0.5, -0.05, 0.38];
  const lip = mat(0xe3eef2, 0.2, 0.1);
  for (const y of bins) {
    box(part, w, 0.012, 0.06, 0, y, inner + 0.03, lip);
    box(part, w, 0.07, 0.008, 0, y + 0.035, inner + 0.06, lip);
  }
  const bottles = [0x2f7d3a, 0x6b3e1a, 0xeaf3f5];
  bottles.forEach((c, i) =>
    can(part, 0.035, 0.26, -0.22 + i * 0.1, bins[0]! + 0.006, inner + 0.03, mat(c, 0.2)),
  );
  const sauces = [0xc0281e, 0xe7c12e, 0xf3efe2];
  sauces.forEach((c, i) =>
    can(part, 0.028, 0.14, -0.2 + i * 0.09, bins[1]! + 0.006, inner + 0.03, mat(c, 0.4)),
  );
  box(part, 0.16, 0.06, 0.05, 0.12, bins[2]! + 0.036, inner + 0.03, mat(0xfff1a8, 0.6));
}

function locker(g: THREE.Object3D, def: HideoutDef, colour: number): void {
  const s = frontOpenShell(g, def, 0.025, metal(colour), metal(0x4b5866));
  const width = s.max.x - s.min.x;
  const depth = s.max.z - s.min.z;
  const midZ = (s.min.z + s.max.z) / 2;
  const shelf = s.max.y - 0.38;
  box(g, width, 0.02, depth, 0, shelf, midZ, metal(colour));
  // A hard hat and a lunch box on the shelf.
  const hat = add(
    g,
    new THREE.SphereGeometry(0.11, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    mat(0xf5c400, 0.4),
    -0.08,
    shelf + 0.01,
    midZ,
  );
  hat.scale.set(1, 0.9, 1.15);
  can(g, 0.14, 0.012, -0.08, shelf + 0.01, midZ, mat(0xf5c400, 0.4));
  box(g, 0.14, 0.1, 0.2, 0.15, shelf + 0.06, midZ + 0.05, mat(0x2b6cb0, 0.5));

  // A rail with a hi-vis vest on a hanger.
  const rail = shelf - 0.06;
  const bar = add(
    g,
    new THREE.CylinderGeometry(0.01, 0.01, width, 8),
    metal(0xb0b8bf),
    0,
    rail,
    midZ,
  );
  bar.rotation.z = Math.PI / 2;
  box(g, 0.3, 0.015, 0.015, 0, rail - 0.06, midZ, mat(0x8a6a44, 0.6));
  box(g, 0.015, 0.06, 0.015, 0, rail - 0.03, midZ, metal(0xb0b8bf));
  const vestTop = rail - 0.07;
  box(g, 0.38, 0.58, 0.07, 0, vestTop - 0.29, midZ, mat(0xff7a1a, 0.8));
  for (const y of [0.22, 0.4]) box(g, 0.385, 0.04, 0.075, 0, vestTop - y, midZ, mat(0xdfe4e8, 0.3));

  // Work boots on the floor.
  for (const x of [-0.07, 0.07]) {
    box(g, 0.1, 0.16, 0.12, x, s.min.y + 0.08, midZ + 0.06, mat(0x5a3a1e, 0.9));
    box(g, 0.1, 0.07, 0.14, x, s.min.y + 0.035, midZ - 0.06, mat(0x5a3a1e, 0.9));
  }
}

/** Air vents near the top of a locker door, on its outside. */
function lockerDoor(part: THREE.Object3D, def: HideoutDef): void {
  const top = def.size.y * 0.49;
  for (let i = 0; i < 5; i++) {
    box(
      part,
      def.size.x * 0.55,
      0.012,
      0.004,
      0,
      top - 0.12 - i * 0.035,
      -DOOR_THICKNESS / 2 - 0.002,
      mat(0x2a323b, 0.6),
    );
  }
}

function cabinet(g: THREE.Object3D, def: HideoutDef, colour: number): void {
  const s = frontOpenShell(g, def, 0.03, mat(colour), mat(0x553b25));
  const width = s.max.x - s.min.x;
  const depth = s.max.z - s.min.z;
  const midZ = (s.min.z + s.max.z) / 2;
  const shelf = (s.min.y + s.max.y) / 2;
  box(g, width, 0.02, depth, 0, shelf, midZ, mat(colour));

  // Board games stacked flat below.
  const games = [0x2f6fd6, 0xd64532, 0x3c9b55];
  games.forEach((c, i) =>
    box(g, 0.42, 0.06, 0.3, -0.27 + i * 0.01, s.min.y + 0.03 + i * 0.062, midZ, mat(c, 0.6)),
  );
  box(g, 0.32, 0.08, 0.26, 0.28, s.min.y + 0.04, midZ, mat(0x22252b, 0.5));

  // A row of books on the shelf, leaning at the end.
  const books = [0x8b2f2f, 0x2e4a7d, 0xd9b44a, 0x3b6e4a, 0x6a4c93, 0xc76a2c, 0x2b2b2b, 0x9c8c74];
  let x = s.min.x + 0.03;
  books.forEach((c, i) => {
    const t = 0.03 + (i % 3) * 0.008;
    const h = 0.2 + ((i * 37) % 5) * 0.012;
    box(g, t, h, 0.17, x + t / 2, shelf + 0.01 + h / 2, midZ + 0.03, mat(c, 0.8));
    x += t + 0.002;
  });
  const leaning = box(
    g,
    0.035,
    0.22,
    0.17,
    x + 0.06,
    shelf + 0.01 + 0.105,
    midZ + 0.03,
    mat(0x4f7fa0, 0.8),
  );
  leaning.rotation.z = -0.35;
  // And a stack of films.
  for (let i = 0; i < 4; i++) {
    box(
      g,
      0.14,
      0.015,
      0.19,
      0.35,
      shelf + 0.018 + i * 0.016,
      midZ,
      mat(i % 2 ? 0x1f1f24 : 0x333a44, 0.4),
    );
  }
}

// ------------------------------------------------------------------ under lids

function toolbox(g: THREE.Object3D, def: HideoutDef, colour: number): void {
  const s = topOpenShell(g, def, 0.012, metal(colour), metal(0x6e1e17));
  const floor = s.min.y;
  // Hammer: handle and head.
  box(g, 0.32, 0.025, 0.03, -0.05, floor + 0.0125, -0.06, mat(0x9a6b3a, 0.7));
  box(g, 0.03, 0.04, 0.12, 0.12, floor + 0.02, -0.06, metal(0x50565c));
  // Screwdriver.
  const shaft = add(
    g,
    new THREE.CylinderGeometry(0.004, 0.004, 0.14, 6),
    metal(0xc8ccd0),
    -0.12,
    floor + 0.012,
    0.06,
  );
  shaft.rotation.z = Math.PI / 2;
  const grip = add(
    g,
    new THREE.CylinderGeometry(0.014, 0.014, 0.1, 8),
    mat(0xf2c12e, 0.5),
    0.0,
    floor + 0.014,
    0.06,
  );
  grip.rotation.z = Math.PI / 2;
  // Tape measure and a wrench.
  box(g, 0.07, 0.07, 0.035, 0.22, floor + 0.035, 0.06, mat(0xf5c400, 0.5));
  box(g, 0.2, 0.008, 0.025, 0.08, floor + 0.03, 0.02, metal(0x9aa2a8));
}

function chest(g: THREE.Object3D, def: HideoutDef, colour: number): void {
  const s = topOpenShell(g, def, 0.03, mat(colour), mat(0x5e3c22, 0.9));
  const w = s.max.x - s.min.x;
  const d = s.max.z - s.min.z;
  // Folded blankets and a ball.
  box(g, w - 0.04, 0.09, d - 0.06, 0, s.min.y + 0.045, 0, mat(0x6c8bb0, 0.95));
  box(g, w * 0.55, 0.08, d - 0.1, -w * 0.18, s.min.y + 0.13, 0, mat(0xc9a25a, 0.95));
  add(g, new THREE.SphereGeometry(0.07, 12, 8), mat(0xd33f2f, 0.5), w * 0.25, s.min.y + 0.16, 0.04);
}

function mailbox(g: THREE.Object3D, def: HideoutDef, colour: number): void {
  const s = topOpenShell(g, def, 0.01, metal(colour), metal(0x4a4a4a));
  const paper = mat(0xf6f2e8, 0.9);
  for (let i = 0; i < 3; i++) {
    const letter = box(
      g,
      0.22,
      0.004,
      0.12,
      0.01 * i,
      s.min.y + 0.003 + i * 0.005,
      -0.05 + i * 0.04,
      paper,
    );
    letter.rotation.y = (i - 1) * 0.25;
  }
  box(g, 0.24, 0.008, 0.17, 0, s.min.y + 0.02, 0.1, mat(0x3a7fc0, 0.6));
}

// ------------------------------------------------------------------ drawers

/**
 * The tray of a drawer, behind its front: a floor and three low walls, with what a kitchen
 * drawer holds. Built in the drawer part's frame (front and tray together, see `hideoutPart`).
 */
function drawerTray(part: THREE.Object3D, def: HideoutDef): void {
  const { x: w, y: h, z: d } = def.size;
  const tw = w * 0.9;
  const th = h * 0.8;
  const t = 0.012;
  const back = d / 2 + DRAWER_TRAY / 2;
  const front = d / 2 - DRAWER_TRAY / 2;
  const mid = (front + back) / 2;
  const wood = mat(0xb8a689, 0.8);
  box(part, tw, t, DRAWER_TRAY, 0, -th / 2 + t / 2, mid, wood);
  box(part, tw, th, t, 0, 0, back - t / 2, wood);
  for (const s of [-1, 1]) box(part, t, th, DRAWER_TRAY, s * (tw / 2 - t / 2), 0, mid, wood);
  const floor = -th / 2 + t;
  const inner = tw / 2 - t;

  if (def.id % 3 === 2) {
    // Cutlery in an organiser.
    const slots = 4;
    const slot = (2 * inner) / slots;
    const organiser = mat(0xe8e4dc, 0.5);
    for (let i = 1; i < slots; i++)
      box(part, 0.006, 0.05, DRAWER_TRAY - 0.04, -inner + i * slot, floor + 0.025, mid, organiser);
    const steel = metal(0xcfd4d8);
    for (let i = 0; i < slots; i++) {
      for (let k = 0; k < 3; k++) {
        const x = -inner + (i + 0.5) * slot + (k - 1) * 0.025;
        box(part, 0.016, 0.006, 0.19 - (i % 2) * 0.02, x, floor + 0.004 + k * 0.004, mid, steel);
      }
    }
  } else if (def.id % 3 === 0) {
    // Cooking tools: a rolling pin, a wooden spoon and a spatula.
    const pin = add(
      part,
      new THREE.CylinderGeometry(0.025, 0.025, 0.3, 10),
      mat(0xd9b98c, 0.6),
      -0.22,
      floor + 0.025,
      mid,
    );
    pin.rotation.x = Math.PI / 2;
    box(part, 0.025, 0.012, 0.26, 0.02, floor + 0.006, mid + 0.02, mat(0x9a6b3a, 0.7));
    box(part, 0.06, 0.014, 0.07, 0.02, floor + 0.007, mid - 0.13, mat(0x9a6b3a, 0.7));
    box(part, 0.02, 0.01, 0.2, 0.2, floor + 0.005, mid + 0.04, mat(0x222222, 0.5));
    box(part, 0.08, 0.004, 0.09, 0.2, floor + 0.002, mid - 0.1, metal(0xcfd4d8));
  } else {
    // The junk drawer.
    const tape = add(
      part,
      new THREE.TorusGeometry(0.04, 0.018, 6, 14),
      mat(0xd9cfa8, 0.6),
      -0.2,
      floor + 0.018,
      mid - 0.05,
    );
    tape.rotation.x = Math.PI / 2;
    for (let i = 0; i < 4; i++) {
      const cell = add(
        part,
        new THREE.CylinderGeometry(0.007, 0.007, 0.05, 8),
        mat(i % 2 ? 0x222222 : 0xd9a32a, 0.4),
        -0.03 + i * 0.02,
        floor + 0.007,
        mid + 0.08,
      );
      cell.rotation.x = Math.PI / 2;
    }
    const pen = box(part, 0.008, 0.008, 0.14, 0.12, floor + 0.004, mid - 0.04, mat(0x2f6fd6, 0.4));
    pen.rotation.y = 0.5;
    box(part, 0.15, 0.003, 0.2, 0.22, floor + 0.0015, mid + 0.02, mat(0xf6f2e8, 0.9));
    box(part, 0.03, 0.015, 0.05, -0.05, floor + 0.0075, mid - 0.1, metal(0x9aa2a8));
  }
}

// ------------------------------------------------------------------ entry points

/**
 * Builds the still part of a hiding place, hollow and filled, in its own frame; `null` for
 * kinds without one (drawers, rugs, cushions).
 */
export function hideoutInterior(def: HideoutDef, colour: number): THREE.Group | null {
  const g = new THREE.Group();
  switch (def.kind) {
    case 'fridge':
      fridge(g, def, colour);
      break;
    case 'locker':
      locker(g, def, colour);
      break;
    case 'cabinet':
      cabinet(g, def, colour);
      break;
    case 'toolbox':
      toolbox(g, def, colour);
      break;
    case 'chest':
      chest(g, def, colour);
      break;
    case 'mailbox':
      mailbox(g, def, colour);
      break;
    default:
      return null;
  }
  return g;
}

/** Adds what moves with a door or drawer besides the panel itself, in the part's frame. */
export function hideoutPartDetails(part: THREE.Object3D, def: HideoutDef): void {
  if (def.kind === 'fridge') fridgeDoor(part, def);
  else if (def.kind === 'locker') lockerDoor(part, def);
  else if (def.kind === 'drawer') drawerTray(part, def);
}
