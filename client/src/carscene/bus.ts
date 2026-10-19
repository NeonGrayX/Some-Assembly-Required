import * as THREE from 'three';
import { CAR, WHEELS, archCut, chevronShape, flare, makeWheel, weather } from './car.ts';
import type { Car } from './car.ts';
import { dashPlastic, dashScreen, leather, seat, steeringWheel } from './cabin.ts';
import { hang, lidOff, outlinePoints, topOf } from './doors.ts';
import type { Swing } from './doors.ts';
import { glazedShell, inset } from './glazing.ts';
import { cbox, glow, mat, put, putSlab, rbox, roundedOutline, slab } from './kit.ts';
import { Surface, madeOf } from '../render/styles.ts';

/**
 * The school bus: a yellow bus with a bonnet, built as the off-roader and the sports car are. A
 * long box of a body on charcoal skirts, a row of windows set into each side, a bonnet out
 * ahead of a flat windscreen, a rounded roof whose visor carries the "SCHOOL BUS" sign between
 * red and amber flashers, black rub rails down its sides, a folding door, a stop arm, the
 * chevron and ringed blue lamps on its nose and the same charcoal arches over the same armoured
 * hover wheels.
 *
 * Modelled facing +x, its right side (the door's) toward +z, its wheels on the ground at y = 0;
 * about 8.5 m from bumper to tail and 3.3 m to the roof.
 */

/** Its paint, its rails and its lamps. */
export const BUS = {
  yellow: 0xf0bd1c,
  rail: 0x1d1e1f,
  red: 0xff2a20,
};

/** Its wheels' centres along x, and out to each side at the bonnet and under the body. */
export const BUS_WHEELS = { front: 2.62, rear: -2.6, frontSide: 1.32, rearSide: 1.44 };

/**
 * Its door on the right: from `x0` to `x1` along x, up to `top`, in two leaves reaching down to
 * the steps inside it; the steps' treads (`steps`, their tops), the lower out from `stair` to the
 * door, the upper in from it to `well`, where the floor stops.
 */
export const BUS_DOOR = {
  x0: 0.76,
  x1: 1.52,
  top: 2.78,
  steps: [0.16, 0.46],
  stair: 0.82,
  well: 0.52,
};
/** The emergency door in its tail: `half` its width either side of the middle, up to `top`. */
export const BUS_BACK_DOOR = { half: 0.4, top: 2.78 };

/**
 * Inside: its floor's top (where it is walked on), the inside of its sides (either side of the
 * middle), its tail wall's thickness, the inside of its front, and its ceiling.
 */
export const BUS_CABIN = { floor: 0.77, inner: 0.92, tail: 0.12, front: 1.76, ceiling: 2.9 };

/** The middle of the frontmost of the six windows down each side, along x; each 0.86 behind. */
const WINDOWS = 0.5;
/** The windows' foot and head, the tail's too. */
const SILL = 2.0;
const HEAD = 2.7;
/** The front edge of the first window on the right, short of the doorway. */
const FIRST = 0.48;
/** The frontmost bench's middle, along x; each 0.86 behind. */
export const BENCHES = 0.4;
/** The driver's seat's middle, along x. */
export const DRIVER = 1.0;
/** The dashboard: its back face and its front along x, and its top. */
export const DASH = { back: 1.53, front: 1.76, top: 1.55 };

/** The body's lines along x and up y. */

export const BUS_BODY = {
  /** The bonnet's nose and the body's tail. */
  front: 3.55,
  rear: -4.75,
  /** The body's front face, where the bonnet meets it under the windscreen. */
  cowl: 1.9,
  sill: 0.62,
  half: 1.12,
  bonnetHalf: 1.0,
  bonnet: 1.64,
  roof: 3.06,
};

const paint = () =>
  mat(BUS.yellow, {
    mottle: 'paint',
    roughness: 0.42,
    metalness: 0.15,
    envMapIntensity: 1.4,
    clearcoat: 1,
    clearcoatRoughness: 0.2,
    vertexColors: true,
  });
/** Its worn edges: paler, toward cream. */
const WORN: [number, number, number] = [1.1, 1.14, 1.7];
const trim = () => mat(CAR.trim, { mottle: 'plastic', roughness: 0.6 });
const bumperMat = () => mat(CAR.bumper, { mottle: 'plastic', roughness: 0.45 });
const rail = () => mat(BUS.rail, { mottle: 'plastic', roughness: 0.5 });
const dark = () => mat(0x1c1f21, { mottle: 'none', roughness: 0.9 });
/** Tinted glass, dark as the cars', the cabin dimly seen through it. */
const glass = () =>
  mat(0x231812, {
    mottle: 'none',
    roughness: 0.05,
    metalness: 0.2,
    envMapIntensity: 2.6,
    transparent: true,
    opacity: 0.74,
  });

/** Block capitals five wide and seven high, for the signs. */
const GLYPHS: Record<string, string[]> = {
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};

/** `text` in `ink` on `ground`, as a texture, and how wide it is for its height. */
function lettering(
  text: string,
  ink: number,
  ground: number,
): { map: THREE.Texture; aspect: number } {
  const k = 8;
  const cols = text.length * 6 - 1 + 4;
  const rows = 7 + 4;
  const [W, H] = [cols * k, rows * k];
  const data = new Uint8Array(W * H * 4);
  const [a, g] = [new THREE.Color(ink), new THREE.Color(ground)];
  const rgb = (c: THREE.Color) => {
    const s = c.clone().convertLinearToSRGB();
    return [s.r * 255, s.g * 255, s.b * 255, 255];
  };
  const [inkRGB, groundRGB] = [rgb(a), rgb(g)];
  for (let i = 0; i < W * H; i++) data.set(groundRGB, i * 4);
  for (const [n, ch] of [...text].entries()) {
    const glyph = GLYPHS[ch] ?? GLYPHS[' ']!;
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < 5; c++) {
        if (glyph[r]![c] !== '#') continue;
        const x0 = (2 + n * 6 + c) * k;
        // Rows count down from the top; the texture's from the bottom.
        const y0 = (rows - 3 - r) * k;
        for (let y = y0; y < y0 + k; y++)
          for (let x = x0; x < x0 + k; x++) data.set(inkRGB, (y * W + x) * 4);
      }
  }
  const map = new THREE.DataTexture(data, W, H);
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return { map, aspect: W / H };
}

