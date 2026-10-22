import { paint } from './paint.ts';
import type { PaintJob, Painting } from './paint.ts';

/** Asked of a worker: paint this. */
export interface PaintAsk {
  id: number;
  job: PaintJob;
}

/** Told by a worker: what it painted for the ask `id`. */
export interface PaintDone extends Painting {
  id: number;
}

// Paints the car scene's big textures off the main thread, one at a time, as they are asked for.
self.onmessage = (e: MessageEvent<PaintAsk>) => {
  const { id, job } = e.data;
  const done: PaintDone = { id, ...paint(job) };
  self.postMessage(done, { transfer: [done.data.buffer] });
};
