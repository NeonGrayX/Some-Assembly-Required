import * as THREE from 'three';
import { bevelCylinder } from './shapes.ts';

/** Same pseudo-random numbers on every client, from a position. */
function hashRng(x: number, z: number): () => number {
  let s = Math.floor(Math.abs(x * 7919 + z * 104729 + 17)) % 2147483647 || 1;
  return () => (s = (s * 48271) % 2147483647) / 2147483647;
}

const glass = new THREE.MeshStandardMaterial({
  color: 0xd8eef5,
  roughness: 0.08,
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
});
const biscuit = new THREE.MeshStandardMaterial({ color: 0xa0632e, roughness: 0.9 });
const lighter = new THREE.MeshStandardMaterial({ color: 0xc08a4e, roughness: 0.9 });
const red = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.45 });

/**
 * A treat jar for the dog, standing at `at` (the bottom of the jar): a glass jar with rounded
 * shoulders, half full of biscuits heaped inside it, and a red lid with a knob on top. As tall
 * and wide as the jar the dog's treats always came in (16 cm of glass under a 3 cm lid).
 */
export function makeTreatJar(at: { x: number; y: number; z: number }): THREE.Group {
  const g = new THREE.Group();
  g.position.set(at.x, at.y, at.z);
  // The glass, turned: a thick base, straight sides, the shoulder and the neck.
  const profile = [
    [0, 0],
    [0.074, 0],
    [0.08, 0.008],
    [0.08, 0.12],
    [0.074, 0.142],
    [0.066, 0.152],
    [0.066, 0.162],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const jar = new THREE.Mesh(new THREE.LatheGeometry(profile, 20), glass);
  jar.renderOrder = 1;
  g.add(jar);
  // Biscuits in rough layers, each tilted a little, inside the glass.
  const rng = hashRng(at.x, at.z);
  const disc = new THREE.CylinderGeometry(0.024, 0.024, 0.011, 10);
  for (let layer = 0; layer < 4; layer++)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + layer * 0.5 + rng() * 0.3;
      const r = i === 0 && layer % 2 ? 0 : 0.04 + rng() * 0.008;
      const b = new THREE.Mesh(disc, rng() < 0.4 ? lighter : biscuit);
      b.position.set(Math.cos(a) * r, 0.014 + layer * 0.018 + rng() * 0.004, Math.sin(a) * r);
      b.rotation.set((rng() - 0.5) * 0.6, rng() * Math.PI, (rng() - 0.5) * 0.6);
      b.castShadow = true;
      g.add(b);
    }
  // The lid over the neck, and its knob.
  const lid = new THREE.Mesh(bevelCylinder(0.074, 0.076, 0.028, 20), red);
  lid.position.y = 0.162 + 0.014 - 0.006;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8), red);
  knob.scale.y = 0.7;
  knob.position.y = lid.position.y + 0.014 + 0.008;
  for (const m of [lid, knob]) {
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  return g;
}
