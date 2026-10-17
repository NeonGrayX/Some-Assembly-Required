import * as THREE from 'three';
import {
  cbox,
  bentPath,
  glow,
  mat,
  put,
  putSlab,
  rbox,
  roundedOutline,
  slab,
  tube,
} from './kit.ts';
import { buildCargo } from './cargo.ts';
import { Surface, madeOf } from '../render/styles.ts';

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
  lime: 0xb2bb68,
  limeDark: 0x6a6a08,
  trim: 0x4a4a4c,
  bumper: 0x4d4b4a,
  flare: 0x5e6062,
  grille: 0x3c3e3d,
  glass: 0x2e2018,
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
  radius: 0.5,
  width: 0.33,
  /** How far each wheel is turned about the upright (toward the tail if positive): turned to the nose, as in the picture. */
  turn: 0,
  /** How far each wheel is tipped, its face turned down: its top kicked out, its foot tucked in. */
  tilt: 0.4,
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
  waist: 1.52,
  /** The windscreen's foot, at the back of the bonnet. */
  cowl: 1.58,
  belt: 1.62,
  roof: 2.33,
  /** Half the width of the lower body, and of the glasshouse on it. */
  half: 1.0,
  cabinHalf: 0.95,
  /** The windscreen's foot and head along x. */
  screenFoot: 1.0,
  screenHead: 0.1,
};

const paint = () =>
  mat(CAR.lime, {
    mottle: 'paint',
    roughness: 0.45,
    metalness: 0.15,
    envMapIntensity: 1.4,
    clearcoat: 1,
    clearcoatRoughness: 0.2,
  });
/** The paint with its wear laid on in vertex colours (see `weather`). */
const paintWorn = () =>
  mat(CAR.lime, {
    mottle: 'paint',
    roughness: 0.45,
    metalness: 0.15,
    envMapIntensity: 1.4,
    clearcoat: 1,
    clearcoatRoughness: 0.2,
    vertexColors: true,
  });
const paintLine = () => mat(CAR.limeDark, { mottle: 'none', roughness: 0.6 });
/** A panel's shut line: deep, nearly black olive. */
const seam = () => mat(0x2a2e0c, { mottle: 'none', roughness: 0.85 });
/** The light lip along a seam's lower edge, where worn paint catches the light. */
const paintLip = () => mat(0xc8cc80, { mottle: 'none', roughness: 0.5 });
const trim = () => mat(CAR.trim, { mottle: 'plastic', roughness: 0.6 });
const bumperMat = () => mat(CAR.bumper, { mottle: 'plastic', roughness: 0.45 });
/** Tinted glass, seen through to the cabin behind it. */
const glass = () =>
  mat(CAR.glass, {
    mottle: 'none',
    roughness: 0.05,
    metalness: 0.15,
    envMapIntensity: 2.5,
    vertexColors: true,
    transparent: true,
    opacity: 0.88,
  });
const steel = () => mat(CAR.steel, { mottle: 'metal', roughness: 0.28, metalness: 0.9 });
const dark = () => mat(0x1c1f21, { mottle: 'none', roughness: 0.9 });

/**
 * Wear painted on in vertex colours, as the picture's is: edges lighter (by `edge`, a colour to
 * multiply by), where the paint is worn and catches the light; and, if `grime`, dirt darkening it
 * toward the sills and round the wheels. A `slab` is extruded along z, its bevels leaning out of
 * its faces; a `box` is a rounded box, its rounded edges' normals off its axes.
 */
export function weather(
  geo: THREE.BufferGeometry,
  kind: 'slab' | 'box',
  grime = false,
  edge: [number, number, number] = [1.22, 1.22, 2.2],
): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const [nx, ny, nz] = [Math.abs(nor.getX(i)), Math.abs(nor.getY(i)), Math.abs(nor.getZ(i))];
    const worn = kind === 'slab' ? nz > 0.15 && nz < 0.9 : Math.max(nx, ny, nz) < 0.96;
    const e = worn ? 1 : 0;
    let dirt = 1;
    if (grime) {
      const [x, y] = [pos.getX(i), pos.getY(i)];
      dirt = 1 - 0.4 * THREE.MathUtils.smoothstep(1.25 - y, 0, 0.6);
      for (const xc of [WHEELS.front, WHEELS.rear]) {
        const near = Math.max(0, 1 - Math.abs(x - xc) / 0.95) * (y < 1.4 ? 1 : 0);
        dirt *= 1 - 0.12 * near;
      }
    }
    col.set(
      edge.map((k) => (1 + (k - 1) * e) * dirt),
      i * 3,
    );
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** The arches' flares: their outer edge round the wheel's centre, at height `y`, and band. */
const FLARE = {
  y: WHEELS.radius - 0.03,
  band: 0.11,
  outer: [
    [-0.68, -0.05],
    [-0.66, 0.34],
    [-0.44, 0.7],
    [0.44, 0.7],
    [0.66, 0.34],
    [0.68, -0.05],
  ] as [number, number][],
};

/**
 * A body's arch cut over the wheel at `xc`, from its foot at height `foot` round to its foot
 * again: a little inside the outer edge of its flare (`scale`d, its centre `y` up), so the flare's
 * band covers the cut's edge and no gap shows between them.
 */
export function archCut(xc: number, foot: number, scale = 1, y = FLARE.y): [number, number][] {
  const outer = FLARE.outer.map(([x, h]): [number, number] => [x * scale, h * scale]);
  const run: [number, number][] = [
    [outer[0]![0], foot - y],
    ...outer.slice(1, -1),
    [outer[outer.length - 1]![0], foot - y],
  ];
  return insetRun(run, 0.04 * scale).map(([x, h]) => [xc + x, y + h]);
}

