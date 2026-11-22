// What a call to TMDB throws, the same on both ways the client reaches it (./transport.ts).

export class TmdbError extends Error {
  readonly status: number
  /** How long a 429 asks to wait before the next call, from its Retry-After in seconds. */
  readonly retryAfterMs?: number

  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message)
    this.name = 'TmdbError'
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

/**
 * No key to call TMDB with (none on Kinopeer's server or, in the WebUI build, none of the user's own
 * where Kinopeer's TMDB proxy doesn't answer the page), or TMDB rejected it.
 */
export class TmdbKeyError extends TmdbError {
  constructor(status: number) {
    super('The TMDB API key is missing or invalid', status)
    this.name = 'TmdbKeyError'
  }
}

/**
 * In the WebUI build, the user's TMDB key couldn't be read from qBittorrent's store, so TMDB wasn't
 * asked: qBittorrent didn't answer or refused, its error the `cause` (`UnauthorizedError` when its
 * session ended). The screens then name qBittorrent rather than TMDB (`TmdbFailedState`).
 */
export class TmdbKeyReadError extends Error {
  constructor(cause: unknown) {
    super('qBittorrent did not give the TMDB key', { cause })
    this.name = 'TmdbKeyReadError'
  }
}
