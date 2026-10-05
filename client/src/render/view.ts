import * as THREE from 'three';
import {
  BIN_SIZE,
  BRICK_TYPES,
  COLOURS,
  PAGE_SIZE,
  PLAYER_HALF_HEIGHT,
  PLAYER_RADIUS,
  TICK_RATE,
  viewDir,
} from '@sar/shared';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { RigidBody, World } from '@dimforge/rapier3d-compat';
import type {
  Assembly,
  Dog,
  Quat,
  Vec3,
  InspectionReport,
  InspectorState,
  LevelDef,
  PageItem,
  Player,
  SnapPreview,
  TargetBuild,
} from '@sar/shared';
import { GET_UP_SECONDS, Ragdoll, animateAvatar, makeAvatar } from './avatar.ts';
import type { Avatar } from './avatar.ts';
import { baseplateMarker, brickGeometry, brickMaterial } from './bricks.ts';
import { DogView } from './dog.ts';
import {
  HOUSE_WINDOWS,
  addHouseDetails,
  cutWindows,
  rectMinusHoles,
  windowOpenings,
} from './details.ts';
import type { Rect, WindowOpening } from './details.ts';
import { Furniture, lightIndoors } from './furniture.ts';
import { makeProp } from './props.ts';
import { makeBell, makeDoneButton } from './stations.ts';
import { KEEP_SEPARATE, mergeStatic } from './merge.ts';
import { addBrickMesh, addShell } from './pages.ts';

interface AssemblyView {
  group: THREE.Group;
  version: number;
}

/** Height of the tallest things that cast or catch the sun's shadow (roof, ledge, builds). */
const SHADOW_TOP = 6;

/**
 * Sizes the sun's shadow to the whole level as the sun sees it. The sun shines in at a slant, so
 * a square the size of the floor misses the far corners, and anything outside the shadow is
 * drawn in full sun: the kitchen's west end, fridge and all, was lit as if it had no roof.
 */
function fitShadow(sun: THREE.DirectionalLight, level: LevelDef): void {
  const cam = sun.shadow.camera;
  cam.position.copy(sun.position);
  cam.lookAt(sun.target.position);
  cam.updateMatrixWorld();
  const toLight = cam.matrixWorldInverse;
  const half = level.floorSize / 2 + 1;
  const box = new THREE.Box3();
  for (const x of [-half, half])
    for (const y of [0, SHADOW_TOP])
      for (const z of [-half, half])
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

/** How far the room shade reaches into the walls: half a wall's thickness. */
const SHADE_PAD = 0.1;

/**
 * Keeps the sun out of the roofed rooms, except through their windows. Thin walls and roof only
 * cast shadows from their far sides, so where a wall meets the roof or another wall the sun
 * leaked in as bright lines. Each room gets a box filling it, seen only by the shadow and
 * casting from its sunward faces, which shades everything inside. A room is a floor decal with
 * a box over it. The box is open where the window holes are, so the sun shines in there alone:
 * it is convex, so a ray into the room crosses one sunward face, and only the hole lets it by.
 */
function roomShade(level: LevelDef, openings: WindowOpening[]): THREE.Group {
  const group = new THREE.Group();
  // Drawn into the shadow only: it writes nothing to the screen.
  const material = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
    shadowSide: THREE.FrontSide,
  });
  for (const d of level.decals) {
    // The lowest box over the room's middle is its ceiling.
    let roof: { bottom: number; thickness: number } | null = null;
    for (const b of level.boxes) {
      const bottom = b.pos.y - b.size.y / 2;
      if (
        bottom > 1.5 &&
        (!roof || bottom < roof.bottom) &&
        Math.abs(d.pos.x - b.pos.x) <= b.size.x / 2 &&
        Math.abs(d.pos.z - b.pos.z) <= b.size.z / 2
      )
        roof = { bottom, thickness: b.size.y };
    }
    if (!roof) continue;
    // Reaching halfway into the walls and the roof, so no seam is left on the edge of the box.
    const top = roof.bottom + roof.thickness / 2;
    const min = new THREE.Vector3(
      d.pos.x - d.size.x / 2 - SHADE_PAD,
      0,
      d.pos.z - d.size.z / 2 - SHADE_PAD,
    );
    const max = new THREE.Vector3(
      d.pos.x + d.size.x / 2 + SHADE_PAD,
      top,
      d.pos.z + d.size.z / 2 + SHADE_PAD,
    );
    const shade = new THREE.Mesh(shadeGeometry(min, max, openings), material);
    shade.castShadow = true;
    group.add(shade);
  }
  group.userData[KEEP_SEPARATE] = true;
  return group;
}