/** A flat sign of `text`, `width` wide, facing +z. */
function sign(text: string, ink: number, ground: number, width: number): THREE.Mesh {
  const { map, aspect } = lettering(text, ink, ground);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width / aspect),
    madeOf(new THREE.MeshStandardMaterial({ map, roughness: 0.45 }), Surface.None),
  );
  m.receiveShadow = true;
  return m;
}

/**
 * The body: one glazed shell from tail to windscreen, cut out over the rear wheels, a row of
 * windows set into each side (the driver's first, then six), the windscreen sunk between its
 * pillars, a split down its middle, wipers at its foot.
 */
function body(car: THREE.Group): void {
  const { rear, cowl, sill, half, roof } = BUS_BODY;
  const b = 0.06;
  const foot = new THREE.Vector2(cowl - b, 1.62);
  const head = new THREE.Vector2(cowl - 0.22 - b, roof - b);
  // Its side, and the same with no arch cut out of its foot for the middle: the rear wheels are
  // only under its sides, the floor running low across between them.
  const side = (arches: boolean) =>
    roundedOutline(
      [
        [rear + b, sill + b, 0.02],
        ...(arches ? archCut(BUS_WHEELS.rear, sill + b) : []),
        [cowl - b, sill + b, 0.02],
        [foot.x, foot.y, 0.03],
        [head.x, head.y, 0.1],
        [rear + b, roof - b, 0.12],
      ],
      0.015,
    );
  const outline = side(true);
  const window = (x0: number, x1: number, y0: number, y1: number) =>
    roundedOutline(
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ],
      0.06,
    );
  // Six windows down each side, the first on the right narrower, clear of the doorway, and the
  // driver's on the left (the door is on the right).
  const openings = [];
  for (let k = 1; k < 6; k++) {
    const c = WINDOWS - k * 0.86;
    openings.push(window(c - 0.37, c + 0.37, SILL, HEAD));
  }
  const d = 0.03;
  const [e0, e1] = [0.05, 0.13];
  const shell = glazedShell({
    outline,
    openings,
    only: {
      [-1]: [window(WINDOWS - 0.37, WINDOWS + 0.37, SILL, HEAD), window(1.18, 1.62, SILL, HEAD)],
      [1]: [window(WINDOWS - 0.37, FIRST, SILL, HEAD)],
    },
    middle: side(false),
    half,
    pillar: 0.2,
    b,
    d,
    runs: [[foot, head, e0, e1]],
    paint: paint(),
    glass,
    worn: WORN,
    hollow: {
      skin: 0.02,
      floor: BUS_CABIN.floor - b - 0.01,
      lining: mat(0x2a2521, { roughness: 0.85, side: THREE.BackSide }),
      openTail: BUS_CABIN.tail - b + 0.01,
      // Over the steps inside the door, a little wider than it (its ends bevel back in).
      open: [BUS_DOOR.x0 - 0.04, BUS_DOOR.x1 + 0.04],
    },
    doorways: [
      {
        side: 1,
        edge: [
          new THREE.Vector2(BUS_DOOR.x0, BUS_DOOR.top),
          new THREE.Vector2(BUS_DOOR.x1, BUS_DOOR.top),
        ],
        up: false,
      },
    ],
  });
  for (const m of [...shell.children]) car.add(m);
  // Each window split by a bar across it, a little below its top: the sliding pane's frame.
  const bar = mat(0x9aa0a4, { mottle: 'metal', roughness: 0.35, metalness: 0.8 });
  for (const side of [-1, 1])
    for (let k = 0; k < 6; k++) {
      const [x0, x1] = [
        WINDOWS - k * 0.86 - 0.35,
        k === 0 && side > 0 ? FIRST - 0.02 : WINDOWS - k * 0.86 + 0.35,
      ];
      cbox(car, bar, (x0 + x1) / 2, 2.48, side * (half - 0.028), x1 - x0, 0.03, 0.012, 0.006);
    }
  // The windscreen's split, and two wipers parked along its foot.
  const along = head.clone().sub(foot);
  const len = along.length();
  along.normalize();
  const out = new THREE.Vector2(along.y, -along.x);
  const angle = Math.atan2(along.y, along.x);
  const mid = foot
    .clone()
    .addScaledVector(along, (e0 + len - e1) / 2)
    .addScaledVector(out, -d + b + 0.01);
  cbox(car, trim(), mid.x, mid.y, 0, len - e0 - e1, 0.03, 0.06, 0.01, [0, 0, angle]);
  for (const z of [-0.5, 0.3]) {
    const at = foot
      .clone()
      .addScaledVector(along, e0 + 0.12)
      .addScaledVector(out, -d + b + 0.02);
    cbox(car, dark(), at.x, at.y, z, 0.03, 0.02, 0.62, 0.008, [0, 0, angle]).rotation.y = 0.12;
  }

  // The roof: rounded off across its width, its edges a drip rail down each side, running on
  // ahead of the windscreen in a short visor.
  const capFront = head.x + b + 0.12;
  const cap = roundedOutline(
    [
      [-(half - 0.004), roof - 0.12, 0.01],
      [half - 0.004, roof - 0.12, 0.01],
      [half - 0.004, roof + 0.24, 0.32],
      [-(half - 0.004), roof + 0.24, 0.32],
    ],
    0.015,
  );
  const capGeo = weather(slab(cap, capFront - rear, 0.05), 'slab', false, WORN);
  capGeo.rotateY(Math.PI / 2);
  put(car, capGeo, paint(), (capFront + rear) / 2, 0, 0);
  for (const side of [-1, 1])
    cbox(
      car,
      rail(),
      (capFront + rear) / 2,
      roof - 0.15,
      // Along the roof's lip, where it stands out over the side.
      side * (half + 0.056),
      capFront - rear - 0.1,
      0.03,
      0.025,
      0.008,
    );

  // The wells inside the rear arches, dark, standing a little into the cabin along its sides
  // where the wheels come up under them, and the underside.
  for (const s of [-1, 1])
    rbox(car, dark(), BUS_WHEELS.rear, 0.91, s * 0.94, 1.3, 0.58, 0.28, 0.05);
  // Broken round the steps inside the door.
  const [u0, u1] = [rear + 0.2, BUS_BODY.front - 0.2];
  const [s0, s1] = [BUS_DOOR.x0 - 0.06, BUS_DOOR.x1 + 0.06];
  for (const [x0, x1] of [
    [u0, s0],
    [s1, u1],
  ] as const)
    rbox(car, dark(), (x0 + x1) / 2, 0.56, 0, x1 - x0, 0.2, half * 2 - 0.2, 0.05);
  const z0 = -(half - 0.1);
  const z1 = BUS_DOOR.well - 0.02;
  rbox(car, dark(), (s0 + s1) / 2, 0.56, (z0 + z1) / 2, s1 - s0, 0.2, z1 - z0, 0.05);
}

