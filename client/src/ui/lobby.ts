import {
  BUILDS,
  RANDOM_BUILD,
  ROUND_LENGTHS,
  SABOTEUR_SETTINGS,
  TIMES_OF_DAY,
  buildById,
} from '@sar/shared';
import type { TimeOfDay } from '@sar/shared';
import type { ClientGame } from '../net/game.ts';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const minutes = (s: number) => `${s / 60} minutes`;
const TIME_LABELS: Record<TimeOfDay, string> = {
  day: 'Day',
  night: 'Night',
  random: 'Random each round',
};

/** The start menu: name, create or join a room, or play solo. */
export class Menu {
  private readonly el = $('#menu');
  private readonly name = $<HTMLInputElement>('#name');
  private readonly code = $<HTMLInputElement>('#code');
  private readonly error = $('#menu-error');

  constructor(handlers: {
    create: (name: string) => void;
    join: (name: string, code: string) => void;
    solo: (name: string) => void;
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
    $('#create').addEventListener('click', () => handlers.create(name()));
    $('#join').addEventListener('click', () => {
      const code = this.code.value.trim().toUpperCase();
      if (!/^[A-Z]{4}$/.test(code)) return this.showError('Room codes are four letters.');
      handlers.join(name(), code);
    });
    this.code.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#join').click();
    });
    $('#solo').addEventListener('click', () => handlers.solo(name()));
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

/** The lobby panel: who is here, who is ready, and (for the host) settings and Start. */
export class LobbyPanel {
  private readonly el = $('#lobby');
  private readonly length = $<HTMLSelectElement>('#length');
  private readonly saboteurs = $<HTMLSelectElement>('#saboteurs');
  private readonly build = $<HTMLSelectElement>('#build');
  private readonly time = $<HTMLSelectElement>('#time');
  private shown = '';

  constructor(private readonly game: () => ClientGame | null) {
    for (const s of ROUND_LENGTHS) this.length.add(new Option(minutes(s), String(s)));
    for (const n of SABOTEUR_SETTINGS) {
      const label = n < 0 ? 'Usual for the group size' : n === 0 ? 'None (co-op)' : String(n);
      this.saboteurs.add(new Option(label, String(n)));
    }
    this.build.add(new Option('Surprise me (random)', RANDOM_BUILD));
    for (const b of BUILDS) this.build.add(new Option(b.name, b.id));
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
    const key = JSON.stringify([g.lobby, g.myId, g.roomCode]);
    if (key === this.shown) return;
    this.shown = key;
    this.el.classList.toggle('host', g.isHost);
    this.el.querySelector('.code')!.textContent = g.roomCode;
    this.el.querySelector('.copy')!.textContent = 'Copy link';
    this.el.querySelector('.players')!.innerHTML = g.lobby.players
      .map((p) => {
        const tags = [
          p.id === g.lobby.host ? 'host' : '',
          !p.connected ? 'reconnecting…' : p.ready ? '✔ ready' : 'not ready',
        ].filter(Boolean);
        const colour = `#${p.colour.toString(16).padStart(6, '0')}`;
        return `<li class="${p.connected ? '' : 'away'}"><span class="dot" style="background:${colour}"></span>
          ${esc(p.name)}${p.id === g.myId ? ' (you)' : ''}
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
    $('#ready').textContent = me?.ready ? 'Not ready' : "I'm ready";
    const everyone = g.lobby.players.filter((p) => p.connected);
    const allReady = everyone.every((p) => p.ready || p.id === g.myId);
    const start = $<HTMLButtonElement>('#start');
    start.textContent = allReady ? 'Start round' : 'Start anyway';
  }
}
