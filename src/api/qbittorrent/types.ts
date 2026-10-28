/** Torrent states reported by qBittorrent (Web API v2, qBittorrent 4.x and 5.x names). */
export type TorrentState =
  | 'error'
  | 'missingFiles'
  | 'uploading'
  | 'pausedUP'
  | 'stoppedUP'
  | 'queuedUP'
  | 'stalledUP'
  | 'checkingUP'
  | 'forcedUP'
  | 'allocating'
  | 'downloading'
  | 'metaDL'
  | 'forcedMetaDL'
  | 'pausedDL'
  | 'stoppedDL'
  | 'queuedDL'
  | 'stalledDL'
  | 'checkingDL'
  | 'forcedDL'
  | 'checkingResumeData'
  | 'moving'
  | 'unknown'

/** The subset of /torrents/info fields Kinoseed uses. Sizes in bytes, speeds in bytes/s, times in Unix seconds. */
export interface Torrent {
  hash: string
  name: string
  state: TorrentState
  /** 0–1 */
  progress: number
  /** Selected size. */
  size: number
  total_size: number
  downloaded: number
  uploaded: number
  amount_left: number
  dlspeed: number
  upspeed: number
  /** Seconds; 8640000 means infinity. */
  eta: number
  ratio: number
  /** Connected seeds and peers. */
  num_seeds: number
  num_leechs: number
  /** Seeds and peers in the swarm, as last reported by trackers; -1 when unknown. */
  num_complete: number
  num_incomplete: number
  category: string
  /** Comma-separated. */
  tags: string
  save_path: string
  content_path: string
  added_on: number
  completion_on: number
  /** Queue position; -1 when queueing is off or the torrent is seeding. */
  priority: number
}

export type TorrentFilter =
  | 'all'
  | 'downloading'
  | 'seeding'
  | 'completed'
  | 'stopped'
  | 'active'
  | 'inactive'
  | 'running'
  | 'stalled'
  | 'errored'

export interface TorrentsQuery {
  filter?: TorrentFilter
  category?: string
  tag?: string
  sort?: keyof Torrent
  reverse?: boolean
  limit?: number
  offset?: number
  hashes?: string[]
}

/** The subset of server_state fields Kinoseed uses. Speeds in bytes/s, sizes in bytes. */
export interface ServerState {
  dl_info_speed: number
  up_info_speed: number
  free_space_on_disk: number
  connection_status: 'connected' | 'firewalled' | 'disconnected'
  /** qBittorrent applies its alternative speed limits instead of the global ones. */
  use_alt_speed_limits: boolean
}

/**
 * Response of /sync/maindata. With `full_update` the maps are complete; otherwise they hold only
 * the fields that changed since the previous `rid`, and removed torrents are listed separately.
 */
export interface MainData {
  rid: number
  full_update?: boolean
  torrents?: Record<string, Partial<Omit<Torrent, 'hash'>>>
  torrents_removed?: string[]
  server_state?: Partial<ServerState>
}

export interface AddTorrentOptions {
  /** .torrent files. */
  files?: File[]
  /** Magnet or HTTP(S) links. */
  urls?: string[]
  tags?: string[]
  category?: string
  savePath?: string
  /** Add without starting. */
  stopped?: boolean
  /**
   * Stop once the metadata has arrived (qBittorrent 4.5+), so a magnet link's files can be chosen
   * before anything downloads. A stopped magnet would never fetch its metadata.
   */
  stopCondition?: 'MetadataReceived' | 'FilesChecked'
  sequentialDownload?: boolean
  /** Put the torrent first in the download queue (qBittorrent 4.4+). */
  addToTopOfQueue?: boolean
}

/** A qBittorrent category; an empty savePath means the default save path (plus the category name with automatic management). */
export interface Category {
  name: string
  savePath: string
}

/** 0: skip, 1: normal, 6: high, 7: maximum. */
export type FilePriority = 0 | 1 | 6 | 7

/** The subset of /torrents/files fields Kinoseed uses. */
export interface TorrentFile {
  index: number
  /** Path inside the torrent, with "/" separators. */
  name: string
  size: number
  /** 0–1. */
  progress: number
  priority: FilePriority
}

/** 0: disabled, 1: not contacted yet, 2: working, 3: updating, 4: not working. */
export type TrackerStatus = 0 | 1 | 2 | 3 | 4

/** The subset of /torrents/trackers fields Kinoseed uses. */
export interface TorrentTracker {
  /** Tracker URL, or "** [DHT] **", "** [PeX] **", "** [LSD] **" for the pseudo-trackers. */
  url: string
  status: TrackerStatus
  /** The tracker's last message, e.g. an error. */
  msg: string
}
