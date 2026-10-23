import RAPIER from '@dimforge/rapier3d-compat';
import {
  DT,
  catchUp,
  EYE_OFFSET,
  GEAR_IDS,
  LIGHTHOUSE,
  MAPS,
  buildById,
  canFlip,
  add,
  isLooseBrick,
  v3,
  loadNavCore,
} from '@sar/shared';
import type { Action, InspectorState, PrintedPage } from '@sar/shared';
import { Sfx } from './audio.ts';
import { Benchmark } from './bench/bench.ts';
import { BotArena } from './bench/arena.ts';
import { BenchReport } from './bench/report.ts';
import { BenchSetup } from './bench/setup.ts';
import type { BenchRun, FrameRun } from './bench/setup.ts';
import { gameNow } from './clock.ts';
import { GameEvents } from './gameEvents.ts';
import { Input, toggleFullscreen } from './input.ts';
import { KEY_LABELS, sayHint, touchLabels } from './hints.ts';
import type { Hint } from './hints.ts';
import { openPicker } from './machineUse.ts';
import { hintFor } from './aimHints.ts';
import { loadSettings } from './settings.ts';
import { localConnection, takeSoloServerMs, withLag, wsConnection } from './net/connection.ts';
import type { Connection } from './net/connection.ts';
import { ClientGame } from './net/game.ts';
import { PagePrinter, pageContent, printIndex, printUnreadable } from './render/pages.ts';
import { ResultsView } from './render/results.ts';
import { CameraRig } from './render/camera.ts';
import { MenuOrbit } from './render/menuOrbit.ts';
import { loadPropFiles } from './render/propFiles.ts';
import { loadPaintings } from './carscene/paintCache.ts';
import { view } from './worldView.ts';
import { AppBar } from './ui/appbar.ts';
import { BoxArt } from './ui/boxArt.ts';
import { DemoPanel } from './ui/demo.ts';
import { Dock } from './ui/dock.ts';
import { setText, typing } from './ui/dom.ts';
import { defaultBuildName, exportJobSite } from './ui/exportBuild.ts';
import { LobbyPanel, Menu } from './ui/lobby.ts';
import { loadingDone, loadingStep } from './ui/loading.ts';
import { PerfPanel } from './ui/perf.ts';
import { PageReader } from './ui/reader.ts';
import { ReportPanel } from './ui/reportPanel.ts';
import { profiler } from './profiler.ts';
import { SettingsPanel } from './ui/settings.ts';
import { SocialUI } from './ui/social.ts';
import { MachinePicker } from './ui/machinePicker.ts';
import { TouchControls, useLabel } from './ui/touch.ts';
import { VoiceChat } from './voiceChat.ts';
import './style.css';

// Levels are built at once, so the prop model files are read first.
loadingStep('Loading the furniture and the physics…');
// The textures a map painted on an earlier visit come back from the browser's storage meanwhile
// (none of the first maps needs them, so nothing waits for them).
void loadPaintings();
await Promise.all([RAPIER.init(), loadPropFiles(), loadNavCore()]);
profiler.watchPhysics(RAPIER);
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
const settingsPanel = new SettingsPanel(
  settings,
  (s, changed) => {
    input.sensitivity = s.sensitivity;
    sfx.setVolume(s.volume, s.muted);
    const v = voiceChat.voice;
    if (changed === 'mic' && v) {
      void v.setMode(s.mic).then(() => settingsPanel.setMicProblem(v.micError));
    }
    if (changed === 'graphics') view.graphics.apply(s.graphics);
    if (changed === 'volume') {
      // A preview click, so they hear the new level.
      sfx.click();
    }
  },
  () => input.freeMouse(),
);
const voiceChat = new VoiceChat(
  document.getElementById('mic')!,
  sfx,
  settings,
  settingsPanel,
  () => solo,
);
const params = new URLSearchParams(location.search);
const lagMs = Number(params.get('lag') ?? 0);

let game: ClientGame | null = null;
let solo = false;

const $ = (id: string) => document.getElementById(id)!;
const hintEl = $('hint');
const statusEl = $('status');
const perf = new PerfPanel(statusEl, () => (solo ? null : (game?.pings ?? [])));
const timerEl = $('timer');
const bannerEl = $('banner');
const report = new ReportPanel($('report'));

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
 * Art for what is printed on a page; forgeries get their own (slightly wrong) art. A page with
 * nothing readable on it (blind build mode, for all but the reader) is a smudge.
 */
