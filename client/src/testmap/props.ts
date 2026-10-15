import * as THREE from 'three';
import { group, rng } from './kit.ts';
import { painted } from './paint.ts';
import {
  WOOD,
  WOOD_DARK,
  WOOD_PALE,
  hangingLantern,
  ironCap,
  lashing,
  nextSeed,
  put,
  rivet,
  timber,
} from './parts.ts';
import { block, finish, rod } from './shape.ts';
import type { Solids } from './walk.ts';

/**
 * The island's props, in the reference picture's chunky hand-painted style: the great cannon,
 * its barrel flared and ringed, on a stepped carriage bound in riveted iron; barrels with
 * bellied staves and iron hoops; crates, sacks, green bottles; iron lanterns hanging from
 * posts; tattered flags; rope rails on posts; a plank walkway.
 */

const ironMat = () => painted('iron', 0xffffff, { roughness: 0.62 });
/** The cannon's barrel: dark blue-grey iron with a soft sheen. */
const gunMetal = () => painted('iron', 0x6f6f6d, { roughness: 0.42, metalness: 0.1 });
const ropeMat = () => painted('cloth', 0xc9a87a, { roughness: 0.95 });

/** A lathe turned about y: `profile` is [radius, height] from the bottom up. */
function lathe(profile: [number, number][], sides: number): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    profile.map(([r, h]) => new THREE.Vector2(r, h)),
    sides,
  );
}

/** A rope sagging `sag` at its middle from `a` to `b`. */
export function ropeLine(
  parent: THREE.Object3D,
  a: THREE.Vector3,
  b: THREE.Vector3,
  sag: number,
  r = 0.035,
): void {
  const n = Math.max(3, Math.ceil(a.distanceTo(b) / 0.5));
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(
      a
        .clone()
        .lerp(b, t)
        .setY(a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t)),
    );
  }
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 3, r, 6, false);
  put(parent, finish(geo, 'cloth', { edge: 0, shade: 0.15, seed: nextSeed() }, 'none'), ropeMat());
}

/**
 * The great cannon: a long iron barrel thick at the breech, ringed with raised bands and flared
 * at the muzzle, on a stepped wooden carriage strapped and bolted with iron, on four small iron
 * wheels. It points along its own -z, its foot's middle at the origin.
 */
