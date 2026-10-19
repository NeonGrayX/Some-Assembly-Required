import * as THREE from 'three';
import { CAR, makeWheel, shutLine } from './car.ts';
import { tuft } from './ground.ts';
import {
  dark,
  disc,
  doorRed,
  glass,
  lip,
  type Face,
  type Opening,
  paint,
  paintedBox,
  panel,
  plinthMat,
  portholeAt,
  rect,
  roofMat,
  slidingDoor,
  seam,
  steel,
  trim,
  windowAt,
  zinc,
} from './house.ts';
import {
  bentPath,
  cbox,
  flatSlab,
  glow,
  mat,
  put,
  rbox,
  rng,
  roundedOutline,
  slab,
  tube,
} from './kit.ts';
import {
  bed,
  bookshelf,
  ceiling,
  ceilingLight,
  coffeeTable,
  counterRun,
  desk,
  floor,
  floorLamp,
  fridge,
  guardRail,
  island,
  lining,
  pendant,
  place,
  plant,
  rug,
  screenWall,
  sofa,
  stairs,
  stool,
  wallIn,
  wardrobe,
} from './interior.ts';
import { SPORT } from './sportscar.ts';

/**
 * A big house, the small one's elder: two storeys of the same thick painted panels on a charcoal
 * plinth, their edges worn pale and their joins shut lines, charcoal posts at the corners and a
 * charcoal band round it between its floors, lit cyan along its front. Windows set deep in
 * charcoal frames with tinted glass, two rows of them; a red door between two ringed lamps under
 * a balcony railed in steel, its glass door above; a ribbed metal roof whose front slope carries
 * a row of solar panels and one of the cars' hover fans for a vent, a chimney behind, gutters and
 * downpipes. Before it a letterbox and grass.
 *
 * Modelled with its front (the door's long side) facing +z, its gables toward ±x, standing on
 * the ground at y = 0: 9 m wide, 6.5 m deep and 7.9 m to the top of its ridge.
 */

/** Its lines: half its width along x and its depth along z, its floors, eaves and ridge. */
export const BIG_HOUSE_BODY = {
  depth: 4.5,
  half: 3.25,
  plinth: 0.4,
  /** The height of the band between its floors, and of the upper floor. */
  floor: 3.3,
  eave: 6.1,
  ridge: 7.7,
  /** How thick its walls are. */
  wall: 0.18,
};

