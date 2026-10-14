import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUTTON_SIZE, HOUSE, MAPS, boxesOverlap, houseLayout, levelSites } from '@sar/shared';
import type { BoxDef, LevelDef, PartPose } from '@sar/shared';

/**
 * Builds every model in the house and yard the way the view does, without a screen, and checks
 * that no two of them pass through each other (shut and with every hiding place open), and that
 * the models of things players bump into stay inside the boxes they bump into.
 */

beforeAll(() => {
  // Signs and screens are drawn on canvases: a stand-in that draws nothing will do.
  const ctx = new Proxy({}, { get: () => () => ({ addColorStop() {}, width: 100 }) });
  Object.assign(globalThis, {
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) },
  });
});

interface Part {
  owner: string;
  pose: PartPose;
  /** The box the owner collides as, if its model must stay inside it. */
  bound?: BoxDef;
}

/** A mesh's own bounding box placed in the world: an oriented box. */
function poseOf(mesh: THREE.Mesh): PartPose {
  const g = mesh.geometry;
  g.computeBoundingBox();
  const local = g.boundingBox!;
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  mesh.matrixWorld.decompose(pos, quat, scale);
  const centre = local.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
  const half = local.getSize(new THREE.Vector3()).multiply(scale).multiplyScalar(0.5);
  return {
    centre: { x: centre.x, y: centre.y, z: centre.z },
    half: { x: Math.abs(half.x), y: Math.abs(half.y), z: Math.abs(half.z) },
    rot: { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
  };
}

const FLAT = new Set(['PlaneGeometry', 'CircleGeometry']);

/** The solid, visible meshes under `obj`, each as an oriented box. */
function partsOf(owner: string, obj: THREE.Object3D, bound?: BoxDef): Part[] {
  obj.updateMatrixWorld(true);
  const out: Part[] = [];
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || FLAT.has(o.geometry.type)) return;
    for (let v: THREE.Object3D | null = o; v; v = v.parent) if (!v.visible) return;
    const m = o.material as THREE.Material;
    if (m.transparent || !m.colorWrite) return;
    // (A part marked `besideBox` is drawn beside its box on purpose, like a post's slot cheeks.)
    out.push({ owner, pose: poseOf(o), bound: o.userData.besideBox ? undefined : bound });
  });
  return out;
}

const where = (p: { x: number; y: number; z: number }) =>
  `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`;

async function modelsOf(level: LevelDef, open: boolean): Promise<Part[]> {
  const { isFence, makeFence, makeHandrail, makeProp } = await import('./props.ts');
  const { MachineView } = await import('./brickworks.ts');
  const { Furniture } = await import('./furniture.ts');
  const { addHouseDetails, cutWindows, windowOpenings } = await import('./details.ts');
  const { makeBell, makeCatapult, makeDoneButton } = await import('./stations.ts');
  const parts: Part[] = [];
  const openings = windowOpenings(level);
  for (const b of level.boxes) {
    const name = `${b.model ?? (isFence(b) ? 'fence' : 'wall')} at ${where(b.pos)}`;
    const prop = makeProp(b, level) ?? (isFence(b) ? makeFence(b) : null);
    if (prop) {
      parts.push(...partsOf(name, prop, b));
      continue;
    }
    for (const piece of cutWindows(b, openings)) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(piece.size.x, piece.size.y, piece.size.z));
      mesh.position.set(piece.pos.x, piece.pos.y, piece.pos.z);
      mesh.rotation.x = piece.tiltX ?? 0;
      parts.push(...partsOf(name, mesh));
    }
  }
  for (const s of level.stairs ?? [])
    parts.push(...partsOf(`handrail at ${where(s.pos)}`, makeHandrail(s)));
  const root = new THREE.Group();
  const furniture: [THREE.Object3D, string][] = [];
  const pieces = new Furniture(root, level, (o, what, at) =>
    furniture.push([o, at ? `${what} at ${where(at)}` : what]),
  );
  if (open) pieces.pose(1);
  root.updateMatrixWorld(true);
  for (const [o, name] of furniture) parts.push(...partsOf(name, o));
  const trim = new THREE.Group();
  addHouseDetails(trim, level);
  parts.push(...partsOf('trim', trim));
  for (const site of levelSites(level)) {
    const button = (at: { x: number; y: number; z: number }): BoxDef => ({
      pos: { x: at.x, y: at.y + BUTTON_SIZE.y / 2, z: at.z },
      size: BUTTON_SIZE,
      colour: 0,
    });
    parts.push(...partsOf('bell', makeBell(site.bell), button(site.bell)));
    parts.push(...partsOf('done button', makeDoneButton(site.doneButton), button(site.doneButton)));
  }
  if (level.catapult) parts.push(...partsOf('catapult', makeCatapult(level.catapult).group));
  for (const def of level.machines) {
    const view = new MachineView(def);
    view.update(
      {
        def,
        mould: '2x4',
        colour: 'red',
        shots: 5,
        part: null,
        jammed: false,
        fixer: null,
        progress: 0,
      },
      {},
    );
    const pos = { x: def.pos.x, y: def.pos.y + def.size.y / 2, z: def.pos.z };
    // Turned a quarter, it reaches as far along x as it is deep.
    const { x, y, z } = def.size;
    const size = Math.abs(Math.sin(def.facing)) > 0.5 ? { x: z, y, z: x } : def.size;
    parts.push(...partsOf(`${def.kind} #${def.id}`, view.group, { pos, size, colour: 0 }));
  }
  return parts;
}