export function cannon(
  parent: THREE.Object3D,
  solids: Solids | null,
  x: number,
  y: number,
  z: number,
  yaw: number,
  scale = 1,
): THREE.Group {
  const g = group(parent, x, y, z, yaw);
  g.scale.setScalar(scale);
  const bedY = 0.4;
  // The carriage's bed and its two stepped cheeks, each step its own chunky block.
  timber(g, 0, bedY, 0.15, 0.95, 0.2, 2.1, { tint: WOOD_DARK, grain: 2 });
  for (const s of [-1, 1]) {
    const cx = s * 0.45;
    timber(g, cx, bedY + 0.34, 0.15, 0.2, 0.5, 2.0, { tint: WOOD, grain: 2 });
    timber(g, cx, bedY + 0.72, 0.5, 0.2, 0.32, 1.25, { tint: WOOD, grain: 2 });
    timber(g, cx, bedY + 0.98, 0.82, 0.2, 0.24, 0.62, { tint: WOOD_PALE, grain: 2 });
    // Iron straps over the cheek, with rivets, and iron at its front end.
    for (const zz of [-0.45, 0.35])
      ironCap(g, cx, bedY + 0.42, zz, 0.26, 0.66, 0.1, { rivets: false });
    for (const [yy, zz] of [
      [0.25, -0.2],
      [0.55, -0.2],
      [0.25, 0.65],
      [0.75, 0.6],
      [1.0, 0.95],
    ] as const)
      rivet(g, new THREE.Vector3(cx + s * 0.1, bedY + yy, zz), new THREE.Vector3(s, 0, 0), 0.045);
    ironCap(g, cx, bedY + 0.34, -0.83, 0.26, 0.56, 0.14, { rivets: false });
    // The wheels: solid iron discs with a raised rim and a hub.
    for (const [zz, rad] of [
      [-0.62, 0.36],
      [0.82, 0.33],
    ] as const) {
      const w = group(g, s * 0.66, rad, zz);
      w.rotation.z = Math.PI / 2;
      put(
        w,
        rod(rad * 0.9, rad * 0.9, 0.18, 'iron', { seed: nextSeed(), bevel: 0.03, sides: 20 }),
        ironMat(),
      );
      put(
        w,
        finish(
          new THREE.TorusGeometry(rad * 0.92, 0.05, 6, 22),
          'iron',
          { edge: 0, seed: nextSeed() },
          'none',
        ),
        ironMat(),
        0,
        0,
        0,
        Math.PI / 2,
      );
      put(
        w,
        rod(rad * 0.32, rad * 0.32, 0.3, 'iron', { seed: nextSeed(), bevel: 0.03 }),
        painted('iron', 0x9a9c9e, { roughness: 0.6 }),
        0,
        s * 0.03,
        0,
      );
      put(w, rod(0.06, 0.06, 0.4, 'iron', { seed: nextSeed() }), ironMat(), 0, s * 0.12, 0);
    }
  }
  // The axletrees.
  for (const [zz, h] of [
    [-0.62, 0.36],
    [0.82, 0.33],
  ] as const)
    timber(g, 0, h, zz, 1.3, 0.2, 0.22, { tint: WOOD_DARK, grain: 0 });

  // The barrel, resting on the cheeks by its trunnions, its muzzle raised a little.
  const b = group(g, 0, bedY + 1.06, 0.5);
  b.rotation.x = 0.07;
  const profile: [number, number][] = [
    [0, -0.6],
    [0.1, -0.58],
    [0.11, -0.5],
    [0.06, -0.47],
    [0.06, -0.42],
    [0.22, -0.4],
    [0.33, -0.3],
    [0.37, -0.15],
    [0.38, 0.0],
    [0.4, 0.02],
    [0.4, 0.1],
    [0.37, 0.12],
    [0.36, 0.7],
    [0.38, 0.72],
    [0.38, 0.8],
    [0.34, 0.82],
    [0.31, 1.8],
    [0.33, 1.82],
    [0.33, 1.9],
    [0.29, 1.92],
    [0.27, 2.45],
    [0.3, 2.55],
    [0.38, 2.68],
    [0.4, 2.78],
    [0.39, 2.84],
    [0.14, 2.86],
    [0.12, 2.6],
  ];
  const barrelGeo = finish(
    lathe(profile, 28),
    'iron',
    { grain: 1, edge: 0, shade: 0.1, seed: nextSeed() },
    'none',
  );
  barrelGeo.rotateX(-Math.PI / 2);
  put(b, barrelGeo, gunMetal());
  // The trunnions it rests on, and their caps.
  put(
    b,
    rod(0.1, 0.1, 1.0, 'iron', { seed: nextSeed() }),
    gunMetal(),
    0,
    -0.05,
    -0.85,
    0,
    0,
    Math.PI / 2,
  );
  for (const s of [-1, 1]) ironCap(b, s * 0.45, 0.02, -0.85, 0.24, 0.12, 0.3, { rivets: false });

  // A coil of rope on the bed behind the breech.
  for (let i = 0; i < 3; i++)
    put(
      g,
      finish(
        new THREE.TorusGeometry(0.22, 0.055, 6, 16),
        'cloth',
        { edge: 0, seed: nextSeed() },
        'none',
      ),
      ropeMat(),
      -0.05,
      bedY + 0.18 + i * 0.08,
      1.35,
      Math.PI / 2 + (i - 1) * 0.12,
    );
  if (solids) {
    // Registered in the scaled frame: its points scale, so the sizes are scaled to match.
    solids.box(g, 0, 0, 0.1, 1.5 * scale, 1.2 * scale, 2.2 * scale);
    solids.box(g, 0, 1.0, -1.2, 0.6 * scale, 0.6 * scale, 1.6 * scale);
  }
  return g;
}

/**
 * A barrel `h` high, its staves bellied out and painted as boards, bound with thick iron hoops,
 * a lid of boards; lying on its side when `lying`.
 */
