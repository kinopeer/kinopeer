/**
 * For the server and integration tests: HTTP servers on random ports, the middleware under test
 * served the way Vite serves it, and stand-ins for qBittorrent, TMDB and Prowlarr that record what
 * reached them. Every server started here is closed by `closeServers()`, which the tests call in
 * afterEach.
 */
import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Release } from '../../src/api/prowlarr/types.ts'
import type { MainData, Torrent, TorrentFile, TorrentTracker } from '../../src/api/qbittorrent/types.ts'
import { RELEASES, TITLES, TORRENTS, details, mainData, page, shogunTorrent } from '../../src/test/fixtures.ts'

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => unknown

const servers: Server[] = []

/** Starts `handler` on a free port of 127.0.0.1 and returns its origin. */
export async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/** Closes every server `listen` started; for afterEach. */
export async function closeServers(): Promise<void> {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
}

/** Kinoseed's side: a middleware with a 404 fallback like Vite's, so a path it passes on is told apart. */
export function serve(middleware: Middleware): Promise<string> {
  return listen((request, response) =>
    middleware(request, response, () => {
      response.statusCode = 404
      response.end('fallback')
    }),
  )
}

/** The request's body as bytes. */
export async function bytesOf(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of request as AsyncIterable<Buffer>) chunks.push(chunk)
  return Buffer.concat(chunks)
}

/** The request's body as text. */
export async function bodyOf(request: IncomingMessage): Promise<string> {
  return (await bytesOf(request)).toString()
}

function json(response: ServerResponse, body: unknown, status = 200): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(body))
}

function text(response: ServerResponse, body: string, status = 200): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'text/plain')
  response.end(body)
}

// qBittorrent

/** What the fake qBittorrent saw of a request past the login. */
export interface QbittorrentRequest {
  method?: string
  url?: string
  cookie?: string
  origin?: string
  contentType?: string
  body: string
}

/** A torrent as the fake qBittorrent received it on /torrents/add. */
export interface AddedTorrent {
  files: { name: string; bytes: Uint8Array }[]
  urls: string[]
  tags: string[]
  category?: string
  savePath?: string
  stopped: boolean
  sequential: boolean
  topOfQueue: boolean
}

/** A call of /torrents/delete as the fake qBittorrent got it. */
export interface DeletedTorrents {
  hashes: string[]
  deleteFiles: boolean
}

/** What the fake qBittorrent answers on /torrents/categories. */
export const CATEGORIES = {
  Movies: { name: 'Movies', savePath: '/downloads/movies' },
  'TV Shows': { name: 'TV Shows', savePath: '/downloads/tv' },
}

/** What the fake qBittorrent answers on /torrents/trackers. */
export const TRACKERS: TorrentTracker[] = [
  { url: '** [DHT] **', status: 2, msg: '' },
  { url: 'udp://tracker.test:6969/announce', status: 2, msg: '' },
  { url: 'https://down.tracker.test/announce', status: 4, msg: 'Connection timed out' },
]

/** What /sync/maindata answers after `rid`: the first torrent progressed. */
export function mainDataDelta(torrents: Torrent[], rid: number): MainData {
  return { rid: rid + 1, torrents: { [torrents[0].hash]: { progress: 0.7 } } }
}

/** Multipart fields of /torrents/add, as qBittorrent reads them. */
async function parseAdd(body: Buffer, contentType: string | undefined): Promise<AddedTorrent> {
  const form = contentType?.startsWith('multipart/form-data')
    ? await new Response(body, { headers: { 'Content-Type': contentType } }).formData()
    : new FormData()
  const files = form.getAll('torrents').filter((value): value is File => typeof value !== 'string')
  const field = (name: string) => form.get(name)?.toString()
  return {
    files: await Promise.all(files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }))),
    urls: (field('urls') ?? '').split('\n').filter(Boolean),
    tags: (field('tags') ?? '').split(',').filter(Boolean),
    category: field('category'),
    savePath: field('savepath'),
    stopped: field('stopped') === 'true',
    sequential: field('sequentialDownload') === 'true',
    topOfQueue: field('addToTopOfQueue') === 'true',
  }
}

