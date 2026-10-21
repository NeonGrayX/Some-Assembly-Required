/**
 * Brick catalogue and world-scale constants.
 *
 * Grid coordinates: x and z count studs, y counts plates (a full brick is 3 plates tall).
 * Bricks are scaled up compared to real ones so they are easy to grab: a 2x4 brick is
 * roughly shoebox-sized next to a character.
 */

/** World size of one stud pitch, in metres. */
export const STUD = 0.1;
/** World height of one plate, in metres. */
export const PLATE_H = 0.04;
/** Plates per full-height brick. */
export const BRICK_PLATES = 3;

export type BrickTypeId =
  | '1x1'
  | '1x2'
  | '1x3'
  | '1x4'
  | '1x6'
  | '2x2'
  | '2x3'
  | '2x4'
  | '1x8'
  | '1x10'
  | '1x12'
  | '1x16'
  | '2x6'
  | '2x8'
  | '2x10'
  | '4x6'
  | 'plate1x1'
  | 'plate1x2'
  | 'plate1x3'
  | 'plate1x4'
  | 'plate1x6'
  | 'plate1x8'
  | 'plate2x2'
  | 'plate2x3'
  | 'plate2x4'
  | 'plate2x6'
  | 'plate2x8'
  | 'plate4x4'
  | 'plate8x8'
  | 'plate1x10'
  | 'plate1x12'
  | 'plate2x10'
  | 'plate2x12'
  | 'plate2x16'
  | 'plate3x3'
  | 'plate4x6'
  | 'plate4x8'
  | 'plate4x10'
  | 'plate4x12'
  | 'plate6x6'
  | 'plate6x8'
  | 'plate6x10'
  | 'plate6x12'
  | 'plate8x16'
  | SpecialTypeId
  | 'baseplate16';

/** Parts that are not plain bricks or plates: tiles, slopes, rounds, windows, side studs, prints. */
export type SpecialTypeId =
  | '1x2x2'
  | 'tile1x1'
  | 'tile1x2'
  | 'tile1x3'
  | 'tile1x4'
  | 'tile1x6'
  | 'tile2x2'
  | 'tile2x4'
  | 'grille1x2'
  | 'roundtile1x1'
  | 'roundtile2x2'
  | 'roundplate1x1'
  | 'round1x1'
  | 'roundplate2x2'
  | 'round2x2'
  | 'roundcorner3x3'
  | 'arc3x3'
  | 'dish2x2'
  | 'cone1x1'
  | 'slope1x2'
  | 'slope2x2'
  | 'slope2x3'
  | 'cheese1x1'
  | 'curve1x2'
  | 'window1x2x2'
  | 'lattice1x2x2'
  | 'headlight1x1'
  | 'sidestuds1x2'
  | 'sidestuds1x4'
  | 'sidestuds1x2x2'
  | 'bracket1x1'
  | 'bracket1x2'
  | 'bracket2x4'
  | 'plant1x1'
  | 'leaf2x2'
  | 'spire2x2'
  | '1x2x3'
  | '1x4x3'
  | '2x2x3'
  | '1x1x5'
  | '1x2x5'
  | 'tile1x8'
  | 'tile2x3'
  | 'tile2x6'
  | 'tile4x4'
  | 'tile6x6'
  | 'slope1x3'
  | 'slope4x2'
  | 'slope3x3'
  | 'slope4x3'
  | 'cheese1x2'
  | 'curve2x2'
  | 'curve1x3'
  | 'sidestuds1x1'
  | 'sidestuds2sides1x1'
  | 'sidestuds4sides1x1'
  | 'bracket1x2x2'
  | 'jumper1x2'
  | 'jumper2x2'
  | 'invbracket1x2'
  | 'invbracket1x2x2'
  | 'roundtile2x2hole'
  | 'bracket1x2to1x4'
  | 'ringplate1x1'
  | 'sidestudplate2x2';

/**
 * Which way a part points. Upright parts (no face) have their studs up; a part with a face is
 * clipped sideways onto side studs, its studs pointing along that axis.
 */
export type Facing = '+x' | '-x' | '+z' | '-z';

/** How a part is drawn. Every shape fills its grid cells' footprint. */
export type Shape =
  | 'box'
  | 'tile'
  | 'grille'
  | 'slope'
  | 'cheese'
  | 'curve'
  | 'round'
  | 'cone'
  | 'dish'
  | 'window'
  | 'plant'
  | 'quarter'
  | 'leaf'
  | 'spire';

/** A stud on a part's side, in the part's own frame at rotation 0. */
export interface SideStud {
  /** The cell it sits on. */
  x: number;
  z: number;
  /** The way it points. */
  dir: Facing;
  /**
   * Height of its centre above the part's bottom, in plates. A side-stud brick's face is a
   * stud square (2.5 plates) over a half plate sliver, so its studs are 1.75 plates up; a
   * bracket's hang 1.25 plates below its plate's top.
   */
  y: number;
  /**
   * How far the stud's base stands out from the side of the part's cells, in plates: a
   * headlight brick's face is set back half a plate (-0.5), a bracket's studs stand on a
   * flange half a plate thick in front of its plate (0.5). Flush (0) if left out.
   */
  out?: number;
}

