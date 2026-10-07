import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import {
  BIN_SIZE,
  BRICK_TYPES,
  DEFAULT_LOOK,
  DT,
  EYE_OFFSET,
  LIGHTHOUSE,
  RANDOM_BUILD,
  buildById,
  HOUSE,
  add,
  isLooseBrick,
  length,
  sub,
  v3,
  pageName,
  pageNumber,
  levelSites,
} from '@sar/shared';
import type {
  Action,
  AimHit,
  InspectionReport,
  InspectorState,
  PageItem,
  Player,
  Look,
  SimEvent,
  TargetBuild,
  Vec3,
} from '@sar/shared';
import { Sfx } from './audio.ts';
import { Input } from './input.ts';
import { loadSettings } from './settings.ts';
import { localConnection, takeSoloServerMs, withLag, wsConnection } from './net/connection.ts';
import type { Connection } from './net/connection.ts';
import { ClientGame } from './net/game.ts';
import { PagePrinter, pageContent, printIndex, printUnreadable } from './render/pages.ts';
import { ResultsView } from './render/results.ts';
import { CameraRig } from './render/camera.ts';
import { HIDEOUT_TRAVEL } from './render/furniture.ts';
import { View } from './render/view.ts';
import { DemoPanel } from './ui/demo.ts';
import { LobbyPanel, Menu, savedLook } from './ui/lobby.ts';
import { PerfPanel } from './ui/perf.ts';
import { SettingsPanel } from './ui/settings.ts';
import { SocialUI } from './ui/social.ts';
import { Voice } from './voice.ts';
import type { Listener, Speaker } from './voice.ts';
import { SCREAM_MS, voiceMix } from './voice-mix.ts';
import './style.css';

await RAPIER.init();

