import * as THREE from 'three';
import { BUTTON_SIZE, CATAPULT } from '@sar/shared';
import type { LevelDef, Vec3 } from '@sar/shared';
import { add, box, can, mat, metal } from './interiors.ts';

/**
 * How high the ground is at `x, z`: the top of any low decking laid there (a camp's veranda),
 * else 0. Markings on the floor go on top of it, not under it where they show through the gaps
 * between its boards.
 */
export function groundAt(level: LevelDef, x: number, z: number): number {
  let top = 0;
  for (const b of level.boxes) {
    const bottom = b.pos.y - b.size.y / 2;
    const up = b.pos.y + b.size.y / 2;
    if (b.tiltX || bottom > 0.01 || up > 0.3) continue;
    if (Math.abs(x - b.pos.x) <= b.size.x / 2 && Math.abs(z - b.pos.z) <= b.size.z / 2)
      top = Math.max(top, up);
  }
  return top;
}

/**
 * The two things players press at the job site: the Done button, a red mushroom button on a
 * post, and the meeting bell, a desk bell on a stand. Both fit inside the `BUTTON_SIZE` box
 * the simulation clicks on, so pressing any of it works.
 */

/** A sign texture with `text` as big as fits. */
function signTexture(text: string, colour: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = colour;
  g.beginPath();
  g.roundRect(4, 4, 248, 120, 18);
  g.fill();
  g.strokeStyle = '#ffffff';
  g.lineWidth = 6;
  g.beginPath();
  g.roundRect(14, 14, 228, 100, 12);
  g.stroke();
  g.fillStyle = '#ffffff';
  let size = 64;
  do {
    g.font = `bold ${size}px system-ui, sans-serif`;
    size -= 2;
  } while (g.measureText(text).width > 200 && size > 10);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A dark post with a base plate and the sign on both faces. `top` is its height. */
function post(g: THREE.Group, top: number, text: string, colour: string): void {
  const steel = mat(0x3a3f47, 0.6, 0.3);
  can(g, BUTTON_SIZE.x / 2 - 0.01, 0.04, 0, 0, 0, steel);
  box(g, 0.12, top - 0.04, 0.12, 0, 0.04 + (top - 0.04) / 2, 0, steel);
  const sign = new THREE.MeshStandardMaterial({ map: signTexture(text, colour), roughness: 0.5 });
  for (const side of [-1, 1]) {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17), sign);
    plate.position.set(0, top * 0.62, side * 0.065);
    if (side < 0) plate.rotation.y = Math.PI;
    g.add(plate);
  }
}

/** Closes a dome's open bottom, so it is not see-through from below. */
function closeUnderside(g: THREE.Group, r: number, y: number, material: THREE.Material): void {
  const disc = add(g, new THREE.CircleGeometry(r, 32), material, 0, y, 0);
  disc.rotation.x = Math.PI / 2;
}

