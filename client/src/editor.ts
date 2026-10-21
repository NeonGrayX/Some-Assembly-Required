import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  BRICK_TYPES,
  BrickGrid,
  COLOURS,
  BUILDS,
  aimAtBricks,
  allBins,
  buildById,
  computeLayerSnap,
  canFlip,
  computeSnap,
  localCentre,
  partQuat,
  parseBuildFile,
  stringifyBuildFile,
  stringifyBuildFileWithMap,
  snapLayer,
  attachOrder,
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
import { addBrickMesh, addGhostMesh } from './render/pages.ts';
import { view } from './worldView.ts';
import { brickThumb, clearBrickThumbs } from './ui/brickThumbs.ts';
import {
  BRICK_KINDS,
  COLOUR_GROUPS,
  HEIGHTS,
  allSizes,
  brickShown,
  catalogueOrder,
  colourShown,
  isHeight,
  loadFavourites,
  saveFavourites,
} from './ui/brickFinder.ts';
import type { BrickFilter, ColourFilter } from './ui/brickFinder.ts';
import { brickName, createBrickViewer } from './ui/brickViewer.ts';

/**
 * In-browser editor for target builds, opened from the main menu. Uses the same grid, aiming and
 * snapping rules as the game, without physics, and is drawn by the game's view on a map of its
 * own (`View.showStudio`): the build under an even light, moved by hand instead of by a player. It imports and exports build files (docs/07-build-file-format.md), and still
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
/** The part to place goes on by its other hole (a headlight brick's back, see `canFlip`). */
let flip = false;
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
for (const id of catalogueOrder()) {
  if (BRICK_TYPES[id].fixture) continue;
  typeItems.set(
    id,
    pickerItem(typeList, brickName(id), () => setType(id)),
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
  if (b && !b.hidden) scrollListTo(b);
}

/**
 * Scrolls the list a picker item is in just far enough to show it. Only the list: the
 * browser's scrollIntoView also scrolls the panel around it (and the sheet it is in on a phone).
 */
function scrollListTo(item: HTMLElement): void {
  const list = item.parentElement!;
  const box = list.getBoundingClientRect();
  const at = item.getBoundingClientRect();
  if (at.top < box.top) list.scrollTop -= box.top - at.top;
  else if (at.bottom > box.bottom) list.scrollTop += at.bottom - box.bottom;
}

function setType(t: BrickTypeId): void {
  // A part picked goes on by its bottom.
  if (t !== type && flip) setFlip(false);
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
  brickFilter.height = isHeight(heightSel.value) ? heightSel.value : null;
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
/** The view, under the panel. The game's canvas is moved in here while the editor is open. */
const container = $('editor-view');
const { renderer, camera } = view;
/** What the editor puts on its map: the build, and the marks over it. */
const stage = new THREE.Group();
/** Where the camera is while the editor is shut (the game moves the one camera meanwhile). */
const lens = { at: new THREE.Vector3(2.6, 2.2, 3.2), far: 50 };
// Only the editor's own view moves the camera: its listeners are on that, not on the canvas.
const controls = new OrbitControls(camera, container);
controls.enabled = false;
controls.target.set(0.8, 0.3, 0.8);
// The scroll wheel zooms; the buttons orbit and pan by hand, below.
controls.mouseButtons = { LEFT: null, MIDDLE: null, RIGHT: null };
// One finger orbits by hand like the mouse (below); two pinch to zoom and pan.
controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_PAN };

const model = new THREE.Group();
stage.add(model);
// Drawn as the game draws where a held brick would snap.
const ghost = new THREE.Mesh(brickGeometry('1x1'), view.ghostMaterial('white'));
ghost.visible = false;
stage.add(ghost);
/** The brick whose line the cursor is on in the live build file, drawn over everything. */
const marked = new THREE.Mesh(
  brickGeometry('1x1'),
  new THREE.MeshBasicMaterial({
    color: 0xffc400,
    transparent: true,
    opacity: 0.55,
    depthTest: false,
  }),
);
marked.renderOrder = 10;
marked.visible = false;
stage.add(marked);
/** The brick a click would pick, while the pipette is on or Alt is held. */
const pickMark = new THREE.Mesh(
  brickGeometry('1x1'),
  new THREE.MeshBasicMaterial({
    color: 0x3ad7ff,
    transparent: true,
    opacity: 0.5,
    depthTest: false,
  }),
);
pickMark.renderOrder = 11;
pickMark.visible = false;
stage.add(pickMark);

/** Puts a marker mesh over a brick of the build. */
function cover(mesh: THREE.Mesh, b: PlacedBrick): void {
  const c = localCentre(b);
  const q = partQuat(b);
  mesh.geometry = brickGeometry(b.type);
  mesh.position.set(c.x, c.y, c.z);
  mesh.quaternion.set(q.x, q.y, q.z, q.w);
}

function draw(): void {
  seePlateFromBelow();
  view.render();
}

/** Phones: the panel covers much of the view (a side page, or a sheet at the bottom). */
const smallScreen = matchMedia('(max-width: 600px), (max-height: 500px)');

function resize(): void {
  if (root.classList.contains('hidden')) return;
  // The view sizes the canvas to the window, as the editor's view is.
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  // On a phone, centre the build in the part of the screen the panel leaves free.
  const panel = $('editor-panel').getBoundingClientRect();
  if (!smallScreen.matches) camera.clearViewOffset();
  else if (panel.width >= w - 1) camera.setViewOffset(w, h, 0, (h - panel.top) / 2, w, h);
  else camera.setViewOffset(w, h, -panel.right / 2, 0, w, h);
  camera.updateProjectionMatrix();
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

/** The baseplate's mesh, made see-through while the build is looked at from below. */
let plateMesh: THREE.Mesh | null = null;
let plateMaterial: THREE.Material | THREE.Material[] | null = null;

/** Seen from under the plate, the plate fades and its studs go, so the build shows through it. */
function seePlateFromBelow(): void {
  if (!plateMesh) return;
  const below = camera.position.y < 0;
  if (below === (plateMaterial !== null)) return;
  if (below) {
    plateMaterial = plateMesh.material;
    plateMesh.material = faded(PLATE.colour);
  } else {
    plateMesh.material = plateMaterial!;
    plateMaterial = null;
  }
  for (const child of plateMesh.children) child.visible = !below;
}

/** Rebuilds the meshes. Each mesh remembers its brick id for picking. */
function redraw(): void {
  model.clear();
  plateMesh = null;
  plateMaterial = null;
  model.add(baseplateMarker());
  for (const b of grid.bricks.values()) {
    const s = steps.get(b.id) ?? -1;
    if (onlyStep.checked && s > step) continue;
    const current = s === step;
    const printed = withPrints.checked ? prints.get(b.id) : undefined;
    // Earlier steps are see-through ghosts, drawn as on the results screen: no panes or prints.
    const mesh =
      s >= 0 && s < step && onlyStep.checked
        ? addGhostMesh(model, b, faded(b.colour))
        : addBrickMesh(
            model,
            printed ? { ...b, prints: printed } : b,
            brickMaterial(b.colour),
            current,
            extras.svgs,
          );
    mesh.userData.brickId = b.id;
    if (b.id === PLATE.id) plateMesh = mesh;
  }
  stepEl.textContent = String(step + 1);
  updateSummary();
  syncCode();
}

/**
 * The build as a build file has it. `order`, if given, gets the brick ids in file order. Page
 * extras only line up with the steps if no step was added or emptied since loading; otherwise
 * they are left out.
 */
function currentBuild(order?: number[]): TargetBuild {
  const bySteps: EditorBrick[][] = [];
  for (const b of grid.bricks.values()) {
    if (BRICK_TYPES[b.type].fixture) continue;
    const s = steps.get(b.id) ?? 0;
    (bySteps[s] ??= []).push({ ...b, step: s });
  }
  const { svgs, ...rest } = extras;
  const printing = withPrints.checked && svgs !== undefined;
  // Each step in an order it can be built in, on what the steps before it put down.
  const placed = BrickGrid.from([PLATE]);
  const build: TargetBuild = {
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
        bricks: attachOrder(placed, s).map(({ id, type, colour, x, y, z, rot, face, orient }) => {
          order?.push(id);
          const brick: TargetBuild['steps'][number]['bricks'][number] = {
            type,
            colour,
            x,
            y,
            z,
            rot,
          };
          if (face) brick.face = face;
          if (orient) brick.orient = orient;
          const p = printing ? prints.get(id) : undefined;
          if (p) brick.prints = p;
          return brick;
        }),
      })),
  };
  if (build.pages && build.pages.length !== build.steps.length) delete build.pages;
  return build;
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
  replaceBuild(build);
  step = Math.max(0, build.steps.length - 1);
  redraw();
}