export function barrel(
  parent: THREE.Object3D,
  solids: Solids | null,
  x: number,
  y: number,
  z: number,
  h = 0.95,
  yaw = 0,
  lying = false,
): THREE.Group {
  const g = group(parent, x, y, z, yaw);
  const inner = group(g, 0, lying ? h * 0.38 : 0, 0);
  if (lying) {
    inner.rotation.z = Math.PI / 2;
    inner.position.x = h / 2;
  }
  const r = h * 0.38;
  const at = (t: number) => r * (0.84 + 0.16 * Math.sin(Math.PI * t));
  const prof: [number, number][] = [[0, 0.02]];
  for (let i = 0; i <= 10; i++) prof.push([at(i / 10), (i / 10) * h]);
  prof.push([at(1) - 0.04, h], [at(1) - 0.05, h - 0.05], [0, h - 0.05]);
  const seed = nextSeed();
  put(
    inner,
    finish(lathe(prof, 16), 'boards', { grain: 1, edge: 0, shade: 0.35, seed, vary: 0.12 }, 'none'),
    painted('boards', WOOD),
  );
  for (const t of [0.1, 0.32, 0.68, 0.9]) {
    const rr = at(t) + 0.02;
    put(
      inner,
      rod(rr, rr, 0.075, 'iron', { seed: nextSeed(), bevel: 0.015, sides: 18 }),
      ironMat(),
      0,
      t * h,
      0,
    );
  }
  if (solids) {
    if (lying) solids.box(g, 0, 0, 0, h, r * 2, r * 2);
    else solids.post(g, 0, 0, r * 0.95, 0, h);
  }
  return g;
}

/** A wooden crate of boards in a heavy frame with iron corners, `s` on a side. */
export function crate(
  parent: THREE.Object3D,
  solids: Solids | null,
  x: number,
  y: number,
  z: number,
  s = 0.7,
  yaw = 0,
): THREE.Group {
  const g = group(parent, x, y, z, yaw);
  timber(g, 0, s / 2, 0, s * 0.92, s * 0.92, s * 0.92, {
    paint: 'boards',
    tint: WOOD_PALE,
    grain: 0,
    edge: 0.3,
  });
  const f = 0.11;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      timber(g, (sx * (s - f)) / 2, s / 2, (sz * (s - f)) / 2, f, s, f, {
        tint: WOOD_DARK,
        grain: 1,
      });
  for (const yy of [f / 2, s - f / 2])
    for (const sz of [-1, 1]) {
      timber(g, 0, yy, (sz * (s - f)) / 2, s, f, f, { tint: WOOD_DARK, grain: 0 });
      timber(g, (sz * (s - f)) / 2, yy, 0, f, f, s, { tint: WOOD_DARK, grain: 2 });
    }
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      ironCap(g, (sx * (s - f)) / 2, s - 0.08, (sz * (s - f)) / 2, f + 0.05, 0.14, f + 0.05, {
        rivets: false,
      });
  if (solids) solids.box(g, 0, 0, 0, s, s, s);
  return g;
}

/** A sack of sacking slumped on the ground, tied at its neck. */
export function sack(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  s = 0.6,
  yaw = 0,
  seed = 1,
): THREE.Group {
  const r = rng(seed);
  const g = group(parent, x, y, z, yaw);
  const body = new THREE.SphereGeometry(s * 0.5, 14, 10);
  const pos = body.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const py = pos.getY(i);
    const k = py < 0 ? 1.15 : 1 - (py / (s * 0.5)) * 0.3;
    pos.setXYZ(i, pos.getX(i) * k * (1 + (r() - 0.5) * 0.08), py * 0.85, pos.getZ(i) * k);
  }
  body.computeVertexNormals();
  const cloth = painted('cloth', 0xe7c48c, { roughness: 0.95 });
  put(
    g,
    finish(body, 'cloth', { edge: 0, shade: 0.45, seed: nextSeed() }, 'none'),
    cloth,
    0,
    s * 0.42,
    0,
  );
  put(g, rod(s * 0.2, s * 0.12, s * 0.22, 'cloth', { seed: nextSeed() }), cloth, 0, s * 0.88, 0);
  put(
    g,
    finish(new THREE.ConeGeometry(s * 0.2, s * 0.2, 8), 'cloth', { seed: nextSeed() }, 'none'),
    cloth,
    0,
    s * 1.06,
    0,
    Math.PI,
  );
  put(
    g,
    finish(
      new THREE.TorusGeometry(s * 0.15, 0.03, 5, 12),
      'cloth',
      { edge: 0, seed: nextSeed() },
      'none',
    ),
    ropeMat(),
    0,
    s * 0.86,
    0,
    Math.PI / 2,
  );
  return g;
}

