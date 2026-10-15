import * as THREE from 'three';
import { bevelBox } from '../render/shapes.ts';
import { Surface } from '../render/styles.ts';
import { C, between, group, mat, part, rng } from './kit.ts';
import { mergeAll } from './nature.ts';
import { bottle, flag, lantern, sign } from './props.ts';
import type { Solids } from './walk.ts';

/**
 * The island's two buildings, after the reference: the tall timber-framed house (a plank ground
 * floor, a plastered upper floor jettied out over it, a steep roof of chunky blue-violet
 * shingles with a cross gable, great rough caps on its ridge beams, iron brackets at every
 * joint, glowing lattice windows, a balcony reached by an outside stair) and the small shop
 * beside it with its round window, double door and red-roofed gable.
 */

const wood = (hex: number = C.wood) => mat(hex, Surface.Wood);
const iron = () => mat(C.iron, Surface.Metal, { roughness: 0.5, metalness: 0.6 });
const ironLight = () => mat(C.ironLight, Surface.Metal, { roughness: 0.45, metalness: 0.6 });
const plaster = () => mat(C.plaster, Surface.Wall, { roughness: 0.95 });

/** A timber `sx × sy × sz` with its middle at (`x`, `y`, `z`). */
function beam(
  g: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  hex: number = C.woodDark,
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.Mesh {
  return part(g, bevelBox(sx, sy, sz), wood(hex), x, y, z, rx, ry, rz);
}

/**
 * An iron bracket wrapped round the corner of a timber: two plates at right angles, `s` long,
 * with bolt heads. `nx`, `nz` say which faces of an upright it covers (±1 each).
 */
function bracket(
  g: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  nx: number,
  nz: number,
  s = 0.4,
  w = 0.2,
): void {
  const t = 0.04;
  part(g, bevelBox(t, s, w), iron(), x + nx * 0.02, y, z);
  part(g, bevelBox(w, s, t), iron(), x, y, z + nz * 0.02);
  for (const dy of [-s * 0.3, s * 0.3]) {
    part(
      g,
      new THREE.CylinderGeometry(0.03, 0.03, 0.05, 6),
      ironLight(),
      x + nx * 0.05,
      y + dy,
      z,
      0,
      0,
      Math.PI / 2,
    );
    part(
      g,
      new THREE.CylinderGeometry(0.03, 0.03, 0.05, 6),
      ironLight(),
      x,
      y + dy,
      z + nz * 0.05,
      Math.PI / 2,
    );
  }
}

/** An iron band right round a timber of `sx × sz` at height `y`. */
function band(
  g: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  sx: number,
  sz: number,
  h = 0.12,
): void {
  part(g, bevelBox(sx + 0.05, h, sz + 0.05), iron(), x, y, z);
}

/**
 * A window in a wall facing +z (in `g`'s space): a heavy wooden frame round warm glass crossed
 * by a dark diamond lattice, a sill below and a lintel above.
 */
function latticeWindow(
  g: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  yaw = 0,
): THREE.Group {
  const f = group(g, x, y, z, yaw);
  const glass = new THREE.MeshStandardMaterial({
    color: 0xffd36e,
    emissive: 0xf6b33c,
    emissiveIntensity: 1.25,
    roughness: 0.35,
  });
  part(f, new THREE.PlaneGeometry(w, h), glass, 0, 0, 0.02);
  const bar = mat(0x2b2a2c, Surface.Metal, { roughness: 0.6 });
  // The diamond lattice: bars both ways at 45°, clipped to the pane by their length.
  const step = 0.2;
  for (let k = -Math.ceil((w + h) / step); k <= Math.ceil((w + h) / step); k++) {
    for (const s of [-1, 1]) {
      // Line: x * s - y = k * step, clipped to |x| < w/2, |y| < h/2.
      const pts: THREE.Vector2[] = [];
      for (const xx of [-w / 2, w / 2]) {
        const yy = xx * s - k * step;
        if (Math.abs(yy) <= h / 2) pts.push(new THREE.Vector2(xx, yy));
      }
      for (const yy of [-h / 2, h / 2]) {
        const xx = (yy + k * step) * s;
        if (Math.abs(xx) <= w / 2) pts.push(new THREE.Vector2(xx, yy));
      }
      if (pts.length < 2) continue;
      const [a, b] = [pts[0]!, pts[1]!];
      if (a.distanceTo(b) < 0.05) continue;
      between(
        f,
        new THREE.Vector3(a.x, a.y, 0.04),
        new THREE.Vector3(b.x, b.y, 0.04),
        0.012,
        bar,
        0.012,
        4,
      ).castShadow = false;
    }
  }
  const fw = 0.14;
  beam(f, 0, h / 2 + fw / 2, 0.05, w + 2 * fw + 0.1, fw, 0.16, C.woodDark);
  beam(f, 0, -h / 2 - fw / 2, 0.08, w + 2 * fw + 0.2, fw, 0.22, C.wood);
  for (const s of [-1, 1]) beam(f, (s * (w + fw)) / 2, 0, 0.05, fw, h, 0.16, C.woodDark);
  // A mullion down the middle.
  beam(f, 0, 0, 0.05, 0.06, h, 0.08, C.woodDark);
  return f;
}

/**
 * Rows of chunky shingles over one slope of a roof, in `g`'s space: the slope runs down from
 * its ridge at (`ridgeY`, x = 0) toward +x (or -x, `side`) at `pitch` radians for `slope`
 * metres, `len` long along z (centred on 0). Each shingle its own shade of `tones`, set a little
 * askew.
 */
function shingles(
  g: THREE.Object3D,
  ridgeY: number,
  pitch: number,
  slope: number,
  len: number,
  side: 1 | -1,
  tones: number[],
  seed: number,
  z0 = 0,
): void {
  const r = rng(seed);
  const rows = Math.ceil(slope / 0.3);
  const across = Math.ceil(len / 0.42);
  const byTone = tones.map(() => [] as THREE.BufferGeometry[]);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (let row = 0; row < rows; row++) {
    const d = (row + 0.5) * (slope / rows);
    const x = side * Math.cos(pitch) * d;
    const y = ridgeY - Math.sin(pitch) * d;
    const off = row % 2 ? 0.21 : 0;
    for (let i = 0; i < across + 1; i++) {
      const z = z0 - len / 2 + i * 0.42 + off - 0.1;
      if (z < z0 - len / 2 - 0.05 || z > z0 + len / 2 + 0.05) continue;
      const tile = bevelBox(0.4 + r() * 0.04, 0.07, 0.34, 0.025);
      e.set(0, 0, 0);
      // Laid down the slope, each a little askew.
      e.set((r() - 0.5) * 0.06, (r() - 0.5) * 0.1, -side * pitch + (r() - 0.5) * 0.05, 'ZYX');
      q.setFromEuler(e);
      // Its long side across the slope (along z).
      const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
      m.compose(new THREE.Vector3(x, y + 0.04, z), q.multiply(turn), new THREE.Vector3(1, 1, 1));
      tile.applyMatrix4(m);
      byTone[Math.floor(r() * tones.length)]!.push(tile.toNonIndexed());
    }
  }
  tones.forEach((hex, i) => {
    if (!byTone[i]!.length) return;
    const merged = mergeAll(byTone[i]!.map((t) => (t.deleteAttribute('uv'), t)));
    merged.computeVertexNormals();
    part(g, merged, mat(hex, Surface.Auto, { roughness: 0.8, flat: true }));
  });
}

/** A plastered triangle (a gable end) in the plane z = `z`, from `w` wide at `y0` up to `y1`. */
function gableWall(
  g: THREE.Object3D,
  z: number,
  y0: number,
  y1: number,
  w: number,
  thick = 0.2,
): void {
  const shape = new THREE.Shape([
    new THREE.Vector2(-w / 2, y0),
    new THREE.Vector2(w / 2, y0),
    new THREE.Vector2(0, y1),
  ]);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  geo.translate(0, 0, z - thick / 2);
  part(g, geo, plaster());
}

/**
 * A great rough cap on a ridge beam's end: a chunky block of timber, cut a little askew, bound
 * by an iron band, as the reference's roofs end.
 */
function ridgeCap(
  g: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  s: number,
  yaw = 0,
  seed = 1,
): void {
  const r = rng(seed);
  const c = group(g, x, y, z, yaw);
  part(
    c,
    bevelBox(s * 1.1, s * 0.85, s, s * 0.14),
    wood(C.woodLight),
    0,
    0,
    0,
    (r() - 0.5) * 0.12,
    0,
    (r() - 0.5) * 0.15,
  );
  part(
    c,
    bevelBox(s * 0.8, s * 0.3, s * 0.8, s * 0.08),
    wood(C.woodPale),
    0,
    s * 0.5,
    0,
    0,
    0.3,
    0,
  );
  part(c, bevelBox(s * 1.16, s * 0.2, s * 0.25), iron(), 0, 0, s * 0.28);
}

/** A wooden door of planks with iron straps and a ring, facing +z, its foot's middle at the origin. */
function door(
  g: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  yaw = 0,
  double = false,
): void {
  const d = group(g, x, y, z, yaw);
  const n = Math.round(w / 0.22);
  const r = rng(Math.round(w * 100 + h));
  for (let i = 0; i < n; i++) {
    const tone = [C.wood, C.woodLight, C.wood, C.woodDark][Math.floor(r() * 4)]!;
    part(
      d,
      bevelBox(w / n - 0.01, h - 0.02 - r() * 0.05, 0.08),
      wood(tone),
      -w / 2 + (i + 0.5) * (w / n),
      h / 2,
      0,
    );
  }
  for (const yy of [0.3, h - 0.35])
    part(
      d,
      bevelBox(w * (double ? 0.44 : 0.8), 0.1, 0.04),
      iron(),
      double ? -w * 0.24 : -w * 0.05,
      yy,
      0.06,
    );
  if (double)
    for (const yy of [0.3, h - 0.35])
      part(d, bevelBox(w * 0.44, 0.1, 0.04), iron(), w * 0.24, yy, 0.06);
  part(
    d,
    new THREE.TorusGeometry(0.07, 0.015, 6, 12),
    iron(),
    double ? -0.12 : w * 0.3,
    h * 0.5,
    0.07,
  );
  if (double) part(d, new THREE.TorusGeometry(0.07, 0.015, 6, 12), iron(), 0.12, h * 0.5, 0.07);
  beam(d, 0, h + 0.08, 0.02, w + 0.3, 0.16, 0.22, C.woodDark);
  for (const s of [-1, 1]) beam(d, (s * (w + 0.12)) / 2, h / 2, 0.02, 0.14, h, 0.2, C.woodDark);
}

/** A box planted with greenery, under a window. */
function windowBox(g: THREE.Object3D, x: number, y: number, z: number, w: number, yaw = 0): void {
  const b = group(g, x, y, z, yaw);
  part(b, bevelBox(w, 0.28, 0.32), wood(C.woodLight), 0, 0, 0);
  for (const s of [-1, 1]) part(b, bevelBox(0.06, 0.32, 0.36), iron(), (s * w) / 2.4, 0, 0);
  const r = rng(Math.round(x * 31 + z * 7));
  const leaf = mat(0x6fae2e, Surface.Auto, { flat: true });
  const leaf2 = mat(0x8fc63c, Surface.Auto, { flat: true });
  for (let i = 0; i < 9; i++) {
    const rad = 0.13 + r() * 0.08;
    part(
      b,
      new THREE.IcosahedronGeometry(rad, 0),
      i % 2 ? leaf : leaf2,
      (r() - 0.5) * (w - 0.2),
      0.18 + r() * 0.08,
      (r() - 0.5) * 0.15,
    );
  }
}

/**
 * The tall house. Its own front (the gable with the balcony) faces +z, its foot's middle at the
 * origin, standing on ground at y = 0.
 */
export function bigHouse(
  parent: THREE.Object3D,
  solids: Solids,
  x: number,
  y: number,
  z: number,
  yaw: number,
): THREE.Group {
  const g = group(parent, x, y, z, yaw);
  const W = 6;
  const D = 7;
  const G = 3.2; // the upper floor's level
  const U = 3.3; // the upper floor's height
  const jetty = 0.35;
  const eave = G + U;
  const pitch = (57 * Math.PI) / 180;

  // A footing of stone and sand under it all, so it sits on uneven ground.
  part(g, bevelBox(W + 0.3, 0.8, D + 0.3), mat(0x9a8f80, Surface.Concrete), 0, -0.25, 0);

  // The ground floor: boards on a frame.
  const r = rng(5);
  const planks = (w: number, along: 'x' | 'z', at: number, from: number, to: number) => {
    const n = Math.round(w / 0.3);
    for (let i = 0; i < n; i++) {
      const u = from + (i + 0.5) * ((to - from) / n);
      const tone = [C.wood, C.woodLight, C.woodDark, C.wood][Math.floor(r() * 4)]!;
      const h = G - 0.05 - r() * 0.08;
      if (along === 'x')
        part(g, bevelBox((to - from) / n - 0.02, h, 0.12), wood(tone), u, h / 2 + 0.15, at);
      else part(g, bevelBox(0.12, h, (to - from) / n - 0.02), wood(tone), at, h / 2 + 0.15, u);
    }
  };
  planks(W, 'x', D / 2 - 0.1, -W / 2, W / 2);
  planks(W, 'x', -D / 2 + 0.1, -W / 2, W / 2);
  planks(D, 'z', W / 2 - 0.1, -D / 2, D / 2);
  planks(D, 'z', -W / 2 + 0.1, -D / 2, D / 2);
  door(g, -0.6, 0.15, D / 2, 1.3, 2.3, 0, true);
  latticeWindow(g, 1.7, 1.7, D / 2 + 0.02, 0.8, 0.9);
  latticeWindow(g, -W / 2 - 0.02, 1.7, 1.2, 0.8, 0.9, -Math.PI / 2);
  // Heavy corner posts with iron at their feet and heads, and a sill beam round the foot.
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const px = (sx * W) / 2;
      const pz = (sz * D) / 2;
      beam(g, px, G / 2, pz, 0.42, G + 0.3, 0.42, C.woodDark);
      bracket(g, px + sx * 0.2, 0.5, pz + sz * 0.2, sx, sz, 0.55, 0.3);
      bracket(g, px + sx * 0.2, G - 0.35, pz + sz * 0.2, sx, sz, 0.55, 0.3);
    }
  for (const sz of [-1, 1]) beam(g, 0, 0.2, (sz * D) / 2, W + 0.3, 0.3, 0.3, C.woodDark);
  for (const sx of [-1, 1]) beam(g, (sx * W) / 2, 0.2, 0, 0.3, 0.3, D + 0.3, C.woodDark);
  // Mid posts.
  for (const sz of [-1, 1]) beam(g, 1.0, G / 2, (sz * D) / 2 + sz * 0.04, 0.3, G, 0.3, C.woodDark);
  for (const sx of [-1, 1]) beam(g, (sx * W) / 2 + sx * 0.04, G / 2, -0.6, 0.3, G, 0.3, C.woodDark);

  // The jetty: joists out over the walls, and the beam round the upper floor's foot.
  for (let i = 0; i < 6; i++) {
    const zz = -D / 2 + 0.4 + (i * (D - 0.8)) / 5;
    for (const sx of [-1, 1]) {
      beam(g, sx * (W / 2 + jetty / 2), G + 0.05, zz, jetty + 0.4, 0.26, 0.24, C.woodDark);
    }
  }
  const UW = W + 2 * jetty;
  const UD = D + 2 * jetty;
  beam(g, 0, G + 0.22, 0, UW + 0.1, 0.34, UD + 0.1, C.wood);
  // The upper floor: plaster between a frame of posts, rails and braces.
  part(g, new THREE.BoxGeometry(UW - 0.2, U, UD - 0.2), plaster(), 0, G + 0.35 + U / 2, 0);
  const top = G + 0.35 + U;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const px = (sx * UW) / 2 - sx * 0.1;
      const pz = (sz * UD) / 2 - sz * 0.1;
      beam(g, px, G + 0.35 + U / 2, pz, 0.34, U, 0.34, C.woodDark);
      bracket(g, px + sx * 0.17, G + 0.65, pz + sz * 0.17, sx, sz, 0.5, 0.26);
      bracket(g, px + sx * 0.17, top - 0.3, pz + sz * 0.17, sx, sz, 0.5, 0.26);
    }
  for (const sz of [-1, 1])
    beam(g, 0, top - 0.1, (sz * UD) / 2 - sz * 0.05, UW + 0.2, 0.3, 0.3, C.woodDark);
  for (const sx of [-1, 1])
    beam(g, (sx * UW) / 2 - sx * 0.05, top - 0.1, 0, 0.3, 0.3, UD + 0.2, C.woodDark);
  // Side walls: posts and a rail between, braces in the bays.
  for (const sx of [-1, 1]) {
    const wx = (sx * UW) / 2 - sx * 0.04;
    for (const zz of [-1.4, 1.4]) beam(g, wx, G + 0.35 + U / 2, zz, 0.2, U, 0.26, C.woodDark);
    beam(g, wx, G + 1.3, 0, 0.18, 0.2, UD - 0.3, C.woodDark);
    between(
      g,
      new THREE.Vector3(wx, G + 0.45, -UD / 2 + 0.3),
      new THREE.Vector3(wx, top - 0.25, -1.55),
      0.09,
      wood(C.woodDark),
      0.09,
      4,
    );
    between(
      g,
      new THREE.Vector3(wx, G + 0.45, UD / 2 - 0.3),
      new THREE.Vector3(wx, top - 0.25, 1.55),
      0.09,
      wood(C.woodDark),
      0.09,
      4,
    );
  }
  // Front and back: posts, rail, and a door onto the balcony at the front.
  for (const sz of [-1, 1]) {
    const wz = (sz * UD) / 2 - sz * 0.04;
    for (const xx of [-1.2, 1.2]) beam(g, xx, G + 0.35 + U / 2, wz, 0.26, U, 0.2, C.woodDark);
  }
  door(g, -0.1, G + 0.35, UD / 2 - 0.02, 1.0, 2.1);
  latticeWindow(g, 2.05, G + 1.9, UD / 2 + 0.02, 0.7, 1.0);
  latticeWindow(g, -2.05, G + 1.9, UD / 2 + 0.02, 0.7, 1.0);
  // The left side: the big lattice window over a box of greenery, and a smaller one.
  latticeWindow(g, -UW / 2 - 0.02, G + 1.85, 0.1, 1.1, 1.3, -Math.PI / 2);
  windowBox(g, -UW / 2 - 0.25, G + 0.98, 0.1, 1.5, -Math.PI / 2);
  latticeWindow(g, -UW / 2 - 0.02, G + 1.9, -2.4, 0.7, 1.0, -Math.PI / 2);
  latticeWindow(g, UW / 2 + 0.02, G + 1.9, 0.1, 0.9, 1.1, Math.PI / 2);
  latticeWindow(g, UW / 2 + 0.02, G + 1.9, -2.4, 0.7, 1.0, Math.PI / 2);

  // The roof: gables front and back, rafters, bargeboards, shingles, the ridge beam and its caps.
  const over = 0.7;
  const half = UW / 2 + over;
  const rise = Math.tan(pitch) * (UW / 2 + 0.05);
  const ridge = top + rise;
  for (const sz of [-1, 1]) gableWall(g, (sz * (UD - 0.2)) / 2, top - 0.05, ridge, UW - 0.2);
  // Timbers on the gables: a king post, a collar, and a small window in the front one.
  for (const sz of [-1, 1]) {
    const gz = (sz * UD) / 2 - sz * 0.02;
    beam(g, 0, top + rise / 2, gz, 0.24, rise, 0.16, C.woodDark);
    beam(g, 0, top + rise * 0.42, gz, UW * 0.56, 0.2, 0.16, C.woodDark);
  }
  latticeWindow(g, 0, top + rise * 0.62, UD / 2 + 0.02, 0.55, 0.7);
  const slope = half / Math.cos(pitch);
  for (const sx of [-1, 1] as const) {
    // A deck of boards under the shingles, seen from below the eaves.
    const deck = part(
      g,
      new THREE.BoxGeometry(slope + 0.05, 0.1, UD + 2 * over),
      wood(C.woodDark),
      (sx * half) / 2,
      ridge - (Math.tan(pitch) * half) / 2 - 0.02,
      0,
      0,
      0,
      -sx * pitch,
    );
    deck.receiveShadow = true;
    shingles(
      g,
      ridge + 0.05,
      pitch,
      slope,
      UD + 2 * over - 0.1,
      sx,
      [C.roofBlue, 0x433d72, 0x2f2a52, 0x4d4880],
      11 + sx,
    );
    // Bargeboards along the gable edges, front and back.
    for (const sz of [-1, 1]) {
      const bz = (sz * (UD + 2 * over)) / 2;
      const b = beam(
        g,
        (sx * half) / 2,
        ridge - (Math.tan(pitch) * half) / 2 + 0.15,
        bz,
        slope + 0.3,
        0.34,
        0.2,
        C.wood,
        0,
        0,
        -sx * pitch,
      );
      b.castShadow = true;
      // Rafter ends poking out under the eaves.
    }
    for (let i = 0; i < 7; i++) {
      const zz = -UD / 2 + (i * UD) / 6;
      beam(
        g,
        sx * (UW / 2 + 0.35),
        top - 0.05 - 0.15,
        zz,
        0.9,
        0.18,
        0.18,
        C.woodDark,
        0,
        0,
        -sx * pitch * 0.6,
      );
    }
  }
  beam(g, 0, ridge + 0.32, 0, 0.42, 0.42, UD + 2 * over + 1.0, C.wood);
  ridgeCap(g, 0, ridge + 0.45, UD / 2 + over + 0.75, 1.0, 0, 7);
  ridgeCap(g, 0, ridge + 0.45, -UD / 2 - over - 0.75, 0.9, Math.PI, 8);
  for (const sz of [-1, 1])
    band(g, 0, ridge + 0.32, (sz * (UD + 2 * over)) / 2 + sz * 0.25, 0.42, 0.42 + 0.0, 0.14);

  // The cross gable on the left side, near the front: its own little gable and roof, with the
  // great capped beam reaching out at its peak.
  const cg = group(g, -UW / 2, 0, 1.6, -Math.PI / 2);
  const CW = 3.0;
  const crise = Math.tan(pitch) * (CW / 2 + 0.05);
  const cridge = top + crise;
  gableWall(cg, 0.3, top - 0.05, cridge, CW);
  part(cg, new THREE.BoxGeometry(CW - 0.1, 1.2, 2.4), plaster(), 0, top - 0.4, -0.9);
  beam(cg, 0, top + crise / 2, 0.42, 0.22, crise, 0.14, C.woodDark);
  latticeWindow(cg, 0, top + crise * 0.4, 0.43, 0.55, 0.65);
  const chalf = CW / 2 + 0.45;
  const cslope = chalf / Math.cos(pitch);
  // Its shingles run along its own ridge (along its z): a frame turned so.
  for (const sx of [-1, 1] as const) {
    part(
      cg,
      new THREE.BoxGeometry(cslope, 0.1, 3.8),
      wood(C.woodDark),
      (sx * chalf) / 2,
      cridge - (Math.tan(pitch) * chalf) / 2 - 0.02,
      -1.1,
      0,
      0,
      -sx * pitch,
    );
    shingles(
      cg,
      cridge + 0.05,
      pitch,
      cslope,
      3.6,
      sx,
      [C.roofBlue, 0x433d72, 0x2f2a52, 0x4d4880],
      21 + sx,
      -1.0,
    );
    beam(
      cg,
      (sx * chalf) / 2,
      cridge - (Math.tan(pitch) * chalf) / 2 + 0.15,
      0.85,
      cslope + 0.25,
      0.3,
      0.18,
      C.wood,
      0,
      0,
      -sx * pitch,
    );
  }
  beam(cg, 0, cridge + 0.28, -0.6, 0.36, 0.36, 3.6, C.wood);
  ridgeCap(cg, 0, cridge + 0.45, 1.35, 1.25, 0, 3);
  band(cg, 0, cridge + 0.28, 0.95, 0.36, 0.36, 0.14);

  // The balcony across the front at the upper floor: boards on brackets, a railing of turned
  // balusters, and posts up to the eaves.
  const by = G + 0.35;
  const bd = 1.5;
  part(g, bevelBox(UW + 0.2, 0.16, bd), wood(C.woodLight), 0, by - 0.08, UD / 2 + bd / 2);
  for (const xx of [-UW / 2 + 0.2, -1, 1, UW / 2 - 0.2]) {
    between(
      g,
      new THREE.Vector3(xx, by - 1.2, UD / 2 - 0.1),
      new THREE.Vector3(xx, by - 0.15, UD / 2 + bd - 0.25),
      0.1,
      wood(C.woodDark),
      0.1,
      4,
    );
    beam(g, xx, by - 0.2, UD / 2 + bd / 2, 0.2, 0.22, bd, C.woodDark);
  }
  const rail = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.round(len / 0.28);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const [px, pz] = [ax + (bx - ax) * t, az + (bz - az) * t];
      part(
        g,
        new THREE.CylinderGeometry(0.05, 0.07, 0.85, 8),
        wood(C.woodLight),
        px,
        by + 0.43,
        pz,
      );
    }
    between(
      g,
      new THREE.Vector3(ax, by + 0.92, az),
      new THREE.Vector3(bx, by + 0.92, bz),
      0.08,
      wood(C.wood),
      0.08,
      6,
    );
  };
  rail(-UW / 2 - 0.05, UD / 2 + bd - 0.1, UW / 2 + 0.05, UD / 2 + bd - 0.1);
  rail(-UW / 2 - 0.05, UD / 2 + 0.05, -UW / 2 - 0.05, UD / 2 + bd - 0.1);
  for (const xx of [-UW / 2 - 0.05, UW / 2 + 0.05]) {
    beam(g, xx, by + 1.3, UD / 2 + bd - 0.1, 0.22, 2.6, 0.22, C.woodDark);
    bracket(g, xx, by + 0.2, UD / 2 + bd, Math.sign(xx), 1, 0.4, 0.22);
  }
  beam(g, 0, by + 2.55, UD / 2 + bd - 0.1, UW + 0.4, 0.24, 0.26, C.woodDark);
  for (let i = 0; i < 3; i++) bottle(g, -1.6 + i * 0.16, by + 0.96, UD / 2 + bd - 0.1, 0.26);
  part(g, bevelBox(0.5, 0.3, 0.4), wood(C.woodPale), 1.8, by + 0.15, UD / 2 + 0.6);
  bottle(g, 1.75, by + 0.3, UD / 2 + 0.6, 0.3);
  bottle(g, 1.95, by + 0.3, UD / 2 + 0.7, 0.26);

  // The stair up the right side to the balcony.
  const sx0 = UW / 2 + 0.75;
  const steps = 11;
  const sz0 = -D / 2 + 0.8;
  const sz1 = UD / 2 + 0.4;
  const run = (sz1 - sz0) / steps;
  for (let i = 0; i < steps; i++) {
    const yy = ((i + 1) * by) / steps;
    part(
      g,
      bevelBox(1.1, 0.12, run + 0.06),
      wood([C.woodLight, C.woodPale][i % 2]!),
      sx0,
      yy - 0.06,
      sz0 + (i + 0.5) * run,
    );
  }
  part(g, bevelBox(1.2, 0.16, 1.4), wood(C.woodLight), sx0 - 0.05, by - 0.08, UD / 2 + 0.9);
  for (const s of [-1, 1]) {
    between(
      g,
      new THREE.Vector3(sx0 + s * 0.55, -0.1, sz0 - 0.1),
      new THREE.Vector3(sx0 + s * 0.55, by - 0.15, sz1),
      0.1,
      wood(C.woodDark),
      0.1,
      4,
    );
  }
  for (const [zz, hh] of [
    [sz0 + 0.1, 0.9],
    [sz0 + (sz1 - sz0) * 0.5, by * 0.5 + 0.9],
    [sz1, by + 0.9],
  ] as const)
    beam(g, sx0 + 0.6, hh / 2, zz, 0.18, hh + (zz === sz0 + 0.1 ? 0 : 0.2), 0.18, C.woodDark);
  between(
    g,
    new THREE.Vector3(sx0 + 0.6, 1.0, sz0 + 0.1),
    new THREE.Vector3(sx0 + 0.6, by + 0.95, sz1),
    0.07,
    wood(C.wood),
    0.07,
    6,
  );
  // Posts under the landing.
  for (const zz of [UD / 2 + 0.3, UD / 2 + 1.5])
    beam(g, sx0 + 0.5, by / 2, zz, 0.2, by, 0.2, C.woodDark);

  // The awning over the ground floor's left side, on posts, with lanterns hung under it.
  const aw = group(g, -W / 2 - 0.1, 0, 0.4);
  for (const zz of [-2.6, 2.6]) {
    beam(aw, -1.7, 1.25, zz, 0.22, 2.5, 0.22, C.woodDark);
    bracket(aw, -1.7, 2.3, zz, -1, Math.sign(zz), 0.35, 0.22);
    lantern(aw, -1.25, 1.7, zz * 0.7, 0.42);
    between(
      aw,
      new THREE.Vector3(-1.25, 2.5, zz * 0.7),
      new THREE.Vector3(-1.25, 2.15, zz * 0.7),
      0.012,
      iron(),
    );
  }
  beam(aw, -1.7, 2.55, 0, 0.24, 0.24, 5.6, C.woodDark);
  for (const zz of [-2.6, 0, 2.6]) beam(aw, -0.85, 2.7, zz, 1.9, 0.18, 0.18, C.woodDark, 0, 0, 0.3);
  const ap = Math.atan2(0.6, 2.1);
  part(aw, new THREE.BoxGeometry(2.4, 0.08, 6.0), wood(C.woodDark), -0.95, 2.85, 0, 0, 0, ap);
  {
    const ag = group(aw, 0, 3.15, 0, 0);
    shingles(ag, 0.05, ap, 2.4, 5.8, -1, [C.roofBlue, 0x433d72, 0x2f2a52, 0x4d4880], 31);
  }
  // A lantern hung from each of the upper floor's front corners, and one at the left.
  for (const sx of [-1, 1]) {
    beam(g, sx * (UW / 2 + 0.45), top - 0.3, UD / 2 + 0.2, 0.9, 0.14, 0.14, C.woodDark);
    between(
      g,
      new THREE.Vector3(sx * (UW / 2 + 0.8), top - 0.3, UD / 2 + 0.2),
      new THREE.Vector3(sx * (UW / 2 + 0.8), top - 0.65, UD / 2 + 0.2),
      0.012,
      iron(),
    );
    lantern(g, sx * (UW / 2 + 0.8), top - 1.18, UD / 2 + 0.2, 0.5);
  }

  // What players bump into and stand on: the house, the balcony, the stair and its landing.
  solids.box(g, 0, -0.5, 0, W + 0.5, eave + 5, D + 0.5);
  solids.box(g, 0, -0.5, 0, UW + 0.2, eave + 5 - G, UD + 0.1);
  solids.box(g, 0, by - 0.2, UD / 2 + bd / 2, UW + 0.2, 0.2, bd);
  solids.box(g, 0, by, UD / 2 + bd - 0.1, UW + 0.2, 1.0, 0.15);
  solids.box(g, -UW / 2 - 0.05, by, UD / 2 + bd / 2, 0.15, 1.0, bd);
  solids.ramp(g, sx0, (sz0 + sz1) / 2, 1.1, sz1 - sz0, 0, by);
  solids.box(g, sx0 - 0.05, by - 0.2, UD / 2 + 0.9, 1.2, 0.2, 1.4);
  solids.box(g, sx0 + 0.6, 0, (sz0 + sz1) / 2, 0.15, by + 1, sz1 - sz0);
  solids.post(aw, -1.7, -2.6, 0.13, 0, 2.5);
  solids.post(aw, -1.7, 2.6, 0.13, 0, 2.5);
  for (const zz of [UD / 2 + 0.3, UD / 2 + 1.5]) solids.post(g, sx0 + 0.5, zz, 0.12, 0, by - 0.3);
  // Where the stair starts, its landing and the balcony's middle, in the house's own space (for the tests).
  g.userData.stairFoot = new THREE.Vector3(sx0, 0, sz0 - 0.8);
  g.userData.landing = new THREE.Vector3(sx0 - 0.05, by, UD / 2 + 0.9);
  g.userData.balcony = new THREE.Vector3(0, by, UD / 2 + bd / 2);
  return g;
}

