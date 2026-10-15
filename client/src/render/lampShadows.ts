import * as THREE from 'three';
import { UPPER_FLOOR, stairsPlan } from '@sar/shared';
import type { FloorRect, LevelDef } from '@sar/shared';
import { LAMP_LIT, atNight, tagged } from './daynight.ts';
import { LAMP_REACH, POOL_SIZE, cutOut, lampRoom } from './furniture.ts';
import { FLOOR_LAYERS } from './layers.ts';
import { TERRAIN } from './terrain.ts';

/** Texels per metre of the shadow drawn on each lamp-lit floor. */
const PPM = 48;
/** How dark a shadow is where the lamp is fully blocked. */
const STRENGTH = 0.35;
/** At night the lamps' own lights cast real shadows, so the baked ones step aside. */
const NIGHT_STRENGTH = 0;
/** Soft edge of a shadow right at the floor, in metres. */
const SOFTNESS = 0.03;
/** Radius of the lamp's glowing diffuser: the higher a thing is, the softer its shadow. */
const DIFFUSER = 0.28;
/** Things this flat cast nothing worth drawing (rugs, baseboards' tops, decals). */
const MIN_TOP = 0.06;
/** A shadow stretches at most this many times as far from the lamp as the thing casting it. */
const MAX_STRETCH = 4;

type Point = [number, number];

