import * as THREE from 'three';
import { Solids } from '../testmap/walk.ts';
import {
  BIG_HOUSE_BODY,
  DOOR as BIG_DOOR,
  LETTERBOX as BIG_LETTERBOX,
  STAIR,
  STAIRWELL,
} from './bighouse.ts';
import { HOUSE_BODY, HOUSE_DOOR, HOUSE_LETTERBOX } from './house.ts';
import type { CarScene } from './scene.ts';
import { STREET } from './street.ts';

/**
 * Walking about the car test map: what stands in the way and what can be stood on, from the
 * scene as it is built (the pirate island's walker and solids, over flat ground). The cars, the
 * cones and the street's furniture are solid to their bounds; the houses have walls with their
 * doors open as gaps, floors on their plinths, their furniture, and in the big house a stair up
 * to the floor above. The camera keeps out of a coarse copy of the same, with ceilings over.
 */

/** Where the player may walk: within this far (m) of the studio floor's middle. */
export const WALK_AREA = { x: -3, z: -9.5, r: 19.5 };

/**
 * Where the player starts: on the near pavement past the railings' end, the street open before
 * them and the big house across it, the bus clear of the camera behind.
 */
export const START = { x: 3.0, z: -12.3, heading: 0.2 };

/** How high a prop's footprint is taken up to (m). */
const WAIST = 1.4;

/** How far a door swings in (rad), and how near (m) the player comes before it does. */
export const DOOR_OPEN = { angle: -1.45, near: 1.7 };

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

/**
 * A house's walls round its plinth, a gap for its door in the face `door.face` (`at` along it),
 * its furniture, and a ceiling over (for the camera only, in `ceilings`).
 */