/**
 * A qBittorrent with one user, admin / "pass word", that hands out SID cookies and can expire them
 * (`sessions.clear()`). A wrong password gets 401 (qBittorrent 5.3+), or 200 "Fails." with
 * `legacy`; the user "banned" gets 403, as from an IP qBittorrent has banned. Every other path
 * needs a live session: the versions, the default save path and CATEGORIES, `torrents` (a copy,
 * returned as `torrents`) as /torrents/info and /sync/maindata (a full update for rid 0,
 * `mainDataDelta` after, plus what was added or deleted since the last poll), TRACKERS, and
 * adding: /torrents/add records what came in `added` (and lists what `listAdded` makes of it),
 * /torrents/files answers `files` (set per hash by the test, 404 for a hash it doesn't have),
 * /torrents/filePrio changes their priorities, /torrents/start and /stop answer OK,
 * /torrents/delete takes the torrents off the list and records the call in `deleted`.
 */
export async function fakeQbittorrent({
  legacy = false,
  torrents = TORRENTS,
  listAdded,
}: {
  legacy?: boolean
  torrents?: Torrent[]
  /**
   * What qBittorrent lists for a torrent after /torrents/add: a torrent it returns joins the list
   * and the next /sync/maindata delta reports it, as qBittorrent's does. Without it, adding only
   * records `added`.
   */
  listAdded?: (added: AddedTorrent) => Torrent | undefined
} = {}) {
  const sessions = new Set<string>()
  const seen: QbittorrentRequest[] = []
  const added: AddedTorrent[] = []
  const deleted: DeletedTorrents[] = []
  const files = new Map<string, TorrentFile[]>()
  // A copy, so deleting never changes the fixtures.
  const listing = [...torrents]
  // Added and deleted since the last poll, for the next delta.
  const pendingAdded: Torrent[] = []
  const pendingRemoved: string[] = []
  let logins = 0
  const base = await listen(async (request, response) => {
    const bytes = await bytesOf(request)
    const body = bytes.toString()
    const url = request.url ?? ''
    if (url === '/api/v2/auth/login') {
      logins++
      const params = new URLSearchParams(body)
      if (params.get('username') === 'banned') return text(response, 'Forbidden', 403)
      if (params.get('username') !== 'admin' || params.get('password') !== 'pass word') {
        if (legacy) return response.end('Fails.')
        return text(response, 'Unauthorized', 401)
      }
      const sid = `sid${logins}`
      sessions.add(sid)
      response.setHeader('Set-Cookie', `SID=${sid}; HttpOnly; SameSite=Strict; path=/`)
      return response.end('Ok.')
    }
    seen.push({
      method: request.method,
      url,
      cookie: request.headers.cookie,
      origin: request.headers.origin,
      contentType: request.headers['content-type'],
      body,
    })
    if (!sessions.has(/SID=(\w+)/.exec(request.headers.cookie ?? '')?.[1] ?? '')) return text(response, 'Forbidden', 403)

    const { pathname, searchParams } = new URL(url, base)
    const params = new URLSearchParams(body)
    switch (pathname) {
      case '/api/v2/app/version':
        return text(response, 'v5.2.4')
      case '/api/v2/app/webapiVersion':
        return text(response, '2.11.4')
      case '/api/v2/app/defaultSavePath':
        return text(response, '/downloads')
      case '/api/v2/torrents/categories':
        return json(response, CATEGORIES)
      case '/api/v2/torrents/info':
        return json(response, listing)
      case '/api/v2/sync/maindata': {
        const rid = Number(searchParams.get('rid') ?? 0)
        if (!rid) {
          pendingAdded.length = 0
          pendingRemoved.length = 0
          return json(response, mainData(listing))
        }
        const delta: MainData = listing.length ? mainDataDelta(listing, rid) : { rid: rid + 1 }
        for (const { hash, ...fields } of pendingAdded.splice(0)) delta.torrents = { ...delta.torrents, [hash]: fields }
        if (pendingRemoved.length) delta.torrents_removed = pendingRemoved.splice(0)
        return json(response, delta)
      }
      case '/api/v2/torrents/trackers':
        return json(response, TRACKERS)
      case '/api/v2/torrents/add': {
        const item = await parseAdd(bytes, request.headers['content-type'])
        added.push(item)
        const listed = listAdded?.(item)
        if (listed) {
          listing.push(listed)
          pendingAdded.push(listed)
        }
        return text(response, 'Ok.')
      }
      case '/api/v2/torrents/delete': {
        const hashes = (params.get('hashes') ?? '').split('|').filter(Boolean)
        deleted.push({ hashes, deleteFiles: params.get('deleteFiles') === 'true' })
        for (const hash of hashes) {
          const index = listing.findIndex((torrent) => torrent.hash === hash)
          if (index >= 0) listing.splice(index, 1)
          pendingRemoved.push(hash)
        }
        return text(response, '')
      }
      case '/api/v2/torrents/files': {
        const list = files.get(searchParams.get('hash') ?? '')
        return list ? json(response, list) : text(response, 'Not Found', 404)
      }
      case '/api/v2/torrents/filePrio': {
        const ids = new Set((params.get('id') ?? '').split('|').map(Number))
        const priority = Number(params.get('priority')) as TorrentFile['priority']
        for (const file of files.get(params.get('hash') ?? '') ?? []) if (ids.has(file.index)) file.priority = priority
        return text(response, '')
      }
      case '/api/v2/torrents/start':
      case '/api/v2/torrents/stop':
        return text(response, '')
      default:
        return text(response, 'Not Found', 404)
    }
  })
  return { base, seen, sessions, added, deleted, files, torrents: listing, logins: () => logins }
}

