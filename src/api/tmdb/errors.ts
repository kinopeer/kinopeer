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
