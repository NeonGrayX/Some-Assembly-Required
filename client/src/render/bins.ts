import * as THREE from 'three';
import type { TrashBinModel } from '@sar/shared';
import { add, box, mat, metal, sharpBox } from './interiors.ts';
import { bevelCylinder } from './shapes.ts';
import { streetBinModel } from './streetBins.ts';
import { barrelModel } from './pirate/harbour.ts';

/**
 * The rubbish bins bricks are thrown away in, one look per kind of place: a wheelie bin with
 * its lid flipped right back, a kitchen pedal bin, an office wire basket, a station's litter
 * bin and a campsite's painted oil drum. Each is open at the top, dark inside with a few
 * bricks already thrown in, so it reads as somewhere bricks go; but for the car scene's street
 * bin, whose face tips out to take what goes in (see `TippingBin`).
 *
 * Models are built in a frame centred on the box with local -z its front, `w` wide (x), `h`
 * high and `d` deep (z), and stay inside the box (it is what they collide as).
 */

/** The dark inside of a bin, seen over its rim. */
const INSIDE = 0x1c1c1e;
/** Bricks that went in before, in the bin's opening: their colours. */
const THROWN = [0xc0392b, 0x2e6fa8, 0xd9b44a, 0x3f8f4a, 0xeeeeee];

/** A bin's wall seen from inside it: drawn on the back of a ring that faces out. */
let insideWall: THREE.Material | null = null;

/** Same pseudo-random numbers on every client, from a position. */
function hashRng(seed: number): () => number {
  let s = Math.floor(Math.abs(seed * 7919 + 17)) % 2147483647 || 1;
  return () => (s = (s * 48271) % 2147483647) / 2147483647;
}

/** A few bricks lying on the dark floor `y` of an opening `rx` by `rz` centred on `cz`. */
function thrownIn(
  g: THREE.Object3D,
  y: number,
  rx: number,
  rz: number,
  seed: number,
  cz = 0,
  scale = 1,
): void {
  const rng = hashRng(seed);
  for (let i = 0; i < 3; i++) {
    const long = rng() < 0.5;
    const [sx, sz] = long ? [0.16 * scale, 0.08 * scale] : [0.08 * scale, 0.08 * scale];
    const sy = 0.05 * scale;
    const x = (rng() - 0.5) * Math.max(0, rx - sx - 0.02);
    const z = (rng() - 0.5) * Math.max(0, rz - sz - 0.02);
    // Each a little higher than the last, lying on the ones under it, never in one plane.
    // Square-edged, as bricks are.
    const lift = 0.004 * (i + 1);
    const b = sharpBox(
      g,
      sx,
      sy,
      sz,
      x,
      y + lift + sy / 2,
      cz + z,
      mat(THROWN[i % THROWN.length]!, 0.45),
    );
    b.rotation.y = rng() * Math.PI;
  }
}

/**
 * An upright drum from `y0` up `h`, `r0` round at its foot and `r1` at its top, open at the
 * top: its dark inside goes `depth` down to a dark floor (with no depth, its top is the floor).
 */
function openDrum(
  g: THREE.Object3D,
  r0: number,
  r1: number,
  y0: number,
  h: number,
  side: THREE.Material,
  depth = 0,
): THREE.Group {
  const out = new THREE.Group();
  g.add(out);
  const dark = mat(INSIDE, 0.95);
  const rAt = (y: number) => r0 + ((r1 - r0) * (y - y0)) / h;
  const floor = y0 + h - depth;
  // Solid up to the floor, whose top is dark.
  const solid = new THREE.Mesh(new THREE.CylinderGeometry(rAt(floor), r0, floor - y0, 24), [
    side,
    dark,
    side,
  ]);
  solid.position.y = (y0 + floor) / 2;
  out.add(solid);
  if (depth > 0) {
    // Above it, the wall: painted outside, dark inside.
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(r1, rAt(floor), depth, 24, 1, true),
      side,
    );
    const inside = new THREE.Mesh(
      new THREE.CylinderGeometry(r1 - 0.006, rAt(floor) - 0.006, depth, 24, 1, true),
      (insideWall ??= new THREE.MeshStandardMaterial({
        color: INSIDE,
        roughness: 0.95,
        side: THREE.BackSide,
      })),
    );
    for (const m of [wall, inside]) {
      m.position.y = floor + depth / 2;
      out.add(m);
    }
  }
  out.traverse((m) => {
    m.castShadow = m.receiveShadow = true;
  });
  return out;
}

/** A round rim or band, lying flat at height `y`. */
function ring(g: THREE.Object3D, r: number, tube: number, y: number, material: THREE.Material) {
  const m = add(g, new THREE.TorusGeometry(r, tube, 6, 28), material, 0, y, 0);
  m.rotation.x = Math.PI / 2;
  return m;
}

/**
 * A wheelie bin: its body tapering toward the ground, the dark opening at the top with its
 * rim, the handle along the top of the back that the lid is hinged on, the lid flipped right
 * over it to hang down behind, and two wheels under it.
 */