/** Pairs of things that sit in or on each other by design. */
const TOGETHER: [RegExp, RegExp][] = [
  // Drawers slide into the counter they are set in.
  [/^counter/, /^drawer/],
  // The backrest stands on the back of the seat.
  [/^sofa /, /^sofaBack/],
  // The pillow sinks into the mattress.
  [/^bed/, /^cushion/],
  // A ceiling lamp's cord goes up into the ceiling.
  [/^lamp/, /^wall/],
  [/^lamp/, /^carriageRoof/],
  // Neighbouring pines' boughs mingle, as they do in a wood, and palms' fronds in a grove.
  [/^pine/, /^pine/],
  [/^palm/, /^palm/],
  // A lamp's cord goes up into the tie beam under a pitched roof.
  [/^lamp/, /^gableRoof/],
  // Rope fences meet at the island's corners, and the bridge's rope rails run on one into the
  // next, each slung from the next one's post.
  [/^ropeFence/, /^ropeFence/],
  [/^ropeRail/, /^ropeRail/],
  // A ship's cannon pokes its muzzle out through the gun port in the hull's bulwark.
  [/^cannon/, /^hull/],
];

const together = (a: string, b: string) =>
  TOGETHER.some(([x, y]) => (x.test(a) && y.test(b)) || (x.test(b) && y.test(a)));

function overlaps(parts: Part[]): string[] {
  const found = new Set<string>();
  // Sorted along x, so only parts whose spans along x meet are compared.
  const reach = (p: Part) => Math.hypot(p.pose.half.x, p.pose.half.y, p.pose.half.z);
  const sorted = [...parts].sort(
    (a, b) => a.pose.centre.x - reach(a) - (b.pose.centre.x - reach(b)),
  );
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    const end = a.pose.centre.x + reach(a);
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (b.pose.centre.x - reach(b) > end) break;
      if (a.owner === b.owner || together(a.owner, b.owner)) continue;
      if (boxesOverlap(a.pose, b.pose, 0.012)) found.add([a.owner, b.owner].sort().join(' and '));
    }
  }
  return [...found];
}

