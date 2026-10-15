import * as THREE from 'three';
import { CONTROLLER_OFFSET, PLAYER_FEET } from '@sar/shared';
import { PRESETS, fromPreset } from './graphics-settings.ts';
import type { Preset } from './graphics-settings.ts';
import { animateAvatar, makeAvatar } from './render/avatar.ts';
import { lightingFor, setTimeOfDay } from './render/daynight.ts';
import { Graphics } from './render/graphics.ts';
import { mergeStatic } from './render/merge.ts';
import { Sky } from './render/sky.ts';
import { Surface, TERRAIN_COLOURS, madeOfAll } from './render/styles.ts';
import { seaMeshes, shoreField, terrainMesh } from './render/terrain.ts';
import { REFERENCE_VIEW, buildIsland } from './testmap/map.ts';
import { loadPirateAssets } from './testmap/assets.ts';
import { PaintedSky } from './testmap/sky.ts';
import { Walker } from './testmap/walk.ts';
import './style.css';

/**
 * The pirate island test map: a scene built after a single reference picture (a stylised pirate
 * island with a galleon, timber-framed houses, great rocks and palms) to see how close the
 * game's renderer and painted style come to it. It has no game on it: walk about it, look round,
 * and jump to the reference picture's own view to compare.
 *
 * `?view=reference` opens on the reference view; `window.islandTest` drives it from a script
 * (the screenshots in the pull request).
 */

const params = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc9e8);
scene.fog = new THREE.Fog(0x9fc9e8, 60, 260);
const camera = new THREE.PerspectiveCamera(REFERENCE_VIEW.fov, 1, 0.1, 400);
const hemi = new THREE.HemisphereLight(0xdfefff, 0x6b5b45, 1.4);
scene.add(hemi);
// The reference's sun: high on the left, a little toward the viewer, so the walls facing left
// are lit and those facing right are in shade.
const sun = new THREE.DirectionalLight(0xfff3dd, 2.2);
sun.position.set(-20, 22, 14);
sun.target.position.set(0, 0, 0);
sun.castShadow = true;
scene.add(sun, sun.target);

const map = buildIsland(await loadPirateAssets());
const world = new THREE.Group();
world.add(map.root);
const terrain = terrainMesh(map.level);
world.add(terrain);
scene.add(world);
// The sea foams round whatever stands in it: the ship's hull, the rocks, the gangway's posts.
const shores = shoreField(map.level, [map.root]);
for (const m of seaMeshes(map.level, shores)) world.add(m);
mergeStatic(map.root);

// The sun's shadow over the whole island and all that stands on it.
{
  const cam = sun.shadow.camera;
  cam.position.copy(sun.position);
  cam.lookAt(sun.target.position);
  cam.updateMatrixWorld();
  const box = new THREE.Box3();
  for (const x of [-26, 25])
    for (const y of [-1, 25])
      for (const z of [-21, 14])
        box.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(cam.matrixWorldInverse));
  Object.assign(cam, {
    left: box.min.x,
    right: box.max.x,
    bottom: box.min.y,
    top: box.max.y,
    near: -box.max.z - 1,
    far: -box.min.z + 1,
  });
  cam.updateProjectionMatrix();
}

const graphics = new Graphics(renderer, scene, camera, sun);
graphics.setHouse(world, map.ground);
// The picture's look needs the soft shade in corners and the lanterns' glow: high unless asked.
const asked = params.get('preset') as Preset | null;
let settings = fromPreset(asked && asked in PRESETS ? asked : 'high');
graphics.apply(settings);
// The picture's colours are muted, a good deal less vivid than the game's own grade makes them.
graphics.grade = { saturation: 0.85, contrast: 0.25 };

