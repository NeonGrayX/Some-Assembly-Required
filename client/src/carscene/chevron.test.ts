import * as THREE from 'three';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BASEPLATE_SIZE, DOOR_THICKNESS } from '@sar/shared';
import type { ChevronScene, SceneBox } from '@sar/shared';
import { BIG_HOUSE_BODY } from './bighouse.ts';
import { BUS_BODY, BUS_CABIN } from './bus.ts';
import { MOVING, Toggle, gadgetsIn } from './gadgets.ts';
import { clickables, hidingToggles } from './hiding.ts';
import { HOUSE_BODY } from './house.ts';
import { INSPECTOR_PAD } from './inspector.ts';
import { SITE_BOARDS, SITE_BUTTONS, SITE_PAD } from './jobsite.ts';
import { intangible } from './meshWalk.ts';
import { CHEVRON_BAYS, CHEVRON_HALF, CHEVRON_LAYOUT } from './chevronLayout.ts';
import { buildCarScene } from './scene.ts';
import type { CarScene, Place } from './scene.ts';
import { carSolids } from './walk.ts';

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
      out.push([kind, mm(dc.x), 0.01, mm(dc.z), mm(ds.x), 0.02, mm(ds.z), 0, 0, 0]);
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
    const facing = Math.atan2(-n.x, -n.z);
    // A door: how far it swings open about the upright, as drawn, and the side it is hung on
    // (its hinge to the right of its middle, looking at its front, or not).
    const shut = handle.getWorldQuaternion(new THREE.Quaternion());
    toggle.use();
    toggle.update(100);
    const open = handle.getWorldQuaternion(new THREE.Quaternion());
    toggle.use();
    toggle.update(100);
    const turn = shut.clone().invert().multiply(open);
    const swing = 2 * Math.acos(Math.min(1, Math.abs(turn.w)));
    const upright = Math.abs(turn.y) / Math.max(1e-9, Math.sin(swing / 2)) > 0.9;
    const hinge = handle.getWorldPosition(new THREE.Vector3()).sub(dc);
    const right = hinge.x * Math.cos(facing) - hinge.z * Math.sin(facing) > 0 ? 1 : 0;
    const hung = upright && swing > 0.1 && kind !== 'mailbox' ? [mm(swing), right] : [0, 0];
    // The portaloo's front is its cabin's: its door, smaller, is measured on it.
    const across = new THREE.Vector3(Math.cos(facing), 0, -Math.sin(facing));
    const leaf: [number, number, number, number] | null =
      kind === 'portaloo' && hung[0]! > 0
        ? [mm(width), mm(ds.y), mm(dc.clone().sub(at).dot(across)), mm(dc.y - at.y)]
        : null;
    const row: ChevronScene['hideouts'][number] = [
      kind,
      mm(at.x),
      mm(at.y),
      mm(at.z),
      mm(w),
      mm(h),
      mm(d),
      mm(facing),
      hung[0]!,
      hung[1]!,
    ];
    if (leaf) row.push(leaf);
    out.push(row);
  }
  return out;
}

/**
 * The scene's other things a click works (see `clickables`), each handle's box as it starts and
 * once it has been clicked (an oven's door down), each at least a few centimetres every way, as
 * car-test.html aims at them.
 */
function clickBoxes(scene: CarScene): ChevronScene['gadgets'] {
  const out: ChevronScene['gadgets'] = [];
  // Each handle's bounds in its own axes, as it starts (water running from a tap turned on is
  // no part of it), grown as `Gadgets` grows them; then where they are in the world.
  const local = (node: THREE.Object3D): THREE.Box3 => {
    const toNode = node.matrixWorld.clone().invert();
    const box = new THREE.Box3();
    node.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const m = new THREE.Matrix4().multiplyMatrices(toNode, mesh.matrixWorld);
      box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(m));
    });
    const size = box.getSize(new THREE.Vector3());
    const grow = (v: number) => Math.max(0.01, (0.08 - v) / 2);
    return box.expandByVector(new THREE.Vector3(grow(size.x), grow(size.y), grow(size.z)));
  };
  const placed = (node: THREE.Object3D, box: THREE.Box3): SceneBox => {
    const b = box.clone().applyMatrix4(node.matrixWorld);
    const c = b.getCenter(new THREE.Vector3());
    const s = b.getSize(new THREE.Vector3());
    return [mm(c.x), mm(c.y), mm(c.z), mm(s.x), mm(s.y), mm(s.z)];
  };
  clickables(scene.root).forEach((g, i) => {
    const boxes = g.handles.map(local);
    const starts = g.handles.map((h, k) => placed(h, boxes[k]!));
    let used = starts;
    if (g instanceof Toggle) {
      g.use();
      g.update(100);
      scene.root.updateMatrixWorld(true);
      used = g.handles.map((h, k) => placed(h, boxes[k]!));
      g.use();
      g.update(100);
      scene.root.updateMatrixWorld(true);
    }
    starts.forEach((b, k) => out.push([i + 1, ...b, ...used[k]!]));
  });
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