export interface BrickType {
  id: BrickTypeId;
  /** Footprint along local x at rotation 0, in studs. */
  studsX: number;
  /** Footprint along local z at rotation 0, in studs. */
  studsZ: number;
  /** Height in plates. */
  plates: number;
  /** Types that are easy to mistake for this one (used for forgeries and "close" matches). */
  nearMiss: BrickTypeId[];
  /** Bins never hand these out (for example baseplates). */
  fixture?: boolean;
  /** How it is drawn; a plain box with studs if left out. */
  shape?: Shape;
  /**
   * Which top cells carry studs: every one (the default), none, only the back row (z = 0), all
   * but the far corner cell that a round corner plate's curve cuts off, or only the first cell
   * (0, 0), the rest of the part reaching out from it (a leaf plate's leaves), or one in the
   * middle of it (a dish's, which a 1x1 goes on half a stud off the grid).
   */
  studs?: 'all' | 'none' | 'back' | 'corner' | 'first' | 'centre';
  /** For a quarter shape: the radius of its hole round the (0, 0) corner, in studs (0 for none). */
  hole?: number;
  /** Studs on its sides, that sideways parts clip onto. */
  sideStuds?: SideStud[];
  /** What fills a window frame. */
  pane?: 'glass' | 'lattice';
  /**
   * The real part's design number (LEGO's, which Gobricks and most other makers use too), so
   * the build editor can find it by number. Left out where no one part matches.
   */
  part?: string;
  /** Its name in parts lists, without the colour ("1x2 tile"); worked out from the id if left out. */
  name?: string;
  /** Looks different when turned half way round (slopes, prints, side studs). */
  directional?: boolean;
  /**
   * What its bottom takes studs with: under every cell (the default), or `centre`, one round
   * hole for a stud in the middle that fits on a single stud or between four (a cone, a dish;
   * not an axle hole like the 2x2 round plate's, which a stud does not go into). A part
   * with a centre hollow can also sit half a stud off the grid both ways, so a 1x1 goes between
   * four studs (only with all four there) and a 2x2 goes on one stud (only with nothing else
   * right under it, as its bottom reaches out over the cells round it). A 1x1 round tile sits on
   * a stud like any tile, so it stays on the grid. Or `bar`, a stem under its
   * cell that goes only into an open stud (a plant stem). Or `first`, under its first cell (0, 0)
   * only, the rest reaching out over whatever is round it (a leaf plate's leaves).
   */
  bottom?: 'cells' | 'centre' | 'bar' | 'first';
  /** Its studs on top are open, with a hole a bar goes into (round 1x1s, a cone). */
  openStud?: boolean;
  /** Its studs on the side are open, with a hole a bar goes into (side-stud bricks). */
  openSideStuds?: boolean;
  /** Hollow underneath as one square all the way up, with no ribs (87087). */
  hollow?: 'square';
  /**
   * Its cells but the first (0, 0) are leaves, tipped up from half way up its layer to half a
   * plate over it: there it fills the top half of its layer, over the studs under it, and the
   * bottom half of the next, under another leaf plate's leaves (a leaf plate).
   */
  canopy?: boolean;
  /** A hole down through the middle of its top that takes a stud from above (15535). */
  topHole?: boolean;
  /**
   * Its bowed underside comes down to its bottom at its rim (a dish, 4740), over the studs round
   * its centre hollow: it goes on a single stud only, never between four, with nothing but that
   * stud's part within a plate under it (a stud a plate up, or another dish's).
   */
  rim?: boolean;
  /**
   * Its first `rows` rows along z are only `plates` high, the rest its full height, each row's
   * studs on its own top (99206, whose raised half has the side studs).
   */
  step?: { rows: number; plates: number };
  /**
   * A thick ring on a short neck out from the middle of its +z side, its middle a stud out from
   * the cell's and three quarters of a plate up, its hole along x (4081b). The ring hangs a
   * quarter plate under the part's bottom; its two ends are open studs (its `sideStuds`).
   */
  ring?: boolean;
}

const side = (x: number, z: number, y: number, dir: Facing = '+z', out = 0): SideStud => ({
  x,
  z,
  y,
  dir,
  ...(out ? { out } : {}),
});

/*
 * Side studs follow real SNOT geometry (studs not on top). A stud is 2.5 plates across, so a
 * 1x1 brick's 3-plate side is a stud square over a half plate sliver, its stud in the square.
 */
/** Height of a side-stud brick's studs: the middle of the stud square on top of its side. */
const SNOT_Y = 3 - 1.25;
/** Height of a bracket's studs: its flange hangs from the plate's top, one stud high. */
const BRACKET_Y = 1 - 1.25;
/** An inverted bracket's: its flange stands up from the plate's bottom, one stud high. */
const INVERTED_Y = 1.25;
/**
 * A ring's (4081b): its middle is 6 LDU up, and its ends, an open stud on each, stand 4 LDU out
 * from the middle of its cell, so their bases are 6 LDU (three quarters of a plate) in from the
 * cell's sides.
 */
const RING_Y = 0.75;
const RING_OUT = -0.75;

/** Tiles, round tiles and prints: one plate, no studs. */
const flat = (
  id: SpecialTypeId,
  studsX: number,
  studsZ: number,
  name: string,
  extra: Partial<BrickType> = {},
): BrickType => ({
  id,
  studsX,
  studsZ,
  plates: 1,
  nearMiss: [],
  shape: 'tile',
  studs: 'none',
  name,
  ...extra,
});

/** A plain brick more than one brick high. */
const tall = (
  id: SpecialTypeId,
  studsX: number,
  studsZ: number,
  plates: number,
  part: string,
  nearMiss: BrickTypeId[],
): BrickType => ({ id, part, studsX, studsZ, plates, nearMiss, name: `${id} brick` });

/** A slope one brick high, studs on its back row, falling toward +z. */
const slope = (
  id: SpecialTypeId,
  studsX: number,
  studsZ: number,
  part: string,
  name: string,
  nearMiss: BrickTypeId[],
): BrickType => ({
  id,
  part,
  studsX,
  studsZ,
  plates: 3,
  nearMiss,
  shape: 'slope',
  studs: 'back',
  directional: true,
  name,
});

