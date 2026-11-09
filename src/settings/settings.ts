import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { getServerSettings, saveDownloadDefaults, type DownloadDefaults } from '../api/settings'
import { tmdbLanguage } from '../api/tmdb'
import {
  DEFAULT_SORT,
  NO_REMEMBERED_FILTERS,
  knownReleaseFilters,
  knownReleaseSort,
  type RememberedFilters,
  type Sort,
} from '../releases/filterReleases'
import { knownOrder, type DownloadSort } from '../torrents/sort'

/**
 * Preferences from the Settings screen, kept in this browser. The download defaults (categories,
 * start paused, sequential, first and last pieces first) are also kept on the Kinopeer server, so
 * every device has the same: the server's win when they load, and changes go to both. Without the
 * server they stay in this browser only. Connection settings live on the server alone.
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
  /** New downloads fetch the start and end of each file first (with sequential, a player can open it early). */
  firstLastPieces: boolean
  /** Language of titles and overviews from TMDB; 'app' follows the interface language. */
  tmdbLanguage: 'app' | 'en-US' | 'ru-RU'
  /** How the downloads list is shown on a phone or tablet. */
  downloadsView: 'list' | 'grid'
  /** The same on desktop, kept apart because the layouts differ: a table or a wider grid. */
  downloadsDesktopView: 'list' | 'grid'
  /** How the downloads list is ordered. */
  downloadsSort: DownloadSort
  /** Its direction; set together with the sort. */
  downloadsSortDescending: boolean
  /** The release filters picked last, which the next title's search starts from. */
  releaseFilters: RememberedFilters
  /** How releases are ordered. */
  releaseSort: Sort
}

export const SETTINGS_STORAGE_KEY = 'kinopeer.settings'

export const DEFAULT_SETTINGS: Settings = {
  startPaused: false,
  sequential: false,
  firstLastPieces: false,
  tmdbLanguage: 'app',
  downloadsView: 'list',
  downloadsDesktopView: 'grid',
  downloadsSort: 'priority',
  downloadsSortDescending: false,
  releaseFilters: NO_REMEMBERED_FILTERS,
  releaseSort: DEFAULT_SORT,
}

type ServerKey = keyof DownloadDefaults

/** The settings the server keeps too: a Record, so a default added to DownloadDefaults fails typecheck until it's here. */
const SERVER_KEY_SET: Record<ServerKey, true> = {
  movieCategory: true,
  tvCategory: true,
  startPaused: true,
  sequential: true,
  firstLastPieces: true,
}
const SERVER_KEYS = Object.keys(SERVER_KEY_SET) as ServerKey[]

let current: Settings | undefined
// The stored string the settings were last read from or saved as, so another tab's event that brings
// nothing new changes nothing here.
let lastStored: string | null | undefined
const listeners = new Set<() => void>()

function read(): Settings {
  try {
    lastStored = localStorage.getItem(SETTINGS_STORAGE_KEY)
    const stored = JSON.parse(lastStored ?? '{}') as Partial<Settings>
    const order = knownOrder(stored.downloadsSort, stored.downloadsSortDescending)
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      // Checked here, so a value from another version or a hand edit can't break a screen that reads them.
      downloadsSort: order.key,
      downloadsSortDescending: order.descending,
      releaseFilters: knownReleaseFilters(stored.releaseFilters),
      releaseSort: knownReleaseSort(stored.releaseSort),
    }
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
  const stored = JSON.stringify(current)
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, stored)
    lastStored = stored
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
  lastStored = undefined
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

/**
 * Follows the settings another tab saves, or storage cleared there: reads them again, so this tab
 * shows them and its next change doesn't write its old copy over them. Called once at startup;
 * returns a function that stops it.
 */
export function initSettingsSync(): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea !== localStorage) return
    if (event.key !== SETTINGS_STORAGE_KEY && event.key !== null) return
    let stored: string | null
    try {
      stored = localStorage.getItem(SETTINGS_STORAGE_KEY)
    } catch {
      return
    }
    if (stored === lastStored) return
    current = read()
    listeners.forEach((listener) => listener())
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
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
