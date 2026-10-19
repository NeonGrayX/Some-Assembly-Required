import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR, WHEELS, archCut, chevronShape, flare, makeWheel, weather } from './car.ts';
import type { Car } from './car.ts';
import { dashPlastic, dashScreen, leather as cabinLeather, seat, steeringWheel } from './cabin.ts';
import { clipX, hang, lidOff, notch, outlinePoints, topOf, widen } from './doors.ts';
import { clipLine, glazedShell, inset } from './glazing.ts';
import { cbox, glow, mat, put, putSlab, rbox, roundedOutline, slab } from './kit.ts';

/**
 * The sports car: a low red coupé built as the off-roader is, its stablemate. A wedge of a body
 * with fenders swelling over the wheels, a short raked glasshouse narrower than the body, the
 * same charcoal arches bolted over the same armoured hover wheels (smaller), ringed blue lamps
 * and a steel chevron on its nose, a charcoal splitter and skirts lit with blue strips, a wing
 * on posts, a red light bar and two blue thrusters at its tail.
 *
 * Modelled facing +x, its right side toward +z, its wheels on the ground at y = 0; about 4.9 m
 * from splitter to tail, 1.45 m to the roof.
 */

/** Its paint, a light lip in that paint, and its tail light. */
export const SPORT = {
  red: 0xc42a22,
  lip: 0xf09080,
  tail: 0xff2a20,
};

/** How much smaller its wheels and arches are than the off-roader's. */
const SCALE = 0.82;

/** Its wheels' centres along x and out to each side. */
export const SPORT_WHEELS = { front: 1.42, rear: -1.48, side: 1.2 };

/** The body's lines along x and up y. */
export const SPORT_BODY = {
  front: 2.3,
  rear: -2.3,
  /** The underside of the red body, above the charcoal skirts. */
  sill: 0.34,
  half: 0.96,
  /** Half the glasshouse's width, at its foot. */
  cabinHalf: 0.88,
  roof: 1.44,
};

const paint = () =>
  mat(SPORT.red, {
    mottle: 'paint',
    roughness: 0.4,
    metalness: 0.15,
    envMapIntensity: 1.4,
    clearcoat: 1,
    clearcoatRoughness: 0.15,
    vertexColors: true,
  });
/** Its worn edges: lighter, toward orange. */
const WORN: [number, number, number] = [1.25, 1.5, 1.5];
const lip = () => mat(SPORT.lip, { mottle: 'none', roughness: 0.5 });
const trim = () => mat(CAR.trim, { mottle: 'plastic', roughness: 0.6 });
const bumperMat = () => mat(CAR.bumper, { mottle: 'plastic', roughness: 0.45 });
const dark = () => mat(0x1c1f21, { mottle: 'none', roughness: 0.9 });
/** Tinted glass, dark as the off-roader's, the cabin dim behind it. */
const glass = () =>
  mat(0x231812, {
    mottle: 'none',
    roughness: 0.05,
    metalness: 0.2,
    envMapIntensity: 2.6,
    transparent: true,
    opacity: 0.74,
  });

const V = THREE.Vector3;
const ray = new THREE.Raycaster();

/** Its doors, each side: front and back edges along x, foot, and how thick (in from the side). */
const DOOR = { x0: -0.5, x1: 0.62, foot: 0.44, depth: 0.12 };
/** How wide the windscreen's pillar stands, in from the glasshouse's edge, ahead of the door. */
const PILLAR = 0.06;
/** The cockpit: its seats' cushions' top, their middles along x and out from the middle. */
const COCKPIT = { cushion: 0.56, seatX: -0.24, seatZ: 0.31 };
/** The dashboard: its back face along x, its top and its underside, and half its width. */
const DASH = { back: 0.24, top: 1.04, under: 0.82, half: 0.52 };
/**
 * The cockpit's well, cut down into the body under the cabin: along x, and its floor; its back
 * clear of the rear arches, so the cut never crosses one.
 */
const WELL = { x0: -0.88, x1: 0.8, floor: 0.44 };
/** The doors, by side (-1 left, 1 right), each built in the car's frame. */
type Doors = Record<number, THREE.Group>;
/**
 * The bonnet and the boot lid: along x, out to each side, and the floor of the well under each;
 * the body's middle ahead of the bonnet's `cut` and behind the boot's is built apart, each lid cut
 * out of it.
 */