/** Puts a build in place of this one. Returns the ids its bricks got, in file order. */
function replaceBuild(build: TargetBuild): number[] {
  grid = BrickGrid.from([PLATE]);
  steps.clear();
  prints.clear();
  nextId = 1;
  const ids: number[] = [];
  build.steps.forEach((s, i) => {
    for (const { prints: p, ...b } of s.bricks) {
      const id = nextId++;
      grid.insert({ ...b, id });
      steps.set(id, i);
      if (p) prints.set(id, p);
      ids.push(id);
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
  return ids;
}

// ------------------------------------------------------------------ input

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

/** The bricks drawn: a step's later bricks are hidden while only the steps so far are shown. */
function shownBricks(): PlacedBrick[] {
  return [...grid.bricks.values()].filter(
    (b) => !onlyStep.checked || (steps.get(b.id) ?? -1) <= step,
  );
}

/**
 * What the mouse is on: the brick, the point and the face, met as the game meets them (on the
 * bricks' collision boxes, see `aimAtBricks`), so a brick snaps where it would in the game.
 */
function pick(
  e: MouseEvent,
): { point: THREE.Vector3; normal: THREE.Vector3; brickId: number } | null {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  // From below, the see-through plate does not stand in the way of the bricks on it.
  const bricks = shownBricks().filter((b) => !(plateMaterial && b.id === PLATE.id));
  // The build stands unturned at the map's origin, so the ray is already in its grid's frame.
  const { origin, direction } = raycaster.ray;
  const hit = aimAtBricks(bricks, origin, direction);
  if (!hit) return null;
  const { point: p, normal: n } = hit;
  return {
    point: new THREE.Vector3(p.x, p.y, p.z),
    normal: new THREE.Vector3(n.x, n.y, n.z),
    brickId: hit.brickId,
  };
}

/** The layer Shift locks snapping to: where the brick snapped as the key went down. */
let lock: SnapLayer | null = null;
/** On a touch screen, with no Shift key or right click: the Same layer and Remove buttons. */
let sameLayer = false;
let removing = false;
/** The Pipette button is on: the next click picks a brick instead of placing one. */
let pipette = false;

function preview(e: MouseEvent) {
  const hit = pick(e);
  const shift = (e.shiftKey || sameLayer) && !flip;
  if (!shift) lock = null;
  else if (lock) {
    // Keep to the locked layer for as long as the brick still clutches something there.
    const { origin, direction } = raycaster.ray;
    const one = [{ type, rot: 0 as Rotation, x: 0, y: 0, z: 0 }];
    const p = computeLayerSnap(grid, origin, direction, one, rot, lock)?.[0];
    if (p) return { ...p, colour };
  }
  const p = hit && computeSnap(grid, hit.point, hit.normal, type, rot, flip);
  if (shift && !lock && !flip && hit && p) lock = snapLayer(hit.point, hit.normal);
  return p ? { ...p, colour } : null;
}

let downAt: { x: number; y: number } | null = null;
let dragging = false;
/** Fingers on the view: a second one turns the gesture into a pinch, never a tap. */
const fingers = new Set<number>();
/** Where each pointer was at its last move. */
const lastAt = new Map<number, { x: number; y: number }>();
container.addEventListener('pointerdown', (e) => {
  // No autoscroll on a middle press: middle drag pans.
  if (e.button === 1) e.preventDefault();
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
container.addEventListener('pointercancel', (e) => {
  lift(e);
  dragging = fingers.size > 0;
  downAt = null;
});
container.addEventListener('contextmenu', (e) => e.preventDefault());
container.addEventListener('pointerleave', () => {
  lastHover = null;
  pickMark.visible = false;
  hoverEl.textContent = '';
  ghost.visible = false;
});

// ------------------------------------------------------------------ hover readout

const hoverEl = $('ed-hover');
const at = (b: Pick<PlacedBrick, 'x' | 'y' | 'z' | 'rot'>) =>
  `x ${b.x}  y ${b.y}  z ${b.z}  ${b.rot * 90}°`;

/**
 * Says, faintly at the bottom, which brick the mouse is on and where the one being placed
 * would go, in the build file's numbers, for placing a brick exactly.
 */
function showHover(id: number | undefined, placing: Omit<PlacedBrick, 'id'> | null): void {
  const parts: string[] = [];
  const b = id === undefined ? undefined : grid.bricks.get(id);
  if (b && !BRICK_TYPES[b.type].fixture) {
    const s = steps.get(b.id);
    parts.push(
      `${brickName(b.type)} · ${colourName(b.colour)} · ${at(b)}` +
        (s === undefined ? '' : ` · step ${s + 1}`),
    );
  }
  if (placing) parts.push(`places ${brickName(placing.type)} at ${at(placing)}`);
  hoverEl.textContent = parts.join('   →   ');
  if (codeOpen()) showCodeLine(b?.id);
}

// Left drag orbits by hand so a click (no drag) can place bricks. Right or middle drag pans,
// moving the whole build plate across the view, so a right click can still remove a brick.
container.addEventListener('pointermove', (e) => {
  if (downAt && (e.buttons === 2 || e.buttons === 4)) {
    const last = lastAt.get(e.pointerId) ?? { x: e.clientX, y: e.clientY };
    lastAt.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (dragging || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) {
      dragging = true;
      pan(e.clientX - last.x, e.clientY - last.y);
    }
    ghost.visible = false;
    pickMark.visible = false;
    hoverEl.textContent = '';
    return;
  }
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
      // All the way over the top and round underneath, as in the brick viewer; only the poles
      // themselves are kept clear, where looking at the build has no up.
      sph.phi = Math.min(Math.PI - 1e-3, Math.max(1e-3, sph.phi - (e.clientY - last.y) * 0.008));
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph));
      camera.lookAt(controls.target);
    }
    ghost.visible = false;
    hoverEl.textContent = '';
    return;
  }
  lastHover = e.pointerType === 'touch' ? null : e;
  altHeld = e.altKey;
  hover(e);
});

/** The mouse's last move over the view, to show a turned brick there before it moves again. */
let lastHover: MouseEvent | null = null;
/** Alt is down, so a click picks a brick rather than placing one. */
let altHeld = false;

/** Shows, at the mouse, the brick a click would place, or what it would pick. */
function hover(e: MouseEvent): void {
  showPicking(altHeld);
  if (pipette || altHeld) {
    ghost.visible = false;
    const id = pick(e)?.brickId;
    showHover(id, null);
    const b = id === undefined ? undefined : grid.bricks.get(id);
    pickMark.visible = b !== undefined && !BRICK_TYPES[b.type].fixture;
    if (b) cover(pickMark, b);
    return;
  }
  pickMark.visible = false;
  const p = preview(e);
  showHover(pick(e)?.brickId, removing ? null : p);
  ghost.visible = p !== null;
  if (p) {
    const c = localCentre(p);
    const q = partQuat(p);
    ghost.geometry = brickGeometry(p.type);
    ghost.position.set(c.x, c.y, c.z);
    ghost.quaternion.set(q.x, q.y, q.z, q.w);
    ghost.material = view.ghostMaterial(p.colour);
  }
}

container.addEventListener('pointerup', (e) => {
  lift(e);
  // A pinch ends one finger at a time: none of them places a brick.
  const wasDrag = dragging;
  dragging = fingers.size > 0 && dragging;
  downAt = null;
  // A finger leaves no hover behind, so no ghost either.
  if (e.pointerType === 'touch') ghost.visible = false;
  if (wasDrag) return;
  if (e.button === 0 && (pipette || e.altKey)) {
    pickBrick(pick(e)?.brickId);
  } else if (e.button === 0 && !removing) {
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
  if (e.code === 'KeyE' && !e.ctrlKey && !e.metaKey && canFlip(type)) setFlip(!flip);
  if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey) fitView();
  if (e.code === 'Escape' && pipette) setPipette(false);
});

/** Moves the view by a drag of so many pixels, the build following the mouse. */
function pan(dx: number, dy: number): void {
  const distance = camera.position.distanceTo(controls.target);
  const perPixel =
    (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) /
    renderer.domElement.clientHeight;
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
  const move = right.multiplyScalar(-dx * perPixel).add(up.multiplyScalar(dy * perPixel));
  camera.position.add(move);
  controls.target.add(move);
  controls.update();
}

/** Turns, zooms and moves the view so the whole build fits it, from the side it is seen from. */
function fitView(): void {
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) return;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const fov = THREE.MathUtils.degToRad(camera.fov / 2);
  const distance =
    (sphere.radius * 1.15) / Math.sin(Math.min(fov, Math.atan(Math.tan(fov) * camera.aspect)));
  const dir = camera.position.clone().sub(controls.target).normalize();
  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center).addScaledVector(dir, distance);
  camera.far = Math.max(50, distance * 4);
  camera.updateProjectionMatrix();
  controls.update();
}

