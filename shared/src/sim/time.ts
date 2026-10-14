/** Simulation steps per second, on the server and in every client's replica. */
export const TICK_RATE = 60;
/** Seconds one simulation step lasts. */
export const DT = 1 / TICK_RATE;

/** A time in seconds as a whole number of simulation steps. */
export const seconds = (s: number): number => Math.round(s * TICK_RATE);
