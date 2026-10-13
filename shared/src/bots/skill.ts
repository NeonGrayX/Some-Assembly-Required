/** How well a bot plays, from a helper who takes it easy to one that knows everything. */
export const BOT_LEVELS = ['easy', 'normal', 'hard', 'expert'] as const;
export type BotLevel = (typeof BOT_LEVELS)[number];

export function isBotLevel(x: unknown): x is BotLevel {
  return typeof x === 'string' && (BOT_LEVELS as readonly string[]).includes(x);
}

export const BOT_LEVEL_NAMES: Record<BotLevel, string> = {
  easy: 'Easy',
  normal: 'Normal',
  hard: 'Hard',
  expert: 'Expert',
};

/**
 * Which side the bots take when roles are dealt: any (dealt like everyone), the saboteurs (bots
 * are dealt the saboteur roles before people are) or the builders (people are dealt them first).
 */
export const BOT_SIDES = ['any', 'saboteurs', 'builders'] as const;
export type BotSide = (typeof BOT_SIDES)[number];

export function isBotSide(x: unknown): x is BotSide {
  return typeof x === 'string' && (BOT_SIDES as readonly string[]).includes(x);
}

/** What a level of bot can do. Everything else about how bots play is the same at every level. */
export interface Skill {
  /** Ticks a bot stands thinking between one job and the next. */
  pause: number;
  /** Runs between jobs (walking otherwise). */
  sprint: boolean;
  /** Steps round loose bricks on the floor, walking carefully over them. */
  careful: boolean;
  /** Seconds between looks over the build for bricks that are wrong (a swap). */
  checkEvery: number;
  /** Builders: how sure they must be of someone before ringing the bell (0..1). */
  accuse: number;
  /** Saboteurs: how often they try something, as a factor on the base rates. */
  mischief: number;
  /** Saboteurs: how far past seeing range (metres) anyone must be before it uses a tool with a tell. */
  caution: number;
  /** Saboteurs: swaps bricks low in the build, under others, where they cost most to put right. */
  cunning: boolean;
  /** Saboteurs: chance, each time it weighs a trick, of tripping into a build that stands tall. */
  trip: number;
  /** The same when people are among the builders it plays against. */
  tripVsPeople: number;
  /** Saboteurs: trips into the build in front of anyone (a trip leaves no tell). */
  bold: boolean;
  /**
   * Knows what a player cannot: every page's contents and where it is, and which people are
   * saboteurs. Only the top level, for a game against people that the bots should win.
   */
  omniscient: boolean;
}

export const SKILLS: Record<BotLevel, Skill> = {
  easy: {
    pause: 90,
    sprint: false,
    careful: false,
    checkEvery: 60,
    accuse: 0.95,
    mischief: 0.5,
    caution: 0,
    cunning: false,
    trip: 0.15,
    tripVsPeople: 0.15,
    bold: false,
    omniscient: false,
  },
  normal: {
    pause: 30,
    sprint: true,
    careful: true,
    checkEvery: 20,
    accuse: 0.85,
    mischief: 1,
    caution: 1,
    cunning: false,
    trip: 0.15,
    tripVsPeople: 0.15,
    bold: false,
    omniscient: false,
  },
  hard: {
    pause: 8,
    sprint: true,
    careful: true,
    checkEvery: 6,
    accuse: 0.75,
    mischief: 1.2,
    caution: 3,
    cunning: true,
    trip: 0.03,
    tripVsPeople: 0.03,
    bold: true,
    omniscient: false,
  },
  expert: {
    pause: 2,
    sprint: true,
    careful: true,
    checkEvery: 2,
    accuse: 0.6,
    mischief: 1.4,
    caution: 3,
    cunning: true,
    trip: 0.03,
    tripVsPeople: 0.4,
    bold: true,
    omniscient: true,
  },
};
