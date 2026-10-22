import * as THREE from 'three';
import {
  BRICK_TYPES,
  CONTROLLER_OFFSET,
  PAGE_SIZE,
  PLAYER_FEET,
  PLAYER_RADIUS,
  TICK_RATE,
  isLooseBrick,
  printKey,
  viewDir,
  CATAPULT,
  floorRect,
  groundHeight,
  groundSlope,
  machinePose,
  v3,
  VACUUM_CAPACITY,
} from '@sar/shared';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { RigidBody, World } from '@dimforge/rapier3d-compat';
import type {
  BoxDef,
  ColourId,
  Assembly,
  VacuumState,
  Dog,
  Quat,
  Vec3,
  InspectionReport,
  InspectorState,
  FloorRect,
  LevelDef,
  MachineState,
  SimEvent,
  PageItem,
  GearItem,
  GearId,
  Player,
  SnapPreview,
  TargetBuild,
  Tool,
} from '@sar/shared';
import { gameNow, random } from '../clock.ts';
import {
  GET_UP_SECONDS,
  Ragdoll,
  animateAvatar,
  gripPoints,
  makeAvatar,
  reachPose,
} from './avatar.ts';
import type { Avatar } from './avatar.ts';
import { Facing, walkHeading } from './facing.ts';
import { baseplateMarker, brickGeometry, drawnHex, setColourBlind } from './bricks.ts';
import {
  LeashLine,
  POLE_TIE_HEIGHT,
  makeGearProp,
  removeGear,
  wearGear,
  aimHeadlamp,
} from './gear.ts';
import type { WornGear } from './gear.ts';
import { VacuumView } from './vacuum.ts';
import { DogView } from './dog.ts';
import { setTimeOfDay } from './daynight.ts';
import type { Furniture } from './furniture.ts';
import { MachineView, makeHeldTool } from './brickworks.ts';
import type { MachineLook } from './brickworks.ts';
import { CarMachineView } from './carMachines.ts';
import { Operating } from './operating.ts';
import type { Released } from './operating.ts';
import { buildLevelScene } from './scene.ts';
import type { InspectorScreen, LevelScene } from './scene.ts';
import { mergeStatic } from './merge.ts';
import { PanelView } from './power.ts';
import { Graphics } from './graphics.ts';
import { setUnseen } from './layers.ts';
import { Sky } from './sky.ts';
import { bakeGroundShadows, bakeOver } from '../carscene/ground.ts';
import {
  DAY,
  FILL_FROM,
  NIGHT,
  SOFT_SHADOWS,
  floorOver,
  setLights,
  setStudio,
} from '../carscene/look.ts';
import { CAR_LIGHT, KEY_LIGHT } from '../carscene/scene.ts';
import { buildBackdrop, studioEnvironment } from '../carscene/studio.ts';
import { GRADE } from './finish.ts';
import { buildSurroundings, disposeSurroundings } from './surroundings.ts';
import { addBrickMeshes, addGhostMesh, addShell } from './pages.ts';
import { SEA_ROCKS, SHORE_MAP, Surface, madeOfAll, setSeaRocks } from './styles.ts';
import type { SeaRock } from './styles.ts';
import { isFence } from './props.ts';
import { addPrints, printsVersion } from './prints.ts';

interface AssemblyView {
  group: THREE.Group;
  version: number;
  /** A single brick, held in the hands rather than carried like a tray. */
  loose: boolean;
}

/**
 * The least height the sun's shadow reaches up to, for what stands on a level besides its boxes
 * (builds, players up a ladder); a level's taller boxes (a treehouse pine) raise it. Over the
 * highest of the ground, where it rises and falls.
 */
const SHADOW_TOP = 6;

/** What stands out at the edge of an island's sea, which the sun's shadow need not reach. */
const OUT_AT_SEA = new Set<BoxDef['model']>(['piling', 'collider']);

/** How a player stands on sloping ground, smoothed: see `onSlope`. */
interface OnSlope {
  /** How far the avatar is lowered from where the sim has the player. */
  sink: number;
  /** How steeply the ground rises ahead of them and to their right (rise per metre run). */
  ahead: number;
  right: number;
}

/** How far the player's capsule is from the ground it rests on: its foot's radius and skin. */
const FOOT_ROUND = PLAYER_RADIUS + CONTROLLER_OFFSET;

/**
 * Follows the slope a player stands on (`at`, where the sim has them, or null when they are not
 * standing on the ground: in the air, up a ladder, down), easing in and out over `dt` seconds.
 * On sloping ground the capsule's round foot rests on it where it touches, uphill of the middle,
 * so the capsule stands higher over the ground under its middle than on the flat, by
 * (r / cos(slope) - r): 5 cm at 30 degrees, 13 at 45. The avatar is lowered by as much, so its
 * feet meet the ground, and its legs reach for the ground up and down the slope from there (see
 * `animateAvatar`). Only over the level's terrain: on flat ground, a deck or a floor, nothing
 * changes.
 */
function onSlope(slope: OnSlope, level: LevelDef, at: Vec3 | null, yaw: number, dt: number): void {
  let [sink, ahead, right] = [0, 0, 0];
  if (at && level.terrain?.length) {
    const rise = groundSlope(level, at.x, at.z);
    const lift = FOOT_ROUND * (Math.hypot(1, rise) - 1);
    const over = at.y - PLAYER_FEET - CONTROLLER_OFFSET - groundHeight(level, at.x, at.z);
    // Resting on the terrain, not on something standing on it.
    if (rise > 0.02 && Math.abs(over - lift) < 0.08) {
      sink = lift;
      const e = 0.1;
      const h = (x: number, z: number) => groundHeight(level, x, z);
      const gx = (h(at.x + e, at.z) - h(at.x - e, at.z)) / (2 * e);
      const gz = (h(at.x, at.z + e) - h(at.x, at.z - e)) / (2 * e);
      // The avatar faces -z turned by its heading; its right is +x turned likewise.
      const [sin, cos] = [Math.sin(yaw), Math.cos(yaw)];
      ahead = -gx * sin - gz * cos;
      right = gx * cos - gz * sin;
    }
  }
  const k = 1 - Math.exp(-dt * 12);
  slope.sink += (sink - slope.sink) * k;
  slope.ahead += (ahead - slope.ahead) * k;
  slope.right += (right - slope.right) * k;
}

/**
 * Sizes the sun's shadow to the whole level as the sun sees it. The sun shines in at a slant, so
 * a square the size of the floor misses the far corners, and anything outside the shadow is
 * drawn in full sun: the kitchen's west end, fridge and all, was lit as if it had no roof.
 */
