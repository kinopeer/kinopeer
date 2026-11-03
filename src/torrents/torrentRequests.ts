import type { Torrent } from '../api/qbittorrent'
import type { SyncState } from './sync'

export type Outcome = { ok: true } | { ok: false; error: unknown }

/** How a request settled, and whether something showing its torrents took the outcome (else the
 *  caller says it elsewhere, in a toast). */
export type Settled = Outcome & { showing: boolean }

/** Something that shows one torrent for a kind of request, as a sheet does while it's open. */
export interface RequestWatcher {
  /** Whether it shows this torrent now, asked when a request for it settles. */
  shows: (target: Torrent) => boolean
  /** A request for the torrent it shows settled, having sent `sent` for `targets`. */
  settled: (outcome: Outcome, sent: unknown, targets: readonly Torrent[]) => void
}

/** What's in flight, by `requestKey`. Replaced, never changed, so it can be a snapshot. */
export type InFlight = ReadonlyMap<string, unknown>

/** The state a request gives a torrent, or none when it takes the torrent away (a delete). */
export type Expect = (torrent: Torrent) => Torrent | undefined

/** A state qBittorrent took for a torrent, shown until a poll sent at `until` or later says. */
export interface Expectation {
  hash: string
  expect: Expect
  /** When qBittorrent answered the request, plus its `hold` (ms since epoch). */
  until: number
}

/** The states requests set, by `requestKey`. Replaced, never changed, so it can be a snapshot. */
export type Expected = ReadonlyMap<string, Expectation>

/** The poll the requests keep in step with: polled again after a request, asked when it was last sent. */
export interface RequestsPoll {
  refresh: () => void
  getSnapshot: () => { requestedAt: number | null }
}

export interface SendOptions {
  /**
   * The state the request gives a torrent: once qBittorrent took it, the torrent shows that state
   * (`withExpected`) until a poll sent after the answer, or `hold` after it, has the final word, even
   * if it disagrees. The poll is asked again when the request settles, either way.
   */
  expect?: Expect
  /**
   * How long qBittorrent may still report a torrent's old state after taking the request (ms), read
   * when it answers: polls sent meanwhile don't have the final word.
   */
  hold?: () => number
  /** A part of each torrent the request is about (a file), so one per part is in flight, not per torrent. */
  part?: string
}

/** The app's requests to qBittorrent about torrents (`REQUEST_KINDS`). */
export interface TorrentRequests {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => InFlight
  getExpected: () => Expected
  /**
   * Sends a request of a kind for one torrent or several in one go, and says how it settled. A torrent
   * with one of that kind in flight is left out, so it never goes out twice; with none left, nothing
   * is sent and it says nothing. `request` gets the hashes that are sent.
   */
  send: (
    kind: string,
    target: Torrent | readonly Torrent[],
    payload: unknown,
    request: (hashes: string[]) => Promise<void>,
    options?: SendOptions,
  ) => Promise<Settled | undefined>
  /** Hands the outcome of each request of a kind to `watcher` while it shows the request's torrent. */
  watch: (kind: string, watcher: RequestWatcher) => () => void
}

/**
 * By hash alone, not when the torrent was added: qBittorrent applies a request to the hash, so one
 * still in flight for a torrent deleted and added again goes to the new one, which shows it busy
 * rather than letting it go out twice. With `part`, for that part of the torrent (`SendOptions`),
 * which the torrent's own key doesn't cover: a part's request isn't found by `requestKey(kind, hash)`.
 */
export const requestKey = (kind: string, hash: string, part?: string) =>
  part === undefined ? `${kind}|${hash}` : `${kind}|${hash}|${part}`

/** What's being sent for the parts of a torrent (`SendOptions.part`) in requests of a kind, whatever the parts. */
export const inFlightParts = (inFlight: InFlight, kind: string, hash: string): unknown[] => {
  const prefix = requestKey(kind, hash, '')
  return [...inFlight].filter(([key]) => key.startsWith(prefix)).map(([, payload]) => payload)
}

