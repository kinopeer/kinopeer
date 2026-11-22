// TMDB called straight from the browser with the user's own key, in the WebUI build, which has no
// Kinopeer server to keep the key (docs/ARCHITECTURE.md → The transport). TMDB's API answers any
// origin's CORS, a v4 token's Authorization header's preflight too.
import { withTimeout } from '../../logic/withTimeout'

/** TMDB's API, as server/tmdb.ts calls it. */
export const TMDB_API = 'https://api.themoviedb.org/3'

/** TMDB's image CDN, which the page's policy lets images in from (WEBUI_CONTENT_SECURITY_POLICY in server/securityHeaders.ts). */
export const TMDB_IMAGES = 'https://image.tmdb.org/t/p'

/** How long a key's check waits for TMDB, as the server's (`TMDB_TIMEOUT_MS` in server/tmdb.ts). */
export const KEY_CHECK_TIMEOUT_MS = 15_000

/**
 * The URL and headers for a call to `url` with `key`, a v3 key (a query parameter) or a v4 read
 * access token (a JWT, sent as a bearer token), as server/tmdb.ts and Kinopeer's proxy send it.
 */
export function authorize(key: string, url: string): { url: string; headers: Record<string, string> } {
  if (key.startsWith('eyJ')) return { url, headers: { Authorization: `Bearer ${key}` } }
  return { url: `${url}${url.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(key)}`, headers: {} }
}

/**
 * Whether TMDB accepts `key`, asked as the server asks (`checkTmdbKey` in server/tmdb.ts). Rejects
 * when TMDB doesn't answer, in `KEY_CHECK_TIMEOUT_MS` among it, or answers anything but 401 for a
 * key it refuses.
 */
export async function checkTmdbKey(key: string): Promise<boolean> {
  const { url, headers } = authorize(key, `${TMDB_API}/authentication`)
  const response = await withTimeout(KEY_CHECK_TIMEOUT_MS, new AbortController().signal, (signal) =>
    fetch(url, { headers: { ...headers, Accept: 'application/json' }, signal }),
  )
  if (response.status === 401) return false
  if (!response.ok) throw new Error(`TMDB responded ${response.status}`)
  return true
}
