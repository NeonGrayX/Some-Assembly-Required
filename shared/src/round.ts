import type { TargetBuild } from './builds/types.ts';
import { matchBuild } from './builds/match.ts';
import type { MatchResult, StepVerdict } from './builds/match.ts';
import { length, makeRng, rotate, v3 } from './math.ts';
import { DT } from './sim/sim.ts';
import type { Sim } from './sim/sim.ts';

/** Seconds a build has to rest on the inspector pad before the verdict shows. */
export const SCAN_SECONDS = 4;
export const DEFAULT_ROUND_SECONDS = 10 * 60;
/** The Done button must be pressed twice within this many seconds. */
export const DONE_CONFIRM_SECONDS = 3;

export type RoundPhase = 'building' | 'results';
export type EndReason = 'done' | 'time';

export interface InspectorState {
  status: 'idle' | 'scanning' | 'done';
  /** 0..1 while scanning. */
  progress: number;
  /** Per-step verdict of the last finished scan. */
  steps: StepVerdict[] | null;
  /** Build version that was scanned, so a changed build gets scanned again. */
  scannedVersion: number;
}

export interface RoundOptions {
  seconds?: number;
  seed?: number;
}

/**
 * One round on the job site: hides the instruction pages, runs the clock and the inspector,
 * and scores the build at the end. Reacts to the sim's events, never touches physics itself
 * beyond spawning pages.
 */
export class Round {
  phase: RoundPhase = 'building';
  timeLeft: number;
  endReason: EndReason | null = null;
  /** While `timeLeft` is above this, a second press of Done ends the round. */
  private doneArmedUntil = Infinity;
  result: MatchResult | null = null;
  readonly inspector: InspectorState = {
    status: 'idle',
    progress: 0,
    steps: null,
    scannedVersion: -1,
  };

  constructor(
    readonly sim: Sim,
    readonly target: TargetBuild,
    opts: RoundOptions = {},
  ) {
    this.timeLeft = opts.seconds ?? DEFAULT_ROUND_SECONDS;
    this.hidePages(makeRng(opts.seed ?? 1));
  }

  /** Puts one page per step on randomly chosen hiding spots. */
  private hidePages(rng: () => number): void {
    const spots = [...this.sim.level.pageSpots];
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [spots[i], spots[j]] = [spots[j]!, spots[i]!];
    }
    if (spots.length < this.target.steps.length) throw new Error('not enough page spots');
    this.target.steps.forEach((_, step) => {
      this.sim.spawnPage(step, spots[step]!, rng() * Math.PI * 2);
    });
  }

  /** Call once after every sim step, before the sim's events are cleared. */
  update(): void {
    if (this.phase !== 'building') return;
    this.timeLeft = Math.max(0, this.timeLeft - DT);
    for (const e of this.sim.events) {
      if (e.kind !== 'button' || e.buttonId !== 'done') continue;
      if (this.doneArmed) this.finish('done');
      else this.doneArmedUntil = this.timeLeft - DONE_CONFIRM_SECONDS;
    }
    if (this.timeLeft === 0) this.finish('time');
    if (this.phase === 'building') this.updateInspector();
  }

  /** True right after a first press of Done: pressing again ends the round. */
  get doneArmed(): boolean {
    return this.timeLeft > this.doneArmedUntil;
  }

  /** Whether the team's build is resting, upright and unheld on the inspector pad. */
  buildOnInspector(): boolean {
    const build = this.sim.build();
    if (build.heldBy !== null || build.anchored) return false;
    const { pos, size } = this.sim.level.inspector;
    const c = this.sim.buildCentre();
    return (
      Math.abs(c.x - pos.x) < size.x / 2 &&
      Math.abs(c.z - pos.z) < size.z / 2 &&
      c.y < pos.y + 0.3 &&
      rotate(build.body.rotation(), v3(0, 1, 0)).y > 0.9 &&
      length(build.body.linvel()) < 0.3
    );
  }

  private updateInspector(): void {
    const ins = this.inspector;
    if (!this.buildOnInspector()) {
      if (ins.status === 'scanning') ins.status = 'idle';
      if (ins.status === 'done') ins.status = 'idle';
      ins.progress = 0;
      return;
    }
    const version = this.sim.build().version;
    if (ins.status === 'done' && ins.scannedVersion === version) return;
    if (ins.status === 'done') ins.progress = 0;
    ins.status = 'scanning';
    ins.progress = Math.min(1, ins.progress + DT / SCAN_SECONDS);
    if (ins.progress >= 1) {
      ins.status = 'done';
      ins.steps = matchBuild(this.target, this.sim.build().grid).steps;
      ins.scannedVersion = version;
    }
  }

  finish(reason: EndReason): void {
    if (this.phase !== 'building') return;
    this.phase = 'results';
    this.endReason = reason;
    this.result = matchBuild(this.target, this.sim.build().grid);
  }
}
