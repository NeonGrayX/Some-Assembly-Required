import RAPIER from '@dimforge/rapier3d-compat';
import {
  BRICK_TYPES,
  DT,
  EYE_OFFSET,
  LIGHTHOUSE,
  HOUSE,
  add,
  isLooseBrick,
  length,
  sub,
  v3,
} from '@sar/shared';
import type {
  Action,
  AimHit,
  InspectionReport,
  InspectorState,
  PageItem,
  Player,
  SimEvent,
  Vec3,
} from '@sar/shared';
import { Sfx } from './audio.ts';
import { Input } from './input.ts';
import { localConnection, withLag, wsConnection } from './net/connection.ts';
import type { Connection } from './net/connection.ts';
import { ClientGame } from './net/game.ts';
import { PagePrinter, pageContent, printIndex } from './render/pages.ts';
import { ResultsView } from './render/results.ts';
import { View } from './render/view.ts';
import { LobbyPanel, Menu } from './ui/lobby.ts';
import { SocialUI } from './ui/social.ts';
import './style.css';

await RAPIER.init();

/** The standard model, for the box art. Each round plays a recoloured variant of it. */
const TARGET = LIGHTHOUSE;
/** This round's model: what the pages, the index, the inspector and the results show. */
const roundTarget = () => game?.target ?? TARGET;
const view = new View(document.getElementById('game')!, HOUSE);
const input = new Input(view.renderer.domElement);
const printer = new PagePrinter();
const sfx = new Sfx();
const params = new URLSearchParams(location.search);
const lagMs = Number(params.get('lag') ?? 0);

let game: ClientGame | null = null;
let solo = false;

const $ = (id: string) => document.getElementById(id)!;
const hintEl = $('hint');
const statusEl = $('status');
const helpEl = $('help');
const timerEl = $('timer');
const pocketEl = $('pocket');
const readerEl = $('reader');
const reportEl = $('report');
const bannerEl = $('banner');
let reportPinned = false;

const results = new ResultsView(document.body, () => game?.send({ t: 'again' }));
const indexArt = new Map<string, HTMLCanvasElement>();
/** Art for whatever is printed on a page; forgeries get their own (slightly wrong) art. */
const pageArt = (page: PageItem): HTMLCanvasElement => {
  const printed = page.printed ?? { step: -1, added: [], stamp: '?' };
  if (printed.step < 0) {
    const key = `${game?.worldVersion}:${printed.stamp}`;
    let art = indexArt.get(key);
    if (!art) indexArt.set(key, (art = printIndex(roundTarget(), printed.stamp)));
    return art;
  }
  const content = pageContent(roundTarget(), printed);
  return printer.page(content, JSON.stringify(content));
};
const social = new SocialUI(
  () => game,
  () => void view.renderer.domElement.requestPointerLock(),
);

// Box art in the corner, so everyone knows what they are building.
const targetEl = $('target');
targetEl.querySelector('.name')!.textContent = TARGET.name;
targetEl
  .querySelector('canvas')!
  .getContext('2d')!
  .drawImage(printer.boxArt(TARGET), 0, 0, 160, 160);

input.holding = () => game?.me?.holding != null;
input.onToggleHelp = () => helpEl.classList.toggle('pinned');
/** Opens the reader on a page, with an optional line saying where it came from. */
function openReader(art: HTMLCanvasElement, caption = ''): void {
  const big = document.createElement('canvas');
  big.width = art.width;
  big.height = art.height;
  big.getContext('2d')!.drawImage(art, 0, 0);
  const label = document.createElement('div');
  label.className = 'caption';
  label.textContent = caption;
  readerEl.replaceChildren(...(caption ? [label] : []), big);
  readerEl.classList.remove('hidden');
}

function closeReader(): void {
  readerEl.classList.add('hidden');
  readerShown = null;
}

/** What the reader shows: 'pocket', 'shown' (held up by someone) or a page id. */
let readerShown: string | null = null;

