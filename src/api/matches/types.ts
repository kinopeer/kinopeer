/**
 * Which TMDB title a torrent is, as the Kinopeer server keeps it: chosen by the user, or guessed
 * from the release name by a browser.
 */
export interface StoredTitle {
  type: 'movie' | 'tv'
  id: number
  source: 'user' | 'guess'
  /** For a guess: the version of the matching that made it, so a newer version guesses again. */
  version?: number
  /** Set by the server: since when (ms) qBittorrent hasn't had this torrent. */
  missingSince?: number
}

/** A guess from the release name that found no title on TMDB, so no device asks TMDB again (#461). */
export interface StoredMiss {
  source: 'miss'
  /** The version of the matching that made it, so a newer version guesses again. */
  version: number
  /** As in StoredTitle. */
  missingSince?: number
}

export type StoredMatch = StoredTitle | StoredMiss

/** Answer of GET /api/matches and PATCH /api/matches: matches by torrent info hash. */
export type Matches = Record<string, StoredMatch>

/** A match as a browser sends it: without what only the server sets. */
export type SentMatch = Omit<StoredTitle, 'missingSince'> | Omit<StoredMiss, 'missingSince'>

/** Body of PATCH /api/matches: matches to save by info hash, null for one to forget. */
export type MatchesPatch = Record<string, SentMatch | null>

/** Error answers of /api/matches. */
export interface MatchesErrorBody {
  error: 'bad-request' | 'storage' | 'not-found'
}
