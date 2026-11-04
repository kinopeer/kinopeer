import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { ReadableStream } from 'node:stream/web'
import type { Middleware } from './prowlarr.ts'

/**
 * Same-origin bridge to TMDB that adds the key server-side, so it never reaches the browser:
 *
 * /tmdb/search/multi?query=… → https://api.themoviedb.org/3/search/multi?query=…&api_key=$TMDB_API_KEY
 * /tmdb-img/w342/abc.jpg → https://image.tmdb.org/t/p/w342/abc.jpg
 *
 * Accepts either a v3 API key or a v4 read access token (a JWT, sent as a bearer token). The key
 * is the one saved from the app (server/settings.ts) or TMDB_API_KEY. Without one, API calls go to
 * Kinoseed's TMDB proxy (`proxyBase`, tmdb-proxy/), which adds Kinoseed's key. Browser cookies are
 * never passed on. Runs as Vite middleware in dev and in the production server.
 */
export interface TmdbConfig {
  /** A function when the key can change while the server runs (saved from the app). */
  apiKey?: string | (() => string | undefined)
  /**
   * Kinoseed's TMDB proxy, `https://<worker>/3`, for calls without a key; none answers 401, so the
   * app asks for a key.
   */
  proxyBase?: string
  /** Overridable for tests. */
  apiBase?: string
  imageBase?: string
}

const API_BASE = 'https://api.themoviedb.org/3'
const API_PREFIX = '/tmdb/'
const IMAGE_PREFIX = '/tmdb-img/'
/** Upstream response headers passed on to the browser. */
const RESPONSE_HEADERS = ['content-type', 'cache-control', 'last-modified', 'etag', 'expires']

/** The URL and headers for a TMDB API call with `key`, which is a v3 key or a v4 token. */
function authorize(key: string, url: string): { url: string; headers: Record<string, string> } {
  if (key.startsWith('eyJ')) return { url, headers: { Authorization: `Bearer ${key}` } }
  return { url: `${url}${url.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(key)}`, headers: {} }
}

/** Whether TMDB accepts `key`. Rejects when TMDB can't be reached. */
export async function checkTmdbKey(key: string, apiBase = API_BASE): Promise<boolean> {
  const { url, headers } = authorize(key, `${apiBase}/authentication`)
  const response = await fetch(url, { headers: { ...headers, Accept: 'application/json' } })
  if (response.status === 401) return false
  if (!response.ok) throw new Error(`TMDB responded ${response.status}`)
  return true
}

async function forward(url: string, headers: Record<string, string>, request: IncomingMessage, response: ServerResponse) {
  if (request.headers.accept) headers.Accept = request.headers.accept
  const upstream = await fetch(url, { method: request.method === 'HEAD' ? 'HEAD' : 'GET', headers })
  response.statusCode = upstream.status
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) response.setHeader(name, value)
  }
  if (!upstream.body) return void response.end()
  Readable.fromWeb(upstream.body as ReadableStream<Uint8Array>)
    .on('error', () => response.destroy())
    .pipe(response)
}

export function tmdbMiddleware(config: TmdbConfig): Middleware {
  const getKey = typeof config.apiKey === 'function' ? config.apiKey : () => config.apiKey as string | undefined
  const apiBase = config.apiBase ?? API_BASE
  const imageBase = config.imageBase ?? 'https://image.tmdb.org/t/p'

  return (request, response, next) => {
    const path = request.url ?? '/'
    const isApi = path.startsWith(API_PREFIX)
    if (!isApi && !path.startsWith(IMAGE_PREFIX)) return next()
    const fail = (status: number, message: string) => {
      response.statusCode = status
      response.setHeader('Content-Type', 'application/json; charset=utf-8')
      response.end(JSON.stringify({ status_message: message }))
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405, 'Method not allowed')

    let target = { url: `${imageBase}/${path.slice(IMAGE_PREFIX.length)}`, headers: {} as Record<string, string> }
    if (isApi) {
      const key = getKey()?.trim()
      const apiPath = path.slice(API_PREFIX.length)
      if (key) target = authorize(key, `${apiBase}/${apiPath}`)
      // No Authorization or key of any kind: the proxy adds its own, and Workers Cache in front of
      // it bypasses a request that carries Authorization.
      else if (config.proxyBase) target = { url: `${config.proxyBase}/${apiPath}`, headers: {} }
      // The app treats 401 as a missing or invalid key and asks for one.
      else return fail(401, 'The TMDB API key is not set')
    }

    // Errors never echo the upstream URL: it may contain the key.
    forward(target.url, target.headers, request, response).catch(() => {
      if (response.headersSent) response.destroy()
      else fail(502, 'TMDB is unreachable')
    })
  }
}
