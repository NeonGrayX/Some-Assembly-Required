import { describe, expect, it } from 'vitest';
import { History } from './history.ts';

/** A number to change, with its history. */
function counter(limit?: number) {
  const box = { n: 0, changes: 0 };
  const history = new History(
    () => box.n,
    (n) => (box.n = n),
    () => box.changes++,
    limit,
  );
  const set = (n: number) => {
    history.record();
    box.n = n;
  };
  return { box, history, set };
}

describe('editor history', () => {
  it('undoes and redoes changes in order', () => {
    const { box, history, set } = counter();
    set(1);
    set(2);
    history.undo();
    expect(box.n).toBe(1);
    history.undo();
    expect(box.n).toBe(0);
    expect(history.canUndo).toBe(false);
    history.undo();
    expect(box.n).toBe(0);
    history.redo();
    history.redo();
    expect(box.n).toBe(2);
    expect(history.canRedo).toBe(false);
  });

  it('forgets what was undone once something else changes', () => {
    const { box, history, set } = counter();
    set(1);
    history.undo();
    set(5);
    expect(history.canRedo).toBe(false);
    history.undo();
    expect(box.n).toBe(0);
  });

  it('reaches back only as far as its limit', () => {
    const { box, history, set } = counter(2);
    for (let n = 1; n <= 4; n++) set(n);
    history.undo();
    history.undo();
    history.undo();
    expect(box.n).toBe(2);
  });

  it('says when what can be undone changes', () => {
    const { box, history, set } = counter();
    set(1);
    history.undo();
    history.redo();
    history.redo();
    expect(box.changes).toBe(3);
  });
});
