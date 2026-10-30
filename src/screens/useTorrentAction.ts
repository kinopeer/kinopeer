import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import type { Torrent } from '../api/qbittorrent'
import { requestKey, type Outcome, type SendOptions, type Settled } from '../torrents/torrentRequests'
import { useTorrentRequests } from '../torrents/useTorrentRequests'

export interface TorrentAction {
  /** Whether one of the kind is in flight for the torrent, sent from anywhere. */
  busy: (hash: string) => boolean
  /** Sends one of the kind for the torrents without one in flight (`TorrentRequests.send`). */
  send: (
    target: Torrent | readonly Torrent[],
    payload: unknown,
    request: (hashes: string[]) => Promise<void>,
    options?: SendOptions,
  ) => Promise<Settled | undefined>
}

/** Something that shows one torrent and says itself how a request of a kind for it went (the More menu). */
export interface ActionWatcher {
  torrent: Torrent
  settled: (outcome: Outcome) => void
}

/**
 * One kind of the app's torrent requests (`useTorrentRequests`) for a place that sends it or shows it
 * busy, wherever it was sent from. With `watcher`, the place takes the outcome of each one for the
 * torrent it shows, so the caller doesn't say it elsewhere.
 */
export function useTorrentAction(kind: string, watcher?: ActionWatcher): TorrentAction {
  const requests = useTorrentRequests()
  const inFlight = useSyncExternalStore(requests.subscribe, requests.getSnapshot)

  // Read when a request settles, so it's whatever the watcher shows then.
  const shown = useRef(watcher)
  useLayoutEffect(() => {
    shown.current = watcher
  })
  const watching = watcher !== undefined
  useEffect(() => {
    if (!watching) return
    return requests.watch(kind, {
      shows: (target) => shown.current?.torrent.hash === target.hash && shown.current.torrent.added_on === target.added_on,
      settled: (outcome) => shown.current?.settled(outcome),
    })
  }, [requests, kind, watching])

  const send = useCallback<TorrentAction['send']>(
    (target, payload, request, options) => requests.send(kind, target, payload, request, options),
    [requests, kind],
  )
  return { busy: (hash) => inFlight.has(requestKey(kind, hash)), send }
}
