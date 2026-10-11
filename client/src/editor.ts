import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  BRICK_TYPES,
  BrickGrid,
  COLOURS,
  BUILDS,
  allBins,
  buildById,
  computeLayerSnap,
  computeSnap,
  localCentre,
  partQuat,
  parseBuildFile,
  stringifyBuildFile,
  snapLayer,
  validateBuild,
} from '@sar/shared';
import type {
  BrickTypeId,
  ColourId,
  PlacedBrick,
  Prints,
  Rotation,
  SnapLayer,
  TargetBuild,
} from '@sar/shared';
import { baseplateMarker, brickGeometry, brickMaterial } from './render/bricks.ts';
import { addBrickMesh } from './render/pages.ts';
import { ScreenPass } from './render/styles.ts';
import { loadSettings } from './settings.ts';
import { brickThumb, clearBrickThumbs } from './ui/brickThumbs.ts';
import {
  BRICK_KINDS,
  COLOUR_GROUPS,
  HEIGHTS,
  allSizes,
  brickShown,
  colourShown,
  loadFavourites,
  saveFavourites,
} from './ui/brickFinder.ts';
import type { BrickFilter, ColourFilter, Height } from './ui/brickFinder.ts';
import { brickName, createBrickViewer } from './ui/brickViewer.ts';

/**
 * In-browser editor for target builds, opened from the main menu. Uses the same grid and snapping rules as the game,
 * without physics. It imports and exports build files (docs/07-build-file-format.md), and still
 * reads the bare `TargetBuild` JSON it used to write.
 */

type EditorBrick = PlacedBrick & { step: number };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const typeList = $('ed-types');
const colourList = $('ed-colours');
const stepEl = $('ed-step');
const onlyStep = $<HTMLInputElement>('ed-only-step');
const withPrints = $<HTMLInputElement>('ed-with-prints');
const summary = $('ed-summary');
const json = $<HTMLTextAreaElement>('ed-json');
const nameInput = $<HTMLInputElement>('ed-name');

// ------------------------------------------------------------------ pickers

/** The brick and colour new bricks are placed in. */
let type: BrickTypeId = '2x4';
let colour: ColourId = 'red';

const colourName = (c: ColourId) => c.replaceAll('-', ' ');

/** One picture button in a picker list. */
function pickerItem(list: HTMLElement, label: string, onPick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('role', 'option');
  b.title = label;
  b.setAttribute('aria-label', label);
  b.append(document.createElement('img'));
  b.addEventListener('click', onPick);
  list.append(b);
  return b;
}

// Every brick type, drawn in the chosen colour.
const typeItems = new Map<BrickTypeId, HTMLButtonElement>();
for (const t of Object.values(BRICK_TYPES)) {
  if (t.fixture) continue;
  typeItems.set(
    t.id,
    pickerItem(typeList, brickName(t.id), () => setType(t.id)),
  );
}
// Every colour, as a 2x2 brick in it, so see-through ones look see-through.
const colourItems = new Map<ColourId, HTMLButtonElement>();
for (const c of Object.values(COLOURS)) {
  colourItems.set(
    c.id,
    pickerItem(colourList, colourName(c.id), () => setColour(c.id)),
  );
}

function markChosen<K>(items: Map<K, HTMLButtonElement>, chosen: K): void {
  for (const [k, b] of items) b.setAttribute('aria-selected', String(k === chosen));
  const b = items.get(chosen);
  if (b && !b.hidden) b.scrollIntoView({ block: 'nearest' });
}

function setType(t: BrickTypeId): void {
  type = t;
  $('ed-type-name').textContent = brickName(t);
  markChosen(typeItems, t);
  showFavourite(typeFav, favourites.bricks.has(t));
}

function setColour(c: ColourId): void {
  colour = c;
  $('ed-colour-name').textContent = colourName(c);
  markChosen(colourItems, c);
  showFavourite(colourFav, favourites.colours.has(c));
  drawTypeThumbs();
}

/**
 * Pictures of the bricks in the list now, in the chosen colour; the rest wait until shown. None
 * while the editor is closed: opening it draws them all afresh.
 */
function drawTypeThumbs(): void {
  if ($('editor').classList.contains('hidden')) return;
  for (const [t, b] of typeItems) {
    if (b.hidden) continue;
    const src = brickThumb(t, colour);
    const img = b.querySelector('img')!;
    if (img.getAttribute('src') !== src) img.src = src;
  }
}

