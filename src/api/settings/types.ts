/** Where a secret comes from: saved from the app, or the server's environment variables. */
export type KeySource = 'saved' | 'env'

export interface SecretStatus {
  configured: boolean
  source: KeySource | null
}

export interface ProwlarrKeyStatus extends SecretStatus {
  /**
   * The server has a key of its own (PROWLARR_API_KEY or a readable config.xml), which applies once
   * a saved key is forgotten.
   */
  serverKey: boolean
}

/** Defaults for adding a release, the same on every device. */
export interface DownloadDefaults {
  /** qBittorrent category for new movie downloads; null picks one named like "Movies". */
  movieCategory: string | null
  /** The same for series ("TV Shows", "Сериалы"). */
  tvCategory: string | null
  /** New downloads start stopped. */
  startPaused: boolean
  /** New downloads fetch pieces in order. */
  sequential: boolean
}

/** Answer of GET /api/settings. Secrets never leave the server, only whether they are set. */
export interface ServerSettings {
  tmdb: SecretStatus
  /** The Prowlarr API key: 'env' covers PROWLARR_API_KEY and the key in Prowlarr's config.xml. */
  prowlarr: ProwlarrKeyStatus
  /** The login the server uses for qBittorrent. */
  qbittorrent: SecretStatus
  /** The download defaults saved so far; null until any is saved. */
  downloads: Partial<DownloadDefaults> | null
}

/** Body of PATCH /api/settings/downloads: the defaults to change. */
export type DownloadDefaultsBody = Partial<DownloadDefaults>

/** Body of PUT /api/settings/tmdb. */
export interface TmdbKeyBody {
  apiKey: string
}

/** Body of PUT /api/settings/prowlarr. */
export interface ProwlarrKeyBody {
  apiKey: string
}

/** Body of PUT /api/settings/qbittorrent. */
export interface QbittorrentLoginBody {
  username: string
  password: string
}

/** Error answers of /api/settings. */
export interface SettingsErrorBody {
  error:
    | 'bad-request'
    | 'invalid-key'
    | 'invalid-credentials'
    | 'banned'
    | 'not-configured'
    | 'unreachable'
    | 'not-prowlarr'
    | 'no-server-key'
    | 'storage'
    | 'not-found'
}
