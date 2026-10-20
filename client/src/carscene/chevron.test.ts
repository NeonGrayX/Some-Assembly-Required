import * as THREE from 'three';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BASEPLATE_SIZE, DOOR_THICKNESS } from '@sar/shared';
import type { ChevronScene } from '@sar/shared';
import { BIG_HOUSE_BODY } from './bighouse.ts';
import { BUS_BODY, BUS_CABIN } from './bus.ts';
import { MOVING, gadgetsIn } from './gadgets.ts';
import { hidingToggles } from './hiding.ts';
import { HOUSE_BODY } from './house.ts';
import { INSPECTOR_PAD } from './inspector.ts';
import { SITE_BOARDS, SITE_BUTTONS, SITE_PAD } from './jobsite.ts';
import { intangible } from './meshWalk.ts';
import {
  BIG_HOUSE_PLACE,
  BRICK_WORKS,
  HOUSE_PLACE,
  INSPECTOR,
  JOB_SITE,
  buildCarScene,
} from './scene.ts';
import type { CarScene } from './scene.ts';
import { START, carSolids } from './walk.ts';

/**
 * Chevron Street, the game's map of the car scene, takes what is solid in it and where its
 * hiding places and stations are from the models themselves: worked out here, from the scene as
 * the map builds it, and kept in the shared code (`chevronScene.ts`) for the server to lay the
 * map out by. This checks that file is up to date with the models; run
 * `CHEVRON=write npx vitest run client/src/carscene/chevron.test.ts` to write it afresh.
 */

const OUT = fileURLToPath(
  new URL('../../../shared/src/content/maps/chevronScene.ts', import.meta.url),
);

/** Millimetres are plenty. */
const mm = (v: number) => Math.round(v * 1000) / 1000;

type Box = [number, number, number, number, number, number];

/** A box from its bounds. */
const boxOf = (b: THREE.Box3): Box => {
  const c = b.getCenter(new THREE.Vector3());
  const s = b.getSize(new THREE.Vector3());
  return [mm(c.x), mm(c.y), mm(c.z), mm(s.x), mm(s.y), mm(s.z)];
};

const bounds = (b: Box) =>
  new THREE.Box3(
    new THREE.Vector3(b[0] - b[3] / 2, b[1] - b[4] / 2, b[2] - b[5] / 2),
    new THREE.Vector3(b[0] + b[3] / 2, b[1] + b[4] / 2, b[2] + b[5] / 2),
  );

/** The first of `o`'s ancestors (or `o`) that `pick` picks. */
function ancestor(o: THREE.Object3D, pick: (a: THREE.Object3D) => boolean): THREE.Object3D | null {
  for (let a: THREE.Object3D | null = o; a; a = a.parent) if (pick(a)) return a;
  return null;
}

/** The scene's own doors and lids that hide pages in the game, as hiding places. */
function hidingPlaces(scene: CarScene): ChevronScene['hideouts'] {
  const out: ChevronScene['hideouts'] = [];
  for (const { toggle, kind } of hidingToggles(scene.root)) {
    const handle = toggle.handles[0]!;
    const door = new THREE.Box3().setFromObject(handle);
    const ds = door.getSize(new THREE.Vector3());
    const dc = door.getCenter(new THREE.Vector3());
    if (kind === 'rug') {
      out.push([kind, mm(dc.x), 0.01, mm(dc.z), mm(ds.x), 0.02, mm(ds.z), 0]);
      continue;
    }
    // What the door is in: the piece of furniture, or the fitting.
    const piece =
      ancestor(handle, (a) => a.name === 'furniture') ??
      ancestor(handle, (a) => a.parent === scene.site) ??
      ancestor(handle, (a) => a.parent?.name === 'house' || a.parent?.name === 'big-house')!;
    const pb = new THREE.Box3().setFromObject(piece);
    const pc = pb.getCenter(new THREE.Vector3());
    // Its front looks out along its thinnest way across, away from the middle of what it is in.
    const alongX = ds.x < ds.z;
    const sign = Math.sign(alongX ? dc.x - pc.x : dc.z - pc.z) || 1;
    const n = alongX ? new THREE.Vector3(sign, 0, 0) : new THREE.Vector3(0, 0, sign);
    const outer = alongX
      ? sign > 0
        ? door.max.x
        : door.min.x
      : sign > 0
        ? door.max.z
        : door.min.z;
    // Its handle stands a little proud of its face.
    const front = outer - sign * 0.015;
    const far = alongX ? (sign > 0 ? pb.min.x : pb.max.x) : sign > 0 ? pb.min.z : pb.max.z;
    const width = alongX ? ds.z : ds.x;
    let [w, h, d] = [width, ds.y, Math.min(0.62, Math.max(0.3, Math.abs(front - far)))];
    let y = dc.y;
    if (kind === 'portaloo') {
      const ps = pb.getSize(new THREE.Vector3());
      [w, h, d] = [alongX ? ps.z : ps.x, ps.y, alongX ? ps.x : ps.z];
      y = pb.min.y + h / 2;
    }
    if (kind === 'mailbox') [w, h, d] = [width, ds.y + 0.06, 0.4];
    const at = alongX
      ? new THREE.Vector3(front - (sign * d) / 2, y, dc.z)
      : new THREE.Vector3(dc.x, y, front - (sign * d) / 2);
    if (kind === 'portaloo') at.set(pc.x, y, pc.z);
    out.push([kind, mm(at.x), mm(at.y), mm(at.z), mm(w), mm(h), mm(d), mm(Math.atan2(-n.x, -n.z))]);
  }
  return out;
}

