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
import { dashPlastic, dashScreen, leather as cabinLeather, seat, steeringWheel } from './cabin.ts';
import { clipX, hang, lidOff, notch, outlinePoints, widen } from './doors.ts';
import { inset, liningWalls } from './glazing.ts';
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
  /** How far each wheel sits in from `side` (and the others' from theirs), under its arch. */
  tuck: 0.2,
};

/** How high the vehicles hover, their wheels clear of the ground. */
export const HOVER = 0.16;

/**
 * How far the body is squashed down onto its wheels: drawn to the lines below, then scaled down
 * in y toward the ground, so its floor comes a little over a grown player's knee and its roof (the
 * rack apart) a head over theirs. Its arches are cut so they come out round once squashed.
 */
export const SQUASH = 0.78;

/** The body's lines along x and up y, before it is squashed (see `SQUASH`). */
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
    opacity: 0.74,
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

/** The arches' (and their flares') centre: lower than the wheels', down close over their tops. */
const ARCH_Y = FLARE.y - 0.1;

/** `archCut` in the body's frame, stretched up so that squashed it is round over its wheel. */
function bodyArch(xc: number, foot: number): [number, number][] {
  return archCut(xc, foot * SQUASH, 1, ARCH_Y).map(([x, y]) => [x, y / SQUASH]);
}

/** The side doors, front and rear, each side: its front and back edges along x. */
const DOOR_SPANS = { front: [-0.4, 0.72], rear: [-1.37, -0.5] } as const;
type DoorKind = keyof typeof DOOR_SPANS;
const DOOR_KINDS: DoorKind[] = ['front', 'rear'];
/** Each side door, by kind and side (-1 left, 1 right): built in the car's frame. */
type Doors = Record<DoorKind, Record<number, THREE.Group>>;
/** The sills' top, under the doors, and the doors' feet on them; the head of their windows' frames. */
const SILL_TOP = 0.82;
const DOOR_FOOT = SILL_TOP + 0.02;
const DOOR_HEAD = BODY.roof - 0.1;
/** How thick the lower body's sides are, the doors cut out of them. */
const SKIN = 0.06;
/** The doors' trim inside: how thick, in to the windows' frames, and its top, at their foot. */
const CARD = { thick: 0.06, top: BODY.belt + 0.04 };
/** Where the cabin's well is cut down into the lower body, to its floor. */
const CABIN_WELL = [new THREE.Vector2(-2.5, 0.74), new THREE.Vector2(0.7, 0.74)];
/**
 * The cabin's furnishing: its floor, the seats' cushions' top, the front seats' and the bench's
 * middles along x, and the front seats' out from the middle.
 */
const INTERIOR = {
  floor: CABIN_WELL[0]!.y,
  cushion: 1.1,
  frontSeat: -0.3,
  rear: -1.22,
  seatZ: 0.44,
};
/** The console between the front seats: along x, and half its width. */
const CONSOLE = { x0: -0.1, x1: 0.32, half: 0.15 };
/** The dashboard: its back face, over the knees, along x; its top, and its underside. */
const DASH = { back: 0.3, top: 1.74, under: 1.4 };

/**
 * The bonnet: from its back edge by the windscreen to its front short of the nose's roll, and out
 * to each side (its edges along x); the nose ahead of `cut` is built apart, the bonnet cut out
 * of its middle.
 */
const HOOD = { x0: BODY.screenFoot + 0.06, x1: BODY.front - 0.12, edge: 0.815, cut: 0.95 };
/**
 * The tailgate: out to each side, from its foot nearly to the roof, how thick it is; the tail
 * behind `cut` is built apart, the tailgate cut out of it.
 */
const TAILGATE = {
  edge: 0.78,
  foot: 0.74,
  head: BODY.roof - 0.14,
  t: 0.06,
  cut: -2.45,
};
/** The bonnet's and the tailgate's hinges' doors, built in the car's frame. */
interface Lids {
  hood: THREE.Group;
  tailgate: THREE.Group;
}

/** Hangs the bonnet on its back edge, lifting at its front, and the tailgate on its right side. */
function hangLids(car: THREE.Group): Lids {
  const hood = hang(car, new THREE.Vector3(HOOD.x0, bonnetAt(HOOD.x0), 0), 0.95, 'z');
  hood.parent!.userData.what = 'bonnet';
  const at = new THREE.Vector3(BODY.rear, 0, TAILGATE.edge);
  const tailgate = hang(car, at, 1.5);
  tailgate.parent!.userData.what = 'tailgate';
  return { hood, tailgate };
}

/**
 * A line from `x0` to `x1` clear over `arch` (a wheel's arch cut, as `archCut` makes it) by `gap`,
 * and no lower than `low`.
 */