/** Draws every picture afresh, from the brick materials as they are now. */
function drawPickers(): void {
  clearBrickThumbs();
  for (const [c, b] of colourItems) b.querySelector('img')!.src = brickThumb('2x2', c, 64);
  setColour(colour);
  setType(type);
}

// ------------------------------------------------------------------ finding

const favourites = loadFavourites();
const typeFav = $<HTMLButtonElement>('ed-type-fav');
const colourFav = $<HTMLButtonElement>('ed-colour-fav');
const typeSearch = $<HTMLInputElement>('ed-type-search');
const colourSearch = $<HTMLInputElement>('ed-colour-search');
const sizeSel = $<HTMLSelectElement>('ed-type-size');
const heightSel = $<HTMLSelectElement>('ed-type-height');
const brickFilter: BrickFilter = {
  query: '',
  kind: null,
  size: null,
  height: null,
  favouritesOnly: false,
};
const colourFilter: ColourFilter = { query: '', group: null, favouritesOnly: false };

function showFavourite(btn: HTMLButtonElement, on: boolean): void {
  btn.textContent = on ? '★' : '☆';
  btn.setAttribute('aria-pressed', String(on));
  const what = btn === typeFav ? 'brick' : 'colour';
  btn.title = on
    ? `Take this ${what} out of your favourites`
    : `Add this ${what} to your favourites`;
  btn.setAttribute('aria-label', btn.title);
}

/**
 * A row of toggle chips: the first is Favourites, on its own; the others pick one of `options`
 * (pressing the one that is on again turns it off).
 */
function chipRow<K extends string>(
  row: HTMLElement,
  options: { id: K; label: string }[],
  onChange: (favouritesOnly: boolean, picked: K | null) => void,
): void {
  let favouritesOnly = false;
  let picked: K | null = null;
  const chip = (label: string, title?: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = label;
    b.setAttribute('aria-pressed', 'false');
    if (title) {
      b.title = title;
      b.setAttribute('aria-label', title);
    }
    row.append(b);
    return b;
  };
  const fav = chip('★', 'Favourites only');
  fav.classList.add('fav-chip');
  const chips = options.map((o) => ({ id: o.id, b: chip(o.label) }));
  const show = () => {
    fav.setAttribute('aria-pressed', String(favouritesOnly));
    for (const c of chips) c.b.setAttribute('aria-pressed', String(c.id === picked));
    onChange(favouritesOnly, picked);
  };
  fav.addEventListener('click', () => {
    favouritesOnly = !favouritesOnly;
    show();
  });
  for (const c of chips) {
    c.b.addEventListener('click', () => {
      picked = picked === c.id ? null : c.id;
      show();
    });
  }
}

/**
 * Shows the items the filter lets through, favourites first, each favourite starred. `none`
 * says so when nothing is left.
 */
function applyFilter<K extends string>(
  items: Map<K, HTMLButtonElement>,
  list: HTMLElement,
  starred: ReadonlySet<string>,
  shown: (k: K) => boolean,
  none: HTMLElement,
): void {
  let any = false;
  const order = [...items.keys()];
  // Favourites first, the rest in catalogue order.
  for (const k of [
    ...order.filter((k) => starred.has(k)),
    ...order.filter((k) => !starred.has(k)),
  ]) {
    const b = items.get(k)!;
    b.hidden = !shown(k);
    b.classList.toggle('starred', starred.has(k));
    any ||= !b.hidden;
    list.append(b);
  }
  none.hidden = any;
  list.hidden = !any;
}

function filterTypes(): void {
  applyFilter(
    typeItems,
    typeList,
    favourites.bricks,
    (t) => brickShown(t, brickName(t), brickFilter, favourites.bricks),
    $('ed-types-none'),
  );
  drawTypeThumbs();
}

function filterColours(): void {
  applyFilter(
    colourItems,
    colourList,
    favourites.colours,
    (c) => colourShown(c, colourFilter, favourites.colours),
    $('ed-colours-none'),
  );
}