/**
 * The bonnet: a narrower slab out ahead of the body, cut out over the front wheels, rolling
 * over into its nose, a louvred vent on each flank. Its lid, between strips down each side, is
 * hung at its back edge and lifts at the nose, over the engine in its well lined dark.
 */
function bonnet(car: THREE.Group): void {
  const { front, cowl, sill, bonnetHalf, bonnet: top } = BUS_BODY;
  const b = 0.05;
  // Its back end buried in the body's front wall, its bevel short of the wall's inside, where the
  // cabin's lining is.
  const back = cowl - 0.05;
  const outline = roundedOutline(
    [
      [back, sill + b, 0.02],
      ...archCut(BUS_WHEELS.front, sill + b),
      [front - b, sill + b, 0.02],
      [front - b, top - 0.18 - b, 0.12],
      [front - 0.3, top - 0.08 - b, 0.2],
      [back, top - b, 0.02],
    ],
    0.015,
  );
  // Unseen: the whole slab, to find its top on.
  const shell = new THREE.Mesh(slab(outline, bonnetHalf * 2, b));
  shell.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const onTop = (x: number, z: number) => {
    ray.set(new THREE.Vector3(x, 5, z), new THREE.Vector3(0, -1, 0));
    return ray.intersectObject(shell, false)[0]!.point;
  };
  const points = outlinePoints(outline);
  const [x0, x1] = [cowl + 0.08, front - 0.12];
  const edge = bonnetHalf - 0.12;
  const floor = 1.22;
  const lid = hang(car, new THREE.Vector3(x0, topOf(points, x0) + b, 0), 0.9, 'z');
  lid.parent!.userData.what = 'bonnet';
  const cut = lidOff(points, [new THREE.Vector2(x0, floor), new THREE.Vector2(x1, floor)], 0.06, b);
  put(car, weather(slab(new THREE.Shape(cut.rest), edge * 2, b), 'slab', false, WORN), paint());
  const strip = weather(slab(outline, bonnetHalf - edge, b), 'slab', false, WORN);
  for (const side of [-1, 1]) put(car, strip, paint(), 0, 0, (side * (edge + bonnetHalf)) / 2);
  const lidGeo = slab(new THREE.Shape(inset(cut.lid, 0.022)), edge * 2 - 0.012, 0.015);
  put(lid, weather(lidGeo, 'slab', false, WORN), paint());
  // The arches' wells, dark, under the engine's.
  rbox(car, dark(), BUS_WHEELS.front, 0.9, 0, 1.3, 0.6, bonnetHalf * 2 - 0.3, 0.05);
  // The engine's well, lined up to under the lid where it is lowest, so no lining stands above
  // the body; in it the engine, a dark block, its two covers ribbed along it, and between them a
  // turbine's housing lit blue at its core.
  const high = Math.min(...cut.lid.map((p) => p.y)) - 0.07;
  const [w0, w1] = [x0 + 0.03, x1 - 0.03];
  put(
    car,
    new THREE.BoxGeometry(w1 - w0, high - floor, edge * 2 - 0.04),
    mat(0x16191b, { roughness: 0.9, side: THREE.BackSide }),
    (w0 + w1) / 2,
    (floor + high) / 2 + 0.003,
    0,
  ).castShadow = false;
  const mid = (w0 + w1) / 2;
  const block = mat(0x2a2d30, { mottle: 'metal', roughness: 0.45, metalness: 0.6 });
  rbox(car, block, mid, floor + 0.07, 0, w1 - w0 - 0.4, 0.14, 1.2, 0.03);
  for (const z of [-0.4, 0.4])
    rbox(car, dark(), mid, floor + 0.16, z, w1 - w0 - 0.5, 0.06, 0.26, 0.025);
  const steel = mat(CAR.steel, { mottle: 'metal', roughness: 0.28, metalness: 0.9 });
  put(car, new THREE.CylinderGeometry(0.17, 0.19, 0.09, 28), steel, mid, floor + 0.18, 0);
  put(
    car,
    new THREE.CircleGeometry(0.11, 24),
    glow(CAR.blue, 2.4),
    mid,
    floor + 0.226,
    0,
    -Math.PI / 2,
  );
  // The crossover mirrors: round, on stalks standing on the bonnet's front corners.
  for (const side of [-1, 1]) {
    const z = side * (bonnetHalf - 0.06);
    const x = front - 0.22;
    const foot = onTop(x, z).y - 0.02;
    const head = top + 0.32;
    cbox(car, trim(), x, (foot + head) / 2, z, 0.03, head - foot, 0.03, 0.01);
    const m = put(
      car,
      new THREE.SphereGeometry(0.09, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      trim(),
      x + 0.008,
      head,
      z,
      0,
      0,
      -Math.PI / 2,
    );
    m.scale.set(1, 0.6, 1);
  }
  for (const side of [-1, 1]) {
    // The vent: dark slots in the flank behind the wheel.
    const face = side * (bonnetHalf + 0.002);
    for (let i = 0; i < 4; i++)
      rbox(car, dark(), cowl + 0.32, 1.1 + i * 0.09, face, 0.26, 0.035, 0.02, 0.01);
  }
}

/**
 * The nose: a slatted grille with the steel chevron on it between two ringed blue lamps, a
 * charcoal bumper with amber corners and blue strips, and two round mirrors on stalks.
 */
function nose(car: THREE.Group): void {
  const x = BUS_BODY.front;
  const brushed = mat(0xc8ced2, {
    mottle: 'metal',
    roughness: 0.3,
    metalness: 0.7,
    envMapIntensity: 2.4,
  });
  cbox(car, mat(CAR.grille, { roughness: 0.6 }), x + 0.005, 1.06, 0, 0.03, 0.5, 1.08, 0.03);
  for (let i = 0; i < 5; i++)
    cbox(car, trim(), x + 0.025, 0.86 + i * 0.1, 0, 0.02, 0.035, 1.02, 0.008);
  putSlab(car, chevronShape(0.5), 0.03, brushed, 0.006, x + 0.05, 1.08, 0, 0, Math.PI / 2, 0);
  for (const side of [-1, 1]) {
    const z = side * 0.78;
    put(
      car,
      new THREE.CylinderGeometry(0.15, 0.15, 0.014, 28),
      mat(0x1d2124, { roughness: 0.5 }),
      x + 0.004,
      1.1,
      z,
      0,
      0,
      Math.PI / 2,
    );
    put(
      car,
      new THREE.TorusGeometry(0.12, 0.018, 10, 36),
      glow(CAR.blue, 3),
      x + 0.014,
      1.1,
      z,
      0,
      Math.PI / 2,
      0,
    );
    put(
      car,
      new THREE.CylinderGeometry(0.1, 0.1, 0.012, 24),
      mat(0x15191c, { roughness: 0.15, mottle: 'none', envMapIntensity: 1.5 }),
      x + 0.009,
      1.1,
      z,
      0,
      0,
      Math.PI / 2,
    );
  }
  // The bumper.
  cbox(car, bumperMat(), x + 0.1, 0.6, 0, 0.3, 0.3, 2.3, 0.03);
  for (const side of [-1, 1]) {
    cbox(car, glow(CAR.amber, 1.2), x + 0.255, 0.66, side * 0.98, 0.02, 0.07, 0.2, 0.01);
    cbox(car, glow(CAR.blue, 3), x + 0.255, 0.52, side * 0.78, 0.02, 0.03, 0.42, 0.008);
  }
}

/** A red and an amber flasher each side of the sign at the roof's front or back (`dir`). */
function flashers(car: THREE.Group, x: number, dir: number): void {
  const y = BUS_BODY.roof + 0.08;
  const hood = mat(0x1b1c1d, { roughness: 0.5 });
  for (const side of [-1, 1])
    for (const [z, colour] of [
      [0.78, CAR.amber],
      [0.96, BUS.red],
    ] as const) {
      put(
        car,
        new THREE.CylinderGeometry(0.085, 0.085, 0.06, 24),
        hood,
        x + dir * 0.02,
        y,
        side * z,
        0,
        0,
        Math.PI / 2,
      );
      put(
        car,
        new THREE.CircleGeometry(0.065, 24),
        glow(colour, 2),
        x + dir * 0.052,
        y,
        side * z,
        0,
        (dir * Math.PI) / 2,
        0,
      );
    }
  // The sign: black lettering on yellow, in a black frame.
  cbox(car, rail(), x + dir * 0.01, y, 0, 0.04, 0.26, 1.24, 0.01);
  const s = sign('SCHOOL BUS', 0x111111, BUS.yellow, 1.18);
  s.position.set(x + dir * 0.032, y, 0);
  s.rotation.y = (dir * Math.PI) / 2;
  car.add(s);
}

/**
 * The sides: charcoal skirts between the arches, black rub rails along the body, mirrors on
 * arms at the front corners, the folding door on the right and the stop arm on the left.
 */
function sides(car: THREE.Group): void {
  const { rear, cowl, half } = BUS_BODY;
  const archX = BUS_WHEELS.rear;
  for (const side of [-1, 1]) {
    const face = side * (half + 0.012);
    for (const [x0, x1] of [
      [rear + 0.04, archX - 0.72],
      [archX + 0.72, side > 0 ? BUS_DOOR.x0 - 0.06 : cowl - 0.04],
    ] as const)
      cbox(car, trim(), (x0 + x1) / 2, 0.6, side * (half + 0.02), x1 - x0, 0.32, 0.12);
    // Three rails: the lowest broken by the arch, all stopping short of the door on its side.
    const end = side > 0 ? BUS_DOOR.x0 - 0.08 : cowl - 0.08;
    for (const y of [1.02, 1.4, 1.72]) {
      const runs: [number, number][] =
        y < 1.3
          ? [
              [rear + 0.06, archX - 0.74],
              [archX + 0.74, end],
            ]
          : [[rear + 0.06, end]];
      for (const [x0, x1] of runs)
        cbox(car, rail(), (x0 + x1) / 2, y, face, x1 - x0, 0.05, 0.03, 0.01);
    }
    // The mirror: an arm out from the side just behind the front corner, forward to a tall case.
    const from = new THREE.Vector3(cowl - 0.32, 2.2, side * (half - 0.02));
    const to = new THREE.Vector3(cowl + 0.06, 2.2, side * (half + 0.26));
    const arm = cbox(car, trim(), 0, 0, 0, from.distanceTo(to), 0.05, 0.05, 0.015);
    arm.position.copy(from).add(to).multiplyScalar(0.5);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), to.clone().sub(from).normalize());
    cbox(car, trim(), cowl + 0.08, 2.05, side * (half + 0.3), 0.12, 0.46, 0.2, 0.03);
    cbox(
      car,
      glow(CAR.amber, 1.2),
      cowl + 0.145,
      1.85,
      side * (half + 0.3),
      0.02,
      0.03,
      0.14,
      0.008,
    );
  }
  // The door: two leaves of charcoal frame, each glazed nearly floor to top with a rail across,
  // in the doorway in the right side, each hung at its outer edge and folding out together.
  const { x0, x1, top, steps } = BUS_DOOR;
  const foot = steps[0]! + 0.02;
  const mid = (x0 + x1) / 2;
  const swing: Swing = { t: 0, shut: true };
  for (const [a, b, hinge, open] of [
    [x0, mid, x0, -1.4],
    [mid, x1, x1, 1.4],
  ] as const) {
    const leaf = hang(car, new THREE.Vector3(hinge, 0, half), open, 'y', swing);
    const frame = roundedOutline(
      [
        [a + 0.008, foot + 0.01],
        [b - 0.008, foot + 0.01],
        [b - 0.008, top - 0.012],
        [a + 0.008, top - 0.012],
      ],
      0.02,
    );
    const pane = (y0: number, y1: number) =>
      roundedOutline(
        [
          [a + 0.06, y0],
          [b - 0.06, y0],
          [b - 0.06, y1],
          [a + 0.06, y1],
        ],
        0.03,
      );
    const panes = [pane(foot + 0.08, 0.86), pane(0.94, 1.5), pane(1.58, top - 0.08)];
    frame.holes.push(...panes);
    put(leaf, slab(frame, 0.04, 0.008), trim(), 0, 0, half - 0.02);
    for (const p of panes)
      put(leaf, slab(p, 0.008, 0.002), glass(), 0, 0, half - 0.02).castShadow = false;
    // The rubber seal where the leaves meet, on the front one.
    if (hinge === x1)
      cbox(leaf, dark(), a + 0.01, (foot + top) / 2, half, 0.012, top - foot - 0.06, 0.006, 0.003);
  }
  stairwell(car);
  // The stop arm, folded flat against the left side under the driver's window: a red octagon,
  // rimmed white, with STOP across it and a lamp above and below.
  const arm = new THREE.Group();
  arm.position.set(1.36, 1.38, -(half + 0.03));
  arm.rotation.y = Math.PI;
  car.add(arm);
  const octagon = (r: number) =>
    new THREE.Shape(
      Array.from({ length: 8 }, (_, i) => {
        const a = ((i + 0.5) / 8) * Math.PI * 2;
        return new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r);
      }),
    );
  put(arm, slab(octagon(0.21), 0.02, 0.004), mat(0xf2f2ee, { roughness: 0.5, mottle: 'none' }));
  put(
    arm,
    slab(octagon(0.19), 0.02, 0.004),
    mat(0xc81e1e, { roughness: 0.45, mottle: 'none' }),
    0,
    0,
    0.004,
  );
  const stop = sign('STOP', 0xf2f2ee, 0xc81e1e, 0.3);
  stop.position.z = 0.016;
  arm.add(stop);
  for (const y of [-0.15, 0.15])
    put(arm, new THREE.CircleGeometry(0.03, 16), glow(BUS.red, 2), 0, y, 0.016);
  cbox(car, trim(), 1.6, 1.38, -(half + 0.02), 0.1, 0.06, 0.03, 0.01);
}

