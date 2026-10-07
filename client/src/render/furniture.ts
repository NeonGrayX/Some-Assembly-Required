import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { hideoutInterior, hideoutPartDetails } from './interiors.ts';
import { GLOW_POOL, LAMP_LIT, POWERED, atNight, nightOnly, tagged } from './daynight.ts';
import { KEEP_SEPARATE, mergeStatic } from './merge.ts';
import {
  BOARD_SIZE,
  DOOR_THICKNESS,
  DRAWER_TRAY,
  UPPER_FLOOR,
  floorLevel,
  hasDoor,
  hideoutBody,
  hideoutPart,
  hideoutPartAt,
  lidHeight,
  openingIn,
  stairsPlan,
  levelSites,
} from '@sar/shared';
import type { FloorRect, HideoutDef, HideoutState, LadderDef, LevelDef } from '@sar/shared';

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

/** How long a hiding place takes to open or shut (seconds). */
export const HIDEOUT_TRAVEL = 0.35;

/** How a hiding place looks, and how it looks when opened. */
interface HideoutView {
  group: THREE.Group;
  /** Starts it opening or shutting, or with `now`, puts it there at once. */
  setOpen(open: boolean, now?: boolean): void;
  /** Moves it on by `dt` seconds towards open or shut. */
  animate(dt: number): void;
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
  } else if (def.kind === 'mailbox' || def.kind === 'chest') {
    // Drawn whole by `hideoutPartDetails` or `addChestDetails`.
  } else if (def.kind === 'toolbox') {
    // A thin pressed-steel shell, open underneath, darker inside.
    const wall = 0.008;
    lidShell(part, w, d, lidHeight(def), wall, -lidHeight(def) / 2, mat(colour, 0.4));
    const top = box({ x: w, y: wall, z: d }, mat(colour, 0.4));
    top.position.y = lidHeight(def) / 2 - wall / 2;
    part.add(top);
    const lining = box(
      { x: w - 2 * wall, y: 0.002, z: d - 2 * wall },
      mat(shadeOf(colour, 0.45), 0.6),
    );
    lining.position.y = lidHeight(def) / 2 - wall - 0.001;
    part.add(lining);
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
  if (hasDoor(def)) addDoorHinges(def, group);
  if (def.kind === 'toolbox') addToolboxDetails(def, part, group);
  if (def.kind === 'chest') addChestDetails(def, colour, part, group);

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

  // How far open it is (0 shut, 1 open) and which way it is going.
  let amount = 0;
  let target = 0;
  const pose = () => {
    // Eased in and out, so a door starts and stops gently.
    const p = hideoutPartAt(def, amount * amount * (3 - 2 * amount), opening);
    part.position.set(p.centre.x, p.centre.y, p.centre.z);
    part.quaternion.set(p.rot.x, p.rot.y, p.rot.z, p.rot.w);
    // A folded rug is shorter than a flat one.
    part.scale.set(p.half.x / shut.half.x, p.half.y / shut.half.y, p.half.z / shut.half.z);
  };
  const setOpen = (open: boolean, now = false) => {
    target = open ? 1 : 0;
    if (!now) return;
    amount = target;
    pose();
  };
  const animate = (dt: number) => {
    if (amount === target) return;
    const step = dt / HIDEOUT_TRAVEL;
    amount = target > amount ? Math.min(target, amount + step) : Math.max(target, amount - step);
    pose();
  };
  setOpen(false, true);
  return { group, setOpen, animate };
}

/**
 * Hinges up the front edge of the side a door turns on (see `hideoutPart`), on the body, where
 * the door's back meets it at every angle.
 */
function addDoorHinges(def: HideoutDef, body: THREE.Group): void {
  const { x: w, y: h, z: d } = def.size;
  const metal = def.kind === 'cabinet' ? mat(0xb08d3c, 0.35) : mat(0xa7adb3, 0.3);
  const knuckle = Math.min(0.1, h * 0.12);
  const inset = Math.min(0.25, h * 0.15);
  for (const y of [h / 2 - inset, -h / 2 + inset]) {
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, knuckle, 10), metal);
    hinge.position.set(-w / 2, y, -d / 2 + DOOR_THICKNESS);
    hinge.castShadow = true;
    body.add(hinge);
  }
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

  // Hinges on the back at the rim, where the lid turns, and latches holding its front down.
  const seam = h / 2 - lidH;
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

