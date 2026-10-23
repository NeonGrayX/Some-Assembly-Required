import * as THREE from 'three';
import type { BrickTypeId, ColourId, Made, Tool } from '@sar/shared';
import { brickGeometry, brickMaterial } from './bricks.ts';
import { add, mat, metal } from './interiors.ts';
import { mouldTop, posedInMould } from './mouldCavity.ts';
import type { MouldTop } from './mouldCavity.ts';
import { BUCKET, HATCH_MOULD } from './operate.ts';
import { block, cached, canGeo, lyingPart, pelletTop, rng, upright } from './machineParts.ts';

/**
 * The brick works' things players carry: the moulds, the pellet buckets (and the pellets that
 * pour into and out of them), the tools held in hand, and what a machine makes as it lies in
 * its output area.
 */

const mouldSteel = metal(0x8c949b);
const mouldSteelLight = metal(0xa9b0b7);
const mouldDark = mat(0x2b2f33, 0.6, 0.4);
const pinSteel = metal(0xd5dade);
/** The cavity's walls and floor: polished, and darker than the face round it, so it reads as a hole. */
const polished = mat(0x6c757d, 0.25, 0.6);
const brass = mat(0xc9a14a, 0.35, 0.6);

/** A mould block's size, as on the dispenser's shelves and clamped in the moulding machine. */
export const MOULD_SIZE = { x: 0.4, y: 0.2, z: 0.4 };

/** How wide the steel round a mould's cavity is, at least. */
const MOULD_RIM = 0.065;

/** Each part's mould's upper half, made once: its face and its cavity. */
const mouldTops = new Map<BrickTypeId, MouldTop>();

/**
 * The upper half of a mould for `type`, `height` thick: a steel slab with the part's shape sunk
 * in its top, as big as fits with a rim round it and steel left under it.
 */
function mouldTopFor(type: BrickTypeId, height: number): MouldTop {
  let top = mouldTops.get(type);
  if (top) return top;
  const { x: W, z: D } = MOULD_SIZE;
  const room = W - 2 * MOULD_RIM;
  const posed = posedInMould(brickGeometry(type), room, height - 0.02, room);
  top = mouldTop(posed, W, D, height);
  posed.dispose();
  mouldTops.set(type, top);
  return top;
}

/**
 * A mould block in its own frame: the centre of its bottom at the origin, `MOULD_SIZE`, its
 * cavity face up (+y) and its front +z. Two halves with a parting line between them, guide
 * pins at the corners, a sprue bush at the back and the part's shape sunk into the top as its
 * cavity, dark against the face, so the moulds can be told apart from a little way off.
 */
export function mouldBlock(type: BrickTypeId): THREE.Group {
  const g = new THREE.Group();
  const { x: W, y: H, z: D } = MOULD_SIZE;
  const lower = H * 0.44;
  const gap = 0.006;
  const top = H - 0.015;
  const rim = 0.05;
  // Ground steel, square-edged like the upper half, the parting line between them.
  block(g, W, lower, D, 0, lower / 2, 0, mouldSteel, 0);
  block(g, W - 0.016, gap, D - 0.016, 0, lower + gap / 2, 0, mouldDark);
  const y0 = lower + gap;
  // The upper half, the cavity sunk in it.
  const { face, cavity } = mouldTopFor(type, top - y0);
  add(g, face, mouldSteelLight, 0, top, 0);
  add(g, cavity, polished, 0, top, 0);
  // Guide pins at the corners, up to the top of its box.
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      add(
        g,
        canGeo(0.012, H - top, 10),
        pinSteel,
        sx * (W / 2 - rim / 2),
        (top + H) / 2,
        sz * (D / 2 - rim / 2),
      );
  // The sprue bush the plastic goes in by, on the back rim.
  upright(g, 0.02, 0.02, top, top + 0.005, 0, -D / 2 + rim / 2, pinSteel, 12);
  upright(g, 0.009, 0.009, top + 0.002, top + 0.006, 0, -D / 2 + rim / 2, mouldDark, 10);
  // A brass maker's plate on the front.
  block(g, W * 0.4, lower * 0.4, 0.003, 0, lower / 2, D / 2 + 0.0015, brass);
  return g;
}

/** How high a full bucket's pellets come, up its inside. */
const BUCKET_FULL = BUCKET.height * 0.82;
/** How wide the pellets in a bucket are `y` up its inside, where it is that wide. */
const pelletsWide = (y: number) =>
  BUCKET.bottom + ((BUCKET.top - BUCKET.bottom) * y) / BUCKET.height - 0.004;
const bucketPlastic = new THREE.MeshStandardMaterial({
  color: 0xf2f2ee,
  roughness: 0.55,
  side: THREE.DoubleSide,
});
/** Its bottom is solid, so it is drawn from outside alone, to stand flat on a grate. */
const bucketBase = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.55 });

