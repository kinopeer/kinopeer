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
}

/** Answer of GET /api/matches and body of PATCH /api/matches: matches by torrent info hash. */
export type Matches = Record<string, StoredMatch>

/** Error answers of /api/matches. */
export interface MatchesErrorBody {
  error: 'bad-request' | 'storage' | 'not-found'
}
