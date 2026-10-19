import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Action } from '@sar/shared';
import { PRESETS, fromPreset } from './graphics-settings.ts';
import type { Preset } from './graphics-settings.ts';
import { Graphics } from './render/graphics.ts';
import { FLOOR, GROUND_LIGHT, bakeGroundShadows } from './carscene/ground.ts';
import { CAR_LIGHT, KEY_LIGHT, SHOWCASE_VIEW, buildCarScene } from './carscene/scene.ts';
import { batchStatic } from './carscene/batch.ts';
import { animatePlayer, buildPlayer } from './carscene/player.ts';
import { BACKDROP, buildBackdrop, studioEnvironment } from './carscene/studio.ts';
import { START, carWalk, gateDoors, slideDoors } from './carscene/walk.ts';
import { CAR_DOOR, CarDoors, doorsIn } from './carscene/doors.ts';
import { LIVE_PARTS } from './carscene/machines.ts';
import { BrickWorksPlay } from './carscene/works.ts';
import { KEY_LABELS, sayHint, touchLabels } from './hints.ts';
import type { MouseHandle } from './input.ts';
import { Walker } from './testmap/walk.ts';
import { MachinePicker } from './ui/machinePicker.ts';
import { PerfPanel } from './ui/perf.ts';
import './style.css';

/**
 * The car test map: one scene built after a single reference picture (a stylised lime-green
 * off-roader on a patch of mossy cobbles in a pale studio, warning cones round it) to see how
 * close the game's renderer comes to it, a red sports car in the same style parked beside it and
 * a yellow school bus beyond that, a small house behind their tails, and a street before them with
 * a big house across it, the brick works' machines along its far side. It has no round on it:
 * walk about it as a toy mechanic (into the houses, up the big one's stair), the mouse held to
 * look while walking (Esc lets it go), and work the brick works' machines as in the game (see
 * `BrickWorksPlay`); or fly round it all in a free view, dragging to turn. The frame rate and draw counts sit in the bottom left corner; click them for the
 * last ten seconds' graph.
 *
 * `?view=orbit` opens on the free view; `window.carTest` drives it from a script (the
 * screenshots in the pull request).
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
const camera = new THREE.PerspectiveCamera(SHOWCASE_VIEW.fov, 1, 0.1, 400);

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
// The brick works, working: the game's simulation of its machines, set up from their models
// before they are baked in with the rest. What the player carries is drawn in `hands`.
await RAPIER.init();
const hands = new THREE.Group();
const works = new BrickWorksPlay(RAPIER, world.machines, scene, hands);
// The vehicles' doors, which a click swings open and shut.
const carDoors = new CarDoors(doorsIn(world.root));
// The floor stays apart too: it goes along under the camera, so however far the player wanders
// there is floor under them (faded into the backdrop by then, so it never shows moving). So do
// the parts of the machines that change as they work.
batchStatic(
  world.root,
  (o) =>
    o.name === 'door' || o.name === CAR_DOOR || o.name === 'floor' || LIVE_PARTS.includes(o.name),
);
const floor = world.root.getObjectByName('floor')!;

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
// Turning side-on to squeeze through gaps too narrow to walk through.
walker.squeezes = true;
walker.spawn(START.x, START.z);
walker.heading = START.heading;
const player = buildPlayer();
scene.add(player.root);
player.root.add(hands);

/** The camera: following the player, or free, turning about a point the arrow keys move. */
let mode: 'walk' | 'orbit' = params.get('view') === 'orbit' ? 'orbit' : 'walk';
const orbit = { yaw: 0, pitch: 0, distance: 0, fov: 0, target: new THREE.Vector3() };
/** Behind the player: which way the camera looks from, how far down, and how far back. */
const follow = { yaw: START.heading, pitch: -0.22, distance: 4.5 };
function fromView(view: typeof SHOWCASE_VIEW): void {
  const offset = view.position.clone().sub(view.target);
  orbit.distance = offset.length();
  orbit.yaw = Math.atan2(offset.x, offset.z);
  orbit.pitch = Math.asin(offset.y / orbit.distance);
  orbit.fov = view.fov;
  orbit.target.copy(view.target);
}
// The free view opens on them all.
fromView(SHOWCASE_VIEW);
/** Set by a script's picture: the free view without the player in it, till the view changes. */
let posed = false;

const keys = new Set<string>();
let jump = false;

