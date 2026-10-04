import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BRICK_TYPES, COLOURS, PLATE_H, STUD } from '@sar/shared';
import type { BrickTypeId, ColourId } from '@sar/shared';

/** Visual gap between neighbouring bricks so seams are readable. */
const GAP = 0.002;
const STUD_RADIUS = STUD * 0.3;
const STUD_HEIGHT = PLATE_H * 0.45;

const geometries = new Map<BrickTypeId, THREE.BufferGeometry>();
const materials = new Map<ColourId, THREE.MeshStandardMaterial>();

/** Brick geometry centred on the brick body (studs stick out on top), at rotation 0. */
export function brickGeometry(type: BrickTypeId): THREE.BufferGeometry {
  let g = geometries.get(type);
  if (g) return g;
  const t = BRICK_TYPES[type];
  const w = t.studsX * STUD;
  const h = t.plates * PLATE_H;
  const d = t.studsZ * STUD;
  const parts: THREE.BufferGeometry[] = [new THREE.BoxGeometry(w - GAP, h - GAP, d - GAP)];
  const stud = new THREE.CylinderGeometry(STUD_RADIUS, STUD_RADIUS, STUD_HEIGHT, 12);
  for (let x = 0; x < t.studsX; x++) {
    for (let z = 0; z < t.studsZ; z++) {
      parts.push(
        stud
          .clone()
          .translate(
            (x + 0.5) * STUD - w / 2,
            h / 2 + STUD_HEIGHT / 2 - GAP / 2,
            (z + 0.5) * STUD - d / 2,
          ),
      );
    }
  }
  // Box and cylinder geometries carry different attribute sets; keep only what we need.
  for (const p of parts) {
    for (const name of Object.keys(p.attributes)) {
      if (name !== 'position' && name !== 'normal') p.deleteAttribute(name);
    }
  }
  g = mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
  g.computeBoundingSphere();
  geometries.set(type, g);
  return g;
}

export function brickMaterial(colour: ColourId): THREE.MeshStandardMaterial {
  let m = materials.get(colour);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: COLOURS[colour].hex, roughness: 0.45 });
    materials.set(colour, m);
  }
  return m;
}

const markerMaterial = new THREE.MeshStandardMaterial({ color: 0xf5c518, roughness: 0.5 });

/**
 * Yellow stripe and arrow on the front edge (+z) of the 16x16 baseplate, in its grid frame.
 * The plate is square, so without it a build could be made a quarter turn off.
 */
export function baseplateMarker(): THREE.Group {
  const g = new THREE.Group();
  const size = 16 * STUD;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(size, PLATE_H * 0.8, 0.006), markerMaterial);
  stripe.position.set(size / 2, PLATE_H / 2, size + 0.003);
  g.add(stripe);
  const arrow = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.012, 3), markerMaterial);
  arrow.position.set(size / 2, 0.006, size + 0.1);
  g.add(arrow);
  return g;
}