function fitShadow(sun: THREE.DirectionalLight, level: LevelDef): void {
  const tops = level.boxes.map((b) => b.pos.y + b.size.y / 2);
  if (!level.terrain?.length) {
    fitShadowTo(sun, floorRect(level), Math.max(SHADOW_TOP, ...tops));
    return;
  }
  // Ground that rises and falls: over the land (and the shallows round it, where shadows show
  // through the water) and what stands on it or out of the sea, not the open sea round it.
  // What marks the edge out in the sea (mooring posts, fences) is left to the shadow's edge,
  // and the walls nobody sees there cast no shadow.
  const sea = level.sea ?? -Infinity;
  const land = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
  let high = -Infinity;
  let low = Infinity;
  const take = (x: number, z: number) => {
    land.x0 = Math.min(land.x0, x);
    land.x1 = Math.max(land.x1, x);
    land.z0 = Math.min(land.z0, z);
    land.z1 = Math.max(land.z1, z);
  };
  for (const t of level.terrain) {
    for (let i = 0; i < t.nx; i++)
      for (let k = 0; k < t.nz; k++) {
        const h = t.heights[i * t.nz + k]!;
        if (h < sea - 0.6) continue;
        take(t.x0 + i * t.step, t.z0 + k * t.step);
        high = Math.max(high, h);
        low = Math.min(low, h);
      }
  }
  for (const b of level.boxes) {
    if (b.pos.y + b.size.y / 2 < sea || OUT_AT_SEA.has(b.model) || isFence(b, level)) continue;
    take(b.pos.x - b.size.x / 2, b.pos.z - b.size.z / 2);
    take(b.pos.x + b.size.x / 2, b.pos.z + b.size.z / 2);
  }
  if (land.x0 > land.x1) {
    fitShadowTo(sun, floorRect(level), Math.max(SHADOW_TOP, ...tops));
    return;
  }
  fitShadowTo(sun, land, Math.max(high + SHADOW_TOP, ...tops), Math.min(0, low));
}

/** Sizes the sun's shadow to a floor and everything from `bottom` up to `top` metres over it. */
function fitShadowTo(sun: THREE.DirectionalLight, f: FloorRect, top: number, bottom = 0): void {
  const cam = sun.shadow.camera;
  cam.position.copy(sun.position);
  cam.lookAt(sun.target.position);
  cam.updateMatrixWorld();
  const toLight = cam.matrixWorldInverse;
  const box = new THREE.Box3();
  for (const x of [f.x0 - 1, f.x1 + 1])
    for (const y of [bottom, top])
      for (const z of [f.z0 - 1, f.z1 + 1])
        box.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(toLight));
  // The camera looks down -z, so depth is -z. The sun sits inside the level's box, so near may be
  // negative: the shadow camera is orthographic, and the roof behind it must still cast.
  Object.assign(cam, {
    left: box.min.x,
    right: box.max.x,
    bottom: box.min.y,
    top: box.max.y,
    near: -box.max.z - 1,
    far: -box.min.z + 1,
  });
  cam.updateProjectionMatrix();
}

/**
 * The build editor's map: nothing standing, an even light and a plain backdrop, the build in
 * the middle. Its floor is the area the sun's shadow covers.
 */
const STUDIO = {
  sky: 0xe9e4d8,
  hemiSky: 0xffffff,
  hemiGround: 0x8a8478,
  hemi: 2,
  sun: 0xffffff,
  sunIntensity: 1.6,
  sunAt: new THREE.Vector3(3, 6, 4),
  floor: { x0: -3, x1: 5, z0: -3, z1: 5 },
  top: 4,
  fov: 45,
  near: 0.01,
};