/**
 * A wooden chest's domed lid (`lid`, posed by `hideoutPart`, filling the same box), and the
 * planks, iron bands, corner caps and lock on it and on its box (`body`, the hiding place's
 * own frame).
 */
/** Four thin walls round the edge of a `w` by `d` lid, `height` tall from `bottom` up. */
function lidShell(
  lid: THREE.Group,
  w: number,
  d: number,
  height: number,
  wall: number,
  bottom: number,
  material: THREE.Material,
): void {
  for (const s of [-1, 1]) {
    const side = box({ x: w, y: height, z: wall }, material);
    side.position.set(0, bottom + height / 2, s * (d / 2 - wall / 2));
    lid.add(side);
    const end = box({ x: wall, y: height, z: d - 2 * wall }, material);
    end.position.set(s * (w / 2 - wall / 2), bottom + height / 2, 0);
    lid.add(end);
  }
}

function addChestDetails(
  def: HideoutDef,
  colour: number,
  lid: THREE.Group,
  body: THREE.Group,
): void {
  const { x: w, y: h, z: d } = def.size;
  const lidH = lidHeight(def);
  const wood = mat(colour, 0.8);
  const groove = mat(shadeOf(colour, 0.6), 0.9);
  const iron = mat(0x3b3a38, 0.45);
  const brass = mat(0xc9a13b, 0.35);

  // The lid: a flat skirt that overhangs the box a little, so the seam shows, under a
  // half-round top squashed to fit what is left of the lid's height.
  const skirt = lidH * 0.3;
  const lip = 0.012;
  const base = -lidH / 2;
  // Hollow: the skirt is four thin boards and the dome is lined, darker, inside.
  const board = 0.014;
  lidShell(lid, w + lip, d + lip, skirt, board, base, wood);
  // Bands have no ends, or those would close off the hollow.
  const dome = (
    r: number,
    length: number,
    material: THREE.Material,
    inside = false,
    band = false,
  ) => {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, length, 24, 1, band, 0, Math.PI),
      material,
    );
    // The lining is seen from inside the dome: its back faces, ends included.
    if (inside) (material as THREE.MeshStandardMaterial).side = THREE.BackSide;
    // On its side along x, the round half up, squashed to the dome's height.
    m.rotation.z = Math.PI / 2;
    m.scale.x = (lidH - skirt) / (d / 2);
    m.position.y = base + skirt;
    m.castShadow = m.receiveShadow = true;
    lid.add(m);
    return m;
  };
  dome((d + lip) / 2, w + lip, wood);
  dome((d + lip) / 2 - board, w + lip - 2 * board, mat(shadeOf(colour, 0.6), 0.9), true);

  // Iron bands over the lid and down the box, front and back.
  const bodyH = h - lidH;
  const seam = h / 2 - lidH;
  for (const x of [-w * 0.32, w * 0.32]) {
    const band = dome((d + lip) / 2 + 0.006, 0.05, iron, false, true);
    band.position.x = x;
    for (const z of [-1, 1]) {
      const bandRim = box({ x: 0.05, y: skirt, z: 0.008 }, iron);
      bandRim.position.set(x, base + skirt / 2, z * ((d + lip) / 2 + 0.004));
      lid.add(bandRim);
      const strap = box({ x: 0.05, y: bodyH, z: 0.008 }, iron);
      strap.position.set(x, seam - bodyH / 2, z * (d / 2 + 0.004));
      body.add(strap);
    }
  }

  // Planks: grooves along the box's front, back and ends.
  for (let y = seam - bodyH / 4; y > -h / 2 + 0.02; y -= bodyH / 4) {
    for (const z of [-1, 1]) {
      const line = box({ x: w, y: 0.008, z: 0.004 }, groove);
      line.position.set(0, y, z * (d / 2 + 0.002));
      body.add(line);
    }
    for (const x of [-1, 1]) {
      const line = box({ x: 0.004, y: 0.008, z: d }, groove);
      line.position.set(x * (w / 2 + 0.002), y, 0);
      body.add(line);
    }
  }

  // Iron caps on the box's vertical corners.
  for (const x of [-1, 1])
    for (const z of [-1, 1]) {
      const cap = box({ x: 0.03, y: bodyH, z: 0.03 }, iron);
      cap.position.set(x * (w / 2 - 0.01), seam - bodyH / 2, z * (d / 2 - 0.01));
      body.add(cap);
    }

  // Hinges along the back at the rim, where the lid turns.
  for (const x of [-w * 0.2, w * 0.2]) {
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.1, 10), iron);
    hinge.rotation.z = Math.PI / 2;
    hinge.position.set(x, seam, d / 2 + 0.008);
    body.add(hinge);
  }

  // A hasp on the lid's front over a brass lock plate on the box.
  const hasp = box({ x: 0.05, y: skirt + 0.03, z: 0.012 }, iron);
  hasp.position.set(0, base + skirt / 2 - 0.015, -(d + lip) / 2 - 0.006);
  lid.add(hasp);
  const plate = box({ x: 0.09, y: 0.1, z: 0.01 }, brass);
  plate.position.set(0, seam - 0.06, -d / 2 - 0.006);
  body.add(plate);
  const keyhole = box({ x: 0.012, y: 0.03, z: 0.004 }, iron);
  keyhole.position.set(0, seam - 0.07, -d / 2 - 0.012);
  body.add(keyhole);
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
  // Legs from the ground up into the bottom of the frame, hidden in it, not up through the cork.
  const legTop = -BOARD_SIZE.y / 2 - 0.01;
  const legHeight = b.pos.y + legTop;
  for (const side of [-1, 1]) {
    const leg = box({ x: 0.06, y: legHeight, z: 0.06 }, frame);
    leg.position.set((side * (BOARD_SIZE.x - 0.1)) / 2, legTop - legHeight / 2, 0);
    g.add(leg);
  }
  return g;
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
    tagged(
      atNight(
        new THREE.MeshStandardMaterial({
          color: 0x000000,
          emissive: LAMP_GLOW,
          emissiveIntensity: 1.6,
        }),
        2.6,
      ),
      POWERED,
    ),
  );
  diffuser.rotation.x = Math.PI / 2;
  diffuser.position.y = 0.02;
  const halo = new THREE.Sprite(
    tagged(atNight(new THREE.SpriteMaterial(glowMaterial(0.55)), 0.45), POWERED),
  );
  halo.scale.setScalar(1.1);
  halo.position.y = -0.08;
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 5),
    tagged(
      tagged(atNight(new THREE.MeshBasicMaterial(glowMaterial(0.3)), 0.5), GLOW_POOL),
      POWERED,
    ),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.userData[LAMP_POOL] = true;
  // On the floor of the lamp's room, downstairs or up.
  pool.position.y = floorLevel(at.y) + 0.008 - at.y;
  // Light thrown back off the ceiling around the shade.
  const bounce = new THREE.Mesh(
    new THREE.PlaneGeometry(3.5, 3.5),
    // Only a little leaks up past the shade, at night too.
    tagged(atNight(new THREE.MeshBasicMaterial(glowMaterial(0.2)), 0.12), POWERED),
  );
  bounce.rotation.x = Math.PI / 2;
  bounce.position.y = 0.29;
  // At night the lamp lights its room for real, fading away from it. The shade lets light out
  // only downward, through its open bottom: a spot whose cone opens as wide as the shade's rim
  // seen from the bulb, softened at its edge. It casts real shadows, so the floor under a table
  // stays dark; the baked shadows (see `bakeLampShadows`) stand in for them by day. By day the
  // room's fill (see `lightIndoors`) is enough, so the light is off and costs nothing, unless
  // shadows are ray traced: then it is on by day too (see `LAMP_LIT`).
  const light = tagged(nightOnly(new THREE.SpotLight(LAMP_GLOW, 12, 9, 1.2, 0.5, 2)), LAMP_LIT);
  light.position.y = 0;
  light.target.position.y = -3;
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  light.shadow.bias = -0.0005;
  light.shadow.normalBias = 0.02;
  g.add(cord, shade, diffuser, halo, pool, bounce, light, light.target);
  return g;
}

