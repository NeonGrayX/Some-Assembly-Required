import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BASEPLATE_SIZE,
  DOOR_THICKNESS,
  IDENTITY,
  MAPS,
  carDoorPose,
  meshDescs,
} from '@sar/shared';
import type {
  ChevronScene,
  LevelDef,
  SceneBox,
  SceneCarDoor,
  SceneDoor,
  SceneMesh,
} from '@sar/shared';
import { BIG_HOUSE_BODY } from './bighouse.ts';
import { BUS_BODY, BUS_CABIN } from './bus.ts';
import { CarDoors, doorsIn, houseDoors, openForGame } from './doors.ts';
import type { Swing } from './doors.ts';
import { MOVING, Toggle, gadgetsIn } from './gadgets.ts';
import { clickables, hidingToggles } from './hiding.ts';
import { HOUSE_BODY } from './house.ts';
import { INSPECTOR_PAD } from './inspector.ts';
import { DEMO_PAGE, SITE_BOARDS, SITE_BUTTONS, SITE_PAD } from './jobsite.ts';
import { intangible } from './meshWalk.ts';
import { CHEVRON_BAYS, CHEVRON_HALF, CHEVRON_LAYOUT } from './chevronLayout.ts';
import { buildCarScene } from './scene.ts';
import { coverOf, passable, sceneMesh, solidParts } from './solidParts.ts';
import type { SolidPart } from './solidParts.ts';
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
/** Where what is met of the models is kept (see `SceneMesh`). */
const MESH_OUT = fileURLToPath(
  new URL('../../../shared/src/content/maps/chevronMesh.ts', import.meta.url),
);

/**
 * What is met of Chevron Street's models: the street's (`still`), each vehicle's as the scene
 * parks it, and each sliding door's, shut (`door 0`…, `bus door 0`…).
 */
