import * as THREE from 'three';
import { mat, put, putSlab, rbox, roundedOutline } from './kit.ts';

/**
 * The load on the roof rack, as the picture piles it: a big orange hard case standing up at the
 * front, leaning back, a small orange case flat beside it, a yellow-lidded case in front of a tall
 * grey crate, a dark helmet, two olive jerry cans with red and blue caps, and a red first-aid kit
 * at the back corner. Laid out on the rack's floor (y = 0), the car facing +x.
 */

const orange = () => mat(0xd9784e, { roughness: 0.55 });
const orangeDark = () => mat(0xb05a36, { roughness: 0.6 });
const charcoal = () => mat(0x3c4043, { roughness: 0.7 });

/** The big orange case: a flat case with handles cut in its raised ends and an X on its face. */
function bigCase(g: THREE.Group): void {
  const c = new THREE.Group();
  // Standing on its long edge across the rack, face to the front, leaning well back and a little
  // toward the camera's side, its foot out over the front rail.
  c.position.set(0.04, 0.02, -0.05);
  c.rotation.set(-0.2, 0, 0.6);
  c.rotation.order = 'YZX';
  c.rotation.y = 0.1;
  g.add(c);
  const outline = roundedOutline(
    [
      [-0.52, 0],
      [0.52, 0],
      [0.52, 0.5],
      [0.44, 0.58],
      [0.22, 0.58],
      [0.12, 0.46],
      [-0.12, 0.46],
      [-0.22, 0.58],
      [-0.44, 0.58],
      [-0.52, 0.5],
    ],
    0.05,
  );
  // The face lies across z, so the outline's x runs along the rack's width.
  putSlab(c, outline, 0.16, orange(), 0.04, 0, 0, 0, 0, Math.PI / 2, 0);
  // A grey rim round its back half.
  putSlab(c, outline, 0.05, charcoal(), 0.015, -0.07, -0.005, 0, 0, Math.PI / 2, 0).scale.set(
    1.01,
    1.01,
    1,
  );
  // The handles: dark openings near the raised ends.
  for (const z of [-0.33, 0.33]) {
    rbox(c, mat(0x2b2523, { roughness: 0.9 }), 0.075, 0.43, z, 0.03, 0.11, 0.13, 0.02);
    rbox(c, orangeDark(), 0.07, 0.36, z, 0.04, 0.03, 0.17, 0.012);
  }
  // The X moulded on its face.
  for (const a of [-0.62, 0.62])
    rbox(c, orangeDark(), 0.085, 0.24, 0, 0.02, 0.05, 0.42, 0.012, [a, 0, 0]);
  // Latches along the bottom.
  for (const z of [-0.25, 0.25])
    rbox(
      c,
      mat(0x8d969c, { metalness: 0.5, roughness: 0.4 }),
      0.085,
      0.08,
      z,
      0.02,
      0.07,
      0.08,
      0.01,
    );
}

/** A small orange case lying flat at the front corner. */
function smallCase(g: THREE.Group): void {
  rbox(g, orange(), 0.02, 0.06, 0.52, 0.36, 0.1, 0.48, 0.03);
  rbox(g, charcoal(), 0.02, 0.06, 0.52, 0.37, 0.025, 0.49, 0.008);
}

/** A case with a dark tub and a yellow lid, lying flat. */
function yellowCase(g: THREE.Group): void {
  const c = new THREE.Group();
  c.position.set(-0.5, 0.1, -0.12);
  c.rotation.y = 0.08;
  g.add(c);
  rbox(c, mat(0x4a4d4c, { roughness: 0.7 }), 0, 0.07, 0, 0.42, 0.13, 0.66, 0.03);
  rbox(c, mat(0xe9c43a, { roughness: 0.5 }), 0, 0.165, 0, 0.44, 0.07, 0.68, 0.03);
  rbox(c, mat(0xc79a22, { roughness: 0.5 }), 0, 0.205, 0, 0.36, 0.015, 0.6, 0.006);
  rbox(c, mat(0x8d969c, { metalness: 0.5, roughness: 0.4 }), 0.225, 0.12, 0, 0.02, 0.08, 0.1, 0.01);
}

