import { downloadBlob } from '../ui/dom.ts';

/**
 * Small pieces the benchmark's pages (setup, bot results) are made of, drawn in the same
 * style as the frame-rate report (`.bench-sheet` in styles/bench.css): the theme's panels (.box),
 * buttons (.btn) and fields (.field), like the menus and settings.
 */

/** A full-screen page over the game, hidden until shown. */
export function sheet(id: string): HTMLElement {
  const el = document.createElement('div');
  el.id = id;
  el.className = 'bench-sheet';
  el.hidden = true;
  document.body.append(el);
  return el;
}

export function button(text: string, click: () => void, primary = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = primary ? 'btn btn-primary' : 'btn';
  b.textContent = text;
  b.addEventListener('click', click);
  return b;
}

/** A page's heading, a line under it, and its buttons on the right, on a panel of their own. */
export function head(
  title: string,
  meta: string,
  buttons: HTMLElement[],
): { head: HTMLElement; meta: HTMLElement } {
  const el = document.createElement('header');
  el.className = 'bench-head box';
  const left = document.createElement('div');
  const h = document.createElement('h2');
  h.textContent = title;
  const p = document.createElement('p');
  p.className = 'bench-meta';
  p.textContent = meta;
  left.append(h, p);
  const right = document.createElement('div');
  right.className = 'bench-buttons';
  right.append(...buttons);
  el.append(left, right);
  return { head: el, meta: p };
}

/** A row of headline numbers. */
export function tiles(items: [label: string, value: string, note: string][]): HTMLElement {
  const box = document.createElement('div');
  box.className = 'bench-tiles';
  for (const [label, value, note] of items) {
    const t = document.createElement('div');
    t.className = 'bench-tile box';
    for (const [cls, text] of [
      ['label', label],
      ['value', value],
      ['note', note],
    ]) {
      const s = document.createElement('span');
      s.className = cls!;
      s.textContent = text!;
      t.append(s);
    }
    box.append(t);
  }
  return box;
}

/** A table under a heading. */
export function table(title: string, columns: string[], rows: string[][]): HTMLElement {
  const box = document.createElement('div');
  box.className = 'bench-table box';
  const h = document.createElement('h3');
  h.textContent = title;
  const t = document.createElement('table');
  const tr = t.createTHead().insertRow();
  for (const c of columns) {
    const th = document.createElement('th');
    th.textContent = c;
    tr.append(th);
  }
  const body = t.createTBody();
  for (const row of rows) {
    const r = body.insertRow();
    for (const v of row) r.insertCell().textContent = v;
  }
  box.append(h, t);
  return box;
}

/** A labelled drop-down. */
export function select<T extends string>(
  label: string,
  options: readonly (readonly [T, string])[],
  value: T,
  change: (v: T) => void,
): HTMLLabelElement {
  const l = document.createElement('label');
  l.className = 'field bench-field';
  const span = document.createElement('span');
  span.textContent = label;
  // The theme's drop-down: its own arrow, drawn on this wrapper.
  const wrap = document.createElement('span');
  wrap.className = 'select';
  const s = document.createElement('select');
  for (const [v, text] of options) s.add(new Option(text, v, false, v === value));
  s.addEventListener('change', () => change(s.value as T));
  wrap.append(s);
  l.append(span, wrap);
  return l;
}

/** Saves `text` as a download. */
export function download(text: string, name: string, type: string): void {
  downloadBlob(new Blob([text], { type }), name);
}

/** A file name's date part: 2026-10-13-14-05-00. */
export const stamp = (iso: string) => iso.slice(0, 19).replace(/[:T]/g, '-');