const HOOD = { x0: 1.04, x1: 2.12, edge: 0.6, cut: 0.95, floor: 0.7 };
const BOOT = { x0: -2.2, x1: -1.92, edge: 0.6, cut: -1.78, floor: 0.7 };
/** The bonnet's and the boot lid's hinges' lids, each built in the car's frame. */
interface Lids {
  hood: THREE.Group;
  boot: THREE.Group;
}
/** How far the body's slabs are bevelled. */
const BEVEL = 0.04;

/** Where a line straight down at (`x`, `z`) meets `mesh`'s top, and the surface's normal there. */
function onTop(mesh: THREE.Mesh, x: number, z: number): { p: THREE.Vector3; n: THREE.Vector3 } {
  ray.set(new V(x, 5, z), new V(0, -1, 0));
  const hit = ray.intersectObject(mesh, false)[0]!;
  return { p: hit.point.clone(), n: hit.face!.normal.clone() };
}

/**
 * Bends each mesh in `g` by `fn`, which moves a point of it, in the car's frame: each mesh's own
 * placing is laid into its geometry first. Its normals are made again for its new shape.
 */
function bend(g: THREE.Object3D, fn: (p: THREE.Vector3) => void): void {
  const p = new V();
  for (const o of g.children) {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) continue;
    mesh.updateMatrix();
    const geo = mesh.geometry.clone().applyMatrix4(mesh.matrix);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      fn(p.fromBufferAttribute(pos, i));
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    mesh.geometry = toCreasedNormals(geo, Math.PI / 4);
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
  }
}

/**
 * The coupé's side, bevelled `BEVEL`: low at the nose, swelling over each wheel, and cut out over
 * the wheels if `arches` (only the body's outer parts are: its middle, between the wheels, isn't).
 */
function profile(arches: boolean): THREE.Vector2[] {
  const { front, rear, sill } = SPORT_BODY;
  const b = BEVEL;
  const yc = (WHEELS.radius - 0.03) * SCALE;
  const cut = (xc: number) => (arches ? archCut(xc, sill + b, SCALE, yc) : []);
  return outlinePoints(
    roundedOutline(
      [
        [rear + b, sill + b, 0.02],
        ...cut(SPORT_WHEELS.rear),
        ...cut(SPORT_WHEELS.front),
        [front - b, sill + b, 0.02],
        // The nose: a short upright face, rolling over into the bonnet.
        [front - b, 0.84 - b, 0.12],
        // The front fender's crest, the cowl, the rear fender's crest and the ducktail.
        [SPORT_WHEELS.front + 0.1, 1.06 - b, 0.5],
        [0.7, 0.99 - b, 0.3],
        [-1.1, 1.0 - b, 0.3],
        [SPORT_WHEELS.rear - 0.1, 1.08 - b, 0.4],
        [rear + b, 1.04 - b, 0.06],
      ],
      0.015,
    ),
  );
}

/** Hangs the bonnet on its back edge, lifting at its front, and the boot lid on its front edge. */
function hangLids(car: THREE.Group): Lids {
  const top = profile(false);
  const at = (x: number) => new V(x, topOf(top, x) + BEVEL, 0);
  const hood = hang(car, at(HOOD.x0), 0.95, 'z');
  hood.parent!.userData.what = 'bonnet';
  const boot = hang(car, at(BOOT.x1), -1.05, 'z');
  boot.parent!.userData.what = 'boot';
  return { hood, boot };
}

/**
 * One end of the body (`end`, beyond a lid's cut; `solid`, the same without the arches cut out):
 * the lid cut off its top over the well and hung on `lid`, a strip each side of it out to the
 * body's side, and the well lined dark from its floor up.
 */