// TMDB

/** What the fake TMDB saw of a request. */
export interface TmdbRequest {
  url?: string
  authorization?: string
  cookie?: string
}

/** The keys the fake TMDB rejects on every API call, so a saved or configured key can be seen to fail. */
const TMDB_BAD_KEYS = new Set(['bad-key', 'Bearer eyJbad'])

/**
 * TMDB's API and image hosts, recording what reached them. `/3/authentication` accepts the key
 * "good-key" or the bearer token "eyJgood" and answers `{ success }`; every API call with the key
 * "bad-key" or the token "eyJbad" is 401; `/3/movie/:id` and `/3/tv/:id` answer the fixtures'
 * details, or TMDB's 404 for a title they don't have; `/3/configuration` is an empty one; `/t/p/*`
 * is a JPEG; `/3/search/multi` answers the fixtures' titles whose name contains the query, when any
 * does; anything else is an empty result list with a tracking cookie, which Kinoseed must not
 * pass on.
 */
export async function fakeTmdb() {
  const seen: TmdbRequest[] = []
  const base = await listen((request, response) => {
    const url = request.url ?? ''
    seen.push({ url, authorization: request.headers.authorization, cookie: request.headers.cookie })
    if (url.startsWith('/t/p/')) {
      response.setHeader('Content-Type', 'image/jpeg')
      response.setHeader('Cache-Control', 'max-age=31536000')
      return response.end(Buffer.from([0xff, 0xd8, 0xff]))
    }
    const { pathname, searchParams } = new URL(url, base)
    const key = searchParams.get('api_key') ?? request.headers.authorization ?? ''
    if (TMDB_BAD_KEYS.has(key)) {
      return json(response, { status_code: 7, status_message: 'Invalid API key: You must be granted a valid key.' }, 401)
    }
    if (pathname.startsWith('/3/authentication')) {
      const ok = key === 'good-key' || key === 'Bearer eyJgood'
      return json(response, { success: ok }, ok ? 200 : 401)
    }
    const title = /^\/3\/(movie|tv)\/(\d+)$/.exec(pathname)
    if (title) {
      const found = details(title[1], Number(title[2]), searchParams.get('language') ?? 'en-US')
      return found
        ? json(response, found)
        : json(response, { status_code: 34, status_message: 'The resource you requested could not be found.' }, 404)
    }
    if (pathname === '/3/configuration') return json(response, { images: {} })
    if (pathname === '/3/search/multi') {
      const query = (searchParams.get('query') ?? '').toLocaleLowerCase()
      const found = TITLES.filter((item) => query && [item.en, item.ru].some((name) => name.toLocaleLowerCase().includes(query)))
      if (found.length) return json(response, page(found, searchParams.get('language') ?? 'en-US'))
    }
    response.setHeader('Content-Type', 'application/json;charset=utf-8')
    response.setHeader('Set-Cookie', 'tracking=1')
    response.end(JSON.stringify({ results: [] }))
  })
  return { base, apiBase: `${base}/3`, seen }
}

