import * as THREE from 'three';
import {
  cbox,
  bentPath,
  glow,
  mat,
  put,
  putSlab,
  rbox,
  roundRect,
  roundedOutline,
  slab,
  tube,
} from './kit.ts';
import { buildCargo } from './cargo.ts';

/**
 * The car: a boxy lime-green off-roader, a stylised take on a square four-by-four. A tall slab of
 * a body on a high charcoal sill, a flat ribbed bonnet, a glasshouse of amber-tinted windows and
 * a glass roof, round headlamps ringed in glowing blue, a chevron on a slatted grille, a chunky
 * charcoal bumper with blue light strips, charcoal arches bolted over wide-set armoured wheels
 * whose hubs are turbines lit blue from within, and a tubular roof rack loaded with cases, cans
 * and a first-aid kit.
 *
 * Modelled facing +x, its right side toward +z, its wheels on the ground at y = 0; about 4.8 m
 * from bumper to tail, 2.7 m wide across the wheels and 2.3 m to the roof (3 m to the cargo).
 */

/** The body's paint, the trim's charcoal plastic, the lights' colours. */
export const CAR = {
  lime: 0xb2c04e,
  limeDark: 0x5c6608,
  trim: 0x5a5c5b,
  bumper: 0x454746,
  grille: 0x3c3e3d,
  glass: 0x6a5434,
  rack: 0x7a797b,
  steel: 0x8f989f,
  blue: 0x3fc4ff,
  amber: 0xffa424,
};

/** Where the wheels are: their centres along x, out to each side, their size and how they fold. */
export const WHEELS = {
  front: 1.42,
  rear: -1.66,
  side: 1.3,
  radius: 0.56,
  width: 0.3,
  /** How far each wheel is turned about the upright, its face toward the tail, as in the picture. */
  turn: 0.08,
  /** How far each wheel is tipped, its face turned down, folded for flight. */
  tilt: 0.42,
};

/** The body's lines along x and up y. */
export const BODY = {
  front: 2.24,
  rear: -2.62,
  /** The underside of the green body, and of the charcoal sills under it. */
  sill: 0.62,
  rocker: 0.44,
  /**
   * The bonnet's nose: from it the bonnet rises toward the windscreen, to the shoulder that runs
   * round the body at the windows' foot (`belt`).
   */
  waist: 1.48,
  /** The windscreen's foot, at the back of the bonnet. */
  cowl: 1.62,
  belt: 1.74,
  roof: 2.33,
  /** Half the width of the lower body, and of the glasshouse on it. */
  half: 1.0,
  cabinHalf: 0.95,
  /** The windscreen's foot and head along x. */
  screenFoot: 0.8,
  screenHead: 0.5,
};

const paint = () =>
  mat(CAR.lime, {
    mottle: 'paint',
    roughness: 0.45,
    metalness: 0.5,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
  });
const paintLine = () => mat(CAR.limeDark, { mottle: 'none', roughness: 0.6 });
const trim = () =>
  mat(CAR.trim, { mottle: 'plastic', roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.3 });
const bumperMat = () =>
  mat(CAR.bumper, { mottle: 'plastic', roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.3 });
const glass = () =>
  mat(CAR.glass, {
    mottle: 'none',
    roughness: 0.06,
    metalness: 0.15,
    envMapIntensity: 2.4,
    vertexColors: true,
  });
const steel = () => mat(CAR.steel, { mottle: 'metal', roughness: 0.28, metalness: 0.9 });
const dark = () => mat(0x1c1f21, { mottle: 'none', roughness: 0.9 });

