import * as THREE from 'three';
import { BASEPLATE_SIZE, floorRect, groundPieces, levelSites } from '@sar/shared';
import type { BoxDef, FloorRect, LevelDef } from '@sar/shared';
import { addHouseDetails, cutWindows, windowOpenings } from './details.ts';
import { CEILING_UNDER, Furniture, NO_FILL, WALL_PIECE, lightIndoors } from './furniture.ts';
import { bakeLampShadows } from './lampShadows.ts';
import { MachineView } from './brickworks.ts';
import { isFence, makeFence, makeHandrail, makeProp } from './props.ts';
import type { PropParts } from './props.ts';
import { groundAt, makeBell, makeCatapult, makeDoneButton } from './stations.ts';
import { makePole } from './gear.ts';
import { makeTreatJar } from './treatJar.ts';
import { greenery } from './nature.ts';
import { KEEP_SEPARATE } from './merge.ts';
import { FLOOR_LAYERS } from './layers.ts';
import { seaMeshes, shoreField, terrainMesh } from './terrain.ts';
import {
  SHORES,
  Surface,
  groundSurface,
  levelShores,
  madeAs,
  madeOf,
  surfaceOf,
} from './styles.ts';

/** Where a box is, as it is named by. */
export const where = (p: { x: number; y: number; z: number }) =>
  `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`;

/** How far the painted outline round a job site stands out from its baseplate on every side. */
const SITE_MARGIN = 0.5;

/**
 * How far in from its sides the water's sheet has a line of points, so that the painted style
 * can slope it down to the ground at its shores (see `SHORES`).
 */
const SHORE_SLOPE = 0.35;

/**
 * A level sheet of water over `w`, `y` up: three squares by three, laid flat (its rows of
 * points then run from z0 to z1), with their lines moved to `SHORE_SLOPE` in from its sides.
 */
function waterSheet(w: FloorRect, y: number): THREE.BufferGeometry {
  const lines = (a0: number, a1: number) => {
    const slope = Math.min(SHORE_SLOPE, (a1 - a0) / 3);
    return [a0, a0 + slope, a1 - slope, a1];
  };
  const xs = lines(w.x0, w.x1);
  const zs = lines(w.z0, w.z1);
  const geometry = new THREE.PlaneGeometry(1, 1, 3, 3).rotateX(-Math.PI / 2);
  const position = geometry.attributes.position!;
  for (let i = 0; i < position.count; i++) {
    position.setXYZ(i, xs[i % 4]!, y, zs[Math.floor(i / 4)]!);
  }
  geometry.computeBoundingSphere();
  return geometry;
}

/** A quality inspector's screen, drawn on a canvas (see `View.showInspectors`). */
export interface InspectorScreen {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  /** What it shows now, so it is only redrawn when that changes. */
  text: string;
}

/** Everything drawn for a level that stays put, and the handles on what does not. */
export interface LevelScene {
  root: THREE.Group;
  furniture: Furniture;
  /** The meeting bell of each job site: kept out of `mergeStatic`, to be shown or hidden. */
  bells: THREE.Group[];
  /** The dog's pole, for a gear hunt's leash: kept out of `mergeStatic`, to be shown or hidden. */
  pole: THREE.Group;
  /** The catapult's arm, which swings when it throws, if the level has a catapult. */
  catapultArm: THREE.Group | null;
  /** One screen per job site's inspector. */
  inspectorScreens: InspectorScreen[];
  /** The electrical panels, each with its status light (none if drawn from a model file). */
  panels: { box: BoxDef; led: THREE.Mesh | null }[];
  /** What an object under `root` belongs to, for the model checks (see `buildLevelModels`). */
  owner(o: THREE.Object3D): string;
  /** Names objects under `root` as belonging to `name` (see `owner`). */
  label(name: string, ...objs: THREE.Object3D[]): void;
  /** Frees what was made for this level: its geometry and the pictures painted for it. */
  dispose(): void;
}

