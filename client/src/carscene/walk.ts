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
import {
  BENCHES,
  BUS_BACK_DOOR,
  BUS_BODY,
  BUS_CABIN,
  BUS_DOOR,
  BUS_WHEELS,
  DASH,
  DRIVER,
  DRIVER_Z,
} from './bus.ts';
import { CONE } from './cone.ts';
import { MOVING } from './gadgets.ts';
import { HOUSE_BODY, HOUSE_DOOR, HOUSE_LETTERBOX } from './house.ts';
import { MACHINE_MODELS } from './machines.ts';
import { intangible } from './meshWalk.ts';
import type { CarScene } from './scene.ts';
import { STREET } from './street.ts';

/**
 * What the following camera keeps out of on the car test map, worked out from the scene as it is
 * built: the cars and the machines to their bounds, the cones round their feet, the houses' walls (with their doorways open), floors, furniture and ceilings, the big
 * house's stair and upper floor, and the bus's sides round its cabin: what is solid right through,
 * which the camera is not to sit inside. The player walks against the models themselves (see
 * `MeshWalker`), and the camera keeps clear of their triangles too (see `followCamera`); this
 * coarse copy keeps it out of a car rather than finding its way in under its mirrors. And the
 * houses' sliding doors.
 */

/**
 * Where the player starts: on the near pavement past the railings' end, the street open before
 * them and the big house across it, the bus clear of the camera behind.
 */
export const START = { x: 3.0, z: -12.3, heading: 0.2 };

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
 * The big house's stair: its treads, and its rail along its open side. And its upper floor round
 * the well.
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

/**
 * The bus: its floor (up its steps at the door and its tail's step and bumper), its sides and
 * tail round it, its doors shut, its benches, the driver's seat and dashboard; and its roof, and
 * its front and wheels to their bounds, in `camera`.
 */
function bus(solids: Solids, camera: Solids, frame: THREE.Object3D): void {
  const { rear, cowl, half, roof } = BUS_BODY;
  const { floor, inner, tail, front, ceiling } = BUS_CABIN;
  const len = cowl - rear;
  const midX = (rear + cowl) / 2;
  const wall = half - inner;
  const side = (s: number) => (s * (inner + half)) / 2;
  // The floor, but over the steps inside the door.
  const { x0, x1, top, steps, stair, well } = BUS_DOOR;
  solids.box(frame, (rear + x0) / 2, 0, 0, x0 - rear, floor, half * 2);
  solids.box(frame, (x1 + cowl) / 2, 0, 0, cowl - x1, floor, half * 2);
  solids.box(frame, (x0 + x1) / 2, 0, (well - half) / 2, x1 - x0, floor, well + half);
  camera.box(frame, midX, ceiling, 0, len, roof + 0.3 - ceiling, half * 2);
  const nose = BUS_BODY.front + 0.3;
  camera.box(frame, (front + nose) / 2, 0, 0, nose - front, roof, (half + 0.35) * 2);
  for (const s of [-1, 1]) camera.box(frame, BUS_WHEELS.rear, 0, s * (half + 0.25), 1.5, 1.3, 0.5);
  // The sides, the right one either side of its doorway; the tail's wall either side of its own.
  solids.box(frame, midX, floor, side(-1), len, roof - floor, wall);
  solids.box(frame, (rear + x0) / 2, floor, side(1), x0 - rear, roof - floor, wall);
  solids.box(frame, (x1 + cowl) / 2, floor, side(1), cowl - x1, roof - floor, wall);
  const dh = BUS_BACK_DOOR.half;
  for (const s of [-1, 1])
    solids.box(
      frame,
      rear + tail / 2,
      floor,
      (s * (inner + dh)) / 2,
      tail,
      roof - floor,
      inner - dh,
    );
  // The steps inside the door, and the tail's step plate and bumper (stood on a little under its
  // top, a step up from the plate).
  const mid = (x0 + x1) / 2;
  solids.box(frame, mid, 0, (well + stair) / 2, x1 - x0, steps[1]!, stair - well);
  solids.box(frame, mid, 0, (stair + half + 0.02) / 2, x1 - x0, steps[0]!, half + 0.02 - stair);
  solids.box(frame, rear - 0.16, 0.14, 0, 0.44, 0.14, dh * 2 + 0.1);
  solids.box(frame, rear - 0.04, 0.28, 0, 0.2, 0.34, dh * 2 + 0.12);
  solids.box(frame, rear - 0.08, 0.45, 0, 0.28, 0.3, (half + 0.03) * 2);
  // Inside: the benches down each side, the panel before the first on the door's side, the
  // driver's seat, the dashboard across the front and the heater's box under it.
  const bench = 0.5;
  const z = inner - bench / 2;
  for (let k = 0; k < 6; k++)
    for (const s of [-1, 1])
      if (k > 0 || s < 0)
        solids.box(frame, BENCHES - k * 0.86 - 0.08, floor, s * z, 0.62, 1.0, bench);
  solids.box(frame, x0 - 0.06, floor, z, 0.06, 0.72, bench);
  solids.box(frame, DRIVER, floor, DRIVER_Z, 0.6, 1.3, 0.56);
  solids.box(
    frame,
    (DASH.back + DASH.front) / 2,
    floor,
    0,
    DASH.front - DASH.back,
    0.75,
    inner * 2,
  );
  solids.box(frame, DASH.back + 0.02, floor, -0.07, 0.3, 0.38, 0.36);
  // The door's leaf down to the lower step, just in from the side.
  const foot = steps[0]!;
  solids.box(frame, mid, foot, half - 0.04, x1 - x0, top - foot, 0.08);
  solids.box(frame, rear + tail / 2, floor, 0, tail, BUS_BACK_DOOR.top - floor, dh * 2);
}