const SPECIAL_TYPES: Record<SpecialTypeId, BrickType> = {
  '1x2x2': {
    id: '1x2x2',
    part: '3245',
    studsX: 2,
    studsZ: 1,
    plates: 6,
    nearMiss: ['1x2'],
    name: '1x2x2 brick',
  },
  tile1x1: flat('tile1x1', 1, 1, '1x1 tile', { part: '3070', nearMiss: ['plate1x1'] }),
  tile1x2: flat('tile1x2', 2, 1, '1x2 tile', { part: '3069', nearMiss: ['plate1x2', 'grille1x2'] }),
  tile1x3: flat('tile1x3', 3, 1, '1x3 tile', { part: '63864', nearMiss: ['plate1x3'] }),
  tile1x4: flat('tile1x4', 4, 1, '1x4 tile', { part: '2431', nearMiss: ['plate1x4'] }),
  tile1x6: flat('tile1x6', 6, 1, '1x6 tile', { part: '6636', nearMiss: ['plate1x6'] }),
  tile2x2: flat('tile2x2', 2, 2, '2x2 tile', { part: '3068', nearMiss: ['plate2x2'] }),
  tile2x4: flat('tile2x4', 4, 2, '2x4 tile', { part: '87079', nearMiss: ['plate2x4'] }),
  grille1x2: flat('grille1x2', 2, 1, '1x2 grille tile', {
    part: '2412',
    shape: 'grille',
    nearMiss: ['tile1x2'],
  }),
  roundtile1x1: flat('roundtile1x1', 1, 1, '1x1 round tile', {
    part: '98138',
    shape: 'round',
    nearMiss: ['roundplate1x1'],
  }),
  roundtile2x2: flat('roundtile2x2', 2, 2, '2x2 round tile', {
    part: '14769',
    shape: 'round',
    bottom: 'centre',
    nearMiss: ['roundplate2x2', 'tile2x2'],
  }),
  roundplate1x1: flat('roundplate1x1', 1, 1, '1x1 round plate', {
    part: '6141',
    shape: 'round',
    bottom: 'centre',
    studs: 'all',
    openStud: true,
    nearMiss: ['roundtile1x1', 'plate1x1'],
  }),
  round1x1: {
    id: 'round1x1',
    part: '3062',
    studsX: 1,
    studsZ: 1,
    plates: 3,
    nearMiss: ['1x1', 'cone1x1'],
    shape: 'round',
    bottom: 'centre',
    openStud: true,
    name: '1x1 round brick',
  },
  roundplate2x2: flat('roundplate2x2', 2, 2, '2x2 round plate', {
    part: '4032',
    shape: 'round',
    studs: 'all',
    nearMiss: ['plate2x2'],
  }),
  round2x2: {
    id: 'round2x2',
    part: '3941',
    studsX: 2,
    studsZ: 2,
    plates: 3,
    nearMiss: ['2x2', 'roundplate2x2'],
    shape: 'round',
    name: '2x2 round brick',
  },
  // A 3x3 plate (30357) with its square corner at (0, 0) and its far corner rounded off: a stud
  // straight along each outer side, then a curve of 2 studs' radius round the middle cell.
  roundcorner3x3: flat('roundcorner3x3', 3, 3, '3x3 round corner plate', {
    part: '30357',
    shape: 'quarter',
    studs: 'corner',
    directional: true,
    nearMiss: ['plate2x2', 'arc3x3'],
  }),
  // A quarter band a stud wide, 2 to 3 studs round the (0, 0) corner, smooth on top (79393).
  arc3x3: flat('arc3x3', 3, 3, '3x3 quarter arc tile', {
    part: '79393',
    shape: 'quarter',
    hole: 2,
    directional: true,
    nearMiss: ['roundcorner3x3'],
  }),
  dish2x2: flat('dish2x2', 2, 2, '2x2 dish', {
    part: '4740',
    shape: 'dish',
    bottom: 'centre',
    rim: true,
    studs: 'centre',
    openStud: true,
    nearMiss: ['roundplate2x2'],
  }),
  cone1x1: {
    id: 'cone1x1',
    part: '4589',
    studsX: 1,
    studsZ: 1,
    plates: 3,
    nearMiss: ['round1x1'],
    shape: 'cone',
    bottom: 'centre',
    openStud: true,
    name: '1x1 cone',
  },
  slope1x2: {
    id: 'slope1x2',
    part: '3040',
    studsX: 1,
    studsZ: 2,
    plates: 3,
    nearMiss: ['curve1x2', '1x2'],
    shape: 'slope',
    studs: 'back',
    directional: true,
    name: '2x1 slope',
  },
  slope2x2: {
    id: 'slope2x2',
    part: '3039',
    studsX: 2,
    studsZ: 2,
    plates: 3,
    nearMiss: ['slope2x3', '2x2'],
    shape: 'slope',
    studs: 'back',
    directional: true,
    name: '2x2 slope',
  },
  slope2x3: {
    id: 'slope2x3',
    part: '3038',
    studsX: 2,
    studsZ: 3,
    plates: 3,
    nearMiss: ['slope2x2', '2x3'],
    shape: 'slope',
    studs: 'back',
    directional: true,
    name: '3x2 slope',
  },
  cheese1x1: {
    id: 'cheese1x1',
    part: '54200',
    studsX: 1,
    studsZ: 1,
    plates: 2,
    nearMiss: ['tile1x1'],
    shape: 'cheese',
    studs: 'none',
    directional: true,
    name: '1x1 cheese slope',
  },
  curve1x2: {
    id: 'curve1x2',
    part: '11477',
    studsX: 1,
    studsZ: 2,
    plates: 2,
    nearMiss: ['slope1x2'],
    shape: 'curve',
    studs: 'none',
    directional: true,
    name: '2x1 curved slope',
  },
  window1x2x2: {
    id: 'window1x2x2',
    part: '60592',
    studsX: 2,
    studsZ: 1,
    plates: 6,
    nearMiss: ['lattice1x2x2', '1x2x2'],
    shape: 'window',
    pane: 'glass',
    name: '1x2x2 window',
  },
  lattice1x2x2: {
    id: 'lattice1x2x2',
    studsX: 2,
    studsZ: 1,
    plates: 6,
    nearMiss: ['window1x2x2'],
    shape: 'window',
    pane: 'lattice',
    name: '1x2x2 lattice window',
  },
  // The Erling brick (4070): its face is set back half a plate, so a tile on it sits half a
  // plate further in than on a brick with studs on the side.
  headlight1x1: {
    id: 'headlight1x1',
    part: '4070',
    studsX: 1,
    studsZ: 1,
    plates: 3,
    nearMiss: ['1x1'],
    sideStuds: [side(0, 0, SNOT_Y, '+z', -0.5)],
    openSideStuds: true,
    directional: true,
    name: '1x1 headlight brick',
  },
  sidestuds1x2: {
    id: 'sidestuds1x2',
    part: '11211',
    studsX: 2,
    studsZ: 1,
    plates: 3,
    nearMiss: ['1x2'],
    sideStuds: [side(0, 0, SNOT_Y), side(1, 0, SNOT_Y)],
    openSideStuds: true,
    directional: true,
    name: '1x2 brick, studs on side',
  },
  sidestuds1x4: {
    id: 'sidestuds1x4',
    part: '30414',
    studsX: 4,
    studsZ: 1,
    plates: 3,
    nearMiss: ['1x4'],
    sideStuds: [0, 1, 2, 3].map((x) => side(x, 0, SNOT_Y)),
    openSideStuds: true,
    directional: true,
    name: '1x4 brick, studs on side',
  },
  // 1x2x1 2/3 (22885): five plates, two studs high, so its two rows of side studs are a whole
  // stud apart and a 2x2 tile covers its side exactly.
  sidestuds1x2x2: {
    id: 'sidestuds1x2x2',
    part: '22885',
    studsX: 2,
    studsZ: 1,
    plates: 5,
    nearMiss: ['1x2x2'],
    sideStuds: [side(0, 0, 1.25), side(1, 0, 1.25), side(0, 0, 3.75), side(1, 0, 3.75)],
    openSideStuds: true,
    directional: true,
    name: '1x2x1 2/3 brick, studs on side',
  },
  // Brackets: a plate with a flange half a plate thick hanging from its front edge, flush with
  // its top, one stud high, the studs on the flange's front.
  bracket1x1: {
    id: 'bracket1x1',
    studsX: 1,
    studsZ: 1,
    plates: 1,
    nearMiss: ['plate1x1'],
    sideStuds: [side(0, 0, BRACKET_Y, '+z', 0.5)],
    directional: true,
    name: '1x1 bracket',
  },
  bracket1x2: {
    id: 'bracket1x2',
    part: '99781',
    studsX: 2,
    studsZ: 1,
    plates: 1,
    nearMiss: ['plate1x2'],
    sideStuds: [side(0, 0, BRACKET_Y, '+z', 0.5), side(1, 0, BRACKET_Y, '+z', 0.5)],
    directional: true,
    name: '1x2 bracket',
  },
  // The sign holder: a 2x4 plate with a 1x4 flange on its long side, so a tile hangs there.
  bracket2x4: {
    id: 'bracket2x4',
    studsX: 4,
    studsZ: 2,
    plates: 1,
    nearMiss: ['plate2x4'],
    sideStuds: [0, 1, 2, 3].map((x) => side(x, 1, BRACKET_Y, '+z', 0.5)),
    directional: true,
    name: '2x4 bracket',
  },
  // A plant stem: a bar that goes into an open stud, three leaves round its top (37695).
  plant1x1: {
    id: 'plant1x1',
    part: '37695',
    studsX: 1,
    studsZ: 1,
    plates: 2,
    nearMiss: ['leaf2x2'],
    shape: 'plant',
    studs: 'none',
    bottom: 'bar',
    name: 'plant stem with 3 leaves',
  },
  // A 1x1 round plate in its (0, 0) cell with three leaves fanning out over the other three,
  // layered a little over one another (32607): it sits on one stud, its leaves over the rest.
  leaf2x2: flat('leaf2x2', 2, 2, '1x1 round plate with 3 leaves', {
    part: '32607',
    shape: 'leaf',
    studs: 'first',
    bottom: 'first',
    openStud: true,
    canopy: true,
    directional: true,
    nearMiss: ['plant1x1', 'roundplate1x1'],
  }),
  // A thin mast with cross arms on a round foot, for the top of a tower.
  spire2x2: {
    id: 'spire2x2',
    studsX: 2,
    studsZ: 2,
    plates: 15,
    nearMiss: ['cone1x1'],
    shape: 'spire',
    studs: 'none',
    name: 'spire',
  },
  // Taller bricks, three and five bricks high.
  '1x2x3': tall('1x2x3', 2, 1, 9, '22886', ['1x2x2']),
  '1x4x3': tall('1x4x3', 4, 1, 9, '49311', ['1x4']),
  '2x2x3': tall('2x2x3', 2, 2, 9, '30145', ['2x2']),
  '1x1x5': tall('1x1x5', 1, 1, 15, '2453', ['1x1']),
  '1x2x5': tall('1x2x5', 2, 1, 15, '2454', ['1x2x3']),
  tile1x8: flat('tile1x8', 8, 1, '1x8 tile', { part: '4162', nearMiss: ['plate1x8', 'tile1x6'] }),
  tile2x3: flat('tile2x3', 3, 2, '2x3 tile', { part: '26603', nearMiss: ['plate2x3', 'tile2x2'] }),
  tile2x6: flat('tile2x6', 6, 2, '2x6 tile', { part: '69729', nearMiss: ['plate2x6', 'tile2x4'] }),
  tile4x4: flat('tile4x4', 4, 4, '4x4 tile', { part: '1751', nearMiss: ['plate4x4'] }),
  tile6x6: flat('tile6x6', 6, 6, '6x6 tile', { part: '10202', nearMiss: ['plate6x6'] }),
  // 33 degree slopes three studs deep (4286, 4161, 3297) and the 45 degree 2x4 (3037).
  slope1x3: slope('slope1x3', 1, 3, '4286', '3x1 slope', ['slope1x2']),
  slope4x2: slope('slope4x2', 4, 2, '3037', '2x4 slope', ['slope2x2', '2x4']),
  slope3x3: slope('slope3x3', 3, 3, '4161', '3x3 slope', ['slope2x3', 'slope4x3']),
  slope4x3: slope('slope4x3', 4, 3, '3297', '3x4 slope', ['slope3x3']),
  // Slope 30 1x2x2/3: a cheese slope two studs long.
  cheese1x2: {
    id: 'cheese1x2',
    part: '85984',
    studsX: 1,
    studsZ: 2,
    plates: 2,
    nearMiss: ['cheese1x1', 'curve1x2'],
    shape: 'cheese',
    studs: 'none',
    directional: true,
    name: '1x2 cheese slope',
  },
  curve2x2: {
    id: 'curve2x2',
    part: '15068',
    studsX: 2,
    studsZ: 2,
    plates: 2,
    nearMiss: ['curve1x2', 'tile2x2'],
    shape: 'curve',
    studs: 'none',
    directional: true,
    name: '2x2 curved slope',
  },
  curve1x3: {
    id: 'curve1x3',
    part: '50950',
    studsX: 1,
    studsZ: 3,
    plates: 2,
    nearMiss: ['curve1x2'],
    shape: 'curve',
    studs: 'none',
    directional: true,
    name: '3x1 curved slope',
  },
  // A 1x1 brick with a stud on one side (87087), on two opposite sides (47905) and on all four
  // (4733), each stud where a side-stud brick's is.
  sidestuds1x1: {
    id: 'sidestuds1x1',
    part: '87087',
    studsX: 1,
    studsZ: 1,
    plates: 3,
    nearMiss: ['headlight1x1', '1x1'],
    sideStuds: [side(0, 0, SNOT_Y)],
    openSideStuds: true,
    hollow: 'square',
    directional: true,
    name: '1x1 brick, stud on side',
  },
  sidestuds2sides1x1: {
    id: 'sidestuds2sides1x1',
    part: '47905',
    studsX: 1,
    studsZ: 1,
    plates: 3,
    nearMiss: ['sidestuds1x1', 'sidestuds4sides1x1'],
    sideStuds: [side(0, 0, SNOT_Y, '+z'), side(0, 0, SNOT_Y, '-z')],
    directional: true,
    openSideStuds: true,
    name: '1x1 brick, studs on 2 sides',
  },
  sidestuds4sides1x1: {
    id: 'sidestuds4sides1x1',
    part: '4733',
    studsX: 1,
    studsZ: 1,
    plates: 3,
    nearMiss: ['sidestuds2sides1x1', '1x1'],
    sideStuds: (['+x', '-x', '+z', '-z'] as const).map((d) => side(0, 0, SNOT_Y, d)),
    openSideStuds: true,
    name: '1x1 brick, studs on 4 sides',
  },
  // A 1x2 plate with a 2x2 flange hanging from its front edge: two rows of studs a stud apart.
  bracket1x2x2: {
    id: 'bracket1x2x2',
    part: '44728',
    studsX: 2,
    studsZ: 1,
    plates: 1,
    nearMiss: ['bracket1x2'],
    sideStuds: [0, 1].flatMap((x) => [
      side(x, 0, BRACKET_Y, '+z', 0.5),
      side(x, 0, BRACKET_Y - 2.5, '+z', 0.5),
    ]),
    directional: true,
    name: '1x2 - 2x2 bracket',
  },
  // Jumper plates: one stud in the middle, half a stud off the grid along the 1x2's length.
  jumper1x2: {
    id: 'jumper1x2',
    part: '3794b',
    studsX: 2,
    studsZ: 1,
    plates: 1,
    nearMiss: ['plate1x2'],
    studs: 'centre',
    name: '1x2 jumper plate',
  },
  // Its bottom's middle tube takes one stud too, so it can sit half a stud off both ways.
  jumper2x2: {
    id: 'jumper2x2',
    part: '87580',
    studsX: 2,
    studsZ: 2,
    plates: 1,
    nearMiss: ['plate2x2'],
    studs: 'centre',
    bottom: 'centre',
    name: '2x2 jumper plate',
  },
  // Inverted brackets: the flange stands up from the plate's front edge, flush with its bottom.
  invbracket1x2: {
    id: 'invbracket1x2',
    part: '99780',
    studsX: 2,
    studsZ: 1,
    plates: 1,
    nearMiss: ['bracket1x2'],
    sideStuds: [0, 1].map((x) => side(x, 0, INVERTED_Y, '+z', 0.5)),
    directional: true,
    name: '1x2 - 1x2 inverted bracket',
  },
  invbracket1x2x2: {
    id: 'invbracket1x2x2',
    part: '99207',
    studsX: 2,
    studsZ: 1,
    plates: 1,
    nearMiss: ['invbracket1x2', 'bracket1x2x2'],
    sideStuds: [0, 1].flatMap((x) => [
      side(x, 0, INVERTED_Y, '+z', 0.5),
      side(x, 0, INVERTED_Y + 2.5, '+z', 0.5),
    ]),
    directional: true,
    name: '1x2 - 2x2 inverted bracket',
  },
  // A 1x2 plate on a 1x4 flange: the flange reaches a stud past the plate at either end.
  bracket1x2to1x4: {
    id: 'bracket1x2to1x4',
    part: '2436',
    studsX: 2,
    studsZ: 1,
    plates: 1,
    nearMiss: ['bracket1x2'],
    sideStuds: [-1, 0, 1, 2].map((x) => side(x, 0, BRACKET_Y, '+z', 0.5)),
    directional: true,
    name: '1x2 - 1x4 bracket',
  },
  // A stud goes into its hole from above, another into its tube from below: a stud reversal.
  roundtile2x2hole: flat('roundtile2x2hole', 2, 2, '2x2 round tile with hole', {
    part: '15535',
    shape: 'round',
    bottom: 'centre',
    topHole: true,
    nearMiss: ['roundtile2x2'],
  }),
  // A 1x1 plate with a thick ring out from its side: the ring's ends are open studs pointing
  // either way along it, so parts clip on sideways at both ends, a stud out from the plate.
  ringplate1x1: {
    id: 'ringplate1x1',
    part: '4081b',
    studsX: 1,
    studsZ: 1,
    plates: 1,
    nearMiss: ['plate1x1'],
    sideStuds: [side(0, 1, RING_Y, '+x', RING_OUT), side(0, 1, RING_Y, '-x', RING_OUT)],
    openSideStuds: true,
    ring: true,
    directional: true,
    name: '1x1 plate with ring',
  },
  // A 2x2 plate, its front row raised a plate with two side studs on its front (99206): the
  // studs sit 1.25 plates up, so a part clipped on reaches half a plate over the raised row.
  sidestudplate2x2: {
    id: 'sidestudplate2x2',
    part: '99206',
    studsX: 2,
    studsZ: 2,
    plates: 2,
    nearMiss: ['plate2x2'],
    step: { rows: 1, plates: 1 },
    sideStuds: [side(0, 1, 1.25), side(1, 1, 1.25)],
    openSideStuds: true,
    directional: true,
    name: '2x2 x 2/3 plate, 2 studs on side',
  },
};

