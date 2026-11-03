import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { UnauthorizedError, getMainData } from '../api/qbittorrent'
import { freeSpace } from './freeSpace'
import { EMPTY_SYNC_STATE, applyMainData, type SyncState } from './sync'
import { withExpected, type Expected } from './torrentRequests'
import { TorrentRequestsContext } from './useTorrentRequests'

export const POLL_INTERVAL_MS = 2_000
/** Slower retries while qBittorrent doesn't answer. */
export const OFFLINE_POLL_INTERVAL_MS = 5_000
/**
 * A poll that hasn't been answered in this long is given up and counts as a failure, so the screens
 * say qBittorrent isn't answering instead of showing ever older data while the request hangs. Five
 * intervals: a full answer for thousands of torrents from a small home server over Wi-Fi takes a
 * second or two, and by 10 s the data shown is already 12 s old, which is worth saying.
 */
export const POLL_TIMEOUT_MS = 10_000

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

/** What the poll is doing, apart from the data, so what shows it renders without the screens. */
export interface PollState {
  /** A request is waiting for qBittorrent's answer. */
  inFlight: boolean
  /** The last request failed. */
  offline: boolean
  /** When the last answer arrived (ms since epoch), or null before the first one. */
  updatedAt: number | null
}

/** The poll's state, for a component that subscribes to it on its own. */
export interface PollSource {
  subscribe: (listener: () => void) => () => void
  getPollState: () => PollState
}

export interface MainDataState extends MainDataSnapshot {
  /** Polls right away instead of waiting for the next tick. */
  refresh: () => void
  /** The poll's own state (`PollState`), which changes more often than the data. */
  poll: PollSource
}

/** One poll of /sync/maindata for everyone subscribed to it. */
export interface MainDataStore extends PollSource {
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
  let pollState: PollState = { inFlight, offline: snapshot.offline, updatedAt: snapshot.updatedAt }
  // Refreshed while a poll was in flight: that request went out before what the caller changed, so
  // poll again as soon as it's answered.
  let refreshed = false
  let unauthorized = false
  // Gives up the poll in flight without counting it as a failure.
  let dropInFlight = () => {}

  // The data's snapshot and the poll's state are separate objects, so a request going out renders
  // only what shows the poll, not every screen that reads the data. Called only when a request goes
  // out or settles, so the poll's state is new every time.
  const update = (changes: Partial<MainDataSnapshot>) => {
    if (Object.keys(changes).length > 0) snapshot = { ...snapshot, ...changes }
    pollState = { inFlight, offline: snapshot.offline, updatedAt: snapshot.updatedAt }
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
    update({})
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS)
    let dropped = false
    dropInFlight = () => {
      dropped = true
      controller.abort()
    }
    let delay = POLL_INTERVAL_MS
    let changes: Partial<MainDataSnapshot>
    try {
      const requestedAt = Date.now()
      state = applyMainData(state, await getMainData(state.rid, controller.signal))
      changes = { data: state, updatedAt: Date.now(), requestedAt, offline: false }
    } catch (error) {
      if (running && error instanceof UnauthorizedError) {
        unauthorized = true
        stop()
        onUnauthorized()
        return
      }
      // Dropped: not qBittorrent's failure, so the screens keep what they showed.
      changes = dropped ? {} : { offline: true }
      delay = OFFLINE_POLL_INTERVAL_MS
    } finally {
      clearTimeout(timeout)
      dropInFlight = () => {}
      inFlight = false
    }
    // Stopped meanwhile: the answer is dropped, and only the poll's state says nothing is in flight.
    update(running ? changes : {})
    schedule(refreshed ? 0 : delay)
  }

  // A poll in flight may hang until its timeout, so it's given up and sent again, at once, rather
  // than waited for (10 s, then the offline interval).
  const pollNow = () => {
    if (!inFlight) return void poll()
    refreshed = true
    dropInFlight()
  }
  // A hidden page drops its poll too: the timeout would mark it offline while nobody looks, and the
  // banner and the reconnected toast would flash on return. It polls again when it's back.
  const onVisibilityChange = () => {
    if (document.hidden) {
      clearTimeout(timer)
      dropInFlight()
    } else pollNow()
  }
  const onOnline = () => {
    if (!document.hidden) pollNow()
  }

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
    getPollState: () => pollState,
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

/** The provider's store, or outside a provider the caller's own, with `onUnauthorized` if it has one. */
function useStore(onUnauthorized?: () => void): MainDataStore {
  const shared = useContext(MainDataContext)
  const [own] = useState(() => (shared ? null : createMainDataStore()))
  useEffect(() => {
    if (own && onUnauthorized) own.setUnauthorizedHandler(onUnauthorized)
  }, [own, onUnauthorized])
  return shared ?? own!
}

/**
 * qBittorrent's torrents and server state. Inside `MainDataProvider` every caller shares its poll
 * (and the provider's `onUnauthorized` applies); elsewhere, as in tests, the caller polls on its own.
 * Under a `TorrentRequestsProvider` a torrent shows the state a request gave it (paused, resumed)
 * from when qBittorrent took it until a poll sent after that has it.
 */
export function useMainData(onUnauthorized?: () => void): MainDataState {
  const requests = useContext(TorrentRequestsContext)
  const expected = useSyncExternalStore(requests?.subscribe ?? noRequests, requests?.getExpected ?? nothingExpected)
  const store = useStore(onUnauthorized)
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return useMemo(
    () => ({
      ...snapshot,
      data: withExpected(snapshot.data, snapshot.requestedAt, expected),
      refresh: store.refresh,
      poll: store,
    }),
    [snapshot, expected, store],
  )
}

/**
 * qBittorrent's free space (`freeSpace`), through the same poll as `useMainData` but rendering only
 * when it changes, not on every poll, for a screen that needs nothing else from it.
 */
export function useFreeSpace(): number | undefined {
  const store = useStore()
  return useSyncExternalStore(store.subscribe, () => freeSpace(store.getSnapshot().data?.server.free_space_on_disk))
}
