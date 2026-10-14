import * as THREE from 'three';

/**
 * Bevelled boxes and cylinders for the man-made models. A painted game's furniture, crates
 * and machines never have knife-edged corners: every edge is taken off, and as it turns from
 * one face to the next it catches the light as a bright line, which is most of what makes a
 * shape read as a solid, handled thing rather than a coloured box. These shapes do that as
 * cheaply as they can: each edge is one flat chamfer, and its normals blend from the one face
 * to the other across it, so it shades as a rounded edge would.
 *
 * A bevelled box costs 44 triangles where a plain one costs 12, and the shadow maps draw them
 * again, so the bevel is sized from the part's thinnest side (see `bevelFor`): none on parts
 * too thin for it to show, a few millimetres on boards and books, a centimetre or two on
 * furniture, up to six on big machines.
 *
 * Each stays a `BoxGeometry` or `CylinderGeometry` with that type and those size parameters,
 * so whatever takes a box or cylinder for a solid block (the model checks) still does: the
 * bevels only shave its edges, never add to it.
 */

/** Parts thinner than this (m) have square edges: a bevel on them would not show. */
const THINNEST = 0.015;
/** The biggest bevel, on the biggest things (m). */
const WIDEST = 0.06;

/**
 * How far in (m) a part's edges are bevelled, for its sizes: about a fifth of its thinnest
 * side on small parts, a smaller share on bigger ones, never more than `WIDEST`, and none
 * under `THINNEST`.
 */
export function bevelFor(...sizes: number[]): number {
  const thin = Math.min(...sizes);
  if (thin < THINNEST) return 0;
  return Math.min(thin * 0.22, 0.006 + thin * 0.1, WIDEST);
}

/**
 * A box `width × height × depth` centred on the origin with its edges and corners chamfered
 * `radius` deep: the six faces inset by it, a strip along each edge between them and a
 * triangle at each corner, 44 triangles in all. Every vertex keeps the normal of the face it
 * belongs to, so across a strip the shading turns from one face to the next, and the corners
 * round off the same way.
 */
export class BevelBoxGeometry extends THREE.BoxGeometry {
  declare parameters: THREE.BoxGeometry['parameters'] & { radius: number };

  constructor(width = 1, height = 1, depth = 1, radius = bevelFor(width, height, depth)) {
    super(width, height, depth);
    const half = [width / 2, height / 2, depth / 2];
    // Never so deep that a face shrinks to nothing.
    const r = Math.max(0, Math.min(radius, ...half.map((h) => h * 0.45)));
    this.parameters.radius = r;
    const inner = half.map((h) => h - r);
    // The four corners of each face, inset by the bevel: the face across `axis` on the side
    // of `signs[axis]`, at its corner towards `signs` (-1 or 1 along each axis).
    const position: number[] = [];
    const normal: number[] = [];
    const uv: number[] = [];
    const SIGNS = [-1, 1];
    for (let axis = 0; axis < 3; axis++)
      for (const sz of SIGNS)
        for (const sy of SIGNS)
          for (const sx of SIGNS) {
            const signs = [sx, sy, sz];
            for (let k = 0; k < 3; k++) {
              position.push(signs[k]! * (k === axis ? half[k]! : inner[k]!));
              normal.push(k === axis ? signs[k]! : 0);
            }
            const [u, v] = [0, 1, 2].filter((k) => k !== axis);
            uv.push((signs[u!]! + 1) / 2, (signs[v!]! + 1) / 2);
          }
    const at = (axis: number, signs: number[]) =>
      axis * 8 + (signs[0]! > 0 ? 1 : 0) + (signs[1]! > 0 ? 2 : 0) + (signs[2]! > 0 ? 4 : 0);
    const index: number[] = [];
    const p = (i: number) => new THREE.Vector3().fromArray(position, i * 3);
    // Wound to face out: for a convex shape round the origin, the way from the origin to a
    // triangle is the way out of it.
    const tri = (a: number, b: number, c: number) => {
      const [pa, pb, pc] = [p(a), p(b), p(c)];
      const facing = pb.clone().sub(pa).cross(pc.clone().sub(pa));
      if (facing.dot(pa.add(pb).add(pc)) < 0) index.push(a, c, b);
      else index.push(a, b, c);
    };
    const quad = (a: number, b: number, c: number, d: number) => {
      tri(a, b, c);
      tri(a, c, d);
    };
    for (let axis = 0; axis < 3; axis++) {
      const [u, v] = [0, 1, 2].filter((k) => k !== axis) as [number, number];
      for (const s of SIGNS) {
        // The face, round its four corners.
        const corner = (su: number, sv: number) => {
          const signs = [0, 0, 0];
          signs[axis] = s;
          signs[u] = su;
          signs[v] = sv;
          return at(axis, signs);
        };
        quad(corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1));
      }
    }
    // The strip along each edge, from the one face's side of it to the other's.
    for (let a = 0; a < 3; a++)
      for (let b = a + 1; b < 3; b++) {
        const c = 3 - a - b;
        for (const sa of SIGNS)
          for (const sb of SIGNS) {
            const end = (sc: number) => {
              const signs = [0, 0, 0];
              signs[a] = sa;
              signs[b] = sb;
              signs[c] = sc;
              return signs;
            };
            quad(at(a, end(-1)), at(a, end(1)), at(b, end(1)), at(b, end(-1)));
          }
      }
    // A triangle at each corner, between the three faces' corners there.
    for (const sz of SIGNS)
      for (const sy of SIGNS)
        for (const sx of SIGNS) {
          const signs = [sx, sy, sz];
          tri(at(0, signs), at(1, signs), at(2, signs));
        }
    this.clearGroups();
    this.setIndex(index);
    this.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    this.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
    this.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  }
}

