import * as THREE from 'three';
import { fbm, noise, rng } from './kit.ts';
import { chaikin, cobble, groundMaterial, mix, polygonField, tuft } from './ground.ts';
import type { Field } from './ground.ts';

/**
 * A stretch of old road under the sports car, painted as the cobble patch is: worn blue-grey
 * asphalt flecked with stone, cracked and patched, its lines chipped, moss in its cracks, its
 * broken ends brushed out over the floor with the patch's own ragged rim. A kerb of pale stone
 * slabs runs along its far side, grass growing behind it.
 */

export interface RoadLayout {
  /** The road's outline, round its ragged edge (x, z). */
  outline: [number, number][];
  /** Where its lines run along x: the dashed middle, if it has one, and the two solid edges (z). */
  middle?: number;
  edges: [number, number];
  /** The kerb along its far side, if it has one: from x0 to x1, at z. */
  kerb?: { x0: number; x1: number; z: number };
}

/** The asphalt, its lines, cracks and patches, and its rim, painted over `rect` (x0, z0, w, d). */
function roadTexture(
  field: Field,
  layout: RoadLayout,
  rect: [number, number, number, number],
  perMetre: number,
): THREE.DataTexture {
  const [x0, z0, w, d] = rect;
  const W = Math.round(w * perMetre);
  const H = Math.round(d * perMetre);
  const data = new Uint8Array(W * H * 4);
  const dark = [0x3a, 0x40, 0x47];
  const mid = [0x55, 0x5c, 0x64];
  const light = [0x74, 0x7a, 0x82];
  const fleck = [0x9a, 0x9e, 0xa2];
  const patched = [0x2e, 0x33, 0x38];
  const crack = [0x16, 0x18, 0x1a];
  const moss = [0x3a, 0x4c, 0x22];
  const paint = [0xdc, 0xd8, 0xcc];
  const rim = [0x56, 0x60, 0x6a];
  // The patch's own rim: a band of dark wet ground, then a dry grey wash out over the floor.
  const wet = [0x4a, 0x4e, 0x50];
  const wash = [0x9a, 0x94, 0x8c];
  // A line `half` wide either side of `z`, its edges a little soft.
  const band = (z: number, at: number, half: number) =>
    Math.max(0, Math.min(1, (half - Math.abs(z - at)) * perMetre * 0.5 + 0.5));
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const x = x0 + ((i + 0.5) / W) * w;
      const z = z0 + (1 - (j + 0.5) / H) * d;
      // The edge roughened and dragged into streaks along x, as the patch's is.
      const rough = (fbm(x * 0.1, z * 0.35, 8, 43, 4) - 0.5) * 0.9;
      const streak = (noise(x * 0.25, z * 14, 1000, 45) - 0.5) * 0.6;
      const f = field(x, z) + rough + streak * 0.6;
      const k = (j * W + i) * 4;
      if (f > 0.7) {
        data[k + 3] = 0;
        continue;
      }
      let c: number[];
      let a = 1;
      if (f > 0) {
        const broken = noise(x * 3, z * 14, 1000, 47);
        if (f < 0.25) {
          c = wet.map((v) => v * (0.85 + 0.3 * broken));
          a = 0.85 * Math.min(1, (0.25 - f) / 0.06 + broken * 0.5);
        } else {
          const t = (f - 0.25) / 0.45;
          a = Math.max(0, (1 - t) * (0.75 + 0.5 * broken) - 0.15) * 0.6;
          c = mix(wet, wash, Math.min(1, t * 3)).map((v) => v * (0.85 + 0.3 * broken));
        }
      } else {
        // The asphalt: broad blotches of wear, darker and lighter, and its stone showing through
        // in flecks.
        const m = fbm(x * 0.1, z * 0.1, 8, 51, 4);
        c = m < 0.5 ? mix(dark, mid, m / 0.5) : mix(mid, light, (m - 0.5) / 0.5);
        const grit = noise(x * 60, z * 60, 100000, 53);
        c = mix(c, fleck, Math.max(0, grit - 0.8) * 3);
        c = mix(c, dark, Math.max(0, 0.18 - grit) * 3);
        // Two patches of newer asphalt, square-cut and darker.
        for (const [px, pz, pw, pd] of [
          [-5.6, -4.6, 1.3, 0.8],
          [-0.6, -3.1, 0.9, 0.55],
        ]) {
          const inside = Math.abs(x - px!) < pw! / 2 && Math.abs(z - pz!) < pd! / 2;
          if (inside) c = mix(patched, c, 0.25 + 0.2 * fbm(x * 0.5, z * 0.5, 8, 55, 2));
        }
        // The lines, chipped and worn through in places.
        const wear = fbm(x * 0.4, z * 0.4, 8, 57, 4);
        const chips = noise(x * 25, z * 25, 100000, 59);
        let line = 0;
        for (const e of layout.edges) line = Math.max(line, band(z, e, 0.055));
        const dash = ((x % 2.4) + 2.4) % 2.4 < 1.4 ? 1 : 0;
        if (layout.middle !== undefined)
          line = Math.max(line, band(z, layout.middle, 0.055) * dash);
        line *= Math.min(1, Math.max(0, (wear - 0.28) * 4)) * (chips > 0.2 ? 1 : 0.3);
        // Faded out toward its broken ends.
        line *= Math.min(1, Math.max(0, -f / 0.35));
        c = mix(c, paint, line * 0.9);
        // Cracks: thin dark lines where a slow noise crosses its middle, some running with moss.
        const along = fbm(x * 0.12, z * 0.3, 8, 61, 4);
        const net = fbm(x * 0.3, z * 0.3, 8, 63, 3);
        const crackAt = Math.max(
          Math.max(0, 1 - Math.abs(along - 0.5) / 0.008) * (net > 0.45 ? 1 : 0),
          Math.max(0, 1 - Math.abs(net - 0.5) / 0.006) * (along > 0.55 ? 1 : 0),
        );
        const mossy = fbm(x * 0.2, z * 0.2, 8, 65, 2) > 0.55;
        c = mix(c, mossy ? moss : crack, crackAt);
        // Crumbling and greyer toward its broken edge, moss creeping in from it.
        const edge = Math.max(0, 1 + f / 0.35);
        c = mix(c, rim, edge * 0.5);
        c = mix(c, moss, edge * Math.max(0, fbm(x * 0.5, z * 0.5, 8, 67, 3) - 0.5) * 2);
      }
      data[k] = c[0]!;
      data[k + 1] = c[1]!;
      data[k + 2] = c[2]!;
      data[k + 3] = Math.round(Math.min(1, a) * 255);
    }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Builds the road: its painted surface, the kerb along its far side, and grass round it. */
