/**
 * How a page's "Add these bricks" list is laid out inside its box, so any number of kinds of
 * brick fits. Up to four kinds get the big icons with the count and name under each. More kinds
 * switch to a compact grid: smaller icons with the count and name beside them, in as many
 * columns and rows as it takes.
 */
export interface PartsLayout {
  cols: number;
  rows: number;
  /** Size of one grid cell. */
  cellW: number;
  cellH: number;
  /** Side of the square part icon. */
  icon: number;
  /** Font sizes of the count ("4×") and the brick name. */
  countPx: number;
  namePx: number;
  /** Count and name under the icon (big layout) or beside it (compact layout). */
  stacked: boolean;
}

/** Cell of the big layout, as printed when the list has room. */
const BIG = { cellW: 132, cellH: 140, icon: 84, countPx: 22, namePx: 13 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Layout for `n` kinds of brick in a box of `w` by `h` pixels. */
export function partsLayout(n: number, w: number, h: number): PartsLayout {
  if (n * BIG.cellW <= w && BIG.cellH <= h) return { cols: n, rows: 1, stacked: true, ...BIG };
  // Compact: three columns at least, and more columns before more rows.
  const cols = clamp(Math.ceil(n / 3), 3, 5);
  const rows = Math.ceil(n / cols);
  const cellW = Math.floor(w / cols);
  const cellH = Math.floor(h / rows);
  return {
    cols,
    rows,
    cellW,
    cellH,
    icon: Math.min(cellH - 4, 64),
    countPx: clamp(Math.round(cellH * 0.3), 10, 20),
    namePx: clamp(Math.round(cellH * 0.2), 8, 13),
    stacked: false,
  };
}

/** Where cell `i` of the layout sits, from the box's top-left corner. */
export function partCell(layout: PartsLayout, i: number): { x: number; y: number } {
  return {
    x: (i % layout.cols) * layout.cellW,
    y: Math.floor(i / layout.cols) * layout.cellH,
  };
}
