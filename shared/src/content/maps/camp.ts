import type { Vec3 } from '../../math.ts';
import type { BoxDef, HideoutDef, LevelDef } from '../house.ts';
import {
  EAST,
  NORTH,
  SOUTH,
  WEST,
  binsAlong,
  box,
  dogNetwork,
  drawerIn,
  facingToward,
  fences,
  floorOf,
  gen,
  gridPoints,
  hideout,
  lampPost,
  rect,
  ring,
  roofOver,
  roomWalls,
  standing,
  mapProblems,
} from './common.ts';
import type { Gap } from './common.ts';

/**
 * Lakeside Camp: a campsite on a lake shore. The fire pit clearing is the job site, in a ring
 * of pitches that take a tent or a caravan each round; a jetty of sections is laid out anew
 * over the water every round, with a diving platform at its end; the camp shop's veranda is
 * the inspector; the woods along the sides hold the woodpile and a treehouse. The lake is the
 * hazard: wading is slow.
 */

const GRASS = 0x7d9b5a;
const SAND = 0xd8c79a;
const LAKE = 0x2f6f9f;
const PINE = 0x3f6b3a;
const BARK = 0x5b4027;
const PLANK = 0x9a7b55;
const CANVAS = 0xd9d4c7;
const SHOP = 0xb98c5a;
const WOOD = 0x9a6b43;

const WATER = rect(-16, 6, 16, 16);
const SHOP_R = rect(-15, -1, -9, 3);
const LOO = rect(9, -1, 15, 3);
const FIRE = { x: 0, z: -2.6 };
/** How far from the fire the pitches stand. */
const PITCH_R = 9;

export function campLayout(seed: number): LevelDef {
  for (let attempt = 0; attempt < 12; attempt++) {
    const level = tryLayout(seed + attempt * 7919);
    if (!mapProblems(level).length) return level;
  }
  throw new Error('no camp layout passed the checks');
}

