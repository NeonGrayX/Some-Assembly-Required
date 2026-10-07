import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AT_NIGHT, LAMP_LIT, POWERED } from './daynight.ts';

/** Set on an object whose meshes move or change later, so `mergeStatic` leaves it alone. */
export const KEEP_SEPARATE = 'keepSeparate';

/**
 * Bakes the plain meshes under `root` (which must sit at the origin, unrotated) into as few
 * meshes as possible: one per kind of surface and shadow setting, with each mesh's colour
 * moved into vertex colours.
 *
 * Three.js makes a draw call per mesh, two with shadows on, and each call leaves a little
 * garbage behind. The level was ~170 separate boxes, bins and bricks; drawn at 240 frames a
 * second that garbage made the browser stop to clean up every few seconds, a visible hitch.
 * Textured or see-through meshes, and anything marked `KEEP_SEPARATE`, are left as they are.
 */
export function mergeStatic(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const groups = new Map<
    string,
    { parts: THREE.BufferGeometry[]; material: THREE.MeshStandardMaterial; mesh: THREE.Mesh }
  >();
  const merged: THREE.Mesh[] = [];
  const visit = (o: THREE.Object3D) => {
    if (o.userData[KEEP_SEPARATE]) return;
    o.children.forEach(visit);
    if (!(o instanceof THREE.Mesh) || !o.visible) return;
    const m = o.material;
    if (!(m instanceof THREE.MeshStandardMaterial) || m.constructor !== THREE.MeshStandardMaterial)
      return;
    if (m.map || m.transparent || m.vertexColors || m.opacity < 1) return;
    const key = [
      m.roughness,
      m.metalness,
      m.emissive.getHex(),
      m.emissiveIntensity,
      m.userData[AT_NIGHT],
      m.userData[LAMP_LIT],
      m.userData[POWERED],
      m.side,
      m.flatShading,
      o.castShadow,
      o.receiveShadow,
    ].join();
    let group = groups.get(key);
    if (!group) {
      const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: m.roughness,
        metalness: m.metalness,
        emissive: m.emissive,
        emissiveIntensity: m.emissiveIntensity,
        side: m.side,
        flatShading: m.flatShading,
      });
      if (m.userData[AT_NIGHT] !== undefined) material.userData[AT_NIGHT] = m.userData[AT_NIGHT];
      if (m.userData[LAMP_LIT]) material.userData[LAMP_LIT] = true;
      if (m.userData[POWERED]) material.userData[POWERED] = true;
      const mesh = new THREE.Mesh(undefined, material);
      mesh.castShadow = o.castShadow;
      mesh.receiveShadow = o.receiveShadow;
      groups.set(key, (group = { parts: [], material, mesh }));
    }
    // Same attributes for every part: positions and normals in world space, plus a colour.
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    g.morphAttributes = {};
    g.clearGroups();
    g.applyMatrix4(o.matrixWorld);
    const n = g.attributes.position!.count;
    const colours = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colours.set([m.color.r, m.color.g, m.color.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    group.parts.push(g);
    merged.push(o);
  };
  visit(root);
  for (const o of merged) o.removeFromParent();
  for (const { parts, mesh } of groups.values()) {
    mesh.geometry = mergeGeometries(parts)!;
    for (const p of parts) p.dispose();
    root.add(mesh);
  }
}
