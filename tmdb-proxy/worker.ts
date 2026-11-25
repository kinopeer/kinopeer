/**
 * Kinopeer's TMDB proxy, a Cloudflare Worker: an install with no TMDB key of its own sends its TMDB
 * API calls here, and the proxy adds Kinopeer's key, which lives only in the worker's secret
 * (docs/DEVELOPMENT.md → The TMDB proxy):
 *
 * https://<worker>/3/search/movie?query=… → https://api.themoviedb.org/3/search/movie?query=…&api_key=…
 *
 * It answers GET and HEAD for the paths Kinopeer calls (src/api/tmdb/client.ts) and nothing else, so
 * it isn't a key to the whole API. Installs don't authenticate: any secret in the image would be as
 * public as the key. Workers Cache, in front of the worker (`cache` in wrangler.jsonc), keeps TMDB's
 * answers by their Cache-Control and runs the worker only on a miss, so only the calls that reach
 * TMDB meet the limit per IP (an IPv6 caller's /64, `limitKey`). Nothing is logged (wrangler.jsonc).
 *
 * A page served from a private origin (Kinopeer as qBittorrent's Alternative WebUI, at a LAN address)
 * calls the proxy from the browser, so those origins get CORS headers (`isPrivateOrigin`, shared
 * with the app in src/logic/privateOrigin.ts); a page on a
 * public origin gets none, so it can't read the answers, and a public site can't use the shared key
 * as the TMDB backend of its own pages. It can still send the calls (a simple GET needs no preflight)
 * and spend the daily quota with them, as a script can. Every answer says `Vary: Origin`, so Workers
 * Cache keeps one copy per origin and never hands one origin's CORS headers to another
 * (docs/SPEC.md's decision log, 2026-11-22).
 */
import { isPrivateOrigin } from '../src/logic/privateOrigin.ts'

