import { BRICK_TYPES, COLOURS } from '@sar/shared';
import type { BrickTypeId, ColourId } from '@sar/shared';
import { brickThumb, clearBrickThumbs } from '../ui/brickThumbs.ts';
import {
  BRICK_KINDS,
  COLOUR_GROUPS,
  HEIGHTS,
  allSizes,
  brickShown,
  catalogueOrder,
  colourShown,
  isHeight,
  loadFavourites,
  saveFavourites,
} from '../ui/brickFinder.ts';
import type { BrickFilter, ColourFilter } from '../ui/brickFinder.ts';
import { brickName } from '../ui/brickViewer.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export const colourName = (c: ColourId) => c.replaceAll('-', ' ');

/** One picture button in a picker list. */
function pickerItem(list: HTMLElement, label: string, onPick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('role', 'option');
  b.title = label;
  b.setAttribute('aria-label', label);
  b.append(document.createElement('img'));
  b.addEventListener('click', onPick);
  list.append(b);
  return b;
}

function markChosen<K>(items: Map<K, HTMLButtonElement>, chosen: K): void {
  for (const [k, b] of items) b.setAttribute('aria-selected', String(k === chosen));
  const b = items.get(chosen);
  if (b && !b.hidden) scrollListTo(b);
}

/**
 * Scrolls the list a picker item is in just far enough to show it. Only the list: the
 * browser's scrollIntoView also scrolls the panel around it (and the sheet it is in on a phone).
 */
function scrollListTo(item: HTMLElement): void {
  const list = item.parentElement!;
  const box = list.getBoundingClientRect();
  const at = item.getBoundingClientRect();
  if (at.top < box.top) list.scrollTop -= box.top - at.top;
  else if (at.bottom > box.bottom) list.scrollTop += at.bottom - box.bottom;
}

function showFavourite(btn: HTMLButtonElement, what: string, on: boolean): void {
  btn.textContent = on ? '★' : '☆';
  btn.setAttribute('aria-pressed', String(on));
  btn.title = on
    ? `Take this ${what} out of your favourites`
    : `Add this ${what} to your favourites`;
  btn.setAttribute('aria-label', btn.title);
}

/**
 * A row of toggle chips: the first is Favourites, on its own; the others pick one of `options`
 * (pressing the one that is on again turns it off).
 */
function chipRow<K extends string>(
  row: HTMLElement,
  options: { id: K; label: string }[],
  onChange: (favouritesOnly: boolean, picked: K | null) => void,
): void {
  let favouritesOnly = false;
  let picked: K | null = null;
  const chip = (label: string, title?: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = label;
    b.setAttribute('aria-pressed', 'false');
    if (title) {
      b.title = title;
      b.setAttribute('aria-label', title);
    }
    row.append(b);
    return b;
  };
  const fav = chip('★', 'Favourites only');
  fav.classList.add('fav-chip');
  const chips = options.map((o) => ({ id: o.id, b: chip(o.label) }));
  const show = () => {
    fav.setAttribute('aria-pressed', String(favouritesOnly));
    for (const c of chips) c.b.setAttribute('aria-pressed', String(c.id === picked));
    onChange(favouritesOnly, picked);
  };
  fav.addEventListener('click', () => {
    favouritesOnly = !favouritesOnly;
    show();
  });
  for (const c of chips) {
    c.b.addEventListener('click', () => {
      picked = picked === c.id ? null : c.id;
      show();
    });
  }
}

/**
 * Shows the items the filter lets through, favourites first, each favourite starred. `none`
 * says so when nothing is left.
 */
function applyFilter<K extends string>(
  items: Map<K, HTMLButtonElement>,
  list: HTMLElement,
  starred: ReadonlySet<string>,
  shown: (k: K) => boolean,
  none: HTMLElement,
): void {
  let any = false;
  const order = [...items.keys()];
  // Favourites first, the rest in catalogue order.
  for (const k of [
    ...order.filter((k) => starred.has(k)),
    ...order.filter((k) => !starred.has(k)),
  ]) {
    const b = items.get(k)!;
    b.hidden = !shown(k);
    b.classList.toggle('starred', starred.has(k));
    any ||= !b.hidden;
    list.append(b);
  }
  none.hidden = any;
  list.hidden = !any;
}

/** The match Enter picks: one named just what was typed, or else the first in the list. */
function bestMatch<K>(items: Map<K, HTMLButtonElement>, query: string): K | undefined {
  const typed = query.trim().toLowerCase().replaceAll('x', '×');
  const shown = [...items].filter(([, b]) => !b.hidden);
  const named = (b: HTMLButtonElement) => b.title.toLowerCase();
  return (shown.find(([, b]) => named(b) === typed) ??
    shown.find(([, b]) => named(b).startsWith(typed)) ??
    shown[0])?.[0];
}

/**
 * The editor's brick and colour pickers: every brick type and every colour, with search,
 * filters and favourites. What is picked is what new bricks are placed as.
 */
export class Pickers {
  /** The brick and colour new bricks are placed in. */
  private chosenType: BrickTypeId = '2x4';
  private chosenColour: ColourId = 'red';
  private readonly typeList = $('ed-types');
  private readonly colourList = $('ed-colours');
  private readonly typeFav = $<HTMLButtonElement>('ed-type-fav');
  private readonly colourFav = $<HTMLButtonElement>('ed-colour-fav');
  private readonly typeItems = new Map<BrickTypeId, HTMLButtonElement>();
  private readonly colourItems = new Map<ColourId, HTMLButtonElement>();
  private readonly favourites = loadFavourites();
  private readonly brickFilter: BrickFilter = {
    query: '',
    kind: null,
    size: null,
    height: null,
    favouritesOnly: false,
  };
  private readonly colourFilter: ColourFilter = { query: '', group: null, favouritesOnly: false };

