/**
 * Which TMDB title a torrent is, as the Kinoseed server keeps it: chosen by the user, or guessed
 * from the release name by a browser.
 */
export interface StoredMatch {
  type: 'movie' | 'tv'
  id: number
  source: 'user' | 'guess'
  /** For a guess: the version of the matching that made it, so a newer version guesses again. */
  version?: number
  /** Set by the server: since when (ms) qBittorrent hasn't had this torrent. */
  missingSince?: number
}

/** Answer of GET /api/matches and PATCH /api/matches: matches by torrent info hash. */
export type Matches = Record<string, StoredMatch>

/** Body of PATCH /api/matches: matches to save by info hash, null for one to forget. */
export type MatchesPatch = Record<string, Omit<StoredMatch, 'missingSince'> | null>

/** Error answers of /api/matches. */
export interface MatchesErrorBody {
  error: 'bad-request' | 'storage' | 'not-found'
}
