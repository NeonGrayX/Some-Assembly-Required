import {
  BOT_LEVELS,
  BOT_SIDES,
  BOT_LEVEL_NAMES,
  BUILDS,
  MAPS,
  GAME_MODES,
  GEAR_HUNT_EXTRA_SECONDS,
  MAX_PLAYERS,
  RANDOM_BUILD,
  ROUND_LENGTHS,
  SABOTEUR_SETTINGS,
  TIMES_OF_DAY,
  buildById,
  faceName,
  hatName,
  lookOr,
  shirtName,
  TEAM_NAMES,
} from '@sar/shared';
import type {
  BotLevel,
  BotSide,
  GameMode,
  LobbyPlayer,
  Look,
  MapId,
  TargetBuild,
  TimeOfDay,
} from '@sar/shared';
import type { ClientGame } from '../net/game.ts';
import { Designer } from './designer.ts';
import { ForumBrowser } from './forum.ts';
import type { ForumHandlers } from './forum.ts';
import { RoomBrowser } from './rooms.ts';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const minutes = (s: number) => `${s / 60} minutes`;
const TIME_LABELS: Record<TimeOfDay, string> = {
  day: 'Day',
  night: 'Night',
  random: 'Random each round',
};
const BOT_LEVEL_LABELS: Record<BotLevel, string> = {
  easy: 'Easy: slow and forgetful',
  normal: 'Normal: a fair teammate',
  hard: 'Hard: quick and sharp',
  expert: 'Expert: plays to beat you',
};
/** The host's per-player lists: a bot's level, and the role a player is dealt (solo). */
const BOT_LEVEL_PICKS: [string, string][] = BOT_LEVELS.map((l) => [l, BOT_LEVEL_NAMES[l]]);
const ROLE_PICKS: [string, string][] = [
  ['random', 'Random'],
  ['saboteur', 'Saboteur'],
  ['builder', 'Builder'],
];
const select = (pick: string, name: string, value: string, options: [string, string][]) =>
  `<span class="select"><select data-pick="${pick}" aria-label="${esc(name).replace(/"/g, '&quot;')}'s ${pick}">` +
  options
    .map(([v, label]) => `<option value="${v}"${v === value ? ' selected' : ''}>${label}</option>`)
    .join('') +
  '</select></span>';
const BOT_SIDE_LABELS: Record<BotSide, string> = {
  any: 'Either side (roles dealt as usual)',
  saboteurs: 'Saboteurs: bots against the people',
  builders: 'Builders: people are the saboteurs',
};
const MODE_LABELS: Record<GameMode, string> = {
  saboteur: 'Saboteur: one of you is secretly against the build',
  gear: 'Gear Hunt (co-op): find the gear that fixes the job site',
  coop: 'Plain co-op: just build together',
  free: 'Free build: no plans, no clock, build anything and export it',
  blind: 'Blind build: one reader sees the pages, nobody else',
  rival: 'Rival teams: two yards race for the best build',
};
export const MODE_NAMES: Record<GameMode, string> = {
  saboteur: 'saboteur',
  gear: 'gear hunt',
  coop: 'plain co-op',
  free: 'free build',
  blind: 'blind build',
  rival: 'rival teams',
};
const TEAM_CLASS = ['red', 'blue'] as const;

/** The look (hat, face, shirt) picked last time, remembered next to the name. */
export function savedLook(): Look {
  try {
    return lookOr({
      hat: localStorage.getItem('sar.hat'),
      face: localStorage.getItem('sar.face'),
      shirt: localStorage.getItem('sar.shirt'),
    });
  } catch {
    // Storage can be blocked; the look just is not remembered then.
    return lookOr(undefined);
  }
}

export function saveLook(look: Look): void {
  try {
    localStorage.setItem('sar.hat', look.hat);
    localStorage.setItem('sar.face', look.face);
    localStorage.setItem('sar.shirt', look.shirt);
  } catch {
    // See above.
  }
}

/**
 * The main menu, the hub every screen leads back to: name, join a room by its code, play solo,
 * the demo or the build editor, the room list (its second page) to find or create a room, and
 * the community page of shared builds. The look is picked in the lobby.
 */