/**
 * Builds what is drawn of `level` that stands still (bar the hiding places' doors), lit as in
 * the game, every piece its own mesh: the view then bakes it into a few (`mergeStatic`), and
 * the model checks look at the pieces (`buildLevelModels`).
 */
export function buildLevelScene(level: LevelDef): LevelScene {
  const root = new THREE.Group();
  const names = new Map<THREE.Object3D, string>();
  const label = (name: string, ...objs: THREE.Object3D[]) => {
    for (const o of objs) names.set(o, name);
  };
  const put = (name: string, ...objs: THREE.Object3D[]) => {
    root.add(...objs);
    label(name, ...objs);
  };

  // The ground, open over the basement (whose stairwell would otherwise be covered).
  const ground = madeOf(
    new THREE.MeshStandardMaterial({ color: level.groundColour ?? 0xc9b48f, roughness: 0.9 }),
    groundSurface(level),
  );
  for (const q of groundPieces(level)) {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(q.x1 - q.x0, q.z1 - q.z0), ground);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((q.x0 + q.x1) / 2, 0, (q.z0 + q.z1) / 2);
    floor.receiveShadow = true;
    floor.userData[NO_FILL] = true;
    put('ground', floor);
  }
  // Or ground that rises and falls, and the sea round it out to the horizon (an island's).
  if (level.terrain?.length) put('ground', terrainMesh(level));
  const shores = shoreField(level);
  if (level.sea !== undefined) put('water', ...seaMeshes(level, shores));
  // Water: a glassy sheet just above the ground, which players wade through slowly. Its
  // ripples and the sky mirrored in it are drawn by the style (see `Surface.Water`).
  const water = madeOf(
    new THREE.MeshStandardMaterial({
      color: 0x3f8fc9,
      roughness: 0.15,
      metalness: 0.1,
      transparent: true,
      opacity: 0.8,
    }),
    Surface.Water,
  );
  const floor = floorRect(level);
  // Its shores, where the painted style's shallows and foam are.
  water.userData[SHORES] = levelShores(level);
  for (const w of level.water ?? []) {
    const sheet = new THREE.Mesh(waterSheet(w, 0.06), water);
    sheet.receiveShadow = true;
    sheet.userData[NO_FILL] = true;
    put('water', sheet);
  }
  // A faint grid on flat ground (on hills and over the sea it would only cut through them).
  if (!level.terrain?.length) {
    const span = Math.max(floor.x1 - floor.x0, floor.z1 - floor.z0);
    const grid = new THREE.GridHelper(span, span, 0x000000, 0x000000);
    (grid.material as THREE.Material).opacity = 0.06;
    (grid.material as THREE.Material).transparent = true;
    grid.position.set((floor.x0 + floor.x1) / 2, FLOOR_LAYERS.grid, (floor.z0 + floor.z1) / 2);
    put('grid', grid);
  }

  // The level's boxes: furniture models, fences, and walls with their windows cut out.
  const openings = windowOpenings(level);
  const panels: LevelScene['panels'] = [];
  for (const box of level.boxes) {
    // Plain boxes: walls, or lower things built of boxes (a rack's shelves and posts).
    const plain = box.size.y >= 2 ? 'wall' : 'box';
    const fence = isFence(box, level);
    const name = `${box.model ?? (fence ? 'fence' : plain)} at ${where(box.pos)}`;
    const parts: PropParts = {};
    const prop = makeProp(box, level, parts) ?? (fence ? makeFence(box) : null);
    if (box.model === 'panel') panels.push({ box, led: parts.led ?? null });
    if (prop) {
      put(name, prop);
      continue;
    }
    // Walls with windows are drawn as the pieces left around the holes. They cast shadows
    // from both faces: from its far faces alone (three.js's default), where a wall met the
    // roof or another wall the sun slipped in through the seam as a bright line.
    for (const piece of cutWindows(box, openings)) {
      const material = madeAs(
        new THREE.MeshStandardMaterial({
          color: piece.colour,
          roughness: 0.8,
          shadowSide: THREE.DoubleSide,
        }),
        box.surface,
      );
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(piece.size.x, piece.size.y, piece.size.z),
        material,
      );
      mesh.position.set(piece.pos.x, piece.pos.y, piece.pos.z);
      mesh.rotation.x = piece.tiltX ?? 0;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData[WALL_PIECE] = true;
      // A flat roof has a ceiling under it, so the rooms are not roofed in tiles.
      if (surfaceOf(material) === Surface.Roof && !piece.tiltX) mesh.userData[CEILING_UNDER] = true;
      put(name, mesh);
    }
  }

  for (const s of level.stairs ?? []) put(`handrail at ${where(s.pos)}`, makeHandrail(s));

  // Painted lines on the floor round a w by d patch centred on (cx, cz), standing on `y`.
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf5c518, roughness: 0.6 });
  const frame = (
    name: string,
    cx: number,
    cz: number,
    w: number,
    d: number,
    thick = 0.08,
    y = 0,
  ) => {
    for (const [x, z, sx, sz] of [
      // The long bars run on over the corners and the short ones stop at them, so no bar's end
      // lies in the plane of a side of what it rings.
      [cx, cz - d / 2, w + thick, thick],
      [cx, cz + d / 2, w + thick, thick],
      [cx - w / 2, cz, thick, d - thick],
      [cx + w / 2, cz, thick, d - thick],
    ] as const) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, FLOOR_LAYERS.padThickness, sz), yellow);
      m.position.set(x, y + FLOOR_LAYERS.marking + FLOOR_LAYERS.padThickness / 2, z);
      m.receiveShadow = true;
      put(name, m);
    }
  };
  const furniture = new Furniture(root, level, (o, what, at) =>
    label(at ? `${what} at ${where(at)}` : what, o),
  );
  label('trim', addHouseDetails(root, level));

  // Each job site: an outline around the baseplate, the Done button and the meeting bell.
  const sites = levelSites(level);
  const bells = sites.map((site, i) => {
    const bp = site.baseplate;
    const side = BASEPLATE_SIZE + 2 * SITE_MARGIN;
    // On whatever the baseplate lies on (a deck, on an island).
    const [cx, cz] = [bp.x + BASEPLATE_SIZE / 2, bp.z + BASEPLATE_SIZE / 2];
    frame(`site ${i} outline`, cx, cz, side, side, 0.08, bp.y);
    const bell = makeBell(site.bell);
    // Shown or hidden with the mode after the level is built, so never baked into the merge.
    bell.userData[KEEP_SEPARATE] = true;
    put(`done button ${i}`, makeDoneButton(site.doneButton));
    put(`bell ${i}`, bell);
    return bell;
  });
  // The catapult in the yard, if the level has one.
  let catapultArm: THREE.Group | null = null;
  if (level.catapult) {
    const c = makeCatapult(level.catapult);
    put('catapult', c.group);
    catapultArm = c.arm;
  }

  // Quality inspectors: a pad on the floor and a screen behind it, one per job site. The
  // screen faces the way the pad's site does: turned about for the second yard.
  const inspectorScreens = sites.map((site, i): InspectorScreen => {
    const ins = site.inspector;
    const turned = i % 2 === 1;
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(ins.size.x, FLOOR_LAYERS.padThickness, ins.size.z),
      new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.8 }),
    );
    // On the decking if it stands on some (the camp's veranda), not buried under it.
    const floor = groundAt(level, ins.pos.x, ins.pos.z);
    pad.position.set(ins.pos.x, floor + FLOOR_LAYERS.padThickness / 2, ins.pos.z);
    pad.receiveShadow = true;
    put(`inspector ${i}`, pad);
    frame(`inspector ${i} outline`, ins.pos.x, ins.pos.z, ins.size.x, ins.size.z, 0.1, floor);
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 768;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 1.35, 1.8),
      [0, 1, 2, 3, 4, 5].map((k) =>
        k === (turned ? 1 : 0)
          ? new THREE.MeshBasicMaterial({ map: texture })
          : new THREE.MeshStandardMaterial({ color: 0x3a3f47 }),
      ),
    );
    const side = turned ? 1 : -1;
    // Its post stands on whatever floor is beside the pad, as the pad does on its own.
    const screenX = ins.pos.x + side * (ins.size.x / 2 + 0.3);
    const screenFloor = groundAt(level, screenX, ins.pos.z);
    screen.position.set(screenX, screenFloor + 1.5, ins.pos.z);
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.9, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x3a3f47 }),
    );
    post.position.set(screenX, screenFloor + 0.45, ins.pos.z);
    screen.castShadow = post.castShadow = true;
    put(`inspector ${i} screen`, screen, post);
    return { canvas, texture, text: '' };
  });
  // The dog's pole, by its kennel, for the leash of a gear hunt: shown in a gear hunt only, so
  // never baked into the merge.
  const polePoint = level.dog.points[level.dog.start]!;
  const pole = makePole();
  const [poleX, poleZ] = [polePoint.x + 0.6, polePoint.z + 0.6];
  // On the ground where it stands (which on a hill is not where the dog's point is).
  pole.position.set(
    poleX,
    level.terrain?.length ? groundAt(level, poleX, poleZ) : polePoint.y,
    poleZ,
  );
  pole.userData[KEEP_SEPARATE] = true;
  put('dog pole', pole);

  // The treat jars on the kitchen counters: glass with biscuits in it, and a lid.
  for (const jarAt of [level.dog.treatJar, ...(level.dog.treatJars ?? [])])
    put(`treat jar at ${where(jarAt)}`, makeTreatJar(jarAt));

  const shadows = bakeLampShadows(root, level, furniture.lampPools);
  put('lamp shadows', shadows.group);
  for (const [wall, pieces] of lightIndoors(root, level)) label(names.get(wall)!, ...pieces);
  put('greenery', greenery(level));
  root.updateMatrixWorld(true);

  return {
    root,
    furniture,
    bells,
    pole,
    catapultArm,
    inspectorScreens,
    panels,
    owner: (o) => {
      for (let v: THREE.Object3D | null = o; v; v = v.parent) {
        const n = names.get(v);
        if (n) return n;
      }
      return 'unknown';
    },
    label,
    dispose: () => {
      root.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
      });
      shadows.dispose();
      shores?.texture.dispose();
      for (const s of inspectorScreens) s.texture.dispose();
    },
  };
}

/**
 * The level's models built as `View` builds them, each named for what it belongs to, for the
 * model checks (see `models.ts` and `coplanar.test.ts`). Nothing is merged, so every piece
 * keeps its own mesh.
 */
export interface LevelModels {
  root: THREE.Group;
  furniture: Furniture;
  /** What each top-level object under `root` is. */
  owner(o: THREE.Object3D): string;
  /** Opens or shuts every hiding place, `fraction` of the way. */
  open(fraction: number): void;
}

export function buildLevelModels(level: LevelDef): LevelModels {
  const { root, furniture, owner, label } = buildLevelScene(level);
  // The machines with something in them, as the view adds them after the merge.
  for (const def of level.machines) {
    const view = new MachineView(def);
    view.update(
      {
        def,
        mould: '2x4',
        colour: 'red',
        shots: 5,
        part: null,
        jammed: false,
        fixer: null,
        progress: 0,
      },
      {},
    );
    root.add(view.group);
    label(`${def.kind} #${def.id}`, view.group);
  }
  root.updateMatrixWorld(true);
  const open = (fraction: number) => {
    furniture.pose(fraction);
    root.updateMatrixWorld(true);
  };
  return { root, furniture, owner, open };
}