function bay(
  shell: THREE.Group,
  end: THREE.Vector2[],
  solid: THREE.Vector2[],
  at: { x0: number; x1: number; edge: number; floor: number },
  lid: THREE.Group,
  parts: [THREE.Mesh, THREE.Group][],
): void {
  const b = BEVEL;
  const { half } = SPORT_BODY;
  const floor = [new THREE.Vector2(at.x0, at.floor), new THREE.Vector2(at.x1, at.floor)];
  const cut = lidOff(solid, floor, 0.05, b);
  put(
    shell,
    weather(slab(new THREE.Shape(cut.rest), at.edge * 2, b), 'slab', false, WORN),
    paint(),
  );
  // Each strip runs out to the body's side, one piece with it.
  const strip = weather(slab(new THREE.Shape(end), half - at.edge, b), 'slab', false, WORN);
  for (const s of [-1, 1]) put(shell, strip, paint(), 0, 0, (s * (at.edge + half)) / 2);
  const lidGeo = slab(new THREE.Shape(inset(cut.lid, 0.022)), at.edge * 2 - 0.012, 0.015);
  parts.push([put(shell, weather(lidGeo, 'slab', false, WORN), paint()), lid]);
  // Lined up to under the lid where it is lowest, so no lining stands above the body.
  const high = Math.min(...cut.lid.map((p) => p.y)) - 0.06;
  const [x0, x1] = [at.x0 + 0.03, at.x1 - 0.03];
  put(
    shell,
    new THREE.BoxGeometry(x1 - x0, high - at.floor, at.edge * 2 - 0.04),
    mat(0x1c1714, { roughness: 0.85, side: THREE.BackSide }),
    (x0 + x1) / 2,
    (at.floor + high) / 2 + 0.003,
    0,
  ).castShadow = false;
}

/**
 * The body: one slab across the car's width, its side the coupé's profile; built as a middle with
 * the cockpit's well cut down into it, the bonnet and the boot lid cut out of its ends, and a side
 * each side, the door cut out of it. Returns the whole slab, unseen, to find its top on.
 */
function body(car: THREE.Group, doors: Doors, lids: Lids): THREE.Mesh {
  const { front, rear, half } = SPORT_BODY;
  const b = BEVEL;
  const points = profile(true);
  const solid = profile(false);
  const foot = [new THREE.Vector2(DOOR.x0, DOOR.foot), new THREE.Vector2(DOOR.x1, DOOR.foot)];
  const well = [new THREE.Vector2(WELL.x0, WELL.floor), new THREE.Vector2(WELL.x1, WELL.floor)];
  const middleHalf = half - DOOR.depth;
  const shell = new THREE.Group();
  const outline = new THREE.Shape(points);
  const whole = put(shell, weather(slab(outline, half * 2, b), 'slab', false, WORN), paint());
  const cockpit = notch(points, widen(well, b, true), true).rest;
  const middle = clipX(clipX(cockpit, BOOT.cut + b, true), HOOD.cut - b, false);
  put(
    shell,
    weather(slab(new THREE.Shape(middle), middleHalf * 2, b), 'slab', false, WORN),
    paint(),
  );
  const parts: [THREE.Mesh, THREE.Group][] = [];
  const ahead = (ps: THREE.Vector2[]) => clipX(ps, HOOD.cut + b, true);
  const behind = (ps: THREE.Vector2[]) => clipX(ps, BOOT.cut - b, false);
  bay(shell, ahead(points), ahead(solid), HOOD, lids.hood, parts);
  bay(shell, behind(points), behind(solid), BOOT, lids.boot, parts);
  // The sides between the bonnet's strips and the boot's, the door cut out of each.
  const between = clipX(clipX(points, BOOT.cut + b, true), HOOD.cut - b, false);
  const sideShape = new THREE.Shape(notch(between, widen(foot, b, true), true).rest);
  const sideGeo = weather(slab(sideShape, DOOR.depth, b), 'slab', false, WORN);
  // Its top raised the inset, flush with the body's line either side.
  const doorTop = inset(notch(points, foot, true).piece, 0.036);
  for (const p of doorTop) if (p.y > 0.9) p.y += 0.036;
  const doorShape = new THREE.Shape(doorTop);
  const doorGeo = weather(slab(doorShape, DOOR.depth, 0.03), 'slab', false, WORN);
  const card = slab(new THREE.Shape(inset(doorShape.getPoints(), 0.05)), 0.016, 0.006);
  for (const side of [-1, 1]) {
    const z = side * (half - DOOR.depth / 2);
    put(shell, sideGeo, paint(), 0, 0, z);
    parts.push([put(shell, doorGeo, paint(), 0, 0, z), doors[side]!]);
    const lining = mat(0x2a1c18, { mottle: 'plastic', roughness: 0.8 });
    parts.push([put(shell, card, lining, 0, 0, side * (middleHalf - 0.006)), doors[side]!]);
    // An armrest along the door, level with the console's, and a pull in it toward the front.
    const arm = COCKPIT.cushion + 0.18;
    const face = side * (middleHalf - 0.04);
    cbox(doors[side]!, lining, -0.05, arm, face, 0.62, 0.05, 0.07, 0.02);
    cbox(
      doors[side]!,
      dashPlastic(),
      0.32,
      arm + 0.07,
      side * (middleHalf - 0.016),
      0.14,
      0.04,
      0.02,
      0.008,
    );
  }
  // Narrowing a little toward its nose, and less toward its tail, ahead of and behind the wheels.
  bend(shell, (p) => {
    const nose = THREE.MathUtils.smoothstep(p.x, SPORT_WHEELS.front + 0.5, front);
    const tail = THREE.MathUtils.smoothstep(-p.x, -SPORT_WHEELS.rear + 0.5, -rear);
    p.z *= 1 - 0.1 * nose - 0.05 * tail;
  });
  shell.remove(whole);
  for (const [mesh, door] of parts) door.add(mesh);
  for (const m of [...shell.children]) car.add(m);
  // The well lined dark inside, under the cabin, its floor a little over the well's (which
  // stands its bevel proud of the cut).
  const wellFloor = WELL.floor + BEVEL + 0.006;
  put(
    car,
    new THREE.BoxGeometry(WELL.x1 - WELL.x0 - 0.04, 0.5, middleHalf * 2 - 0.02),
    mat(0x1c1714, { roughness: 0.85, side: THREE.BackSide }),
    (WELL.x0 + WELL.x1) / 2,
    wellFloor + 0.25,
    0,
  ).castShadow = false;
  // The wells inside the arches, dark, either side of the body's middle (across it too, behind
  // the boot, where the middle is cut out over the rear wheels), and the underside.
  for (const xc of [SPORT_WHEELS.front, SPORT_WHEELS.rear])
    for (const s of [-1, 1]) rbox(car, dark(), xc, 0.66, s * 0.71, 1.0, 0.56, 0.22, 0.05);
  const x0 = BOOT.cut + 0.02;
  const x1 = SPORT_WHEELS.rear + 0.5;
  rbox(car, dark(), (x0 + x1) / 2, 0.66, 0, x1 - x0, 0.56, 1.3, 0.05);
  rbox(car, dark(), -0.05, 0.32, 0, 4.2, 0.08, half * 2 - 0.2, 0.03);
  whole.updateMatrixWorld(true);
  return whole;
}