chipRow($('ed-type-kinds'), BRICK_KINDS, (favouritesOnly, kind) => {
  brickFilter.favouritesOnly = favouritesOnly;
  brickFilter.kind = kind;
  filterTypes();
});
chipRow($('ed-colour-groups'), COLOUR_GROUPS, (favouritesOnly, group) => {
  colourFilter.favouritesOnly = favouritesOnly;
  colourFilter.group = group;
  filterColours();
});
for (const s of allSizes([...typeItems.keys()])) sizeSel.add(new Option(s, s));
for (const h of HEIGHTS) heightSel.add(new Option(h.label, h.id));
sizeSel.addEventListener('change', () => {
  brickFilter.size = sizeSel.value || null;
  filterTypes();
});
heightSel.addEventListener('change', () => {
  brickFilter.height = (heightSel.value || null) as Height | null;
  filterTypes();
});
typeSearch.addEventListener('input', () => {
  brickFilter.query = typeSearch.value;
  filterTypes();
});
colourSearch.addEventListener('input', () => {
  colourFilter.query = colourSearch.value;
  filterColours();
});
/** The match Enter picks: one named just what was typed, or else the first in the list. */
function bestMatch<K>(items: Map<K, HTMLButtonElement>, query: string): K | undefined {
  const typed = query.trim().toLowerCase().replaceAll('x', '×');
  const shown = [...items].filter(([, b]) => !b.hidden);
  const named = (b: HTMLButtonElement) => b.title.toLowerCase();
  return (shown.find(([, b]) => named(b) === typed) ??
    shown.find(([, b]) => named(b).startsWith(typed)) ??
    shown[0])?.[0];
}
typeSearch.addEventListener('keydown', (e) => {
  const t = e.key === 'Enter' && bestMatch(typeItems, typeSearch.value);
  if (t) setType(t);
});
colourSearch.addEventListener('keydown', (e) => {
  const c = e.key === 'Enter' && bestMatch(colourItems, colourSearch.value.replaceAll('-', ' '));
  if (c) setColour(c);
});

typeFav.addEventListener('click', () => {
  if (!favourites.bricks.delete(type)) favourites.bricks.add(type);
  saveFavourites(favourites);
  showFavourite(typeFav, favourites.bricks.has(type));
  filterTypes();
});
colourFav.addEventListener('click', () => {
  if (!favourites.colours.delete(colour)) favourites.colours.add(colour);
  saveFavourites(favourites);
  showFavourite(colourFav, favourites.colours.has(colour));
  filterColours();
});
filterTypes();
filterColours();

// ------------------------------------------------------------------ state

const PLATE: PlacedBrick = {
  id: 0,
  type: 'baseplate16',
  colour: 'baseplate-green',
  x: 0,
  y: 0,
  z: 0,
  rot: 0,
};
let grid = BrickGrid.from([PLATE]);
const steps = new Map<number, number>(); // brick id -> step
let nextId = 1;
let step = 0;
let rot: Rotation = 0;
/** What the last loaded build had besides its bricks, kept so an export does not lose it. */
let extras: Pick<TargetBuild, 'author' | 'description' | 'cover' | 'pages' | 'svgs'> = {};
/** The prints of the loaded build's bricks, by brick id. A brick placed here has none. */
const prints = new Map<number, Prints>();
/** The name as of the last change to it that undo knows about (typing commits on leaving the box). */
let name = nameInput.value;

// ------------------------------------------------------------------ undo

/** Everything a change to the build can touch, to put back on undo or redo. */
type Snapshot = {
  bricks: PlacedBrick[];
  steps: [number, number][];
  prints: [number, Prints][];
  nextId: number;
  step: number;
  extras: typeof extras;
  name: string;
};

const HISTORY = 200;
const undoStack: Snapshot[] = [];
const redoStack: Snapshot[] = [];
const undoBtn = $<HTMLButtonElement>('ed-undo');
const redoBtn = $<HTMLButtonElement>('ed-redo');

/** Bricks are never changed in place, only swapped, so the snapshot can share them. */
function snapshot(): Snapshot {
  return {
    bricks: [...grid.bricks.values()],
    steps: [...steps],
    prints: [...prints],
    nextId,
    step,
    extras,
    name,
  };
}

function restore(s: Snapshot): void {
  grid = BrickGrid.from(s.bricks);
  steps.clear();
  for (const [id, n] of s.steps) steps.set(id, n);
  prints.clear();
  for (const [id, p] of s.prints) prints.set(id, p);
  nextId = s.nextId;
  step = s.step;
  extras = s.extras;
  name = nameInput.value = s.name;
  redraw();
}