/** A plain brick or plate with studs on every cell. */
const box = (
  id: BrickTypeId,
  studsX: number,
  studsZ: number,
  plates: number,
  part: string,
  nearMiss: BrickTypeId[],
): BrickType => ({
  id,
  part,
  studsX,
  studsZ,
  plates,
  nearMiss,
});

export const BRICK_TYPES: Record<BrickTypeId, BrickType> = {
  '1x1': box('1x1', 1, 1, 3, '3005', ['1x2']),
  '1x2': box('1x2', 2, 1, 3, '3004', ['1x1', 'plate1x2']),
  '1x3': box('1x3', 3, 1, 3, '3622', ['1x2', '1x4']),
  '1x4': box('1x4', 4, 1, 3, '3010', ['1x2']),
  '1x6': box('1x6', 6, 1, 3, '3009', ['1x4']),
  '2x2': box('2x2', 2, 2, 3, '3003', ['2x3', 'plate2x2']),
  '2x3': box('2x3', 3, 2, 3, '3002', ['2x2', '2x4']),
  '2x4': box('2x4', 4, 2, 3, '3001', ['2x3', 'plate2x4']),
  '1x8': box('1x8', 8, 1, 3, '3008', ['1x6', '1x10']),
  '1x10': box('1x10', 10, 1, 3, '6111', ['1x8', '1x12']),
  '1x12': box('1x12', 12, 1, 3, '6112', ['1x10']),
  '1x16': box('1x16', 16, 1, 3, '2465', ['1x12']),
  '2x6': box('2x6', 6, 2, 3, '2456', ['2x4', '2x8']),
  '2x8': box('2x8', 8, 2, 3, '3007', ['2x6', '2x10']),
  '2x10': box('2x10', 10, 2, 3, '3006', ['2x8']),
  '4x6': box('4x6', 6, 4, 3, '2356', ['2x6']),
  plate1x1: box('plate1x1', 1, 1, 1, '3024', ['1x1', 'plate1x2']),
  plate1x2: box('plate1x2', 2, 1, 1, '3023', ['1x2']),
  plate1x3: box('plate1x3', 3, 1, 1, '3623', ['plate1x2', 'plate1x4']),
  plate1x4: box('plate1x4', 4, 1, 1, '3710', ['1x4', 'plate1x3']),
  plate1x6: box('plate1x6', 6, 1, 1, '3666', ['plate1x4', 'plate1x8']),
  plate1x8: box('plate1x8', 8, 1, 1, '3460', ['plate1x6']),
  plate2x2: box('plate2x2', 2, 2, 1, '3022', ['2x2']),
  plate2x3: box('plate2x3', 3, 2, 1, '3021', ['2x3', 'plate2x2']),
  plate2x4: box('plate2x4', 4, 2, 1, '3020', ['2x4']),
  plate2x6: box('plate2x6', 6, 2, 1, '3795', ['plate2x4', 'plate2x8']),
  plate2x8: box('plate2x8', 8, 2, 1, '3034', ['plate2x6']),
  plate4x4: box('plate4x4', 4, 4, 1, '3031', ['plate2x4']),
  plate8x8: box('plate8x8', 8, 8, 1, '41539', ['plate4x4']),
  plate1x10: box('plate1x10', 10, 1, 1, '4477', ['plate1x8', 'plate1x12']),
  plate1x12: box('plate1x12', 12, 1, 1, '60479', ['plate1x10']),
  plate2x10: box('plate2x10', 10, 2, 1, '3832', ['plate2x8', 'plate2x12']),
  plate2x12: box('plate2x12', 12, 2, 1, '2445', ['plate2x10']),
  plate2x16: box('plate2x16', 16, 2, 1, '4282', ['plate2x12']),
  plate3x3: box('plate3x3', 3, 3, 1, '11212', ['plate2x2', 'plate4x4']),
  plate4x6: box('plate4x6', 6, 4, 1, '3032', ['plate4x4', 'plate4x8']),
  plate4x8: box('plate4x8', 8, 4, 1, '3035', ['plate4x6', 'plate4x10']),
  plate4x10: box('plate4x10', 10, 4, 1, '3030', ['plate4x8', 'plate4x12']),
  plate4x12: box('plate4x12', 12, 4, 1, '3029', ['plate4x10']),
  plate6x6: box('plate6x6', 6, 6, 1, '3958', ['plate4x6', 'plate6x8']),
  plate6x8: box('plate6x8', 8, 6, 1, '3036', ['plate6x6', 'plate8x8']),
  plate6x10: box('plate6x10', 10, 6, 1, '3033', ['plate6x8', 'plate6x12']),
  plate6x12: box('plate6x12', 12, 6, 1, '3028', ['plate6x10']),
  plate8x16: box('plate8x16', 16, 8, 1, '92438', ['plate8x8']),
  baseplate16: {
    id: 'baseplate16',
    studsX: 16,
    studsZ: 16,
    plates: 1,
    nearMiss: [],
    fixture: true,
  },
  ...SPECIAL_TYPES,
};

