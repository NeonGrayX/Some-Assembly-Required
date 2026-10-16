import * as THREE from 'three';
import { PRESETS, fromPreset } from './graphics-settings.ts';
import type { Preset } from './graphics-settings.ts';
import { Graphics } from './render/graphics.ts';
import { FLOOR, GROUND_LIGHT, bakeGroundShadows } from './carscene/ground.ts';
import { CAR_LIGHT, KEY_LIGHT, REFERENCE_VIEW, buildCarScene } from './carscene/scene.ts';
import { BACKDROP, buildBackdrop, studioEnvironment } from './carscene/studio.ts';
import './style.css';

/**
 * The car test map: one scene built after a single reference picture (a stylised lime-green
 * off-roader on a patch of mossy cobbles in a pale studio, warning cones round it) to see how
 * close the game's renderer comes to it. It has no game on it: drag to turn round the car, wheel
 * or pinch to come closer, and jump back to the picture's own view to compare.
 *
 * `?view=reference` opens on the reference view; `window.carTest` drives it from a script (the
 * comparison screenshots in the pull request).
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
BACKDROP.low.value.set(0xb4b3b2);
BACKDROP.top.value.set(0x1a222c);
BACKDROP.pool.value.setRGB(0.08, 0.085, 0.09);
FLOOR.near.value.set(0xe8e3dc);
FLOOR.range.value.set(7, 1.6);
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
// The key's shadow just round the car (the ground's own are baked, softer).
Object.assign(sun.shadow.camera, {
  left: -4.5,
  right: 4.5,
  top: 4.5,
  bottom: -4.5,
  near: 1,
  far: 40,
});
sun.shadow.camera.updateProjectionMatrix();

const world = buildCarScene();
scene.add(world.root);

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
  vignette: 0.42,
  ao: 1.6,
};

// The ground's soft shadows, once: nothing in the scene moves.
GROUND_LIGHT.keyColour.value.setRGB(1.08, 1.06, 1.02);
GROUND_LIGHT.ambient.value.setRGB(0.38, 0.38, 0.39);
GROUND_LIGHT.keyDark.value = 0.95;
GROUND_LIGHT.skyDark.value = 0.9;
let baked = bakeGroundShadows(renderer, scene, KEY_LIGHT);

/** The camera: orbiting a point, or fixed on the reference picture's view. */
let mode: 'orbit' | 'reference' = params.get('view') === 'reference' ? 'reference' : 'orbit';
const orbit = { yaw: 0, pitch: 0, distance: 0, target: new THREE.Vector3() };
function fromReference(): void {
  const offset = REFERENCE_VIEW.position.clone().sub(REFERENCE_VIEW.target);
  orbit.distance = offset.length();
  orbit.yaw = Math.atan2(offset.x, offset.z);
  orbit.pitch = Math.asin(offset.y / orbit.distance);
  orbit.target.copy(REFERENCE_VIEW.target);
}
fromReference();

const canvas = renderer.domElement;
const pointers = new Map<number, { x: number; y: number }>();
let pinch = 0;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  if (pointers.size === 1) {
    if (mode === 'reference') setMode('orbit');
    orbit.yaw -= (e.clientX - p.x) * 0.006;
    orbit.pitch = Math.max(0.02, Math.min(1.45, orbit.pitch + (e.clientY - p.y) * 0.006));
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
  pointers.delete(e.pointerId);
  pinch = 0;
};
canvas.addEventListener('pointerup', lift);
canvas.addEventListener('pointercancel', lift);
canvas.addEventListener('wheel', (e) => zoom(Math.exp(e.deltaY * 0.001)), { passive: true });
function zoom(k: number): void {
  if (mode === 'reference') setMode('orbit');
  orbit.distance = Math.max(3, Math.min(40, orbit.distance * k));
}
addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'SELECT') return;
  if (e.code === 'KeyR') setMode(mode === 'reference' ? 'orbit' : 'reference');
});

const viewButton = document.getElementById('reference-view') as HTMLButtonElement;
viewButton.addEventListener('click', () => setMode(mode === 'reference' ? 'orbit' : 'reference'));
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
  mode = m;
  viewButton.textContent = m === 'reference' ? 'Free view' : 'Reference view';
  if (m === 'reference') fromReference();
}
setMode(mode);

const resize = () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  graphics.resize();
};
addEventListener('resize', resize);
resize();

function frame(): void {
  if (mode === 'reference') {
    camera.position.copy(REFERENCE_VIEW.position);
    camera.fov = REFERENCE_VIEW.fov;
    camera.lookAt(REFERENCE_VIEW.target);
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
  graphics.render();
  if (!paused) requestAnimationFrame(frame);
}
/** Stopped by a script taking a picture, which draws frames one at a time instead. */
let paused = false;
requestAnimationFrame(frame);

/** For scripts: switch the view, aim the camera, and take pictures. */
(window as unknown as { carTest: unknown }).carTest = {
  reference: () => setMode('reference'),
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
  rebake: () => (baked = bakeGroundShadows(renderer, scene, KEY_LIGHT)),
  baked: () => baked,
  renderer,
  sun,
  fill,
  hemi,
  graphics,
  scene,
  camera,
  world,
  groundLight: GROUND_LIGHT,
  stats: () => ({ ...renderer.info.render }),
  /** Stops the loop, draws one frame, and hands back the picture. */
  still: () => {
    paused = true;
    frame();
    return renderer.domElement.toDataURL('image/png');
  },
};
