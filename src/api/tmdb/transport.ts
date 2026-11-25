// How TMDB's client reaches TMDB: through Kinopeer's server in the server build, from the browser
// itself in the WebUI build, which has no server (docs/ARCHITECTURE.md → The transport). By path, as
// the TMDB bridge is a plain proxy; the client's calls (./client.ts) are the same on both.
import { fetchKinopeer } from '../fetchKinopeer'
import { KinopeerUnreachableError } from '../qbittorrent/errors'
import { BRIDGE_HEADER } from '../qbittorrent/transport'
import { getWebuiSettings, sharedTmdbAvailable } from '../settings/webui'
import { TMDB_API, authorize } from './direct'
import { TmdbError, TmdbKeyError, TmdbKeyReadError } from './errors'

/**
 * Sends a GET to `path` under TMDB's API (`/search/multi?query=…`) and resolves with the answer when
 * it's ok. Anything else it throws as the client's errors itself (`TmdbKeyError` for no key or one
 * TMDB rejected, `TmdbError` with the status otherwise), so nothing above the client asks which
 * build it is.
 */
export type TmdbTransport = (path: string, signal?: AbortSignal) => Promise<Response>

/** Same-origin prefix proxied to the TMDB API; the proxy adds the API key. */
export const TMDB_BASE = '/tmdb'

/**
 * The longest wait a Retry-After is taken for: TMDB's own reaches every install on the proxy's key
 * (#619), and a day, or Infinity, which would never end the title lookups' pause, isn't one to keep.
 */
const MAX_RETRY_AFTER_S = 600

/**
 * Retry-After in seconds (Kinopeer's proxy's form; TMDB's docs name none), in milliseconds, at most
 * MAX_RETRY_AFTER_S. The date form reads as none, so the caller's own wait applies.
 */
function retryAfter(response: Response): number | undefined {
  const seconds = Number(response.headers.get('retry-after') ?? Number.NaN)
  return seconds > 0 ? Math.min(seconds, MAX_RETRY_AFTER_S) * 1000 : undefined
}

function isJson(response: Response): boolean {
  return response.headers.get('content-type')?.includes('application/json') ?? false
}

/** Kinopeer's TMDB bridge (server/tmdb.ts), which adds the server's key or sends the call to Kinopeer's proxy. */
export const bridgeTransport: TmdbTransport = async (path, signal) => {
  const response = await fetchKinopeer(`${TMDB_BASE}${path}`, { headers: { Accept: 'application/json' }, signal })
  // 404 from the dev server itself (no /tmdb proxy configured) is not JSON.
  if (response.status === 401 || (response.status === 404 && !isJson(response))) {
    throw new TmdbKeyError(response.status)
  }
  // Without the TMDB bridge's mark, something in front of Kinopeer's server answered for it (#537):
  // `unreachable` in the qBittorrent client tells who didn't answer, for TMDB's calls too.
  if (!response.ok) {
    throw response.headers.has(BRIDGE_HEADER)
      ? new TmdbError(`TMDB responded ${response.status}`, response.status, retryAfter(response))
      : new KinopeerUnreachableError(response.status)
  }
  return response
}

/**
 * TMDB from the page itself, in the WebUI build: with the user's own key, which qBittorrent keeps
 * (`getWebuiSettings`), straight to TMDB; else through Kinopeer's TMDB proxy (`__TMDB_PROXY__`), which
 * adds Kinopeer's key, where it answers the page (`sharedTmdbAvailable`: a private origin); else
 * there's no key, as the bridge's 401 says, so the app asks for one. No cookie goes with either, a
 * cross-origin request's default, and no Referer, by the page's policy. A key qBittorrent didn't
 * give is `TmdbKeyReadError`, apart from TMDB's own failures.
 */
export const webuiTransport: TmdbTransport = async (path, signal) => {
  let tmdbKey: string | null
  try {
    tmdbKey = (await getWebuiSettings(signal)).tmdbKey
  } catch (error) {
    // Given up by the caller: an abort like any other call's.
    if (signal?.aborted) throw error
    throw new TmdbKeyReadError(error)
  }
  const target = tmdbKey
    ? authorize(tmdbKey, `${TMDB_API}${path}`)
    : sharedTmdbAvailable()
      ? { url: `${__TMDB_PROXY__}${path}`, headers: {} }
      : undefined
  if (!target) throw new TmdbKeyError(401)
  // Accept is a header CORS lets through without a preflight, which the proxy doesn't answer for other headers.
  const response = await fetch(target.url, { headers: { ...target.headers, Accept: 'application/json' }, signal })
  if (response.status === 401) throw new TmdbKeyError(response.status)
  if (!response.ok) throw new TmdbError(`TMDB responded ${response.status}`, response.status, retryAfter(response))
  return response
}