/**
 * The little shop: plaster in a timber frame over a plank skirt, a double door under a lantern,
 * a round iron-rimmed window in its gable, a red shingle roof with capped ridge beam and a red
 * pennant flying from a pole at its corner. Its front faces +z.
 */
export function shop(
  parent: THREE.Object3D,
  solids: Solids,
  x: number,
  y: number,
  z: number,
  yaw: number,
): THREE.Group {
  const g = group(parent, x, y, z, yaw);
  const W = 5;
  const D = 5.4;
  const H = 3.3;
  const pitch = (50 * Math.PI) / 180;
  part(g, bevelBox(W + 0.3, 0.8, D + 0.3), mat(0x9a8f80, Surface.Concrete), 0, -0.25, 0);
  part(g, new THREE.BoxGeometry(W - 0.2, H, D - 0.2), plaster(), 0, H / 2 + 0.1, 0);
  // The plank skirt round its foot.
  const r = rng(9);
  for (const [sx, sz, len, alongX] of [
    [0, 1, W, true],
    [0, -1, W, true],
    [1, 0, D, false],
    [-1, 0, D, false],
  ] as const) {
    const n = Math.round(len / 0.3);
    for (let i = 0; i < n; i++) {
      const u = -len / 2 + (i + 0.5) * (len / n);
      const tone = [C.wood, C.woodLight, C.woodDark][Math.floor(r() * 3)]!;
      const hh = 1.0 + r() * 0.1;
      if (alongX)
        part(
          g,
          bevelBox(len / n - 0.02, hh, 0.1),
          wood(tone),
          u,
          hh / 2 + 0.1,
          (sz * D) / 2 - sz * 0.05,
        );
      else
        part(
          g,
          bevelBox(0.1, hh, len / n - 0.02),
          wood(tone),
          (sx * W) / 2 - sx * 0.05,
          hh / 2 + 0.1,
          u,
        );
    }
  }
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      beam(g, (sx * W) / 2, H / 2 + 0.1, (sz * D) / 2, 0.34, H + 0.2, 0.34, C.woodDark);
      bracket(g, (sx * W) / 2 + sx * 0.17, H - 0.2, (sz * D) / 2 + sz * 0.17, sx, sz, 0.45, 0.24);
      bracket(g, (sx * W) / 2 + sx * 0.17, 0.5, (sz * D) / 2 + sz * 0.17, sx, sz, 0.45, 0.24);
    }
  for (const sz of [-1, 1]) beam(g, 0, H + 0.1, (sz * D) / 2, W + 0.3, 0.3, 0.3, C.woodDark);
  for (const sx of [-1, 1]) beam(g, (sx * W) / 2, H + 0.1, 0, 0.3, 0.3, D + 0.3, C.woodDark);
  for (const sz of [-1, 1]) beam(g, 0, 1.2, (sz * D) / 2 + sz * 0.02, W, 0.18, 0.16, C.woodDark);
  door(g, 0, 0.1, D / 2 + 0.02, 1.5, 2.35, 0, true);
  // Shelves with bottles either side of the door.
  for (const s of [-1, 1]) {
    part(g, bevelBox(0.9, 0.08, 0.3), wood(C.woodLight), s * 1.6, 1.75, D / 2 + 0.18);
    for (const sy of [-1, 1])
      between(
        g,
        new THREE.Vector3(s * 1.6 + sy * 0.38, 1.72, D / 2 + 0.05),
        new THREE.Vector3(s * 1.6 + sy * 0.38, 1.5, D / 2 + 0.05),
        0.03,
        iron(),
      );
    for (let i = 0; i < 3; i++)
      bottle(g, s * 1.6 - 0.28 + i * 0.28, 1.79, D / 2 + 0.2, 0.28 + (i % 2) * 0.05);
  }
  lantern(g, 1.0, 2.25, D / 2 + 0.35, 0.42);
  beam(g, 1.0, 2.9, D / 2 + 0.3, 0.12, 0.12, 0.5, C.woodDark);
  latticeWindow(g, W / 2 + 0.02, 1.9, -0.3, 0.8, 0.9, Math.PI / 2);
  latticeWindow(g, -W / 2 - 0.02, 1.9, -0.3, 0.8, 0.9, -Math.PI / 2);
  sign(g, W / 2 + 0.15, 2.6, D / 2 - 0.4, 0);

  // The roof.
  const over = 0.55;
  const half = W / 2 + over;
  const rise = Math.tan(pitch) * (W / 2 + 0.05);
  const top = H + 0.25;
  const ridge = top + rise;
  for (const sz of [-1, 1]) gableWall(g, (sz * (D - 0.2)) / 2, top - 0.1, ridge, W - 0.1);
  for (const sz of [-1, 1]) {
    const gz = (sz * D) / 2 - sz * 0.02;
    beam(g, 0, top + 0.05, gz, W, 0.22, 0.2, C.woodDark);
  }
  // The round window in the front gable: an iron rim with bolts round warm glass.
  const pz = D / 2 + 0.05;
  const py = top + rise * 0.38;
  part(
    g,
    new THREE.CircleGeometry(0.38, 20),
    new THREE.MeshStandardMaterial({ color: 0xffd36e, emissive: 0xf0ae3a, emissiveIntensity: 1.1 }),
    0,
    py,
    pz,
  );
  part(g, new THREE.TorusGeometry(0.42, 0.09, 8, 24), iron(), 0, py, pz + 0.02);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    part(
      g,
      new THREE.SphereGeometry(0.035, 6, 4),
      ironLight(),
      Math.cos(a) * 0.42,
      py + Math.sin(a) * 0.42,
      pz + 0.1,
    );
  }
  between(
    g,
    new THREE.Vector3(-0.38, py, pz + 0.04),
    new THREE.Vector3(0.38, py, pz + 0.04),
    0.02,
    iron(),
  );
  between(
    g,
    new THREE.Vector3(0, py - 0.38, pz + 0.04),
    new THREE.Vector3(0, py + 0.38, pz + 0.04),
    0.02,
    iron(),
  );
  const slope = half / Math.cos(pitch);
  for (const sx of [-1, 1] as const) {
    part(
      g,
      new THREE.BoxGeometry(slope + 0.05, 0.1, D + 2 * over),
      wood(C.woodDark),
      (sx * half) / 2,
      ridge - (Math.tan(pitch) * half) / 2 - 0.02,
      0,
      0,
      0,
      -sx * pitch,
    );
    shingles(
      g,
      ridge + 0.05,
      pitch,
      slope,
      D + 2 * over - 0.1,
      sx,
      [C.roofRed, 0x9d4a31, 0x7a3522, 0xa85a3a],
      41 + sx,
    );
    for (const sz of [-1, 1])
      beam(
        g,
        (sx * half) / 2,
        ridge - (Math.tan(pitch) * half) / 2 + 0.15,
        (sz * (D + 2 * over)) / 2,
        slope + 0.25,
        0.3,
        0.18,
        C.wood,
        0,
        0,
        -sx * pitch,
      );
  }
  beam(g, 0, ridge + 0.3, 0, 0.38, 0.38, D + 2 * over + 0.9, C.wood);
  ridgeCap(g, 0, ridge + 0.42, D / 2 + over + 0.65, 0.9, 0, 5);
  band(g, 0, ridge + 0.3, D / 2 + over + 0.2, 0.38, 0.38, 0.14);
  // The pennant's pole at the front right corner.
  const fx = W / 2 + 0.2;
  const fz = D / 2 + 0.2;
  beam(g, fx, (H + 3.6) / 2, fz, 0.16, H + 3.6, 0.16, C.woodDark);
  part(g, new THREE.SphereGeometry(0.1, 8, 6), wood(C.woodLight), fx, H + 3.65, fz);
  flag(g, fx + 0.06, H + 3.5, fz, 1.3, 0.55, C.flagRed, -0.4, 17);
  ridgeCap(g, fx, H + 0.95, fz, 0.7, 0.4, 6);

  solids.box(g, 0, -0.5, 0, W + 0.5, H + 5, D + 0.5);
  return g;
}