export function buildRoad(layout: RoadLayout): THREE.Group {
  const root = new THREE.Group();
  root.name = 'road';
  const field = polygonField(layout.outline);
  let [minX, minZ, maxX, maxZ] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, z] of layout.outline) {
    minX = Math.min(minX, x - 0.9);
    maxX = Math.max(maxX, x + 0.9);
    minZ = Math.min(minZ, z - 0.9);
    maxZ = Math.max(maxZ, z + 0.9);
  }
  const rect: [number, number, number, number] = [minX, minZ, maxX - minX, maxZ - minZ];
  const geo = new THREE.PlaneGeometry(rect[2], rect[3]);
  geo.rotateX(-Math.PI / 2);
  const surface = new THREE.Mesh(
    geo,
    groundMaterial(0xffffff, {
      map: roadTexture(field, layout, rect, 128),
      shine: 0.45,
      grain: 0.8,
    }),
  );
  surface.position.set(minX + rect[2] / 2, 0.003, minZ + rect[3] / 2);
  // Under the cobble patch's rim and the holes, where they meet it.
  surface.renderOrder = 0.5;
  root.add(surface);

  // Grass behind the kerb, and a few sprigs in the road's cracks and broken edge.
  const grass = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.7,
    side: THREE.DoubleSide,
  });
  const sprigs = rng(73);
  if (layout.kerb) {
    // The kerb: pale stone slabs end to end, a little uneven, their corners rounded.
    const stone = groundMaterial(0x8a9098, { vertexColors: true, shine: 0.5, grain: 0.6 });
    const rand = rng(71);
    const { x0, x1, z } = layout.kerb;
    for (let x = x0; x < x1 - 0.3;) {
      const len = 0.7 + rand() * 0.25;
      const w = 0.26;
      const slab = [
        new THREE.Vector2(-len / 2, -w / 2),
        new THREE.Vector2(len / 2, -w / 2),
        new THREE.Vector2(len / 2, w / 2),
        new THREE.Vector2(-len / 2, w / 2),
      ];
      const m = new THREE.Mesh(
        cobble(chaikin(slab), Math.floor(rand() * 1e6), 0.08 + rand() * 0.02),
        stone,
      );
      m.position.set(x + len / 2, 0, z + (rand() - 0.5) * 0.03);
      m.rotation.y = (rand() - 0.5) * 0.04;
      root.add(m);
      x += len + 0.03;
    }
    for (let i = 0; i < 14; i++) {
      const t = new THREE.Mesh(tuft(700 + i, 0.14 + sprigs() * 0.12, sprigs() > 0.5), grass);
      t.position.set(x0 + sprigs() * (x1 - x0), 0, z - 0.2 - sprigs() * 0.15);
      t.rotation.y = sprigs() * Math.PI * 2;
      t.castShadow = true;
      root.add(t);
    }
  }
  for (let i = 0, placed = 0; i < 200 && placed < 8; i++) {
    const x = minX + sprigs() * rect[2];
    const zz = minZ + sprigs() * rect[3];
    const f = field(x, zz);
    if (f > -0.05 || f < -0.4) continue;
    placed++;
    const t = new THREE.Mesh(tuft(800 + i, 0.07 + sprigs() * 0.08), grass);
    t.position.set(x, 0, zz);
    t.rotation.y = sprigs() * Math.PI * 2;
    root.add(t);
  }
  return root;
}
