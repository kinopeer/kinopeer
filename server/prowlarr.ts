import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { MagnetResponse, ProwlarrErrorBody, ProwlarrStatus, Release } from '../src/api/prowlarr/types.ts'

/**
 * Same-origin bridge to Prowlarr. Unlike a plain proxy it reshapes responses, because Prowlarr's
 * download links carry its API key and must not reach the browser:
 *
 * GET /prowlarr/search?query=…&type=search|movie|tvsearch&categories=2000 → Release[]
 * GET /prowlarr/download?token=… → the .torrent file, or { magnet } when the release is a magnet link
 * GET /prowlarr/status → { version, indexers }, to check the connection from Settings
 *
 * Runs as Vite middleware in dev and in the production server.
 */
export interface ProwlarrConfig {
  /** e.g. http://192.168.1.10:9696 */
  url?: string
  /** A function when the key is read on every request, e.g. from Prowlarr's own config.xml. */
  apiKey?: string | (() => Promise<string | undefined>)
}

type Next = (error?: unknown) => void
export type Middleware = (request: IncomingMessage, response: ServerResponse, next: Next) => void

const PREFIX = '/prowlarr/'
const SEARCH_TYPES = new Set(['search', 'movie', 'tvsearch'])
const MAX_TORRENT_BYTES = 20 * 1024 * 1024
const MAX_REDIRECTS = 3
const BENCODE_DICT = 0x64 // "d"

/** What Kinoseed reads from Prowlarr's /api/v1/search results. */
interface ProwlarrRelease {
  guid?: string
  title?: string
  indexer?: string
  size?: number
  seeders?: number
  leechers?: number
  publishDate?: string
  infoUrl?: string
  categories?: { id: number }[]
  infoHash?: string
  magnetUrl?: string
  downloadUrl?: string
  imdbId?: number
  tmdbId?: number
  protocol?: string
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(body))
}

function fail(response: ServerResponse, status: number, error: ProwlarrErrorBody['error']): void {
  send(response, status, { error } satisfies ProwlarrErrorBody)
}

/**
 * Prowlarr download links look like {base}/{indexerId}/download?apikey=…&link=…&file=…. The token
 * keeps the indexer id and the query without the key, so the server can rebuild the link later.
 */
export function downloadToken(link: string | undefined): string | undefined {
  if (!link) return undefined
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return undefined
  }
  const match = /\/(\d+)\/download$/.exec(url.pathname)
  if (!match) return undefined
  url.searchParams.delete('apikey')
  return `${match[1]}/download?${url.searchParams}`
}

function downloadUrl(base: string, token: string, apiKey: string): URL | undefined {
  const match = /^(\d+)\/download\?(.*)$/.exec(token)
  if (!match) return undefined
  const params = new URLSearchParams(match[2])
  params.delete('apikey')
  params.set('apikey', apiKey)
  // The /api/ path, not Prowlarr's /{id}/download alias: proxies in front of Prowlarr (e.g. Umbrel's
  // app auth) often let only /api/* through without their own login.
  return new URL(`${base}/api/v1/indexer/${match[1]}/download?${params}`)
}

export function toRelease(item: ProwlarrRelease): Release | undefined {
  if (!item.guid || !item.title || (item.protocol && item.protocol !== 'torrent')) return undefined
  const magnet = item.magnetUrl?.startsWith('magnet:') ? item.magnetUrl : undefined
  const download = downloadToken(item.downloadUrl) ?? (magnet ? undefined : downloadToken(item.magnetUrl))
  if (!magnet && !download) return undefined
  return {
    id: item.guid,
    title: item.title,
    indexer: item.indexer ?? '',
    size: item.size ?? 0,
    seeders: item.seeders,
    leechers: item.leechers,
    publishDate: item.publishDate,
    infoUrl: item.infoUrl,
    categories: (item.categories ?? []).map((category) => category.id),
    infoHash: item.infoHash?.toLowerCase(),
    magnet,
    download,
    imdbId: item.imdbId || undefined,
    tmdbId: item.tmdbId || undefined,
  }
}