/** The hiding place's front face: its middle, and the way it looks. */
function frontOf(h: ChevronScene['hideouts'][number]): { at: THREE.Vector3; n: THREE.Vector3 } {
  const [, x, y, z, , , d, facing] = h;
  const n = new THREE.Vector3(-Math.sin(facing), 0, -Math.cos(facing));
  return { at: new THREE.Vector3(x, y, z).addScaledVector(n, d / 2), n };
}

/**
 * Cuts `b` back behind the front of each hiding place set in it, so the hiding place's door is
 * what a click lands on (and what a page comes out past).
 */
function cutBehind(b: Box, hideouts: ChevronScene['hideouts']): Box {
  const box = bounds(b);
  for (const h of hideouts) {
    if (h[0] === 'rug' || h[0] === 'portaloo') continue;
    const { at, n } = frontOf(h);
    const inside = box.clone().expandByScalar(0.03).containsPoint(at);
    if (!inside) continue;
    const back = DOOR_THICKNESS + 0.01;
    if (n.x > 0.5) box.max.x = Math.min(box.max.x, at.x - back);
    if (n.x < -0.5) box.min.x = Math.max(box.min.x, at.x + back);
    if (n.z > 0.5) box.max.z = Math.min(box.max.z, at.z - back);
    if (n.z < -0.5) box.min.z = Math.max(box.min.z, at.z + back);
  }
  return boxOf(box);
}

/** A block of `carSolids` as the box it fills, square to the axes. */
function blockBox(b: {
  x: number;
  z: number;
  hx: number;
  hz: number;
  cos: number;
  sin: number;
  y0: number;
  y1: number;
}): Box {
  const ex = Math.abs(b.cos) * b.hx + Math.abs(b.sin) * b.hz;
  const ez = Math.abs(b.sin) * b.hx + Math.abs(b.cos) * b.hz;
  return [mm(b.x), mm((b.y0 + b.y1) / 2), mm(b.z), mm(2 * ex), mm(b.y1 - b.y0), mm(2 * ez)];
}

/** Whether `inner` lies inside `outer`, to a centimetre. */
const within = (inner: Box, outer: Box) =>
  bounds(outer).expandByScalar(0.01).containsBox(bounds(inner));

/** Leaves out every box another holds. */
function pruned(boxes: Box[]): Box[] {
  const big = [...boxes].sort((a, b) => b[3] * b[4] * b[5] - a[3] * a[4] * a[5]);
  const kept: Box[] = [];
  for (const b of big) if (!kept.some((k) => within(b, k))) kept.push(b);
  return kept;
}