export class Menu {
  private readonly el = $('#menu');
  private readonly home = $('#menu .home');
  private readonly roomsPage = $('#menu .rooms');
  private readonly forumPage = $('#menu .forum');
  private readonly name = $<HTMLInputElement>('#name');
  private readonly code = $<HTMLInputElement>('#code');
  private readonly rooms: RoomBrowser;
  private readonly forum: ForumBrowser;

  constructor(handlers: {
    create: (name: string, hidden: boolean) => void;
    join: (name: string, code: string) => void;
    solo: (name: string) => void;
    demo: (name: string) => void;
    bench: () => void;
    editor: () => void;
    /** The community page's: a build's box art, and picking a build for demo mode. */
    forum: Pick<ForumHandlers, 'art'> & { use: (build: TargetBuild) => string | null };
  }) {
    try {
      this.name.value = localStorage.getItem('sar.name') ?? '';
    } catch {
      // Storage can be blocked; the name just is not remembered then.
    }
    const linked = location.pathname.slice(1).toUpperCase();
    if (/^[A-Z]{4}$/.test(linked)) this.code.value = linked;
    const name = () => {
      const n = this.name.value.trim();
      try {
        localStorage.setItem('sar.name', n);
      } catch {
        // See above.
      }
      return n;
    };
    this.rooms = new RoomBrowser(this.roomsPage, {
      join: (code) => handlers.join(name(), code),
      create: (hidden) => handlers.create(name(), hidden),
    });
    this.forum = new ForumBrowser(this.forumPage, {
      name,
      art: handlers.forum.art,
      play: (build) => {
        const problem = handlers.forum.use(build);
        if (!problem) handlers.demo(name());
        return problem;
      },
    });
    $('#browse').addEventListener('click', () => this.showPage('rooms'));
    $('#community').addEventListener('click', () => this.showPage('forum'));
    // Back is in the app bar, as on every page; Esc does the same.
    for (const page of [this.roomsPage, this.forumPage]) {
      page.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this.back();
      });
    }
    $('#join').addEventListener('click', () => {
      const code = this.code.value.trim().toUpperCase();
      if (!/^[A-Z]{4}$/.test(code)) return this.showError('Room codes are four letters.');
      handlers.join(name(), code);
    });
    this.code.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#join').click();
    });
    $('#solo').addEventListener('click', () => handlers.solo(name()));
    $('#demo').addEventListener('click', () => handlers.demo(name()));
    $('#open-editor').addEventListener('click', () => handlers.editor());
    $('#bench').addEventListener('click', () => handlers.bench());
    (this.code.value ? this.code : this.name).focus();
  }

  /** Turns to the room list or the community page, or back to the cover. */
  private showPage(page: 'home' | 'rooms' | 'forum'): void {
    const from = this.page;
    this.clearErrors();
    this.home.classList.toggle('hidden', page !== 'home');
    this.roomsPage.classList.toggle('hidden', page !== 'rooms');
    this.forumPage.classList.toggle('hidden', page !== 'forum');
    if (page === 'rooms') this.rooms.open();
    else this.rooms.close();
    if (page === 'forum') this.forum.open();
    if (page === 'home' && from !== 'home') $(from === 'rooms' ? '#browse' : '#community').focus();
  }

  /** The page off the cover that is open, if one is (and the menu is showing). */
  get subpage(): 'rooms' | 'forum' | null {
    const page = this.page;
    return this.visible && page !== 'home' ? page : null;
  }

  /** One step back: from a shared build to the list, from a page to the cover. */
  back(): void {
    if (this.page === 'forum' && this.forum.back()) return;
    this.showPage('home');
  }

  private get page(): 'home' | 'rooms' | 'forum' {
    if (!this.roomsPage.classList.contains('hidden')) return 'rooms';
    if (!this.forumPage.classList.contains('hidden')) return 'forum';
    return 'home';
  }

  private clearErrors(): void {
    for (const e of this.el.querySelectorAll('.menu-error')) e.textContent = '';
    this.forum.clearMessage();
  }

  /** Shows the menu with a message on the page it was left on. */
  showError(message: string): void {
    this.clearErrors();
    const page = this.page === 'rooms' ? this.roomsPage : this.home;
    if (this.page === 'forum') this.showPage('home');
    page.querySelector('.menu-error')!.textContent = message;
    this.show();
  }

  show(): void {
    this.el.classList.remove('hidden');
    if (this.page === 'rooms') this.rooms.open();
  }

  get visible(): boolean {
    return !this.el.classList.contains('hidden');
  }

  hide(): void {
    this.el.classList.add('hidden');
    this.rooms.close();
    this.clearErrors();
  }
}