// Q reads the page you are looking at (wherever it lies), otherwise the one in your pocket.
input.onToggleReader = () => {
  const g = game;
  const me = g?.me;
  if (!g || !me || !readerEl.classList.contains('hidden')) return closeReader();
  const hit = g.sim.aim(me);
  const aimed = hit?.owner.kind === 'page' ? g.sim.pages.get(hit.owner.pageId) : undefined;
  if (aimed) {
    openReader(pageArt(aimed), 'Reading it where it lies');
    readerShown = `page:${aimed.id}`;
  } else if (me.page !== null) {
    const page = g.sim.pages.get(me.page);
    if (page) {
      openReader(pageArt(page));
      readerShown = 'pocket';
    }
  }
};
input.onShow = () => {
  if (game?.me?.page != null) game.send({ t: 'show' });
};
input.onToggleReport = () => (reportPinned = !reportPinned);
input.onChat = () => {
  if (game) social.openChat();
};
// With the mouse free (in a meeting, or after Esc) Enter still opens the chat.
document.addEventListener('keydown', (e) => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
  if (e.key === 'Enter' && game && !input.locked && !typing && !social.chatOpen) social.openChat();
});
view.renderer.domElement.addEventListener('click', () => sfx.unlock());

// ------------------------------------------------------------------ joining

const tokenKey = (code: string) => `sar.token.${code}`;
const readToken = (code: string) => {
  try {
    return sessionStorage.getItem(tokenKey(code)) ?? undefined;
  } catch {
    return undefined;
  }
};

async function open(name: string, room: string | undefined, local: boolean): Promise<void> {
  menu.hide();
  banner(local ? '' : 'Connecting…');
  let conn: Connection;
  try {
    conn = local ? localConnection(RAPIER) : await wsConnection();
  } catch (err) {
    banner('');
    menu.showError(`${(err as Error).message} Try "Play solo" instead.`);
    return;
  }
  if (lagMs > 0) conn = withLag(conn, lagMs);
  game?.close();
  solo = local;
  const g = new ClientGame(RAPIER, conn);
  game = g;
  conn.onClose = (reason) => void lost(g, name, reason);
  g.hello(name, room, room ? readToken(room) : undefined);
}

