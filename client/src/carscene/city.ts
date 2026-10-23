import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AT_NIGHT } from '../render/daynight.ts';
import { untraced } from '../render/raytrace.ts';
import { Surface, madeOf } from '../render/styles.ts';
import { batchStatic } from './batch.ts';
import { CHEVRON_HALF } from './chevronLayout.ts';
import { TERRACE_DEPTH, TOWN_COLOURS, streetTree, terraceHouse, workshop } from './facades.ts';
import type { TerraceHouse, Workshop } from './facades.ts';
import { FLOOR, coverGround, groundMaterial } from './ground.ts';
import type { GroundCover } from './ground.ts';
import { hash, paintedOnce, rng } from './kit.ts';
import { BAY, FACADE } from './paint.ts';
import type { Rect } from './paint.ts';
import { WATER_BARRIER, waterBarrier } from './roadworks.ts';
import { BUS } from './bus.ts';
import {
  buildStreet,
  lampSpot,
  pieceSpot,
  plainLamp,
  plainPiece,
  streetLamp,
  streetPiece,
} from './street.ts';
import type { Side, StreetPiece, StreetPlan } from './street.ts';
import { BACKDROP, SWEEP_GLSL } from './studio.ts';

/**
 * The town round Chevron Street, filling the studio's floor out past the map's walls: Chevron
 * Street itself carried on east and west to a cross street at each end, closed off just past the
 * map by water barriers; terraced houses along both sides of it and backing on to the map, a
 * street of taller ones behind; and past them, out to the far plane, blocks of flats and offices,
 * their windows painted on (see `facade` in `paint.ts`). All of it in the map's own style, and
 * all of it fading with distance into the studio's backdrop as the floor does, so the town
 * dissolves into the grey rather than ending at a horizon.
 *
 * It is scenery only: nothing in it is solid or can be clicked, it casts no shadow and takes
 * none, and it is left out of the ground's baked shadows and of ray tracing. It is laid out in
 * the frame of the map's first copy (the houses toward +z, the lot toward -z); on a rival
 * teams' level the half of it round the map is turned about the dividing line with the map's
 * second copy, and the cross streets and the blocks beyond are laid round both.
 */

/** The map's street as the map has it: its kerbs, and how deep the pavements are. */
const ROAD = { south: -1.0, north: 5.4 };
const PAVE = 2.2;
/** How deep a front garden is, pavement to door. */
const GARDEN = 1.4;
/** The cross streets' middles (x = ±CROSS), and half their road's width. */
const CROSS = 50;
const HALF_ROAD = 3.2;
/** The street behind the map, along x: its kerbs. */
const NORTH = { south: 38, north: 44.4 };
/** On a level of one team, the street along the far side of the lot (beyond the hoarding). */
const SOUTH = { south: -27.4, north: -21 };
/** How far the near streets run out along x before they give out in the haze. */
const REACH = 92;
/** The back lane behind the map's gardens. */
const LANE = { z0: CHEVRON_HALF + 1.4, z1: CHEVRON_HALF + 4.4 };

/** Where the blocks beyond start (the near streets' rows end inside it) and the town ends. */
const MID = { near: 73, far: 178 };

/** How far out (m) the town and floor are half faded into the backdrop, and how sharply. */
export const CITY_HAZE = { past: 55, sharpness: 2.6 };

// ---------------------------------------------------------------------------------------------
// Fading into the backdrop.

const HAZE_UNIFORMS = {
  floorCentre: FLOOR.centre,
  floorRange: FLOOR.range,
  sweepLow: BACKDROP.low,
  sweepTop: BACKDROP.top,
};

/** The fade, as the floor's (see `FLOOR` in `ground.ts`), mixed in before tone mapping. */
const HAZE_FRAGMENT = /* glsl */ `
  float hazeFade = 1.0 - 1.0 / ( 1.0 + pow( distance( vHazeWorld.xz, floorCentre ) / floorRange.x, floorRange.y ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, sweep( normalize( vHazeWorld - cameraPosition ).y ), hazeFade );
  #include <tonemapping_fragment>
`;

/**
 * Fades `material` (one of three.js's own, lit) into the studio's backdrop with distance, as the
 * floor fades, and leaves it out of ray tracing; in place.
 */