/** Turns the brick to place, and shows it turned at once, as in the game. */
function rotate(): void {
  rot = ((rot + 1) % 4) as Rotation;
  if (lastHover && !downAt) hover(lastHover);
}

/** Flips the part to place onto its other hole, or back, and shows it at once. */
function setFlip(on: boolean): void {
  flip = on;
  const btn = $<HTMLButtonElement>('ed-flip');
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
  if (lastHover && !downAt) hover(lastHover);
}

// ------------------------------------------------------------------ pipette

const pipetteBtn = $<HTMLButtonElement>('ed-pipette');
const pickedEl = $('ed-picked');

function setPipette(on: boolean): void {
  pipette = on;
  pipetteBtn.classList.toggle('on', on);
  pipetteBtn.setAttribute('aria-pressed', String(on));
  showPicking(altHeld);
  if (lastHover && !downAt) hover(lastHover);
  else if (!on) pickMark.visible = false;
}

/** The crosshair over the view, while a click would pick rather than place. */
function showPicking(alt: boolean): void {
  container.classList.toggle('picking', pipette || alt);
}

/**
 * Takes the brick and colour of a brick in the build, and its turn, so the next one placed
 * matches it, and says what it is. The pipette is spent once it has picked a brick.
 */
function pickBrick(id: number | undefined): void {
  const b = id === undefined ? undefined : grid.bricks.get(id);
  if (!b || BRICK_TYPES[b.type].fixture) return;
  setColour(b.colour);
  setType(b.type);
  rot = b.rot;
  pickedEl.textContent = `Picked: ${brickName(b.type)} in ${colourName(b.colour)}`;
  pickedEl.hidden = false;
  setPipette(false);
}

