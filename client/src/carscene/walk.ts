import * as THREE from 'three';
import { Solids } from '../testmap/walk.ts';
import {
  BALCONY,
  BALCONY_DOOR,
  BIG_HOUSE_BODY,
  DOOR as BIG_DOOR,
  LETTERBOX as BIG_LETTERBOX,
  STAIR,
  STAIRWELL,
} from './bighouse.ts';
import { HOUSE_BODY, HOUSE_DOOR, HOUSE_LETTERBOX } from './house.ts';
import { MACHINE_MODELS } from './machines.ts';
import type { CarScene } from './scene.ts';
import { STREET } from './street.ts';

/**
 * Walking about the car test map: what stands in the way and what can be stood on, from the
 * scene as it is built (the pirate island's walker and solids, over flat ground). The cars, the
 * cones and the street's furniture are solid to their bounds; the houses have walls with their
 * doors open as gaps, floors on their plinths, their furniture, and in the big house a stair up
 * to the floor above. The camera keeps out of a coarse copy of the same, with ceilings over.
 * Nothing walls the map in: past it all, the studio's floor goes on for good.
 */

/**
 * Where the player starts: on the near pavement past the railings' end, the street open before
 * them and the big house across it, the bus clear of the camera behind.
 */
export const START = { x: 3.0, z: -12.3, heading: 0.2 };

/** How high a prop's footprint is taken up to (m). */
const WAIST = 1.4;

/** How near (m) the player comes to a door before it slides open. */
export const DOOR_OPEN = { near: 1.7 };

/** `o`'s bounds in `frame`'s own axes, exact however `frame` is turned about the upright. */
export function boxIn(o: THREE.Object3D, frame: THREE.Object3D): THREE.Box3 {
  frame.updateWorldMatrix(true, true);
  const toFrame = frame.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  const local = new THREE.Matrix4();
  o.traverse((m) => {
    const mesh = m as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    local.multiplyMatrices(toFrame, mesh.matrixWorld);
    box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(local));
  });
  return box;
}

/** A box block over `b`, a box in `frame`'s axes. */
function block(solids: Solids, frame: THREE.Object3D, b: THREE.Box3): void {
  const c = b.getCenter(new THREE.Vector3());
  const s = b.getSize(new THREE.Vector3());
  solids.box(frame, c.x, b.min.y, c.z, s.x, s.y, s.z);
}

interface Body {
  depth: number;
  half: number;
  plinth: number;
  eave: number;
  wall: number;
}

/** A doorway through a house's wall: on `face`, `at` along it, `w` wide, from `y0` up to `top`. */
interface Doorway {
  face: '+x' | '+z';
  at: number;
  w: number;
  y0: number;
  top: number;
}

/**
 * A house's walls round its plinth, a gap in them for each of its `doors`, its furniture, and a
 * ceiling over (for the camera only, in `ceilings`).
 */