/** A tall grey metal crate with a lid, darker trim round its edges. */
function crate(g: THREE.Group): void {
  const metal = { mottle: 'metal', roughness: 0.4, metalness: 0.6 } as const;
  rbox(g, mat(0x8c9094, metal), -1.32, 0.34, 0.05, 0.66, 0.66, 0.76, 0.05);
  rbox(g, mat(0x7c8084, metal), -1.32, 0.7, 0.05, 0.7, 0.08, 0.8, 0.04);
  rbox(g, mat(0x4a4e52, { roughness: 0.6 }), -1.32, 0.655, 0.05, 0.68, 0.015, 0.78, 0.006);
  rbox(g, mat(0x4a4e52, { roughness: 0.6 }), -1.32, 0.03, 0.05, 0.68, 0.04, 0.78, 0.01);
  rbox(g, orange(), -0.98, 0.65, 0.05, 0.03, 0.06, 0.1, 0.01);
}

/** A dark helmet lying among the cases, a lime badge on its side. */
function helmet(g: THREE.Group): void {
  const shell = new THREE.SphereGeometry(0.22, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  const h = put(g, shell, mat(0x1f2325, { roughness: 0.35, mottle: 'plastic' }), -1.2, 0.1, -0.42);
  h.scale.set(1, 0.95, 1.1);
  rbox(g, mat(0x2a2f31, { roughness: 0.6 }), -1.2, 0.12, -0.42, 0.46, 0.05, 0.5, 0.02);
  const badge = new THREE.CircleGeometry(0.055, 20);
  put(g, badge, mat(0x9fc22a, { roughness: 0.5, mottle: 'none' }), -1.08, 0.24, -0.6, 0.6, -0.5, 0);
}

/** An olive jerry can, standing, its broad faces across x, a cap of `cap`'s colour. */
function jerryCan(g: THREE.Group, x: number, z: number, cap: number, turn: number): void {
  const c = new THREE.Group();
  c.position.set(x, 0, z);
  c.rotation.y = turn;
  c.scale.setScalar(1.15);
  g.add(c);
  const olive = mat(0x5d6a44, { roughness: 0.6 });
  rbox(c, olive, 0, 0.24, 0, 0.17, 0.46, 0.34, 0.04);
  // The X pressed into each face.
  for (const a of [-0.9, 0.9])
    for (const s of [-1, 1])
      rbox(c, mat(0x4c573a, { roughness: 0.6 }), s * 0.087, 0.22, 0, 0.01, 0.025, 0.36, 0.01, [
        a,
        0,
        0,
      ]);
  // The three-bar handle and the spout with its cap.
  for (const hz of [-0.1, 0, 0.1]) rbox(c, olive, 0, 0.5, hz, 0.04, 0.07, 0.025, 0.01);
  rbox(c, olive, 0, 0.535, 0, 0.04, 0.025, 0.24, 0.01);
  put(
    c,
    new THREE.CylinderGeometry(0.035, 0.04, 0.05, 14),
    mat(cap, { roughness: 0.4 }),
    0,
    0.49,
    0.13,
  );
}

/** The red first-aid kit, standing at the back corner, a white cross in a ring on its face. */
function firstAid(g: THREE.Group): void {
  const c = new THREE.Group();
  c.position.set(-2.12, 0, -0.6);
  c.rotation.y = 0.5;
  g.add(c);
  rbox(c, mat(0xd9514f, { roughness: 0.5 }), 0, 0.21, 0, 0.15, 0.4, 0.48, 0.04);
  rbox(c, mat(0xb63e3d, { roughness: 0.5 }), 0, 0.21, 0, 0.16, 0.42, 0.012, 0.004);
  const white = mat(0xf2ece6, { roughness: 0.5, mottle: 'none' });
  const ring = new THREE.TorusGeometry(0.12, 0.012, 8, 32);
  put(c, ring, white, 0.08, 0.22, 0, 0, Math.PI / 2, 0);
  rbox(c, white, 0.08, 0.22, 0, 0.01, 0.16, 0.05, 0.004);
  rbox(c, white, 0.08, 0.22, 0, 0.01, 0.05, 0.16, 0.004);
  // Two dark latches over its top.
  for (const z of [-0.16, 0.16])
    rbox(c, mat(0x3b3f42, { roughness: 0.5 }), 0.03, 0.4, z, 0.1, 0.06, 0.05, 0.01);
}

export function buildCargo(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'cargo';
  bigCase(g);
  smallCase(g);
  yellowCase(g);
  crate(g);
  helmet(g);
  jerryCan(g, -1.72, -0.4, 0xd23a2a, 0.15);
  jerryCan(g, -1.98, -0.26, 0x2f6fd0, 0.1);
  firstAid(g);
  return g;
}
