import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BRICK_TYPES, COLOURS, PLATE_H, STUD, hasTopStud } from '@sar/shared';
import type { BrickType, BrickTypeId, ColourId, Facing } from '@sar/shared';

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
  if (t.shape && t.shape !== 'box') {
    g = shapedGeometry(t);
    geometries.set(type, g);
    return g;
  }
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
  parts.push(...sideStudParts(t, h));
  for (let x = 0; x < t.studsX; x++) {
    for (let z = 0; z < t.studsZ; z++) {
      if (!hasTopStud(type, x, z)) continue;
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
  g = merge(parts, w, h, d);
  geometries.set(type, g);
  return g;
}

/** Merges parts into one geometry, with `userData.body` the solid body's box. */
function merge(parts: THREE.BufferGeometry[], w: number, h: number, d: number) {
  // Box, cylinder and extruded geometries carry different attribute sets; keep only these.
  for (const p of parts) {
    for (const name of Object.keys(p.attributes)) {
      if (name !== 'position' && name !== 'normal') p.deleteAttribute(name);
    }
  }
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
  g.computeBoundingSphere();
  g.userData.body = new THREE.Box3(
    new THREE.Vector3(-w / 2, -h / 2, -d / 2),
    new THREE.Vector3(w / 2, h / 2, d / 2),
  );
  return g;
}

const SIDE_DIRS: Record<Facing, THREE.Vector3> = {
  '+x': new THREE.Vector3(1, 0, 0),
  '-x': new THREE.Vector3(-1, 0, 0),
  '+z': new THREE.Vector3(0, 0, 1),
  '-z': new THREE.Vector3(0, 0, -1),
};

/**
 * Side studs, and the flange a bracket's studs stand on where they reach past its body. In the
 * part's own frame, centred on its body (`w`, `h`, `d` are the body's size).
 */
function sideStudParts(t: BrickType, h: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  // Flanges, one for each row of studs side by side (built a stud at a time, the gaps
  // between the pieces showed as dark slits down the flange): stud cells along the row, by
  // the row's direction, height and line.
  const rows = new Map<string, { dir: THREE.Vector3; cy: number; line: number; at: number[] }>();
  for (const s of t.sideStuds ?? []) {
    const dir = SIDE_DIRS[s.dir];
    const cx = (s.x + 0.5) * STUD - (t.studsX * STUD) / 2;
    const cz = (s.z + 0.5) * STUD - (t.studsZ * STUD) / 2;
    const cy = -h / 2 + s.y * PLATE_H;
    // Out to the body's side in the stud's direction.
    const face = new THREE.Vector3(cx + (dir.x * STUD) / 2, cy, cz + (dir.z * STUD) / 2);
    const below = cy - STUD / 2 < -h / 2;
    const above = cy + STUD / 2 > h / 2;
    if (below || above) {
      // A flange one plate thick on that side, one stud high around the stud.
      const line = dir.x ? face.x : face.z;
      const key = `${s.dir}|${cy}|${line}`;
      let row = rows.get(key);
      if (!row) rows.set(key, (row = { dir, cy, line, at: [] }));
      row.at.push(dir.x ? s.z : s.x);
    }
    const stud = new THREE.CylinderGeometry(STUD_RADIUS, STUD_RADIUS, STUD_HEIGHT, 12);
    // A cylinder stands along y: lay it along the stud's direction.
    if (dir.x) stud.rotateZ(-Math.sign(dir.x) * (Math.PI / 2));
    else stud.rotateX(Math.sign(dir.z) * (Math.PI / 2));
    stud.translate(face.x + (dir.x * STUD_HEIGHT) / 2, cy, face.z + (dir.z * STUD_HEIGHT) / 2);
    out.push(stud);
  }
  for (const { dir, cy, line, at } of rows.values()) {
    const cells = [...new Set(at)].sort((a, b) => a - b);
    const half = ((dir.x ? t.studsZ : t.studsX) * STUD) / 2;
    // Runs of cells next to each other, each one flange.
    for (let i = 0; i < cells.length;) {
      let j = i;
      while (j + 1 < cells.length && cells[j + 1] === cells[j]! + 1) j++;
      const from = cells[i]! * STUD - half;
      const to = (cells[j]! + 1) * STUD - half;
      const length = to - from - GAP;
      const mid = (from + to) / 2;
      // Round its studs, and on into the body it hangs from or stands on: studs set more than
      // half a stud off the body (a hanging bracket's) left a slit between the two.
      const y0 = Math.min(cy - (STUD - GAP) / 2, h / 2 - PLATE_H / 2);
      const y1 = Math.max(cy + (STUD - GAP) / 2, -h / 2 + PLATE_H / 2);
      const flange = new THREE.BoxGeometry(
        dir.x ? PLATE_H : length,
        y1 - y0,
        dir.z ? PLATE_H : length,
      );
      flange.translate(
        dir.x ? line - (dir.x * PLATE_H) / 2 : mid,
        (y0 + y1) / 2,
        dir.z ? line - (dir.z * PLATE_H) / 2 : mid,
      );
      out.push(flange);
      i = j + 1;
    }
  }
  return out;
}

/** A stud on top of cell (x, z) of a part whose body is `h` high. */
function topStud(t: BrickType, x: number, z: number, h: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(STUD_RADIUS, STUD_RADIUS, STUD_HEIGHT, 12).translate(
    (x + 0.5) * STUD - (t.studsX * STUD) / 2,
    h / 2 + STUD_HEIGHT / 2,
    (z + 0.5) * STUD - (t.studsZ * STUD) / 2,
  );
}

/**
 * A prism whose side profile (in the part's z-y plane, z toward the front) is `profile`,
 * running the part's whole width along x.
 */
function prism(profile: [number, number][], w: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(profile.map(([z, y]) => new THREE.Vector2(-z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false, curveSegments: 8 });
  // Extruded along +z from 0; turned so the extrusion runs along x and the profile's z is z.
  g.rotateY(Math.PI / 2);
  g.translate(-w / 2, 0, 0);
  return g;
}

/** Geometry of every part that is not a plain box with studs. */
function shapedGeometry(t: BrickType): THREE.BufferGeometry {
  const w = t.studsX * STUD - GAP;
  const h = t.plates * PLATE_H - GAP;
  const d = t.studsZ * STUD - GAP;
  const parts: THREE.BufferGeometry[] = [];
  const studsOnTop = () => {
    for (let x = 0; x < t.studsX; x++)
      for (let z = 0; z < t.studsZ; z++)
        if (hasTopStud(t.id, x, z)) parts.push(topStud(t, x, z, h));
  };
  switch (t.shape) {
    case 'tile':
      parts.push(new THREE.BoxGeometry(w, h, d));
      break;
    case 'grille': {
      // Three ridges along the tile over a lower body, so the grooves show.
      parts.push(new THREE.BoxGeometry(w, h * 0.6, d).translate(0, -h * 0.2, 0));
      for (const z of [-0.3, 0, 0.3]) {
        parts.push(new THREE.BoxGeometry(w, h * 0.4, d * 0.16).translate(0, h * 0.3, z * d));
      }
      break;
    }
    case 'round': {
      const r = (Math.min(t.studsX, t.studsZ) * STUD) / 2 - GAP;
      parts.push(new THREE.CylinderGeometry(r, r, h, 24));
      studsOnTop();
      break;
    }
    case 'cone': {
      const r = STUD / 2 - GAP;
      parts.push(new THREE.CylinderGeometry(r * 0.55, r, h, 20));
      studsOnTop();
      break;
    }
    case 'dish': {
      // A shallow bowl, open side up, on a small foot.
      const r = (Math.min(t.studsX, t.studsZ) * STUD) / 2 - GAP;
      const points = [
        new THREE.Vector2(0.001, -h / 2),
        new THREE.Vector2(r * 0.35, -h / 2),
        new THREE.Vector2(r, h / 2),
        new THREE.Vector2(r * 0.94, h / 2),
        new THREE.Vector2(0.001, -h / 2 + h * 0.3),
      ];
      parts.push(new THREE.LatheGeometry(points, 24));
      parts.push(
        new THREE.CylinderGeometry(STUD_RADIUS, STUD_RADIUS, h * 0.9, 12).translate(0, 0, 0),
      );
      break;
    }
    case 'slope': {
      // Flat on top over the back row (z = 0), then down at 45 degrees to a lip at the front.
      const back = -d / 2;
      const lip = PLATE_H * 0.8;
      parts.push(
        prism(
          [
            [back, -h / 2],
            [d / 2, -h / 2],
            [d / 2, -h / 2 + lip],
            [back + STUD, h / 2],
            [back, h / 2],
          ],
          w,
        ),
      );
      studsOnTop();
      break;
    }
    case 'cheese':
      parts.push(
        prism(
          [
            [-d / 2, -h / 2],
            [d / 2, -h / 2],
            [d / 2, -h / 2 + h * 0.12],
            [-d / 2, h / 2],
          ],
          w,
        ),
      );
      break;
    case 'curve': {
      const profile: [number, number][] = [
        [-d / 2, -h / 2],
        [d / 2, -h / 2],
      ];
      // A quarter-round top falling from the back to a low front.
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * (Math.PI / 2);
        profile.push([d / 2 - d * (1 - Math.cos(a)), -h / 2 + h * 0.2 + h * 0.8 * Math.sin(a)]);
      }
      profile.push([-d / 2, h / 2]);
      parts.push(prism(profile, w));
      break;
    }
    case 'window': {
      // A frame round the opening (the pane is drawn separately), studs on top.
      const post = STUD * 0.18;
      const rail = PLATE_H * 0.9;
      parts.push(
        new THREE.BoxGeometry(post, h, d).translate(-w / 2 + post / 2, 0, 0),
        new THREE.BoxGeometry(post, h, d).translate(w / 2 - post / 2, 0, 0),
        new THREE.BoxGeometry(w, rail, d).translate(0, h / 2 - rail / 2, 0),
        new THREE.BoxGeometry(w, rail, d).translate(0, -h / 2 + rail / 2, 0),
      );
      studsOnTop();
      break;
    }
    case 'plant': {
      // A short stem and five leaves fanning out and drooping past the cell.
      parts.push(new THREE.CylinderGeometry(STUD * 0.12, STUD * 0.15, h, 8));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const leaf = new THREE.SphereGeometry(STUD * 0.5, 10, 6);
        leaf.scale(0.45, 0.12, 1);
        leaf.rotateX(0.35);
        leaf.translate(0, h * 0.25, STUD * 0.45);
        leaf.rotateY(a);
        parts.push(leaf);
      }
      break;
    }
    case 'quarter': {
      // A quarter disc (or band, with a hole) round the (0, 0) corner, curving out toward +x, +z.
      const r = t.studsX * STUD - GAP;
      const hole = (t.hole ?? 0) * STUD;
      const shape = new THREE.Shape();
      // Drawn in x and -z, so extruding along +z and turning it up stands it on the y axis.
      shape.moveTo(hole, 0);
      shape.lineTo(r, 0);
      shape.absarc(0, 0, r, 0, -Math.PI / 2, true);
      shape.lineTo(0, -hole);
      if (hole > 0) shape.absarc(0, 0, hole, -Math.PI / 2, 0, false);
      else shape.lineTo(0, 0);
      const g = new THREE.ExtrudeGeometry(shape, {
        depth: h,
        bevelEnabled: false,
        curveSegments: 12,
      });
      g.rotateX(-Math.PI / 2);
      g.translate(-w / 2, -h / 2, -d / 2);
      parts.push(g);
      studsOnTop();
      break;
    }
    case 'flower': {
      // Five round petals round a hub with a stud, lying flat.
      parts.push(new THREE.CylinderGeometry(STUD * 0.32, STUD * 0.32, h, 14));
      parts.push(topStud(t, 0.5, 0.5, h));
      for (let i = 0; i < 5; i++) {
        const petal = new THREE.SphereGeometry(STUD * 0.5, 12, 6);
        petal.scale(0.75, (h / STUD) * 0.9, 1);
        petal.translate(0, 0, STUD * 0.5);
        petal.rotateY((i / 5) * Math.PI * 2);
        parts.push(petal);
      }
      break;
    }
    case 'spire': {
      // A round foot, a collar, a thin mast and two pairs of cross arms near the top.
      const foot = PLATE_H - GAP;
      const r = STUD - GAP;
      parts.push(new THREE.CylinderGeometry(r, r, foot, 24).translate(0, -h / 2 + foot / 2, 0));
      const collar = PLATE_H * 2;
      parts.push(
        new THREE.CylinderGeometry(STUD * 0.3, STUD * 0.36, collar, 16).translate(
          0,
          -h / 2 + foot + collar / 2,
          0,
        ),
      );
      const mast = h - foot - collar;
      parts.push(
        new THREE.CylinderGeometry(STUD * 0.06, STUD * 0.12, mast, 10).translate(
          0,
          -h / 2 + foot + collar + mast / 2,
          0,
        ),
      );
      for (const [at, len] of [
        [0.45, 0.7],
        [0.7, 0.5],
      ] as const) {
        const y = -h / 2 + foot + collar + mast * at;
        parts.push(new THREE.BoxGeometry(STUD * len, STUD * 0.08, STUD * 0.08).translate(0, y, 0));
        parts.push(new THREE.BoxGeometry(STUD * 0.08, STUD * 0.08, STUD * len).translate(0, y, 0));
        parts.push(
          new THREE.CylinderGeometry(STUD * 0.16, STUD * 0.16, STUD * 0.1, 12).translate(
            0,
            y - STUD * 0.25,
            0,
          ),
        );
      }
      break;
    }
    default:
      parts.push(new THREE.BoxGeometry(w, h, d));
  }
  parts.push(...sideStudParts(t, h));
  return merge(parts, w, h, d);
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
    const alpha = COLOURS[colour].alpha;
    m = new THREE.MeshStandardMaterial({
      color: drawnHex(colour),
      roughness: alpha ? 0.15 : 0.45,
      ...(alpha ? { transparent: true, opacity: alpha, depthWrite: false } : {}),
    });
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