function haze<M extends THREE.Material>(material: M): M {
  town.add(material);
  material.onBeforeCompile = function (shader, renderer) {
    THREE.Material.prototype.onBeforeCompile.call(this, shader, renderer);
    untraced(shader);
    Object.assign(shader.uniforms, HAZE_UNIFORMS);
    shader.vertexShader =
      'varying vec3 vHazeWorld;\n' +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 hazeAt = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          hazeAt = instanceMatrix * hazeAt;
        #endif
        vHazeWorld = ( modelMatrix * hazeAt ).xyz;`,
      );
    shader.fragmentShader =
      `varying vec3 vHazeWorld;\nuniform vec2 floorCentre;\nuniform vec2 floorRange;\n${SWEEP_GLSL}\n` +
      shader.fragmentShader.replace('#include <tonemapping_fragment>', HAZE_FRAGMENT);
  };
  material.customProgramCacheKey = function () {
    return `${THREE.Material.prototype.customProgramCacheKey.call(this)}|haze`;
  };
  return material;
}

const hazedCopies = new WeakMap<THREE.Material, THREE.Material>();
/** The same copies, to keep when a town goes. */
const sharedCopies = new Set<THREE.Material>();
/** The town's own materials, faded already. */
const town = new WeakSet<THREE.Material>();

/**
 * Lays `material`, one of the ground's (see `groundMaterial`), over the floor however far off:
 * a few millimetres over it is lost in the depth buffer's precision past thirty metres or so.
 */
function overFloor<M extends THREE.Material>(material: M): M {
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -4;
  return material;
}

/**
 * The town's copy of `source`, one of the car scene's shared materials, faded with distance (the
 * map's own stays as it is). The ground's shader (made afresh for each mesh) fades by a switch
 * of its own.
 */
function hazed(source: THREE.Material): THREE.Material {
  const shader = source as THREE.ShaderMaterial;
  if (shader.isShaderMaterial) {
    if (shader.uniforms.floorRange && !shader.polygonOffset) {
      shader.defines.HAZE = '';
      overFloor(shader);
      shader.needsUpdate = true;
    }
    return source;
  }
  if (town.has(source)) return source;
  let m = hazedCopies.get(source);
  if (!m) {
    m = haze(source.clone());
    hazedCopies.set(source, m);
    sharedCopies.add(m);
  }
  return m;
}

/**
 * Finishes `root` as the town's: its parts joined into a draw call for each material, then
 * `stamped` added, and all of it faded, casting and taking no shadows, never aimed at, still.
 */
function finish(root: THREE.Object3D, stamped = new Stamper()): void {
  batchStatic(root, () => false);
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const spots: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.name === LAMP || o.name === FINE_LAMP || o.name === PIECE) spots.push(o);
  });
  for (const o of spots) {
    const g = new THREE.Group();
    const piece = o.userData.piece as Piece | undefined;
    const m =
      o.name === LAMP
        ? model('lamp', () => (plainLamp(g), g))
        : o.name === FINE_LAMP
          ? model('fine lamp', () => (streetLamp(g), g))
          : model(`piece ${JSON.stringify(piece)}`, () => {
              (piece!.plain ? plainPiece : streetPiece)(g, piece!);
              return g;
            });
    stamped.stamp(m, toRoot.clone().multiply(o.matrixWorld));
    o.removeFromParent();
  }
  stamped.build(root);
  root.traverse((o) => {
    o.matrixAutoUpdate = false;
    o.updateMatrix();
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.raycast = () => {};
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(hazed) : hazed(mesh.material);
  });
}

// ---------------------------------------------------------------------------------------------
// Stamping models.

/** A model flattened: one geometry per material, in the model's own frame. */
type Model = { material: THREE.Material; geometry: THREE.BufferGeometry }[];

/** `geo` as the stamper takes it: unindexed, with normals, texture coordinates and colours. */
function normalised(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position!.count;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.attributes.position!);
  out.setAttribute('normal', g.attributes.normal!);
  out.setAttribute('uv', g.attributes.uv ?? new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  out.setAttribute(
    'color',
    g.attributes.color?.itemSize === 3
      ? g.attributes.color
      : new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3),
  );
  return out;
}

/** `root`, built once, flattened into a geometry per material, and freed. */
function flatten(root: THREE.Object3D): Model {
  root.updateMatrixWorld(true);
  const parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    // (Nor what is hidden till it is switched on, as a charging post's bar.)
    if (!mesh.isMesh || !mesh.visible || Array.isArray(mesh.material)) return;
    const g = normalised(mesh.geometry).applyMatrix4(mesh.matrixWorld);
    mesh.geometry.dispose();
    const list = parts.get(mesh.material) ?? [];
    list.push(g);
    parts.set(mesh.material, list);
  });
  return [...parts].map(([material, list]) => ({
    material,
    geometry: mergeGeometries(list, false),
  }));
}

const models = new Map<string, Model>();

/** The model `make` builds for `key`, built and flattened only the first time it is asked for. */
function model(key: string, make: () => THREE.Object3D): Model {
  let m = models.get(key);
  if (!m) models.set(key, (m = flatten(make())));
  return m;
}

/**
 * Lays copies of models out and joins them into one mesh per material: a few dozen draw calls
 * for the whole town's houses. A copy's walls (what its model paints in vertex colours) take
 * its own colour.
 */
class Stamper {
  private readonly copies = new Map<
    THREE.Material,
    { geometry: THREE.BufferGeometry; at: THREE.Matrix4; tint: THREE.Color | null }[]
  >();

  stamp(m: Model, at: THREE.Matrix4, tint: THREE.Color | null = null): void {
    for (const { material, geometry } of m) {
      const list = this.copies.get(material) ?? [];
      list.push({ geometry, at, tint: material.vertexColors ? tint : null });
      this.copies.set(material, list);
    }
  }

  /** The joined meshes, under `root`. */
  build(root: THREE.Object3D): void {
    const p = new THREE.Vector3();
    const normal = new THREE.Matrix3();
    for (const [material, list] of this.copies) {
      const count = list.reduce((n, c) => n + c.geometry.attributes.position!.count, 0);
      const pos = new Float32Array(count * 3);
      const nor = new Float32Array(count * 3);
      const uv = new Float32Array(count * 2);
      const col = new Float32Array(count * 3);
      let k = 0;
      for (const { geometry, at, tint } of list) {
        const a = geometry.attributes;
        const n = a.position!.count;
        normal.getNormalMatrix(at);
        for (let i = 0; i < n; i++) {
          p.fromBufferAttribute(a.position as THREE.BufferAttribute, i).applyMatrix4(at);
          p.toArray(pos, (k + i) * 3);
          p.fromBufferAttribute(a.normal as THREE.BufferAttribute, i)
            .applyMatrix3(normal)
            .normalize();
          p.toArray(nor, (k + i) * 3);
          uv[(k + i) * 2] = a.uv!.getX(i);
          uv[(k + i) * 2 + 1] = a.uv!.getY(i);
          col[(k + i) * 3] = a.color!.getX(i) * (tint?.r ?? 1);
          col[(k + i) * 3 + 1] = a.color!.getY(i) * (tint?.g ?? 1);
          col[(k + i) * 3 + 2] = a.color!.getZ(i) * (tint?.b ?? 1);
        }
        k += n;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.computeBoundingSphere();
      root.add(new THREE.Mesh(geo, material));
    }
  }
}

/** Standing at (`x`, `z`) turned `heading` about y (its front, +z, turned toward +x by it). */
function placed(x: number, z: number, heading: number, stretch = 1): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, 0, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading),
    new THREE.Vector3(stretch, 1, 1),
  );
}

// ---------------------------------------------------------------------------------------------
// The near streets.

/**
 * Marks where a street's lamp stands, to be stamped there (see `finish`): the plain lamp, or
 * where the street is painted finely enough to be seen close to, the map's own.
 */
const LAMP = 'town lamp';
const FINE_LAMP = 'town lamp, fine';
/** Marks where a piece of street furniture stands (its `Piece` in its `userData.piece`). */
const PIECE = 'town furniture';
/** A piece of street furniture as a street of the town's has it: plain, if seen from afar. */
type Piece = Pick<StreetPiece, 'kind' | 'colour' | 'seed'> & { plain: boolean };
/**
 * How finely (pixels a metre) a street is painted that is seen close to, and fitted out so: with
 * the map's own furniture out to `NEARBY` from the map's middle along x, plain past it.
 */
const CLOSE = 64;
const NEARBY = 28;

/**
 * A street of the town's: no crossing, nothing in it to click, painted coarser further off; its
 * lamps and furniture marked, to be stamped.
 */
function townStreet(o: Partial<StreetPlan> & Pick<StreetPlan, 'x0' | 'x1' | 'north' | 'south'>) {
  const plan: StreetPlan = {
    middle: (o.north + o.south) / 2,
    pavement: PAVE,
    crossing: 0,
    lamps: [],
    manholes: [],
    drains: [],
    railings: [],
    furniture: [],
    bays: [],
    plain: true,
    ...o,
  };
  const street = buildStreet({ ...plan, lamps: [], furniture: [] });
  const close = (plan.detail ?? 100) >= CLOSE;
  for (const l of plan.lamps) {
    const spot = lampSpot(plan, l);
    spot.name = close ? FINE_LAMP : LAMP;
    street.add(spot);
  }
  for (const f of plan.furniture) {
    const spot = pieceSpot(plan, f);
    spot.name = PIECE;
    const piece: Piece = { kind: f.kind, plain: !close || Math.abs(f.x) > NEARBY };
    if (f.colour !== undefined) piece.colour = f.colour;
    if (f.kind === 'planter') piece.seed = f.seed ?? 41;
    spot.userData.piece = piece;
    street.add(spot);
  }
  return street;
}

/**
 * Furniture strewn along a street seen from further off, from `x0` to `x1`: a bin, a planter, a
 * bench and so on in turn every ten metres or so, on one pavement or the other, clear of its
 * lamps and of the side streets coming in (`gaps`).
 */
function strewn(
  x0: number,
  x1: number,
  lamps: { x: number }[],
  gaps: { x0: number; x1: number }[],
  seed: number,
): StreetPiece[] {
  const kinds = ['bin', 'planter', 'bench', 'bin', 'planter', 'hydrant'] as const;
  const rand = rng(seed);
  const out: StreetPiece[] = [];
  let i = 0;
  for (let x = x0 + 2 + rand() * 5; x < x1 - 2; x += 8 + rand() * 6) {
    if (lamps.some((l) => Math.abs(l.x - x) < 1.8)) continue;
    if (gaps.some((g) => x > g.x0 - 1.6 && x < g.x1 + 1.6)) continue;
    const kind = kinds[i++ % kinds.length]!;
    const side: Side = rand() < 0.5 ? 'north' : 'south';
    out.push({
      kind,
      x,
      side,
      back: { bin: 1.7, planter: 1.4, bench: 1.6, hydrant: 1.5 }[kind],
      toRoad: kind === 'bin' || kind === 'bench',
      ...(kind === 'bin' && rand() < 0.3 ? { colour: BUS.yellow } : {}),
      seed: 41 + (i % 3),
    });
  }
  return out;
}

/** The terraced houses' widths: a few, so that a few models serve the whole town. */
const WIDTHS = [5.4, 6.0, 6.6, 7.2];

/** A row of terraced houses along a street. */
interface Row {
  /** Where the row's first house's front corner is, and which way the fronts face. */
  x: number;
  z: number;
  heading: number;
  /** How long it runs, to its fronts' right (seen from the street). */
  length: number;
  storeys: [number, number];
  seed: number;
  /** A shop on the ground floor of its first or last house (a corner shop). */
  shops?: ('first' | 'last')[];
  /** How many storeys a house `along` metres down the row has, if not as `storeys` would. */
  tall?: (along: number) => number | undefined;
  /** Seen close to, from the map: its houses built finer (see `TerraceHouse.fine`). */
  fine?: boolean;
}

const colour = new THREE.Color();

/** Stamps the houses of `row`. */
function row(st: Stamper, r: Row): void {
  const rand = rng(r.seed);
  const widths: number[] = [];
  let sum = 0;
  while (sum < r.length - 3) {
    // Each end of the row the same width, so a few models serve all the rows' ends.
    const w = sum === 0 ? WIDTHS[1]! : WIDTHS[Math.floor(rand() * WIDTHS.length)]!;
    widths.push(w);
    sum += w;
  }
  sum += WIDTHS[1]! - widths.at(-1)!;
  widths[widths.length - 1] = WIDTHS[1]!;
  // Stretched or squeezed a little to fill the row to its length.
  const stretch = r.length / sum;
  const along = new THREE.Vector3(Math.cos(r.heading), 0, -Math.sin(r.heading));
  const back = new THREE.Vector3(-Math.sin(r.heading), 0, -Math.cos(r.heading));
  let at = 0;
  widths.forEach((w, i) => {
    const [lo, hi] = r.storeys;
    const mid = at + (w * stretch) / 2;
    // Its door, chimney and lit windows go with its width and height, and its door away from
    // the end of the row: few enough models that building them all is quick. (Its colour sets
    // it apart from its neighbours.)
    const kind = WIDTHS.indexOf(w);
    const storeys = r.tall?.(mid) ?? lo + Math.floor(rand() * (hi - lo + 1));
    const ends = { left: i === 0, right: i === widths.length - 1 };
    const house: TerraceHouse = {
      width: w,
      storeys,
      door: ends.left ? 1 : ends.right ? -1 : kind % 2 ? 1 : -1,
      ends,
      shop: (ends.left && r.shops?.includes('first')) || (ends.right && r.shops?.includes('last')),
      chimney: kind > 1,
      seed: storeys % 2,
      ...(r.fine ? { fine: true, garden: GARDEN } : {}),
    };
    const p = new THREE.Vector3(r.x, 0, r.z)
      .addScaledVector(along, mid)
      .addScaledVector(back, TERRACE_DEPTH / 2);
    const m = model(`house ${JSON.stringify(house)}`, () => terraceHouse(house));
    colour.set(TOWN_COLOURS[Math.floor(hash(i, r.seed, 17) * TOWN_COLOURS.length)]!);
    st.stamp(m, placed(p.x, p.z, r.heading, stretch), colour.clone());
    at += w * stretch;
  });
}

/** Stamps a tree `size` tall at (`x`, `z`). */
function tree(st: Stamper, x: number, z: number, size: number, seed: number): void {
  const kind = seed % 4;
  const m = model(`tree ${kind}`, () => streetTree(9, 900 + kind));
  const at = placed(x, z, hash(seed, 3, 7) * Math.PI * 2).scale(
    new THREE.Vector3(size / 9, size / 9, size / 9),
  );
  st.stamp(m, at);
}

/** Facing -z, +z, +x and -x. */
const TO = { north: Math.PI, south: 0, east: -Math.PI / 2, west: Math.PI / 2 } as const;
const FRONT = { north: ROAD.north + PAVE + GARDEN, south: ROAD.south - PAVE - GARDEN };
/** The near ends of the rows beside the map, and their far ends, by the cross streets. */
const NEAR = CHEVRON_HALF + 0.6;
const FAR = CROSS - HALF_ROAD - PAVE - 0.4;

/**
 * The furniture along the east carrying on of the map's street (the west's the same turned
 * about): bins, benches and planters, a hydrant, a charging post, and bollards at the corner.
 */
const ALONG: StreetPiece[] = [
  { kind: 'bin', x: 18.6, side: 'north', back: 1.7, toRoad: true },
  { kind: 'bench', x: 21.6, side: 'north', back: 1.6, toRoad: true },
  { kind: 'planter', x: 23.4, side: 'north', back: 1.4, seed: 42 },
  { kind: 'hydrant', x: 30.2, side: 'north', back: 1.5 },
  { kind: 'bin', x: 33.6, side: 'north', back: 1.7, toRoad: true, colour: BUS.yellow },
  { kind: 'planter', x: 36.8, side: 'north', back: 1.4, seed: 43 },
  { kind: 'charger', x: 41.2, side: 'north', back: 1.8, toRoad: true },
  { kind: 'bollard', x: 43.4, side: 'north', back: 0.42 },
  { kind: 'bollard', x: 44.1, side: 'north', back: 0.42 },
  { kind: 'planter', x: 19.4, side: 'south', back: 1.4, seed: 41 },
  { kind: 'bench', x: 22.2, side: 'south', back: 1.6, toRoad: true },
  { kind: 'bin', x: 24.4, side: 'south', back: 1.75, toRoad: true },
  { kind: 'bin', x: 25.0, side: 'south', back: 1.75, toRoad: true, colour: BUS.yellow },
  { kind: 'hydrant', x: 34.0, side: 'south', back: 1.5 },
  { kind: 'planter', x: 42.0, side: 'south', back: 1.4, seed: 43 },
  { kind: 'bollard', x: 43.4, side: 'south', back: 0.42 },
  { kind: 'bollard', x: 44.1, side: 'south', back: 0.42 },
];

/**
 * The half of the town round the map's first copy: its street carried on to the cross streets,
 * the rows along it, the back lane and the gardens behind the map, and the street behind them.
 */
function nearHalf(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'near town';
  const st = new Stamper();

  // The street carried on each way, closed just past the map with water barriers, side streets'
  // pavements stopping short of the cross street's: painted as finely as the map's own, and
  // fitted out as it is, with the map's lamps, bins, benches, planters and the rest.
  const corner = CROSS - HALF_ROAD - PAVE;
  for (const s of [-1, 1]) {
    const [x0, x1] =
      s > 0 ? [CHEVRON_HALF, CROSS - HALF_ROAD] : [-CROSS + HALF_ROAD, -CHEVRON_HALF];
    const gap = s > 0 ? { x0: corner, x1 } : { x0, x1: -corner };
    // The west's the east's turned about, its pavements swapped.
    const side = (east: Side): Side => (s > 0 ? east : east === 'north' ? 'south' : 'north');
    root.add(
      townStreet({
        x0,
        x1,
        ...ROAD,
        open: true,
        detail: 100,
        openings: [
          { side: 'north', ...gap },
          { side: 'south', ...gap },
        ],
        lamps: [
          { x: s * 26, side: side('north') },
          { x: s * 39, side: side('south') },
        ],
        furniture: ALONG.map((f) => ({ ...f, x: s * f.x, side: side(f.side) })),
      }),
    );
    const { length } = WATER_BARRIER;
    const n = Math.ceil((ROAD.north - ROAD.south) / (length + 0.05));
    for (let i = 0; i < n; i++) {
      const red = i % 2 === 0;
      const z = ROAD.south + (i + 0.5) * (length + 0.05);
      st.stamp(
        model(`barrier ${red}`, () => waterBarrier(red)),
        placed(s * (CHEVRON_HALF + 1.1), z, 0),
      );
    }
  }

  // The street behind, the whole width of the town: between the cross streets (seen down the
  // alley and over the gardens) painted finer than past them.
  const behind = [-CROSS, CROSS].flatMap((c) =>
    (['north', 'south'] as const).map((side) => ({ side, x0: c - HALF_ROAD, x1: c + HALF_ROAD })),
  );
  const lamps = [-75, -38, -12, 14, 38, 75].map((x, i) => ({
    x,
    side: (i % 2 ? 'north' : 'south') as Side,
  }));
  const pieces = strewn(-REACH, REACH, lamps, behind, 71);
  for (const [x0, x1, detail] of [
    [-REACH, -CROSS + HALF_ROAD, 24],
    [-CROSS + HALF_ROAD, CROSS - HALF_ROAD, 40],
    [CROSS - HALF_ROAD, REACH, 24],
  ] as const) {
    const within = <T extends { x: number }>(list: T[]) => list.filter((o) => o.x > x0 && o.x < x1);
    root.add(
      townStreet({
        x0,
        x1,
        ...NORTH,
        open: true,
        detail,
        openings: behind,
        lamps: within(lamps),
        furniture: within(pieces),
      }),
    );
  }

  // Along the street's continuations: houses facing it on both sides, from beside the map out
  // to the cross street, a shop on each corner there.
  for (const s of [-1, 1]) {
    const n = s > 0 ? 0 : 1;
    // North side, facing -z: the row runs toward -x.
    row(st, {
      x: s > 0 ? FAR : -NEAR,
      z: FRONT.north,
      heading: TO.north,
      length: FAR - NEAR,
      storeys: [2, 3],
      seed: 11 + n,
      shops: [s > 0 ? 'first' : 'last'],
      fine: true,
    });
    // South side, facing +z: toward +x.
    row(st, {
      x: s > 0 ? NEAR : -FAR,
      z: FRONT.south,
      heading: TO.south,
      length: FAR - NEAR,
      storeys: [2, 3],
      seed: 21 + n,
      shops: [s > 0 ? 'last' : 'first'],
      fine: true,
    });
  }

  // Facing the street behind from its near side, backing on to the gardens behind the map, an
  // alley through the middle; and from its far side, taller.
  const nearSide = NORTH.south - PAVE - GARDEN;
  const farSide = NORTH.north + PAVE + GARDEN;
  for (const [x, length, seed] of [
    [-FAR, FAR - 1.4, 31],
    [1.4, FAR - 1.4, 32],
  ] as const)
    row(st, { x, z: nearSide, heading: TO.south, length, storeys: [2, 3], seed, fine: true });
  for (const [x, length, seed] of [
    [FAR, FAR - 1.4, 41],
    [-1.4, FAR - 1.4, 42],
    [REACH, REACH - CROSS - HALF_ROAD - PAVE - 0.4, 43],
    [-CROSS - HALF_ROAD - PAVE - 0.4, REACH - CROSS - HALF_ROAD - PAVE - 0.4, 44],
  ] as const)
    row(st, { x, z: farSide, heading: TO.north, length, storeys: [3, 4], seed });
  // Past the cross streets, on its near side, clear of the rows along the cross streets.
  const outer = CROSS + HALF_ROAD + PAVE + GARDEN + TERRACE_DEPTH + 0.4;
  row(st, {
    x: outer,
    z: nearSide,
    heading: TO.south,
    length: REACH - outer,
    storeys: [2, 3],
    seed: 33,
  });
  row(st, {
    x: -REACH,
    z: nearSide,
    heading: TO.south,
    length: REACH - outer,
    storeys: [2, 3],
    seed: 34,
  });

  // Along the cross streets' far sides, facing in: taller where the map's street looks up at
  // them, a shop at the corner with the street behind.
  const crossFront = CROSS + HALF_ROAD + PAVE + GARDEN;
  const vista = (ROAD.south + ROAD.north) / 2;
  const crossRow = (s: number): Row => ({
    x: s * crossFront,
    z: s > 0 ? -CHEVRON_HALF + 0.4 : NORTH.south - PAVE - 0.4,
    heading: s > 0 ? TO.east : TO.west,
    length: NORTH.south - PAVE - 0.4 + CHEVRON_HALF - 0.4,
    storeys: [2, 3],
    seed: 51 + s,
    shops: [s > 0 ? 'last' : 'first'],
    tall: (along) => {
      const z = s > 0 ? -CHEVRON_HALF + 0.4 + along : NORTH.south - PAVE - 0.4 - along;
      return Math.abs(z - vista) < 7 ? 4 : undefined;
    },
  });
  row(st, crossRow(1));
  row(st, crossRow(-1));

  // Trees in the gardens behind the map and beside it.
  const rand = rng(61);
  for (let i = 0; i < 16; i++) {
    const x = (rand() - 0.5) * 2 * (FAR - 2);
    const z = Math.abs(x) < NEAR + 1 ? LANE.z1 + 1.5 + rand() * 4 : 18.5 + rand() * 6;
    tree(st, x, z, 6 + rand() * 4, i);
  }
  for (let i = 0; i < 8; i++) {
    const x = (i % 2 ? 1 : -1) * (NEAR + 2 + rand() * (FAR - NEAR - 4));
    tree(st, x, -CHEVRON_HALF + 1.6 + rand() * 1.2, 5 + rand() * 3, 20 + i);
  }

  // The ground: the back lane's gravel, lawns in the gardens behind and beside the map, behind
  // the rows along the cross streets and behind the far side of the street behind, slabs before
  // the houses. What lies round the map painted finely, what is seen only from further off less.
  const back = CROSS + PITCH - 4;
  const close: GroundCover = {
    gravel: { ...patch(-NEAR, LANE.z0, NEAR, LANE.z1), tracks: [] },
    lawns: [
      patch(-FAR - 0.4, LANE.z1, FAR + 0.4, nearSide - TERRACE_DEPTH),
      ...[-1, 1].flatMap((s) => [
        patch(s * NEAR, CHEVRON_HALF + 1, s * (FAR + 0.4), LANE.z1),
        patch(s * (NEAR + 0.8), -CHEVRON_HALF, s * (FAR + 0.4), FRONT.south - TERRACE_DEPTH),
      ]),
    ],
    paths: [
      ...[-1, 1].flatMap((s): Rect[] => [
        rectOf(s * CHEVRON_HALF, ROAD.north + PAVE, s * corner, FRONT.north),
        rectOf(s * CHEVRON_HALF, FRONT.south, s * corner, ROAD.south - PAVE),
        rectOf(s * (crossFront - GARDEN), -CHEVRON_HALF, s * crossFront, NORTH.south - PAVE),
      ]),
    ],
  };
  root.add(townGround(close, 32, 64));
  root.add(
    townGround(
      { lawns: [], paths: [rectOf(-corner, nearSide, corner, NORTH.south - PAVE)] },
      32,
      40,
    ),
  );
  root.add(
    townGround({
      lawns: [
        patch(-REACH, farSide + TERRACE_DEPTH, REACH, (NORTH.south + NORTH.north) / 2 + PITCH - 4),
        ...[-1, 1].map((s) =>
          patch(s * (crossFront + TERRACE_DEPTH), -CHEVRON_HALF, s * back, nearSide),
        ),
      ],
      paths: [rectOf(-REACH, NORTH.north + PAVE, REACH, farSide)],
    }),
  );

  finish(root, st);
  return root;
}

/**
 * A patch of the ground's cover (see `GroundCover`) over the rectangle with corners (`x0`, `z0`)
 * and (`x1`, `z1`), cut off straight all round: the town's lawns and gravel meet each other and
 * the map's edge-on, where the map's own are brushed out over the floor.
 */
function patch(x0: number, z0: number, x1: number, z1: number) {
  const r = rectOf(x0, z0, x1, z1);
  return { outline: box(r[0] - 2, r[1] - 2, r[0] + r[2] + 2, r[1] + r[3] + 2), rect: r };
}

/**
 * The town's ground cover, laid under the map's, so that the map's brushed edges lie over it
 * where they meet: its lot and lawns painted `perMetre` pixels a metre, its paths' slabs `slabs`.
 */
function townGround(cover: Parameters<typeof coverGround>[0], perMetre = 12, slabs = 20) {
  const g = coverGround(cover, { perMetre, slabs, haze: true });
  g.traverse((o) => (o.renderOrder -= 0.1));
  return g;
}

/** The outline of the rectangle with corners (`x0`, `z0`) and (`x1`, `z1`), either way round. */
function box(x0: number, z0: number, x1: number, z1: number): [number, number][] {
  const [a, b] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [c, d] = [Math.min(z0, z1), Math.max(z0, z1)];
  return [
    [a, c],
    [b, c],
    [b, d],
    [a, d],
  ];
}

/** The rectangle with corners (`x0`, `z0`) and (`x1`, `z1`), either way round. */
function rectOf(x0: number, z0: number, x1: number, z1: number): Rect {
  return [Math.min(x0, x1), Math.min(z0, z1), Math.abs(x1 - x0), Math.abs(z1 - z0)];
}

/**
 * The cross streets, from `z0` to `z1`, the side streets coming in: the map's street and its
 * twin across the dividing line (`streets`) on their inner sides, the streets behind
 * (`throughs`) on both.
 */
function crossStreets(z0: number, z1: number, streets: number[], throughs: number[]): THREE.Group {
  const root = new THREE.Group();
  root.name = 'cross streets';
  for (const s of [-1, 1]) {
    // Built along x, then turned so its x runs along +z: its own z is then -x, so its north
    // side is toward the map on the east street, its south side on the west.
    const inner = s > 0 ? 'north' : 'south';
    const gap = (z: number) => ({ x0: z - HALF_ROAD, x1: z + HALF_ROAD });
    const openings = [
      ...streets.map((z) => ({ side: inner, ...gap(z) }) as const),
      ...throughs.flatMap((z) =>
        (['north', 'south'] as const).map((side) => ({ side, ...gap(z) })),
      ),
    ];
    const lamps = Array.from({ length: Math.floor((z1 - z0) / 28) }, (_, i) => ({
      x: z0 + 14 + i * 28,
      side: (i % 2 ? 'north' : 'south') as Side,
    }));
    const street = townStreet({
      x0: z0,
      x1: z1,
      north: HALF_ROAD,
      south: -HALF_ROAD,
      // As fine as a texture as long as the street (and its broken-off ends) can be.
      detail: Math.min(28, Math.floor(4096 / (z1 - z0 + 5))),
      openings,
      lamps,
      furniture: strewn(z0, z1, lamps, openings, 81 + s),
    });
    street.rotation.y = -Math.PI / 2;
    street.position.x = s * CROSS;
    // Under the streets they cross.
    street.traverse((o) => {
      if (o.renderOrder === 0.5) o.renderOrder = 0.45;
    });
    root.add(street);
  }
  finish(root);
  return root;
}

/**
 * On a level of one team, what lies past the hoarding along the far side of the lot: a verge of
 * grass with trees, a street, and workshops across it in their yards.
 */
function farSide(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'far side';
  const st = new Stamper();
  root.add(
    townStreet({
      x0: -REACH,
      x1: REACH,
      ...SOUTH,
      detail: 20,
      openings: [-CROSS, CROSS].flatMap((c) =>
        (['north', 'south'] as const).map((side) => ({
          side,
          x0: c - HALF_ROAD,
          x1: c + HALF_ROAD,
        })),
      ),
      lamps: [-70, -30, 10, 46, 80].map((x, i) => ({ x, side: i % 2 ? 'north' : 'south' })),
    }),
  );
  const front = SOUTH.south - PAVE - 4.4;
  const rand = rng(71);
  for (const [a, b] of [
    [-REACH, -CROSS - HALF_ROAD - PAVE],
    [-CROSS + HALF_ROAD + PAVE, CROSS - HALF_ROAD - PAVE],
    [CROSS + HALF_ROAD + PAVE, REACH],
  ] as const) {
    let x = a + 1;
    while (x < b - 10) {
      // Three sizes, each its own height.
      let k = Math.floor(rand() * 3);
      while (k >= 0 && 12 + 3 * k > b - 1 - x) k--;
      if (k < 0) break;
      const w: Workshop = { width: 12 + 3 * k, depth: 12, height: 6 + 0.75 * k, doors: 2, seed: k };
      const m = model(`workshop ${JSON.stringify(w)}`, () => workshop(w));
      st.stamp(m, placed(x + w.width / 2, front - w.depth / 2, TO.south));
      x += w.width + 2.5;
    }
  }
  for (let x = -REACH + 6; x < REACH; x += 11 + rand() * 4)
    // None leaning in over the hoarding.
    if (Math.abs(Math.abs(x) - CROSS) > 7 && Math.abs(x) > CHEVRON_HALF + 4)
      tree(st, x, SOUTH.north + PAVE + 1.3, 6 + rand() * 3, Math.floor(x + 200));
  root.add(
    townGround({
      gravel: { ...patch(-REACH, front, REACH, front + 4.4), tracks: [] },
      lawns: [patch(-REACH, SOUTH.north + PAVE, REACH, -CHEVRON_HALF)],
      paths: [],
    }),
  );
  finish(root, st);
  return root;
}

// ---------------------------------------------------------------------------------------------
// The blocks beyond.

/** A rectangle on the ground: x0, z0, x1, z1. */
type Area = [number, number, number, number];

const overlaps = (a: Area, b: Area) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** The blocks' walls' material: the facade painted on, lit windows by night. */
function facadeMaterial(): THREE.MeshStandardMaterial {
  const day = paintedOnce({ kind: 'facade', night: false, perMetre: 128 / 3 });
  const night = paintedOnce({ kind: 'facade', night: true, perMetre: 128 / 3 });
  for (const t of [day, night]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const m = new THREE.MeshStandardMaterial({
    map: day,
    emissiveMap: night,
    emissive: 0xffffff,
    emissiveIntensity: 0,
    vertexColors: true,
    roughness: 0.75,
    metalness: 0.05,
    envMapIntensity: 0.7,
  });
  m.userData[AT_NIGHT] = 1.1;
  return haze(madeOf(m, Surface.None));
}

/** Writes the four walls and the roof of a block `x0..x1` × `z0..z1`, `h` high. */
function block(
  walls: number[][],
  roofs: number[],
  [x0, z0, x1, z1]: Area,
  h: number,
  tint: THREE.Color,
  u0: number,
  v0: number,
): void {
  plainBlock(roofs, [x0, z0, x1, z1], h, h, true);
  const [pos, nor, uv, col] = walls as [number[], number[], number[], number[]];
  const quad = (corners: number[][], n: number[], width: number) => {
    // Two triangles: 0 1 2, 0 2 3, corners from the bottom left, anticlockwise from outside.
    const uvs = [
      [u0, v0],
      [u0 + width / FACADE, v0],
      [u0 + width / FACADE, v0 + h / FACADE],
      [u0, v0 + h / FACADE],
    ];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(...corners[i]!);
      nor.push(...n);
      uv.push(...uvs[i]!);
      col.push(tint.r, tint.g, tint.b);
    }
  };
  quad(
    [
      [x0, 0, z1],
      [x1, 0, z1],
      [x1, h, z1],
      [x0, h, z1],
    ],
    [0, 0, 1],
    x1 - x0,
  );
  quad(
    [
      [x1, 0, z0],
      [x0, 0, z0],
      [x0, h, z0],
      [x1, h, z0],
    ],
    [0, 0, -1],
    x1 - x0,
  );
  quad(
    [
      [x1, 0, z1],
      [x1, 0, z0],
      [x1, h, z0],
      [x1, h, z1],
    ],
    [1, 0, 0],
    z1 - z0,
  );
  quad(
    [
      [x0, 0, z0],
      [x0, 0, z1],
      [x0, h, z1],
      [x0, h, z0],
    ],
    [-1, 0, 0],
    z1 - z0,
  );
}

/**
 * Writes a plain box `x0..x1` × `z0..z1` from `y0` up to `y1`, its walls and its top, as
 * triangles' corners into `out`, or (`top`) only its top.
 */
function plainBlock(out: number[], [x0, z0, x1, z1]: Area, y0: number, y1: number, top = false) {
  out.push(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z1, x1, y1, z0, x0, y1, z0);
  if (top) return;
  const wall = (a: [number, number], b: [number, number]) =>
    out.push(
      a[0],
      y0,
      a[1],
      b[0],
      y0,
      b[1],
      b[0],
      y1,
      b[1],
      a[0],
      y0,
      a[1],
      b[0],
      y1,
      b[1],
      a[0],
      y1,
      a[1],
    );
  wall([x0, z1], [x1, z1]);
  wall([x1, z0], [x0, z0]);
  wall([x1, z1], [x1, z0]);
  wall([x0, z0], [x0, z1]);
}

/**
 * The blocks of flats and offices beyond the near streets, out to the far plane, on a grid of
 * streets lined up with the cross streets (`xs` and `zs` its lines), none within `keep`: each
 * block split into a few buildings of three to seven storeys, a tower here and there, taller
 * the further out; and the streets between them.
 */
function blocks(xs: number[], zs: number[], keep: Area[], centre: [number, number]): THREE.Group {
  const root = new THREE.Group();
  root.name = 'blocks';
  const walls: number[][] = [[], [], [], []];
  const roofs: number[] = [];
  const roads: number[] = [];
  const street = 8;
  const rand = rng(81);
  const far = (x: number, z: number) => Math.hypot(x - centre[0], z - centre[1]);
  const tint = new THREE.Color();
  const kept = (a: Area) => keep.some((k) => overlaps(a, k));
  for (let i = 0; i + 1 < xs.length; i++)
    for (let j = 0; j + 1 < zs.length; j++) {
      const cell: Area = [
        xs[i]! + street / 2,
        zs[j]! + street / 2,
        xs[i + 1]! - street / 2,
        zs[j + 1]! - street / 2,
      ];
      const [cx, cz] = [(cell[0] + cell[2]) / 2, (cell[1] + cell[3]) / 2];
      if (kept(cell) || far(cx, cz) > MID.far) continue;
      // The street along its south and west sides, as far as the next block.
      roads.push(cell[0] - street, cell[1] - street, cell[2] + street, cell[1]);
      roads.push(cell[0] - street, cell[1], cell[0], cell[3] + street);
      // Split once or twice along its longer side.
      let parts: Area[] = [cell];
      for (let k = 0; k < 2; k++)
        parts = parts.flatMap((a) => {
          const [w, d] = [a[2] - a[0], a[3] - a[1]];
          if (Math.max(w, d) < 16 || rand() < 0.35) return [a];
          const t = 0.35 + rand() * 0.3;
          return w > d
            ? [
                [a[0], a[1], a[0] + w * t, a[3]] as Area,
                [a[0] + w * t + 0.6, a[1], a[2], a[3]] as Area,
              ]
            : [
                [a[0], a[1], a[2], a[1] + d * t] as Area,
                [a[0], a[1] + d * t + 0.6, a[2], a[3]] as Area,
              ];
        });
      for (const a of parts) {
        const out = (far(cx, cz) - MID.near) / (MID.far - MID.near);
        const tower = rand() < 0.04 + 0.08 * out;
        const storeys = tower
          ? 9 + Math.floor(rand() * 6)
          : 3 + Math.floor(rand() * (3 + 2 * out)) + (rand() < 0.3 ? 1 : 0);
        // Its ground floor's windows level with a storey's in the painting.
        const h = storeys * BAY;
        tint.set(TOWN_COLOURS[Math.floor(rand() * TOWN_COLOURS.length)]!);
        tint.lerp(new THREE.Color(0xe8e4dc), 0.35 + 0.2 * rand());
        const inset = tower ? Math.min(a[2] - a[0], a[3] - a[1]) * 0.2 : 0;
        const b: Area = [a[0] + inset, a[1] + inset, a[2] - inset, a[3] - inset];
        block(walls, roofs, b, h, tint, Math.floor(rand() * 4) / 4, Math.floor(rand() * 4) / 4);
        // A parapet round the roof's edge, and a plant room on the roof of some.
        const e = 0.25;
        for (const side of [
          [b[0], b[1], b[2], b[1] + e],
          [b[0], b[3] - e, b[2], b[3]],
          [b[0], b[1], b[0] + e, b[3]],
          [b[2] - e, b[1], b[2], b[3]],
        ] as Area[])
          plainBlock(roofs, side, h, h + 0.6);
        if (rand() < 0.5) {
          const [w, d] = [(b[2] - b[0]) * 0.3, (b[3] - b[1]) * 0.3];
          const px = b[0] + (b[2] - b[0]) * (0.1 + rand() * 0.5);
          const pz = b[1] + (b[3] - b[1]) * (0.1 + rand() * 0.5);
          plainBlock(roofs, [px, pz, px + w, pz + d], h, h + 2.4);
        }
      }
    }
  const mesh = (geo: THREE.BufferGeometry, m: THREE.Material) => {
    geo.computeBoundingSphere();
    root.add(new THREE.Mesh(geo, m));
  };
  const [pos, nor, uv, col] = walls;
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos!, 3));
  wallGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nor!, 3));
  wallGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv!, 2));
  wallGeo.setAttribute('color', new THREE.Float32BufferAttribute(col!, 3));
  mesh(wallGeo, facadeMaterial());
  const roofGeo = new THREE.BufferGeometry();
  roofGeo.setAttribute('position', new THREE.Float32BufferAttribute(roofs, 3));
  roofGeo.computeVertexNormals();
  mesh(
    roofGeo,
    haze(
      madeOf(
        new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.85, envMapIntensity: 0.5 }),
        Surface.None,
      ),
    ),
  );
  // The streets: flat dark strips just over the floor.
  const road: number[] = [];
  for (let k = 0; k < roads.length; k += 4) {
    const [x0, z0, x1, z1] = roads.slice(k, k + 4) as Area;
    road.push(
      x0,
      0.002,
      z1,
      x1,
      0.002,
      z1,
      x1,
      0.002,
      z0,
      x0,
      0.002,
      z1,
      x1,
      0.002,
      z0,
      x0,
      0.002,
      z0,
    );
  }
  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(road, 3));
  roadGeo.computeVertexNormals();
  const asphalt = new THREE.Mesh(
    roadGeo,
    overFloor(groundMaterial(0x5a6066, { haze: true, grain: 0.6 })),
  );
  asphalt.renderOrder = 0.2;
  root.add(asphalt);
  finish(root);
  return root;
}

// ---------------------------------------------------------------------------------------------
// The whole town.

/** How far apart the grid of streets beyond runs. */
const PITCH = 32.7;

/** `line`, then every `PITCH` from it toward `to` (not past it). */
function lines(line: number, to: number): number[] {
  const out: number[] = [];
  const step = Math.sign(to - line) * PITCH;
  for (let v = line; Math.abs(v - line) <= Math.abs(to - line); v += step) out.push(v);
  return out;
}

/**
 * The town round Chevron Street, as the view adds it round the map (see `CITY_HAZE` for the
 * floor's fade to go with it): round its one copy, or (`divide`, the dividing line's z) round
 * both copies of a rival teams' level, the second turned half round about the line's middle.
 */
export function buildCity(divide: number | null): THREE.Group {
  const root = new THREE.Group();
  root.name = 'city';
  const near = nearHalf();
  root.add(near);
  const turn = (z: number) => 2 * (divide ?? 0) - z;
  if (divide !== null) {
    const twin = near.clone();
    twin.rotation.y = Math.PI;
    twin.position.z = 2 * divide;
    twin.updateMatrix();
    // (A clone aims as meshes do.)
    twin.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.raycast = () => {};
    });
    root.add(twin);
  } else root.add(farSide());

  // The cross streets, the whole length of the town, and the streets coming into them.
  const behind = [(NORTH.south + NORTH.north) / 2];
  const mid = (ROAD.south + ROAD.north) / 2;
  const [z0, z1] = [divide === null ? -64 : turn(76), 76];
  root.add(
    crossStreets(
      z0,
      z1,
      divide === null ? [mid] : [mid, turn(mid)],
      divide === null
        ? [...behind, (SOUTH.south + SOUTH.north) / 2]
        : [...behind, ...behind.map(turn)],
    ),
  );

  // The blocks beyond: kept clear of the near streets' rows (and their gardens), on a grid lined
  // up with the cross streets and the street behind.
  const north = NORTH.north + PAVE + GARDEN + TERRACE_DEPTH + 6;
  const south = divide === null ? SOUTH.south - PAVE - 4.4 - 12 - 4 : turn(north);
  const keep: Area[] = [
    [-MID.near, south, MID.near, north],
    [-REACH - 2, NORTH.south - PAVE - GARDEN - TERRACE_DEPTH - 2, REACH + 2, north],
  ];
  if (divide === null) keep.push([-REACH - 2, south, REACH + 2, -CHEVRON_HALF]);
  else keep.push([-REACH - 2, turn(north), REACH + 2, turn(keep[1]![1])]);
  const xs = [...lines(-CROSS, -MID.far - PITCH).reverse(), ...lines(CROSS, MID.far + PITCH)];
  const zMid = (NORTH.south + NORTH.north) / 2;
  const zs =
    divide === null
      ? [
          ...lines(zMid, -MID.far - PITCH)
            .reverse()
            .slice(0, -1),
          ...lines(zMid, MID.far + PITCH),
        ]
      : [
          ...lines(zMid, MID.far + PITCH)
            .map(turn)
            .reverse(),
          ...lines(zMid, MID.far + PITCH),
        ];
  const centre: [number, number] = [0, divide === null ? 0 : divide];
  root.add(blocks(xs, zs, keep, centre));

  root.updateMatrixWorld(true);
  return root;
}

/**
 * Frees what `buildCity` made: its meshes and the materials made for it alone (those copied from
 * the car scene's shared ones are kept for the next town, as are the painted textures).
 */
export function disposeCity(root: THREE.Group): void {
  const seen = new Set<object>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const x of [mesh.geometry, ...[mesh.material].flat()]) {
      if (seen.has(x)) continue;
      seen.add(x);
      if (x instanceof THREE.Material && sharedCopies.has(x)) continue;
      x.dispose();
    }
  });
}
