/**
 * How the master index lays out every page's parts so a manual of any length fits on one sheet.
 * Each page gets its label ("Page 3") with its parts flowing to the right of it, as many to a
 * line as fit and wrapping onto more lines. Pages fill columns top to bottom and never break
 * across columns. The biggest font that fits wins, in as few columns as it takes.
 */
export interface IndexEntry {
  label: string;
  parts: string[];
}

export interface IndexText {
  text: string;
  /** From the box's top-left corner; text is drawn from its top. */
  x: number;
  y: number;
  bold: boolean;
}

export interface IndexLayout {
  columns: number;
  /** Font size of the parts; labels are bold at the same size. */
  px: number;
  texts: IndexText[];
  /** False only when even the smallest print does not fit: then the last pages are left off. */
  fits: boolean;
  /** Whether every line is inside the box's width. */
  fitsWidth: boolean;
}

/** Width of `text` at `px` pixels, bold or not. */
export type Measure = (text: string, px: number, bold: boolean) => number;

const LARGEST = 18;
const SMALLEST = 7;
const MAX_COLUMNS = 3;
const GUTTER = 14;
const SEPARATOR = ', ';

/** Lays out `entries` in a box of `w` by `h` pixels. */
export function indexLayout(entries: IndexEntry[], measure: Measure, w: number, h: number) {
  for (let px = LARGEST; px >= SMALLEST; px--) {
    for (let columns = 1; columns <= MAX_COLUMNS; columns++) {
      const layout = tryLayout(entries, measure, w, h, px, columns);
      if (layout.fits) return layout;
    }
  }
  // Too much to print: the smallest print in the most columns that still fit across.
  for (let columns = MAX_COLUMNS; columns > 1; columns--) {
    const layout = tryLayout(entries, measure, w, h, SMALLEST, columns);
    if (layout.fitsWidth) return layout;
  }
  return tryLayout(entries, measure, w, h, SMALLEST, 1);
}

function tryLayout(
  entries: IndexEntry[],
  measure: Measure,
  w: number,
  h: number,
  px: number,
  columns: number,
): IndexLayout {
  const colW = (w - (columns - 1) * GUTTER) / columns;
  const lineH = Math.round(px * 1.25);
  const gap = Math.round(px * 0.45);
  // Every label gets the width of the widest one, so the parts line up in each column.
  const labelW = Math.max(0, ...entries.map((e) => measure(e.label, px, true))) + px * 0.6;
  const partsW = colW - labelW;
  const texts: IndexText[] = [];
  let fitsHeight = true;
  let fitsWidth = partsW > 0;
  let column = 0;
  let y = 0;
  for (const entry of entries) {
    const lines = wrap(entry.parts, measure, px, partsW);
    if (lines.some((line) => measure(line, px, false) > partsW)) fitsWidth = false;
    const height = Math.max(1, lines.length) * lineH;
    if (y > 0 && y + height > h) {
      column++;
      y = 0;
    }
    if (column >= columns || y + height > h) {
      // Out of room: the rest is left off rather than printed over the page's edge.
      fitsHeight = false;
      break;
    }
    const x = column * (colW + GUTTER);
    texts.push({ text: entry.label, x, y, bold: true });
    lines.forEach((text, i) => texts.push({ text, x: x + labelW, y: y + i * lineH, bold: false }));
    y += height + gap;
  }
  return { columns, px, texts, fits: fitsHeight && fitsWidth, fitsWidth };
}

/** The parts as lines no wider than `width`; a part that is too wide on its own gets a line. */
function wrap(parts: string[], measure: Measure, px: number, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  parts.forEach((part, i) => {
    const piece = i < parts.length - 1 ? part + SEPARATOR.trimEnd() : part;
    const next = line ? `${line} ${piece}` : piece;
    if (line && measure(next, px, false) > width) {
      lines.push(line);
      line = piece;
    } else {
      line = next;
    }
  });
  if (line) lines.push(line);
  return lines;
}
