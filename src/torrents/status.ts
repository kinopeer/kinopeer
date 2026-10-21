import type { Torrent, TorrentState } from '../api/qbittorrent'

/** The design system's status set; each has its own chip and progress bar color. */
export type DownloadStatus = 'downloading' | 'seeding' | 'paused' | 'completed' | 'queued' | 'checking' | 'error'

const STATUS_BY_STATE: Record<TorrentState, DownloadStatus> = {
  downloading: 'downloading',
  forcedDL: 'downloading',
  metaDL: 'downloading',
  forcedMetaDL: 'downloading',
  stalledDL: 'downloading',
  allocating: 'downloading',
  uploading: 'seeding',
  forcedUP: 'seeding',
  stalledUP: 'seeding',
  pausedDL: 'paused',
  stoppedDL: 'paused',
  unknown: 'paused',
  // Finished and stopped: nothing left to do, so it reads as done rather than paused.
  pausedUP: 'completed',
  stoppedUP: 'completed',
  queuedDL: 'queued',
  queuedUP: 'queued',
  checkingDL: 'checking',
  checkingUP: 'checking',
  checkingResumeData: 'checking',
  moving: 'checking',
  error: 'error',
  missingFiles: 'error',
}

export function downloadStatus(torrent: Pick<Torrent, 'state'>): DownloadStatus {
  return STATUS_BY_STATE[torrent.state] ?? 'paused'
}

export const STATUS_FILTERS = ['all', 'downloading', 'seeding', 'paused', 'completed', 'error'] as const
export type StatusFilter = (typeof STATUS_FILTERS)[number]

export function matchesFilter(torrent: Pick<Torrent, 'state' | 'progress'>, filter: StatusFilter): boolean {
  const status = downloadStatus(torrent)
  switch (filter) {
    case 'all':
      return true
    case 'downloading':
      return status === 'downloading' || ((status === 'queued' || status === 'checking') && torrent.progress < 1)
    case 'completed':
      return torrent.progress >= 1
    default:
      return status === filter
  }
}

/** Queue order first (as in qBittorrent), then everything outside the queue, newest first. */
export function compareByQueue(a: Torrent, b: Torrent): number {
  const aQueued = a.priority > 0
  const bQueued = b.priority > 0
  if (aQueued && bQueued) return a.priority - b.priority
  if (aQueued !== bQueued) return aQueued ? -1 : 1
  return b.added_on - a.added_on
}
