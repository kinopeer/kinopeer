import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { getServerSettings, saveDownloadDefaults, type DownloadDefaults } from '../api/settings'
import { tmdbLanguage } from '../api/tmdb'
import type { DownloadSort } from '../torrents/sort'

/**
 * Preferences from the Settings screen, kept in this browser. The download defaults (categories,
 * start paused, sequential) are also kept on the Kinoseed server, so every device has the same:
 * the server's win when they load, and changes go to both. Without the server they stay in this
 * browser only. Connection settings live on the server alone.
 */
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
  /** How the downloads list is shown. */
  downloadsView: 'list' | 'grid'
  /** How the downloads list is ordered. */
  downloadsSort: DownloadSort
}

export const SETTINGS_STORAGE_KEY = 'kinoseed.settings'

export const DEFAULT_SETTINGS: Settings = {
  startPaused: false,
  sequential: false,
  tmdbLanguage: 'app',
  downloadsView: 'list',
  downloadsSort: 'priority',
}

/** The settings the server keeps too. */
const SERVER_KEYS = ['movieCategory', 'tvCategory', 'startPaused', 'sequential'] as const
type ServerKey = (typeof SERVER_KEYS)[number]

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

function apply(changes: Partial<Settings>): void {
  current = { ...getSettings(), ...changes }
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(current))
  } catch {
    // Not persisted; the change still applies until the page reloads.
  }
  listeners.forEach((listener) => listener())
}

/** The download defaults among `settings`, as the server keeps them (null: pick automatically). */
function serverPart(settings: Partial<Settings>): Partial<DownloadDefaults> {
  const part: Partial<DownloadDefaults> = {}
  for (const key of SERVER_KEYS) {
    if (!(key in settings)) continue
    if (key === 'movieCategory' || key === 'tvCategory') part[key] = settings[key] ?? null
    else part[key] = settings[key] ?? DEFAULT_SETTINGS[key]
  }
  return part
}

// Loading the server's download defaults: once per page, again a minute after a failure.
const RETRY_MS = 60_000
let loaded = false
let loading = false
let failedAt: number | undefined
// Bumped by resetSettings, so a load from before it is ignored.
let generation = 0
// Changed on this page while the server's defaults were loading, so they don't overwrite them.
const changedWhileLoading = new Set<ServerKey>()

/** Saves download defaults on the server. */
function share(defaults: Partial<DownloadDefaults>): void {
  if (Object.keys(defaults).length === 0) return
  // If the server doesn't save them, this browser keeps them until a page load brings the server's.
  saveDownloadDefaults(defaults).catch(() => {})
}

async function load(started: number): Promise<void> {
  let saved: Partial<DownloadDefaults>
  try {
    saved = (await getServerSettings()).downloads ?? {}
  } catch {
    // No server, or it didn't answer: this browser's defaults apply.
    if (started === generation) failedAt = Date.now()
    return
  } finally {
    if (started === generation) loading = false
  }
  if (started !== generation) return
  loaded = true
  failedAt = undefined

  const local = getSettings()
  const taken: Partial<Settings> = {}
  const missing: Partial<Settings> = {}
  for (const key of SERVER_KEYS) {
    if (changedWhileLoading.has(key)) continue
    const value = saved[key]
    if (value !== undefined) Object.assign(taken, { [key]: value ?? undefined })
    else if (local[key] !== DEFAULT_SETTINGS[key]) Object.assign(missing, { [key]: local[key] })
  }
  if (Object.keys(taken).length > 0) apply(taken)
  share(serverPart(missing))
}

/**
 * Takes the server's download defaults. A default the server doesn't have yet but this browser
 * changed is sent to it, so what was set before the defaults moved to the server isn't lost.
 */
export function loadServerSettings(): void {
  if (loaded || loading || (failedAt !== undefined && Date.now() - failedAt < RETRY_MS)) return
  loading = true
  changedWhileLoading.clear()
  void load(generation)
}

export function updateSettings(changes: Partial<Settings>): void {
  apply(changes)
  const shared = serverPart(changes)
  if (loading) for (const key of Object.keys(shared) as ServerKey[]) changedWhileLoading.add(key)
  share(shared)
}

/** For tests. */
export function resetSettings(): void {
  current = undefined
  generation += 1
  loaded = false
  loading = false
  failedAt = undefined
  changedWhileLoading.clear()
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
  useEffect(loadServerSettings, [])
  const settings = useSyncExternalStore(subscribe, getSettings)
  return [settings, useCallback((changes: Partial<Settings>) => updateSettings(changes), [])]
}

/** The TMDB language tag to request: the chosen one, or the interface language's. */
export function useTmdbLanguage(): string {
  const { i18n } = useTranslation()
  const [settings] = useSettings()
  return settings.tmdbLanguage === 'app' ? tmdbLanguage(i18n.resolvedLanguage ?? i18n.language) : settings.tmdbLanguage
}