/** This round's build in its design colours, for the box art. Each round recolours it. */
const designTarget = () => buildById(game?.targetId ?? '') ?? LIGHTHOUSE;
/** This round's model: what the pages, the index, the inspector and the results show. */
const roundTarget = () => game?.target ?? designTarget();
const view = new View(document.getElementById('game')!, HOUSE);
const input = new Input(view.renderer.domElement);
/** Where the camera is drawn from: with the player, eased only where a wall or the toggle gets in the way. */
const rig = new CameraRig();
const printer = new PagePrinter();
const sfx = new Sfx();
const settings = loadSettings();
input.sensitivity = settings.sensitivity;
sfx.setVolume(settings.volume, settings.muted);
view.graphics.apply(settings.graphics);
const settingsPanel = new SettingsPanel(settings, (s, changed) => {
  input.sensitivity = s.sensitivity;
  sfx.setVolume(s.volume, s.muted);
  if (changed === 'mic' && voice) {
    sfx.unlock();
    const v = voice;
    void v.setMode(s.mic).then(() => settingsPanel.setMicProblem(v.micError));
  }
  if (changed === 'graphics') view.graphics.apply(s.graphics);
  if (changed === 'volume') {
    // A preview click, so they hear the new level. Changing it is a gesture, so audio may start.
    sfx.unlock();
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
const helpEl = $('help');
const timerEl = $('timer');
const pocketEl = $('pocket');
const readerEl = $('reader');
const reportEl = $('report');
const bannerEl = $('banner');
let reportPinned = false;

// In demo mode "again" goes straight into a new round with the demo panel's choices.
const results = new ResultsView(document.body, () =>
  demo.active ? demo.newRound() : game?.send({ t: 'again' }),
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

// Box art in the corner, so everyone knows what they are building. In the lobby it shows the
// host's pick for the next round, or a question mark when the round picks one at random.
const targetEl = $('target');
/** The build whose art is shown (null for the question mark); undefined before the first. */
let shownBoxArt: TargetBuild | null | undefined;
function updateBoxArt(): void {
  const g = game;
  const next = g?.phase === 'lobby' ? g.lobby.build : null;
  const build = next === RANDOM_BUILD ? null : (buildById(next ?? '') ?? designTarget());
  if (build === shownBoxArt) return;
  shownBoxArt = build;
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

async function open(
  name: string,
  look: Look,
  room: string | undefined,
  local: boolean,
  demoMode = false,
): Promise<void> {
  menu.hide();
  banner(local ? '' : 'Connecting…');
  demo.stop();
  let conn: Connection;
  const soloRoom = local ? localConnection(RAPIER) : null;
  try {
    conn = soloRoom ?? (await wsConnection());
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
  conn.onClose = (reason) => void lost(g, name, look, reason);
  g.hello(name, look, room, room ? readToken(room) : undefined);
  // The solo room has taken the hello by now, so the first round can start right away.
  if (demoMode && soloRoom) demo.start(soloRoom.room);
}

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
  noticeEl.textContent = text;
  noticeEl.classList.remove('hidden');
  noticeUntil = performance.now() + 3500;
}

function banner(text: string): void {
  bannerEl.textContent = text;
  bannerEl.classList.toggle('hidden', !text);
}

const menu = new Menu({
  create: (name) => void open(name, savedLook(), undefined, false),
  join: (name, code) => void open(name, savedLook(), code, false),
  solo: (name) => void open(name, savedLook(), undefined, true),
  demo: (name) => void open(name, savedLook(), undefined, true, true),
});
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
  __sar: { view, input, game: () => game, voice: () => voice, open, pageArt },
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
  if (g.role === 'reader' && (o?.kind === 'bin' || o?.kind === 'brick' || o?.kind === 'broom')) {
    return "The reader can't touch bricks: tell the builders what the pages say";
  }
  if (o?.kind === 'dog') {
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
    return g.round.doneArmed[o.site]
      ? g.rival
        ? 'Click again to hand in your build: it is judged and locked as it stands!'
        : 'Click again to hand in the build!'
      : g.rival
        ? 'Click: Done (hand in your build; accuracy counts first, then speed)'
        : 'Click: Done (hand in the build and end the round)';
  }
  if (o?.kind === 'broom') {
    return p.holding ? 'Put down what you carry to take the broom' : 'Click: take the broom';
  }
  if (g.sim.broom.heldBy === p.id) {
    return 'Click: sweep loose bricks on the floor ahead of you · G: put the broom down';
  }
  if (p.holding) {
    const held = g.sim.assemblies.get(p.holding.assemblyId);
    if (held && !isLooseBrick(held)) {
      return canSnap
        ? 'Click: snap it all on · R: rotate · G: set down gently · T: throw'
        : 'R: rotate · G: set the build down gently · T: throw';
    }
    return canSnap
      ? 'Click: snap · R: rotate · G: drop · T: throw'
      : 'Aim at the top of a build to snap · Click: drop · T: throw';
  }
  if (!o) return '';
  if (o.kind === 'bin') {
    const bin = g.sim.level.bins.find((b) => b.id === o.binId)!;
    return `Click: take a ${bin.colour} ${bin.type}`;
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
  for (const lp of g.lobby.players) {
    if (lp.id === g.myId) continue;
    const p = g.sim.players.get(lp.id);
    const pos = p ? add(g.pose(p.body, alpha).pos, v3(0, EYE_OFFSET, 0)) : listener.pos;
    const near = !together && p && !listenerHome;
    const mix = voiceMix({
      together,
      distance: length(sub(pos, eye)),
      walls: near ? g.sim.wallsBetween(eye, pos) : 0,
      speakerHome: lp.home,
      listenerHome,
      screaming: (screams.get(lp.id) ?? 0) > now,
    });
    speakers.set(lp.id, { pos, mix });
  }
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
  sfx.unlock();
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

/** Each player screams in their own voice. */
const voicePitch = (id: number | undefined) => 0.85 + (((id ?? 0) * 37) % 30) / 100;

function playEvents(events: SimEvent[], listener: Vec3): void {
  const mine = (e: SimEvent) => e.playerId !== undefined && e.playerId === game?.myId;
  for (const e of events) {
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
    } else if (e.kind === 'swap' || e.kind === 'forge' || e.kind === 'hide') {
      // A saboteur tell: only sent to players close enough to notice.
      view.puff(e.pos);
      sfx.rustle(volume);
    } else if (e.kind === 'powerOut') {
      // The whole house goes dark: everyone hears it, wherever they are.
      sfx.powerOut();
      notice('The power is out! Fix the electrical panel in the basement.');
    } else if (e.kind === 'fixing') sfx.thump(volume * 0.7);
    else if (e.kind === 'powerOn') {
      sfx.powerOn();
      notice(mine(e) ? 'You fixed the panel: the lights are back on.' : 'The lights are back on.');
    } else if (e.kind === 'meeting') sfx.bell();
    else if (e.kind === 'sentHome') sfx.sentHome();
    else if (e.kind === 'open' || e.kind === 'close') {
      // Events carry where the hiding place is, which is enough to tell which one it was.
      const def = game?.sim.level.hideouts.find((h) => length(sub(h.pos, e.pos)) < 0.01);
      if (def) sfx.hideout(def.kind, e.kind === 'open', HIDEOUT_TRAVEL, volume);
      else sfx.thump(volume * 0.8);
    } else if (e.kind === 'pin') sfx.pin(volume);
    else if (e.kind === 'snap') sfx.snap(volume);
    else if (e.kind === 'page') sfx.page(volume);
    else if (e.kind === 'button') sfx.button(volume);
    else if (e.kind === 'grab') sfx.pickUp(volume, e.count);
    else if (e.kind === 'break') sfx.crash(volume, e.count);
    else if (e.kind === 'anchor') sfx.anchor(volume, e.count);
    else if (e.kind === 'broomUp') {
      sfx.broomUp(volume);
      if (mine(e)) notice('You took the broom. Click to sweep loose bricks ahead of you.');
    } else if (e.kind === 'broomDown') sfx.broomDown(volume);
    else if (e.kind === 'sweep') {
      if (e.playerId !== undefined) view.broom.swept(e.playerId);
      sfx.sweep(volume, e.count);
    } else if (e.kind === 'drop') {
      // A brick put back lands on top of its bin; anything else lands on the floor.
      const bin = game?.sim.level.bins.some(
        (b) => length(sub(add(b.pos, v3(0, BIN_SIZE.y, 0)), e.pos)) < 0.01,
      );
      if (bin) sfx.binDrop(volume);
      else sfx.drop(volume, e.count, e.speed);
    }
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
  const report = g.myInspector?.report ?? null;
  const pad = levelSites(g.sim.level)[g.mySite]!.inspector.pos;
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

function frame(now: number): void {
  const elapsed = Math.min(0.25, (now - last) / 1000);
  last = now;
  const started = performance.now();
  perf.frame(now, takeSoloServerMs());
  const g = game;
  input.update();

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
  timerEl.classList.toggle('hidden', !g?.round);
  lobbyPanel.update();
  if (demo.active) demo.update();
  updateBoxArt();
  if (!g) social.update(now);

  if (!g) {
    voiceFor(null);
    micEl.classList.add('hidden');
    // Before joining: a slow fly-around of the empty yard behind the menu.
    const t = now / 1000;
    view.camera.position.set(Math.sin(t * 0.1) * 9, 5, Math.cos(t * 0.1) * 9);
    view.camera.lookAt(0, 0.5, 0);
    view.setNight(false);
    view.render();
    requestAnimationFrame(frame);
    return;
  }
  onWelcome(g);
  view.setNight(g.night);

  acc += elapsed;
  while (acc >= DT) {
    const actions: Action[] = g.round?.phase === 'results' ? [] : input.drainActions();
    g.tick(input.state, actions);
    acc -= DT;
  }
  const simulated = performance.now();
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
      teams: g.ending.teams,
      team: g.team,
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
  view.syncAssemblies(g.sim.assemblies);
  view.syncDog(g.sim.dog, elapsed, now / 1000);
  view.syncBroom(g.sim.broom);
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
  view.showGhost(preview, held);
  view.showInspectors(inspectors, roundTarget());
  const build = g.sim.assemblies.get(g.sim.buildIds[g.mySite] ?? g.sim.buildId);
  if (build) view.showInspectionMarks(inspector.report, build);
  playEvents(g.takeEvents(), eye);
  updateVoice(g, eye, alpha);
  view.updateEffects(elapsed);
  view.furniture.sync(g.sim.hideouts, g.sim.furnitureVersion);
  view.furniture.animate(elapsed);
  view.setPower(g.sim.power.on);
  view.animatePanel(elapsed, g.sim.power.on, g.sim.power.fixer !== null);
  updateShown(g);
  if (now > noticeUntil) noticeEl.classList.add('hidden');
  social.update(now);
  updateTimer(g);
  if (me) {
    updateReport(g, me);
    updatePocket(g, me);
  }

  const aim = me ? g.sim.aim(me) : null;
  hintEl.textContent = input.locked && me ? hintFor(g, me, aim, preview !== null) : '';
  const where = demo.active
    ? 'demo'
    : solo
      ? 'solo'
      : `room ${g.roomCode} · ${Math.round(g.ping)} ms`;
  statusEl.textContent = `${perf.currentFps(now).toFixed(0)} fps · ${where} · ${g.lobby.players.filter((p) => p.connected).length} players`;

  const synced = performance.now();
  view.render();
  results.frame(elapsed);
  perf.work(started, simulated, synced, performance.now());
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
