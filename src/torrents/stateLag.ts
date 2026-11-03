import { getRefreshInterval } from '../api/qbittorrent'

/** qBittorrent's "Refresh interval" by default (ms). */
export const DEFAULT_REFRESH_INTERVAL_MS = 1_500
/** What qBittorrent takes past its refresh interval to post the new states, and a poll to reach it. */
export const STATE_LAG_MARGIN_MS = 500

// Read once per page, again after a failure.
let refreshInterval: number | undefined
let reading = false
// Bumped by resetStateLag, so a read from before it is ignored.
let generation = 0

async function read(started: number): Promise<void> {
  try {
    const interval = await getRefreshInterval()
    if (started === generation) refreshInterval = interval ?? DEFAULT_REFRESH_INTERVAL_MS
  } catch {
    // qBittorrent didn't answer: its default applies until the next pause or resume reads it again.
  } finally {
    if (started === generation) reading = false
  }
}

/** Starts reading qBittorrent's refresh interval for `stateLag`, unless it's read or being read. */
export function readRefreshInterval(): void {
  if (refreshInterval !== undefined || reading) return
  reading = true
  void read(generation)
}

/**
 * How long after taking a pause or resume qBittorrent may still report a torrent's old state (ms):
 * it sets the state it reports only when it updates the torrents' states, once per refresh interval
 * (`TorrentImpl::stop` and `start` in qBittorrent 5.1, and on its master as of November 2026). Its
 * default interval until `readRefreshInterval` has read it.
 */
export function stateLag(): number {
  return (refreshInterval ?? DEFAULT_REFRESH_INTERVAL_MS) + STATE_LAG_MARGIN_MS
}

/** For tests. */
export function resetStateLag(): void {
  refreshInterval = undefined
  reading = false
  generation += 1
}