/** The lower body: a slab from tail to nose, cut out over the wheels. */
function lowerBody(car: THREE.Group): void {
  const b = 0.08;
  const arch = (xc: number): [number, number][] => [
    [xc - 0.74, BODY.sill + b],
    [xc - 0.7, 0.98],
    [xc - 0.5, 1.3],
    [xc + 0.5, 1.3],
    [xc + 0.7, 0.98],
    [xc + 0.74, BODY.sill + b],
  ];
  // The rear arch runs out through the tail: the body's back corner is cut away over the wheel.
  const rearArch = arch(WHEELS.rear).filter(([x]) => x > BODY.rear + b + 0.05);
  const outline = roundedOutline(
    [
      [BODY.rear + b, 1.12, 0.01],
      ...rearArch,
      ...arch(WHEELS.front),
      [BODY.front - b, BODY.sill + b, 0.01],
      [BODY.front - b, BODY.waist - b, 0.02],
      [BODY.screenFoot + 0.04, BODY.cowl - b, 0.02],
      [BODY.screenFoot - 0.1, BODY.belt - b, 0.02],
      [BODY.rear + b, BODY.belt - b, 0.02],
    ],
    0.015,
  );
  // Its edges cut off flat, crisp as pressed steel, as the picture's are.
  put(car, slab(outline, BODY.half * 2, b, 12, 1), paint());
  // The wheel wells inside the arches, dark, so the arches are not tunnels.
  for (const xc of [WHEELS.front, WHEELS.rear])
    rbox(car, dark(), xc, 0.95, 0, 1.3, 0.6, BODY.half * 2 - 0.3, 0.05);
  // The underside between the sills.
  rbox(car, dark(), -0.05, 0.56, 0, 3.9, 0.2, 1.8, 0.05);
}

/** The glasshouse: the windscreen leaning back, the roof flat, the tail square. */
function cabin(car: THREE.Group): void {
  const b = 0.08;
  const outline = roundedOutline(
    [
      [BODY.rear + b, BODY.cowl - 0.05, 0.01],
      [BODY.screenFoot - b, BODY.cowl - 0.05, 0.01],
      [BODY.screenHead - b, BODY.roof - b, 0.04],
      [BODY.rear + b, BODY.roof - b, 0.04],
    ],
    0.015,
  );
  put(car, slab(outline, BODY.cabinHalf * 2, b, 12, 1), paint());
}

/**
 * A pane of glass in a rounded outline, lying in its local x-y plane: lighter at its head, where
 * it catches the sky, darker at its foot.
 */
function pane(car: THREE.Group, shape: THREE.Shape): THREE.Mesh {
  const geo = slab(shape, 0.02, 0.008, 8);
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox!;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - min.y) / (max.y - min.y || 1);
    const v = 0.5 + 0.6 * t * t;
    col.set([v, v * 0.97, v * 0.9], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return put(car, geo, glass());
}

/** The windows: the windscreen, three down each side, and the glass roof. */
function windows(car: THREE.Group): void {
  // The windscreen, along the leaning face from the foot to the head of the glasshouse.
  const foot = new THREE.Vector2(BODY.screenFoot, BODY.cowl);
  const head = new THREE.Vector2(BODY.screenHead, BODY.roof);
  const along = head.clone().sub(foot);
  const lean = Math.atan2(-along.x, along.y);
  const mid = foot.clone().add(head).multiplyScalar(0.5);
  const normal = new THREE.Vector2(along.y, -along.x).normalize();
  const screen = pane(car, roundRect(1.66, along.length() - 0.2, 0.1));
  screen.rotation.order = 'ZYX';
  screen.rotation.set(0, Math.PI / 2, lean);
  screen.position.set(mid.x + normal.x * 0.006, mid.y + normal.y * 0.006 + 0.03, 0);
  // Down each side: the front door's, its front edge leaning with the windscreen, the back
  // door's, and the hold's.
  const slope = -along.x / along.y;
  const at = (y: number) => BODY.screenFoot - 0.16 - slope * (y - BODY.cowl);
  const [y0, y1] = [BODY.belt + 0.03, BODY.roof - 0.18];
  const sideWindows: [number, number][][] = [
    [
      [-0.39, y0],
      [at(y0), y0],
      [at(y1), y1],
      [-0.39, y1],
    ],
    [
      [-1.31, y0],
      [-0.51, y0],
      [-0.51, y1],
      [-1.31, y1],
    ],
    [
      [-2.42, y0],
      [-1.41, y0],
      [-1.41, y1],
      [-2.42, y1],
    ],
  ];
  for (const side of [-1, 1])
    for (const w of sideWindows)
      pane(car, roundedOutline(w, 0.06)).position.z = side * (BODY.cabinHalf + 0.004);
  // The glass roof, from the windscreen's head back under the rack.
  const roof = pane(car, roundRect(1.2, 1.6, 0.12));
  roof.rotation.set(-Math.PI / 2, 0, 0);
  roof.position.set(-0.3, BODY.roof + 0.004, 0);
}