const glass = new THREE.MeshStandardMaterial({
  color: 0x2f8a3c,
  roughness: 0.12,
  metalness: 0.1,
  emissive: 0x0d4a16,
  emissiveIntensity: 0.7,
});

/** A green glass bottle with a cork, standing (or lying, `lying`). */
export function bottle(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  h = 0.32,
  lying = false,
  yaw = 0,
): void {
  const g = group(parent, x, y, z, yaw);
  const r = h * 0.22;
  const pts: [number, number][] = [
    [0, 0],
    [r, 0],
    [r * 1.05, h * 0.08],
    [r, h * 0.55],
    [r * 0.45, h * 0.72],
    [r * 0.36, h * 0.92],
    [r * 0.42, h * 0.95],
    [r * 0.4, h],
    [0, h],
  ];
  put(g, lathe(pts, 12), glass);
  put(
    g,
    rod(r * 0.36, r * 0.36, h * 0.12, 'wood', { seed: nextSeed() }),
    painted('wood', WOOD_PALE),
    0,
    h + 0.03,
    0,
  );
  if (lying) {
    g.rotation.z = Math.PI / 2;
    g.position.y += r;
  }
}

/** An iron lantern standing on its foot at the origin, `s` high (see `hangingLantern`). */
export function lantern(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  s = 0.5,
  yaw = 0,
): THREE.Group {
  const g = group(parent, x, y, z, yaw);
  const k = s / 0.85;
  hangingLantern(g, 0, 0.82 * k, 0, k, 0);
  return g;
}

/**
 * A lantern on a post: a chunky upright with an arm out at the top braced by a strut, iron at
 * its joints, the lantern hanging from the arm's end. Its foot at the origin, the arm reaching
 * along -z.
 */
export function lanternPost(
  parent: THREE.Object3D,
  solids: Solids | null,
  x: number,
  y: number,
  z: number,
  h = 2.4,
  yaw = 0,
): THREE.Group {
  const g = group(parent, x, y, z, yaw);
  timber(g, 0, h / 2 - 0.15, 0, 0.26, h + 0.3, 0.26, { tint: WOOD_DARK, grain: 1, rz: 0.02 });
  timber(g, 0, h - 0.15, -0.42, 0.18, 0.2, 1.0, { tint: WOOD, grain: 2 });
  const brace = timber(g, 0, h - 0.5, -0.24, 0.12, 0.6, 0.12, { tint: WOOD, grain: 1 });
  brace.rotation.x = -0.75;
  ironCap(g, 0, h - 0.15, 0, 0.34, 0.3, 0.34);
  ironCap(g, 0, 0.15, 0, 0.34, 0.26, 0.34, { rivets: false });
  ironCap(g, 0, h - 0.15, -0.86, 0.24, 0.26, 0.16, { rivets: false });
  lashing(g, 0, h * 0.45, 0, 0.13, 2);
  hangingLantern(g, 0, h - 0.27, -0.82, 0.95, 0.15);
  if (solids) solids.post(g, 0, 0, 0.16, -0.5, h);
  return g;
}

/**
 * A flag on a pole: cloth waving out along +x from the pole's top, its fly end torn into
 * tatters, stained.
 */
