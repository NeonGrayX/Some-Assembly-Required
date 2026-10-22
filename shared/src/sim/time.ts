/** Simulation steps per second, on the server and in every client's replica. */
export const TICK_RATE = 60;
/** Seconds one simulation step lasts. */
export const DT = 1 / TICK_RATE;

/** A time in seconds as a whole number of simulation steps. */
export const seconds = (s: number): number => Math.round(s * TICK_RATE);

/** How long a run of catch-up steps may take before the rest are let go (ms; see `catchUp`). */
export const CATCH_UP_MS = 50;

/**
 * Behind by `acc` seconds: runs `step` once a tick to catch up, but only while the steps have
 * taken no longer than `CATCH_UP_MS` all told, and lets the rest go, telling `letGo` how many
 * ticks that was. Steps that slow (a stall in them) cannot be caught up on: running every one
 * would only take longer still, and leave the next lot further behind. What is left of `acc`.
 */
export function catchUp(
  acc: number,
  step: () => void,
  letGo: (ticks: number) => void = () => {},
): number {
  const started = Date.now();
  while (acc >= DT) {
    acc -= DT;
    step();
    if (Date.now() - started > CATCH_UP_MS) {
      letGo(Math.floor(acc / DT));
      return acc % DT;
    }
  }
  return acc;
}