function chevronScene(): ChevronScene {
  const scene = buildCarScene({ noWorks: true });
  scene.root.updateMatrixWorld(true);
  const { solids, shells, ceilings } = carSolids(scene);
  const hideouts = hidingPlaces(scene);

  // The vehicles: what of the solids is theirs, each in the world as it parks, and its middle.
  const vehicles = {
    car: scene.car.root,
    sports: scene.sports.root,
    bus: scene.bus.root,
  };
  const spans = Object.fromEntries(
    Object.entries(vehicles).map(([k, v]) => [k, new THREE.Box3().setFromObject(v)]),
  );
  const whose = (b: Box) =>
    (Object.keys(vehicles) as (keyof typeof vehicles)[]).find((k) =>
      spans[k]!.clone()
        .expandByScalar(0.05)
        .containsPoint(new THREE.Vector3(b[0], b[1], b[2])),
    );
  const owned: Record<keyof typeof vehicles, Box[]> = { car: [], sports: [], bus: [] };
  const still: Box[] = [];
  /** The houses' walls, full height and thin. */
  const walls: Box[] = [];

  // The houses' walls stop at their eaves, under the roofs (the camera's copy runs them on up).
  const houses = [
    { at: HOUSE_PLACE, body: HOUSE_BODY },
    { at: BIG_HOUSE_PLACE, body: BIG_HOUSE_BODY },
  ];
  const eaveOf = (b: Box) =>
    houses.find(
      ({ at, body }) =>
        Math.abs(b[0] - at.x) < body.depth + 0.2 &&
        Math.abs(b[2] - at.z) < body.half + 0.2 &&
        Math.abs(b[1] + b[4] / 2 - (body.eave + 0.4)) < 0.01,
    )?.body.eave;
  for (const block of [...solids.blocks, ...shells.blocks]) {
    const b = blockBox(block);
    const v = whose(b);
    if (v) {
      owned[v].push(b);
      continue;
    }
    const eave = eaveOf(b);
    if (eave === undefined) {
      still.push(b);
      continue;
    }
    const y0 = b[1] - b[4] / 2;
    const clipped: Box = [b[0], mm((y0 + eave) / 2), b[2], b[3], mm(eave - y0), b[5]];
    // Over a doorway, it is only a header.
    (eave - y0 >= 2.4 ? walls : still).push(clipped);
  }
  for (const r of solids.rounds) {
    const b: Box = [
      mm(r.x),
      mm((r.y0 + r.y1) / 2),
      mm(r.z),
      mm(2 * r.r),
      mm(r.y1 - r.y0),
      mm(2 * r.r),
    ];
    (whose(b) ? owned[whose(b)!] : still).push(b);
  }
  // The small house's ceiling; the big house is roofed by its roof's slopes.
  for (const block of ceilings.blocks) {
    const b = blockBox(block);
    if (Math.abs(b[0] - HOUSE_PLACE.x) < 1 && Math.abs(b[2] - HOUSE_PLACE.z) < 1) still.push(b);
  }
  expect(solids.ramps).toHaveLength(0);

  // The street's furniture and the site's fittings, part by part: but for what the game has its
  // own of (the Done button, the bell and the boards, the bins, the power cabinet and the
  // portaloo), where a click has to land on the game's.
  const bins: Box[] = [];
  let panel: Box | null = null;
  const own = new Set<THREE.Object3D>();
  for (const g of gadgetsIn(scene.root)) {
    const handle = g.handles[0];
    if (!handle) continue;
    const prop = ancestor(handle, (a) => a.name === 'prop');
    if (g.hint() === 'open the bin' && prop) {
      own.add(prop);
      bins.push(boxOf(new THREE.Box3().setFromObject(prop)));
    }
  }
  const fittings = scene.site.children;
  for (const f of fittings) {
    if (f.name === 'jobSite') for (const c of f.children) if (c.name !== 'pad') own.add(c);
    if (f.name === 'portaloo') own.add(f);
    if (f.name === 'power cabinet') {
      own.add(f);
      panel = boxOf(new THREE.Box3().setFromObject(f));
    }
  }
  const parts: Box[] = [];
  const take = (o: THREE.Object3D) => {
    if (o.name === MOVING || own.has(o)) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !intangible(o)) {
      const b = boxOf(new THREE.Box3().setFromObject(mesh));
      // Bolts and the like stop nobody.
      if (Math.max(b[3], b[4], b[5]) >= 0.05) parts.push(b);
    }
    o.children.forEach(take);
  };
  for (const prop of [...scene.street.children, ...fittings.flatMap((s) => s.children)])
    if (prop.name === 'prop') take(prop);

  const cut = (bs: Box[]) => bs.map((b) => cutBehind(b, hideouts));
  const middle = (k: keyof typeof vehicles) => {
    const c = spans[k]!.getCenter(new THREE.Vector3());
    return [mm(c.x), mm(c.z)] as [number, number];
  };

  // The big house's roof: a slab down each slope from the ridge, out over the eaves.
  const { depth, half, eave, ridge } = BIG_HOUSE_BODY;
  const rise = ridge - eave;
  const A = Math.atan2(rise, half);
  const run = Math.hypot(rise, half);
  const thick = 0.12;
  const over = { eave: 0.4, gable: 0.35 };
  const roofs: ChevronScene['roofs'] = [-1, 1].map((side) => {
    const down = new THREE.Vector3(0, -Math.sin(A), side * Math.cos(A));
    const up = new THREE.Vector3(0, Math.cos(A), side * Math.sin(A));
    const [s0, s1] = [-0.04, run + over.eave];
    const mid = new THREE.Vector3(BIG_HOUSE_PLACE.x, ridge, BIG_HOUSE_PLACE.z)
      .addScaledVector(down, (s0 + s1) / 2)
      .addScaledVector(up, thick / 2);
    return [
      mm(mid.x),
      mm(mid.y),
      mm(mid.z),
      mm((depth + over.gable) * 2),
      thick,
      mm(s1 - s0),
      mm(side * A),
    ];
  });

  // The stations, from the job site's and the inspector's own layouts.
  const site = new THREE.Object3D();
  site.position.set(JOB_SITE.x, 0, JOB_SITE.z);
  site.rotation.y = JOB_SITE.heading;
  site.updateMatrixWorld(true);
  const onSite = (x: number, z: number) => {
    const p = new THREE.Vector3(x, 0, z).applyMatrix4(site.matrixWorld);
    return [mm(p.x), mm(p.z)] as [number, number];
  };
  const jobSite = fittings.find((f) => f.name === 'jobSite')!;
  const boards = jobSite.children
    .filter((c) => c.name === 'prop' && c !== jobSite.children[1] && c !== jobSite.children[2])
    .map((c) => {
      const b = new THREE.Box3().setFromObject(c);
      const at = b.getCenter(new THREE.Vector3());
      const s = b.getSize(new THREE.Vector3());
      return [mm(at.x), SITE_BOARDS.y, mm(at.z), s.x < s.z ? Math.PI / 2 : 0] as [
        number,
        number,
        number,
        number,
      ];
    });

  // The ladder up the big house's back: climbed straight up, out past the eave's gutter.
  const ladder = fittings.find((f) => f.name === 'ladder')!;
  const lb = new THREE.Box3().setFromObject(ladder);
  const wall = BIG_HOUSE_PLACE.z - BIG_HOUSE_BODY.half;

  // Inside the houses and the bus.
  const room = (x: number, z: number, hx: number, hz: number, y0: number, y1: number) =>
    [
      mm(x - hx),
      mm(z - hz),
      mm(x + hx),
      mm(z + hz),
      mm(y0),
      mm(y1),
    ] as ChevronScene['rooms'][number];
  const bus = scene.bus.root;
  const cabin = new THREE.Box3(
    new THREE.Vector3(BUS_BODY.rear + BUS_CABIN.tail, BUS_CABIN.floor, -BUS_CABIN.inner),
    new THREE.Vector3(BUS_CABIN.front, BUS_CABIN.ceiling, BUS_CABIN.inner),
  ).applyMatrix4(bus.matrixWorld);
  const rooms: ChevronScene['rooms'] = [
    room(
      HOUSE_PLACE.x,
      HOUSE_PLACE.z,
      HOUSE_BODY.depth - HOUSE_BODY.wall,
      HOUSE_BODY.half - HOUSE_BODY.wall,
      HOUSE_BODY.plinth,
      HOUSE_BODY.eave,
    ),
    room(
      BIG_HOUSE_PLACE.x,
      BIG_HOUSE_PLACE.z,
      depth - BIG_HOUSE_BODY.wall,
      half - BIG_HOUSE_BODY.wall,
      BIG_HOUSE_BODY.plinth,
      BIG_HOUSE_BODY.floor,
    ),
    room(
      BIG_HOUSE_PLACE.x,
      BIG_HOUSE_PLACE.z,
      depth - BIG_HOUSE_BODY.wall,
      half - BIG_HOUSE_BODY.wall,
      BIG_HOUSE_BODY.floor + 0.2,
      eave,
    ),
  ];

  // The treat jar, on the big house's kitchen island: the piece of furniture with cupboards in
  // it that stands clear of the walls.
  const island = scene.bigHouse.children
    .filter((c) => c.name === 'furniture')
    .map((c) => new THREE.Box3().setFromObject(c))
    .find(
      (b) =>
        hideouts.some(
          (h) => h[0] === 'cabinet' && b.containsPoint(new THREE.Vector3(h[1], h[2], h[3])),
        ) &&
        b.min.x > BIG_HOUSE_PLACE.x - depth + 0.4 &&
        b.max.x < BIG_HOUSE_PLACE.x + depth - 0.4 &&
        b.min.z > BIG_HOUSE_PLACE.z - half + 0.4 &&
        b.max.z < BIG_HOUSE_PLACE.z + half - 0.4,
    )!;
  const top = island.getCenter(new THREE.Vector3());

  return {
    boxes: pruned([...cut(still), ...cut(parts)]),
    walls,
    roofs,
    vehicles: {
      car: { middle: middle('car'), boxes: pruned(owned.car) },
      sports: { middle: middle('sports'), boxes: pruned(owned.sports) },
      bus: {
        middle: middle('bus'),
        boxes: pruned(owned.bus),
        cabin: [
          mm(cabin.min.x),
          mm(cabin.min.z),
          mm(cabin.max.x),
          mm(cabin.max.z),
          mm(cabin.min.y),
          mm(cabin.max.y),
        ],
      },
    },
    hideouts,
    bins,
    panel: panel!,
    rooms,
    site: {
      baseplate: [
        mm(JOB_SITE.x - BASEPLATE_SIZE / 2),
        SITE_PAD.height,
        mm(JOB_SITE.z - BASEPLATE_SIZE / 2),
      ],
      done: onSite(SITE_BUTTONS.done.x, SITE_BUTTONS.done.z),
      bell: onSite(SITE_BUTTONS.bell.x, SITE_BUTTONS.bell.z),
      boards,
      inspector: [INSPECTOR.x, INSPECTOR.z, INSPECTOR_PAD.size],
    },
    machines: BRICK_WORKS.map((m) => [m.kind, mm(m.x), mm(m.z), mm(m.facing)]),
    ladder: [
      mm((lb.min.x + lb.max.x) / 2),
      mm(wall - 0.8),
      mm(BIG_HOUSE_BODY.eave + 0.05),
      Math.PI,
    ],
    start: [START.x, START.z],
    jar: [mm(top.x), mm(island.max.y), mm(top.z)],
  };
}