/** The lower body: a slab from tail to nose, cut out over the wheels. */
function lowerBody(car: THREE.Group): void {
  const b = 0.035;
  const arch = (xc: number) => archCut(xc, BODY.sill + b);
  const outline = roundedOutline(
    [
      [BODY.rear + b, BODY.sill + b, 0.01],
      ...arch(WHEELS.rear),
      ...arch(WHEELS.front),
      [BODY.front - b, BODY.sill + b, 0.01],
      // The bonnet's nose rolls over into the grille's surround.
      [BODY.front - b, BODY.waist - b, 0.08],
      [BODY.screenFoot + 0.04, BODY.cowl - b, 0.02],
      [BODY.screenFoot - 0.1, BODY.belt - b, 0.02],
      [BODY.rear + b, BODY.belt - b, 0.02],
    ],
    0.015,
  );
  // Its edges crisp, rounded only a little, as pressed steel: they catch a line of light.
  put(car, weather(slab(outline, BODY.half * 2, b), 'slab', true), paintWorn());
  // The wheel wells inside the arches, dark, so the arches are not tunnels.
  for (const xc of [WHEELS.front, WHEELS.rear])
    rbox(car, dark(), xc, 0.95, 0, 1.3, 0.6, BODY.half * 2 - 0.3, 0.05);
  // The underside between the sills.
  rbox(car, dark(), -0.05, 0.56, 0, 3.9, 0.2, 1.8, 0.05);
}

/** How far the glasshouse's sides lean in from its foot to the roof, each side (m). */
const TUMBLE = 0.04;

/**
 * A pane of glass in `shape`, lying in its local x-y plane: lighter at its head, where it
 * catches the sky, darker at its foot.
 */
export function pane(
  parent: THREE.Object3D,
  shape: THREE.Shape,
  material: THREE.Material = glass(),
): THREE.Mesh {
  const geo = slab(shape, 0.02, 0.006, 8);
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
  const m = put(parent, geo, material);
  m.castShadow = false;
  return m;
}

/** A trapezium `w0` wide at its foot and `w1` at its head, `h` tall, centred on the origin. */
function trapezium(w0: number, w1: number, h: number): THREE.Vector2[] {
  return [
    new THREE.Vector2(-w0 / 2, -h / 2),
    new THREE.Vector2(w0 / 2, -h / 2),
    new THREE.Vector2(w1 / 2, h / 2),
    new THREE.Vector2(-w1 / 2, h / 2),
  ];
}

/**
 * The glasshouse, hollow, as the picture's is seen through: thin painted sides with the windows
 * cut in them, leaning in a little toward the roof; the windscreen's frame, long and laid well
 * back; a roof round a glass panel; the tail; and inside, the cabin's brown trim, seats and
 * dashboard.
 */