export function overArch(
  arch: [number, number][],
  x0: number,
  x1: number,
  low: number,
  gap: number,
) {
  const xs = [x0, ...arch.map(([x]) => x).filter((x) => x > x0 && x < x1), x1];
  return xs.map((x) => new THREE.Vector2(x, Math.max(low, topAt(arch, x) + gap)));
}

/** The roof's glass panel along x: behind the windscreen's head, so the roof is cut round it. */
const ROOF_GLASS = { x0: -1.3, x1: -0.12 };

/** Hangs the side doors, each on a hinge at its front edge, swinging out from the body. */
function hangDoors(car: THREE.Group): Doors {
  const doors = { front: {}, rear: {} } as Doors;
  for (const k of DOOR_KINDS)
    for (const side of [-1, 1])
      doors[k][side] = hang(
        car,
        new THREE.Vector3(DOOR_SPANS[k][1], 0, side * BODY.half),
        side * 1.15,
      );
  return doors;
}

/** The highest point of the line through `points` straight over `x`, if any. */
function topAt(points: [number, number][], x: number): number {
  let top = -Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const [[x0, y0], [x1, y1]] = [points[i]!, points[i + 1]!];
    if (x0 < x === x1 < x) continue;
    top = Math.max(top, y0 + ((y1 - y0) * (x - x0)) / (x1 - x0));
  }
  return top;
}

/** A side door's foot, under its lower panel: the rear door's clears the rear arch, round it. */
function doorFoot(k: DoorKind): THREE.Vector2[] {
  const [x0, x1] = DOOR_SPANS[k];
  return overArch(bodyArch(WHEELS.rear, BODY.sill + 0.035), x0, x1, DOOR_FOOT, 0.09);
}

/**
 * The nose's middle (`plain`, the lower body's outline ahead of the bonnet's cut, with no arch cut
 * out of it: the front wheels stand only under the strips, their wells beside the engine): the
 * bonnet cut off its top over the engine's well, deep enough for the engine to sit under the
 * shut bonnet, and a strip either side of it out to `inner` (`nose`, cut over the wheels); the
 * well lined dark, the engine in it, its turbine's core lit blue.
 */
function bonnetBay(
  car: THREE.Group,
  nose: THREE.Vector2[],
  plain: THREE.Vector2[],
  inner: number,
  b: number,
  hood: THREE.Group,
): void {
  // The engine stands 0.2 tall: its well's floor that and a little more under the bonnet's
  // underside where it is lowest, at its front.
  const deep = bonnetAt(HOOD.x1) - 0.1 - 0.24;
  const floor = [new THREE.Vector2(HOOD.x0, deep), new THREE.Vector2(HOOD.x1, deep)];
  const { lid, rest } = lidOff(plain, floor, 0.1, b);
  put(car, weather(slab(new THREE.Shape(rest), HOOD.edge * 2, b), 'slab', true), paintWorn());
  const strip = weather(slab(new THREE.Shape(nose), inner - HOOD.edge, b), 'slab', true);
  for (const s of [-1, 1]) put(car, strip, paintWorn(), 0, 0, (s * (HOOD.edge + inner)) / 2);
  const lidGeo = slab(new THREE.Shape(inset(lid, 0.022)), HOOD.edge * 2 - 0.012, 0.015);
  put(hood, weather(lidGeo, 'slab', true), paintWorn());
  // The well, lined, from the highest of its floor up under the bonnet.
  const low = Math.max(...floor.map((p) => p.y));
  const [x0, x1] = [HOOD.x0 + 0.03, HOOD.x1 - 0.03];
  put(
    car,
    new THREE.BoxGeometry(x1 - x0, bonnetAt(HOOD.x0) - 0.1 - low, HOOD.edge * 2 - 0.04),
    mat(0x16191b, { roughness: 0.9, side: THREE.BackSide }),
    (x0 + x1) / 2,
    (low + bonnetAt(HOOD.x0) - 0.1) / 2,
    0,
  ).castShadow = false;
  // The engine: a dark block, its two covers ribbed along it, and between them a turbine's
  // housing lit blue at its core.
  const block = mat(0x2a2d30, { mottle: 'metal', roughness: 0.45, metalness: 0.6 });
  const mid = (x0 + x1) / 2;
  rbox(car, block, mid, low + 0.06, 0, x1 - x0 - 0.3, 0.12, 1.1, 0.03);
  for (const z of [-0.36, 0.36])
    rbox(car, dark(), mid, low + 0.14, z, x1 - x0 - 0.4, 0.06, 0.24, 0.025);
  const housing = new THREE.CylinderGeometry(0.15, 0.17, 0.08, 28);
  put(car, housing, steel(), mid, low + 0.16, 0);
  put(
    car,
    new THREE.CircleGeometry(0.1, 24),
    glow(CAR.blue, 2.4),
    mid,
    low + 0.201,
    0,
    -Math.PI / 2,
  );
}