/** The bonnet's height at `x`: rising from its nose back to the windscreen's foot. */
export function bonnetAt(x: number): number {
  const t = (BODY.front - x) / (BODY.front - BODY.screenFoot);
  return BODY.waist + (BODY.cowl - BODY.waist) * Math.min(1, Math.max(0, t));
}

/** The bonnet: four raised ribs along its slope, and vents at its back corners. */
function bonnet(car: THREE.Group): void {
  const x0 = BODY.screenFoot + 0.12;
  const x1 = BODY.front - 0.1;
  const tilt = -Math.atan2(BODY.cowl - BODY.waist, BODY.front - BODY.screenFoot);
  const mid = (x0 + x1) / 2;
  const len = (x1 - x0) / Math.cos(tilt);
  for (const z of [-0.66, -0.22, 0.22, 0.66]) {
    cbox(car, paint(), mid, bonnetAt(mid) + 0.02, z, len, 0.07, 0.28, 0.025, [0, 0, tilt]);
    // A small dark notch on each rib's nose.
    const notch = new THREE.Shape();
    notch.moveTo(0, 0.06);
    notch.lineTo(-0.05, -0.04);
    notch.lineTo(0.05, -0.04);
    notch.closePath();
    const nx = x1 - 0.12;
    const on = new THREE.Group();
    on.position.set(nx, bonnetAt(nx) + 0.02, z);
    on.rotation.z = tilt;
    car.add(on);
    putSlab(on, notch, 0.012, paintLine(), 0.002, 0, 0.036, 0, -Math.PI / 2, 0, -Math.PI / 2);
  }
  // Slatted vents on the shoulders just ahead of the windscreen.
  for (const side of [-1, 1])
    for (let i = 0; i < 4; i++) {
      const x = x0 + i * 0.06;
      rbox(car, paintLine(), x, bonnetAt(x) + 0.0, side * 0.92, 0.025, 0.04, 0.14, 0.008);
    }
}