const pageArt = (printed: PrintedPage | null): HTMLCanvasElement => {
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
const reader = new PageReader($('reader'), $('pocket'), pageArt, roundTarget, notice);
const social = new SocialUI(() => game, input);
const gameEvents = new GameEvents(sfx, () => game, notice, voiceChat);

const boxArt = new BoxArt($('target'), printer, designTarget);
boxArt.update(game);

input.holding = () => game?.me?.holding != null || game?.me?.tool != null;
input.vacuuming = () => !!game?.me && game.sim.vacuum.heldBy === game.me.id;
input.onToggleHelp = () => dock.togglePinned();
input.onToggleReader = () => reader.toggle(game);
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
  if (!reader.isOpen) return false;
  reader.close();
  return true;
};
// Outside full screen the browser frees the mouse on Esc before the game hears it, so close the
// page and take the mouse straight back. The game frees it on purpose for the chat, settings,
// meetings and results; leave the page open for those.
input.onEscapeUnlock = () => {
  if (!reader.isOpen) return;
  if (social.chatOpen || settingsPanel.isOpen || game?.meeting || results.visible) return;
  if (picker.isOpen) return;
  reader.close();
  input.relock();
};
input.onShow = () => {
  if (game?.me?.page != null) game.send({ t: 'show' });
};
input.onToggleReport = () => (report.pinned = !report.pinned);
input.onChat = () => {
  if (game) social.openChat();
};
// With the mouse free (in a meeting, or after Esc) Enter still opens the chat.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && game && !input.locked && !typing(e) && !social.chatOpen) {
    social.openChat();
  }
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
  const soloRoom = local
    ? localConnection(RAPIER, extra === 'bench' ? 1 : undefined, extra === 'bench')
    : null;
  try {
    conn = soloRoom ?? (await wsConnection());
  } catch (err) {
    banner('');
    // Without a server, solo play still runs in this tab; only invites need the server.
    if (invitable) return open(name, undefined, true);
    menu.showError(`${(err as Error).message} Try "Play solo" instead.`);
    return;
  }
  // A benchmark's messages come and go on its own steps, not the wall clock's (?lag).
  if (lagMs > 0 && extra !== 'bench') conn = withLag(conn, lagMs);
  game?.close();
  solo = local;
  const g = new ClientGame(RAPIER, conn);
  game = g;
  conn.onClose = (reason) => void lost(g, name, reason);
  // The demo's first round starts once the solo room has let us in (later with ?lag).
  follow(g, extra === 'demo' && soloRoom ? () => demo.start(soloRoom.room) : undefined);
  g.hello(name, room, room ? readToken(room) : undefined, hidden, invitable);
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
        tick: () => soloRoom.tick(),
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
  void open('Benchmark', undefined, true, 'bench');
}

const benchSetup = new BenchSetup(() => settings.graphics, startBench);
const benchReport = new BenchReport(
  () => startBench(frameRun),
  () => {},
);
const arena = new BotArena(() => benchSetup.show());