/**
 * The tail's middle behind the tailgate's cut (out to `inner` each side): a column either side of
 * the tailgate, and between them the sill under it, level with the cargo floor; and the
 * tailgate's lower panel, up to the glasshouse's foot.
 */
function tailBay(car: THREE.Group, inner: number, b: number, tailgate: THREE.Group): void {
  const [x0, x1] = [BODY.rear + b, TAILGATE.cut - b];
  const rect = (y0: number, y1: number) =>
    new THREE.Shape([
      new THREE.Vector2(x0, y0),
      new THREE.Vector2(x1, y0),
      new THREE.Vector2(x1, y1),
      new THREE.Vector2(x0, y1),
    ]);
  const column = weather(
    slab(rect(BODY.sill + b, BODY.belt - b), inner - TAILGATE.edge, b),
    'slab',
    true,
  );
  for (const s of [-1, 1]) put(car, column, paintWorn(), 0, 0, (s * (TAILGATE.edge + inner)) / 2);
  // Under the tailgate, the cargo floor's sill, level with the floor inside.
  put(
    car,
    weather(slab(rect(BODY.sill + b, TAILGATE.foot - b), TAILGATE.edge * 2, b), 'slab', true),
    paintWorn(),
  );
  // The tailgate's lower panel, trimmed inside as the doors are.
  const [z, y0, y1] = [TAILGATE.edge - 0.026, TAILGATE.foot + 0.026, BODY.cowl - 0.05];
  const panel = roundedOutline(
    [
      [-z, y0],
      [z, y0],
      [z, y1],
      [-z, y1],
    ],
    0.02,
  );
  const lower = put(tailgate, weather(slab(panel, TAILGATE.t, 0.02), 'slab', true), paintWorn());
  lower.rotation.y = Math.PI / 2;
  lower.position.x = BODY.rear + TAILGATE.t / 2;
  const card = roundedOutline(
    [
      [-z + 0.05, y0 + 0.05],
      [z - 0.05, y0 + 0.05],
      [z - 0.05, y1 - 0.02],
      [-z + 0.05, y1 - 0.02],
    ],
    0.02,
  );
  const trimmed = put(
    tailgate,
    slab(card, 0.016, 0.006),
    mat(0x3a2a1e, { mottle: 'plastic', roughness: 0.8 }),
  );
  trimmed.rotation.y = Math.PI / 2;
  trimmed.position.x = BODY.rear + TAILGATE.t + 0.006;
}