type ChevronMesh = Record<string, SceneMesh>;

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
 * once it has been clicked (an oven's door down), each at least a few centimetres every way, so
 * the crosshair can find them.
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
const within = (inner: Box, outer: Box, slack = 0.01) =>
  bounds(outer).expandByScalar(slack).containsBox(bounds(inner));

/** How high above the ground what lies on it is walked over, and laid nothing out by. */
const UNDERFOOT = 0.06;
/** How high a ledge round the foot of something is stepped up on, and laid out by as part of it. */
const LEDGE = 0.35;
/** How far what juts from a wall high enough to be overhead (see `covering`) is the wall's. */
const [OVERHEAD, JUT] = [0.6, 0.2];

/**
 * Whether `boxes` hold all of `inner` between them, to `slack`: at points through it no further
 * apart than a few centimetres (or as many as eight along a side).
 */
function heldBy(inner: Box, boxes: Box[], slack: number): boolean {
  const b = bounds(inner);
  const near = boxes.map((o) => bounds(o).expandByScalar(slack)).filter((o) => o.intersectsBox(b));
  if (near.some((o) => o.containsBox(b))) return true;
  if (!near.length) return false;
  const n = [0, 1, 2].map((i) => Math.min(8, Math.max(2, Math.ceil(inner[3 + i]! / 0.05) + 1)));
  const at = new THREE.Vector3();
  for (let i = 0; i < n[0]!; i++)
    for (let j = 0; j < n[1]!; j++)
      for (let k = 0; k < n[2]!; k++) {
        at.set(
          b.min.x + ((b.max.x - b.min.x) * i) / (n[0]! - 1),
          b.min.y + ((b.max.y - b.min.y) * j) / (n[1]! - 1),
          b.min.z + ((b.max.z - b.min.z) * k) / (n[2]! - 1),
        );
        if (!near.some((o) => o.containsPoint(at))) return false;
      }
  return true;
}

/** Leaves out every box another holds. */
function pruned(boxes: Box[]): Box[] {
  const big = [...boxes].sort((a, b) => b[3] * b[4] * b[5] - a[3] * a[4] * a[5]);
  const kept: Box[] = [];
  for (const b of big) if (!kept.some((k) => within(b, k))) kept.push(b);
  return kept;
}

/**
 * What the game has its own of in the scene, met as the game's own are, and so left out of what
 * is met of the scene: the street's bins, the Done button, the bell and the boards, the power
 * cabinet, the portaloo and the ladder.
 */
function gamesOwn(scene: CarScene): Set<THREE.Object3D> {
  const own = new Set<THREE.Object3D>();
  for (const g of gadgetsIn(scene.root)) {
    const prop = g.handles[0] && ancestor(g.handles[0], (a) => a.name === 'prop');
    if (g.role === 'bin' && prop) own.add(prop);
  }
  for (const f of scene.site.children) {
    if (f.name === 'jobSite') for (const c of f.children) if (c.name !== 'pad') own.add(c);
    if (f.name === 'portaloo' || f.name === 'ladder' || f.name === 'power cabinet') own.add(f);
  }
  return own;
}

/**
 * What is left out of what is met of the scene: what moves, the ground (the game's own), the
 * baseplate (the build's own) and the boards' pages, and what the game has its own of (`own`).
 */
const unmet = (own: Set<THREE.Object3D>) => (o: THREE.Object3D) =>
  o.name === MOVING ||
  o.name === 'floor' ||
  o.name === 'baseplate' ||
  o.name === DEMO_PAGE ||
  own.has(o);

/** Half a body's extents along x and z, set down at `at`: turned a quarter, they swap. */
function extents(at: Place, alongX: number, alongZ: number): [number, number] {
  return Math.abs(Math.sin(at.heading)) > 0.5 ? [alongZ, alongX] : [alongX, alongZ];
}

function chevronScene(): { scene: ChevronScene; mesh: ChevronMesh } {
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
  const own = gamesOwn(scene);
  for (const g of gadgetsIn(scene.root)) {
    const handle = g.handles[0];
    if (!handle) continue;
    const prop = ancestor(handle, (a) => a.name === 'prop');
    if (g.role === 'bin' && prop) {
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
  for (const f of fittings)
    if (f.name === 'power cabinet') panel = boxOf(new THREE.Box3().setFromObject(f));
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
  const turned = (k: keyof typeof vehicles) => L.parked.find((p) => p.vehicle === k)!.turned;
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

  // What is met, part by part as it is drawn in a game, with its doors open: but for what the
  // game has its own of, what moves, the ground (the game's own) and the vehicles, which are
  // each worked out apart, to be parked where a round parks them.
  openForGame(scene.root, scene.bus.root);
  const vehicleRoots = new Set<THREE.Object3D>(Object.values(vehicles));
  const left = unmet(own);
  /**
   * `rough` and, round each of `solids` none of them nor the houses' walls holds, boxes of its
   * bounds: what the map is laid out by (the dog's walks, where pages and bins go) is all that is
   * met.
   */
  const covering = (rough: Box[], solids: SolidPart[]) => {
    const out = [...rough];
    const held = [...rough, ...walls];
    for (const s of solids)
      for (const piece of coverOf(s)) {
        // What lies on the ground underfoot, a paving stone or a pebble, is walked over.
        if (piece.max.y < UNDERFOOT) continue;
        const b = boxOf(piece);
        // What lies on a wall's face, a panel or a skirting, is the wall's for laying out by, and
        // a house's floor under its walls the floor's and the walls', a ledge it stands out by
        // that is stepped up on as well.
        if (heldBy(b, held, piece.max.y < LEDGE ? 0.12 : 0.03)) continue;
        // And what juts from a wall over the dog's head, a sill or a gutter, the wall's too.
        if (piece.min.y > OVERHEAD && heldBy(b, walls, JUT)) continue;
        out.push(b);
      }
    return pruned(out);
  };
  const met = solidParts(scene.root, (o) => left(o) || vehicleRoots.has(o));
  const vehicleSolids = {
    car: solidParts(vehicles.car, left),
    sports: solidParts(vehicles.sports, left),
    bus: solidParts(vehicles.bus, left),
  };
  // The houses' sliding doors and the vehicles' doors, bonnets and boots, each met apart, as it
  // stands shut, and moved as it opens.
  const sliding = houseDoors(scene.root);
  const isDoor = new Set(sliding);
  const vec = (v: THREE.Vector3) => [mm(v.x), mm(v.y), mm(v.z)] as const;
  const doorMeshes: Record<string, SceneMesh> = {};
  const houseDoorsShut: SceneDoor[] = sliding.map((d, i) => {
    const slide = d.userData.slide as number;
    d.position.x -= slide;
    d.updateMatrixWorld(true);
    const at = d.getWorldPosition(new THREE.Vector3());
    const open = d.parent!.localToWorld(d.position.clone().setX(d.position.x + slide));
    doorMeshes[`door ${i}`] = sceneMesh(d, null, left, true);
    d.position.x += slide;
    d.updateMatrixWorld(true);
    return [...vec(at), 0, 0, 0, ...vec(open.sub(at))];
  });
  /** Those that open together: one group to a swing (see `Swing`). */
  const groups = new Map<Swing, number>();
  const carDoors = (k: keyof typeof vehicles): SceneCarDoor[] =>
    doorsIn(vehicles[k]).map((d, i) => {
      isDoor.add(d);
      const swing = d.userData.swing as Swing;
      const was = swing.t;
      swing.t = 0;
      new CarDoors([d]).update(0, null);
      d.updateMatrixWorld(true);
      if (!groups.has(swing)) groups.set(swing, groups.size);
      const turn = new THREE.Matrix3().setFromMatrix4(d.parent!.matrixWorld);
      const way = (v: THREE.Vector3) => vec(v.clone().applyMatrix3(turn));
      const u = d.userData as {
        axis: string;
        open?: number;
        out?: THREE.Vector3;
        along?: THREE.Vector3;
      };
      const axis = new THREE.Vector3(0, u.axis === 'y' ? 1 : 0, u.axis === 'z' ? 1 : 0);
      doorMeshes[`${k} door ${i}`] = sceneMesh(d, null, left, true);
      swing.t = was;
      new CarDoors([d]).update(0, null);
      d.updateMatrixWorld(true);
      return {
        group: groups.get(swing)!,
        what: (d.userData.what as string | undefined) ?? 'door',
        ...(u.axis === 'slide'
          ? { slide: [...way(u.out!), ...way(u.along!)] }
          : {
              hinge: [
                ...vec(d.getWorldPosition(new THREE.Vector3())),
                ...vec(axis.applyMatrix3(turn).normalize()),
                mm(u.open!),
              ],
            }),
      };
    });
  const vehicleDoors = { car: carDoors('car'), sports: carDoors('sports'), bus: carDoors('bus') };
  const mesh: ChevronMesh = {
    still: sceneMesh(scene.root, null, (o) => left(o) || vehicleRoots.has(o) || isDoor.has(o)),
    car: sceneMesh(vehicles.car, null, (o) => left(o) || isDoor.has(o)),
    sports: sceneMesh(vehicles.sports, null, (o) => left(o) || isDoor.has(o)),
    bus: sceneMesh(vehicles.bus, null, (o) => left(o) || isDoor.has(o)),
    ...doorMeshes,
  };

  const chevron: ChevronScene = {
    boxes: covering([...cut(still), ...cut(parts)], met),
    doors: houseDoorsShut,
    walls,
    roofs,
    vehicles: {
      car: {
        middle: middle('car'),
        turned: turned('car'),
        doors: vehicleDoors.car,
        boxes: covering(owned.car, vehicleSolids.car),
      },
      sports: {
        middle: middle('sports'),
        turned: turned('sports'),
        doors: vehicleDoors.sports,
        boxes: covering(owned.sports, vehicleSolids.sports),
      },
      bus: {
        middle: middle('bus'),
        turned: turned('bus'),
        doors: vehicleDoors.bus,
        boxes: covering(owned.bus, vehicleSolids.bus),
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
  return { scene: chevron, mesh };
}

/** The file, as it is written. */
function source(scene: ChevronScene): string {
  const lines = (rows: unknown[], pad: string) =>
    rows.map((r) => `${pad}${JSON.stringify(r)},`).join('\n');
  const { boxes, walls, roofs, vehicles, hideouts, gadgets, bins, bays, ...rest } = scene;
  const vehicle = (
    name: string,
    v: { middle: [number, number]; turned: boolean; boxes: Box[]; doors: SceneCarDoor[] },
    more = '',
  ) =>
    `    ${name}: {\n      middle: ${JSON.stringify(v.middle)},\n      turned: ${v.turned},${more}\n      doors: [\n${lines(v.doors, '        ')}\n      ],\n      boxes: [\n${lines(v.boxes, '        ')}\n      ],\n    },`;
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

/** The mesh file, as it is written. */
function meshSource(mesh: ChevronMesh): string {
  const part = (name: string) => {
    const { shapes, triangles } = mesh[name]!;
    return [
      `  ${/^\w+$/.test(name) ? name : `'${name}'`}: {`,
      `    shapes: [\n${shapes.map((r) => `      ${JSON.stringify(r)},`).join('\n')}\n    ],`,
      `    triangles: [\n${triangles.map((t) => `      '${t}',`).join('\n')}\n    ],`,
      '  },',
    ].join('\n');
  };
  return [
    '// Worked out from the car scene’s models by client/src/carscene/chevron.test.ts: not to be',
    '// edited by hand (see there). In the car scene’s own axes, the vehicles parked as it parks them',
    '// and the sliding doors shut.',
    "import type { SceneMesh } from './sceneMesh.ts';",
    '',
    '// prettier-ignore',
    'export const CHEVRON_MESH: Record<string, SceneMesh> = {',
    ...Object.keys(mesh).map(part),
    '};',
    '',
  ].join('\n');
}

/** How fine the tops of the models and of what is met are compared (m). */
const TOP_CELL = 0.1;
/** How far what is met may stand over or under the models it is met for (m). */
const TOP_SLACK = 0.15;

/**
 * The top of what is in `meshes` over each of an `nx × nz` grid's cells, TOP_CELL square from
 * (`x0`, `z0`): the height of the highest triangle over its middle (0, the ground, if none).
 */
function modelTops(
  meshes: THREE.Mesh[],
  x0: number,
  z0: number,
  nx: number,
  nz: number,
  edges: boolean,
) {
  const tops = new Float32Array(nx * nz);
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (const mesh of meshes) {
    const pos = mesh.geometry.attributes.position!;
    const index = mesh.geometry.index;
    const n = index ? index.count : pos.count;
    const at = (i: number, v: THREE.Vector3) =>
      v.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
    for (let t = 0; t + 2 < n; t += 3) {
      at(t, a);
      at(t + 1, b);
      at(t + 2, c);
      // With `edges`, what is drawn anywhere in a cell, not just over its middle: a leaf
      // thinner than a cell is drawn where no cell's middle is.
      if (edges)
        for (const [p, q] of [
          [a, b],
          [b, c],
          [c, a],
        ] as const) {
          const steps = Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / (TOP_CELL / 2));
          for (let s = 0; s <= steps; s++) {
            const f = s / Math.max(1, steps);
            const i = Math.floor((p.x + (q.x - p.x) * f - x0) / TOP_CELL);
            const k = Math.floor((p.z + (q.z - p.z) * f - z0) / TOP_CELL);
            const y = p.y + (q.y - p.y) * f;
            if (i >= 0 && i < nx && k >= 0 && k < nz && y > tops[i * nz + k]!) tops[i * nz + k] = y;
          }
        }
      const den = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(den) < 1e-12) continue;
      const i0 = Math.max(0, Math.ceil((Math.min(a.x, b.x, c.x) - x0) / TOP_CELL - 0.5));
      const i1 = Math.min(nx - 1, Math.floor((Math.max(a.x, b.x, c.x) - x0) / TOP_CELL - 0.5));
      const k0 = Math.max(0, Math.ceil((Math.min(a.z, b.z, c.z) - z0) / TOP_CELL - 0.5));
      const k1 = Math.min(nz - 1, Math.floor((Math.max(a.z, b.z, c.z) - z0) / TOP_CELL - 0.5));
      for (let i = i0; i <= i1; i++)
        for (let k = k0; k <= k1; k++) {
          const [x, z] = [x0 + (i + 0.5) * TOP_CELL, z0 + (k + 0.5) * TOP_CELL];
          const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / den;
          const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / den;
          if (u < 0 || v < 0 || u + v > 1) continue;
          const y = u * a.y + v * b.y + (1 - u - v) * c.y;
          if (y > tops[i * nz + k]!) tops[i * nz + k] = y;
        }
    }
  }
  return tops;
}

/**
 * Where what is met in `world` stands over or under what is drawn in `meshes` by more than the
 * slack, all round a cell, on an `nx × nz` grid TOP_CELL square from (`x0`, `z0`): `world` is
 * `shift` along x and z from the drawing.
 */
function mismatches(
  meshes: THREE.Mesh[],
  world: RAPIER.World,
  x0: number,
  z0: number,
  nx: number,
  nz: number,
  shift = { x: 0, z: 0 },
): string[] {
  // What is drawn anywhere in a cell, to stand on; what is drawn over its middle, to fall into.
  const [over, mid] = [true, false].map((edges) => modelTops(meshes, x0, z0, nx, nz, edges));
  const met = new Float32Array(nx * nz);
  for (let i = 0; i < nx; i++)
    for (let k = 0; k < nz; k++) {
      const [x, z] = [x0 + (i + 0.5) * TOP_CELL + shift.x, z0 + (k + 0.5) * TOP_CELL + shift.z];
      const hit = world.castRay(new RAPIER.Ray({ x, y: 12, z }, { x: 0, y: -1, z: 0 }), 12, true);
      met[i * nz + k] = hit ? Math.max(0, 12 - hit.timeOfImpact) : 0;
    }
  // Out by more than the slack all round a cell, a player's foot's width: a model's edge filled
  // out a little on its grid is no matter.
  const wrong: string[] = [];
  const off = (i: number, k: number, d: number) =>
    d * (met[i * nz + k]! - (d > 0 ? over : mid)![i * nz + k]!) > TOP_SLACK;
  for (let i = 1; i + 1 < nx; i++)
    for (let k = 1; k + 1 < nz; k++)
      for (const [d, what] of [
        [1, 'stood on air'],
        [-1, 'fallen into'],
      ] as const) {
        let all = true;
        for (let di = -1; di <= 1 && all; di++)
          for (let dk = -1; dk <= 1 && all; dk++) all = off(i + di, k + dk, d);
        if (all) {
          const [x, z] = [x0 + (i + 0.5) * TOP_CELL, z0 + (k + 0.5) * TOP_CELL];
          wrong.push(
            `${what} at ${x.toFixed(2)}, ${z.toFixed(2)}: met ${met[i * nz + k]!.toFixed(2)}, drawn ${(d > 0 ? over : mid)![i * nz + k]!.toFixed(2)}`,
          );
        }
      }
  return wrong;
}

/** The meshes under `root` that are met, as `sceneMesh` takes them, but for what `left` leaves. */
function metMeshes(root: THREE.Object3D, left: (o: THREE.Object3D) => boolean): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  const take = (o: THREE.Object3D) => {
    if (left(o) || passable(o) || intangible(o)) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) meshes.push(mesh);
    o.children.forEach(take);
  };
  take(root);
  return meshes;
}

describe('Chevron Street’s solids', () => {
  it(
    'are where the models are: no standing on air, and no falling into what is drawn',
    { timeout: 300000 },
    async () => {
      await RAPIER.init();
      const scene = buildCarScene({ noWorks: true, layout: CHEVRON_LAYOUT });
      // With its doors shut, as a game's stand while nobody is by them.
      scene.root.updateMatrixWorld(true);
      const meshes = metMeshes(scene.root, unmet(gamesOwn(scene)));
      // What is met: the street's meshes, the vehicles' parked as the scene parks them, and the
      // doors shut, as the game builds them.
      const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
      const vehicleDoors = (['car', 'sports', 'bus'] as const).flatMap((k) =>
        doorsIn(scene[k].root).map((_, i) => `chevron ${k} door ${i}`),
      );
      for (const mesh of [
        'chevron',
        'chevron car',
        'chevron sports',
        'chevron bus',
        ...houseDoors(scene.root).map((_, i) => `chevron door ${i}`),
        ...vehicleDoors,
      ])
        for (const desc of meshDescs(RAPIER, { mesh, at: { x: 0, y: 0, z: 0 }, turn: IDENTITY }))
          world.createCollider(desc);
      world.step();
      const H = CHEVRON_HALF;
      const n = Math.round((2 * H) / TOP_CELL);
      const wrong = mismatches(meshes, world, -H, -H, n, n);
      expect(wrong).toEqual([]);
    },
  );

  it(
    'are where a round draws each vehicle, turned end for end or not',
    { timeout: 600000 },
    async () => {
      await RAPIER.init();
      const chevron = MAPS.find((m) => m.id === 'chevron')!;
      // A round for each way each car can park.
      const rounds: LevelDef[] = [];
      const ways = new Set<string>();
      for (let seed = 1; ways.size < 4 && seed < 40; seed++) {
        const level = chevron.layout(seed);
        const fresh = level
          .scenery!.parked.filter((p) => p.vehicle !== 'bus')
          .map((p) => `${p.vehicle} ${p.turned}`)
          .filter((w) => !ways.has(w));
        if (!fresh.length) continue;
        fresh.forEach((w) => ways.add(w));
        rounds.push(level);
      }
      expect(ways.size).toBe(4);
      for (const level of rounds) {
        const def = level.scenery!;
        const scene = buildCarScene({ noWorks: true, layout: CHEVRON_LAYOUT, parked: def.parked });
        scene.root.updateMatrixWorld(true);
        const left = unmet(gamesOwn(scene));
        const doors = new CarDoors(
          [scene.car, scene.sports, scene.bus].flatMap((v) => doorsIn(v.root)),
        );
        // With every door, bonnet and boot shut, and with them all open.
        for (const t of [0, 1]) {
          for (const d of doors.doors) (d.userData.swing as Swing).t = t;
          doors.update(0, null);
          scene.root.updateMatrixWorld(true);
          for (const k of ['car', 'sports', 'bus'] as const) {
            // The vehicle's mesh and its doors', as the level places them: on their own, as
            // another's open door may reach over this one's ground.
            const ours = (mesh: string) =>
              mesh === `chevron ${k}` || mesh.startsWith(`chevron ${k} `);
            const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
            for (const place of [
              ...level.meshes!.filter((m) => ours(m.mesh)),
              ...level
                .carDoors!.filter((d) => ours(d.mesh.mesh))
                .map((d) => ({ mesh: d.mesh.mesh, ...carDoorPose(d, t) })),
            ])
              for (const desc of meshDescs(RAPIER, place)) world.createCollider(desc);
            world.step();
            const v = scene[k];
            const span = new THREE.Box3().setFromObject(v.root).expandByScalar(0.3);
            const [nx, nz] = [span.max.x - span.min.x, span.max.z - span.min.z].map((d) =>
              Math.ceil(d / TOP_CELL),
            );
            const wrong = mismatches(
              metMeshes(v.root, left),
              world,
              span.min.x,
              span.min.z,
              nx!,
              nz!,
              def,
            );
            const turned = def.parked.find((p) => p.vehicle === k)!.turned;
            expect(wrong, `${k} turned ${turned}, doors ${t}`).toEqual([]);
          }
        }
      }
    },
  );
});

describe('Chevron Street’s solids and places', () => {
  it('are worked out from the car scene as it is now', { timeout: 300000 }, () => {
    const { scene, mesh } = chevronScene();
    const [text, meshText] = [source(scene), meshSource(mesh)];
    if (process.env.CHEVRON === 'write') {
      writeFileSync(OUT, text);
      writeFileSync(MESH_OUT, meshText);
    }
    expect(readFileSync(OUT, 'utf8'), 'run with CHEVRON=write to bring it up to date').toBe(text);
    // Not compared with toBe: the diff of so many triangles would be enormous.
    expect(
      readFileSync(MESH_OUT, 'utf8') === meshText,
      'run with CHEVRON=write to bring it up to date',
    ).toBe(true);
  });
});

describe('Chevron Street’s layout', () => {
  it(
    'digs its road works in the road and stands the inspector beside the site office, clear of all',
    {
      timeout: 120000,
    },
    () => {
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
      // No sign among them.
      expect(works).toHaveLength(7);
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
    },
  );
});
