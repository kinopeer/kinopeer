/** Where a secret comes from: saved from the app, or the server's environment variables. */
export type KeySource = 'saved' | 'env'

export interface SecretStatus {
  configured: boolean
  source: KeySource | null
}

/** Answer of GET /api/settings. Secrets never leave the server, only whether they are set. */
export interface ServerSettings {
  tmdb: SecretStatus
  /** The login the server uses for qBittorrent. */
  qbittorrent: SecretStatus
}

/** Body of PUT /api/settings/tmdb. */
export interface TmdbKeyBody {
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
    | 'storage'
    | 'not-found'
}
