import { stringifyBuildFileWithMap } from '@sar/shared';
import type { TargetBuild } from '@sar/shared';

/** What the build file pane needs of the editor. */
export interface BuildFileHost {
  /** The build as a build file has it; `order` gets the brick ids in file order. */
  current(order: number[]): TargetBuild;
  /** A build file's text read as far as it can be: the build, if any, and what is wrong. */
  read(text: string): { build: TargetBuild | null; problems: string[] };
  /** Makes the editor's build `build`, and gives the new brick ids in file order. */
  replace(build: TargetBuild): number[];
  /** Remembers the build as it is, so the change about to be made can be undone. */
  record(): void;
  redraw(): void;
  /** Marks a brick in the view (none: takes the mark away). */
  mark(id: number | undefined): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * The build file beside the view, live: it shows the build as its file, and the build takes
 * in what is typed there. The brick under the pointer has its line lit, and the brick whose
 * line the cursor is on is marked in the view.
 */
export class BuildFilePane {
  private readonly pane = $('ed-code');
  private readonly code = $<HTMLTextAreaElement>('ed-code-text');
  private readonly status = $('ed-code-status');
  private readonly openBtn = $<HTMLButtonElement>('ed-code-open');
  private readonly lineEl = $('ed-code-line');
  /** The brick id on each brick line of the text, in order. */
  private ids: number[] = [];
  /** The build those bricks belong to: the text's, as last written or read. */
  private build: TargetBuild | null = null;
  /** The line (from 0) each of those bricks is on in the text, or -1 where it is not found. */
  private lines: number[] = [];
  /** An edit in the text box is the one change undo knows about until the box is left. */
  private recorded = false;
  private timer = 0;
  /** Typed in since the build last took the text in. */
  private dirty = false;
  /** The row lit behind the text box, as a line number, or -1. */
  private litRow = -1;

  constructor(private readonly host: BuildFileHost) {
    const { code } = this;
    code.addEventListener('scroll', () => this.placeLine());
    code.addEventListener('input', () => {
      // The lines move as they are typed in; the build takes the text in a moment later.
      if (this.build) this.lines = brickLinesIn(code.value, this.build);
      this.dirty = true;
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.apply(), 300);
    });
    code.addEventListener('focus', () => {
      this.recorded = false;
      this.litRow = -1;
      this.placeLine();
    });
    code.addEventListener('blur', () => {
      if (this.dirty) this.apply();
      // Unreadable text stays as typed, to be fixed. Otherwise it is tidied into the file's layout.
      if (!this.status.classList.contains('bad')) this.sync();
    });
    for (const ev of ['keyup', 'click', 'select'] as const) {
      code.addEventListener(ev, () => this.markBrick());
    }
    this.openBtn.addEventListener('click', () => this.setOpen(!this.isOpen));
    $('ed-code-close').addEventListener('click', () => this.setOpen(false));
  }

  get isOpen(): boolean {
    return !this.pane.classList.contains('hidden');
  }

  private setOpen(on: boolean): void {
    this.pane.classList.toggle('hidden', !on);
    this.openBtn.setAttribute('aria-pressed', String(on));
    this.openBtn.classList.toggle('on', on);
    if (!on) this.host.mark(undefined);
    this.sync();
  }

  /** Writes the build into the text box, unless it is being typed in. */
  sync(): void {
    if (!this.isOpen || document.activeElement === this.code) return;
    const order: number[] = [];
    this.build = this.host.current(order);
    const { text, brickLines } = stringifyBuildFileWithMap(this.build);
    this.code.value = text;
    this.ids = order;
    this.lines = brickLines;
    this.showStatus([]);
  }

  private showStatus(problems: string[], bad = false): void {
    this.status.classList.toggle('bad', bad);
    this.status.textContent = problems.length
      ? (bad ? '' : '⚠ ') + problems.slice(0, 3).join(' · ')
      : '✓ The build matches the file.';
  }

  /** Builds what the text box says, as far as it can be read. */
  private apply(): void {
    const { code, host } = this;
    clearTimeout(this.timer);
    this.dirty = false;
    const { build, problems } = host.read(code.value);
    if (!build) {
      let why: string;
      try {
        JSON.parse(code.value);
        why = 'Not a build file: it needs manual.pages with bricks.';
      } catch (err) {
        why = `Not readable JSON: ${(err as Error).message}`;
      }
      this.showStatus([why], true);
      return;
    }
    if (!this.recorded) {
      host.record();
      this.recorded = true;
    }
    this.ids = host.replace(build);
    this.build = build;
    this.lines = brickLinesIn(code.value, build);
    host.redraw();
    this.showStatus(problems);
    this.markBrick();
  }

  /** The index of the brick whose line the cursor is on, if it is on one. */
  private brickLineAt(pos: number): number {
    const row = this.code.value.slice(0, pos).split('\n').length - 1;
    return this.lines.indexOf(row);
  }

  /** Marks in the view the brick whose line the cursor is on, while typing there. */
  private markBrick(): void {
    const { code } = this;
    const i = document.activeElement === code ? this.brickLineAt(code.selectionStart) : -1;
    this.host.mark(i < 0 ? undefined : this.ids[i]);
  }

  /** Scrolls the text box to a brick's line and lights it, while the box is not in use. */
  showLine(id: number | undefined): void {
    const { code } = this;
    if (document.activeElement === code) return;
    const i = id === undefined ? -1 : this.ids.indexOf(id);
    this.litRow = i < 0 ? -1 : (this.lines[i] ?? -1);
    if (this.litRow >= 0) {
      const lh = this.lineHeight();
      const top = this.litRow * lh;
      if (top < code.scrollTop || top + lh > code.scrollTop + code.clientHeight - lh) {
        code.scrollTop = Math.max(0, top - code.clientHeight / 2);
      }
    }
    this.placeLine();
  }

  private lineHeight(): number {
    return parseFloat(getComputedStyle(this.code).lineHeight) || 16;
  }

  private placeLine(): void {
    const { code, lineEl, litRow } = this;
    const lh = this.lineHeight();
    const style = getComputedStyle(code);
    const pad = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.borderTopWidth) || 0);
    const top = pad + litRow * lh - code.scrollTop;
    // Only while the line is in sight in the box.
    lineEl.hidden = litRow < 0 || top < pad || top + lh > code.clientHeight;
    lineEl.style.top = `${top}px`;
    lineEl.style.height = `${lh}px`;
  }
}

/**
 * Where the bricks of a build read from `text` are in it: the line (from 0) of each, in file
 * order, or -1 for one not found. Typed text need not be laid out as the editor writes it, so
 * each brick's line as the editor would write it is looked for, from the last one found on.
 */
function brickLinesIn(text: string, build: TargetBuild): number[] {
  const own = stringifyBuildFileWithMap(build);
  const ownLines = own.text.split('\n');
  const lines = text.split('\n').map((l) => l.trim());
  let from = 0;
  return own.brickLines.map((at) => {
    const row = lines.indexOf(ownLines[at]!.trim(), from);
    if (row >= 0) from = row + 1;
    return row;
  });
}