/** Models that reach outside their boxes on purpose, and how. */
const OUTSIDE: RegExp[] = [
  // A garden lamp's lantern and roof sit on top of its post.
  /^lampPost/,
  // The ramp stands on legs, and its box is tilted.
  /^ramp/,
  // Arms and cushions rise above the seat, cushions lean out from the backrest.
  /^sofa/,
  // The headboard rises above the bed against the wall.
  /^bed/,
  // The tap stands up from the worktop, which overhangs the doors.
  /^counter/,
  // The conduit runs up into the ceiling; the light and handle stand out of its door.
  /^panel/,
  // A pine's boughs spread far wider than its trunk, which is all it collides as.
  /^pine/,
  // A shutter's housing carries the guides down both sides of its bay.
  /^shutter/,
  // The forklift's mast and forks stand in their own collision boxes ahead of it.
  /^forklift/,
  // The engine's boiler, cab, chimney and buffers stand in their own collision boxes on it.
  /^locomotive/,
  // The wagon's wheels and frames hang under its body down to the rails, its headboard above.
  /^wagon/,
  // A palm's trunk leans out of its foot's box, and its fronds spread far wider.
  /^palm/,
  // A ship's bow sweeps out ahead of its hull's box, its bulwarks stand up round the deck.
  /^hull/,
  // A mast's yards and sails spread across the ship, a flagpole's flag flies out from it.
  /^mast/,
  /^flagpole/,
  // A rope rail's ropes run on up or down to the next length's post.
  /^ropeRail/,
];

function protrusions(parts: Part[]): string[] {
  const found = new Set<string>();
  for (const p of parts) {
    if (!p.bound || OUTSIDE.some((r) => r.test(p.owner))) continue;
    const b = p.bound;
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), b.tiltX ?? 0);
    const toBox = tilt.clone().invert();
    const rot = new THREE.Quaternion(p.pose.rot.x, p.pose.rot.y, p.pose.rot.z, p.pose.rot.w);
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1]) {
          const corner = new THREE.Vector3(
            sx * p.pose.half.x,
            sy * p.pose.half.y,
            sz * p.pose.half.z,
          )
            .applyQuaternion(rot)
            .add(new THREE.Vector3(p.pose.centre.x, p.pose.centre.y, p.pose.centre.z))
            .sub(new THREE.Vector3(b.pos.x, b.pos.y, b.pos.z))
            .applyQuaternion(toBox);
          // A tread's nose, a rim or a cap may lip over by a couple of centimetres.
          const tol = 0.03;
          if (
            Math.abs(corner.x) > b.size.x / 2 + tol ||
            Math.abs(corner.y) > b.size.y / 2 + tol ||
            Math.abs(corner.z) > b.size.z / 2 + tol
          )
            found.add(p.owner);
        }
  }
  return [...found];
}

const LEVELS: [string, () => LevelDef][] = [
  ['the hand-made house', () => HOUSE],
  ...[11, 222, 3333, 44444, 98765, 7, 2024, 31337, 500000, 1234567].map(
    (seed) =>
      [`the house furnished for seed ${seed}`, () => houseLayout(seed)] as [string, () => LevelDef],
  ),
  ...MAPS.filter((m) => m.id !== 'house').flatMap((m) =>
    [1, 7, 2024, 31337].map(
      (seed) =>
        [`${m.name} laid out for seed ${seed}`, () => m.layout(seed)] as [string, () => LevelDef],
    ),
  ),
];

describe('the house and yard models', () => {
  it.each(LEVELS)('never pass through each other in %s', { timeout: 60000 }, async (_, level) => {
    const shut = await modelsOf(level(), false);
    expect(overlaps(shut), 'shut').toEqual([]);
    expect(protrusions(shut)).toEqual([]);
    const open = await modelsOf(level(), true);
    expect(overlaps(open), 'every hiding place open').toEqual([]);
  });

  it('notice two things in one place', async () => {
    const level = HOUSE;
    // The yard table moved onto the crates beside it.
    const table = level.boxes.find((b) => b.model === 'table')!;
    const crate = level.boxes.find((b) => b.model === 'crate')!;
    const moved = {
      ...level,
      boxes: level.boxes.map((b) =>
        b === table ? { ...b, pos: { ...crate.pos, y: table.pos.y } } : b,
      ),
    };
    expect((await modelsOf(moved, false)).length).toBeGreaterThan(100);
    expect(
      overlaps(await modelsOf(moved, false)).some((o) => /crate/.test(o) && /table/.test(o)),
    ).toBe(true);
  });
});
