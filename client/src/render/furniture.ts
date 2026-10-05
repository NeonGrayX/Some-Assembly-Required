import * as THREE from 'three';
import { KEEP_SEPARATE } from './merge.ts';
import {
  BIN_SIZE,
  BOARD_SIZE,
  DRAWER_TRAY,
  hasDoor,
  hideoutBody,
  hideoutPart,
  lidHeight,
  openSwing,
} from '@sar/shared';
import type { HideoutDef, HideoutState, LadderDef, LevelDef } from '@sar/shared';

const COLOURS: Record<HideoutDef['kind'], number> = {
  fridge: 0xeef1f2,
  locker: 0x5d6d7e,
  cabinet: 0x6b4a2f,
  drawer: 0xcdbfa6,
  cushion: 0x6c8bb0,
  rug: 0x9b3d3d,
  mailbox: 0xc0392b,
  toolbox: 0xb03a2e,
  chest: 0x8a5a33,
};
const RUG_COLOURS = [0x9b3d3d, 0x6a4c93, 0x3d7a6b];

const mat = (color: number, roughness = 0.7) =>
  new THREE.MeshStandardMaterial({ color, roughness });

function box(size: { x: number; y: number; z: number }, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** How a hiding place looks, and how it looks when opened. */
interface HideoutView {
  group: THREE.Group;
  setOpen(open: boolean): void;
}

/**
 * Builds one hiding place in its own frame: centred on `pos`, turned so local -z is its front.
 * The part that moves (door, drawer, lid, rug or cushion) is posed by `hideoutPart`, the same
 * boxes the simulation clicks on.
 */
function makeHideout(def: HideoutDef, rugIndex: number, swing: number): HideoutView {
  const group = new THREE.Group();
  group.position.set(def.pos.x, def.pos.y, def.pos.z);
  group.rotation.y = def.facing;
  const { x: w, y: h, z: d } = def.size;
  const colour =
    def.kind === 'rug' ? RUG_COLOURS[rugIndex % RUG_COLOURS.length]! : COLOURS[def.kind];
  const shut = hideoutPart(def, false);
  const soft = def.kind === 'rug' || def.kind === 'cushion';
  // Posed as a whole by `hideoutPart`; what it is made of is drawn in its own frame.
  const part = new THREE.Group();
  part.userData[KEEP_SEPARATE] = true;
  group.add(part);

  if (def.kind === 'drawer') {
    // The part spans the front and the tray behind it.
    const front = box(def.size, mat(colour));
    front.position.z = -DRAWER_TRAY / 2;
    part.add(front);
    const tray = box({ x: w * 0.9, y: h * 0.8, z: DRAWER_TRAY }, mat(0x8f8270));
    tray.position.z = d / 2;
    part.add(tray);
    const handle = box({ x: 0.2, y: 0.03, z: 0.03 }, mat(0x333333, 0.3));
    handle.position.z = -DRAWER_TRAY / 2 - d / 2 - 0.02;
    part.add(handle);
  } else {
    part.add(
      box(
        { x: shut.half.x * 2, y: shut.half.y * 2, z: shut.half.z * 2 },
        mat(colour, soft ? 0.95 : 0.4),
      ),
    );
  }
  if (hasDoor(def)) {
    const handle = box({ x: 0.03, y: Math.min(0.3, h * 0.4), z: 0.03 }, mat(0x333333, 0.3));
    handle.position.set(w / 2 - 0.06, 0, -0.03);
    part.add(handle);
  }
  if (def.kind === 'toolbox') addToolboxDetails(def, part, group);

  const still = hideoutBody(def);
  if (still) {
    const body = box(
      { x: still.half.x * 2, y: still.half.y * 2, z: still.half.z * 2 },
      mat(colour),
    );
    body.position.set(still.centre.x, still.centre.y, still.centre.z);
    group.add(body);
  }

  const setOpen = (open: boolean) => {
    const pose = hideoutPart(def, open, swing);
    part.position.set(pose.centre.x, pose.centre.y, pose.centre.z);
    part.quaternion.set(pose.rot.x, pose.rot.y, pose.rot.z, pose.rot.w);
    // A folded rug is shorter than a flat one.
    part.scale.set(pose.half.x / shut.half.x, pose.half.y / shut.half.y, pose.half.z / shut.half.z);
  };
  setOpen(false);
  return { group, setOpen };
}

/**
 * A carry handle and catches on the toolbox's lid (`lid`, posed by `hideoutPart`), and hinges
 * and latches on its box (`body`, the hiding place's own frame), all in dark metal.
 */
function addToolboxDetails(def: HideoutDef, lid: THREE.Group, body: THREE.Group): void {
  const { x: w, y: h, z: d } = def.size;
  const lidH = lidHeight(def);
  const metal = mat(0x2b2b2e, 0.35);
  const steel = mat(0xb8bcc2, 0.3);
  const top = lidH / 2;

  // Carry handle: two posts and a grip across the middle of the lid.
  const span = w * 0.5;
  const rise = 0.06;
  for (const side of [-1, 1]) {
    const post = box({ x: 0.025, y: rise, z: 0.025 }, metal);
    post.position.set((side * span) / 2, top + rise / 2, 0);
    lid.add(post);
  }
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, span + 0.025, 12), metal);
  grip.rotation.z = Math.PI / 2;
  grip.position.set(0, top + rise, 0);
  grip.castShadow = true;
  lid.add(grip);

  // A dark opening inside the rim, only seen with the lid up.
  const seam = h / 2 - lidH;
  const inside = box({ x: w - 0.04, y: 0.004, z: d - 0.04 }, mat(0x2a1512, 0.9));
  inside.position.y = seam + 0.002;
  body.add(inside);

  // Hinges along the back seam, and latches holding the front of the lid down.
  for (const side of [-1, 1]) {
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 10), steel);
    hinge.rotation.z = Math.PI / 2;
    hinge.position.set(side * w * 0.3, seam, d / 2 + 0.006);
    body.add(hinge);

    const latch = box({ x: 0.05, y: 0.06, z: 0.012 }, steel);
    latch.position.set(side * w * 0.3, seam - 0.02, -d / 2 - 0.006);
    body.add(latch);
    const keeper = box({ x: 0.05, y: lidH * 0.6, z: 0.012 }, steel);
    keeper.position.set(side * w * 0.3, 0, -d / 2 - 0.006);
    lid.add(keeper);
  }
}