/** How far a bucket's handle lies back from upright, at rest. */
export const HANDLE_BACK = -0.6;

/**
 * A plastic pail with a wire handle, its bottom centre at the origin, filled most of the way
 * with `colour` pellets, or empty.
 */
export function bucket(colour: ColourId | null): THREE.Group {
  const g = new THREE.Group();
  const { height: h, bottom, top } = BUCKET;
  upright(g, bottom, top, 0.008, h, 0, 0, bucketPlastic, 24, true);
  upright(g, bottom, bottom, 0, 0.008, 0, 0, bucketBase, 24);
  const rim = add(
    g,
    cached('bucketRim', () => new THREE.TorusGeometry(top, 0.007, 6, 28)),
    bucketPlastic,
    0,
    h,
    0,
  );
  rim.rotation.x = Math.PI / 2;
  // Lugs on the sides, and the handle lying back from them.
  const wire = metal(0x9aa1a8);
  for (const s of [-1, 1])
    block(g, 0.012, 0.03, 0.02, s * (top - 0.004), h - 0.04, 0, bucketPlastic);
  const handle = add(
    g,
    cached('bucketHandle', () => new THREE.TorusGeometry(top + 0.008, 0.004, 5, 20, Math.PI)),
    wire,
    0,
    h - 0.04,
    0,
  );
  handle.rotation.x = HANDLE_BACK;
  handle.name = 'handle';
  if (colour) pelletTop(g, pelletsWide(BUCKET_FULL), BUCKET_FULL, colour);
  return g;
}

/**
 * What a player carries in both hands: a mould, a little smaller than in a machine, or a
 * bucket of pellets. Its origin is its middle; a new model every call.
 */
export function makeHeldTool(tool: Tool): THREE.Group {
  const g = new THREE.Group();
  if (tool.kind === 'mould') {
    const k = 0.3 / MOULD_SIZE.x;
    const m = mouldBlock(tool.type);
    m.scale.setScalar(k);
    m.position.y = (-MOULD_SIZE.y * k) / 2;
    g.add(m);
  } else {
    const b = bucket(tool.colour);
    b.position.y = -BUCKET.height / 2;
    g.add(b);
  }
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  return g;
}

const BEAD = 0.012;
const beadGeo = () => cached('bead', () => new THREE.SphereGeometry(BEAD, 6, 4));

/**
 * Pellets of `colour` falling from `from` down to `bottom`, in `group`. The function it gives
 * back poses them `t` seconds in, or hides them for `null`.
 */
export function pelletStream(
  group: THREE.Object3D,
  colour: ColourId,
  from: THREE.Vector3,
  bottom: number,
): (t: number | null) => void {
  const plastic = brickMaterial(colour);
  const rand = rng(11);
  const beads = Array.from({ length: 18 }, () => {
    const m = new THREE.Mesh(beadGeo(), plastic);
    m.userData.dx = (rand() - 0.5) * 0.03;
    m.userData.dz = (rand() - 0.5) * 0.03;
    m.userData.phase = rand();
    group.add(m);
    return m;
  });
  const drop = from.y - bottom;
  return (t) => {
    for (const b of beads) {
      b.visible = t !== null;
      if (t === null) continue;
      const f = (t * 2.2 + (b.userData.phase as number)) % 1;
      b.position.set(
        from.x + (b.userData.dx as number) * f,
        from.y - f * f * drop,
        from.z + (b.userData.dz as number) * f,
      );
    }
  };
}

/**
 * Pellets of `colour` in an empty bucket, filled to `level` (0 to 1) by the function given
 * back. Full, it looks just as a bucket made full (see `bucket`).
 */
export function pelletFill(pail: THREE.Object3D, colour: ColourId): (level: number) => void {
  const r = BUCKET.bottom - 0.004;
  const column = upright(pail, r, r, 0, 1, 0, 0, brickMaterial(colour), 20);
  // The top of them as a full bucket's, as wide as the bucket is at the level they are up to.
  const top = pelletTop(pail, pelletsWide(BUCKET_FULL), BUCKET_FULL, colour);
  return (level) => {
    const y = 0.01 + level * (BUCKET_FULL - 0.01);
    // (Full, the column is out of sight under the top.)
    column.visible = level > 0 && level < 1;
    top.visible = level > 0;
    column.scale.y = y - 0.01;
    column.position.y = (y - 0.01) / 2;
    top.position.y = y;
    top.scale.x = top.scale.z = pelletsWide(y) / pelletsWide(BUCKET_FULL);
  };
}

/** What a machine made as it lies in its output area, its origin the middle of its bottom. */
export function madeModel(made: Made): THREE.Object3D {
  if (made.kind === 'bucket') return bucket(made.colour);
  if (made.kind === 'part') return lyingPart(made.type, made.colour);
  const mould = mouldBlock(made.type);
  mould.scale.setScalar(HATCH_MOULD);
  return mould;
}
