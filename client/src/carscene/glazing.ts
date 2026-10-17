import * as THREE from 'three';
import { weather } from './car.ts';
import { put, rbox, slab } from './kit.ts';

/**
 * A run of a shell's outline to sink glass into: from `a` to `c` (in the outline's own order,
 * along a straight of it), sunk from `e0` along it to `e1` short of its end.
 */
export type GlassRun = [a: THREE.Vector2, c: THREE.Vector2, e0: number, e1: number];

/**
 * A glazed shell, its glass set into it rather than laid on it: a slab of `outline` (its side,
 * extruded across `half` × 2), built as two sides `pillar` thick with `openings` cut through each
 * (side windows, their frames rolling into them `b` deep, the glass a little way in) and a middle
 * between them a hair lower, sunk `d` under each of `runs` with the glass laid in the recess, so
 * the pillars stand either side of it.
 */
export function glazedShell(o: {
  outline: THREE.Shape;
  openings: THREE.Shape[];
  half: number;
  pillar: number;
  b: number;
  d: number;
  runs: GlassRun[];
  paint: THREE.Material;
  glass: () => THREE.Material;
  worn: [number, number, number];
}): THREE.Group {
  const { outline, half, pillar, b, d, runs } = o;
  const shell = new THREE.Group();
  const points = outline.getPoints(12);

  // Its two sides, the openings through them...
  const sideShape = outline.clone();
  sideShape.holes.push(...o.openings);
  for (const side of [-1, 1]) {
    const geo = weather(slab(sideShape, pillar, b), 'slab', false, o.worn);
    // Its inner edge, where it meets the middle, is no edge to wear.
    const nor = geo.attributes.normal as THREE.BufferAttribute;
    const col = geo.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < nor.count; i++) if (nor.getZ(i) * side < -0.15) col.setXYZ(i, 1, 1, 1);
    put(shell, geo, o.paint, 0, 0, side * (half - pillar / 2));
  }

  // ...and its middle between them, the same side but a hair lower, sunk under each run.
  const sunk: THREE.Vector2[] = [];
  for (const [i, p] of points.entries()) {
    sunk.push(p);
    const q = points[(i + 1) % points.length]!;
    for (const [a, c, e0, e1] of runs) {
      const along = c.clone().sub(a);
      const len = along.length();
      along.normalize();
      // On this run's straight: both ends on its line, between its rounded ends.
      const off = (v: THREE.Vector2) => Math.abs(v.clone().sub(a).cross(along));
      if (off(p) > 1e-4 || off(q) > 1e-4 || p.distanceTo(q) < len * 0.3) continue;
      const out = new THREE.Vector2(along.y, -along.x);
      const at = (t: number, depth: number) =>
        a.clone().addScaledVector(along, t).addScaledVector(out, -depth);
      sunk.push(at(e0, 0), at(e0, d), at(len - e1, d), at(len - e1, 0));
    }
  }
  const middle = slab(new THREE.Shape(sunk), (half - b) * 2, b - 0.002);
  put(shell, weather(middle, 'slab', false, o.worn), o.paint);

  for (const [a, c, e0, e1] of runs) {
    const along = c.clone().sub(a);
    const len = along.length();
    along.normalize();
    const out = new THREE.Vector2(along.y, -along.x);
    // The floor of the recess, its ends stepping up, each step `b` into it.
    const run = len - e0 - e1 - 2 * (b - 0.002);
    const mid = a
      .clone()
      .addScaledVector(along, (e0 + len - e1) / 2)
      .addScaledVector(out, -d + b - 0.002 + 0.005);
    rbox(shell, o.glass(), mid.x, mid.y, 0, run + 0.01, 0.008, (half - pillar) * 2 + 0.05, 0.003, [
      0,
      0,
      Math.atan2(along.y, along.x),
    ]).castShadow = false;
  }
  // The side windows' glass, a little way into each opening, its edges in the frame.
  for (const side of [-1, 1])
    for (const h of o.openings) {
      const geo = slab(h, 0.01, 0.003, 8);
      put(shell, geo, o.glass(), 0, 0, side * (half - 0.04)).castShadow = false;
    }
  return shell;
}