/** How far a lamp's light reaches across its room, and above it. */
/** Marks a lamp's warm pool on the floor, so the lamp's shadows can cut it. */
export const LAMP_POOL = 'lampPool';

export const LAMP_REACH = { x: 4.1, z: 4.6, up: 0.4 };
/** How much of a surface's own colour the lamps add to it, warmed by the lamp colour. */
const LAMP_FILL = 0.35;

/**
 * How strong the lamps' even fill is at night. The ceiling lamps' real lights do most of the
 * work then; an even fill any stronger made the walls look like they glowed.
 */
const NIGHT_FILL = 0.5;
/** Rooms reach this far into their walls: half a wall's thickness. */
const WALL_HALF = 0.1;
/** A room reaches from a little under its floor (into the floor) to under the floor above. */
const ROOM_SPAN = { below: 0.25, above: 2.7 };

/** Whether height `y` is within the room whose floor decal is `d`. */
const atRoomHeight = (d: LevelDef['decals'][number], y: number) =>
  y >= d.pos.y - ROOM_SPAN.below && y < d.pos.y + ROOM_SPAN.above;
/** Marks the outside half of a wall or the roof, split off by `lightIndoors`. */
export const OUTSIDE_HALF = 'outsideHalf';
/** Marks a mesh `lightIndoors` leaves alone wherever it is: the ground, outdoors throughout. */
export const NO_FILL = 'noFill';
/**
 * Underground, the daylight the sky sheds on everything is mostly kept out: surfaces in the
 * basement keep this much of their colour, and their lamp makes up the rest, so with the power
 * out they go dark even by day.
 */