/** Tries to get back into the same room a few times before giving up. */
async function lost(g: ClientGame, name: string, reason: string): Promise<void> {
  if (game !== g) return;
  if (g.error) {
    // The server turned us away (unknown room, full room): no point retrying.
    game = null;
    banner('');
    menu.showError(g.error);
    return;
  }
  const room = g.roomCode;
  for (let attempt = 1; attempt <= 5 && room; attempt++) {
    banner(`${reason} Reconnecting (${attempt}/5)…`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
    if (game !== g) return;
    try {
      let conn = await wsConnection();
      if (lagMs > 0) conn = withLag(conn, lagMs);
      const next = new ClientGame(RAPIER, conn);
      game = next;
      conn.onClose = (why) => void lost(next, name, why);
      next.hello(name, room, readToken(room));
      banner('');
      return;
    } catch {
      // Try again.
    }
  }
  game = null;
  banner('');
  menu.showError(`${reason} Could not get back in.`);
}

function banner(text: string): void {
  bannerEl.textContent = text;
  bannerEl.classList.toggle('hidden', !text);
}

const menu = new Menu({
  create: (name) => void open(name, undefined, false),
  join: (name, code) => void open(name, code, false),
  solo: (name) => void open(name, undefined, true),
});
const lobbyPanel = new LobbyPanel(() => game);

let welcomed = '';
/** Once in a room: remember the reconnect token and put the room code in the address bar. */
function onWelcome(g: ClientGame): void {
  if (g.error) {
    const message = g.error;
    g.close();
    game = null;
    menu.showError(message);
    return;
  }
  if (!g.roomCode || welcomed === `${g.roomCode}:${g.token}`) return;
  welcomed = `${g.roomCode}:${g.token}`;
  banner('');
  if (solo) return;
  try {
    sessionStorage.setItem(tokenKey(g.roomCode), g.token);
  } catch {
    // Without storage a reload just joins as a new player.
  }
  history.replaceState(null, '', `/${g.roomCode}${location.search}`);
}

// Handy for debugging in the browser console and for automated smoke tests.
Object.assign(window, { __sar: { view, input, game: () => game, open, pageArt } });

// ------------------------------------------------------------------ HUD helpers

const IDLE_INSPECTOR: InspectorState = {
  status: 'idle',
  progress: 0,
  report: null,
  scannedVersion: -1,
};

function hintFor(g: ClientGame, p: Player, hit: AimHit | null, canSnap: boolean): string {
  const o = hit?.owner;
  if (o?.kind === 'page') {
    const what = g.sim.pages.get(o.pageId)?.step === -1 ? 'the master index' : 'this page';
    const take = p.page === null ? `Click: pick up ${what}` : `Click: swap your pocket for ${what}`;
    return `${take} · Q: read it here`;
  }
  if (o?.kind === 'hideout') {
    const h = g.sim.hideouts.get(o.hideoutId);
    if (!h) return '';
    const name =
      h.def.kind === 'cushion'
        ? 'sofa cushion'
        : h.def.kind === 'cabinet'
          ? 'TV cabinet'
          : h.def.kind;
    if (h.def.kind === 'rug')
      return h.open ? 'Click: lay the rug back down' : 'Click: lift the rug';
    return h.open ? `Click: close the ${name}` : `Click: open the ${name}`;
  }
  if (o?.kind === 'board') {
    return p.page !== null
      ? 'Click: pin your page to the board for everyone'
      : 'Corkboard: pin pages here so everyone can read them';
  }
  if (o?.kind === 'button' && o.buttonId === 'bell') {
    if (!g.round) return 'The meeting bell works once a round has started';
    return 'Click: ring the bell for a Brick Meeting (one per player per round)';
  }
  if (o?.kind === 'button') {
    if (!g.round) return 'The Done button works once a round has started';
    return g.round.doneArmed
      ? 'Click again to hand in the build!'
      : 'Click: Done (hand in the build and end the round)';
  }
  if (p.holding) {
    const held = g.sim.assemblies.get(p.holding.assemblyId);
    if (held && !isLooseBrick(held)) return 'G: set the build down gently · T: throw';
    return canSnap
      ? 'Click: snap · R: rotate · G: drop · T: throw'
      : 'Aim at the top of a build to snap · Click: drop · T: throw';
  }
  if (!o) return '';
  if (o.kind === 'bin') {
    const bin = g.sim.level.bins.find((b) => b.id === o.binId)!;
    const n = g.sim.binStock.get(bin.id) ?? null;
    if (n === 0) return `This bin of ${bin.colour} ${bin.type} is empty`;
    return `Click: take a ${bin.colour} ${bin.type}${n === null ? '' : ` (${n} left)`}`;
  }
  if (o.kind === 'player') {
    const name = g.lobby.players.find((x) => x.id === o.playerId)?.name;
    return name ?? '';
  }
  if (o.kind !== 'brick') return '';
  const a = g.sim.assemblies.get(o.assemblyId);
  if (!a) return '';
  if (a.heldBy !== null) {
    const who = g.lobby.players.find((x) => x.id === a.heldBy)?.name;
    return who ? `${who} is holding this` : '';
  }
  const brick = a.grid.bricks.get(o.brickId);
  if (!brick) return '';
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
    if (e.kind === 'swap' || e.kind === 'forge' || e.kind === 'hide') {
      // A saboteur tell: only sent to players close enough to notice.
      view.puff(e.pos);
      sfx.rustle(volume);
    } else if (e.kind === 'meeting') sfx.bell();
    else if (e.kind === 'open' || e.kind === 'close') sfx.thump(volume * 0.8);
    else if (e.kind === 'pin') sfx.click(volume);
    else if (e.kind === 'empty') sfx.thump(volume * 0.4);
    else if (e.kind === 'snap' || e.kind === 'page' || e.kind === 'button') sfx.click(volume);
    else if (e.kind === 'break') sfx.crash(volume);
    else if (e.kind === 'drop' || e.kind === 'anchor') sfx.thump(volume * 0.6);
  }
}

