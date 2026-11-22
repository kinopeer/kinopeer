import { HASH, merged, pruned, validStoredMatch, withoutGuesses } from '../../logic/titleMatches'
import { loadClientData, storeClientData, type ClientData } from '../qbittorrent/webui'
import type { Matches, MatchesPatch } from './types'

/**
 * The torrent-to-title matches in the WebUI build, which has no Kinopeer server to keep them: in
 * qBittorrent's `clientdata`, a key per torrent (`kinopeer.match.<info hash>`), so every device
 * signed in to that qBittorrent shows the same (#561). The store's rules are the server's
 * (src/logic/titleMatches.ts), applied here: each change reads the matches qBittorrent keeps, applies
 * them, and stores only the keys that changed, one change of the page at a time, so a change another
 * device stored meanwhile stays, unless it stored the same torrent's in the moment between this read
 * and this store. About 80 bytes
 * a torrent, of the 1 MiB every interface's keys share.
 */
export const MATCH_KEY_PREFIX = 'kinopeer.match.'

/** The matches qBittorrent keeps, without a key of Kinopeer's prefix that isn't a match. */
export async function loadWebuiMatches(signal?: AbortSignal): Promise<Matches> {
  // qBittorrent loads only keys it's named, or every key: a torrent's isn't known before it's loaded.
  const data = await loadClientData(undefined, signal)
  const matches: Matches = {}
  for (const [key, value] of Object.entries(data)) {
    const hash = key.slice(MATCH_KEY_PREFIX.length)
    if (key.startsWith(MATCH_KEY_PREFIX) && HASH.test(hash) && validStoredMatch(value)) matches[hash] = value
  }
  return matches
}

// The page's last change, which the next one waits for, as the server's JsonFile runs its changes.
// Not a promise from the start: a call at the module's top level would stay in the server build.
let changing: Promise<unknown> | undefined

/**
 * Applies `change` to the matches qBittorrent keeps, stores what changed, and answers the result,
 * after the page's change before it has settled, so its read sees what that one stored and its answer
 * comes after that one's: otherwise a guess batch read before the user's choice was stored would
 * store the guess over it, and a prune read before a torrent was forgotten would bring its match back.
 */
function changeMatches(change: (current: Matches) => Matches): Promise<Matches> {
  const before = changing
  const run = (async () => {
    await before
    return applyChange(change)
  })()
  changing = run.catch(() => {})
  return run
}

async function applyChange(change: (current: Matches) => Matches): Promise<Matches> {
  const current = await loadWebuiMatches()
  const next = change(current)
  const changes: ClientData = {}
  for (const [hash, match] of Object.entries(next)) if (match !== current[hash]) changes[MATCH_KEY_PREFIX + hash] = match
  for (const hash of Object.keys(current)) if (!(hash in next)) changes[MATCH_KEY_PREFIX + hash] = null
  if (Object.keys(changes).length > 0) await storeClientData(changes)
  return next
}

/** As the server's PATCH /api/matches: saves `matches` where `replaces` lets them, null forgetting one. */
export function saveWebuiMatches(matches: MatchesPatch): Promise<Matches> {
  return changeMatches((current) => merged(current, matches))
}

/** As the server's DELETE /api/matches: forgets every guess and miss; the user's choices stay. */
export function clearWebuiGuesses(): Promise<Matches> {
  return changeMatches(withoutGuesses)
}

/**
 * As the server's hourly check: notes which torrents qBittorrent no longer has (`has` says whether it
 * has a hash) and forgets the matches of those gone for `graceMs`.
 */
export function pruneWebuiMatches(has: (hash: string) => boolean, graceMs: number, now: number): Promise<Matches> {
  return changeMatches((current) => pruned(current, has, graceMs, now))
}
