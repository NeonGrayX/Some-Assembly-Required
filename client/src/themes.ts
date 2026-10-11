/**
 * The interface's look: one of the eight themes every arrow-lab.de app shares (the style guide
 * at https://themes.arrow-lab.de/). A theme is only `<html data-theme="…">`: the stylesheets in
 * src/themes/ do the rest, so switching never redraws anything. The 3D world's graphics style is
 * a separate setting (Settings → Graphics).
 *
 * The inline script in index.html applies the saved theme before the first paint, with the same
 * rules as `savedTheme` here; keep the two in step.
 */

export type ThemeId =
  'pop' | 'bauhaus' | 'blueprint' | 'arcade' | 'broadsheet' | 'washi' | 'cyberpunk' | 'horizon';

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  /** One line on what it looks like, shown under the name in the picker. */
  note: string;
  dark: boolean;
}

/** In the style guide's order. */
export const THEMES: readonly ThemeInfo[] = [
  { id: 'pop', name: 'Pop', note: 'Loud colour, ink outlines, hard offset shadows', dark: false },
  {
    id: 'bauhaus',
    name: 'Bauhaus',
    note: 'A poster: primaries on cream, black bars',
    dark: false,
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    note: 'A cyanotype drawing: grid paper, white technical lines',
    dark: true,
  },
  {
    id: 'arcade',
    name: 'Arcade',
    note: "A cabinet's game-select screen: pixels and scanlines",
    dark: true,
  },
  {
    id: 'broadsheet',
    name: 'Broadsheet',
    note: 'A morning paper: newsprint, ink rules, serif masthead',
    dark: false,
  },
  { id: 'washi', name: 'Washi', note: 'Paper, sumi ink and one red seal', dark: false },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    note: 'A night market in the rain: dark glass and neon',
    dark: true,
  },
  {
    id: 'horizon',
    name: 'Horizon',
    note: 'White sheets, one blue, green selection frames',
    dark: false,
  },
];

const IDS = new Set<string>(THEMES.map((t) => t.id));
/** This app's saved state (the arrow-lab.de `<app-id>:state` convention). */
const STATE_KEY = 'sar:state';
/** Shared by every arrow-lab.de app, so a theme picked in one is the theme in all of them. */
const COOKIE = 'arrowlab-theme';

export const isTheme = (id: unknown): id is ThemeId => typeof id === 'string' && IDS.has(id);

function cookieTheme(): ThemeId | null {
  const m = /(?:^|;\s*)arrowlab-theme=([^;]+)/.exec(document.cookie);
  const id = m ? decodeURIComponent(m[1]!) : null;
  return isTheme(id) ? id : null;
}

function stateTheme(): ThemeId | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null');
    const id = raw && typeof raw === 'object' ? (raw as { theme?: unknown }).theme : null;
    return isTheme(id) ? id : null;
  } catch {
    return null;
  }
}

/** The theme the reader picked (here or in another arrow-lab.de app), if they picked one. */
export function savedTheme(): ThemeId | null {
  return cookieTheme() ?? stateTheme();
}

/** With nothing picked: Cyberpunk on a dark system, Pop on any other. */
export function defaultTheme(): ThemeId {
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'cyberpunk' : 'pop';
}

export function currentTheme(): ThemeId {
  const id = document.documentElement.dataset.theme;
  return isTheme(id) ? id : (savedTheme() ?? defaultTheme());
}

/** Shows a theme, and sets the browser's bar to its page colour. */
export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta && bg) meta.content = bg;
}

/** The reader picked a theme: show it and remember it. Only an explicit pick is saved. */
export function pickTheme(id: ThemeId): void {
  applyTheme(id);
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null');
    const state = raw && typeof raw === 'object' ? raw : {};
    localStorage.setItem(STATE_KEY, JSON.stringify({ ...state, theme: id }));
  } catch {
    // Storage can be blocked; the theme then lasts until the tab closes.
  }
  // On arrow-lab.de the pick goes to every app there; elsewhere (localhost, a self-hosted copy)
  // the cookie stays with this site.
  const shared = /(^|\.)arrow-lab\.de$/.test(location.hostname) ? '; domain=.arrow-lab.de' : '';
  const secure = location.protocol === 'https:' ? '; secure' : '';
  document.cookie = `${COOKIE}=${id}; path=/; max-age=31536000; samesite=lax${shared}${secure}`;
}

/** Follows the system's light or dark mode while the reader has not picked a theme. */
export function followSystemTheme(onChange: () => void): void {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (savedTheme()) return;
    applyTheme(defaultTheme());
    onChange();
  });
}
