import { GAME_MODES, MAPS } from '@sar/shared';
import type { GameMode, MapId, RoomListing } from '@sar/shared';

/** The game modes as the room list names them. */
export const MODE_TITLES: Record<GameMode, string> = {
  saboteur: 'Saboteur',
  gear: 'Gear hunt',
  coop: 'Plain co-op',
  free: 'Free build',
  blind: 'Blind build',
  rival: 'Rival teams',
};
/** How often the list is asked for again while it is open. */
const REFRESH_MS = 5000;

export interface RoomFilter {
  /** Matched against the host's name and the room code, ignoring case. */
  search: string;
  map: MapId | null;
  mode: GameMode | null;
}

/** Whether a room passes the filters the player picked. */
export function roomShown(room: RoomListing, f: RoomFilter): boolean {
  if (f.map && room.map !== f.map) return false;
  if (f.mode && room.mode !== f.mode) return false;
  const q = f.search.trim().toLowerCase();
  return !q || room.host.toLowerCase().includes(q) || room.code.toLowerCase().includes(q);
}

/** The room list's answer, kept to well-formed rooms (it comes from the network). */
export function parseListing(json: unknown): RoomListing[] {
  const rooms = (json as { rooms?: unknown } | null)?.rooms;
  if (!Array.isArray(rooms)) return [];
  return rooms.filter(
    (r): r is RoomListing =>
      !!r &&
      typeof r === 'object' &&
      typeof r.code === 'string' &&
      /^[A-Z]{4}$/.test(r.code) &&
      typeof r.host === 'string' &&
      typeof r.players === 'number' &&
      typeof r.max === 'number',
  );
}

/**
 * The room list, the menu's page for playing together: the open rooms (private ones are never
 * listed), filtered by map, game mode and a search, a Join on each, and Create a room.
 */
export class RoomBrowser {
  private readonly list: HTMLUListElement;
  private readonly status: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly map: HTMLSelectElement;
  private readonly mode: HTMLSelectElement;
  private readonly hidden: HTMLInputElement;
  private rooms: RoomListing[] = [];
  /** Null until the first answer; a message when the last request failed. */
  private problem: string | null = null;
  private loaded = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private asking = false;
  /** What the list shows now, so a refresh that changes nothing leaves the rows alone. */
  private shown = '';

  constructor(
    private readonly el: HTMLElement,
    handlers: { join: (code: string) => void; create: (hidden: boolean) => void },
  ) {
    const q = <T extends HTMLElement>(sel: string) => el.querySelector(sel) as T;
    this.list = q('.room-list');
    this.status = q('.room-status');
    this.search = q('#room-search');
    this.map = q('#room-map');
    this.mode = q('#room-mode');
    this.hidden = q('#create-private');
    this.map.add(new Option('All maps', ''));
    for (const m of MAPS) this.map.add(new Option(m.name, m.id));
    this.mode.add(new Option('All modes', ''));
    for (const m of GAME_MODES) this.mode.add(new Option(MODE_TITLES[m], m));
    // Filters are remembered for next time, like the name.
    try {
      const saved = JSON.parse(localStorage.getItem('sar.roomFilter') ?? '{}') as Partial<
        Record<'map' | 'mode', string>
      >;
      this.map.value = saved.map ?? '';
      this.mode.value = saved.mode ?? '';
      // A map or mode that is gone leaves no option picked: back to all.
      if (this.map.selectedIndex < 0) this.map.value = '';
      if (this.mode.selectedIndex < 0) this.mode.value = '';
    } catch {
      // Storage can be blocked, or hold something old; all rooms are shown then.
    }
    const changed = () => {
      try {
        localStorage.setItem(
          'sar.roomFilter',
          JSON.stringify({ map: this.map.value, mode: this.mode.value }),
        );
      } catch {
        // See above.
      }
      this.render();
    };
    this.map.addEventListener('change', changed);
    this.mode.addEventListener('change', changed);
    this.search.addEventListener('input', () => this.render());
    q('.refresh').addEventListener('click', () => void this.refresh());
    q('#create').addEventListener('click', () => handlers.create(this.hidden.checked));
    this.list.addEventListener('click', (e) => {
      const code = (e.target as HTMLElement).closest<HTMLElement>('[data-code]')?.dataset.code;
      if (code) handlers.join(code);
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.timer) void this.refresh();
    });
  }

  /** Starts showing the list, kept fresh while it is open. */
  open(): void {
    this.search.focus();
    void this.refresh();
    this.timer ??= setInterval(() => {
      if (!document.hidden) void this.refresh();
    }, REFRESH_MS);
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private filter(): RoomFilter {
    return {
      search: this.search.value,
      map: (this.map.value || null) as MapId | null,
      mode: (this.mode.value || null) as GameMode | null,
    };
  }

  async refresh(): Promise<void> {
    if (this.asking) return;
    this.asking = true;
    try {
      const res = await fetch('/rooms.json', { cache: 'no-store' });
      if (res.status === 429) {
        // Asked too often: the list shown stays, and the next refresh tries again.
        this.problem = 'The list is taking a breather. It refreshes again in a moment.';
      } else if (!res.ok) {
        throw new Error(String(res.status));
      } else {
        this.rooms = parseListing(await res.json());
        this.problem = null;
        this.loaded = true;
      }
    } catch {
      this.problem = 'Could not reach the server for the room list.';
    } finally {
      this.asking = false;
    }
    this.render();
  }

  private render(): void {
    const f = this.filter();
    const shown = this.rooms.filter((r) => roomShown(r, f));
    // Rebuilt only when something changed, so a refresh never pulls a button from under a click.
    const key = JSON.stringify(shown);
    if (key !== this.shown) {
      this.shown = key;
      this.list.replaceChildren(...shown.map((r) => roomRow(r)));
    }
    const filtered = !!(f.search.trim() || f.map || f.mode);
    this.status.textContent =
      this.problem ??
      (!this.loaded
        ? 'Looking for rooms…'
        : !this.rooms.length
          ? 'No open rooms right now. Create one, and friends can join from here.'
          : !shown.length
            ? 'No rooms match. Try other filters, or create a room.'
            : filtered
              ? `${shown.length} of ${this.rooms.length} open rooms`
              : `${shown.length} open room${shown.length === 1 ? '' : 's'}`);
  }
}

function roomRow(r: RoomListing): HTMLLIElement {
  const li = document.createElement('li');
  const full = r.players >= r.max;
  li.className = full ? 'full' : '';
  const span = (cls: string, text: string) => {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  };
  const title = document.createElement('div');
  title.className = 'title';
  title.append(span('host', `${r.host || 'Someone'}'s room`), span('room-code', r.code));
  const map = MAPS.find((m) => m.id === r.map)?.name ?? r.map;
  const mode = MODE_TITLES[r.mode] ?? r.mode;
  const join = document.createElement('button');
  join.type = 'button';
  join.className = 'btn';
  join.textContent = full ? 'Full' : 'Join';
  join.disabled = full;
  if (!full) join.dataset.code = r.code;
  join.setAttribute('aria-label', full ? `${r.code} is full` : `Join room ${r.code}`);
  li.append(
    title,
    span('about', `${map} · ${mode}`),
    span(
      'state',
      `${r.players}/${r.max} players · ${r.playing ? 'round under way' : 'in the lobby'}`,
    ),
    join,
  );
  return li;
}