/** How wide a job site's baseplate is, either way, in metres. */
export const BASEPLATE_SIZE = BRICK_TYPES.baseplate16.studsX * STUD;

/** Whether a placement turned `a` and one turned `b` look the same. */
export function sameTurn(type: BrickTypeId, a: Rotation, b: Rotation): boolean {
  const t = BRICK_TYPES[type];
  if (t.directional) return a === b;
  if (t.studsX === t.studsZ) return true;
  return a % 2 === b % 2;
}

/** Top cells (in the part's own frame at rotation 0) that carry studs. */
/** How high row `z` (along the part's own z) of a part is, in plates: lower on a stepped part. */
export function rowPlates(type: BrickTypeId, z: number): number {
  const t = BRICK_TYPES[type];
  return t.step && z < t.step.rows ? t.step.plates : t.plates;
}

export function hasTopStud(type: BrickTypeId, x: number, z: number): boolean {
  const t = BRICK_TYPES[type];
  const studs = t.studs ?? 'all';
  if (studs === 'corner') return (x + 0.5) ** 2 + (z + 0.5) ** 2 <= t.studsX ** 2;
  if (studs === 'first') return x === 0 && z === 0;
  return studs === 'all' || (studs === 'back' && z === 0);
}

export type ColourId =
  | 'white'
  | 'light-grey'
  | 'dark-grey'
  | 'black'
  | 'red'
  | 'dark-red'
  | 'yellow'
  | 'orange'
  | 'blue'
  | 'dark-blue'
  | 'green'
  | 'gold'
  | 'dark-brown'
  | 'sand-green'
  | 'trans-clear'
  | 'trans-light-blue'
  | 'trans-blue'
  | 'trans-red'
  | 'trans-orange'
  | 'trans-black'
  | 'brown'
  | 'tan'
  | 'teal'
  | 'pink'
  | 'purple'
  | 'light-blue'
  | 'lime'
  | 'trans-green'
  | 'light-orange'
  | 'dark-orange'
  | 'light-yellow'
  | 'coral'
  | 'bright-pink'
  | 'magenta'
  | 'lavender'
  | 'medium-lavender'
  | 'medium-azure'
  | 'dark-azure'
  | 'medium-blue'
  | 'sand-blue'
  | 'dark-turquoise'
  | 'dark-green'
  | 'olive-green'
  | 'yellowish-green'
  | 'dark-tan'
  | 'light-nougat'
  | 'nougat'
  | 'medium-nougat'
  | 'pearl-gold'
  | 'flat-silver'
  | 'trans-yellow'
  | 'trans-pink'
  | 'trans-purple'
  | 'trans-neon-green'
  | 'trans-neon-orange'
  | 'baseplate-green';

