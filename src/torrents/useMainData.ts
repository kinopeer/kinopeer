import { useCallback, useEffect, useRef, useState } from 'react'
import { UnauthorizedError, getMainData } from '../api/qbittorrent'
import { EMPTY_SYNC_STATE, applyMainData, type SyncState } from './sync'

export const POLL_INTERVAL_MS = 2_000
/** Slower retries while qBittorrent doesn't answer. */
export const OFFLINE_POLL_INTERVAL_MS = 5_000

export interface MainDataState {
  /** Null until the first response arrives. */
  data: SyncState | null
  /** The last request failed; `data` holds the last known state. */
  offline: boolean
  /** Polls right away instead of waiting for the next tick. */
  refresh: () => void
}

/**
 * Polls /sync/maindata while the page is visible. Calls `onUnauthorized` once if the session
 * expires, and stops polling until remounted.
 */
export function useMainData(onUnauthorized: () => void): MainDataState {
  const [data, setData] = useState<SyncState | null>(null)
  const [offline, setOffline] = useState(false)
  const refreshRef = useRef<() => void>(() => {})
  const onUnauthorizedRef = useRef(onUnauthorized)

  useEffect(() => {
    onUnauthorizedRef.current = onUnauthorized
  }, [onUnauthorized])

  useEffect(() => {
    let state = EMPTY_SYNC_STATE
    let timer: ReturnType<typeof setTimeout> | undefined
    let inFlight = false
    let stopped = false

    const schedule = (delay: number) => {
      clearTimeout(timer)
      if (!stopped && !document.hidden) timer = setTimeout(() => void poll(), delay)
    }

    const poll = async () => {
      if (inFlight || stopped) return
      inFlight = true
      clearTimeout(timer)
      let delay = POLL_INTERVAL_MS
      try {
        state = applyMainData(state, await getMainData(state.rid))
        if (stopped) return
        setData(state)
        setOffline(false)
      } catch (error) {
        if (stopped) return
        if (error instanceof UnauthorizedError) {
          stopped = true
          onUnauthorizedRef.current()
          return
        }
        setOffline(true)
        delay = OFFLINE_POLL_INTERVAL_MS
      } finally {
        inFlight = false
      }
      schedule(delay)
    }

    const onVisibilityChange = () => {
      if (document.hidden) clearTimeout(timer)
      else void poll()
    }

    refreshRef.current = () => void poll()
    document.addEventListener('visibilitychange', onVisibilityChange)
    void poll()

    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  const refresh = useCallback(() => refreshRef.current(), [])

  return { data, offline, refresh }
}
