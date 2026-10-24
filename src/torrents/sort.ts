import type { Torrent } from '../api/qbittorrent'
import { compareByQueue, downloadStatus } from './status'

/** Orders for the downloads list; `priority` is qBittorrent's queue order. */
export const DOWNLOAD_SORTS = ['priority', 'added', 'name', 'progress', 'size', 'speed', 'eta'] as const
export type DownloadSort = (typeof DOWNLOAD_SORTS)[number]

type Compare = (a: Torrent, b: Torrent) => number

/** Seconds left, or null where the row shows none (only a downloading torrent with speed has one). */
function timeLeft(torrent: Torrent): number | null {
  // qBittorrent's 8640000 (100 days) means "unknown".
  return downloadStatus(torrent) === 'downloading' && torrent.dlspeed > 0 && torrent.eta < 8_640_000
    ? torrent.eta
    : null
}

function byTimeLeft(a: Torrent, b: Torrent): number {
  const aLeft = timeLeft(a)
  const bLeft = timeLeft(b)
  if (aLeft === null || bLeft === null) return aLeft === bLeft ? 0 : aLeft === null ? 1 : -1
  return aLeft - bLeft
}

/**
 * Compares torrents for `sort`, with ties in queue order. Each order has one direction: newest,
 * A to Z by `titleOf` (the title the row shows), most progress, largest, fastest (download speed,
 * then upload), soonest done (torrents without a time left go last).
 */
export function compareTorrents(sort: DownloadSort, titleOf: (torrent: Torrent) => string): Compare {
  const first: Compare | undefined = {
    priority: undefined,
    added: (a: Torrent, b: Torrent) => b.added_on - a.added_on,
    name: (a: Torrent, b: Torrent) =>
      titleOf(a).localeCompare(titleOf(b), undefined, { numeric: true, sensitivity: 'base' }),
    progress: (a: Torrent, b: Torrent) => b.progress - a.progress,
    size: (a: Torrent, b: Torrent) => b.size - a.size,
    speed: (a: Torrent, b: Torrent) => b.dlspeed - a.dlspeed || b.upspeed - a.upspeed,
    eta: byTimeLeft,
  }[sort]
  return first ? (a, b) => first(a, b) || compareByQueue(a, b) : compareByQueue
}

/** A stored sort that's no longer offered falls back to the queue. */
export function knownSort(sort: string | undefined): DownloadSort {
  return DOWNLOAD_SORTS.includes(sort as DownloadSort) ? (sort as DownloadSort) : 'priority'
}
