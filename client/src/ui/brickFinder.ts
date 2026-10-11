import { BRICK_TYPES, COLOURS } from '@sar/shared';
import type { BrickTypeId, ColourId } from '@sar/shared';

/**
 * Finding a part or colour in the build editor's long lists: what kind of part each is, its
 * size, a search over names and part numbers, and favourites kept on this device.
 */

/** The kinds the brick list can be narrowed to. A part can be more than one (a round plate). */
export type BrickKind = 'brick' | 'plate' | 'tile' | 'slope' | 'round' | 'modified' | 'other';

export const BRICK_KINDS: { id: BrickKind; label: string }[] = [
  { id: 'brick', label: 'Brick' },
  { id: 'plate', label: 'Plate' },
  { id: 'tile', label: 'Tile' },
  { id: 'slope', label: 'Slope' },
  { id: 'round', label: 'Round' },
  { id: 'modified', label: 'Modified' },
  { id: 'other', label: 'Other' },
];

/** What kinds of part a type is. */
export function brickKinds(type: BrickTypeId): Set<BrickKind> {
  const t = BRICK_TYPES[type];
  const shape = t.shape ?? 'box';
  const out = new Set<BrickKind>();
  if (shape === 'slope' || shape === 'cheese' || shape === 'curve') out.add('slope');
  if (shape === 'round' || shape === 'cone' || shape === 'dish' || shape === 'quarter')
    out.add('round');
  if (t.sideStuds?.length) out.add('modified');
  if (shape === 'window' || shape === 'plant' || shape === 'flower' || shape === 'spire')
    out.add('other');
  const flatTop = t.studs === 'none';
  if (t.plates === 1 && flatTop && ['tile', 'grille', 'round', 'quarter'].includes(shape))
    out.add('tile');
  else if (t.plates === 1 && !flatTop && shape !== 'dish') out.add('plate');
  else if (t.plates >= 3 && (shape === 'box' || shape === 'round')) out.add('brick');
  return out;
}

/** The footprint as it is said, smaller side first: "2×4". */
export function sizeLabel(type: BrickTypeId): string {
  const t = BRICK_TYPES[type];
  return `${Math.min(t.studsX, t.studsZ)}×${Math.max(t.studsX, t.studsZ)}`;
}

/** Every footprint some part has, smallest first. */
export function allSizes(types: BrickTypeId[]): string[] {
  const sizes = new Set(types.map(sizeLabel));
  const n = (s: string) => s.split('×').map(Number) as [number, number];
  return [...sizes].sort((a, b) => n(a)[0] - n(b)[0] || n(a)[1] - n(b)[1]);
}

/** How tall a part is, for the height filter. */
export type Height = 'plate' | 'two' | 'brick' | 'tall';

export const HEIGHTS: { id: Height; label: string }[] = [
  { id: 'plate', label: '1 plate' },
  { id: 'two', label: '2 plates' },
  { id: 'brick', label: '1 brick' },
  { id: 'tall', label: 'Taller' },
];

export function heightOf(type: BrickTypeId): Height {
  const p = BRICK_TYPES[type].plates;
  return p <= 1 ? 'plate' : p === 2 ? 'two' : p === 3 ? 'brick' : 'tall';
}

/** Lower case, "×" as "x", runs of space and dashes as one space. */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replaceAll('×', 'x')
    .replace(/[\s,-]+/g, ' ')
    .trim();

/** Whether every word of the query starts a word of the text ("2x4" is not in "12x4"). */
function matches(query: string, text: string): boolean {
  const have = text.split(' ');
  return norm(query)
    .split(' ')
    .filter(Boolean)
    .every((w) => have.some((h) => h.startsWith(w)));
}

/** The text a part is found by: its name, id, part number, kinds and size both ways round. */
export function brickSearchText(type: BrickTypeId, name: string): string {
  const t = BRICK_TYPES[type];
  const [a, b] = [Math.min(t.studsX, t.studsZ), Math.max(t.studsX, t.studsZ)];
  const kinds = [...brickKinds(type)].join(' ');
  return norm(`${name} ${type} ${t.part ?? ''} ${kinds} ${a}x${b} ${b}x${a}`);
}

export interface BrickFilter {
  query: string;
  kind: BrickKind | null;
  size: string | null;
  height: Height | null;
  favouritesOnly: boolean;
}

export function brickShown(
  type: BrickTypeId,
  name: string,
  f: BrickFilter,
  favourites: ReadonlySet<string>,
): boolean {
  if (f.favouritesOnly && !favourites.has(type)) return false;
  if (f.kind && !brickKinds(type).has(f.kind)) return false;
  if (f.size && sizeLabel(type) !== f.size) return false;
  if (f.height && heightOf(type) !== f.height) return false;
  return matches(f.query, brickSearchText(type, name));
}

/** The groups the colour list can be narrowed to. */
export type ColourGroup = 'solid' | 'trans' | 'metallic';

export const COLOUR_GROUPS: { id: ColourGroup; label: string }[] = [
  { id: 'solid', label: 'Solid' },
  { id: 'trans', label: 'See-through' },
  { id: 'metallic', label: 'Metallic' },
];

export function colourGroup(c: ColourId): ColourGroup {
  const { alpha, metallic } = COLOURS[c];
  return alpha ? 'trans' : metallic ? 'metallic' : 'solid';
}

export interface ColourFilter {
  query: string;
  group: ColourGroup | null;
  favouritesOnly: boolean;
}

export function colourShown(
  c: ColourId,
  f: ColourFilter,
  favourites: ReadonlySet<string>,
): boolean {
  if (f.favouritesOnly && !favourites.has(c)) return false;
  const group = colourGroup(c);
  if (f.group && group !== f.group) return false;
  const words = group === 'trans' ? 'transparent see through' : group;
  return matches(f.query, norm(`${c} ${words}`));
}

// ------------------------------------------------------------------ favourites

/** Starred parts and colours, kept on this device like the other settings. */
export interface Favourites {
  bricks: Set<BrickTypeId>;
  colours: Set<ColourId>;
}

const KEY = 'sar.editor.favourites';

/** Reads favourites from stored JSON, dropping anything that is not a part or colour (any more). */
export function parseFavourites(json: string | null): Favourites {
  let raw: { bricks?: unknown; colours?: unknown } = {};
  try {
    const parsed: unknown = json ? JSON.parse(json) : null;
    if (parsed && typeof parsed === 'object') raw = parsed;
  } catch {
    // Corrupt storage: start with none.
  }
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  return {
    bricks: new Set(
      list(raw.bricks).filter(
        (t): t is BrickTypeId => t in BRICK_TYPES && !BRICK_TYPES[t as BrickTypeId].fixture,
      ),
    ),
    colours: new Set(
      list(raw.colours).filter((c): c is ColourId => c in COLOURS && c !== 'baseplate-green'),
    ),
  };
}

export function loadFavourites(): Favourites {
  try {
    return parseFavourites(localStorage.getItem(KEY));
  } catch {
    // Storage can be blocked; favourites then last until the tab closes.
    return parseFavourites(null);
  }
}

export function saveFavourites(f: Favourites): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ bricks: [...f.bricks], colours: [...f.colours] }));
  } catch {
    // See above.
  }
}
