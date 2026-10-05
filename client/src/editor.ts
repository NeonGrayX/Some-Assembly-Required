import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  BRICK_TYPES,
  BrickGrid,
  COLOURS,
  BUILDS,
  buildById,
  computeSnap,
  validateBuild,
} from '@sar/shared';
import type { BrickTypeId, ColourId, PlacedBrick, Rotation, TargetBuild } from '@sar/shared';
import { baseplateMarker, brickGeometry, brickMaterial } from './render/bricks.ts';
import { addBrickMesh } from './render/pages.ts';
import './style.css';

/**
 * In-browser editor for target builds. Uses the same grid and snapping rules as the game,
 * without physics, and exports the JSON format used in shared/src/builds.
 */

type EditorBrick = PlacedBrick & { step: number };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const typeSel = $<HTMLSelectElement>('type');
const colourSel = $<HTMLSelectElement>('colour');
const stepEl = $('step');
const onlyStep = $<HTMLInputElement>('only-step');
const summary = $('summary');
const json = $<HTMLTextAreaElement>('json');
const nameInput = $<HTMLInputElement>('name');

for (const t of Object.values(BRICK_TYPES)) {
  if (!t.fixture) typeSel.add(new Option(t.id, t.id));
}
for (const c of Object.values(COLOURS)) colourSel.add(new Option(c.id, c.id));
typeSel.value = '2x4';
colourSel.value = 'red';

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

// ------------------------------------------------------------------ scene

const container = $('game');
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

function resize(): void {
  const w = container.clientWidth;
  const h = container.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
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

/** Rebuilds the meshes. Each mesh remembers its brick id for picking. */
function redraw(): void {
  model.clear();
  model.add(baseplateMarker());
  for (const b of grid.bricks.values()) {
    const s = steps.get(b.id) ?? -1;
    if (onlyStep.checked && s > step) continue;
    const current = s === step;
    const mesh = addBrickMesh(
      model,
      b,
      s >= 0 && s < step && onlyStep.checked ? faded(b.colour) : brickMaterial(b.colour),
      current,
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
  return {
    id:
      nameInput.value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-') || 'build',
    name: nameInput.value.trim() || 'Build',
    // Drop empty steps so numbering stays contiguous.
    steps: bySteps
      .filter((s) => s && s.length)
      .map((s) => ({
        bricks: s
          .sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z)
          .map(({ type, colour, x, y, z, rot }) => ({ type, colour, x, y, z, rot })),
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

function load(build: TargetBuild): void {
  grid = BrickGrid.from([PLATE]);
  steps.clear();
  nextId = 1;
  build.steps.forEach((s, i) => {
    for (const b of s.bricks) {
      const id = nextId++;
      grid.insert({ ...b, id });
      steps.set(id, i);
    }
  });
  nameInput.value = build.name;
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

function preview(e: MouseEvent) {
  const hit = pick(e);
  if (!hit) return null;
  const type = typeSel.value as BrickTypeId;
  const p = computeSnap(grid, hit.point, hit.normal, type, rot);
  return p ? { ...p, colour: colourSel.value as ColourId } : null;
}

let downAt: { x: number; y: number } | null = null;
renderer.domElement.addEventListener(
  'pointerdown',
  (e) => (downAt = { x: e.clientX, y: e.clientY }),
);
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

// Left drag orbits by hand so a click (no drag) can place bricks.
let dragging = false;
renderer.domElement.addEventListener('pointermove', (e) => {
  if (downAt && e.buttons === 1) {
    const dx = e.clientX - downAt.x;
    const dy = e.clientY - downAt.y;
    if (dragging || Math.hypot(dx, dy) > 4) {
      dragging = true;
      const offset = camera.position.clone().sub(controls.target);
      const sph = new THREE.Spherical().setFromVector3(offset);
      sph.theta -= e.movementX * 0.008;
      sph.phi = Math.min(1.5, Math.max(0.1, sph.phi - e.movementY * 0.008));
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph));
      camera.lookAt(controls.target);
    }
    ghost.visible = false;
    return;
  }
  const p = preview(e);
  ghost.visible = p !== null;
  if (p) {
    const c = new THREE.Vector3();
    const t = BRICK_TYPES[p.type];
    const w = (p.rot % 2 ? t.studsZ : t.studsX) * 0.1;
    const d = (p.rot % 2 ? t.studsX : t.studsZ) * 0.1;
    c.set(p.x * 0.1 + w / 2, (p.y + t.plates / 2) * 0.04, p.z * 0.1 + d / 2);
    ghost.geometry = brickGeometry(p.type);
    ghost.position.copy(c);
    ghost.rotation.y = (p.rot * Math.PI) / 2;
    ghostMat.color.setHex(COLOURS[p.colour].hex);
  }
});

renderer.domElement.addEventListener('pointerup', (e) => {
  const wasDrag = dragging;
  dragging = false;
  downAt = null;
  if (wasDrag) return;
  if (e.button === 0) {
    const p = preview(e);
    if (!p) return;
    const id = nextId++;
    if (grid.add({ ...p, id }).ok) steps.set(id, step);
    redraw();
  } else if (e.button === 2) {
    const hit = pick(e);
    if (hit?.brickId === undefined || hit.brickId === PLATE.id) return;
    grid.remove(hit.brickId);
    steps.delete(hit.brickId);
    redraw();
  }
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.code === 'KeyR') rot = ((rot + 1) % 4) as Rotation;
});

$('step-prev').addEventListener('click', () => {
  step = Math.max(0, step - 1);
  redraw();
});
$('step-next').addEventListener('click', () => {
  step++;
  redraw();
});
onlyStep.addEventListener('change', redraw);
nameInput.addEventListener('input', updateSummary);
$('export').addEventListener('click', () => {
  json.value = JSON.stringify(currentBuild(), null, 2);
  json.select();
});
$('import').addEventListener('click', () => {
  try {
    load(JSON.parse(json.value) as TargetBuild);
  } catch (err) {
    alert(`Could not read that JSON: ${(err as Error).message}`);
  }
});
const loadSel = $<HTMLSelectElement>('load-build');
for (const b of BUILDS) loadSel.add(new Option(b.name, b.id));
loadSel.addEventListener('change', () => {
  const b = buildById(loadSel.value);
  if (b) load(b);
  loadSel.value = '';
});
$('clear').addEventListener('click', () => {
  if (confirm('Remove every brick?')) load({ id: 'build', name: nameInput.value, steps: [] });
});

Object.assign(window, { __editor: { load, currentBuild } });

redraw();
renderer.setAnimationLoop(() => renderer.render(scene, camera));