function house(
  solids: Solids,
  ceilings: Solids,
  frame: THREE.Group,
  body: Body,
  door: { face: '+x' | '+z'; at: number; w: number; top: number },
  floors: number[],
): void {
  const { depth, half, plinth, eave, wall } = body;
  const high = eave + 0.4;
  solids.box(frame, 0, 0, 0, depth * 2, plinth, half * 2);
  // The long walls along x (at ±z) and the gables along z (at ±x), the door's split round it.
  const run = (along: 'x' | 'z', side: number, from: number, to: number, y0 = 0, y1 = high) => {
    const mid = (from + to) / 2;
    const off = side * ((along === 'x' ? half : depth) - wall / 2);
    if (along === 'x') solids.box(frame, mid, y0, off, to - from, y1 - y0, wall);
    else solids.box(frame, off, y0, mid, wall, y1 - y0, to - from);
  };
  for (const side of [-1, 1]) {
    if (side > 0 && door.face === '+z') {
      run('x', side, -depth, door.at - door.w / 2);
      run('x', side, door.at + door.w / 2, depth);
      run('x', side, door.at - door.w / 2, door.at + door.w / 2, door.top, high);
    } else run('x', side, -depth, depth);
    if (side > 0 && door.face === '+x') {
      run('z', side, -half, door.at - door.w / 2);
      run('z', side, door.at + door.w / 2, half);
      run('z', side, door.at - door.w / 2, door.at + door.w / 2, door.top, high);
    } else run('z', side, -half, half);
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

/** The big house's stair as its steps, solid underneath, and its upper floor round the well. */
function upstairs(solids: Solids, frame: THREE.Group): void {
  const { depth, half, plinth, floor: band, wall } = BIG_HOUSE_BODY;
  const [ix, iz] = [depth - wall, half - wall];
  const [y0, y1] = [plinth + 0.01, band + 0.2];
  const going = STAIR.run / STAIR.steps;
  const rise = (y1 - y0) / STAIR.steps;
  const z = -iz + STAIR.width / 2 + 0.02;
  for (let k = 0; k < STAIR.steps; k++)
    solids.box(frame, STAIR.x + (k + 0.5) * going, 0, z, going, y0 + (k + 1) * rise, STAIR.width);
  // The floor: three slabs round the well, its underside at the ceiling below.
  const { x0, x1, out } = STAIRWELL;
  const slab = (xa: number, xb: number, za: number, zb: number) =>
    solids.box(frame, (xa + xb) / 2, band - 0.1, (za + zb) / 2, xb - xa, y1 - band + 0.1, zb - za);
  slab(-ix, x0, -iz, iz);
  slab(x0, x1, -iz + out, iz);
  slab(x1, ix, -iz, iz);
  // The rail round the well's open sides.
  solids.box(frame, x0, y1, -iz + out / 2, 0.06, 1.0, out);
  solids.box(frame, (x0 + x1) / 2, y1, -iz + out, x1 - x0, 1.0, 0.06);
}

export interface CarWalk {
  solids: Solids;
  /** Boxes the camera keeps out of: everything solid and the houses' ceilings. */
  camera: THREE.Group;
  /** The houses' doors, each hung on its hinge. */
  doors: THREE.Object3D[];
}

export function carWalk(scene: CarScene): CarWalk {
  scene.root.updateMatrixWorld(true);
  const solids = new Solids();
  const ceilings = new Solids();

  for (const v of [scene.car, scene.sports, scene.bus])
    block(solids, v.root, boxIn(v.root, v.root));
  for (const c of scene.cones) block(solids, c, boxIn(c, c));

  house(
    solids,
    ceilings,
    scene.house,
    HOUSE_BODY,
    { face: '+x', at: HOUSE_DOOR.at, w: HOUSE_DOOR.w, top: HOUSE_DOOR.y + HOUSE_DOOR.h / 2 },
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
  house(
    solids,
    ceilings,
    scene.bigHouse,
    big,
    { face: '+z', at: BIG_DOOR.at, w: BIG_DOOR.w, top: BIG_DOOR.y + BIG_DOOR.h / 2 },
    [big.plinth, big.floor + 0.2],
  );
  upstairs(solids, scene.bigHouse);
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
  }

  // The camera's copy: a box for each block, and the floor under them all.
  const camera = new THREE.Group();
  const stuff = new THREE.MeshBasicMaterial();
  for (const b of [...solids.blocks, ...ceilings.blocks]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.y1 - b.y0, b.hz * 2), stuff);
    m.position.set(b.x, (b.y0 + b.y1) / 2, b.z);
    m.rotation.y = Math.atan2(b.sin, b.cos);
    camera.add(m);
  }
  for (const r of solids.rounds) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r.r, r.r, r.y1 - r.y0, 8), stuff);
    m.position.set(r.x, (r.y0 + r.y1) / 2, r.z);
    camera.add(m);
  }
  const floor = new THREE.Mesh(new THREE.BoxGeometry(80, 0.2, 80), stuff);
  floor.position.set(WALK_AREA.x, -0.1, WALK_AREA.z);
  camera.add(floor);
  camera.updateMatrixWorld(true);

  const doors: THREE.Object3D[] = [];
  scene.root.traverse((o) => {
    if (o.name === 'door') doors.push(o);
  });
  return { solids, camera, doors };
}

const hinge = new THREE.Vector3();

/**
 * Swings each door toward open while `who` stands near it, and shut again after, `dt` seconds
 * on; shut at once if `who` is null.
 */
export function swingDoors(doors: THREE.Object3D[], who: THREE.Vector3 | null, dt: number): void {
  for (const d of doors) {
    if (!who) {
      d.rotation.y = 0;
      continue;
    }
    d.getWorldPosition(hinge);
    const near =
      Math.hypot(hinge.x - who.x, hinge.z - who.z) < DOOR_OPEN.near &&
      Math.abs(hinge.y - (who.y + 1)) < 1.5;
    const target = near ? DOOR_OPEN.angle : 0;
    d.rotation.y += (target - d.rotation.y) * Math.min(1, dt * 6);
  }
}
