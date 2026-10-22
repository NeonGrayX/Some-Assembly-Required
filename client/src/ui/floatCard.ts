/**
 * A card that floats over the game like a window: it drags by its title bar, resizes from any
 * edge or corner, and holds small cards (tiles) in one column or two, as its width allows. Each
 * tile drags by its header to another place in either column. Where the card is, its size and
 * the tiles' order are remembered.
 */

/** Kept clear between the card and the window's edges. */
const EDGE = 8;
/** How much of the card stays on screen when it is dragged towards an edge: its title bar. */
const GRIP = 40;
/** The narrowest a column of tiles gets before the card falls back to one column. */
const COLUMN = 250;
/** Between the two columns. */
const GAP = 16;
/** Wide enough for two columns of tiles, with room to spare for the card's padding and scroll bar. */
const WIDE = 600;
const MIN_W = COLUMN + 40;
const MIN_H = 120;
/** How far a tile's header moves under the pointer before it lifts: less is a click. */
const LIFT = 5;

/**
 * Where the card sits, measured from the window's nearer edges, so it grows away from them: a card
 * dragged to the bottom right opens its tiles upwards.
 */
interface Spot {
  h: 'left' | 'right';
  x: number;
  v: 'top' | 'bottom';
  y: number;
}

interface Layout {
  /** Null until the card is first dragged: it sits where the page's styles put it. */
  spot: Spot | null;
  /** Null until the card is first resized: as wide as two columns, as tall as its tiles. */
  size: { w: number; h: number } | null;
  /** The tiles' ids, column by column, as last arranged; null for the order they were added. */
  cols: string[][] | null;
}

const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

export class FloatCard {
  readonly el: HTMLElement;
  private readonly scroll: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly cols: [HTMLElement, HTMLElement];
  private readonly tiles = new Map<string, HTMLElement>();
  private layout: Layout = { spot: null, size: null, cols: null };

  constructor(
    id: string,
    title: string,
    /** Where the layout is kept in local storage. */
    private readonly store: string,
    onClose: () => void,
    /** Called when the columns change width, so what is drawn to fit them can be drawn again. */
    private readonly onResize: () => void,
  ) {
    this.load();
    this.el = document.createElement('div');
    this.el.id = id;
    this.el.hidden = true;

    const bar = document.createElement('div');
    bar.className = 'perf-bar';
    bar.title = 'Drag to move, drag an edge to resize. Double-click to put it back.';
    const name = document.createElement('strong');
    name.textContent = title;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'perf-close';
    close.textContent = '×';
    close.title = 'Close';
    close.setAttribute('aria-label', `Close ${title.toLowerCase()}`);
    close.addEventListener('click', onClose);
    bar.append(name, close);
    this.drags(bar, (r, dx, dy) => this.moveTo(r.left + dx, r.top + dy, r));
    bar.addEventListener('dblclick', (e) => {
      if ((e.target as Element).closest('button')) return;
      this.layout.spot = this.layout.size = null;
      this.place();
      this.save();
    });

    this.scroll = document.createElement('div');
    this.scroll.className = 'perf-scroll';
    this.grid = document.createElement('div');
    this.grid.className = 'perf-cols';
    this.cols = [document.createElement('div'), document.createElement('div')];
    for (const col of this.cols) col.className = 'perf-col';
    this.grid.append(...this.cols);
    this.scroll.append(this.grid);
    this.el.append(bar, this.scroll);

    for (const edge of EDGES) {
      const handle = document.createElement('div');
      handle.className = `perf-edge perf-edge-${edge}`;
      this.el.append(handle);
      this.drags(handle, (r, dx, dy) => this.resize(edge, r, dx, dy));
    }

    // Two columns once there is room for them; the tiles' graphs widen to fill either way.
    let width = 0;
    new ResizeObserver(() => {
      const w = this.grid.clientWidth;
      if (w === width) return;
      width = w;
      this.grid.classList.toggle('two', w >= 2 * COLUMN + GAP);
      this.onResize();
    }).observe(this.grid);
    window.addEventListener('resize', () => this.place());
    // A tile opened can push the card past the window's edge.
    new ResizeObserver(() => this.place()).observe(this.el);
    this.place();
  }

  /** Adds a tile to the end of a column; `handle` (its header) drags it to another place. */
  dock(id: string, tile: HTMLElement, handle: HTMLElement, col: 0 | 1): void {
    tile.classList.add('perf-tile');
    tile.dataset.tile = id;
    const grip = document.createElement('span');
    grip.className = 'perf-grip';
    grip.title = 'Drag to rearrange';
    handle.prepend(grip);
    this.tiles.set(id, tile);
    this.cols[col].append(tile);
    this.tileDrags(tile, handle, grip);
  }