const canvas = renderer.domElement;
const pointers = new Map<number, { x: number; y: number }>();
let pinch = 0;
/** Touch, walking: a thumb dragged on the left half of the screen walks, as a stick. */
const stick = { id: -1, x0: 0, y0: 0, x: 0, y: 0 };
/** Walking with a mouse: the cursor is held by the page (click to take it, Esc to let go). */
const locked = () => document.pointerLockElement === canvas;
/** The mouse free for the game's picker while it is open, then held again (see `MouseHandle`). */
let relockOnEscapeUp = false;
const mouse: MouseHandle = {
  touch: matchMedia('(pointer: coarse)').matches,
  freeMouse: () => {
    relockOnEscapeUp = false;
    if (locked()) document.exitPointerLock();
  },
  relock: () => {
    if (mode === 'walk' && !mouse.touch) canvas.requestPointerLock()?.catch(() => {});
  },
  relockAfterEscape: () => {
    relockOnEscapeUp = true;
  },
};
addEventListener('keyup', (e) => {
  if (e.key !== 'Escape' || !relockOnEscapeUp) return;
  relockOnEscapeUp = false;
  // A task later: the browser refuses a capture asked for while it still handles this Esc.
  setTimeout(() => mouse.relock());
});
/** The game's own picker: the silo's colours, the mould vendor's moulds, the printer's pictures. */
const picker = new MachinePicker((a) => works.act(a), mouse);
canvas.addEventListener('pointerdown', (e) => {
  if (mode === 'walk' && e.pointerType === 'mouse') {
    if (!locked()) canvas.requestPointerLock()?.catch(() => {});
    else if (e.button === 0) use();
    return;
  }
  canvas.setPointerCapture(e.pointerId);
  if (mode === 'walk' && e.pointerType !== 'mouse' && e.clientX < innerWidth / 2 && stick.id < 0) {
    Object.assign(stick, { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: 0, y: 0 });
    return;
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
});
canvas.addEventListener('pointermove', (e) => {
  if (locked()) {
    if (mode !== 'walk') return;
    follow.yaw -= e.movementX * 0.0025;
    follow.pitch = Math.max(-1.2, Math.min(0.5, follow.pitch - e.movementY * 0.0025));
    return;
  }
  if (e.pointerId === stick.id) {
    stick.x = Math.max(-1, Math.min(1, (e.clientX - stick.x0) / 60));
    stick.y = Math.max(-1, Math.min(1, (e.clientY - stick.y0) / 60));
    return;
  }
  const p = pointers.get(e.pointerId);
  if (!p) return;
  if (pointers.size === 1) {
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
  if (mode === 'walk') follow.distance = Math.max(1.5, Math.min(12, follow.distance * k));
  else orbit.distance = Math.max(3, Math.min(40, orbit.distance * k));
}
/** The game's keys for what is in hand: put it down, turn it, throw it. */
const HAND_KEYS: Record<string, Action> = {
  KeyG: { kind: 'drop' },
  KeyR: { kind: 'rotate' },
  KeyT: { kind: 'throw' },
};
addEventListener('keydown', (e) => {
  if (['SELECT', 'INPUT'].includes((e.target as HTMLElement).tagName) || picker.isOpen) return;
  keys.add(e.code);
  const action = HAND_KEYS[e.code];
  if (mode === 'walk' && action && !e.repeat) works.act(action);
  if (e.code === 'Space') {
    e.preventDefault();
    jump = true;
  }
  if (e.code === 'KeyF') setMode(mode === 'orbit' ? 'walk' : 'orbit');
  if (e.code.startsWith('Arrow') || (mode === 'orbit' && e.ctrlKey)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const walkButton = document.getElementById('walk-view') as HTMLButtonElement;
const freeButton = document.getElementById('free-view') as HTMLButtonElement;
walkButton.addEventListener('click', () => setMode('walk'));
freeButton.addEventListener('click', () => setMode('orbit'));
document.getElementById('jump')!.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  jump = true;
});
document.getElementById('use')!.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  use();
});
/** A click, or the Use button: a door aimed at swings, else the brick works has it. */
function use(): void {
  if (!carDoors.click()) works.click(picker);
}
const hint = document.getElementById('hint')!;
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
  posed = false;
  if (m !== 'walk' && locked()) document.exitPointerLock();
  for (const [b, on] of [
    [walkButton, m === 'walk'],
    [freeButton, m === 'orbit'],
  ] as const)
    b.setAttribute('aria-pressed', String(on));
  document.body.dataset.view = m;
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
const crown = new THREE.Vector3();
const side = new THREE.Vector3();
const head = new THREE.Vector3();
const eye = new THREE.Vector3();
const before = new THREE.Vector3();
let last = performance.now();

/**
 * What the following camera keeps out of, each as a box in its own axes (turned only about the
 * upright, so distances hold): as it is, and grown by how near the camera may come before it
 * clips. `big` is anything too wide to see round: a wall, a vehicle, a machine, a ceiling.
 */
const CLEAR = 0.2;
const blocks = walk.camera.children.map((m) => {
  const mesh = m as THREE.Mesh;
  mesh.geometry.computeBoundingBox();
  const solid = mesh.geometry.boundingBox!.clone();
  const size = solid.getSize(new THREE.Vector3());
  return {
    toLocal: mesh.matrixWorld.clone().invert(),
    solid,
    box: solid.clone().expandByScalar(CLEAR),
    big: Math.min(size.x, size.z) >= 1.5 || (Math.max(size.x, size.z) >= 1.5 && size.y >= 1.2),
  };
});
/** The houses' rooms, each a box in its house's axes. */
const rooms = walk.rooms.map((r) => ({
  toLocal: r.frame.matrixWorld.clone().invert(),
  box: r.box,
}));
const local = new THREE.Ray();
const point = new THREE.Vector3();
/**
 * How far the camera may go along `dir` from `from` for the rooms: from inside one, never out
 * through its doorway or a window; from outside, never in through them. Infinity if no room is in
 * the way.
 */
function roomsAllow(from: THREE.Vector3, dir: THREE.Vector3): number {
  let d = Infinity;
  for (const r of rooms) {
    local.origin.copy(from).applyMatrix4(r.toLocal);
    local.direction.copy(dir).transformDirection(r.toLocal);
    if (!local.intersectBox(r.box, point)) continue;
    // Inside, the line's way out of the room; outside, its way in.
    d = Math.min(d, point.distanceTo(local.origin) - 0.25);
  }
  return d;
}
/** Where the line from `from` along `dir` goes into `box` of `b`, if it does from outside it. */
function into(
  b: (typeof blocks)[number],
  box: THREE.Box3,
  from: THREE.Vector3,
  dir: THREE.Vector3,
) {
  local.origin.copy(from).applyMatrix4(b.toLocal);
  if (box.containsPoint(local.origin)) return Infinity;
  local.direction.copy(dir).transformDirection(b.toLocal);
  return local.intersectBox(box, point) ? point.distanceTo(local.origin) : Infinity;
}
/**
 * How far back along `dir` from `from` the camera can sit, up to `far`: short of anything big
 * in the way, and else all the way unless it would be inside something there, then just short
 * of where the line goes into it. A post or a lamp between it and the player it sees round.
 */
function clearBack(from: THREE.Vector3, dir: THREE.Vector3, far: number): number {
  // Above the floor, wherever on it.
  let d = dir.y < 0 ? Math.min(far, (from.y - CLEAR) / -dir.y) : far;
  d = Math.min(d, roomsAllow(from, dir));
  for (const b of blocks) if (b.big) d = Math.min(d, into(b, b.solid, from, dir) - 0.3);
  d = Math.max(0.5, d);
  for (let pass = 0; pass < 4 && d > 0.5; pass++) {
    point.copy(from).addScaledVector(dir, d);
    const inside = blocks.find((b) =>
      b.box.containsPoint(local.origin.copy(point).applyMatrix4(b.toLocal)),
    );
    if (!inside) break;
    const t = into(inside, inside.box, from, dir);
    // The player stands in its margin (a ceiling close over them): it is not in the way.
    if (t === Infinity) break;
    d = Math.max(0.5, t - 0.05);
  }
  return d;
}
/**
 * How far along `dir` from `from` there is room, up to `far`: short of anything in the way, and
 * of a room's walls from inside it.
 */
function clearSide(from: THREE.Vector3, dir: THREE.Vector3, far: number): number {
  let d = Math.min(far, roomsAllow(from, dir));
  for (const b of blocks) d = Math.min(d, into(b, b.solid, from, dir) - CLEAR);
  return Math.max(0, d);
}
/**
 * How far right of the player the following camera looks, as the game's does over the
 * shoulder: the crosshair in the middle of the screen is then on what is before them, not on
 * their head.
 */
const SHOULDER = 0.6;
/** How far back the following camera is now: in at once, out again gently. */
let back = follow.distance;

function frame(now = performance.now()): void {
  const dt = Math.min(0.05, Math.max(0, now - last) / 1000);
  last = now;
  perf.frame(now);
  const started = performance.now();

  // Walking (or in the free view, moving the camera), relative to where the camera looks.
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
  const fast = keys.has('ShiftLeft') || keys.has('ShiftRight');
  if (mode === 'orbit') {
    // Flying: on along the way the camera looks, Space up and Ctrl (or C) down, faster the
    // further out it is; never below the floor.
    const c = Math.cos(orbit.pitch);
    forward.set(-Math.sin(orbit.yaw) * c, -Math.sin(orbit.pitch), -Math.cos(orbit.yaw) * c);
    right.set(Math.cos(orbit.yaw), 0, -Math.sin(orbit.yaw));
    const iy =
      (keys.has('Space') ? 1 : 0) -
      (keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC') ? 1 : 0);
    const step = Math.max(2, orbit.distance * 0.5) * (fast ? 2.5 : 1) * dt;
    const t = orbit.target;
    t.addScaledVector(right, ix * step).addScaledVector(forward, -iz * step);
    t.y = Math.max(0, t.y + iy * step);
    [ix, iz] = [0, 0];
  }
  forward.set(-Math.sin(follow.yaw), 0, -Math.cos(follow.yaw));
  right.set(-forward.z, 0, forward.x);
  before.copy(walker.pos);
  walker.update(dt, {
    x: right.x * ix - forward.x * iz,
    z: right.z * ix - forward.z * iz,
    run: fast || Math.hypot(stick.x, stick.y) > 0.9,
    jump: jump && mode === 'walk',
  });
  jump = false;
  const p = walker.pos;
  const simulated = performance.now();

  player.root.position.copy(p);
  // Turned toward the way they face quickly, rather than at once, so that they are seen to turn
  // side-on into a gap and back again out of it.
  const turn = walker.heading - player.root.rotation.y;
  player.root.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, dt * 14);
  const speed = dt > 0 ? Math.hypot(p.x - before.x, p.z - before.z) / dt : 0;
  const squeezing = walker.squeeze !== null;
  animatePlayer(
    player,
    squeezing ? 0 : speed,
    !walker.grounded,
    dt,
    squeezing ? walker.edging : null,
  );
  player.root.visible = !posed;
  slideDoors(walk.doors, posed ? null : p, dt);

  if (mode === 'walk') {
    camera.fov = 60;
    crown.set(p.x, p.y + 1.55, p.z);
    side.set(Math.cos(follow.yaw), 0, -Math.sin(follow.yaw));
    head.copy(crown).addScaledVector(side, clearSide(crown, side, SHOULDER));
    const c = Math.cos(follow.pitch);
    eye.set(Math.sin(follow.yaw) * c, -Math.sin(follow.pitch), Math.cos(follow.yaw) * c);
    // Pulled in only where it would be inside something, else left behind what is in the way.
    const d = clearBack(head, eye, follow.distance);
    // Easing out where the way is clear, else straight to where it can be.
    const out = back + (d - back) * Math.min(1, dt * 5);
    back = d < back || clearBack(head, eye, out) < out ? d : out;
    camera.position.copy(head).addScaledVector(eye, back);
    camera.lookAt(head);
  } else {
    const c = Math.cos(orbit.pitch);
    camera.position
      .set(Math.sin(orbit.yaw) * c, Math.sin(orbit.pitch), Math.cos(orbit.yaw) * c)
      .multiplyScalar(orbit.distance)
      .add(orbit.target);
    camera.fov = orbit.fov;
    camera.lookAt(orbit.target);
  }
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  // The brick works on a step, the player aiming where the crosshair is while walking.
  const aiming = mode === 'walk' && !posed && !picker.isOpen;
  works.update(dt, p, aiming ? { camera, head: crown } : null);
  carDoors.update(dt, aiming ? { camera, head: crown } : null);
  gateDoors(walk.gates);
  const aimedHint = carDoors.aimed ? carDoors.hint() : works.hint();
  const said = aiming ? sayHint(aimedHint, mouse.touch ? touchLabels('Use') : KEY_LABELS) : '';
  if (hint.textContent !== said) hint.textContent = said;
  floor.position.set(camera.position.x, 0, camera.position.z);
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
  walk: () => setMode('walk'),
  orbit: () => setMode('orbit'),
  /** Stands the player at (`x`, `z`) facing `heading`, the camera behind them. */
  place: (x: number, z: number, heading = 0, pitch = -0.22, distance = 4.5, reach?: number) => {
    walker.spawn(x, z, reach);
    walker.heading = heading;
    player.root.rotation.y = heading;
    setMode('walk');
    Object.assign(follow, { yaw: heading, pitch, distance });
  },
  /** Looks from `pos` at `target` with a field of view of `fov`, the player out of the way. */
  shot: (pos: [number, number, number], target: [number, number, number], fov = 46) => {
    setMode('orbit');
    fromView({ position: new THREE.Vector3(...pos), target: new THREE.Vector3(...target), fov });
    posed = true;
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
  works,
  carDoors,
  picker,
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
