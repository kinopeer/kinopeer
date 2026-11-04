/**
 * Kinoseed's TMDB proxy, a Cloudflare Worker: an install with no TMDB key of its own sends its TMDB
 * API calls here, and the proxy adds Kinoseed's key, which lives only in the worker's secret
 * (docs/DEVELOPMENT.md → The TMDB proxy):
 *
 * https://<worker>/3/search/movie?query=… → https://api.themoviedb.org/3/search/movie?query=…&api_key=…
 *
 * It answers GET and HEAD for the paths Kinoseed calls (src/api/tmdb/client.ts) and nothing else, so
 * it isn't a key to the whole API. Installs don't authenticate: any secret in the image would be as
 * public as the key. Workers Cache, in front of the worker (`cache` in wrangler.jsonc), keeps TMDB's
 * answers by their Cache-Control and runs the worker only on a miss, so only the calls that reach
 * TMDB meet the per-IP limit. Nothing is logged (wrangler.jsonc).
 */

/** The worker's bindings (wrangler.jsonc) and secrets. */
export interface Env {
  /** Kinoseed's TMDB key: a v3 API key or a v4 read access token (a JWT). */
  TMDB_API_KEY?: string
  /** Workers' rate limiting, keyed by the caller's IP; every environment in wrangler.jsonc has one. */
  LIMITER?: RateLimiter
}

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

/** What the worker gets from the runtime, apart for tests. */
export interface Deps {
  fetch?: typeof fetch
  apiBase?: string
}

const API_BASE = 'https://api.themoviedb.org/3'
const PREFIX = '/3'
const HOUR = 3600

/**
 * The paths Kinoseed calls, and how long Workers Cache keeps their answers, in seconds. TMDB's terms allow
 * up to six months; searches change the most, a title's page the least.
 */
const ROUTES: readonly (readonly [RegExp, number])[] = [
  [/^\/configuration$/, 24 * HOUR],
  [/^\/search\/(movie|tv|multi)$/, HOUR],
  [/^\/discover\/(movie|tv)$/, 6 * HOUR],
  [/^\/(movie|tv)\/\d+$/, 24 * HOUR],
  [/^\/(movie|tv)\/\d+\/(recommendations|similar)$/, 24 * HOUR],
]

/**
 * Parameters dropped from every call: a key the caller sends, so the call goes with Kinoseed's alone;
 * append_to_response, which would add a title's credits, videos or images to an allowed path; and the
 * session ids of TMDB's account calls. client.ts sends none of them.
 */
const DROPPED_PARAMETERS = ['api_key', 'append_to_response', 'session_id', 'guest_session_id']

/** TMDB's response headers passed on; its own Cache-Control is replaced by the proxy's. */
const RESPONSE_HEADERS = ['content-type', 'etag', 'last-modified']

/** TMDB's terms ask that an application doesn't hide who it is. */
const USER_AGENT = 'Kinoseed-TMDB-proxy'

/** Never cached: a 429 kept by Workers Cache would answer every install, not the IP over its limit. */
const NO_STORE = 'no-store'

function fail(status: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ status_message: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': NO_STORE, ...headers },
  })
}

/** The URL and headers for a TMDB call with `key`, a v3 key or a v4 token (server/tmdb.ts does the same). */
function authorize(key: string, url: string): { url: string; headers: Record<string, string> } {
  if (key.startsWith('eyJ')) return { url, headers: { Authorization: `Bearer ${key}` } }
  return { url: `${url}${url.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(key)}`, headers: {} }
}

export async function handle(request: Request, env: Env, deps: Deps = {}): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return fail(405, 'Method not allowed', { Allow: 'GET, HEAD' })
  }
  const url = new URL(request.url)
  const path = url.pathname.startsWith(`${PREFIX}/`) ? url.pathname.slice(PREFIX.length) : ''
  const ttl = ROUTES.find(([pattern]) => pattern.test(path))?.[1]
  if (ttl === undefined) return fail(404, 'Not a path Kinoseed calls')
  const key = env.TMDB_API_KEY?.trim()
  if (!key) return fail(503, 'The proxy has no TMDB key')
  // A worker deployed without its environment has no limiter; it mustn't read as "no limit".
  if (!env.LIMITER) return fail(500, 'The proxy has no rate limiter')

  const query = new URLSearchParams(url.search)
  for (const name of DROPPED_PARAMETERS) query.delete(name)
  const search = String(query) ? `?${query}` : ''

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
  if (!(await env.LIMITER.limit({ key: ip })).success) {
    return fail(429, 'Too many requests', { 'Retry-After': '10' })
  }

  const target = authorize(key, `${deps.apiBase ?? API_BASE}${path}${search}`)
  let upstream: Response
  try {
    upstream = await (deps.fetch ?? fetch)(target.url, {
      headers: { ...target.headers, Accept: 'application/json', 'User-Agent': USER_AGENT },
    })
  } catch {
    return fail(502, 'TMDB could not be reached')
  }
  const headers = new Headers()
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  // s-maxage, not max-age: Workers Cache is a shared cache and keeps the answer, a browser behind
  // Kinoseed's server doesn't, so the Settings check still asks the proxy. GET and HEAD share a cache
  // entry, so a HEAD's empty answer isn't kept, and neither is an error.
  const cacheable = upstream.ok && request.method === 'GET'
  headers.set('Cache-Control', cacheable ? `public, s-maxage=${ttl}` : NO_STORE)
  if (request.method === 'HEAD') {
    // Released rather than left unread, which holds the connection to TMDB until it's collected.
    await upstream.body?.cancel()
    return new Response(null, { status: upstream.status, headers })
  }
  return new Response(upstream.body, { status: upstream.status, headers })
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env)
  },
}
