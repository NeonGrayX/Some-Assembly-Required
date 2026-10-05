import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { hideoutInterior, hideoutPartDetails } from './interiors.ts';
import { atNight } from './daynight.ts';
import { KEEP_SEPARATE, mergeStatic } from './merge.ts';
import {
  BIN_SIZE,
  BOARD_SIZE,
  DRAWER_TRAY,
  hasDoor,
  hideoutBody,
  hideoutPart,
  lidHeight,
  openingIn,
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

const shadeOf = (colour: number, f: number) => new THREE.Color(colour).multiplyScalar(f).getHex();

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
function makeHideout(
  def: HideoutDef,
  rugIndex: number,
  opening: number,
  level: LevelDef,
): HideoutView {
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

  if (def.kind === 'drawer') {
    // The part spans the front and the tray behind it.
    const front = box(def.size, mat(colour));
    front.position.z = -DRAWER_TRAY / 2;
    part.add(front);
    const handle = box({ x: 0.2, y: 0.03, z: 0.03 }, mat(0x333333, 0.3));
    handle.position.z = -DRAWER_TRAY / 2 - d / 2 - 0.02;
    part.add(handle);
  } else if (def.kind === 'mailbox') {
    // Drawn whole by `hideoutPartDetails`.
  } else if (def.kind === 'cushion') {
    const cushion = new THREE.Mesh(
      new RoundedBoxGeometry(w, h, d, 2, Math.min(0.04, h / 2)),
      mat(colour, 0.95),
    );
    cushion.castShadow = cushion.receiveShadow = true;
    part.add(cushion);
  } else if (def.kind === 'rug') {
    // A border and a lighter field inside it.
    part.add(box(def.size, mat(colour, 0.95)));
    const field = box({ x: w - 0.16, y: h, z: d - 0.16 }, mat(shadeOf(colour, 1.25), 0.95));
    field.position.y = 0.003;
    part.add(field);
    const inner = box({ x: w - 0.3, y: h, z: d - 0.3 }, mat(colour, 0.95));
    inner.position.y = 0.006;
    part.add(inner);
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

  hideoutPartDetails(part, def, colour);
  // Lit like the room it stands in (while it is in place), then many small pieces become one
  // draw call: the part is merged while it still sits at the origin.
  group.add(part);
  group.updateMatrixWorld(true);
  lightIndoors(part, level);
  group.remove(part);
  mergeStatic(part);
  part.userData[KEEP_SEPARATE] = true;
  group.add(part);

  const still = hideoutBody(def);
  const interior = hideoutInterior(def, colour);
  if (interior) group.add(interior);
  else if (still) {
    const body = box(
      { x: still.half.x * 2, y: still.half.y * 2, z: still.half.z * 2 },
      mat(colour),
    );
    body.position.set(still.centre.x, still.centre.y, still.centre.z);
    group.add(body);
  }

  const setOpen = (open: boolean) => {
    const pose = hideoutPart(def, open, opening);
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

  // Hinges on the lid's back edge, where it turns, and latches holding its front down.
  const seam = h / 2 - lidH;
  for (const side of [-1, 1]) {
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 10), steel);
    hinge.rotation.z = Math.PI / 2;
    hinge.position.set(side * w * 0.3, h / 2, d / 2 + 0.006);
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

export const LAMP_GLOW = 0xffe2b0;
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

export const glowMaterial = (opacity: number) => ({
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
  // Everything glowing burns brighter at night, with no daylight to wash it out.
  const diffuser = new THREE.Mesh(
    new THREE.CircleGeometry(0.28, 20),
    atNight(
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: LAMP_GLOW,
        emissiveIntensity: 1.6,
      }),
      2.6,
    ),
  );
  diffuser.rotation.x = Math.PI / 2;
  diffuser.position.y = 0.02;
  const halo = new THREE.Sprite(atNight(new THREE.SpriteMaterial(glowMaterial(0.55)), 0.85));
  halo.scale.setScalar(1.1);
  halo.position.y = -0.08;
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 5),
    atNight(new THREE.MeshBasicMaterial(glowMaterial(0.3)), 0.5),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.008 - at.y;
  // Light thrown back off the ceiling around the shade.
  const bounce = new THREE.Mesh(
    new THREE.PlaneGeometry(3.5, 3.5),
    atNight(new THREE.MeshBasicMaterial(glowMaterial(0.2)), 0.35),
  );
  bounce.rotation.x = Math.PI / 2;
  bounce.position.y = 0.29;
  g.add(cord, shade, diffuser, halo, pool, bounce);
  return g;
}

/** How far a lamp's light reaches across its room, and above it. */
const LAMP_REACH = { x: 4.1, z: 4.6, up: 0.4 };
/** How much of a surface's own colour the lamps add to it, warmed by the lamp colour. */
const LAMP_FILL = 0.35;

/** Rooms reach this far into their walls: half a wall's thickness. */
const WALL_HALF = 0.1;
/** Marks the outside half of a wall or the roof, split off by `lightIndoors`. */
const OUTSIDE = 'outsideHalf';

/**
 * Brightens everything in the lamps' rooms as if lit by them, by giving it a little of its own
 * colour as emissive. It is baked into the materials once, so it costs nothing per frame, and
 * `mergeStatic` still merges the surfaces (one extra merged mesh per colour indoors).
 *
 * The outsides of the house's walls and roof were brightened along with their insides, which
 * looks fine by day but glowed warm all night long. So walls and roof are split down the
 * middle first, and their outside halves keep the fill by day only.
 */
export function lightIndoors(root: THREE.Object3D, level: LevelDef): void {
  root.updateMatrixWorld(true);
  const warm = new THREE.Color(LAMP_GLOW).multiplyScalar(LAMP_FILL);
  const box = new THREE.Box3();
  const centre = new THREE.Vector3();
  const inRoom = (p: THREE.Vector3) =>
    level.decals.some(
      (d) =>
        Math.abs(p.x - d.pos.x) <= d.size.x / 2 + WALL_HALF + 1e-6 &&
        Math.abs(p.z - d.pos.z) <= d.size.z / 2 + WALL_HALF + 1e-6,
    );
  const lit = (p: THREE.Vector3) =>
    inRoom(p) &&
    level.lights.some(
      (l) =>
        Math.abs(p.x - l.x) <= LAMP_REACH.x &&
        Math.abs(p.z - l.z) <= LAMP_REACH.z &&
        p.y <= l.y + LAMP_REACH.up,
    );
  const walls: { wall: THREE.Mesh; thin: 'x' | 'y' | 'z' }[] = [];
  root.traverse((o) => {
    const thin = o instanceof THREE.Mesh && o.parent === root ? thinAxis(o) : null;
    if (thin) walls.push({ wall: o as THREE.Mesh, thin });
  });
  for (const { wall, thin } of walls) {
    const sides = [-1, 1].map((side) => halfWall(wall, thin, side));
    const inside = sides.map((h) => lit(h.position.clone().applyMatrix4(root.matrixWorld)));
    if (inside[0] === inside[1]) {
      for (const h of sides) h.geometry.dispose();
      continue;
    }
    sides[inside[0] ? 1 : 0]!.userData[OUTSIDE] = true;
    wall.removeFromParent();
    wall.geometry.dispose();
    root.add(...sides);
    for (const h of sides) h.updateMatrixWorld();
  }
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshStandardMaterial)) return;
    const m = o.material;
    // Leave see-through things and anything already glowing (the lamps) as they are, and
    // merged meshes: their colour is in their vertices, so they were lit before merging.
    if (m.transparent || m.vertexColors || m.emissive.getHex() !== 0) return;
    const outside = !!o.userData[OUTSIDE];
    if (!outside && !lit(box.setFromObject(o).getCenter(centre))) return;
    o.material = m.clone();
    o.material.emissive.copy(m.color).multiply(warm);
    if (outside) atNight(o.material, 0);
  });
}

