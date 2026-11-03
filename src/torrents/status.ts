import type { Torrent, TorrentState } from '../api/qbittorrent'
import type { Formatters } from '../lib/format'

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

/** Statuses with something to stop; the rest offer Resume. */
/**
 * Whether qBittorrent has the torrent's metadata (its files and pieces). A magnet link has none
 * until peers send it, whatever its state: qBittorrent reports its total size as -1 until then, on
 * 4.x and 5.x alike (5.x also sends `has_metadata`).
 */
export function hasMetadata(torrent: Pick<Torrent, 'total_size'>): boolean {
  return torrent.total_size !== -1
}

export function isRunning(status: DownloadStatus): boolean {
  return status === 'downloading' || status === 'seeding' || status === 'queued' || status === 'checking'
}

/**
 * The torrent as qBittorrent will report it once it took a pause (stopped) or a resume (started),
 * by whether it's finished, with nothing moving either way; unchanged when it already is that way,
 * so a qBittorrent 4.x `pausedDL` stays itself.
 */
export function withRunning(torrent: Torrent, running: boolean): Torrent {
  if (isRunning(downloadStatus(torrent)) === running) return torrent
  const finished = torrent.progress >= 1
  const state: TorrentState = running ? (finished ? 'stalledUP' : 'stalledDL') : finished ? 'stoppedUP' : 'stoppedDL'
  return { ...torrent, state, dlspeed: 0, upspeed: 0 }
}

/**
 * The torrent as qBittorrent will report it once it took a forced recheck: checking, as a download
 * or, once finished, a seed, stopped or not; unchanged when it's being checked already.
 */
export function withChecking(torrent: Torrent): Torrent {
  if (downloadStatus(torrent) === 'checking') return torrent
  return { ...torrent, state: torrent.progress >= 1 ? 'checkingUP' : 'checkingDL' }
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

/** Whether a torrent in `status` has a speed to show: while downloading or seeding, 0 B/s included. */
export function showsSpeed(status: DownloadStatus): boolean {
  return status === 'downloading' || status === 'seeding'
}

/** "↓ 4.3 MB/s" while downloading, "↑ …" while seeding, otherwise null (see showsSpeed). */
export function transferSpeed(
  torrent: Pick<Torrent, 'dlspeed' | 'upspeed'>,
  status: DownloadStatus,
  format: Formatters,
): string | null {
  if (!showsSpeed(status)) return null
  return status === 'downloading' ? `↓ ${format.speed(torrent.dlspeed)}` : `↑ ${format.speed(torrent.upspeed)}`
}