// The game's sky lights the scene (see `Sky.bakeLight`); the reference picture's own is drawn.
const sky = new Sky();
scene.add(new PaintedSky().mesh);
function light(): void {
  setTimeOfDay(scene, hemi, sun, false);
  const fog = scene.fog as THREE.Fog;
  fog.color.set(0x9fd0f0);
  fog.near = 70;
  fog.far = 320;
  sky.setTime(false, sun.position.clone().sub(sun.target.position));
  const below = new THREE.Color(0x2f86a6)
    .lerp(new THREE.Color(TERRAIN_COLOURS.sand), 0.2)
    .multiplyScalar(0.55);
  sky.bakeLight(renderer, below, hemi, lightingFor(false).env);
  // The picture's light: a strong warm sun from the left, and shade a good deal darker than the
  // light, filled a muted grey-blue from the sky rather than the baked sky's deep blue.
  sun.color.set(0xfff1dc);
  sun.intensity = 4.8;
  hemi.color.setRGB(0.3, 0.38, 0.52);
  hemi.groundColor.setRGB(0.22, 0.2, 0.18);
}
light();

// The player: one of the game's builders, walking about.
const walker = new Walker(map.solids, map.ground, 0);
walker.spawn(map.spawn.x, map.spawn.z);
walker.heading = 0;
const avatar = makeAvatar(0xe8b33a, null);
madeOfAll(avatar.group, Surface.Plastic);
scene.add(avatar.group);

/** How the camera follows: behind the player, or fixed on the reference picture's view. */
let mode: 'walk' | 'reference' = params.get('view') === 'reference' ? 'reference' : 'walk';
let yaw = 0;
let pitch = -0.12;
let distance = 6;
const keys = new Set<string>();
let jump = false;

addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'SELECT') return;
  keys.add(e.code);
  if (e.code === 'Space') jump = true;
  if (e.code === 'KeyR') setMode(mode === 'reference' ? 'walk' : 'reference');
  if (
    ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(
      e.code,
    ) &&
    mode === 'reference'
  )
    setMode('walk');
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const canvas = renderer.domElement;
canvas.addEventListener('click', () => {
  if (matchMedia('(pointer: fine)').matches && document.pointerLockElement !== canvas)
    void canvas.requestPointerLock?.();
});
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  yaw -= e.movementX * 0.0025;
  pitch = Math.max(-1.2, Math.min(0.9, pitch - e.movementY * 0.0025));
});
canvas.addEventListener('wheel', (e) => {
  distance = Math.max(1.2, Math.min(18, distance * Math.exp(e.deltaY * 0.001)));
});

// Touch: drag on the left half to walk, on the right half to look.
const stick = { id: -1, x0: 0, y0: 0, x: 0, y: 0 };
const look = { id: -1, x: 0, y: 0 };
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  if (e.clientX < innerWidth / 2 && stick.id < 0)
    Object.assign(stick, { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: 0, y: 0 });
  else if (look.id < 0) Object.assign(look, { id: e.pointerId, x: e.clientX, y: e.clientY });
  if (mode === 'reference' && stick.id === e.pointerId) setMode('walk');
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId === stick.id) {
    stick.x = Math.max(-1, Math.min(1, (e.clientX - stick.x0) / 60));
    stick.y = Math.max(-1, Math.min(1, (e.clientY - stick.y0) / 60));
  } else if (e.pointerId === look.id) {
    yaw -= (e.clientX - look.x) * 0.006;
    pitch = Math.max(-1.2, Math.min(0.9, pitch - (e.clientY - look.y) * 0.006));
    look.x = e.clientX;
    look.y = e.clientY;
  }
});
const lift = (e: PointerEvent) => {
  if (e.pointerId === stick.id) Object.assign(stick, { id: -1, x: 0, y: 0 });
  if (e.pointerId === look.id) look.id = -1;
};
canvas.addEventListener('pointerup', lift);
canvas.addEventListener('pointercancel', lift);

// The panel: which view, and how good it looks.
const viewButton = document.getElementById('reference-view') as HTMLButtonElement;
viewButton.addEventListener('click', () => setMode(mode === 'reference' ? 'walk' : 'reference'));
const presetSelect = document.getElementById('preset') as HTMLSelectElement;
for (const p of Object.keys(PRESETS) as Preset[])
  presetSelect.add(new Option(p[0]!.toUpperCase() + p.slice(1), p));