  /** Puts the tiles in the order they were last left in; call once they are all docked. */
  arrange(): void {
    const saved = this.layout.cols;
    if (!saved) return;
    const placed = new Set<string>();
    const order = this.cols.map((col, c) => {
      const ids = (saved[c] ?? []).filter((id) => this.tiles.has(id) && !placed.has(id));
      for (const id of ids) placed.add(id);
      return ids;
    });
    // Tiles added since stay in the column they were added to, after the rest.
    this.cols.forEach((col, c) => {
      for (const el of col.children) {
        const id = (el as HTMLElement).dataset.tile;
        if (id && !placed.has(id)) order[c]!.push(id);
      }
    });
    order.forEach((ids, c) => this.cols[c]!.append(...ids.map((id) => this.tiles.get(id)!)));
  }

  private load(): void {
    try {
      const saved = JSON.parse(
        localStorage.getItem(this.store) ?? 'null',
      ) as Partial<Layout> | null;
      const spot = saved?.spot;
      if (
        spot &&
        (spot.h === 'left' || spot.h === 'right') &&
        (spot.v === 'top' || spot.v === 'bottom') &&
        Number.isFinite(spot.x) &&
        Number.isFinite(spot.y)
      )
        this.layout.spot = spot;
      const size = saved?.size;
      if (size && Number.isFinite(size.w) && Number.isFinite(size.h)) this.layout.size = size;
      const cols = saved?.cols;
      if (Array.isArray(cols) && cols.every((c) => Array.isArray(c))) {
        this.layout.cols = cols.map((c) => c.filter((id): id is string => typeof id === 'string'));
      }
    } catch {
      // Private browsing or blocked storage: the card starts where it always did.
    }
  }

  private save(): void {
    this.layout.cols = this.cols.map((col) =>
      [...col.children].flatMap((el) => (el as HTMLElement).dataset.tile ?? []),
    );
    try {
      localStorage.setItem(this.store, JSON.stringify(this.layout));
    } catch {
      // Not remembered, that is all.
    }
  }

