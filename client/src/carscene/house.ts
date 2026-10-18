import * as THREE from 'three';
import { CAR, makeWheel, shutLine, weather } from './car.ts';
import { tuft } from './ground.ts';
import {
  bentPath,
  cbox,
  flatSlab,
  glow,
  mat,
  put,
  putSlab,
  rbox,
  rng,
  roundedOutline,
  slab,
  tube,
} from './kit.ts';
import { SPORT } from './sportscar.ts';

/**
 * A small house, built as the cars are: walls of thick painted panels on a charcoal plinth,
 * their edges worn pale and their joins shut lines, charcoal posts at the corners, windows set
 * deep in charcoal frames with tinted glass, a red door under a canopy lit cyan, a ringed lamp
 * beside it, a dark ribbed metal roof whose ridge is capped, gutters and a downpipe, a chimney,
 * and on the roof one of the cars' armoured hover fans turned to a vent. A letterbox stands
 * out before the door, grass at the house's foot.
 *
 * Modelled facing +x (its door's gable), its long sides toward ±z, standing on the ground at
 * y = 0: about 3.6 m deep, 4.2 m wide and 4.4 m to the top of its fan.
 */

/** Its paint, its seams' dark groove and light lip in that paint. */
export const HOUSE = {
  wall: 0x7fb2c2,
  seam: 0x1e3038,
  lip: 0xc4e6ee,
  roof: 0x3d4347,
};

/** Its lines: half its depth along x and its width along z, its floor, eaves and ridge. */
export const HOUSE_BODY = {
  depth: 1.8,
  half: 2.1,
  plinth: 0.36,
  eave: 2.75,
  ridge: 3.95,
  /** How thick its walls are. */
  wall: 0.16,
};

const paint = () =>
  mat(HOUSE.wall, {
    mottle: 'paint',
    roughness: 0.48,
    metalness: 0.12,
    envMapIntensity: 1.3,
    clearcoat: 0.7,
    clearcoatRoughness: 0.25,
    vertexColors: true,
  });
/** Its worn edges: paler, toward white. */
const WORN: [number, number, number] = [1.18, 1.16, 1.12];
const seam = () => mat(HOUSE.seam, { mottle: 'none', roughness: 0.85 });
const lip = () => mat(HOUSE.lip, { mottle: 'none', roughness: 0.5 });
const trim = () => mat(CAR.trim, { mottle: 'plastic', roughness: 0.6 });
const plinthMat = () => mat(CAR.bumper, { mottle: 'plastic', roughness: 0.55 });
const dark = () => mat(0x15181a, { mottle: 'none', roughness: 0.95 });
const steel = () =>
  mat(0xc8ced2, { mottle: 'metal', roughness: 0.3, metalness: 0.75, envMapIntensity: 2.2 });
const roofMat = () =>
  mat(HOUSE.roof, {
    mottle: 'paint',
    roughness: 0.4,
    metalness: 0.35,
    envMapIntensity: 1.5,
    clearcoat: 0.6,
    clearcoatRoughness: 0.3,
  });
/** Tinted glass, dark as the cars'. */
const glass = () =>
  mat(0x231812, { mottle: 'none', roughness: 0.05, metalness: 0.2, envMapIntensity: 2.6 });

/** A painted panel: `shape` pushed out `depth`, its edges rounded `b` deep and worn pale. */
function panel(shape: THREE.Shape, depth: number, b: number): THREE.BufferGeometry {
  return weather(flatSlab(shape, depth, b), 'slab', false, WORN);
}

/** A rounded-off rectangle `w × h` round (`cx`, `cy`), as an outline or a hole. */
const rect = (cx: number, cy: number, w: number, h: number, r: number) =>
  roundedOutline(
    [
      [cx - w / 2, cy - h / 2],
      [cx + w / 2, cy - h / 2],
      [cx + w / 2, cy + h / 2],
      [cx - w / 2, cy + h / 2],
    ],
    r,
  );

/** A round hole of radius `r` at (`cx`, `cy`). */
const disc = (cx: number, cy: number, r: number) => {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, false);
  return p;
};

/** A window in a wall: where it is along the wall, its middle's height, and its size. */
interface Opening {
  at: number;
  y: number;
  w: number;
  h: number;
}