/**
 * Which way an unturned, thin box (a wall, the header over a doorway, or the roof) is thin, or
 * null if `o` is not one.
 */
function thinAxis(o: THREE.Mesh): 'x' | 'y' | 'z' | null {
  const g = o.geometry;
  if (!(g instanceof THREE.BoxGeometry) || !o.rotation.equals(new THREE.Euler())) return null;
  const { width, height, depth } = g.parameters;
  const thin = 2 * WALL_HALF + 1e-6;
  if (width <= thin && depth >= 1) return 'x';
  if (depth <= thin && width >= 1) return 'z';
  if (height <= thin && width >= 1 && depth >= 1) return 'y';
  return null;
}

/** One side (-1 or 1 along its `thin` axis) of a wall or roof cut down the middle. */
function halfWall(wall: THREE.Mesh, thin: 'x' | 'y' | 'z', side: number): THREE.Mesh {
  const { width, height, depth } = (wall.geometry as THREE.BoxGeometry).parameters;
  const size = { x: width, y: height, z: depth };
  size[thin] /= 2;
  const h = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), wall.material);
  h.position.copy(wall.position);
  h.position[thin] += (side * size[thin]) / 2;
  h.castShadow = wall.castShadow;
  h.receiveShadow = wall.receiveShadow;
  return h;
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
      const v = makeHideout(def, def.kind === 'rug' ? rugs++ : 0, openingIn(level, def), level);
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