/**
 * The glasshouse: a short raked cabin narrower than the body, standing on its shoulders, hollow,
 * its glass set into it: the windscreen and the fastback's window sunk between the pillars, and
 * a side window in two panes each side, each in an opening its frame rolls into. Inside, two
 * bucket seats sunk low, the wheel, and a dashboard lit cyan.
 */
function glasshouse(car: THREE.Group, doors: Doors): void {
  const { cabinHalf, roof } = SPORT_BODY;
  const b = 0.05;
  // The cabin's side, round its edge: the windscreen's foot and head, the roof's back edge, and
  // the fastback's foot.
  const foot = new THREE.Vector2(0.88, 0.922);
  const head = new THREE.Vector2(-0.08, roof - b);
  const crown = new THREE.Vector2(-0.6, roof - b);
  const tail = new THREE.Vector2(-1.9 + b, 1.04);
  const outline = roundedOutline(
    [
      [tail.x, 0.92, 0.02],
      [0.97 - b, 0.9, 0.02],
      [foot.x, foot.y, 0.06],
      [head.x, head.y, 0.1],
      [crown.x, crown.y, 0.3],
      [tail.x, tail.y, 0.08],
    ],
    0.015,
  );
  // In from the windscreen's pillar, down and back square to it: how far in a point is, and the
  // point that far in at a height.
  const along = head.clone().sub(foot).normalize();
  const inward = new THREE.Vector2(-along.y, along.x);
  const depth = foot.dot(inward);
  const behind = (d: number, y: number) =>
    foot
      .clone()
      .addScaledVector(along, (y - foot.y - d * inward.y) / along.y)
      .addScaledVector(inward, d);
  // The side windows' openings: a long one in the door's frame, behind the windscreen's pillar,
  // and a small quarter window behind the door. The frame rolls into each, `b` deep all round.
  const doorWindow = roundedOutline(
    [
      [behind(PILLAR + 0.07, 1.04).x, 1.04],
      [behind(PILLAR + 0.07, 1.31).x, 1.31],
      [-0.4, 1.31],
      [-0.4, 1.04],
    ],
    0.04,
  );
  const openings: [number, number][][] = [
    [
      [-0.62, 1.04],
      [-0.62, 1.32],
      [-0.71, 1.32],
      [-1.38, 1.13],
      [-1.25, 1.065],
    ],
  ];
  // Each side cut right through for its door's frame, from its foot to the roof: what is left is
  // the windscreen's pillar ahead, and the rest of the side behind; each stands proud of its
  // outline the bevel all round, so is cut that much clear of the frame.
  const points = outlinePoints(outline);
  const pillar = clipLine(points, inward.clone().negate(), -(depth + PILLAR - b));
  const rear = clipX(points, DOOR.x0 - b, false);
  const cabin = glazedShell({
    outline,
    openings: openings.map((o) => roundedOutline(o, 0.04)),
    pieces: [pillar, rear],
    half: cabinHalf,
    pillar: 0.1,
    b,
    // The windscreen and the fastback's window sunk between the pillars.
    d: 0.03,
    runs: [
      [foot, head, 0.07, 0.11],
      [crown, tail, 0.26, 0.11],
    ],
    paint: paint(),
    glass,
    worn: WORN,
    hollow: {
      skin: 0.02,
      floor: 0.95,
      lining: mat(0x1c1714, { roughness: 0.85, side: THREE.BackSide }),
      open: [WELL.x0 + 0.02, WELL.x1 - 0.02],
    },
  });
  // The doors' frames: each the piece of the side between the pillar and the rest, out to the
  // side's own bevelled edge (its own bevel smaller) and a hair clear of either cut, no further
  // forward than the door, its window glazed; as thick as the door's top, flush with the side's
  // outer face, and swung with the door.
  const grown = inset(points, 0.02 - b);
  const cut = clipLine(grown, inward, depth + PILLAR + 0.026);
  const piece = clipX(clipX(cut, DOOR.x0 + 0.026, true), DOOR.x1 - 0.026, false);
  const frame = new THREE.Shape(piece);
  frame.holes.push(doorWindow);
  const thick = 0.1;
  const frameGeo = weather(slab(frame, thick, 0.02), 'slab', false, WORN);
  const parts: [THREE.Mesh, THREE.Group][] = [];
  for (const side of [-1, 1]) {
    const door = doors[side]!;
    const z = side * (cabinHalf + b - 0.02 - thick / 2);
    parts.push([put(cabin, frameGeo, paint(), 0, 0, z), door]);
    const pane = slab(doorWindow, 0.01, 0.003, 8);
    parts.push([put(cabin, pane, glass(), 0, 0, side * (cabinHalf - 0.04)), door]);
  }
  // Its sides leaning in toward the roof, the glass with them.
  bend(cabin, (p) => {
    p.z *= 1 - 0.2 * THREE.MathUtils.clamp((p.y - 0.92) / (roof - 0.92), 0, 1);
  });
  for (const [mesh, door] of parts) door.add(mesh);
  for (const m of [...cabin.children]) car.add(m);
  cockpit(car);
}