pipetteBtn.addEventListener('click', () => setPipette(!pipette));
// Alt shows the crosshair, and lights the brick a click would pick, before the mouse moves;
// letting go (or leaving the window) puts the brick to place back.
function setAlt(on: boolean): void {
  if (altHeld === on) return;
  altHeld = on;
  showPicking(on);
  if (lastHover && !downAt && !root.classList.contains('hidden')) hover(lastHover);
  else if (!on && !pipette) pickMark.visible = false;
}
window.addEventListener('keydown', (e) => {
  if (e.key === 'Alt' && !root.classList.contains('hidden')) setAlt(true);
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'Alt') setAlt(false);
});
window.addEventListener('blur', () => setAlt(false));

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
placeBtn.addEventListener('click', () => {
  setRemoving(false);
  setPipette(false);
});
removeBtn.addEventListener('click', () => {
  setRemoving(true);
  setPipette(false);
});
$('ed-rotate').addEventListener('click', rotate);
$('ed-flip').addEventListener('click', () => canFlip(type) && setFlip(!flip));
$('ed-fit').addEventListener('click', fitView);
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
  json.value = stringifyBuildFile(currentBuild());
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

// ------------------------------------------------------------------ live build file

const codePane = $('ed-code');
const code = $<HTMLTextAreaElement>('ed-code-text');
const codeStatus = $('ed-code-status');
const codeOpenBtn = $<HTMLButtonElement>('ed-code-open');
/** The brick id on each brick line of the text, in order. */
let codeIds: number[] = [];
/** The build those bricks belong to: the text's, as last written or read. */
let codeBuild: TargetBuild | null = null;
/** The line (from 0) each of those bricks is on in the text, or -1 where it is not found. */
let codeLines: number[] = [];
/** An edit in the text box is the one change undo knows about until the box is left. */
let codeRecorded = false;
let codeTimer = 0;
/** Typed in since the build last took the text in. */
let codeDirty = false;

