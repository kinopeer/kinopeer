/** Newznab categories Prowlarr uses: 2000 movies, 5000 TV (subcategories like 2040 or 5070 fall under them). */
export const MOVIE_CATEGORY = 2000
export const TV_CATEGORY = 5000

export type SearchType = 'search' | 'movie' | 'tvsearch'

/**
 * A release as Kinopeer's server hands it to the browser: Prowlarr's search result with only the
 * fields the UI needs, and without the links that carry Prowlarr's API key.
 */
export interface Release {
  /** Prowlarr's guid: unique per release. */
  id: string
  title: string
  indexer: string
  /** Bytes. */
  size: number
  seeders?: number
  leechers?: number
  /** ISO date. */
  publishDate?: string
  /** The release's page on the tracker. */
  infoUrl?: string
  /** Newznab category ids. */
  categories: number[]
  infoHash?: string
  /** A real magnet link, when the indexer gives one. */
  magnet?: string
  /** Opaque token for /prowlarr/download, which fetches the .torrent (or magnet) through Prowlarr. */
  download?: string
  imdbId?: number
  tmdbId?: number
}

/** What /prowlarr/download answers with when the release is a magnet link rather than a file. */
export interface MagnetResponse {
  magnet: string
}

/** Answer of /prowlarr/status. */
export interface ProwlarrStatus {
  /** Prowlarr's version, e.g. "1.24.3.4754". */
  version: string
  /** Enabled indexers. */
  indexers: number
}

/**
 * The longest `within` /prowlarr/failing accepts: longer than any search takes. Prowlarr keeps an
 * indexer's last failure after it recovers, so a longer window would name old failures.
 */
export const MAX_FAILING_WITHIN_MS = 10 * 60 * 1000

/** Answer of /prowlarr/failing. */
export interface FailingIndexers {
  /** Names of the enabled indexers that failed, sorted. */
  indexers: string[]
}

/** Error body of the /prowlarr routes. */
export interface ProwlarrErrorBody {
  error: 'not-configured' | 'unauthorized' | 'unreachable' | 'bad-request' | 'not-found' | 'upstream'
}