const UNDERGROUND = 0.3;
/** How brightly the basement's lamp fills it, day or night (it has no windows). */
const UNDERGROUND_FILL = 1.8;

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
        Math.abs(p.z - d.pos.z) <= d.size.z / 2 + WALL_HALF + 1e-6 &&
        atRoomHeight(d, p.y),
    );
  // Each lamp lights its own floor's room, not the one above or below.
  const lit = (p: THREE.Vector3) =>
    inRoom(p) &&
    level.lights.some(
      (l) =>
        Math.abs(p.x - l.x) <= LAMP_REACH.x &&
        Math.abs(p.z - l.z) <= LAMP_REACH.z &&
        p.y <= l.y + LAMP_REACH.up &&
        p.y >= floorLevel(l.y) - ROOM_SPAN.below,
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
    sides[inside[0] ? 1 : 0]!.userData[OUTSIDE_HALF] = true;
    // At an outside corner the inside half runs on past the room to the corner, and its cut
    // end showed outdoors as a strip lit like the room: that end goes to the outside too.
    const ends = thin === 'y' ? [] : cornerEnds(sides[inside[0] ? 0 : 1]!, thin, level);
    for (const e of ends) e.userData[OUTSIDE_HALF] = true;
    wall.removeFromParent();
    wall.geometry.dispose();
    root.add(...sides, ...ends);
    for (const h of [...sides, ...ends]) h.updateMatrixWorld();
  }
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshStandardMaterial)) return;
    const m = o.material;
    // Leave see-through things and anything already glowing (the lamps) as they are, and
    // merged meshes: their colour is in their vertices, so they were lit before merging.
    if (m.transparent || m.vertexColors || m.emissive.getHex() !== 0) return;
    if (o.userData[NO_FILL]) return;
    const outside = !!o.userData[OUTSIDE_HALF];
    if (!outside && !lit(box.setFromObject(o).getCenter(centre))) return;
    o.material = m.clone();
    o.material.emissive.copy(m.color).multiply(warm);
    if (!outside && box.max.y <= 0.001) {
      // Wholly underground: the basement.
      o.material.color.multiplyScalar(UNDERGROUND);
      o.material.emissiveIntensity = UNDERGROUND_FILL;
      tagged(atNight(o.material, UNDERGROUND_FILL), LAMP_LIT);
      return;
    }
    atNight(o.material, outside ? 0 : NIGHT_FILL);
    if (!outside) tagged(o.material, LAMP_LIT);
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
  // Walls around a window are cut into pieces, some of them narrow.
  if (width <= thin && depth > thin) return 'x';
  if (depth <= thin && width > thin) return 'z';
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

/**
 * Trims the inside half of a wall (thin along `thin`) back to the rooms it faces, and returns
 * the pieces cut off its ends past them: at an outside corner, the bit inside the other wall.
 * The half sits in the scene's root, so its position is in the root's frame like the decals.
 */
