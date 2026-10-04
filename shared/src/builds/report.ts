import { BRICK_TYPES } from '../bricks.ts';
import type { BrickTypeId, ColourId } from '../bricks.ts';
import type { BrickGrid } from '../grid.ts';
import type { MatchResult, StepVerdict } from './match.ts';
import type { TargetBrick } from './types.ts';

/** "white 2x2 brick", "light grey 2x4 plate". */
export function brickName(type: BrickTypeId, colour: ColourId): string {
  const plate = type.startsWith('plate');
  const size = plate ? type.slice('plate'.length) : type;
  return `${colour.replace('-', ' ')} ${size} ${plate ? 'plate' : 'brick'}`;
}

export interface ReportLine {
  kind: 'wrong' | 'close' | 'missing' | 'extra';
  text: string;
}

export interface StepReport {
  verdict: StepVerdict;
  correct: number;
  total: number;
  lines: ReportLine[];
}

/** What the quality inspector prints after a scan. */
export interface InspectionReport {
  correct: number;
  total: number;
  steps: StepReport[];
  /** Problems that belong to no step: bricks that are not in the plans at all. */
  extras: ReportLine[];
  /** Bricks in the real build to mark: wrong and extra in red, close in orange. */
  flagged: { id: number; kind: 'wrong' | 'close' }[];
  /** Missing bricks of steps that were started, to show as ghosts on the build. */
  ghosts: TargetBrick[];
}

/**
 * Turns a match result into the inspector's report. Steps nobody has started yet only say
 * "not started", so a scan never gives away a page the team has not found.
 */
export function inspectionReport(result: MatchResult, grid: BrickGrid): InspectionReport {
  const name = (b: { type: BrickTypeId; colour: ColourId }) => brickName(b.type, b.colour);
  const steps: StepReport[] = result.steps.map((verdict) => ({
    verdict,
    correct: 0,
    total: 0,
    lines: [],
  }));
  const flagged: InspectionReport['flagged'] = [];
  const ghosts: TargetBrick[] = [];
  for (const v of result.bricks) {
    const s = steps[v.target.step]!;
    s.total++;
    if (v.status === 'correct') {
      s.correct++;
      continue;
    }
    const actual = v.actualId !== undefined ? grid.bricks.get(v.actualId) : undefined;
    if (actual && (v.status === 'wrong' || v.status === 'close')) {
      flagged.push({ id: actual.id, kind: v.status });
      s.lines.push({
        kind: v.status,
        text: `${name(actual)}, should be ${name(v.target)}`,
      });
    } else if (s.verdict !== 'empty') {
      ghosts.push(v.target);
      s.lines.push({ kind: 'missing', text: `missing: ${name(v.target)}` });
    }
  }
  const extras: ReportLine[] = [];
  for (const id of result.extras) {
    const b = grid.bricks.get(id);
    if (!b || BRICK_TYPES[b.type].fixture) continue;
    flagged.push({ id, kind: 'wrong' });
    extras.push({ kind: 'extra', text: `extra: ${name(b)} (not in the plans)` });
  }
  return {
    correct: result.counts.correct,
    total: result.counts.total,
    steps,
    extras,
    flagged,
    ghosts,
  };
}
