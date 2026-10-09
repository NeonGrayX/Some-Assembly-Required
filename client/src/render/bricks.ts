import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BRICK_TYPES, COLOURS, PLATE_H, STUD } from '@sar/shared';
import type { BrickTypeId, ColourId } from '@sar/shared';

/** Visual gap between neighbouring bricks so seams are readable. */
const GAP = 0.002;
const STUD_RADIUS = STUD * 0.3;
const STUD_HEIGHT = PLATE_H * 0.45;
// Underside proportions follow a real brick (8 mm pitch): 1.2 mm walls, a 1 mm top,
// 6.51 mm tubes whose bore fits a stud, and 3.2 mm pins under 1-wide bricks.
const WALL = STUD * 0.15;
const TOP = STUD * 0.12;
const TUBE_OUTER = STUD * 0.407;
const TUBE_INNER = STUD_RADIUS;
const PIN_RADIUS = STUD * 0.2;
const SEGMENTS = 16;

const geometries = new Map<BrickTypeId, THREE.BufferGeometry>();
const materials = new Map<ColourId, THREE.MeshStandardMaterial>();

/**
 * Hollow tube standing on y = 0, open at the top (it is hidden under the brick's top).
 * Built by hand because three's cylinders have no bore.
 */
function tubeGeometry(outer: number, inner: number, height: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[][]) => {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(...[a, b, c, d][i]!);
      nrm.push(...n[i]!);
    }
  };
  for (let i = 0; i < SEGMENTS; i++) {
    const a0 = (i / SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / SEGMENTS) * Math.PI * 2;
    const [c0, s0, c1, s1] = [Math.cos(a0), Math.sin(a0), Math.cos(a1), Math.sin(a1)];
    const o = (c: number, s: number, y: number) => [c * outer, y, s * outer];
    const n = (c: number, s: number, y: number) => [c * inner, y, s * inner];
    // Outer wall faces out, bore faces in, bottom ring faces down.
    quad(o(c0, s0, 0), o(c0, s0, height), o(c1, s1, height), o(c1, s1, 0), [
      [c0, 0, s0],
      [c0, 0, s0],
      [c1, 0, s1],
      [c1, 0, s1],
    ]);
    quad(n(c0, s0, 0), n(c1, s1, 0), n(c1, s1, height), n(c0, s0, height), [
      [-c0, 0, -s0],
      [-c1, 0, -s1],
      [-c1, 0, -s1],
      [-c0, 0, -s0],
    ]);
    const down = [0, -1, 0];
    quad(n(c0, s0, 0), o(c0, s0, 0), o(c1, s1, 0), n(c1, s1, 0), [down, down, down, down]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

/**
 * Brick geometry centred on the brick body (studs stick out on top), at rotation 0.
 * The underside is hollow like a real brick: walls, tubes between the studs of 2-wide
 * bricks and pins under 1-wide ones. `userData.body` holds the solid body's Box3.
 */
export function brickGeometry(type: BrickTypeId): THREE.BufferGeometry {
  let g = geometries.get(type);
  if (g) return g;
  const t = BRICK_TYPES[type];
  const w = t.studsX * STUD - GAP;
  const h = t.plates * PLATE_H - GAP;
  const d = t.studsZ * STUD - GAP;
  const parts: THREE.BufferGeometry[] = [];
  if (t.fixture) {
    // Baseplates are flat underneath.
    parts.push(new THREE.BoxGeometry(w, h, d));
  } else {
    const inner = h - TOP;
    const wallY = -h / 2 + inner / 2;
    // The four walls are one ring, so each side of the brick is one face: walls made of
    // separate boxes met partway along the sides and showed there as faint lines.
    const ring = new THREE.Shape()
      .moveTo(-w / 2, -d / 2)
      .lineTo(w / 2, -d / 2)
      .lineTo(w / 2, d / 2)
      .lineTo(-w / 2, d / 2)
      .closePath();
    ring.holes.push(
      new THREE.Path()
        .moveTo(-w / 2 + WALL, -d / 2 + WALL)
        .lineTo(-w / 2 + WALL, d / 2 - WALL)
        .lineTo(w / 2 - WALL, d / 2 - WALL)
        .lineTo(w / 2 - WALL, -d / 2 + WALL)
        .closePath(),
    );
    parts.push(
      new THREE.BoxGeometry(w, TOP, d).translate(0, h / 2 - TOP / 2, 0),
      new THREE.ExtrudeGeometry(ring, { depth: inner, bevelEnabled: false })
        .rotateX(-Math.PI / 2)
        .translate(0, -h / 2, 0),
    );
    const x0 = -(t.studsX * STUD) / 2;
    const z0 = -(t.studsZ * STUD) / 2;
    if (t.studsX > 1 && t.studsZ > 1) {
      // Tubes sit where four studs meet, so a stud below is clutched between tube and wall.
      const tube = tubeGeometry(TUBE_OUTER, TUBE_INNER, inner);
      for (let x = 1; x < t.studsX; x++) {
        for (let z = 1; z < t.studsZ; z++) {
          parts.push(tube.clone().translate(x0 + x * STUD, -h / 2, z0 + z * STUD));
        }
      }
    } else {
      // 1-wide bricks get a solid pin between each pair of studs.
      const pin = new THREE.CylinderGeometry(PIN_RADIUS, PIN_RADIUS, inner, SEGMENTS);
      for (let i = 1; i < Math.max(t.studsX, t.studsZ); i++) {
        const along = i * STUD;
        parts.push(
          pin
            .clone()
            .translate(t.studsX > 1 ? x0 + along : 0, wallY, t.studsZ > 1 ? z0 + along : 0),
        );
      }
    }
  }
  const stud = new THREE.CylinderGeometry(STUD_RADIUS, STUD_RADIUS, STUD_HEIGHT, 12);
  for (let x = 0; x < t.studsX; x++) {
    for (let z = 0; z < t.studsZ; z++) {
      parts.push(
        stud
          .clone()
          .translate(
            (x + 0.5) * STUD - (t.studsX * STUD) / 2,
            h / 2 + STUD_HEIGHT / 2,
            (z + 0.5) * STUD - (t.studsZ * STUD) / 2,
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
  g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
  g.computeBoundingSphere();
  g.userData.body = new THREE.Box3(
    new THREE.Vector3(-w / 2, -h / 2, -d / 2),
    new THREE.Vector3(w / 2, h / 2, d / 2),
  );
  geometries.set(type, g);
  return g;
}
/**
 * The one grey every brick is without the colour goggles (Gear Hunt). One grey, not a shade
 * per colour, or players would soon tell dark red from red by its shade.
 */
export const BLIND_GREY = 0x8a8c90;
let colourBlind = false;

/** Whether brick colours are drawn as they are, or all as one grey. */
export function isColourBlind(): boolean {
  return colourBlind;
}

/**
 * Switches every brick material (the bins' sample bricks and held bricks included, since they
 * share these) between its colour and the one grey. Call it whenever the goggles go on or off.
 */
export function setColourBlind(blind: boolean): boolean {
  if (blind === colourBlind) return false;
  colourBlind = blind;
  for (const [colour, m] of materials) m.color.setHex(blind ? BLIND_GREY : COLOURS[colour].hex);
  return true;
}

/** The colour a brick is drawn in: its own, or the one grey without the goggles. */
export function drawnHex(colour: ColourId): number {
  return colourBlind ? BLIND_GREY : COLOURS[colour].hex;
}

export function brickMaterial(colour: ColourId): THREE.MeshStandardMaterial {
  let m = materials.get(colour);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: drawnHex(colour), roughness: 0.45 });
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
