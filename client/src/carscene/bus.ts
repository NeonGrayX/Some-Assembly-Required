import * as THREE from 'three';
import { CAR, WHEELS, archCut, chevronShape, flare, makeWheel, shutLine, weather } from './car.ts';
import type { Car } from './car.ts';
import { glazedShell } from './glazing.ts';
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
 * about 8.5 m from bumper to tail and 3 m to the roof.
 */

/** Its paint, its seams' dark groove and light lip in that paint, and its lamps. */
export const BUS = {
  yellow: 0xf0bd1c,
  seam: 0x3b2a06,
  lip: 0xffe08a,
  rail: 0x1d1e1f,
  red: 0xff2a20,
};

/** Its wheels' centres along x, and out to each side at the bonnet and under the body. */
export const BUS_WHEELS = { front: 2.62, rear: -2.6, frontSide: 1.32, rearSide: 1.44 };

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
  roof: 2.74,
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
const seam = () => mat(BUS.seam, { mottle: 'none', roughness: 0.85 });
const lip = () => mat(BUS.lip, { mottle: 'none', roughness: 0.5 });
const trim = () => mat(CAR.trim, { mottle: 'plastic', roughness: 0.6 });
const bumperMat = () => mat(CAR.bumper, { mottle: 'plastic', roughness: 0.45 });
const rail = () => mat(BUS.rail, { mottle: 'plastic', roughness: 0.5 });
const dark = () => mat(0x1c1f21, { mottle: 'none', roughness: 0.9 });
/** Tinted glass, dark as the cars'. */
const glass = () =>
  mat(0x231812, { mottle: 'none', roughness: 0.05, metalness: 0.2, envMapIntensity: 2.6 });

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
  const outline = roundedOutline(
    [
      [rear + b, sill + b, 0.02],
      ...archCut(BUS_WHEELS.rear, sill + b),
      [cowl - b, sill + b, 0.02],
      [foot.x, foot.y, 0.03],
      [head.x, head.y, 0.1],
      [rear + b, roof - b, 0.12],
    ],
    0.015,
  );
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
  const openings = [window(1.18, 1.62, 1.78, 2.52)];
  for (let k = 0; k < 6; k++) {
    const c = 0.62 - k * 0.86;
    openings.push(window(c - 0.37, c + 0.37, 1.86, 2.52));
  }
  const d = 0.03;
  const [e0, e1] = [0.05, 0.13];
  const shell = glazedShell({
    outline,
    openings,
    half,
    pillar: 0.2,
    b,
    d,
    runs: [[foot, head, e0, e1]],
    paint: paint(),
    glass,
    worn: WORN,
  });
  for (const m of [...shell.children]) car.add(m);
  // Each window split by a bar across it, a little below its top: the sliding pane's frame.
  const bar = mat(0x9aa0a4, { mottle: 'metal', roughness: 0.35, metalness: 0.8 });
  for (const side of [-1, 1])
    for (let k = 0; k < 6; k++) {
      const c = 0.62 - k * 0.86;
      cbox(car, bar, c, 2.3, side * (half - 0.028), 0.7, 0.03, 0.012, 0.006);
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

  // The wells inside the rear arches, dark, and the underside.
  rbox(car, dark(), BUS_WHEELS.rear, 0.95, 0, 1.3, 0.6, half * 2 - 0.3, 0.05);
  rbox(
    car,
    dark(),
    (rear + BUS_BODY.front) / 2,
    0.56,
    0,
    BUS_BODY.front - rear - 0.4,
    0.2,
    half * 2 - 0.2,
    0.05,
  );
}

/**
 * The bonnet: a narrower slab out ahead of the body, cut out over the front wheels, rolling
 * over into its nose; its shut lines down each side and a louvred vent on each flank.
 */
