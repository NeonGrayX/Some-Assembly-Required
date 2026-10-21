import type { SolidDef } from '../house.ts';
import { CHEVRON_MESH } from './chevronMesh.ts';
import { solidAt, unpackTriangles } from './sceneMesh.ts';
import type { SceneMesh } from './sceneMesh.ts';

/** The levels' meshes (see `LevelDef.meshes`), by name: Chevron Street's `chevron`, its `still` part. */
const MESHES: Record<string, SceneMesh> = Object.fromEntries(
  Object.entries(CHEVRON_MESH).map(([k, m]) => [k === 'still' ? 'chevron' : `chevron ${k}`, m]),
);

/** A mesh as it is met, in its own axes: its shapes, and its triangles. */
export interface Mesh {
  shapes: SolidDef[];
  vertices: Float32Array;
  indices: Uint32Array;
}

const unpacked = new Map<string, Mesh>();

/** The mesh named `name`, unpacked the first time it is asked for. */
export function meshOf(name: string): Mesh {
  let mesh = unpacked.get(name);
  if (!mesh) {
    const m = MESHES[name];
    if (!m) throw new Error(`No mesh ${name}`);
    mesh = {
      shapes: m.shapes.map((s) => solidAt(s, (x, y, z) => ({ x, y, z }))),
      ...unpackTriangles(m.triangles.join('')),
    };
    unpacked.set(name, mesh);
  }
  return mesh;
}
