/**
 * How good the game looks, against how fast it runs. Each player picks for their own computer,
 * watching the frame rate in the corner; everything applies at once while playing.
 */

/** Sun shadows: none, shadow maps of growing size, or ray traced against the house. */
export type ShadowQuality = 'off' | 'low' | 'medium' | 'high' | 'traced';
export type Preset = 'low' | 'medium' | 'high' | 'ultra';

export interface GraphicsSettings {
  /** Which preset the rest came from, or 'custom' once something was changed by hand. */
  preset: Preset | 'custom';
  /** Fraction of the screen's resolution the 3D view is drawn at. */
  scale: number;
  shadows: ShadowQuality;
  /** Ambient occlusion: soft darkening in corners, under furniture and between bricks. */
  ao: boolean;
  /**
   * Bloom: a soft glow round the sun, the lamps and bright shine, and the frame's colours graded.
   */
  bloom: boolean;
}

/** The quality settings a preset sets. */
type Quality = Omit<GraphicsSettings, 'preset'>;

export const SHADOW_QUALITIES: readonly ShadowQuality[] = [
  'off',
  'low',
  'medium',
  'high',
  'traced',
];
export const SCALES: readonly number[] = [0.5, 0.67, 0.75, 0.85, 1];

export const PRESETS: Record<Preset, Quality> = {
  low: { scale: 0.75, shadows: 'low', ao: false, bloom: false },
  medium: { scale: 1, shadows: 'medium', ao: false, bloom: true },
  high: { scale: 1, shadows: 'high', ao: true, bloom: true },
  ultra: { scale: 1, shadows: 'traced', ao: true, bloom: true },
};

export const DEFAULT_GRAPHICS: GraphicsSettings = {
  preset: 'medium',
  ...PRESETS.medium,
};

/** Settings from a preset. */
export const fromPreset = (preset: Preset): GraphicsSettings => ({ preset, ...PRESETS[preset] });

/**
 * What a phone or tablet starts on: its screen packs two or three pixels into each one a
 * desktop draws, and the medium preset drew them all at full resolution with large shadow maps.
 * Players can still pick any preset.
 */
export const touchGraphics = (): GraphicsSettings => fromPreset('low');

/** The preset these settings match, or 'custom'. */
export function presetOf(g: Quality): Preset | 'custom' {
  for (const [name, p] of Object.entries(PRESETS) as [Preset, (typeof PRESETS)[Preset]][]) {
    if (p.scale === g.scale && p.shadows === g.shadows && p.ao === g.ao && p.bloom === g.bloom) {
      return name;
    }
  }
  return 'custom';
}

/**
 * Reads stored graphics settings, falling back to the defaults for anything missing or odd, or
 * to `fresh` if none were ever stored.
 */
export function parseGraphics(raw: unknown, fresh = DEFAULT_GRAPHICS): GraphicsSettings {
  if (!raw || typeof raw !== 'object') return { ...fresh };
  const r = raw as Record<string, unknown>;
  const d = DEFAULT_GRAPHICS;
  const g = {
    scale: SCALES.includes(r.scale as number) ? (r.scale as number) : d.scale,
    shadows: SHADOW_QUALITIES.includes(r.shadows as ShadowQuality)
      ? (r.shadows as ShadowQuality)
      : d.shadows,
    ao: typeof r.ao === 'boolean' ? r.ao : d.ao,
  };
  // Settings saved before bloom existed take it from the preset they match, so a preset stays
  // that preset; set by hand, they keep the cost they had (no bloom).
  const matched = Object.values(PRESETS).find(
    (p) => p.scale === g.scale && p.shadows === g.shadows && p.ao === g.ao,
  );
  const bloom = typeof r.bloom === 'boolean' ? r.bloom : (matched?.bloom ?? false);
  return { preset: presetOf({ ...g, bloom }), ...g, bloom };
}
