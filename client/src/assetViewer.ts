import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { view } from './worldView.ts';
import { ASSET_GROUPS, loadCatalogue, solidBox } from './ui/assetCatalog.ts';
import type { Asset } from './ui/assetCatalog.ts';

/**
 * The asset viewer, opened from the main menu as the build editor is: every model in the game
 * in a list down the left (`assetCatalog.ts`), and the one picked on its own in the middle,
 * turned, zoomed and panned with the mouse or a finger. It is drawn by the game's view on the
 * build editor's map (`View.showStudio`), so it looks as it does in the game.
 */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const root = document.createElement('div');
root.id = 'assets';
root.className = 'hidden';
root.innerHTML = `
  <div id="assets-view"></div>
  <aside id="assets-panel" class="box">
    <h3>Asset viewer</h3>
    <input id="av-search" type="search" placeholder="Search models" aria-label="Search models" autocomplete="off" />
    <div id="av-list" role="listbox" aria-label="Models"></div>
    <p id="av-loading" class="av-loading">Loading the maps' models…</p>
  </aside>
  <div id="av-info" class="box">
    <div class="av-title">
      <strong id="av-name"></strong>
      <span id="av-what"></span>
    </div>
    <div class="av-controls">
      <label class="field" id="av-variant-field">Variant <span class="select"><select id="av-variant"></select></span></label>
      <label class="field" id="av-open-field">Open <input id="av-open" type="range" min="0" max="1" step="0.05" value="0" /></label>
      <div class="av-sides" id="av-sides"></div>
      <label class="inline check"><input type="checkbox" id="av-spin" /> spin</label>
    </div>
  </div>
  <p id="av-help">Drag to turn · Scroll or pinch to zoom · Right drag to pan · ↑↓ next model · ←→ turn</p>`;
document.body.append(root);

const container = $('assets-view');
const panel = $('assets-panel');
const search = $<HTMLInputElement>('av-search');
const list = $('av-list');
const loading = $('av-loading');
const nameEl = $('av-name');
const whatEl = $('av-what');
const variantField = $('av-variant-field');
const variantSel = $<HTMLSelectElement>('av-variant');
const openField = $('av-open-field');
const openRange = $<HTMLInputElement>('av-open');
const spin = $<HTMLInputElement>('av-spin');
const info = $('av-info');

const { renderer, camera } = view;
/** What the viewer puts on the editor's map: the model and a floor under it. */
const stage = new THREE.Group();
const holder = new THREE.Group();
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(1, 64),
  new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.95 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
stage.add(holder, floor);

// Its own listeners, on its own view: the game and the editor keep theirs.
const controls = new OrbitControls(camera, container);
controls.enabled = false;
controls.enableDamping = true;
controls.autoRotateSpeed = 2;

let assets: Asset[] = [];
let current: { asset: Asset; variant: number } | null = null;
let isOpen = false;
let radius = 1;
const buttons = new Map<string, HTMLButtonElement>();
/** The groups opened or shut by hand: whether each is open. */
const folded = new Map<string, boolean>();

// ------------------------------------------------------------------ the list

/** Fills the list from `assets`, in their groups, keeping to what the search matches. */
function drawList(): void {
  const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const match = (a: Asset) => {
    const text = `${a.name} ${a.group} ${a.variants.map((v) => v.label).join(' ')}`.toLowerCase();
    return words.every((w) => text.includes(w));
  };
  list.replaceChildren();
  buttons.clear();
  for (const group of ASSET_GROUPS) {
    const shown = assets
      .filter((a) => a.group === group && match(a))
      .sort((a, b) => (group === 'Bricks' ? 0 : a.name.localeCompare(b.name)));
    if (!shown.length) continue;
    const details = document.createElement('details');
    details.dataset.group = group;
    // Every group starts open but the bricks (the editor's brick viewer has them too), and
    // stays as it is opened or shut; a search opens whatever it finds.
    details.open = words.length > 0 || (folded.get(group) ?? group !== 'Bricks');
    details.addEventListener('toggle', () => {
      if (!words.length) folded.set(group, details.open);
    });
    const summary = document.createElement('summary');
    summary.innerHTML = `<span></span><small>${shown.length}</small>`;
    summary.querySelector('span')!.textContent = group;
    details.append(summary);
    for (const a of shown) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(current?.asset.id === a.id));
      b.innerHTML = `<span></span><small></small>`;
      b.querySelector('span')!.textContent = a.name;
      if (a.variants.length > 1) b.querySelector('small')!.textContent = `${a.variants.length}`;
      b.addEventListener('click', () => select(a));
      details.append(b);
      buttons.set(a.id, b);
    }
    list.append(details);
  }
  if (!list.childElementCount) list.innerHTML = '<p class="av-none">No model matches that.</p>';
}

