import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR, WHEELS, archCut, chevronShape, flare, makeWheel, shutLine, weather } from './car.ts';
import type { Car } from './car.ts';
import { dashPlastic, dashScreen, leather as cabinLeather, seat, steeringWheel } from './cabin.ts';
import { glazedShell } from './glazing.ts';
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

/** Its paint, and its seams' dark groove and light lip in that paint. */
export const SPORT = {
  red: 0xc42a22,
  seam: 0x3a0c0a,
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
  /** Half the glasshouse's width. */
  cabinHalf: 0.74,
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
const seam = () => mat(SPORT.seam, { mottle: 'none', roughness: 0.85 });
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

/** Where a line straight down at (`x`, `z`) meets `mesh`'s top, and the surface's normal there. */
function onTop(mesh: THREE.Mesh, x: number, z: number): { p: THREE.Vector3; n: THREE.Vector3 } {
  ray.set(new V(x, 5, z), new V(0, -1, 0));
  const hit = ray.intersectObject(mesh, false)[0]!;
  return { p: hit.point.clone(), n: hit.face!.normal.clone() };
}

/** A shut line over `mesh`'s top, through the points straight above each of `at` (x, z). */
function seamOver(car: THREE.Group, mesh: THREE.Mesh, at: [number, number][]): void {
  const hits = at.map(([x, z]) => onTop(mesh, x, z));
  for (let i = 0; i < hits.length - 1; i++) {
    const [a, b] = [hits[i]!, hits[i + 1]!];
    shutLine(car, a.p, b.p, a.n.clone().add(b.n).normalize(), seam(), lip());
  }
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

/** `n` + 1 evenly spaced values from `a` to `b`. */
const steps = (a: number, b: number, n: number) =>
  Array.from({ length: n + 1 }, (_, k) => a + ((b - a) * k) / n);

/**
 * The body: one slab across the car's width, its side the coupé's profile, low at the nose,
 * swelling over each wheel, cut out over the wheels.
 */
function body(car: THREE.Group): THREE.Mesh {
  const { front, rear, sill, half } = SPORT_BODY;
  const b = 0.04;
  const yc = (WHEELS.radius - 0.03) * SCALE;
  const outline = roundedOutline(
    [
      [rear + b, sill + b, 0.02],
      ...archCut(SPORT_WHEELS.rear, sill + b, SCALE, yc),
      ...archCut(SPORT_WHEELS.front, sill + b, SCALE, yc),
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
  );
  // Narrowing a little toward its nose, and less toward its tail, ahead of and behind the wheels.
  const shell = new THREE.Group();
  const m = put(shell, weather(slab(outline, half * 2, b), 'slab', false, WORN), paint());
  bend(shell, (p) => {
    const nose = THREE.MathUtils.smoothstep(p.x, SPORT_WHEELS.front + 0.5, front);
    const tail = THREE.MathUtils.smoothstep(-p.x, -SPORT_WHEELS.rear + 0.5, -rear);
    p.z *= 1 - 0.1 * nose - 0.05 * tail;
  });
  car.add(m);
  // The wells inside the arches, dark, and the underside.
  for (const xc of [SPORT_WHEELS.front, SPORT_WHEELS.rear])
    rbox(car, dark(), xc, 0.66, 0, 1.0, 0.56, half * 2 - 0.3, 0.05);
  rbox(car, dark(), -0.05, 0.32, 0, 4.2, 0.08, half * 2 - 0.2, 0.03);
  m.updateMatrixWorld(true);
  return m;
}

/**
 * The glasshouse: a short raked cabin narrower than the body, standing on its shoulders, hollow,
 * its glass set into it: the windscreen and the fastback's window sunk between the pillars, and
 * a side window in two panes each side, each in an opening its frame rolls into. Inside, two
 * bucket seats sunk low, the wheel, and a dashboard lit cyan.
 */
function glasshouse(car: THREE.Group): void {
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
  // The side windows' openings: a long one behind the windscreen's pillar and a small quarter
  // window, a slim pillar between them. The frame rolls into each, `b` deep all round.
  const openings: [number, number][][] = [
    [
      [0.56, 1.04],
      [-0.04, 1.33],
      [-0.58, 1.33],
      [-0.58, 1.04],
    ],
    [
      [-0.62, 1.04],
      [-0.62, 1.32],
      [-0.71, 1.32],
      [-1.38, 1.13],
      [-1.25, 1.065],
    ],
  ];
  const cabin = glazedShell({
    outline,
    openings: openings.map((o) => roundedOutline(o, 0.04)),
    half: cabinHalf,
    pillar: 0.16,
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
    },
  });
  // Its sides leaning in toward the roof, the glass with them.
  bend(cabin, (p) => {
    p.z *= 1 - 0.2 * THREE.MathUtils.clamp((p.y - 0.92) / (roof - 0.92), 0, 1);
  });
  for (const m of [...cabin.children]) car.add(m);
  cockpit(car);
}

/**
 * Inside: two bucket seats sunk low into the body, their backs and headrests up in the windows;
 * the dashboard under the windscreen, its screens glowing; and the wheel before the left seat.
 */
function cockpit(car: THREE.Group): void {
  const tan = cabinLeather(0x8a4a2a);
  for (const z of [-0.3, 0.3])
    seat(car, tan, -0.36, 0.8, z, 0.7, { w: 0.46, back: 0.34, recline: 0.32 });
  cbox(car, dashPlastic(), -0.2, 0.9, 0, 0.6, 0.16, 0.16, 0.03);
  cbox(car, dashPlastic(), 0.42, 1.0, 0, 0.32, 0.12, 1.0, 0.03);
  dashScreen(car, 0.25, 1.03, -0.3, 0.24, 0.07, 0.3);
  dashScreen(car, 0.25, 1.02, 0.06, 0.26, 0.09, 0.3);
  steeringWheel(car, 0.14, 1.1, -0.3, 0.13, 0.6, 0.2);
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

/** The bonnet's shut lines all round it, and two vents of dark slats ahead of the windscreen. */
function bonnet(car: THREE.Group, shell: THREE.Mesh): void {
  const [back, front, edge] = [1.04, 2.12, 0.6];
  for (const side of [-1, 1])
    seamOver(
      car,
      shell,
      steps(back, front, 8).map((x) => [x, side * edge]),
    );
  seamOver(
    car,
    shell,
    steps(-edge, edge, 6).map((z) => [back, z]),
  );
  seamOver(
    car,
    shell,
    steps(-edge, edge, 6).map((z) => [front, z]),
  );
  for (const side of [-1, 1])
    for (let i = 0; i < 5; i++) {
      const { p, n } = onTop(shell, 1.18 + i * 0.07, side * 0.32);
      const slot = rbox(
        car,
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
}

/**
 * The sides: charcoal skirts between the arches lit along their foot, the doors' seams and a
 * handle, a dark intake behind each door, and a small mirror on a charcoal arm.
 */
function sides(car: THREE.Group, shell: THREE.Mesh): void {
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
    // Each door seam runs up the side to just under the shoulder's roll.
    for (const x of [0.62, -0.5]) {
      const top = onTop(shell, x, side * (half - 0.08)).p.y - 0.06;
      shutLine(car, new V(x, 0.44, face), new V(x, top, face), new V(0, 0, side), seam(), lip());
    }
    rbox(car, lip(), -0.36, 0.84, face, 0.17, 0.05, 0.012, 0.01);
    rbox(
      car,
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
    // The mirror.
    cbox(car, trim(), 0.6, 1.02, side * (SPORT_BODY.cabinHalf + 0.1), 0.06, 0.04, 0.2, 0.015);
    cbox(car, trim(), 0.56, 1.08, side * (SPORT_BODY.cabinHalf + 0.24), 0.14, 0.12, 0.18, 0.03);
    cbox(
      car,
      glow(CAR.amber, 1.2),
      0.6,
      1.04,
      side * (SPORT_BODY.cabinHalf + 0.33),
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
function tail(car: THREE.Group, shell: THREE.Mesh): void {
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
  // The wing: a charcoal blade tipped up at its trailing edge, end plates, two posts down to the
  // deck.
  const wingX = -2.06;
  const deck = onTop(shell, wingX, 0.45).p.y;
  const wingY = deck + 0.24;
  cbox(car, bumperMat(), wingX, wingY, 0, 0.4, 0.05, SPORT_BODY.half * 2 - 0.1, 0.02, [0, 0, 0.1]);
  for (const side of [-1, 1]) {
    cbox(
      car,
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
      car,
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
  const shell = body(car);
  glasshouse(car);
  bonnet(car, shell);
  nose(car);
  sides(car, shell);
  tail(car, shell);
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