function glasshouse(car: THREE.Group): void {
  const wall = 0.05;
  const base = BODY.cowl - 0.05;
  const top = BODY.roof;
  const foot = new THREE.Vector2(BODY.screenFoot, base);
  const head = new THREE.Vector2(BODY.screenHead, top);
  const along = head.clone().sub(foot);
  const slope = -along.x / along.y;
  // The windscreen's line: x along it at height y.
  const screenAt = (y: number) => BODY.screenFoot - slope * (y - base);
  const lean = Math.atan2(TUMBLE, top - BODY.belt);

  // The sides: the glasshouse's outline with the windows cut out.
  const b = 0.015;
  const [y0, y1] = [BODY.belt + 0.08, top - 0.16];
  // The windscreen's frame is thin; the door's pillar behind it, and those between the windows,
  // are broad.
  const pillar = 0.09;
  const aPillar = 0.14;
  const sideWindows: [number, number][][] = [
    [
      [-0.35, y0],
      [screenAt(y0) - aPillar, y0],
      [screenAt(y1) - aPillar, y1],
      [-0.35, y1],
    ],
    [
      [-1.27, y0],
      [-0.55, y0],
      [-0.55, y1],
      [-1.27, y1],
    ],
    [
      [-2.4, y0],
      [-1.47, y0],
      [-1.47, y1],
      [-2.4, y1],
    ],
  ];
  const outline = roundedOutline(
    [
      [BODY.rear + b, base, 0.01],
      [screenAt(base) - b, base, 0.01],
      [screenAt(top) - b, top - b, 0.03],
      [BODY.rear + b, top - b, 0.03],
    ],
    0.015,
  );
  for (const w of sideWindows) outline.holes.push(roundedOutline(w, 0.07));
  for (const side of [-1, 1]) {
    // Leaning in toward the roof: turned about the ground's line under the side, then moved out
    // so its foot is where it stands.
    const g = new THREE.Group();
    g.rotation.x = -side * lean;
    g.position.z = side * BODY.belt * Math.tan(lean);
    car.add(g);
    const z = side * (BODY.cabinHalf - wall / 2);
    put(g, weather(slab(outline, wall, b), 'slab'), paintWorn()).position.z = z;
    for (const w of sideWindows) pane(g, roundedOutline(w, 0.07)).position.z = z;
    // The doors' seams on up the glasshouse.
    for (const x of [-0.45, -1.37])
      groove(g, x, BODY.belt + 0.01, y1 + 0.04, side * BODY.cabinHalf, side);
  }

  // The windscreen's frame, a thin pillar round it, in the windscreen's leaning plane.
  const length = along.length();
  const wFoot = BODY.cabinHalf * 2;
  const wHead = wFoot - 2 * TUMBLE;
  const frame = new THREE.Shape(trapezium(wFoot, wHead, length));
  const hole = trapezium(wFoot - 2 * pillar, wHead - 2 * pillar, length - 0.12).map((p) =>
    p.add(new THREE.Vector2(0, -0.01)),
  );
  frame.holes.push(new THREE.Path(hole.slice().reverse()));
  const tilt = Math.atan2(-along.x, along.y);
  const mid = foot.clone().add(head).multiplyScalar(0.5);
  const inPlane = (m: THREE.Mesh, out: number) => {
    const normal = new THREE.Vector2(along.y, -along.x).normalize();
    m.rotation.order = 'ZYX';
    m.rotation.set(0, Math.PI / 2, tilt);
    m.position.set(mid.x + normal.x * out, mid.y + normal.y * out, 0);
  };
  inPlane(put(car, weather(slab(frame, wall, b), 'slab'), paintWorn()), -wall / 2);
  inPlane(pane(car, new THREE.Shape(hole)), -wall / 2);

  // The roof: a thin lid round a glass panel, narrowed with the sides.
  const roofHalf = BODY.cabinHalf - TUMBLE;
  const lid = new THREE.Shape([
    new THREE.Vector2(BODY.rear, -roofHalf),
    new THREE.Vector2(screenAt(top) - 0.02, -roofHalf),
    new THREE.Vector2(screenAt(top) - 0.02, roofHalf),
    new THREE.Vector2(BODY.rear, roofHalf),
  ]);
  const glassRoof = roundedOutline(
    [
      [-0.95, -0.72],
      [0.35, -0.72],
      [0.35, 0.72],
      [-0.95, 0.72],
    ],
    0.1,
  );
  lid.holes.push(glassRoof);
  const roof = put(car, weather(slab(lid, 0.06, b), 'slab'), paintWorn());
  roof.rotation.x = Math.PI / 2;
  roof.position.y = top - 0.03;
  // A short visor over the windscreen's head, in the roof's worn paint.
  const visor = put(
    car,
    weather(
      slab(
        roundedOutline(
          trapezium(wHead - 0.04, wHead - 0.1, 0.07).map((p) => [p.x, p.y]),
          0.02,
        ),
        0.025,
        0.008,
      ),
      'slab',
    ),
    paintWorn(),
  );
  // Laid flat across the car, reaching forward from the windscreen's head, out ahead of the
  // glass, and turned down a little at its front edge.
  visor.rotation.set(-Math.PI / 2, Math.PI / 2, 0, 'YXZ');
  visor.position.x = 0.035;
  const brow = new THREE.Group();
  brow.position.set(screenAt(top) + 0.02, top - 0.01, 0);
  brow.rotation.z = -Math.PI / 18;
  car.add(brow);
  brow.add(visor);
  const roofPane = pane(car, glassRoof);
  roofPane.rotation.x = Math.PI / 2;
  roofPane.position.y = top - 0.03;

  // The tail, solid, narrowed with the sides.
  const tail = new THREE.Shape(trapezium(wFoot, wHead, top - base));
  // The tailgate's window, cut through it as the side windows are.
  const tailMid = (top + base) / 2;
  const rearWindow: [number, number][] = [
    [-0.6, 1.72 - tailMid],
    [0.6, 1.72 - tailMid],
    [0.6, y1 - tailMid],
    [-0.6, y1 - tailMid],
  ];
  tail.holes.push(roundedOutline(rearWindow, 0.07));
  const back = put(car, weather(slab(tail, wall, b), 'slab'), paintWorn());
  back.rotation.y = Math.PI / 2;
  back.position.set(BODY.rear + wall / 2, tailMid, 0);
  const rearPane = pane(car, roundedOutline(rearWindow, 0.07));
  rearPane.rotation.y = Math.PI / 2;
  rearPane.position.set(BODY.rear + wall / 2, tailMid, 0);
  // Its handle under the window, a pocket with a lighter rim as the doors' are.
  rbox(car, paintLip(), BODY.rear, 1.44, 0, 0.012, 0.06, 0.24, 0.01);
  rbox(car, mat(0x23272a, { roughness: 0.6 }), BODY.rear - 0.002, 1.44, 0, 0.012, 0.04, 0.2, 0.008);
  // The tailgate's shut line, round it from the sill nearly to the roof.
  const V = THREE.Vector3;
  const behind = new V(-1, 0, 0);
  const [gx, gz, gy0, gy1] = [BODY.rear, 0.78, BODY.sill + 0.12, top - 0.14];
  const corners = [
    new V(gx, gy0, -gz),
    new V(gx, gy0, gz),
    new V(gx, gy1, gz),
    new V(gx, gy1, -gz),
  ];
  corners.forEach((c, k) => shutLine(car, c, corners[(k + 1) % 4]!, behind));

  // Inside: brown trim lining it (seen only from within), the dashboard, the seats, the wheel.
  const lining = mat(0x2a1e16, { mottle: 'plastic', roughness: 0.8, side: THREE.BackSide });
  const inX0 = BODY.rear + wall;
  const inX1 = BODY.screenHead;
  put(
    car,
    new THREE.BoxGeometry(inX1 - inX0, top - 0.06 - BODY.belt, (BODY.cabinHalf - wall) * 2 - 0.06),
    lining,
    (inX0 + inX1) / 2,
    (top - 0.06 + BODY.belt) / 2,
    0,
  ).castShadow = false;
  const leather = mat(0x4a3222, { mottle: 'plastic', roughness: 0.7 });
  const dash = mat(0x1a1614, { mottle: 'plastic', roughness: 0.75 });
  // The dashboard, its front tucked in behind the windscreen where it leans back over it.
  const dashFront = screenAt(BODY.belt + 0.2) - 0.05;
  cbox(car, dash, dashFront - 0.18, BODY.belt + 0.1, 0, 0.36, 0.2, 1.7, 0.04);
  for (const z of [-0.42, 0.42])
    cbox(car, leather, -0.12, BODY.belt + 0.3, z, 0.14, 0.6, 0.5, 0.06, [0, 0, -0.18]);
  cbox(car, leather, -1.12, BODY.belt + 0.26, 0, 0.14, 0.52, 1.6, 0.06, [0, 0, -0.12]);
  put(
    car,
    new THREE.TorusGeometry(0.15, 0.02, 8, 28),
    dash,
    screenAt(BODY.belt + 0.28) - 0.32,
    BODY.belt + 0.28,
    -0.42,
    0,
    Math.PI / 2,
    0,
  ).rotation.z = 0.5;
}

/**
 * A panel's shut line from `a` to `b` on a face looking along `out`: a dark groove, and beside it
 * a thin lip of worn paint catching the light.
 */
