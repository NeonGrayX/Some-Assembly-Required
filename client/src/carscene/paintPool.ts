import type { PaintJob, Painting } from './paint.ts';
import type { PaintAsk, PaintDone } from './paint.worker.ts';

/**
 * The workers that paint the car scene's big textures (see `paint.ts`), a few of them so that a
 * map's are painted side by side: started on the first ask, and kept for the rest of the visit.
 */

interface Painter {
  worker: Worker;
  /** The asks it has yet to answer. */
  asks: Map<number, { resolve: (p: Painting) => void; reject: (e: Error) => void }>;
}

let painters: Painter[] | null = null;
/** Whether workers cannot be had here (none in the browser, or they failed to start). */
let none = typeof Worker === 'undefined';
let nextId = 0;

function start(): Painter[] | null {
  if (painters || none) return painters;
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
  try {
    painters = Array.from({ length: Math.max(1, Math.min(4, cores - 1)) }, () => {
      const worker = new Worker(new URL('./paint.worker.ts', import.meta.url), { type: 'module' });
      const p: Painter = { worker, asks: new Map() };
      worker.onmessage = (e: MessageEvent<PaintDone>) => {
        const { id, data, width, height } = e.data;
        p.asks.get(id)?.resolve({ data, width, height });
        p.asks.delete(id);
      };
      // A worker that will not paint fails what it was asked, and no more are asked of any.
      worker.onerror = (e) => {
        none = true;
        for (const ask of p.asks.values()) ask.reject(new Error(e.message || 'A painter stopped.'));
        p.asks.clear();
      };
      return p;
    });
  } catch {
    none = true;
    painters = null;
  }
  return painters;
}

/**
 * Paints `job` in a worker, or null if there are none here (then it is painted on the main
 * thread). Rejects if the worker stops before it is done.
 */
export function paintAway(job: PaintJob): Promise<Painting> | null {
  const pool = start();
  if (!pool || none) return null;
  // To the one with the fewest asks waiting.
  const p = pool.reduce((a, b) => (b.asks.size < a.asks.size ? b : a));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    p.asks.set(id, { resolve, reject });
    const ask: PaintAsk = { id, job };
    p.worker.postMessage(ask);
  });
}