export interface Colour {
  id: ColourId;
  hex: number;
  nearMiss: ColourId[];
  /** How opaque a see-through colour is drawn; solid colours leave it out. */
  alpha?: number;
  /** A metallic finish (pearl gold, flat silver) shines like metal; plain plastic leaves it out. */
  metallic?: boolean;
  /** Only fixtures come in it (the baseplate): no bin hands it out and nothing is built in it. */
  fixture?: true;
}

export const COLOURS: Record<ColourId, Colour> = {
  white: { id: 'white', hex: 0xf4f4f0, nearMiss: ['light-grey'] },
  'light-grey': { id: 'light-grey', hex: 0xa3a6a8, nearMiss: ['dark-grey', 'white'] },
  'dark-grey': { id: 'dark-grey', hex: 0x5c5f62, nearMiss: ['light-grey', 'black'] },
  black: { id: 'black', hex: 0x232527, nearMiss: ['dark-grey'] },
  red: { id: 'red', hex: 0xc91a1a, nearMiss: ['dark-red', 'orange'] },
  'dark-red': { id: 'dark-red', hex: 0x7b1a1a, nearMiss: ['red'] },
  yellow: { id: 'yellow', hex: 0xf5c518, nearMiss: ['orange'] },
  orange: { id: 'orange', hex: 0xf07d1a, nearMiss: ['yellow', 'red'] },
  blue: { id: 'blue', hex: 0x1e5bc6, nearMiss: ['dark-blue'] },
  'dark-blue': { id: 'dark-blue', hex: 0x15305e, nearMiss: ['blue'] },
  green: { id: 'green', hex: 0x2c9a3a, nearMiss: [] },
  brown: { id: 'brown', hex: 0x6b3a24, nearMiss: ['dark-red', 'orange'] },
  tan: { id: 'tan', hex: 0xdcc391, nearMiss: ['yellow', 'white'] },
  teal: { id: 'teal', hex: 0x138a8a, nearMiss: ['green', 'blue'] },
  pink: { id: 'pink', hex: 0xd2589a, nearMiss: ['red', 'purple'] },
  purple: { id: 'purple', hex: 0x5c3a9e, nearMiss: ['dark-blue', 'pink'] },
  'light-blue': { id: 'light-blue', hex: 0x9fd2ea, nearMiss: ['blue', 'white'] },
  lime: { id: 'lime', hex: 0x9cb83a, nearMiss: ['green', 'yellow'] },
  gold: { id: 'gold', hex: 0xc9a23a, nearMiss: ['yellow', 'tan'] },
  'dark-brown': { id: 'dark-brown', hex: 0x3b2418, nearMiss: ['brown', 'black'] },
  'sand-green': { id: 'sand-green', hex: 0x7a9e86, nearMiss: ['teal', 'light-grey'] },
  'trans-clear': { id: 'trans-clear', hex: 0xe8f1f4, nearMiss: ['trans-light-blue'], alpha: 0.35 },
  'trans-light-blue': {
    id: 'trans-light-blue',
    hex: 0x9fdcef,
    nearMiss: ['trans-clear', 'trans-blue'],
    alpha: 0.5,
  },
  'trans-blue': { id: 'trans-blue', hex: 0x2f6fd0, nearMiss: ['trans-light-blue'], alpha: 0.6 },
  'trans-red': { id: 'trans-red', hex: 0xd0202a, nearMiss: ['trans-orange'], alpha: 0.6 },
  'trans-orange': { id: 'trans-orange', hex: 0xf28a1e, nearMiss: ['trans-red'], alpha: 0.6 },
  'trans-black': { id: 'trans-black', hex: 0x4a4740, nearMiss: ['trans-clear'], alpha: 0.6 },
  'trans-green': {
    id: 'trans-green',
    hex: 0x5fd06a,
    nearMiss: ['trans-light-blue', 'trans-clear'],
    alpha: 0.55,
  },
  // More of the current LEGO palette (Gobricks and the other makers match it), by their
  // usual names.
  'light-orange': { id: 'light-orange', hex: 0xf8bb3d, nearMiss: ['orange', 'yellow'] },
  'dark-orange': { id: 'dark-orange', hex: 0xa95500, nearMiss: ['orange', 'brown'] },
  'light-yellow': { id: 'light-yellow', hex: 0xfff03a, nearMiss: ['yellow'] },
  coral: { id: 'coral', hex: 0xff698f, nearMiss: ['pink', 'red'] },
  'bright-pink': { id: 'bright-pink', hex: 0xe4adc8, nearMiss: ['pink'] },
  magenta: { id: 'magenta', hex: 0x923978, nearMiss: ['pink', 'purple'] },
  lavender: { id: 'lavender', hex: 0xe1d5ed, nearMiss: ['medium-lavender', 'white'] },
  'medium-lavender': { id: 'medium-lavender', hex: 0xac78ba, nearMiss: ['lavender', 'purple'] },
  'medium-azure': { id: 'medium-azure', hex: 0x36aebf, nearMiss: ['light-blue', 'dark-azure'] },
  'dark-azure': { id: 'dark-azure', hex: 0x078bc9, nearMiss: ['blue', 'medium-azure'] },
  'medium-blue': { id: 'medium-blue', hex: 0x5a93db, nearMiss: ['blue', 'light-blue'] },
  'sand-blue': { id: 'sand-blue', hex: 0x6074a1, nearMiss: ['medium-blue', 'light-grey'] },
  'dark-turquoise': { id: 'dark-turquoise', hex: 0x008f9b, nearMiss: ['teal'] },
  'dark-green': { id: 'dark-green', hex: 0x184632, nearMiss: ['green', 'sand-green'] },
  'olive-green': { id: 'olive-green', hex: 0x9b9a5a, nearMiss: ['lime', 'dark-tan'] },
  'yellowish-green': { id: 'yellowish-green', hex: 0xdfeea5, nearMiss: ['lime', 'light-yellow'] },
  'dark-tan': { id: 'dark-tan', hex: 0x958a73, nearMiss: ['tan'] },
  'light-nougat': { id: 'light-nougat', hex: 0xf6d7b3, nearMiss: ['tan', 'nougat'] },
  nougat: { id: 'nougat', hex: 0xd09168, nearMiss: ['medium-nougat', 'light-nougat'] },
  'medium-nougat': { id: 'medium-nougat', hex: 0xaa7d55, nearMiss: ['nougat', 'brown'] },
  'pearl-gold': { id: 'pearl-gold', hex: 0xaa7f2e, nearMiss: ['gold'], metallic: true },
  'flat-silver': { id: 'flat-silver', hex: 0x898788, nearMiss: ['light-grey'], metallic: true },
  'trans-yellow': { id: 'trans-yellow', hex: 0xf5cd2f, nearMiss: ['trans-orange'], alpha: 0.6 },
  'trans-pink': { id: 'trans-pink', hex: 0xdf6695, nearMiss: ['trans-red'], alpha: 0.6 },
  'trans-purple': {
    id: 'trans-purple',
    hex: 0xa5a5cb,
    nearMiss: ['trans-light-blue', 'trans-pink'],
    alpha: 0.55,
  },
  'trans-neon-green': {
    id: 'trans-neon-green',
    hex: 0xd9e830,
    nearMiss: ['trans-yellow', 'trans-green'],
    alpha: 0.6,
  },
  'trans-neon-orange': {
    id: 'trans-neon-orange',
    hex: 0xff800d,
    nearMiss: ['trans-orange', 'trans-red'],
    alpha: 0.6,
  },
  'baseplate-green': { id: 'baseplate-green', hex: 0x3f8a3a, nearMiss: [], fixture: true },
};

/** Quarter turns around the vertical axis. */
export type Rotation = 0 | 1 | 2 | 3;

/** Footprint in grid studs after rotation. */
export function footprint(type: BrickTypeId, rot: Rotation): { w: number; d: number } {
  const t = BRICK_TYPES[type];
  return rot % 2 === 0 ? { w: t.studsX, d: t.studsZ } : { w: t.studsZ, d: t.studsX };
}

/** World-space size of a brick's body (without studs) at rotation 0, in metres. */
export function brickSize(type: BrickTypeId): { x: number; y: number; z: number } {
  const t = BRICK_TYPES[type];
  return { x: t.studsX * STUD, y: t.plates * PLATE_H, z: t.studsZ * STUD };
}