/**
 * The steps inside the door, down from the floor in a well between steel sides: two dark
 * treads, the lower out to the door, each block filled down to the one under it, their
 * nosings and the floor's edge in steel; and the floor laid over the well's open skin beside
 * them, out to the steps.
 */
function stairwell(car: THREE.Group): void {
  const { x0, x1, steps, stair, well } = BUS_DOOR;
  const { floor, inner } = BUS_CABIN;
  const half = BUS_BODY.half;
  const steel = mat(0x9aa0a4, { mottle: 'metal', roughness: 0.4, metalness: 0.7 });
  const tread = mat(0x26292b, { mottle: 'plastic', roughness: 0.85 });
  const [lo, hi] = [steps[0]!, steps[1]!];
  const base = lo - 0.1;
  const mid = (x0 + x1) / 2;
  const [w0, w1] = [x0 - 0.06, x1 + 0.06];
  // The floor out to the well, a hair over the lining's.
  const top = floor + 0.01;
  cbox(
    car,
    tread,
    (w0 + w1) / 2,
    (hi + 0.01 + top) / 2,
    (well - inner) / 2,
    w1 - w0,
    top - hi - 0.01,
    well + inner,
    0.01,
  );
  // The upper step, filled down to the lower; the lower, out to the door.
  cbox(car, tread, mid, (lo + hi) / 2, (well + stair) / 2, x1 - x0, hi - lo, stair - well, 0.01);
  cbox(
    car,
    tread,
    mid,
    (base + lo) / 2,
    (stair + half + 0.02) / 2,
    x1 - x0,
    lo - base,
    half + 0.02 - stair,
    0.01,
  );
  for (const [y, z] of [
    [top, well],
    [hi, stair],
    [lo, half + 0.02],
  ] as const)
    cbox(car, steel, mid, y - 0.006, z - 0.015, x1 - x0, 0.014, 0.034, 0.004);
  // Its steel sides, down from the floor to the lower step's foot, out to just in from the side.
  const out = half - 0.01;
  for (const x of [x0 - 0.015, x1 + 0.015])
    cbox(car, steel, x, (base + top) / 2, (well + out) / 2, 0.09, top - base, out - well, 0.01);
}