const codeOpen = () => !codePane.classList.contains('hidden');

function setCodeOpen(on: boolean): void {
  codePane.classList.toggle('hidden', !on);
  codeOpenBtn.setAttribute('aria-pressed', String(on));
  codeOpenBtn.classList.toggle('on', on);
  if (!on) marked.visible = false;
  syncCode();
}

/** Writes the build into the text box, unless it is being typed in. */
function syncCode(): void {
  if (!codeOpen() || document.activeElement === code) return;
  const order: number[] = [];
  codeBuild = currentBuild(order);
  const { text, brickLines } = stringifyBuildFileWithMap(codeBuild);
  code.value = text;
  codeIds = order;
  codeLines = brickLines;
  showCodeStatus([]);
}

function showCodeStatus(problems: string[], bad = false): void {
  codeStatus.classList.toggle('bad', bad);
  codeStatus.textContent = problems.length
    ? (bad ? '' : '⚠ ') + problems.slice(0, 3).join(' · ')
    : '✓ The build matches the file.';
}

/** Builds what the text box says, as far as it can be read. */
function applyCode(): void {
  clearTimeout(codeTimer);
  codeDirty = false;
  const r = parseBuildFile(code.value, allBins());
  const build = r.ok ? r.build : looseBuild(code.value);
  if (!build) {
    let why: string;
    try {
      JSON.parse(code.value);
      why = 'Not a build file: it needs manual.pages with bricks.';
    } catch (err) {
      why = `Not readable JSON: ${(err as Error).message}`;
    }
    showCodeStatus([why], true);
    return;
  }
  if (!codeRecorded) {
    record();
    codeRecorded = true;
  }
  codeIds = replaceBuild(build);
  codeBuild = build;
  codeLines = brickLinesIn(code.value, build);
  step = Math.min(step, Math.max(0, build.steps.length - 1));
  redraw();
  showCodeStatus(r.ok ? [] : r.problems);
  markCodeBrick();
}

