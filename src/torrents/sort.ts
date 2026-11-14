import type { Torrent } from '../api/qbittorrent'
import { usualOrder, type SortOrder, type UsualDirections } from '../logic/sortOrder'
import { compareByQueue, downloadStatus, showsSpeed, type DownloadStatus } from './status'

/** Orders for the downloads list; `priority` is qBittorrent's queue order. */
export const DOWNLOAD_SORTS = ['priority', 'added', 'name', 'progress', 'status', 'size', 'speed', 'eta'] as const
export type DownloadSort = (typeof DOWNLOAD_SORTS)[number]

/** A sort and its direction. */
export type DownloadOrder = SortOrder<DownloadSort>

/**
 * Each sort's usual direction, the one a menu pick or a column's first click gives: the queue from
 * its first position, newest, A to Z, most progress, what needs attention first, largest, fastest, soonest done.
 */
export const DOWNLOADS_USUALLY_DESCENDING: UsualDirections<DownloadSort> = {
  priority: false,
  added: true,
  name: false,
  progress: true,
  status: false,
  size: true,
  speed: true,
  eta: false,
}

type Compare = (a: Torrent, b: Torrent) => number

/**
 * The status sort's usual order, what needs attention first: a failed torrent, then what's still to
 * come in (downloading, being checked, waiting in the queue), what's stopped half-way, and last what's
 * done (seeding, then finished and stopped).
 */
const STATUS_RANK: Record<DownloadStatus, number> = {
  error: 0,
  downloading: 1,
  checking: 2,
  queued: 3,
  paused: 4,
  seeding: 5,
  completed: 6,
}

/** Seconds left, or null where the row shows none (only a downloading torrent with speed has one). */
function timeLeft(torrent: Torrent): number | null {
  // qBittorrent's 8640000 (100 days) means "unknown".
  return downloadStatus(torrent) === 'downloading' && torrent.dlspeed > 0 && torrent.eta < 8_640_000
    ? torrent.eta
    : null
}

/** How a sort compares, smallest first; `has` is for a value some torrents lack. */
interface SortKey {
  compare: Compare
  has?: (torrent: Torrent) => boolean
}

function sortKey(sort: DownloadSort, titleOf: (torrent: Torrent) => string): SortKey {
  switch (sort) {
    case 'priority':
      return { compare: (a, b) => a.priority - b.priority, has: (torrent) => torrent.priority > 0 }
    case 'added':
      return { compare: (a, b) => a.added_on - b.added_on }
    case 'name':
      return {
        compare: (a, b) => titleOf(a).localeCompare(titleOf(b), undefined, { numeric: true, sensitivity: 'base' }),
      }
    case 'progress':
      return { compare: (a, b) => a.progress - b.progress }
    case 'status':
      return { compare: (a, b) => STATUS_RANK[downloadStatus(a)] - STATUS_RANK[downloadStatus(b)] }
    case 'size':
      return { compare: (a, b) => a.size - b.size }
    case 'speed':
      return { compare: (a, b) => a.dlspeed - b.dlspeed || a.upspeed - b.upspeed, has: (torrent) => showsSpeed(downloadStatus(torrent)) }
    case 'eta':
      return { compare: (a, b) => timeLeft(a)! - timeLeft(b)!, has: (torrent) => timeLeft(torrent) !== null }
  }
}

/**
 * Compares torrents for `order`, with ties in queue order: by queue position, date added, the title
 * the row shows (`titleOf`, numbers by value), progress, status (STATUS_RANK), size, speed (download, then upload) or time
 * left. Torrents without a queue position, a speed shown or a time left go last in either direction.
 */
export function compareTorrents(order: DownloadOrder, titleOf: (torrent: Torrent) => string): Compare {
  const { compare, has } = sortKey(order.key, titleOf)
  const direction = order.descending ? -1 : 1
  return (a, b) => {
    if (has) {
      const aHas = has(a)
      if (aHas !== has(b)) return aHas ? -1 : 1
      if (!aHas) return compareByQueue(a, b)
    }
    return direction * compare(a, b) || compareByQueue(a, b)
  }
}

/**
 * A stored sort and direction: a sort that's no longer offered falls back to the queue, and one
 * stored without a direction (before there was one) takes its usual direction.
 */
export function knownOrder(sort: unknown, descending: unknown): DownloadOrder {
  const known = DOWNLOAD_SORTS.includes(sort as DownloadSort) ? (sort as DownloadSort) : 'priority'
  return typeof descending === 'boolean' && known === sort
    ? { key: known, descending }
    : usualOrder(known, DOWNLOADS_USUALLY_DESCENDING)
}