function makeLadder(l: LadderDef): THREE.Group {
  const g = new THREE.Group();
  g.position.set(l.pos.x, l.pos.y, l.pos.z);
  g.rotation.y = l.facing;
  const wood = mat(0x8a6a44);
  const top = l.height - 0.6;
  for (const side of [-1, 1]) {
    const rail = box({ x: 0.06, y: top, z: 0.06 }, wood);
    rail.position.set((side * l.width) / 2, top / 2, 0);
    g.add(rail);
  }
  for (let y = 0.3; y < top; y += 0.3) {
    const rung = box({ x: l.width, y: 0.04, z: 0.04 }, wood);
    rung.position.y = y;
    g.add(rung);
  }
  return g;
}

function makeBoard(level: LevelDef): THREE.Group {
  const g = new THREE.Group();
  const b = level.board;
  g.position.set(b.pos.x, b.pos.y, b.pos.z);
  g.rotation.y = b.facing;
  g.add(box(BOARD_SIZE, mat(0xb8875a, 0.95)));
  const frame = mat(0x5b3f28);
  for (const [x, y, sx, sy] of [
    [0, BOARD_SIZE.y / 2, BOARD_SIZE.x + 0.08, 0.06],
    [0, -BOARD_SIZE.y / 2, BOARD_SIZE.x + 0.08, 0.06],
    [-BOARD_SIZE.x / 2, 0, 0.06, BOARD_SIZE.y],
    [BOARD_SIZE.x / 2, 0, 0.06, BOARD_SIZE.y],
  ] as const) {
    const m = box({ x: sx, y: sy, z: 0.09 }, frame);
    m.position.set(x, y, 0);
    g.add(m);
  }
  for (const side of [-1, 1]) {
    const leg = box({ x: 0.06, y: b.pos.y, z: 0.06 }, frame);
    leg.position.set((side * (BOARD_SIZE.x - 0.1)) / 2, -b.pos.y / 2, 0.05);
    g.add(leg);
  }
  return g;
}

function stockLabel(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 48;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(20, 22, 28, 0.75)';
  g.beginPath();
  g.roundRect(4, 4, 120, 40, 10);
  g.fill();
  g.fillStyle = text === 'empty' ? '#ff7a6e' : '#ffffff';
  g.font = 'bold 24px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 25);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false }));
  s.scale.set(0.6, 0.22, 1);
  return s;
}

const LAMP_GLOW = 0xffe2b0;
let glowTexture: THREE.CanvasTexture | null = null;