/** The file, as it is written. */
function source(scene: ChevronScene): string {
  const lines = (rows: unknown[], pad: string) =>
    rows.map((r) => `${pad}${JSON.stringify(r)},`).join('\n');
  const { boxes, walls, roofs, vehicles, hideouts, bins, ...rest } = scene;
  const vehicle = (name: string, v: { middle: [number, number]; boxes: Box[] }, more = '') =>
    `    ${name}: {\n      middle: ${JSON.stringify(v.middle)},${more}\n      boxes: [\n${lines(v.boxes, '        ')}\n      ],\n    },`;
  return [
    '// Worked out from the car scene’s models by client/src/carscene/chevron.test.ts: not to be',
    '// edited by hand (see there). In the car scene’s own axes.',
    "import type { ChevronScene } from './chevron.ts';",
    '',
    '// prettier-ignore',
    'export const CHEVRON_SCENE: ChevronScene = {',
    `  boxes: [\n${lines(boxes, '    ')}\n  ],`,
    `  walls: [\n${lines(walls, '    ')}\n  ],`,
    `  roofs: [\n${lines(roofs, '    ')}\n  ],`,
    '  vehicles: {',
    vehicle('car', vehicles.car),
    vehicle('sports', vehicles.sports),
    vehicle('bus', vehicles.bus, `\n      cabin: ${JSON.stringify(vehicles.bus.cabin)},`),
    '  },',
    `  hideouts: [\n${lines(hideouts, '    ')}\n  ],`,
    `  bins: [\n${lines(bins, '    ')}\n  ],`,
    ...Object.entries(rest).map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`),
    '};',
    '',
  ].join('\n');
}

describe('Chevron Street’s solids and places', () => {
  it('are worked out from the car scene as it is now', { timeout: 300000 }, () => {
    const text = source(chevronScene());
    if (process.env.CHEVRON === 'write') writeFileSync(OUT, text);
    expect(readFileSync(OUT, 'utf8'), 'run with CHEVRON=write to bring it up to date').toBe(text);
  });
});