/**
 * Inside, behind the glass: the driver's seat at the wheel on the left, a dashboard of lit
 * screens under the windscreen, rows of green benches either side of the aisle back to the
 * emergency door, and lamps along the ceiling.
 */
function cabin(car: THREE.Group): void {
  const { floor, inner, ceiling } = BUS_CABIN;
  const cushion = floor + 0.44;
  // The driver's seat, black and high-backed, and the wheel before it, its column running down
  // into the dashboard under the instruments.
  seat(car, leather(0x1b1b1c), DRIVER, cushion, -0.5, floor, {
    w: 0.54,
    back: 0.78,
    recline: 0.1,
    headrest: false,
  });
  steeringWheel(car, 1.3, 1.4, -0.5, 0.21, 0.75, 0.32);
  dashboard(car);
  mirrorAndFans(car);
  // Benches down each side, an aisle between them wide enough to walk back to the emergency door.
  const green = leather(0x3d5a45);
  const bench = 0.5;
  const z = inner - bench / 2;
  for (let k = 0; k < 6; k++)
    for (const s of [-1, 1])
      seat(car, green, BENCHES - k * 0.86, cushion, s * z, floor, {
        w: bench,
        back: 0.6,
        recline: 0.12,
        headrest: false,
      });
  // A panel in front of the first bench on the door's side.
  cbox(car, green, BENCHES + 0.3, floor + 0.36, z, 0.04, 0.72, bench, 0.015);
  const lamp = glow(0xfff1d6, 0.7);
  for (const s of [-1, 1])
    cbox(car, lamp, -1.6, ceiling - 0.02, s * 0.6, 5.2, 0.012, 0.06, 0.004).castShadow = false;
}

