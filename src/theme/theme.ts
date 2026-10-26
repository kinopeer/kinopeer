export type ThemePreference = 'system' | 'dark' | 'light'
export type ResolvedTheme = 'dark' | 'light'

export const THEME_STORAGE_KEY = 'kinoseed.theme'

const LIGHT_QUERY = '(prefers-color-scheme: light)'

export function readThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY)
    if (value === 'dark' || value === 'light' || value === 'system') return value
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
  }
  return 'system'
}

export function writeThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Not persisted; the choice still applies for this session.
  }
}

export function systemPrefersLight(): boolean {
  return window.matchMedia?.(LIGHT_QUERY).matches ?? false
}

export function resolveTheme(preference: ThemePreference, prefersLight: boolean): ResolvedTheme {
  if (preference === 'system') return prefersLight ? 'light' : 'dark'
  return preference
}

/**
 * Browser and status bar color per theme: --bg from src/styles/tokens.css. A meta tag can't read
 * CSS custom properties, and index.html sets it before the styles load.
 */
export const THEME_COLORS: Record<ResolvedTheme, string> = { dark: '#0e1113', light: '#f3f5f5' }

export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme])
}

export function watchSystemTheme(onChange: (prefersLight: boolean) => void): () => void {
  const query = window.matchMedia?.(LIGHT_QUERY)
  if (!query) return () => {}
  const listener = (event: MediaQueryListEvent) => onChange(event.matches)
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

// The preference is shared by the whole page, so every screen that shows it stays in sync.
let preference: ThemePreference | undefined
const listeners = new Set<() => void>()

export function getThemePreference(): ThemePreference {
  preference ??= readThemePreference()
  return preference
}

export function subscribeThemePreference(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setThemePreference(next: ThemePreference): void {
  writeThemePreference(next)
  preference = next
  applyTheme(resolveTheme(next, systemPrefersLight()))
  listeners.forEach((listener) => listener())
}

/** Forgets the preference read from storage, so the next read starts over. For tests. */
export function resetThemePreference(): void {
  preference = undefined
}

/**
 * Applies the theme and follows the system's light or dark setting for as long as the page is open,
 * while the preference is system. Called once at startup; returns a function that stops it.
 */
export function initTheme(): () => void {
  applyTheme(resolveTheme(getThemePreference(), systemPrefersLight()))
  return watchSystemTheme((prefersLight) => applyTheme(resolveTheme(getThemePreference(), prefersLight)))
}
