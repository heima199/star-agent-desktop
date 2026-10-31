/**
 * "Follow the system appearance" support for the desktop themes.
 *
 * The OS only hands us a dark/light signal, while the app ships six palettes —
 * four paper grounds and two ink ones. So each half carries its own
 * preference, and following the system is stored as four values that resolve
 * into one applied theme:
 *
 *   followSystemTheme — is the switch on
 *   theme             — the applied theme (also the manual choice when off)
 *   lightTheme        — which paper palette the light half resolves to
 *   darkTheme         — which ink palette the dark half resolves to
 *
 * Detection goes through `prefers-color-scheme` rather than an Electron IPC
 * round-trip on purpose: the same renderer runs under Electron, the legacy
 * Tauri shell and the browser/H5 entry, and the media query is the only
 * signal all three share. Under Electron it is authoritative because the main
 * process never pins `nativeTheme.themeSource` — see
 * `desktop/electron/services/nativeAppearance.ts` for why.
 */

import {
  isDarkTheme,
  isThemeMode,
  type DarkThemeMode,
  type LightThemeMode,
  type ThemeMode,
} from '../types/settings'
import { ACCENT_STORAGE_KEY } from './accent'

export type SystemAppearance = 'dark' | 'light'

export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)'

export const THEME_STORAGE_KEY = 'cc-haha-theme'
export const FOLLOW_SYSTEM_THEME_STORAGE_KEY = 'cc-haha-follow-system-theme'
export const LIGHT_THEME_STORAGE_KEY = 'cc-haha-light-theme'
export const DARK_THEME_STORAGE_KEY = 'cc-haha-dark-theme'

export const DEFAULT_THEME: ThemeMode = 'white'
export const DEFAULT_LIGHT_THEME: LightThemeMode = 'white'
export const DEFAULT_DARK_THEME: DarkThemeMode = 'dark'

/**
 * Base ground of each palette — the `--cc-bg` source value each
 * `[data-theme]` block sets in globals.css, which `--color-background` then
 * maps to. Duplicated here because the Electron window background and the
 * pre-hydration inline script both need it before any CSS is parsed;
 * theme/globals.test.ts keeps the two in sync.
 */
export const THEME_BACKGROUNDS: Record<ThemeMode, string> = {
  white: '#FFFFFF',
  paper: '#FBF9F4',
  'warm-classic': '#F6F0E1',
  celadon: '#F5F8F5',
  dark: '#121212',
  // Retired: stored values fold onto 深色, so this ground is never applied.
  // Kept equal to its globals.css block, which theme/globals.test.ts checks.
  'ink-blue': '#1A1D24',
}

/**
 * STAR ships two palettes: 浅色 (`white`) and 深色 (`dark`). The other four
 * keys stay valid so stored values from older builds still parse, and fold
 * onto the palette of their ground.
 */
export function normalizeThemeMode(theme: ThemeMode): 'white' | 'dark' {
  return isDarkTheme(theme) ? 'dark' : 'white'
}

/**
 * Fold the stored values into the theme that should be on `<html>`.
 * Pure so the pre-hydration inline script in index.html can be checked
 * against it (see theme/bootstrapScript.test.ts).
 */
export function resolveAppliedTheme(input: {
  followSystem: boolean
  theme: ThemeMode
  lightTheme: LightThemeMode
  darkTheme: DarkThemeMode
  systemAppearance: SystemAppearance
}): ThemeMode {
  if (!input.followSystem) return input.theme
  return input.systemAppearance === 'dark' ? input.darkTheme : input.lightTheme
}

function getMediaQueryList(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  try {
    return window.matchMedia(DARK_SCHEME_QUERY)
  } catch {
    // jsdom without a matchMedia stub, or a WebView that rejects the query.
    return null
  }
}

/**
 * Current OS appearance. Falls back to `'light'` where the query is
 * unavailable, matching the app's historical default theme.
 */
export function getSystemAppearance(): SystemAppearance {
  return getMediaQueryList()?.matches ? 'dark' : 'light'
}

/**
 * Subscribe to OS appearance flips. Returns an unsubscribe function; a no-op
 * one where the query is unavailable.
 */
export function subscribeSystemAppearance(
  onChange: (appearance: SystemAppearance) => void,
): () => void {
  const query = getMediaQueryList()
  if (!query) return () => {}

  const listener = (event: MediaQueryListEvent) => {
    onChange(event.matches ? 'dark' : 'light')
  }

  // Safari < 14 (and the older WebKit the Tauri shell runs on) only has the
  // deprecated addListener/removeListener pair.
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  }
  if (typeof query.addListener === 'function') {
    query.addListener(listener)
    return () => query.removeListener(listener)
  }
  return () => {}
}

const THEME_KEYS: readonly string[] = [
  THEME_STORAGE_KEY,
  FOLLOW_SYSTEM_THEME_STORAGE_KEY,
  LIGHT_THEME_STORAGE_KEY,
  DARK_THEME_STORAGE_KEY,
  ACCENT_STORAGE_KEY,
]

/**
 * Subscribe to appearance changes made by *another* window.
 *
 * The pet window, the trace windows and the main window each run the renderer
 * bootstrap with their own store instance over one shared localStorage. The
 * `storage` event only fires in the windows that did not perform the write,
 * which is exactly the set that needs to catch up.
 */
export function subscribeThemeStorageChanges(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {}
  }

  const listener = (event: StorageEvent) => {
    // key is null when the whole store was cleared — that affects us too.
    if (event.key !== null && !THEME_KEYS.includes(event.key)) return
    onChange()
  }

  window.addEventListener('storage', listener)
  return () => window.removeEventListener('storage', listener)
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function getStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function readStoredTheme(storage: StorageLike | null = getStorage()): ThemeMode {
  const stored = safeRead(storage, THEME_STORAGE_KEY)
  return isThemeMode(stored) ? normalizeThemeMode(stored) : DEFAULT_THEME
}

/** One palette per ground: the light half is always 浅色. */
export function readStoredLightTheme(_storage: StorageLike | null = getStorage()): LightThemeMode {
  return DEFAULT_LIGHT_THEME
}

/** One palette per ground: the dark half is always 深色. */
export function readStoredDarkTheme(_storage: StorageLike | null = getStorage()): DarkThemeMode {
  return DEFAULT_DARK_THEME
}

/**
 * Whether the switch is on. New installs default to following the system —
 * that is the whole point of the feature. Existing installs are detected by
 * the presence of a stored theme and keep their current fixed appearance, so
 * an update never silently repaints someone's app.
 */
export function readStoredFollowSystemTheme(storage: StorageLike | null = getStorage()): boolean {
  const stored = safeRead(storage, FOLLOW_SYSTEM_THEME_STORAGE_KEY)
  if (stored === '1') return true
  if (stored === '0') return false
  return safeRead(storage, THEME_STORAGE_KEY) === null
}

function safeRead(storage: StorageLike | null, key: string): string | null {
  if (!storage) return null
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}
