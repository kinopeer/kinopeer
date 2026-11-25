// How long a 429's Retry-After asks to wait. One rule for the TMDB proxy, which passes TMDB's on to
// every install on its key (tmdb-proxy/worker.ts), and for the client, which also reads TMDB's
// directly with a key of its own (src/api/tmdb/transport.ts) (#619).

/**
 * The longest wait taken, in seconds: the title lookups' own longest (RETRY_DELAYS_MS in
 * src/torrents/useTitleMatches.ts). A day from TMDB would stop every install's lookups for a day,
 * and Infinity would end their pause at once and leave it open, so later 429s backed off no more.
 */
const MAX_RETRY_AFTER_S = 600

/**
 * The wait in `value`, a positive whole number of seconds (Kinopeer's proxy's form; TMDB's docs name
 * none), at most MAX_RETRY_AFTER_S; undefined for anything else (none, 0, a fraction, Infinity, the
 * date form), where the caller's own wait applies.
 */
export function retryAfterSeconds(value: string | null): number | undefined {
  const seconds = value && /^\d+$/.test(value) ? Number(value) : 0
  return seconds > 0 ? Math.min(seconds, MAX_RETRY_AFTER_S) : undefined
}
