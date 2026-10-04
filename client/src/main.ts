import RAPIER from '@dimforge/rapier3d-compat';
import {
  BRICK_TYPES,
  DT,
  SANDBOX,
  Sim,
  add,
  cameraPosition,
  length,
  scale,
  sub,
} from '@sar/shared';
import type { AimHit, Player, Vec3 } from '@sar/shared';
import { Sfx } from './audio.ts';
import { Input } from './input.ts';
import { connect } from './net.ts';
import type { NetStatus } from './net.ts';
import { View } from './render/view.ts';
import './style.css';

await RAPIER.init();

const sim = new Sim(RAPIER, SANDBOX, Date.now() >>> 0);
const me = sim.addPlayer();
const view = new View(document.getElementById('game')!, SANDBOX);
const input = new Input(view.renderer.domElement);
const sfx = new Sfx();
const hintEl = document.getElementById('hint')!;
const statusEl = document.getElementById('status')!;
const helpEl = document.getElementById('help')!;

input.holding = () => me.holding !== null;
input.onToggleHelp = () => helpEl.classList.toggle('hidden');
view.renderer.domElement.addEventListener('click', () => sfx.unlock());

let net: NetStatus = 'connecting';
connect((s) => (net = s));

// Handy for debugging in the browser console and for automated smoke tests.
Object.assign(window, { __sar: { sim, me, view, input } });

/** Pulls the third-person camera in front of walls so it never looks through them. */
function clipCamera(eye: Vec3, cam: Vec3, p: Player): Vec3 {
  const offset = sub(cam, eye);
  const dist = length(offset);
  if (dist < 1e-3) return cam;
  const dir = scale(offset, 1 / dist);
  const heldId = p.holding?.assemblyId;
  const hit = sim.world.castRay(
    new RAPIER.Ray(eye, dir),
    dist,
    true,
    undefined,
    undefined,
    p.collider,
    heldId !== undefined ? sim.assemblies.get(heldId)?.body : undefined,
  );
  return hit ? add(eye, scale(dir, Math.max(0.2, hit.timeOfImpact - 0.15))) : cam;
}

function hintFor(p: Player, hit: AimHit | null, canSnap: boolean): string {
  if (p.holding) {
    return canSnap
      ? 'Click: snap · R: rotate · G: drop · T: throw'
      : 'Aim at the top of a build to snap · Click: drop · T: throw';
  }
  if (!hit) return '';
  const o = hit.owner;
  if (o.kind === 'bin') {
    const bin = sim.level.bins.find((b) => b.id === o.binId)!;
    return `Click: take a ${bin.colour} ${bin.type}`;
  }
  if (o.kind !== 'brick') return '';
  const a = sim.assemblies.get(o.assemblyId);
  if (!a || a.heldBy !== null) return '';
  const brick = a.grid.bricks.get(o.brickId)!;
  if (BRICK_TYPES[brick.type].fixture) return 'Job site baseplate';
  if (a.anchored) return 'Click: pull this brick off';
  if (a.grid.size === 1) return 'Click: pick up';
  return 'Click: carry build · Right click: pull this brick off';
}

function playEvents(listener: Vec3): void {
  for (const e of sim.events) {
    const volume = 1 / (1 + length(sub(e.pos, listener)) / 4);
    if (e.kind === 'snap') sfx.click(volume);
    else if (e.kind === 'break') sfx.crash(volume);
    else if (e.kind === 'drop') sfx.thump(volume * 0.5);
  }
  sim.events = [];
}

let last = performance.now();
let acc = 0;
let fps = 60;

function frame(now: number): void {
  const elapsed = Math.min(0.25, (now - last) / 1000);
  last = now;
  fps += (1 / Math.max(elapsed, 1e-3) - fps) * 0.05;

  input.update();
  Object.assign(me.input, input.state);
  acc += elapsed;
  while (acc >= DT) {
    for (const action of input.drainActions()) sim.act(me.id, action);
    sim.step();
    acc -= DT;
  }

  const eye = sim.eye(me);
  const cam = clipCamera(eye, cameraPosition(eye, me.input), me);
  view.camera.position.set(cam.x, cam.y, cam.z);
  view.camera.rotation.set(me.input.pitch, me.input.yaw, 0, 'YXZ');

  const held = me.holding ? sim.assemblies.get(me.holding.assemblyId) : undefined;
  const preview = sim.snapPreview(me);
  view.syncAssemblies(sim.assemblies);
  view.syncPlayers(sim.players, me.id, me.input.firstPerson);
  view.showGhost(preview, held);
  playEvents(eye);

  hintEl.textContent = input.locked ? hintFor(me, sim.aim(me), preview !== null) : '';
  let bricks = 0;
  for (const a of sim.assemblies.values()) bricks += a.grid.size;
  statusEl.textContent = `${fps.toFixed(0)} fps · ${bricks} bricks in ${sim.assemblies.size} pieces · server ${net}`;

  view.render();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
