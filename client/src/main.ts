import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import {
  BRICK_TYPES,
  brickName,
  DEFAULT_LOOK,
  DT,
  EYE_OFFSET,
  GEAR_IDS,
  LIGHTHOUSE,
  MAPS,
  RANDOM_BUILD,
  VACUUM_CAPACITY,
  buildById,
  gearName,
  add,
  isLooseBrick,
  tiredFactor,
  length,
  litAt,
  makeableColours,
  MOULD_TYPES,
  shapeName,
  sub,
  v3,
  pageName,
  pageNumber,
  levelSites,
  viewDir,
  withoutColours,
} from '@sar/shared';
import type {
  Action,
  AimHit,
  Beam,
  InspectionReport,
  InspectorState,
  MachineState,
  PageItem,
  Player,
  Look,
  SimEvent,
  TargetBuild,
  Vec3,
} from '@sar/shared';
import { Sfx } from './audio.ts';
import { Benchmark } from './bench/bench.ts';
import { BotArena } from './bench/arena.ts';
import { BenchReport } from './bench/report.ts';
import { BenchSetup } from './bench/setup.ts';
import type { BenchRun, FrameRun } from './bench/setup.ts';
import { Input, freeMouse, toggleFullscreen } from './input.ts';
import { loadSettings } from './settings.ts';
import { localConnection, takeSoloServerMs, withLag, wsConnection } from './net/connection.ts';
import type { Connection } from './net/connection.ts';
import { ClientGame } from './net/game.ts';
import { PagePrinter, pageContent, printIndex, printUnreadable } from './render/pages.ts';
import { printsVersion } from './render/prints.ts';
import { ResultsView } from './render/results.ts';
import { CameraRig } from './render/camera.ts';
import { MenuOrbit } from './render/menuOrbit.ts';
import { HIDEOUT_TRAVEL } from './render/furniture.ts';
import { loadPropFiles } from './render/propFiles.ts';
import { view } from './worldView.ts';
import { AppBar } from './ui/appbar.ts';
import { DemoPanel } from './ui/demo.ts';
import { Dock } from './ui/dock.ts';
import { setText } from './ui/dom.ts';
import { defaultBuildName, exportJobSite } from './ui/exportBuild.ts';
import { LobbyPanel, Menu, savedLook } from './ui/lobby.ts';
import { loadingDone, loadingStep } from './ui/loading.ts';
import { PerfPanel } from './ui/perf.ts';
import { SettingsPanel } from './ui/settings.ts';
import { SocialUI } from './ui/social.ts';
import { MachinePicker } from './ui/machinePicker.ts';
import { TouchControls } from './ui/touch.ts';
import { Voice } from './voice.ts';
import type { Listener, Speaker } from './voice.ts';
import { SCREAM_MS, reaches, voiceMix } from './voice-mix.ts';
import './style.css';

// Levels are built at once, so the prop model files are read first.
loadingStep('Loading the furniture and the physics…');
await Promise.all([RAPIER.init(), loadPropFiles()]);
loadingStep('Building the house…');

/** This round's build in its design colours, for the box art. Each round recolours it. */
const designTarget = () => buildById(game?.targetId ?? '') ?? LIGHTHOUSE;
/** This round's model: what the pages, the index, the inspector and the results show. */
const roundTarget = () => game?.target ?? designTarget();
const input = new Input(view.renderer.domElement);
/** Where the camera is drawn from: with the player, eased only where a wall or the toggle gets in the way. */
const rig = new CameraRig();
const printer = new PagePrinter();
const sfx = new Sfx();
for (const el of document.querySelectorAll('[data-version]')) el.textContent = __APP_VERSION__;
const settings = loadSettings();
input.sensitivity = settings.sensitivity;
sfx.setVolume(settings.volume, settings.muted);
view.graphics.apply(settings.graphics);
const settingsPanel = new SettingsPanel(settings, (s, changed) => {
  input.sensitivity = s.sensitivity;
  sfx.setVolume(s.volume, s.muted);
  if (changed === 'mic' && voice) {
    const v = voice;
    void v.setMode(s.mic).then(() => settingsPanel.setMicProblem(v.micError));
  }
  if (changed === 'graphics') view.graphics.apply(s.graphics);
  if (changed === 'volume') {
    // A preview click, so they hear the new level.
    sfx.click();
  }
});
const params = new URLSearchParams(location.search);
const lagMs = Number(params.get('lag') ?? 0);

let game: ClientGame | null = null;
let solo = false;

const $ = (id: string) => document.getElementById(id)!;
const hintEl = $('hint');
const statusEl = $('status');
const perf = new PerfPanel(statusEl, () => (solo ? null : (game?.pings ?? [])));
const timerEl = $('timer');
const pocketEl = $('pocket');
const readerEl = $('reader');
const reportEl = $('report');
const bannerEl = $('banner');
let reportPinned = false;

// In demo mode "again" goes straight into a new round with the demo panel's choices.
const results = new ResultsView(
  document.body,
  () => (demo.active ? demo.newRound() : game?.send({ t: 'again' })),
  (name) => (game ? exportJobSite(game, name) : ''),
);
const demo = new DemoPanel(() => game);
const indexArt = new Map<string, HTMLCanvasElement>();
let unreadableArt: HTMLCanvasElement | null = null;
/**
 * Art for whatever is printed on a page; forgeries get their own (slightly wrong) art. A page
 * with nothing readable on it (blind build mode, for all but the reader) is a smudge.
 */
const pageArt = (page: PageItem): HTMLCanvasElement => {
  const printed = page.printed;
  if (!printed) return (unreadableArt ??= printUnreadable());
  if (printed.step < 0) {
    const key = `${game?.worldVersion}:${printed.stamp}:${view.colourBlind ? 'grey' : ''}`;
    let art = indexArt.get(key);
    if (!art) indexArt.set(key, (art = printIndex(roundTarget(), printed.stamp)));
    return art;
  }
  const content = pageContent(roundTarget(), printed);
  // The build's pictures are the same on every page, so they are left out of the key.
  return printer.page(content, JSON.stringify({ ...content, svgs: undefined }));
};
const social = new SocialUI(
  () => game,
  () => input.relock(),
);

// Box art in the corner, so everyone knows what they are building. In the lobby it shows the
// host's pick for the next round, or a question mark when the round picks one at random.
const targetEl = $('target');
/** The build whose art is shown (null for the question mark); undefined before the first. */
let shownBoxArt: TargetBuild | null | undefined;
let shownBoxArtGrey = false;
let shownBoxArtPrints = -1;
let shownBoxArtFree = false;
function updateBoxArt(): void {
  const g = game;
  const next = g?.phase === 'lobby' ? g.lobby.build : null;
  const build = next === RANDOM_BUILD ? null : (buildById(next ?? '') ?? designTarget());
  // A free build has no box art: there is nothing to build but what you like.
  const free = (g?.phase === 'lobby' ? g.lobby.mode : g?.mode) === 'free';
  if (
    build === shownBoxArt &&
    free === shownBoxArtFree &&
    view.colourBlind === shownBoxArtGrey &&
    printsVersion() === shownBoxArtPrints
  )
    return;
  shownBoxArt = build;
  shownBoxArtFree = free;
  shownBoxArtGrey = view.colourBlind;
  shownBoxArtPrints = printsVersion();
  targetEl.classList.toggle('free', free);
  if (free) {
    setText(targetEl.querySelector('.eyebrow')!, 'Free build');
    setText(targetEl.querySelector('.name')!, 'Build anything');
    setText(
      targetEl.querySelector('small')!,
      'No plans and no clock. Esc, then Export build, saves it as a build file. Done twice ends the session.',
    );
    return;
  }
  setText(targetEl.querySelector('.eyebrow')!, 'Build this');
  setText(
    targetEl.querySelector('small')!,
    "Colours change every round: the hidden pages and the master index show this round's.",
  );
  targetEl.querySelector('.name')!.textContent = build?.name ?? 'a surprise build';
  const ctx = targetEl.querySelector('canvas')!.getContext('2d')!;
  ctx.clearRect(0, 0, 160, 160);
  if (build) {
    ctx.drawImage(printer.boxArt(build), 0, 0, 160, 160);
  } else {
    ctx.fillStyle = '#5c5f62';
    ctx.font = 'bold 110px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', 80, 86);
  }
}
updateBoxArt();

