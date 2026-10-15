import * as THREE from 'three';
import { bevelBox } from '../render/shapes.ts';
import { Surface } from '../render/styles.ts';
import { C, between, group, mat, part, rng, rope } from './kit.ts';
import { painted } from './paint.ts';
import { flag, lantern } from './props.ts';
import type { Solids } from './walk.ts';

/**
 * The galleon moored in the cove, after the reference: a dark planked hull with heavy wales,
 * a raised forecastle and quarterdeck, three masts with red-and-white striped sails worn ragged
 * at their feet, rigging down to the rails, a crow's nest with its bell and a black flag at the
 * main truck, and the bowsprit's two spars reaching out ahead.
 *
 * In its own space the waterline is y = 0, the bow points along -x and the hull is `LENGTH`
 * long, centred on the origin. Its decks are walked on, reached from the island over the
 * gangway to the gap in its rail on its +z side.
 */

export const LENGTH = 22;
const HALF = LENGTH / 2;
/** The decks' heights over the water: the waist, the forecastle and the quarterdeck. */
export const WAIST = 3.1;
const FORE = 4.3;
const QUARTER = 4.9;
/** Where along the hull (t, -1 at the bow to 1 at the stern) the raised decks begin. */
const FORE_END = -0.56;
const QUARTER_START = 0.42;
/** Where the gangway meets the rail, along the hull (x), and on which side (z). */
export const ENTRY_X = -7.4;
export const ENTRY_SIDE = 1;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The hull's half beam at `t` (-1 bow, 1 stern), at its widest. */
export function beamAt(t: number): number {
  if (t < 0) return Math.max(0.12, 3 * Math.pow(Math.max(0, 1 - t * t), 0.48));
  return 3 - 0.72 * t * t;
}

/** The deck's height at `t`. */
export function deckAt(t: number): number {
  if (t < FORE_END) return FORE;
  if (t > QUARTER_START) return QUARTER;
  return WAIST;
}

/** The top of the hull's side at `t`: up past each raised deck, with a sweep to bow and stern. */
function sheerAt(t: number): number {
  const fore = (FORE - WAIST) * smooth(FORE_END + 0.08, FORE_END - 0.04, t);
  const quarter = (QUARTER - WAIST) * smooth(QUARTER_START - 0.08, QUARTER_START + 0.04, t);
  return (
    WAIST + 0.1 + fore + quarter + 0.5 * Math.max(0, -t - 0.8) + 0.35 * Math.max(0, t - 0.85) * 5
  );
}

/** The keel's depth at `t`, rising to the stem at the bow. */
function keelAt(t: number): number {
  return -2.1 + 3.2 * smooth(-0.7, -1.0, t) + 0.6 * smooth(0.75, 1.0, t);
}

/** How far out the side is at `s` (0 at the keel, 1 at the top), as a share of the beam. */
function bulge(s: number): number {
  if (s < 0.62) return 0.12 + 0.88 * Math.pow(Math.sin((Math.PI / 2) * (s / 0.62)), 0.55);
  return 1 - 0.07 * ((s - 0.62) / 0.38);
}

/** A point on the hull's side at `t`, `s` up it, on the side `side` (±1 in z). */
function hullPoint(t: number, s: number, side: number): THREE.Vector3 {
  const k = keelAt(t);
  const top = sheerAt(t);
  return new THREE.Vector3(t * HALF, k + (top - k) * s, side * beamAt(t) * bulge(s));
}

/**
 * The hull's skin: strakes of planking from keel to sheer, each its own shade, as separate
 * bands so their edges stay crisp; the transom closing the stern.
 */