/** The faces of the walls, each its plane's middle and the way out of it. */
type Face = '+x' | '-x' | '+z' | '-z';

/** Where a point `at` along `face` (and `y` up it) is, in the wall's middle, and its turn. */
function onFace(face: Face, at: number, y: number): { p: THREE.Vector3; turn: number } {
  const { depth, half, wall } = HOUSE_BODY;
  switch (face) {
    case '+x':
      return { p: new THREE.Vector3(depth - wall / 2, y, at), turn: Math.PI / 2 };
    case '-x':
      return { p: new THREE.Vector3(-(depth - wall / 2), y, at), turn: -Math.PI / 2 };
    case '+z':
      return { p: new THREE.Vector3(at, y, half - wall / 2), turn: 0 };
    case '-z':
      return { p: new THREE.Vector3(at, y, -(half - wall / 2)), turn: Math.PI };
  }
}

/**
 * A window set into the wall on `face`: a deep charcoal frame lining the opening and lapping
 * over the wall round it, its glass sunk in the middle of the frame's depth, a bar across and one
 * down, and a steel sill under it.
 */
function windowIn(house: THREE.Group, face: Face, o: Opening): void {
  const { wall } = HOUSE_BODY;
  const g = new THREE.Group();
  const { p, turn } = onFace(face, o.at, o.y);
  g.position.copy(p);
  g.rotation.y = turn;
  house.add(g);
  // Each part laid out with the wall's face toward +z.
  const frame = rect(0, 0, o.w + 0.12, o.h + 0.12, 0.07);
  frame.holes.push(rect(0, 0, o.w - 0.06, o.h - 0.06, 0.04));
  putSlab(g, frame, wall + 0.06, trim(), 0.015);
  cbox(g, glass(), 0, 0, 0.01, o.w - 0.07, o.h - 0.07, 0.01, 0.004);
  cbox(g, trim(), 0, 0, 0.03, 0.035, o.h - 0.08, 0.03, 0.008);
  cbox(g, trim(), 0, o.h * 0.12, 0.03, o.w - 0.08, 0.035, 0.03, 0.008);
  cbox(g, steel(), 0, -o.h / 2 - 0.09, wall / 2 + 0.05, o.w + 0.24, 0.05, 0.16, 0.015);
}

/**
 * The walls: a gable at each end and a long side between them, each a thick panel of paint with
 * its openings cut through, its edges worn; a shut line down the middle of each side, across each
 * gable at the eaves and up beside the door, and charcoal posts over the corners.
 */