/**
 * Where the bricks of a build read from `text` are in it: the line (from 0) of each, in file
 * order, or -1 for one not found. Typed text need not be laid out as the editor writes it, so
 * each brick's line as the editor would write it is looked for, from the last one found on.
 */
function brickLinesIn(text: string, build: TargetBuild): number[] {
  const own = stringifyBuildFileWithMap(build);
  const ownLines = own.text.split('\n');
  const lines = text.split('\n').map((l) => l.trim());
  let from = 0;
  return own.brickLines.map((at) => {
    const row = lines.indexOf(ownLines[at]!.trim(), from);
    if (row >= 0) from = row + 1;
    return row;
  });
}

/** The index of the brick whose line the cursor is on, if it is on one. */
function brickLineAt(pos: number): number {
  const row = code.value.slice(0, pos).split('\n').length - 1;
  return codeLines.indexOf(row);
}

/** Marks in the view the brick whose line the cursor is on, while typing there. */
function markCodeBrick(): void {
  const i = document.activeElement === code ? brickLineAt(code.selectionStart) : -1;
  const b = i < 0 ? undefined : grid.bricks.get(codeIds[i] ?? -1);
  marked.visible = b !== undefined;
  if (b) cover(marked, b);
}

const codeLine = $('ed-code-line');
/** The row lit behind the text box, as a line number, or -1. */
let litRow = -1;