/** Remembers the build as it was before a change, so the change can be undone. */
function record(before: Snapshot = snapshot()): void {
  undoStack.push(before);
  if (undoStack.length > HISTORY) undoStack.shift();
  redoStack.length = 0;
  updateHistoryButtons();
}

function undo(): void {
  const s = undoStack.pop();
  if (!s) return;
  redoStack.push(snapshot());
  restore(s);
  updateHistoryButtons();
}

function redo(): void {
  const s = redoStack.pop();
  if (!s) return;
  undoStack.push(snapshot());
  restore(s);
  updateHistoryButtons();
}

function updateHistoryButtons(): void {
  undoBtn.disabled = undoStack.length === 0;
  redoBtn.disabled = redoStack.length === 0;
}

// ------------------------------------------------------------------ scene

const root = $('editor');
const container = $('editor-view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe9e4d8);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(3, 6, 4);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 50);
camera.position.set(2.6, 2.2, 3.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0.8, 0.3, 0.8);
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: null };
// One finger orbits by hand like the mouse (below); two pinch to zoom and pan.
controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_PAN };
controls.update();

const model = new THREE.Group();
scene.add(model);
const ghostMat = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
});
const ghost = new THREE.Mesh(brickGeometry('1x1'), ghostMat);
ghost.visible = false;
scene.add(ghost);

/** In the theme graphics style, the build is drawn like the interface theme too. */
let themePass: ScreenPass | null = null;

function draw(): void {
  renderer.setRenderTarget(themePass?.target ?? null);
  renderer.render(scene, camera);
  themePass?.render(renderer);
}

/** Phones: the panel covers much of the view (a side page, or a sheet at the bottom). */
const smallScreen = matchMedia('(max-width: 600px), (max-height: 500px)');

function resize(): void {
  if (root.classList.contains('hidden')) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  // On a phone, centre the build in the part of the screen the panel leaves free.
  const panel = $('editor-panel').getBoundingClientRect();
  if (!smallScreen.matches) camera.clearViewOffset();
  else if (panel.width >= w - 1) camera.setViewOffset(w, h, 0, (h - panel.top) / 2, w, h);
  else camera.setViewOffset(w, h, -panel.right / 2, 0, w, h);
  camera.updateProjectionMatrix();
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  themePass?.setSize(size.x, size.y);
}
window.addEventListener('resize', resize);
resize();

const fadedCache = new Map<ColourId, THREE.Material>();
const faded = (c: ColourId) => {
  let m = fadedCache.get(c);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: COLOURS[c].hex, transparent: true, opacity: 0.25 });
    fadedCache.set(c, m);
  }
  return m;
};

/** Rebuilds the meshes. Each mesh remembers its brick id for picking. */
function redraw(): void {
  model.clear();
  model.add(baseplateMarker());
  for (const b of grid.bricks.values()) {
    const s = steps.get(b.id) ?? -1;
    if (onlyStep.checked && s > step) continue;
    const current = s === step;
    const printed = withPrints.checked ? prints.get(b.id) : undefined;
    const mesh = addBrickMesh(
      model,
      printed ? { ...b, prints: printed } : b,
      s >= 0 && s < step && onlyStep.checked ? faded(b.colour) : brickMaterial(b.colour),
      current,
      extras.svgs,
    );
    mesh.userData.brickId = b.id;
  }
  stepEl.textContent = String(step + 1);
  updateSummary();
}

function currentBuild(): TargetBuild {
  const bySteps: EditorBrick[][] = [];
  for (const b of grid.bricks.values()) {
    if (BRICK_TYPES[b.type].fixture) continue;
    const s = steps.get(b.id) ?? 0;
    (bySteps[s] ??= []).push({ ...b, step: s });
  }
  const { svgs, ...rest } = extras;
  const printing = withPrints.checked && svgs !== undefined;
  return {
    id:
      nameInput.value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-') || 'build',
    name: nameInput.value.trim() || 'Build',
    ...rest,
    ...(printing ? { svgs } : {}),
    // Drop empty steps so numbering stays contiguous.
    steps: bySteps
      .filter((s) => s && s.length)
      .map((s) => ({
        bricks: s
          // Bottom up, but parts clipped on sideways last: one can hang lower than its studs.
          .sort(
            (a, b) => Number(!!a.face) - Number(!!b.face) || a.y - b.y || a.x - b.x || a.z - b.z,
          )
          .map(({ id, type, colour, x, y, z, rot, face }) => {
            const brick: TargetBuild['steps'][number]['bricks'][number] = {
              type,
              colour,
              x,
              y,
              z,
              rot,
            };
            if (face) brick.face = face;
            const p = printing ? prints.get(id) : undefined;
            if (p) brick.prints = p;
            return brick;
          }),
      })),
  };
}