  /**
   * Calls `move` with the card's rectangle when the drag began and how far the pointer has gone,
   * for a drag that starts on `el`; the layout is saved when it ends.
   */
  private drags(el: HTMLElement, move: (r: DOMRect, dx: number, dy: number) => void): void {
    let grab: { id: number; x: number; y: number; r: DOMRect } | null = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as Element).closest('button')) return;
      grab = { id: e.pointerId, x: e.clientX, y: e.clientY, r: this.el.getBoundingClientRect() };
      el.setPointerCapture(e.pointerId);
      this.el.classList.add('moving');
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (grab && e.pointerId === grab.id) move(grab.r, e.clientX - grab.x, e.clientY - grab.y);
    });
    const drop = (e: PointerEvent) => {
      if (!grab || e.pointerId !== grab.id) return;
      grab = null;
      this.el.classList.remove('moving');
      this.save();
    };
    el.addEventListener('pointerup', drop);
    el.addEventListener('pointercancel', drop);
  }

  private moveTo(left: number, top: number, r: DOMRect): void {
    const { innerWidth: W, innerHeight: H } = window;
    left = clamp(left, EDGE, W - r.width - EDGE);
    top = clamp(top, EDGE, H - GRIP);
    this.layout.spot = this.spot(left, top, r.width, r.height);
    this.place();
  }

  private resize(edge: string, r: DOMRect, dx: number, dy: number): void {
    const { innerWidth: W, innerHeight: H } = window;
    let { left, top, right, bottom } = r;
    if (edge.includes('e')) right = clamp(r.right + dx, left + MIN_W, W - EDGE);
    if (edge.includes('w')) left = clamp(r.left + dx, EDGE, right - MIN_W);
    if (edge.includes('s')) bottom = clamp(r.bottom + dy, top + MIN_H, H - EDGE);
    if (edge.includes('n')) top = clamp(r.top + dy, EDGE, bottom - MIN_H);
    const w = right - left;
    const h = bottom - top;
    this.layout.size = { w, h };
    this.layout.spot = this.spot(left, top, w, h);
    this.place();
  }

  /** The spot for a card at this rectangle, measured from the nearer edges. */
  private spot(left: number, top: number, w: number, h: number): Spot {
    const { innerWidth: W, innerHeight: H } = window;
    const right = left + w / 2 > W / 2;
    const bottom = top + h / 2 > H / 2;
    return {
      h: right ? 'right' : 'left',
      x: right ? W - left - w : left,
      v: bottom ? 'bottom' : 'top',
      y: bottom ? H - top - h : top,
    };
  }

  /** Puts the card where it was dragged, at the size it was left, on screen with its bar in reach. */
  private place(): void {
    const s = this.el.style;
    const { innerWidth: W, innerHeight: H } = window;
    const { spot, size } = this.layout;
    const w = Math.max(Math.min(MIN_W, W - 2 * EDGE), Math.min(size?.w ?? WIDE, W - 2 * EDGE));
    s.width = `${w}px`;
    s.height = size ? `${Math.min(size.h, H - 2 * EDGE)}px` : '';
    if (!spot) {
      s.left = s.right = s.top = s.bottom = s.maxHeight = '';
      // Where the page puts it can be past the right edge of a narrow window, as on a phone.
      const r = this.el.getBoundingClientRect();
      if (r.right > W) s.left = `${Math.max(0, W - r.width - EDGE)}px`;
      return;
    }
    const x = clamp(spot.x, 0, W - w - EDGE);
    s.left = spot.h === 'left' ? `${x}px` : 'auto';
    s.right = spot.h === 'right' ? `${x}px` : 'auto';
    const y = clamp(spot.y, 0, H - GRIP);
    s.top = spot.v === 'top' ? `${y}px` : 'auto';
    s.bottom = spot.v === 'bottom' ? `${y}px` : 'auto';
    s.maxHeight = `${H - y - EDGE}px`;
  }

  /**
   * A tile lifts once its header is dragged a little way (at once from its grip, which a finger
   * needs: dragging a header by touch scrolls), follows the pointer, and drops where the gap
   * opens for it.
   */
  private tileDrags(tile: HTMLElement, handle: HTMLElement, grip: HTMLElement): void {
    let press: { id: number; x: number; y: number } | null = null;
    let lift: { dx: number; dy: number; slot: HTMLElement } | null = null;
    let moved = false;

    const start = (e: PointerEvent) => {
      const r = tile.getBoundingClientRect();
      const from = press ?? { x: e.clientX, y: e.clientY };
      const slot = document.createElement('div');
      slot.className = 'perf-slot';
      slot.style.height = `${r.height}px`;
      tile.before(slot);
      tile.classList.add('lifted');
      tile.style.width = `${r.width}px`;
      // Held where it was pressed, not where the pointer had got to when it lifted.
      lift = { dx: from.x - r.left, dy: from.y - r.top, slot };
      this.grid.classList.add('docking');
      follow(e);
    };

    const follow = (e: PointerEvent) => {
      if (!lift) return;
      tile.style.left = `${e.clientX - lift.dx}px`;
      tile.style.top = `${e.clientY - lift.dy}px`;
      // The column under the pointer, or the nearest: side by side, or one above the other.
      let col = this.cols[0];
      let best = Infinity;
      for (const c of this.cols) {
        const r = c.getBoundingClientRect();
        const d =
          Math.max(r.left - e.clientX, 0, e.clientX - r.right) +
          Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
        if (d < best) [col, best] = [c, d];
      }
      const before = [...col.children].find((el) => {
        if (el === tile || el === lift!.slot || (el as HTMLElement).hidden) return false;
        const r = el.getBoundingClientRect();
        return e.clientY < r.top + r.height / 2;
      });
      if (before) {
        if (lift.slot.nextElementSibling !== before) before.before(lift.slot);
      } else if (col.lastElementChild !== lift.slot) {
        col.append(lift.slot);
      }
      // Near the top or bottom of the card, its tiles scroll.
      const s = this.scroll.getBoundingClientRect();
      if (e.clientY < s.top + 24) this.scroll.scrollTop -= 12;
      else if (e.clientY > s.bottom - 24) this.scroll.scrollTop += 12;
    };

    handle.addEventListener('pointerdown', (e) => {
      const onGrip = e.target === grip;
      if (e.button !== 0 || (e.pointerType === 'touch' && !onGrip)) return;
      press = { id: e.pointerId, x: e.clientX, y: e.clientY };
      moved = false;
      handle.setPointerCapture(e.pointerId);
      if (onGrip) {
        e.preventDefault();
        start(e);
      }
    });
    handle.addEventListener('pointermove', (e) => {
      if (!press || e.pointerId !== press.id) return;
      if (!lift && Math.hypot(e.clientX - press.x, e.clientY - press.y) > LIFT) start(e);
      if (lift) {
        moved = true;
        follow(e);
      }
    });
    const drop = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.id) return;
      press = null;
      if (!lift) return;
      lift.slot.replaceWith(tile);
      tile.classList.remove('lifted');
      tile.style.left = tile.style.top = tile.style.width = '';
      this.grid.classList.remove('docking');
      lift = null;
      this.save();
      this.onResize();
    };
    handle.addEventListener('pointerup', drop);
    handle.addEventListener('pointercancel', drop);
    // A drag is not a click: the tile stays open or shut as it was.
    handle.addEventListener('click', (e) => {
      if (moved) e.preventDefault();
      moved = false;
    });
  }
}