export function shutLine(
  parent: THREE.Object3D,
  a: THREE.Vector3,
  b: THREE.Vector3,
  out: THREE.Vector3,
  dark: THREE.Material = seam(),
  lip: THREE.Material = paintLip(),
): void {
  const along = b.clone().sub(a);
  const len = along.length();
  along.normalize();
  const lit = out.clone().cross(along).normalize();
  const turn = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(along, lit, out),
  );
  const mid = a.clone().add(b).multiplyScalar(0.5);
  rbox(parent, dark, mid.x, mid.y, mid.z, len, 0.024, 0.014, 0.004).quaternion.copy(turn);
  const at = mid.addScaledVector(lit, 0.017).addScaledVector(out, 0.001);
  rbox(parent, lip, at.x, at.y, at.z, len, 0.007, 0.01, 0.002).quaternion.copy(turn);
}

/** A door's seam, from `y0` up to `y1` at `x`, on the face at `z` (out toward `side`). */
function groove(
  parent: THREE.Object3D,
  x: number,
  y0: number,
  y1: number,
  z: number,
  side: number,
): void {
  const V = THREE.Vector3;
  shutLine(parent, new V(x, y0, z), new V(x, y1, z), new V(0, 0, side));
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
    cbox(car, paint(), mid, bonnetAt(mid) + 0.006, z, len, 0.042, 0.28, 0.02, [0, 0, tilt]);
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
    putSlab(on, notch, 0.012, paintLine(), 0.002, 0, 0.022, 0, -Math.PI / 2, 0, -Math.PI / 2);
  }
  // Its shut lines, all the way round: down each side just outboard of the ribs, over the
  // rounded nose, across the nose's face just above the lamps, and across its back ahead of the
  // windscreen.
  const V = THREE.Vector3;
  const up = new V(BODY.cowl - BODY.waist, BODY.front - BODY.screenFoot, 0).normalize();
  const roll = 0.115;
  const [back, front, edge] = [BODY.screenFoot + 0.06, BODY.front - roll, 0.815];
  const nosed = BODY.waist - roll;
  for (const side of [-1, 1]) {
    const z = side * edge;
    shutLine(car, new V(back, bonnetAt(back), z), new V(front, bonnetAt(front), z), up);
    // Over the nose's roll, in four short runs, each square to the curve it lies on.
    const at = (a: number) => new V(Math.cos(a), Math.sin(a), 0);
    for (let k = 0; k < 4; k++) {
      const [a0, a1] = [(Math.PI / 2) * (1 - k / 4), (Math.PI / 2) * (1 - (k + 1) / 4)];
      const p = (a: number) =>
        at(a)
          .multiplyScalar(roll)
          .add(new V(front, nosed, z));
      shutLine(car, p(a0), p(a1), at((a0 + a1) / 2));
    }
  }
  shutLine(car, new V(BODY.front, nosed, -edge), new V(BODY.front, nosed, edge), new V(1, 0, 0));
  shutLine(car, new V(back, bonnetAt(back), edge), new V(back, bonnetAt(back), -edge), up);
  // Slatted vents on the shoulders just ahead of the windscreen, outboard of the seams.
  for (const side of [-1, 1])
    for (let i = 0; i < 6; i++) {
      const x = BODY.screenFoot + 0.08 + i * 0.065;
      rbox(car, paintLine(), x, bonnetAt(x) + 0.01, side * 0.91, 0.03, 0.05, 0.14, 0.01);
    }
}

