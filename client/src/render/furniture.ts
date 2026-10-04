import * as THREE from 'three';
import { BIN_SIZE, BOARD_SIZE } from '@sar/shared';
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
 * Doors swing, drawers slide, lids lift and rugs fold back when opened.
 */
function makeHideout(def: HideoutDef, rugIndex: number): HideoutView {
  const group = new THREE.Group();
  group.position.set(def.pos.x, def.pos.y, def.pos.z);
  group.rotation.y = def.facing;
  const { x: w, y: h, z: d } = def.size;
  const colour =
    def.kind === 'rug' ? RUG_COLOURS[rugIndex % RUG_COLOURS.length]! : COLOURS[def.kind];

  if (def.kind === 'drawer') {
    const drawer = new THREE.Group();
    drawer.add(box(def.size, mat(colour)));
    const tray = box({ x: w * 0.9, y: h * 0.8, z: 0.4 }, mat(0x8f8270));
    tray.position.z = d / 2 + 0.2;
    drawer.add(tray);
    const handle = box({ x: 0.2, y: 0.03, z: 0.03 }, mat(0x333333, 0.3));
    handle.position.z = -d / 2 - 0.02;
    drawer.add(handle);
    group.add(drawer);
    return { group, setOpen: (open) => (drawer.position.z = open ? -0.32 : 0) };
  }

  if (def.kind === 'rug' || def.kind === 'cushion') {
    const top = box(def.size, mat(colour, 0.95));
    group.add(top);
    return {
      group,
      setOpen: (open) => {
        // Folded back (rug) or lifted and tipped (cushion), showing what was underneath.
        top.position.set(0, open ? (def.kind === 'rug' ? 0.02 : 0.2) : 0, open ? d * 0.55 : 0);
        top.rotation.x = open ? (def.kind === 'rug' ? 0 : -0.7) : 0;
        top.scale.z = open && def.kind === 'rug' ? 0.45 : 1;
      },
    };
  }

  if (def.kind === 'toolbox' || def.kind === 'chest' || def.kind === 'mailbox') {
    // A box with a lid hinged at the back.
    const lidH = Math.min(0.08, h * 0.3);
    const body = box({ x: w, y: h - lidH, z: d }, mat(colour));
    body.position.y = -lidH / 2;
    group.add(body);
    const hinge = new THREE.Group();
    hinge.position.set(0, h / 2 - lidH, d / 2);
    const lid = box({ x: w, y: lidH, z: d }, mat(colour, 0.5));
    lid.position.set(0, lidH / 2, -d / 2);
    hinge.add(lid);
    group.add(hinge);
    return { group, setOpen: (open) => (hinge.rotation.x = open ? -1.9 : 0) };
  }

  // Fridge, locker, cabinet: a body with a door hinged on its left edge.
  group.add(box({ x: w, y: h, z: d - 0.03 }, mat(colour)));
  const hinge = new THREE.Group();
  hinge.position.set(-w / 2, 0, -d / 2 + 0.015);
  const door = box({ x: w, y: h * 0.98, z: 0.03 }, mat(colour, 0.4));
  door.position.x = w / 2;
  hinge.add(door);
  const handle = box({ x: 0.03, y: Math.min(0.3, h * 0.4), z: 0.03 }, mat(0x333333, 0.3));
  handle.position.set(w - 0.06, 0, -0.03);
  hinge.add(handle);
  group.add(hinge);
  return { group, setOpen: (open) => (hinge.rotation.y = open ? 1.9 : 0) };
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
      const v = makeHideout(def, def.kind === 'rug' ? rugs++ : 0);
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
    for (const p of level.lights) {
      const light = new THREE.PointLight(0xfff1d6, 9, 11, 2);
      light.position.set(p.x, p.y, p.z);
      scene.add(light);
    }
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
