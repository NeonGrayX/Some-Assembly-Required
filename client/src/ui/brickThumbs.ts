import * as THREE from 'three';
import type { BrickTypeId, ColourId } from '@sar/shared';
import { brickGeometry, brickMaterial } from '../render/bricks.ts';

/**
 * Small pictures of bricks for pickers: one brick type in one colour, seen from the front corner.
 * Drawn with the game's own brick geometry and materials, so they look like the bricks in play
 * (colour goggles and graphics styles included) once redrawn.
 */

/** The direction the camera looks from: the front right corner, a little above. */
export const CORNER = new THREE.Vector3(1, 0.8, 1.3);

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let mesh: THREE.Mesh;
let edges: THREE.LineSegments;
const edgeCache = new Map<BrickTypeId, THREE.EdgesGeometry>();
const cache = new Map<string, string>();

/**
 * Lights a brick scene from above and below, so the hollow underside reads as well as the studs.
 * Shared with the brick viewer, so its big preview and these pictures are lit alike.
 */
export function addBrickLights(s: THREE.Scene): void {
  s.add(new THREE.HemisphereLight(0xffffff, 0x9a948a, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(3, 6, 4);
  s.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6);
  fill.position.set(-3, -4, -2);
  s.add(fill);
}

/** Outlines on the creases of a brick, so studs, walls and tubes stand apart from any side. */
export function brickEdges(type: BrickTypeId): THREE.EdgesGeometry {
  let e = edgeCache.get(type);
  if (!e) edgeCache.set(type, (e = new THREE.EdgesGeometry(brickGeometry(type), 25)));
  return e;
}

/** Centres `m` on its whole brick, studs included, and gives the radius that holds all of it. */
export function centreBrick(m: THREE.Mesh): number {
  m.geometry.computeBoundingBox();
  const box = m.geometry.boundingBox!;
  m.position.copy(box.getCenter(new THREE.Vector3())).negate();
  return box.getSize(new THREE.Vector3()).length() / 2;
}

function setup(): void {
  // Its own small renderer, kept out of the page: pictures are read off it straight after drawing.
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  scene = new THREE.Scene();
  addBrickLights(scene);
  camera = new THREE.PerspectiveCamera(30, 1, 0.005, 50);
  mesh = new THREE.Mesh();
  edges = new THREE.LineSegments(
    undefined,
    new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }),
  );
  mesh.add(edges);
  scene.add(mesh);
}

/**
 * A data URL picture of `type` in `colour`, `size` pixels square on a clear background.
 * Pictures are kept until `clearBrickThumbs`, so asking again is cheap.
 */
export function brickThumb(type: BrickTypeId, colour: ColourId, size = 96): string {
  const key = `${type}|${colour}|${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (!renderer) setup();
  renderer!.setSize(size, size, false);
  mesh.geometry = brickGeometry(type);
  mesh.material = brickMaterial(colour);
  edges.geometry = brickEdges(type);
  const radius = centreBrick(mesh);
  const fit = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2);
  camera.position
    .copy(CORNER)
    .normalize()
    .multiplyScalar(fit * 0.9);
  camera.lookAt(0, 0, 0);
  renderer!.render(scene, camera);
  const url = renderer!.domElement.toDataURL();
  cache.set(key, url);
  return url;
}

/** Forgets every picture, for when the brick materials change look. */
export function clearBrickThumbs(): void {
  cache.clear();
}