/**
 * The dashboard, grey across the whole width under the windscreen: before the driver a hooded
 * cluster of round gauges with switches out to its left, a screen over a box of switches in the
 * middle with the heater's black box under it on the floor, and before the door a lighter
 * glovebox panel and a box up in the corner; a steel pole up from the top of the steps.
 */
function dashboard(car: THREE.Group): void {
  const { floor, inner } = BUS_CABIN;
  const grey = mat(0x8c8e8b, { mottle: 'plastic', roughness: 0.7 });
  const light = mat(0xaeafaa, { mottle: 'plastic', roughness: 0.65 });
  const black = dashPlastic();
  const top = DASH.top;
  cbox(
    car,
    grey,
    (DASH.back + DASH.front) / 2,
    (floor + top) / 2,
    0,
    DASH.front - DASH.back,
    top - floor,
    inner * 2 - 0.02,
    0.03,
  );
  // Its top, rolled over a little toward the seats and on forward to the windscreen's foot.
  const cap = [DASH.back - 0.04, DASH.front + 0.04];
  cbox(car, grey, (cap[0]! + cap[1]!) / 2, top, 0, cap[1]! - cap[0]!, 0.04, inner * 2 - 0.02, 0.02);
  // The cluster, tipped back toward the driver: a housing under a hood, two big gauges in the
  // middle and two small either side, each a dark face in a pale ring with a lit needle.
  const cluster = new THREE.Group();
  cluster.position.set(DASH.back + 0.01, top + 0.04, -0.5);
  cluster.rotation.z = -0.25;
  car.add(cluster);
  cbox(cluster, grey, 0.07, 0, 0, 0.14, 0.2, 0.5, 0.03);
  cbox(cluster, grey, 0.05, 0.11, 0, 0.2, 0.03, 0.52, 0.012);
  const face = mat(0x16181a, { roughness: 0.5 });
  const ring = mat(0xd9d9d2, { roughness: 0.4 });
  const needle = glow(CAR.amber, 1.4);
  for (const [y, z, r] of [
    [0, -0.09, 0.055],
    [0, 0.09, 0.055],
    [0.045, -0.2, 0.028],
    [-0.045, -0.2, 0.028],
    [0.045, 0.2, 0.028],
    [-0.045, 0.2, 0.028],
  ] as const) {
    put(cluster, new THREE.CircleGeometry(r, 24), face, -0.002, y, z, 0, -Math.PI / 2);
    put(cluster, new THREE.RingGeometry(r, r + 0.008, 24), ring, -0.003, y, z, 0, -Math.PI / 2);
    cbox(
      cluster,
      needle,
      -0.005,
      y + r * 0.3,
      z - r * 0.2,
      0.002,
      r * 0.7,
      0.005,
      0.001,
      [0.6, 0, 0],
    );
  }
  // Switches out to the left of the wheel, on a black panel.
  cbox(car, black, DASH.back - 0.03, top - 0.08, -0.8, 0.08, 0.12, 0.22, 0.015);
  for (const z of [-0.87, -0.8, -0.73])
    cbox(car, light, DASH.back - 0.072, top - 0.08, z, 0.012, 0.04, 0.03, 0.004);
  // The middle: a screen in a grey housing, a black box of switches under it, some lit, and the
  // heater's box under that on the floor.
  cbox(car, grey, DASH.back - 0.03, top - 0.12, -0.07, 0.12, 0.3, 0.3, 0.02);
  dashScreen(car, DASH.back - 0.095, top - 0.06, -0.07, 0.2, 0.11, 0.2);
  cbox(car, black, DASH.back - 0.06, top - 0.24, -0.07, 0.08, 0.1, 0.26, 0.012);
  for (const [z, lit] of [
    [-0.15, true],
    [-0.1, false],
    [-0.04, true],
    [0.02, false],
  ] as const)
    cbox(
      car,
      lit ? glow(CAR.amber, 1.2) : light,
      DASH.back - 0.102,
      top - 0.24,
      z,
      0.006,
      0.03,
      0.035,
      0.003,
    );
  cbox(car, black, DASH.back + 0.02, floor + 0.19, -0.07, 0.3, 0.38, 0.36, 0.02);
  // Before the door: a lighter glovebox panel with its handle, and a box up in the corner.
  cbox(car, light, DASH.back - 0.01, top - 0.1, 0.34, 0.03, 0.16, 0.5, 0.02);
  cbox(car, black, DASH.back - 0.027, top - 0.1, 0.34, 0.006, 0.025, 0.12, 0.004);
  cbox(car, light, DASH.back + 0.1, top + 0.08, 0.74, 0.24, 0.16, 0.34, 0.03);
  // Vents along its top.
  for (const z of [-0.78, -0.25, 0.3])
    cbox(car, black, DASH.back + 0.04, top + 0.021, z, 0.06, 0.004, 0.18, 0.002);
  // The pole: up from the top of the steps and bent forward into the dashboard.
  const steel = mat(CAR.steel, { mottle: 'metal', roughness: 0.28, metalness: 0.9 });
  const [px, pz, py] = [DASH.back - 0.12, BUS_DOOR.well - 0.05, top - 0.1];
  put(car, new THREE.CylinderGeometry(0.02, 0.02, py - floor, 14), steel, px, (floor + py) / 2, pz);
  put(car, new THREE.SphereGeometry(0.02, 14, 10), steel, px, py, pz);
  put(
    car,
    new THREE.CylinderGeometry(0.02, 0.02, 0.14, 14),
    steel,
    px + 0.07,
    py,
    pz,
    0,
    0,
    Math.PI / 2,
  );
  // Its foot, a flange on the floor.
  put(car, new THREE.CylinderGeometry(0.04, 0.04, 0.012, 18), steel, px, floor + 0.006, pz);
}