/**
 * Inside, at a grown driver's proportions (as the picture's coupé has it): two bucket seats low
 * in the well, their backs tall and only a little laid back, a console between them rising from
 * an armrest to the centre stack and its screen, the instruments under a hood over the wheel, and
 * the dashboard low and deep under the raked windscreen.
 */
function cockpit(car: THREE.Group): void {
  const { cushion, seatX, seatZ } = COCKPIT;
  const floor = WELL.floor;
  const tan = cabinLeather(0x8a4a2a);
  const dash = dashPlastic();
  for (const z of [-seatZ, seatZ])
    seat(car, tan, seatX, cushion, z, floor, {
      w: 0.44,
      back: 0.6,
      depth: 0.5,
      recline: 0.32,
      head: 0.18,
    });
  // The console: an armrest between the seats, and from it forward the shifter's tray rising to
  // the centre stack, its screen under the dashboard's middle.
  rbox(car, tan, seatX - 0.04, cushion + 0.14, 0, 0.36, 0.06, 0.16, 0.02);
  cbox(
    car,
    dash,
    seatX - 0.04,
    (floor + cushion + 0.11) / 2,
    0,
    0.36,
    cushion + 0.11 - floor,
    0.15,
    0.02,
  );
  const [c0, c1] = [seatX + 0.14, DASH.back + 0.1];
  cbox(
    car,
    dash,
    (c0 + c1) / 2,
    (floor + cushion + 0.06) / 2,
    0,
    c1 - c0,
    cushion + 0.06 - floor,
    0.17,
    0.02,
  );
  cbox(
    car,
    dash,
    DASH.back + 0.04,
    (cushion + DASH.under) / 2,
    0,
    0.16,
    DASH.under - cushion,
    0.2,
    0.02,
  );
  dashScreen(car, DASH.back - 0.045, DASH.under - 0.07, 0, 0.16, 0.1, 0.35);
  cbox(car, dash, 0.08, cushion + 0.1, 0, 0.05, 0.1, 0.035, 0.012);
  cbox(
    car,
    mat(0xb8bcbf, { mottle: 'metal', roughness: 0.3, metalness: 0.85 }),
    0.08,
    cushion + 0.16,
    0,
    0.07,
    0.03,
    0.045,
    0.01,
  );
  // The dashboard, low and deep, from over the knees forward under the windscreen, and the hood
  // over the instruments before the driver.
  const { back, top, under, half } = DASH;
  cbox(car, dash, back + 0.18, (under + top) / 2, 0, 0.36, top - under, half * 2, 0.03);
  rbox(car, dash, back + 0.05, top + 0.02, -seatZ, 0.16, 0.06, 0.4, 0.025);
  dashScreen(car, back - 0.012, top - 0.05, -seatZ, 0.34, 0.1, 0.2);
  for (const z of [-0.47, 0.47, 0.06])
    cbox(
      car,
      mat(0xb8bcbf, { mottle: 'metal', roughness: 0.3, metalness: 0.85 }),
      back - 0.006,
      top - 0.08,
      z,
      0.012,
      0.05,
      0.1,
      0.006,
    );
  // The wheel, at the driver's arms' reach, the instruments seen through its upper half.
  steeringWheel(car, 0.1, cushion + 0.33, -seatZ, 0.18, 0.42, 0.2);
}