// Prowlarr

/** What the fake Prowlarr saw of a request. */
export interface ProwlarrRequest {
  url?: string
  key?: string
}

/** The magnet link the fake Prowlarr redirects a download with the link "magnet" to. */
export const PROWLARR_MAGNET = 'magnet:?xt=urn:btih:0000000000000000000000000000000000000001&dn=Shogun.S01E01'

/** A search result as Prowlarr's API returns it, with its download link carrying the key. */
function toProwlarr(release: Release, base: string, apiKey: string) {
  return {
    guid: release.id,
    title: release.title,
    indexer: release.indexer,
    size: release.size,
    seeders: release.seeders,
    leechers: release.leechers,
    publishDate: release.publishDate,
    infoUrl: release.infoUrl,
    categories: release.categories.map((id) => ({ id })),
    protocol: 'torrent',
    downloadUrl: release.download ? `${base}/1/download?apikey=${apiKey}&link=${encodeURIComponent(release.download)}` : undefined,
    magnetUrl: release.magnet,
    infoHash: release.infoHash,
    imdbId: release.imdbId,
    tmdbId: release.tmdbId,
  }
}

/**
 * A Prowlarr that needs `apiKey` in X-Api-Key on every API call (401 otherwise) and records what
 * reached it. /api/v1/system/status and /api/v1/indexer (two enabled, one not) serve the status
 * check; /api/v1/search answers `releases`, each with a download link that carries the key, as
 * Prowlarr's do; /api/v1/indexer/1/download serves by its `link`: "shogun" is the Shōgun .torrent
 * from the fixtures, "magnet" redirects to PROWLARR_MAGNET, anything else is 404.
 */
export async function fakeProwlarr({ apiKey = 'prowlarr-key', releases = RELEASES }: { apiKey?: string; releases?: Release[] } = {}) {
  const seen: ProwlarrRequest[] = []
  const base = await listen((request, response) => {
    const url = request.url ?? ''
    const key = request.headers['x-api-key']?.toString()
    seen.push({ url, key })
    const { pathname, searchParams } = new URL(url, base)
    if (key !== apiKey) return text(response, 'Unauthorized', 401)
    if (pathname === '/api/v1/system/status') return json(response, { version: '1.24.3.4754' })
    if (pathname === '/api/v1/indexer') {
      return json(response, [
        { id: 1, name: 'RuTor', enable: true },
        { id: 2, name: 'NNM-Club', enable: true },
        { id: 3, name: 'Kinozal', enable: false },
      ])
    }
    if (pathname === '/api/v1/search') {
      return json(
        response,
        releases.map((release) => toProwlarr(release, base, apiKey)),
      )
    }
    if (pathname === '/api/v1/indexer/1/download') {
      const link = searchParams.get('link')
      if (link === 'magnet') {
        response.statusCode = 302
        response.setHeader('Location', PROWLARR_MAGNET)
        return response.end()
      }
      if (link !== 'shogun') return text(response, 'Not Found', 404)
      response.setHeader('Content-Type', 'application/x-bittorrent')
      return response.end(shogunTorrent())
    }
    text(response, 'Not Found', 404)
  })
  return { base, apiKey, seen }
}
