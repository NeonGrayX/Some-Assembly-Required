import * as THREE from 'three';
import { PRESETS, fromPreset } from './graphics-settings.ts';
import type { Preset } from './graphics-settings.ts';
import { Graphics } from './render/graphics.ts';
import { FLOOR, GROUND_LIGHT, bakeGroundShadows } from './carscene/ground.ts';
import {
  CAR_LIGHT,
  KEY_LIGHT,
  SHOWCASE_VIEW,
  REFERENCE_VIEW,
  buildCarScene,
} from './carscene/scene.ts';
import { batchStatic } from './carscene/batch.ts';
import { animatePlayer, buildPlayer } from './carscene/player.ts';
import { BACKDROP, buildBackdrop, studioEnvironment } from './carscene/studio.ts';
import { START, WALK_AREA, carWalk, swingDoors } from './carscene/walk.ts';
import { Walker } from './testmap/walk.ts';
import { PerfPanel } from './ui/perf.ts';
import './style.css';

/**
 * The car test map: one scene built after a single reference picture (a stylised lime-green
 * off-roader on a patch of mossy cobbles in a pale studio, warning cones round it) to see how
 * close the game's renderer comes to it, a red sports car in the same style parked beside it and
 * a yellow school bus beyond that, a small house behind their tails, and a street before them with
 * a big house across it. It has no game on it: walk about it as a toy mechanic (into the houses,
 * up the big one's stair), or drag round the car in a free view, and jump back to the picture's
 * own view to compare. The frame rate and draw counts sit in the bottom left corner; click them
 * for the last ten seconds' graph.
 *
 * `?view=reference` opens on the reference view and `?view=orbit` on the free view;
 * `window.carTest` drives it from a script (the comparison screenshots in the pull request).
 */

const params = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x828589);
// The studio's colours, as the picture's: a pale warm floor greying off into the backdrop.
BACKDROP.low.value.set(0xa4a3a2);
BACKDROP.top.value.set(0x363e48);
BACKDROP.pool.value.setRGB(0.08, 0.085, 0.09);
FLOOR.near.value.set(0xe8e3dc);
FLOOR.range.value.set(7, 1.6);
// The key's light on the floor: bright toward the picture's lower left, dying off to its right.
FLOOR.pool.value.set(0.78, 0.62, -3.2, -0.8);
FLOOR.poolDark.value = 0.48;
scene.add(buildBackdrop());
const camera = new THREE.PerspectiveCamera(REFERENCE_VIEW.fov, 1, 0.1, 400);

// The studio: a key light high behind the car on the picture's right, the studio's light all
// round (and its reflections in the paint and glass), and a softbox on the camera's side.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(studioEnvironment(KEY_LIGHT), 0.04).texture;
scene.environmentIntensity = 1.4;
const hemi = new THREE.HemisphereLight(0xe6ecf2, 0x6a6058, 0.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff6ea, 2.8);
sun.position.copy(CAR_LIGHT).multiplyScalar(20);
sun.target.position.set(0, 0, 0);
sun.castShadow = true;
scene.add(sun, sun.target);
// A softbox on the camera's side, lighting the car's flank, though less than its top.
const fill = new THREE.DirectionalLight(0xf2f4f6, 0.35);
fill.position.set(1.5, 2, -6);
scene.add(fill);
// The key's shadow just round the vehicles, the houses and the street (the ground's own are baked,
// softer).
sun.target.position.set(-4.5, 0, -12.5);
sun.position.copy(CAR_LIGHT).multiplyScalar(20).add(sun.target.position);
Object.assign(sun.shadow.camera, {
  left: -18.5,
  right: 18.5,
  top: 18.5,
  bottom: -18.5,
  near: 1,
  far: 40,
});
sun.shadow.camera.updateProjectionMatrix();

const world = buildCarScene();
scene.add(world.root);
// Where the player can walk, worked out from the scene's parts before they are baked together:
// a draw call per material rather than per part (see the stats in the corner), the doors apart
// so they can swing.
const walk = carWalk(world);
batchStatic(world.root, (o) => o.name === 'door');