  constructor(
    /** Called as a different brick type is picked. */
    private readonly typeChanged: () => void,
  ) {
    const { typeItems, colourItems, brickFilter, colourFilter, favourites } = this;
    // Every brick type, drawn in the chosen colour.
    for (const id of catalogueOrder()) {
      if (BRICK_TYPES[id].fixture) continue;
      typeItems.set(
        id,
        pickerItem(this.typeList, brickName(id), () => this.setType(id)),
      );
    }
    // Every colour, as a 2x2 brick in it, so see-through ones look see-through.
    for (const c of Object.values(COLOURS)) {
      colourItems.set(
        c.id,
        pickerItem(this.colourList, colourName(c.id), () => this.setColour(c.id)),
      );
    }

    const typeSearch = $<HTMLInputElement>('ed-type-search');
    const colourSearch = $<HTMLInputElement>('ed-colour-search');
    const sizeSel = $<HTMLSelectElement>('ed-type-size');
    const heightSel = $<HTMLSelectElement>('ed-type-height');
    chipRow($('ed-type-kinds'), BRICK_KINDS, (favouritesOnly, kind) => {
      brickFilter.favouritesOnly = favouritesOnly;
      brickFilter.kind = kind;
      this.filterTypes();
    });
    chipRow($('ed-colour-groups'), COLOUR_GROUPS, (favouritesOnly, group) => {
      colourFilter.favouritesOnly = favouritesOnly;
      colourFilter.group = group;
      this.filterColours();
    });
    for (const s of allSizes([...typeItems.keys()])) sizeSel.add(new Option(s, s));
    for (const h of HEIGHTS) heightSel.add(new Option(h.label, h.id));
    sizeSel.addEventListener('change', () => {
      brickFilter.size = sizeSel.value || null;
      this.filterTypes();
    });
    heightSel.addEventListener('change', () => {
      brickFilter.height = isHeight(heightSel.value) ? heightSel.value : null;
      this.filterTypes();
    });
    typeSearch.addEventListener('input', () => {
      brickFilter.query = typeSearch.value;
      this.filterTypes();
    });
    colourSearch.addEventListener('input', () => {
      colourFilter.query = colourSearch.value;
      this.filterColours();
    });
    typeSearch.addEventListener('keydown', (e) => {
      const t = e.key === 'Enter' && bestMatch(typeItems, typeSearch.value);
      if (t) this.setType(t);
    });
    colourSearch.addEventListener('keydown', (e) => {
      const c =
        e.key === 'Enter' && bestMatch(colourItems, colourSearch.value.replaceAll('-', ' '));
      if (c) this.setColour(c);
    });

    this.typeFav.addEventListener('click', () => {
      const t = this.chosenType;
      if (!favourites.bricks.delete(t)) favourites.bricks.add(t);
      saveFavourites(favourites);
      showFavourite(this.typeFav, 'brick', favourites.bricks.has(t));
      this.filterTypes();
    });
    this.colourFav.addEventListener('click', () => {
      const c = this.chosenColour;
      if (!favourites.colours.delete(c)) favourites.colours.add(c);
      saveFavourites(favourites);
      showFavourite(this.colourFav, 'colour', favourites.colours.has(c));
      this.filterColours();
    });
    this.filterTypes();
    this.filterColours();
  }

  get type(): BrickTypeId {
    return this.chosenType;
  }

  get colour(): ColourId {
    return this.chosenColour;
  }

  setType(t: BrickTypeId): void {
    // A part picked goes on by its bottom.
    if (t !== this.chosenType) this.typeChanged();
    this.chosenType = t;
    $('ed-type-name').textContent = brickName(t);
    markChosen(this.typeItems, t);
    showFavourite(this.typeFav, 'brick', this.favourites.bricks.has(t));
  }

  setColour(c: ColourId): void {
    this.chosenColour = c;
    $('ed-colour-name').textContent = colourName(c);
    markChosen(this.colourItems, c);
    showFavourite(this.colourFav, 'colour', this.favourites.colours.has(c));
    this.drawTypeThumbs();
  }

  /**
   * Pictures of the bricks in the list now, in the chosen colour; the rest wait until shown. None
   * while the editor is closed: opening it draws them all afresh.
   */
  private drawTypeThumbs(): void {
    if ($('editor').classList.contains('hidden')) return;
    for (const [t, b] of this.typeItems) {
      if (b.hidden) continue;
      const src = brickThumb(t, this.chosenColour);
      const img = b.querySelector('img')!;
      if (img.getAttribute('src') !== src) img.src = src;
    }
  }

  /** Draws every picture afresh, from the brick materials as they are now. */
  draw(): void {
    clearBrickThumbs();
    for (const [c, b] of this.colourItems) b.querySelector('img')!.src = brickThumb('2x2', c, 64);
    this.setColour(this.chosenColour);
    this.setType(this.chosenType);
  }

  private filterTypes(): void {
    const { favourites, brickFilter } = this;
    applyFilter(
      this.typeItems,
      this.typeList,
      favourites.bricks,
      (t) => brickShown(t, brickName(t), brickFilter, favourites.bricks),
      $('ed-types-none'),
    );
    this.drawTypeThumbs();
  }

  private filterColours(): void {
    const { favourites, colourFilter } = this;
    applyFilter(
      this.colourItems,
      this.colourList,
      favourites.colours,
      (c) => colourShown(c, colourFilter, favourites.colours),
      $('ed-colours-none'),
    );
  }
}