/** The assets in the order the list shows them, for stepping through with the arrow keys. */
function listed(): Asset[] {
  const byButton = new Map([...buttons].map(([id, b]) => [b, id]));
  return [...list.querySelectorAll<HTMLButtonElement>('details[open] button')]
    .map((b) => assets.find((a) => a.id === byButton.get(b)))
    .filter((a): a is Asset => !!a);
}

search.addEventListener('input', drawList);
search.addEventListener('keydown', (e) => {
  const first = listed()[0];
  if (e.key === 'Enter' && first) select(first);
});

// ------------------------------------------------------------------ showing one

function select(asset: Asset, variant = 0): void {
  current = { asset, variant };
  for (const [id, b] of buttons) b.setAttribute('aria-selected', String(id === asset.id));
  buttons.get(asset.id)?.scrollIntoView({ block: 'nearest' });
  variantSel.replaceChildren(...asset.variants.map((v, i) => new Option(v.label, String(i))));
  variantSel.value = String(variant);
  variantField.hidden = asset.variants.length < 2;
  openRange.value = '0';
  show(true);
}

/** Shows the current variant; `reframe` puts the camera back to its corner view. */
function show(reframe: boolean): void {
  if (!current) return;
  const { asset, variant } = current;
  const v = asset.variants[variant]!;
  openField.hidden = !v.opens;
  holder.clear();
  const shown = v.show(holder, Number(openRange.value));
  const box = solidBox(shown.focus);
  const size = box.getSize(new THREE.Vector3());
  radius = Math.max(0.05, size.length() / 2);
  nameEl.textContent = asset.name;
  const m = (n: number) => (n < 1 ? `${Math.round(n * 100)} cm` : `${n.toFixed(1)} m`);
  whatEl.textContent =
    `${asset.group} · ${v.map ?? v.label} · ${m(size.x)} × ${m(size.y)} × ${m(size.z)}` +
    (asset.variants.length > 1 ? ` · ${asset.variants.length} variants` : '');
  // The floor: under it, a good way out round it, for its shadow to fall on.
  const centre = box.getCenter(new THREE.Vector3());
  floor.position.set(centre.x, shown.floor - 0.002, centre.z);
  floor.scale.setScalar(Math.max(size.x, size.z, 0.3) * 3);
  view.lightStudioFor(box);
  if (reframe) frame(centre, shown.front + 0.6, 0.35);
}

/** Looks at `centre` from `yaw` round (0: from the front) and `pitch` above level. */
function frame(centre: THREE.Vector3, yaw: number, pitch: number): void {
  // Far enough for all of it to fit in what is left free, up and down and across.
  resize();
  const a = freeArea();
  const w = container.clientWidth;
  const h = container.clientHeight;
  const tall = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const half = Math.min((tall * (a.y1 - a.y0)) / h, (tall * camera.aspect * (a.x1 - a.x0)) / w);
  const dist = (radius / Math.sin(Math.atan(half))) * 1.08;
  // Local -z is the front: straight on looks along +z turned by the yaw.
  const dir = new THREE.Vector3(
    -Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  );
  camera.position.copy(centre).addScaledVector(dir, dist);
  camera.near = Math.max(0.005, radius / 50);
  camera.far = Math.max(50, dist * 20);
  camera.updateProjectionMatrix();
  controls.target.copy(centre);
  controls.minDistance = radius * 0.6;
  controls.maxDistance = dist * 5;
  camera.lookAt(centre);
  controls.update();
}

/** The camera's turn about y, from the model's front, as `frame` takes it. */
const SIDES: Record<string, [number, number]> = {
  Front: [0, 0.15],
  Back: [Math.PI, 0.15],
  Left: [-Math.PI / 2, 0.15],
  Right: [Math.PI / 2, 0.15],
  Top: [0.0001, Math.PI / 2 - 0.05],
  Corner: [0.6, 0.35],
};
for (const [name, [yaw, pitch]] of Object.entries(SIDES)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn';
  b.textContent = name;
  b.addEventListener('click', () => {
    if (!current) return;
    const v = current.asset.variants[current.variant]!;
    holder.clear();
    const shown = v.show(holder, Number(openRange.value));
    frame(solidBox(shown.focus).getCenter(new THREE.Vector3()), shown.front + yaw, pitch);
  });
  $('av-sides').append(b);
}