/** Half a body's extents along x and z, set down at `at`: turned a quarter, they swap. */
function extents(at: Place, alongX: number, alongZ: number): [number, number] {
  return Math.abs(Math.sin(at.heading)) > 0.5 ? [alongZ, alongX] : [alongX, alongZ];
}

function chevronScene(): ChevronScene {
  const L = CHEVRON_LAYOUT;
  const scene = buildCarScene({ noWorks: true, layout: L });
  scene.root.updateMatrixWorld(true);
  const { solids, shells, ceilings } = carSolids(scene);
  const hideouts = hidingPlaces(scene);
  const gadgets = clickBoxes(scene);

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
    { at: L.house, body: HOUSE_BODY },
    { at: L.bigHouse, body: BIG_HOUSE_BODY },
  ];
  const eaveOf = (b: Box) =>
    houses.find(({ at, body }) => {
      const [ex, ez] = extents(at, body.depth, body.half);
      return (
        Math.abs(b[0] - at.x) < ex + 0.2 &&
        Math.abs(b[2] - at.z) < ez + 0.2 &&
        Math.abs(b[1] + b[4] / 2 - (body.eave + 0.4)) < 0.01
      );
    })?.body.eave;
  // The baseplate on the job site: in a game it is the build's own plate, solid as that.
  const plates: Box[] = [];
  scene.site.traverse((o) => {
    if (o.name === 'baseplate') plates.push(boxOf(new THREE.Box3().setFromObject(o)));
  });
  for (const block of [...solids.blocks, ...shells.blocks]) {
    const b = blockBox(block);
    if (plates.some((p) => within(b, p) && within(p, b))) continue;
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
    if (Math.abs(b[0] - L.house.x) < 1 && Math.abs(b[2] - L.house.z) < 1) still.push(b);
  }
  expect(solids.ramps).toHaveLength(0);

  // The street's furniture and the site's fittings, part by part: but for what the game has its
  // own of (the Done button, the bell and the boards, the bins, the power cabinet and the
  // portaloo), where a click has to land on the game's.
  const bins: ChevronScene['bins'] = [];
  let panel: Box | null = null;
  const own = new Set<THREE.Object3D>();
  for (const g of gadgetsIn(scene.root)) {
    const handle = g.handles[0];
    if (!handle) continue;
    const prop = ancestor(handle, (a) => a.name === 'prop');
    if (g.hint() === 'open the bin' && prop) {
      own.add(prop);
      // Its front is its +x, the way it is turned.
      const n = new THREE.Vector3(1, 0, 0).applyQuaternion(
        prop.getWorldQuaternion(new THREE.Quaternion()),
      );
      bins.push([
        ...boxOf(new THREE.Box3().setFromObject(prop)),
        mm(Math.atan2(-n.x, -n.z)),
        prop.userData.binColour as number,
      ]);
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
    const mid = new THREE.Vector3(L.bigHouse.x, ridge, L.bigHouse.z)
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
  site.position.set(L.jobSite.x, 0, L.jobSite.z);
  site.rotation.y = L.jobSite.heading;
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

  // The ladder up the big house: climbed straight up, its foot out from where it stands, its
  // middle across as it is drawn.
  const ladder = fittings.find((f) => f.name === 'ladder')!;
  const lc = new THREE.Box3().setFromObject(ladder).getCenter(new THREE.Vector3());
  const out = { x: Math.sin(L.ladder.heading), z: Math.cos(L.ladder.heading) };
  const foot = {
    x: Math.abs(out.x) > 0.5 ? L.ladder.x + out.x * 0.18 : lc.x,
    z: Math.abs(out.z) > 0.5 ? L.ladder.z + out.z * 0.18 : lc.z,
  };

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
      L.house.x,
      L.house.z,
      ...extents(L.house, HOUSE_BODY.depth - HOUSE_BODY.wall, HOUSE_BODY.half - HOUSE_BODY.wall),
      HOUSE_BODY.plinth,
      HOUSE_BODY.eave,
    ),
    room(
      L.bigHouse.x,
      L.bigHouse.z,
      ...extents(L.bigHouse, depth - BIG_HOUSE_BODY.wall, half - BIG_HOUSE_BODY.wall),
      BIG_HOUSE_BODY.plinth,
      BIG_HOUSE_BODY.floor,
    ),
    room(
      L.bigHouse.x,
      L.bigHouse.z,
      ...extents(L.bigHouse, depth - BIG_HOUSE_BODY.wall, half - BIG_HOUSE_BODY.wall),
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
        b.min.x > L.bigHouse.x - depth + 0.4 &&
        b.max.x < L.bigHouse.x + depth - 0.4 &&
        b.min.z > L.bigHouse.z - half + 0.4 &&
        b.max.z < L.bigHouse.z + half - 0.4,
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
    gadgets,
    bins,
    road: [mm(L.street.x0), mm(L.street.south), mm(L.street.x1), mm(L.street.north)],
    bays: CHEVRON_BAYS,
    panel: panel!,
    rooms,
    site: {
      baseplate: [
        mm(L.jobSite.x - BASEPLATE_SIZE / 2),
        SITE_PAD.height,
        mm(L.jobSite.z - BASEPLATE_SIZE / 2),
      ],
      done: onSite(SITE_BUTTONS.done.x, SITE_BUTTONS.done.z),
      bell: onSite(SITE_BUTTONS.bell.x, SITE_BUTTONS.bell.z),
      boards,
      inspector: [mm(L.inspector.x), mm(L.inspector.z), INSPECTOR_PAD.size],
    },
    machines: L.brickWorks.map((m) => [m.kind, mm(m.x), mm(m.z), mm(m.facing)]),
    ladder: [mm(foot.x), mm(foot.z), mm(L.ladder.height), mm(L.ladder.heading)],
    start: [mm(L.start.x), mm(L.start.z)],
    jar: [mm(top.x), mm(island.max.y), mm(top.z)],
  };
}

