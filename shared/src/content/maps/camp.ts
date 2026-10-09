import type { Vec3 } from '../../math.ts';
import type { BoxDef, DecalDef, FloorRect, HideoutDef, LevelDef, WindowDef } from '../house.ts';
import {
  EAST,
  NORTH,
  SOUTH,
  WEST,
  box,
  dogNetwork,
  drawerIn,
  facingToward,
  fences,
  floorOf,
  gen,
  gridPoints,
  grow,
  hideout,
  LADDER_CLEAR,
  lampPost,
  rect,
  ring,
  roofOver,
  roomWalls,
  standing,
  mapProblems,
  standPartsRacks,
  addGroundPageSpots,
  standSecondBoard,
} from './common.ts';
import type { Gap } from './common.ts';

/**
 * Lakeside Camp: a campsite on a lake shore. The fire circle is the job site, in a ring of
 * five pitches that each take a tent or a caravan every round; a jetty of sections is laid out
 * anew over the water with a diving platform at its end; the camp shop's veranda is the
 * inspector; the woods along the sides hold the woodpile and a treehouse, and the lifeguard
 * tower stands on the beach. The lake is the hazard: wading is slow.
 *
 * Everything here is placed by hand round the fire so that nothing stands in anything else:
 * the pitches, their tables and lanterns have fixed spots, and only what each pitch holds, the
 * jetty, the canoes and the tents' sizes change with the seed.
 */

const GRASS = 0x7d9b5a;
const SAND = 0xd8c79a;
const LAKE = 0x2f6f9f;
const TRODDEN = 0xa08a5c;
const BARK = 0x5b4027;
const PLANK = 0x9a7b55;
const RAIL_WOOD = 0x7a5a3a;
const STONE = 0x7a7570;
const SHOP = 0xb98c5a;
const SHOP_ROOF = 0x6e4a2a;
const LOO_WALL = 0xc8c3bb;
const LOO_ROOF = 0x6e6a66;
const CARAVAN = 0xe8e2d4;
const CARAVAN_ROOF = 0xb8b4ac;
const LINO = 0xb9a27a;
const WOOD = 0x9a6b43;
const BENCH = 0x4f6d8f;
const TYRE = 0x1f1f1f;

/**
 * Half the site's width: 3 m more all round than the house's yard, which leaves room along the
 * south fence for the bin racks.
 */
const HALF = 19;
const WATER = rect(-HALF, 6.5, HALF, HALF);
const BEACH = rect(-HALF, 3.6, HALF, 6.5);
const SHOP_R = rect(-14.5, -1, -9.5, 3);
const SHOP_H = 2.8;
/** The shop's veranda, where the warden inspects your kit: decking a step up off the grass. */
const VERANDA = rect(-14.3, -5, -10.5, -1.2);
const LOO = rect(9.5, -1, 14.5, 3);
/** Lower than the shop, so the two roofs are drawn with their own eaves. */
const LOO_H = 2.5;
const FIRE = { x: 0, z: -3 };
const CARAVAN_H = 2.5;
/** The treehouse's tree, in the eastern woods. */
const TREEHOUSE = { x: 11.7, z: -12.4 };
/** The woodpile, across the clearing from it. */
const WOODPILE = { x: -12, z: -11.6 };

type Side = Gap['side'];

/**
 * A pitch: where it is, which side its caravan's door is on (the side towards the fire), and
 * where its picnic table, lantern and (for a tent) cool box go. The spots are hand-picked so
 * that whatever the pitch holds, nothing meets anything else.
 */
interface Pitch {
  x: number;
  z: number;
  door: Side;
  table: { x: number; z: number };
  lantern: { x: number; z: number };
  coolbox: { x: number; z: number };
}

