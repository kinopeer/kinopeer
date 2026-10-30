import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { UnauthorizedError, getMainData } from '../api/qbittorrent'
import { EMPTY_SYNC_STATE, applyMainData, type SyncState } from './sync'
import { withExpected, type Expected } from './torrentRequests'
import { TorrentRequestsContext } from './useTorrentRequests'

export const POLL_INTERVAL_MS = 2_000
/** Slower retries while qBittorrent doesn't answer. */
export const OFFLINE_POLL_INTERVAL_MS = 5_000

export interface MainDataSnapshot {
  /** Null until the first response arrives. */
  data: SyncState | null
  /** The last request failed; `data` holds the last known state. */
  offline: boolean
  /** When `data` last arrived (ms since epoch), or null before the first response. */
  updatedAt: number | null
  /** When the request that brought `data` was sent: what happened before that is in `data`. */
  requestedAt: number | null
}

export interface MainDataState extends MainDataSnapshot {
  /** Polls right away instead of waiting for the next tick. */
  refresh: () => void
}

/** One poll of /sync/maindata for everyone subscribed to it. */
export interface MainDataStore {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => MainDataSnapshot
  refresh: () => void
  /** Called once if the session expires. */
  setUnauthorizedHandler: (handler: () => void) => void
}

/**
 * Polls /sync/maindata while anyone is subscribed and the page is visible, and right away when the
 * device comes back online. Calls the unauthorized handler once if the session expires, and stops for good.
 * The last state stays when the last subscriber leaves, so the next one starts from it.
 */
export function createMainDataStore(): MainDataStore {
  let onUnauthorized = () => {}
  let snapshot: MainDataSnapshot = { data: null, offline: false, updatedAt: null, requestedAt: null }
  let state = EMPTY_SYNC_STATE
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let inFlight = false
  // Refreshed while a poll was in flight: that request went out before what the caller changed, so
  // poll again as soon as it's answered.
  let refreshed = false
  let unauthorized = false

  const update = (changes: Partial<MainDataSnapshot>) => {
    snapshot = { ...snapshot, ...changes }
    listeners.forEach((listener) => listener())
  }

  const schedule = (delay: number) => {
    clearTimeout(timer)
    if (running && !document.hidden) timer = setTimeout(() => void poll(), delay)
  }

  const poll = async () => {
    if (inFlight || !running) return
    inFlight = true
    refreshed = false
    clearTimeout(timer)
    let delay = POLL_INTERVAL_MS
    try {
      const requestedAt = Date.now()
      state = applyMainData(state, await getMainData(state.rid))
      if (!running) return
      update({ data: state, updatedAt: Date.now(), requestedAt, offline: false })
    } catch (error) {
      if (!running) return
      if (error instanceof UnauthorizedError) {
        unauthorized = true
        stop()
        onUnauthorized()
        return
      }
      update({ offline: true })
      delay = OFFLINE_POLL_INTERVAL_MS
    } finally {
      inFlight = false
    }
    schedule(refreshed ? 0 : delay)
  }

  const onVisibilityChange = () => {
    if (document.hidden) clearTimeout(timer)
    else void poll()
  }
  const onOnline = () => void poll()

  const start = () => {
    if (running || unauthorized) return
    running = true
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('online', onOnline)
    void poll()
  }

  function stop() {
    running = false
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('online', onOnline)
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      clearTimeout(idleTimer)
      start()
      return () => {
        listeners.delete(listener)
        // A screen that replaces another subscribes right after the old one leaves: keep polling.
        if (listeners.size === 0) idleTimer = setTimeout(() => listeners.size === 0 && stop(), 0)
      }
    },
    getSnapshot: () => snapshot,
    refresh: () => {
      if (inFlight) refreshed = true
      else void poll()
    },
    setUnauthorizedHandler: (handler) => {
      onUnauthorized = handler
    },
  }
}

/** The app's shared poll, provided by `MainDataProvider`. */
export const MainDataContext = createContext<MainDataStore | null>(null)

const NOTHING_EXPECTED: Expected = new Map()
const noRequests = () => () => {}
const nothingExpected = () => NOTHING_EXPECTED

/**
 * qBittorrent's torrents and server state. Inside `MainDataProvider` every caller shares its poll
 * (and the provider's `onUnauthorized` applies); elsewhere, as in tests, the caller polls on its own.
 * Under a `TorrentRequestsProvider` a torrent shows the state a request gave it (paused, resumed)
 * from when qBittorrent took it until a poll sent after that has it.
 */
export function useMainData(onUnauthorized?: () => void): MainDataState {
  const requests = useContext(TorrentRequestsContext)
  const expected = useSyncExternalStore(requests?.subscribe ?? noRequests, requests?.getExpected ?? nothingExpected)
  const shared = useContext(MainDataContext)
  const [own] = useState(() => (shared ? null : createMainDataStore()))
  useEffect(() => {
    if (own && onUnauthorized) own.setUnauthorizedHandler(onUnauthorized)
  }, [own, onUnauthorized])
  const store = shared ?? own!
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return useMemo(
    () => ({ ...snapshot, data: withExpected(snapshot.data, snapshot.requestedAt, expected), refresh: store.refresh }),
    [snapshot, expected, store],
  )
}