/**
 * The lobby panel: who is here (and what they wear), who is ready, the character designer
 * for your own look, and (for the host) settings and Start.
 */
export class LobbyPanel {
  private readonly el = $('#lobby');
  private readonly designer = new Designer($('#lobby .designer'), (look) => {
    saveLook(look);
    this.game()?.send({ t: 'look', ...look });
  });
  private readonly length = $<HTMLSelectElement>('#length');
  private readonly saboteurs = $<HTMLSelectElement>('#saboteurs');
  private readonly mode = $<HTMLSelectElement>('#mode');
  private readonly build = $<HTMLSelectElement>('#build');
  private readonly time = $<HTMLSelectElement>('#time');
  private readonly map = $<HTMLSelectElement>('#map');
  private readonly listed = $<HTMLSelectElement>('#listed');
  private readonly botLevel = $<HTMLSelectElement>('#bot-level');
  private readonly botSide = $<HTMLSelectElement>('#bot-side');
  private shown = '';

  constructor(
    private readonly game: () => ClientGame | null,
    private readonly solo: () => boolean,
  ) {
    for (const s of ROUND_LENGTHS) this.length.add(new Option(minutes(s), String(s)));
    for (const n of SABOTEUR_SETTINGS) {
      const label = n < 0 ? 'Usual for the group size' : n === 0 ? 'None (co-op)' : String(n);
      this.saboteurs.add(new Option(label, String(n)));
    }
    this.build.add(new Option('Surprise me (random)', RANDOM_BUILD));
    for (const b of BUILDS) this.build.add(new Option(`${b.name} (${b.steps.length} pages)`, b.id));
    this.build.addEventListener('change', () =>
      this.game()?.send({ t: 'settings', build: this.build.value }),
    );
    this.saboteurs.addEventListener('change', () =>
      this.game()?.send({ t: 'settings', saboteurs: Number(this.saboteurs.value) }),
    );
    for (const m of GAME_MODES) this.mode.add(new Option(MODE_LABELS[m], m));
    this.mode.addEventListener('change', () =>
      this.game()?.send({ t: 'settings', mode: this.mode.value as GameMode }),
    );
    for (const t of TIMES_OF_DAY) this.time.add(new Option(TIME_LABELS[t], t));
    this.time.addEventListener('change', () =>
      this.game()?.send({ t: 'settings', time: this.time.value as TimeOfDay }),
    );
    this.length.addEventListener('change', () =>
      this.game()?.send({ t: 'settings', seconds: Number(this.length.value) }),
    );
    for (const m of MAPS) this.map.add(new Option(m.name, m.id));
    this.map.addEventListener('change', () =>
      this.game()?.send({ t: 'settings', map: this.map.value as MapId }),
    );
    this.listed.add(new Option('Listed: anyone can find it', 'listed'));
    this.listed.add(new Option('Private: link or code only', 'private'));
    this.listed.addEventListener('change', () =>
      this.game()?.send({ t: 'settings', private: this.listed.value === 'private' }),
    );
    for (const l of BOT_LEVELS) this.botLevel.add(new Option(BOT_LEVEL_LABELS[l], l));
    this.botLevel.addEventListener('change', () =>
      this.game()?.send({ t: 'bots', level: this.botLevel.value }),
    );
    for (const side of BOT_SIDES) this.botSide.add(new Option(BOT_SIDE_LABELS[side], side));
    this.botSide.addEventListener('change', () =>
      this.game()?.send({ t: 'bots', side: this.botSide.value }),
    );
    $('#add-bot').addEventListener('click', () =>
      this.game()?.send({ t: 'bots', add: 1, level: this.botLevel.value }),
    );
    $('#fill-bots').addEventListener('click', () =>
      this.game()?.send({ t: 'bots', fill: true, level: this.botLevel.value }),
    );
    // Taking a bot out: the host's ✕ beside it in the list.
    const players = this.el.querySelector('.players')!;
    players.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-remove-bot]')?.dataset
        .removeBot;
      if (id !== undefined) this.game()?.send({ t: 'bots', remove: Number(id) });
    });
    // The host's picks beside each player: a bot's level, and (solo) the role they are dealt.
    players.addEventListener('change', (e) => {
      const select = e.target as HTMLSelectElement;
      const id = Number(select.closest<HTMLElement>('[data-player]')?.dataset.player);
      if (!Number.isFinite(id)) return;
      if (select.dataset.pick === 'level')
        this.game()?.send({ t: 'pick', id, level: select.value });
      if (select.dataset.pick === 'role') this.game()?.send({ t: 'pick', id, role: select.value });
    });
    $('#ready').addEventListener('click', () => {
      const g = this.game();
      const me = g?.lobby.players.find((p) => p.id === g.myId);
      if (g && me) g.send({ t: 'ready', ready: !me.ready });
    });
    $('#start').addEventListener('click', () => this.game()?.send({ t: 'start' }));
    $('#team').addEventListener('click', () => this.game()?.send({ t: 'team' }));
    this.el.querySelector('.copy')!.addEventListener('click', (e) => {
      const g = this.game();
      if (!g) return;
      void navigator.clipboard?.writeText(`${location.origin}/${g.roomCode}`);
      (e.target as HTMLElement).textContent = 'Copied!';
    });
  }

  update(): void {
    const g = this.game();
    const visible = !!g && g.myId >= 0 && g.phase === 'lobby';
    this.el.classList.toggle('hidden', !visible);
    if (!g || !visible) return;
    // The designer's turntable turns every frame; the rest only changes with the lobby.
    const mine = g.lobby.players.find((p) => p.id === g.myId);
    if (mine) {
      const look = { hat: mine.hat, face: mine.face, shirt: mine.shirt };
      this.designer.update(look, mine.colour, mine.ready);
    }
    const key = JSON.stringify([g.lobby, g.myId, g.roomCode, this.solo()]);
    if (key === this.shown) return;
    this.shown = key;
    this.el.classList.toggle('host', g.isHost);
    this.el.classList.toggle('rival', g.lobby.mode === 'rival');
    this.el.querySelector('.code')!.textContent = g.roomCode;
    const copy = this.el.querySelector<HTMLElement>('.copy')!;
    copy.textContent = 'Copy link';
    // A solo room lives in this tab, so a link to it would lead nowhere.
    copy.hidden = this.solo();
    const picks = (p: LobbyPlayer) => {
      const level =
        g.isHost && p.bot
          ? `<label class="field pick-level">Level ${select('level', p.name, p.bot, BOT_LEVEL_PICKS)}</label>`
          : '';
      const role =
        g.isHost && g.lobby.rolePicks
          ? `<label class="field pick-role saboteur-only">Role ${select('role', p.name, p.role ?? 'random', ROLE_PICKS)}</label>`
          : '';
      return level || role ? `<div class="player-picks">${level}${role}</div>` : '';
    };
    this.el.querySelector('.players')!.innerHTML = g.lobby.players
      .map((p) => {
        if (p.bot) {
          const remove = g.isHost
            ? `<button type="button" class="btn remove-bot" data-remove-bot="${p.id}" aria-label="Take ${esc(p.name)} out">✕</button>`
            : '';
          // The host sees the level in its own list below the name.
          const level = g.isHost ? '' : ` · ${BOT_LEVEL_NAMES[p.bot].toLowerCase()}`;
          return `<li class="bot" data-player="${p.id}"><span class="dot" style="background:#${p.colour.toString(16).padStart(6, '0')}"></span>
          ${esc(p.name)} <span class="hat">bot${level}</span>${remove}${picks(p)}</li>`;
        }
        const tags = [
          p.id === g.lobby.host ? 'host' : '',
          !p.connected ? 'reconnecting…' : p.ready ? '✔ ready' : 'not ready',
        ].filter(Boolean);
        const colour = `#${p.colour.toString(16).padStart(6, '0')}`;
        const team =
          g.lobby.mode === 'rival'
            ? `<span class="team ${TEAM_CLASS[p.team] ?? ''}">${TEAM_NAMES[p.team] ?? '?'}</span>`
            : '';
        return `<li class="${p.connected ? '' : 'away'}" data-player="${p.id}"><span class="dot" style="background:${colour}"></span>
          ${esc(p.name)}${p.id === g.myId ? ' (you)' : ''} ${team}
          <span class="hat">${esc(`${hatName(p.hat)} · ${faceName(p.face)} · ${shirtName(p.shirt)}`.toLowerCase())}</span>
          <span class="tag ${p.ready ? 'ready' : ''}">${tags.join(' · ')}</span>${picks(p)}</li>`;
      })
      .join('');
    this.length.value = String(g.lobby.seconds);
    this.saboteurs.value = String(g.lobby.saboteurs);
    this.mode.value = g.lobby.mode;
    const withSaboteurs = g.lobby.mode === 'saboteur' || g.lobby.mode === 'blind';
    this.el.classList.toggle('saboteur-mode', withSaboteurs);
    this.el.classList.toggle('free-mode', g.lobby.mode === 'free');
    this.build.value = g.lobby.build;
    this.time.value = g.lobby.time;
    this.map.value = g.lobby.map;
    this.listed.value = g.lobby.private ? 'private' : 'listed';
    this.botLevel.value = g.lobby.botLevel;
    this.botSide.value = g.lobby.botSide;
    const full = g.lobby.players.length >= MAX_PLAYERS;
    $<HTMLButtonElement>('#add-bot').disabled = full;
    $<HTMLButtonElement>('#fill-bots').disabled = full;
    // A solo game is never listed: it lives in this tab, or friends join it by invite only.
    this.listed.closest('label')!.hidden = this.solo() || g.lobby.solo;
    const botLevels = new Set(g.lobby.players.flatMap((p) => (p.bot ? [p.bot] : [])));
    const sabs = g.lobby.saboteurs < 0 ? 'usual number of' : String(g.lobby.saboteurs);
    const build = buildById(g.lobby.build)?.name ?? 'a surprise';
    const who =
      g.lobby.mode === 'saboteur'
        ? `${sabs} saboteurs`
        : g.lobby.mode === 'blind'
          ? `${sabs} saboteurs · blind build: one reader sees the pages`
          : g.lobby.mode === 'gear'
            ? `gear hunt (+${GEAR_HUNT_EXTRA_SECONDS / 60} minutes for the hunt, no saboteurs)`
            : g.lobby.mode === 'rival'
              ? 'rival teams: two yards race for the best build, no saboteurs'
              : 'plain co-op';
    const free = g.lobby.mode === 'free';
    this.el.querySelector('.length-note')!.textContent =
      `Map: ${MAPS.find((m) => m.id === g.lobby.map)?.name ?? g.lobby.map} · ` +
      (free
        ? 'Free build: no plans, no time limit, build anything and export it · '
        : `Build: ${build} · Round length: ${minutes(g.lobby.seconds)} · ${who} · `) +
      `${TIME_LABELS[g.lobby.time].toLowerCase()}` +
      (g.lobby.private && !this.solo() && !g.lobby.solo ? ' · private room' : '') +
      (botLevels.size
        ? (botLevels.size === 1
            ? ` · ${BOT_LEVEL_NAMES[[...botLevels][0]!].toLowerCase()} bots`
            : ' · bots of mixed levels') +
          (withSaboteurs && g.lobby.botSide !== 'any'
            ? g.lobby.botSide === 'saboteurs'
              ? ' playing the saboteurs'
              : ' building, people sabotaging'
            : '')
        : '');
    const me = g.lobby.players.find((p) => p.id === g.myId);
    $('#ready').textContent = me?.ready ? 'Not ready' : "I'm ready";
    const team = $<HTMLButtonElement>('#team');
    team.disabled = !!me?.ready;
    team.textContent = me ? `Switch to ${TEAM_NAMES[me.team ? 0 : 1]}` : 'Switch team';
    const everyone = g.lobby.players.filter((p) => p.connected);
    const allReady = everyone.every((p) => p.ready || p.id === g.myId);
    const start = $<HTMLButtonElement>('#start');
    start.textContent = allReady ? 'Start round' : 'Start anyway';
  }
}
