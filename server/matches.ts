import type { Matches, MatchesErrorBody, StoredMatch } from '../src/api/matches/types.ts'
import { isJsonRequest, readJson, sendJson } from './json.ts'
import { JsonFile } from './jsonFile.ts'
import type { Middleware } from './prowlarr.ts'

/**
 * Which TMDB title each torrent is, kept by the server so every device shows the same and
 * qBittorrent's tag list stays clean: the user's choice, or a guess a browser made from the release
 * name. They live in matches.json in the data directory, by info hash. Entries of torrents that are
 * gone stay: they are small, and the same torrent added again is the same title.
 *
 * GET /api/matches → Matches
 * PATCH /api/matches Matches → saves them, except a guess over the user's choice; answers Matches
 * DELETE /api/matches → forgets every guess (Settings → Clear cache), keeps the user's choices
 */
export class MatchesStore extends JsonFile<Matches> {
  constructor(dir: string) {
    super(dir, 'matches.json')
  }

  /** Saves `changes` over what is kept; a guess never replaces the user's choice. */
  save(changes: Matches): Promise<Matches> {
    return this.change((current) => {
      const next = { ...current }
      for (const [hash, match] of Object.entries(changes)) {
        if (match.source === 'guess' && current[hash]?.source === 'user') continue
        next[hash] = match
      }
      return next
    })
  }

  /** Forgets every guess, so browsers guess again; the user's choices stay. */
  clearGuesses(): Promise<Matches> {
    return this.change((current) =>
      Object.fromEntries(Object.entries(current).filter(([, match]) => match.source === 'user')),
    )
  }
}

const PATH = '/api/matches'
// About a thousand matches per request.
const MAX_BODY_BYTES = 128 * 1024
// qBittorrent's info hash: SHA-1 (v1, or v2 truncated), or a full v2 SHA-256.
const HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

function fail(response: Parameters<Middleware>[1], status: number, error: MatchesErrorBody['error']): void {
  sendJson(response, status, { error } satisfies MatchesErrorBody)
}

function validMatch(value: unknown): value is StoredMatch {
  if (!value || typeof value !== 'object') return false
  const { type, id, source, version, ...rest } = value as Record<string, unknown>
  return (
    Object.keys(rest).length === 0 &&
    (type === 'movie' || type === 'tv') &&
    Number.isSafeInteger(id) &&
    (id as number) > 0 &&
    (source === 'user' || source === 'guess') &&
    (version === undefined || (Number.isSafeInteger(version) && (version as number) > 0))
  )
}

function validMatches(value: unknown): value is Matches {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.entries(value).every(([hash, match]) => HASH.test(hash) && validMatch(match))
  )
}

export function matchesMiddleware(store: MatchesStore): Middleware {
  return (request, response, next) => {
    const path = new URL(request.url ?? '/', 'http://kinoseed.local').pathname
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
      (body) => (validMatches(body) ? write(response, () => store.save(body)) : fail(response, 400, 'bad-request')),
      () => fail(response, 400, 'bad-request'),
    )
  }
}

async function write(response: Parameters<Middleware>[1], change: () => Promise<Matches>): Promise<void> {
  try {
    sendJson(response, 200, await change())
  } catch {
    console.warn('[kinoseed] could not write matches.json; is the data directory writable?')
    fail(response, 500, 'storage')
  }
}
