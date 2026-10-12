import { COLOURS, PRINT_SIDES, shapeName } from '@sar/shared';
import type { Action, BrickTypeId, ColourId, PrintJob } from '@sar/shared';
import { freeMouse } from '../input.ts';
import { drawnHex } from '../render/bricks.ts';
import {
  BRICK_KINDS,
  COLOUR_GROUPS,
  HEIGHTS,
  allSizes,
  brickShown,
  colourShown,
  loadFavourites,
} from './brickFinder.ts';
import type { BrickFilter, ColourFilter, Height } from './brickFinder.ts';
import { brickThumb } from './brickThumbs.ts';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = '',
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text) e.textContent = text;
  return e;
}

const SEARCH_ICON =
  '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" />' +
  '<path d="m20 20-3.5-3.5" /></svg>';

/** What a mould looks like in the list: the part it makes, in plain steel grey. */
const MOULD_COLOUR: ColourId = 'light-grey';

/** One choice in the list, and whether the filters let it through. */
interface Item {
  button: HTMLButtonElement;
  shown: () => boolean;
}

/**
 * The brick works' choices that are too many for clicks in the world: which colour of pellets
 * the silo fills a bucket with, which mould the dispenser hands out, and which picture the UV
 * printer prints on the part on its bed. A dialog of big buttons, so a finger picks as easily as
 * the mouse, with a search and filters (as in the build editor) for the long lists; picking
 * queues the action and goes back into the game, Esc or Cancel just goes back.
 */
export class MachinePicker {
  private readonly root = document.getElementById('picker')!;
  private readonly title = this.root.querySelector('h2')!;
  private readonly sub = this.root.querySelector<HTMLElement>('.sub')!;
  private readonly finder = this.root.querySelector<HTMLElement>('.finder')!;
  private readonly choices = this.root.querySelector<HTMLElement>('.choices')!;
  private readonly none = this.root.querySelector<HTMLElement>('.none')!;
  private items: Item[] = [];
  /** Draws the pictures of the choices now shown, a few a frame (null: none to draw). */
  private drawing: number | null = null;