function walls(house: THREE.Group): void {
  const { depth, half, plinth, eave, ridge, wall } = HOUSE_BODY;
  const b = 0.03;
  const V = THREE.Vector3;
  const door: Opening = { at: -0.6, y: plinth + 1.03, w: 0.9, h: 2.06 };
  const openings: Record<Face, Opening[]> = {
    '+x': [{ at: 0.95, y: 1.6, w: 1.0, h: 1.0 }],
    '-x': [{ at: 0.4, y: 1.6, w: 1.1, h: 1.0 }],
    '+z': [{ at: 0, y: 1.6, w: 1.2, h: 1.0 }],
    '-z': [
      { at: -0.78, y: 1.6, w: 0.9, h: 1.0 },
      { at: 0.78, y: 1.6, w: 0.9, h: 1.0 },
    ],
  };
  const porthole = { y: ridge - 0.72, r: 0.24 };

  // The gables, each its outline across z (as x, turned below) up to the ridge.
  for (const face of ['+x', '-x'] as const) {
    // The door's opening a notch up from the foot of its gable, a little wide of the door, the
    // bevel's roll taken off it.
    const [z0, z1] = [door.at - door.w / 2 - 0.02 - b, door.at + door.w / 2 + 0.02 + b];
    const head = door.y + door.h / 2 + 0.02 + b;
    const notch: [number, number, number][] =
      face === '+x'
        ? [
            [z0, plinth + b, 0.005],
            [z0, head, 0.01],
            [z1, head, 0.01],
            [z1, plinth + b, 0.005],
          ]
        : [];
    const outline = roundedOutline(
      [
        [-half + b, plinth + b],
        ...notch,
        [half - b, plinth + b],
        [half - b, eave - b],
        [0, ridge - b * 1.6],
        [-half + b, eave - b],
      ],
      0.02,
    );
    for (const o of openings[face])
      outline.holes.push(rect(o.at, o.y, o.w + 0.04, o.h + 0.04, 0.05));
    outline.holes.push(disc(0, porthole.y, porthole.r + 0.02));
    const geo = panel(outline, wall, b);
    // Its outline's x along the house's z.
    geo.rotateY(-Math.PI / 2);
    const x = face === '+x' ? depth - wall / 2 : -(depth - wall / 2);
    put(house, geo, paint(), x, 0, 0);
    for (const o of openings[face]) windowIn(house, face, o);
    porthole_(house, face, porthole.y, porthole.r);
    // Its seams: across at the eaves, and on the door's gable one up beside it.
    const out = new V(Math.sign(x), 0, 0);
    const fx = Math.sign(x) * depth;
    shutLine(
      house,
      new V(fx, eave, -half + 0.12),
      new V(fx, eave, half - 0.12),
      out,
      seam(),
      lip(),
    );
    if (face === '+x')
      shutLine(
        house,
        new V(fx, plinth + 0.04, 0.17),
        new V(fx, eave - 0.04, 0.17),
        out,
        seam(),
        lip(),
      );
  }

  // The long sides, between the gables, up to the eaves.
  for (const face of ['+z', '-z'] as const) {
    const side = face === '+z' ? 1 : -1;
    const outline = rect(
      0,
      (plinth + eave) / 2,
      (depth - wall / 2) * 2 - 2 * b,
      eave - plinth - 2 * b,
      0.02,
    );
    // Seen from outside on -z, its outline's x runs the other way: the openings are symmetric.
    for (const o of openings[face])
      outline.holes.push(rect(o.at, o.y, o.w + 0.04, o.h + 0.04, 0.05));
    const geo = panel(outline, wall, b);
    put(house, geo, paint(), 0, 0, side * (half - wall / 2));
    for (const o of openings[face]) windowIn(house, face, o);
    const out = new V(0, 0, side);
    const fz = side * half;
    // A seam down between the windows on one side, two either side of the window on the other.
    for (const x of face === '-z' ? [0] : [-1.0, 1.0])
      shutLine(house, new V(x, plinth + 0.04, fz), new V(x, eave - 0.04, fz), out, seam(), lip());
  }

  // Charcoal posts over the corners, standing a little proud of both walls.
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      cbox(
        house,
        trim(),
        sx * (depth - 0.09),
        (plinth + eave - 0.03) / 2,
        sz * (half - 0.09),
        0.24,
        eave - 0.03 - plinth,
        0.24,
        0.03,
      );

  // Dark inside, so the windows show nothing through: the gables' outline, inside the walls.
  const inner = half - wall - 0.01;
  const room = slab(
    roundedOutline(
      [
        [-inner, plinth],
        [inner, plinth],
        [inner, eave],
        [0, ridge - 0.12],
        [-inner, eave],
      ],
      0.01,
    ),
    (depth - wall - 0.01) * 2,
    0,
  );
  room.rotateY(-Math.PI / 2);
  put(house, room, dark());

  doorway(house, door);
}

/** A round window high in the gable on `face`: a charcoal ring, a steel lip, its glass. */
function porthole_(house: THREE.Group, face: Face, y: number, r: number): void {
  const { wall } = HOUSE_BODY;
  const g = new THREE.Group();
  const { p, turn } = onFace(face, 0, y);
  g.position.copy(p);
  g.rotation.y = turn;
  house.add(g);
  const ring = new THREE.Shape();
  ring.absarc(0, 0, r + 0.08, 0, Math.PI * 2, false);
  ring.holes.push(disc(0, 0, r - 0.03));
  putSlab(g, ring, wall + 0.06, trim(), 0.015);
  put(g, new THREE.TorusGeometry(r + 0.05, 0.012, 8, 48), steel(), 0, 0, wall / 2 + 0.035);
  put(g, new THREE.CircleGeometry(r - 0.02, 40), glass(), 0, 0, 0.01);
}

