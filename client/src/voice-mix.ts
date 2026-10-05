/**
 * How loud, and how muffled, one player's voice is for another. Kept free of WebRTC and Web
 * Audio so the rules can be tested on their own.
 */

/** Voices fade out over the last few metres before this distance, and are silent past it. */
export const VOICE_RANGE = 22;
const FADE = 6;
/** Within this distance a voice is at full volume; further away it falls off like real sound. */
export const VOICE_REF_DISTANCE = 2;
/** A scream carries further and louder. */
export const SCREAM_GAIN = 2.2;
export const SCREAM_RANGE = 1.6;
/** How long after stepping on a brick a player's voice counts as a scream (ms). */
export const SCREAM_MS = 2500;

export interface Hearing {
  /** Lobby, results and meetings: everyone hears everyone, as if in one room. */
  together: boolean;
  /** Metres between the two heads. */
  distance: number;
  /** Walls, doors and furniture in the straight line between them. */
  walls: number;
  /** Whether either of them was voted off the job site. */
  speakerHome: boolean;
  listenerHome: boolean;
  /** The speaker just stepped on a brick. */
  screaming: boolean;
}

export interface Mix {
  /** Volume on top of the distance falloff, 0 (silent) to `SCREAM_GAIN`. */
  gain: number;
  /** Low-pass cutoff in Hz: high for a clear voice, low for one heard through a wall. */
  cutoff: number;
  /** Placed where the speaker stands (panned, falling off with distance), or heard centred. */
  spatial: boolean;
}

const CLEAR = 20_000;

/** The mix for one speaker as one listener hears them. */
export function voiceMix(h: Hearing): Mix {
  // Players sent home only talk among themselves, but hear everyone still on site.
  if (h.speakerHome && !h.listenerHome) return { gain: 0, cutoff: CLEAR, spatial: false };
  if (h.together || (h.speakerHome && h.listenerHome)) {
    return { gain: 1, cutoff: CLEAR, spatial: false };
  }
  const reach = h.screaming ? SCREAM_RANGE : 1;
  const range = VOICE_RANGE * reach;
  const fade = FADE * reach;
  const d = h.distance;
  let gain = d >= range ? 0 : d > range - fade ? (range - d) / fade : 1;
  // Every wall in between takes a good part of the volume and most of the highs.
  const walls = Math.min(3, h.walls);
  gain *= [1, 0.6, 0.35, 0.2][walls]!;
  let cutoff = [CLEAR, 1400, 800, 500][walls]!;
  if (h.screaming) {
    gain *= SCREAM_GAIN;
    cutoff = Math.min(CLEAR, cutoff * 2);
  }
  return { gain, cutoff, spatial: true };
}