/** Where a point `at` along `face` (and `y` up it) is, in the wall's middle, and its turn. */
function onFace(face: Face, at: number, y: number): { p: THREE.Vector3; turn: number } {
  const { depth, half, wall } = BIG_HOUSE_BODY;
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

/** Its front door, under the balcony. */
export const DOOR: Opening = { at: 0, y: 0.4 + 1.125, w: 1.1, h: 2.25 };

/** Where its letterbox's post stands, beside the path to the door. */
export const LETTERBOX = { x: DOOR.at + 1.35, z: BIG_HOUSE_BODY.half + 1.1 };

/**
 * Its windows, by face, each along that face (x on the front and back, z on the gables), each
 * clear of the furniture along its wall: the kitchen's sills over the counter's top, the
 * living room's either side of the screen, none behind the stair.
 */
export const BIG_WINDOWS: Record<Face, Opening[]> = {
  '+z': [
    { at: -2.85, y: 1.9, w: 1.7, h: 1.3 },
    { at: 2.85, y: 1.9, w: 1.7, h: 1.3 },
    // Upstairs out toward the corners, clear of the wardrobe and the shelf either side of the
    // glass door.
    { at: -3.0, y: 4.9, w: 1.1, h: 1.2 },
    { at: 3.0, y: 4.9, w: 1.1, h: 1.2 },
  ],
  '-z': [
    { at: -2.6, y: 1.9, w: 1.3, h: 1.2 },
    { at: 2.6, y: 1.9, w: 1.3, h: 1.2 },
    { at: -2.6, y: 4.9, w: 1.2, h: 1.1 },
    { at: 0, y: 4.9, w: 1.2, h: 1.1 },
    { at: 2.6, y: 4.9, w: 1.2, h: 1.1 },
  ],
  '+x': [
    { at: 0.9, y: 2.05, w: 1.3, h: 1.1 },
    { at: -1.35, y: 2.05, w: 0.9, h: 1.1 },
    { at: 0.9, y: 4.9, w: 1.1, h: 1.1 },
    { at: -1.35, y: 4.9, w: 0.9, h: 1.1 },
  ],
  '-x': [
    { at: -1.15, y: 1.9, w: 1.2, h: 1.3 },
    { at: 1.95, y: 1.95, w: 0.8, h: 1.2 },
    { at: -1.15, y: 4.9, w: 1.1, h: 1.1 },
    { at: 1.95, y: 4.9, w: 0.9, h: 1.1 },
  ],
};
const OPENINGS = BIG_WINDOWS;

/** The balcony's glass door, in the front over the front door: two leaves sliding apart. */
export const BALCONY_DOOR: Opening = { at: 0, y: 4.65, w: 1.5, h: 2.2 };

/** The balcony before it: how wide it is along the front and how far out it stands. */
export const BALCONY = { w: 3.0, out: 1.3 };

/**
 * The walls: a gable at each end and a long side between them, each a thick panel of paint with
 * its openings cut through, its edges worn; shut lines up the long sides and across and up the
 * gables; charcoal posts over the corners, and a charcoal band round it between its floors.
 */
function walls(house: THREE.Group): void {
  const { depth, half, plinth, floor, eave, ridge, wall } = BIG_HOUSE_BODY;
  const b = 0.03;
  const V = THREE.Vector3;
  const porthole = { y: ridge - 0.95, r: 0.3 };

  // The gables, each its outline across z (as x, turned below) up to the ridge.
  for (const face of ['+x', '-x'] as const) {
    const outline = roundedOutline(
      [
        [-half + b, plinth + b],
        [half - b, plinth + b],
        [half - b, eave - b],
        [0, ridge - b * 1.6],
        [-half + b, eave - b],
      ],
      0.02,
    );
    for (const o of OPENINGS[face])
      outline.holes.push(rect(o.at, o.y, o.w + 0.04, o.h + 0.04, 0.05));
    outline.holes.push(disc(0, porthole.y, porthole.r + 0.02));
    const geo = panel(outline, wall, b);
    // Its outline's x along the house's z.
    geo.rotateY(-Math.PI / 2);
    const x = face === '+x' ? depth - wall / 2 : -(depth - wall / 2);
    put(house, geo, paint(), x, 0, 0);
    const inGeo = lining(outline);
    inGeo.rotateY(-Math.PI / 2);
    put(house, inGeo, wallIn(), x - Math.sign(x) * (wall / 2 + 0.011), 0, 0);
    for (const o of OPENINGS[face]) {
      const { p, turn } = onFace(face, o.at, o.y);
      windowAt(house, p, turn, o, wall);
    }
    const ph = onFace(face, 0, porthole.y);
    portholeAt(house, ph.p, ph.turn, porthole.r, wall);
    const out = new V(Math.sign(x), 0, 0);
    const fx = Math.sign(x) * depth;
    shutLine(
      house,
      new V(fx, eave, -half + 0.14),
      new V(fx, eave, half - 0.14),
      out,
      seam(),
      lip(),
    );
    shutLine(
      house,
      new V(fx, plinth + 0.04, -0.4 * Math.sign(x)),
      new V(fx, eave - 0.04, -0.4 * Math.sign(x)),
      out,
      seam(),
      lip(),
    );
  }

  // The long sides, between the gables, up to the eaves; the front's door a notch up from its
  // foot.
  for (const face of ['+z', '-z'] as const) {
    const side = face === '+z' ? 1 : -1;
    const w = depth - wall / 2 - b;
    const [x0, x1] = [DOOR.at - DOOR.w / 2 - 0.02 - b, DOOR.at + DOOR.w / 2 + 0.02 + b];
    const head = DOOR.y + DOOR.h / 2 + 0.02 + b;
    const notch: [number, number, number][] =
      face === '+z'
        ? [
            [x0, plinth + b, 0.005],
            [x0, head, 0.01],
            [x1, head, 0.01],
            [x1, plinth + b, 0.005],
          ]
        : [];
    const outline = roundedOutline(
      [[-w, plinth + b], ...notch, [w, plinth + b], [w, eave - b], [-w, eave - b]],
      0.02,
    );
    for (const o of OPENINGS[face])
      outline.holes.push(rect(o.at, o.y, o.w + 0.04, o.h + 0.04, 0.05));
    const bd = BALCONY_DOOR;
    if (face === '+z') outline.holes.push(rect(bd.at, bd.y, bd.w + 0.04, bd.h + 0.04, 0.01));
    put(house, panel(outline, wall, b), paint(), 0, 0, side * (half - wall / 2));
    put(house, lining(outline), wallIn(), 0, 0, side * (half - wall - 0.011));
    for (const o of OPENINGS[face]) {
      const { p, turn } = onFace(face, o.at, o.y);
      windowAt(house, p, turn, o, wall);
    }
    const out = new V(0, 0, side);
    const fz = side * half;
    for (const x of face === '+z' ? [-1.55, 1.55] : [-1.3, 1.3])
      shutLine(house, new V(x, plinth + 0.04, fz), new V(x, eave - 0.04, fz), out, seam(), lip());
  }

  // Charcoal posts over the corners, standing a little proud of both walls.
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      cbox(
        house,
        trim(),
        sx * (depth - 0.1),
        (plinth + eave - 0.03) / 2,
        sz * (half - 0.1),
        0.26,
        eave - 0.03 - plinth,
        0.26,
        0.03,
      );

  // The band between the floors, round all four sides, lit cyan under its edge along the front.
  for (const sz of [-1, 1])
    cbox(house, trim(), 0, floor, sz * (half + 0.01), depth * 2 + 0.08, 0.22, 0.1, 0.025);
  for (const sx of [-1, 1])
    cbox(house, trim(), sx * (depth + 0.01), floor, 0, 0.1, 0.22, half * 2 + 0.08, 0.025);
  cbox(
    house,
    glow(CAR.blue, 1.8),
    0,
    floor - 0.112,
    half + 0.045,
    depth * 2 - 0.4,
    0.008,
    0.02,
    0.003,
  );

  // Dark above the upper ceiling, so the round windows show nothing.
  const inner = half - wall - 0.01;
  const attic = slab(
    roundedOutline(
      [
        [-inner, eave],
        [inner, eave],
        [0, ridge - 0.15],
      ],
      0.01,
    ),
    (depth - wall - 0.01) * 2,
    0,
  );
  attic.rotateY(-Math.PI / 2);
  put(house, attic, dark());
}

/** Where the stair runs up along the back wall, from the living room to the landing above. */
export const STAIR = { x: -2.0, run: 4.25, width: 0.9, steps: 17 };

/**
 * The opening the stair comes up through in the upper floor, along x and out from the back wall:
 * long enough to give over 2.4 m clear above the steps under its near end, and wide enough that
 * its rail stands clear of the stair's own.
 */
export const STAIRWELL = { x0: -1.3, x1: 2.3, out: 1.1 };

/**
 * Its floors and ceilings: a warm floor on the plinth, the upper floor between the storeys with
 * the stairwell cut from it (pale under, warm on top), and a pale ceiling at the eaves.
 */
function floors(house: THREE.Group): void {
  const { depth, half, plinth, floor: band, eave, wall } = BIG_HOUSE_BODY;
  const [ix, iz] = [depth - wall, half - wall];
  cbox(house, floor(), 0, plinth + 0.005, 0, ix * 2, 0.01, iz * 2, 0.002);
  cbox(house, ceiling(), 0, eave - 0.01, 0, ix * 2, 0.02, iz * 2, 0.002);
  // The upper floor's outline, seen from above with z running down the page (so -z up it).
  const { x0, x1, out } = STAIRWELL;
  const shape = new THREE.Shape();
  const pts: [number, number][] = [
    [-ix, -iz],
    [ix, -iz],
    [ix, iz],
    [x1, iz],
    [x1, iz - out],
    [x0, iz - out],
    [x0, iz],
    [-ix, iz],
  ];
  shape.moveTo(...pts[0]!);
  for (const p of pts.slice(1)) shape.lineTo(...p);
  const under = flatSlab(shape, 0.28, 0.006);
  under.rotateX(-Math.PI / 2);
  put(house, under, ceiling(), 0, band + 0.04, 0);
  const top = flatSlab(shape, 0.02, 0.004);
  top.rotateX(-Math.PI / 2);
  put(house, top, floor(), 0, band + 0.19, 0);
}

/**
 * Its rooms. Below: a living room toward -x, a sofa facing a screen on the gable over a low
 * table and rug, a lamp and a plant; a kitchen toward +x, its counter along the gable under the
 * windows, a fridge, an island with three stools and lights hung over it; the stair up along the
 * back. Above: a bedroom toward -x, the bed's head to the gable, a wardrobe at the front; a study
 * toward +x, a desk at the gable and a shelf by the balcony's door; a rail round the stairwell.
 */
function rooms(house: THREE.Group): void {
  const { depth, half, plinth, floor: band, eave, wall } = BIG_HOUSE_BODY;
  const [ix, iz] = [depth - wall, half - wall];
  const y0 = plinth + 0.01;
  const y1 = band + 0.2;
  const under = band - 0.1;
  // The living room.
  sofa(place(house, -1.75, y0, 0.45, -Math.PI / 2), 2.3);
  rug(place(house, -2.85, y0, 0.45), 2.3, 2.6, 0x5e8f99);
  coffeeTable(place(house, -2.95, y0 + 0.012, 0.45, Math.PI / 2), 1.0, 0.56);
  screenWall(place(house, -ix, y0, 0.45, Math.PI / 2), 1.5);
  floorLamp(place(house, -ix + 0.35, y0, iz - 0.35));
  plant(place(house, -ix + 0.4, y0, -iz + 0.4), 1.1, 821);
  ceilingLight(place(house, -2.6, under, 0.45));
  // The kitchen.
  counterRun(place(house, ix, y0, 0.4, -Math.PI / 2), 4.4, -0.5, 1.0);
  fridge(place(house, ix, y0, -2.45, -Math.PI / 2));
  island(place(house, 2.3, y0, 0.4, -Math.PI / 2), 1.9);
  for (const z of [-0.2, 0.4, 1.0])
    stool(place(house, 1.5, y0, z), 0.66, z === 0.4 ? 0x2c6670 : SPORT.red);
  for (const z of [-0.1, 0.9]) pendant(place(house, 2.3, under, z), 1.0);
  ceilingLight(place(house, 2.6, under, 2.1));
  // The stair, along the back wall.
  const flight = place(house, STAIR.x, y0, -iz + STAIR.width / 2 + 0.02);
  flight.name = 'stairs';
  const { x0, x1, out } = STAIRWELL;
  stairs(flight, STAIR.run, y1 - y0, STAIR.width, STAIR.steps, x1 - STAIR.x);

  // The bedroom.
  bed(place(house, -ix, y1, 0.35, Math.PI / 2), 1.3);
  rug(place(house, -2.9, y1, 0.35), 2.0, 2.4, 0xa34a3c);
  wardrobe(place(house, -1.5, y1, iz, Math.PI), 1.0);
  floorLamp(place(house, -ix + 0.35, y1, iz - 0.4));
  ceilingLight(place(house, -2.6, eave - 0.02, 0.35));
  // The study.
  desk(place(house, ix, y1, -0.275, -Math.PI / 2), 0.9);
  bookshelf(place(house, 1.55, y1, iz, Math.PI), 0.9, 1.8, 23);
  plant(place(house, ix - 0.4, y1, iz - 0.4), 0.9, 829);
  ceilingLight(place(house, 2.4, eave - 0.02, 0.2));
  // A rail round the stairwell's open sides, on round to meet the stair's own at its head.
  const rail = place(house, 0, y1, 0);
  rail.name = 'rail';
  guardRail(rail, [
    new THREE.Vector3(x0, 0, -iz + 0.02),
    new THREE.Vector3(x0, 0, -iz + out),
    new THREE.Vector3(x1, 0, -iz + out),
    new THREE.Vector3(x1, 0, -iz + STAIR.width - 0.01),
  ]);
}

/**
 * The front door: a red panel sliding into the wall from a charcoal frame (see `slidingDoor`); two
 * steps before it and a ringed lamp either side.
 */
function doorway(house: THREE.Group): void {
  const { half, wall, plinth } = BIG_HOUSE_BODY;
  const g = new THREE.Group();
  g.position.set(DOOR.at, 0, half - wall / 2);
  house.add(g);
  const top = DOOR.y + DOOR.h / 2;
  // The frame: two jambs and a head, lining the opening and lapping over the wall.
  for (const s of [-1, 1])
    cbox(
      g,
      trim(),
      s * (DOOR.w / 2 + 0.02),
      (plinth + top + 0.08) / 2,
      0,
      0.1,
      top + 0.08 - plinth,
      wall + 0.06,
      0.015,
    );
  cbox(g, trim(), 0, top + 0.04, 0, DOOR.w + 0.14, 0.1, wall + 0.06, 0.015);
  // The panel in the wall's middle, sliding into it toward +x.
  const leaf = slidingDoor(g, DOOR.w, DOOR.h, { x: 0.24, y: 0.25, w: 0.16, h: 1.2 });
  leaf.position.y = DOOR.y;
  // Two steps up to it, charcoal, out from the plinth.
  const face = wall / 2 + 0.1;
  cbox(g, plinthMat(), 0, 0.135, face + 0.175, DOOR.w + 0.5, 0.27, 0.35, 0.03);
  cbox(g, plinthMat(), 0, 0.065, face + 0.525, DOOR.w + 0.8, 0.13, 0.35, 0.03);
  // A ringed lamp either side of it, glowing cyan, as the cars' are.
  for (const s of [-1, 1]) {
    const lamp = new THREE.Group();
    lamp.position.set(s * (DOOR.w / 2 + 0.38), DOOR.y + 0.4, wall / 2);
    g.add(lamp);
    const housing = new THREE.CylinderGeometry(0.1, 0.11, 0.08, 32);
    housing.rotateX(Math.PI / 2);
    put(lamp, housing, trim(), 0, 0, 0.04);
    put(lamp, new THREE.TorusGeometry(0.075, 0.012, 8, 32), steel(), 0, 0, 0.082);
    put(lamp, new THREE.CircleGeometry(0.066, 28), glow(CAR.blue, 2.2), 0, 0, 0.083);
  }
}

/**
 * The balcony over the door, before the glass door above: a painted slab out from the band, a
 * cyan strip under its front edge, and a railing of charcoal posts and steel rails round it.
 */
function balcony(house: THREE.Group): void {
  const { half, floor } = BIG_HOUSE_BODY;
  const { w, out } = BALCONY;
  const top = floor + 0.2;
  const thick = 0.2;
  // A rounded box: an extruded outline left its underside one long strip of thin faces, which
  // the wear on its edges shaded in streaks.
  put(house, paintedBox(w, thick, out, 0.03), paint(), 0, top - thick / 2, half + out / 2);
  cbox(house, trim(), 0, top - thick - 0.015, half + out / 2, w - 0.1, 0.03, out - 0.1, 0.01);
  cbox(
    house,
    glow(CAR.blue, 1.8),
    0,
    top - thick - 0.035,
    half + out - 0.12,
    w - 0.3,
    0.01,
    0.03,
    0.003,
  );
  // The railing: posts at the corners and along it, a steel rail along their tops and two lower.
  const z1 = half + out - 0.06;
  const x1 = w / 2 - 0.06;
  const posts: [number, number][] = [
    [-x1, half + 0.06],
    [-x1, (half + z1) / 2],
    [-x1, z1],
    [-x1 / 2, z1],
    [0, z1],
    [x1 / 2, z1],
    [x1, z1],
    [x1, (half + z1) / 2],
    [x1, half + 0.06],
  ];
  for (const [x, z] of posts) cbox(house, trim(), x, top + 0.5, z, 0.05, 1.0, 0.05, 0.012);
  for (const [y, r] of [
    [top + 1.0, 0.026],
    [top + 0.66, 0.012],
    [top + 0.33, 0.012],
  ] as const) {
    // From the wall and back to it, turned tight round the corner posts so they stay inside.
    const rail = bentPath(
      [
        new THREE.Vector3(-x1, y, half - 0.01),
        new THREE.Vector3(-x1, y, z1),
        new THREE.Vector3(x1, y, z1),
        new THREE.Vector3(x1, y, half - 0.01),
      ],
      0.04,
    );
    tube(house, rail, r, steel());
  }
}

/**
 * The balcony's glass door: a charcoal frame lining its opening, a threshold at the floor, and two
 * leaves of tinted glass in charcoal frames meeting in the middle, each with a steel pull, that
 * slide apart into the wall (see `slideDoors`).
 */
function balconyDoor(house: THREE.Group): void {
  const { half, wall } = BIG_HOUSE_BODY;
  const { at, y, w, h } = BALCONY_DOOR;
  const g = new THREE.Group();
  g.position.set(at, y, half - wall / 2);
  house.add(g);
  const depth = wall + 0.06;
  for (const s of [-1, 1])
    cbox(g, trim(), s * (w / 2 + 0.02), 0.02, 0, 0.1, h + 0.12, depth, 0.015);
  // The head, its underside a little below the opening's top so the two never share a plane.
  cbox(g, trim(), 0, h / 2 + 0.037, 0, w + 0.14, 0.1, depth, 0.015);
  cbox(g, trim(), 0, -h / 2 + 0.005, 0, w + 0.04, 0.05, depth, 0.01);
  const lw = w / 2;
  const lh = h - 0.03;
  for (const s of [-1, 1]) {
    const leaf = new THREE.Group();
    leaf.name = 'door';
    leaf.userData.slide = s * (lw - 0.06);
    leaf.position.set((s * lw) / 2, 0.01, 0);
    g.add(leaf);
    const frame = rect(0, 0, lw, lh, 0.015);
    frame.holes.push(rect(0, 0, lw - 0.12, lh - 0.12, 0.01));
    put(leaf, flatSlab(frame, 0.05, 0.008), trim());
    cbox(leaf, glass(), 0, 0, 0, lw - 0.1, lh - 0.1, 0.01, 0.003);
    // A pull up the frame where the leaves meet, flush with it on both faces.
    for (const f of [-1, 1])
      rbox(leaf, steel(), -s * (lw / 2 - 0.03), 0.05, f * 0.027, 0.02, 0.5, 0.008, 0.004);
  }
}

/**
 * The roof: two panels of dark ribbed metal resting on the gables, out over the walls all round,
 * a rounded cap along the ridge, a gutter under each eave and a downpipe from each at opposite
 * corners; on its front slope a row of solar panels and a hover fan sunk in a collar, and a
 * chimney through its back.
 */
function roof(house: THREE.Group): void {
  const { depth, half, eave, ridge } = BIG_HOUSE_BODY;
  const rise = ridge - eave;
  const A = Math.atan2(rise, half);
  const run = Math.hypot(rise, half);
  const over = { eave: 0.4, gable: 0.35 };
  const thick = 0.12;
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
    cbox(house, roofing, mid.x, mid.y, mid.z, length, thick, s1 - s0, 0.03, [side * A, 0, 0]);
    // Standing seams down it.
    for (let x = -length / 2 + 0.3; x < length / 2 - 0.2; x += 0.5) {
      const at = ridgeAt
        .clone()
        .addScaledVector(down, (s0 + s1) / 2 + 0.02)
        .addScaledVector(up, thick + 0.014);
      cbox(house, ribMat, x, at.y, at.z, 0.035, 0.035, s1 - s0 - 0.08, 0.012, [side * A, 0, 0]);
    }
    // The gutter under its eave, a rounded trough of zinc.
    const edge = ridgeAt.clone().addScaledVector(down, s1 - 0.04);
    rbox(house, zinc(), 0, edge.y - 0.05, edge.z + side * 0.02, length - 0.04, 0.13, 0.14, 0.045);
  }
  // The ridge's cap, its top clear of the roofing's rounded edges where they meet under it.
  rbox(house, ribMat, 0, ridge + thick / Math.cos(A) - 0.006, 0, length + 0.04, 0.12, 0.3, 0.05);

  // A downpipe from each gutter down to the plinth: the front's (+z) at its +x corner, the
  // back's at its -x corner.
  for (const side of [-1, 1]) {
    const g = ridgeAt.clone().addScaledVector(slope(side).down, run + over.eave - 0.04);
    const px = side * (depth + over.gable - 0.26);
    const wall = side * (half + 0.07);
    const pipe = bentPath(
      [
        new THREE.Vector3(px, g.y - 0.07, g.z + side * 0.02),
        new THREE.Vector3(px, g.y - 0.36, g.z),
        new THREE.Vector3(px, g.y - 0.6, wall),
        new THREE.Vector3(px, 0.48, wall),
        new THREE.Vector3(px + side * 0.18, 0.32, wall),
      ],
      0.08,
    );
    tube(house, pipe, 0.045, zinc());
    for (const y of [1.2, 2.6, 4.6])
      cbox(house, steel(), px, y, side * (half + 0.025), 0.11, 0.03, 0.1, 0.01);
  }

  // Where a point `s` down the slope toward `side`, `x` along it, sits on the roofing's top.
  const onSlope = (side: number, s: number, x: number) => {
    const { down, up } = slope(side);
    const p = ridgeAt
      .clone()
      .addScaledVector(down, s)
      .addScaledVector(up, thick + 0.012);
    p.x = x;
    return p;
  };

  // The solar panels: dark blue glass in steel frames, on short feet off the front slope.
  // Matt enough that the sun's glint off them stays a sheen, not a blaze.
  const cell = mat(0x1a2a48, {
    mottle: 'none',
    roughness: 0.42,
    metalness: 0.2,
    envMapIntensity: 1.4,
  });
  const along = 1.7;
  for (const x of [-3.45, -2.35, -1.25]) {
    const p = onSlope(1, run * 0.5, x);
    const up = slope(1).up;
    const at = p.clone().addScaledVector(up, 0.07);
    cbox(house, steel(), at.x, at.y, at.z, 1.02, 0.05, along + 0.04, 0.01, [A, 0, 0]);
    const face = at.clone().addScaledVector(up, 0.028);
    cbox(house, cell, face.x, face.y, face.z, 0.96, 0.01, along - 0.02, 0.003, [A, 0, 0]);
    // Its cells' lines across it.
    for (let k = 1; k < 4; k++) {
      const q = face
        .clone()
        .addScaledVector(slope(1).down, -along / 2 + (k * along) / 4)
        .addScaledVector(up, 0.006);
      cbox(house, steel(), q.x, q.y, q.z, 0.94, 0.004, 0.012, 0.001, [A, 0, 0]);
    }
    for (const s of [-1, 1]) {
      const foot = p.clone().addScaledVector(slope(1).down, (s * along) / 3);
      cbox(house, trim(), foot.x, foot.y + 0.02, foot.z, 0.9, 0.08, 0.06, 0.01, [A, 0, 0]);
    }
  }

  // The fan: one of the cars' hover wheels, its face turned up off the front slope, standing in a
  // charcoal collar sunk in the roof.
  {
    const { up } = slope(1);
    const scale = 0.72;
    const hw = 0.165 * scale;
    const base = onSlope(1, run * 0.5, 2.4);
    const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), up);
    const collarH = 0.14;
    const collar = new THREE.CylinderGeometry(0.32, 0.35, collarH + 0.08, 40);
    collar.rotateX(Math.PI / 2);
    const c = put(house, collar, trim());
    c.position.copy(base).addScaledVector(up, collarH / 2 - 0.04);
    c.quaternion.copy(turn);
    const fan = makeWheel();
    fan.scale.setScalar(scale);
    fan.position.copy(base).addScaledVector(up, collarH + hw - 0.01);
    fan.quaternion.copy(turn);
    house.add(fan);
  }

  // The chimney, through the back slope, capped in charcoal with a steel vent on it.
  const cx = 2.9;
  const cz = -1.1;
  const roofY = ridge + cz * Math.tan(A);
  const chimTop = ridge + 0.55;
  const cGeo = panel(rect(0, 0, 0.5, 0.5, 0.05), chimTop - roofY + 0.25, 0.03);
  cGeo.rotateX(Math.PI / 2);
  put(house, cGeo, paint(), cx, (chimTop + roofY - 0.25) / 2, cz);
  cbox(house, trim(), cx, chimTop + 0.035, cz, 0.62, 0.07, 0.62, 0.02);
  put(house, new THREE.CylinderGeometry(0.1, 0.1, 0.18, 24), steel(), cx, chimTop + 0.16, cz);
  put(house, new THREE.CylinderGeometry(0.17, 0.15, 0.045, 24), steel(), cx, chimTop + 0.27, cz);
}

