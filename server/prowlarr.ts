import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { FailingIndexers, MagnetResponse, ProwlarrErrorBody, ProwlarrStatus, Release } from '../src/api/prowlarr/types.ts'

/**
 * Same-origin bridge to Prowlarr. Unlike a plain proxy it reshapes responses, because Prowlarr's
 * download links carry its API key and must not reach the browser:
 *
 * GET /prowlarr/search?query=…&type=search|movie|tvsearch&categories=2000 → Release[]
 * GET /prowlarr/download?token=… → the .torrent file, or { magnet } when the release is a magnet link
 * GET /prowlarr/status → { version, indexers }, to check the connection from Settings
 * GET /prowlarr/failing?within=ms → { indexers: names }, the enabled indexers that failed in the last
 *   `within` ms (since a search started) or that Prowlarr has put on hold after failures (its search
 *   skips those and says nothing)
 *
 * Runs as Vite middleware in dev and in the production server.
 */
export interface ProwlarrConfig {
  /** e.g. http://192.168.1.10:9696 */
  url?: string
  /** A function when the key is read on every request, e.g. from Prowlarr's own config.xml. */
  apiKey?: string | (() => Promise<string | undefined>)
  /** How long /prowlarr/failing waits for Prowlarr. Default 5 s. */
  failingTimeoutMs?: number
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

type Handler = (base: string, apiKey: string, query: URLSearchParams, response: ServerResponse) => Promise<void>

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

/** What Kinoseed reads from Prowlarr's /api/v1/indexer. */
interface ProwlarrIndexer {
  id?: number
  name?: string
  enable?: boolean
}

/** What Kinoseed reads from Prowlarr's /api/v1/indexerstatus: indexers that have failed lately. */
interface ProwlarrIndexerStatus {
  indexerId?: number
  /** ISO date until which Prowlarr skips the indexer. */
  disabledTill?: string
  mostRecentFailure?: string
}

/**
 * Ids of the indexers that failed at or after `since`, or that are on hold now. Prowlarr's search
 * answers 200 with whatever the other indexers found, so this is the only way to tell.
 */
export function failedIds(statuses: ProwlarrIndexerStatus[], since: number, now: number): Set<number> {
  return new Set(
    statuses
      .filter(
        (status) =>
          Date.parse(status.disabledTill ?? '') > now || Date.parse(status.mostRecentFailure ?? '') >= since,
      )
      .map((status) => status.indexerId)
      // A row without an id is malformed, never a failure.
      .filter((id): id is number => typeof id === 'number'),
  )
}

/** Names of the enabled indexers among `ids`, sorted. */
export function indexerNames(indexers: ProwlarrIndexer[], ids: Set<number>): string[] {
  return indexers
    .filter((indexer) => indexer.enable && indexer.name && typeof indexer.id === 'number' && ids.has(indexer.id))
    .map((indexer) => indexer.name!)
    .sort((a, b) => a.localeCompare(b))
}

/**
 * The longest `within` accepted, as the client's MAX_FAILING_WITHIN_MS (a value, so not imported:
 * the image carries server/ without src/; a test keeps them equal).
 */
export const MAX_WITHIN_MS = 10 * 60 * 1000

/**
 * `within` is how long ago the search started, measured by the browser on its own monotonic clock:
 * a duration, so a phone whose clock is off still asks about the right moment, which the server
 * dates by its own clock (on the same machine as Prowlarr's, on Umbrel).
 */
function failing(timeoutMs: number): Handler {
  return async (base, apiKey, query, response) => {
    const within = query.get('within') ?? ''
    if (!/^\d+$/.test(within) || Number(within) > MAX_WITHIN_MS) return fail(response, 400, 'bad-request')
    const since = Date.now() - Number(within)
    // A note beside the results isn't worth a request that hangs: give up and say unreachable.
    const init = { headers: { 'X-Api-Key': apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) }
    /** A list from Prowlarr; anything else (an error, a proxy's login page) is an UpstreamError. */
    const list = async (path: string): Promise<unknown[]> => {
      const upstream = await fetch(`${base}${path}`, init)
      if (!upstream.ok) {
        // Free the connection now rather than when the body is collected.
        await upstream.body?.cancel()
        throw new UpstreamError(upstream.status === 401 ? 'unauthorized' : 'upstream')
      }
      const body: unknown = await upstream.json().catch(() => undefined)
      if (!Array.isArray(body)) throw new UpstreamError('upstream')
      return body
    }
    try {
      const failed = failedIds((await list('/api/v1/indexerstatus')) as ProwlarrIndexerStatus[], since, Date.now())
      // The indexer list carries every indexer's full definition: fetch it only to name a failure.
      const indexers = failed.size ? ((await list('/api/v1/indexer')) as ProwlarrIndexer[]) : []
      send(response, 200, { indexers: indexerNames(indexers, failed) } satisfies FailingIndexers)
    } catch (error) {
      if (error instanceof UpstreamError) return fail(response, 502, error.code)
      throw error
    }
  }
}

class UpstreamError extends Error {
  readonly code: 'unauthorized' | 'upstream'

  constructor(code: 'unauthorized' | 'upstream') {
    super(code)
    this.code = code
  }
}

/**
 * Whether Prowlarr at `base` takes `apiKey`: 'invalid' when it answers 401, 'not-prowlarr' when
 * the answer isn't Prowlarr's status (a proxy's login page, an app's index.html). Throws when it
 * doesn't answer or answers with another error.
 */
export async function checkProwlarrKey(base: string, apiKey: string): Promise<'valid' | 'invalid' | 'not-prowlarr'> {
  const response = await fetch(`${base}/api/v1/system/status`, {
    headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
  })
  if (response.status === 401) return 'invalid'
  if (!response.ok) throw new Error(`Prowlarr answered ${response.status}`)
  const body = (await response.json().catch(() => undefined)) as { version?: unknown } | undefined
  return typeof body?.version === 'string' ? 'valid' : 'not-prowlarr'
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
  const handlers: Record<string, Handler> = { search, download, status, failing: failing(config.failingTimeoutMs ?? 5000) }

  return (request, response, next) => {
    const url = new URL(request.url ?? '/', 'http://kinoseed.local')
    if (!url.pathname.startsWith(PREFIX)) return next()
    void (async () => {
      const apiKey = (await getKey())?.trim()
      if (!base || !apiKey) return fail(response, 503, 'not-configured')
      if (request.method !== 'GET') return fail(response, 404, 'not-found')

      const route = url.pathname.slice(PREFIX.length)
      // Own keys only, so /prowlarr/constructor is a 404 like any unknown route.
      const handler = Object.hasOwn(handlers, route) ? handlers[route] : undefined
      if (!handler) return fail(response, 404, 'not-found')
      // Errors never echo upstream URLs: they would contain the API key.
      await handler(base, apiKey, url.searchParams, response)
    })().catch(() => {
      if (!response.headersSent) fail(response, 502, 'unreachable')
      else response.end()
    })
  }
}