function cornerEnds(half: THREE.Mesh, thin: 'x' | 'z', level: LevelDef): THREE.Mesh[] {
  const g = half.geometry as THREE.BoxGeometry;
  const along = thin === 'x' ? 'z' : 'x';
  const across = (d: LevelDef['decals'][number]) =>
    Math.abs(half.position[thin] - d.pos[thin]) <= d.size[thin] / 2 + WALL_HALF + 1e-6;
  const length = along === 'x' ? g.parameters.width : g.parameters.depth;
  const [lo, hi] = [half.position[along] - length / 2, half.position[along] + length / 2];
  const rooms = level.decals.filter(
    (d) =>
      across(d) &&
      atRoomHeight(d, half.position.y) &&
      d.pos[along] + d.size[along] / 2 + WALL_HALF > lo &&
      d.pos[along] - d.size[along] / 2 - WALL_HALF < hi,
  );
  if (!rooms.length) return [];
  const from = Math.max(
    lo,
    Math.min(...rooms.map((d) => d.pos[along] - d.size[along] / 2 - WALL_HALF)),
  );
  const to = Math.min(
    hi,
    Math.max(...rooms.map((d) => d.pos[along] + d.size[along] / 2 + WALL_HALF)),
  );
  if (from - lo < 1e-4 && hi - to < 1e-4) return [];
  const piece = (a: number, b: number) => {
    const size = { x: g.parameters.width, y: g.parameters.height, z: g.parameters.depth };
    size[along] = b - a;
    const m = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), half.material);
    m.position.copy(half.position);
    m.position[along] = (a + b) / 2;
    m.castShadow = half.castShadow;
    m.receiveShadow = half.receiveShadow;
    return m;
  };
  const ends = [
    ...(from - lo >= 1e-4 ? [piece(lo, from)] : []),
    ...(hi - to >= 1e-4 ? [piece(to, hi)] : []),
  ];
  const kept = piece(from, to);
  half.geometry.dispose();
  half.geometry = kept.geometry;
  half.position.copy(kept.position);
  return ends;
}

/** The rectangles left of each of `rects` once `hole` is cut out of them. */
function cutOut(rects: FloorRect[], hole: FloorRect): FloorRect[] {
  return rects.flatMap((r) => {
    if (hole.x0 >= r.x1 || hole.x1 <= r.x0 || hole.z0 >= r.z1 || hole.z1 <= r.z0) return [r];
    const z0 = Math.max(r.z0, hole.z0);
    const z1 = Math.min(r.z1, hole.z1);
    return [
      { ...r, z1: z0 },
      { ...r, z0: z1 },
      { x0: r.x0, x1: Math.max(r.x0, hole.x0), z0, z1 },
      { x0: Math.min(r.x1, hole.x1), x1: r.x1, z0, z1 },
    ].filter((q) => q.x1 - q.x0 > 1e-6 && q.z1 - q.z0 > 1e-6);
  });
}

/** The house's furniture that changes: hiding places opening and shutting. */
export class Furniture {
  private readonly hideouts = new Map<number, HideoutView>();
  private shownVersion = -1;
  /** Whether the next sync puts hiding places where they are without animating them. */
  private snap = true;

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly level: LevelDef,
  ) {
    let rugs = 0;
    for (const def of level.hideouts) {
      const v = makeHideout(def, def.kind === 'rug' ? rugs++ : 0, openingIn(level, def), level);
      scene.add(v.group);
      this.hideouts.set(def.id, v);
    }
    for (const l of level.ladders) scene.add(makeLadder(l));
    for (const site of levelSites(level)) scene.add(makeBoard({ ...level, board: site.board }));
    // Room floors, less the stairwells in them.
    const wells = (level.stairs ?? []).map((s) => ({
      ...stairsPlan(s).well,
      y: s.pos.y + UPPER_FLOOR,
    }));
    for (const d of level.decals) {
      const room = {
        x0: d.pos.x - d.size.x / 2,
        x1: d.pos.x + d.size.x / 2,
        z0: d.pos.z - d.size.z / 2,
        z1: d.pos.z + d.size.z / 2,
      };
      for (const r of wells.filter((w) => Math.abs(w.y - d.pos.y) < 0.01).reduce(cutOut, [room])) {
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0),
          mat(d.colour, 0.85),
        );
        m.rotation.x = -Math.PI / 2;
        m.position.set((r.x0 + r.x1) / 2, d.pos.y + 0.004, (r.z0 + r.z1) / 2);
        m.receiveShadow = true;
        scene.add(m);
      }
    }
    for (const p of level.lights) scene.add(makeLamp(p));
  }

  /** Forces the next sync to redraw (after a new world arrived). */
  invalidate(): void {
    this.shownVersion = -1;
    this.snap = true;
  }

  /** Moves opening and shutting hiding places on by `dt` seconds. */
  animate(dt: number): void {
    for (const v of this.hideouts.values()) v.animate(dt);
  }

  /** Opens and shuts hiding places. */
  sync(hideouts: Map<number, HideoutState>, version: number): void {
    if (version === this.shownVersion) return;
    this.shownVersion = version;
    for (const [id, h] of hideouts) this.hideouts.get(id)?.setOpen(h.open, this.snap);
    this.snap = false;
  }
}