/** The file, as it is written. */
function source(scene: ChevronScene): string {
  const lines = (rows: unknown[], pad: string) =>
    rows.map((r) => `${pad}${JSON.stringify(r)},`).join('\n');
  const { boxes, walls, roofs, vehicles, hideouts, gadgets, bins, bays, ...rest } = scene;
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
    `  gadgets: [\n${lines(gadgets, '    ')}\n  ],`,
    `  bins: [\n${lines(bins, '    ')}\n  ],`,
    '  bays: {',
    `    long: [\n${lines(bays.long, '      ')}\n    ],`,
    `    short: [\n${lines(bays.short, '      ')}\n    ],`,
    '  },',
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

describe('Chevron Street’s layout', () => {
  it('digs its road works in the road and stands the inspector beside the site office, clear of all', () => {
    const L = CHEVRON_LAYOUT;
    const scene = buildCarScene({ noWorks: true, layout: L });
    scene.root.updateMatrixWorld(true);
    const boxOf = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);
    const pieces = new Set([
      'water barrier',
      'road works sign',
      'portable signal',
      'road plate',
      'spoil heap',
    ]);
    const works = scene.site.children.filter((g) => pieces.has(g.name));
    expect(works).toHaveLength(8);
    const inspector = scene.site.children.find((g) => g.name === 'inspector')!;
    // Wherever a vehicle may park in a round: a car in any short bay, the bus in either long one.
    const parkedIn = (b: [number, number, number, number], v: THREE.Object3D) => {
      const s = boxOf(v).getSize(new THREE.Vector3());
      const [x, z] = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
      return new THREE.Box3(
        new THREE.Vector3(x - s.x / 2, 0, z - s.z / 2),
        new THREE.Vector3(x + s.x / 2, s.y, z + s.z / 2),
      );
    };
    const vehicles = [
      ...CHEVRON_BAYS.short.flatMap((b) =>
        [scene.car.root, scene.sports.root].map((v) => parkedIn(b, v)),
      ),
      ...CHEVRON_BAYS.long.map((b) => parkedIn(b, scene.bus.root)),
    ];
    // The street's furniture part by part, so a lamp's arm out over the road is no matter.
    const props: THREE.Box3[] = [];
    for (const prop of scene.street.children.filter((c) => c.name === 'prop'))
      prop.traverse((m) => {
        if ((m as THREE.Mesh).isMesh) props.push(boxOf(m));
      });
    const others = scene.site.children
      .filter((g) => g !== inspector && !pieces.has(g.name))
      .map(boxOf);
    const houses = [scene.house, scene.bigHouse].map(boxOf);
    for (const piece of [...works, inspector]) {
      const b = boxOf(piece);
      // Clear of a parked vehicle, its mirrors and all, with a little to spare.
      const show = (o: THREE.Box3) =>
        `${piece.name} ${JSON.stringify([b.min, b.max])} in ${JSON.stringify([o.min, o.max])}`;
      for (const v of vehicles)
        expect(b.intersectsBox(v.clone().expandByScalar(0.1)), show(v)).toBe(false);
      for (const o of [...props, ...others, ...houses])
        expect(b.intersectsBox(o), show(o)).toBe(false);
    }
    // The works between the kerbs, clear of the zebra crossing.
    const st = L.street;
    for (const piece of works) {
      const b = boxOf(piece);
      expect(b.min.z).toBeGreaterThan(st.south);
      expect(b.max.z).toBeLessThan(st.north);
      expect(b.min.x - st.crossing > 1.5 || st.crossing - b.max.x > 1.5).toBe(true);
    }
    // The inspector on the site office's far side from the alley (its right, seen from the
    // street), a good stride clear of its wall, not out before its door, and inside the map.
    const office = boxOf(scene.house);
    const b = boxOf(inspector);
    expect(L.inspector.x).toBeLessThan(L.house.x);
    expect(b.max.x).toBeLessThan(office.min.x - 0.75);
    expect(b.min.z).toBeGreaterThan(office.min.z - 1);
    expect(b.min.x).toBeGreaterThan(-CHEVRON_HALF);
    expect(b.max.z).toBeLessThan(CHEVRON_HALF);
  });
});