const graphics = new Graphics(renderer, scene, camera, sun);
graphics.setHouse(null);
const asked = params.get('preset') as Preset | null;
let settings = fromPreset(asked && asked in PRESETS ? asked : 'high');
function applySettings(): void {
  graphics.apply(settings);
  // A big light: soft edges on the car's own shadows.
  sun.shadow.radius = 4;
}
applySettings();
// The picture's grade: rich colour, little contrast, the lamps blooming, deep corner shading, and
// its corners darkened well.
graphics.grade = {
  saturation: 1.0,
  contrast: 0.05,
  lift: 0,
  bloom: 0.16,
  threshold: 1.2,
  vignette: 0.2,
  ao: 1.6,
};

// The ground's soft shadows, once: nothing in the scene moves.
GROUND_LIGHT.keyColour.value.setRGB(1.08, 1.06, 1.02);
GROUND_LIGHT.ambient.value.setRGB(0.38, 0.38, 0.39);
GROUND_LIGHT.keyDark.value = 0.95;
GROUND_LIGHT.skyDark.value = 0.9;
let baked = bakeGroundShadows(renderer, scene, KEY_LIGHT);

// The player, walking about the scene: added after the ground's shadows are baked, so it casts
// none into them.
const walker = new Walker(walk.solids, () => 0, -100);
walker.spawn(START.x, START.z);
walker.heading = START.heading;
const player = buildPlayer();
scene.add(player.root);

/**
 * The camera: following the player, orbiting a point, or fixed on the reference picture's view.
 * `free` is whichever of the first two it was last, to go back to.
 */
const asView = params.get('view');
let mode: 'walk' | 'orbit' | 'reference' =
  asView === 'reference' ? 'reference' : asView === 'orbit' ? 'orbit' : 'walk';
let free: 'walk' | 'orbit' = asView === 'orbit' ? 'orbit' : 'walk';
const orbit = { yaw: 0, pitch: 0, distance: 0, target: new THREE.Vector3() };
/** Behind the player: which way the camera looks from, how far down, and how far back. */
const follow = { yaw: START.heading, pitch: -0.22, distance: 4.5 };
function fromView(view: typeof REFERENCE_VIEW): void {
  const offset = view.position.clone().sub(view.target);
  orbit.distance = offset.length();
  orbit.yaw = Math.atan2(offset.x, offset.z);
  orbit.pitch = Math.asin(offset.y / orbit.distance);
  orbit.target.copy(view.target);
}
const fromReference = () => fromView(REFERENCE_VIEW);
// The free view opens on them all.
fromView(SHOWCASE_VIEW);

const keys = new Set<string>();
let jump = false;
const MOVES = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

const canvas = renderer.domElement;
const pointers = new Map<number, { x: number; y: number }>();
let pinch = 0;
/** Touch, walking: a thumb dragged on the left half of the screen walks, as a stick. */
const stick = { id: -1, x0: 0, y0: 0, x: 0, y: 0 };
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  if (mode === 'walk' && e.pointerType !== 'mouse' && e.clientX < innerWidth / 2 && stick.id < 0) {
    Object.assign(stick, { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: 0, y: 0 });
    return;
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId === stick.id) {
    stick.x = Math.max(-1, Math.min(1, (e.clientX - stick.x0) / 60));
    stick.y = Math.max(-1, Math.min(1, (e.clientY - stick.y0) / 60));
    return;
  }
  const p = pointers.get(e.pointerId);
  if (!p) return;
  if (pointers.size === 1) {
    if (mode === 'reference') setMode(free);
    const [dx, dy] = [e.clientX - p.x, e.clientY - p.y];
    if (mode === 'walk') {
      follow.yaw -= dx * 0.006;
      follow.pitch = Math.max(-1.2, Math.min(0.5, follow.pitch - dy * 0.006));
    } else {
      orbit.yaw -= dx * 0.006;
      orbit.pitch = Math.max(0.02, Math.min(1.45, orbit.pitch + dy * 0.006));
    }
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    if (pinch) zoom(pinch / d);
    pinch = d;
  }
  p.x = e.clientX;
  p.y = e.clientY;
});
const lift = (e: PointerEvent) => {
  if (e.pointerId === stick.id) Object.assign(stick, { id: -1, x: 0, y: 0 });
  pointers.delete(e.pointerId);
  pinch = 0;
};
canvas.addEventListener('pointerup', lift);
canvas.addEventListener('pointercancel', lift);
canvas.addEventListener('wheel', (e) => zoom(Math.exp(e.deltaY * 0.001)), { passive: true });
function zoom(k: number): void {
  if (mode === 'reference') setMode(free);
  if (mode === 'walk') follow.distance = Math.max(1.5, Math.min(12, follow.distance * k));
  else orbit.distance = Math.max(3, Math.min(40, orbit.distance * k));
}
addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'SELECT') return;
  keys.add(e.code);
  if (e.code === 'Space') {
    e.preventDefault();
    jump = true;
  }
  if (e.code === 'KeyR') setMode(mode === 'reference' ? free : 'reference');
  if (e.code === 'KeyF') setMode(mode === 'orbit' ? 'walk' : 'orbit');
  if (MOVES.includes(e.code) && mode !== 'walk') setMode('walk');
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const walkButton = document.getElementById('walk-view') as HTMLButtonElement;
const freeButton = document.getElementById('free-view') as HTMLButtonElement;
const viewButton = document.getElementById('reference-view') as HTMLButtonElement;
walkButton.addEventListener('click', () => setMode('walk'));
freeButton.addEventListener('click', () => setMode('orbit'));
viewButton.addEventListener('click', () => setMode('reference'));
document.getElementById('jump')!.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  jump = true;
});
const presetSelect = document.getElementById('preset') as HTMLSelectElement;
for (const p of Object.keys(PRESETS) as Preset[])
  presetSelect.add(new Option(p[0]!.toUpperCase() + p.slice(1), p));