/**
 * A wide mirror hung from the ceiling at the windscreen's head, a fan under it and another up
 * in the corner over the driver's window.
 */
function mirrorAndFans(car: THREE.Group): void {
  const { ceiling } = BUS_CABIN;
  const black = dashPlastic();
  const y = 2.66;
  cbox(car, black, 1.6, (y + ceiling) / 2, 0, 0.02, ceiling - y, 0.03, 0.006);
  cbox(car, black, 1.6, y, 0, 0.03, 0.14, 0.8, 0.02);
  cbox(
    car,
    mat(0xdde4e8, { roughness: 0.06, metalness: 1 }),
    1.584,
    y,
    0,
    0.004,
    0.11,
    0.76,
    0.002,
  );
  // A fan facing the driver: a ring of a guard round a blur of blades, on its hub, on a stem.
  const fan = (x: number, fy: number, z: number, yaw: number, stem: number) => {
    const g = new THREE.Group();
    g.position.set(x, fy, z);
    g.rotation.y = yaw;
    car.add(g);
    put(g, new THREE.TorusGeometry(0.085, 0.007, 8, 28), black);
    put(
      g,
      new THREE.CircleGeometry(0.08, 24),
      mat(0x2b2c2d, { roughness: 0.6, side: THREE.DoubleSide }),
    );
    const hub = new THREE.CylinderGeometry(0.025, 0.03, 0.05, 16);
    hub.rotateX(Math.PI / 2);
    put(g, hub, black, 0, 0, -0.02);
    cbox(g, black, 0, stem / 2, -0.03, 0.015, stem, 0.015, 0.004);
  };
  fan(1.56, 2.44, 0.12, -Math.PI / 2, 0.16);
  fan(1.5, 2.5, -0.8, -Math.PI / 2 - 0.5, 0.3);
}

/**
 * The tail: the emergency door with its window in a charcoal frame, a window either side of it,
 * red and amber lamps, the sign and flashers up top, and a charcoal bumper lit blue.
 */