function hull(g: THREE.Object3D): void {
  const strakes = 14;
  const along = 40;
  const r = rng(77);
  const tones = [0x5a3a26, 0x4c3020, 0x664330, 0x523424];
  const positions: number[] = [];
  const colours: number[] = [];
  const col = new THREE.Color();
  for (const side of [-1, 1]) {
    for (let k = 0; k < strakes; k++) {
      const [s0, s1] = [k / strakes, (k + 1) / strakes];
      // Below the water the hull is darker, weathered; the band at the waterline darker still.
      const base = tones[Math.floor(r() * tones.length)]!;
      for (let i = 0; i < along; i++) {
        const [t0, t1] = [-1 + (2 * i) / along, -1 + (2 * (i + 1)) / along];
        const shade = 0.92 + r() * 0.16;
        col.set(base).multiplyScalar(shade);
        const quad = [
          hullPoint(t0, s0, side),
          hullPoint(t1, s0, side),
          hullPoint(t1, s1, side),
          hullPoint(t0, s1, side),
        ];
        // A groove along each strake's lower edge: the band's lower edge a shade darker.
        const tri = side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
        for (const v of tri) {
          const p = quad[v]!;
          positions.push(p.x, p.y, p.z);
          const groove = v < 2 ? 0.72 : 1;
          colours.push(col.r * groove, col.g * groove, col.b * groove);
        }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geo.computeVertexNormals();
  part(
    g,
    geo,
    mat(0xffffff, Surface.Auto, { vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }),
  );

  // The transom: the flat stern, from keel to sheer.
  const stern: THREE.Vector2[] = [];
  for (let k = 0; k <= strakes; k++) {
    const p = hullPoint(1, k / strakes, 1);
    stern.push(new THREE.Vector2(p.z, p.y));
  }
  for (let k = strakes; k >= 0; k--) {
    const p = hullPoint(1, k / strakes, -1);
    stern.push(new THREE.Vector2(p.z, p.y));
  }
  const transom = new THREE.ShapeGeometry(new THREE.Shape(stern));
  transom.rotateY(Math.PI / 2);
  part(g, transom, mat(0x4a2f20, Surface.Wood, { side: THREE.DoubleSide }), HALF - 0.01, 0, 0);

  // The wales: heavy timbers along the side, and the rail capping the sheer.
  const wale = mat(0x2f1f16, Surface.Wood);
  for (const side of [-1, 1]) {
    for (const s of [0.5, 0.7, 0.86]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 30; i++) {
        const t = -0.97 + (1.96 * i) / 30;
        const p = hullPoint(t, s, side);
        p.z += side * 0.06;
        pts.push(p);
      }
      const m = part(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.11, 6), wale);
      m.scale.y = 1;
    }
    const cap: THREE.Vector3[] = [];
    for (let i = 0; i <= 40; i++) {
      const t = -0.99 + (1.98 * i) / 40;
      cap.push(hullPoint(t, 1, side));
    }
    part(
      g,
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cap), 80, 0.12, 6),
      mat(C.woodLight, Surface.Wood),
    );
  }
}

/**
 * A square sail of vertical red and white stripes hung from a yard `w` wide, `h` deep, bellied
 * out along +z by `belly`, its foot torn into tatters and a few holes worn through it.
 */