/**
 * The faces of the box from `min` to `max`, facing out, less the bottom (the sun never sees
 * it) and less the window holes in the walls the sides run along.
 */
function shadeGeometry(
  min: THREE.Vector3,
  max: THREE.Vector3,
  openings: WindowOpening[],
): THREE.BufferGeometry {
  const positions: number[] = [];
  // Axis 0 is x, 1 is y, 2 is z. A face lies across `axis` at `at`, facing `sign`; its rect's
  // u runs along axis `ua` and v along axis `va`.
  const face = (axis: number, at: number, sign: number, ua: number, va: number, rect: Rect) => {
    const holes = openings
      .filter(
        (o) =>
          axis !== 1 &&
          (o.alongX ? axis === 2 : axis === 0) &&
          Math.abs(o.centre - at) < o.thickness,
      )
      .map((o) => ({ u0: o.from, u1: o.to, v0: o.bottom, v1: o.top }));
    for (const r of rectMinusHoles(rect, holes)) {
      const corner = (u: number, v: number) => {
        const p = [0, 0, 0];
        p[axis] = at;
        p[ua] = u;
        p[va] = v;
        return p;
      };
      const [a, b, c, e] = [
        corner(r.u0, r.v0),
        corner(r.u1, r.v0),
        corner(r.u1, r.v1),
        corner(r.u0, r.v1),
      ];
      // Wind the quad so it faces out: (b - a) x (c - a) points along `sign` on `axis`.
      const n = new THREE.Vector3()
        .subVectors(new THREE.Vector3(...b), new THREE.Vector3(...a))
        .cross(new THREE.Vector3().subVectors(new THREE.Vector3(...c), new THREE.Vector3(...a)));
      const out = n.getComponent(axis) * sign > 0;
      positions.push(
        ...(out ? [...a, ...b, ...c, ...a, ...c, ...e] : [...a, ...c, ...b, ...a, ...e, ...c]),
      );
    }
  };
  const xRect = { u0: min.z, u1: max.z, v0: min.y, v1: max.y };
  const zRect = { u0: min.x, u1: max.x, v0: min.y, v1: max.y };
  face(0, min.x, -1, 2, 1, xRect);
  face(0, max.x, 1, 2, 1, xRect);
  face(2, min.z, -1, 0, 1, zRect);
  face(2, max.z, 1, 0, 1, zRect);
  face(1, max.y, 1, 0, 2, { u0: min.x, u1: max.x, v0: min.z, v1: max.z });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Everything drawn on screen. Reads the simulation, never changes it. */
export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
  private readonly assemblyViews = new Map<number, AssemblyView>();
  /**
   * Where to draw a body this frame. The game sets this to blend between the last two physics
   * steps, so motion stays smooth on screens that refresh faster or less evenly than 60 Hz.
   */
  poseOf: (body: RigidBody) => { pos: Vec3; rot: Quat } = (b) => ({
    pos: b.translation(),
    rot: b.rotation(),
  });
  private readonly pageMeshes = new Map<number, THREE.Mesh>();
  private readonly effects = new THREE.Group();
  furniture!: Furniture;
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
  private inspectorScreen!: {
    canvas: HTMLCanvasElement;
    texture: THREE.CanvasTexture;
    text: string;
  };
  private readonly dog = new DogView();
  private readonly avatars = new Map<
    number,
    { avatar: Avatar; key: string; ragdoll: Ragdoll | null; knocks: number }
  >();
  private readonly ghost: THREE.Mesh;
  private readonly ghostMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });

  constructor(container: HTMLElement, level: LevelDef) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    window.addEventListener('resize', () => this.resize());
    this.resize();

    this.scene.background = new THREE.Color(0x9fc9e8);
    this.scene.fog = new THREE.Fog(0x9fc9e8, 25, 60);
    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x6b5b45, 1.4));
    const sun = new THREE.DirectionalLight(0xfff3dd, 2.2);
    // Low enough in the sky to shine well into the rooms through the windows.
    sun.position.set(10, 8, 7.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    fitShadow(sun, level);
    const openings = windowOpenings(level, HOUSE_WINDOWS);
    this.scene.add(roomShade(level, openings));
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);

    this.buildLevel(level, openings);
    this.scene.add(this.marks.group, this.effects, this.dog.group);

    this.ghost = new THREE.Mesh(brickGeometry('1x1'), this.ghostMaterial);
    this.ghost.visible = false;
    this.scene.add(this.ghost);
  }

  private resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  private buildLevel(level: LevelDef, openings: WindowOpening[]): void {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(level.floorSize, level.floorSize),
      new THREE.MeshStandardMaterial({ color: 0xc9b48f, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(level.floorSize, level.floorSize, 0x000000, 0x000000);
    (grid.material as THREE.Material).opacity = 0.06;
    (grid.material as THREE.Material).transparent = true;
    grid.position.y = 0.001;
    this.scene.add(grid);

    for (const box of level.boxes) {
      const prop = makeProp(box, level);
      if (prop) {
        this.scene.add(prop);
        continue;
      }
      // Walls with windows are drawn as the pieces left around the holes.
      for (const piece of cutWindows(box, openings)) {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(piece.size.x, piece.size.y, piece.size.z),
          new THREE.MeshStandardMaterial({ color: piece.colour, roughness: 0.8 }),
        );
        mesh.position.set(piece.pos.x, piece.pos.y, piece.pos.z);
        mesh.rotation.x = piece.tiltX ?? 0;
        mesh.castShadow = mesh.receiveShadow = true;
        this.scene.add(mesh);
      }
    }

    for (const bin of level.bins) {
      const group = new THREE.Group();
      group.position.set(bin.pos.x, bin.pos.y, bin.pos.z);
      const tub = new THREE.Mesh(
        new THREE.BoxGeometry(BIN_SIZE.x, BIN_SIZE.y, BIN_SIZE.z),
        new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.7 }),
      );
      tub.position.y = BIN_SIZE.y / 2;
      tub.castShadow = tub.receiveShadow = true;
      group.add(tub);
      // A few sample bricks on top show what the bin holds.
      for (let i = 0; i < 3; i++) {
        const sample = new THREE.Mesh(brickGeometry(bin.type), brickMaterial(bin.colour));
        sample.position.set((i - 1) * 0.2, BIN_SIZE.y + 0.06, (i % 2) * 0.15 - 0.07);
        sample.rotation.y = i * 0.9;
        sample.castShadow = true;
        group.add(sample);
      }
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(BIN_SIZE.x + 0.01, 0.08, BIN_SIZE.z + 0.01),
        new THREE.MeshStandardMaterial({ color: COLOURS[bin.colour].hex }),
      );
      stripe.position.y = BIN_SIZE.y - 0.08;
      group.add(stripe);
      this.scene.add(group);
    }

    const yellow = new THREE.MeshStandardMaterial({ color: 0xf5c518, roughness: 0.6 });
    const frame = (cx: number, cz: number, w: number, d: number, thick = 0.08) => {
      for (const [x, z, sx, sz] of [
        [cx, cz - d / 2, w, thick],
        [cx, cz + d / 2, w, thick],
        [cx - w / 2, cz, thick, d],
        [cx + w / 2, cz, thick, d],
      ] as const) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.006, sz), yellow);
        m.position.set(x, 0.003, z);
        m.receiveShadow = true;
        this.scene.add(m);
      }
    };
    this.furniture = new Furniture(this.scene, level);
    addHouseDetails(this.scene, level, HOUSE_WINDOWS);

    // Job site outline around the baseplate.
    const bp = level.baseplate;
    frame(bp.x + 0.8, bp.z + 0.8, 2.6, 2.6);

    // The Done button and the meeting bell.
    this.scene.add(makeDoneButton(level.doneButton), makeBell(level.bell));

    // Quality inspector: a pad on the floor and a screen behind it.
    const ins = level.inspector;
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(ins.size.x, 0.008, ins.size.z),
      new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.8 }),
    );
    pad.position.set(ins.pos.x, 0.004, ins.pos.z);
    pad.receiveShadow = true;
    this.scene.add(pad);
    frame(ins.pos.x, ins.pos.z, ins.size.x, ins.size.z, 0.1);
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 768;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 1.35, 1.8),
      [0, 1, 2, 3, 4, 5].map((i) =>
        i === 0
          ? new THREE.MeshBasicMaterial({ map: texture })
          : new THREE.MeshStandardMaterial({ color: 0x3a3f47 }),
      ),
    );
    screen.position.set(ins.pos.x - ins.size.x / 2 - 0.3, 1.5, ins.pos.z);
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.9, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x3a3f47 }),
    );
    post.position.set(screen.position.x, 0.45, ins.pos.z);
    screen.castShadow = post.castShadow = true;
    this.scene.add(screen, post);
    this.inspectorScreen = { canvas, texture, text: '' };

    // The treat jar on the kitchen counter: glass with biscuits in it, and a lid.
    const jarAt = level.dog.treatJar;
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.16, 16),
      new THREE.MeshStandardMaterial({
        color: 0xd8eef5,
        roughness: 0.1,
        transparent: true,
        opacity: 0.45,
      }),
    );
    glass.position.set(jarAt.x, jarAt.y + 0.08, jarAt.z);
    const biscuits = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.09, 12),
      new THREE.MeshStandardMaterial({ color: 0xa0632e, roughness: 0.9 }),
    );
    biscuits.position.set(jarAt.x, jarAt.y + 0.05, jarAt.z);
    const lid = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 0.03, 16),
      new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5 }),
    );
    lid.position.set(jarAt.x, jarAt.y + 0.175, jarAt.z);
    this.scene.add(glass, biscuits, lid);

    lightIndoors(this.scene, level);
    // Nothing above moves (apart from the hiding places' doors), so draw it in a few calls.
    mergeStatic(this.scene);
  }

  /** Redraws the inspector's screen when what it says changes. */
  showInspector(state: InspectorState, build: TargetBuild): void {
    const pct = Math.round(state.progress * 100);
    const key = `${state.status}|${pct}|${state.scannedVersion}`;
    const s = this.inspectorScreen;
    if (s.text === key) return;
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
          if (b) addShell(this.marks.group, b, f.kind === 'close' ? 0xff9f0a : 0xff3b30);
        }
        for (const t of report.ghosts) {
          if (build.grid.brickAt(t.x, t.y, t.z) === undefined) {
            addBrickMesh(this.marks.group, t, this.ghostMarkMaterial).castShadow = false;
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
      const key = artKey(page.printed);
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

  /** Adds, removes and moves meshes to match the simulation's assemblies. */
  syncAssemblies(assemblies: Map<number, Assembly>): void {
    for (const [id, v] of this.assemblyViews) {
      if (!assemblies.has(id)) {
        this.scene.remove(v.group);
        this.assemblyViews.delete(id);
      }
    }
    for (const a of assemblies.values()) {
      let v = this.assemblyViews.get(a.id);
      if (!v) {
        v = { group: new THREE.Group(), version: -1 };
        this.scene.add(v.group);
        this.assemblyViews.set(a.id, v);
      }
      if (v.version !== a.version) {
        v.group.clear();
        for (const b of a.grid.bricks.values()) {
          addBrickMesh(v.group, b, brickMaterial(b.colour));
          if (BRICK_TYPES[b.type].fixture) v.group.add(baseplateMarker());
        }
        v.version = a.version;
      }
      const { pos: t, rot: r } = this.poseOf(a.body);
      v.group.position.set(t.x, t.y, t.z);
      v.group.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  /**
   * Draws every player in their lobby colour, with a name tag over everyone but yourself.
   * Avatars are rebuilt if a player's colour or name changes.
   */
  /**
   * Draws every player. Someone knocked over becomes a ragdoll in the client's world (made
   * when their knock count goes up) until they are back on their feet.
   */
  syncPlayers(
    players: Map<number, Player>,
    localId: number,
    firstPerson: boolean,
    look: (id: number) => { colour: number; name: string },
    physics: { R: typeof RAPIER; world: World },
    dt: number,
  ): void {
    for (const [id, v] of this.avatars) {
      if (!players.has(id)) {
        this.dropAvatar(v);
        this.avatars.delete(id);
      }
    }
    for (const p of players.values()) {
      const { colour, name } = look(p.id);
      const key = `${colour}|${name}`;
      let v = this.avatars.get(p.id);
      if (v && v.key !== key) {
        this.dropAvatar(v);
        v = undefined;
      }
      if (!v) {
        const avatar = makeAvatar(colour, p.id === localId ? null : nameTag(name));
        this.scene.add(avatar.group);
        v = { avatar, key, ragdoll: null, knocks: p.knocks };
        this.avatars.set(p.id, v);
      }
      const t = this.poseOf(p.body).pos;
      const g = v.avatar.group;
      g.position.set(t.x, t.y, t.z);
      g.rotation.y = p.input.yaw;
      // Down: a ragdoll. For the last moments of it the player gets back up, and then the
      // standing avatar takes over exactly where the ragdoll's parts ended up.
      const getUpTicks = GET_UP_SECONDS * TICK_RATE;
      if (p.down > getUpTicks && !v.ragdoll && (p.knocks !== v.knocks || p.down > 30)) {
        const fall = viewDir(p.input.yaw, 0);
        v.ragdoll = new Ragdoll(physics.R, physics.world, v.avatar, fall);
        this.scene.add(v.ragdoll.group);
      } else if (v.ragdoll && !v.ragdoll.standing) {
        // Back on their feet without getting up (moved to a meeting): no animation.
        if (p.down === 0) {
          v.ragdoll.dispose();
          v.ragdoll = null;
          v.avatar.last = null;
        } else if (p.down <= getUpTicks) v.ragdoll.standUp();
      }
      v.knocks = p.knocks;
      animateAvatar(
        v.avatar,
        {
          limping: p.limp > 0,
          carrying: p.holding !== null || p.treat,
          careful: p.input.careful,
        },
        dt,
      );
      v.avatar.treat.visible = p.treat;
      if (v.ragdoll?.standing) {
        g.updateMatrixWorld(true);
        if (v.ragdoll.updateGetUp(dt)) {
          v.ragdoll.dispose();
          v.ragdoll = null;
        }
      } else v.ragdoll?.sync();
      g.visible = !v.ragdoll && !(p.id === localId && firstPerson);
    }
  }

  /** Poses the dog; call every frame. */
  syncDog(dog: Dog, dt: number, time: number): void {
    this.dog.update(dog, this.poseOf(dog.body).pos, dt, time);
  }

  /** Where the camera should look while the given player lies on the ground, if they do. */
  ragdollFocus(id: number): Vec3 | null {
    return this.avatars.get(id)?.ragdoll?.focus ?? null;
  }

  private dropAvatar(v: { avatar: Avatar; ragdoll: Ragdoll | null }): void {
    this.scene.remove(v.avatar.group);
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
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5);
      m.userData = { vel: dir.multiplyScalar(1.2), life: 0.8 };
      this.effects.add(m);
    }
  }

  /** Moves and fades effects; call once per frame. */
  updateEffects(dt: number): void {
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
    // The ragdolls' bodies went with the old world.
    for (const v of this.avatars.values()) {
      this.scene.remove(v.avatar.group);
      v.ragdoll?.group.removeFromParent();
    }
    this.avatars.clear();
    this.marks.group.clear();
    this.marks.report = null;
    this.marks.key = '';
    this.ghost.visible = false;
  }

  showGhost(preview: SnapPreview | null, held: Assembly | undefined): void {
    const brick = held?.grid.size === 1 ? held.grid.bricks.values().next().value : undefined;
    if (!preview || !brick) {
      this.ghost.visible = false;
      return;
    }
    this.ghost.geometry = brickGeometry(brick.type);
    this.ghostMaterial.color.setHex(COLOURS[brick.colour].hex);
    this.ghost.position.set(preview.pos.x, preview.pos.y, preview.pos.z);
    this.ghost.quaternion.set(preview.rot.x, preview.rot.y, preview.rot.z, preview.rot.w);
    this.ghost.visible = true;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
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
  sprite.position.y = PLAYER_HALF_HEIGHT + PLAYER_RADIUS + 0.35;
  return sprite;
}