input.holding = () => game?.me?.holding != null || game?.me?.tool != null;
input.vacuuming = () => !!game?.me && game.sim.vacuum.heldBy === game.me.id;
input.onToggleHelp = () => dock.togglePinned();
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

/** Every headlamp's beam: from its wearer's eye, the way they look. */
function beams(g: ClientGame): Beam[] {
  return [...g.sim.players.values()]
    .filter((p) => p.gear.has('headlamp'))
    .map((p) => ({ eye: g.sim.eye(p), dir: viewDir(p.input.yaw, p.input.pitch) }));
}

/** Whether a page at `at` can be read: not in a gear hunt's dark house, except in a beam. */
function canRead(g: ClientGame, at: Vec3): boolean {
  if (g.mode !== 'gear') return true;
  return litAt(g.sim.level, at, g.night, g.sim.power.on, beams(g));
}
const TOO_DARK = 'Too dark to read here. Take it outside, or get the headlamp\u2019s beam on it.';

// Q reads the page you are looking at (wherever it lies), otherwise the one in your pocket.
input.onToggleReader = () => {
  const g = game;
  const me = g?.me;
  if (!g || !me || !readerEl.classList.contains('hidden')) return closeReader();
  const hit = g.sim.aim(me);
  const aimed = hit?.owner.kind === 'page' ? g.sim.pages.get(hit.owner.pageId) : undefined;
  if (aimed) {
    if (!canRead(g, aimed.body?.translation() ?? me.body.translation())) return notice(TOO_DARK);
    openReader(pageArt(aimed), 'Reading it where it lies');
    readerShown = `page:${aimed.id}`;
  } else if (me.page !== null) {
    const page = g.sim.pages.get(me.page);
    if (page) {
      if (!canRead(g, me.body.translation())) return notice(TOO_DARK);
      openReader(pageArt(page));
      readerShown = 'pocket';
    }
  }
};
// Number keys: the saboteur's tools, or in a gear hunt the gear to take off and hand over.
input.onDigit = (n) => {
  const g = game;
  if (!g) return;
  if (g.mode === 'gear') {
    const kind = GEAR_IDS[n - 1];
    if (kind && g.worn.has(kind)) input.act({ kind: 'unequip', gear: kind });
    return;
  }
  const tool = (['swap', 'forge', 'clumsy', 'trap', 'tamper'] as const)[n - 1];
  if (tool) input.act({ kind: 'sabotage', tool });
};
// Esc closes an open manual page before it frees the mouse.
input.onEscape = () => {
  if (readerEl.classList.contains('hidden')) return false;
  closeReader();
  return true;
};
// Outside full screen the browser frees the mouse on Esc before the game hears it, so close the
// page and take the mouse straight back. The game frees it on purpose for the chat, settings,
// meetings and results; leave the page open for those.
input.onEscapeUnlock = () => {
  if (readerEl.classList.contains('hidden')) return;
  if (social.chatOpen || settingsPanel.isOpen || game?.meeting || results.visible) return;
  if (picker.isOpen) return;
  closeReader();
  input.relock();
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

// ------------------------------------------------------------------ joining

const tokenKey = (code: string) => `sar.token.${code}`;
const readToken = (code: string) => {
  try {
    return sessionStorage.getItem(tokenKey(code)) ?? undefined;
  } catch {
    return undefined;
  }
};

async function open(
  name: string,
  look: Look,
  room: string | undefined,
  local: boolean,
  /** A solo game that is the demo, or a benchmark run. */
  extra: 'demo' | 'bench' | null = null,
  hidden = false,
  /** A solo game on the server, so friends can join by invite. */
  invitable = false,
): Promise<void> {
  menu.hide();
  banner(local ? '' : 'Connecting…');
  demo.stop();
  stopBench();
  let conn: Connection;
  // A benchmark lays its maps out the same way every run.
  const soloRoom = local ? localConnection(RAPIER, extra === 'bench' ? 1 : undefined) : null;
  try {
    conn = soloRoom ?? (await wsConnection());
  } catch (err) {
    banner('');
    // Without a server, solo play still runs in this tab; only invites need the server.
    if (invitable) return open(name, look, undefined, true);
    menu.showError(`${(err as Error).message} Try "Play solo" instead.`);
    return;
  }
  if (lagMs > 0) conn = withLag(conn, lagMs);
  game?.close();
  solo = local;
  const g = new ClientGame(RAPIER, conn);
  game = g;
  conn.onClose = (reason) => void lost(g, name, look, reason);
  g.hello(name, look, room, room ? readToken(room) : undefined, hidden, invitable);
  // The solo room has taken the hello by now, so the first round can start right away.
  if (extra === 'demo' && soloRoom) demo.start(soloRoom.room);
  if (extra === 'bench' && soloRoom) {
    const run = frameRun;
    view.graphics.apply(run.graphics);
    bench = new Benchmark(
      {
        rapier: RAPIER,
        room: soloRoom.room,
        game: () => (game === g ? g : null),
        input,
        read: () => input.onToggleReader(),
      },
      view.renderer,
      run.graphics,
      run.maps,
      (result) => {
        bench = null;
        view.graphics.apply(settings.graphics);
        toMenu();
        benchReport.show(result);
      },
    );
  }
}

/** The benchmark run in progress, if one is. */
let bench: Benchmark | null = null;
/** What the next (or last) frame-rate run visits and draws with. */
let frameRun: FrameRun = {
  kind: 'frames',
  maps: MAPS.map((m) => m.id),
  graphics: settings.graphics,
};

/** Ends a frame-rate run without a report, and puts the player's own graphics back. */
function stopBench(): void {
  if (!bench) return;
  bench.cancel();
  bench = null;
  view.graphics.apply(settings.graphics);
}

function startBench(run: BenchRun): void {
  if (run.kind === 'bots') return arena.start(run);
  frameRun = run;
  void open('Benchmark', savedLook(), undefined, true, 'bench');
}

const benchSetup = new BenchSetup(() => settings.graphics, startBench);
const benchReport = new BenchReport(
  () => startBench(frameRun),
  () => {},
);
const arena = new BotArena(() => benchSetup.show());

/** Tries to get back into the same room a few times before giving up. */
async function lost(g: ClientGame, name: string, look: Look, reason: string): Promise<void> {
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
      // Back in the same look, even one picked in the lobby after joining.
      const me = g.lobby.players.find((p) => p.id === g.myId);
      if (me) look = { hat: me.hat, face: me.face, shirt: me.shirt };
      conn.onClose = (why) => void lost(next, name, look, why);
      next.hello(name, look, room, readToken(room));
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

// An accidental Ctrl+W while walking carefully asks first. Browsers do not let a page swallow
// Ctrl+W (outside locked full screen) or say why it is closing, so the prompt only shows while
// Ctrl or Cmd is held from mid-game; reloads and the close button leave without asking.
window.addEventListener('beforeunload', (e) => {
  if (!game || !input.accidentalClose) return;
  e.preventDefault();
  e.returnValue = '';
});

const noticeEl = $('notice');
let noticeUntil = 0;

/** A short message about something that just happened to you; fades after a few seconds. */
function notice(text: string): void {
  noticeEl.textContent = forTouch(text);
  noticeEl.classList.remove('hidden');
  noticeUntil = performance.now() + 3500;
}

/** Hints and notices name mouse buttons and keys; on a touch screen, the buttons there. */
function forTouch(text: string): string {
  if (!input.touch) return text;
  return text
    .split(' · ')
    .filter((part) => !/^[RT]: /.test(part))
    .join(' · ')
    .replace('Hold Ctrl and click', 'Turn on Careful and tap')
    .replace('Hold Ctrl', 'Turn on Careful')
    .replace('Right click', 'Pull')
    .replace(/\bG: /, 'Drop: ')
    .replace(/\bClick/g, 'Tap')
    .replace(/\bclick/g, 'tap');
}

function banner(text: string): void {
  bannerEl.textContent = text;
  bannerEl.classList.toggle('hidden', !text);
}

const menu = new Menu({
  create: (name, hidden) => void open(name, savedLook(), undefined, false, null, hidden),
  join: (name, code) => void open(name, savedLook(), code, false),
  solo: (name) => void open(name, savedLook(), undefined, false, null, false, true),
  demo: (name) => void open(name, savedLook(), undefined, true, 'demo'),
  bench: () => benchSetup.show(),
  editor: () => void openEditor(),
  forum: { art: (build) => printer.boxArt(build), use: (build) => demo.useBuild(build) },
});

// ------------------------------------------------------------------ getting around

const appBar = new AppBar({
  resume: () => {
    input.relock();
  },
  pause: () => freeMouse(),
  leave: () => toMenu(),
  back: () => openPage()?.back(),
  endRound: () => game?.send({ t: 'end' }),
});
const dock = new Dock();

/** The page off the main menu that is open, if one is: where it is, and the way back. */
function openPage(): { where: string; back: () => void } | null {
  if (benchReport.visible) return { where: 'Benchmark results', back: () => benchReport.back() };
  if (arena.visible) return { where: 'Bots against bots', back: () => arena.back() };
  if (benchSetup.visible) return { where: 'Benchmark', back: () => benchSetup.back() };
  const page = menu.subpage;
  if (page)
    return { where: page === 'rooms' ? 'Open rooms' : 'Shared builds', back: () => menu.back() };
  return null;
}
// A free build can be saved at any point while building, from the menu.
const exportBtn = $('appbar').querySelector<HTMLButtonElement>('.export-build')!;
exportBtn.addEventListener('click', () => {
  if (game) notice(exportJobSite(game, ''));
});

const touch = new TouchControls(input, {
  tap: () => {
    // A tap on the open page puts it away, as Esc does; anywhere else it is a click.
    if (!readerEl.classList.contains('hidden')) return closeReader();
    input.act({ kind: input.holding() ? 'place' : 'grab' });
  },
  read: () => input.onToggleReader(),
  show: () => input.onShow(),
  chat: () => input.onChat(),
  // How to play is a tab in the dock, which only shows with play stopped.
  help: () => {
    freeMouse();
    dock.open('help');
  },
  talk: (down) => talkKey(down),
  fullscreen: () => void toggleFullscreen(),
});
const picker = new MachinePicker(
  (a) => input.act(a),
  () => input.relock(),
  () => input.touch,
);
input.mayCapture = () => !picker.isOpen && !editorOpen;

/**
 * A click on the silo, the mould dispenser or the UV printer with a part on it asks what to
 * make first: the picker opens instead, and what is picked goes to the server as its own action.
 */
function pickFirst(g: ClientGame, action: Action): boolean {
  const me = g.me;
  if ((action.kind !== 'grab' && action.kind !== 'place') || !me || g.role === 'reader') {
    return false;
  }
  if (me.holding || g.sim.vacuum.heldBy === me.id) return false;
  const hit = g.sim.aim(me);
  if (hit?.owner.kind !== 'machine' || !g.sim.mayUse(me, hit.point)) return false;
  const m = g.sim.machines.get(hit.owner.machineId);
  // A jammed machine only takes a click to clear it; one without power makes nothing to pick.
  if (m?.jammed || !g.sim.machinesPowered) return false;
  if (m?.def.kind === 'silo' && me.tool?.kind !== 'mould') {
    picker.openColours(makeableColours(), g.colourBlind);
    return true;
  }
  // With a mould in hand, a click puts it back.
  if (m?.def.kind === 'dispenser' && !me.tool) {
    picker.openMoulds(MOULD_TYPES);
    return true;
  }
  if (m?.def.kind === 'printer' && m.part && !me.tool) {
    const type = m.part.type;
    const jobs = g.sim.printJobs
      .map((job, index) => ({ job, index }))
      .filter(({ job }) => job.type === type);
    picker.openPrints(type, jobs, g.sim.level.svgs ?? {});
    return true;
  }
  return false;
}

// The open page covers the controls; a tap anywhere on it puts it away.
readerEl.addEventListener('click', () => {
  if (input.touch) closeReader();
});

/** Back to the main menu, from a game (lobby, round or demo) or the build editor. */
function toMenu(): void {
  if (editorOpen) {
    // Opened from the menu, the editor is one step on in the history: go back to it.
    if ((history.state as { editor?: boolean } | null)?.editor) return history.back();
    closeEditor();
  }
  stopBench();
  const g = game;
  if (g) {
    // Cleared first, so the closing connection does not try to get back in.
    game = null;
    g.close();
    solo = false;
    welcomed = '';
    demo.stop();
    results.hide();
    closeReader();
    social.closeChat(false);
    reportPinned = false;
    dock.unpin();
    noticeEl.classList.add('hidden');
    freeMouse();
    // The room code leaves the address bar, so a reload does not join it again.
    if (location.pathname !== '/') history.replaceState(null, '', `/${location.search}`);
  }
  banner('');
  menu.show();
}

let editor: typeof import('./editor.ts') | null = null;
let editorOpen = false;

/** Opens the build editor from the main menu; it is loaded the first time. */
async function openEditor(push = true): Promise<void> {
  if (game) return;
  menu.hide();
  editorOpen = true;
  if (push && location.hash !== '#editor') history.pushState({ editor: true }, '', '#editor');
  editor ??= await import('./editor.ts');
  if (editorOpen) editor.showEditor();
  loadingDone();
}

function closeEditor(): void {
  editorOpen = false;
  editor?.hideEditor();
  if (location.hash === '#editor')
    history.replaceState(null, '', location.pathname + location.search);
}

// The browser's back and forward buttons go in and out of the editor.
window.addEventListener('popstate', () => {
  if (location.hash === '#editor') void openEditor(false);
  else if (editorOpen) {
    closeEditor();
    menu.show();
  }
});
if (location.hash === '#editor') void openEditor(false);
const lobbyPanel = new LobbyPanel(
  () => game,
  () => solo,
);

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
Object.assign(window, {
  __sar: { view, input, game: () => game, voice: () => voice, open, pageArt, toMenu },
});

// ------------------------------------------------------------------ HUD helpers

const IDLE_INSPECTOR: InspectorState = {
  status: 'idle',
  progress: 0,
  report: null,
  scannedVersion: -1,
};

function hintFor(g: ClientGame, p: Player, hit: AimHit | null, canSnap: boolean): string {
  const o = hit?.owner;
  // Rival teams: the other side is for looking at.
  if (hit && o && o.kind !== 'static' && o.kind !== 'player' && !g.sim.mayUse(p, hit.point)) {
    return "The other team's side: you can look, but only touch things on your own";
  }
  const power = g.sim.power;
  if (power.fixer === p.id) {
    return `Fixing the electrical panel… ${Math.round(power.progress * 100)}% (stay here)`;
  }
  if (o?.kind === 'panel') {
    if (g.mode === 'gear') return 'The panel is dead this round. The headlamp lights the house';
    if (power.on && g.role === 'saboteur')
      return 'Electrical panel · 5: tamper with it (cut the power)';
    if (power.on) return 'Electrical panel: the power is on';
    if (power.fixer !== null) return 'Someone is fixing the electrical panel';
    return 'Click: fix the electrical panel and get the lights back on';
  }
  if (o?.kind === 'catapult') {
    return g.phase === 'building'
      ? 'The catapult only throws between rounds'
      : 'Catapult: step into the bucket at the back to be thrown across the yard';
  }
  if (o?.kind === 'page') {
    const page = g.sim.pages.get(o.pageId);
    const what = page?.step === -1 ? 'the master index' : 'this page';
    const take = p.page === null ? `Click: pick up ${what}` : `Click: swap your pocket for ${what}`;
    if (page && !page.printed) {
      const reader = g.reader !== null ? g.nameOf(g.reader) : 'the reader';
      return `${take} · only ${reader} can read it: bring it to them or pin it on the board`;
    }
    return `${take} · Q: read it here`;
  }
  if (
    g.role === 'reader' &&
    (o?.kind === 'machine' || o?.kind === 'brick' || o?.kind === 'vacuum')
  ) {
    return "The reader can't touch bricks: tell the builders what the pages say";
  }
  if (o?.kind === 'machine') {
    const m = g.sim.machines.get(o.machineId);
    const fixing = m?.fixer === p.id;
    if (fixing) return `Clearing the jam… ${Math.round(m.progress * 100)}% (stay here)`;
    if (m) {
      const hint = machineHint(g, p, m);
      return g.role === 'saboteur' && !m.jammed ? `${hint} · 5: tamper with it` : hint;
    }
  }
  if (o?.kind === 'gear') {
    const item = g.sim.gear.get(o.gearId);
    return item ? `Click: put on the ${gearName(item.kind).toLowerCase()}` : '';
  }
  if (o?.kind === 'dog') {
    if (g.sim.dog.leashed) return 'The dog is on its leash now';
    if (p.gear.has('leash')) return 'Click: leash the dog to the pole by its kennel';
    if (p.treat) return 'Click: give the dog your treat (it drops what it carries and follows you)';
    if (g.sim.dog.page !== null) return 'Click: grab its collar, so it lets go of the page';
    return p.holding ? 'Put down what you carry to pat the dog' : 'Click: pat the dog';
  }
  if (o?.kind === 'treats') {
    return p.treat ? 'You have a treat: the dog will come for it' : 'Click: take a dog treat';
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
    if (g.role === 'saboteur' && p.page !== null) {
      return h.def.kind === 'rug'
        ? 'Click: hide your page under the rug'
        : `Click: hide your page in the ${name}`;
    }
    if (h.locked) {
      return p.gear.has('keys')
        ? `Click: unlock the ${name} with your key ring`
        : `Padlocked ${name}. The key ring opens it`;
    }
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
    if (g.rival) return 'No Brick Meetings in a race: there is nobody to vote off';
    return 'Click: ring the bell for a Brick Meeting (one per player per round)';
  }
  if (o?.kind === 'button') {
    if (!g.round) return 'The Done button works once a round has started';
    if (g.rival && g.round.handedIn[o.site] != null) return 'This team has handed in its build';
    if (g.role === 'saboteur') return "Saboteurs can't hand in the build: leave Done to the team";
    if (g.mode === 'free') {
      return g.round.doneArmed[o.site]
        ? 'Click again to finish the free build (export it first: Esc, then Export build)'
        : 'Click: Done (finish the free build and go back to the lobby)';
    }
    return g.round.doneArmed[o.site]
      ? g.rival
        ? 'Click again to hand in your build: it is judged and locked as it stands!'
        : 'Click again to hand in the build! (It is locked until then)'
      : g.rival
        ? 'Click: Done (hand in your build; accuracy counts first, then speed)'
        : 'Click: Done (hand in the build and end the round)';
  }
  if (o?.kind === 'vacuum') {
    return p.holding ? 'Put down what you carry to take the vacuum' : 'Click: take the vacuum';
  }
  if (o?.kind === 'trashBin') {
    if (!p.holding && g.sim.vacuum.heldBy === p.id) {
      return g.sim.vacuum.load > 0
        ? `Click: empty the vacuum into the bin (${g.sim.vacuum.load} bricks)`
        : 'The vacuum is empty';
    }
    if (!p.holding) return 'Rubbish bin: click it with a brick in hand, or drop one in, to bin it';
    return g.sim.isBuild(p.holding.assemblyId)
      ? "The team's build doesn't go in the bin"
      : 'Click: throw what you carry in the bin (it is gone for good)';
  }
  if (g.sim.vacuum.heldBy === p.id) {
    const load = g.sim.vacuum.load;
    return load >= VACUUM_CAPACITY
      ? 'The vacuum is full: click a rubbish bin to empty it · G: put the vacuum down'
      : `Hold click: suck up loose bricks on the floor at the crosshair (${load}/${VACUUM_CAPACITY}) · G: put the vacuum down`;
  }
  if (p.tool?.kind === 'mould') {
    return `Your ${shapeName(p.tool.type)} mould: click a moulding machine to put it in · G: put it away`;
  }
  if (p.tool?.kind === 'bucket') {
    const what = g.colourBlind ? 'pellets' : `${p.tool.colour.replaceAll('-', ' ')} pellets`;
    return `A bucket of ${what}: click a moulding machine to pour them in · G: put it away`;
  }
  if (p.holding) {
    const held = g.sim.assemblies.get(p.holding.assemblyId);
    if (held && !isLooseBrick(held)) {
      if (tiredFactor(p) < 1) return 'Your arms are tiring: set the build down soon (G)';
      return canSnap
        ? 'Click: snap it all on · R: rotate · G: set down gently · T: throw'
        : 'R: rotate · G: set the build down gently · T: throw';
    }
    return canSnap
      ? 'Click: snap · R: rotate · G: drop · T: throw'
      : 'Aim at the top of a build to snap · Click: drop · T: throw';
  }
  if (!o) return '';
  if (o.kind === 'player') {
    const name = g.lobby.players.find((x) => x.id === o.playerId)?.name;
    const page = g.sim.players.get(o.playerId)?.page ?? null;
    if (!name || page === null) return name ?? '';
    const what = g.pocketLabels.get(page) ?? 'a page';
    return `${name} has ${what} in their pocket · Click fast: pick it out`;
  }
  if (o.kind !== 'brick') return '';
  const a = g.sim.assemblies.get(o.assemblyId);
  if (!a) return '';
  if (a.heldBy !== null) {
    const who = g.lobby.players.find((x) => x.id === a.heldBy)?.name;
    if (!who) return '';
    return isLooseBrick(a)
      ? `${who} is holding this`
      : `${who} carries this · Click fast: tug it away`;
  }
  const brick = a.grid.bricks.get(o.brickId);
  if (!brick) return '';
  if (BRICK_TYPES[brick.type].fixture) {
    if (g.sim.heavyFor(p)) {
      return a.anchored
        ? 'Hold Ctrl and click: lift the heavy build (slowly, or wear the back brace)'
        : 'Click: carry the build (slowly, without the back brace)';
    }
    return a.anchored ? 'Click: lift the whole build off the job site' : 'Click: carry the build';
  }
  const named = g.colourBlind ? shapeName(brick.type) : brickName(brick.type, brick.colour);
  const name = named.charAt(0).toUpperCase() + named.slice(1);
  if (a.anchored) return `${name} · Click: pull this brick off`;
  if (a.grid.size === 1) return `${name} · Click: pick up`;
  return `${name} · Click: carry build · Right click: pull this brick off`;
}

/** What a click on one of the brick works' machines would do. */
function machineHint(g: ClientGame, p: Player, m: MachineState): string {
  const colour = (c: string) => (g.colourBlind ? '' : `${c.replaceAll('-', ' ')} `);
  if (m.jammed) {
    if (m.fixer !== null) return `Someone is clearing the jam`;
    return 'Jammed, it makes nothing. Click: clear the jam (stay here)';
  }
  if (!g.sim.machinesPowered) {
    return 'No power: the machines are dead until someone fixes the electrical panel';
  }
  if (m.def.kind === 'silo') {
    if (p.tool?.kind === 'mould') return 'Pellet silo. Put your mould in a moulding machine first';
    if (p.holding) return 'Pellet silo. Put down what you carry to fill a bucket';
    return 'Click: fill a bucket with pellets of any colour';
  }
  if (m.def.kind === 'dispenser') {
    if (p.tool?.kind === 'mould') return `Click: put the ${shapeName(p.tool.type)} mould back`;
    if (p.tool) return 'Mould dispenser. Your hands are full';
    if (p.holding) return 'Mould dispenser. Put down what you carry to take a mould';
    return 'Click: pick a mould to take to a moulding machine';
  }
  if (m.def.kind === 'printer') {
    const part = m.part;
    if (part) {
      const name = `${colour(part.colour)}${shapeName(part.type)}`;
      if (p.holding || p.tool) return `UV printer, with a ${name} on its bed. Your hands are full`;
      return `Click: pick a print for the ${name} on the bed, or take it out`;
    }
    const held = p.holding ? g.sim.assemblies.get(p.holding.assemblyId) : undefined;
    if (held && isLooseBrick(held)) return "Click: put the part on the UV printer's bed";
    return 'UV printer: put a part on its bed to print a picture on it';
  }
  const loaded = m.mould ? `${shapeName(m.mould)} mould` : 'no mould';
  const pellets = m.colour ? `${colour(m.colour)}pellets for ${m.shots}` : 'no pellets';
  if (p.tool?.kind === 'mould') {
    return `Click: put your ${shapeName(p.tool.type)} mould in (it has ${loaded})`;
  }
  if (p.tool?.kind === 'bucket') {
    return `Click: pour your ${colour(p.tool.colour)}pellets in (it has ${pellets})`;
  }
  if (!m.mould) return 'Moulding machine: bring it a mould from the mould dispenser';
  if (!m.colour) return `Moulding machine with a ${loaded}: bring it pellets from the silo`;
  if (p.holding) return `Moulding machine: ${loaded}, ${pellets}. Your hands are full`;
  return `Click: make a ${colour(m.colour)}${shapeName(m.mould)} (pellets for ${m.shots} more)`;
}

// ------------------------------------------------------------------ voice chat

let voice: Voice | null = null;
let voiceGame: ClientGame | null = null;
/** Until when each player's voice counts as a scream (they just stepped on a brick). */
const screams = new Map<number, number>();
const micEl = $('mic');

/** Starts voice chat for a newly joined room (never in solo play), or stops it. */
function voiceFor(g: ClientGame | null): Voice | null {
  const wanted = g && !solo && g.myId >= 0 ? g : null;
  if (voiceGame === wanted) return voice;
  voice?.close();
  voice = null;
  voiceGame = wanted;
  if (!wanted) return null;
  const v = new Voice(
    wanted.myId,
    wanted.ice,
    (to, data) => wanted.send({ t: 'signal', to, data }),
    () => sfx.output(),
  );
  voice = v;
  wanted.onSignal = (from, data) => void v.signal(from, data);
  for (const m of wanted.signals.splice(0)) void v.signal(m.from, m.data);
  void v.setMode(settings.mic).then(() => settingsPanel.setMicProblem(v.micError));
  return v;
}

/** Places every voice for this frame and shows who is talking. */
function updateVoice(g: ClientGame, eye: Vec3, alpha: number): void {
  const v = voiceFor(g);
  micEl.classList.toggle('hidden', !v);
  if (!v) return;
  v.sync(g.lobby.players.filter((p) => p.connected).map((p) => p.id));
  const cam = view.camera;
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
  const listener: Listener = { pos: cam.position.clone(), forward, up };
  const together = g.phase !== 'building' || !!g.meeting;
  const listenerHome = g.sentHome;
  const now = performance.now();
  const speakers = new Map<number, Speaker>();
  const audience = new Set<number>();
  const screaming = (screams.get(g.myId) ?? 0) > now;
  for (const lp of g.lobby.players) {
    if (lp.id === g.myId) continue;
    const p = g.sim.players.get(lp.id);
    const pos = p ? add(g.pose(p.body, alpha).pos, v3(0, EYE_OFFSET, 0)) : listener.pos;
    const distance = length(sub(pos, eye));
    const near = !together && p && !listenerHome;
    const mix = voiceMix({
      together,
      distance,
      walls: near ? g.sim.wallsBetween(eye, pos) : 0,
      speakerHome: lp.home,
      listenerHome,
      screaming: (screams.get(lp.id) ?? 0) > now,
    });
    speakers.set(lp.id, { pos, mix });
    // The other way round: whether they would hear us, and so get our voice at all.
    if (
      reaches({ together, distance, speakerHome: listenerHome, listenerHome: lp.home, screaming })
    ) {
      audience.add(lp.id);
    }
  }
  v.setAudience(audience);
  v.update(listener, speakers, settings.muted ? 0 : settings.voiceVolume);
  view.showSpeaking((id) => v.speaking(id));

  const mode = v.micMode;
  micEl.textContent = !Voice.micAvailable
    ? '🎤 listen only (talking needs https://)'
    : v.micError
      ? '🎤 unavailable (see Settings)'
      : mode === 'off'
        ? '🎤 off'
        : v.sending
          ? '🎤 on air'
          : mode === 'push'
            ? '🎤 hold C to talk'
            : '🎤 …';
  micEl.classList.toggle('live', v.sending);
  micEl.classList.toggle('speaking', v.ownSpeaking);
}

/** Push to talk: hold C, or a mouse side button, wherever focus is (but not while typing). */
function talkKey(down: boolean): void {
  if (settings.mic !== 'push' || !voice) return;
  const v = voice;
  void v.pushToTalk(down).then(() => settingsPanel.setMicProblem(v.micError));
}
const typing = (e: Event) =>
  e.target instanceof HTMLInputElement ||
  e.target instanceof HTMLTextAreaElement ||
  e.target instanceof HTMLSelectElement;
document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyC' && !e.repeat && !typing(e)) talkKey(true);
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'KeyC') talkKey(false);
});
document.addEventListener('mousedown', (e) => {
  if (e.button === 3 || e.button === 4) talkKey(true);
});
document.addEventListener('mouseup', (e) => {
  if (e.button !== 3 && e.button !== 4) return;
  // Side buttons would otherwise go back and forward in the browser's history.
  e.preventDefault();
  talkKey(false);
});
window.addEventListener('blur', () => talkKey(false));

