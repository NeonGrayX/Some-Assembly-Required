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
}

export const SHADOW_QUALITIES: readonly ShadowQuality[] = [
  'off',
  'low',
  'medium',
  'high',
  'traced',
];
export const SCALES: readonly number[] = [0.5, 0.67, 0.75, 0.85, 1];

export const PRESETS: Record<Preset, Omit<GraphicsSettings, 'preset'>> = {
  low: { scale: 0.75, shadows: 'low', ao: false },
  medium: { scale: 1, shadows: 'medium', ao: false },
  high: { scale: 1, shadows: 'high', ao: true },
  ultra: { scale: 1, shadows: 'traced', ao: true },
};

export const DEFAULT_GRAPHICS: GraphicsSettings = { preset: 'medium', ...PRESETS.medium };

/** Settings from a preset. */
export const fromPreset = (preset: Preset): GraphicsSettings => ({ preset, ...PRESETS[preset] });

/** The preset these settings match, or 'custom'. */
export function presetOf(g: Omit<GraphicsSettings, 'preset'>): Preset | 'custom' {
  for (const [name, p] of Object.entries(PRESETS) as [Preset, (typeof PRESETS)[Preset]][]) {
    if (p.scale === g.scale && p.shadows === g.shadows && p.ao === g.ao) {
      return name;
    }
  }
  return 'custom';
}

/** Reads stored graphics settings, falling back to the defaults for anything missing or odd. */
export function parseGraphics(raw: unknown): GraphicsSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_GRAPHICS };
  const r = raw as Record<string, unknown>;
  const d = DEFAULT_GRAPHICS;
  const g = {
    scale: SCALES.includes(r.scale as number) ? (r.scale as number) : d.scale,
    shadows: SHADOW_QUALITIES.includes(r.shadows as ShadowQuality)
      ? (r.shadows as ShadowQuality)
      : d.shadows,
    ao: typeof r.ao === 'boolean' ? r.ao : d.ao,
  };
  return { preset: presetOf(g), ...g };
}