const PITCHES: Pitch[] = [
  {
    x: 9,
    z: -5.5,
    door: 'w',
    table: { x: 9.4, z: -9.2 },
    lantern: { x: 11.2, z: -8.6 },
    coolbox: { x: 9, z: -7.5 },
  },
  {
    x: 6,
    z: -10.2,
    door: 'n',
    table: { x: 8.6, z: -13 },
    lantern: { x: 2.9, z: -9.3 },
    coolbox: { x: 8.2, z: -10.4 },
  },
  {
    x: 2.2,
    z: -12.5,
    door: 'n',
    table: { x: 5.6, z: -13.1 },
    lantern: { x: 7.3, z: -12.5 },
    coolbox: { x: 4.2, z: -12 },
  },
  {
    x: -5.5,
    z: -10.5,
    door: 'n',
    table: { x: -8.6, z: -12.4 },
    lantern: { x: -7, z: -13 },
    coolbox: { x: -7.75, z: -10.6 },
  },
  {
    // (Far enough east that the family tent, turned to the fire, keeps off the veranda.)
    x: -8.8,
    z: -5.5,
    door: 'e',
    table: { x: -9.2, z: -9.2 },
    lantern: { x: -11, z: -8.6 },
    coolbox: { x: -9, z: -7.5 },
  },
];

/** Where the jetty may leave the shore, and the beach things keep clear of it. */
const JETTY_X = [-2, 2, 5];
/** Where a canoe may lie on the sand. */
const CANOE_X = [-12.4, -7.2, 9.4, 13.1];
const SPAWN = { x: 7, y: 0, z: 4.6 };

/** A tent's size: the usual one, or the family tent. */
const BIG_TENT = { x: 2.2, y: 1.7, z: 2.8 };

export function campLayout(seed: number): LevelDef {
  for (let attempt = 0; attempt < 12; attempt++) {
    const level = tryLayout(seed + attempt * 7919);
    if (!mapProblems(level).length) return level;
  }
  throw new Error('no camp layout passed the checks');
}

// ---------------------------------------------------------------- pieces

/** Decking `h` thick standing on `y0`, over a rectangle. */
const deck = (r: FloorRect, y0: number, h = 0.2): BoxDef =>
  standing(r, h, PLANK, y0, { model: 'deck' });

/** A round post standing on `y0`. */
const post = (x: number, z: number, h: number, y0 = 0, thick = 0.2): BoxDef =>
  box(x, y0 + h / 2, z, thick, h, thick, BARK, { model: 'post' });

/** A railing along a thin rectangle, standing on `y0`. */
const railing = (r: FloorRect, y0: number, h = 0.9): BoxDef =>
  standing(r, h, RAIL_WOOD, y0, { model: 'rail' });

/**
 * Railings round a platform's four edges, open where the ladder comes up: `open` is the side
 * the ladder is on and `at` where along it, with room either side for a climber's shoulders.
 */
function railsRound(r: FloorRect, y0: number, open: Side, at: number): BoxDef[] {
  const t = 0.06;
  const gap = 0.75;
  const out: BoxDef[] = [];
  const along = (side: Side): [number, number] =>
    side === 'n' || side === 's' ? [r.x0, r.x1] : [r.z0, r.z1];
  const strip = (side: Side, a: number, b: number): FloorRect =>
    side === 'n'
      ? rect(a, r.z1 - t, b, r.z1)
      : side === 's'
        ? rect(a, r.z0, b, r.z0 + t)
        : side === 'e'
          ? rect(r.x1 - t, a, r.x1, b)
          : rect(r.x0, a, r.x0 + t, b);
  for (const side of ['n', 's', 'e', 'w'] as const) {
    const [a, b] = along(side);
    const inset = side === 'n' || side === 's' ? 0 : t;
    if (side !== open) {
      out.push(railing(strip(side, a + inset, b - inset), y0));
      continue;
    }
    out.push(railing(strip(side, a + inset, at - gap), y0));
    out.push(railing(strip(side, at + gap, b - inset), y0));
  }
  return out;
}