/** Convex hull (monotone chain), counter-clockwise. */
function hull(points: Point[]): Point[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Point, a: Point, b: Point) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Point[] = [];
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * Soft shadows the ceiling lamps throw on the floor under the furniture, worked out once from
 * where everything stands when the level is built and drawn as one see-through layer per room.
 * Each solid thing in a lamp's room is boxed, the box's corners are cast from the lamp down to
 * the floor, and the outline of those points is painted dark and blurred.
 *
 * The layer covers the lamp's reach of its room's floor, less any stairwell in it: a railing's
 * shadow painted over the well would hang in the air above the flight below. Only what stands in
 * the room casts: in a room smaller than the reach (a caravan, a station office), things outside
 * cast through the walls, and the layer spread their shadows over the ground outside.
 *
 * The warm pool each lamp throws on its floor (`pools`, one per lamp in the order of the
 * level's `lights`) is cut by the same shadows.
 *
 * Call it whenever the level is built, after the furniture is placed and before `mergeStatic`
 * bakes the furniture into a few big meshes (whose boxes would cover whole rooms). Returns the
 * layers, to add to the scene, and what frees the pictures painted for them.
 */
export function bakeLampShadows(
  root: THREE.Object3D,
  level: LevelDef,
  pools: readonly THREE.Mesh[],
): { group: THREE.Group; dispose(): void } {
  root.updateMatrixWorld(true);
  const group = new THREE.Group();
  const painted: THREE.Texture[] = [];
  const box = new THREE.Box3();
  const meshes: THREE.Box3[] = [];
  root.traverse((o) => {
    // (Nor the ground, where it rises and falls: it is what the shadows lie on.)
    if (!(o instanceof THREE.Mesh) || !o.visible || !o.castShadow || o.userData[TERRAIN]) return;
    const m = o.material as THREE.Material;
    if (m.transparent || !m.colorWrite) return;
    meshes.push(box.setFromObject(o).clone());
  });

  // The stairwells, each on the floor its flight comes out on.
  const wells = (level.stairs ?? []).map((s) => ({
    ...stairsPlan(s).well,
    y: s.pos.y + UPPER_FLOOR,
  }));

  for (const [i, lamp] of level.lights.entries()) {
    // Heights from here on are above the floor of the lamp's room, downstairs or up.
    const room = lampRoom(level, lamp);
    const floorY = room.y;
    const r = room.rect;
    const lampY = lamp.y - floorY;
    // Each shadow: its outline on the floor (world x, z) and how soft its edge is.
    const shadows: { outline: Point[]; blur: number }[] = [];
    for (const b0 of meshes) {
      const b = {
        min: b0.min.clone().setY(b0.min.y - floorY),
        max: b0.max.clone().setY(b0.max.y - floorY),
      };
      // In this lamp's room, standing on its floor below the lamp, and tall enough to matter.
      if (b.min.y < -0.05 || b.max.y < MIN_TOP || b.max.y >= lampY - 0.05 || b.min.y > lampY)
        continue;
      const cx = (b.min.x + b.max.x) / 2;
      const cz = (b.min.z + b.max.z) / 2;
      if (Math.abs(cx - lamp.x) > LAMP_REACH.x || Math.abs(cz - lamp.z) > LAMP_REACH.z) continue;
      if (r && (cx < r.x0 || cx > r.x1 || cz < r.z0 || cz > r.z1)) continue;
      const points: Point[] = [];
      for (const x of [b.min.x, b.max.x])
        for (const y of [b.min.y, b.max.y])
          for (const z of [b.min.z, b.max.z]) {
            const k = Math.min(lampY / (lampY - y), MAX_STRETCH);
            points.push([lamp.x + (x - lamp.x) * k, lamp.z + (z - lamp.z) * k]);
          }
      shadows.push({
        outline: hull(points),
        blur: SOFTNESS + (DIFFUSER * b.min.y) / (lampY - b.min.y),
      });
    }
    if (!shadows.length) continue;

    /** The shadows painted over a w by d patch of floor centred on the lamp. */
    const paint = (w: number, d: number, light: string, dark: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(w * PPM);
      canvas.height = Math.ceil(d * PPM);
      // Drawn once on the CPU: a GPU-backed 2D canvas kept the browser's GPU busier every frame.
      const g = canvas.getContext('2d', { willReadFrequently: true })!;
      g.fillStyle = light;
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = dark;
      const left = lamp.x - w / 2;
      const far = lamp.z - d / 2;
      for (const { outline, blur } of shadows) {
        // Canvas blur takes a standard deviation, about half the visible spread.
        g.filter = `blur(${(blur * PPM) / 2}px)`;
        g.beginPath();
        for (const [i, [x, z]] of outline.entries()) {
          if (i) g.lineTo((x - left) * PPM, (z - far) * PPM);
          else g.moveTo((x - left) * PPM, (z - far) * PPM);
        }
        g.closePath();
        g.fill();
      }
      const texture = new THREE.CanvasTexture(canvas);
      painted.push(texture);
      return texture;
    };

    // A dark layer over the room's floor. Its alpha map reads brightness: white is full shadow.
    const w = LAMP_REACH.x * 2;
    const d = LAMP_REACH.z * 2;
    const x0 = lamp.x - w / 2;
    const z0 = lamp.z - d / 2;
    const material = tagged(
      atNight(
        new THREE.MeshBasicMaterial({
          color: 0x000000,
          alphaMap: paint(w, d, '#000', '#fff'),
          transparent: true,
          opacity: STRENGTH,
          depthWrite: false,
        }),
        NIGHT_STRENGTH,
      ),
      LAMP_LIT,
    );
    // In pieces round any stairwell on this floor, each showing its part of the one painting.
    const reach: FloorRect = {
      x0: Math.max(x0, r?.x0 ?? -Infinity),
      x1: Math.min(x0 + w, r?.x1 ?? Infinity),
      z0: Math.max(z0, r?.z0 ?? -Infinity),
      z1: Math.min(z0 + d, r?.z1 ?? Infinity),
    };
    const pieces = wells.filter((q) => Math.abs(q.y - floorY) < 0.01).reduce(cutOut, [reach]);
    for (const q of pieces) {
      const geometry = new THREE.PlaneGeometry(q.x1 - q.x0, q.z1 - q.z0);
      const uv = geometry.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) {
        // The plane is laid flat, so its top edge (v = 1) is its far edge, where z is least.
        const u = (q.x0 + uv.getX(i) * (q.x1 - q.x0) - x0) / w;
        const v = 1 - (q.z1 - uv.getY(i) * (q.z1 - q.z0) - z0) / d;
        uv.setXY(i, u, v);
      }
      const floor = new THREE.Mesh(geometry, material);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set((q.x0 + q.x1) / 2, floorY + FLOOR_LAYERS.lampShadows, (q.z0 + q.z1) / 2);
      // Drawn after the lamp's warm pool, over it. Both are see-through and write no depth, so
      // left to themselves they are drawn farthest first, and the two (centred alike under the
      // lamp) would swap places as the camera moves: where a shadow's soft edge meets the
      // pool, the floor would brighten and darken by turns.
      floor.renderOrder = 1;
      group.add(floor);
    }

    // The warm pool is the lamp's own light, so a shadow blocks all of it, not just a share.
    // Painted for the whole square: the pool's piece of it, cut to the room, shows its part.
    const pool = pools[i]!.material as THREE.MeshBasicMaterial;
    pool.alphaMap = paint(POOL_SIZE, POOL_SIZE, '#fff', '#000');
    pool.needsUpdate = true;
  }
  return {
    group,
    dispose: () => {
      for (const t of painted) t.dispose();
    },
  };
}