/** The nose: the grille and its chevron, the ringed headlamps, the amber lamps by the grille. */
function nose(car: THREE.Group): void {
  const x = BODY.front;
  // The grille: a dark recess, slats across it, and the chevron over them.
  rbox(car, mat(CAR.grille, { roughness: 0.75 }), x - 0.01, 1.05, 0, 0.06, 0.52, 0.84, 0.03);
  for (let i = 0; i < 8; i++)
    rbox(
      car,
      mat(0x272a2b, { roughness: 0.8 }),
      x + 0.025,
      0.84 + i * 0.06,
      0,
      0.03,
      0.026,
      0.72,
      0.008,
    );
  const chevron = new THREE.Shape();
  for (const [i, [px, py]] of (
    [
      [-0.27, 0.22],
      [-0.17, 0.22],
      [0, -0.08],
      [0.17, 0.22],
      [0.27, 0.22],
      [0, -0.24],
    ] as const
  ).entries())
    if (i === 0) chevron.moveTo(px, py);
    else chevron.lineTo(px, py);
  chevron.closePath();
  const inner = new THREE.Shape();
  inner.moveTo(-0.055, 0.22);
  inner.lineTo(0.055, 0.22);
  inner.lineTo(0, 0.04);
  inner.closePath();
  for (const [s, d] of [
    [chevron, 0.05],
    [inner, 0.04],
  ] as const)
    putSlab(car, s, d, steel(), 0.012, x + 0.055, 1.07, 0, 0, Math.PI / 2, 0);
  for (const side of [-1, 1]) {
    // The headlamps: a dark round housing, a glowing blue ring, a dark lens inside it.
    const z = side * 0.72;
    put(
      car,
      new THREE.CylinderGeometry(0.17, 0.18, 0.06, 32),
      mat(0x1d2124, { roughness: 0.5 }),
      x + 0.01,
      1.2,
      z,
      0,
      0,
      Math.PI / 2,
    );
    put(
      car,
      new THREE.TorusGeometry(0.135, 0.02, 10, 40),
      glow(CAR.blue, 4),
      x + 0.04,
      1.2,
      z,
      0,
      Math.PI / 2,
      0,
    );
    put(
      car,
      new THREE.CylinderGeometry(0.11, 0.11, 0.02, 28),
      mat(0x15191c, { roughness: 0.15, mottle: 'none', envMapIntensity: 1.5 }),
      x + 0.035,
      1.2,
      z,
      0,
      0,
      Math.PI / 2,
    );
    // An amber lamp low beside the grille, a little trapezium.
    const lamp = new THREE.Shape();
    lamp.moveTo(-0.07, -0.035);
    lamp.lineTo(0.07, -0.035);
    lamp.lineTo(0.05, 0.035);
    lamp.lineTo(-0.05, 0.035);
    lamp.closePath();
    putSlab(
      car,
      lamp,
      0.03,
      glow(CAR.amber, 2.2),
      0.005,
      x + 0.01,
      1.02,
      side * 0.56,
      0,
      Math.PI / 2,
      0,
    );
  }
}

/**
 * The bumper: a heavy charcoal bar low across the nose, its ends tall blocks wrapping the corners
 * out past the body, a blue strip low on each.
 */
function bumper(car: THREE.Group): void {
  const x = BODY.front;
  cbox(car, bumperMat(), x + 0.14, 0.56, 0, 0.36, 0.36, 1.3, 0.05);
  // A slot along the middle bar's face.
  cbox(
    car,
    mat(0x1d2022, { roughness: 0.9, mottle: 'none' }),
    x + 0.31,
    0.6,
    0,
    0.04,
    0.06,
    0.95,
    0.015,
  );
  for (const side of [-1, 1]) {
    // The corner block, seen from above: square at the back, its outer front corner cut off.
    const plan = new THREE.Shape(
      (
        [
          [x - 0.18, 0.56],
          [x + 0.3, 0.56],
          [x + 0.3, 0.96],
          [x + 0.12, 1.16],
          [x - 0.18, 1.16],
        ] as const
      ).map(([px, pz]) => new THREE.Vector2(px, -side * pz)),
    );
    // Stood up: the plan's y runs to -z, its depth up y.
    const block = put(car, slab(plan, 0.6, 0.035, 12, 1), bumperMat(), 0, 0.68, 0);
    block.rotation.x = -Math.PI / 2;
    cbox(car, glow(CAR.blue, 3.5), x + 0.305, 0.48, side * 0.76, 0.02, 0.035, 0.32, 0.01);
  }
}