function updateSummary(): void {
  const build = currentBuild();
  const total = build.steps.reduce((n, s) => n + s.bricks.length, 0);
  const lines = [`${total} bricks in ${build.steps.length} steps`];
  build.steps.forEach((s, i) => lines.push(`  step ${i + 1}: ${s.bricks.length} bricks`));
  summary.textContent = lines.join('\n');
  for (const p of validateBuild(build)) {
    const warn = document.createElement('div');
    warn.className = 'warn';
    warn.textContent = `⚠ step ${p.step + 1}${p.brick >= 0 ? `, brick ${p.brick + 1}` : ''}: ${p.message}`;
    summary.append(warn);
  }
}

/** Loads a build in place of this one. It can be undone, like any other change. */
function load(build: TargetBuild): void {
  record();
  grid = BrickGrid.from([PLATE]);
  steps.clear();
  prints.clear();
  nextId = 1;
  build.steps.forEach((s, i) => {
    for (const { prints: p, ...b } of s.bricks) {
      const id = nextId++;
      grid.insert({ ...b, id });
      steps.set(id, i);
      if (p) prints.set(id, p);
    }
  });
  name = nameInput.value = build.name;
  const { author, description, cover, pages, svgs } = build;
  extras = {};
  if (svgs) extras.svgs = svgs;
  if (author) extras.author = author;
  if (description) extras.description = description;
  if (cover) extras.cover = cover;
  if (pages) extras.pages = pages;
  step = Math.max(0, build.steps.length - 1);
  redraw();
}

// ------------------------------------------------------------------ input

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function pick(
  e: MouseEvent,
): { point: THREE.Vector3; normal: THREE.Vector3; brickId?: number } | null {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(model.children, false).find((h) => h.face);
  if (!hit) return null;
  const brickId = hit.object.userData.brickId as number | undefined;
  const body = (hit.object as THREE.Mesh).geometry.userData.body as THREE.Box3 | undefined;
  if (body) {
    // Bricks are hollow underneath; a ray that enters through the open bottom should
    // still count as hitting the bottom face, so test it against the solid body too.
    const toLocal = hit.object.matrixWorld.clone().invert();
    const ray = raycaster.ray.clone().applyMatrix4(toLocal);
    const entry = ray.intersectBox(body, new THREE.Vector3());
    if (entry) {
      const point = entry.clone().applyMatrix4(hit.object.matrixWorld);
      if (point.distanceTo(raycaster.ray.origin) < hit.distance - 1e-4) {
        const size = body.getSize(new THREE.Vector3());
        const rel = entry.clone().sub(body.getCenter(new THREE.Vector3())).divide(size);
        const axis = (['x', 'y', 'z'] as const).reduce((a, b) =>
          Math.abs(rel[b]) > Math.abs(rel[a]) ? b : a,
        );
        const local = new THREE.Vector3();
        local[axis] = Math.sign(rel[axis]);
        const normal = local.transformDirection(hit.object.matrixWorld);
        return { point, normal, brickId };
      }
    }
  }
  const normal = hit.face!.normal.clone().transformDirection(hit.object.matrixWorld);
  return { point: hit.point, normal, brickId };
}

/** The layer Shift locks snapping to: where the brick snapped as the key went down. */
let lock: SnapLayer | null = null;
/** On a touch screen, with no Shift key or right click: the Same layer and Remove buttons. */
let sameLayer = false;
let removing = false;

function preview(e: MouseEvent) {
  const hit = pick(e);
  const shift = e.shiftKey || sameLayer;
  if (!shift) lock = null;
  else if (lock) {
    // Keep to the locked layer for as long as the brick still clutches something there.
    const { origin, direction } = raycaster.ray;
    const one = [{ type, rot: 0 as Rotation, x: 0, y: 0, z: 0 }];
    const p = computeLayerSnap(grid, origin, direction, one, rot, lock)?.[0];
    if (p) return { ...p, colour };
  }
  const p = hit && computeSnap(grid, hit.point, hit.normal, type, rot);
  if (shift && !lock && hit && p) lock = snapLayer(hit.point, hit.normal);
  return p ? { ...p, colour } : null;
}

