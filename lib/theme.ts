import 'server-only';
import { getSetting, setSetting } from '@/lib/settings';

/**
 * Accent themes, Apple-palette flavored. The accent drives buttons, the active
 * tab, badges, and every "primary" moment; --accent-ink is the readable text
 * color on top of it. Stored per board in the settings table so every device
 * sees the same theme.
 */
export const THEMES = {
  blue: { label: 'Blue', accent: '#0a84ff', ink: '#ffffff' },
  orange: { label: 'Orange', accent: '#ff9f0a', ink: '#1c1102' },
  green: { label: 'Green', accent: '#30d158', ink: '#04240e' },
  purple: { label: 'Purple', accent: '#bf5af2', ink: '#ffffff' },
  pink: { label: 'Pink', accent: '#ff375f', ink: '#ffffff' },
  graphite: { label: 'Graphite', accent: '#8e8e93', ink: '#ffffff' },
} as const;

export type ThemeKey = keyof typeof THEMES;

/**
 * Appearance (light / dark / follow the device). 'system' is the default so a
 * fresh board honors prefers-color-scheme; 'light' and 'dark' pin it. Board-wide
 * like the accent, resolved to a concrete data-appearance attribute on <html>
 * by an inline script in app/layout.tsx before first paint.
 */
export const APPEARANCES = {
  system: { label: 'Auto' },
  light: { label: 'Light' },
  dark: { label: 'Dark' },
} as const;

export type AppearanceMode = keyof typeof APPEARANCES;

const THEME_KEY = 'theme.accent';
const APPEARANCE_KEY = 'theme.mode';

export function getThemeKey(): ThemeKey {
  // The database does not exist yet during a first production build, which
  // prerenders static pages before instrumentation can run migrations.
  try {
    const stored = getSetting(THEME_KEY);
    if (stored && stored in THEMES) return stored as ThemeKey;
  } catch {
    // Fall through to the default below.
  }
  return 'blue';
}

export function setThemeKey(key: string): boolean {
  if (!(key in THEMES)) return false;
  setSetting(THEME_KEY, key);
  return true;
}

export function getAppearance(): AppearanceMode {
  // Same build-time caveat as getThemeKey: no database during prerender.
  try {
    const stored = getSetting(APPEARANCE_KEY);
    if (stored && stored in APPEARANCES) return stored as AppearanceMode;
  } catch {
    // Fall through to the default below.
  }
  return 'system';
}

export function setAppearance(mode: string): boolean {
  if (!(mode in APPEARANCES)) return false;
  setSetting(APPEARANCE_KEY, mode);
  return true;
}

/** CSS custom properties to spread onto <body>, overriding globals.css. */
export function themeStyle(): Record<string, string> {
  const theme = THEMES[getThemeKey()];
  return { '--accent': theme.accent, '--accent-ink': theme.ink };
}