function sail(parent: THREE.Object3D, w: number, h: number, belly: number, seed: number): void {
  const r = rng(seed);
  const stripes = Math.max(6, Math.round(w / 1.05));
  const cols = 3;
  const rows = 10;
  const white: number[] = [];
  const red: number[] = [];
  const whiteC: number[] = [];
  const redC: number[] = [];
  const whiteUV: number[] = [];
  const redUV: number[] = [];
  const tone = new THREE.Color();
  /** Weathering: soft darker patches, and grime toward the foot and the edges. */
  const dirt = (u: number, v: number) =>
    0.86 +
    0.1 * Math.sin(u * 11 + v * 5 + seed) * Math.sin(u * 4 - v * 9 + seed * 2) -
    0.1 * v * v -
    0.08 * Math.pow(Math.abs(u - 0.5) * 2, 4);
  const at = (u: number, v: number) => {
    // u across (0..1), v down (0..1). The foot narrows a little, as a sail does under its yard.
    const x = (u - 0.5) * w * (1 - v * 0.08);
    const y = -v * h;
    const z =
      belly * Math.sin(Math.PI * u) * Math.sin(Math.PI * (0.15 + 0.7 * v)) + belly * 0.2 * v;
    return [x, y, z] as const;
  };
  for (let s = 0; s < stripes; s++) {
    const out = s % 2 ? red : white;
    const foot = 1 - r() * 0.22;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        // Worn through here and there.
        if (j > 1 && j < rows - 1 && r() < 0.045) continue;
        const [u0, u1] = [(s + i / cols) / stripes, (s + (i + 1) / cols) / stripes];
        // The torn foot: each column ends at its own depth.
        const end0 = j + 1 === rows ? foot - (i === 1 ? 0.06 + 0.08 * r() : 0.02 * r()) : 1;
        const [v0, v1] = [j / rows, j + 1 === rows ? end0 : (j + 1) / rows];
        const a = at(u0, v0);
        const b = at(u1, v0);
        const c = at(u1, v1);
        const d = at(u0, v1);
        out.push(...a, ...d, ...c, ...a, ...c, ...b);
        (out === red ? redUV : whiteUV).push(
          ...[u0, v0, u0, v1, u1, v1, u0, v0, u1, v1, u1, v0].map(
            (k, n) => (n % 2 ? k * h : k * w) / 3,
          ),
        );
        const shades = out === red ? redC : whiteC;
        for (const [uu, vv] of [
          [u0, v0],
          [u0, v1],
          [u1, v1],
          [u0, v0],
          [u1, v1],
          [u1, v0],
        ] as const) {
          tone.set(out === red ? C.sailRed : C.sailWhite).multiplyScalar(dirt(uu, vv));
          shades.push(tone.r, tone.g, tone.b);
        }
      }
    }
  }
  for (const [list, shades, uvs] of [
    [white, whiteC, whiteUV],
    [red, redC, redUV],
  ] as const) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(shades, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.computeVertexNormals();
    part(parent, geo, painted('cloth', 0xffffff, { side: THREE.DoubleSide, roughness: 0.9 }));
  }
  // A bolt rope along the head.
  between(
    parent,
    new THREE.Vector3(-w / 2, 0, 0),
    new THREE.Vector3(w / 2, 0, 0),
    0.04,
    mat(C.rope, Surface.Fabric),
  );
}

/**
 * A mast stepped at `x` on the deck, `h` tall over the water, with its yards and sails, braced
 * round by `brace` radians (so the sails face the island).
 */
function mast(
  g: THREE.Object3D,
  x: number,
  h: number,
  sails: { y: number; w: number; drop: number }[],
  brace: number,
  seed: number,
  tops: number[],
): THREE.Vector3 {
  const deck = deckAt(x / HALF);
  const spar = mat(0x6a4529, Surface.Wood);
  part(g, new THREE.CylinderGeometry(0.17, 0.32, h - deck, 12), spar, x, deck + (h - deck) / 2, 0);
  // Bands of iron up the mast.
  for (let y = deck + 1; y < h - 2; y += 2.4)
    part(
      g,
      new THREE.CylinderGeometry(0.3, 0.3, 0.12, 12),
      mat(C.iron, Surface.Metal, { metalness: 0.6, roughness: 0.5 }),
      x,
      y,
      0,
    );
  // The tops: platforms partway up, on cross-trees.
  for (const y of tops) {
    part(g, bevelBox(1.6, 0.16, 1.9), mat(C.wood, Surface.Wood), x, y, 0);
    for (const s of [-1, 1])
      part(g, bevelBox(0.18, 0.18, 2.4), mat(C.woodDark, Surface.Wood), x + s * 0.5, y - 0.15, 0);
  }
  const yard = mat(0x5c3b23, Surface.Wood);
  sails.forEach((s, i) => {
    // The yard runs across the hull (along z), braced round about the mast.
    const y = group(g, x, s.y, 0, brace);
    part(y, new THREE.CylinderGeometry(0.11, 0.16, s.w + 1.2, 8), yard, 0, 0, 0, Math.PI / 2);
    part(y, bevelBox(0.45, 0.3, 0.5), mat(C.woodDark, Surface.Wood), -0.1, 0, 0);
    // The sail hangs under it, its face toward the bow, bellied out that way.
    const hang = group(y, -0.3, -0.12, 0, Math.PI / 2);
    sail(hang, s.w, s.drop, -0.9 - s.drop * 0.12, seed * 10 + i);
  });
  return new THREE.Vector3(x, h, 0);
}