let downAt: { x: number; y: number } | null = null;
let dragging = false;
/** Fingers on the view: a second one turns the gesture into a pinch, never a tap. */
const fingers = new Set<number>();
/** Where each pointer was at its last move. */
const lastAt = new Map<number, { x: number; y: number }>();
renderer.domElement.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY };
  lastAt.set(e.pointerId, downAt);
  if (e.pointerType !== 'touch') return;
  fingers.add(e.pointerId);
  if (fingers.size > 1) dragging = true;
});
const lift = (e: PointerEvent) => {
  fingers.delete(e.pointerId);
  lastAt.delete(e.pointerId);
};
renderer.domElement.addEventListener('pointercancel', (e) => {
  lift(e);
  dragging = fingers.size > 0;
  downAt = null;
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

// Left drag orbits by hand so a click (no drag) can place bricks.
renderer.domElement.addEventListener('pointermove', (e) => {
  if (downAt && e.buttons === 1) {
    const dx = e.clientX - downAt.x;
    const dy = e.clientY - downAt.y;
    // Since the last move of this pointer (a finger's movementX is not reliable everywhere).
    const last = lastAt.get(e.pointerId) ?? { x: e.clientX, y: e.clientY };
    lastAt.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Two fingers: the orbit controls pinch and pan.
    if (fingers.size > 1) return;
    if (dragging || Math.hypot(dx, dy) > (e.pointerType === 'touch' ? 10 : 4)) {
      dragging = true;
      const offset = camera.position.clone().sub(controls.target);
      const sph = new THREE.Spherical().setFromVector3(offset);
      sph.theta -= (e.clientX - last.x) * 0.008;
      sph.phi = Math.min(1.5, Math.max(0.1, sph.phi - (e.clientY - last.y) * 0.008));
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph));
      camera.lookAt(controls.target);
    }
    ghost.visible = false;
    return;
  }
  const p = preview(e);
  ghost.visible = p !== null;
  if (p) {
    const c = localCentre(p);
    const q = partQuat(p);
    ghost.geometry = brickGeometry(p.type);
    ghost.position.set(c.x, c.y, c.z);
    ghost.quaternion.set(q.x, q.y, q.z, q.w);
    ghostMat.color.setHex(COLOURS[p.colour].hex);
  }
});

renderer.domElement.addEventListener('pointerup', (e) => {
  lift(e);
  // A pinch ends one finger at a time: none of them places a brick.
  const wasDrag = dragging;
  dragging = fingers.size > 0 && dragging;
  downAt = null;
  // A finger leaves no hover behind, so no ghost either.
  if (e.pointerType === 'touch') ghost.visible = false;
  if (wasDrag) return;
  if (e.button === 0 && !removing) {
    const p = preview(e);
    if (!p) return;
    const before = snapshot();
    const id = nextId++;
    if (!grid.add({ ...p, id }).ok) {
      nextId = before.nextId;
      return;
    }
    steps.set(id, step);
    record(before);
    redraw();
  } else if (e.button === 2 || (e.button === 0 && removing)) {
    const hit = pick(e);
    if (hit?.brickId === undefined || hit.brickId === PLATE.id) return;
    record();
    grid.remove(hit.brickId);
    steps.delete(hit.brickId);
    redraw();
  }
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (viewer.isOpen || root.classList.contains('hidden')) return;
  // Ctrl+Z (Cmd+Z on a Mac) undoes; with Shift, or Ctrl+Y, redoes.
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyZ' || e.code === 'KeyY')) {
    e.preventDefault();
    if (e.code === 'KeyY' || e.shiftKey) redo();
    else undo();
    return;
  }
  if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) rotate();
});

function rotate(): void {
  rot = ((rot + 1) % 4) as Rotation;
}

// The touch tools: place or remove, rotate, and keep to the layer.
const placeBtn = $<HTMLButtonElement>('ed-mode-place');
const removeBtn = $<HTMLButtonElement>('ed-mode-remove');
const layerBtn = $<HTMLButtonElement>('ed-layer');
function setRemoving(on: boolean): void {
  removing = on;
  placeBtn.classList.toggle('on', !on);
  placeBtn.setAttribute('aria-pressed', String(!on));
  removeBtn.classList.toggle('on', on);
  removeBtn.setAttribute('aria-pressed', String(on));
}
placeBtn.addEventListener('click', () => setRemoving(false));
removeBtn.addEventListener('click', () => setRemoving(true));
$('ed-rotate').addEventListener('click', rotate);
layerBtn.addEventListener('click', () => {
  sameLayer = !sameLayer;
  lock = null;
  layerBtn.classList.toggle('on', sameLayer);
  layerBtn.setAttribute('aria-pressed', String(sameLayer));
});

