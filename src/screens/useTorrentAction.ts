import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import type { Torrent } from '../api/qbittorrent'
import type { RequestKind } from '../torrents/requestKinds'
import { requestKey, type Outcome, type SendOptions, type Settled } from '../torrents/torrentRequests'
import { useTorrentRequests } from '../torrents/useTorrentRequests'

export interface TorrentAction {
  /** Whether one of the kind is in flight for the torrent, sent from anywhere. */
  busy: (hash: string) => boolean
  /** What's being sent for the torrent while it is, from anywhere. */
  pending: (hash: string) => unknown
  /** Sends one of the kind for the torrents without one in flight (`TorrentRequests.send`). */
  send: (
    target: Torrent | readonly Torrent[],
    payload: unknown,
    request: (hashes: string[]) => Promise<void>,
    options?: SendOptions,
  ) => Promise<Settled | undefined>
}

/**
 * Something that shows torrents and says itself how a request of a kind for them went (the More
 * menu, the delete confirmation).
 */
export interface ActionWatcher {
  torrents: readonly Torrent[]
  /** A request for some of them settled, sent for `targets`. */
  settled: (outcome: Outcome, targets: readonly Torrent[]) => void
}

/**
 * One kind of the app's torrent requests (`useTorrentRequests`) for a place that sends it or shows it
 * busy, wherever it was sent from. With `watcher`, the place takes the outcome of each one for the
 * torrent it shows, so the caller doesn't say it elsewhere.
 */
export function useTorrentAction(kind: RequestKind, watcher?: ActionWatcher): TorrentAction {
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
      shows: (target) =>
        !!shown.current?.torrents.some((item) => item.hash === target.hash && item.added_on === target.added_on),
      settled: (outcome, _sent, targets) => shown.current?.settled(outcome, targets),
    })
  }, [requests, kind, watching])

  const send = useCallback<TorrentAction['send']>(
    (target, payload, request, options) => requests.send(kind, target, payload, request, options),
    [requests, kind],
  )
  return {
    busy: (hash) => inFlight.has(requestKey(kind, hash)),
    pending: (hash) => inFlight.get(requestKey(kind, hash)),
    send,
  }
}