function wheelieBin(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const plastic = mat(colour, 0.6);
  const lid = 0.04;
  // The body takes all but the lid and the handle behind it.
  const bodyD = d - lid - 0.05;
  const back = -d / 2 + bodyD;
  const top = h / 2;
  const rimH = 0.16;
  const bodyH = h - rimH;
  // The body, a little narrower at its foot, with the inside dark under the rim.
  const geo = new THREE.BoxGeometry(w - 0.04, bodyH, bodyD - 0.02);
  const pos = geo.attributes.position!;
  for (let i = 0; i < pos.count; i++)
    if (pos.getY(i) < 0) {
      pos.setX(i, pos.getX(i) * 0.9);
      pos.setZ(i, pos.getZ(i) * 0.92);
    }
  geo.computeVertexNormals();
  const body = new THREE.Mesh(geo, [
    plastic,
    plastic,
    mat(INSIDE, 0.95),
    plastic,
    plastic,
    plastic,
  ]);
  body.position.set(0, -h / 2 + bodyH / 2, -d / 2 + bodyD / 2);
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  // The walls of the opening above it, going on up from the body, and the lip round its top.
  const rim = mat(colour, 0.5);
  const cz = -d / 2 + bodyD / 2;
  const [innerW, innerD] = [w - 0.04, bodyD - 0.02];
  const t = 0.035;
  const lipH = 0.03;
  const wallH = rimH - lipH;
  const wallY = top - lipH - wallH / 2;
  const lip = t + 0.02;
  // The walls square-edged, meeting as one moulding; the lip round their top rolled.
  for (const s of [-1, 1]) {
    sharpBox(g, innerW, wallH, t, 0, wallY, cz + s * (innerD / 2 - t / 2), plastic);
    sharpBox(g, t, wallH, innerD - 2 * t, s * (innerW / 2 - t / 2), wallY, cz, plastic);
    box(g, w, lipH, lip, 0, top - lipH / 2, cz + s * (bodyD / 2 - lip / 2), rim);
    box(g, lip, lipH, bodyD - 2 * lip, s * (w / 2 - lip / 2), top - lipH / 2, cz, rim);
  }
  thrownIn(g, -h / 2 + bodyH, w - 0.16, bodyD - 0.16, colour + h, -d / 2 + bodyD / 2);
  // The handle along the top of the back, on two lugs out of the body: the lid's hinge.
  const handleY = top - 0.045;
  const handleZ = back + 0.025;
  const bar = add(
    g,
    // Its ends inside the lugs.
    new THREE.CylinderGeometry(0.018, 0.018, w - 0.14, 8),
    mat(0x222222, 0.6),
    0,
    handleY,
    handleZ,
  );
  bar.rotation.z = Math.PI / 2;
  for (const s of [-1, 1]) box(g, 0.04, 0.05, 0.06, s * (w / 2 - 0.08), handleY, back + 0.015, rim);
  // The lid, flipped right over on its hinge: its back edge over the handle, close behind the
  // rim, and the rest of it hanging down outside the handle.
  const lidH = Math.min(bodyD, h * 0.55);
  const fold = 0.025;
  box(g, w - 0.02, fold, 0.075, 0, top - fold / 2, back + 0.0425, rim);
  box(g, w - 0.02, lidH - fold, 0.03, 0, top - fold - (lidH - fold) / 2, back + 0.065, rim);
  // Two wheels at the back, on an axle under the body.
  const wheelR = 0.1;
  const wheelZ = d / 2 - wheelR - 0.005;
  for (const s of [-1, 1]) {
    const wheel = add(
      g,
      bevelCylinder(wheelR, wheelR, 0.05, 16),
      mat(0x1a1a1a, 0.85),
      s * (w / 2 - 0.025),
      -h / 2 + wheelR,
      wheelZ,
    );
    wheel.rotation.z = Math.PI / 2;
  }
  const axle = add(
    g,
    new THREE.CylinderGeometry(0.012, 0.012, w - 0.06, 6),
    metal(0x8a8f94),
    0,
    -h / 2 + wheelR,
    wheelZ,
  );
  axle.rotation.z = Math.PI / 2;
}

/** A kitchen pedal bin: a steel drum with a rolled rim, a dark opening and a pedal at its foot. */
function pedalBin(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const r = Math.min(w, d) / 2;
  const steel = mat(colour, 0.35, 0.2);
  const pedalD = 0.05;
  const body = r - pedalD / 2;
  openDrum(g, body * 0.96, body, -h / 2, h - 0.02, steel, 0.12).position.z = pedalD / 2;
  const rim = add(
    g,
    new THREE.TorusGeometry(body - 0.012, 0.012, 6, 28),
    steel,
    0,
    h / 2 - 0.014,
    pedalD / 2,
  );
  rim.rotation.x = Math.PI / 2;
  thrownIn(g, h / 2 - 0.14, body * 1.0, body * 1.0, colour + h, pedalD / 2);
  // The pedal, out in front at the foot.
  box(
    g,
    body * 0.8,
    0.025,
    pedalD + 0.02,
    0,
    -h / 2 + 0.05,
    -r + pedalD / 2 + 0.01,
    mat(0x2b2b2b, 0.5),
  );
  // A dark plastic foot ring.
  ring(g, body * 0.96 - 0.012, 0.012, -h / 2 + 0.013, mat(0x2b2b2b, 0.7)).position.z = pedalD / 2;
}