/** A pine: the trunk is the box, the boughs are drawn round it. */
const pine = (x: number, z: number, h: number, trunk = 0.45): BoxDef =>
  box(x, h / 2, z, trunk, h, trunk, BARK, { model: 'pine' });

/** A log lying on the ground (or on other logs), `len` long along x or z. */
const log = (x: number, y0: number, z: number, len: number, alongX: boolean, thick = 0.42) =>
  box(x, y0 + thick / 2, z, alongX ? len : thick, thick, alongX ? thick : len, BARK, {
    model: 'log',
    front: alongX ? '-z' : '-x',
  });

/** A picnic table with its benches: the top's middle is at `x, z`. */
const picnicTable = (x: number, z: number): BoxDef =>
  box(x, 0.375, z, 1.6, 0.75, 1.6, WOOD, { model: 'picnicTable' });

// ---------------------------------------------------------------- the caravan

/** What a pitch's caravan or tent adds to the level. */
interface Made {
  boxes: BoxDef[];
  hideouts: HideoutDef[];
  pageSpots: Vec3[];
  windows: WindowDef[];
  decals: DecalDef[];
  lights: Vec3[];
  /** Extra points for the dog's network: inside and at the door. */
  dogPoints: Vec3[];
}

/**
 * A caravan on a pitch: a little room 4 m by 2.2 m with its door in the middle of the long
 * side towards the fire, a doormat outside it, windows on its other three sides and wheels
 * under its sides. Inside, a bench with a cushion along the far wall, a cupboard at one end
 * and a small table at the other.
 *
 * Laid out in the caravan's own frame: `u` runs along its length, `v` across it, from the
 * door's wall (`v` = -1.1) to the far wall (`v` = +1.1).
 */
function caravan(p: Pitch, next: () => number): Made {
  const { x: px, z: pz, door } = p;
  const alongX = door === 'n' || door === 's';
  // Unit vectors of the caravan's frame in the world.
  const U = alongX ? { x: 1, z: 0 } : { x: 0, z: 1 };
  const V = { n: { x: 0, z: -1 }, s: { x: 0, z: 1 }, e: { x: -1, z: 0 }, w: { x: 1, z: 0 } }[door];
  const at = (u: number, v: number) => ({ x: px + U.x * u + V.x * v, z: pz + U.z * u + V.z * v });
  /** A size `along` u by `across` v, as x and z. */
  const dims = (along: number, across: number) =>
    alongX ? { x: along, z: across } : { x: across, z: along };
  /** The way that looks towards the door's wall (-v) or the far wall (+v). */
  const toDoor = facingToward(-V.x, -V.z);
  const toFar = facingToward(V.x, V.z);
  const half = dims(2, 1.1);
  const r = rect(px - half.x, pz - half.z, px + half.x, pz + half.z);
  const boxes: BoxDef[] = [
    ...roomWalls(r, CARAVAN_H, CARAVAN, [{ side: door, at: alongX ? px : pz, width: 1 }]),
    // The roof is thicker than a house's, so the client does not run eaves round it (and
    // round all the caravans together: it joins flat roofs at one height into one).
    standing(grow(r, 0.15), 0.26, CARAVAN_ROOF, CARAVAN_H),
  ];
  // Wheels under both sides, outboard of the walls.
  for (const u of [-1.2, 1.2])
    for (const v of [-1.33, 1.33]) {
      const c = at(u, v);
      const s = dims(0.6, 0.24);
      boxes.push(box(c.x, 0.3, c.z, s.x, 0.6, s.z, TYRE, { model: 'wheel' }));
    }
  const hideouts: HideoutDef[] = [];
  const pageSpots: Vec3[] = [];
  // The bench along the far wall, with its cushion.
  const bench = at(-1, 0.72);
  const benchSize = dims(1.6, 0.55);
  const front = { n: '+z', s: '-z', e: '+x', w: '-x' }[door] as BoxDef['front'];
  boxes.push(
    box(bench.x, 0.225, bench.z, benchSize.x, 0.45, benchSize.z, BENCH, { model: 'sofa', front }),
  );
  hideouts.push(
    hideout(next(), 'cushion', bench.x, bench.z, toDoor, 0.45, { x: 1, y: 0.1, z: 0.5 }),
  );
  // The cupboard at one end of the far wall, its door towards the caravan's door.
  const cupboard = at(1.35, 0.72);
  hideouts.push(
    hideout(next(), 'cabinet', cupboard.x, cupboard.z, toDoor, 0, { x: 0.9, y: 0.7, z: 0.5 }),
  );
  // A small table by the door, clear of where its leaves stand open.
  const table = at(1.45, -0.7);
  const tableSize = dims(0.7, 0.5);
  boxes.push(box(table.x, 0.35, table.z, tableSize.x, 0.7, tableSize.z, WOOD, { model: 'table' }));
  pageSpots.push({ x: table.x, y: 0.75, z: table.z });
  // The doormat outside the door.
  const mat = at(0, -1.55);
  hideouts.push(hideout(next(), 'rug', mat.x, mat.z, toFar, 0, { x: 0.9, y: 0.02, z: 0.7 }));
  // Windows: two on the far side, one in each end.
  const windows: WindowDef[] = [
    ...[-1.1, 1.1].map((u) => ({ ...at(u, 1.1), alongX })),
    ...[-2, 2].map((u) => ({ ...at(u, 0), alongX: !alongX })),
  ];
  const inside = at(-0.2, -0.2);
  const outside = at(0, -2.1);
  return {
    boxes,
    hideouts,
    pageSpots,
    windows,
    decals: [floorOf(r, LINO)],
    lights: [{ x: px, y: 2, z: pz }],
    dogPoints: [
      { x: inside.x, y: 0, z: inside.z },
      { x: outside.x, y: 0, z: outside.z },
    ],
  };
}

