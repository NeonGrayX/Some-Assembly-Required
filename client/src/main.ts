import RAPIER from '@dimforge/rapier3d-compat';
import {
  BRICK_TYPES,
  DT,
  LIGHTHOUSE,
  Round,
  SANDBOX,
  Sim,
  add,
  cameraPosition,
  length,
  scale,
  sub,
} from '@sar/shared';
import type { AimHit, Player, SimEvent, Vec3 } from '@sar/shared';
import { Sfx } from './audio.ts';
import { Input } from './input.ts';
import { connect } from './net.ts';
import type { NetStatus } from './net.ts';
import { PagePrinter, pageContent } from './render/pages.ts';
import { ResultsView } from './render/results.ts';
import { View } from './render/view.ts';
import './style.css';

await RAPIER.init();

const TARGET = LIGHTHOUSE;
const seed = Date.now() >>> 0;
const sim = new Sim(RAPIER, SANDBOX, seed);
const round = new Round(sim, TARGET, { seed });
const me = sim.addPlayer();
const view = new View(document.getElementById('game')!, SANDBOX);
const input = new Input(view.renderer.domElement);
const printer = new PagePrinter();
const results = new ResultsView(document.body, () => location.reload());
const sfx = new Sfx();

const $ = (id: string) => document.getElementById(id)!;
const hintEl = $('hint');
const statusEl = $('status');
const helpEl = $('help');
const timerEl = $('timer');
const pocketEl = $('pocket');
const readerEl = $('reader');

const pageArt = (step: number) => printer.page(pageContent(TARGET, step), `${TARGET.id}:${step}`);

// Box art in the corner, so everyone knows what they are building.
const targetEl = $('target');
targetEl.querySelector('.name')!.textContent = TARGET.name;
targetEl
  .querySelector('canvas')!
  .getContext('2d')!
  .drawImage(printer.boxArt(TARGET), 0, 0, 160, 160);

input.holding = () => me.holding !== null;
input.onToggleHelp = () => helpEl.classList.toggle('pinned');
input.onToggleReader = () => {
  if (me.page !== null || !readerEl.classList.contains('hidden')) {
    readerEl.classList.toggle('hidden');
  }
};
view.renderer.domElement.addEventListener('click', () => sfx.unlock());

let net: NetStatus = 'connecting';
connect((s) => (net = s));

// Handy for debugging in the browser console and for automated smoke tests.
Object.assign(window, { __sar: { sim, round, me, view, input } });

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
  const o = hit?.owner;
  if (o?.kind === 'page') {
    return p.page === null
      ? 'Click: pick up this page'
      : 'Click: swap it for the page in your pocket';
  }
  if (o?.kind === 'button') {
    return round.doneArmed
      ? 'Click again to hand in the build!'
      : 'Click: Done (hand in the build and end the round)';
  }
  if (p.holding) {
    const held = sim.assemblies.get(p.holding.assemblyId);
    if (held && held.grid.size > 1) return 'G: set the build down gently · T: throw';
    return canSnap
      ? 'Click: snap · R: rotate · G: drop · T: throw'
      : 'Aim at the top of a build to snap · Click: drop · T: throw';
  }
  if (!o) return '';
  if (o.kind === 'bin') {
    const bin = sim.level.bins.find((b) => b.id === o.binId)!;
    return `Click: take a ${bin.colour} ${bin.type}`;
  }
  if (o.kind !== 'brick') return '';
  const a = sim.assemblies.get(o.assemblyId);
  if (!a || a.heldBy !== null) return '';
  const brick = a.grid.bricks.get(o.brickId)!;
  if (BRICK_TYPES[brick.type].fixture) {
    return a.anchored ? 'Click: lift the whole build off the job site' : 'Click: carry the build';
  }
  if (a.anchored) return 'Click: pull this brick off';
  if (a.grid.size === 1) return 'Click: pick up';
  return 'Click: carry build · Right click: pull this brick off';
}

function playEvents(events: SimEvent[], listener: Vec3): void {
  for (const e of events) {
    const volume = 1 / (1 + length(sub(e.pos, listener)) / 4);
    if (e.kind === 'snap' || e.kind === 'page' || e.kind === 'button') sfx.click(volume);
    else if (e.kind === 'break') sfx.crash(volume);
    else if (e.kind === 'drop' || e.kind === 'anchor') sfx.thump(volume * 0.6);
  }
}

let shownPage: number | null = null;
function updatePocket(): void {
  if (me.page === shownPage) return;
  shownPage = me.page;
  const page = me.page === null ? undefined : sim.pages.get(me.page);
  pocketEl.classList.toggle('hidden', !page);
  readerEl.replaceChildren();
  if (!page) {
    readerEl.classList.add('hidden');
    return;
  }
  const art = pageArt(page.step);
  pocketEl.querySelector('.title')!.textContent = `Page ${page.step + 1} of ${TARGET.steps.length}`;
  pocketEl.querySelector('canvas')!.getContext('2d')!.drawImage(art, 0, 0, 90, 126);
  const big = document.createElement('canvas');
  big.width = art.width;
  big.height = art.height;
  big.getContext('2d')!.drawImage(art, 0, 0);
  readerEl.append(big);
}

function updateTimer(): void {
  const t = Math.ceil(round.timeLeft);
  timerEl.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  timerEl.classList.toggle('low', t <= 60);
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
  const events: SimEvent[] = [];
  while (acc >= DT) {
    if (round.phase === 'building') {
      for (const action of input.drainActions()) sim.act(me.id, action);
    }
    sim.step();
    round.update();
    events.push(...sim.events);
    sim.events = [];
    acc -= DT;
  }

  if (round.phase === 'results' && !results.visible) {
    document.exitPointerLock();
    readerEl.classList.add('hidden');
    results.show(TARGET, sim.build().grid, round.result!, round.endReason!);
  }

  const eye = sim.eye(me);
  const cam = clipCamera(eye, cameraPosition(eye, me.input), me);
  view.camera.position.set(cam.x, cam.y, cam.z);
  view.camera.rotation.set(me.input.pitch, me.input.yaw, 0, 'YXZ');

  const held = me.holding ? sim.assemblies.get(me.holding.assemblyId) : undefined;
  const preview = sim.snapPreview(me);
  view.syncAssemblies(sim.assemblies);
  view.syncPlayers(sim.players, me.id, me.input.firstPerson);
  view.syncPages(sim.pages, pageArt);
  view.showGhost(preview, held);
  view.showInspector(round.inspector, TARGET);
  playEvents(events, eye);
  updatePocket();
  updateTimer();

  hintEl.textContent = input.locked ? hintFor(me, sim.aim(me), preview !== null) : '';
  let bricks = 0;
  for (const a of sim.assemblies.values()) bricks += a.grid.size;
  statusEl.textContent = `${fps.toFixed(0)} fps · ${bricks} bricks in ${sim.assemblies.size} pieces · server ${net}`;

  view.render();
  results.frame(elapsed);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