/** The badge's chevron, `size` times its unit size: a V with a dark line down each arm. */
export function chevronShape(size: number): THREE.Shape {
  const chevron = new THREE.Shape();
  for (const [i, [px, py]] of (
    [
      [-0.24, 0.22],
      [-0.17, 0.22],
      [0, -0.135],
      [0.17, 0.22],
      [0.24, 0.22],
      [0, -0.24],
    ] as const
  ).entries())
    if (i === 0) chevron.moveTo(px * size, py * size);
    else chevron.lineTo(px * size, py * size);
  chevron.closePath();
  // A dark line cut down the middle of each arm.
  for (const k of [-1, 1]) {
    const [x0, y0, x1, y1] = [0.19 * k, 0.19, 0.045 * k, -0.1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const [nx, ny] = [(-(y1 - y0) / len) * 0.006, ((x1 - x0) / len) * 0.006];
    const groove = [
      [x0 + nx, y0 + ny],
      [x1 + nx, y1 + ny],
      [x1 - nx, y1 - ny],
      [x0 - nx, y0 - ny],
    ].map(([x, y]) => new THREE.Vector2(x! * size, y! * size));
    // Wound against the outline, as a hole must be.
    if (THREE.ShapeUtils.isClockWise(groove) === THREE.ShapeUtils.isClockWise(chevron.getPoints()))
      groove.reverse();
    chevron.holes.push(new THREE.Path(groove));
  }
  return chevron;
}

/**
 * The nose: a wide grille set in a lime surround from lamp to lamp, slats across it and a thin
 * steel chevron; the ringed headlamps flush in the panel; amber lamps under them.
 */
function nose(car: THREE.Group): void {
  const x = BODY.front;
  const [gy, gh, gw] = [1.06, 0.48, 1.06];
  // The grille's dark panel, and round it a lip of paint, so it reads as set in.
  cbox(car, mat(CAR.grille, { roughness: 0.75 }), x, gy, 0, 0.03, gh, gw, 0.01);
  for (const [dy, dz, h, w] of [
    [gh / 2 + 0.02, 0, 0.04, gw + 0.08],
    [-gh / 2 - 0.02, 0, 0.04, gw + 0.08],
    [0, gw / 2 + 0.02, gh, 0.04],
    [0, -gw / 2 - 0.02, gh, 0.04],
  ] as const)
    cbox(car, paint(), x + 0.02, gy + dy, dz, 0.05, h, w, 0.015);
  // Seven slats across it, each dark with a lighter top edge.
  for (let i = 0; i < 7; i++) {
    const y = gy - gh / 2 + 0.06 + i * 0.06;
    cbox(car, mat(0x26292a, { roughness: 0.8 }), x + 0.02, y, 0, 0.025, 0.032, gw - 0.06, 0.006);
    cbox(
      car,
      mat(0x5a5e60, { roughness: 0.6 }),
      x + 0.025,
      y + 0.017,
      0,
      0.02,
      0.008,
      gw - 0.06,
      0.002,
    );
  }
  const chevron = chevronShape(1.15);
  // A thin V of brushed metal, lighter than the grille behind it.
  const brushed = mat(0xc8ced2, {
    mottle: 'metal',
    roughness: 0.3,
    metalness: 0.7,
    envMapIntensity: 2.4,
  });
  putSlab(car, chevron, 0.04, brushed, 0.008, x + 0.05, gy + 0.02, 0, 0, Math.PI / 2, 0);
  for (const side of [-1, 1]) {
    // The headlamps, flush in the panel: a thin glowing ring round a dark lens.
    const z = side * 0.75;
    put(
      car,
      new THREE.CylinderGeometry(0.18, 0.18, 0.012, 32),
      mat(0x1d2124, { roughness: 0.5 }),
      x + 0.004,
      1.2,
      z,
      0,
      0,
      Math.PI / 2,
    );
    put(
      car,
      new THREE.TorusGeometry(0.15, 0.018, 10, 40),
      glow(CAR.blue, 3),
      x + 0.012,
      1.2,
      z,
      0,
      Math.PI / 2,
      0,
    );
    put(
      car,
      new THREE.CylinderGeometry(0.125, 0.125, 0.01, 28),
      mat(0x15191c, { roughness: 0.15, mottle: 'none', envMapIntensity: 1.5 }),
      x + 0.008,
      1.2,
      z,
      0,
      0,
      Math.PI / 2,
    );
    // An amber lamp under each headlamp, a trapezium.
    const lamp = new THREE.Shape();
    lamp.moveTo(-0.09, -0.045);
    lamp.lineTo(0.09, -0.045);
    lamp.lineTo(0.065, 0.045);
    lamp.lineTo(-0.065, 0.045);
    lamp.closePath();
    putSlab(car, lamp, 0.03, glow(CAR.amber, 1.2), 0.006, x + 0.01, 0.95, z, 0, Math.PI / 2, 0);
  }
}

/**
 * The bumper: a long low bar across the nose with a dark opening over it under the grille, and
 * at each end a low block wrapping the corner back along the side, its outer front corner cut
 * off, a blue strip low on its face.
 */
function bumper(car: THREE.Group): void {
  const x = BODY.front;
  cbox(car, bumperMat(), x + 0.14, 0.5, 0, 0.36, 0.36, 1.3, 0.03);
  // A thin groove between the bar and the grille.
  cbox(car, mat(0x1a1c1d, { roughness: 0.9, mottle: 'none' }), x, 0.71, 0, 0.06, 0.05, 1.0, 0.01);
  for (const side of [-1, 1]) {
    // The corner block, seen from above: square at the back, its outer front corner cut off.
    const plan = new THREE.Shape(
      (
        [
          [x - 0.3, 0.56],
          [x + 0.3, 0.56],
          [x + 0.3, 0.96],
          [x + 0.12, 1.16],
          [x - 0.3, 1.16],
        ] as const
      ).map(([px, pz]) => new THREE.Vector2(px, -side * pz)),
    );
    // Stood up: the plan's y runs to -z, its depth up y.
    const block = put(
      car,
      weather(slab(plan, 0.4, 0.03), 'slab', false, [1.35, 1.35, 1.35]),
      mat(CAR.bumper, { mottle: 'plastic', roughness: 0.45, vertexColors: true }),
      0,
      0.65,
      0,
    );
    block.rotation.x = -Math.PI / 2;
    // Its blue strips, low on its face and along its outer side, standing just proud of the
    // bevel.
    cbox(car, glow(CAR.blue, 3), x + 0.335, 0.53, side * 0.76, 0.02, 0.03, 0.32, 0.008);
    cbox(car, glow(CAR.blue, 3), x - 0.1, 0.53, side * 1.193, 0.3, 0.03, 0.02, 0.008);
  }
}

/**
 * `pts`, an open run of straight edges round the origin, moved in toward it by `d`, square to
 * each edge; its two ends kept at their own heights.
 */
export function insetRun(pts: [number, number][], d: number): [number, number][] {
  const lines = pts.slice(0, -1).map(([x0, y0], i) => {
    const [x1, y1] = pts[i + 1]!;
    const len = Math.hypot(x1 - x0, y1 - y0);
    let [nx, ny] = [-(y1 - y0) / len, (x1 - x0) / len];
    if (nx * -x0 + ny * -y0 < 0) [nx, ny] = [-nx, -ny];
    return { p: [x0 + nx * d, y0 + ny * d], t: [(x1 - x0) / len, (y1 - y0) / len] };
  });
  // Where line `a` meets line `b`.
  const meet = (a: (typeof lines)[number], b: (typeof lines)[number]): [number, number] => {
    const den = a.t[0]! * b.t[1]! - a.t[1]! * b.t[0]!;
    const k = ((b.p[0]! - a.p[0]!) * b.t[1]! - (b.p[1]! - a.p[1]!) * b.t[0]!) / den;
    return [a.p[0]! + a.t[0]! * k, a.p[1]! + a.t[1]! * k];
  };
  // An end: along its edge's moved line to the end's own height.
  const end = (l: (typeof lines)[number], y: number): [number, number] => {
    const k = (y - l.p[1]!) / l.t[1]!;
    return [l.p[0]! + l.t[0]! * k, y];
  };
  return [
    end(lines[0]!, pts[0]![1]),
    ...lines.slice(1).map((l, i) => meet(lines[i]!, l)),
    end(lines[lines.length - 1]!, pts[pts.length - 1]![1]),
  ];
}

/**
 * A charcoal arch bolted round a wheel, as the picture's: a band in five straight runs, two legs,
 * two shoulders and a flat top, standing a little off the wheel and only a little out from the
 * body, a lip along its outer edge and its feet flared out a little.
 */
export function flare(
  car: THREE.Group,
  xc: number,
  side: number,
  scale = 1,
  out = 1.12,
  yc = FLARE.y,
): void {
  const band = FLARE.band * scale;
  const outer = FLARE.outer.map(([x, y]): [number, number] => [x * scale, y * scale]);
  const strip = (run: [number, number][], d: number) =>
    roundedOutline([...run, ...insetRun(run, d).reverse()], 0.03);
  const g = new THREE.Group();
  // Reaching in to the body's side, so no gap shows between them.
  g.position.set(xc, yc, side * out);
  // Its top leaning out a little, as the wheel's does.
  g.rotation.x = side * 0.05;
  car.add(g);
  const plastic = mat(CAR.flare, { mottle: 'plastic', roughness: 0.55, vertexColors: true });
  // Deep enough that its back stays buried in the body all the way round.
  put(
    g,
    weather(slab(strip(outer, band), 0.3, 0.02), 'slab', false, [1.35, 1.35, 1.35]),
    plastic,
  ).position.z = -side * 0.05;
  // The lip along its outer edge, standing proud.
  put(g, slab(strip(outer, 0.025), 0.03, 0.008), plastic).position.z = side * 0.11;
  // Seven bolts along the band's middle.
  const bolt = new THREE.CylinderGeometry(0.016, 0.02, 0.02, 10);
  const middle = new THREE.CurvePath<THREE.Vector3>();
  const mids = insetRun(outer, band / 2).map(([x, y]) => new THREE.Vector3(x, y, 0));
  for (let k = 0; k < mids.length - 1; k++)
    middle.add(new THREE.LineCurve3(mids[k]!, mids[k + 1]!));
  for (let k = 0; k < 7; k++) {
    const p = middle.getPointAt(0.04 + (k / 6) * 0.92);
    put(
      g,
      bolt,
      mat(0x2a2e30, { roughness: 0.5, metalness: 0.3 }),
      p.x,
      p.y,
      side * 0.125,
      Math.PI / 2,
      0,
      0,
    );
  }
}

/** The sills between the arches, and the seams, handles and mirrors down each side. */
function sides(car: THREE.Group): void {
  const x0 = WHEELS.rear + 0.66;
  const x1 = WHEELS.front - 0.66;
  const sillTop = 1.0;
  for (const side of [-1, 1]) {
    // The sill: a tall charcoal panel between the arches, its foot tucked under, two shallow
    // panels set in it and a light worn top edge.
    cbox(
      car,
      trim(),
      (x0 + x1) / 2,
      (BODY.rocker + sillTop) / 2,
      side * (BODY.half + 0.02),
      x1 - x0,
      sillTop - BODY.rocker,
      0.14,
    );
    const len = (x1 - x0) / 2 - 0.12;
    for (const k of [-1, 1])
      cbox(
        car,
        mat(0x3c3c3e, { mottle: 'plastic', roughness: 0.7 }),
        (x0 + x1) / 2 + (k * (x1 - x0)) / 4,
        0.76,
        side * (BODY.half + 0.091),
        len,
        0.26,
        0.004,
        0.002,
      );
    cbox(
      car,
      mat(0x8c8a85, { mottle: 'plastic', roughness: 0.6 }),
      (x0 + x1) / 2,
      sillTop - 0.004,
      side * (BODY.half + 0.08),
      x1 - x0 - 0.02,
      0.012,
      0.02,
      0.004,
    );
    const face = side * (BODY.half + 0.002);
    // The doors' seams, up from the sill to the belt, and a crease along the doors.
    // Each stops at the arches' cut, so none stands out in the air over a wheel.
    const archTop = 1.34;
    const seams: [number, number][] = [
      [BODY.screenFoot - 0.28, sillTop],
      [-0.45, sillTop],
      [-1.37, archTop],
    ];
    for (const [x, y0] of seams) groove(car, x, y0, BODY.belt - 0.01, face, side);
    const [c0, c1] = [x0 - 0.06, x1 + 0.06];
    rbox(car, paintLine(), (c0 + c1) / 2, 1.18, face, c1 - c0, 0.014, 0.012, 0.004);
    rbox(car, paintLip(), (c0 + c1) / 2, 1.168, face + side * 0.001, c1 - c0, 0.004, 0.008, 0.002);
    // Handles, as pockets with a lighter rim, and a fuel flap at the back.
    for (const hx of [BODY.screenFoot - 0.5, -0.62]) {
      rbox(car, paintLip(), hx, BODY.belt - 0.09, face, 0.19, 0.06, 0.012, 0.01);
      rbox(
        car,
        mat(0x23272a, { roughness: 0.6 }),
        hx,
        BODY.belt - 0.09,
        face + side * 0.002,
        0.16,
        0.04,
        0.012,
        0.008,
      );
    }
    rbox(car, paintLine(), -1.8, 1.43, face + side * 0.004, 0.2, 0.14, 0.01, 0.02);
    // A column of small moulded rectangles on the rear quarter.
    for (let i = 0; i < 3; i++)
      rbox(car, paintLine(), -2.25, 1.28 + i * 0.09, face + side * 0.004, 0.05, 0.06, 0.01, 0.006);
    // The mirror: a short arm out from the windscreen's foot, a big case, an amber repeater
    // along its outer foot.
    const mx = BODY.screenFoot - 0.18;
    cbox(car, trim(), mx, BODY.belt - 0.06, side * (BODY.cabinHalf + 0.08), 0.07, 0.06, 0.16, 0.02);
    cbox(car, trim(), mx - 0.04, BODY.belt, side * (BODY.cabinHalf + 0.23), 0.15, 0.4, 0.2, 0.03);
    rbox(
      car,
      glow(CAR.amber, 1.2),
      mx + 0.04,
      BODY.belt - 0.17,
      side * (BODY.cabinHalf + 0.27),
      0.03,
      0.045,
      0.14,
      0.01,
    );
  }
}

/**
 * The intake's back, behind the turbine: cyan light brightest at its rim, fading to dark well
 * a little way out from the hub, as the picture's glow does between the blades.
 */
let intake: THREE.MeshStandardMaterial | undefined;
function intakeGlow(): THREE.MeshStandardMaterial {
  if (intake) return intake;
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const rim = new THREE.Color(0xb8f0ff);
  const deep = new THREE.Color(0x2a7a96);
  const c = new THREE.Color();
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
      const t = THREE.MathUtils.smoothstep(d, 0.25, 0.6);
      c.copy(deep)
        .lerp(rim, THREE.MathUtils.smoothstep(d, 0.6, 0.95))
        .multiplyScalar(t);
      data.set([c.r * 255, c.g * 255, c.b * 255, 255], (y * size + x) * 4);
    }
  const map = new THREE.DataTexture(data, size, size);
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = map.minFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  intake = madeOf(
    new THREE.MeshStandardMaterial({
      color: 0x0a1014,
      roughness: 0.7,
      emissive: 0xffffff,
      emissiveMap: map,
      emissiveIntensity: 1.6,
    }),
    Surface.None,
  );
  return intake;
}