/** The lower body: a slab from tail to nose, cut out over the wheels, its doors cut out of it. */
function lowerBody(car: THREE.Group, doors: Doors, lids: Lids): void {
  const b = 0.035;
  const arch = (xc: number) => bodyArch(xc, BODY.sill + b);
  // Its side, and the same with no arches cut out for its middle, between the wheels.
  const profile = (arches: boolean) =>
    roundedOutline(
      [
        [BODY.rear + b, BODY.sill + b, 0.01],
        ...(arches ? [...arch(WHEELS.rear), ...arch(WHEELS.front)] : []),
        [BODY.front - b, BODY.sill + b, 0.01],
        // The bonnet's nose rolls over into the grille's surround.
        [BODY.front - b, BODY.waist - b, 0.08],
        [BODY.screenFoot + 0.04, BODY.cowl - b, 0.02],
        [BODY.screenFoot - 0.1, BODY.belt - b, 0.02],
        [BODY.rear + b, BODY.belt - b, 0.02],
      ],
      0.015,
    );
  const outline = profile(true);
  // Its edges crisp, rounded only a little, as pressed steel: they catch a line of light. Its
  // sides are skins with the doors cut out of them, and between them the middle, the cabin's
  // well cut down into it.
  const points = outlinePoints(outline);
  let side = points;
  for (const k of DOOR_KINDS) side = notch(side, widen(doorFoot(k), b, true), true).rest;
  // The well cut low, down nearly to the sills, in the middle without arches: the rear wheels
  // stand only under the sides, their wells up into the cabin beside the floor.
  const well = notch(outlinePoints(profile(false)), widen(CABIN_WELL, b, true), true).rest;
  const inner = BODY.half - SKIN;
  const main = clipX(clipX(well, TAILGATE.cut + b, true), HOOD.cut - b, false);
  put(car, weather(slab(new THREE.Shape(main), inner * 2, b), 'slab', true), paintWorn());
  const plain = clipX(outlinePoints(profile(false)), HOOD.cut + b, true);
  bonnetBay(car, clipX(points, HOOD.cut + b, true), plain, inner, b, lids.hood);
  tailBay(car, inner, b, lids.tailgate);
  const skin = weather(slab(new THREE.Shape(side), SKIN, b), 'slab', true);
  for (const s of [-1, 1]) put(car, skin, paintWorn(), 0, 0, s * (BODY.half - SKIN / 2));
  // The doors' lower panels, a hair in from their cuts all round, trimmed inside in the cabin's
  // brown: a panel in as far as the window's frame above it, and up over the frame's foot to the
  // window, so the door reads as one inside.
  const card = mat(0x3a2a1e, { mottle: 'plastic', roughness: 0.8 });
  const bronze = mat(0x8c6c44, { mottle: 'metal', roughness: 0.35, metalness: 0.8 });
  for (const k of DOOR_KINDS) {
    const panel = inset(notch(points, doorFoot(k), true).piece, 0.026);
    const geo = weather(slab(new THREE.Shape(panel), SKIN, 0.02), 'slab', true);
    const inside = inset(panel, 0.05);
    for (const p of inside) if (p.y > BODY.belt - 0.2) p.y = CARD.top;
    const trimmed = slab(new THREE.Shape(inside), CARD.thick, 0.006);
    for (const s of [-1, 1]) {
      put(doors[k][s]!, geo, paintWorn(), 0, 0, s * (BODY.half - SKIN / 2));
      put(doors[k][s]!, trimmed, card, 0, 0, s * (BODY.half - SKIN - CARD.thick / 2));
      // An armrest along it, level with the console's, a bronze pull under its front, and low on
      // the front door a speaker's grille.
      const [x0, x1] = DOOR_SPANS[k];
      const face = BODY.half - SKIN - CARD.thick;
      const arm = INTERIOR.cushion + 0.2;
      cbox(
        doors[k][s]!,
        card,
        (x0 + x1) / 2,
        arm,
        s * (face - 0.035),
        x1 - x0 - 0.24,
        0.06,
        0.07,
        0.02,
      );
      cbox(
        doors[k][s]!,
        bronze,
        x1 - 0.32,
        arm - 0.08,
        s * (face - 0.012),
        0.22,
        0.03,
        0.024,
        0.008,
      );
      if (k === 'front') {
        const grille = new THREE.CylinderGeometry(0.09, 0.09, 0.012, 24);
        grille.rotateX(Math.PI / 2);
        put(doors[k][s]!, grille, dark(), x1 - 0.22, INTERIOR.floor + 0.2, s * (face - 0.006));
      }
    }
  }
  // The wheel wells inside the arches, dark, so the arches are not tunnels: either side of the
  // engine under the bonnet, along each side under the cabin; over the wheels' tops once squashed.
  const [wy, wh] = [0.875 / SQUASH, 0.41 / SQUASH];
  for (const s of [-1, 1]) {
    rbox(car, dark(), WHEELS.front, wy, s * 0.7, 1.44, wh, 0.3, 0.05);
    rbox(car, dark(), WHEELS.rear, wy, s * 0.86, 1.3, wh, 0.22, 0.05);
  }
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
function glasshouse(car: THREE.Group, doors: Doors, tailgate: THREE.Group): void {
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
  // The doors' windows' frames are cut out of the sides from their foot up, the front door's
  // running up behind the windscreen's pillar; the quarter window is cut through.
  const frontAt = (y: number) => screenAt(y) - aPillar + 0.05;
  const kneeY = base + (BODY.screenFoot - (DOOR_SPANS.front[1] + aPillar - 0.05)) / slope;
  const heads: Record<DoorKind, THREE.Vector2[]> = {
    front: [
      new THREE.Vector2(DOOR_SPANS.front[0], DOOR_HEAD),
      new THREE.Vector2(frontAt(DOOR_HEAD), DOOR_HEAD),
      new THREE.Vector2(DOOR_SPANS.front[1], kneeY),
    ],
    rear: DOOR_SPANS.rear.map((x) => new THREE.Vector2(x, DOOR_HEAD)),
  };
  const points = outlinePoints(outline);
  let rest = points;
  for (const k of DOOR_KINDS) rest = notch(rest, widen(heads[k], b, false), false).rest;
  const sideShape = new THREE.Shape(rest);
  sideShape.holes.push(roundedOutline(sideWindows[2]!, 0.07));
  const frames = DOOR_KINDS.map((k, i) => {
    const frame = new THREE.Shape(inset(notch(points, heads[k], false).piece, 0.018));
    frame.holes.push(roundedOutline(sideWindows[i]!, 0.07));
    return { k, geo: weather(slab(frame, wall, 0.012), 'slab'), window: sideWindows[i]! };
  });
  for (const side of [-1, 1]) {
    // Leaning in toward the roof: turned about the ground's line under the side, then moved out
    // so its foot is where it stands.
    const leaning = (parent: THREE.Object3D) => {
      const g = new THREE.Group();
      g.rotation.x = -side * lean;
      g.position.z = side * BODY.belt * Math.tan(lean);
      parent.add(g);
      return g;
    };
    const g = leaning(car);
    const z = side * (BODY.cabinHalf - wall / 2);
    put(g, weather(slab(sideShape, wall, b), 'slab'), paintWorn()).position.z = z;
    pane(g, roundedOutline(sideWindows[2]!, 0.07)).position.z = z;
    // Each door's window in its frame, leaning with the side.
    for (const f of frames) {
      const d = leaning(doors[f.k][side]!);
      put(d, f.geo, paintWorn()).position.z = z;
      pane(d, roundedOutline(f.window, 0.07)).position.z = z;
    }
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
      [ROOF_GLASS.x0, -0.72],
      [ROOF_GLASS.x1, -0.72],
      [ROOF_GLASS.x1, 0.72],
      [ROOF_GLASS.x0, 0.72],
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

  // The tail, narrowed with the sides, the tailgate's top cut out of it from its foot up: the
  // tailgate's window in it, cut through it as the side windows are.
  const tailMid = (top + base) / 2;
  const tailPoints = trapezium(wFoot, wHead, top - base);
  const gateHead = [-TAILGATE.edge, TAILGATE.edge].map(
    (z) => new THREE.Vector2(z, TAILGATE.head - tailMid),
  );
  const rearWindow: [number, number][] = [
    [-0.6, 1.72 - tailMid],
    [0.6, 1.72 - tailMid],
    [0.6, y1 - tailMid],
    [-0.6, y1 - tailMid],
  ];
  const tail = new THREE.Shape(notch(tailPoints, widen(gateHead, b, false), false).rest);
  const gate = new THREE.Shape(inset(notch(tailPoints, gateHead, false).piece, 0.018));
  gate.holes.push(roundedOutline(rearWindow, 0.07));
  for (const [parent, shape] of [
    [car, tail],
    [tailgate, gate],
  ] as const) {
    const back = put(parent, weather(slab(shape, wall, b), 'slab'), paintWorn());
    back.rotation.y = Math.PI / 2;
    back.position.set(BODY.rear + wall / 2, tailMid, 0);
  }
  const rearPane = pane(tailgate, roundedOutline(rearWindow, 0.07));
  rearPane.rotation.y = Math.PI / 2;
  rearPane.position.set(BODY.rear + wall / 2, tailMid, 0);
  // Its handle under the window, a pocket with a lighter rim as the doors' are.
  rbox(tailgate, paintLip(), BODY.rear, 1.44, 0, 0.012, 0.06, 0.24, 0.01);
  const pocket = mat(0x23272a, { roughness: 0.6 });
  rbox(tailgate, pocket, BODY.rear - 0.002, 1.44, 0, 0.012, 0.04, 0.2, 0.008);

  // Inside: brown trim lining it (seen only from within), the dashboard, the seats, the wheel.
  // It runs down into the well cut in the lower body, to the floor, and up under the windscreen;
  // round the cabin and up its sides to the windows' foot, open under the glass (the windscreen,
  // the roof's panel and the tailgate's window) and over the windows, so they are seen out of.
  const lining = mat(0x2a1e16, { mottle: 'plastic', roughness: 0.8, side: THREE.BackSide });
  // Its ceiling a little under the roof's inside, not on it.
  const [floorY, ceiling, shelf] = [CABIN_WELL[0]!.y + 0.02, top - 0.08, BODY.belt - 0.015];
  const [rearIn, frontIn] = [CABIN_WELL[0]!.x + 0.02, CABIN_WELL[1]!.x - 0.02];
  const round = [
    [rearIn, floorY],
    [frontIn, floorY],
    // Over the footwell a little under the body's top at the windscreen's foot, not on it.
    [frontIn, shelf],
    [screenAt(shelf) - 0.08, shelf],
    // The windscreen.
    [screenAt(ceiling) - 0.08, ceiling],
    [ROOF_GLASS.x1, ceiling],
    // The roof's glass.
    [ROOF_GLASS.x0, ceiling],
    [rearIn, ceiling],
    // The tailgate's window.
    [rearIn, BODY.belt],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const across = (BODY.cabinHalf - wall) * 2 - 0.06;
  put(car, liningWalls(round, new Set([3, 5, 7]), across), lining).castShadow = false;
  const below = new THREE.Shape(
    [
      [rearIn, floorY],
      [frontIn, floorY],
      [frontIn, BODY.belt],
      [rearIn, BODY.belt],
    ].map(([x, y]) => new THREE.Vector2(x, y)),
  );
  for (const s of [-1, 1]) {
    const cap = new THREE.ShapeGeometry(below);
    if (s < 0) cap.scale(1, 1, -1).index!.array.reverse();
    put(car, cap, lining, 0, 0, (s * across) / 2).castShadow = false;
  }
  cabin(car);
}

/**
 * The cabin's furnishing, at a grown driver's proportions (as the picture's full-size truck has
 * it): two front seats either side of a broad console with an armrest, a bench of three behind
 * them ahead of the rear arches, and a deep dashboard across the whole width, its instruments
 * and its middle screen side by side over the wheel and the centre stack, vents at its ends.
 */
function cabin(car: THREE.Group): void {
  const { floor, cushion, rear, frontSeat, seatZ } = INTERIOR;
  const leather = cabinLeather(0x4a3222);
  const dash = dashPlastic();
  const trimMat = mat(0x3a2a1e, { mottle: 'plastic', roughness: 0.8 });
  const bronze = mat(0x8c6c44, { mottle: 'metal', roughness: 0.35, metalness: 0.8 });
  // The front seats, broad and tall-backed, their headrests up in the windows.
  for (const z of [-seatZ, seatZ])
    seat(car, leather, frontSeat, cushion, z, floor, {
      w: 0.56,
      back: 0.66,
      depth: 0.52,
      head: 0.22,
    });
  // Behind them two seats, each with its headrest, between the rear arches' wells; and between
  // those only a thin pad to sit on in a pinch, its back low and leaning with theirs.
  for (const z of [-0.47, 0.47])
    seat(car, leather, rear, cushion + 0.02, z, floor, {
      w: 0.56,
      back: 0.64,
      depth: 0.5,
      head: 0.2,
    });
  rbox(car, leather, rear + 0.02, cushion - 0.03, 0, 0.42, 0.07, 0.34, 0.03);
  cbox(car, dash, rear + 0.02, (floor + cushion - 0.06) / 2, 0, 0.36, cushion - 0.06 - floor, 0.3);
  rbox(car, leather, rear - 0.3, cushion + 0.2, 0, 0.07, 0.4, 0.32, 0.03, [0, 0, 0.22]);
  // The console between the front seats, from the centre stack back to an armrest level with the
  // seats' bolsters; the gear selector and a dial on it, lit at their tops.
  const { x0, x1, half } = CONSOLE;
  cbox(
    car,
    dash,
    (x0 + x1) / 2,
    (floor + cushion + 0.12) / 2,
    0,
    x1 - x0,
    cushion + 0.12 - floor,
    half * 2,
    0.03,
  );
  const arm = frontSeat - 0.05;
  cbox(car, trimMat, arm, cushion + 0.2, 0, 0.42, 0.08, half * 2 + 0.02, 0.03);
  cbox(car, dash, arm, (floor + cushion + 0.2) / 2, 0, 0.4, cushion + 0.18 - floor, half * 2, 0.03);
  cbox(car, dash, 0.12, cushion + 0.18, 0, 0.08, 0.12, 0.05, 0.015);
  cbox(car, bronze, 0.12, cushion + 0.25, 0, 0.09, 0.03, 0.06, 0.01);
  put(car, new THREE.CylinderGeometry(0.035, 0.035, 0.03, 20), bronze, -0.02, cushion + 0.135, 0);
  put(
    car,
    new THREE.CircleGeometry(0.025, 20),
    glow(CAR.blue, 1.4),
    -0.02,
    cushion + 0.151,
    0,
    -Math.PI / 2,
  );
  // The dashboard: deep, from its back face over the knees forward to the windscreen, across the
  // cabin; the centre stack down from it to the console.
  const { back, top, under } = DASH;
  const front = BODY.screenFoot - 0.32;
  cbox(car, dash, (back + front) / 2, (under + top) / 2, 0, front - back, top - under, 1.74, 0.04);
  cbox(
    car,
    dash,
    back + 0.12,
    (cushion + 0.1 + under) / 2,
    0,
    0.24,
    under - cushion - 0.1,
    half * 2 + 0.04,
    0.03,
  );
  // Its face: the instruments over the wheel and the middle screen beside them, a lighter panel
  // with a bronze strip before the passenger, vents in bronze at each end and under the screen.
  dashScreen(car, back - 0.012, top - 0.09, -seatZ, 0.42, 0.14, 0.12);
  dashScreen(car, back - 0.03, top - 0.15, 0.03, 0.38, 0.24, 0.1);
  cbox(car, trimMat, back - 0.006, top - 0.12, 0.56, 0.012, 0.16, 0.5, 0.02);
  cbox(car, bronze, back - 0.014, top - 0.17, 0.56, 0.006, 0.018, 0.44, 0.004);
  for (const z of [-0.8, 0.8]) {
    cbox(car, bronze, back - 0.008, top - 0.14, z, 0.016, 0.24, 0.1, 0.01);
    cbox(car, dash, back - 0.014, top - 0.14, z, 0.012, 0.2, 0.07, 0.006);
  }
  cbox(car, bronze, back - 0.008, under - 0.04, 0.03, 0.016, 0.07, 0.3, 0.008);
  cbox(car, dash, back - 0.014, under - 0.04, 0.03, 0.012, 0.045, 0.26, 0.004);
  // The wheel, before the driver at their arms' reach, its top just under the instruments, its
  // column running forward into a shroud under the dashboard.
  steeringWheel(car, 0.06, cushion + 0.36, -seatZ, 0.19, 0.5, 0.3);
  cbox(car, dash, back - 0.02, under - 0.07, -seatZ, 0.18, 0.18, 0.2, 0.03);
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

/** The bonnet's height at `x`: rising from its nose back to the windscreen's foot. */
export function bonnetAt(x: number): number {
  const t = (BODY.front - x) / (BODY.front - BODY.screenFoot);
  return BODY.waist + (BODY.cowl - BODY.waist) * Math.min(1, Math.max(0, t));
}

/** The bonnet: four raised ribs along its slope, and vents at its back corners. */
function bonnet(car: THREE.Group, hood: THREE.Group): void {
  const x0 = BODY.screenFoot + 0.12;
  const x1 = HOOD.x1 - 0.03;
  const tilt = -Math.atan2(BODY.cowl - BODY.waist, BODY.front - BODY.screenFoot);
  const mid = (x0 + x1) / 2;
  const len = (x1 - x0) / Math.cos(tilt);
  for (const z of [-0.66, -0.22, 0.22, 0.66]) {
    cbox(hood, paint(), mid, bonnetAt(mid) + 0.006, z, len, 0.042, 0.28, 0.02, [0, 0, tilt]);
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
    hood.add(on);
    putSlab(on, notch, 0.012, paintLine(), 0.002, 0, 0.022, 0, -Math.PI / 2, 0, -Math.PI / 2);
  }
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

/** A corner block of a bumper at `x`, its face toward `dir` along x (1 the nose, -1 the tail). */
function bumperCorner(car: THREE.Group, x: number, dir: number, side: number, back = 0.3): void {
  // Seen from above: square at the back, its outer corner cut off.
  const plan = new THREE.Shape(
    (
      [
        [x - dir * back, 0.56],
        [x + dir * 0.3, 0.56],
        [x + dir * 0.3, 0.96],
        [x + dir * 0.12, 1.16],
        [x - dir * back, 1.16],
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
    bumperCorner(car, x, 1, side);
    // Its blue strips, low on its face and along its outer side, standing just proud of the
    // bevel.
    cbox(car, glow(CAR.blue, 3), x + 0.335, 0.53, side * 0.76, 0.02, 0.03, 0.32, 0.008);
    cbox(car, glow(CAR.blue, 3), x - 0.1, 0.53, side * 1.193, 0.3, 0.03, 0.02, 0.008);
  }
}

/**
 * The rear bumper, as the front's: a long low bar across the tail under the tailgate's sill, a
 * ribbed step along its top to climb up to the rack by, a tow hitch under it, and at each end a
 * block wrapping the corner forward along the side, short of the rear wheel's flare, a red
 * reflector low on its face.
 */
function rearBumper(car: THREE.Group): void {
  const x = BODY.rear;
  cbox(car, bumperMat(), x - 0.14, 0.5, 0, 0.36, 0.36, 1.3, 0.03);
  const dark = mat(0x1a1c1d, { roughness: 0.9, mottle: 'none' });
  for (const dz of [-0.36, -0.24, -0.12, 0, 0.12, 0.24, 0.36])
    cbox(car, dark, x - 0.17, 0.685, dz, 0.24, 0.02, 0.07, 0.008);
  // The hitch: a square tube out of the bar's foot, a pin through it.
  const steel = mat(CAR.steel, { mottle: 'metal', roughness: 0.35, metalness: 0.85 });
  cbox(car, steel, x - 0.38, 0.38, 0, 0.18, 0.08, 0.08, 0.012);
  cbox(car, steel, x - 0.42, 0.38, 0, 0.025, 0.025, 0.12, 0.008);
  for (const side of [-1, 1]) {
    bumperCorner(car, x, -1, side, 0.24);
    cbox(car, glow(0xff2a1a, 1.6), x - 0.335, 0.53, side * 0.76, 0.02, 0.03, 0.32, 0.008);
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
 * A charcoal fender bolted round a wheel, as the picture's, in five straight runs (two legs, two
 * shoulders and a flat top), moulded of sheet: in section an L, a shelf standing out from the
 * body over the tyre, clear of it, and from its outer edge a skirt hanging down over the tyre's
 * outer side, bolted through, to keep what the wheel throws up from flying out. `out` is how far
 * out from the middle it is set, `reach` how far that is out from the body.
 */
export function flare(
  car: THREE.Group,
  xc: number,
  side: number,
  scale = 1,
  out = 1.12,
  yc = FLARE.y,
  reach = 0.12,
): void {
  const band = FLARE.band * scale;
  const sheet = 0.022 * scale;
  const outer = FLARE.outer.map(([x, y]): [number, number] => [x * scale, y * scale]);
  const strip = (run: [number, number][], d: number) =>
    roundedOutline([...run, ...insetRun(run, d).reverse()], Math.min(0.03, d / 2));
  const g = new THREE.Group();
  g.position.set(xc, yc, side * out);
  // Its top leaning out a little, as the wheel's does.
  g.rotation.x = side * 0.05;
  car.add(g);
  const plastic = mat(CAR.flare, { mottle: 'plastic', roughness: 0.55, vertexColors: true });
  const wear: [number, number, number] = [1.35, 1.35, 1.35];
  // The shelf, from a little into the body out to its edge.
  const [inner, edge] = [-reach - 0.02, 0.12 * scale];
  put(
    g,
    weather(slab(strip(outer, sheet), edge - inner, 0.006), 'slab', false, wear),
    plastic,
  ).position.z = (side * (inner + edge)) / 2;
  // The skirt, down from the shelf's outer edge.
  const face = edge - 0.01;
  put(g, weather(slab(strip(outer, band), 0.02, 0.006), 'slab', false, wear), plastic).position.z =
    side * face;
  // Seven bolts along the skirt's middle.
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
      side * (face + 0.012),
      Math.PI / 2,
      0,
      0,
    );
  }
}

/** The sills between the arches, and the creases, handles and mirrors down each side. */
function sides(car: THREE.Group, doors: Doors): void {
  const x0 = WHEELS.rear + 0.66;
  const x1 = WHEELS.front - 0.66;
  const sillTop = SILL_TOP;
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
        (BODY.rocker + sillTop) / 2,
        side * (BODY.half + 0.091),
        len,
        sillTop - BODY.rocker - 0.12,
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
    // What on the side is on a door goes with it.
    const on = (x: number) => {
      const k = DOOR_KINDS.find((d) => x > DOOR_SPANS[d][0] && x < DOOR_SPANS[d][1]);
      return k ? doors[k][side]! : car;
    };
    // A crease along the doors, in pieces where they are cut.
    const cuts = [x0 - 0.06, ...DOOR_KINDS.flatMap((k) => DOOR_SPANS[k]), x1 + 0.06]
      .filter((x) => x >= x0 - 0.06 && x <= x1 + 0.06)
      .sort((a, b) => a - b);
    for (let i = 0; i < cuts.length - 1; i++) {
      const [c0, c1] = [cuts[i]! + 0.02, cuts[i + 1]! - 0.02];
      if (c1 <= c0) continue;
      const at = on((c0 + c1) / 2);
      rbox(at, paintLine(), (c0 + c1) / 2, 1.18, face, c1 - c0, 0.014, 0.012, 0.004);
      rbox(at, paintLip(), (c0 + c1) / 2, 1.168, face + side * 0.001, c1 - c0, 0.004, 0.008, 0.002);
    }
    // Handles, as pockets with a lighter rim, each at the back of its door, where it swings
    // open; and a fuel flap at the back.
    for (const hx of DOOR_KINDS.map((k) => DOOR_SPANS[k][0] + 0.2)) {
      rbox(on(hx), paintLip(), hx, BODY.belt - 0.09, face, 0.19, 0.06, 0.012, 0.01);
      rbox(
        on(hx),
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
  // The body, squashed down toward the ground over its wheels.
  const body = new THREE.Group();
  body.scale.y = SQUASH;
  car.add(body);
  const doors = hangDoors(body);
  const lids = hangLids(body);
  lowerBody(body, doors, lids);
  glasshouse(body, doors, lids.tailgate);
  bonnet(body, lids.hood);
  nose(body);
  bumper(body);
  rearBumper(body);
  sides(body, doors);
  const wheels: THREE.Group[] = [];
  for (const xc of [WHEELS.front, WHEELS.rear])
    for (const side of [-1, 1]) {
      flare(car, xc, side, 1, 1.12, ARCH_Y);
      const w = makeWheel();
      w.position.set(xc, WHEELS.radius, side * (WHEELS.side - WHEELS.tuck));
      // Both sides folded alike, mirrored.
      w.rotation.set(WHEELS.tilt, side < 0 ? Math.PI + WHEELS.turn : -WHEELS.turn, 0, 'YXZ');
      // Down onto the ground, tipped as it is, its armour resting on it.
      w.updateMatrixWorld(true);
      w.position.y -= new THREE.Box3().setFromObject(w).min.y;
      car.add(w);
      wheels.push(w);
    }
  // The rack and its load, unsquashed, standing on the squashed roof.
  const top = new THREE.Group();
  top.position.y = BODY.roof * (SQUASH - 1);
  car.add(top);
  rack(top);
  const cargo = buildCargo();
  cargo.position.y = BODY.roof + 0.16;
  top.add(cargo);
  return { root: car, wheels };
}
