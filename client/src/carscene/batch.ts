import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Bakes the still meshes under `root` into one mesh per material (and shadow setting), each
 * keeping its own material, textures and all, so the scene looks just as it did with a draw call
 * for each material rather than for each part. (The game's own `mergeStatic` moves colours into
 * the vertices and leaves textured meshes alone, and nearly every part here is textured.)
 *
 * Left as they are: anything under an object `keep` picks out (a door that swings), see-through
 * meshes (drawn back to front, one by one), instanced, mirrored or multi-material meshes, and
 * meshes with a hook of their own before they draw. Returns how many meshes it took in.
 */
export function batchStatic(root: THREE.Object3D, keep: (o: THREE.Object3D) => boolean): number {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const groups = new Map<string, { like: THREE.Mesh; parts: THREE.BufferGeometry[] }>();
  const taken: THREE.Mesh[] = [];
  const m = new THREE.Matrix4();
  const visit = (o: THREE.Object3D) => {
    if (keep(o)) return;
    o.children.forEach(visit);
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || !mesh.visible) return;
    const material = mesh.material;
    if (
      Array.isArray(material) ||
      material.transparent ||
      mesh.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender
    )
      return;
    m.multiplyMatrices(toRoot, mesh.matrixWorld);
    if (m.determinant() < 0) return;
    const geo = mesh.geometry;
    const key = [
      material.uuid,
      Object.keys(geo.attributes).sort().join('+'),
      geo.index ? 'indexed' : 'flat',
      mesh.castShadow,
      mesh.receiveShadow,
      mesh.layers.mask,
      mesh.renderOrder,
    ].join();
    let group = groups.get(key);
    if (!group) {
      group = { like: mesh, parts: [] };
      groups.set(key, group);
    }
    group.parts.push(geo.clone().applyMatrix4(m));
    taken.push(mesh);
  };
  visit(root);
  for (const mesh of taken) mesh.removeFromParent();
  for (const g of groups.values()) {
    const merged = g.parts.length > 1 ? mergeGeometries(g.parts, false) : null;
    // Parts the merge cannot join (unlike attributes) go back one by one, already placed.
    for (const geo of merged ? [merged] : g.parts) {
      const { like } = g;
      const mesh = new THREE.Mesh(geo, like.material);
      mesh.castShadow = like.castShadow;
      mesh.receiveShadow = like.receiveShadow;
      mesh.layers.mask = like.layers.mask;
      mesh.renderOrder = like.renderOrder;
      root.add(mesh);
    }
    if (merged) for (const p of g.parts) p.dispose();
  }
  return taken.length;
}
