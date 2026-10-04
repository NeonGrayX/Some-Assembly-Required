import * as THREE from 'three';
import { BIN_SIZE, COLOURS, PLAYER_HALF_HEIGHT, PLAYER_RADIUS, localCentre } from '@sar/shared';
import type { Assembly, LevelDef, Player, SnapPreview } from '@sar/shared';
import { brickGeometry, brickMaterial } from './bricks.ts';

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
          const mesh = new THREE.Mesh(brickGeometry(b.type), brickMaterial(b.colour));
          const c = localCentre(b);
          mesh.position.set(c.x, c.y, c.z);
          mesh.rotation.y = (b.rot * Math.PI) / 2;
          mesh.castShadow = mesh.receiveShadow = true;
          v.group.add(mesh);
        }
        v.version = a.version;
      }
      const t = a.body.translation();
      const r = a.body.rotation();
      v.group.position.set(t.x, t.y, t.z);
      v.group.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  syncPlayers(players: Map<number, Player>, localId: number, firstPerson: boolean): void {
    for (const p of players.values()) {
      let avatar = this.avatars.get(p.id);
      if (!avatar) {
        avatar = makeAvatar(p.id === localId ? 0xf07d1a : 0x1e5bc6);
        this.scene.add(avatar);
        this.avatars.set(p.id, avatar);
      }
      const t = p.body.translation();
      avatar.position.set(t.x, t.y, t.z);
      avatar.rotation.y = p.input.yaw;
      avatar.visible = !(p.id === localId && firstPerson);
    }
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

function makeAvatar(colour: number): THREE.Group {
  const g = new THREE.Group();
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