/** An office wire basket: upright wires round a solid base, a ring at the top and one lower. */
function basketBin(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const r = Math.min(w, d) / 2 - 0.01;
  const wire = metal(colour);
  // The base, and the dark inside seen through the wires.
  add(g, new THREE.CylinderGeometry(r * 0.86, r * 0.86, 0.02, 20), wire, 0, -h / 2 + 0.01, 0);
  openDrum(g, r * 0.8, r * 0.82, -h / 2 + 0.02, h * 0.12, mat(INSIDE, 0.95));
  thrownIn(g, -h / 2 + 0.02 + h * 0.12, r * 1.1, r * 1.1, colour + h, 0, 0.6);
  // Upright wires, leaning out a little toward the top.
  const n = 18;
  const len = h - 0.02;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const mid = r * 0.93;
    const bar = add(
      g,
      new THREE.CylinderGeometry(0.004, 0.004, len, 4),
      wire,
      Math.cos(a) * mid,
      0.01,
      Math.sin(a) * mid,
    );
    // Lean out from the foot (r * 0.86) to the top (r).
    bar.rotation.set(Math.sin(a) * 0.09, 0, -Math.cos(a) * 0.09);
  }
  ring(g, r - 0.008, 0.008, h / 2 - 0.008, wire);
  ring(g, r * 0.9, 0.005, -h / 2 + h * 0.3, wire);
}

/**
 * A station litter bin: a round body on a plinth, in the railway's colour, with a cream band
 * near the top, a dark opening and a rolled rim.
 */
function litterBin(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const r = Math.min(w, d) / 2;
  const paint = mat(colour, 0.5, 0.2);
  // The plinth.
  add(
    g,
    new THREE.CylinderGeometry(r * 0.75, r * 0.82, 0.08, 20),
    mat(0x2b2b2b, 0.7),
    0,
    -h / 2 + 0.04,
    0,
  );
  openDrum(g, r * 0.9, r * 0.94, -h / 2 + 0.08, h - 0.08 - 0.02, paint, 0.15);
  ring(g, r * 0.94 - 0.02, 0.02, h / 2 - 0.02, paint);
  // A cream band round it near the top, where a station's bins carry their crest (below the
  // floor of the opening, so it never shows inside).
  ring(g, r * 0.94, 0.012, h / 2 - 0.24, mat(0xe8dcb5, 0.5)).scale.z = 3;
  thrownIn(g, h / 2 - 0.17, r * 1.1, r * 1.1, colour + h);
}

/** A painted oil drum: the rolling hoops round its middle, the rolled rim at the top. */
function drumBin(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const r = Math.min(w, d) / 2 - 0.015;
  const paint = mat(colour, 0.55, 0.3);
  openDrum(g, r, r, -h / 2, h - 0.01, paint, 0.15);
  const hoop = mat(new THREE.Color(colour).multiplyScalar(0.8).getHex(), 0.5, 0.3);
  for (const y of [-h / 6, h / 6]) ring(g, r, 0.012, y, hoop);
  ring(g, r - 0.004, 0.012, h / 2 - 0.012, hoop);
  ring(g, r - 0.004, 0.012, -h / 2 + 0.012, hoop);
  thrownIn(g, h / 2 - 0.16, r * 1.1, r * 1.1, colour + h);
}

/**
 * An island's open barrel: staves and iron hoops as the island's barrels have, with no head, so
 * the bricks in it lie on a dark floor a little way down.
 */
function barrelBin(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const open = 0.16;
  barrelModel(g, w, h, d, colour, hashRng(colour + h * 31), open);
  const r = Math.min(w, d) / 2 - 0.06;
  thrownIn(g, h / 2 - open, r * 1.1, r * 1.1, colour + h);
}

/** The street bin, as Chevron Street's scene draws its own (see `TippingBin`), its face shut. */
function streetBin(g: THREE.Object3D, _w: number, _h: number, _d: number, colour: number): void {
  streetBinModel(g, colour);
}

/** Draws a rubbish bin's model into `g` (see `makeProp`). */
export function trashBinModel(
  g: THREE.Object3D,
  model: TrashBinModel,
  w: number,
  h: number,
  d: number,
  colour: number,
): void {
  ({ wheelieBin, pedalBin, basketBin, litterBin, drumBin, barrelBin, streetBin })[model](
    g,
    w,
    h,
    d,
    colour,
  );
}