/** The plinth the house stands on, charcoal, out a little past its walls. */
function plinth(house: THREE.Group): void {
  const { depth, half, plinth: top } = BIG_HOUSE_BODY;
  cbox(house, plinthMat(), 0, top / 2, 0, depth * 2 + 0.2, top, half * 2 + 0.2, 0.03);
}

/** A letterbox on a post out before the door, beside the path, and grass along its foot. */
function yard(house: THREE.Group): void {
  const { depth, half } = BIG_HOUSE_BODY;
  const rand = rng(29);
  const { x: lx, z: lz } = LETTERBOX;
  cbox(house, trim(), lx, 0.5, lz, 0.07, 1.0, 0.07, 0.015);
  const box = roundedOutline(
    [
      [-0.12, 0],
      [0.12, 0],
      [0.12, 0.2, 0.12],
      [-0.12, 0.2, 0.12],
    ],
    0.015,
  );
  put(house, slab(box, 0.44, 0.02), doorRed(), lx, 1.0, lz);
  cbox(
    house,
    mat(CAR.amber, { roughness: 0.4 }),
    lx + 0.135,
    1.25,
    lz - 0.12,
    0.012,
    0.08,
    0.12,
    0.005,
  );
  cbox(house, trim(), lx + 0.13, 1.15, lz - 0.1, 0.012, 0.2, 0.02, 0.004);

  const grass = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.7,
    side: THREE.DoubleSide,
  });
  const clumps: [number, number, number][] = [
    [-depth + 0.3, half + 0.18, 0.34],
    [-1.9, half + 0.16, 0.26],
    [1.7, half + 0.18, 0.3],
    [depth - 0.5, half + 0.16, 0.28],
    [depth + 0.18, 1.2, 0.3],
    [-depth - 0.18, -0.9, 0.32],
    [-depth - 0.16, 2.2, 0.24],
    [lx + 0.1, lz + 0.08, 0.22],
  ];
  for (const [i, [x, z, size]] of clumps.entries()) {
    const m = new THREE.Mesh(tuft(760 + i, size, true), grass);
    m.position.set(x, 0, z);
    m.rotation.y = rand() * Math.PI * 2;
    m.castShadow = true;
    house.add(m);
  }
}

/** Builds the big house, standing at the origin, its front facing +z. */
export function buildBigHouse(): THREE.Group {
  const house = new THREE.Group();
  house.name = 'big-house';
  plinth(house);
  walls(house);
  floors(house);
  rooms(house);
  doorway(house);
  balcony(house);
  balconyDoor(house);
  roof(house);
  yard(house);
  return house;
}