/** Whether the vacuum's motor was still last frame, so the switch clicks as it starts. */
let vacuumStill = true;

/** The vacuum's motor, heard from wherever the vacuum is. */
function playVacuum(listener: Vec3): void {
  const v = view.vacuum;
  const volume = 1 / (1 + length(sub(v.group.position, listener)) / 4);
  if (v.speed > 0 && vacuumStill) sfx.vacuumSwitch(volume);
  vacuumStill = v.speed === 0;
  sfx.vacuumMotor(v.speed, volume, v.full);
}

/** Each player screams in their own voice. */
const voicePitch = (id: number | undefined) => 0.85 + (((id ?? 0) * 37) % 30) / 100;

function playEvents(events: SimEvent[], listener: Vec3): void {
  const mine = (e: SimEvent) => e.playerId !== undefined && e.playerId === game?.myId;
  for (const e of events) {
    view.machineAt(e);
    const volume = 1 / (1 + length(sub(e.pos, listener)) / 4);
    if (e.kind === 'trip') {
      sfx.oof(volume, voicePitch(e.playerId));
      if (mine(e)) notice('Down you go!');
    } else if (e.kind === 'ouch') {
      sfx.scream(volume, voicePitch(e.playerId));
      // Whatever they yell into their microphone now carries further.
      if (e.playerId !== undefined) screams.set(e.playerId, performance.now() + SCREAM_MS);
      if (mine(e)) notice('Ouch! You stepped on a brick. Limping for a while.');
    } else if (e.kind === 'catapult') {
      sfx.catapult(volume);
      view.fireCatapult();
      if (mine(e)) notice('Wheee!');
    } else if (e.kind === 'bark') sfx.bark(volume);
    else if (e.kind === 'pat') sfx.whine(volume);
    else if (e.kind === 'yelp') {
      sfx.yelp(volume);
      if (mine(e)) notice('You grabbed its collar: the dog let go of the page.');
    } else if (e.kind === 'crunch') {
      sfx.crunch(volume);
      if (mine(e)) notice('The dog loves you. It follows you for a while.');
    } else if (e.kind === 'treat') {
      sfx.treats(volume);
      if (mine(e)) notice('You took a dog treat. The dog will come for it.');
    } else if (
      e.kind === 'swap' ||
      e.kind === 'forge' ||
      e.kind === 'hide' ||
      e.kind === 'tamper'
    ) {
      // A saboteur tell: only sent to players close enough to notice.
      view.puff(e.pos);
      sfx.rustle(volume);
    } else if (e.kind === 'powerOut') {
      // The whole house goes dark: everyone hears it, wherever they are.
      sfx.powerOut();
      notice(
        game?.mode === 'gear'
          ? 'The power is out for good. Find the headlamp to read inside the house.'
          : 'The power is out, and the machines with it! Fix the electrical panel in the basement.',
      );
    } else if (e.kind === 'gearOn') {
      sfx.pickUp(volume);
      if (mine(e) && e.gear) {
        const n = GEAR_IDS.indexOf(e.gear) + 1;
        notice(
          `You put on the ${gearName(e.gear).toLowerCase()}. ${n}: take it off for someone else.`,
        );
      }
    } else if (e.kind === 'gearOff') sfx.drop(volume, 1, 2);
    else if (e.kind === 'locked') {
      sfx.click(volume);
      if (mine(e)) notice('Padlocked. The key ring opens it.');
    } else if (e.kind === 'unlock') sfx.pin(volume);
    else if (e.kind === 'leash') {
      // The dog barks on its own as the leash goes on.
      notice('The dog is on its leash: no more stolen pages or wrecked builds.');
    } else if (e.kind === 'tug') {
      sfx.thump(volume * 0.6);
      if (e.fromId === game?.myId)
        notice(`${game?.nameOf(e.playerId ?? 0)} is tugging at the build you carry!`);
    } else if (e.kind === 'tugged') {
      sfx.pickUp(volume, 2);
      if (mine(e)) notice(`You tugged the build out of ${game?.nameOf(e.fromId ?? 0)}'s hands.`);
      else if (e.fromId === game?.myId)
        notice(`${game?.nameOf(e.playerId ?? 0)} tugged the build out of your hands!`);
    } else if (e.kind === 'pick') {
      sfx.page(volume * 0.5);
      if (e.fromId === game?.myId)
        notice(`${game?.nameOf(e.playerId ?? 0)} is going for the page in your pocket!`);
    } else if (e.kind === 'picked') {
      sfx.page(volume);
      if (mine(e)) notice(`You picked the page out of ${game?.nameOf(e.fromId ?? 0)}'s pocket.`);
      else if (e.fromId === game?.myId)
        notice(`${game?.nameOf(e.playerId ?? 0)} picked the page out of your pocket!`);
    } else if (e.kind === 'tired') {
      sfx.oof(volume * 0.6, voicePitch(e.playerId));
      if (mine(e)) notice('Your arms are too tired to carry a build. Rest a while first.');
    } else if (e.kind === 'heavy') {
      sfx.oof(volume, voicePitch(e.playerId));
      if (mine(e)) notice('Too heavy! Hold Ctrl to lift it carefully, or find the back brace.');
    } else if (e.kind === 'fixing') sfx.thump(volume * 0.7);
    else if (e.kind === 'breakdown') {
      sfx.crash(volume, 3);
      if (length(sub(e.pos, listener)) < 12)
        notice('A machine broke down! Click it and stay there to clear the jam.');
    } else if (e.kind === 'unjammed') {
      sfx.button(volume);
      if (mine(e)) notice('You cleared the jam: the machine works again.');
    } else if (e.kind === 'powerOn') {
      sfx.powerOn();
      notice(mine(e) ? 'You fixed the panel: the lights are back on.' : 'The lights are back on.');
    } else if (e.kind === 'meeting') sfx.bell();
    else if (e.kind === 'sentHome') sfx.sentHome();
    else if (e.kind === 'open' || e.kind === 'close') {
      const def = game?.sim.level.hideouts.find((h) => h.id === e.hideoutId);
      if (def) sfx.hideout(def.kind, e.kind === 'open', HIDEOUT_TRAVEL, volume);
      else sfx.thump(volume * 0.8);
    } else if (e.kind === 'pin') sfx.pin(volume);
    else if (e.kind === 'snap') sfx.snap(volume);
    else if (e.kind === 'page') sfx.page(volume);
    else if (e.kind === 'button') sfx.button(volume);
    else if (e.kind === 'grab') sfx.pickUp(volume, e.count);
    else if (e.kind === 'break') sfx.crash(volume, e.count);
    else if (e.kind === 'anchor') sfx.anchor(volume, e.count);
    else if (e.kind === 'vacuumUp') {
      sfx.vacuumUp(volume);
      if (mine(e)) {
        notice(
          `You took the vacuum. Hold the click to suck up loose bricks where you aim; it holds ${VACUUM_CAPACITY}, then empty it at a rubbish bin.`,
        );
      }
    } else if (e.kind === 'vacuumDown') sfx.vacuumDown(volume);
    else if (e.kind === 'suck') {
      if (e.playerId !== undefined) view.vacuum.sucked(e.playerId);
      sfx.suck(volume, e.count);
    } else if (e.kind === 'vacuumFull') {
      sfx.vacuumFull(volume);
      if (mine(e)) notice('The vacuum is full. Empty it at a rubbish bin.');
    } else if (e.kind === 'drop') sfx.drop(volume, e.count, e.speed);
    else if (e.kind === 'toolUp') sfx.pickUp(volume, 2);
    else if (e.kind === 'toolDown') sfx.binDrop(volume);
    else if (e.kind === 'mouldIn') sfx.mouldIn(volume);
    else if (e.kind === 'pour' || e.kind === 'fill') sfx.pour(volume);
    else if (e.kind === 'moulded') sfx.moulded(volume);
    else if (e.kind === 'printerIn') sfx.snap(volume);
    else if (e.kind === 'print') sfx.print(volume);
    else if (e.kind === 'binned') sfx.binDrop(volume);
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
  pocketEl.querySelector('.title')!.textContent = !page.printed
    ? 'A page (only the reader can read it)'
    : page.step < 0
      ? 'Master index'
      : `Page ${pageNumber(page.printed)} of ${roundTarget().steps.length}`;
  pocketEl.querySelector('canvas')!.getContext('2d')!.drawImage(art, 0, 0, 90, 126);
}

let shownAt = 0;
/** Someone held up a page for us: show it for a while. */
function updateShown(g: ClientGame): void {
  const s = g.shown;
  if (s && s.at !== shownAt) {
    shownAt = s.at;
    const what = pageName(s.printed);
    if (g.me && !canRead(g, g.me.body.translation())) {
      notice(`${g.nameOf(s.from)} shows you ${what}, but it is too dark to see it.`);
      return;
    }
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
let shownReportKey: string | null = null;
/** The inspector's full report, shown near the inspector or when pinned with I. */
function updateReport(g: ClientGame, me: Player): void {
  const report = g.myInspector?.report ?? null;
  const pad = levelSites(g.sim.level)[g.mySite]!.inspector.pos;
  const p = me.body.translation();
  const near = Math.hypot(p.x - pad.x, p.z - pad.z) < 4.5;
  reportEl.classList.toggle(
    'hidden',
    !report || !(near || reportPinned) || g.round?.phase !== 'building',
  );
  const reportKey = report && `${g.colourBlind}`;
  if (!report || (report === shownReport && reportKey === shownReportKey)) return;
  shownReport = report;
  shownReportKey = reportKey;
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const rows = report.steps.map((s, i) => {
    const head =
      s.verdict === 'empty'
        ? `<span class="muted">not started</span>`
        : `<span class="${s.verdict}">${s.correct} of ${s.total} correct</span>`;
    const text = (t: string) => esc(g.colourBlind ? withoutColours(t) : t);
    const lines = s.lines.map((l) => `<li class="${l.kind}">${text(l.text)}</li>`).join('');
    return `<h4>Step ${i + 1} · ${head}</h4>${lines ? `<ul>${lines}</ul>` : ''}`;
  });
  if (report.extras.length) {
    rows.push(
      `<h4>Not in the plans</h4><ul>${report.extras.map((l) => `<li class="extra">${esc(g.colourBlind ? withoutColours(l.text) : l.text)}</li>`).join('')}</ul>`,
    );
  }
  reportEl.innerHTML =
    `<h3>Inspection report: ${report.correct} of ${report.total} bricks correct</h3>` +
    `<p class="muted">Problems are marked on the build until you fix them. I: pin this list.</p>` +
    rows.join('');
}

function updateTimer(g: ClientGame): void {
  // A free build has no time limit.
  timerEl.classList.toggle('hidden', !g.round || g.mode === 'free');
  if (!g.round) return;
  const t = Math.ceil(g.round.timeLeft);
  setText(timerEl, `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
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
  return {
    colour: p?.colour ?? 0x7f8c8d,
    name: p?.name ?? '',
    look: p ? { hat: p.hat, face: p.face, shirt: p.shirt } : DEFAULT_LOOK,
  };
};

// ------------------------------------------------------------------ loop

let last = performance.now();
let acc = 0;
let shownWorld = -1;
let shownGame: ClientGame | null = null;
/** The fly-around behind the menu, for the level the view has standing. */
let menuOrbit: MenuOrbit | null = null;
/** The game whose phase was last seen, and that phase: to tell when the host ends a round. */
let phaseGame: ClientGame | null = null;
let shownPhase: ClientGame['phase'] | null = null;

function frame(now: number): void {
  const elapsed = Math.min(0.25, (now - last) / 1000);
  last = now;
  const started = performance.now();
  const serverMs = takeSoloServerMs();
  perf.frame(now, serverMs);
  const g = game;
  input.update();
  bench?.drive(now);

  if (g !== shownGame || (g && g.worldVersion !== shownWorld)) {
    // A new round comes with a newly furnished house.
    if (g) view.setLevel(g.sim.level);
    view.reset();
    results.hide();
    shownReport = null;
    shownPage = null;
    shownGame = g;
    shownWorld = g?.worldVersion ?? -1;
  }
  const inRoom = !!g && !demo.active && !solo && !!g.roomCode;
  const page = !g && !editorOpen ? openPage() : null;
  appBar.set(
    editorOpen ? 'editor' : g ? 'game' : page ? 'page' : 'menu',
    editorOpen
      ? 'Build editor'
      : !g
        ? (page?.where ?? '')
        : demo.active
          ? 'Demo'
          : solo
            ? 'Solo game'
            : g.roomCode
              ? `Room ${g.roomCode}`
              : 'Connecting…',
    !g ? null : inRoom ? 'room' : 'game',
    // The host can call a round off and take everyone back to the lobby for a new one.
    !!g && g.isHost && g.phase === 'building' && !demo.active && !bench,
  );
  timerEl.classList.toggle('hidden', !g?.round || g.mode === 'free');
  exportBtn.classList.toggle('hidden', g?.mode !== 'free' || g.round?.phase !== 'building');
  lobbyPanel.update();
  if (demo.active) demo.update();
  dock.update();
  updateBoxArt();
  if (!g) social.update(now);

  if (!g) {
    voiceFor(null);
    sfx.vacuumMotor(0, 0, false);
    micEl.classList.add('hidden');
    // The editor moves the camera and draws the view itself, on its own map.
    if (editorOpen) {
      requestAnimationFrame(frame);
      return;
    }
    // Before joining: a slow fly-around of the empty yard behind the menu, kept out of the
    // house (or whatever map the last round left standing).
    if (menuOrbit?.level !== view.level) menuOrbit = new MenuOrbit(view.level);
    const pos = menuOrbit.at(now / 1000);
    view.camera.position.set(pos.x, pos.y, pos.z);
    view.camera.lookAt(menuOrbit.look.x, menuOrbit.look.y, menuOrbit.look.z);
    view.setNight(false);
    // The benchmark's pages cover the yard: drawing it would only cost frames (and slow the
    // bots playing rounds meanwhile).
    if (!benchSetup.visible && !benchReport.visible && !arena.visible) view.render();
    loadingDone();
    requestAnimationFrame(frame);
    return;
  }
  onWelcome(g);
  if (g !== phaseGame) {
    phaseGame = g;
    shownPhase = g.phase;
  }
  if (g.phase !== shownPhase) {
    // Straight from building to the lobby, with no results: the host ended the round.
    if (shownPhase === 'building' && g.phase === 'lobby') {
      notice(g.isHost ? 'You ended the round.' : 'The host ended the round.');
    }
    shownPhase = g.phase;
  }
  view.setNight(g.night);
  view.setGearMode(g.mode === 'gear');
  view.setFreeMode(g.mode === 'free');
  if (g.colourBlind !== view.colourBlind) {
    // The goggles went on or came off: everything printed in colour prints again.
    view.setColourBlind(g.colourBlind);
    indexArt.clear();
    shownPage = null;
    if (readerShown) closeReader();
  }

  acc += elapsed;
  while (acc >= DT) {
    const actions: Action[] =
      g.round?.phase === 'results' ? [] : input.drainActions().filter((a) => !pickFirst(g, a));
    g.tick(input.state, actions);
    acc -= DT;
  }
  const simulated = performance.now();
  if (g.round?.phase === 'results' && !results.visible && g.round.result) {
    freeMouse();
    closeReader();
    const ending = g.ending && {
      winner: g.ending.winner,
      roles: [...g.ending.roles].map(([id, role]) => ({
        name: g.nameOf(id),
        role,
        home: g.ending!.sentHome.includes(id),
      })),
      teams: g.ending.teams,
      team: g.team,
    };
    results.show(
      roundTarget(),
      g.sim.build().grid,
      g.round.result,
      g.round.endReason!,
      ending,
      g.mode === 'free' ? { name: defaultBuildName(g) } : null,
    );
  }
  if (results.visible) results.setHost(g.isHost);
  if (g.phase === 'lobby' && results.visible) results.hide();

  // Draw everything blended between the last two physics steps.
  const alpha = acc / DT;
  g.settle(elapsed);
  view.poseOf = (body) => g.pose(body, alpha);
  const me = g.me;
  // Lying on the ground, you watch your own ragdoll from behind.
  const fallen = me && me.down > 0 ? view.ragdollFocus(me.id) : null;
  const eye = fallen
    ? add(fallen, v3(0, 0.5, 0))
    : me
      ? add(g.pose(me.body, alpha).pos, v3(0, EYE_OFFSET, 0))
      : v3(0, 2, 6);
  let closeUp = input.state.firstPerson;
  if (me) {
    const pose = rig.update(
      { eye, yaw: input.state.yaw, pitch: input.state.pitch, firstPerson: !fallen && closeUp },
      elapsed,
      (from, to, radius) => g.sim.sightline(me, from, to, radius),
    );
    view.camera.position.set(pose.pos.x, pose.pos.y, pose.pos.z);
    view.camera.rotation.set(pose.pitch, pose.yaw, 0, 'YXZ');
    closeUp = pose.closeUp;
  } else {
    rig.reset();
    if (g.sentHome && g.phase === 'building') flyCamera(elapsed);
  }

  const held = me?.holding ? g.sim.assemblies.get(me.holding.assemblyId) : undefined;
  const preview = me ? g.sim.snapPreview(me) : null;
  const inspectors = g.round?.inspectors ?? g.sim.sites.map(() => IDLE_INSPECTOR);
  const inspector = inspectors[g.mySite] ?? IDLE_INSPECTOR;
  view.syncAssemblies(g.sim.assemblies, g.sim.level.svgs);
  view.syncDog(g.sim.dog, elapsed, now / 1000);
  const vacuumBy = g.sim.vacuum.heldBy === null ? null : g.sim.players.get(g.sim.vacuum.heldBy);
  view.syncVacuum(g.sim.vacuum, vacuumBy ? g.sim.vacuumHead(vacuumBy) : null);
  view.syncPlayers(
    g.sim.players,
    g.myId,
    closeUp,
    look(g),
    {
      R: RAPIER,
      world: g.sim.world,
    },
    elapsed,
  );
  view.syncPages(g.sim.pages, pageArt);
  view.syncGear(g.sim.gear);
  view.syncMachines(g.sim.machines, g.sim.level.svgs ?? {}, g.sim.machinesPowered);
  view.showGhost(preview, held);
  view.showInspectors(inspectors, roundTarget());
  const build = g.sim.assemblies.get(g.sim.buildIds[g.mySite] ?? g.sim.buildId);
  if (build) view.showInspectionMarks(inspector.report, build);
  playEvents(g.takeEvents(), eye);
  playVacuum(eye);
  updateVoice(g, eye, alpha);
  view.updateEffects(elapsed);
  view.furniture.sync(g.sim.hideouts, g.sim.furnitureVersion);
  view.furniture.animate(elapsed);
  view.setPower(g.sim.power.on);
  view.animatePanel(elapsed, g.sim.power.on, g.sim.power.fixer !== null);
  updateShown(g);
  // A page open in the reader shuts when the dark closes in (the lamp wearer walked off).
  if (me && readerShown && readerShown !== 'shown' && !canRead(g, me.body.translation())) {
    closeReader();
    notice(TOO_DARK);
  }
  if (now > noticeUntil) noticeEl.classList.add('hidden');
  social.update(now);
  updateTimer(g);
  if (me) {
    updateReport(g, me);
    updatePocket(g, me);
  }

  const aim = me ? g.sim.aim(me) : null;
  hintEl.textContent = input.locked && me ? forTouch(hintFor(g, me, aim, preview !== null)) : '';
  if (input.touch) {
    touch.update({
      holding: !!me?.holding || !!me?.tool || g.sim.vacuum.heldBy === me?.id,
      page: me?.page != null,
      others: !solo && g.lobby.players.filter((p) => p.connected).length > 1,
      talk: !!voice && voice.micMode === 'push',
    });
  }
  const where = demo.active
    ? 'demo'
    : solo
      ? 'solo'
      : `room ${g.roomCode} · ${Math.round(g.ping)} ms`;
  setText(
    statusEl,
    `${perf.currentFps(now).toFixed(0)} fps · ${where} · ${g.lobby.players.filter((p) => p.connected).length} players`,
  );

  const synced = performance.now();
  bench?.beforeDraw();
  view.render();
  loadingDone();
  results.frame(elapsed);
  const done = performance.now();
  perf.work(started, simulated, synced, done);
  bench?.sample(now, { started, simulated, synced, done, server: serverMs });
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// ?bench in the address opens the benchmark's setup.
if (params.has('bench') && location.hash !== '#editor') benchSetup.show();