$('ed-step-prev').addEventListener('click', () => {
  step = Math.max(0, step - 1);
  redraw();
});
$('ed-step-next').addEventListener('click', () => {
  step++;
  redraw();
});
onlyStep.addEventListener('change', redraw);
withPrints.addEventListener('change', redraw);
nameInput.addEventListener('input', updateSummary);
// A renaming is one change when the box is left, not one per letter.
nameInput.addEventListener('change', () => {
  if (nameInput.value === name) return;
  const before = snapshot();
  name = nameInput.value;
  record(before);
});
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);
$('ed-export').addEventListener('click', () => {
  const build = currentBuild();
  // Page extras only line up with the steps if no step was added or emptied since loading.
  if (build.pages && build.pages.length !== build.steps.length) delete build.pages;
  json.value = stringifyBuildFile(build);
  json.select();
});
$('ed-import').addEventListener('click', () => {
  // The editor has no bins, so a build file is checked for everything but those.
  const r = parseBuildFile(json.value, allBins());
  if (r.ok) return load(r.build);
  // Not a valid build file: load what the bricks are anyway, so the problems can be fixed here.
  const loose = looseBuild(json.value);
  if (loose) load(loose);
  alert(
    `${loose ? 'Loaded, but this' : 'This'} is not a valid build file:\n` +
      r.problems.slice(0, 8).join('\n'),
  );
});

/** The bricks of a build file or a bare `TargetBuild`, without checking them. */
function looseBuild(text: string): TargetBuild | null {
  try {
    const data = JSON.parse(text) as {
      build?: { id?: string; name?: string };
      manual?: { pages?: { bricks?: TargetBuild['steps'][number]['bricks'] }[] };
      id?: string;
      name?: string;
      steps?: TargetBuild['steps'];
    };
    if (Array.isArray(data.manual?.pages)) {
      return {
        id: data.build?.id ?? 'build',
        name: data.build?.name ?? 'Build',
        steps: data.manual.pages.map((p) => ({ bricks: Array.isArray(p.bricks) ? p.bricks : [] })),
      };
    }
    if (Array.isArray(data.steps)) {
      return { id: data.id ?? 'build', name: data.name ?? 'Build', steps: data.steps };
    }
  } catch {
    // Not JSON at all.
  }
  return null;
}
const loadSel = $<HTMLSelectElement>('ed-load-build');
for (const b of BUILDS) loadSel.add(new Option(b.name, b.id));
loadSel.addEventListener('change', () => {
  const b = buildById(loadSel.value);
  if (b) load(b);
  loadSel.value = '';
});
// No confirmation: a clear is one step in the history, so Undo brings the build back.
$('ed-clear').addEventListener('click', () => {
  if (steps.size) load({ id: 'build', name: nameInput.value, steps: [] });
});

const viewer = createBrickViewer({
  onUse(t, c) {
    setColour(c);
    setType(t);
  },
});
$('ed-view-bricks').addEventListener('click', () => viewer.show(type, colour));

Object.assign(window, { __editor: { load, currentBuild, undo, redo, camera, controls, viewer } });

redraw();
updateHistoryButtons();

/** Shows the editor, as the game's build editor screen. */
export function showEditor(): void {
  root.classList.remove('hidden');
  const themed = loadSettings().graphics.style === 'theme';
  if (themed && !themePass) themePass = new ScreenPass(renderer, camera, 'theme', true);
  if (!themed && themePass) {
    themePass.dispose();
    themePass = null;
  }
  resize();
  drawPickers();
  // Showing the chosen brick and colour can scroll the panel itself; start it at the top.
  $('editor-panel').scrollTop = 0;
  renderer.setAnimationLoop(draw);
}

/** Hides the editor and stops drawing it. The build stays as it was for next time. */
export function hideEditor(): void {
  if (viewer.isOpen) viewer.close();
  root.classList.add('hidden');
  renderer.setAnimationLoop(null);
}
