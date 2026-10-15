import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BASEPLATE_SIZE,
  floorRect,
  groundHeight,
  groundSlope,
  inSea,
  levelSites,
} from '@sar/shared';
import type { BoxDef, FloorRect, LevelDef } from '@sar/shared';
import { roomSides } from './details.ts';
import { Surface, madeOf, styleNoise } from './styles.ts';
import { noise } from './surroundings.ts';
import { paintGround, wornAt } from './terrain.ts';

/**
 * The outdoors, drawn chunky and painted as in a storybook game: the camp's pines, stones, logs
 * and stumps, and the tufts of grass, bushes and flowers growing about every map. Their light
 * and shade are painted into each model's vertex colours (darker underneath and in the hollows,
 * lighter at the tips, on top and along worn edges), so they read the same in every visual
 * style, and the scene merge keeps them (see `mergeStatic`).
 *
 * The models are built like `props.ts`'s, in a frame centred on their box, `w` wide (x), `h`
 * high and `d` deep (z).
 */

/** One finish for all of it, so the scene merge bakes it into the meshes it already draws. */
const ROUGHNESS = 0.9;

const materials = new Map<string, THREE.MeshStandardMaterial>();

/**
 * A white material showing its mesh's vertex colours, made of `surface`, shared as `mat`'s are;
 * drawn from both sides if `twoSided` (a leaf, a sail, a flag: one sheet with nothing behind it).
 * If `castsEitherWay`, its faces cast the sun's shadow whichever way they face it, not only
 * those turned away from it as usual: for one of a leaf's two faces, which lie in each other, to
 * cast the leaf's whole shadow alone.
 */
export function painted(
  surface: Surface,
  twoSided = false,
  castsEitherWay = false,
): THREE.MeshStandardMaterial {
  const key = `${surface}:${twoSided}:${castsEitherWay}`;
  let m = materials.get(key);
  if (!m) {
    m = madeOf(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: ROUGHNESS,
        side: twoSided ? THREE.DoubleSide : THREE.FrontSide,
        shadowSide: castsEitherWay ? THREE.DoubleSide : null,
      }),
      surface,
    );
    materials.set(key, m);
  }
  return m;
}