/**
 * The nose: the steel chevron between two ringed lamps on its short face, a charcoal bumper
 * under it with a slatted intake and blue strips, and a splitter out ahead.
 */
function nose(car: THREE.Group): void {
  const x = SPORT_BODY.front;
  const brushed = mat(0xc8ced2, {
    mottle: 'metal',
    roughness: 0.3,
    metalness: 0.7,
    envMapIntensity: 2.4,
  });
  putSlab(car, chevronShape(0.46), 0.03, brushed, 0.006, x + 0.01, 0.56, 0, 0, Math.PI / 2, 0);
  for (const side of [-1, 1]) {
    // The headlamps, as the off-roader's: a glowing ring round a dark lens, smaller.
    const z = side * 0.64;
    put(
      car,
      new THREE.CylinderGeometry(0.11, 0.11, 0.012, 28),
      mat(0x1d2124, { roughness: 0.5 }),
      x + 0.004,
      0.56,
      z,
      0,
      0,
      Math.PI / 2,
    );
    put(
      car,
      new THREE.TorusGeometry(0.09, 0.014, 10, 36),
      glow(CAR.blue, 3),
      x + 0.012,
      0.56,
      z,
      0,
      Math.PI / 2,
      0,
    );
    put(
      car,
      new THREE.CylinderGeometry(0.075, 0.075, 0.01, 24),
      mat(0x15191c, { roughness: 0.15, mottle: 'none', envMapIntensity: 1.5 }),
      x + 0.008,
      0.56,
      z,
      0,
      0,
      Math.PI / 2,
    );
  }
  // The bumper: a charcoal bar across the nose's foot, an intake of dark slats in it, amber lamps
  // at its corners and blue strips low on its face.
  cbox(car, bumperMat(), x + 0.06, 0.3, 0, 0.26, 0.24, 1.8, 0.03);
  cbox(car, dark(), x + 0.18, 0.31, 0, 0.04, 0.12, 1.0, 0.01);
  for (let i = 0; i < 3; i++)
    cbox(
      car,
      mat(0x5a5e60, { roughness: 0.6 }),
      x + 0.2,
      0.27 + i * 0.04,
      0,
      0.02,
      0.012,
      0.96,
      0.003,
    );
  for (const side of [-1, 1]) {
    cbox(car, glow(CAR.amber, 1.2), x + 0.19, 0.35, side * 0.74, 0.02, 0.05, 0.14, 0.01);
    cbox(car, glow(CAR.blue, 3), x + 0.19, 0.23, side * 0.72, 0.02, 0.025, 0.3, 0.008);
  }
  // The splitter, a thin dark blade out ahead of the bumper.
  cbox(car, mat(0x2a2c2e, { roughness: 0.5 }), x + 0.12, 0.17, 0, 0.36, 0.04, 1.86, 0.015);
}