/** Tries to get back into the same room a few times before giving up. */
async function lost(g: ClientGame, name: string, reason: string): Promise<void> {
  // Turned away by the server, the game is gone already (see follow): no point retrying.
  if (game !== g) return;
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
      follow(next);
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
function notice(text: string | Hint): void {
  noticeEl.textContent = typeof text === 'string' ? text : say(text);
  noticeEl.classList.remove('hidden');
  noticeUntil = performance.now() + 3500;
}

/** Whether you hold anything: a brick or build, a mould or bucket, or the vacuum. */
const holdsAnything = (g: ClientGame | null) => {
  const me = g?.me;
  return !!me && (!!me.holding || !!me.tool || g.sim.vacuum.heldBy === me.id);
};

/** A hint in the words of the controls in use: keys and mouse buttons, or the touch buttons. */
const say = (hint: Hint): string =>
  sayHint(hint, input.touch ? touchLabels(useLabel(holdsAnything(game))) : KEY_LABELS);

function banner(text: string): void {
  bannerEl.textContent = text;
  bannerEl.classList.toggle('hidden', !text);
}

const menu = new Menu({
  create: (name, hidden) => void open(name, undefined, false, null, hidden),
  join: (name, code) => void open(name, code, false),
  solo: (name) => void open(name, undefined, false, null, false, true),
  demo: (name) => void open(name, undefined, true, 'demo'),
  bench: () => benchSetup.show(),
  editor: () => void openEditor(),
  forum: { art: (build) => printer.boxArt(build), use: (build) => demo.useBuild(build) },
});

// ------------------------------------------------------------------ getting around

const appBar = new AppBar({
  resume: () => {
    input.relock();
  },
  pause: () => input.freeMouse(),
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
    if (reader.isOpen) return reader.close();
    input.act({ kind: input.holding() ? 'place' : 'grab' });
  },
  read: () => input.onToggleReader(),
  show: () => input.onShow(),
  chat: () => input.onChat(),
  // How to play is a tab in the dock, which only shows with play stopped.
  help: () => {
    input.freeMouse();
    dock.open('help');
  },
  talk: (down) => voiceChat.talk(down),
  fullscreen: () => void toggleFullscreen(),
});
const picker = new MachinePicker((a) => pick(a), input);
input.mayCapture = () => !picker.isOpen && !editorOpen;
/** The silo or mould dispenser the picker is open for (see `pickFirst`). */
let pickingFor: number | null = null;

/**
 * What was picked goes to the server, unless the silo or the dispenser started on something
 * else meanwhile (someone else's order), when it would not take the pick: then it says so.
 */
function pick(action: Action): void {
  const g = game;
  if (g && pickingFor !== null && (action.kind === 'fill' || action.kind === 'mould')) {
    const m = g.sim.machines.get(pickingFor);
    if (m && (m.making !== null || !m.out.includes(null))) {
      const [name, what] = m.def.kind === 'silo' ? ['silo', 'bucket'] : ['dispenser', 'mould'];
      return notice(
        `The ${name} started on someone else's ${what} meanwhile: pick again once it is taken`,
      );
    }
  }
  input.act(action);
}

/**
 * A click on something lying in a machine's output area says so: should it be gone by the
 * time the click reaches the server, the click then does nothing rather than work the machine.
 */
function markOutput(g: ClientGame, action: Action): Action {
  if (action.kind !== 'grab' && action.kind !== 'place') return action;
  const me = g.me;
  return me && g.sim.sight.aim(me)?.owner.kind === 'output' ? { ...action, output: true } : action;
}

/**
 * A click on the silo, the mould dispenser or the UV printer with a part on it asks what to
 * make first: the picker opens instead, and what is picked goes to the server as its own action.
 */
function pickFirst(g: ClientGame, action: Action): boolean {
  const me = g.me;
  if (!me || g.role === 'reader') return false;
  const m = openPicker(g, me, picker, action);
  if (m) pickingFor = m.def.id;
  return m !== null;
}

