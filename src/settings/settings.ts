import { useCallback, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { tmdbLanguage } from '../api/tmdb'

/** Per-browser preferences from the Settings screen. Connection settings live on the server. */
export interface Settings {
  /** qBittorrent category for new movie downloads; undefined picks one named like "Movies". */
  movieCategory?: string
  /** The same for series ("TV Shows", "Сериалы"). */
  tvCategory?: string
  /** New downloads start stopped. */
  startPaused: boolean
  /** New downloads fetch pieces in order. */
  sequential: boolean
  /** Language of titles and overviews from TMDB; 'app' follows the interface language. */
  tmdbLanguage: 'app' | 'en-US' | 'ru-RU'
}

export const SETTINGS_STORAGE_KEY = 'kinoseed.settings'

export const DEFAULT_SETTINGS: Settings = { startPaused: false, sequential: false, tmdbLanguage: 'app' }

let current: Settings | undefined
const listeners = new Set<() => void>()

function read(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}') as Partial<Settings>
    return { ...DEFAULT_SETTINGS, ...stored }
  } catch {
    // Unreadable or blocked storage: start from the defaults.
    return DEFAULT_SETTINGS
  }
}

export function getSettings(): Settings {
  current ??= read()
  return current
}

export function updateSettings(changes: Partial<Settings>): void {
  current = { ...getSettings(), ...changes }
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(current))
  } catch {
    // Not persisted; the change still applies until the page reloads.
  }
  listeners.forEach((listener) => listener())
}

/** For tests. */
export function resetSettings(): void {
  current = undefined
  try {
    localStorage.removeItem(SETTINGS_STORAGE_KEY)
  } catch {
    // Nothing to clear.
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSettings(): [Settings, (changes: Partial<Settings>) => void] {
  const settings = useSyncExternalStore(subscribe, getSettings)
  return [settings, useCallback((changes: Partial<Settings>) => updateSettings(changes), [])]
}

/** The TMDB language tag to request: the chosen one, or the interface language's. */
export function useTmdbLanguage(): string {
  const { i18n } = useTranslation()
  const [settings] = useSettings()
  return settings.tmdbLanguage === 'app' ? tmdbLanguage(i18n.resolvedLanguage ?? i18n.language) : settings.tmdbLanguage
}