let shownPage: string | null = null;
function updatePocket(g: ClientGame, me: Player): void {
  // Redraw when the pocket changes or the page in it is reprinted (forged).
  const key = me.page === null ? null : `${me.page}:${g.sim.pages.get(me.page)?.version}`;
  if (key === shownPage) return;
  shownPage = key;
  const page = me.page === null ? undefined : g.sim.pages.get(me.page);
  pocketEl.classList.toggle('hidden', !page);
  if (readerShown === 'pocket') {
    if (page) openReader(pageArt(page));
    else closeReader();
  }
  if (!page) return;
  const art = pageArt(page);
  pocketEl.querySelector('.title')!.textContent =
    page.step < 0 ? 'Master index' : `Page ${page.step + 1} of ${TARGET.steps.length}`;
  pocketEl.querySelector('canvas')!.getContext('2d')!.drawImage(art, 0, 0, 90, 126);
}

let shownAt = 0;
/** Someone held up a page for us: show it for a while. */
function updateShown(g: ClientGame): void {
  const s = g.shown;
  if (s && s.at !== shownAt) {
    shownAt = s.at;
    const what = s.printed.step < 0 ? 'the master index' : `page ${s.printed.step + 1}`;
    openReader(
      pageArt({ ...dummyPage, printed: s.printed, step: s.printed.step }),
      `${g.nameOf(s.from)} shows you ${what}`,
    );
    readerShown = 'shown';
  }
  if (readerShown === 'shown' && s && performance.now() - s.at > SHOWN_MS) closeReader();
}
const SHOWN_MS = 10000;
const dummyPage: PageItem = {
  id: -1,
  step: 0,
  printed: null,
  body: null,
  carriedBy: null,
  hideout: null,
  pinned: null,
  version: 0,
};

let shownReport: InspectionReport | null = null;
/** The inspector's full report, shown near the inspector or when pinned with I. */
function updateReport(g: ClientGame, me: Player): void {
  const report = g.round?.inspector.report ?? null;
  const pad = g.sim.level.inspector.pos;
  const p = me.body.translation();
  const near = Math.hypot(p.x - pad.x, p.z - pad.z) < 4.5;
  reportEl.classList.toggle(
    'hidden',
    !report || !(near || reportPinned) || g.round?.phase !== 'building',
  );
  if (!report || report === shownReport) return;
  shownReport = report;
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const rows = report.steps.map((s, i) => {
    const head =
      s.verdict === 'empty'
        ? `<span class="muted">not started</span>`
        : `<span class="${s.verdict}">${s.correct} of ${s.total} correct</span>`;
    const lines = s.lines.map((l) => `<li class="${l.kind}">${esc(l.text)}</li>`).join('');
    return `<h4>Step ${i + 1} · ${head}</h4>${lines ? `<ul>${lines}</ul>` : ''}`;
  });
  if (report.extras.length) {
    rows.push(
      `<h4>Not in the plans</h4><ul>${report.extras.map((l) => `<li class="extra">${esc(l.text)}</li>`).join('')}</ul>`,
    );
  }
  reportEl.innerHTML =
    `<h3>Inspection report: ${report.correct} of ${report.total} bricks correct</h3>` +
    `<p class="muted">Problems are marked on the build until you fix them. I: pin this list.</p>` +
    rows.join('');
}

function updateTimer(g: ClientGame): void {
  timerEl.classList.toggle('hidden', !g.round);
  if (!g.round) return;
  const t = Math.ceil(g.round.timeLeft);
  timerEl.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  timerEl.classList.toggle('low', t <= 60);
}

/** Players sent home float around freely to watch. */
function flyCamera(dt: number): void {
  const s = input.state;
  const speed = (s.sprint ? 8 : 4) * dt;
  const fwd = {
    x: -Math.sin(s.yaw) * Math.cos(s.pitch),
    y: Math.sin(s.pitch),
    z: -Math.cos(s.yaw) * Math.cos(s.pitch),
  };
  const right = { x: Math.cos(s.yaw), y: 0, z: -Math.sin(s.yaw) };
  const c = view.camera.position;
  c.x += (fwd.x * s.forward + right.x * s.right) * speed;
  c.y = Math.max(0.3, c.y + fwd.y * s.forward * speed + (s.jump ? speed : 0));
  c.z += (fwd.z * s.forward + right.z * s.right) * speed;
  view.camera.rotation.set(s.pitch, s.yaw, 0, 'YXZ');
}

const look = (g: ClientGame) => (id: number) => {
  const p = g.lobby.players.find((x) => x.id === id);
  return { colour: p?.colour ?? 0x7f8c8d, name: p?.name ?? '' };
};