presetSelect.value = settings.preset === 'custom' ? 'high' : settings.preset;
presetSelect.addEventListener('change', () => {
  settings = fromPreset(presetSelect.value as Preset);
  graphics.apply(settings);
  presetSelect.blur();
});
document.getElementById('jump-tap')?.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  jump = true;
});

function setMode(m: typeof mode): void {
  mode = m;
  viewButton.textContent = m === 'reference' ? 'Back to walking' : 'Reference view';
  if (m === 'walk') {
    // Behind the player again, looking the way they face.
    yaw = walker.heading;
  }
}
setMode(mode);

const resize = () => {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  graphics.resize();
};
addEventListener('resize', resize);
resize();

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const head = new THREE.Vector3();
const eye = new THREE.Vector3();
const ray = new THREE.Raycaster();
let last = performance.now();

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

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
  if (mode === 'reference') [ix, iz] = [0, 0];
  forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  right.set(-forward.z, 0, forward.x);
  walker.update(dt, {
    x: right.x * ix - forward.x * iz,
    z: right.z * ix - forward.z * iz,
    run: keys.has('ShiftLeft') || keys.has('ShiftRight') || Math.hypot(stick.x, stick.y) > 0.9,
    jump,
  });
  jump = false;

  const p = walker.pos;
  avatar.group.position.set(p.x, p.y + PLAYER_FEET + CONTROLLER_OFFSET, p.z);
  avatar.group.rotation.y = walker.heading;
  animateAvatar(
    avatar,
    { limping: false, carrying: false, careful: false, airborne: !walker.grounded },
    dt,
  );

  if (mode === 'reference') {
    camera.position.copy(REFERENCE_VIEW.position);
    camera.lookAt(REFERENCE_VIEW.target);
    camera.fov = REFERENCE_VIEW.fov;
  } else {
    camera.fov = 60;
    head.set(p.x, p.y + 1.55, p.z);
    eye.set(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    // Pulled in where something stands between the camera and the player.
    ray.set(head, eye);
    ray.far = distance;
    const hit = ray.intersectObject(world, true)[0];
    const d = hit ? Math.max(0.6, hit.distance - 0.5) : distance;
    camera.position.copy(head).addScaledVector(eye, d);
    camera.lookAt(head);
  }
  camera.updateProjectionMatrix();
  avatar.group.visible = mode === 'walk';
  graphics.render();
  if (!paused) requestAnimationFrame(frame);
}
/** Stopped by a script taking a picture, which draws frames one at a time instead. */
let paused = false;
requestAnimationFrame(frame);

/** For scripts: switch the view, or stand the player somewhere and look a given way. */
(window as unknown as { islandTest: unknown }).islandTest = {
  reference: () => setMode('reference'),
  walk: () => setMode('walk'),
  place: (x: number, z: number, lookYaw: number, lookPitch = -0.15, dist = 6, reach?: number) => {
    walker.spawn(x, z, reach);
    walker.heading = lookYaw;
    setMode('walk');
    [yaw, pitch, distance] = [lookYaw, lookPitch, dist];
  },
  shot: (pos: [number, number, number], target: [number, number, number], fov = 50) => {
    Object.assign(REFERENCE_VIEW, {
      position: new THREE.Vector3(...pos),
      target: new THREE.Vector3(...target),
      fov,
    });
    setMode('reference');
  },
  preset: (p: Preset) => {
    settings = fromPreset(p);
    presetSelect.value = p;
    graphics.apply(settings);
  },
  walker,
  sun,
  hemi,
  graphics,
  scene,
  camera,
  marks: map.marks,
  deckWalk: map.deckWalk,
  stats: () => ({ ...renderer.info.render }),
  /** Stops the loop, draws one frame `dt` seconds on, and hands back the picture. */
  still: (dt = 0.016) => {
    paused = true;
    last = performance.now() - dt * 1000;
    frame(performance.now());
    return renderer.domElement.toDataURL('image/png');
  },
};