/** A tent on a pitch, facing the fire, with its cool box beside it. */
function tent(p: Pitch, big: boolean, next: () => number): Made {
  const toFire = facingToward(FIRE.x - p.x, FIRE.z - p.z);
  const hideouts = [
    big
      ? hideout(next(), 'tent', p.x, p.z, toFire, 0, BIG_TENT)
      : hideout(next(), 'tent', p.x, p.z, toFire),
    hideout(next(), 'coolbox', p.coolbox.x, p.coolbox.z, toFire),
  ];
  return { boxes: [], hideouts, pageSpots: [], windows: [], decals: [], lights: [], dogPoints: [] };
}

// ---------------------------------------------------------------- the layout

/** One try at a layout from a seed, before the checks (see `mapProblems`). */
export function tryLayout(seed: number): LevelDef {
  const g = gen(seed);
  const boxes: BoxDef[] = [...fences(HALF)];
  const hideouts: HideoutDef[] = [];
  const pageSpots: Vec3[] = [];
  const lights: Vec3[] = [];
  const windows: WindowDef[] = [];
  const decals: DecalDef[] = [];
  const dogPoints: Vec3[] = [];
  let id = 1;
  const next = () => id++;

  // The fire circle: a kerb of stones round the fire (the job site, with the fire out), logs
  // to sit on at the four sides and stumps between them, lamp posts either side.
  for (const [i, s] of ring(FIRE.x, FIRE.z, 2.9, 12, 0, 0.13).entries()) {
    const w = 0.34 + ((i * 7) % 5) * 0.03;
    boxes.push(box(s.x, 0.14, s.z, w, 0.28, w * 0.9, STONE, { model: 'rock' }));
  }
  const seatR = 4.7;
  boxes.push(
    log(FIRE.x, 0, FIRE.z + seatR, 2.2, true),
    log(FIRE.x, 0, FIRE.z - seatR, 2.2, true),
    log(FIRE.x + seatR, 0, FIRE.z, 2.2, false),
    log(FIRE.x - seatR, 0, FIRE.z, 2.2, false),
  );
  pageSpots.push(
    { x: FIRE.x + 0.5, y: 0.47, z: FIRE.z + seatR },
    { x: FIRE.x - 0.5, y: 0.47, z: FIRE.z - seatR },
  );
  for (const s of ring(FIRE.x, FIRE.z, seatR, 4, 0, Math.PI / 4))
    boxes.push(box(s.x, 0.21, s.z, 0.5, 0.42, 0.5, BARK, { model: 'stump' }));
  const meetingSeats = ring(FIRE.x, FIRE.z, 3.75, 10, 0, 0.2);
  boxes.push(lampPost(-6.4, FIRE.z + 0.8, 2.6), lampPost(6.4, FIRE.z + 0.8, 2.6));
  dogPoints.push(
    ...ring(FIRE.x, FIRE.z, 3.75, 8, 0, 0.4),
    ...ring(FIRE.x, FIRE.z, 6.2, 12, 0, 0.1),
  );

  // The camp shop: the counter with the treat jar, the fridge, the shelves, and the veranda
  // outside its back door where the warden inspects your kit.
  boxes.push(
    ...roomWalls(SHOP_R, SHOP_H, SHOP, [{ side: 'e', at: 1, width: 1.4 }]),
    roofOver(SHOP_R, SHOP_H, SHOP_ROOF),
  );
  const counter = box(-12, 0.45, SHOP_R.z1 - 0.4, 3, 0.9, 0.6, 0xd9d4c7, { model: 'counter' });
  boxes.push(counter);
  hideouts.push(drawerIn(next(), counter, -0.9), drawerIn(next(), counter, 0.9));
  const treatJar = { x: -11.4, y: 0.9, z: SHOP_R.z1 - 0.4 };
  hideouts.push(
    hideout(next(), 'fridge', SHOP_R.x0 + 0.45, 1, EAST, 0, { x: 0.8, y: 1.8, z: 0.7 }),
  );
  boxes.push(box(-12.3, 0.9, SHOP_R.z0 + 0.3, 2, 1.8, 0.4, WOOD, { model: 'bookshelf' }));
  pageSpots.push({ x: -12.3, y: 1.85, z: SHOP_R.z0 + 0.3 });
  hideouts.push(hideout(next(), 'rug', SHOP_R.x1 - 0.8, 1, SOUTH, 0, { x: 1, y: 0.02, z: 1.2 }));
  lights.push({ x: -12, y: 2.3, z: 1 });
  windows.push({ x: -12.5, z: SHOP_R.z1, alongX: true });
  boxes.push(deck(VERANDA, 0, 0.07));
  decals.push(floorOf(SHOP_R, 0xc9b8a0));

  // The toilet block: three cubicles with doors along its east wall, a washbasin counter.
  boxes.push(
    ...roomWalls(LOO, LOO_H, LOO_WALL, [{ side: 'w', at: 1, width: 1.4 }]),
    roofOver(LOO, LOO_H, LOO_ROOF),
  );
  for (const z of [-0.2, 1, 2.2])
    hideouts.push(hideout(next(), 'locker', LOO.x1 - 0.5, z, WEST, 0, { x: 0.9, y: 2.1, z: 0.8 }));
  const basins = box(11.3, 0.45, LOO.z0 + 0.35, 2, 0.9, 0.5, 0xd9d4c7, {
    model: 'counter',
    front: '+z',
  });
  boxes.push(basins);
  pageSpots.push({ x: 11.8, y: 0.95, z: LOO.z0 + 0.35 });
  hideouts.push(hideout(next(), 'rug', LOO.x0 + 0.9, 1, SOUTH, 0, { x: 1, y: 0.02, z: 1.2 }));
  lights.push({ x: 12, y: 2, z: 1 });
  windows.push({ x: 11.5, z: LOO.z1, alongX: true });
  decals.push(floorOf(LOO, 0xd8d4cc));

  // The pitches round the clearing: a tent or a caravan each, with the picnic table and the
  // lantern on their own spots.
  const kinds = g.shuffle([
    'caravan',
    'caravan',
    'tent',
    'tent',
    g.chance(0.5) ? 'caravan' : 'tent',
  ]);
  PITCHES.forEach((p, i) => {
    const made = kinds[i] === 'caravan' ? caravan(p, next) : tent(p, g.chance(0.4), next);
    boxes.push(...made.boxes);
    hideouts.push(...made.hideouts);
    pageSpots.push(...made.pageSpots);
    windows.push(...made.windows);
    decals.push(...made.decals);
    lights.push(...made.lights);
    dogPoints.push(...made.dogPoints);
    boxes.push(picnicTable(p.table.x, p.table.z));
    // Towards one end of the top, within reach from beyond the bench.
    pageSpots.push({ x: p.table.x + 0.5, y: 0.8, z: p.table.z });
    boxes.push(lampPost(p.lantern.x, p.lantern.z, 1.6));
  });

  // The lake shore: the jetty of sections laid out anew, the diving platform at its end, the
  // lifeguard tower up its ladder, canoes upturned on the sand, and a lamp by the jetty.
  const jx = g.pick(JETTY_X);
  const plan = g.pick(['straight', 'dogleg', 'tee'] as const);
  const sections: { x: number; z: number; alongX: boolean }[] = [];
  let z = WATER.z0 + 0.9;
  for (let i = 0; i < 2; i++, z += 3) sections.push({ x: jx, z, alongX: false });
  const endZ = z - 1.5;
  if (plan === 'dogleg') {
    const dir = g.pick([-1, 1]);
    for (let i = 1; i <= 2; i++)
      sections.push({ x: jx + dir * (0.8 + 1.5 + (i - 1) * 3), z: endZ, alongX: true });
  }
  if (plan === 'tee')
    for (const dir of [-1, 1]) sections.push({ x: jx + dir * (0.8 + 1.5), z: endZ, alongX: true });
  for (const s of sections)
    boxes.push(
      box(s.x, 0.14, s.z, s.alongX ? 3 : 1.6, 0.28, s.alongX ? 1.6 : 3, PLANK, { model: 'deck' }),
    );
  const last = sections[sections.length - 1]!;
  const dive =
    plan === 'straight'
      ? { x: jx, z: endZ + 1.5 + 1.1 }
      : {
          x: last.x + (last.alongX ? (last.x > jx ? 1.5 + 1.1 : -(1.5 + 1.1)) : 0),
          z: last.alongX ? last.z : endZ + 1.5 + 1.1,
        };
  boxes.push(box(dive.x, 0.14, dive.z, 2.2, 0.28, 2.2, PLANK, { model: 'deck' }));
  pageSpots.push(
    { x: sections[1]!.x, y: 0.33, z: sections[1]!.z },
    { x: dive.x, y: 0.33, z: dive.z },
  );
  boxes.push(lampPost(jx - 2.4, 5.6, 2.6));

  // The lifeguard tower: four legs, a railed deck up a ladder with the lifeguard's kit chest
  // and a page on it, and a sun roof on posts.
  const towerX = jx - 6;
  const towerZ = 5;
  const towerDeck = rect(towerX - 1.25, towerZ - 1.25, towerX + 1.25, towerZ + 1.25);
  const deckTop = 3.2;
  for (const dx of [-0.95, 0.95])
    for (const dz of [-0.95, 0.95]) boxes.push(post(towerX + dx, towerZ + dz, deckTop - 0.2));
  boxes.push(deck(towerDeck, deckTop - 0.2));
  boxes.push(...railsRound(towerDeck, deckTop, 's', towerX));
  for (const dx of [-1.05, 1.05])
    for (const dz of [-1.05, 1.05]) boxes.push(post(towerX + dx, towerZ + dz, 2.2, deckTop, 0.1));
  boxes.push(standing(grow(towerDeck, 0.1), 0.08, 0xd9d4c7, deckTop + 2.2));
  hideouts.push(
    hideout(next(), 'chest', towerX + 0.45, towerZ + 0.4, WEST, deckTop, {
      x: 0.8,
      y: 0.6,
      z: 0.6,
    }),
  );
  pageSpots.push({ x: towerX - 0.6, y: deckTop + 0.05, z: towerZ - 0.5 });
  const ladders = [
    {
      pos: { x: towerX, y: 0, z: towerDeck.z0 - 0.35 },
      width: 0.8,
      height: deckTop + LADDER_CLEAR,
      facing: NORTH,
    },
  ];

  // Canoes on the sand, clear of the jetty, the tower and the spawn.
  const canoeXs = g
    .shuffle(
      CANOE_X.filter(
        (x) => Math.abs(x - jx) > 2.6 && Math.abs(x - towerX) > 3.2 && Math.abs(x - SPAWN.x) > 2.3,
      ),
    )
    .slice(0, 2);
  for (const x of canoeXs) {
    boxes.push(
      box(x, 0.2, 4.6, 3.6, 0.4, 0.8, g.pick([0xc0392b, 0x2e6fa8, 0xd9b44a]), { model: 'canoe' }),
    );
    pageSpots.push({ x: x + 0.3, y: 0.45, z: 4.6 });
  }

  // The woods along both sides, and a pine at each end of the beach.
  for (const x of [-15, 15]) {
    for (const tz of [-14, -10.8, -7.6, -4.4])
      boxes.push(pine(x + g.range(-0.3, 0.3), tz, g.range(6, 7.5)));
    // On the beach, far enough past the shop and the toilet block that its boughs keep off
    // their roofs.
    boxes.push(pine(x * 1.013, 5.6, g.range(6, 7.5)));
  }

  // The treehouse: a tall pine with a railed deck round its trunk up a ladder on its west side.
  const th = TREEHOUSE;
  // Tall enough that its lowest boughs clear a player standing on the deck.
  boxes.push(pine(th.x, th.z, 13, 0.7));
  const thDeck = rect(th.x - 1.3, th.z - 1.3, th.x + 1.3, th.z + 1.3);
  const thTop = 3.4;
  const hole = 0.45; // half the hole round the trunk
  boxes.push(
    deck(rect(thDeck.x0, thDeck.z0, th.x - hole, thDeck.z1), thTop - 0.2),
    deck(rect(th.x + hole, thDeck.z0, thDeck.x1, thDeck.z1), thTop - 0.2),
    deck(rect(th.x - hole, thDeck.z0, th.x + hole, th.z - hole), thTop - 0.2),
    deck(rect(th.x - hole, th.z + hole, th.x + hole, thDeck.z1), thTop - 0.2),
  );
  boxes.push(...railsRound(thDeck, thTop, 'w', th.z));
  // The ladder's bearers, from the ground up under the deck's edge.
  for (const dz of [-0.55, 0.55]) boxes.push(post(thDeck.x0 - 0.1, th.z + dz, thTop - 0.2, 0, 0.1));
  ladders.push({
    pos: { x: thDeck.x0 - 0.35, y: 0, z: th.z },
    width: 0.8,
    height: thTop + LADDER_CLEAR,
    facing: EAST,
  });
  pageSpots.push({ x: th.x + 0.9, y: thTop + 0.05, z: th.z + 0.9 });

  // The woodpile with the toolbox in front of it and the warden's store chest beside it.
  const wp = WOODPILE;
  for (const [row, xs] of [
    [0, [-0.5, 0, 0.5]],
    [1, [-0.25, 0.25]],
    [2, [0]],
  ] as const)
    for (const dx of xs) boxes.push(log(wp.x + dx, row * 0.5, wp.z, 1.5, false, 0.5));
  pageSpots.push({ x: wp.x, y: 1.55, z: wp.z });
  hideouts.push(hideout(next(), 'toolbox', wp.x, wp.z + 1.5, NORTH, 0));
  // The store chest in the corner behind it, out of the catapult's way.
  hideouts.push(hideout(next(), 'chest', -13.6, -14.6, NORTH, 0, { x: 0.9, y: 0.7, z: 0.6 }));

  // The gate in the south fence: an arch with the campsite's sign, the mailbox beside it, a
  // lamp, and the catapult in the corner, aimed at the fire.
  const gateX = -1;
  const gateZ = -HALF + 0.45;
  for (const x of [gateX - 1.6, gateX + 1.6]) boxes.push(post(x, gateZ, 2.25, 0, 0.25));
  boxes.push(box(gateX, 2.45, gateZ, 3.5, 0.4, 0.08, WOOD));
  hideouts.push(hideout(next(), 'mailbox', gateX - 2.3, gateZ, NORTH, 0.9));
  boxes.push(lampPost(-4, -14.3, 2.6));
  decals.push(
    // The path in from the gate.
    {
      pos: { x: gateX, y: 0, z: (gateZ - 9) / 2 },
      size: { x: 2.2, z: -9 - gateZ },
      colour: TRODDEN,
    },
    { pos: { x: FIRE.x, y: 0, z: FIRE.z }, size: { x: 13, z: 13 }, colour: TRODDEN },
  );
  // Clear of the woodpile, the supply crates by the side path, the store chest and whatever
  // the nearest pitch holds.
  const catapultAt = { x: -10.8, y: 0, z: -13 };

  const level: LevelDef = {
    floorSize: 2 * HALF,
    groundColour: GRASS,
    water: [WATER],
    boxes,
    decals: [floorOf(WATER, LAKE), floorOf(BEACH, SAND), ...decals],
    // Every bin is on the racks (`standPartsRacks`).
    bins: [],
    baseplate: { x: FIRE.x - 0.8, y: 0, z: FIRE.z - 0.8 },
    inspector: { pos: { x: -12.4, y: 0, z: -3.1 }, size: { x: 2.4, z: 2.4 } },
    doneButton: { x: FIRE.x - 1.8, y: 0, z: FIRE.z + 1.4 },
    bell: { x: FIRE.x + 1.8, y: 0, z: FIRE.z + 1.4 },
    board: { pos: { x: -5.2, y: 1.3, z: FIRE.z + 2.8 }, facing: 0 },
    pageSpots,
    hideouts,
    ladders,
    meetingSeats,
    lights,
    windows,
    spawn: { ...SPAWN, y: 1 },
    dog: { points: [], links: [], start: 0, treatJar },
    // The broom leans on the shop's back wall, on the veranda.
    broom: { pos: { x: -11.2, y: 0.07, z: SHOP_R.z0 - 0.25 }, facing: 0 },
    catapult: {
      pos: catapultAt,
      facing: facingToward(FIRE.x - catapultAt.x, FIRE.z - catapultAt.z),
    },
  };
  // A second corkboard beside the first, and every bin on its rack with the specialty shelf.
  standSecondBoard(level);
  standPartsRacks(level);
  // Room for every page of the longest manual.
  addGroundPageSpots(level);
  // The dog's walks: the whole site on a grid, closer in the rooms, with the fire circle's
  // rings and each caravan's door and inside added. It lives under the shop's veranda.
  level.dog = dogNetwork(
    level,
    [
      ...gridPoints(rect(-HALF + 1, -HALF + 0.5, HALF - 1, 6), 2.4),
      ...gridPoints(SHOP_R, 2),
      ...gridPoints(LOO, 2),
      ...dogPoints,
    ],
    { x: -12.4, y: 0, z: -6.2 },
    treatJar,
  );
  return level;
}
