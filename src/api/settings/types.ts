/** Where the server's TMDB key comes from: saved from the app, or the TMDB_API_KEY environment variable. */
export type KeySource = 'saved' | 'env'

/** Answer of GET /api/settings. Secrets never leave the server, only whether they are set. */
export interface ServerSettings {
  tmdb: { configured: boolean; source: KeySource | null }
}

/** Body of PUT /api/settings/tmdb. */
export interface TmdbKeyBody {
  apiKey: string
}

/** Error answers of /api/settings. */
export interface SettingsErrorBody {
  error: 'bad-request' | 'invalid-key' | 'unreachable' | 'storage' | 'not-found'
}