variantSel.addEventListener('change', () => {
  if (!current) return;
  current.variant = Number(variantSel.value);
  openRange.value = '0';
  show(true);
});
openRange.addEventListener('input', () => show(false));
spin.addEventListener('change', () => (controls.autoRotate = spin.checked));

window.addEventListener(
  'keydown',
  (e) => {
    if (!isOpen || e.target instanceof HTMLSelectElement) return;
    const typing = e.target instanceof HTMLInputElement && e.target.type !== 'range';
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const order = listed();
      if (!order.length) return;
      const at = current ? order.findIndex((a) => a.id === current!.asset.id) : -1;
      const i = at + (e.key === 'ArrowDown' ? 1 : -1);
      select(order[(i + order.length) % order.length]!);
    } else if (!typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      // A quarter turn round the model.
      const off = camera.position.clone().sub(controls.target);
      off.applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        ((e.key === 'ArrowLeft' ? -1 : 1) * Math.PI) / 2,
      );
      camera.position.copy(controls.target).add(off);
      controls.update();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  },
  true,
);

// ------------------------------------------------------------------ in and out

/** The app bar's height, in the top right corner. */
const APP_BAR = 64;

/**
 * The part of the screen the panel and the info box leave free: the panel is down the left or,
 * on a phone, a sheet along the bottom; the info box is along the bottom or under the app bar.
 */
function freeArea(): { x0: number; x1: number; y0: number; y1: number } {
  const w = container.clientWidth;
  const h = container.clientHeight;
  const p = panel.getBoundingClientRect();
  const i = info.getBoundingClientRect();
  const a = { x0: 0, x1: w, y0: APP_BAR, y1: h };
  if (p.width >= w - 1) a.y1 = p.top;
  else a.x0 = p.right;
  if (i.top > h / 2) a.y1 = Math.min(a.y1, i.top);
  else a.y0 = i.bottom;
  // Never so small the model cannot be seen.
  if (a.x1 - a.x0 < w / 4) a.x0 = 0;
  if (a.y1 - a.y0 < h / 4) [a.y0, a.y1] = [0, h];
  return a;
}

function resize(): void {
  if (!isOpen) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  // The model in the middle of what is left free.
  const a = freeArea();
  camera.setViewOffset(w, h, w / 2 - (a.x0 + a.x1) / 2, h / 2 - (a.y0 + a.y1) / 2, w, h);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

function draw(): void {
  controls.update();
  view.render();
}

let loaded: Promise<unknown> | null = null;
/** Where the game's canvas lives while the viewer is shut. */
let canvasHome: HTMLElement | null = null;

/** Shows the viewer, drawing on the game's canvas; the catalogue is made the first time. */
export function showAssets(): void {
  isOpen = true;
  root.classList.remove('hidden');
  canvasHome = renderer.domElement.parentElement;
  container.append(renderer.domElement);
  view.showStudio(stage);
  controls.enabled = true;
  resize();
  loaded ??= loadCatalogue((all) => {
    assets = all;
    drawList();
    if (!current) {
      const first = assets.find((a) => a.id === 'player') ?? assets[0];
      if (first && isOpen) select(first);
    }
  }).then(() => (loading.hidden = true));
  if (current) show(false);
  renderer.setAnimationLoop(draw);
}

/** Hides the viewer and stops drawing it. What was picked stays for next time. */
export function hideAssets(): void {
  isOpen = false;
  root.classList.add('hidden');
  renderer.setAnimationLoop(null);
  controls.enabled = false;
  holder.clear();
  // The view puts its lens back as it was.
  view.hideStudio();
  canvasHome?.append(renderer.domElement);
}

/** For scripts (screenshots, checks): the list, and showing one by id. */
Object.assign(window, {
  assetViewer: {
    assets: () =>
      assets.map((a) => ({
        id: a.id,
        name: a.name,
        group: a.group,
        variants: a.variants.map((v) => v.label),
      })),
    show: (id: string, variant = 0) => {
      const a = assets.find((x) => x.id === id);
      if (a) select(a, variant);
      return !!a;
    },
    loaded: () => loaded,
  },
});