/** A soft warm spot, bright in the middle and gone at the edge, shared by every lamp. */
function glow(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255, 236, 200, 1)');
  r.addColorStop(0.3, 'rgba(255, 220, 170, 0.4)');
  r.addColorStop(0.65, 'rgba(255, 210, 160, 0.08)');
  r.addColorStop(0.9, 'rgba(255, 210, 160, 0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

const glowMaterial = (opacity: number) => ({
  map: glow(),
  color: LAMP_GLOW,
  transparent: true,
  opacity,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

/**
 * A ceiling lamp hanging with its glowing diffuser at `at`. It gives off no light of its own:
 * the diffuser glows, a halo around it and a warm pool on the floor below fake the rest, which
 * costs a few cheap draws instead of shading every surface in the level for each lamp.
 */
function makeLamp(at: { x: number; y: number; z: number }): THREE.Group {
  const g = new THREE.Group();
  g.position.set(at.x, at.y, at.z);
  // Cord up into the ceiling (the house's ceiling is 0.3 above the lamps).
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 6), mat(0x2b2b2b));
  cord.position.y = 0.24;
  // Shade open at the bottom, with the glowing diffuser just inside its rim.
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.3, 0.2, 20, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x3c4a3f, roughness: 0.5, side: THREE.DoubleSide }),
  );
  shade.position.y = 0.1;
  shade.castShadow = true;
  const diffuser = new THREE.Mesh(
    new THREE.CircleGeometry(0.28, 20),
    new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: LAMP_GLOW,
      emissiveIntensity: 1.6,
    }),
  );
  diffuser.rotation.x = Math.PI / 2;
  diffuser.position.y = 0.02;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial(glowMaterial(0.55)));
  halo.scale.setScalar(1.1);
  halo.position.y = -0.08;
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 5),
    new THREE.MeshBasicMaterial(glowMaterial(0.3)),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.008 - at.y;
  // Light thrown back off the ceiling around the shade.
  const bounce = new THREE.Mesh(
    new THREE.PlaneGeometry(3.5, 3.5),
    new THREE.MeshBasicMaterial(glowMaterial(0.2)),
  );
  bounce.rotation.x = Math.PI / 2;
  bounce.position.y = 0.29;
  g.add(cord, shade, diffuser, halo, pool, bounce);
  return g;
}

/** How far a lamp's light reaches across its room, and above it. */
const LAMP_REACH = { x: 4.1, z: 4.6, up: 0.6 };
/** How much of a surface's own colour the lamps add to it, warmed by the lamp colour. */
const LAMP_FILL = 0.35;

/**
 * Brightens everything in the lamps' rooms as if lit by them, by giving it a little of its own
 * colour as emissive. It is baked into the materials once, so it costs nothing per frame, and
 * `mergeStatic` still merges the surfaces (one extra merged mesh per colour indoors).
 */
export function lightIndoors(root: THREE.Object3D, level: LevelDef): void {
  root.updateMatrixWorld(true);
  const warm = new THREE.Color(LAMP_GLOW).multiplyScalar(LAMP_FILL);
  const box = new THREE.Box3();
  const centre = new THREE.Vector3();
  const lit = (p: THREE.Vector3) =>
    level.lights.some(
      (l) =>
        Math.abs(p.x - l.x) <= LAMP_REACH.x &&
        Math.abs(p.z - l.z) <= LAMP_REACH.z &&
        p.y <= l.y + LAMP_REACH.up,
    );
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshStandardMaterial)) return;
    const m = o.material;
    // Leave see-through things and anything already glowing (the lamps) as they are.
    if (m.transparent || m.emissive.getHex() !== 0) return;
    if (!lit(box.setFromObject(o).getCenter(centre))) return;
    o.material = m.clone();
    o.material.emissive.copy(m.color).multiply(warm);
  });
}

/** The house's furniture that changes: hiding places opening, bins running low. */
export class Furniture {
  private readonly hideouts = new Map<number, HideoutView>();
  private readonly labels = new Map<number, THREE.Sprite>();
  private shownVersion = -1;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly level: LevelDef,
  ) {
    let rugs = 0;
    for (const def of level.hideouts) {
      const v = makeHideout(def, def.kind === 'rug' ? rugs++ : 0, openSwing(level, def));
      scene.add(v.group);
      this.hideouts.set(def.id, v);
    }
    for (const l of level.ladders) scene.add(makeLadder(l));
    scene.add(makeBoard(level));
    for (const d of level.decals) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(d.size.x, d.size.z), mat(d.colour, 0.85));
      m.rotation.x = -Math.PI / 2;
      m.position.set(d.pos.x, d.pos.y + 0.004, d.pos.z);
      m.receiveShadow = true;
      scene.add(m);
    }
    for (const p of level.lights) scene.add(makeLamp(p));
  }

  /** Forces the next sync to redraw (after a new world arrived). */
  invalidate(): void {
    this.shownVersion = -1;
  }

  /** Opens and shuts hiding places and updates the "left" labels on rare bins. */
  sync(
    hideouts: Map<number, HideoutState>,
    stock: Map<number, number | null>,
    version: number,
  ): void {
    if (version === this.shownVersion) return;
    this.shownVersion = version;
    for (const [id, h] of hideouts) this.hideouts.get(id)?.setOpen(h.open);
    for (const bin of this.level.bins) {
      const n = stock.get(bin.id) ?? null;
      const old = this.labels.get(bin.id);
      if (old) {
        this.scene.remove(old);
        old.material.map?.dispose();
        old.material.dispose();
        this.labels.delete(bin.id);
      }
      if (n === null) continue;
      const label = stockLabel(n === 0 ? 'empty' : `${n} left`);
      label.position.set(bin.pos.x, bin.pos.y + BIN_SIZE.y + 0.45, bin.pos.z);
      this.scene.add(label);
      this.labels.set(bin.id, label);
    }
  }
}
