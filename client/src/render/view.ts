import * as THREE from 'three';
import {
  BIN_SIZE,
  BRICK_TYPES,
  BUTTON_SIZE,
  COLOURS,
  PAGE_SIZE,
  PLAYER_HALF_HEIGHT,
  PLAYER_RADIUS,
} from '@sar/shared';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import type {
  Assembly,
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
import { baseplateMarker, brickGeometry, brickMaterial } from './bricks.ts';
import { Furniture, lightIndoors } from './furniture.ts';
import { mergeStatic } from './merge.ts';
import { addBrickMesh, addShell } from './pages.ts';

interface AssemblyView {
  group: THREE.Group;
  version: number;
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
  private readonly avatars = new Map<number, THREE.Group>();
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
    sun.position.set(8, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = level.floorSize / 2 + 1;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 50 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);

    this.buildLevel(level);
    this.scene.add(this.marks.group, this.effects);

    this.ghost = new THREE.Mesh(brickGeometry('1x1'), this.ghostMaterial);
    this.ghost.visible = false;
    this.scene.add(this.ghost);
  }

  private resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  private buildLevel(level: LevelDef): void {
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
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(box.size.x, box.size.y, box.size.z),
        new THREE.MeshStandardMaterial({ color: box.colour, roughness: 0.8 }),
      );
      mesh.position.set(box.pos.x, box.pos.y, box.pos.z);
      mesh.rotation.x = box.tiltX ?? 0;
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);
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

    // Job site outline around the baseplate.
    const bp = level.baseplate;
    frame(bp.x + 0.8, bp.z + 0.8, 2.6, 2.6);

    // Done button: a pedestal with a big red button and a label.
    const btn = level.doneButton;
    const pedestal = new THREE.Mesh(
      new THREE.BoxGeometry(BUTTON_SIZE.x, BUTTON_SIZE.y, BUTTON_SIZE.z),
      [0, 1, 2, 3, 4, 5].map((i) =>
        i === 4
          ? new THREE.MeshStandardMaterial({ map: labelTexture('DONE', '#c91a1a') })
          : new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.7 }),
      ),
    );
    pedestal.position.set(btn.x, btn.y + BUTTON_SIZE.y / 2, btn.z);
    pedestal.castShadow = true;
    const knob = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.15, 0.08, 24),
      new THREE.MeshStandardMaterial({ color: 0xc91a1a, roughness: 0.3 }),
    );
    knob.position.set(btn.x, btn.y + BUTTON_SIZE.y + 0.04, btn.z);
    knob.castShadow = true;
    this.scene.add(pedestal, knob);

    // Meeting bell: a post with a brass bell on a sign.
    const bell = level.bell;
    const bellPost = new THREE.Mesh(
      new THREE.BoxGeometry(BUTTON_SIZE.x, BUTTON_SIZE.y, BUTTON_SIZE.z),
      [0, 1, 2, 3, 4, 5].map((i) =>
        i === 4
          ? new THREE.MeshStandardMaterial({ map: labelTexture('MEETING', '#1e5bc6') })
          : new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.7 }),
      ),
    );
    bellPost.position.set(bell.x, bell.y + BUTTON_SIZE.y / 2, bell.z);
    bellPost.castShadow = true;
    const brass = new THREE.MeshStandardMaterial({
      color: 0xd4a017,
      metalness: 0.7,
      roughness: 0.3,
    });
    const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.17, 0.2, 24, 1, true), brass);
    dome.position.set(bell.x, bell.y + BUTTON_SIZE.y + 0.12, bell.z);
    const bellKnob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), brass);
    bellKnob.position.set(bell.x, bell.y + BUTTON_SIZE.y + 0.24, bell.z);
    dome.castShadow = true;
    this.scene.add(bellPost, dome, bellKnob);

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
  syncPlayers(
    players: Map<number, Player>,
    localId: number,
    firstPerson: boolean,
    look: (id: number) => { colour: number; name: string },
  ): void {
    for (const [id, avatar] of this.avatars) {
      if (!players.has(id)) {
        this.scene.remove(avatar);
        this.avatars.delete(id);
      }
    }
    for (const p of players.values()) {
      const { colour, name } = look(p.id);
      const key = `${colour}|${name}`;
      let avatar = this.avatars.get(p.id);
      if (avatar && avatar.userData.key !== key) {
        this.scene.remove(avatar);
        avatar = undefined;
      }
      if (!avatar) {
        avatar = makeAvatar(colour, p.id === localId ? null : name);
        avatar.userData.key = key;
        this.scene.add(avatar);
        this.avatars.set(p.id, avatar);
      }
      const t = this.poseOf(p.body).pos;
      avatar.position.set(t.x, t.y, t.z);
      avatar.rotation.y = p.input.yaw;
      avatar.visible = !(p.id === localId && firstPerson);
    }
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
    for (const a of this.avatars.values()) this.scene.remove(a);
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

function labelTexture(text: string, colour: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3a3f47';
  g.fillRect(0, 0, 128, 256);
  g.fillStyle = colour;
  g.fillRect(10, 30, 108, 56);
  g.fillStyle = '#ffffff';
  g.font = 'bold 34px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText(text, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
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

function makeAvatar(colour: number, name: string | null): THREE.Group {
  const g = new THREE.Group();
  if (name) g.add(nameTag(name));
  const mat = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.6 });
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_HALF_HEIGHT * 2, 6, 16),
    mat,
  );
  body.castShadow = true;
  g.add(body);
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.14, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.2 }),
  );
  visor.position.set(0, 0.55, -0.24);
  g.add(visor);
  const hat = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.32, 0.16, 16),
    new THREE.MeshStandardMaterial({ color: 0xf5c518, roughness: 0.5 }),
  );
  hat.position.y = PLAYER_HALF_HEIGHT + PLAYER_RADIUS + 0.02;
  hat.castShadow = true;
  g.add(hat);
  return g;
}