  constructor(
    private readonly act: (a: Action) => void,
    private readonly relock: () => void,
    private readonly touch: () => boolean,
  ) {
    this.root.querySelector('.cancel')!.addEventListener('click', () => this.close(true));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close(true);
    });
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /**
   * The silo's colours, to search and narrow down by kind (solid, see-through, metallic) or to
   * your favourites from the build editor. Without the colour goggles (a gear hunt) the swatches
   * are all the one grey and go by number, as the bricks do, and there is nothing to narrow
   * them by but the number.
   */
  openColours(colours: ColourId[], colourBlind: boolean): void {
    this.show(
      'Pellet silo',
      'Pick a colour: your bucket fills with its pellets. Pour them into a moulding machine.',
    );
    const favourites = loadFavourites().colours;
    const filter: ColourFilter = { query: '', group: null, favouritesOnly: false };
    this.search(
      colourBlind ? 'Search: a number' : 'Search: red, dark, trans…',
      'Search colours',
      (q) => {
        filter.query = q;
      },
    );
    if (!colourBlind) {
      this.chips(COLOUR_GROUPS, favourites.size > 0, 'Kind of colour', (favouritesOnly, group) => {
        filter.favouritesOnly = favouritesOnly;
        filter.group = group;
      });
    }
    colours.forEach((colour, i) => {
      const name = colourBlind ? `Pellets ${i + 1}` : colour.replaceAll('-', ' ');
      const swatch = el('span', 'swatch');
      swatch.style.background = `#${drawnHex(colour).toString(16).padStart(6, '0')}`;
      if (COLOURS[colour].alpha && !colourBlind) swatch.classList.add('clear');
      this.choice([swatch, el('span', 'name', name)], name, { kind: 'fill', colour }, () =>
        colourBlind
          ? !filter.query.trim() || name.toLowerCase().includes(filter.query.trim().toLowerCase())
          : colourShown(colour, filter, favourites),
      );
    });
    this.empty('No colours match.');
    this.refresh();
  }

  /**
   * The dispenser's moulds, one for every part, each pictured, to search by name, size or part
   * number and narrow down by kind, size and height, or to your favourites from the build editor.
   */
  openMoulds(types: BrickTypeId[]): void {
    this.show('Mould dispenser', 'Pick a mould: put it in a moulding machine to make that part.');
    const favourites = loadFavourites().bricks;
    const filter: BrickFilter = {
      query: '',
      kind: null,
      size: null,
      height: null,
      favouritesOnly: false,
    };
    this.search('Search: 2x4, slope, 3001…', 'Search moulds', (q) => {
      filter.query = q;
    });
    this.chips(BRICK_KINDS, favourites.size > 0, 'Kind of part', (favouritesOnly, kind) => {
      filter.favouritesOnly = favouritesOnly;
      filter.kind = kind;
    });
    const pair = el('div', 'pair');
    pair.append(
      this.select(
        'Any size',
        'Size',
        allSizes(types).map((s) => [s, s] as const),
        (v) => {
          filter.size = v;
        },
      ),
      this.select(
        'Any height',
        'Height',
        HEIGHTS.map((h) => [h.id, h.label] as const),
        (v) => {
          filter.height = v as Height | null;
        },
      ),
    );
    this.finder.append(pair);
    for (const type of types) {
      const name = shapeName(type);
      const img = document.createElement('img');
      img.alt = '';
      img.className = 'thumb';
      img.dataset.type = type;
      this.choice([img, el('span', 'name', name)], `${name} mould`, { kind: 'mould', type }, () =>
        brickShown(type, name, filter, favourites),
      );
    }
    this.empty('No moulds match.');
    this.refresh();
  }

  /**
   * The UV printer's pictures for the part on its bed: the printed parts of this round's model
   * of the same type, each with its pictures side by side; or take the part out as it is.
   */
  openPrints(
    type: BrickTypeId,
    jobs: { job: PrintJob; index: number }[],
    svgs: Record<string, string>,
  ): void {
    const part = shapeName(type);
    this.show(
      'UV printer',
      jobs.length
        ? `Pick a print for the ${part} on the bed. It prints, then comes out into your hands.`
        : `Nothing in this model is printed on a ${part}. Take it out as it is.`,
    );
    for (const { job, index } of jobs) {
      const parts: HTMLElement[] = [];
      for (const side of PRINT_SIDES) {
        const name = job.prints[side];
        const svg = name ? svgs[name] : undefined;
        if (!name || !svg) continue;
        const figure = el('span', 'print');
        const img = document.createElement('img');
        img.alt = name;
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        figure.append(img, el('span', 'side', side));
        parts.push(figure);
      }
      const label = `Print ${PRINT_SIDES.filter((s) => job.prints[s])
        .map((s) => `${job.prints[s]} on the ${s}`)
        .join(', ')}`;
      this.choice(parts, label, { kind: 'print', job: index });
    }
    const out = this.choice(
      [el('span', 'name', 'Take it out unprinted')],
      'Take it out unprinted',
      { kind: 'print', job: -1 },
    );
    out.classList.add('wide');
    this.refresh();
  }

  close(relock: boolean): void {
    if (!this.isOpen) return;
    this.root.classList.add('hidden');
    this.clear();
    if (relock) this.relock();
  }

  private clear(): void {
    if (this.drawing !== null) cancelAnimationFrame(this.drawing);
    this.drawing = null;
    this.items = [];
    this.finder.replaceChildren();
    this.choices.replaceChildren();
    this.none.hidden = true;
  }

  private show(title: string, sub: string): void {
    freeMouse();
    this.clear();
    this.title.textContent = title;
    this.sub.textContent = sub;
    this.root.classList.remove('hidden');
    this.choices.scrollTop = 0;
  }

  /** The search box: narrows the list as you type; Enter picks the first choice left. */
  private search(placeholder: string, label: string, onChange: (q: string) => void): void {
    const field = el('label', 'field search');
    field.innerHTML = SEARCH_ICON;
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = placeholder;
    input.setAttribute('aria-label', label);
    input.addEventListener('input', () => {
      onChange(input.value);
      this.refresh();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      this.items.find((i) => !i.button.hidden)?.button.click();
    });
    field.append(input);
    this.finder.append(field);
    // Straight into typing with a keyboard; on a touch screen the keyboard waits for a tap.
    if (!this.touch()) requestAnimationFrame(() => input.focus());
  }

  /**
   * A row of toggle chips, as in the build editor: Favourites first (when there are any), on
   * its own; the others pick one of `options` (pressing the one that is on again turns it off).
   */
  private chips<K extends string>(
    options: { id: K; label: string }[],
    withFavourites: boolean,
    label: string,
    onChange: (favouritesOnly: boolean, picked: K | null) => void,
  ): void {
    const row = el('div', 'chips');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', label);
    let favouritesOnly = false;
    let picked: K | null = null;
    const chip = (text: string, title?: string) => {
      const b = el('button', 'chip', text);
      b.type = 'button';
      b.setAttribute('aria-pressed', 'false');
      if (title) {
        b.title = title;
        b.setAttribute('aria-label', title);
      }
      row.append(b);
      return b;
    };
    const fav = withFavourites ? chip('★', 'Favourites only') : null;
    const all = options.map((o) => ({ id: o.id, b: chip(o.label) }));
    const update = () => {
      fav?.setAttribute('aria-pressed', String(favouritesOnly));
      for (const c of all) c.b.setAttribute('aria-pressed', String(c.id === picked));
      onChange(favouritesOnly, picked);
      this.refresh();
    };
    fav?.addEventListener('click', () => {
      favouritesOnly = !favouritesOnly;
      update();
    });
    for (const c of all) {
      c.b.addEventListener('click', () => {
        picked = picked === c.id ? null : c.id;
        update();
      });
    }
    this.finder.append(row);
  }

  private select(
    any: string,
    label: string,
    options: readonly (readonly [string, string])[],
    onChange: (value: string | null) => void,
  ): HTMLElement {
    const wrap = el('span', 'field select');
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', label);
    sel.add(new Option(any, ''));
    for (const [value, text] of options) sel.add(new Option(text, value));
    sel.addEventListener('change', () => {
      onChange(sel.value || null);
      this.refresh();
    });
    wrap.append(sel);
    return wrap;
  }

  private empty(text: string): void {
    this.none.textContent = text;
  }

  private choice(
    content: HTMLElement[],
    label: string,
    action: Action,
    shown: () => boolean = () => true,
  ): HTMLButtonElement {
    const button = el('button', 'btn choice');
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.append(...content);
    button.addEventListener('click', () => {
      this.act(action);
      this.close(true);
    });
    this.choices.append(button);
    this.items.push({ button, shown });
    return button;
  }

  /** Shows the choices the search and filters let through, and draws their pictures. */
  private refresh(): void {
    let any = false;
    for (const item of this.items) {
      item.button.hidden = !item.shown();
      any ||= !item.button.hidden;
    }
    this.none.hidden = any;
    this.drawThumbs();
  }

  /** The pictures of the moulds now shown, a handful a frame so the list opens at once. */
  private drawThumbs(): void {
    if (this.drawing !== null) cancelAnimationFrame(this.drawing);
    const todo = this.items
      .map((i) => i.button.querySelector<HTMLImageElement>('img.thumb'))
      .filter((img): img is HTMLImageElement => !!img && !img.closest('[hidden]') && !img.src);
    const step = () => {
      this.drawing = null;
      for (const img of todo.splice(0, 12))
        img.src = brickThumb(img.dataset.type as BrickTypeId, MOULD_COLOUR, 96);
      if (todo.length) this.drawing = requestAnimationFrame(step);
    };
    step();
  }
}