/** Everything drawn on screen. Reads the simulation, never changes it. */
export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
  /** Resolution, shadows, ambient occlusion and lamps, from the graphics settings. */
  readonly graphics: Graphics;
  private readonly assemblyViews = new Map<number, AssemblyView>();
  /** The pictures printed parts carry, this round. */
  private printSvgs: Record<string, string> | undefined;
  /**
   * Where to draw a body this frame. The game sets this to blend between the last two physics
   * steps, so motion stays smooth on screens that refresh faster or less evenly than 60 Hz.
   */
  poseOf: (body: RigidBody) => { pos: Vec3; rot: Quat } = (b) => ({
    pos: b.translation(),
    rot: b.rotation(),
  });
  private readonly pageMeshes = new Map<number, THREE.Mesh>();
  /** Gear lying about (Gear Hunt), by item id. */
  private readonly gearMeshes = new Map<number, THREE.Group>();
  /** The dog's pole and the leash on it, shown in a gear hunt. */
  private pole!: THREE.Group;
  private readonly leashLine = new LeashLine();
  private bellMeshes: THREE.Object3D[] = [];
  /** The brick works' machines, by id, showing what is in them. */
  private machineViews = new Map<number, MachineLook>();
  /** Players operating the machines move by move (see `Operating`). */
  private readonly operating = new Operating(() => this.machineViews);
  /** Whether brick colours are drawn as one grey (a gear hunt without the goggles). */
  colourBlind = false;
  private readonly effects = new THREE.Group();
  furniture!: Furniture;
  /** The level drawn, and everything drawn for it. */
  level!: LevelDef;
  private levelScene!: LevelScene;
  private levelRoot!: THREE.Group;
  private readonly paper = new THREE.MeshStandardMaterial({ color: 0xfbf8f0, roughness: 0.9 });
  private readonly marks = {
    group: new THREE.Group(),
    report: null as InspectionReport | null,
    key: '',
  };
  private readonly ghostMarkMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  /** One screen per job site's inspector. */
  private inspectorScreens: InspectorScreen[] = [];
  private readonly dog = new DogView();
  readonly vacuum = new VacuumView();
  private vacuumBy: number | null = null;
  /** Where the carried vacuum's head rests, world space. */
  private vacuumHead: THREE.Vector3 | null = null;
  /** The player patting the dog, posed reaching for its head. */
  private patBy: number | null = null;
  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  /** The sky round the level (the build editor's map keeps its flat background colour). */
  private readonly sky = new Sky();
  /** The studio's light all round, every level's (see `buildLevel`). */
  private studioLight: THREE.Texture | null = null;
  /**
   * Every level is lit as car-test.html lights its scene (see `CarLook`), with a softbox beside
   * the sun; a level drawn with the cars' models also stands against the studio's backdrop
   * rather than the sky, its ground's soft shadows baked once it is built.
   */
  private readonly carStudio = {
    backdrop: buildBackdrop(),
    fill: new THREE.DirectionalLight(),
    baked: null as { key: THREE.WebGLRenderTarget; sky: THREE.WebGLRenderTarget } | null,
  };
  /** The sky's haze, out past the level (none in the studio). */
  private readonly fog = new THREE.Fog(0x9fc9e8, 25, 60);
  /** The country round the level, past its fence: drawn with the sky (and built once it shows). */
  private surroundings: THREE.Group | null = null;
  private night = false;
  /** Whether the house has power: without it the ceiling lamps are out. */
  private power = true;
  private panels: PanelView[] = [];
  /** Whether the lamps' real light is ray traced, so the ceiling lamps shine by day too. */
  private realLamps = false;
  /** Whether the scene was lit yet: it is built as by day with flat colours, until it is. */
  private lit = false;
  private readonly avatars = new Map<
    number,
    {
      avatar: Avatar;
      key: string;
      ragdoll: Ragdoll | null;
      /** Their knock count as of the last knock shown falling as a ragdoll. */
      knocks: number;
      /** The gear drawn on this builder. */
      worn: Map<GearId, WornGear>;
      /** The mould or bucket in their hands, and what it is. */
      tool: { key: string; group: THREE.Group } | null;
      /** Kept out of the camera's sight (see `UNSEEN`), gear and all. */
      unseen: boolean;
      /** The speaker icon over them, made the first time they talk on voice chat. */
      speaking: THREE.Sprite | null;
      /** The sloping ground they stand on, smoothed (see `onSlope`). */
      slope: OnSlope;
      /** Which way the body faces, turning to the way they walk (see `Facing`). */
      facing: Facing;
      /** Turns of a bolt their wrench has made, as of the last one heard (see `ratchets`). */
      turns: number;
      /** The part in their hands that a move hides till it is over (see `Operating`). */
      hidden: number | null;
    }
  >();
  /** Where a wrench turned a bolt this frame (world space), to be heard (see `syncPlayers`). */
  readonly ratchets: THREE.Vector3[] = [];
  /** The catapult's arm, and how far through a throw it is (null: at rest). */
  private catapultArm: THREE.Group | null = null;
  private catapultSwing: number | null = null;
  /** See-through bricks where the held brick or piece would snap, one mesh per brick. */
  private readonly ghost = new THREE.Group();
  private readonly ghostMaterials = new Map<string, THREE.MeshBasicMaterial>();
  /**
   * The build editor's map while it is shown in place of the level: what it draws, and what
   * it put away to be brought back after.
   */
  private studio: {
    stage: THREE.Object3D;
    hidden: THREE.Object3D[];
    lens: { fov: number; near: number; far: number };
  } | null = null;

  constructor(container: HTMLElement, level: LevelDef) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    window.addEventListener('resize', () => this.resize());
    this.resize();

    this.scene.background = new THREE.Color(0x9fc9e8);
    this.scene.fog = this.fog;
    this.hemi = new THREE.HemisphereLight(0xdfefff, 0x6b5b45, 1.4);
    this.scene.add(this.hemi);
    const sun = (this.sun = new THREE.DirectionalLight(0xfff3dd, 2.2));
    sun.castShadow = true;
    // Its map size and offsets go with the graphics settings (`Graphics.apply`).
    this.scene.add(sun, sun.target);
    this.scene.add(this.carStudio.backdrop, this.carStudio.fill, this.carStudio.fill.target);

    this.graphics = new Graphics(this.renderer, this.scene, this.camera, sun);
    this.buildLevel(level);
    this.graphics.onTraced = (on) => {
      if (on === this.realLamps) return;
      this.realLamps = on;
      this.applyTimeOfDay();
    };
    this.lightLevel();
    madeOfAll(this.dog.group, Surface.Fabric);
    this.scene.add(this.marks.group, this.effects, this.dog.group, this.vacuum.group);
    this.leashLine.line.visible = false;
    this.scene.add(this.leashLine.line);
    this.scene.add(this.sky.mesh);

    this.ghost.visible = false;
    this.scene.add(this.ghost);
  }

  /**
   * Shows the build editor's map (`STUDIO`) with `stage` on it instead of the level, until
   * `hideStudio`: everything else in the scene is put away, and the light, sky and lens are the
   * map's. It is drawn just as the level is, in the graphics settings.
   */
  showStudio(stage: THREE.Object3D): void {
    if (this.studio) return;
    const keep = new Set<THREE.Object3D>([this.hemi, this.sun, stage]);
    const hidden = this.scene.children.filter((o) => o.visible && !keep.has(o));
    for (const o of hidden) o.visible = false;
    const cam = this.camera;
    this.studio = {
      stage,
      hidden,
      lens: { fov: cam.fov, near: cam.near, far: cam.far },
    };
    this.scene.add(stage);
    this.scene.fog = null;
    this.sun.position.copy(STUDIO.sunAt);
    this.sun.target.position.set(0, 0, 0);
    fitShadowTo(this.sun, STUDIO.floor, STUDIO.top);
    this.graphics.grade = { ...GRADE };
    this.graphics.shadowSoftness = null;
    this.graphics.setHouse(null);
    this.applyTimeOfDay();
    cam.fov = STUDIO.fov;
    cam.near = STUDIO.near;
    cam.updateProjectionMatrix();
  }

  /** Puts the build editor's map away and brings the level back as it was. */
  hideStudio(): void {
    const s = this.studio;
    if (!s) return;
    this.studio = null;
    this.scene.remove(s.stage);
    for (const o of s.hidden) o.visible = true;
    this.lightLevel();
    this.applyTimeOfDay();
    Object.assign(this.camera, s.lens);
    this.camera.clearViewOffset();
    this.resize();
  }

  /** The height of the level's ground at (`x`, `z`) (see `groundHeight`). */
  private readonly groundOf = (x: number, z: number) => groundHeight(this.level, x, z);

  private resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.graphics?.resize();
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  private gearMode = false;
  /** A free build has no meetings either, so no bell. */
  private freeMode = false;

  /** Shows the job site as a gear hunt's: no bell, and a pole for the dog. */
  setGearMode(on: boolean): void {
    if (on === this.gearMode) return;
    this.gearMode = on;
    this.showBells();
    this.pole.visible = on;
  }

  /** Shows the job site as a free build's: no bell. */
  setFreeMode(on: boolean): void {
    if (on === this.freeMode) return;
    this.freeMode = on;
    this.showBells();
  }

  private showBells(): void {
    for (const bell of this.bellMeshes) bell.visible = !this.gearMode && !this.freeMode;
  }

  /**
   * Draws every brick colour as one grey, or as it is: the bricks and the machines, the snap
   * ghosts and the inspector's marks. Pages are printed again by their art callback.
   */
  setColourBlind(blind: boolean): void {
    if (blind === this.colourBlind) return;
    this.colourBlind = blind;
    setColourBlind(blind);
    for (const machine of this.machineViews.values()) machine.refreshColours();
    for (const m of this.ghostMaterials.values()) m.dispose();
    this.ghostMaterials.clear();
    this.ghost.clear();
    this.marks.key = '';
  }

  /** Shows gear lying about, and the leash on the pole once the dog is on it. */
  syncGear(gear: Map<number, GearItem>): void {
    for (const [id, mesh] of this.gearMeshes) {
      if (!gear.has(id)) {
        this.scene.remove(mesh);
        this.gearMeshes.delete(id);
      }
    }
    let leashed = false;
    for (const item of gear.values()) {
      if (item.placed) leashed = true;
      let mesh = this.gearMeshes.get(item.id);
      if (!mesh) {
        mesh = makeGearProp(item.kind);
        this.scene.add(mesh);
        this.gearMeshes.set(item.id, mesh);
      }
      mesh.visible = item.body !== null;
      if (item.body) {
        const { pos: t, rot: r } = this.poseOf(item.body);
        mesh.position.set(t.x, t.y, t.z);
        mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }
    }
    this.leashLine.line.visible = leashed;
    if (leashed) {
      const top = new THREE.Vector3(0, POLE_TIE_HEIGHT, 0);
      this.pole.localToWorld(top);
      const collar = this.dog.headTop(new THREE.Vector3());
      collar.y -= 0.12;
      this.leashLine.update(top, collar);
    }
  }

  private buildLevel(level: LevelDef): void {
    this.machineViews = new Map();
    const built = buildLevelScene(level);
    const root = built.root;
    this.level = level;
    this.levelScene = built;
    this.levelRoot = root;
    this.scene.add(root);
    this.furniture = built.furniture;
    // (The bells are hidden in a gear hunt and a free build, which have no meetings.)
    this.bellMeshes = built.bells;
    this.showBells();
    this.catapultArm = built.catapultArm;
    this.inspectorScreens = built.inspectorScreens;
    this.pole = built.pole;
    this.pole.visible = this.gearMode;
    // Every level is lit by the car studio's light all round too, as car-test.html lights its
    // scene (and its reflections in paint, glass and plastic).
    if (!this.studioLight) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.studioLight = pmrem.fromScene(studioEnvironment(KEY_LIGHT), 0.04).texture;
      pmrem.dispose();
    }
    this.scene.environment = this.studioLight;
    // Nothing above moves (apart from the hiding places' doors), so draw it in a few calls.
    mergeStatic(root);
    // The machines change with what is put in them: drawn on their own, after the merge. A
    // level drawn with the car scene's models has its machines in that style too.
    for (const def of level.machines) {
      const machine = level.scenery ? new CarMachineView(def) : new MachineView(def);
      this.machineViews.set(def.id, machine);
      root.add(machine.group);
    }
    this.panels = built.panels.map((p) => new PanelView(root, p.box, p.led));
    if (level.scenery) this.bakeGround();
  }

  /**
   * Bakes the soft shadows of everything in the level onto its ground, as the car scene's are
   * (see `bakeGroundShadows`), over the whole of its floor: once, as nothing in it moves but the
   * hiding places' doors. The players and all that comes and goes are left out.
   */
  private bakeGround(): void {
    const f = floorRect(this.level);
    const area = {
      x: (f.x0 + f.x1) / 2,
      z: (f.z0 + f.z1) / 2,
      size: Math.max(f.x1 - f.x0, f.z1 - f.z0) + 4,
    };
    bakeOver(area);
    floorOver(area);
    const old = this.carStudio.baked;
    old?.key.dispose();
    old?.sky.dispose();
    const alone = new THREE.Scene();
    alone.add(this.levelRoot);
    this.carStudio.baked = bakeGroundShadows(this.renderer, alone, KEY_LIGHT, { samples: 32 });
    this.scene.add(this.levelRoot);
  }

  /**
   * Lights the level as car-test.html lights its scene, whatever it is drawn with: from the
   * key's side with a softbox and soft shadows, graded as the cars are. A level drawn with the
   * cars' models stands in their studio; the others keep their sky round them.
   */
  private lightLevel(): void {
    const cars = !!this.level.scenery;
    const { backdrop, fill } = this.carStudio;
    backdrop.visible = cars;
    fill.visible = true;
    this.scene.fog = cars ? null : this.fog;
    const f = floorRect(this.level);
    this.sun.target.position.set((f.x0 + f.x1) / 2, 0, (f.z0 + f.z1) / 2);
    this.sun.position.copy(CAR_LIGHT).multiplyScalar(25).add(this.sun.target.position);
    fill.target.position.copy(this.sun.target.position);
    fill.position.copy(FILL_FROM).add(fill.target.position);
    fitShadow(this.sun, this.level);
    this.graphics.shadowSoftness = SOFT_SHADOWS;
    // Traced light is for the game's own houses: the cars' models are lit as they are made for.
    this.graphics.setHouse(cars ? null : this.levelRoot, this.groundOf);
  }

  /**
   * Swaps in another level: the house furnished for a new round. Everything drawn for the old
   * one goes; the sun, sky and whatever is drawn per frame stay.
   */
  setLevel(level: LevelDef): void {
    if (level === this.level) return;
    // Built behind the build editor's map, to be there once it is put away.
    const stage = this.studio?.stage;
    this.hideStudio();
    this.levelRoot.removeFromParent();
    this.levelScene.dispose();
    if (this.surroundings) {
      this.surroundings.removeFromParent();
      disposeSurroundings(this.surroundings);
      this.surroundings = null;
    }
    this.buildLevel(level);
    this.lightLevel();
    // The new house is built as by day with its lamps off: light it for the time and settings.
    this.applyTimeOfDay();
    if (stage) this.showStudio(stage);
  }

  /** Redraws the inspectors' screens when what they say changes. */
  showInspectors(states: InspectorState[], build: TargetBuild): void {
    states.forEach((state, i) => this.showInspector(state, build, i));
  }

  private showInspector(state: InspectorState, build: TargetBuild, site = 0): void {
    const pct = Math.round(state.progress * 100);
    const key = `${state.status}|${pct}|${state.scannedVersion}`;
    const s = this.inspectorScreens[site];
    if (!s || s.text === key) return;
    s.text = key;
    const W = s.canvas.width;
    const g = s.canvas.getContext('2d')!;
    g.fillStyle = '#10131a';
    g.fillRect(0, 0, W, s.canvas.height);
    g.fillStyle = '#f5c518';
    g.font = 'bold 44px system-ui, sans-serif';
    g.fillText('QUALITY INSPECTOR', 36, 64);
    g.font = '36px system-ui, sans-serif';
    g.fillStyle = '#e8eef5';
    let y = 130;
    if (state.status === 'scanning') {
      g.fillText(`Scanning… ${pct}%`, 36, y);
      g.fillStyle = '#2c9a3a';
      g.fillRect(36, y + 24, (W - 72) * state.progress, 28);
      y += 110;
    } else if (state.status === 'idle') {
      g.fillText('Set the build down on the pad to check it.', 36, y);
      y += 60;
    }
    const report = state.report;
    if (report && state.status !== 'scanning') {
      if (state.status === 'idle') {
        g.fillStyle = '#9aa3ad';
        g.font = '30px system-ui, sans-serif';
        g.fillText('Last scan:', 36, y);
        y += 50;
      }
      g.fillStyle = report.correct === report.total ? '#3fd15a' : '#e8eef5';
      g.font = 'bold 52px system-ui, sans-serif';
      g.fillText(`${report.correct} of ${report.total} bricks correct`, 36, y + 20);
      y += 90;
      g.font = '34px system-ui, sans-serif';
      report.steps.forEach((step, i) => {
        const x = 36 + (i % 2) * (W / 2);
        const row = y + Math.floor(i / 2) * 52;
        g.fillStyle = '#e8eef5';
        g.fillText(`Step ${i + 1}`, x, row);
        const [text, colour] =
          step.verdict === 'empty'
            ? ['not started', '#7d8590']
            : step.verdict === 'correct'
              ? [`✔ ${step.correct}/${step.total}`, '#3fd15a']
              : [
                  `✘ ${step.correct}/${step.total}`,
                  step.verdict === 'wrong' ? '#ff5a4a' : '#f5c518',
                ];
        g.fillStyle = colour;
        g.fillText(text, x + 140, row);
      });
      const problems = report.steps.reduce((n, st) => n + st.lines.length, report.extras.length);
      g.fillStyle = '#9aa3ad';
      g.font = '28px system-ui, sans-serif';
      g.fillText(
        problems
          ? `${problems} problems marked on the build. Press I for the list.`
          : 'No problems found.',
        36,
        s.canvas.height - 70,
      );
    }
    g.fillStyle = '#5c636d';
    g.font = '24px system-ui, sans-serif';
    g.fillText(`Model: ${build.name}`, 36, s.canvas.height - 28);
    s.texture.needsUpdate = true;
  }

  /**
   * Sticks the last inspection onto the build: red shells on wrong or extra bricks, orange on
   * look-alikes, ghosts where bricks are missing. Marks disappear once the brick is replaced.
   */
  showInspectionMarks(report: InspectionReport | null, build: Assembly): void {
    const key = report ? `${build.version}` : '';
    if (report !== this.marks.report || key !== this.marks.key) {
      this.marks.report = report;
      this.marks.key = key;
      this.marks.group.clear();
      if (report) {
        for (const f of report.flagged) {
          const b = build.grid.bricks.get(f.id);
          // Without the goggles the marks tell nothing apart: all the one grey.
          const shade = this.colourBlind ? 0x8a8c90 : f.kind === 'close' ? 0xff9f0a : 0xff3b30;
          if (b) addShell(this.marks.group, b, shade);
        }
        for (const t of report.ghosts) {
          if (build.grid.brickAt(t.x, t.y, t.z) === undefined) {
            addGhostMesh(this.marks.group, t, this.ghostMarkMaterial);
          }
        }
      }
    }
    const { pos: p, rot: r } = this.poseOf(build.body);
    this.marks.group.position.set(p.x, p.y, p.z);
    this.marks.group.quaternion.set(r.x, r.y, r.z, r.w);
  }

  /** Shows pages lying in the world; pocketed pages are hidden. Reprinted pages get new art. */
  syncPages(pages: Map<number, PageItem>, art: (page: PageItem) => HTMLCanvasElement): void {
    for (const [id, mesh] of this.pageMeshes) {
      if (!pages.has(id)) {
        this.scene.remove(mesh);
        this.pageMeshes.delete(id);
      }
    }
    for (const page of pages.values()) {
      let mesh = this.pageMeshes.get(page.id);
      const key = `${this.colourBlind ? 'grey:' : ''}${printsVersion()}:${artKey(page.printed)}`;
      if (mesh && mesh.userData.key !== key) {
        this.scene.remove(mesh);
        mesh = undefined;
      }
      if (!mesh) {
        const texture = new THREE.CanvasTexture(art(page));
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        const face = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 });
        mesh = new THREE.Mesh(new THREE.BoxGeometry(PAGE_SIZE.x, PAGE_SIZE.y, PAGE_SIZE.z), [
          this.paper,
          this.paper,
          face,
          this.paper,
          this.paper,
          this.paper,
        ]);
        mesh.userData.key = key;
        mesh.castShadow = mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.pageMeshes.set(page.id, mesh);
      }
      mesh.visible = page.body !== null;
      if (page.body) {
        const { pos: t, rot: r } = this.poseOf(page.body);
        mesh.position.set(t.x, t.y, t.z);
        mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }
    }
  }

  /**
   * Adds, removes and moves meshes to match the simulation's assemblies. Printed parts carry
   * their prints, drawn from `svgs`.
   */
  syncAssemblies(assemblies: Map<number, Assembly>, svgs?: Record<string, string>): void {
    if (svgs !== this.printSvgs) {
      this.printSvgs = svgs;
      for (const v of this.assemblyViews.values()) v.version = -1;
    }
    for (const [id, v] of this.assemblyViews) {
      if (!assemblies.has(id)) {
        this.scene.remove(v.group);
        this.assemblyViews.delete(id);
      }
    }
    for (const a of assemblies.values()) {
      let v = this.assemblyViews.get(a.id);
      if (!v) {
        v = { group: new THREE.Group(), version: -1, loose: true };
        this.scene.add(v.group);
        this.assemblyViews.set(a.id, v);
      }
      if (v.version !== a.version) {
        for (const o of v.group.children) if (o instanceof THREE.InstancedMesh) o.dispose();
        v.group.clear();
        addBrickMeshes(v.group, a.grid.bricks.values(), this.printSvgs);
        for (const b of a.grid.bricks.values()) {
          if (BRICK_TYPES[b.type].fixture) v.group.add(baseplateMarker());
        }
        v.version = a.version;
        v.loose = isLooseBrick(a);
      }
      const { pos: t, rot: r } = this.poseOf(a.body);
      v.group.position.set(t.x, t.y, t.z);
      v.group.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  /**
   * Draws every player as the mechanic in their lobby colour, with a name tag over everyone but
   * yourself; avatars are rebuilt if a player's colour or name changes. Someone knocked
   * over becomes a ragdoll in the client's world (made when their knock count goes up) until
   * they are back on their feet. `firstPerson`: the camera is in close, so your own builder is
   * kept out of its sight; `looking`: you play in first person, so your builder faces the way
   * you look rather than the way you walk. `fixing` says who is fixing something (a jammed
   * machine, the electrical panel), the wrench out in their hand; each turn of a bolt it makes
   * is put in `ratchets`.
   */
  syncPlayers(
    players: Map<number, Player>,
    localId: number,
    firstPerson: boolean,
    looking: boolean,
    who: (id: number) => { colour: number; name: string },
    physics: { R: typeof RAPIER; world: World },
    dt: number,
    fixing: (id: number) => boolean = () => false,
  ): void {
    this.ratchets.length = 0;
    const now = gameNow() / 1000;
    for (const [id, v] of this.avatars) {
      if (!players.has(id)) {
        this.dropAvatar(v);
        this.avatars.delete(id);
        this.operating.forget(id);
      }
    }
    for (const p of players.values()) {
      const { colour, name } = who(p.id);
      const key = `${colour}|${name}`;
      let v = this.avatars.get(p.id);
      if (v && v.key !== key) {
        this.dropAvatar(v);
        v = undefined;
      }
      // Down: a ragdoll. For the last moments of it the player gets back up, and then the
      // standing avatar takes over exactly where the ragdoll's parts ended up.
      const getUpTicks = GET_UP_SECONDS * TICK_RATE;
      if (!v) {
        const avatar = makeAvatar(colour, p.id === localId ? null : nameTag(name));
        // Builders are moulded plastic, like the bricks.
        madeOfAll(avatar.group, Surface.Plastic);
        this.scene.add(avatar.group);
        v = {
          avatar,
          key,
          ragdoll: null,
          // Seen first lying down: that knock is still to be shown.
          knocks: p.down > getUpTicks ? p.knocks - 1 : p.knocks,
          worn: new Map(),
          tool: null,
          unseen: false,
          speaking: null,
          slope: { sink: 0, ahead: 0, right: 0 },
          facing: new Facing(p.input.yaw),
          turns: 0,
          hidden: null,
        };
        this.avatars.set(p.id, v);
      }
      // Gear put on or taken off since last frame.
      let wore = false;
      for (const [kind, worn] of v.worn) {
        if (!p.gear.has(kind)) {
          removeGear(worn);
          v.worn.delete(kind);
        }
      }
      for (const kind of p.gear) {
        if (!v.worn.has(kind)) {
          v.worn.set(kind, wearGear(v.avatar, kind));
          wore = true;
        }
      }
      const t = this.poseOf(p.body).pos;
      const g = v.avatar.group;
      g.position.set(t.x, t.y, t.z);
      // Operating a machine move by move: the body steps where the move has it.
      const op = v.ragdoll ? null : this.operating.pose(p, g.position.clone(), now);
      if (op?.at) g.position.copy(op.at);
      // Facing: the way they walk, turning there in a short swing. Your own builder goes by your
      // keys, so walking into a wall still turns them to it; someone else's by how they move.
      // Holding something out in front (the sim has it where they look), patting the dog and in
      // first person, they face where they look; working a machine, they face where they work
      // it. Down, the ragdoll has them.
      const mine = p.id === localId;
      const went = v.facing.walking(t.x, t.z, dt);
      const aimed =
        (mine && looking) ||
        p.holding !== null ||
        p.tool !== null ||
        this.vacuumBy === p.id ||
        this.patBy === p.id;
      if (v.facing.jumped) v.facing.snap(p.input.yaw);
      // Squeezing through a gap, side-on to it, as car-test.html's mechanic does.
      const sq = p.squeeze;
      const hand = p.work?.hand;
      const heading =
        op?.heading != null
          ? op.heading
          : sq
            ? Math.atan2(-sq.x, -sq.z) + Math.PI / 2
            : hand
              ? Math.atan2(-(hand.x - t.x), -(hand.z - t.z))
              : aimed
                ? p.input.yaw
                : mine
                  ? walkHeading(p.input.yaw, p.input.forward, p.input.right)
                  : went;
      g.rotation.y = v.ragdoll ? v.facing.heading : v.facing.turn(heading, dt);
      // Standing on sloping ground, lowered onto it (see `onSlope`).
      const standing = p.grounded && p.ladder === null && p.down === 0;
      onSlope(v.slope, this.level, standing ? t : null, g.rotation.y, dt);
      g.position.y -= v.slope.sink;
      // Each knock falls as one ragdoll, once the last one is back up.
      if (p.down > getUpTicks && !v.ragdoll && p.knocks !== v.knocks) {
        const fall = viewDir(g.rotation.y, 0);
        const ground = this.level.terrain?.length ? this.groundOf : undefined;
        v.ragdoll = new Ragdoll(physics.R, physics.world, v.avatar, fall, ground);
        this.scene.add(v.ragdoll.group);
        v.knocks = p.knocks;
      } else if (v.ragdoll && !v.ragdoll.standing) {
        // Back on their feet without getting up (moved to a meeting): no animation.
        if (p.down === 0) {
          v.ragdoll.dispose();
          v.ragdoll = null;
          v.avatar.last = null;
        } else if (p.down <= getUpTicks) v.ragdoll.standUp();
      }
      // What they carry: but what a move takes is the move's to draw till it is over, and what
      // they bring up to a machine is drawn by it (see `Operating`).
      const shown = op?.hideHeld ? undefined : p.holding;
      const held = shown ? this.assemblyViews.get(shown.assemblyId) : undefined;
      if (op?.hideHeld && p.holding) {
        const hidden = this.assemblyViews.get(p.holding.assemblyId);
        if (hidden) hidden.group.visible = false;
        v.hidden = p.holding.assemblyId;
      } else if (v.hidden !== null) {
        const hidden = this.assemblyViews.get(v.hidden);
        if (hidden) hidden.group.visible = true;
        v.hidden = null;
      }
      const carried = v.tool;
      const tool = this.carriedTool(v, op?.hideTool ? null : p.tool);
      this.operating.carry(p.id, g);
      const brought = op?.carry ?? null;
      const vacuum =
        this.vacuumBy === p.id
          ? this.vacuum.carry(g, this.vacuumHead, p.id === localId && firstPerson)
          : null;
      let pat: THREE.Vector3 | null = null;
      if (this.patBy === p.id) {
        g.updateMatrixWorld(true);
        pat = g.worldToLocal(this.dog.headTop(new THREE.Vector3()));
      }
      let work: THREE.Vector3 | null = null;
      if (p.work?.there && !op?.hands) {
        g.updateMatrixWorld(true);
        const { x, y, z } = p.work.hand;
        work = g.worldToLocal(new THREE.Vector3(x, y, z));
      }
      // The move's hands and look, in the avatar's own space, and the body brought down and
      // leaning in as far as they need to reach.
      let operate = null;
      if (op?.hands) {
        g.updateMatrixWorld(true);
        const local = (w: THREE.Vector3 | null) => (w ? g.worldToLocal(w.clone()) : null);
        const hands: [THREE.Vector3 | null, THREE.Vector3 | null] = [
          local(op.hands[0]),
          local(op.hands[1]),
        ];
        operate = { hands, ...reachPose(hands), look: local(op.look) };
      }
      animateAvatar(
        v.avatar,
        {
          limping: p.limp > 0,
          carrying:
            !operate &&
            (held !== undefined || p.treat || vacuum !== null || tool !== null || !!brought),
          careful: p.input.careful,
          grip: operate
            ? null
            : held
              ? gripPoints(v.avatar, held.group, !held.loose)
              : tool
                ? gripPoints(v.avatar, tool, false)
                : brought
                  ? gripPoints(v.avatar, brought, false)
                  : vacuum,
          pat,
          work,
          operate,
          wrench: fixing(p.id),
          climb: p.ladder === null ? null : (this.level.ladders[p.ladder] ?? null),
          airborne: !p.grounded && p.ladder === null && p.down === 0,
          slope: v.slope,
          turn: v.ragdoll ? null : { spin: v.facing.spin, lead: v.facing.lead },
          squeeze: p.squeeze !== null,
        },
        dt,
      );
      v.avatar.treat.visible = p.treat;
      if (v.avatar.turns !== v.turns) {
        v.turns = v.avatar.turns;
        this.ratchets.push(g.localToWorld(v.avatar.workAt.clone()));
      }
      v.avatar.page.visible = p.page !== null;
      if (v.ragdoll?.standing) {
        g.updateMatrixWorld(true);
        if (v.ragdoll.updateGetUp(dt)) {
          v.ragdoll.dispose();
          v.ragdoll = null;
        }
      } else v.ragdoll?.sync();
      // Down, the ragdoll stands in for the avatar, headlamp and all, which goes out. With the
      // camera in close, your own builder is only kept out of its sight.
      g.visible = !v.ragdoll;
      const unseen = p.id === localId && firstPerson;
      // Seen through your own eyes, the wrench still shows, as what you carry does.
      if (unseen !== v.unseen || wore || v.tool !== carried) {
        setUnseen(g, unseen);
        setUnseen(v.avatar.wrench, false);
      }
      v.unseen = unseen;
      for (const worn of v.worn.values()) aimHeadlamp(worn, v.avatar, p.input.pitch);
    }
  }

  /** Poses the dog; call every frame, before `syncPlayers` (whoever pats it reaches for it). */
  syncDog(dog: Dog, dt: number, time: number): void {
    const ground = this.level.terrain?.length ? this.groundOf : undefined;
    this.dog.update(dog, this.poseOf(dog.body).pos, dt, time, ground);
    this.patBy = dog.mode === 'pat' ? dog.patBy : null;
  }

  /**
   * Poses the vacuum where it rests, and runs its motor on by `dt` seconds; call every frame,
   * before `syncPlayers` (which poses it carried, its head on the floor at `head`).
   */
  syncVacuum(b: VacuumState, head: Vec3 | null, dt: number): void {
    this.vacuumBy = b.heldBy;
    this.vacuumHead = head && new THREE.Vector3(head.x, head.y, head.z);
    this.vacuum.setLoad(b.load, VACUUM_CAPACITY);
    this.vacuum.update(b.heldBy, dt);
    if (b.heldBy === null) this.vacuum.rest(b);
  }

  /** Where the camera should look while the given player lies on the ground, if they do. */
  ragdollFocus(id: number): Vec3 | null {
    return this.avatars.get(id)?.ragdoll?.focus ?? null;
  }

  /** Shows a speaker icon over the players who are talking on voice chat right now. */
  showSpeaking(speaking: (id: number) => boolean): void {
    for (const [id, v] of this.avatars) {
      const on = speaking(id);
      if (!v.speaking && !on) continue;
      if (!v.speaking) {
        const icon = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: speakerIcon(), depthWrite: false }),
        );
        icon.scale.setScalar(0.28);
        icon.position.y = PLAYER_FEET + 0.65;
        v.avatar.group.add(icon);
        v.speaking = icon;
      }
      v.speaking.visible = on;
    }
  }

  /**
   * Shows the mould or bucket a builder carries, held out in front of them (nothing, or what
   * they carried, gone). Returns it, for their hands to grip.
   */
  private carriedTool(
    v: { avatar: Avatar; tool: { key: string; group: THREE.Group } | null },
    tool: Tool | null,
  ): THREE.Group | null {
    const key = tool ? `${tool.kind}:${tool.kind === 'mould' ? tool.type : tool.colour}` : '';
    if (v.tool?.key === key) return v.tool.group;
    if (v.tool) v.avatar.group.remove(v.tool.group);
    v.tool = null;
    if (!tool) return null;
    const group = makeHeldTool(tool);
    // At the chest, an arm's length out, where carried bricks are held.
    group.position.set(0, tool.kind === 'bucket' ? 0.05 : 0.15, -0.42);
    v.avatar.group.add(group);
    v.tool = { key, group };
    return group;
  }

  /** Shows what is in each of the brick works' machines, and them working; call every frame. */
  syncMachines(
    machines: Map<number, MachineState>,
    svgs: Record<string, string>,
    powered: boolean,
  ): void {
    const now = gameNow() / 1000;
    for (const [id, view] of this.machineViews) {
      const m = machines.get(id);
      if (m) {
        view.update(m, svgs, powered);
        // A jammed machine puffs dark smoke now and then.
        if (m.jammed && view.smokeDue(now)) {
          const { centre, half } = machinePose(m.def);
          this.puff(v3(centre.x, centre.y + half.y, centre.z), 0x4a4a4a);
        }
      }
      view.tick(now);
    }
    this.operating.tick(now);
  }

  /** Shows a machine doing what a player just had it do (a brick works event). */
  machineAt(e: SimEvent): void {
    if (e.machineId === undefined) return;
    this.machineViews.get(e.machineId)?.play(e, gameNow() / 1000);
  }

  /**
   * Holds a brick works event a player's hands are to bring about until they get there and do
   * (see `Operating`), rather than showing it now; returns whether it was held. It comes back
   * from `heldEvents` when its time comes.
   */
  holdEvent(e: SimEvent): boolean {
    return this.operating.hold(e, gameNow() / 1000);
  }

  /** The held events whose time came since last asked (see `Operating.takeReleased`). */
  heldEvents(): Released[] {
    return this.operating.takeReleased();
  }

  private dropAvatar(v: {
    avatar: Avatar;
    ragdoll: Ragdoll | null;
    worn: Map<GearId, WornGear>;
  }): void {
    this.scene.remove(v.avatar.group);
    for (const worn of v.worn.values()) removeGear(worn);
    v.ragdoll?.dispose();
  }

  /** A small puff of dust where something happened that a sharp eye might notice. */
  puff(pos: Vec3, colour = 0xd8cfc0): void {
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Sprite(
        new THREE.SpriteMaterial({
          color: colour,
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
        }),
      );
      m.position.set(pos.x, pos.y, pos.z);
      m.scale.setScalar(0.08);
      const dir = new THREE.Vector3(random() - 0.5, random() * 0.8, random() - 0.5);
      m.userData = { vel: dir.multiplyScalar(1.2), life: 0.8 };
      this.effects.add(m);
    }
  }

  /** Moves and fades effects; call once per frame. */
  /** The catapult throws: the arm whips forward, hangs there, then creaks back down. */
  fireCatapult(): void {
    if (this.catapultArm) this.catapultSwing = 0;
  }

  updateEffects(dt: number): void {
    if (this.catapultArm && this.catapultSwing !== null) {
      this.catapultSwing += dt;
      const t = this.catapultSwing;
      const { rest, swing } = CATAPULT.arm;
      // Out in a quarter second, held for half, back over a second.
      const k =
        t < 0.25
          ? 1 - (1 - t / 0.25) ** 3
          : t < 0.75
            ? 1
            : t < 1.75
              ? 1 - ((t - 0.75) / 1) ** 2 * (3 - 2 * ((t - 0.75) / 1))
              : 0;
      this.catapultArm.rotation.x = rest - swing * k;
      if (t >= 1.75) this.catapultSwing = null;
    }
    for (const m of [...this.effects.children] as THREE.Sprite[]) {
      const d = m.userData as { vel: THREE.Vector3; life: number };
      d.life -= dt;
      if (d.life <= 0) {
        this.effects.remove(m);
        m.material.dispose();
        continue;
      }
      m.position.addScaledVector(d.vel, dt);
      m.scale.setScalar(0.08 + (0.8 - d.life) * 0.3);
      m.material.opacity = d.life;
    }
  }

  /** Forgets everything drawn for the old world; the next syncs rebuild it. */
  reset(): void {
    this.furniture.invalidate();
    for (const v of this.assemblyViews.values()) this.scene.remove(v.group);
    this.assemblyViews.clear();
    for (const m of this.pageMeshes.values()) this.scene.remove(m);
    this.pageMeshes.clear();
    for (const m of this.gearMeshes.values()) this.scene.remove(m);
    this.gearMeshes.clear();
    this.leashLine.line.visible = false;
    // The ragdolls' bodies went with the old world.
    for (const v of this.avatars.values()) {
      this.scene.remove(v.avatar.group);
      for (const worn of v.worn.values()) removeGear(worn);
      v.ragdoll?.group.removeFromParent();
    }
    this.avatars.clear();
    this.marks.group.clear();
    this.marks.report = null;
    this.marks.key = '';
    this.ghost.visible = false;
  }

  showGhost(preview: SnapPreview | null, held: Assembly | undefined): void {
    if (!preview || !held) {
      this.ghost.visible = false;
      return;
    }
    const meshes = this.ghost.children as THREE.Mesh[];
    while (meshes.length < preview.bricks.length) {
      this.ghost.add(new THREE.Mesh(brickGeometry('1x1'), this.ghostMaterial('white')));
    }
    meshes.forEach((m, i) => {
      const b = preview.bricks[i];
      const brick = b && held.grid.bricks.get(b.id);
      m.visible = !!brick;
      if (!b || !brick) return;
      m.geometry = brickGeometry(b.placement.type);
      m.material = this.ghostMaterial(brick.colour);
      // A printed part shows its print see-through too, so it can be turned the right way.
      const prints = brick.prints && this.printSvgs ? brick.prints : undefined;
      const key = prints ? `${b.placement.type}|${printKey(prints)}` : '';
      if (m.userData.prints !== key) {
        m.userData.prints = key;
        m.clear();
        if (prints) addPrints(m, b.placement.type, prints, this.printSvgs!, 'ghost');
      }
      m.position.set(b.pos.x, b.pos.y, b.pos.z);
      m.quaternion.set(b.rot.x, b.rot.y, b.rot.z, b.rot.w);
    });
    this.ghost.visible = true;
  }

  /** The see-through look of a brick where a held one would snap (the build editor's too). */
  ghostMaterial(colour: ColourId): THREE.MeshBasicMaterial {
    let m = this.ghostMaterials.get(colour);
    if (!m) {
      m = new THREE.MeshBasicMaterial({
        color: drawnHex(colour),
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      });
      this.ghostMaterials.set(colour, m);
    }
    return m;
  }

  /** Switches between day and night (a no-op if it already is that time). */
  setNight(night: boolean): void {
    if (night === this.night) return;
    this.night = night;
    this.applyTimeOfDay();
  }

  /** Switches the ceiling lamps with the power (a no-op if it already is so). */
  setPower(on: boolean): void {
    if (on === this.power) return;
    this.power = on;
    this.applyTimeOfDay();
  }

  /** Moves the electrical panels' status lights and sparks on by `dt` seconds. */
  animatePanel(dt: number, on: boolean, fixing: boolean): void {
    for (const panel of this.panels) panel.update(dt, on, fixing);
  }

  private applyTimeOfDay(): void {
    this.lit = true;
    // Lamps switched on or off change how many lights every program is compiled for.
    this.graphics.rewarm();
    if (this.studio) {
      (this.scene.background as THREE.Color).set(STUDIO.sky);
      this.hemi.color.set(STUDIO.hemiSky);
      this.hemi.groundColor.set(STUDIO.hemiGround);
      this.hemi.intensity = STUDIO.hemi;
      this.sun.color.set(STUDIO.sun);
      this.sun.intensity = STUDIO.sunIntensity;
      return;
    }
    setTimeOfDay(this.scene, this.hemi, this.sun, this.night, this.realLamps, this.power);
    // The lamps and glows go with the time of day; the light itself is car-test.html's.
    const look = this.night ? NIGHT : DAY;
    setStudio(look);
    setLights(look, {
      scene: this.scene,
      hemi: this.hemi,
      key: this.sun,
      fill: this.carStudio.fill,
    });
    this.graphics.grade = { ...look.grade };
    if (!this.level.scenery)
      this.sky.setTime(this.night, this.sun.position.clone().sub(this.sun.target.position));
  }

  /** Draws the frame: false, and nothing drawn, while its shaders compile (`Graphics.rewarm`). */
  render(): boolean {
    // Lit on the first frame, once the graphics settings are in.
    if (!this.lit) this.applyTimeOfDay();
    const sky = (this.sky.mesh.visible = !this.studio && !this.level.scenery);
    // Built the first time it shows: the build editor's map never draws it.
    // (A level drawn with the cars' models stands in their studio instead.)
    if (sky && !this.surroundings && !this.level.scenery) {
      this.surroundings = buildSurroundings(this.level);
      this.scene.add(this.surroundings);
      // The rocks standing out of the open sea, for its water to ring with foam.
      const rocks = (this.surroundings.userData[SEA_ROCKS] ?? []) as SeaRock[];
      this.levelRoot.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        for (const x of Array.isArray(m) ? m : m ? [m] : [])
          if (x.userData[SHORE_MAP]) setSeaRocks(x, rocks);
      });
    }
    if (this.surroundings) this.surroundings.visible = sky;
    return this.graphics.render();
  }
}