/**
 * Two vents of dark slats on the bonnet, ahead of the windscreen, and a leather holdall in the
 * well under it.
 */
function bonnet(car: THREE.Group, shell: THREE.Mesh, hood: THREE.Group): void {
  for (const side of [-1, 1])
    for (let i = 0; i < 5; i++) {
      const { p, n } = onTop(shell, 1.18 + i * 0.07, side * 0.32);
      const slot = rbox(
        hood,
        mat(0x2a2c2e, { roughness: 0.7 }),
        p.x,
        p.y,
        p.z,
        0.035,
        0.03,
        0.34,
        0.01,
      );
      slot.quaternion.setFromUnitVectors(new V(0, 1, 0), n);
    }
  rbox(car, cabinLeather(0x5a3a26), 1.55, HOOD.floor + 0.09, 0.12, 0.5, 0.17, 0.7, 0.07);
}

/**
 * The sides: charcoal skirts between the arches lit along their foot, the doors' seams and a
 * handle, a dark intake behind each door, and a small mirror on a charcoal arm.
 */
function sides(car: THREE.Group, shell: THREE.Mesh, doors: Doors): void {
  const { half } = SPORT_BODY;
  const x0 = SPORT_WHEELS.rear + 0.5;
  const x1 = SPORT_WHEELS.front - 0.5;
  for (const side of [-1, 1]) {
    cbox(car, trim(), (x0 + x1) / 2, 0.33, side * (half + 0.03), x1 - x0, 0.2, 0.1);
    cbox(
      car,
      glow(CAR.blue, 3),
      (x0 + x1) / 2,
      0.27,
      side * (half + 0.085),
      x1 - x0 - 0.3,
      0.025,
      0.02,
      0.008,
    );
    const face = side * (half + 0.002);
    const door = doors[side]!;
    rbox(door, lip(), -0.36, 0.84, face, 0.17, 0.05, 0.012, 0.01);
    rbox(
      door,
      mat(0x23272a, { roughness: 0.6 }),
      -0.36,
      0.84,
      face + side * 0.002,
      0.14,
      0.032,
      0.012,
      0.008,
    );
    // The intake: a dark scoop behind the door, three slats across it.
    cbox(car, dark(), -0.74, 0.66, side * (half - 0.005), 0.3, 0.2, 0.03, 0.02);
    for (let i = 0; i < 3; i++)
      cbox(car, trim(), -0.74, 0.6 + i * 0.06, side * (half + 0.01), 0.28, 0.018, 0.02, 0.004);
    // The mirror, on the door.
    cbox(door, trim(), 0.6, 1.02, side * (SPORT_BODY.half - 0.12), 0.06, 0.04, 0.2, 0.015);
    cbox(door, trim(), 0.56, 1.08, side * (SPORT_BODY.half + 0.02), 0.14, 0.12, 0.18, 0.03);
    cbox(
      door,
      glow(CAR.amber, 1.2),
      0.6,
      1.04,
      side * (SPORT_BODY.half + 0.11),
      0.06,
      0.02,
      0.02,
      0.006,
    );
  }
}

/**
 * The tail: a red light bar across it in a charcoal surround, two blue thrusters under it, a
 * finned diffuser at its foot and a wing on two posts over the deck.
 */