presetSelect.value = settings.preset === 'custom' ? 'high' : settings.preset;
presetSelect.addEventListener('change', () => {
  settings = fromPreset(presetSelect.value as Preset);
  applySettings();
  presetSelect.blur();
});

function setMode(m: typeof mode): void {
  if (m === 'walk' && mode !== 'walk') follow.yaw = walker.heading;
  mode = m;
  if (m !== 'reference') free = m;
  for (const [b, on] of [
    [walkButton, m === 'walk'],
    [freeButton, m === 'orbit'],
    [viewButton, m === 'reference'],
  ] as const)
    b.setAttribute('aria-pressed', String(on));
  document.body.dataset.view = m;
  if (m === 'reference') fromReference();
}
setMode(mode);

// The frame rate and the scene's draw counts, bottom left; click for the last ten seconds' graph.
const status = document.getElementById('status')!;
const perf = new PerfPanel(status, () => null, false);
renderer.info.autoReset = false;
let statusAt = 0;
function showStats(now: number): void {
  if (now - statusAt < 250) return;
  statusAt = now;
  const { calls, triangles } = renderer.info.render;
  const fps = perf.currentFps(now);
  const tris =
    triangles >= 1e6 ? `${(triangles / 1e6).toFixed(2)}M` : `${Math.round(triangles / 1e3)}k`;
  status.textContent = `${Math.round(fps)} fps · ${calls} draws · ${tris} tris`;
}

const resize = () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  graphics.resize();
};
addEventListener('resize', resize);
resize();

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const head = new THREE.Vector3();
const eye = new THREE.Vector3();
const before = new THREE.Vector3();
const ray = new THREE.Raycaster();
let last = performance.now();