/**
 * The door: a red panel sunk in a charcoal frame, a slot of glass down it, a steel bar of a
 * handle and a kick plate; a step before it, a canopy over it lit cyan underneath, and a ringed
 * lamp beside it.
 */
function doorway(house: THREE.Group, door: Opening): void {
  const { depth, wall, plinth } = HOUSE_BODY;
  const fx = depth;
  const top = door.y + door.h / 2;
  // The frame: two jambs and a head, lining the opening and lapping over the wall.
  for (const s of [-1, 1])
    cbox(
      house,
      trim(),
      fx - wall / 2,
      (plinth + top + 0.08) / 2,
      door.at + s * (door.w / 2 + 0.02),
      wall + 0.06,
      top + 0.08 - plinth,
      0.1,
      0.015,
    );
  cbox(house, trim(), fx - wall / 2, top + 0.04, door.at, wall + 0.06, 0.1, door.w + 0.14, 0.015);
  // The panel, sunk to the wall's middle, a slot of glass down its latch side.
  const red = mat(SPORT.red, {
    mottle: 'paint',
    roughness: 0.4,
    metalness: 0.15,
    envMapIntensity: 1.4,
    clearcoat: 1,
    clearcoatRoughness: 0.2,
  });
  const leaf = rect(0, 0, door.w - 0.06, door.h - 0.02, 0.02);
  const slot = { x: 0.2, y: 0.25, w: 0.14, h: 1.1 };
  leaf.holes.push(rect(slot.x, slot.y, slot.w, slot.h, 0.05));
  const g = new THREE.Group();
  g.position.set(fx - wall / 2 + 0.02, door.y, door.at);
  g.rotation.y = Math.PI / 2;
  house.add(g);
  put(g, flatSlab(leaf, 0.06, 0.012), red);
  cbox(g, glass(), slot.x, slot.y, 0, slot.w, slot.h, 0.01, 0.004);
  cbox(g, steel(), 0, -door.h / 2 + 0.12, 0.032, door.w - 0.14, 0.16, 0.01, 0.006);
  // The handle: a steel bar stood off the panel, beside the slot.
  const hx = -0.3;
  rbox(g, steel(), hx, 0.1, 0.075, 0.035, 0.5, 0.035, 0.016);
  for (const y of [-0.1, 0.3]) rbox(g, steel(), hx, y, 0.05, 0.03, 0.03, 0.05, 0.01);
  // The step, charcoal, at the plinth's foot.
  cbox(house, plinthMat(), fx + 0.28, 0.09, door.at, 0.42, 0.18, door.w + 0.4, 0.03);
  // The canopy: a painted slab out over the door on two brackets, a cyan strip under its edge.
  const canopy = { x: fx + 0.3, y: top + 0.32, w: door.w + 0.5 };
  const cGeo = panel(rect(0, 0, 0.6, 0.1, 0.02), canopy.w, 0.03);
  put(house, cGeo, paint(), canopy.x, canopy.y, door.at);
  cbox(
    house,
    glow(CAR.blue, 1.6),
    canopy.x + 0.22,
    canopy.y - 0.055,
    door.at,
    0.03,
    0.012,
    canopy.w - 0.12,
    0.004,
  );
  for (const s of [-1, 1]) {
    const z = door.at + s * (canopy.w / 2 - 0.12);
    const strut = cbox(house, trim(), fx + 0.17, canopy.y - 0.2, z, 0.05, 0.42, 0.05, 0.012);
    strut.rotation.z = 0.75;
    cbox(house, trim(), fx + 0.03, canopy.y - 0.28, z, 0.06, 0.16, 0.08, 0.012);
  }
  // A ringed lamp on the wall beside the door, glowing cyan, as the cars' are.
  const lamp = new THREE.Group();
  lamp.position.set(fx, door.y + 0.35, door.at - door.w / 2 - 0.32);
  lamp.rotation.y = Math.PI / 2;
  house.add(lamp);
  const housing = new THREE.CylinderGeometry(0.1, 0.11, 0.08, 32);
  housing.rotateX(Math.PI / 2);
  put(lamp, housing, trim(), 0, 0, 0.04);
  put(lamp, new THREE.TorusGeometry(0.075, 0.012, 8, 32), steel(), 0, 0, 0.082);
  put(lamp, new THREE.CircleGeometry(0.066, 28), glow(CAR.blue, 2.2), 0, 0, 0.083);
}

