import * as THREE from 'three';
import type { LevelDef } from '@sar/shared';
import { LAMP_LIT, atNight, tagged } from './daynight.ts';
import { LAMP_POOL, LAMP_REACH } from './furniture.ts';

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
 * Call it whenever the level is built, after the furniture is placed and before `mergeStatic`
 * bakes the furniture into a few big meshes (whose boxes would cover whole rooms).
 */
export function bakeLampShadows(root: THREE.Object3D, level: LevelDef): THREE.Group {
  root.updateMatrixWorld(true);
  const group = new THREE.Group();
  const box = new THREE.Box3();
  const meshes: THREE.Box3[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.visible || !o.castShadow) return;
    const m = o.material as THREE.Material;
    if (m.transparent || !m.colorWrite) return;
    meshes.push(box.setFromObject(o).clone());
  });

  const pools: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.userData[LAMP_POOL]) pools.push(o);
  });
  const centre = new THREE.Vector3();

  for (const lamp of level.lights) {
    // Each shadow: its outline on the floor (world x, z) and how soft its edge is.
    const shadows: { outline: Point[]; blur: number }[] = [];
    for (const b of meshes) {
      // In this lamp's room, standing below the lamp, and tall enough to matter.
      if (b.max.y < MIN_TOP || b.max.y >= lamp.y - 0.05 || b.min.y > lamp.y) continue;
      const cx = (b.min.x + b.max.x) / 2;
      const cz = (b.min.z + b.max.z) / 2;
      if (Math.abs(cx - lamp.x) > LAMP_REACH.x || Math.abs(cz - lamp.z) > LAMP_REACH.z) continue;
      const points: Point[] = [];
      for (const x of [b.min.x, b.max.x])
        for (const y of [b.min.y, b.max.y])
          for (const z of [b.min.z, b.max.z]) {
            const k = Math.min(lamp.y / (lamp.y - y), MAX_STRETCH);
            points.push([lamp.x + (x - lamp.x) * k, lamp.z + (z - lamp.z) * k]);
          }
      shadows.push({
        outline: hull(points),
        blur: SOFTNESS + (DIFFUSER * b.min.y) / (lamp.y - b.min.y),
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
      const x0 = lamp.x - w / 2;
      const z0 = lamp.z - d / 2;
      for (const { outline, blur } of shadows) {
        // Canvas blur takes a standard deviation, about half the visible spread.
        g.filter = `blur(${(blur * PPM) / 2}px)`;
        g.beginPath();
        for (const [i, [x, z]] of outline.entries()) {
          if (i) g.lineTo((x - x0) * PPM, (z - z0) * PPM);
          else g.moveTo((x - x0) * PPM, (z - z0) * PPM);
        }
        g.closePath();
        g.fill();
      }
      return new THREE.CanvasTexture(canvas);
    };

    // A dark layer over the room's floor. Its alpha map reads brightness: white is full shadow.
    const w = LAMP_REACH.x * 2;
    const d = LAMP_REACH.z * 2;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      tagged(
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
      ),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(lamp.x, 0.006, lamp.z);
    // Over the lamp's warm pool on the floor, which is drawn first.
    floor.renderOrder = 1;
    group.add(floor);

    // The warm pool is the lamp's own light, so a shadow blocks all of it, not just a share.
    const pool = pools.find((p) => {
      p.getWorldPosition(centre);
      return Math.hypot(centre.x - lamp.x, centre.z - lamp.z) < 0.01;
    });
    if (pool && pool.geometry instanceof THREE.PlaneGeometry) {
      const { width, height } = pool.geometry.parameters;
      (pool.material as THREE.MeshBasicMaterial).alphaMap = paint(width, height, '#fff', '#000');
      (pool.material as THREE.MeshBasicMaterial).needsUpdate = true;
    }
  }
  return group;
}