/**
 * Requests in flight, shared by every screen under one store, so a sheet for a torrent shows a
 * request sent from another screen (Downloads under the drawer) and gets its outcome. The outcome
 * goes to every watcher of the kind showing one of its torrents when it settles; when some torrent
 * has none, the caller says it. Linked to `poll`, it polls again after a request that expects a
 * state, and keeps that state only until a poll has it.
 */
export function createTorrentRequests(poll?: RequestsPoll): TorrentRequests {
  let inFlight: InFlight = new Map()
  let expected: Expected = new Map()
  const listeners = new Set<() => void>()
  const watchers = new Map<string, Set<RequestWatcher>>()

  const notify = () => listeners.forEach((listener) => listener())

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => inFlight,
    getExpected: () => expected,
    async send(kind, target, payload, request, options) {
      const { expect, hold, part } = options ?? {}
      const targets = (Array.isArray(target) ? target : [target]).filter(
        (item: Torrent) => !inFlight.has(requestKey(kind, item.hash, part)),
      )
      if (targets.length === 0) return undefined
      const keys = targets.map((item) => requestKey(kind, item.hash, part))
      const sending = new Map(inFlight)
      keys.forEach((key) => sending.set(key, payload))
      inFlight = sending
      notify()

      let outcome: Outcome
      try {
        await request(targets.map((item) => item.hash))
        outcome = { ok: true }
      } catch (error) {
        outcome = { ok: false, error }
      }
      const settled = new Map(inFlight)
      keys.forEach((key) => settled.delete(key))
      inFlight = settled
      if (outcome.ok && expect) {
        const until = Date.now() + (hold?.() ?? 0)
        // Without the ones a poll has had its word on since, so they don't pile up.
        const polled = poll?.getSnapshot().requestedAt ?? null
        const next = new Map([...expected].filter(([, item]) => polled === null || polled < item.until))
        // Taken out first, so the order they're applied in is the order qBittorrent took them.
        targets.forEach((item, index) => {
          next.delete(keys[index])
          next.set(keys[index], { hash: item.hash, expect, until })
        })
        expected = next
      }
      notify()
      // Then a poll has the torrents' state, whichever way it went. Move files and speed limits still
      // poll again themselves.
      if (expect) poll?.refresh()

      // Asked before any is told, since a watcher told may stop showing the torrent (a sheet closes).
      const ofKind = [...(watchers.get(kind) ?? [])]
      const showing = targets.map((item) => ofKind.filter((watcher) => watcher.shows(item)))
      new Set(showing.flat()).forEach((watcher) => watcher.settled(outcome, payload, targets))
      return { ...outcome, showing: showing.every((shownBy) => shownBy.length > 0) }
    },
    watch(kind, watcher) {
      const ofKind = watchers.get(kind) ?? new Set()
      watchers.set(kind, ofKind.add(watcher))
      return () => {
        ofKind.delete(watcher)
        if (ofKind.size === 0) watchers.delete(kind)
      }
    },
  }
}

/**
 * The poll's state with the states requests expect, for the torrents a poll sent before their
 * `until` may still have old, without those a request takes away. A poll sent at `until` or later
 * went out after qBittorrent took the request and, with a hold, had time to report it, so it has the
 * final word.
 */
export function withExpected(data: SyncState | null, requestedAt: number | null, expected: Expected): SyncState | null {
  if (!data || expected.size === 0) return data
  let torrents: Record<string, Torrent> | undefined
  for (const { hash, expect, until } of expected.values()) {
    const torrent = (torrents ?? data.torrents)[hash]
    if (!torrent || (requestedAt !== null && requestedAt >= until)) continue
    torrents ??= { ...data.torrents }
    const shown = expect(torrent)
    if (shown) torrents[hash] = shown
    else delete torrents[hash]
  }
  return torrents ? { ...data, torrents } : data
}