/**
 * A box `sx × sy × sz` centred on the origin, its edges bevelled `radius` deep (by default as
 * `bevelFor` sizes it); a plain box where that comes to nothing.
 */
export function bevelBox(
  sx: number,
  sy: number,
  sz: number,
  radius = bevelFor(sx, sy, sz),
): THREE.BoxGeometry {
  return radius > 0 ? new BevelBoxGeometry(sx, sy, sz, radius) : new THREE.BoxGeometry(sx, sy, sz);
}

/**
 * How many sides a round part of radius `r` (m) needs to look round: eight on a little knob,
 * a couple of dozen on a big drum. Its normals are smooth, so only its outline shows them.
 */
export function sidesFor(r: number): number {
  return 2 * Math.round(Math.min(16, Math.max(4, 4 + r * 24)));
}

/**
 * An upright cylinder (or a cone's frustum) `height` tall centred on the origin, `radiusTop`
 * round at its top and `radiusBottom` at its bottom, with both rims chamfered `radius` deep:
 * each cap inset by it, joined to the side by a band whose normals turn from the side's to the
 * cap's, so the rims shade rounded. Twice a plain cylinder's triangles.
 */
export class BevelCylinderGeometry extends THREE.CylinderGeometry {
  declare parameters: THREE.CylinderGeometry['parameters'] & { radius: number };

  constructor(
    radiusTop = 1,
    radiusBottom = 1,
    height = 1,
    radialSegments = sidesFor(Math.max(radiusTop, radiusBottom)),
    radius = bevelFor(2 * Math.min(radiusTop, radiusBottom), height),
  ) {
    super(radiusTop, radiusBottom, height, radialSegments);
    const r = Math.max(0, Math.min(radius, radiusTop * 0.5, radiusBottom * 0.5, height * 0.4));
    this.parameters.radius = r;
    const n = radialSegments;
    const rAt = (y: number) =>
      radiusBottom + ((radiusTop - radiusBottom) * (y + height / 2)) / height;
    // The side leans in by this much for each metre up (a frustum's), which tips its normals.
    const lean = (radiusBottom - radiusTop) / height;
    const position: number[] = [];
    const normal: number[] = [];
    const uv: number[] = [];
    /** A ring of `n + 1` vertices (the last on the first, for the texture's seam). */
    const ring = (y: number, across: number, up: number | null): number => {
      const first = position.length / 3;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const [sin, cos] = [Math.sin(a), Math.cos(a)];
        position.push(across * sin, y, across * cos);
        if (up === null) {
          const k = 1 / Math.hypot(1, lean);
          normal.push(sin * k, lean * k, cos * k);
        } else normal.push(0, up, 0);
        uv.push(i / n, (y + height / 2) / height);
      }
      return first;
    };
    const centre = (y: number, up: number): number => {
      position.push(0, y, 0);
      normal.push(0, up, 0);
      uv.push(0.5, (y + height / 2) / height);
      return position.length / 3 - 1;
    };
    const top = height / 2;
    const bottomCentre = centre(-top, -1);
    const bottomRim = ring(-top, rAt(-top) - r, -1);
    const sideLow = ring(-top + r, rAt(-top + r), null);
    const sideHigh = ring(top - r, rAt(top - r), null);
    const topRim = ring(top, rAt(top) - r, 1);
    const topCentre = centre(top, 1);
    const index: number[] = [];
    // Bands between rings, wound to face out (rings run anticlockwise seen from above).
    const band = (lower: number, upper: number) => {
      for (let i = 0; i < n; i++) index.push(lower + i, lower + i + 1, upper + i + 1);
      for (let i = 0; i < n; i++) index.push(lower + i, upper + i + 1, upper + i);
    };
    for (let i = 0; i < n; i++) index.push(bottomCentre, bottomRim + i + 1, bottomRim + i);
    band(bottomRim, sideLow);
    band(sideLow, sideHigh);
    band(sideHigh, topRim);
    for (let i = 0; i < n; i++) index.push(topCentre, topRim + i, topRim + i + 1);
    this.clearGroups();
    this.setIndex(index);
    this.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    this.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
    this.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  }
}

/**
 * An upright cylinder (or frustum) centred on the origin with its rims bevelled (by default as
 * `bevelFor` sizes it, from its diameter and height), with as many sides as its size needs
 * (`sidesFor`); a plain one where the bevel comes to nothing.
 */
export function bevelCylinder(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  radialSegments = sidesFor(Math.max(radiusTop, radiusBottom)),
  radius = bevelFor(2 * Math.min(radiusTop, radiusBottom), height),
): THREE.CylinderGeometry {
  return radius > 0
    ? new BevelCylinderGeometry(radiusTop, radiusBottom, height, radialSegments, radius)
    : new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments);
}