/** Adds a mesh painted in its vertex colours to `g`. */
export function put(
  g: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  surface: Surface,
  castShadow = true,
  twoSided = false,
): THREE.Mesh {
  const m = new THREE.Mesh(geometry, painted(surface, twoSided));
  m.castShadow = castShadow;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

/** A colour from its hex code, as a new `THREE.Color` to work on. */
export const hex = (colour: number) => new THREE.Color(colour);

/** The colour of what is never seen: a shadow's core (see `shadowCore`). */
const CORE = 0x1c1a18;

/**
 * Casts the shadow of a part drawn without one (a barrel's staves and hoops, a palm's ringed
 * trunk, a coil of rope) from a plain shape of a few dozen triangles hidden inside it, `profile`
 * (radii and heights, bottom to top) turned `sides` round about y; open at its ends unless the
 * profile closes them. The shadow map draws every triangle that casts, again, and a barrel casts
 * much the shadow a plain drum would: the two differ by a centimetre or so at their edges, which
 * the map's texels blur away. Returned to be moved into place (a palm's leaning trunk bends it).
 */
export function shadowCore(
  g: THREE.Object3D,
  profile: [number, number][],
  sides: number,
): THREE.Mesh {
  const geometry = new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    sides,
  );
  geometry.deleteAttribute('uv');
  const n = geometry.attributes.position!.count;
  const c = hex(CORE);
  const colours = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colours.set([c.r, c.g, c.b], i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const m = put(g, geometry, Surface.Auto);
  m.name = 'shadow core';
  return m;
}

/**
 * The bark and the sawn wood are drawn as an unknown surface, not as wood: their ridges and
 * rings are in the models' own colours, and the painted wood is sawn timber's straight grain
 * and boards, which would run across them. The stones likewise are not concrete, a cast,
 * man-made finish.
 */
const BARK = Surface.Auto;
const STONE = Surface.Auto;

/** The pale wood of a sawn face, worked out from the bark's colour. */
const sawnWood = (bark: number) => hex(bark).lerp(hex(0xd9c29a), 0.68);

/**
 * Bark round a piece, a share of its radius at each point round it: three points to a ridge,
 * two out on its flat top and the third down in the groove after it. Its tops catch the light
 * and wear pale (the two a shade apart, as if brushed); its grooves are deep in shade.
 */
const BARK_RIDGE = [1, 1, 0.78];
const BARK_SHADE = [1.3, 1.12, 0.4];

// ---------------------------------------------------------------- turned wood

/** One ring of a round wooden piece (see `turned`). */
interface Ring {
  /** Its height along the piece. */
  y: number;
  /** Its radius; 0 closes the piece with a point on its axis. */
  r: number;
  /** How far the bark's ridges stand out of it: 0 on a sawn face, 1 on the bark. */
  ridges: number;
  colour: THREE.Color;
}

/**
 * A round wooden piece turned about y through `rings`, bottom to top, with `ridges` ridges of
 * bark running along it (see `BARK_RIDGE`, each a little different). Sawn faces are rings at
 * one height, painted with the tree's rings. Its outside faces out wherever the rings turn, so
 * a piece closed at both ends is solid.
 */
function turned(rings: Ring[], ridges: number, seed: () => number): THREE.BufferGeometry {
  const sides = ridges * BARK_RIDGE.length;
  const reach = Array.from({ length: sides }, (_, j) => {
    const f = BARK_RIDGE[j % BARK_RIDGE.length]!;
    return f < 1 ? f + seed() * 0.06 : f - seed() * 0.03;
  });
  const positions: number[] = [];
  const colours: number[] = [];
  const starts: number[] = [];
  for (const ring of rings) {
    starts.push(positions.length / 3);
    const points = ring.r === 0 ? 1 : sides;
    for (let j = 0; j < points; j++) {
      const a = (j / sides) * Math.PI * 2;
      const out = ring.r * (1 - ring.ridges * (1 - reach[j]!));
      positions.push(out * Math.sin(a), ring.y, out * Math.cos(a));
      const lit = ring.r === 0 ? 1 : 1 + ring.ridges * (BARK_SHADE[j % BARK_SHADE.length]! - 1);
      // A brush's unevenness.
      const c = ring.colour.clone().multiplyScalar(lit * (0.94 + seed() * 0.12));
      colours.push(c.r, c.g, c.b);
    }
  }
  const index: number[] = [];
  for (let k = 0; k + 1 < rings.length; k++) {
    const lower = starts[k]!;
    const upper = starts[k + 1]!;
    for (let j = 0; j < sides; j++) {
      const j1 = (j + 1) % sides;
      if (rings[k]!.r === 0) index.push(upper + j, lower, upper + j1);
      else if (rings[k + 1]!.r === 0) index.push(lower + j, lower + j1, upper);
      else index.push(upper + j, lower + j, upper + j1, lower + j, lower + j1, upper + j1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A sawn face's rings, from the bark's edge in to the heart, `r` across at height `y` (on its
 * underside if `down`): pale wood with darker year rings painted round it, and the heart dark.
 */
function sawnFace(y: number, r: number, wood: THREE.Color, down = false): Ring[] {
  const face: [number, number][] = [
    [0.9, 1.12],
    [0.7, 0.72],
    [0.42, 1.04],
    [0, 0.6],
  ];
  const rings = face.map(([f, shade]) => ({
    y,
    r: r * f,
    ridges: 0,
    colour: wood.clone().multiplyScalar(shade),
  }));
  return down ? rings.reverse() : rings;
}

// ---------------------------------------------------------------- the camp's models

/** A log along the box's x: chunky bark round it, sawn ends, resting on the box's bottom. */
export function logModel(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
): void {
  const r = Math.min(h, d) / 2;
  const half = (w - 0.02) / 2;
  const bark = hex(colour);
  const worn = bark.clone().lerp(hex(0xb08a62), 0.35);
  const wood = sawnWood(colour);
  // Each end's bark rounded over onto the sawn face, a little in from the end.
  const bevel = Math.min(0.04, r * 0.25);
  const along = (y: number, f: number): Ring => ({ y, r: r * f, ridges: 1, colour: bark });
  const rings: Ring[] = [
    ...sawnFace(-half, r, wood, true),
    { y: -half + bevel * 0.35, r: r * 0.96, ridges: 0.6, colour: worn },
    along(-half + bevel, 1),
    along(-half * 0.3 + (seed() - 0.5) * 0.2, 0.96 + seed() * 0.04),
    along(half * 0.4 + (seed() - 0.5) * 0.2, 0.96 + seed() * 0.04),
    along(half - bevel, 1),
    { y: half - bevel * 0.35, r: r * 0.96, ridges: 0.6, colour: worn },
    ...sawnFace(half, r, wood),
  ];
  // Turned about y, then laid along x.
  const geometry = turned(rings, 6, seed).rotateZ(-Math.PI / 2);
  geometry.rotateX(seed() * Math.PI * 2);
  // On its side, resting on its lowest ridge, not hovering over the ground.
  geometry.computeBoundingBox();
  geometry.translate(0, -h / 2 - geometry.boundingBox!.min.y, 0);
  put(g, geometry, BARK);
}

/** A stump standing on its end: its bark flared to the ground, rings on the sawn top. */
export function stumpModel(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
): void {
  const r = Math.min(w, d) / 2;
  const bark = hex(colour);
  const wood = sawnWood(colour);
  const top = h / 2;
  const rings: Ring[] = [
    // Its roots spreading into the ground, darker with the earth on them.
    { y: -h / 2, r, ridges: 1, colour: bark.clone().multiplyScalar(0.7) },
    { y: -h / 2 + h * 0.18, r: r * 0.88, ridges: 1, colour: bark },
    { y: top - 0.05, r: r * 0.85, ridges: 1, colour: bark },
    // The bark's rim, worn pale, standing a little proud of the sawn wood.
    { y: top, r: r * 0.83, ridges: 0.6, colour: bark.clone().lerp(hex(0xb08a62), 0.4) },
    ...sawnFace(top - 0.008, r * 0.8, wood),
  ];
  const geometry = turned(rings, 7, seed);
  geometry.rotateY(seed() * Math.PI * 2);
  put(g, geometry, BARK);
}

/** How far a pine's lowest boughs spread round its trunk, for its height. */
export const PINE_BOUGHS = 0.22;

/**
 * A pine: the box is the trunk, and five chunky tiers of boughs sit on it from `boughs` up (its
 * box's `boughs`, or a little under half way), spreading `PINE_BOUGHS` of its height round it
 * and so well outside the box. Nothing collides with them, which is how a tree's foliage should
 * be. The trunk, in ridged bark flaring at its foot, tapers up into the lowest tier.
 */
export function pineModel(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
  boughs = h * 0.42,
): void {
  const r = Math.min(w, d) / 2;
  // (The tree's deck fixings are drawn to this taper, see `treeDeckFixings`.)
  const trunkTop = h * 0.66;
  const bark = hex(colour);
  const foot = -h / 2;
  const at = (t: number, ridges = 1, shade = 1): Ring => ({
    y: foot + t * trunkTop,
    r: r * (1 - 0.4 * t),
    ridges,
    colour: bark.clone().multiplyScalar(shade),
  });
  const trunk = turned(
    [
      { y: foot, r: r * 1.12, ridges: 1, colour: bark.clone().multiplyScalar(0.65) },
      { ...at(0.3 / trunkTop), r: r * 0.99 },
      at(0.3),
      at(0.65),
      // Up in the boughs' shade.
      at(1, 1, 0.6),
      { ...at(1, 0, 0.5), r: 0 },
    ],
    6,
    seed,
  );
  put(g, trunk, BARK);
  const green = hex(0x3f6b3a).offsetHSL(seed() * 0.05 - 0.025, 0, seed() * 0.08 - 0.04);
  const R = h * PINE_BOUGHS;
  // The tiers fill from the lowest boughs to a tenth over the trunk's top, closer together
  // over a long bare trunk, each narrower than the one under it.
  const span = h * 1.1 - boughs;
  const tiers = 5;
  const tier = span * 0.34;
  for (let i = 0; i < tiers; i++) {
    const f = i / (tiers - 1);
    const th = tier * (1 - 0.25 * f);
    // Each turned its own way and, over the lowest (which stays level, for a deck may be built
    // just under it), leaning a hair off true, as if grown, not stacked. (Turned in its own
    // points, so that its bounds stay snug round it, as a deck's builders would measure.)
    const lean = i === 0 ? 0 : 0.04;
    const geometry = bough(R * (1 - 0.74 * f), th, f, green, seed)
      .rotateY(seed() * Math.PI * 2)
      .rotateX((seed() - 0.5) * lean)
      .rotateZ((seed() - 0.5) * lean);
    put(g, geometry, Surface.Grass).position.y = foot + boughs + f * (span - tier) + th / 2;
  }
}

/**
 * One tier of a pine's boughs, `r` round and `h` tall, `f` of the way up the tree: a cone that
 * bulges a little, its rim spread into seven to nine chunky branch tips drooping to its foot
 * with the hollows between them tucked in and up (never out past the tier or down under it,
 * where a deck may be built round it), hollowed underneath so the tier above does not show
 * through as a flat lid. Painted dark deep inside and underneath, in `green` over its slopes,
 * and light and yellower out at the tips, and the higher up the tree, the lighter.
 */
function bough(
  r: number,
  h: number,
  f: number,
  green: THREE.Color,
  seed: () => number,
): THREE.BufferGeometry {
  const tips = 7 + Math.floor(seed() * 3);
  const sides = tips * 2;
  const rows = 3;
  const geo = new THREE.ConeGeometry(r, h, sides, rows);
  const reach = Array.from({ length: sides }, (_, j) =>
    j % 2 === 0 ? 0.94 + seed() * 0.06 : 0.66 + seed() * 0.1,
  );
  const deep = green.clone().multiply(hex(0x4a5a66)).multiplyScalar(0.55);
  const light = green.clone().lerp(hex(0xc9d870), 0.55).multiplyScalar(1.15);
  const sunlit = 0.82 + 0.3 * f;
  const pos = geo.attributes.position!;
  const colours = new Float32Array(pos.count * 3);
  // The cone's points, as three.js lays them out: rows from the tip down, each `sides + 1`
  // round (the first point repeated at the seam), then the underside's middle (one per side)
  // and its rim.
  const torso = (rows + 1) * (sides + 1);
  const c = new THREE.Color();
  for (let k = 0; k < pos.count; k++) {
    const under = k >= torso;
    const middle = under && k < torso + sides;
    const j = (under ? (middle ? k - torso : k - torso - sides) : k % (sides + 1)) % sides;
    const v = under ? 1 : Math.floor(k / (sides + 1)) / rows;
    const tip = j % 2 === 0;
    if (middle) {
      // The middle of the underside, pushed up into the cone.
      pos.setXYZ(k, 0, -h / 2 + h * 0.45, 0);
      c.copy(deep).multiplyScalar(0.6);
    } else {
      const a = (j / sides) * Math.PI * 2;
      const out = r * (v + 0.12 * Math.sin(Math.PI * v)) * (1 - (1 - reach[j]!) * v ** 1.5);
      // The tips droop to the tier's foot; the hollows between them lift.
      const y = -h / 2 + h * (1 - v) + (tip ? -0.07 * h * Math.sin(Math.PI * v) : 0.22 * h * v * v);
      pos.setXYZ(k, out * Math.sin(a), y, out * Math.cos(a));
      if (under) c.copy(deep).lerp(green, 0.3);
      else {
        c.copy(deep)
          .lerp(green, Math.min(1, v / 0.7))
          .lerp(light, (tip ? 0.8 : 0.2) * v * v);
        c.multiplyScalar(sunlit);
      }
    }
    c.multiplyScalar(0.93 + seed() * 0.14);
    colours.set([c.r, c.g, c.b], k * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geo.computeVertexNormals();
  return geo;
}

/** How far a palm's fronds reach out from the top of its trunk, for its height. */
export const PALM_FRONDS = 0.36;
/** How far a palm leans over at its top, at the most, for its height (see `palmModel`). */
const PALM_LEAN = 0.15;
/**
 * How far a palm's crown can spread out from over its foot, for its height: the lean of its
 * trunk and its longest fronds.
 */
export const PALM_CROWN = PALM_LEAN + PALM_FRONDS * 1.08;

/** The palm's greens: dark at a frond's foot and underneath, bright yellow-green out to its tips. */
const FROND_FOOT = hex(0x3f7a22);
const FROND = hex(0x8cc43a);
const FROND_TIP = hex(0xd2e65c);
const FROND_RIB = hex(0xe4ee8a);
const FROND_UNDER = hex(0x5c8c2e);

/**
 * A palm: the box is its trunk, a stack of chunky rings each flaring to a pale lip, leaning a
 * little its own way and more the higher it goes, and on top a crown of eight to ten big
 * paddle fronds arching up and out and drooping to their tips, `PALM_FRONDS` of its height
 * round, with coconuts hanging under them. Like a pine's boughs the fronds reach well outside
 * the box and stop nothing; the lean stays within a hand of the box up to head height.
 */
export function palmModel(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
): void {
  const r = Math.min(w, d) / 2;
  const foot = -h / 2;
  const top = h / 2 - 0.12;
  const tall = top - foot;
  const bark = hex(colour);
  const lip = bark.clone().lerp(hex(0xe0cfa4), 0.4);
  const tuck = bark.clone().multiplyScalar(0.5);
  const count = Math.max(5, Math.round(tall / (0.3 + seed() * 0.06)));
  const step = tall / count;
  const rings: Ring[] = [{ y: foot, r: r * 1.12, ridges: 0.4, colour: tuck }];
  for (let i = 0; i < count; i++) {
    const y = foot + i * step;
    const rr = r * (1 - 0.3 * (i / count));
    const tone = 0.92 + seed() * 0.16;
    rings.push(
      // Tucked in under the lip of the ring below, in its shade.
      { y: y + 0.01, r: rr * 0.84, ridges: 0.35, colour: tuck },
      { y: y + step * 0.45, r: rr * 0.92, ridges: 0.35, colour: bark.clone().multiplyScalar(tone) },
      { y: y + step * 0.86, r: rr, ridges: 0.35, colour: bark.clone().multiplyScalar(tone * 1.1) },
      { y: y + step * 0.97, r: rr * 0.97, ridges: 0.2, colour: lip },
    );
  }
  rings.push({ y: top, r: 0, ridges: 0, colour: tuck });
  const trunk = turned(rings, 4, seed);
  // Bent over: each point moved along the way it leans by the square of its height up it.
  const heading = seed() * Math.PI * 2;
  const lean = h * (0.07 + seed() * (PALM_LEAN - 0.07));
  const lx = Math.cos(heading) * lean;
  const lz = Math.sin(heading) * lean;
  const bend = (geometry: THREE.BufferGeometry) => {
    const pos = geometry.attributes.position!;
    for (let k = 0; k < pos.count; k++) {
      const t = ((pos.getY(k) - foot) / tall) ** 2;
      pos.setXYZ(k, pos.getX(k) + lx * t, pos.getY(k), pos.getZ(k) + lz * t);
    }
    geometry.computeVertexNormals();
  };
  bend(trunk);
  // Its shadow is cast by a plain tapering core inside it, bent with it: just inside the rings
  // where they are tucked in narrowest (a ridge's groove, at 0.775 of the ring's round), and in
  // short enough lengths to follow the bend to within a few millimetres.
  put(g, trunk, BARK, false);
  const core: [number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const f = i / 8;
    core.push([r * 0.73 * (1 - 0.3 * f), foot + (top - 0.06 - foot) * f]);
  }
  bend(shadowCore(g, [...core, [0, top - 0.06]], 8).geometry);

  // The crown: the frond stalks' sheaths bunched round the top, the fronds out of it, and the
  // coconuts hanging under them.
  const crown = new THREE.Vector3(lx, top, lz);
  const rc = r * 0.7;
  const sheath = turned(
    [
      { y: -0.12, r: 0, ridges: 0, colour: tuck },
      { y: -0.1, r: rc * 1.2, ridges: 1, colour: FROND_FOOT.clone().lerp(bark, 0.6) },
      { y: 0.06, r: rc * 1.45, ridges: 1, colour: FROND_FOOT.clone().lerp(bark, 0.3) },
      { y: 0.18, r: rc * 0.8, ridges: 1, colour: FROND_FOOT },
      { y: 0.24, r: 0, ridges: 0, colour: FROND_FOOT },
    ],
    3,
    seed,
  );
  put(g, sheath, BARK).position.copy(crown);
  const fronds = 8 + Math.floor(seed() * 3);
  const turn = seed() * Math.PI * 2;
  const reach = h * PALM_FRONDS;
  for (let i = 0; i < fronds; i++) {
    const a = turn + ((i + (seed() - 0.5) * 0.4) / fronds) * Math.PI * 2;
    // Every other one higher and shorter, the rest drooping lower and further out.
    const high = i % 2 === 0;
    // (The longest is 1.08 of `reach`: see `PALM_CROWN`.)
    const length = reach * (high ? 0.78 + seed() * 0.15 : 0.92 + seed() * 0.16);
    const rise = high ? 0.45 + seed() * 0.25 : 0.2 + seed() * 0.2;
    const droop = high ? 0.35 + seed() * 0.2 : 0.55 + seed() * 0.25;
    // Its top seen from above and its underside from below, but the shadow cast by the
    // underside alone: the two lie in each other, and one casts what both did.
    const [top, under] = frond(length, rise, droop, seed);
    const shading = put(g, under, Surface.Grass);
    shading.material = painted(Surface.Grass, false, true);
    for (const leaf of [put(g, top, Surface.Grass, false), shading]) {
      leaf.position.copy(crown).add(new THREE.Vector3(0, 0.1, 0));
      leaf.rotation.y = -a;
    }
  }
  for (let i = 0; i < 3; i++) {
    const a = turn + (i / 3) * Math.PI * 2 + 0.5;
    const nut = new THREE.IcosahedronGeometry(0.085 + seed() * 0.02, 0);
    const shade = hex(0x5b4a22).lerp(hex(0x6f7a2a), seed());
    const colours: number[] = [];
    const at = nut.attributes.position!;
    for (let k = 0; k < at.count; k++) {
      const c = shade.clone().multiplyScalar(0.75 + 0.45 * Math.max(0, at.getY(k) / 0.1));
      colours.push(c.r, c.g, c.b);
    }
    nut.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    put(g, nut, Surface.Auto, false).position.set(
      crown.x + Math.cos(a) * rc * 1.25,
      crown.y - 0.05 - seed() * 0.06,
      crown.z + Math.sin(a) * rc * 1.25,
    );
  }
}

/**
 * One palm frond along +x, `length` long: a broad paddle of a leaf on its midrib, which arches
 * up `rise` of its length at first and then droops to its tip, `droop` of its length under where
 * it starts. It is folded down a little either side of the rib, as a real one is, and its edges
 * are cut into leaflets that sweep toward the tip. Painted bright yellow-green on top, pale
 * along the rib and the tips, dark at its foot, and a darker green underneath: its top and its
 * underside, each its own geometry, through the same points.
 */
function frond(
  length: number,
  rise: number,
  droop: number,
  seed: () => number,
): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const rows = 16;
  const width = length * (0.17 + seed() * 0.04);
  const fold = 0.32;
  // The midrib's line: up and out, then over and down.
  const rib = (u: number) =>
    new THREE.Vector3(length * u, length * (rise * u - (rise + droop) * u * u), 0);
  // The top of the leaf, then the same points again for its underside.
  const [top, underside] = [false, true].map((under) => {
    const positions: number[] = [];
    const colours: number[] = [];
    const index: number[] = [];
    const point = (p: THREE.Vector3, c: THREE.Color) => {
      positions.push(p.x, p.y, p.z);
      colours.push(c.r, c.g, c.b);
    };
    for (let i = 0; i <= rows; i++) {
      const u = i / rows;
      // Narrow at its stalk, broadest a third out, to a point at the tip.
      const half =
        width * Math.sin(Math.PI * Math.min(1, u * 1.12) ** 0.75) * (u < 0.08 ? u / 0.08 : 1);
      const tooth = i % 2 === 0;
      const out = tooth ? half : half * 0.76;
      // A leaflet's tip sweeps on toward the frond's tip.
      const ahead = tooth && i < rows ? 0.55 / rows : 0;
      const c = FROND_FOOT.clone().lerp(FROND, Math.min(1, u / 0.35));
      const shade = 0.9 + seed() * 0.2;
      const lit = c
        .clone()
        .lerp(FROND_TIP, tooth ? 0.5 * u : 0.15 * u)
        .multiplyScalar(shade);
      const mid = rib(u);
      point(mid, under ? FROND_UNDER : c.clone().lerp(FROND_RIB, 0.65 * Math.min(1, u * 2)));
      for (const side of [-1, 1]) {
        const p = rib(Math.min(1, u + ahead));
        p.z = side * out;
        p.y -= out * fold;
        point(p, under ? FROND_UNDER.clone().multiplyScalar(0.9 + 0.3 * u) : lit);
      }
    }
    // Rows of three points: the rib, then either edge.
    for (let i = 0; i < rows; i++) {
      const a = i * 3;
      const b = a + 3;
      for (const e of [1, 2]) {
        // Wound to face up on top (the -z edge's the other way round) and down underneath.
        const flip = (e === 1) !== under;
        if (flip) index.push(a, b, a + e, a + e, b, b + e);
        else index.push(a, a + e, b, a + e, b + e, b);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    return geometry;
  });
  return [top!, underside!];
}

/**
 * A boulder fitted to the box: a chunky lump of a few big flat facets, its edges bevelled as if
 * knocked off and worn, each facet its own shade of grey, lighter on top and pale along the
 * worn bevels, dark underneath and down by the ground, with moss on some of its top.
 *
 * It is the hull round a ring of points on the ground (its flat foot), a ring round its
 * shoulders and a few on top, and then the hull again round each of its faces drawn in a
 * little from its edges, which cuts a bevel along every edge.
 */
export function rockModel(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
): void {
  const points: THREE.Vector3[] = [];
  const ring = (n: number, y: number, r0: number, r1: number, rise: number) => {
    const turn = seed() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = turn + ((i + (seed() - 0.5) * 0.5) / n) * Math.PI * 2;
      const r = r0 + seed() * (r1 - r0);
      points.push(new THREE.Vector3(Math.cos(a) * r, y + seed() * rise, Math.sin(a) * r));
    }
  };
  ring(6, 0, 0.75, 0.95, 0);
  ring(5 + Math.floor(seed() * 2), 0.4, 0.85, 1, 0.2);
  ring(3, 0.85, 0.2, 0.55, 0.15);
  // Weathered paler than the stone's own colour, which reads near black in the shade.
  const base = hex(colour).lerp(hex(0xbab5ab), 0.5);
  const geometry = facetedStone(points, 0.07, w, h, d);
  paintStone(geometry, w, h, d, base, seed() < 0.6);
  put(g, geometry, STONE).position.y = -h / 2;
}

/** A great rock's own grey, pale, its faces in the sun warmer and those in shade cooler. */
const BOULDER = 0xd5d8d6;
const SUNLIT = 0xf3eee2;
const COOL = 0x8796a8;
/** Sand blown against a great rock's foot, and the rock wet and weedy under the sea. */
const SANDY = 0xc9b38a;
const WET_ROCK = 0x3e5a55;

/**
 * A great boulder fitted to the box, as the island's are: a block of stone with its corners
 * knocked off, a few broad flat faces with chunky bevels between them, its broad top tipped one
 * way. It is pale grey, warmer and lighter on top in the sun, cooler down its sides, darker
 * underneath; worn pale along its bevels, with a soft crack or two down its biggest faces;
 * sandy at its foot, where the map sinks it into the ground, or dark and wet below the sea's
 * level `sea` (in its frame) where it stands in the water. A tall one may have a smaller rock
 * fallen against it, inside the box. Its foot fills the box but for the corners, so that what
 * players bump into is mostly rock.
 */
export function boulderModel(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
  sea: number | null = null,
): void {
  const tall = h / Math.max(w, d);
  const base = hex(colour).lerp(hex(BOULDER), 0.72);
  // A smaller rock against a tall one's side, along its longer way, in a slice of the box.
  const leaning = h > 2.4 && seed() < 0.6;
  const alongX = w >= d;
  const L = alongX ? w : d;
  const slice = leaning ? L * (0.26 + seed() * 0.06) : 0;
  const end = seed() < 0.5 ? -1 : 1;
  const mainL = L - slice;
  const shift = (-end * slice) / 2;
  const mainW = alongX ? mainL : w;
  const mainD = alongX ? d : mainL;
  // Tall ones narrow and tip more toward their tops; low ones stay broad, to stand on.
  const taper = tall > 1 ? 0.72 + seed() * 0.12 : 0.9 + seed() * 0.06;
  const tip = tall > 1 ? 0.12 + seed() * 0.12 : 0.04 + seed() * 0.05;
  const points = knockedBlock(seed, taper, tip, tall > 1 ? 0.3 : 0.24);
  const main = facetedStone(points, 0.06, mainW, h, mainD);
  paintBoulder(main, h, base, seed, sea === null ? null : sea + h / 2);
  const m = put(g, main, STONE);
  m.position.set(alongX ? shift : 0, -h / 2, alongX ? 0 : shift);
  const cracks = crackLines(main, seed);
  if (cracks) m.add(cracks);
  if (leaning) {
    // The fallen piece at the box's end, its top tipped in onto the big one, its foot sunk.
    const sw = slice + mainL * 0.12;
    const sd = (alongX ? d : w) * (0.5 + seed() * 0.2);
    const sh = h * (0.34 + seed() * 0.12);
    const piece = facetedStone(
      knockedBlock(seed, 0.8, 0.15, 0.3),
      0.07,
      alongX ? sw : sd,
      sh,
      alongX ? sd : sw,
    );
    const tilt = 0.2 + seed() * 0.1;
    if (alongX) piece.rotateZ(end * tilt);
    else piece.rotateX(-end * tilt);
    piece.computeBoundingBox();
    const bb = piece.boundingBox!;
    const across = (seed() - 0.5) * ((alongX ? d : w) - sd) * 0.8;
    // Its outer side at the box's end, its lowest point at the box's foot.
    const outer =
      end > 0 ? L / 2 - (alongX ? bb.max.x : bb.max.z) : -L / 2 - (alongX ? bb.min.x : bb.min.z);
    piece.translate(alongX ? outer : across, -bb.min.y, alongX ? across : outer);
    paintBoulder(piece, sh, base, seed, sea === null ? null : sea + h / 2);
    put(g, piece.translate(0, -h / 2, 0), STONE);
    const crack = crackLines(piece, seed, 1);
    if (crack) g.add(crack);
  }
}

/**
 * The corners of a block of stone with its corners knocked off, to take the hull of: cut from a
 * box -1 to 1 across (x and z) and 0 to 1 up by flat planes, so that its faces are flat. Its
 * sides lean in to `taper` of its width at the top, its top is tipped `tip` down to one side,
 * each corner is cut off (deeper up top, by up to `cut`), and some of the top's edges are
 * bevelled broad, and a side or two is broken into two faces with a ridge between.
 */
function knockedBlock(
  seed: () => number,
  taper: number,
  tip: number,
  cut: number,
): THREE.Vector3[] {
  /** The planes, as n·p <= c. */
  const planes: { n: THREE.Vector3; c: number }[] = [];
  const plane = (n: THREE.Vector3, c: number) => planes.push({ n, c });
  plane(new THREE.Vector3(0, -1, 0), 0);
  const way = seed() * Math.PI * 2;
  const k = tip / (2 * Math.SQRT2);
  plane(new THREE.Vector3(-k * Math.cos(way), 1, -k * Math.sin(way)), 1 - tip / 2);
  // The sides, each through its foot's edge, leaning in; one or two in two faces.
  const ridged = new Set([Math.floor(seed() * 4), Math.floor(seed() * 4)]);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const lean = (1 - taper) * (0.8 + seed() * 0.4);
    const turns = ridged.has(i) ? [-0.16 - seed() * 0.1, 0.16 + seed() * 0.1] : [0];
    const out = 1 - seed() * 0.05;
    for (const t of turns) {
      const n = new THREE.Vector3(Math.cos(a + t), lean, Math.sin(a + t));
      // Through the point `out` along the side's middle at the foot.
      plane(n, out * Math.cos(t));
    }
  }
  // Where three planes meet, if it is inside all the others.
  const corners = (): THREE.Vector3[] => {
    const found: THREE.Vector3[] = [];
    const m = new THREE.Matrix3();
    for (let i = 0; i < planes.length; i++)
      for (let j = i + 1; j < planes.length; j++)
        for (let l = j + 1; l < planes.length; l++) {
          const [a, b, c] = [planes[i]!, planes[j]!, planes[l]!];
          m.set(a.n.x, a.n.y, a.n.z, b.n.x, b.n.y, b.n.z, c.n.x, c.n.y, c.n.z);
          if (Math.abs(m.determinant()) < 1e-9) continue;
          const p = new THREE.Vector3(a.c, b.c, c.c).applyMatrix3(m.invert());
          if (planes.some((q) => q.n.dot(p) > q.c + 1e-6)) continue;
          if (found.some((f) => f.distanceToSquared(p) < 1e-8)) continue;
          found.push(p);
        }
    return found;
  };
  // Each corner of that knocked off by a plane across it, square to the way out of it.
  const centre = new THREE.Vector3(0, 0.45, 0);
  for (const p of corners()) {
    const top = p.y > 0.5;
    const deep = top ? cut * (0.4 + seed() * 0.6) : cut * (0.12 + seed() * 0.18);
    const n = p.clone().sub(centre);
    n.y *= top ? 1.4 : 0.5;
    n.x += (seed() - 0.5) * 0.4;
    n.z += (seed() - 0.5) * 0.4;
    n.normalize();
    plane(n, n.dot(p) - deep);
  }
  // A broad bevel along some of the top's edges.
  for (let i = 0; i < 4; i++) {
    if (seed() < 0.5) continue;
    const a = (i * Math.PI) / 2 + (seed() - 0.5) * 0.3;
    const n = new THREE.Vector3(Math.cos(a), 1.1, Math.sin(a)).normalize();
    const edge = new THREE.Vector3(Math.cos(a) * taper, 1 - tip / 2, Math.sin(a) * taper);
    plane(n, n.dot(edge) - cut * (0.25 + seed() * 0.25));
  }
  return corners();
}

/**
 * Paints a great rock (`facetedStone`'s, `h` tall) in vertex colours, face by face (the
 * triangles lying in one plane are one face): each face its own shade of `base`, warmer and
 * lighter turned to the sky, cooler down its sides, darker underneath; the narrow bevels and
 * corners between the big faces worn pale; sandy at its foot, or dark and wet below `sea` (from
 * its foot) and darker a hand's breadth over it.
 */
function paintBoulder(
  geo: THREE.BufferGeometry,
  h: number,
  base: THREE.Color,
  seed: () => number,
  sea: number | null,
): void {
  const at = geo.attributes.position!;
  const normals = geo.attributes.normal!;
  const colours = new Float32Array(at.count * 3);
  const sunlit = hex(SUNLIT);
  const cool = hex(COOL);
  const sandy = hex(SANDY);
  const wet = hex(WET_ROCK);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const e = new THREE.Vector3();
  // The faces: the triangles turned the same way, and how big each face is.
  const faces: { n: THREE.Vector3; area: number; tone: number }[] = [];
  const faceOf: number[] = [];
  let total = 0;
  for (let k = 0; k < at.count; k += 3) {
    const n = new THREE.Vector3().fromBufferAttribute(normals, k);
    a.fromBufferAttribute(at, k);
    b.fromBufferAttribute(at, k + 1).sub(a);
    e.fromBufferAttribute(at, k + 2).sub(a);
    const area = b.cross(e).length() / 2;
    total += area;
    let f = faces.findIndex((x) => x.n.dot(n) > 0.9995);
    if (f < 0) f = faces.push({ n, area: 0, tone: seed() }) - 1;
    faces[f]!.area += area;
    faceOf.push(f);
  }
  for (let k = 0; k < at.count; k += 3) {
    const face = faces[faceOf[k / 3]!]!;
    const up = face.n.y;
    const worn = face.area < total * 0.022;
    const c = base.clone();
    if (up > 0.45) c.lerp(sunlit, 0.25 + 0.25 * up).multiplyScalar(1 + 0.08 * up);
    else if (up < -0.2) c.lerp(cool, 0.4).multiplyScalar(0.66);
    else c.lerp(cool, 0.06 + 0.16 * (1 - face.tone)).multiplyScalar(0.9 + 0.16 * face.tone);
    if (worn) c.lerp(sunlit, 0.3).multiplyScalar(1.05);
    for (let n = 0; n < 3; n++) {
      const y = at.getY(k + n);
      const p = c.clone();
      if (sea !== null && y < sea + 0.25) {
        // Wet below the sea, and darker just over it where the waves wash.
        p.lerp(wet, y < sea ? 0.7 : 0.3).multiplyScalar(y < sea ? 0.7 : 0.85);
      } else {
        // Sand blown against its foot, where the ground was dug out round it.
        const low = Math.max(0, 1 - y / Math.min(1.2, h * 0.4));
        p.multiplyScalar(0.86 + 0.14 * (1 - low)).lerp(sandy, 0.4 * low);
      }
      colours.set([p.r, p.g, p.b], (k + n) * 3);
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
}

/**
 * Soft cracks down a rock's biggest faces that do not face up (`count` of them): each a dark
 * line wandering a little in from near an edge, thinning as it goes, laid a hair out from the
 * face. Their colours are the face's own, darkened. (No lit lip along them: on the pale rock a
 * lip reads as a stick laid on it, not a crack in it.)
 */
function crackLines(
  geo: THREE.BufferGeometry,
  seed: () => number,
  count = 2,
): THREE.Object3D | null {
  const at = geo.attributes.position!;
  const normals = geo.attributes.normal!;
  const colours = geo.attributes.color!;
  const faces: { k: number; area: number }[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let k = 0; k < at.count; k += 3) {
    if (Math.abs(normals.getY(k)) > 0.5) continue;
    a.fromBufferAttribute(at, k);
    b.fromBufferAttribute(at, k + 1);
    c.fromBufferAttribute(at, k + 2);
    const area = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
    faces.push({ k, area });
  }
  faces.sort((p, q) => q.area - p.area);
  const positions: number[] = [];
  const out: number[] = [];
  const paint: number[] = [];
  for (const { k, area } of faces.slice(0, count)) {
    if (area < 0.6) continue;
    const corners = [0, 1, 2].map((i) => new THREE.Vector3().fromBufferAttribute(at, k + i));
    const n = new THREE.Vector3().fromBufferAttribute(normals, k);
    const shade = new THREE.Color().fromBufferAttribute(colours, k);
    // A point in the face from its corners' weights.
    const inFace = (u: number, v: number) =>
      corners[0]!
        .clone()
        .multiplyScalar(1 - u - v)
        .addScaledVector(corners[1]!, u)
        .addScaledVector(corners[2]!, v);
    // From near the middle of an edge in toward the face's middle, wandering.
    const start = 0.06 + seed() * 0.05;
    const line: THREE.Vector3[] = [];
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const u = 0.47 - 0.25 * t + (i > 0 ? (seed() - 0.5) * 0.04 : 0);
      const v = 0.47 - 0.2 * t + (i > 0 ? (seed() - 0.5) * 0.04 : 0);
      line.push(
        inFace(Math.min(u, 0.5 - start / 2), Math.min(v, 0.5 - start / 2)).addScaledVector(
          n,
          0.006,
        ),
      );
    }
    const width = Math.min(0.06, Math.sqrt(area) * 0.025);
    for (let i = 0; i + 1 < line.length; i++) {
      const p0 = line[i]!;
      const p1 = line[i + 1]!;
      const along = p1.clone().sub(p0).normalize();
      const side = along.clone().cross(n).normalize();
      const w0 = width * (1 - i / steps);
      const w1 = width * (1 - (i + 1) / steps) + 0.004;
      const q = [
        p0.clone().addScaledVector(side, -w0 / 2),
        p1.clone().addScaledVector(side, -w1 / 2),
        p1.clone().addScaledVector(side, w1 / 2),
        p0.clone().addScaledVector(side, w0 / 2),
      ];
      // Wound to face out along the face's normal.
      const face = q[1]!.clone().sub(q[0]!).cross(q[2]!.clone().sub(q[0]!));
      const order = face.dot(n) < 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
      const col = shade.clone().multiplyScalar(0.4);
      for (const j of order) {
        positions.push(q[j]!.x, q[j]!.y, q[j]!.z);
        out.push(n.x, n.y, n.z);
        paint.push(col.r, col.g, col.b);
      }
    }
  }
  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(out, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(paint, 3));
  const mesh = new THREE.Mesh(geometry, painted(STONE));
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * The hull round `points` with every edge bevelled `bevel` deep (in the points' own units),
 * stretched to `w` by `h` by `d` standing on y = 0, each face flat.
 */
function facetedStone(
  points: THREE.Vector3[],
  bevel: number,
  w: number,
  h: number,
  d: number,
): THREE.BufferGeometry {
  const hull = new ConvexHull().setFromPoints(points);
  const inset: THREE.Vector3[] = [];
  const middle = new THREE.Vector3();
  const towards = new THREE.Vector3();
  for (const face of hull.faces) {
    const corners: THREE.Vector3[] = [];
    let edge = face.edge;
    do {
      corners.push(edge.head().point);
      edge = edge.next;
    } while (edge !== face.edge);
    middle.set(0, 0, 0);
    for (const c of corners) middle.addScaledVector(c, 1 / corners.length);
    for (const c of corners) {
      towards.subVectors(middle, c);
      const by = Math.min(bevel, towards.length() * 0.4);
      inset.push(c.clone().addScaledVector(towards.normalize(), by));
    }
  }
  const geo = new ConvexGeometry(inset);
  // Stretched to just fill the box, standing on the ground.
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const size = bb.getSize(new THREE.Vector3());
  geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  geo.scale((w * 0.98) / size.x, (h * 0.98) / size.y, (d * 0.98) / size.z);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Paints a stone (`facetedStone`'s, fitted to a box `w` by `h` by `d`) in vertex colours: each
 * facet its own shade of `base`, lighter facing up, darker facing down and earthy low down, the
 * worn bevels pale, and moss on some of the top if `mossy`.
 */
function paintStone(
  geo: THREE.BufferGeometry,
  w: number,
  h: number,
  d: number,
  base: THREE.Color,
  mossy: boolean,
) {
  const at = geo.attributes.position!;
  const normals = geo.attributes.normal!;
  const moss = hex(0x6d8f3a);
  const colours = new Float32Array(at.count * 3);
  const c = new THREE.Color();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const e = new THREE.Vector3();
  // The facets are big; the bevels and the corners between them small, for the size of the box
  // (the stone stands a hair inside it).
  const area = w * d * 0.02;
  for (let k = 0; k < at.count; k += 3) {
    const up = normals.getY(k);
    a.fromBufferAttribute(at, k);
    b.fromBufferAttribute(at, k + 1).sub(a);
    e.fromBufferAttribute(at, k + 2).sub(a);
    const worn = b.cross(e).length() / 2 < area;
    // Each facet a shade of its own, from which way it faces.
    const tone =
      Math.abs(Math.sin(normals.getX(k) * 12.9898 + normals.getZ(k) * 78.233) * 43758.5453) % 1;
    c.copy(base).multiplyScalar(0.84 + 0.26 * tone);
    c.multiplyScalar(up > 0 ? 1 + 0.3 * up : 1 + 0.45 * up);
    if (worn) c.multiplyScalar(1.12 + 0.12 * Math.max(0, up));
    const mossHere = mossy && up > 0.55;
    for (let n = 0; n < 3; n++) {
      const y = at.getY(k + n);
      // Down by the ground, earthy.
      const p = c.clone().multiplyScalar(0.72 + 0.28 * Math.min(1, y / (h * 0.3)));
      if (mossHere && y > h * 0.5) p.lerp(moss, 0.5);
      colours.set([p.r, p.g, p.b], (k + n) * 3);
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
}

// ---------------------------------------------------------------- greenery

/** Triangles gathered into one geometry: their points, normals and colours. */
class Batch {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colours: number[] = [];
  /** How high the ground is under what is being added: everything added is lifted by it. */
  ground = 0;

  /** One point of a triangle. */
  point(p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color): void {
    this.positions.push(p.x, p.y + this.ground, p.z);
    this.normals.push(n.x, n.y, n.z);
    this.colours.push(c.r, c.g, c.b);
  }

  /**
   * Adds a geometry with normals and colours, moved by `matrix`: point by point, rounded at each
   * step as a copy of it moved and then lifted onto the ground would be, to the last bit, but
   * without making that copy (which took most of the time building a level's greenery).
   */
  add(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): void {
    const { position, normal, color } = geometry.attributes as Record<
      string,
      THREE.BufferAttribute
    >;
    const index = geometry.index;
    const turn = new THREE.Matrix3().getNormalMatrix(matrix);
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const f = Math.fround;
    const count = index ? index.count : position!.count;
    for (let i = 0; i < count; i++) {
      const k = index ? index.getX(i) : i;
      p.fromBufferAttribute(position!, k).applyMatrix4(matrix);
      this.positions.push(f(p.x), f(f(p.y) + this.ground), f(p.z));
      n.fromBufferAttribute(normal!, k).applyNormalMatrix(turn);
      n.set(f(n.x), f(n.y), f(n.z)).normalize();
      this.normals.push(f(n.x), f(n.y), f(n.z));
      this.colours.push(color!.getX(k), color!.getY(k), color!.getZ(k));
    }
  }

  get empty(): boolean {
    return this.positions.length === 0;
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colours, 3));
    return g;
  }
}

/** A number from 0 to 1 that looks random, the same for the same numbers on every client. */
function hash(...xs: number[]): number {
  let h = 2166136261;
  for (const x of xs) {
    h = Math.imul(h ^ Math.round(x * 1000), 16777619);
    h ^= h >>> 13;
  }
  return (h >>> 0) / 4294967296;
}

/** Pseudo-random numbers seeded from a position (mulberry32), the same on every client. */
function rngAt(...xs: number[]): () => number {
  let s = Math.floor(hash(...xs) * 4294967296);
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The greens of grass and leaves: dark at the root and in the shade, light at the tips. */
const GRASS_ROOT = hex(0x24401f);
const GRASS_TIP = hex(0xa9c95a);
const GRASS_DRY = hex(0xd1c46a);
const LEAF_SHADE = hex(0x1f3a24);
const LEAF = hex(0x4a8a3a);
const LEAF_LIGHT = hex(0xb0d662);
const PETALS = [0xf4f1e4, 0xf6c91c, 0xe2553f, 0xb36ad6, 0xf08fb5];

const UP = new THREE.Vector3(0, 1, 0);

/**
 * A tuft of grass, `size` tall, at `x, z`: five to seven chunky blades, each a thin spike of
 * three faces leaning out from the root, dark at its foot and light at its tip. They are lit as
 * if part of the ground under them (their normals mostly up), so a tuft reads as grass grown up
 * out of it, not as a cluster of shiny spikes.
 */
function tuft(batch: Batch, x: number, z: number, size: number, rng: () => number): void {
  const blades = 6 + Math.floor(rng() * 3);
  const tip = GRASS_TIP.clone().lerp(GRASS_DRY, rng() * 0.35);
  const root = new THREE.Vector3();
  const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const top = new THREE.Vector3();
  const out = new THREE.Vector3();
  const across = new THREE.Vector3();
  const nFoot = new THREE.Vector3();
  const nTip = new THREE.Vector3();
  const cTip = new THREE.Color();
  const turn = rng() * Math.PI * 2;
  for (let k = 0; k < blades; k++) {
    const a = turn + ((k + rng() * 0.7) / blades) * Math.PI * 2;
    out.set(Math.cos(a), 0, Math.sin(a));
    across.set(-out.z, 0, out.x);
    const lean = 0.25 + rng() * 0.5;
    const length = size * (0.6 + rng() * 0.5);
    const width = size * (0.11 + rng() * 0.05);
    root.set(x, -0.01, z).addScaledVector(out, size * 0.1 * rng());
    corners[0]!.copy(root).addScaledVector(across, width);
    corners[1]!.copy(root).addScaledVector(across, -width);
    corners[2]!.copy(root).addScaledVector(out, -width * 0.7);
    top
      .copy(root)
      .addScaledVector(out, length * Math.sin(lean))
      .addScaledVector(across, (rng() - 0.5) * length * 0.25)
      .addScaledVector(UP, length * Math.cos(lean));
    nFoot.copy(out).multiplyScalar(0.3).add(UP).normalize();
    nTip.copy(out).multiplyScalar(0.8).add(UP).normalize();
    cTip.copy(tip).multiplyScalar(0.85 + rng() * 0.3);
    for (let s = 0; s < 3; s++) {
      batch.point(corners[s]!, nFoot, GRASS_ROOT);
      batch.point(corners[(s + 1) % 3]!, nFoot, GRASS_ROOT);
      batch.point(top, nTip, cTip);
    }
  }
}

/** A ball of `detail` (see `leafBall`), its corners welded: each made once, then copied. */
const balls: THREE.BufferGeometry[] = [];
function weldedBall(detail: number): THREE.BufferGeometry {
  const ball = new THREE.IcosahedronGeometry(1, detail);
  ball.deleteAttribute('normal');
  ball.deleteAttribute('uv');
  const geo = mergeVertices(ball);
  ball.dispose();
  return geo;
}

/** A lumpy ball of leaves, `detail` fine (see `IcosahedronGeometry`), its own lumps from `rng`. */
function leafBall(detail: number, rng: () => number): THREE.BufferGeometry {
  const geo = (balls[detail] ??= weldedBall(detail)).clone();
  const pos = geo.attributes.position!;
  const v = new THREE.Vector3();
  const waves = Array.from({ length: 3 }, () => ({
    k: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize().multiplyScalar(4),
    phase: rng() * Math.PI * 2,
  }));
  for (let k = 0; k < pos.count; k++) {
    v.fromBufferAttribute(pos, k);
    let r = 1;
    for (const w of waves) r += 0.09 * Math.sin(v.dot(w.k) + w.phase);
    v.multiplyScalar(r);
    pos.setXYZ(k, v.x, v.y, v.z);
  }
  return geo;
}

/**
 * A bush, `r` round and `h` tall, at `x, z`: a big lumpy ball of leaves with smaller ones
 * huddled round it, painted dark underneath and inside, in leaf green round their sides and
 * light on top, where the sun catches them. A `small` one (a hand's breadth, in a window box)
 * keeps its huddled balls coarse, as no one is near enough to see them.
 */
function bush(
  batch: Batch,
  x: number,
  z: number,
  r: number,
  h: number,
  rng: () => number,
  small = false,
): void {
  const tint = new THREE.Color().setHSL(rng() * 0.06 - 0.03, 0, 0);
  const mid = LEAF.clone().offsetHSL(tint.r, 0, rng() * 0.06 - 0.03);
  const light = LEAF_LIGHT.clone().offsetHSL(tint.r, 0, 0);
  const balls: { x: number; y: number; z: number; s: THREE.Vector3; detail: number }[] = [
    { x: 0, y: h * 0.52, z: 0, s: new THREE.Vector3(r * 0.72, h * 0.5, r * 0.72), detail: 1 },
  ];
  const more = 3 + Math.floor(rng() * 3);
  const turn = rng() * Math.PI * 2;
  for (let i = 0; i < more; i++) {
    const a = turn + ((i + rng() * 0.5) / more) * Math.PI * 2;
    const s = 0.42 + rng() * 0.18;
    balls.push({
      x: Math.cos(a) * r * 0.55,
      y: h * (0.25 + rng() * 0.15),
      z: Math.sin(a) * r * 0.55,
      s: new THREE.Vector3(r * s, h * s * 0.85, r * s),
      detail: s > 0.52 && !small ? 1 : 0,
    });
  }
  const matrix = new THREE.Matrix4();
  const c = new THREE.Color();
  for (const b of balls) {
    const geo = leafBall(b.detail, rng);
    geo.scale(b.s.x, b.s.y, b.s.z);
    geo.computeVertexNormals();
    const pos = geo.attributes.position!;
    const normals = geo.attributes.normal!;
    const colours = new Float32Array(pos.count * 3);
    for (let k = 0; k < pos.count; k++) {
      const up = normals.getY(k);
      const y = b.y + pos.getY(k);
      c.copy(LEAF_SHADE).lerp(mid, THREE.MathUtils.smoothstep(up, -0.7, 0.2));
      c.lerp(light, THREE.MathUtils.smoothstep(up, 0.2, 1) * 0.85);
      // Shaded in, low down among the others.
      c.multiplyScalar((0.55 + 0.45 * Math.min(1, y / h + 0.25)) * (0.9 + rng() * 0.2));
      colours.set([c.r, c.g, c.b], k * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    batch.add(geo, matrix.makeTranslation(x + b.x, b.y, z + b.z));
    geo.dispose();
  }
}

/**
 * A flower at `x, z`: a green stalk up to a head of five petals in `colour` round a yellow
 * middle, turned up to the sun.
 */
function flower(batch: Batch, x: number, z: number, colour: number, rng: () => number): void {
  const tall = 0.12 + rng() * 0.12;
  const head = new THREE.Vector3(x + (rng() - 0.5) * 0.06, tall, z + (rng() - 0.5) * 0.06);
  const stalk = 0.008;
  const foot = [0, 1, 2].map((i) => {
    const a = (i / 3) * Math.PI * 2;
    return new THREE.Vector3(x + Math.cos(a) * stalk, -0.01, z + Math.sin(a) * stalk);
  });
  const n = new THREE.Vector3();
  for (let s = 0; s < 3; s++) {
    const a = foot[s]!;
    const b = foot[(s + 1) % 3]!;
    n.copy(a).add(b).multiplyScalar(0.5).sub(head).setY(0).normalize().add(UP).normalize();
    batch.point(b, n, GRASS_ROOT);
    batch.point(a, n, GRASS_ROOT);
    batch.point(head, n, LEAF);
  }
  // The head: a shallow five-pointed star, its middle raised and yellow.
  const petal = hex(colour);
  const middle = hex(0xf2c230);
  const size = 0.05 + rng() * 0.025;
  const turn = rng() * Math.PI * 2;
  const centre = head.clone().setY(tall + size * 0.45);
  const under = head.clone().setY(tall - size * 0.2);
  const rim = Array.from({ length: 5 }, (_, i) => {
    const a = turn + (i / 5) * Math.PI * 2;
    return new THREE.Vector3(head.x + Math.cos(a) * size, tall, head.z + Math.sin(a) * size);
  });
  const down = new THREE.Vector3(0, -1, 0);
  const shade = petal.clone().multiplyScalar(0.55);
  for (let i = 0; i < 5; i++) {
    const a = rim[i]!;
    const b = rim[(i + 1) % 5]!;
    batch.point(centre, UP, middle);
    batch.point(b, UP, petal);
    batch.point(a, UP, petal);
    batch.point(under, down, shade);
    batch.point(a, down, shade);
    batch.point(b, down, shade);
  }
}

/** A leaf's colours (see `blade`): dark at its foot, out to its tips, along its rib, beneath. */
interface LeafPaint {
  foot: THREE.Color;
  mid: THREE.Color;
  tip: THREE.Color;
  rib: THREE.Color;
  under: THREE.Color;
}

/** The big leaves of the lush tropical plants: a rich green, yellower out to the tips. */
const BIG_LEAF: LeafPaint = {
  foot: hex(0x2f5a2a),
  mid: hex(0x74a64a),
  tip: hex(0xbcd86a),
  rib: hex(0xd4e294),
  under: hex(0x46703a),
};
/** A fern's fronds: a deeper, cooler green than the big leaves. */
const FERN: LeafPaint = {
  foot: hex(0x264a26),
  mid: hex(0x5a9142),
  tip: hex(0x9cc25a),
  rib: hex(0xa2c072),
  under: hex(0x3a6236),
};

/**
 * One leaf along +x, `length` long, its rib a curve from the ground at the plant's middle up
 * over an arch (its bend `up` of its length high) and down to its tip, `tip` of its length up:
 * a stalk to `from` of the way along, then the blade, `width` across at its broadest, folded
 * down either side of the rib, and cut into leaflets along its edges if `toothed` (a fern's
 * frond). Painted as `paint` says: lighter along the rib and out to the tips, darker beneath.
 * Built as the palms' fronds are, a top and an underside, each its own geometry, through the
 * same points.
 */
function blade(
  length: number,
  width: number,
  up: number,
  tip: number,
  from: number,
  toothed: boolean,
  paint: LeafPaint,
  rng: () => number,
): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const rows = toothed ? 12 : 8;
  const fold = toothed ? 0.2 : 0.38;
  const bend = new THREE.Vector3(length * 0.32, length * up, 0);
  const end = new THREE.Vector3(length, length * tip, 0);
  // The rib: a curve from the middle of the plant, at the ground, through the bend to the tip.
  const rib = (u: number) =>
    new THREE.Vector3()
      .addScaledVector(bend, 2 * u * (1 - u))
      .addScaledVector(end, u * u)
      .setZ(0);
  const stalk = Math.max(0.006, length * 0.014);
  const shades = Array.from({ length: rows + 1 }, () => 0.9 + rng() * 0.2);
  const [top, underside] = [false, true].map((under) => {
    const positions: number[] = [];
    const colours: number[] = [];
    const index: number[] = [];
    const point = (p: THREE.Vector3, c: THREE.Color) => {
      positions.push(p.x, p.y, p.z);
      colours.push(c.r, c.g, c.b);
    };
    for (let i = 0; i <= rows; i++) {
      // Two rows up the stalk, the rest along the blade.
      const u = i < 2 ? (from * i) / 2 : from + ((1 - from) * (i - 2)) / (rows - 2);
      const along = (u - from) / (1 - from);
      // Broadest a third of the way up the blade (a broad leaf's rounded at its foot), to a
      // point at the tip.
      const half =
        along <= 0
          ? stalk
          : Math.max(stalk, (width / 2) * Math.sin(Math.PI * along ** (toothed ? 0.7 : 0.6)));
      const tooth = toothed && i % 2 === 0 && along > 0;
      const out = toothed && !tooth && along > 0 ? half * 0.45 : half;
      const c = paint.foot.clone().lerp(paint.mid, Math.min(1, Math.max(0, along) / 0.4));
      const lit = c
        .clone()
        .lerp(paint.tip, Math.max(0, along) * (tooth ? 0.7 : 0.45))
        .multiplyScalar(shades[i]!);
      const mid = rib(u);
      point(mid, under ? paint.under : c.clone().lerp(paint.rib, 0.55 * Math.min(1, along * 2)));
      for (const side of [-1, 1]) {
        // A leaflet's tip sweeps on toward the frond's tip.
        const p = rib(Math.min(1, u + (tooth && i < rows ? 0.5 / rows : 0)));
        p.z = side * out;
        // Folded down, and curling down more toward its tip.
        p.y -= out * (fold + 0.3 * Math.max(0, along));
        point(p, under ? paint.under.clone().multiplyScalar(0.9 + 0.3 * u) : lit);
      }
    }
    for (let i = 0; i < rows; i++) {
      const a = i * 3;
      const b = a + 3;
      for (const e of [1, 2]) {
        // Wound to face up on top (the -z edge's the other way round) and down underneath.
        const flip = (e === 1) !== under;
        if (flip) index.push(a, b, a + e, a + e, b, b + e);
        else index.push(a, a + e, b, a + e, b + e, b);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    return geometry;
  });
  return [top!, underside!];
}

/**
 * The big leaves and ferns of the island's plants (see `blade`): their tops, and their
 * undersides, which cast the shadow of both.
 */
type Leaves = [tops: Batch, undersides: Batch];

/** Adds a leaf's top and underside (see `blade`) to `leaves`, moved by `matrix`. */
function addLeaf(
  [tops, undersides]: Leaves,
  [top, underside]: [THREE.BufferGeometry, THREE.BufferGeometry],
  matrix: THREE.Matrix4,
): void {
  tops.add(top, matrix);
  undersides.add(underside, matrix);
  top.dispose();
  underside.dispose();
}

/**
 * A lush tropical plant `size` across at `x, z`: six to nine big broad leaves on stalks from its
 * middle, the outer ones arching out all round with their tips drooping toward the ground, the
 * inner ones shorter and held up.
 */
function bigLeaves(leaves: Leaves, x: number, z: number, size: number, rng: () => number): void {
  const n = 6 + Math.floor(rng() * 4);
  const turn = rng() * Math.PI * 2;
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const a = turn + ((i + (rng() - 0.5) * 0.6) / n) * Math.PI * 2;
    const inner = i % 3 === 2;
    const length = (size / 2) * (inner ? 0.55 + rng() * 0.2 : 0.75 + rng() * 0.35);
    const leaf = blade(
      length,
      length * (0.55 + rng() * 0.15),
      inner ? 1.4 + rng() * 0.5 : 0.85 + rng() * 0.5,
      inner ? 0.35 + rng() * 0.2 : 0.04 + rng() * 0.14,
      0.3 + rng() * 0.08,
      false,
      BIG_LEAF,
      rng,
    );
    addLeaf(leaves, leaf, matrix.makeRotationY(-a).setPosition(x, 0, z));
  }
}

/**
 * A fern `size` across at `x, z`: eight to twelve narrow fronds cut into leaflets, springing up
 * from its middle and arching out all round.
 */
function fern(leaves: Leaves, x: number, z: number, size: number, rng: () => number): void {
  const n = 8 + Math.floor(rng() * 5);
  const turn = rng() * Math.PI * 2;
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const a = turn + ((i + (rng() - 0.5) * 0.7) / n) * Math.PI * 2;
    const length = (size / 2) * (0.7 + rng() * 0.45);
    const frond = blade(
      length,
      length * (0.26 + rng() * 0.06),
      0.6 + rng() * 0.5,
      0.02 + rng() * 0.12,
      0.12,
      true,
      FERN,
      rng,
    );
    addLeaf(leaves, frond, matrix.makeRotationY(-a).setPosition(x, 0, z));
  }
}

/**
 * Small stones to strew over rocky ground: a few shapes, each a lump knocked about as a boulder
 * is, a metre across and as high, standing on y = 0, painted pale grey (see `paintStone`). They
 * are made once and scaled down and turned to place.
 */
let pebbleShapes: THREE.BufferGeometry[] | null = null;
function pebbles(): THREE.BufferGeometry[] {
  if (pebbleShapes) return pebbleShapes;
  const rng = rngAt(5.5, 7.25, 3);
  pebbleShapes = Array.from({ length: 5 }, () => {
    const points: THREE.Vector3[] = [];
    for (const [n, y, r] of [
      [6, 0, 0.9],
      [5, 0.45, 1],
      [3, 0.9, 0.5],
    ] as const) {
      const turn = rng() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const a = turn + ((i + (rng() - 0.5) * 0.6) / n) * Math.PI * 2;
        const rr = r * (0.75 + rng() * 0.25);
        points.push(new THREE.Vector3(Math.cos(a) * rr, y + rng() * 0.15, Math.sin(a) * rr));
      }
    }
    const geo = facetedStone(points, 0.1, 1, 1, 1);
    paintStone(geo, 1, 1, 1, hex(0xc2c0b8), false);
    return geo;
  });
  return pebbleShapes;
}

/**
 * What grows in a window box `w` long (along x) and `d` deep, standing on y = 0 about the
 * middle: a row of little leafy clumps, spilling a little over its edges, with flowers of two
 * or three colours up among them.
 */
export function windowBoxPlants(w: number, d: number, seed: () => number): THREE.BufferGeometry {
  const batch = new Batch();
  const rng = rngAt(w, d, seed());
  const clumps = Math.max(2, Math.round(w / 0.2));
  for (let i = 0; i < clumps; i++) {
    const x = -w / 2 + (w * (i + 0.5)) / clumps + (rng() - 0.5) * 0.04;
    bush(batch, x, (rng() - 0.5) * d * 0.2, d * 0.5, 0.13 + rng() * 0.07, rng, true);
  }
  const colours = [PETALS[Math.floor(rng() * PETALS.length)]!, PETALS[2]!, PETALS[1]!];
  for (let i = 0; i < clumps + 2; i++) {
    const x = -w / 2 + 0.05 + (w - 0.1) * rng();
    flower(batch, x, (rng() - 0.5) * d * 0.5, colours[i % colours.length]!, rng);
  }
  return batch.geometry();
}

/** A rectangle greenery keeps out of, and the level's box it is, if it is one. */
interface Patch extends FloorRect {
  box?: BoxDef;
}

/** The rectangle `half` round a point. */
const around = (x: number, z: number, half: number): Patch => ({
  x0: x - half,
  x1: x + half,
  z0: z - half,
  z1: z + half,
});

/**
 * Whether a box stands on the ground, or is a model sunk in it (a boulder's foot, a post's,
 * a palm's) that stands up out of it.
 */
function grounded(level: LevelDef, b: BoxDef): boolean {
  const foot = b.pos.y - b.size.y / 2 - groundHeight(level, b.pos.x, b.pos.z);
  return Math.abs(foot) < 0.05 || (!!b.model && foot < 0 && foot + b.size.y > 0.05);
}

/** How high over the ground under it a point is. */
const overGround = (level: LevelDef, x: number, y: number, z: number) =>
  y - groundHeight(level, x, z);

/**
 * Where nothing may grow: water, the buildings, the job sites, the paving in front of doors,
 * whatever stands on the ground, and round everything players come for (the hiding places,
 * the pages lying about, the machines, the ladders, the catapult), so that greenery never
 * hides or crowds any of it.
 */
function keepOuts(level: LevelDef): Patch[] {
  const out: Patch[] = [];
  for (const w of level.water ?? []) out.push(grown(w, 0.2));
  for (const i of level.interiors) {
    const [x, z] = [(i.rect.x0 + i.rect.x1) / 2, (i.rect.z0 + i.rect.z1) / 2];
    if (overGround(level, x, i.y0, z) < 0.6) out.push(grown(i.rect, 0.02));
  }
  // A hole in the ground, kept a step clear of, unless it is a cellar under a building's floor
  // (which already keeps out to the building's walls, where tufts grow outside).
  const inside = (h: FloorRect) =>
    level.interiors.some(
      (i) =>
        h.x0 > i.rect.x0 - 0.01 &&
        h.x1 < i.rect.x1 + 0.01 &&
        h.z0 > i.rect.z0 - 0.01 &&
        h.z1 < i.rect.z1 + 0.01,
    );
  for (const h of level.groundHoles ?? (level.groundHole ? [level.groundHole] : []))
    if (!inside(h)) out.push(grown(h, 0.2));
  // Whatever stands low enough to be in the way (decking on tall posts, roofs and the like
  // leave the ground under them alone).
  for (const b of level.boxes) {
    if (overGround(level, b.pos.x, b.pos.y - b.size.y / 2, b.pos.z) > 1.2) continue;
    out.push({
      x0: b.pos.x - b.size.x / 2,
      x1: b.pos.x + b.size.x / 2,
      z0: b.pos.z - b.size.z / 2,
      z1: b.pos.z + b.size.z / 2,
      box: b,
    });
  }
  for (const h of level.hideouts) {
    if (overGround(level, h.pos.x, h.pos.y - h.size.y / 2, h.pos.z) > 1.2) continue;
    out.push(around(h.pos.x, h.pos.z, Math.hypot(h.size.x, h.size.z) / 2 + 0.45));
  }
  for (const m of level.machines)
    out.push(around(m.pos.x, m.pos.z, Math.max(m.size.x, m.size.z) / 2 + 0.9));
  for (const p of level.pageSpots)
    if (overGround(level, p.x, p.y, p.z) < 0.4) out.push(around(p.x, p.z, 0.7));
  for (const l of level.ladders) out.push(around(l.pos.x, l.pos.z, 0.9));
  for (const s of level.meetingSeats) out.push(around(s.x, s.z, 0.45));
  for (const site of levelSites(level)) {
    const bp = site.baseplate;
    const margin = 1.1;
    out.push({
      x0: bp.x - margin,
      x1: bp.x + BASEPLATE_SIZE + margin,
      z0: bp.z - margin,
      z1: bp.z + BASEPLATE_SIZE + margin,
    });
    const ins = site.inspector;
    out.push({
      x0: ins.pos.x - ins.size.x / 2 - 1,
      x1: ins.pos.x + ins.size.x / 2 + 1,
      z0: ins.pos.z - ins.size.z / 2 - 1,
      z1: ins.pos.z + ins.size.z / 2 + 1,
    });
    for (const p of [site.doneButton, site.bell]) out.push(around(p.x, p.z, 0.7));
    for (const b of [site.board, ...(site.moreBoards ?? [])])
      out.push(around(b.pos.x, b.pos.z, 1.2));
    out.push(around(site.spawn.x, site.spawn.z, 1.5));
  }
  if (level.catapult) out.push(around(level.catapult.pos.x, level.catapult.pos.z, 2.6));
  // The dog's kennel and pole.
  const kennel = level.dog.points[level.dog.start];
  if (kennel) out.push(around(kennel.x, kennel.z, 1.5));
  // The paving in front of every doorway out of a building on the ground.
  for (const s of roomSides(level)) {
    for (const d of s.doorways) {
      const u = (d.from + d.to) / 2;
      const [x, z] = s.alongX ? [u, s.face] : [s.face, u];
      if (overGround(level, x, s.floor, z) > 0.6) continue;
      const face = s.face - s.normal * d.thickness;
      const [a0, a1] = [face, face - s.normal * 1.8].sort((p, q) => p - q) as [number, number];
      const [u0, u1] = [d.from - 0.5, d.to + 0.5];
      out.push(s.alongX ? { x0: u0, x1: u1, z0: a0, z1: a1 } : { x0: a0, x1: a1, z0: u0, z1: u1 });
    }
  }
  return out;
}

const grown = (r: FloorRect, by: number): FloorRect => ({
  x0: r.x0 - by,
  x1: r.x1 + by,
  z0: r.z0 - by,
  z1: r.z1 + by,
});

/** How much a spot of ground grows: freely, only at the foot of things, or nothing. */
type Growth = 'grass' | 'edges' | 'none';

/** Things whose foot greenery gathers round, and how thickly (tufts round a metre of edge). */
const FOOT: Partial<Record<NonNullable<BoxDef['model']>, number>> = {
  rock: 5,
  boulder: 5,
  stump: 4,
  log: 3,
  pine: 3,
  palm: 3,
  post: 2,
  lampPost: 3,
  // (A harbour lantern's post is thin, and often stands by what keeps greenery off one side of
  // it: a clump all round its foot, so some of it grows.)
  lanternPost: 8,
  barrel: 2,
};

/**
 * Greenery for a level, decoration only (nothing collides with it): tufts of grass, bushes and
 * flowers. On grassy ground it grows all over, thickest at the foot of the fences and walls,
 * round the stones, stumps, logs, trees, posts and lamp posts, with bushes along the fence and
 * under the trees. Paved, gravelled or tarmacked ground only has weeds at the foot of things
 * and a few bushes along the fences and walls, and the paths, the beach and the trodden ground
 * by the job site nothing but tufts at the foot of things. Placed the same on every client:
 * every random choice is seeded from where it is made.
 *
 * Built as three meshes (the tufts, which cast no shadow, the bushes and the flowers), which
 * the scene merge bakes in with the rest.
 */
export function greenery(level: LevelDef): THREE.Group {
  const keep = keepOuts(level);
  const floor = floorRect(level);
  const grassy = level.groundSurface === 'grass';
  // Whether nothing keeps greenery `r` round a point out, but for the box it grows against.
  const free = (x: number, z: number, r: number, against?: BoxDef) =>
    x > floor.x0 + 0.2 + r &&
    x < floor.x1 - 0.2 - r &&
    z > floor.z0 + 0.2 + r &&
    z < floor.z1 - 0.2 - r &&
    !keep.some(
      (k) =>
        (!against || k.box !== against) &&
        x > k.x0 - r &&
        x < k.x1 + r &&
        z > k.z0 - r &&
        z < k.z1 + r,
    );
  // Ground floors drawn over the ground: rooms, paths, the beach, the trodden ground round
  // the job site.
  const floors = level.decals.filter(
    (d) => Math.abs(overGround(level, d.pos.x, d.pos.y, d.pos.z)) < 0.05,
  );
  const hilly = !!level.terrain?.length;
  const soil = { grass: 0, rock: 0 };
  const growth = (x: number, z: number): Growth => {
    const d = floors.find(
      (f) => Math.abs(x - f.pos.x) <= f.size.x / 2 && Math.abs(z - f.pos.z) <= f.size.z / 2,
    );
    // A narrow strip (a path, the beach) is kept clear: it is walked along.
    if (d) return Math.min(d.size.x, d.size.z) < 4 ? 'none' : 'edges';
    if (hilly) {
      // Hills: nothing in the sea or on the wet sand, or on rock where it is steep; on the dry
      // sand only tufts at the foot of things, and on the grass all over (as the ground is
      // painted, see `paintGround`).
      if (inSea(level, x, z, -0.25)) return 'none';
      const slope = groundSlope(level, x, z);
      paintGround(level, x, groundHeight(level, x, z), z, 1 / Math.hypot(1, slope), soil);
      if (soil.rock > 0.4) return 'none';
      return soil.grass > 0.6 ? 'grass' : 'edges';
    }
    return grassy ? 'grass' : 'edges';
  };
  // Each piece stands on the ground where it grows, sunk a little on a slope so that none of
  // it floats on the downhill side.
  const onGround = (batch: Batch, x: number, z: number, r: number) => {
    batch.ground = hilly
      ? groundHeight(level, x, z) - Math.min(0.15, r * groundSlope(level, x, z) * 0.6)
      : 0;
  };

  const tufts = new Batch();
  const bushes = new Batch();
  const flowers = new Batch();
  const tuftAt = (x: number, z: number, size: number, rng: () => number, against?: BoxDef) => {
    if (growth(x, z) === 'none' || !free(x, z, 0.04, against)) return;
    onGround(tufts, x, z, size * 0.3);
    tuft(tufts, x, z, size, rng);
  };
  const flowersAt = (x: number, z: number, n: number, spread: number, rng: () => number) => {
    const colour = PETALS[Math.floor(rng() * PETALS.length)]!;
    for (let i = 0; i < n; i++) {
      const fx = x + (rng() - 0.5) * spread;
      const fz = z + (rng() - 0.5) * spread;
      if (growth(fx, fz) === 'none' || !free(fx, fz, 0.05)) continue;
      onGround(flowers, fx, fz, 0.03);
      flower(flowers, fx, fz, colour, rng);
    }
  };
  // A bush `r` round, clear of everything by `clear` (and up against the box `against`).
  const bushAt = (
    x: number,
    z: number,
    r: number,
    clear: number,
    rng: () => number,
    against?: BoxDef,
  ) => {
    if (growth(x, z) === 'none' || !free(x, z, clear, against)) return false;
    onGround(bushes, x, z, r);
    bush(bushes, x, z, r, r * (1.1 + rng() * 0.4), rng);
    return true;
  };

  for (const b of level.boxes) {
    if (!grounded(level, b) || b.tiltX) continue;
    const rng = rngAt(b.pos.x, b.pos.z, b.size.y);
    const thin = Math.min(b.size.x, b.size.z);
    const long = Math.max(b.size.x, b.size.z);
    const alongX = b.size.x >= b.size.z;
    if (!b.model && thin <= 0.35 && long >= 1 && b.size.y >= 0.6) {
      // A fence or a wall: tufts all along its foot on both sides (those indoors, or on the far
      // side of the level's edge, come to nothing), and now and then a bush.
      const step = grassy ? 0.42 : 0.55;
      for (const side of [-1, 1]) {
        let nextBush = 1 + rng() * 3;
        // Grass grows in clumps along it, thick in places and thin between them.
        const phase = rng() * Math.PI * 2;
        const every = 1.6 + rng() * 1.4;
        for (
          let u = -long / 2 + 0.3 + rng() * step;
          u < long / 2 - 0.3;
          u += step * (0.6 + rng() * 0.8)
        ) {
          const off = side * (thin / 2 + 0.04 + rng() * 0.14);
          const x = b.pos.x + (alongX ? u : off);
          const z = b.pos.z + (alongX ? off : u);
          const clump = 0.5 + 0.5 * Math.sin((u / every) * Math.PI * 2 + phase);
          if (rng() < (grassy ? 0.45 : 0.25) + 0.55 * clump)
            tuftAt(x, z, 0.24 + rng() * 0.12 + clump * 0.1, rng);
          if (u + long / 2 < nextBush) continue;
          nextBush += grassy ? 3 + rng() * 4 : 2.5 + rng() * 3;
          const r = 0.35 + rng() * 0.25;
          const at = (out: number) => {
            const o = side * (thin / 2 + out);
            return [b.pos.x + (alongX ? u : o), b.pos.z + (alongX ? o : u)] as const;
          };
          // Up against it, clear of anything else, a building's walls included (whose
          // insides reach out to their outer faces); flowers in front of some of them.
          if (bushAt(...at(r), r, r - 0.05, rng, b) && rng() < 0.6)
            flowersAt(...at(r * 2 + 0.15), 4, 0.6, rng);
        }
      }
      continue;
    }
    const per = b.model ? FOOT[b.model] : undefined;
    if (!per) continue;
    // Round the foot of a stone, a stump, a log, a tree trunk or a post: its own footprint,
    // or the round foot a lamp post or a pine stands on.
    const flare = b.model === 'pine' ? 1.12 : 1;
    const lamp = b.model === 'lampPost' || b.model === 'lanternPost';
    const hx = Math.max((b.size.x / 2) * flare, lamp ? 0.12 : 0);
    const hz = Math.max((b.size.z / 2) * flare, lamp ? 0.12 : 0);
    const n = Math.max(2, Math.round(per * 2 * (hx + hz) * (0.7 + rng() * 0.6)));
    for (let i = 0; i < n; i++) {
      const a = ((i + rng() * 0.8) / n) * Math.PI * 2;
      const off = 0.03 + rng() * 0.1;
      const c = Math.cos(a);
      const s = Math.sin(a);
      // Out to the footprint's edge along that way (a log's and a timber post's are square, the
      // rest round), and a little beyond. (Round a timber post right up against it: its box
      // is the post, nothing more.)
      const square = b.model === 'log' || b.model === 'lanternPost';
      const reach = square
        ? Math.min(hx / Math.max(Math.abs(c), 1e-3), hz / Math.max(Math.abs(s), 1e-3))
        : 1 / Math.hypot(c / hx, s / hz);
      const x = b.pos.x + c * (reach + off);
      const z = b.pos.z + s * (reach + off);
      tuftAt(x, z, 0.22 + rng() * 0.16, rng, b.model === 'lanternPost' ? b : undefined);
    }
    if (b.model === 'pine' && grassy) {
      // Undergrowth in the shade of the trees.
      for (let i = 0, count = 1 + Math.floor(rng() * 2); i < count; i++) {
        const a = rng() * Math.PI * 2;
        const d = 0.8 + rng() * 0.7;
        const x = b.pos.x + Math.cos(a) * d;
        const z = b.pos.z + Math.sin(a) * d;
        const r = 0.35 + rng() * 0.2;
        if (bushAt(x, z, r, r + 0.1, rng) && rng() < 0.5)
          flowersAt(x + Math.cos(a) * (r + 0.3), z + Math.sin(a) * (r + 0.3), 4, 0.5, rng);
      }
    }
  }

  if (grassy) {
    // Tufts and the odd patch of flowers scattered over the open grass, one chance a square
    // metre.
    for (let i = Math.floor(floor.x0); i < floor.x1; i++)
      for (let j = Math.floor(floor.z0); j < floor.z1; j++) {
        const rng = rngAt(i, j, 7);
        const x = i + 0.1 + rng() * 0.8;
        const z = j + 0.1 + rng() * 0.8;
        if (growth(x, z) !== 'grass') continue;
        if (rng() < 0.5) tuftAt(x, z, 0.16 + rng() * 0.14, rng);
        if (rng() < 0.03) flowersAt(x, z, 4 + Math.floor(rng() * 4), 0.7, rng);
      }
  }

  // On hills (an island's): lush clumps of big leaves, ferns and bushes along the edge of the
  // grass and round the feet of the great rocks, the palms and the buildings, as in a tropical
  // painting; and small stones strewn over the rocky ground and about the rocks' feet.
  const leaves: Leaves = [new Batch(), new Batch()];
  const stones = new Batch();
  if (hilly) {
    /** A big-leafed plant or a fern `size` across, if it may grow there, clear of the ways. */
    const plant = (x: number, z: number, size: number, rng: () => number, against?: BoxDef) => {
      if (growth(x, z) === 'none' || wornAt(level, x, z) > 0.05) return false;
      if (!free(x, z, size * 0.3, against)) return false;
      for (const batch of leaves) onGround(batch, x, z, size * 0.3);
      if (rng() < 0.55) bigLeaves(leaves, x, z, size, rng);
      else fern(leaves, x, z, size * 0.9, rng);
      return true;
    };
    const shapes = pebbles();
    const matrix = new THREE.Matrix4();
    const turn = new THREE.Quaternion();
    /** A small stone `s` across at `x, z`, sunk a little into the ground. */
    const stone = (x: number, z: number, s: number, rng: () => number) => {
      if (inSea(level, x, z, -0.1) || !free(x, z, s * 0.5)) return;
      onGround(stones, x, z, s);
      turn.setFromAxisAngle(UP, rng() * Math.PI * 2);
      const size = new THREE.Vector3(s, s * (0.45 + rng() * 0.3), s * (0.7 + rng() * 0.3));
      matrix.compose(new THREE.Vector3(x, -size.y * 0.25, z), turn, size);
      stones.add(shapes[Math.floor(rng() * shapes.length)]!, matrix);
    };
    const STEP = 0.6;
    for (let i = floor.x0; i < floor.x1; i += STEP)
      for (let j = floor.z0; j < floor.z1; j += STEP) {
        const rng = rngAt(i, j, 31);
        const x = i + rng() * STEP;
        const z = j + rng() * STEP;
        // In clumps along the edge of the grass, with stretches of bare edge between.
        const edge = grassEdge(level, x, z, soil);
        if (soil.rock > 0.3) {
          if (rng() < 0.12 + 0.3 * soil.rock) stone(x, z, 0.12 + rng() * 0.24, rng);
          continue;
        }
        if (edge > 0.3) {
          // Out on the grass: clumps of tufts, and now and then a fern or a big leafy plant.
          if (rng() < 0.3) {
            for (let k = 0, m = 2 + Math.floor(rng() * 3); k < m; k++)
              tuftAt(x + (rng() - 0.5) * 0.45, z + (rng() - 0.5) * 0.45, 0.2 + rng() * 0.16, rng);
          } else if (rng() < 0.04) plant(x, z, 0.6 + rng() * 0.5, rng);
          continue;
        }
        if (edge < -0.12) continue;
        if (noise(x * 0.3, z * 0.3, 61) < 0.3 || rng() > 0.7) {
          // Between the clumps, the grass grows out over the edge in tufts.
          if (rng() < 0.5) tuftAt(x, z, 0.2 + rng() * 0.15, rng);
          continue;
        }
        const size = 0.75 + rng() * 0.65;
        if (!plant(x, z, size, rng)) {
          // Too near a way or a wall for a plant: a tuft or two, so the edge is not bare.
          if (rng() < 0.6) tuftAt(x, z, 0.2 + rng() * 0.15, rng);
          continue;
        }
        if (rng() < 0.4) {
          const a = rng() * Math.PI * 2;
          const r = 0.3 + rng() * 0.15;
          const [bx, bz] = [x + Math.cos(a) * size * 0.55, z + Math.sin(a) * size * 0.55];
          if (wornAt(level, bx, bz) < 0.05) bushAt(bx, bz, r, r, rng);
        }
      }
    for (const b of level.boxes) {
      if (!grounded(level, b) || b.tiltX) continue;
      const rng = rngAt(b.pos.x, b.pos.z, 41);
      const [hx, hz] = [b.size.x / 2, b.size.z / 2];
      if (b.model === 'boulder' || b.model === 'palm') {
        // Round the foot: out past its footprint's edge (its round foot, for a palm).
        const rock = b.model === 'boulder';
        const n = rock ? 2 + Math.floor(rng() * 3) : 1 + Math.floor(rng() * 2);
        for (let k = 0; k < n; k++) {
          const a = rng() * Math.PI * 2;
          const [c, s] = [Math.cos(a), Math.sin(a)];
          const reach = rock ? 1 / Math.hypot(c / hx, s / hz) : 0.2;
          const size = 0.65 + rng() * 0.6;
          const d = reach + size * 0.3 + rng() * 0.3;
          plant(b.pos.x + c * d, b.pos.z + s * d, size, rng, b);
        }
        if (!rock) continue;
        for (let k = 0, m = 2 + Math.floor(rng() * 4); k < m; k++) {
          const a = rng() * Math.PI * 2;
          const [c, s] = [Math.cos(a), Math.sin(a)];
          const d = 1 / Math.hypot(c / hx, s / hz) + 0.1 + rng() * 0.6;
          stone(b.pos.x + c * d, b.pos.z + s * d, 0.12 + rng() * 0.22, rng);
        }
        continue;
      }
      // Along the outside of a building's walls, now and then.
      const thin = Math.min(b.size.x, b.size.z);
      const long = Math.max(b.size.x, b.size.z);
      if (b.model || thin > 0.35 || long < 1 || b.size.y < 2) continue;
      const alongX = b.size.x >= b.size.z;
      for (let u = -long / 2 + 0.4 + rng() * 1.2; u < long / 2 - 0.4; u += 1.4 + rng() * 1.8) {
        if (rng() < 0.4) continue;
        const size = 0.7 + rng() * 0.6;
        for (const side of [-1, 1]) {
          const off = side * (thin / 2 + size * 0.32);
          const x = b.pos.x + (alongX ? u : off);
          const z = b.pos.z + (alongX ? off : u);
          if (plant(x, z, size, rng, b)) break;
        }
      }
    }
  }

  const group = new THREE.Group();
  if (!tufts.empty) put(group, tufts.geometry(), Surface.Grass, false);
  if (!bushes.empty) put(group, bushes.geometry(), Surface.Grass);
  if (!flowers.empty) put(group, flowers.geometry(), Surface.Auto);
  // The big leaves and ferns: their tops seen from above and their undersides from below, the
  // shadow cast by the undersides alone (as a palm's fronds'), whichever way each faces the sun.
  const [tops, undersides] = leaves;
  if (!tops.empty) {
    put(group, tops.geometry(), Surface.Grass, false);
    put(group, undersides.geometry(), Surface.Grass).material = painted(Surface.Grass, false, true);
  }
  // The stones lie on the ground: their shadows would be specks under them, so (as the tufts)
  // they cast none.
  if (!stones.empty) put(group, stones.geometry(), STONE, false);
  return group;
}

/**
 * How far into the grass the terrain is painted at (`x`, `z`) (below 0 out on the sand), as
 * its shader picks it (see `terrainPick` in styles.ts), with its ground in `soil`.
 */
function grassEdge(
  level: LevelDef,
  x: number,
  z: number,
  soil: { grass: number; rock: number },
): number {
  const y = groundHeight(level, x, z);
  paintGround(level, x, y, z, 1 / Math.hypot(1, groundSlope(level, x, z)), soil);
  const big = styleNoise(x * 0.55 + 3.1, y * 0.55 + 3.1, z * 0.55 + 3.1) - 0.5;
  const clump = styleNoise(x * 2.4 + 7.7, y * 1.2 + 7.7, z * 2.4 + 7.7) - 0.5;
  const tufts = styleNoise(x * 6 + 2.9, y * 2 + 2.9, z * 6 + 2.9) - 0.5;
  return soil.grass - 0.5 + big * 0.4 + clump * 0.34 + tufts * 0.24;
}
