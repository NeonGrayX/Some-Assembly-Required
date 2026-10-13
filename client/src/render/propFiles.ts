import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Props as model files (glTF binary, .glb), so they can be made or touched up in Blender or any
 * other modelling tool. A level box names one with `asset` and it is drawn in place of the box's
 * coded model, at its own size (in metres), with its origin in the middle of the box's bottom
 * and its front (+z, as glTF models face) towards the box's front; it still collides as the
 * box. The gallery (models.html) saves any model in the game as a .glb in that frame, so a
 * prop saved and named again comes back exactly as it was, and previews a .glb in a prop's
 * place. See docs/09-prop-files.md.
 */

/** The .glb files shipped with the game, by path. */
const FILES = import.meta.glob<string>('../assets/props/*.glb', {
  query: '?url',
  import: 'default',
  eager: true,
});

const loaded = new Map<string, THREE.Object3D>();

/** The name a level box gives a file by: `couch` for `props/couch.glb`. */
export const propFileName = (path: string) => path.replace(/^.*[/\\]/, '').replace(/\.glb$/i, '');

/**
 * Loads every .glb in `assets/props`, before any level is built (levels are built at once and
 * cannot wait for a file). One that fails is left out: its boxes keep their coded models.
 */
export async function loadPropFiles(): Promise<void> {
  await Promise.all(
    Object.entries(FILES).map(async ([path, url]) => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        await addPropFile(propFileName(path), await res.arrayBuffer());
      } catch (e) {
        console.warn(`Could not load the prop file ${path}:`, e);
      }
    }),
  );
}

/** Reads a .glb and keeps it as `name`, for the boxes that name it. */
export async function addPropFile(name: string, glb: ArrayBuffer): Promise<void> {
  const gltf = await new GLTFLoader().parseAsync(glb, '');
  loaded.set(name, gltf.scene);
}

/**
 * The file `name`, its origin at `(0, floor, 0)` and its front turned to -z as a coded model's
 * is; `null` if no such file is loaded.
 */
export function propFile(name: string, floor = 0): THREE.Object3D | null {
  const source = loaded.get(name);
  if (!source) return null;
  const g = new THREE.Group();
  const model = source.clone();
  model.rotation.y = Math.PI;
  model.position.y = floor;
  model.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
  });
  g.add(model);
  return g;
}

/**
 * `objects` as a .glb, facing +z, in the frame of the first (for a prop: unturned and centred
 * on its box) lowered to `floor` in it, or by default to the lowest point. Hidden parts are
 * left out.
 */
export async function exportGlb(
  objects: THREE.Object3D[],
  name = 'model',
  floor?: number,
): Promise<ArrayBuffer> {
  const root = new THREE.Group();
  root.name = name;
  if (objects.length) {
    for (const o of objects) o.updateWorldMatrix(true, true);
    const toFrame = new THREE.Matrix4()
      .makeRotationY(Math.PI)
      .multiply(objects[0]!.matrixWorld.clone().invert());
    for (const o of objects) {
      const copy = o.clone();
      new THREE.Matrix4()
        .multiplyMatrices(toFrame, o.matrixWorld)
        .decompose(copy.position, copy.quaternion, copy.scale);
      root.add(copy);
    }
    root.updateMatrixWorld(true);
    const lowest = new THREE.Box3().setFromObject(root, true).min.y;
    const drop = floor ?? (Number.isFinite(lowest) ? lowest : 0);
    for (const c of root.children) c.position.y -= drop;
  }
  return (await new GLTFExporter().parseAsync(root, { binary: true })) as ArrayBuffer;
}
