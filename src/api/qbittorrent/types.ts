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
  num_seeds: number
  num_leechs: number
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
