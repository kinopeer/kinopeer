import { getTorrents, type Torrent } from '../api/qbittorrent'

/**
 * qBittorrent's torrents asked once with `torrents/info`, for a screen that wants to know what's in
 * downloads before the shared poll has run on this page (Search opened first on a phone). Not a
 * `getMainData`, which would reset the poll's `rid` (docs/ARCHITECTURE.md → Torrent state and the
 * poll). The answer is kept for the page: what's in it may be a little behind, which is accepted;
 * once the poll has data, the screens read that instead.
 */
let torrents: Torrent[] | undefined
let loading: Promise<void> | undefined
let failedAt: number | undefined
// Bumped by resetOneOffTorrents, so a load from before it is ignored.
let generation = 0
const listeners = new Set<() => void>()

/** When qBittorrent didn't answer, the next screen that wants the list asks again after this. */
export const ONE_OFF_RETRY_MS = 60_000

/** Calls `listener` when the list arrives; returns what stops it. */
export function subscribeOneOffTorrents(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The list asked for, or undefined until an answer came. */
export const currentOneOffTorrents = (): Torrent[] | undefined => torrents

/** Asks for the list unless it's here or on its way, or asks again once a failure is a minute old. */
export function loadOneOffTorrents(): void {
  if (torrents || loading) return
  if (failedAt !== undefined && Date.now() - failedAt <= ONE_OFF_RETRY_MS) return
  const started = generation
  loading = getTorrents().then(
    (answer) => {
      if (started !== generation) return
      torrents = answer
      failedAt = undefined
      for (const listener of listeners) listener()
    },
    () => {
      if (started !== generation) return
      // No mark is shown without it; nothing else on the screen waits for it.
      failedAt = Date.now()
    },
  )
  void loading.finally(() => {
    if (started === generation) loading = undefined
  })
}

/** Forgets the list, for tests. */
export function resetOneOffTorrents(): void {
  generation++
  torrents = undefined
  loading = undefined
  failedAt = undefined
}
