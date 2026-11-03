import { getRefreshInterval } from '../api/qbittorrent'

/** qBittorrent's "Refresh interval" by default (ms). */
export const DEFAULT_REFRESH_INTERVAL_MS = 1_500
/** What qBittorrent takes past its refresh interval to post the new states, and a poll to reach it. */
export const STATE_LAG_MARGIN_MS = 500

// Read once per page, again after a failure.
let refreshInterval: number | undefined
let reading: Promise<void> | undefined

/**
 * Reads qBittorrent's refresh interval for `stateLag`, unless it's read or being read, and settles
 * once it's read or the read failed.
 */
export function readRefreshInterval(): Promise<void> {
  if (refreshInterval !== undefined) return Promise.resolve()
  if (reading) return reading
  const read: Promise<void> = getRefreshInterval()
    .then((interval) => {
      // Unless `resetStateLag` came in between.
      if (reading === read) refreshInterval = interval ?? DEFAULT_REFRESH_INTERVAL_MS
    })
    // qBittorrent didn't answer: its default applies until the next pause or resume reads it again.
    .catch(() => {})
    .finally(() => {
      if (reading === read) reading = undefined
    })
  reading = read
  return read
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
  reading = undefined
}