/** A part of a prop as it stands: its bounds and its triangles (nine numbers each), in the world. */
export interface PropPart {
  box: THREE.Box3;
  triangles: Float32Array;
}

function propPart(mesh: THREE.Mesh): PropPart {
  const pos = mesh.geometry.attributes.position!;
  const index = mesh.geometry.index;
  const count = index ? index.count : pos.count;
  const triangles = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
    v.toArray(triangles, i * 3);
  }
  return { box: new THREE.Box3().setFromObject(mesh), triangles };
}

/**
 * Whether `p` is inside `part`: the line straight up from it and the line straight down from it
 * each go through its surface an odd number of times. (A sheet over or under `p` is crossed by
 * only one of them.)
 */
export function insidePart(part: PropPart, p: THREE.Vector3): boolean {
  if (!part.box.containsPoint(p)) return false;
  const t = part.triangles;
  let [up, down] = [0, 0];
  for (let i = 0; i + 8 < t.length; i += 9) {
    const [ax, az, bx, bz, cx, cz] = [t[i]!, t[i + 2]!, t[i + 3]!, t[i + 5]!, t[i + 6]!, t[i + 8]!];
    // Where (p.x, p.z) is in the triangle seen from above, as weights on its corners.
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-12) continue;
    const wa = ((bz - cz) * (p.x - cx) + (cx - bx) * (p.z - cz)) / det;
    const wb = ((cz - az) * (p.x - cx) + (ax - cx) * (p.z - cz)) / det;
    const wc = 1 - wa - wb;
    if (wa < 0 || wb < 0 || wc < 0) continue;
    const y = wa * t[i + 1]! + wb * t[i + 4]! + wc * t[i + 7]!;
    if (y > p.y) up++;
    else down++;
  }
  return up % 2 === 1 && down % 2 === 1;
}

export interface CarWalk {
  /**
   * Boxes the camera keeps out of: everything solid (the modelled things to their bounds) and
   * the houses' ceilings.
   */
  camera: THREE.Group;
  /** The parts of the street's furniture and the site's fittings, for the camera to keep out of. */
  props: PropPart[];
  /** The houses' doors, each sliding along its own x (see `slideDoors`). */
  doors: THREE.Object3D[];
  /** Inside each house, a box in its own axes: the camera stays in it while the player is. */
  rooms: { frame: THREE.Object3D; box: THREE.Box3 }[];
}

export function carWalk(scene: CarScene): CarWalk {
  scene.root.updateMatrixWorld(true);
  const solids = new Solids();
  // The houses' shells, and the modelled things to their bounds.
  const shells = new Solids();

  for (const v of [scene.car, scene.sports]) {
    block(shells, v.root, boxIn(v.root, v.root));
  }
  bus(solids, shells, scene.bus.root);
  // The cones: upright, round their foot; knocked over, to their bounds.
  for (const c of scene.cones) {
    if (c.name === 'cone')
      solids.post(
        scene.root,
        c.position.x,
        c.position.z,
        CONE.foot * c.scale.x,
        0,
        CONE.height * c.scale.y,
      );
    else block(shells, c, boxIn(c, c));
  }
  // The job site's and the inspector's pads, a step up as the brick works' are.
  const fittings = scene.site.children.flatMap((s) => s.children);
  for (const m of fittings) if (m.name === 'pad') block(solids, scene.root, boxIn(m, scene.root));
  // The brick works: each machine's pad a step up, and each machine to its bounds.
  for (const m of scene.machines.children) {
    if (m.name === 'pad') block(solids, m, boxIn(m, m));
    else if (MACHINE_MODELS[m.name as keyof typeof MACHINE_MODELS]) block(shells, m, boxIn(m, m));
  }

  house(
    solids,
    shells,
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
    shells,
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

  // The pavements, kerb to back.
  const { x0, x1, north, south, pavement } = STREET;
  solids.box(scene.root, (x0 + x1) / 2, 0, north + pavement / 2, x1 - x0, 0.15, pavement);
  solids.box(scene.root, (x0 + x1) / 2, 0, south - pavement / 2, x1 - x0, 0.15, pavement);
  // The street's furniture and the site's fittings, part by part as they are drawn: the camera
  // stays out behind a lamp or the inspector's arch, and comes in only where it would be in one.
  // What opens or swings (a lid, a cupboard's door) it keeps out of only by the walker's
  // triangles, which go with it.
  const props: PropPart[] = [];
  const take = (o: THREE.Object3D) => {
    if (o.name === MOVING) return;
    if ((o as THREE.Mesh).isMesh && !intangible(o)) props.push(propPart(o as THREE.Mesh));
    o.children.forEach(take);
  };
  for (const prop of [...scene.street.children, ...fittings]) if (prop.name === 'prop') take(prop);

  // The camera's copy: a box for each block (the floor it keeps above on its own).
  const camera = new THREE.Group();
  const stuff = new THREE.MeshBasicMaterial();
  for (const b of [...solids.blocks, ...shells.blocks]) {
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
  camera.updateMatrixWorld(true);

  const doors: THREE.Object3D[] = [];
  scene.root.traverse((o) => {
    if (o.name === 'door') doors.push(o);
  });
  // The rooms: inside its walls, from its floor to its ceiling, in each house's own axes; and
  // inside the bus.
  const { rear } = BUS_BODY;
  const { floor, inner, tail, front, ceiling } = BUS_CABIN;
  const cabin = {
    frame: scene.bus.root as THREE.Object3D,
    box: new THREE.Box3(
      new THREE.Vector3(rear + tail, floor, -inner),
      new THREE.Vector3(front, ceiling, inner),
    ),
  };
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
  return { camera, props, doors, rooms: [...rooms, cabin] };
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