export function flag(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  hex: number,
  yaw = 0,
  seed = 3,
): THREE.Group {
  const r = rng(seed);
  const g = group(parent, x, y, z, yaw);
  const cols = 12;
  const rows = 6;
  const positions: number[] = [];
  const indices: number[] = [];
  const tatter = Array.from({ length: rows + 1 }, () => 0.7 + r() * 0.3);
  for (let i = 0; i <= cols; i++) {
    for (let j = 0; j <= rows; j++) {
      const u = i / cols;
      const vv = j / rows;
      const len = u * w * (u > 0.6 ? 1 + (tatter[j]! - 1) * ((u - 0.6) / 0.4) : 1);
      positions.push(
        len,
        -vv * h * (1 - u * 0.15) - u * u * 0.15,
        Math.sin(u * 6 + vv * 1.5) * 0.14 * u,
      );
    }
  }
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j;
      if (i > cols * 0.65 && (j === 1 || j === 4) && r() < 0.7) continue;
      indices.push(a, a + rows + 1, a + 1, a + 1, a + rows + 1, a + rows + 2);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  put(
    g,
    finish(geo, 'cloth', { grain: 0, edge: 0, shade: 0.25, seed: nextSeed() }, 'none'),
    painted('cloth', hex, { side: THREE.DoubleSide, roughness: 0.9 }),
  );
  return g;
}

/**
 * Rope rails on posts along `points` (each a post): two ropes sagging between each pair, as the
 * rope fence round the beach and the walkway's sides are.
 */
export function ropeRail(
  parent: THREE.Object3D,
  solids: Solids | null,
  points: THREE.Vector3[],
  h = 1.05,
): void {
  for (const p of points) {
    const post = timber(parent, p.x, p.y + (h + 0.3) / 2 - 0.3, p.z, 0.2, h + 0.3, 0.2, {
      tint: WOOD_DARK,
      grain: 1,
    });
    post.rotation.set(((p.z * 7) % 1) * 0.08 - 0.04, (p.x * 7) % 1, ((p.x * 5) % 1) * 0.08 - 0.04);
    put(
      parent,
      rod(0.13, 0.11, 0.1, 'wood', { seed: nextSeed() }),
      painted('wood', WOOD_PALE),
      p.x,
      p.y + h + 0.02,
      p.z,
    );
    lashing(parent, p.x, p.y + h - 0.1, p.z, 0.1, 2);
    if (solids) solids.post(parent, p.x, p.z, 0.1, p.y - 0.3, p.y + h);
  }
  for (let i = 0; i + 1 < points.length; i++) {
    const [a, b] = [points[i]!, points[i + 1]!];
    for (const yy of [h - 0.1, h * 0.55])
      ropeLine(parent, a.clone().setY(a.y + yy), b.clone().setY(b.y + yy), 0.14, 0.035);
  }
}

/** A board hung from an iron bracket, as a shop sign. */
export function sign(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  yaw = 0,
): THREE.Group {
  const g = group(parent, x, y, z, yaw);
  put(g, block(0.9, 0.08, 0.08, 'iron', { seed: nextSeed() }), ironMat(), 0.45, 0, 0);
  timber(g, 0.45, -0.45, 0, 0.8, 0.5, 0.08, { tint: WOOD_PALE, rz: 0.05, grain: 0 });
  return g;
}

/** Planks laid as a walkway from `a` to `b` (their middles, on top), `w` wide. */
export function walkway(
  parent: THREE.Object3D,
  solids: Solids | null,
  a: THREE.Vector3,
  b: THREE.Vector3,
  w: number,
): THREE.Group {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const yaw = Math.atan2(b.x - a.x, b.z - a.z);
  const g = group(parent, a.x, a.y, a.z, yaw);
  const n = Math.round(len / 0.36);
  const r = rng(Math.round(a.x * 100));
  const rise = b.y - a.y;
  const tilt = -Math.atan2(rise, len);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const plank = timber(
      g,
      (r() - 0.5) * 0.1,
      rise * t - 0.05,
      len * t,
      w * (0.88 + r() * 0.14),
      0.1,
      0.3,
      {
        tint: [WOOD, WOOD_PALE, WOOD_DARK][i % 3],
        grain: 0,
        ry: (r() - 0.5) * 0.1,
      },
    );
    plank.rotation.x = tilt + (r() - 0.5) * 0.04;
  }
  // The two stringers under the planks.
  for (const s of [-1, 1]) {
    const st = timber(
      g,
      (s * w) / 2.6,
      rise / 2 - 0.16,
      len / 2,
      0.14,
      0.2,
      Math.hypot(len, rise),
      { tint: WOOD_DARK, grain: 2 },
    );
    st.rotation.x = tilt;
  }
  if (solids) solids.ramp(g, 0, len / 2, w, len, 0, rise);
  return g;
}