/** A charcoal arch bolted round a wheel, standing out from the body over the tyre. */
function flare(car: THREE.Group, xc: number, side: number): void {
  const yc = WHEELS.radius - 0.03;
  const outline = roundedOutline(
    [
      [-0.78, -0.02],
      [-0.75, 0.4],
      [-0.52, 0.74],
      [0.52, 0.74],
      [0.75, 0.4],
      [0.78, -0.02],
      [0.68, -0.02],
      [0.66, 0.36],
      [0.46, 0.65],
      [-0.46, 0.65],
      [-0.66, 0.36],
      [-0.68, -0.02],
    ],
    0.008,
  );
  // A band of moulded plastic, its corners sharp and its edges cut off flat.
  put(car, slab(outline, 0.28, 0.025, 12, 1), trim()).position.set(xc, yc, side * 1.2);
  // Bolts round its face.
  const bolt = new THREE.CylinderGeometry(0.022, 0.026, 0.02, 10);
  for (const [bx, by] of [
    [-0.71, 0.2],
    [-0.61, 0.53],
    [-0.3, 0.71],
    [0.3, 0.71],
    [0.61, 0.53],
    [0.71, 0.2],
  ])
    put(
      car,
      bolt,
      mat(0x2a2e30, { roughness: 0.5, metalness: 0.3 }),
      xc + bx!,
      yc + by!,
      side * 1.345,
      Math.PI / 2,
      0,
      0,
    );
}

/** The sills between the arches, and the panel lines, handles and mirrors down each side. */
function sides(car: THREE.Group): void {
  const x0 = WHEELS.rear + 0.66;
  const x1 = WHEELS.front - 0.66;
  for (const side of [-1, 1]) {
    // The sill: a tall charcoal panel between the arches, its foot tucked under.
    cbox(
      car,
      trim(),
      (x0 + x1) / 2,
      (BODY.rocker + 0.92) / 2,
      side * (BODY.half + 0.02),
      x1 - x0,
      0.92 - BODY.rocker,
      0.14,
      0.05,
    );
    cbox(
      car,
      trim(),
      (x0 + x1) / 2 - 0.04,
      0.8,
      side * (BODY.half + 0.085),
      x1 - x0 - 0.3,
      0.14,
      0.03,
      0.012,
    );
    const face = side * (BODY.half + 0.002);
    const cabinFace = side * (BODY.cabinHalf + 0.002);
    const line = (x: number, y0: number, y1: number, zf: number) =>
      rbox(car, paintLine(), x, (y0 + y1) / 2, zf, 0.014, y1 - y0, 0.01, 0.003);
    // The doors' seams, up the body and on up the glasshouse.
    line(0.5, 0.95, bonnetAt(0.5) - 0.05, face);
    line(-0.45, 0.95, BODY.belt - 0.05, face);
    line(-1.36, 0.95, BODY.belt - 0.05, face);
    line(-0.45, BODY.belt + 0.02, BODY.roof - 0.1, cabinFace);
    line(-1.36, BODY.belt + 0.02, BODY.roof - 0.1, cabinFace);
    // A crease along the doors.
    rbox(car, paintLine(), -0.3, 1.12, face, 2.2, 0.012, 0.01, 0.003);
    // Handles, and a fuel flap at the back.
    for (const hx of [0.36, -0.56])
      rbox(
        car,
        mat(0x30353a, { roughness: 0.5 }),
        hx,
        1.62,
        face + side * 0.012,
        0.16,
        0.04,
        0.025,
        0.012,
      );
    rbox(car, paintLine(), -1.75, 1.3, face + side * 0.004, 0.2, 0.14, 0.01, 0.02);
    // The mirror: an arm out from the windscreen's foot, a charcoal case, an amber repeater.
    cbox(
      car,
      trim(),
      0.62,
      BODY.belt - 0.06,
      side * (BODY.cabinHalf + 0.12),
      0.07,
      0.06,
      0.24,
      0.02,
    );
    cbox(
      car,
      trim(),
      0.58,
      BODY.belt - 0.0,
      side * (BODY.cabinHalf + 0.26),
      0.13,
      0.32,
      0.18,
      0.045,
    );
    rbox(
      car,
      glow(CAR.amber, 2),
      0.645,
      BODY.belt - 0.13,
      side * (BODY.cabinHalf + 0.28),
      0.03,
      0.04,
      0.11,
      0.01,
    );
  }
}

