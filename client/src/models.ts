import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BRICK_TYPES, FACES, GEAR_IDS, HATS, MAPS, SHIRTS, houseLayout } from '@sar/shared';
import type { BoxDef, BrickTypeId, LevelDef, Look } from '@sar/shared';
import { animateAvatar, makeAvatar } from './render/avatar.ts';
import { brickGeometry, brickMaterial } from './render/bricks.ts';
import { VacuumView } from './render/vacuum.ts';
import { DogView } from './render/dog.ts';
import { makeGearProp, wearGear } from './render/gear.ts';
import {
  addPropFile,
  exportGlb,
  loadPropFiles,
  propFile,
  propFileName,
} from './render/propFiles.ts';
import { makeProp } from './render/props.ts';
import { buildLevelModels, where } from './render/scene.ts';
import { downloadBlob } from './ui/dom.ts';
import type { LevelModels } from './render/scene.ts';
import './style.css';

/**
 * A gallery of every model in the game, one at a time, for checking how they look: each piece
 * of a level shown with whatever it stands in or against, and the players, their gear, the dog
 * and the bricks on their own. `?item=N` picks one; `window.gallery` drives it from a script
 * (see the model screenshots in the docs).
 *
 * The bar at the top saves what is shown as a .glb, and opens a .glb to see it in the shown
 * prop's place, standing on its box as the game would draw it (see `propFiles.ts`).
 */

interface Item {
  label: string;
  /** Builds the scene's contents for this item and returns what to frame. */
  show(open: number): { focus: THREE.Object3D[]; front: number };
  /** Whether it has a part that opens. */
  opens?: boolean;
  /** The level box it is the prop of, which an opened .glb can stand in for. */
  prop?: BoxDef;
}

/** A .glb opened in the gallery, shown in place of the prop it was opened over. */
let preview: string | null = null;

