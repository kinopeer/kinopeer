import type { Torrent } from '../api/qbittorrent'

export type Outcome = { ok: true } | { ok: false; error: unknown }

/** How a request settled, and whether something showing its torrent took the outcome (else the
 *  caller says it elsewhere, in a toast). */
export type Settled = Outcome & { showing: boolean }

/** Something that shows one torrent for a kind of request, as a sheet does while it's open. */
export interface RequestWatcher {
  /** Whether it shows this torrent now, asked when a request for it settles. */
  shows: (target: Torrent) => boolean
  /** A request for the torrent it shows settled, having sent `sent`. */
  settled: (outcome: Outcome, sent: unknown) => void
}

/** What's in flight, by `requestKey`. Replaced, never changed, so it can be a snapshot. */
export type InFlight = ReadonlyMap<string, unknown>

/** The app's requests to qBittorrent about one torrent (moving its files, its speed limits). */
export interface TorrentRequests {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => InFlight
  /**
   * Sends a request of a kind for a torrent and says how it settled, or nothing when one of that kind
   * is already in flight for it: it never goes out twice.
   */
  send: (kind: string, target: Torrent, payload: unknown, request: () => Promise<void>) => Promise<Settled | undefined>
  /** Hands the outcome of each request of a kind to `watcher` while it shows the request's torrent. */
  watch: (kind: string, watcher: RequestWatcher) => () => void
}

/**
 * By hash alone, not when the torrent was added: qBittorrent applies a request to the hash, so one
 * still in flight for a torrent deleted and added again goes to the new one, which shows it busy
 * rather than letting it go out twice.
 */
export const requestKey = (kind: string, hash: string) => `${kind}|${hash}`

/**
 * Requests in flight, shared by every screen under one store, so a sheet for a torrent shows a
 * request sent from another screen (Downloads under the drawer) and gets its outcome. The outcome
 * goes to every watcher of the kind showing the torrent when it settles; with none, the caller says it.
 */
export function createTorrentRequests(): TorrentRequests {
  let inFlight: InFlight = new Map()
  const listeners = new Set<() => void>()
  const watchers = new Map<string, Set<RequestWatcher>>()

  const set = (next: InFlight) => {
    inFlight = next
    listeners.forEach((listener) => listener())
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => inFlight,
    async send(kind, target, payload, request) {
      const key = requestKey(kind, target.hash)
      if (inFlight.has(key)) return undefined
      set(new Map(inFlight).set(key, payload))
      let outcome: Outcome
      try {
        await request()
        outcome = { ok: true }
      } catch (error) {
        outcome = { ok: false, error }
      }
      const next = new Map(inFlight)
      next.delete(key)
      set(next)
      const showing = [...(watchers.get(kind) ?? [])].filter((watcher) => watcher.shows(target))
      showing.forEach((watcher) => watcher.settled(outcome, payload))
      return { ...outcome, showing: showing.length > 0 }
    },
    watch(kind, watcher) {
      const ofKind = watchers.get(kind) ?? new Set()
      watchers.set(kind, ofKind.add(watcher))
      return () => {
        ofKind.delete(watcher)
      }
    },
  }
}