/**
 * The roof: two panels of dark ribbed metal resting on the gables, out over the walls all round,
 * a rounded cap along the ridge, a gutter under each eave and a downpipe at the corner the
 * camera sees, a chimney, and a hover fan sunk in a collar on the slope facing -z.
 */
function roof(house: THREE.Group): void {
  const { depth, half, eave, ridge } = HOUSE_BODY;
  const rise = ridge - eave;
  const A = Math.atan2(rise, half);
  const run = Math.hypot(rise, half);
  const over = { eave: 0.34, gable: 0.3 };
  const thick = 0.1;
  const length = (depth + over.gable) * 2;
  const roofing = roofMat();
  const ribMat = mat(0x4b5257, {
    mottle: 'metal',
    roughness: 0.32,
    metalness: 0.6,
    envMapIntensity: 1.8,
  });
  // Along the slope down from the ridge, and out of it, on the side toward `side` (±z).
  const slope = (side: number) => ({
    down: new THREE.Vector3(0, -Math.sin(A), side * Math.cos(A)),
    up: new THREE.Vector3(0, Math.cos(A), side * Math.sin(A)),
  });
  const ridgeAt = new THREE.Vector3(0, ridge, 0);
  for (const side of [-1, 1]) {
    const { down, up } = slope(side);
    const s0 = -0.04;
    const s1 = run + over.eave;
    const mid = ridgeAt
      .clone()
      .addScaledVector(down, (s0 + s1) / 2)
      .addScaledVector(up, thick / 2);
    cbox(house, roofing, mid.x, mid.y, mid.z, length, thick, s1 - s0, 0.025, [side * A, 0, 0]);
    // Standing seams down it.
    for (let x = -length / 2 + 0.3; x < length / 2 - 0.2; x += 0.46) {
      const at = ridgeAt
        .clone()
        .addScaledVector(down, (s0 + s1) / 2 + 0.02)
        .addScaledVector(up, thick + 0.012);
      cbox(house, ribMat, x, at.y, at.z, 0.03, 0.03, s1 - s0 - 0.08, 0.01, [side * A, 0, 0]);
    }
    // The gutter under its eave, a rounded trough of charcoal.
    const edge = ridgeAt.clone().addScaledVector(down, s1 - 0.04);
    rbox(house, trim(), 0, edge.y - 0.04, edge.z + side * 0.02, length - 0.04, 0.11, 0.12, 0.04);
  }
  // The ridge's cap.
  rbox(house, ribMat, 0, ridge + thick / Math.cos(A) - 0.01, 0, length + 0.04, 0.1, 0.26, 0.045);

  // A downpipe from the gutter at the door's gable, the camera's side, to the plinth.
  const g = ridgeAt.clone().addScaledVector(slope(-1).down, run + over.eave - 0.04);
  const px = depth + over.gable - 0.24;
  const pipe = bentPath(
    [
      new THREE.Vector3(px, g.y - 0.06, g.z - 0.02),
      new THREE.Vector3(px, g.y - 0.32, g.z),
      new THREE.Vector3(px, g.y - 0.55, -half - 0.06),
      new THREE.Vector3(px, 0.42, -half - 0.06),
      new THREE.Vector3(px + 0.16, 0.28, -half - 0.06),
    ],
    0.08,
  );
  tube(house, pipe, 0.04, trim());
  for (const y of [0.9, 1.9]) cbox(house, steel(), px, y, -half - 0.02, 0.1, 0.03, 0.1, 0.01);

  // The chimney, through the slope toward +z, capped in charcoal with a steel vent on it.
  const cx = -0.85;
  const cz = 0.62;
  const roofY = ridge - cz * Math.tan(A);
  const chimTop = ridge + 0.42;
  const cGeo = panel(rect(0, 0, 0.42, 0.42, 0.04), chimTop - roofY + 0.2, 0.03);
  cGeo.rotateX(Math.PI / 2);
  put(house, cGeo, paint(), cx, (chimTop + roofY - 0.2) / 2, cz);
  cbox(house, trim(), cx, chimTop + 0.03, cz, 0.52, 0.06, 0.52, 0.02);
  const vent = new THREE.CylinderGeometry(0.09, 0.09, 0.16, 24);
  put(house, vent, steel(), cx, chimTop + 0.14, cz);
  put(house, new THREE.CylinderGeometry(0.15, 0.13, 0.04, 24), steel(), cx, chimTop + 0.24, cz);

  // The fan: one of the cars' hover wheels, a little smaller, its face turned up off the slope
  // facing -z, standing in a charcoal collar sunk in the roof.
  const { down, up } = slope(-1);
  const scale = 0.62;
  const hw = 0.165 * scale;
  const s = run * 0.48;
  const base = ridgeAt
    .clone()
    .addScaledVector(down, s)
    .addScaledVector(up, thick + 0.012);
  const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), up);
  const collarH = 0.12;
  const collar = new THREE.CylinderGeometry(0.27, 0.3, collarH + 0.08, 40);
  collar.rotateX(Math.PI / 2);
  const c = put(house, collar, trim());
  c.position.copy(base).addScaledVector(up, collarH / 2 - 0.04);
  c.quaternion.copy(turn);
  const fan = makeWheel();
  fan.scale.setScalar(scale);
  fan.position.copy(base).addScaledVector(up, collarH + hw - 0.01);
  fan.quaternion.copy(turn);
  fan.position.x = -0.55;
  c.position.x = -0.55;
  house.add(fan);
}