function bonnet(car: THREE.Group): void {
  const { front, cowl, sill, bonnetHalf, bonnet: top } = BUS_BODY;
  const b = 0.05;
  const outline = roundedOutline(
    [
      [cowl - 0.1, sill + b, 0.02],
      ...archCut(BUS_WHEELS.front, sill + b),
      [front - b, sill + b, 0.02],
      [front - b, top - 0.18 - b, 0.12],
      [front - 0.3, top - 0.08 - b, 0.2],
      [cowl - 0.1, top - b, 0.02],
    ],
    0.015,
  );
  const shell = put(car, weather(slab(outline, bonnetHalf * 2, b), 'slab', false, WORN), paint());
  rbox(car, dark(), BUS_WHEELS.front, 0.95, 0, 1.3, 0.6, bonnetHalf * 2 - 0.3, 0.05);
  // The shut lines where the bonnet lifts, laid on its top: along each side and across its back.
  shell.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const onTop = (x: number, z: number) => {
    ray.set(new THREE.Vector3(x, 5, z), new THREE.Vector3(0, -1, 0));
    return ray.intersectObject(shell, false)[0]!.point;
  };
  const edge = bonnetHalf - 0.12;
  const [x0, x1] = [cowl + 0.08, front - 0.3];
  const seamAlong = (pts: [number, number][]) => {
    for (let k = 0; k < pts.length - 1; k++)
      shutLine(
        car,
        onTop(...pts[k]!),
        onTop(...pts[k + 1]!),
        new THREE.Vector3(0, 1, 0),
        seam(),
        lip(),
      );
  };
  for (const side of [-1, 1])
    seamAlong(
      Array.from({ length: 7 }, (_, k): [number, number] => [
        x0 + ((x1 - x0) * k) / 6,
        side * edge,
      ]),
    );
  seamAlong([
    [x0, -edge],
    [x0, edge],
  ]);
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
      [archX + 0.72, side > 0 ? 1.08 : cowl - 0.04],
    ] as const)
      cbox(car, trim(), (x0 + x1) / 2, 0.6, side * (half + 0.02), x1 - x0, 0.32, 0.12);
    // Three rails: the lowest broken by the arch, all stopping short of the door on its side.
    const end = side > 0 ? 1.06 : cowl - 0.08;
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
  // The door: two leaves of charcoal frame, each glazed, standing just proud of the right side.
  const door = new THREE.Shape([
    new THREE.Vector2(1.12, 0.68),
    new THREE.Vector2(1.76, 0.68),
    new THREE.Vector2(1.76, 1.76),
    new THREE.Vector2(1.12, 1.76),
  ]);
  const panes = [
    [1.18, 1.42],
    [1.46, 1.7],
  ].map(([x0, x1]) =>
    roundedOutline(
      [
        [x0!, 0.8],
        [x1!, 0.8],
        [x1!, 1.68],
        [x0!, 1.68],
      ],
      0.03,
    ),
  );
  door.holes.push(...panes);
  put(car, slab(door, 0.03, 0.008), trim(), 0, 0, half + 0.012);
  for (const p of panes)
    put(car, slab(p, 0.008, 0.002), glass(), 0, 0, half + 0.004).castShadow = false;
  cbox(car, dark(), 1.44, 1.22, half + 0.028, 0.012, 1.06, 0.006, 0.003);
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
  // The door's frame runs on down to its foot.
  framed(-0.36, 0.36, 1.86, 2.46, 0.8);
  cbox(car, mat(0x23272a, { roughness: 0.6 }), x - 0.03, 1.5, -0.24, 0.02, 0.06, 0.18, 0.01);
  for (const side of [-1, 1]) {
    framed(side > 0 ? 0.56 : -0.92, side > 0 ? 0.92 : -0.56, 1.86, 2.46);
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
  cbox(car, bumperMat(), x - 0.08, 0.6, 0, 0.28, 0.3, 2.3, 0.03);
  cbox(car, glow(CAR.blue, 3), x - 0.225, 0.52, 0, 0.02, 0.03, 1.6, 0.008);
  flashers(car, x, -1);
}

/** Builds the bus, standing at the origin facing +x. */
export function buildBus(): Car {
  const car = new THREE.Group();
  car.name = 'bus';
  body(car);
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
