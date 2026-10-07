import {
  BUILDS,
  FACES,
  HATS,
  RANDOM_BUILD,
  ROUND_LENGTHS,
  SABOTEUR_SETTINGS,
  SHIRTS,
  TIMES_OF_DAY,
  buildById,
  faceName,
  hatName,
  lookOr,
  shirtName,
} from '@sar/shared';
import type { Look, TimeOfDay } from '@sar/shared';
import type { ClientGame } from '../net/game.ts';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const minutes = (s: number) => `${s / 60} minutes`;
const TIME_LABELS: Record<TimeOfDay, string> = {
  day: 'Day',
  night: 'Night',
  random: 'Random each round',
};

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

/** The three pickers of a look, filled from the catalogues. */
class LookPickers {
  readonly hat: HTMLSelectElement;
  readonly face: HTMLSelectElement;
  readonly shirt: HTMLSelectElement;

  constructor(prefix: string, onChange: (look: Look) => void) {
    this.hat = $<HTMLSelectElement>(`#${prefix}hat`);
    this.face = $<HTMLSelectElement>(`#${prefix}face`);
    this.shirt = $<HTMLSelectElement>(`#${prefix}shirt`);
    for (const h of HATS) this.hat.add(new Option(h.name, h.id));
    for (const f of FACES) this.face.add(new Option(f.name, f.id));
    for (const s of SHIRTS) this.shirt.add(new Option(s.name, s.id));
    for (const select of [this.hat, this.face, this.shirt]) {
      select.addEventListener('change', () => onChange(this.value));
    }
  }

  get value(): Look {
    return lookOr({ hat: this.hat.value, face: this.face.value, shirt: this.shirt.value });
  }

  set value(look: Look) {
    this.hat.value = look.hat;
    this.face.value = look.face;
    this.shirt.value = look.shirt;
  }
}

/** The start menu: name and look, create or join a room, or play solo. */
export class Menu {
  private readonly el = $('#menu');
  private readonly name = $<HTMLInputElement>('#name');
  private readonly look = new LookPickers('menu-', saveLook);
  private readonly code = $<HTMLInputElement>('#code');
  private readonly error = $('#menu-error');

  constructor(handlers: {
    create: (name: string, look: Look) => void;
    join: (name: string, look: Look, code: string) => void;
    solo: (name: string, look: Look) => void;
    demo: (name: string, look: Look) => void;
  }) {
    try {
      this.name.value = localStorage.getItem('sar.name') ?? '';
    } catch {
      // Storage can be blocked; the name just is not remembered then.
    }
    this.look.value = savedLook();
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
    const look = () => this.look.value;
    $('#create').addEventListener('click', () => handlers.create(name(), look()));
    $('#join').addEventListener('click', () => {
      const code = this.code.value.trim().toUpperCase();
      if (!/^[A-Z]{4}$/.test(code)) return this.showError('Room codes are four letters.');
      handlers.join(name(), look(), code);
    });
    this.code.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#join').click();
    });
    $('#solo').addEventListener('click', () => handlers.solo(name(), look()));
    $('#demo').addEventListener('click', () => handlers.demo(name(), look()));
    (this.code.value ? this.code : this.name).focus();
  }

  showError(message: string): void {
    this.error.textContent = message;
    this.show();
  }

  show(): void {
    this.el.classList.remove('hidden');
  }

  hide(): void {
    this.el.classList.add('hidden');
    this.error.textContent = '';
  }
}

/**
 * The lobby panel: who is here (and what they wear), who is ready, your own look, and (for
 * the host) settings and Start.
 */
export class LobbyPanel {
  private readonly el = $('#lobby');
  private readonly look = new LookPickers('', (look) => {
    saveLook(look);
    this.game()?.send({ t: 'look', ...look });
  });
  private readonly length = $<HTMLSelectElement>('#length');
  private readonly saboteurs = $<HTMLSelectElement>('#saboteurs');
  private readonly build = $<HTMLSelectElement>('#build');
  private readonly time = $<HTMLSelectElement>('#time');
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
    for (const t of TIMES_OF_DAY) this.time.add(new Option(TIME_LABELS[t], t));
    this.time.addEventListener('change', () =>
      this.game()?.send({ t: 'settings', time: this.time.value as TimeOfDay }),
    );
    this.length.addEventListener('change', () =>
      this.game()?.send({ t: 'settings', seconds: Number(this.length.value) }),
    );
    $('#ready').addEventListener('click', () => {
      const g = this.game();
      const me = g?.lobby.players.find((p) => p.id === g.myId);
      if (g && me) g.send({ t: 'ready', ready: !me.ready });
    });
    $('#start').addEventListener('click', () => this.game()?.send({ t: 'start' }));
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
    const key = JSON.stringify([g.lobby, g.myId, g.roomCode, this.solo()]);
    if (key === this.shown) return;
    this.shown = key;
    this.el.classList.toggle('host', g.isHost);
    this.el.querySelector('.code')!.textContent = g.roomCode;
    const copy = this.el.querySelector<HTMLElement>('.copy')!;
    copy.textContent = 'Copy link';
    // A solo room lives in this tab, so a link to it would lead nowhere.
    copy.hidden = this.solo();
    this.el.querySelector('.players')!.innerHTML = g.lobby.players
      .map((p) => {
        const tags = [
          p.id === g.lobby.host ? 'host' : '',
          !p.connected ? 'reconnecting…' : p.ready ? '✔ ready' : 'not ready',
        ].filter(Boolean);
        const colour = `#${p.colour.toString(16).padStart(6, '0')}`;
        return `<li class="${p.connected ? '' : 'away'}"><span class="dot" style="background:${colour}"></span>
          ${esc(p.name)}${p.id === g.myId ? ' (you)' : ''}
          <span class="hat">${esc(`${hatName(p.hat)} · ${faceName(p.face)} · ${shirtName(p.shirt)}`.toLowerCase())}</span>
          <span class="tag ${p.ready ? 'ready' : ''}">${tags.join(' · ')}</span></li>`;
      })
      .join('');
    this.length.value = String(g.lobby.seconds);
    this.saboteurs.value = String(g.lobby.saboteurs);
    this.build.value = g.lobby.build;
    this.time.value = g.lobby.time;
    const sabs = g.lobby.saboteurs < 0 ? 'usual number of' : String(g.lobby.saboteurs);
    const build = buildById(g.lobby.build)?.name ?? 'a surprise';
    this.el.querySelector('.length-note')!.textContent =
      `Build: ${build} · Round length: ${minutes(g.lobby.seconds)} · ${sabs} saboteurs · ` +
      `${TIME_LABELS[g.lobby.time].toLowerCase()}`;
    const me = g.lobby.players.find((p) => p.id === g.myId);
    if (me) this.look.value = { hat: me.hat, face: me.face, shirt: me.shirt };
    $('#ready').textContent = me?.ready ? 'Not ready' : "I'm ready";
    const everyone = g.lobby.players.filter((p) => p.connected);
    const allReady = everyone.every((p) => p.ready || p.id === g.myId);
    const start = $<HTMLButtonElement>('#start');
    start.textContent = allReady ? 'Start round' : 'Start anyway';
  }
}
