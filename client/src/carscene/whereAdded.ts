import * as THREE from 'three';

/*
 * For the tests that look over the whole map for faults: where each mesh is, in words a reader
 * can find it by, down to the line of the map's code that put it there.
 */

/** Where a mesh is, for a reader to find it: its named parents, its kind, colour and bounds. */
export function where(m: THREE.Mesh): string {
  const path: string[] = [];
  for (let p: THREE.Object3D | null = m; p; p = p.parent) if (p.name) path.unshift(p.name);
  let model = m.parent!;
  while (!model.name && model.parent) model = model.parent;
  const colour = (m.material as THREE.MeshStandardMaterial).color?.getHexString() ?? '-';
  const box = new THREE.Box3().setFromObject(m);
  const [c, s] = [box.getCenter(new THREE.Vector3()), box.getSize(new THREE.Vector3())];
  const v = (x: THREE.Vector3) => `${x.x.toFixed(3)} ${x.y.toFixed(3)} ${x.z.toFixed(3)}`;
  // Where it is in its model's own frame, as its code places it.
  const own = c.clone().applyMatrix4(model.matrixWorld.clone().invert());
  return `${m.userData.addedAt ?? '?'} ${path.join('/')} ${m.geometry.type} #${colour} centre ${v(c)} (in ${model.name}: ${v(own)}) size ${v(s)}`;
}

/** Where in the map's code each mesh was added, for the report: the first line outside the kit. */
export function noteWhereAdded(): () => void {
  const add = THREE.Object3D.prototype.add;
  THREE.Object3D.prototype.add = function (this: THREE.Object3D, ...objects: THREE.Object3D[]) {
    const line = new Error().stack
      ?.split('\n')
      .find((l) => /carscene\/(?!kit\.ts|gadgets\.ts|whereAdded\.ts)\w+\.ts/.test(l));
    for (const o of objects) o.userData.addedAt ??= line?.match(/carscene\/[\w.]+:\d+/)?.[0];
    return add.apply(this, objects);
  };
  return () => {
    THREE.Object3D.prototype.add = add;
  };
}
