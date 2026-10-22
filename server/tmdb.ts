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
 * Accepts either a v3 API key or a v4 read access token (a JWT, sent as a bearer token). Browser
 * cookies are never passed on. Runs as Vite middleware in dev and in the production server.
 */
export interface TmdbConfig {
  apiKey?: string
  /** Overridable for tests. */
  apiBase?: string
  imageBase?: string
}

const API_PREFIX = '/tmdb/'
const IMAGE_PREFIX = '/tmdb-img/'
/** Upstream response headers passed on to the browser. */
const RESPONSE_HEADERS = ['content-type', 'cache-control', 'last-modified', 'etag', 'expires']

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
  const key = config.apiKey?.trim()
  const isToken = key?.startsWith('eyJ') ?? false
  const apiBase = config.apiBase ?? 'https://api.themoviedb.org/3'
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

    let url: string
    const headers: Record<string, string> = {}
    if (isApi) {
      // The app treats 401 as a missing or invalid key (Settings shows it).
      if (!key) return fail(401, 'TMDB_API_KEY is not set')
      url = `${apiBase}/${path.slice(API_PREFIX.length)}`
      if (isToken) headers.Authorization = `Bearer ${key}`
      else url += `${url.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(key)}`
    } else {
      url = `${imageBase}/${path.slice(IMAGE_PREFIX.length)}`
    }

    // Errors never echo the upstream URL: it may contain the key.
    forward(url, headers, request, response).catch(() => {
      if (response.headersSent) response.destroy()
      else fail(502, 'TMDB is unreachable')
    })
  }
}