/** The worker's bindings (wrangler.jsonc) and secrets. */
export interface Env {
  /** Kinopeer's TMDB key: a v3 API key or a v4 read access token (a JWT). */
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
 * The paths Kinopeer calls, and how long Workers Cache keeps their answers, in seconds. TMDB's terms allow
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
 * Parameters dropped from every call: a key the caller sends, so the call goes with Kinopeer's alone;
 * append_to_response, which would add a title's credits, videos or images to an allowed path; and the
 * session ids of TMDB's account calls. client.ts sends none of them.
 */
const DROPPED_PARAMETERS = ['api_key', 'append_to_response', 'session_id', 'guest_session_id']

/**
 * TMDB's response headers passed on; its own Cache-Control is replaced by the proxy's. Not its
 * validators: a refresh that answers 200 with the cached ETag "does not reliably replace the old
 * content" (Cloudflare's Revalidation page), and for TMDB's configuration, whose ETag doesn't change,
 * it kept the entry an older worker had stored, headers included, past its time (#617). The proxy
 * gives its answers an ETag of its own instead (`answer`).
 */
const RESPONSE_HEADERS = ['content-type']

/** TMDB's terms ask that an application doesn't hide who it is. */
const USER_AGENT = 'Kinopeer-TMDB-proxy'

/** The methods the proxy answers; OPTIONS is a CORS preflight. */
const ALLOW = 'GET, HEAD, OPTIONS'

/**
 * What a browser keeps a preflight for, in seconds. Chromium caps it at two hours, Firefox at a day.
 * A GET or HEAD is preflighted only for a request header outside the safelist, and the answer names
 * no `Access-Control-Allow-Headers`, so today a preflight admits nothing: the client's GETs send no
 * such header, and one that does needs its name added here first. The branch is there so a
 * preflight gets an answer that says so, rather than a 405.
 */
const PREFLIGHT_MAX_AGE = String(24 * HOUR)

/** Response headers a page's script may read beyond the CORS-safelisted ones: a 429's wait. */
const EXPOSED_HEADERS = 'Retry-After'

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

/**
 * `response` with the CORS headers for `origin`: `Vary: Origin` on every answer, since Workers Cache
 * honors it and keeps an answer per origin, and the rest only for a private one. A preflight also
 * gets the methods and how long the browser may keep it.
 */
function withCors(response: Response, origin: string | null, preflight: boolean): Response {
  response.headers.append('Vary', 'Origin')
  if (!isPrivateOrigin(origin)) return response
  response.headers.set('Access-Control-Allow-Origin', origin ?? '')
  response.headers.set('Access-Control-Expose-Headers', EXPOSED_HEADERS)
  if (preflight) {
    response.headers.set('Access-Control-Allow-Methods', 'GET, HEAD')
    response.headers.set('Access-Control-Max-Age', PREFLIGHT_MAX_AGE)
  }
  return response
}

/** The groups of one side of an IPv6 address's `::`, an IPv4 tail counted as the two it takes. */
function groups(part: string | undefined): string[] {
  return part ? part.split(':').flatMap((group) => (group.includes('.') ? ['0', '0'] : [group])) : []
}

/**
 * What the rate limit counts a caller by: an IPv4 address as it is, an IPv6 one by its /64, since a
 * single client gets a whole /64 and can take a new address in it for every call. Anything that
 * doesn't read as an address is kept whole.
 */
export function limitKey(ip: string): string {
  if (!ip.includes(':')) return ip
  const halves = ip.toLowerCase().split('::')
  if (halves.length > 2) return ip
  const head = groups(halves[0])
  const tail = groups(halves[1])
  // None elided, rather than a negative count, when the sides already have more than eight groups.
  const elided = halves.length === 2 ? Math.max(0, 8 - head.length - tail.length) : 0
  const all = [...head, ...Array<string>(elided).fill('0'), ...tail]
  if (all.length !== 8) return ip
  return `${all.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, '')).join(':')}::/64`
}

export async function handle(request: Request, env: Env, deps: Deps = {}): Promise<Response> {
  const response = await answer(request, env, deps)
  // A preflight's own headers only on its 204: a 404 refuses it, for a path the proxy doesn't serve.
  return withCors(response, request.headers.get('Origin'), request.method === 'OPTIONS' && response.ok)
}

async function answer(request: Request, env: Env, deps: Deps): Promise<Response> {
  const preflight = request.method === 'OPTIONS'
  if (request.method !== 'GET' && request.method !== 'HEAD' && !preflight) {
    return fail(405, 'Method not allowed', { Allow: ALLOW })
  }
  const url = new URL(request.url)
  const path = url.pathname.startsWith(`${PREFIX}/`) ? url.pathname.slice(PREFIX.length) : ''
  const ttl = ROUTES.find(([pattern]) => pattern.test(path))?.[1]
  if (ttl === undefined) return fail(404, 'Not a path Kinopeer calls')
  // Answered without the key, the limit or TMDB: a preflight only asks what the GET may do.
  if (preflight) return new Response(null, { status: 204, headers: { Allow: ALLOW, 'Cache-Control': NO_STORE } })
  const key = env.TMDB_API_KEY?.trim()
  if (!key) return fail(503, 'The proxy has no TMDB key')
  // A worker deployed without its environment has no limiter; it mustn't read as "no limit".
  if (!env.LIMITER) return fail(500, 'The proxy has no rate limiter')

  const query = new URLSearchParams(url.search)
  for (const name of DROPPED_PARAMETERS) query.delete(name)
  const search = String(query) ? `?${query}` : ''

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
  if (!(await env.LIMITER.limit({ key: limitKey(ip) })).success) {
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
  // Kinopeer's server doesn't, so the Settings check still asks the proxy. GET and HEAD share a cache
  // entry, so a HEAD's empty answer isn't kept, and neither is an error.
  const cacheable = upstream.ok && request.method === 'GET'
  headers.set('Cache-Control', cacheable ? `public, s-maxage=${ttl}` : NO_STORE)
  // A new ETag for every answer made, so a refresh replaces the cached entry, the case Cloudflare's
  // Revalidation page documents. Not a Last-Modified, which would serve as well: with no max-age, a
  // browser keeps an answer that has one fresh for a tenth of its time since then (RFC 9111 §4.2.2,
  // Chromium, Firefox and WebKit alike), and Kinopeer's server passes it on with no Age, its released
  // versions too.
  if (cacheable) headers.set('ETag', `W/"${Date.now().toString(36)}"`)
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