// ------------------------------------------------------------------ loop

let last = performance.now();
let acc = 0;
let fps = 60;
let shownWorld = -1;
let shownGame: ClientGame | null = null;

function frame(now: number): void {
  const elapsed = Math.min(0.25, (now - last) / 1000);
  last = now;
  fps += (1 / Math.max(elapsed, 1e-3) - fps) * 0.05;
  const g = game;
  input.update();

  if (g !== shownGame || (g && g.worldVersion !== shownWorld)) {
    view.reset();
    results.hide();
    shownReport = null;
    shownPage = null;
    shownGame = g;
    shownWorld = g?.worldVersion ?? -1;
  }
  timerEl.classList.toggle('hidden', !g?.round);
  lobbyPanel.update();
  if (!g) social.update(now);

  if (!g) {
    // Before joining: a slow fly-around of the empty yard behind the menu.
    const t = now / 1000;
    view.camera.position.set(Math.sin(t * 0.1) * 9, 5, Math.cos(t * 0.1) * 9);
    view.camera.lookAt(0, 0.5, 0);
    view.render();
    requestAnimationFrame(frame);
    return;
  }
  onWelcome(g);

  acc += elapsed;
  while (acc >= DT) {
    const actions: Action[] = g.round?.phase === 'results' ? [] : input.drainActions();
    g.tick(input.state, actions);
    acc -= DT;
  }
  if (g.round?.phase === 'results' && !results.visible && g.round.result) {
    document.exitPointerLock();
    readerEl.classList.add('hidden');
    const ending = g.ending && {
      winner: g.ending.winner,
      roles: [...g.ending.roles].map(([id, role]) => ({
        name: g.nameOf(id),
        role,
        home: g.ending!.sentHome.includes(id),
      })),
    };
    results.show(roundTarget(), g.sim.build().grid, g.round.result, g.round.endReason!, ending);
  }
  if (results.visible) results.setHost(g.isHost);
  if (g.phase === 'lobby' && results.visible) results.hide();

  // Draw everything blended between the last two physics steps.
  const alpha = acc / DT;
  g.settle(elapsed);
  view.poseOf = (body) => g.pose(body, alpha);
  const me = g.me;
  const eye = me ? add(g.pose(me.body, alpha).pos, v3(0, EYE_OFFSET, 0)) : v3(0, 2, 6);
  if (me) {
    const cam = g.sim.camera(me, eye, input.state);
    view.camera.position.set(cam.x, cam.y, cam.z);
    view.camera.rotation.set(input.state.pitch, input.state.yaw, 0, 'YXZ');
  } else if (g.sentHome && g.phase === 'building') {
    flyCamera(elapsed);
  }

  const held = me?.holding ? g.sim.assemblies.get(me.holding.assemblyId) : undefined;
  const preview = me ? g.sim.snapPreview(me) : null;
  const inspector = g.round?.inspector ?? IDLE_INSPECTOR;
  view.syncAssemblies(g.sim.assemblies);
  view.syncPlayers(g.sim.players, g.myId, input.state.firstPerson, look(g));
  view.syncPages(g.sim.pages, pageArt);
  view.showGhost(preview, held);
  view.showInspector(inspector, roundTarget());
  const build = g.sim.assemblies.get(g.sim.buildId);
  if (build) view.showInspectionMarks(inspector.report, build);
  playEvents(g.takeEvents(), eye);
  view.updateEffects(elapsed);
  view.furniture.sync(g.sim.hideouts, g.sim.binStock, g.sim.furnitureVersion);
  updateShown(g);
  social.update(now);
  updateTimer(g);
  if (me) {
    updateReport(g, me);
    updatePocket(g, me);
  }

  hintEl.textContent = input.locked && me ? hintFor(g, me, g.sim.aim(me), preview !== null) : '';
  const where = solo ? 'solo' : `room ${g.roomCode} · ${Math.round(g.ping)} ms`;
  statusEl.textContent = `${fps.toFixed(0)} fps · ${where} · ${g.lobby.players.filter((p) => p.connected).length} players`;

  view.render();
  results.frame(elapsed);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
