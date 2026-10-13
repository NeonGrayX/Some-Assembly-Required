import RAPIER from '@dimforge/rapier3d-compat';
import { playArena } from '@sar/shared';
import type { ArenaGame, ArenaResult } from '@sar/shared';

/** Asked of a worker: play this round. */
export interface ArenaJob {
  index: number;
  game: ArenaGame;
}

/** Told by a worker: how far a round is, how it went, or that it could not be played. */
export type ArenaNews =
  | { kind: 'progress'; index: number; done: number }
  | { kind: 'result'; index: number; result: ArenaResult; ms: number }
  | { kind: 'error'; index: number; message: string };

// Plays rounds between bots off the main thread, one at a time, as they are handed over.
const ready = RAPIER.init();
const tell = (news: ArenaNews) => self.postMessage(news);

self.onmessage = async (e: MessageEvent<ArenaJob>) => {
  const { index, game } = e.data;
  try {
    await ready;
    const start = performance.now();
    const result = playArena(RAPIER, game, (done) => tell({ kind: 'progress', index, done }));
    tell({ kind: 'result', index, result, ms: performance.now() - start });
  } catch (err) {
    tell({ kind: 'error', index, message: String((err as Error)?.message ?? err) });
  }
};