/** One try at a layout from a seed, before the checks (see `mapProblems`). */
export function tryLayout(seed: number): LevelDef {
  const g = gen(seed);
  const boxes: BoxDef[] = [...fences()];
  const hideouts: HideoutDef[] = [];
  const pageSpots: Vec3[] = [];
  const lights: Vec3[] = [];
  let id = 1;
  const next = () => id++;

  // The fire pit: a ring of logs to sit on, the job site in the middle.
  for (const s of ring(FIRE.x, FIRE.z, 5.2, 5, 0, Math.PI / 2 + 0.3)) {
    const facing = facingToward(FIRE.x - s.x, FIRE.z - s.z);
    boxes.push(box(s.x, 0.2, s.z, 1.6, 0.4, 0.4, BARK, { model: 'step', front: '-z' }));
    void facing;
  }
  const meetingSeats = ring(FIRE.x, FIRE.z, 3.8, 10, 0, 0.2);
  for (const p of ring(FIRE.x, FIRE.z, 2.4, 8, 0, 0.1))
    boxes.push(box(p.x, 0.12, p.z, 0.35, 0.24, 0.35, 0x6f6a63));
  boxes.push(lampPost(-6, FIRE.z + 1, 2.6), lampPost(6, FIRE.z + 1, 2.6));

  // The camp shop and its veranda, where the warden inspects your kit.
  boxes.push(
    ...roomWalls(SHOP_R, 2.8, SHOP, [{ side: 'e', at: 1, width: 1.4 }]),
    roofOver(SHOP_R, 2.8, 0x6e4a2a),
  );
  const counter = box(-12, 0.45, SHOP_R.z1 - 0.4, 3, 0.9, 0.6, 0xd9d4c7, { model: 'counter' });
  boxes.push(counter);
  hideouts.push(drawerIn(next(), counter, -0.9), drawerIn(next(), counter, 0.9));
  const treatJar = { x: -11.4, y: 0.9, z: SHOP_R.z1 - 0.4 };
  hideouts.push(
    hideout(next(), 'fridge', SHOP_R.x0 + 0.45, 1, EAST, 0, { x: 0.8, y: 1.8, z: 0.7 }),
  );
  boxes.push(box(-12.5, 0.9, SHOP_R.z0 + 0.3, 2, 1.8, 0.4, WOOD, { model: 'bookshelf' }));
  pageSpots.push({ x: -12.5, y: 1.85, z: SHOP_R.z0 + 0.3 });
  hideouts.push(hideout(next(), 'rug', SHOP_R.x1 - 0.9, 1, SOUTH, 0, { x: 1, y: 0.02, z: 1.2 }));
  lights.push({ x: -12, y: 2.3, z: 1 });
  boxes.push(standing(rect(-14.5, -5, -10, -1.2), 0.06, PLANK));

  // The toilet block: cubicles with doors.
  boxes.push(
    ...roomWalls(LOO, 2.8, 0xc8c3bb, [{ side: 'w', at: 1, width: 1.4 }]),
    roofOver(LOO, 2.8, 0x6e6a66),
  );
  for (const z of [-0.2, 1, 2.2])
    hideouts.push(hideout(next(), 'locker', LOO.x1 - 0.45, z, WEST, 0, { x: 0.9, y: 2.1, z: 0.8 }));
  hideouts.push(hideout(next(), 'rug', LOO.x0 + 0.9, 1, SOUTH, 0, { x: 1, y: 0.02, z: 1.2 }));
  lights.push({ x: 12, y: 2.3, z: 1 });

  // The pitches round the clearing: a tent or a caravan each, facing the fire, with the picnic
  // table behind it, a lantern by the table and a cool box beside a tent. Caravans stand with
  // their doors towards the fire.
  const angles = [-15, -52.5, -90, -127.5, -165].map((a) => (a * Math.PI) / 180);
  const kinds = g.shuffle([
    'caravan',
    'caravan',
    'tent',
    'tent',
    g.chance(0.5) ? 'caravan' : 'tent',
  ]);
  angles.forEach((a, i) => {
    const out = { x: Math.cos(a), z: Math.sin(a) };
    const side = { x: -out.z, z: out.x };
    const px = FIRE.x + out.x * PITCH_R;
    const pz = FIRE.z + out.z * PITCH_R;
    const toFire = facingToward(-out.x, -out.z);
    const at = (r: number, t: number) => ({
      x: px + out.x * r + side.x * t,
      z: pz + out.z * r + side.z * t,
    });
    // How far the pitch reaches away from the fire, so the table stands clear behind it.
    let reach: number;
    if (kinds[i] === 'tent') {
      hideouts.push(hideout(next(), 'tent', px, pz, toFire));
      const cool = at(0.2, 1.6);
      hideouts.push(hideout(next(), 'coolbox', cool.x, cool.z, toFire));
      reach = 1.2;
    } else {
      // A caravan: a little room with its door towards the fire.
      const along = Math.abs(out.x) > 0.6 ? 'z' : 'x';
      const half = along === 'x' ? { x: 2, z: 1.1 } : { x: 1.1, z: 2 };
      const r = rect(px - half.x, pz - half.z, px + half.x, pz + half.z);
      const doorSide: Gap['side'] =
        along === 'x' ? (pz < FIRE.z ? 'n' : 's') : px < FIRE.x ? 'e' : 'w';
      const gap: Gap = { side: doorSide, at: along === 'x' ? px : pz, width: 1 };
      boxes.push(...roomWalls(r, 2.5, CANVAS, [gap]), roofOver(r, 2.5, 0x8a8a8a, 0.15));
      for (const [dx, dz] of [
        [r.x0 + 0.5, r.z0 + 0.3],
        [r.x1 - 0.5, r.z0 + 0.3],
        [r.x0 + 0.5, r.z1 - 0.3],
        [r.x1 - 0.5, r.z1 - 0.3],
      ] as const)
        boxes.push(box(dx, 0.25, dz, 0.5, 0.5, 0.3, 0x1f1f1f));
      // Inside: a cupboard at one end and a bench with a cushion at the other.
      if (along === 'x') {
        hideouts.push(
          hideout(next(), 'cabinet', r.x0 + 0.65, pz, EAST, 0, { x: 0.9, y: 0.7, z: 0.5 }),
        );
        boxes.push(
          box(r.x1 - 0.9, 0.225, pz, 1.2, 0.45, 0.6, 0x4f6d8f, { model: 'sofa', front: '-x' }),
        );
        hideouts.push(
          hideout(next(), 'cushion', r.x1 - 0.9, pz, WEST, 0.45, { x: 0.5, y: 0.1, z: 1 }),
        );
      } else {
        hideouts.push(
          hideout(next(), 'cabinet', px, r.z0 + 0.65, NORTH, 0, { x: 0.9, y: 0.7, z: 0.5 }),
        );
        boxes.push(
          box(px, 0.225, r.z1 - 0.9, 0.6, 0.45, 1.2, 0x4f6d8f, { model: 'sofa', front: '-z' }),
        );
        hideouts.push(
          hideout(next(), 'cushion', px, r.z1 - 0.9, SOUTH, 0.45, { x: 0.5, y: 0.1, z: 1 }),
        );
      }
      lights.push({ x: px, y: 2, z: pz });
      // A doormat outside the door.
      const step = {
        n: { x: 0, z: 1.6 },
        s: { x: 0, z: -1.6 },
        e: { x: 1.6, z: 0 },
        w: { x: -1.6, z: 0 },
      }[doorSide];
      hideouts.push(
        hideout(next(), 'rug', px + step.x, pz + step.z, SOUTH, 0, { x: 0.9, y: 0.02, z: 0.7 }),
      );
      reach = Math.abs(out.x) * half.x + Math.abs(out.z) * half.z + 0.2;
    }
    const table = at(reach + 1.1, 0);
    boxes.push(box(table.x, 0.375, table.z, 1.2, 0.75, 0.8, WOOD, { model: 'table' }));
    pageSpots.push({ x: table.x, y: 0.8, z: table.z });
    const lamp = at(reach + 1.1, -1.4);
    boxes.push(lampPost(lamp.x, lamp.z, 1.6));
  });

  // The lake shore: the jetty of sections laid out anew, the diving platform at its end, and
  // the lifeguard tower with a page on its deck and a chair you can look under.
  const jx = g.pick([-4, 0, 4]);
  const plan = g.pick(['straight', 'dogleg', 'tee'] as const);
  const sections: { x: number; z: number; alongX: boolean }[] = [];
  let z = WATER.z0 + 1.2;
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
      box(s.x, 0.14, s.z, s.alongX ? 3 : 1.6, 0.28, s.alongX ? 1.6 : 3, PLANK, { model: 'step' }),
    );
  const last = sections[sections.length - 1]!;
  const dive =
    plan === 'straight'
      ? { x: jx, z: endZ + 1.5 + 1.2 }
      : {
          x: last.x + (last.alongX ? (last.x > jx ? 1.5 + 1.2 : -(1.5 + 1.2)) : 0),
          z: last.alongX ? last.z : endZ + 1.5 + 1.2,
        };
  boxes.push(box(dive.x, 0.14, dive.z, 2.4, 0.28, 2.4, PLANK, { model: 'step' }));
  pageSpots.push(
    { x: sections[1]!.x, y: 0.33, z: sections[1]!.z },
    { x: dive.x, y: 0.33, z: dive.z },
  );
  const towerX = jx + 5.4;
  for (const [dx, dz] of [
    [-0.9, -0.9],
    [0.9, -0.9],
    [-0.9, 0.9],
    [0.9, 0.9],
  ] as const)
    boxes.push(box(towerX + dx, 1.5, 4.6 + dz, 0.2, 3, 0.2, BARK));
  boxes.push(standing(rect(towerX - 1.2, 3.4, towerX + 1.2, 5.8), 0.2, PLANK, 3));
  hideouts.push(hideout(next(), 'chest', towerX, 5.1, SOUTH, 3.2, { x: 0.8, y: 0.6, z: 0.6 }));
  pageSpots.push({ x: towerX - 0.6, y: 3.25, z: 4 });
  const ladders = [{ pos: { x: towerX, y: 0, z: 3 }, width: 0.8, height: 3.3, facing: NORTH }];

  // The woods: pines along both sides, the woodpile with its toolbox, the treehouse, the gate
  // in the south fence with the catapult beside it.
  for (const x of [-15, 15])
    for (let tz = -14; tz <= 3.5; tz += 3.2) {
      const tx = x + g.range(-0.4, 0.4);
      boxes.push(box(tx, 1.6, tz, 0.45, 3.2, 0.45, BARK), box(tx, 4.2, tz, 2.6, 2.2, 2.6, PINE));
    }
  const pileSide = g.pick([-1, 1]);
  const pileAt = { x: pileSide * 11.5, z: -12.5 };
  for (const [dx, dz] of [
    [0, 0],
    [0.7, 0],
    [0.35, 0.6],
  ] as const)
    boxes.push(box(pileAt.x + dx, 0.3, pileAt.z + dz, 0.65, 0.6, 0.6, WOOD, { model: 'crate' }));
  hideouts.push(hideout(next(), 'toolbox', pileAt.x + 0.35, pileAt.z - 0.9, NORTH, 0));
  pageSpots.push({ x: pileAt.x + 0.35, y: 0.92, z: pileAt.z + 0.3 });
  hideouts.push(
    hideout(next(), 'chest', pileAt.x - pileSide * 1.6, -12.8, NORTH, 0, {
      x: 0.9,
      y: 0.7,
      z: 0.6,
    }),
  );
  const treeX = -pileSide * 11.5;
  boxes.push(standing(rect(treeX - 1.2, -11.2, treeX + 1.2, -8.8), 0.2, PLANK, 3.2));
  boxes.push(box(treeX, 1.6, -10, 0.6, 3.2, 0.6, BARK), box(treeX, 5.4, -10, 3.2, 2.4, 3.2, PINE));
  ladders.push({ pos: { x: treeX, y: 0, z: -8.4 }, width: 0.8, height: 3.5, facing: SOUTH });
  pageSpots.push({ x: treeX + 0.6, y: 3.45, z: -10.6 });
  hideouts.push(hideout(next(), 'mailbox', 1.6, -15.55, NORTH, 0.9));

  // Supply crates of bricks: unloaded along the side paths and the south fence, with a few on
  // the beach, by the toilet block and behind the shop.
  const bins = binsAlong(
    [
      { from: { x: -13.4, z: -3.5 }, to: { x: -13.4, z: -14 } },
      { from: { x: 13.4, z: -3.5 }, to: { x: 13.4, z: -14 } },
      { from: { x: -12.2, z: -15.1 }, to: { x: -6, z: -15.1 } },
      { from: { x: 6, z: -15.1 }, to: { x: 12.2, z: -15.1 } },
    ],
    [
      { x: -13.5, z: 4.9 },
      { x: -12.3, z: 4.9 },
      { x: -11.1, z: 4.9 },
      { x: 11.1, z: 4.9 },
      { x: 12.3, z: 4.9 },
      { x: 13.5, z: 4.9 },
      { x: 10.6, z: -2.2 },
      { x: 11.8, z: -2.2 },
      { x: 13, z: -2.2 },
      { x: -11, z: -6.6 },
      { x: -12.2, z: -6.6 },
    ],
  );

  const level: LevelDef = {
    floorSize: 32,
    groundColour: GRASS,
    water: [WATER],
    boxes,
    decals: [
      floorOf(WATER, LAKE),
      floorOf(rect(-16, 4, 16, 6), SAND),
      floorOf(SHOP_R, 0xc9b8a0),
      floorOf(LOO, 0xd8d4cc),
      // The clearing's trodden ground.
      { pos: { x: FIRE.x, y: 0, z: FIRE.z }, size: { x: 12, z: 12 }, colour: 0xa08a5c },
    ],
    bins,
    baseplate: { x: FIRE.x - 0.8, y: 0, z: FIRE.z - 0.8 },
    inspector: { pos: { x: -12, y: 0, z: -3.3 }, size: { x: 2.4, z: 2.4 } },
    doneButton: { x: FIRE.x - 1.8, y: 0, z: FIRE.z + 1.4 },
    bell: { x: FIRE.x + 1.8, y: 0, z: FIRE.z + 1.4 },
    board: { pos: { x: -5, y: 1.3, z: 1.5 }, facing: 0 },
    pageSpots,
    hideouts,
    ladders,
    meetingSeats,
    lights,
    windows: [],
    spawn: { x: 0, y: 1, z: FIRE.z - 6 },
    dog: { points: [], links: [], start: 0, treatJar },
    broom: { pos: { x: -12, y: 0, z: SHOP_R.z0 - 0.25 }, facing: 0 },
    catapult: { pos: { x: -6.5, y: 0, z: 5 }, facing: facingToward(6.5, FIRE.z - 5) },
  };
  const dog = dogNetwork(
    level,
    [
      ...gridPoints(rect(-15, -15.5, 15, 5.5), 2.4),
      ...gridPoints(SHOP_R, 2),
      ...gridPoints(LOO, 2),
    ],
    { x: -5, y: 0, z: 2 },
    treatJar,
  );
  level.dog = dog;
  return level;
}