function tail(car: THREE.Group): void {
  const x = BUS_BODY.rear;
  // A framed window on the tail, glass set back in its frame: `z0`..`z1` across, `y0`..`y1` up.
  const framed = (z0: number, z1: number, y0: number, y1: number, y2 = y0) => {
    const frame = roundedOutline(
      [
        [z0 - 0.06, y2 - 0.06],
        [z1 + 0.06, y2 - 0.06],
        [z1 + 0.06, y1 + 0.06],
        [z0 - 0.06, y1 + 0.06],
      ],
      0.04,
    );
    const hole = roundedOutline(
      [
        [z0, y0],
        [z1, y0],
        [z1, y1],
        [z0, y1],
      ],
      0.04,
    );
    frame.holes.push(hole);
    put(car, slab(frame, 0.03, 0.008), trim(), x - 0.012, 0, 0, 0, -Math.PI / 2, 0);
    put(car, slab(hole, 0.008, 0.002), glass(), x - 0.004, 0, 0, 0, -Math.PI / 2, 0).castShadow =
      false;
  };
  // The tail's wall, built apart from the body's skin: through it the emergency door's way and a
  // window either side, painted outside and lined inside.
  const { inner, tail: thick, floor } = BUS_CABIN;
  const { half: dh, top } = BUS_BACK_DOOR;
  const rect = (z0: number, z1: number, y0: number, y1: number, r: number) =>
    roundedOutline(
      [
        [z0, y0],
        [z1, y0],
        [z1, y1],
        [z0, y1],
      ],
      r,
    );
  const sideWindows = [-1, 1].map((s) =>
    rect(s > 0 ? 0.54 : -0.88, s > 0 ? 0.88 : -0.54, SILL, HEAD, 0.04),
  );
  const wall = rect(-inner - 0.01, inner + 0.01, BUS_BODY.sill, BUS_BODY.roof - 0.14, 0.01);
  wall.holes.push(rect(-dh, dh, floor, top, 0.03), ...sideWindows);
  put(
    car,
    weather(slab(wall, thick, 0.02), 'slab', false, WORN),
    paint(),
    x + thick / 2,
    0,
    0,
    0,
    -Math.PI / 2,
    0,
  );
  // Inside, a panel in the paint the sides show within.
  const card = rect(-inner + 0.01, inner - 0.01, floor, BUS_CABIN.ceiling, 0.01);
  card.holes.push(rect(-dh - 0.01, dh + 0.01, floor - 0.01, top + 0.01, 0.03), ...sideWindows);
  put(
    car,
    weather(slab(card, 0.012, 0.004), 'slab', false, WORN),
    paint(),
    x + thick + 0.006,
    0,
    0,
    0,
    -Math.PI / 2,
    0,
  );
  // The emergency door: hung at its left edge (seen from behind), swinging out; its window high
  // up in a charcoal frame running on down round it, and a handle.
  const door = hang(car, new THREE.Vector3(x, 0, -dh), -1.45);
  const leaf = rect(-dh + 0.006, dh - 0.006, floor + 0.006, top - 0.006, 0.02);
  const light = rect(-0.3, 0.3, SILL, HEAD - 0.1, 0.04);
  leaf.holes.push(light);
  put(
    door,
    weather(slab(leaf, 0.05, 0.01), 'slab', false, WORN),
    paint(),
    x + 0.03,
    0,
    0,
    0,
    -Math.PI / 2,
    0,
  );
  put(door, slab(light, 0.008, 0.002), glass(), x + 0.03, 0, 0, 0, -Math.PI / 2, 0).castShadow =
    false;
  const surround = rect(-dh + 0.03, dh - 0.03, floor + 0.04, top - 0.04, 0.03);
  surround.holes.push(rect(-dh + 0.09, dh - 0.09, floor + 0.1, top - 0.1, 0.03));
  put(door, slab(surround, 0.012, 0.004), trim(), x - 0.0, 0, 0, 0, -Math.PI / 2, 0);
  cbox(door, mat(0x23272a, { roughness: 0.6 }), x - 0.01, 1.5, 0.24, 0.03, 0.06, 0.18, 0.01);
  for (const side of [-1, 1]) {
    framed(side > 0 ? 0.54 : -0.88, side > 0 ? 0.88 : -0.54, SILL, HEAD);
    // Lamps: red tail lamps over amber ones, ringed in charcoal.
    for (const [y, colour] of [
      [1.32, BUS.red],
      [1.06, CAR.amber],
    ] as const) {
      const z = side * 0.86;
      put(
        car,
        new THREE.CylinderGeometry(0.11, 0.11, 0.03, 24),
        mat(0x1d2124, { roughness: 0.5 }),
        x - 0.005,
        y,
        z,
        0,
        0,
        Math.PI / 2,
      );
      put(
        car,
        new THREE.CircleGeometry(0.085, 24),
        glow(colour, 2.2),
        x - 0.022,
        y,
        z,
        0,
        -Math.PI / 2,
        0,
      );
    }
  }
  // The bumper, two steps let down into it under the door, each a stride up from the last to the
  // floor: its ends either side at full height, between them a lower block standing out of the
  // bar for the first step, its tread ribbed, and behind it, under the bar's top, the second.
  const [b0, b1, low, high] = [0.45, 0.75, 0.28, 0.62];
  const end = 1.15 - dh - 0.05;
  for (const side of [-1, 1]) {
    const zc = side * (dh + 0.05 + end / 2);
    cbox(car, bumperMat(), x - 0.08, (b0 + b1) / 2, zc, 0.28, b1 - b0, end, 0.03);
    cbox(car, glow(CAR.blue, 3), x - 0.225, 0.52, side * (dh + 0.42), 0.02, 0.03, 0.6, 0.008);
  }
  cbox(car, bumperMat(), x - 0.04, (low + high) / 2, 0, 0.2, high - low, dh * 2 + 0.12, 0.02);
  cbox(car, bumperMat(), x - 0.16, (0.14 + low) / 2, 0, 0.44, low - 0.14, dh * 2 + 0.1, 0.03);
  for (let i = -3; i <= 3; i++)
    for (const [xc, y] of [
      [x - 0.26, low],
      [x - 0.05, high],
    ] as const)
      cbox(car, dark(), xc, y + 0.004, i * 0.11, 0.18, 0.012, 0.05, 0.004);
  flashers(car, x, -1);
}

/** Builds the bus, standing at the origin facing +x. */
export function buildBus(): Car {
  const car = new THREE.Group();
  car.name = 'bus';
  body(car);
  cabin(car);
  bonnet(car);
  nose(car);
  sides(car);
  tail(car);
  flashers(car, BUS_BODY.cowl - 0.22 + 0.12, 1);
  const wheels: THREE.Group[] = [];
  for (const [xc, out] of [
    [BUS_WHEELS.front, BUS_WHEELS.frontSide],
    [BUS_WHEELS.rear, BUS_WHEELS.rearSide],
  ] as const)
    for (const side of [-1, 1]) {
      const half = xc > 0 ? BUS_BODY.bonnetHalf : BUS_BODY.half;
      flare(car, xc, side, 1, half + 0.12);
      const w = makeWheel();
      w.position.set(xc, WHEELS.radius, side * (out - WHEELS.tuck));
      w.rotation.set(WHEELS.tilt, side < 0 ? Math.PI : 0, 0, 'YXZ');
      w.updateMatrixWorld(true);
      w.position.y -= new THREE.Box3().setFromObject(w).min.y;
      car.add(w);
      wheels.push(w);
    }
  return { root: car, wheels };
}