await loadPropFiles();

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game')!.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc9e8);
scene.add(new THREE.HemisphereLight(0xdfefff, 0x6b5b45, 1.4));
const sun = new THREE.DirectionalLight(0xfff3dd, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
const controls = new OrbitControls(camera, renderer.domElement);
const stage = new THREE.Group();
scene.add(stage);
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshStandardMaterial({ color: 0xb9b2a4, roughness: 0.95 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// ------------------------------------------------------------------ the items

const LEVELS: [string, () => LevelDef][] = [
  ['house', () => MAPS[0]!.plain],
  ['house 222', () => houseLayout(222)],
  ['house 44444', () => houseLayout(44444)],
  ...MAPS.filter((m) => m.id !== 'house').map(
    (m) => [m.id, () => m.layout(1)] as [string, () => LevelDef],
  ),
];
const built = new Map<string, LevelModels>();
const level = (name: string) => {
  let lm = built.get(name);
  if (!lm) {
    lm = buildLevelModels(LEVELS.find(([n]) => n === name)![1]());
    built.set(name, lm);
  }
  return lm;
};
/** Big things that stand around everything else: left out, so they do not hide it. */
const SURROUNDS = /^(ground|wall|trim|room floor|fence|lamp|deck|platform)/;
const kindOf = (owner: string) => owner.replace(/ at .*| #\d+| \d+$/, '');

const items: Item[] = [];
/** How many of each kind have been picked on each map. */
const picked = new Map<string, number>();
const ALIKE =
  /^(step|rail|rug|deck|pine|rock|post|fence|lamp|bin|Group|treat|site|inspector|bell|done|catapult|dog pole|handrail|box)/;
const box = new THREE.Box3();
const other = new THREE.Box3();
for (const [name, make] of LEVELS) {
  const def = make();
  const lm = buildLevelModels(def);
  built.set(name, lm);
  const owners = new Map<string, THREE.Object3D[]>();
  for (const o of lm.root.children) {
    const n = lm.owner(o);
    if (!owners.has(n)) owners.set(n, []);
    owners.get(n)!.push(o);
  }
  // One or two of each kind, of different sizes, per map.
  const seen = new Set<string>();
  for (const [owner, objs] of owners) {
    if (/^(ground|room floor|wall|trim)/.test(owner) && owner !== 'trim') continue;
    box.makeEmpty();
    for (const o of objs) box.expandByObject(o);
    const size = box.getSize(new THREE.Vector3());
    const kind = kindOf(owner);
    const key = `${kind} ${size.x.toFixed(1)} ${size.y.toFixed(1)} ${size.z.toFixed(1)}`;
    // Of the many alike (steps, rails, rugs...) one will do.
    const limit = ALIKE.test(kind) ? 1 : 2;
    const family = `${name.split(' ')[0]}:${kind}`;
    if (seen.has(key) || owner === 'trim' || (picked.get(family) ?? 0) >= limit) continue;
    seen.add(key);
    picked.set(family, (picked.get(family) ?? 0) + 1);
    const hideout = def.hideouts.find(
      (h) => owner.endsWith(`#${h.id}`) && owner.startsWith(h.kind),
    );
    const prop: BoxDef | undefined = def.boxes.find(
      (b) => b.model && owner === `${b.model} at ${where(b.pos)}`,
    );
    items.push({
      label: `${name}: ${owner}`,
      prop,
      opens: !!hideout || objs.some((o) => hasHideout(lm, o, def)),
      show(open) {
        const lm = level(name);
        lm.open(open);
        let focus = lm.root.children.filter((o) => lm.owner(o) === owner);
        const file = prop && preview ? makeProp({ ...prop, asset: preview }, def) : null;
        if (file) {
          stage.add(file);
          file.updateMatrixWorld(true);
          focus = [file];
        }
        box.makeEmpty();
        for (const o of focus) box.expandByObject(o);
        box.expandByScalar(0.03);
        // With what it stands in, on or against.
        const near = lm.root.children.filter((o) => {
          const n = lm.owner(o);
          if (n === owner || SURROUNDS.test(n)) return false;
          other.setFromObject(o);
          return other.intersectsBox(box);
        });
        stage.add(lm.root);
        for (const o of lm.root.children) o.visible = focus.includes(o) || near.includes(o);
        floor.position.y = box.min.y - 0.002;
        const front = hideout ? hideout.facing : (focus[0]?.rotation.y ?? 0);
        return { focus, front };
      },
    });
  }
}

function hasHideout(_lm: LevelModels, o: THREE.Object3D, def: LevelDef): boolean {
  box.setFromObject(o);
  return def.hideouts.some((h) => box.containsPoint(new THREE.Vector3(h.pos.x, h.pos.y, h.pos.z)));
}

const solo = (label: string, make: () => THREE.Object3D, opens = false) =>
  items.push({
    label,
    opens,
    show() {
      const o = make();
      stage.add(o);
      o.updateMatrixWorld(true);
      floor.position.y = new THREE.Box3().setFromObject(o).min.y - 0.002;
      return { focus: [o], front: 0 };
    },
  });

const colours = [0xd9443a, 0x2e86de, 0x27ae60, 0xf1c40f];
const look = (i: number): Look => ({
  hat: HATS[i % HATS.length]!.id,
  face: FACES[i % FACES.length]!.id,
  shirt: SHIRTS[i % SHIRTS.length]!.id,
});
for (let i = 0; i < Math.max(HATS.length, FACES.length, SHIRTS.length); i++) {
  const l = look(i);
  solo(`player: ${l.hat}, ${l.face}, ${l.shirt}`, () => {
    const a = makeAvatar(colours[i % colours.length]!, null, l);
    return a.group;
  });
}
for (const g of GEAR_IDS) {
  solo(`gear: ${g}`, () => makeGearProp(g));
  solo(`gear worn: ${g}`, () => {
    const a = makeAvatar(0x2e86de, null, { hat: 'none', face: 'smile', shirt: 'plain' });
    wearGear(a, g);
    return a.group;
  });
}
solo('dog', () => new DogView().group);
solo('vacuum', () => new VacuumView().group);
solo('player carrying the vacuum', () => {
  const a = makeAvatar(0x2e86de, null, { hat: 'none', face: 'smile', shirt: 'plain' });
  const v = new VacuumView();
  const both = new THREE.Group();
  both.add(a.group, v.group);
  for (let i = 0; i < 40; i++) {
    const head = a.group.localToWorld(new THREE.Vector3(0.25, -0.85, -0.85));
    const grip = v.carry(a.group, head, false);
    animateAvatar(a, { limping: false, carrying: true, careful: false, grip }, 1 / 60);
  }
  return both;
});
solo('vacuum: running, half full', () => {
  const v = new VacuumView();
  v.setLoad(5, 10);
  v.sucked(1);
  v.speed = 1;
  v.update(1);
  return v.group;
});
for (const t of Object.keys(BRICK_TYPES) as BrickTypeId[])
  solo(`brick: ${t}`, () => new THREE.Mesh(brickGeometry(t), brickMaterial('red')));

// ------------------------------------------------------------------ showing them

let current: THREE.Object3D[] = [];
/** What is shown: what the camera frames, and what is saved as a .glb. */
let shown: { i: number; focus: THREE.Object3D[] } = { i: 0, focus: [] };

/**
 * Shows item `i`, `open` of the way open, from `yaw` round its front (0: straight on) and
 * `pitch` above level, at `zoom` times the distance that frames it.
 */
function show(i: number, yaw = 0.6, pitch = 0.35, open = 0, zoom = 1): string {
  stage.clear();
  for (const o of current) o.removeFromParent();
  const item = items[i]!;
  const { focus, front } = item.show(open);
  shown = { i, focus };
  picker.value = String(i);
  current = [...stage.children];
  scene.updateMatrixWorld(true);
  box.makeEmpty();
  // Framed on what is solid: a lamp's glow on the floor spreads far wider than the lamp.
  for (const o of focus)
    o.traverse((m) => {
      if (m instanceof THREE.Mesh && !(m.material as THREE.Material).transparent)
        box.expandByObject(m);
    });
  if (box.isEmpty()) for (const o of focus) box.expandByObject(o);
  const centre = box.getCenter(new THREE.Vector3());
  const radius = Math.max(0.15, box.getSize(new THREE.Vector3()).length() / 2);
  const dist = (radius / Math.sin((camera.fov * Math.PI) / 360)) * zoom;
  // Local -z is the front: straight on looks along +z turned by `front`.
  const a = front + yaw;
  const dir = new THREE.Vector3(
    -Math.sin(a) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(a) * Math.cos(pitch),
  );
  camera.position.copy(centre).addScaledVector(dir, dist);
  camera.near = Math.max(0.01, dist / 100);
  camera.lookAt(centre);
  camera.updateProjectionMatrix();
  controls.target.copy(centre);
  sun.position.copy(centre).add(new THREE.Vector3(6, 10, 4));
  sun.target.position.copy(centre);
  const s = sun.shadow.camera as THREE.OrthographicCamera;
  s.left = s.bottom = -radius * 2;
  s.right = s.top = radius * 2;
  s.near = 0.1;
  s.far = 40;
  s.updateProjectionMatrix();
  renderer.render(scene, camera);
  return item.label;
}

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ files

/** What is shown as a .glb. */
const shownGlb = () => {
  const { label, prop } = items[shown.i]!;
  // A prop is saved standing where its box stands: on the box's bottom.
  return exportGlb(shown.focus, label, prop && -prop.size.y / 2);
};

/** Opens a .glb as `name`: in the shown prop's place, or on its own if it is no prop. */
async function openGlb(name: string, glb: ArrayBuffer): Promise<string> {
  await addPropFile(name, glb);
  preview = name;
  if (items[shown.i]!.prop) return show(shown.i);
  const label = `file: ${name}`;
  let i = items.findIndex((it) => it.label === label);
  if (i < 0) {
    i = items.length;
    solo(label, () => propFile(name)!);
    addOption(i);
  }
  return show(i);
}

const bar = document.createElement('div');
bar.style.cssText =
  'position:fixed;top:8px;left:8px;right:8px;display:flex;gap:6px;flex-wrap:wrap;font:13px system-ui';
const picker = document.createElement('select');
picker.style.maxWidth = 'min(420px, 100%)';
const addOption = (i: number) => picker.add(new Option(items[i]!.label, String(i)));
items.forEach((_, i) => addOption(i));
picker.addEventListener('change', () => show(Number(picker.value)));
const button = (text: string, onClick: () => void) => {
  const b = document.createElement('button');
  b.textContent = text;
  b.addEventListener('click', onClick);
  bar.append(b);
  return b;
};
bar.append(picker);
button('Save .glb', async () => {
  const name = items[shown.i]!.label.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  downloadBlob(new Blob([await shownGlb()], { type: 'model/gltf-binary' }), `${name}.glb`);
});
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = '.glb,model/gltf-binary';
fileInput.addEventListener('change', async () => {
  const f = fileInput.files?.[0];
  fileInput.value = '';
  if (f) await openGlb(propFileName(f.name), await f.arrayBuffer());
});
button('Open .glb…', () => fileInput.click());
const coded = button('Show coded model', () => {
  preview = null;
  show(shown.i);
});
coded.title = 'Stop showing the opened .glb in place of props';
document.body.append(bar);

Object.assign(window, {
  gallery: {
    items: () => items.map((it, i) => ({ i, label: it.label, opens: !!it.opens })),
    show,
    /** What is shown as a .glb, base64. */
    saveGlb: async () => {
      const bytes = new Uint8Array(await shownGlb());
      let text = '';
      for (let i = 0; i < bytes.length; i += 0x8000)
        text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(text);
    },
    /** Opens a .glb given in base64 as `name`. */
    openGlb: (name: string, base64: string) =>
      openGlb(name, Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer),
  },
});

const params = new URLSearchParams(location.search);
show(Number(params.get('item') ?? 0), 0.6, 0.35, Number(params.get('open') ?? 0));
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