function tail(car: THREE.Group, shell: THREE.Mesh, boot: THREE.Group): void {
  const x = SPORT_BODY.rear;
  cbox(car, mat(0x1e2022, { roughness: 0.5 }), x - 0.005, 0.86, 0, 0.03, 0.1, 1.66, 0.02);
  cbox(car, glow(SPORT.tail, 2.5), x - 0.02, 0.86, 0, 0.02, 0.04, 1.56, 0.008);
  for (const side of [-1, 1]) {
    const z = side * 0.5;
    put(
      car,
      new THREE.CylinderGeometry(0.14, 0.14, 0.03, 28),
      mat(0x1d2124, { roughness: 0.5 }),
      x - 0.005,
      0.56,
      z,
      0,
      0,
      Math.PI / 2,
    );
    put(
      car,
      new THREE.TorusGeometry(0.11, 0.018, 10, 36),
      glow(CAR.blue, 3),
      x - 0.02,
      0.56,
      z,
      0,
      Math.PI / 2,
      0,
    );
    put(
      car,
      new THREE.CircleGeometry(0.08, 24),
      glow(0x9fe8ff, 1.2),
      x - 0.022,
      0.56,
      z,
      0,
      -Math.PI / 2,
      0,
    );
  }
  // The diffuser: a charcoal block under the tail, five fins standing down from it.
  cbox(car, bumperMat(), x + 0.02, 0.3, 0, 0.26, 0.22, 1.8, 0.03);
  for (let i = -2; i <= 2; i++)
    cbox(car, mat(0x2a2c2e, { roughness: 0.5 }), x - 0.06, 0.2, i * 0.26, 0.2, 0.14, 0.025, 0.006);
  // The wing, on the boot lid: a charcoal blade tipped up at its trailing edge, end plates, two
  // posts down to the deck. A small case in the boot.
  rbox(car, cabinLeather(0x2e2a28), -2.09, BOOT.floor + 0.08, -0.2, 0.22, 0.15, 0.5, 0.04);
  const wingX = -2.06;
  const deck = onTop(shell, wingX, 0.45).p.y;
  const wingY = deck + 0.24;
  cbox(boot, bumperMat(), wingX, wingY, 0, 0.4, 0.05, SPORT_BODY.half * 2 - 0.1, 0.02, [0, 0, 0.1]);
  for (const side of [-1, 1]) {
    cbox(
      boot,
      bumperMat(),
      wingX,
      wingY - 0.02,
      side * (SPORT_BODY.half - 0.04),
      0.44,
      0.18,
      0.03,
      0.012,
    );
    cbox(
      boot,
      trim(),
      wingX + 0.04,
      (deck + wingY) / 2,
      side * 0.45,
      0.08,
      wingY - deck,
      0.05,
      0.015,
    );
  }
}

/** Builds the sports car, standing at the origin facing +x. */
export function buildSportsCar(): Car {
  const car = new THREE.Group();
  car.name = 'sports car';
  // Each door hung at its front edge, swinging out.
  const doors: Doors = {};
  for (const side of [-1, 1])
    doors[side] = hang(car, new THREE.Vector3(DOOR.x1, 0, side * SPORT_BODY.half), side * 1.1);
  const lids = hangLids(car);
  const shell = body(car, doors, lids);
  glasshouse(car, doors);
  bonnet(car, shell, lids.hood);
  nose(car);
  sides(car, shell, doors);
  tail(car, shell, lids.boot);
  const wheels: THREE.Group[] = [];
  const yc = (WHEELS.radius - 0.03) * SCALE;
  for (const xc of [SPORT_WHEELS.front, SPORT_WHEELS.rear])
    for (const side of [-1, 1]) {
      flare(car, xc, side, SCALE, SPORT_BODY.half + 0.1, yc);
      const w = makeWheel();
      w.scale.setScalar(SCALE);
      w.position.set(xc, WHEELS.radius * SCALE, side * (SPORT_WHEELS.side - WHEELS.tuck * SCALE));
      // Tipped as the off-roader's are, and set down on the ground.
      w.rotation.set(WHEELS.tilt, side < 0 ? Math.PI : 0, 0, 'YXZ');
      w.updateMatrixWorld(true);
      w.position.y -= new THREE.Box3().setFromObject(w).min.y;
      car.add(w);
      wheels.push(w);
    }
  return { root: car, wheels };
}
