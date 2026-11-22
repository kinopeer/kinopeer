import type { Matches, MatchesPatch, SentMatch, StoredMatch } from '../api/matches/types.ts'

/**
 * The rules of the torrent-to-title matches store, the same wherever it's kept: Kinopeer's server
 * (server/matches.ts, which imports this file: the image carries it beside server/) or qBittorrent's
 * `clientdata` in the WebUI build (src/api/matches/webui.ts). Each transform answers `current` itself
 * when nothing changes, and keeps the matches it doesn't change as they are, so a caller can tell
 * what changed by identity.
 */

// qBittorrent's info hash: SHA-1 (v1, or v2 truncated), or a full v2 SHA-256.
export const HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

/** How often the store checks which torrents qBittorrent no longer has. */
export const CHECK_INTERVAL_MS = 60 * 60_000
/**
 * How long a torrent may be missing before its match is forgotten: qBittorrent may answer with an
 * empty or partial list right after a restart, and a torrent added back within the week keeps its match.
 */
export const MISSING_GRACE_MS = 7 * 24 * 60 * 60_000

/**
 * Whether a match sent replaces the one kept: the user's choice replaces anything and only the
 * user's choice replaces it. Otherwise a newer version of guessing replaces an older one (a guess
 * saved without a version is the oldest), nothing replaces a newer one, and of the same version a
 * guess replaces either, a miss neither. A device whose page loaded the matches before another one
 * found the title still sends its miss, which would take that title from every device; a page open
 * since before guessing changed would take the newer match back to its version, so every device
 * guessed again.
 */
export function replaces(match: SentMatch, kept: StoredMatch | undefined): boolean {
  if (match.source === 'user' || !kept) return true
  if (kept.source === 'user') return false
  const sent = match.version ?? 0
  const held = kept.version ?? 0
  return sent > held || (sent === held && match.source !== 'miss')
}

/** `changes` over `current`, where `replaces` lets them, without those set to null. */
export function merged(current: Matches, changes: MatchesPatch): Matches {
  let next = current
  for (const [hash, match] of Object.entries(changes)) {
    if (match === null ? !(hash in next) : !replaces(match, current[hash])) continue
    if (next === current) next = { ...current }
    if (match === null) delete next[hash]
    else next[hash] = match
  }
  return next
}

/**
 * Notes which torrents qBittorrent no longer has (`has` says whether it has a hash) and forgets those
 * gone for `graceMs`; a torrent that is back loses its note.
 */
export function pruned(current: Matches, has: (hash: string) => boolean, graceMs: number, now: number): Matches {
  let changed = false
  const next: Matches = {}
  for (const [hash, match] of Object.entries(current)) {
    if (has(hash)) {
      if (match.missingSince === undefined) {
        next[hash] = match
      } else {
        const back = { ...match }
        delete back.missingSince
        next[hash] = back
        changed = true
      }
    } else if (match.missingSince === undefined) {
      next[hash] = { ...match, missingSince: now }
      changed = true
    } else if (now - match.missingSince < graceMs) {
      next[hash] = match
    } else {
      changed = true
    }
  }
  return changed ? next : current
}

/** Every guess and miss forgotten, so browsers guess again; the user's choices stay. */
export function withoutGuesses(current: Matches): Matches {
  const next = Object.fromEntries(Object.entries(current).filter(([, match]) => match.source === 'user'))
  return Object.keys(next).length === Object.keys(current).length ? current : next
}

/** Whether `value` is a match as a browser sends it, with nothing more. */
export function validMatch(value: unknown): value is SentMatch {
  if (!value || typeof value !== 'object') return false
  const { type, id, source, version, ...rest } = value as Record<string, unknown>
  const validVersion = Number.isSafeInteger(version) && (version as number) > 0
  if (Object.keys(rest).length > 0) return false
  if (source === 'miss') return type === undefined && id === undefined && validVersion
  return (
    (type === 'movie' || type === 'tv') &&
    Number.isSafeInteger(id) &&
    (id as number) > 0 &&
    (source === 'user' || source === 'guess') &&
    (version === undefined || validVersion)
  )
}

/** Whether `value` is a match as a store keeps it: one sent, perhaps with the time it went missing. */
export function validStoredMatch(value: unknown): value is StoredMatch {
  if (!value || typeof value !== 'object') return false
  const { missingSince, ...sent } = value as Record<string, unknown>
  return (missingSince === undefined || Number.isSafeInteger(missingSince)) && validMatch(sent)
}