/**
 * A wheel as the picture draws it, a flying car's hover pod: an open drum of dark gunmetal,
 * armoured with angular plates of polished steel that wrap its band and fold over its face, and
 * inside it a turbine of twisted blades round a domed hub, lit pale cyan from behind. Its axle
 * runs along z, its face toward +z.
 */
export function makeWheel(): THREE.Group {
  const w = new THREE.Group();
  const r = WHEELS.radius - 0.08;
  const inner = 0.35;
  const hw = WHEELS.width / 2;
  // Metals show what they mirror: these see the studio brighter than the paint does.
  const gunmetal = mat(0x3a3f44, {
    mottle: 'metal',
    roughness: 0.4,
    metalness: 0.8,
    envMapIntensity: 1.8,
  });
  const polished = mat(0xd4d9de, {
    mottle: 'metal',
    roughness: 0.32,
    metalness: 0.6,
    envMapIntensity: 2,
  });
  const bladeMetal = mat(0x6a737a, {
    mottle: 'metal',
    roughness: 0.3,
    metalness: 0.9,
    envMapIntensity: 2.2,
  });
  // The drum: open right through, a rounded lip at its face.
  const drum = new THREE.LatheGeometry(
    [
      [inner, -hw],
      [r - 0.02, -hw],
      [r, -hw + 0.03],
      [r, hw - 0.03],
      [r - 0.02, hw],
      [inner + 0.03, hw],
      [inner, hw - 0.03],
      [inner, -hw],
    ].map(([a, b]) => new THREE.Vector2(a, b)),
    56,
  );
  drum.rotateX(Math.PI / 2);
  put(w, drum, gunmetal);
  // Light inside it: a pale cyan band round the drum's inside, and a glowing back behind the
  // turbine.
  const band = new THREE.CylinderGeometry(inner - 0.004, inner - 0.004, hw * 1.2, 48, 1, true);
  band.rotateX(Math.PI / 2);
  put(
    w,
    band,
    mat(0x9fe6ff, {
      emissive: 0x6fd8ff,
      emissiveIntensity: 0.45,
      mottle: 'none',
      side: THREE.BackSide,
    }),
    0,
    0,
    -hw * 0.2,
  );
  put(
    w,
    new THREE.CircleGeometry(inner, 48),
    mat(0x0d1519, { roughness: 0.7, mottle: 'none' }),
    0,
    0,
    -hw + 0.06,
  );
  const halo = new THREE.TorusGeometry(inner - 0.07, 0.045, 10, 56);
  put(w, halo, glow(0xa8ecff, 1.8), 0, 0, -hw + 0.1);
  put(w, new THREE.TorusGeometry(0.16, 0.03, 8, 40), glow(0x7fdcff, 1.4), 0, 0, -hw + 0.1);
  // The armour: a closed ring of polished steel round the band, faceted like bent sheet, and on
  // it six plates with seams between, each with a flap folded over the face, a darker plate
  // riveted on it, slots and rivets; some run on past the drum as a fin.
  const at = (rad: number, a: number) => new THREE.Vector2(Math.cos(a) * rad, Math.sin(a) * rad);
  const facets = 18;
  const polygon = (rad: number) =>
    Array.from({ length: facets }, (_, k) => at(rad, (k / facets) * Math.PI * 2));
  const ring = new THREE.Shape(polygon(r + 0.018));
  ring.holes.push(new THREE.Path(polygon(r - 0.02).reverse()));
  putSlab(w, ring, WHEELS.width + 0.04, polished, 0.01);
  const plates = 6;
  for (let i = 0; i < plates; i++) {
    const a0 = (i / plates) * Math.PI * 2 + 0.35;
    const a1 = a0 + (Math.PI * 2) / plates - 0.12;
    const steps = 2;
    // Round the band: flat facets, so the plate reads as bent sheet, not a turned ring.
    const outer: THREE.Vector2[] = [];
    for (let k = 0; k <= steps; k++) outer.push(at(r + 0.032, a0 + ((a1 - a0) * k) / steps));
    const under: THREE.Vector2[] = [];
    for (let k = steps; k >= 0; k--) under.push(at(r - 0.005, a0 + ((a1 - a0) * k) / steps));
    putSlab(w, new THREE.Shape([...outer, ...under]), WHEELS.width + 0.06, polished, 0.012);
    // The flap folded over the face: from the band in toward the opening, its ends cut square.
    const flap = new THREE.Shape([
      at(r + 0.045, a0),
      at(r + 0.045, a1),
      at(inner + 0.05, a1 - 0.06),
      at(inner + 0.05, a0 + 0.06),
    ]);
    putSlab(w, flap, 0.04, polished, 0.01, 0, 0, hw + 0.025);
    // A darker plate set into the flap, and on it a slot and rivets.
    const mid = (a0 + a1) / 2;
    const insetShape = new THREE.Shape([
      at(r - 0.01, a0 + 0.1),
      at(r - 0.01, a1 - 0.1),
      at(inner + 0.07, a1 - 0.14),
      at(inner + 0.07, a0 + 0.14),
    ]);
    putSlab(w, insetShape, 0.02, gunmetal, 0.005, 0, 0, hw + 0.05);
    const slot = put(
      w,
      new THREE.BoxGeometry(0.06, 0.016, 0.01),
      mat(0x14171a, { mottle: 'none' }),
    );
    slot.position.set(Math.cos(mid) * (r - 0.06), Math.sin(mid) * (r - 0.06), hw + 0.064);
    slot.rotation.z = mid + Math.PI / 2;
    for (const e of [a0 + 0.06, a1 - 0.06]) {
      const rivet = put(w, new THREE.CylinderGeometry(0.011, 0.011, 0.012, 8), polished);
      rivet.rotation.x = Math.PI / 2;
      rivet.position.set(Math.cos(e) * (r + 0.01), Math.sin(e) * (r + 0.01), hw + 0.05);
    }
    // A step across the band, where two sheets overlap.
    const step = put(w, new THREE.BoxGeometry(0.035, 0.022, WHEELS.width + 0.07), polished);
    step.position.set(Math.cos(mid + 0.15) * (r + 0.055), Math.sin(mid + 0.15) * (r + 0.055), 0);
    step.rotation.z = mid + 0.15;
    if (i % 3 === 0) {
      // The fin: a bracket running on past the drum from the plate's leading end.
      const fin = new THREE.Shape([
        at(r - 0.02, a0 - 0.02),
        at(r + 0.17, a0 - 0.02),
        at(r + 0.19, a0 + 0.1),
        at(r + 0.04, a0 + 0.16),
      ]);
      putSlab(w, fin, 0.08, polished, 0.012, 0, 0, hw - 0.02);
    }
  }
  // The turbine: twisted blades round a domed hub.
  const blades = 8;
  for (let i = 0; i < blades; i++) {
    const blade = new THREE.Group();
    blade.rotation.z = (i / blades) * Math.PI * 2 + 0.2;
    blade.position.z = hw * 0.25;
    w.add(blade);
    const b = put(
      blade,
      new THREE.BoxGeometry(0.27, 0.11, 0.02),
      bladeMetal,
      0.19,
      0,
      0,
      0.75,
      0,
      0.12,
    );
    b.castShadow = false;
  }
  const hub = new THREE.CylinderGeometry(0.075, 0.1, 0.16, 24);
  hub.rotateX(Math.PI / 2);
  put(w, hub, gunmetal, 0, 0, hw * 0.25);
  const dome = new THREE.SphereGeometry(0.075, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.rotateX(Math.PI / 2);
  put(w, dome, polished, 0, 0, hw * 0.25 + 0.08);
  return w;
}

/** The roof rack: two rails of tube round the roof on posts, crossbars, feet on green pads. */
function rack(car: THREE.Group): THREE.Group {
  const g = new THREE.Group();
  car.add(g);
  const m = mat(CAR.rack, { mottle: 'metal', roughness: 0.38, metalness: 0.2 });
  const [x0, x1] = [-2.4, 0.26];
  const zw = 0.86;
  const low = BODY.roof + 0.2;
  const high = low + 0.2;
  const loop = (y: number, inset: number) =>
    bentPath(
      [
        new THREE.Vector3(x1 - inset, y, -zw + inset),
        new THREE.Vector3(x1 - inset, y, zw - inset),
        new THREE.Vector3(x0 + inset, y, zw - inset),
        new THREE.Vector3(x0 + inset, y, -zw + inset),
      ],
      0.18,
      true,
    );
  tube(g, loop(low, 0), 0.034, m, true);
  tube(g, loop(high, 0.04), 0.034, m, true);
  // Posts between the rails down each side and across the ends.
  for (const side of [-1, 1])
    for (const x of [-1.96, -1.4, -0.84, -0.28])
      tube(
        g,
        new THREE.LineCurve3(
          new THREE.Vector3(x, low, side * zw),
          new THREE.Vector3(x, high, side * (zw - 0.04)),
        ),
        0.024,
        m,
      );
  for (const z of [-0.4, 0.4]) {
    tube(
      g,
      new THREE.LineCurve3(new THREE.Vector3(x1, low, z), new THREE.Vector3(x1 - 0.04, high, z)),
      0.024,
      m,
    );
    tube(
      g,
      new THREE.LineCurve3(new THREE.Vector3(x0, low, z), new THREE.Vector3(x0 + 0.04, high, z)),
      0.024,
      m,
    );
  }
  // Crossbars the load sits on.
  for (const x of [-1.7, -1.05, -0.4])
    tube(
      g,
      new THREE.LineCurve3(
        new THREE.Vector3(x, low - 0.02, -zw),
        new THREE.Vector3(x, low - 0.02, zw),
      ),
      0.026,
      m,
    );
  // Feet: a green pad on the roof's edge, a steel post up to the lower rail.
  for (const side of [-1, 1])
    for (const x of [-1.96, -0.94, 0.06]) {
      rbox(
        car,
        paint(),
        x,
        BODY.roof + 0.02,
        side * (BODY.cabinHalf - 0.06),
        0.24,
        0.1,
        0.16,
        0.04,
      );
      put(
        car,
        new THREE.CylinderGeometry(0.03, 0.035, 0.14, 12),
        steel(),
        x,
        BODY.roof + 0.12,
        side * zw,
      );
      rbox(car, steel(), x, BODY.roof + 0.075, side * zw, 0.09, 0.04, 0.09, 0.012);
    }
  return g;
}

export interface Car {
  root: THREE.Group;
  wheels: THREE.Group[];
}

/** Builds the car, standing at the origin facing +x. */
export function buildCar(): Car {
  const car = new THREE.Group();
  car.name = 'car';
  lowerBody(car);
  cabin(car);
  windows(car);
  bonnet(car);
  nose(car);
  bumper(car);
  sides(car);
  const wheels: THREE.Group[] = [];
  for (const xc of [WHEELS.front, WHEELS.rear])
    for (const side of [-1, 1]) {
      flare(car, xc, side);
      const w = makeWheel();
      w.position.set(xc, WHEELS.radius, side * WHEELS.side);
      // Both sides folded alike, mirrored.
      w.rotation.set(WHEELS.tilt, side < 0 ? Math.PI + WHEELS.turn : -WHEELS.turn, 0, 'YXZ');
      // Down onto the ground, tipped as it is, its armour resting on it.
      w.updateMatrixWorld(true);
      w.position.y -= new THREE.Box3().setFromObject(w).min.y;
      car.add(w);
      wheels.push(w);
    }
  rack(car);
  const cargo = buildCargo();
  cargo.position.y = BODY.roof + 0.2;
  car.add(cargo);
  return { root: car, wheels };
}