// The open page covers the controls; a tap anywhere on it puts it away.
reader.el.addEventListener('click', () => {
  if (input.touch) reader.close();
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
    demo.stop();
    results.hide();
    reader.close();
    social.closeChat(false);
    report.pinned = false;
    dock.unpin();
    noticeEl.classList.add('hidden');
    input.freeMouse();
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

/**
 * Follows a game into its room: once in (and `joined`, if given), remember the reconnect token
 * and put the room code in the address bar; turned away, back to the menu saying why.
 */
function follow(g: ClientGame, joined?: () => void): void {
  g.onWelcome = () => {
    if (game !== g) return;
    banner('');
    joined?.();
    if (solo) return;
    try {
      sessionStorage.setItem(tokenKey(g.roomCode), g.token);
    } catch {
      // Without storage a reload just joins as a new player.
    }
    history.replaceState(null, '', `/${g.roomCode}${location.search}`);
  };
  g.onError = (message) => {
    if (game !== g) return;
    // The server turned us away (unknown room, full room): no point retrying.
    game = null;
    g.close();
    banner('');
    menu.showError(message);
  };
}

// ------------------------------------------------------------------ HUD helpers

const IDLE_INSPECTOR: InspectorState = {
  status: 'idle',
  progress: 0,
  report: null,
  scannedVersion: -1,
};

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

const who = (g: ClientGame) => (id: number) => {
  const p = g.lobby.players.find((x) => x.id === id);
  return { colour: p?.colour ?? 0x7f8c8d, name: p?.name ?? '' };
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
  // A benchmark run moves the game on a fixed step a frame, and runs its room itself.
  const elapsed = bench?.step() ?? Math.min(0.25, (now - last) / 1000);
  last = now;
  const started = performance.now();
  const serverMs = takeSoloServerMs();
  perf.frame(now, serverMs);
  const g = game;
  profiler.begin('logic.input');
  input.update();
  bench?.drive(now);

  if (g !== shownGame || (g && g.worldVersion !== shownWorld)) {
    // A new round comes with a newly furnished house.
    profiler.next('scene.level');
    if (g) view.setLevel(g.sim.level);
    view.reset();
    results.hide();
    report.forget();
    reader.forget();
    shownGame = g;
    shownWorld = g?.worldVersion ?? -1;
  }
  profiler.next('logic.ui');
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
  boxArt.update(g);
  if (!g) social.update(now);
  profiler.end();

  if (!g) {
    voiceChat.stop();
    sfx.vacuumMotor(0, 0, false);
    // The editor moves the camera and draws the view itself, on its own map.
    if (editorOpen) {
      perf.done();
      requestAnimationFrame(frame);
      return;
    }
    // Before joining: a slow fly-around of the empty yard behind the menu, kept out of the
    // house (or whatever map the last round left standing).
    profiler.begin('scene.camera');
    if (menuOrbit?.level !== view.level) menuOrbit = new MenuOrbit(view.level);
    const pos = menuOrbit.at(now / 1000);
    view.camera.position.set(pos.x, pos.y, pos.z);
    view.camera.lookAt(menuOrbit.look.x, menuOrbit.look.y, menuOrbit.look.z);
    profiler.next('light.sun');
    view.setNight(false);
    profiler.next('render.other');
    // The benchmark's pages cover the yard: drawing it would only cost frames (and slow the
    // bots playing rounds meanwhile).
    const covered = benchSetup.visible || benchReport.visible || arena.visible;
    // The loading screen stays up while the yard's shaders compile.
    const drawn = covered || view.render();
    profiler.end();
    if (drawn) loadingDone();
    perf.done();
    requestAnimationFrame(frame);
    return;
  }
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
  profiler.begin('light.sun');
  view.setNight(g.night);
  profiler.next('scene.props');
  view.setGearMode(g.mode === 'gear');
  view.setFreeMode(g.mode === 'free');
  profiler.end();
  if (g.colourBlind !== view.colourBlind) {
    // The goggles went on or came off: everything printed in colour prints again.
    view.setColourBlind(g.colourBlind);
    indexArt.clear();
    reader.redraw();
  }

  profiler.begin('logic.rules');
  // Ticks that fell behind are caught up on, unless they are too slow to (see `catchUp`).
  acc = catchUp(acc + elapsed, () => {
    const actions: Action[] =
      g.round?.phase === 'results'
        ? []
        : input
            .drainActions()
            .filter((a) => !pickFirst(g, a))
            .map((a) => markOutput(g, a));
    g.tick(input.state, actions);
  });
  profiler.end();
  const simulated = performance.now();
  profiler.begin('logic.ui');
  if (g.round?.phase === 'results' && !results.visible && g.round.result) {
    input.freeMouse();
    reader.close();
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
  profiler.next('logic.net');
  const alpha = acc / DT;
  g.settle(elapsed);
  view.poseOf = (body) => g.pose(body, alpha);
  profiler.next('scene.camera');
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
      (from, to, radius) => g.sim.sight.sightline(me, from, to, radius),
    );
    view.camera.position.set(pose.pos.x, pose.pos.y, pose.pos.z);
    view.camera.rotation.set(pose.pitch, pose.yaw, 0, 'YXZ');
    closeUp = pose.closeUp;
  } else {
    rig.reset();
    if (g.sentHome && g.phase === 'building') flyCamera(elapsed);
  }

  profiler.next('scene.bricks');
  const held = me?.holding ? g.sim.assemblies.get(me.holding.assemblyId) : undefined;
  const preview = me ? g.sim.placing.snapPreview(me) : null;
  const inspectors = g.round?.inspectors ?? g.sim.sites.map(() => IDLE_INSPECTOR);
  const inspector = inspectors[g.mySite] ?? IDLE_INSPECTOR;
  view.syncAssemblies(g.sim.assemblies, g.sim.level.svgs);
  profiler.next('scene.players');
  view.syncDog(g.sim.dog, elapsed, gameNow() / 1000);
  const vacuumBy = g.sim.vacuum.heldBy === null ? null : g.sim.players.get(g.sim.vacuum.heldBy);
  view.syncVacuum(g.sim.vacuum, vacuumBy ? g.sim.vacuuming.vacuumHead(vacuumBy) : null, elapsed);
  view.syncPlayers(
    g.sim.players,
    g.myId,
    closeUp,
    input.state.firstPerson,
    who(g),
    {
      R: RAPIER,
      world: g.sim.world,
    },
    elapsed,
    (id) => g.sim.working.fixing(id),
  );
  profiler.next('scene.props');
  view.syncPages(g.sim.pages, (page) => pageArt(page.printed));
  view.syncGear(g.sim.gear);
  view.syncMachines(g.sim.machines, g.sim.level.svgs ?? {}, g.sim.working.machinesPowered);
  profiler.next('scene.bricks');
  view.showGhost(preview, held);
  view.showInspectors(inspectors, roundTarget());
  const buildId = g.sim.buildIds[g.mySite];
  const build = buildId === undefined ? undefined : g.sim.assemblies.get(buildId);
  if (build) view.showInspectionMarks(inspector.report, build);
  profiler.next('logic.audio');
  sfx.future = !!g.sim.level.scenery;
  gameEvents.update(g.takeEvents(), eye);
  voiceChat.update(g, eye, alpha);
  profiler.next('scene.effects');
  view.updateEffects(elapsed);
  profiler.next('scene.props');
  view.furniture.sync(g.sim.hideouts, g.sim.furnitureVersion, g.sim.gadgets);
  view.furniture.slideDoors(g.sim.doorsOpen(), g.sim.carDoorsOpen());
  view.furniture.animate(elapsed);
  profiler.next('light.sun');
  view.setPower(g.sim.power.on);
  view.furniture.setPower(g.sim.power.on);
  view.animatePanel(elapsed, g.sim.power.on, g.sim.power.fixer !== null);
  profiler.next('logic.ui');
  reader.update(g);
  if (now > noticeUntil) noticeEl.classList.add('hidden');
  social.update(gameNow());
  updateTimer(g);
  if (me) {
    report.update(g, me);
  }

  const aim = me ? g.sim.sight.aim(me) : null;
  // Whether R turns the single part in hand 45° where it would go: it is turned so already, or
  // it would hang on one stud alone there.
  const single = me?.holding && g.sim.assemblies.get(me.holding.assemblyId);
  const turns45 =
    input.locked &&
    !!me?.holding &&
    !!preview &&
    !!single &&
    isLooseBrick(single) &&
    (me.holding.eighth
      ? !!preview.turned45
      : !!g.sim.placing.snapPreview(me, { eighth: true })?.turned45);
  hintEl.textContent =
    input.locked && me ? say(hintFor(g, me, aim, preview !== null, turns45)) : '';
  if (input.touch) {
    const inHand = me?.holding && g.sim.assemblies.get(me.holding.assemblyId);
    const [part] = inHand && isLooseBrick(inHand) ? inHand.grid.bricks.values() : [];
    touch.update({
      holding: holdsAnything(g),
      flip: !!part && canFlip(part.type),
      page: me?.page != null,
      others: !solo && g.lobby.players.filter((p) => p.connected).length > 1,
      talk: voiceChat.voice?.micMode === 'push',
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

  profiler.end();
  const synced = performance.now();
  bench?.beforeDraw();
  profiler.begin('render.other');
  const drawn = view.render();
  profiler.next('logic.ui');
  if (drawn) loadingDone();
  results.frame(elapsed);
  profiler.end();
  const done = performance.now();
  perf.done();
  bench?.sample(now, { started, simulated, synced, done, server: serverMs }, drawn);
  requestAnimationFrame(frame);
}

// The first frame compiles every shader the yard is drawn with before it shows anything.
loadingStep('Mixing the paint…');
requestAnimationFrame(frame);

// ?bench in the address opens the benchmark's setup.
if (params.has('bench') && location.hash !== '#editor') benchSetup.show();