/** The plinth the house stands on, charcoal, out a little past its walls. */
function plinth(house: THREE.Group): void {
  const { depth, half, plinth: top } = HOUSE_BODY;
  cbox(house, plinthMat(), 0, top / 2, 0, depth * 2 + 0.2, top, half * 2 + 0.2, 0.03);
}

/** A letterbox on a post out before the door, and grass at the house's foot. */
function yard(house: THREE.Group, doorAt: number): void {
  const { depth, half } = HOUSE_BODY;
  const rand = rng(23);
  // The letterbox: a rounded box in the door's red on a charcoal post, an amber flag up.
  const lx = depth + 1.3;
  const lz = doorAt - 0.72;
  cbox(house, trim(), lx, 0.5, lz, 0.07, 1.0, 0.07, 0.015);
  const red = mat(SPORT.red, {
    mottle: 'paint',
    roughness: 0.4,
    metalness: 0.15,
    clearcoat: 1,
    clearcoatRoughness: 0.2,
  });
  const box = roundedOutline(
    [
      [-0.12, 0],
      [0.12, 0],
      [0.12, 0.2, 0.12],
      [-0.12, 0.2, 0.12],
    ],
    0.015,
  );
  const bGeo = slab(box, 0.44, 0.02);
  bGeo.rotateY(Math.PI / 2);
  put(house, bGeo, red, lx, 1.0, lz);
  cbox(
    house,
    mat(CAR.amber, { roughness: 0.4 }),
    lx - 0.12,
    1.25,
    lz - 0.135,
    0.12,
    0.08,
    0.012,
    0.005,
  );
  cbox(house, trim(), lx - 0.1, 1.15, lz - 0.13, 0.02, 0.2, 0.012, 0.004);

  // Grass, lit like the cars', in clumps along its foot.
  const grass = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.7,
    side: THREE.DoubleSide,
  });
  const clumps: [number, number, number][] = [
    [depth + 0.2, -half - 0.12, 0.3],
    [depth - 0.6, -half - 0.16, 0.22],
    [-depth + 0.4, -half - 0.14, 0.26],
    [depth + 0.18, doorAt + 0.75, 0.24],
    [depth + 0.2, half + 0.05, 0.28],
    [depth + 1.38, lz + 0.05, 0.2],
  ];
  for (const [i, [x, z, size]] of clumps.entries()) {
    const m = new THREE.Mesh(tuft(700 + i, size, true), grass);
    m.position.set(x, 0, z);
    m.rotation.y = rand() * Math.PI * 2;
    m.castShadow = true;
    house.add(m);
  }
}

/** Builds the house, standing at the origin, its door's gable facing +x. */
export function buildHouse(): THREE.Group {
  const house = new THREE.Group();
  house.name = 'house';
  plinth(house);
  walls(house);
  roof(house);
  yard(house, -0.6);
  return house;
}