/** The Done button: a big red mushroom on a yellow collar, on a post. */
export function makeDoneButton(at: Vec3): THREE.Group {
  const g = new THREE.Group();
  g.position.set(at.x, at.y, at.z);
  const top = BUTTON_SIZE.y - 0.17;
  post(g, top, 'DONE', '#c91a1a');
  // A yellow housing with the stem coming out of it.
  can(g, 0.1, 0.06, 0, top, 0, mat(0xf5c400, 0.45));
  can(g, 0.06, 0.04, 0, top + 0.06, 0, mat(0x9a1010, 0.4));
  // The cap: a round dome, a little wider than tall, with a rolled rim and a closed
  // underside.
  const red = mat(0xd61f1f, 0.25);
  const capY = top + 0.1;
  const r = 0.11;
  const cap = add(
    g,
    new THREE.SphereGeometry(r, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    red,
    0,
    capY,
    0,
  );
  cap.scale.y = 0.8;
  const rim = add(g, new THREE.TorusGeometry(r - 0.004, 0.01, 8, 32), red, 0, capY, 0);
  rim.rotation.x = Math.PI / 2;
  closeUnderside(g, r, capY, red);
  return g;
}

/** The meeting bell: a brass desk bell on a turned wooden base, on a little stand. */
/**
 * The catapult: a wooden frame to step onto, two uprights holding the axle, and the arm with
 * a bucket at the back and an iron counterweight at the front. `arm` pivots about the axle;
 * the view swings it when someone is thrown.
 */
export function makeCatapult(def: { pos: Vec3; facing: number }): {
  group: THREE.Group;
  arm: THREE.Group;
} {
  const g = new THREE.Group();
  g.position.set(def.pos.x, def.pos.y, def.pos.z);
  g.rotation.y = def.facing;
  const wood = mat(0x7a5230, 0.75);
  const dark = mat(0x4a3222, 0.8);
  const iron = metal(0x3a3d42);
  const { frame, axle, arm: A, bucket } = CATAPULT;
  // The frame: two long beams and three cross planks, hazard stripes on the front plank.
  for (const x of [-0.5, 0.5]) {
    box(g, 0.16, frame.size.y, frame.size.z, x, frame.size.y / 2, frame.centreZ, wood);
  }
  // Set into the beams a little below their tops, which they would otherwise share.
  for (const z of [-1.0, 0.6, 2.2])
    box(g, frame.size.x, 0.08, 0.3, 0, frame.size.y - 0.045, z, dark);
  box(
    g,
    frame.size.x,
    0.1,
    0.12,
    0,
    frame.size.y + 0.05,
    frame.centreZ - frame.size.z / 2 + 0.06,
    mat(0xf5c518, 0.6),
  );
  // The uprights and the axle.
  for (const x of [-0.5, 0.5])
    box(g, 0.14, axle.y - frame.size.y, 0.14, x, (axle.y + frame.size.y) / 2, axle.z, wood);
  const axleMesh = add(
    g,
    new THREE.CylinderGeometry(0.05, 0.05, frame.size.x + 0.1, 12),
    iron,
    0,
    axle.y,
    axle.z,
  );
  axleMesh.rotation.z = Math.PI / 2;
  // The arm, pivoting about the axle.
  const arm = new THREE.Group();
  arm.position.set(0, axle.y, axle.z);
  arm.rotation.x = A.rest;
  g.add(arm);
  box(arm, 0.14, 0.12, A.back + A.front, 0, 0, (A.back - A.front) / 2, wood);
  // The bucket at the back: a tub with a lighter inside.
  const tub = add(
    arm,
    new THREE.CylinderGeometry(bucket.radius, bucket.radius * 0.8, bucket.height, 16),
    dark,
    0,
    bucket.height / 2 - 0.02,
    A.back,
  );
  tub.castShadow = true;
  add(
    arm,
    new THREE.CylinderGeometry(bucket.radius * 0.9, bucket.radius * 0.7, bucket.height * 0.9, 16),
    mat(0xb08a5a, 0.9),
    0,
    bucket.height / 2,
    A.back,
  );
  // The counterweight hanging at the front.
  box(arm, 0.5, 0.5, 0.5, 0, -0.3, -A.front, iron);
  return { group: g, arm };
}

export function makeBell(at: Vec3): THREE.Group {
  const g = new THREE.Group();
  g.position.set(at.x, at.y, at.z);
  const top = BUTTON_SIZE.y - 0.22;
  post(g, top, 'MEETING', '#1e5bc6');
  // A small square shelf for the bell to sit on.
  box(g, BUTTON_SIZE.x - 0.04, 0.025, BUTTON_SIZE.z - 0.04, 0, top + 0.0125, 0, mat(0x5b3f28, 0.6));
  let y = top + 0.025;
  // The turned wooden base: a wide foot and a moulding.
  const wood = mat(0x6a3a1e, 0.35);
  add(g, new THREE.CylinderGeometry(0.135, 0.15, 0.03, 32), wood, 0, y + 0.015, 0);
  y += 0.03;
  add(g, new THREE.CylinderGeometry(0.12, 0.13, 0.012, 32), mat(0x4f2a14, 0.35), 0, y + 0.006, 0);
  y += 0.012;
  // The bright skirt of the bell under the dome, with a dark gap above it.
  const silver = metal(0xc8c2b0);
  add(g, new THREE.CylinderGeometry(0.1, 0.11, 0.025, 32), silver, 0, y + 0.0125, 0);
  y += 0.025;
  add(g, new THREE.CylinderGeometry(0.095, 0.095, 0.01, 32), mat(0x1c1a17, 0.6), 0, y + 0.005, 0);
  y += 0.008;
  // The dome, darkened brass.
  const brass = mat(0x9c8a5c, 0.25, 0.85);
  const dome = add(
    g,
    new THREE.SphereGeometry(0.105, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2),
    brass,
    0,
    y,
    0,
  );
  dome.scale.y = 0.72;
  closeUnderside(g, 0.105, y, brass);
  y += 0.105 * 0.72;
  // The plunger: a stem with collars and a flat round knob.
  can(g, 0.018, 0.012, 0, y - 0.004, 0, brass);
  can(g, 0.008, 0.035, 0, y, 0, metal(0xb9a46a));
  can(g, 0.013, 0.006, 0, y + 0.018, 0, brass);
  const knob = add(g, new THREE.SphereGeometry(0.026, 16, 8), metal(0xb9a46a), 0, y + 0.04, 0);
  knob.scale.y = 0.45;
  return g;
}