const artKeys = new WeakMap<object, string>();
/** A cached identity for what is printed on a page, so it is not re-serialised every frame. */
function artKey(printed: object | null): string {
  if (!printed) return '';
  let k = artKeys.get(printed);
  if (k === undefined) artKeys.set(printed, (k = JSON.stringify(printed)));
  return k;
}

let speakerTexture: THREE.CanvasTexture | null = null;

/** A speaker with sound waves, shared by every talking player's icon. */
function speakerIcon(): THREE.CanvasTexture {
  if (speakerTexture) return speakerTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(20, 22, 28, 0.75)';
  g.beginPath();
  g.arc(32, 32, 30, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#7dff8f';
  g.beginPath();
  g.moveTo(14, 26);
  g.lineTo(22, 26);
  g.lineTo(32, 17);
  g.lineTo(32, 47);
  g.lineTo(22, 38);
  g.lineTo(14, 38);
  g.closePath();
  g.fill();
  g.strokeStyle = '#7dff8f';
  g.lineWidth = 4;
  g.lineCap = 'round';
  for (const r of [8, 15]) {
    g.beginPath();
    g.arc(34, 32, r, -0.9, 0.9);
    g.stroke();
  }
  speakerTexture = new THREE.CanvasTexture(c);
  speakerTexture.colorSpace = THREE.SRGBColorSpace;
  return speakerTexture;
}

function nameTag(name: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = 'bold 30px system-ui, sans-serif';
  const w = Math.min(248, g.measureText(name).width + 24);
  g.fillStyle = 'rgba(20, 22, 28, 0.7)';
  g.beginPath();
  g.roundRect((256 - w) / 2, 8, w, 46, 12);
  g.fill();
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, 128, 32, 236);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false }));
  sprite.scale.set(1, 0.25, 1);
  sprite.position.y = PLAYER_FEET + 0.35;
  return sprite;
}