async function search(base: string, apiKey: string, query: URLSearchParams, response: ServerResponse): Promise<void> {
  const term = query.get('query')?.trim()
  const type = query.get('type') ?? 'search'
  const categories = query.getAll('categories')
  if (!term || !SEARCH_TYPES.has(type) || categories.some((category) => !/^\d+$/.test(category))) {
    return fail(response, 400, 'bad-request')
  }

  const params = new URLSearchParams({ query: term, type, limit: '100' })
  for (const category of categories) params.append('categories', category)
  const upstream = await fetch(`${base}/api/v1/search?${params}`, {
    headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
  })
  if (upstream.status === 401) return fail(response, 502, 'unauthorized')
  if (!upstream.ok) return fail(response, 502, 'upstream')

  const items = (await upstream.json()) as ProwlarrRelease[]
  const releases = items.map(toRelease).filter((release): release is Release => release !== undefined)
  send(response, 200, releases)
}

async function download(base: string, apiKey: string, query: URLSearchParams, response: ServerResponse): Promise<void> {
  let url: URL | undefined = downloadUrl(base, query.get('token') ?? '', apiKey)
  if (!url) return fail(response, 400, 'bad-request')

  // Prowlarr answers with the file, or redirects to a magnet link or to the tracker's own link.
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const upstream: Response = await fetch(url, {
      redirect: 'manual',
      headers: hop === 0 ? { 'X-Api-Key': apiKey } : undefined,
    })
    const location = upstream.headers.get('location')
    if (upstream.status >= 300 && upstream.status < 400 && location) {
      if (location.startsWith('magnet:')) return send(response, 200, { magnet: location } satisfies MagnetResponse)
      const next: URL = new URL(location, url)
      if (next.protocol !== 'http:' && next.protocol !== 'https:') return fail(response, 502, 'upstream')
      url = next
      continue
    }
    if (upstream.status === 401) return fail(response, 502, 'unauthorized')
    if (upstream.status === 404) return fail(response, 404, 'not-found')
    if (!upstream.ok) return fail(response, 502, 'upstream')

    const bytes = new Uint8Array(await upstream.arrayBuffer())
    // A .torrent is a bencoded dictionary; anything else (say, a proxy's login page) is not one.
    if (bytes.length > MAX_TORRENT_BYTES || bytes[0] !== BENCODE_DICT) return fail(response, 502, 'upstream')
    response.statusCode = 200
    response.setHeader('Content-Type', 'application/x-bittorrent')
    response.setHeader('Cache-Control', 'no-store')
    response.end(bytes)
    return
  }
  fail(response, 502, 'upstream')
}

async function status(base: string, apiKey: string, _query: URLSearchParams, response: ServerResponse): Promise<void> {
  const headers = { 'X-Api-Key': apiKey, Accept: 'application/json' }
  const [system, indexers] = await Promise.all([
    fetch(`${base}/api/v1/system/status`, { headers }),
    fetch(`${base}/api/v1/indexer`, { headers }),
  ])
  if (system.status === 401 || indexers.status === 401) return fail(response, 502, 'unauthorized')
  if (!system.ok || !indexers.ok) return fail(response, 502, 'upstream')

  const { version } = (await system.json()) as { version?: string }
  const list = (await indexers.json()) as { enable?: boolean }[]
  send(response, 200, {
    version: version ?? '',
    indexers: list.filter((indexer) => indexer.enable).length,
  } satisfies ProwlarrStatus)
}

/** Prowlarr's API key from its config.xml (<ApiKey>…</ApiKey>), or undefined when it can't be read. */
export async function readProwlarrApiKey(configXmlPath: string): Promise<string | undefined> {
  try {
    const xml = await readFile(configXmlPath, 'utf8')
    return /<ApiKey>\s*([^<\s]+)\s*<\/ApiKey>/.exec(xml)?.[1]
  } catch {
    return undefined
  }
}

export function prowlarrMiddleware(config: ProwlarrConfig): Middleware {
  const base = config.url?.trim().replace(/\/+$/, '')
  const getKey = typeof config.apiKey === 'function' ? config.apiKey : async () => config.apiKey as string | undefined

  return (request, response, next) => {
    const url = new URL(request.url ?? '/', 'http://kinoseed.local')
    if (!url.pathname.startsWith(PREFIX)) return next()
    void (async () => {
      const apiKey = (await getKey())?.trim()
      if (!base || !apiKey) return fail(response, 503, 'not-configured')
      if (request.method !== 'GET') return fail(response, 404, 'not-found')

      const route = url.pathname.slice(PREFIX.length)
      const handler =
        route === 'search' ? search : route === 'download' ? download : route === 'status' ? status : undefined
      if (!handler) return fail(response, 404, 'not-found')
      // Errors never echo upstream URLs: they would contain the API key.
      await handler(base, apiKey, url.searchParams, response)
    })().catch(() => {
      if (!response.headersSent) fail(response, 502, 'unreachable')
      else response.end()
    })
  }
}