/**
 * A wheel as the picture draws it, a flying car's hover pod: a narrow round housing of dark
 * gunmetal, open right through, its band armoured with a few curved plates of polished steel,
 * stepped at their edges and folded a little way over its face, with slots, rivets and engraved
 * lines; and filling it a big fan of broad pitched blades round a capped hub, lit pale cyan from
 * behind. Its axle runs along z, its face toward +z.
 */
export function makeWheel(): THREE.Group {
  const w = new THREE.Group();
  const r = WHEELS.radius - 0.055;
  const inner = r - 0.06;
  const hw = WHEELS.width / 2;
  // Metals show what they mirror: these see the studio brighter than the paint does.
  const gunmetal = mat(0x3a3f44, {
    mottle: 'metal',
    roughness: 0.4,
    metalness: 0.8,
    envMapIntensity: 1.8,
  });
  const polished = mat(0xdde2e6, {
    mottle: 'metal',
    roughness: 0.3,
    metalness: 0.7,
    envMapIntensity: 2.4,
  });
  const bladeMetal = mat(0x737c83, {
    mottle: 'metal',
    roughness: 0.35,
    metalness: 0.8,
    envMapIntensity: 2.4,
  });
  const panel = mat(0x4a5157, { mottle: 'metal', roughness: 0.45, metalness: 0.7 });
  const engraved = mat(0x14171a, { mottle: 'none' });
  // The housing: a narrow ring, open right through, its lip rounded at the face.
  const drum = new THREE.LatheGeometry(
    [
      [inner, -hw],
      [r - 0.02, -hw],
      [r, -hw + 0.03],
      [r, hw - 0.03],
      [r - 0.02, hw],
      [inner + 0.025, hw],
      [inner, hw - 0.025],
      [inner, -hw],
    ].map(([a, b]) => new THREE.Vector2(a, b)),
    64,
  );
  drum.rotateX(Math.PI / 2);
  put(w, drum, gunmetal);
  // A bright edge round the opening, where the light catches its lip.
  put(w, new THREE.TorusGeometry(inner + 0.006, 0.007, 8, 64), polished, 0, 0, hw - 0.012);
  // Light inside it: a pale cyan band round its inside, and a glowing back behind the fan.
  const band = new THREE.CylinderGeometry(inner - 0.004, inner - 0.004, hw * 1.2, 48, 1, true);
  band.rotateX(Math.PI / 2);
  put(
    w,
    band,
    mat(0x1c3a46, {
      emissive: 0x3fb0d8,
      emissiveIntensity: 0.3,
      mottle: 'none',
      side: THREE.BackSide,
    }),
    0,
    0,
    -hw * 0.2,
  );
  put(w, new THREE.CircleGeometry(inner, 56), intakeGlow(), 0, 0, -hw + 0.06);
  const halo = new THREE.TorusGeometry(inner - 0.025, 0.03, 10, 64);
  put(w, halo, glow(0xa8ecff, 0.9), 0, 0, -hw + 0.1);

  const at = (rad: number, a: number) => new THREE.Vector2(Math.cos(a) * rad, Math.sin(a) * rad);
  const arc = (rad: number, a0: number, a1: number, steps: number) =>
    Array.from({ length: steps + 1 }, (_, k) => at(rad, a0 + ((a1 - a0) * k) / steps));
  // A curved strip from radius `r0` to `r1`, from angle `a0` to `a1`, its corners cut `cut` at
  // each end (an angle, at its outer edge).
  const sector = (r0: number, r1: number, a0: number, a1: number, cut = [0, 0]) => {
    const steps = Math.max(2, Math.ceil((a1 - a0) / 0.08));
    return new THREE.Shape([
      ...arc(r1, a0 + cut[0]!, a1 - cut[1]!, steps),
      ...arc(r0, a1, a0, steps),
    ]);
  };
  // The band: dark panels set into it all round, a seam between each.
  const panels = 10;
  for (let i = 0; i < panels; i++) {
    const a0 = (i / panels) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / panels - 0.025;
    putSlab(w, sector(r - 0.004, r + 0.006, a0, a1), WHEELS.width - 0.05, panel, 0.004);
  }
  // The armour: four curved plates of polished steel round the band, each in two steps: a wide
  // plate toward the face and a narrower tab running on past one end toward the back. Each folds
  // over the face's edge a little way, with a slot and two rivets there, and an engraved line
  // and a slot across the band.
  const plates: [number, number][] = [
    [0.35, 1.35],
    [1.95, 2.75],
    [3.3, 4.35],
    [4.9, 5.75],
  ];
  const [p0, p1] = [r + 0.006, r + 0.024];
  for (const [i, [a0, a1]] of plates.entries()) {
    const mid = (a0 + a1) / 2;
    putSlab(w, sector(p0, p1, a0, a1), WHEELS.width * 0.8, polished, 0.006, 0, 0, hw * 0.2);
    const [t0, t1] = i % 2 ? [a1 - 0.3, a1 + 0.14] : [a0 - 0.14, a0 + 0.3];
    putSlab(
      w,
      sector(p0, p1 - 0.004, t0, t1),
      WHEELS.width * 0.5,
      polished,
      0.006,
      0,
      0,
      -hw * 0.45,
    );
    // Folded over the face, its ends cut back.
    const fold = sector(inner + 0.014, p1, a0 + 0.02, a1 - 0.02, [0.06, 0.02]);
    putSlab(w, fold, 0.02, polished, 0.006, 0, 0, hw + 0.004);
    // A rounded slot and two rivets on the fold.
    const slot = put(w, new THREE.CapsuleGeometry(0.007, 0.04, 2, 8), engraved);
    slot.position.set(Math.cos(mid) * (r - 0.012), Math.sin(mid) * (r - 0.012), hw + 0.015);
    slot.rotation.z = mid;
    for (const e of [a0 + 0.1, a1 - 0.08]) {
      const rivet = put(w, new THREE.CylinderGeometry(0.008, 0.008, 0.01, 8), polished);
      rivet.rotation.x = Math.PI / 2;
      rivet.position.set(Math.cos(e) * (r - 0.012), Math.sin(e) * (r - 0.012), hw + 0.015);
    }
    // Across the band: an engraved line along the plate and a slot near its end.
    putSlab(
      w,
      sector(p1 - 0.002, p1 + 0.003, a0 + 0.12, a1 - 0.25),
      0.008,
      engraved,
      0,
      0,
      0,
      hw * 0.1,
    );
    const band2 = put(w, new THREE.CapsuleGeometry(0.008, 0.05, 2, 8), engraved);
    const e = a1 - 0.14;
    band2.position.set(Math.cos(e) * (p1 + 0.001), Math.sin(e) * (p1 + 0.001), hw * 0.45);
    band2.rotation.set(Math.PI / 2, 0, e, 'ZYX');
    if (i === 0) {
      // The bracket: a long lug running on past the housing from the plate's leading end.
      const fin = new THREE.Shape([
        at(r, a0 + 0.02),
        at(r + 0.16, a0 + 0.02),
        at(r + 0.17, a0 + 0.1),
        at(r + 0.02, a0 + 0.16),
      ]);
      putSlab(w, fin, 0.05, polished, 0.008, 0, 0, hw - 0.01);
    }
  }

  // The fan: broad blades from the hub out nearly to the housing, each pitched round its own
  // length, widening toward its tip, its leading corner cut off.
  const blades = 9;
  const root = 0.09;
  const tip = inner - 0.012;
  const blade = new THREE.Shape([
    new THREE.Vector2(root, -0.028),
    new THREE.Vector2(tip, -0.07),
    new THREE.Vector2(tip, 0.045),
    new THREE.Vector2(tip - 0.03, 0.075),
    new THREE.Vector2(root, 0.028),
  ]);
  const bladeGeo = slab(blade, 0.014, 0.004);
  for (let i = 0; i < blades; i++) {
    const g = new THREE.Group();
    g.rotation.z = (i / blades) * Math.PI * 2 + 0.2;
    g.position.z = hw * 0.1;
    w.add(g);
    put(g, bladeGeo, bladeMetal, 0, 0, 0, 0.6).castShadow = false;
  }
  // The hub: a gunmetal drum with a polished cap and a dome.
  const hub = new THREE.CylinderGeometry(0.1, 0.11, 0.08, 32);
  hub.rotateX(Math.PI / 2);
  put(w, hub, gunmetal, 0, 0, hw * 0.1);
  const cap = new THREE.CylinderGeometry(0.07, 0.08, 0.02, 32);
  cap.rotateX(Math.PI / 2);
  put(w, cap, polished, 0, 0, hw * 0.1 + 0.05);
  put(w, new THREE.TorusGeometry(0.085, 0.006, 6, 32), engraved, 0, 0, hw * 0.1 + 0.042);
  const dome = new THREE.SphereGeometry(0.04, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.rotateX(Math.PI / 2);
  put(w, dome, gunmetal, 0, 0, hw * 0.1 + 0.06);
  return w;
}

/** The roof rack: two rails of tube round the roof on posts, crossbars, feet on green pads. */
function rack(car: THREE.Group): THREE.Group {
  const g = new THREE.Group();
  car.add(g);
  const m = mat(CAR.rack, { mottle: 'metal', roughness: 0.2, metalness: 0.5 });
  const [x0, x1] = [-2.4, 0.26];
  const zw = 0.86;
  const low = BODY.roof + 0.16;
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
  tube(g, loop(low, 0), 0.044, m, true);
  tube(g, loop(high, 0.04), 0.044, m, true);
  // Posts between the rails down each side and across the ends.
  for (const side of [-1, 1])
    for (const x of [-1.96, -1.4, -0.84, -0.28])
      tube(
        g,
        new THREE.LineCurve3(
          new THREE.Vector3(x, low, side * zw),
          new THREE.Vector3(x, high, side * (zw - 0.04)),
        ),
        0.031,
        m,
      );
  for (const z of [-0.4, 0.4]) {
    tube(
      g,
      new THREE.LineCurve3(new THREE.Vector3(x1, low, z), new THREE.Vector3(x1 - 0.04, high, z)),
      0.031,
      m,
    );
    tube(
      g,
      new THREE.LineCurve3(new THREE.Vector3(x0, low, z), new THREE.Vector3(x0 + 0.04, high, z)),
      0.031,
      m,
    );
  }
  // Crossbars the load sits on.
  for (const x of [-1.7, -1.05, -0.4, 0.05])
    tube(
      g,
      new THREE.LineCurve3(
        new THREE.Vector3(x, low - 0.02, -zw),
        new THREE.Vector3(x, low - 0.02, zw),
      ),
      0.034,
      m,
    );
  // Feet: a green pad on the roof's edge, a steel post up to the lower rail.
  for (const side of [-1, 1])
    for (const x of [-1.96, -0.94, 0.06]) {
      rbox(car, paint(), x, BODY.roof + 0.015, side * (zw - 0.02), 0.15, 0.06, 0.1, 0.025);
      put(
        car,
        new THREE.CylinderGeometry(0.025, 0.03, 0.13, 12),
        steel(),
        x,
        BODY.roof + 0.095,
        side * zw,
      );
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
  glasshouse(car);
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
  cargo.position.y = BODY.roof + 0.16;
  car.add(cargo);
  return { root: car, wheels };
}
