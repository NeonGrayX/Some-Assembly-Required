/**
 * Undo and redo over snapshots of something: `record` remembers how it was before a change,
 * `undo` and `redo` hand back how it was to put back, having taken how it is now (`now`).
 */
export class History<S> {
  private readonly undos: S[] = [];
  private readonly redos: S[] = [];

  constructor(
    /** How it is now. */
    private readonly now: () => S,
    /** Puts back how it was. */
    private readonly restore: (s: S) => void,
    /** Called whenever what can be undone or redone changes. */
    private readonly changed: () => void = () => {},
    /** How many changes back undo reaches. */
    private readonly limit = 200,
  ) {}

  get canUndo(): boolean {
    return this.undos.length > 0;
  }

  get canRedo(): boolean {
    return this.redos.length > 0;
  }

  /** Remembers how it was before a change, so the change can be undone. */
  record(before: S = this.now()): void {
    this.undos.push(before);
    if (this.undos.length > this.limit) this.undos.shift();
    this.redos.length = 0;
    this.changed();
  }

  undo(): void {
    this.step(this.undos, this.redos);
  }

  redo(): void {
    this.step(this.redos, this.undos);
  }

  private step(from: S[], to: S[]): void {
    const s = from.pop();
    if (s === undefined) return;
    to.push(this.now());
    this.restore(s);
    this.changed();
  }
}