/** The galleon, its hull's waterline middle at (`x`, `y`, `z`), its bow toward yaw `yaw`'s -x. */
export function galleon(
  parent: THREE.Object3D,
  solids: Solids,
  x: number,
  y: number,
  z: number,
  yaw: number,
): THREE.Group {
  const g = group(parent, x, y, z, yaw);
  hull(g);

  // The decks: planked floors at each level, filling the hull at that height.
  const deckMat = mat(0x9a6a40, Surface.Wood);
  const deckPiece = (t0: number, t1: number, yy: number) => {
    const shape: THREE.Vector2[] = [];
    const n = 16;
    for (let i = 0; i <= n; i++) {
      const t = t0 + ((t1 - t0) * i) / n;
      shape.push(new THREE.Vector2(t * HALF, beamAt(t) * 0.97));
    }
    for (let i = n; i >= 0; i--) {
      const t = t0 + ((t1 - t0) * i) / n;
      shape.push(new THREE.Vector2(t * HALF, -beamAt(t) * 0.97));
    }
    const geo = new THREE.ExtrudeGeometry(new THREE.Shape(shape), {
      depth: 0.2,
      bevelEnabled: false,
    });
    geo.rotateX(Math.PI / 2);
    // Extruded down from the deck's top.
    geo.translate(0, yy, 0);
    part(g, geo, deckMat);
  };
  deckPiece(-0.995, FORE_END, FORE);
  deckPiece(FORE_END, QUARTER_START, WAIST);
  deckPiece(QUARTER_START, 0.995, QUARTER);
  // The faces where the raised decks step down to the waist: bulkheads with a door and windows.
  const bulk = mat(0x5a3a26, Surface.Wood);
  for (const [t, top] of [
    [FORE_END, FORE],
    [QUARTER_START, QUARTER],
  ] as const) {
    const w = beamAt(t) * 0.97 * 2;
    part(g, bevelBox(0.2, top - WAIST, w), bulk, t * HALF, (top + WAIST) / 2, 0);
    part(g, bevelBox(0.3, 0.2, w + 0.1), mat(C.woodLight, Surface.Wood), t * HALF, top + 0.05, 0);
  }
  // The quarterdeck's windows facing forward, glowing, and its door.
  const glow = new THREE.MeshStandardMaterial({
    color: 0xffd36e,
    emissive: 0xf6b33c,
    emissiveIntensity: 1.2,
  });
  for (const zz of [-1.6, 1.6])
    part(
      g,
      new THREE.PlaneGeometry(0.6, 0.6),
      glow,
      QUARTER_START * HALF - 0.11,
      WAIST + 1.0,
      zz,
      0,
      -Math.PI / 2,
    );
  // Stairs up to the raised decks, beside the masts, and where they start and end (for tests).
  const stairs = (t: number, dir: 1 | -1, top: number, z: number) => {
    const x0 = t * HALF;
    const steps = Math.round((top - WAIST) / 0.25);
    const run = 0.3;
    for (let i = 0; i < steps; i++) {
      const sx = x0 - dir * (steps - i) * run + dir * run * 0.5;
      part(
        g,
        bevelBox(run + 0.04, 0.1, 1.2),
        mat(C.woodLight, Surface.Wood),
        sx,
        WAIST + (i + 1) * ((top - WAIST) / steps) - 0.05,
        z,
      );
    }
    for (const s of [-1, 1])
      between(
        g,
        new THREE.Vector3(x0 - dir * steps * run, WAIST + 0.9, z + s * 0.62),
        new THREE.Vector3(x0, top + 0.9, z + s * 0.62),
        0.05,
        mat(C.woodDark, Surface.Wood),
      );
    solids.ramp(
      g,
      x0 - (dir * steps * run) / 2,
      z,
      1.2,
      steps * run,
      WAIST,
      top,
      dir > 0 ? Math.PI / 2 : -Math.PI / 2,
    );
    return [
      new THREE.Vector3(x0 - dir * (steps * run + 0.6), WAIST, z),
      new THREE.Vector3(x0 + dir * 0.8, top, z),
    ];
  };
  g.userData.quarterStair = stairs(QUARTER_START, 1, QUARTER, 1.3);
  g.userData.foreStair = stairs(FORE_END, -1, FORE, 1.3);

  // Bulwarks round the decks: boards between stanchions, a gap at the entry port.
  const bulwark = mat(0x5e3d27, Surface.Wood);
  const railMat = mat(C.woodLight, Surface.Wood);
  for (const side of [-1, 1]) {
    const n = 34;
    for (let i = 0; i < n; i++) {
      const [t0, t1] = [-0.97 + (1.94 * i) / n, -0.97 + (1.94 * (i + 1)) / n];
      const xm = ((t0 + t1) / 2) * HALF;
      if (side === ENTRY_SIDE && Math.abs(xm - ENTRY_X) < 0.9) continue;
      const tm = (t0 + t1) / 2;
      const d = deckAt(tm);
      const a = new THREE.Vector3(t0 * HALF, d, side * beamAt(t0) * 0.95);
      const b = new THREE.Vector3(t1 * HALF, d, side * beamAt(t1) * 0.95);
      const len = a.distanceTo(b);
      const panel = part(
        g,
        bevelBox(len + 0.02, 0.9, 0.1),
        bulwark,
        (a.x + b.x) / 2,
        d + 0.45,
        (a.z + b.z) / 2,
      );
      panel.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      const rail = part(
        g,
        bevelBox(len + 0.04, 0.12, 0.2),
        railMat,
        (a.x + b.x) / 2,
        d + 0.95,
        (a.z + b.z) / 2,
      );
      rail.rotation.y = panel.rotation.y;
      if (i % 3 === 0)
        part(g, bevelBox(0.14, 1.05, 0.14), mat(C.woodDark, Surface.Wood), a.x, d + 0.5, a.z);
      solids.box(g, (a.x + b.x) / 2, d, (a.z + b.z) / 2, len + 0.05, 1.0, 0.25, panel.rotation.y);
    }
  }
  // Cannons run out through the side facing the island.
  for (const gx of [-4.5, 0.6, 3.2]) {
    const t = gx / HALF;
    const pz = beamAt(t) * bulge(0.78) + 0.05;
    const py = keelAt(t) + (sheerAt(t) - keelAt(t)) * 0.78;
    part(g, bevelBox(0.7, 0.6, 0.08), mat(0x2a1a12, Surface.Wood), gx, py, pz);
    part(
      g,
      new THREE.CylinderGeometry(0.13, 0.16, 1.0, 12),
      mat(0x34383e, Surface.Metal, { metalness: 0.7, roughness: 0.45 }),
      gx,
      py,
      pz + 0.3,
      Math.PI / 2,
    );
  }
  // The stern: a row of glowing windows, a lantern at each corner of the taffrail.
  for (const zz of [-1.2, -0.4, 0.4, 1.2]) {
    part(
      g,
      new THREE.PlaneGeometry(0.55, 0.7),
      glow,
      HALF + 0.03,
      QUARTER - 0.9,
      zz,
      0,
      Math.PI / 2,
    );
    part(
      g,
      bevelBox(0.1, 0.9, 0.1),
      mat(C.woodDark, Surface.Wood),
      HALF + 0.05,
      QUARTER - 0.9,
      zz + 0.4,
    );
  }
  for (const zz of [-1.9, 1.9]) {
    part(
      g,
      bevelBox(0.16, 0.9, 0.16),
      mat(C.woodDark, Surface.Wood),
      HALF - 0.4,
      QUARTER + 1.35,
      zz,
    );
    lantern(g, HALF - 0.4, QUARTER + 1.8, zz, 0.6);
  }
  // The stem post and the bowsprit's two spars reaching up and ahead.
  between(
    g,
    new THREE.Vector3(-HALF + 0.3, 0.2, 0),
    new THREE.Vector3(-HALF - 0.6, FORE + 1.0, 0),
    0.22,
    mat(C.woodDark, Surface.Wood),
  );
  const bsp = mat(0x3a2a20, Surface.Wood);
  const bowA = new THREE.Vector3(-HALF + 0.8, FORE + 0.6, 0.18);
  const bowTip = new THREE.Vector3(-HALF - 6.0, FORE + 3.4, 0.35);
  between(g, bowA, bowTip, 0.24, bsp, 0.14, 10);
  between(
    g,
    bowA.clone().add(new THREE.Vector3(0, 0.55, -0.2)),
    bowTip.clone().add(new THREE.Vector3(-1.5, 1.2, -0.4)),
    0.17,
    bsp,
    0.1,
    10,
  );
  for (const f of [0.35, 0.7]) band(g, bowA.clone().lerp(bowTip, f), 0.27);

  // The masts and their sails, braced round toward the island.
  const brace = 0.7;
  const fore = mast(
    g,
    -6.4,
    20.5,
    [
      { y: 18.2, w: 8.0, drop: 4.4 },
      { y: 13.0, w: 10.0, drop: 4.8 },
    ],
    brace,
    1,
    [12.6],
  );
  const main = mast(
    g,
    0.2,
    25,
    [
      { y: 21.2, w: 9.0, drop: 4.9 },
      { y: 15.4, w: 11.2, drop: 5.4 },
    ],
    brace,
    2,
    [14.9],
  );
  const mizzen = mast(
    g,
    6.6,
    18.5,
    [
      { y: 16.2, w: 7.2, drop: 4.0 },
      { y: 11.4, w: 7.8, drop: 3.8 },
    ],
    brace + 0.1,
    3,
    [11.1],
  );
  solids.post(g, -6.4, 0, 0.32, 0, 20);
  solids.post(g, 0.2, 0, 0.34, 0, 24);
  solids.post(g, 6.6, 0, 0.32, 0, 18);

  // The crow's nest on the main: a tub with a rail, and above it the bell and the black flag.
  const nest = 22.3;
  part(
    g,
    new THREE.CylinderGeometry(0.9, 0.7, 0.8, 14, 1, true),
    mat(C.wood, Surface.Wood, { side: THREE.DoubleSide }),
    0.2,
    nest,
    0,
  );
  part(
    g,
    new THREE.TorusGeometry(0.9, 0.07, 6, 16),
    mat(C.woodDark, Surface.Wood),
    0.2,
    nest + 0.4,
    0,
    Math.PI / 2,
  );
  part(g, bevelBox(1.4, 0.14, 0.24), mat(C.woodDark, Surface.Wood), 0.2, nest + 1.2, 0);
  const bell = new THREE.LatheGeometry(
    [
      [0, 0.32],
      [0.08, 0.32],
      [0.14, 0.27],
      [0.17, 0.12],
      [0.23, 0.0],
      [0.24, -0.04],
    ]
      .map(([a, b]) => new THREE.Vector2(a!, b!))
      .reverse(),
    16,
  );
  part(
    g,
    bell,
    mat(0xd2a23a, Surface.Metal, { metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide }),
    0.75,
    nest + 0.75,
    0,
  );
  between(
    g,
    new THREE.Vector3(0.75, nest + 1.15, 0),
    new THREE.Vector3(0.75, nest + 1.05, 0),
    0.03,
    mat(C.iron, Surface.Metal),
  );
  flag(g, 0.25, main.y + 1.9, 0, 2.2, 1.2, C.flagBlack, -Math.PI / 2 + 0.5, 23);
  part(
    g,
    new THREE.CylinderGeometry(0.06, 0.08, 2.2, 8),
    mat(C.woodDark, Surface.Wood),
    0.2,
    main.y + 1.0,
    0,
  );
  part(
    g,
    new THREE.SphereGeometry(0.13, 10, 8),
    mat(0xd2a23a, Surface.Metal, { metalness: 0.8, roughness: 0.3 }),
    0.2,
    main.y + 2.15,
    0,
  );
  flag(g, -6.35, fore.y + 0.5, 0, 1.0, 0.5, C.flagRed, -Math.PI / 2 + 0.6, 29);
  part(
    g,
    new THREE.CylinderGeometry(0.05, 0.06, 1.0, 8),
    mat(C.woodDark, Surface.Wood),
    -6.4,
    fore.y + 0.2,
    0,
  );

  // The rigging: shrouds from each mast's tops down to the rails, stays between the masts and
  // out to the bowsprit.
  const lines = mat(0x3b2c22, Surface.Fabric);
  for (const [m, high] of [
    [fore, 12.6],
    [main, 14.9],
    [mizzen, 11.1],
  ] as const) {
    for (const side of [-1, 1]) {
      for (const dx of [-1.4, -0.4, 0.6]) {
        const t = (m.x + dx) / HALF;
        const foot = new THREE.Vector3(m.x + dx, deckAt(t) + 1.0, side * beamAt(t) * 1.0);
        between(g, foot, new THREE.Vector3(m.x, high, side * 0.8), 0.025, lines, 0.025, 4);
      }
    }
    between(
      g,
      new THREE.Vector3(m.x, high + 0.1, 0),
      new THREE.Vector3(m.x, m.y - 0.5, 0),
      0.03,
      lines,
      0.03,
      4,
    );
  }
  between(
    g,
    new THREE.Vector3(main.x, main.y - 1, 0),
    new THREE.Vector3(fore.x, 12.7, 0),
    0.03,
    lines,
    0.03,
    4,
  );
  between(g, new THREE.Vector3(fore.x, fore.y - 0.7, 0), bowTip, 0.03, lines, 0.03, 4);
  between(
    g,
    new THREE.Vector3(fore.x, 12.5, 0),
    bowA.clone().lerp(bowTip, 0.6),
    0.03,
    lines,
    0.03,
    4,
  );
  between(
    g,
    new THREE.Vector3(mizzen.x, mizzen.y - 0.6, 0),
    new THREE.Vector3(main.x, 15.0, 0),
    0.03,
    lines,
    0.03,
    4,
  );
  rope(
    g,
    new THREE.Vector3(-HALF + 1, FORE + 1.0, 1.2),
    new THREE.Vector3(-HALF - 3, FORE + 2.2, 0.3),
    0.4,
    0.03,
    lines,
  );
  rope(
    g,
    new THREE.Vector3(-HALF + 1, FORE + 1.0, -1.2),
    new THREE.Vector3(-HALF - 3, FORE + 2.2, 0.3),
    0.4,
    0.03,
    lines,
  );

  // Below the decks the hull is solid: blocks under each deck along its length, each deck's
  // ending where it steps up or down.
  for (const [a, b] of [
    [-0.98, FORE_END],
    [FORE_END, QUARTER_START],
    [QUARTER_START, 0.98],
  ] as const) {
    const n = Math.max(2, Math.round(((b - a) * HALF) / 1.0));
    for (let i = 0; i < n; i++) {
      const [t0, t1] = [a + ((b - a) * i) / n, a + ((b - a) * (i + 1)) / n];
      const w = Math.min(beamAt(t0), beamAt(t1)) * 2 * 0.95;
      solids.box(
        g,
        ((t0 + t1) / 2) * HALF,
        -3,
        0,
        (t1 - t0) * HALF + 0.02,
        deckAt((t0 + t1) / 2) + 3,
        Math.max(w, 0.4),
      );
    }
  }
  return g;
}

/** An iron band round a spar at `p`. */
function band(g: THREE.Object3D, p: THREE.Vector3, r: number): void {
  const m = part(
    g,
    new THREE.TorusGeometry(r, 0.04, 6, 14),
    mat(C.iron, Surface.Metal, { metalness: 0.6, roughness: 0.5 }),
    p.x,
    p.y,
    p.z,
  );
  m.rotation.y = Math.PI / 2;
}
