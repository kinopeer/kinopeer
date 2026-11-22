import type { Matches, MatchesErrorBody, MatchesPatch } from '../src/api/matches/types.ts'
import { CHECK_INTERVAL_MS, HASH, MISSING_GRACE_MS, merged, pruned, validMatch, withoutGuesses } from '../src/logic/titleMatches.ts'
import { isJsonRequest, readJson, sendJson } from './json.ts'
import { JsonFile } from './jsonFile.ts'
import type { Middleware } from './prowlarr.ts'

/**
 * Which TMDB title each torrent is, kept by the server so every device shows the same and
 * qBittorrent's tag list stays clean: the user's choice, or a guess a browser made from the release
 * name, one that found no title included (a miss), so no device asks TMDB for it again. They live
 * in matches.json in the data directory, by info hash, with no expiry: a torrent's name doesn't
 * change, so a guess is redone only when guessing changes (its version) or on DELETE.
 *
 * A torrent deleted from Kinopeer has its match forgotten right away (PATCH with null). For torrents
 * deleted elsewhere, the server checks qBittorrent's list every hour and forgets a match once its
 * torrent has been gone for a week: qBittorrent may answer with an empty or partial list right
 * after a restart, and a torrent added back within the week keeps its match.
 *
 * GET /api/matches → Matches
 * PATCH /api/matches MatchesPatch → saves them where `replaces` (src/logic/titleMatches.ts) lets
 *   them (never a guess or a miss over the user's choice, nothing over a newer version of guessing,
 *   no miss over a guess of the same version), and forgets those set to null; answers Matches
 * DELETE /api/matches → forgets every guess and miss (Settings → Clear cache), keeps the user's choices
 */
export class MatchesStore extends JsonFile<Matches> {
  constructor(dir: string) {
    super(dir, 'matches.json')
  }

  /** Saves `changes` over what is kept, where `replaces` lets them, and forgets those set to null. */
  save(changes: MatchesPatch): Promise<Matches> {
    return this.change((current) => merged(current, changes))
  }

  /**
   * Notes which torrents qBittorrent no longer has (`present` is every hash it has) and forgets those
   * gone for `graceMs`; a torrent that is back loses its note.
   */
  prune(present: Set<string>, graceMs: number, now: number): Promise<Matches> {
    return this.change((current) => pruned(current, (hash) => present.has(hash), graceMs, now))
  }

  /** Forgets every guess and miss, so browsers guess again; the user's choices stay. */
  clearGuesses(): Promise<Matches> {
    return this.change(withoutGuesses)
  }
}

const PATH = '/api/matches'
// About a thousand matches per request.
const MAX_BODY_BYTES = 128 * 1024

function fail(response: Parameters<Middleware>[1], status: number, error: MatchesErrorBody['error']): void {
  sendJson(response, status, { error } satisfies MatchesErrorBody)
}

function validPatch(value: unknown): value is MatchesPatch {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.entries(value).every(([hash, match]) => HASH.test(hash) && (match === null || validMatch(match)))
  )
}

export function matchesMiddleware(store: MatchesStore): Middleware {
  return (request, response, next) => {
    const path = new URL(request.url ?? '/', 'http://kinopeer.local').pathname
    if (path !== PATH) return next()

    if (request.method === 'GET') {
      void store.load().then((matches) => sendJson(response, 200, matches))
      return
    }
    // A cross-site DELETE needs a CORS preflight, which never succeeds here.
    if (request.method === 'DELETE') return void write(response, () => store.clearGuesses())
    if (request.method !== 'PATCH') return fail(response, 405, 'bad-request')
    if (!isJsonRequest(request)) return fail(response, 415, 'bad-request')
    readJson(request, MAX_BODY_BYTES).then(
      (body) => (validPatch(body) ? write(response, () => store.save(body)) : fail(response, 400, 'bad-request')),
      () => fail(response, 400, 'bad-request'),
    )
  }
}

async function write(response: Parameters<Middleware>[1], change: () => Promise<Matches>): Promise<void> {
  try {
    sendJson(response, 200, await change())
  } catch {
    console.warn('[kinopeer] could not write matches.json; is the data directory writable?')
    fail(response, 500, 'storage')
  }
}

// The first check waits a minute after start, so qBittorrent has time to come up with the server.
const FIRST_CHECK_MS = 60_000

/** Every info hash qBittorrent has, or undefined when it didn't answer with its list. */
export async function qbittorrentHashes(get: (path: string) => Promise<Response>): Promise<Set<string> | undefined> {
  const response = await get('/api/v2/torrents/info')
  if (!response.ok) return undefined
  const torrents: unknown = await response.json()
  if (!Array.isArray(torrents)) return undefined
  return new Set(
    torrents.flatMap((torrent: unknown) => {
      const hash = (torrent as { hash?: unknown } | null)?.hash
      return typeof hash === 'string' ? [hash] : []
    }),
  )
}

/**
 * Checks qBittorrent's torrents every hour and forgets the matches of torrents gone for a week.
 * When qBittorrent doesn't answer nothing changes. Returns a function that stops it.
 */
export function startMatchesCleanup(
  store: MatchesStore,
  hashes: () => Promise<Set<string> | undefined>,
  options: { intervalMs?: number; graceMs?: number } = {},
): () => void {
  const graceMs = options.graceMs ?? MISSING_GRACE_MS
  let running = false
  const check = async () => {
    if (running) return
    running = true
    try {
      const present = await hashes()
      if (present) await store.prune(present, graceMs, Date.now())
    } catch {
      // qBittorrent unreachable or matches.json not writable: the next check tries again.
    } finally {
      running = false
    }
  }
  const first = setTimeout(() => void check(), FIRST_CHECK_MS)
  const timer = setInterval(() => void check(), options.intervalMs ?? CHECK_INTERVAL_MS)
  // Never keeps the process alive on its own (tests, `vite build`).
  first.unref()
  timer.unref()
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}