function house(
  solids: Solids,
  ceilings: Solids,
  frame: THREE.Group,
  body: Body,
  doors: Doorway[],
  floors: number[],
): void {
  const { depth, half, plinth, eave, wall } = body;
  const high = eave + 0.4;
  solids.box(frame, 0, 0, 0, depth * 2, plinth, half * 2);
  // The long walls along x (at ±z) and the gables along z (at ±x), split round their doors.
  const run = (along: 'x' | 'z', side: number, from: number, to: number, y0 = 0, y1 = high) => {
    const mid = (from + to) / 2;
    const off = side * ((along === 'x' ? half : depth) - wall / 2);
    if (along === 'x') solids.box(frame, mid, y0, off, to - from, y1 - y0, wall);
    else solids.box(frame, off, y0, mid, wall, y1 - y0, to - from);
  };
  for (const side of [-1, 1])
    for (const along of ['x', 'z'] as const) {
      const face = along === 'x' ? '+z' : '+x';
      const gaps = side > 0 ? doors.filter((d) => d.face === face) : [];
      const end = along === 'x' ? depth : half;
      // Cut along it wherever a door starts or ends, and stand each piece up round the doors
      // that it is under (one over another, as the big house's front door and glass door are).
      const cuts = [-end, end, ...gaps.flatMap((d) => [d.at - d.w / 2, d.at + d.w / 2])];
      cuts.sort((p, q) => p - q);
      for (let i = 0; i + 1 < cuts.length; i++) {
        const [a, b] = [cuts[i]!, cuts[i + 1]!];
        if (b - a < 1e-6) continue;
        const over = gaps.filter((d) => d.at - d.w / 2 < b - 1e-6 && d.at + d.w / 2 > a + 1e-6);
        over.sort((p, q) => p.y0 - q.y0);
        let y = 0;
        for (const d of over) {
          if (d.y0 > y) run(along, side, a, b, y, d.y0);
          y = Math.max(y, d.top);
        }
        run(along, side, a, b, y, high);
      }
    }
  ceilings.box(frame, 0, eave - 0.02, 0, depth * 2, 0.3, half * 2);
  for (const piece of frame.children) {
    if (piece.name !== 'furniture') continue;
    const b = boxIn(piece, frame);
    // Lights hung from the ceiling stand in no one's way.
    const under = Math.max(...floors.filter((f) => f <= b.min.y + 0.05));
    if (b.min.y - under > 1.0) continue;
    block(solids, frame, b);
  }
}

/**
 * The big house's stair: walked as a slope through the middle of its treads, so the player goes
 * up and down it smoothly rather than a step at a time. Under it, only its treads stand in the
 * way (of a head that would hit them), so that it can be walked under where it is high enough;
 * its rail stands along its open side. And its upper floor round the well.
 */
function upstairs(solids: Solids, frame: THREE.Group): void {
  const { depth, half, plinth, floor: band, wall } = BIG_HOUSE_BODY;
  const [ix, iz] = [depth - wall, half - wall];
  const [y0, y1] = [plinth + 0.01, band + 0.2];
  const going = STAIR.run / STAIR.steps;
  const rise = (y1 - y0) / STAIR.steps;
  const z = -iz + STAIR.width / 2 + 0.02;
  const rail = z + STAIR.width / 2 - 0.03;
  for (let k = 0; k < STAIR.steps; k++) {
    const x = STAIR.x + (k + 0.5) * going;
    const tread = y0 + (k + 1) * rise;
    solids.box(frame, x, tread - 0.15, z, going, 0.1, STAIR.width, 0, false);
    solids.box(frame, x, tread, rail, going, 0.95, 0.06, 0, false);
  }
  // From the floor just before the first step to the middle of the last tread.
  solids.ramp(
    frame,
    STAIR.x + STAIR.run / 2 - going / 2,
    z,
    STAIR.width,
    STAIR.run,
    y0,
    y1,
    Math.PI / 2,
  );
  // The floor: three slabs round the well, its underside at the ceiling below.
  const { x0, x1, out } = STAIRWELL;
  const slab = (xa: number, xb: number, za: number, zb: number) =>
    solids.box(frame, (xa + xb) / 2, band - 0.1, (za + zb) / 2, xb - xa, y1 - band + 0.1, zb - za);
  slab(-ix, x0, -iz, iz);
  slab(x0, x1, -iz + out, iz);
  slab(x1, ix, -iz, iz);
  // The rail round the well's open sides, on to the stair's own at its head.
  solids.box(frame, x0, y1, -iz + out / 2, 0.06, 1.0, out);
  solids.box(frame, (x0 + x1) / 2, y1, -iz + out, x1 - x0, 1.0, 0.06);
  solids.box(frame, x1, y1, (rail - iz + out) / 2, 0.06, 1.0, -iz + out - rail);
}