/** Scrolls the text box to a brick's line and lights it, while the box is not in use. */
function showCodeLine(id: number | undefined): void {
  if (document.activeElement === code) return;
  const i = id === undefined ? -1 : codeIds.indexOf(id);
  litRow = i < 0 ? -1 : (codeLines[i] ?? -1);
  if (litRow >= 0) {
    const lh = lineHeight();
    const top = litRow * lh;
    if (top < code.scrollTop || top + lh > code.scrollTop + code.clientHeight - lh) {
      code.scrollTop = Math.max(0, top - code.clientHeight / 2);
    }
  }
  placeCodeLine();
}

const lineHeight = () => parseFloat(getComputedStyle(code).lineHeight) || 16;

function placeCodeLine(): void {
  const lh = lineHeight();
  const style = getComputedStyle(code);
  const pad = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.borderTopWidth) || 0);
  const top = pad + litRow * lh - code.scrollTop;
  // Only while the line is in sight in the box.
  codeLine.hidden = litRow < 0 || top < pad || top + lh > code.clientHeight;
  codeLine.style.top = `${top}px`;
  codeLine.style.height = `${lh}px`;
}
code.addEventListener('scroll', placeCodeLine);

code.addEventListener('input', () => {
  // The lines move as they are typed in; the build takes the text in a moment later.
  if (codeBuild) codeLines = brickLinesIn(code.value, codeBuild);
  codeDirty = true;
  clearTimeout(codeTimer);
  codeTimer = window.setTimeout(applyCode, 300);
});
code.addEventListener('focus', () => {
  codeRecorded = false;
  litRow = -1;
  placeCodeLine();
});
code.addEventListener('blur', () => {
  if (codeDirty) applyCode();
  // Unreadable text stays as typed, to be fixed. Otherwise it is tidied into the file's layout.
  if (!codeStatus.classList.contains('bad')) syncCode();
});
for (const ev of ['keyup', 'click', 'select'] as const) code.addEventListener(ev, markCodeBrick);
codeOpenBtn.addEventListener('click', () => setCodeOpen(!codeOpen()));
$('ed-code-close').addEventListener('click', () => setCodeOpen(false));

const viewer = createBrickViewer({
  onUse(t, c) {
    setColour(c);
    setType(t);
  },
});
$('ed-view-bricks').addEventListener('click', () => viewer.show(type, colour));

redraw();
updateHistoryButtons();

/** The element the game's canvas goes back into when the editor shuts. */
let canvasHome: HTMLElement | null = null;

/** Shows the editor, as the game's build editor screen, on its own map in the game's view. */
export function showEditor(): void {
  root.classList.remove('hidden');
  canvasHome = renderer.domElement.parentElement;
  container.append(renderer.domElement);
  view.showStudio(stage);
  camera.position.copy(lens.at);
  camera.far = lens.far;
  controls.enabled = true;
  controls.update();
  resize();
  drawPickers();
  renderer.setAnimationLoop(draw);
}

/** Hides the editor and stops drawing it. The build stays as it was for next time. */
export function hideEditor(): void {
  if (viewer.isOpen) viewer.close();
  root.classList.add('hidden');
  renderer.setAnimationLoop(null);
  controls.enabled = false;
  lens.at.copy(camera.position);
  lens.far = camera.far;
  view.hideStudio();
  canvasHome?.append(renderer.domElement);
}