function frame(now = performance.now()): void {
  const dt = Math.min(0.05, Math.max(0, now - last) / 1000);
  last = now;
  perf.frame(now);
  const started = performance.now();

  // Walking, relative to where the camera looks.
  let ix =
    (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) -
    (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) +
    stick.x;
  let iz =
    (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) -
    (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) +
    stick.y;
  const len = Math.hypot(ix, iz);
  if (len > 1) [ix, iz] = [ix / len, iz / len];
  if (mode !== 'walk') [ix, iz] = [0, 0];
  forward.set(-Math.sin(follow.yaw), 0, -Math.cos(follow.yaw));
  right.set(-forward.z, 0, forward.x);
  before.copy(walker.pos);
  walker.update(dt, {
    x: right.x * ix - forward.x * iz,
    z: right.z * ix - forward.z * iz,
    run: keys.has('ShiftLeft') || keys.has('ShiftRight') || Math.hypot(stick.x, stick.y) > 0.9,
    jump: jump && mode === 'walk',
  });
  jump = false;
  // Kept to the studio's floor.
  const p = walker.pos;
  const [ax, az] = [p.x - WALK_AREA.x, p.z - WALK_AREA.z];
  const out = Math.hypot(ax, az) / WALK_AREA.r;
  if (out > 1) p.set(WALK_AREA.x + ax / out, p.y, WALK_AREA.z + az / out);
  const simulated = performance.now();

  player.root.position.copy(p);
  player.root.rotation.y = walker.heading;
  const speed = dt > 0 ? Math.hypot(p.x - before.x, p.z - before.z) / dt : 0;
  animatePlayer(player, speed, !walker.grounded, dt);
  player.root.visible = mode !== 'reference';
  swingDoors(walk.doors, mode === 'reference' ? null : p, dt);

  if (mode === 'reference') {
    camera.position.copy(REFERENCE_VIEW.position);
    camera.fov = REFERENCE_VIEW.fov;
    camera.lookAt(REFERENCE_VIEW.target);
  } else if (mode === 'walk') {
    camera.fov = 60;
    head.set(p.x, p.y + 1.55, p.z);
    const c = Math.cos(follow.pitch);
    eye.set(Math.sin(follow.yaw) * c, -Math.sin(follow.pitch), Math.cos(follow.yaw) * c);
    // Pulled in where something stands between the camera and the player.
    ray.set(head, eye);
    ray.far = follow.distance;
    const hit = ray.intersectObject(walk.camera, true)[0];
    const d = hit ? Math.max(0.5, hit.distance - 0.3) : follow.distance;
    camera.position.copy(head).addScaledVector(eye, d);
    camera.lookAt(head);
  } else {
    const c = Math.cos(orbit.pitch);
    camera.position
      .set(Math.sin(orbit.yaw) * c, Math.sin(orbit.pitch), Math.cos(orbit.yaw) * c)
      .multiplyScalar(orbit.distance)
      .add(orbit.target);
    camera.fov = REFERENCE_VIEW.fov;
    camera.lookAt(orbit.target);
  }
  camera.updateProjectionMatrix();
  const synced = performance.now();
  renderer.info.reset();
  graphics.render();
  perf.work(started, simulated, synced, performance.now());
  showStats(now);
  if (!paused) requestAnimationFrame(frame);
}
/** Stopped by a script taking a picture, which draws frames one at a time instead. */
let paused = false;
requestAnimationFrame(frame);

/** For scripts: switch the view, aim the camera, and take pictures. */
(window as unknown as { carTest: unknown }).carTest = {
  reference: () => setMode('reference'),
  walk: () => setMode('walk'),
  orbit: () => setMode('orbit'),
  /** Stands the player at (`x`, `z`) facing `heading`, the camera behind them. */
  place: (x: number, z: number, heading = 0, pitch = -0.22, distance = 4.5, reach?: number) => {
    walker.spawn(x, z, reach);
    walker.heading = heading;
    setMode('walk');
    Object.assign(follow, { yaw: heading, pitch, distance });
  },
  /** Looks from `pos` at `target` with a field of view of `fov`, as the reference view. */
  shot: (
    pos: [number, number, number],
    target: [number, number, number],
    fov = REFERENCE_VIEW.fov,
  ) => {
    REFERENCE_VIEW.position.set(...pos);
    REFERENCE_VIEW.target.set(...target);
    REFERENCE_VIEW.fov = fov;
    setMode('reference');
  },
  preset: (p: Preset) => {
    settings = fromPreset(p);
    presetSelect.value = p;
    applySettings();
  },
  rebake: () => {
    player.root.visible = false;
    baked = bakeGroundShadows(renderer, scene, KEY_LIGHT);
  },
  baked: () => baked,
  renderer,
  sun,
  fill,
  hemi,
  graphics,
  scene,
  camera,
  world,
  walker,
  follow,
  player,
  solids: walk.solids,
  doors: walk.doors,
  groundLight: GROUND_LIGHT,
  stats: () => ({ ...renderer.info.render }),
  /** Stops the loop, draws one frame `dt` seconds on, and hands back the picture. */
  still: (dt = 0.016) => {
    paused = true;
    last = performance.now() - dt * 1000;
    frame();
    return renderer.domElement.toDataURL('image/png');
  },
};