export interface CarWalk {
  solids: Solids;
  /** Boxes the camera keeps out of: everything solid and the houses' ceilings. */
  camera: THREE.Group;
  /** The houses' doors, each sliding along its own x (see `slideDoors`). */
  doors: THREE.Object3D[];
  /** Inside each house, a box in its own axes: the camera stays in it while the player is. */
  rooms: { frame: THREE.Object3D; box: THREE.Box3 }[];
}

export function carWalk(scene: CarScene): CarWalk {
  scene.root.updateMatrixWorld(true);
  const solids = new Solids();
  const ceilings = new Solids();

  for (const v of [scene.car, scene.sports, scene.bus])
    block(solids, v.root, boxIn(v.root, v.root));
  for (const c of scene.cones) block(solids, c, boxIn(c, c));
  // The brick works: its pad a step up, and each machine to its bounds.
  for (const m of scene.machines.children) {
    if (m.name === 'pad') block(solids, scene.root, new THREE.Box3().setFromObject(m));
    else if (MACHINE_MODELS[m.name as keyof typeof MACHINE_MODELS]) block(solids, m, boxIn(m, m));
  }

  house(
    solids,
    ceilings,
    scene.house,
    HOUSE_BODY,
    [
      {
        face: '+x',
        at: HOUSE_DOOR.at,
        w: HOUSE_DOOR.w,
        y0: 0,
        top: HOUSE_DOOR.y + HOUSE_DOOR.h / 2,
      },
    ],
    [HOUSE_BODY.plinth],
  );
  // Its step up to the door, and the letterbox.
  solids.box(
    scene.house,
    HOUSE_BODY.depth + 0.28,
    0,
    HOUSE_DOOR.at,
    0.42,
    0.18,
    HOUSE_DOOR.w + 0.4,
  );
  solids.post(scene.house, HOUSE_LETTERBOX.x, HOUSE_LETTERBOX.z, 0.13, 0, 1.25);

  const big = BIG_HOUSE_BODY;
  const up = big.floor + 0.2;
  house(
    solids,
    ceilings,
    scene.bigHouse,
    big,
    [
      { face: '+z', at: BIG_DOOR.at, w: BIG_DOOR.w, y0: 0, top: BIG_DOOR.y + BIG_DOOR.h / 2 },
      { face: '+z', at: BALCONY_DOOR.at, w: BALCONY_DOOR.w, y0: up, top: up + BALCONY_DOOR.h },
    ],
    [big.plinth, up],
  );
  upstairs(solids, scene.bigHouse);
  // The balcony out through the glass door, and its railing.
  const { w: bw, out: bo } = BALCONY;
  solids.box(scene.bigHouse, 0, up - 0.2, big.half + bo / 2, bw, 0.2, bo);
  solids.box(scene.bigHouse, 0, up, big.half + bo - 0.06, bw, 1.0, 0.06);
  for (const s of [-1, 1])
    solids.box(scene.bigHouse, s * (bw / 2 - 0.06), up, big.half + bo / 2, 0.06, 1.0, bo);
  // Its two steps up to the door, and the letterbox.
  const face = big.half + 0.1;
  solids.box(scene.bigHouse, BIG_DOOR.at, 0, face + 0.175, BIG_DOOR.w + 0.5, 0.27, 0.35);
  solids.box(scene.bigHouse, BIG_DOOR.at, 0, face + 0.525, BIG_DOOR.w + 0.8, 0.13, 0.35);
  solids.post(scene.bigHouse, BIG_LETTERBOX.x, BIG_LETTERBOX.z, 0.13, 0, 1.25);

  // The pavements, kerb to back, and the street's furniture to its footprint up to a waist's
  // height (not the lamps' and the signs' arms out over the road).
  const { x0, x1, north, south, pavement } = STREET;
  solids.box(scene.root, (x0 + x1) / 2, 0, north + pavement / 2, x1 - x0, 0.15, pavement);
  solids.box(scene.root, (x0 + x1) / 2, 0, south - pavement / 2, x1 - x0, 0.15, pavement);
  const v = new THREE.Vector3();
  const parts: THREE.Box3[] = [];
  for (const prop of scene.street.children) {
    if (prop.name !== 'prop') continue;
    const low = new THREE.Box3();
    let top = 0;
    prop.traverse((m) => {
      const mesh = m as THREE.Mesh;
      if (!mesh.isMesh) return;
      const pos = mesh.geometry.attributes.position!;
      let any = false;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        if (v.y > WAIST) continue;
        low.expandByPoint(v);
        any = true;
      }
      if (any) top = Math.max(top, Math.min(new THREE.Box3().setFromObject(mesh).max.y, 2.2));
    });
    if (low.isEmpty()) continue;
    low.max.y = top;
    block(solids, scene.root, low);
    // For the camera, every part of it as it stands, the lamps' and the lights' heads up on
    // their poles too, so that it keeps out of them as it does out of a bin.
    prop.traverse((m) => {
      if (!(m as THREE.Mesh).isMesh) return;
      const b = new THREE.Box3().setFromObject(m);
      const s = b.getSize(v);
      if (Math.max(s.x, s.y, s.z) > 0.08) parts.push(b);
    });
  }

  // The camera's copy: a box for each block (the floor it keeps above on its own).
  const camera = new THREE.Group();
  const stuff = new THREE.MeshBasicMaterial();
  for (const b of [...solids.blocks, ...ceilings.blocks]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.y1 - b.y0, b.hz * 2), stuff);
    m.position.set(b.x, (b.y0 + b.y1) / 2, b.z);
    m.rotation.y = Math.atan2(b.sin, b.cos);
    camera.add(m);
  }
  for (const b of parts) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...b.getSize(v).toArray()), stuff);
    b.getCenter(m.position);
    camera.add(m);
  }
  for (const r of solids.rounds) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r.r, r.r, r.y1 - r.y0, 8), stuff);
    m.position.set(r.x, (r.y0 + r.y1) / 2, r.z);
    camera.add(m);
  }
  camera.updateMatrixWorld(true);

  const doors: THREE.Object3D[] = [];
  scene.root.traverse((o) => {
    if (o.name === 'door') doors.push(o);
  });
  // The rooms: inside its walls, from its floor to its ceiling, in each house's own axes.
  const rooms = [
    { frame: scene.house as THREE.Object3D, body: HOUSE_BODY },
    { frame: scene.bigHouse, body: BIG_HOUSE_BODY },
  ].map(({ frame, body }) => {
    const [ix, iz] = [body.depth - body.wall, body.half - body.wall];
    return {
      frame,
      box: new THREE.Box3(
        new THREE.Vector3(-ix, body.plinth, -iz),
        new THREE.Vector3(ix, body.eave, iz),
      ),
    };
  });
  return { solids, camera, doors, rooms };
}

const doorAt = new THREE.Vector3();

/**
 * Slides each door toward open (`userData.slide` along its own x, into its wall) while `who`
 * stands near it, and shut again after, `dt` seconds on; shut at once if `who` is null.
 */
export function slideDoors(doors: THREE.Object3D[], who: THREE.Vector3 | null, dt: number): void {
  for (const d of doors) {
    const u = d.userData as { slide: number; home?: number; open?: number };
    const home = (u.home ??= d.position.x);
    let open = u.open ?? 0;
    if (!who) open = 0;
    else {
      doorAt.set(home, d.position.y, d.position.z);
      d.parent!.localToWorld(doorAt);
      const near =
        Math.hypot(doorAt.x - who.x, doorAt.z - who.z) < DOOR_OPEN.near &&
        Math.abs(doorAt.y - (who.y + 1)) < 1.5;
      open += ((near ? 1 : 0) - open) * Math.min(1, dt * 6);
    }
    u.open = open;
    d.position.x = home + open * u.slide;
  }
}
