/**
 * For the server and integration tests: HTTP servers on random ports, the middleware under test
 * served the way Vite serves it, and stand-ins for qBittorrent, TMDB, Prowlarr, Telegram and a push
 * service that record what reached them. Every server started here is closed by `closeServers()`, which the tests call in
 * afterEach.
 */
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http'
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify, type ECDH } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { Release } from '../../src/api/prowlarr/types.ts'
import type { MainData, Torrent, TorrentFile, TorrentTracker } from '../../src/api/qbittorrent/types.ts'
import { RELEASES, TITLES, TORRENTS, details, mainData, page, shogunTorrent } from '../../src/test/fixtures.ts'
import { handle as handleTmdbProxy } from '../../tmdb-proxy/worker.ts'
import type { PushTarget } from '../webPush.ts'

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => unknown

const servers: Server[] = []

/** Starts `handler` on a free port of 127.0.0.1 and returns its origin. */
export async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/**
 * An address on this machine where nothing listens. Port 2: below 1024, so the system never hands it
 * out for port 0 to a server another test file starts meanwhile, as it can a port let go, and not one
 * of fetch's bad ports, which it refuses without connecting.
 */
export const CLOSED_ADDRESS = 'http://127.0.0.1:2'

/**
 * Kinopeer's TMDB proxy (tmdb-proxy/worker.ts), the real worker served over HTTP in front of
 * `tmdbApiBase` with `key` as its secret and a rate limiter that lets everything through, or with
 * `overLimit` refuses everything, as for an IP over its limit: what the Workers runtime does, without
 * its cache. `seen` lists the paths it got.
 */
export async function serveTmdbProxy(tmdbApiBase: string, key: string, { overLimit = false } = {}) {
  const seen: { url: string; authorization: string | undefined }[] = []
  const env = { TMDB_API_KEY: key, LIMITER: { limit: async () => ({ success: !overLimit }) } }
  const base = await listen(async (request, response) => {
    seen.push({ url: request.url ?? '', authorization: request.headers.authorization })
    const headers = new Headers({ 'cf-connecting-ip': request.socket.remoteAddress ?? '' })
    for (const [name, value] of Object.entries(request.headers)) if (typeof value === 'string') headers.set(name, value)
    const answer = await handleTmdbProxy(new Request(`http://worker${request.url}`, { method: request.method, headers }), env, {
      apiBase: tmdbApiBase,
    })
    response.statusCode = answer.status
    answer.headers.forEach((value, name) => response.setHeader(name, value))
    response.end(Buffer.from(await answer.arrayBuffer()))
  })
  return { base, apiBase: `${base}/3`, seen }
}

/** GETs `path` from `base` with `headers`, Host among them, which `fetch` won't let a caller set. */
export function getWithHost(base: string, path: string, headers: OutgoingHttpHeaders) {
  const { hostname, port } = new URL(base)
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
    httpRequest({ hostname, port, path, headers }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => (body += chunk))
      response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, body }))
    })
      .on('error', reject)
      .end()
  })
}

/** Closes every server `listen` started, with the requests they hold open; for afterEach. */
export async function closeServers(): Promise<void> {
  await Promise.all(
    servers.splice(0).map((server) => {
      const closed = new Promise((resolve) => server.close(resolve))
      server.closeAllConnections()
      return closed
    }),
  )
}

/**
 * A service that takes requests and never answers, as a hung TMDB, qBittorrent or Prowlarr does.
 * `received` resolves once a request has reached it, `closed` once Kinopeer has given that request
 * up and closed its connection.
 */
export async function silentService() {
  let receive!: () => void
  let close!: () => void
  const received = new Promise<void>((resolve) => (receive = resolve))
  const closed = new Promise<void>((resolve) => (close = resolve))
  const base = await listen((_request, response) => {
    response.on('close', close)
    receive()
  })
  return { base, received, closed }
}

/** Whether `promise` settles within `ms`. */
export function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([promise.then(() => true), new Promise<boolean>((resolve) => setTimeout(resolve, ms, false))])
}

/**
 * Sends a request to `url` the way a browser that gives up does: once `received` resolves (the
 * service behind Kinopeer has it), the request is aborted.
 */
export async function abandon(url: string, received: Promise<void>, init: RequestInit = {}): Promise<void> {
  const controller = new AbortController()
  const sent = fetch(url, { ...init, signal: controller.signal }).catch(() => undefined)
  await received
  controller.abort()
  await sent
}

/** Kinopeer's side: a middleware with a 404 fallback like Vite's, so a path it passes on is told apart. */
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

function html(response: ServerResponse, body: string): void {
  response.setHeader('Content-Type', 'text/html')
  response.end(body)
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
  firstLastPieces: boolean
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

/** What the fake qBittorrent answers on /app/preferences: the few fields Kinopeer reads, as qBittorrent's defaults. */
export const PREFERENCES = {
  auto_tmm_enabled: false,
  use_category_paths_in_manual_mode: false,
  // No `use_subcategories`: qBittorrent 5.2 dropped it from the preferences, subcategories are always on.
  /** "When Torrent Category changed: Relocate torrent", qBittorrent's default. */
  torrent_changed_tmm_enabled: true,
  /** "Keep incomplete torrents in", off by default. */
  temp_path_enabled: false,
  /** "When Default Save Path changed" and "When Category Save Path changed": switch the affected torrents to manual mode, qBittorrent's default. */
  save_path_changed_tmm_enabled: false,
  category_changed_tmm_enabled: false,
  refresh_interval: 1500,
}

/**
 * Where qBittorrent 5.3 moves a torrent under automatic management when its category changes: the
 * category's path, else the default save path and the category's name; the default save path
 * without a category.
 */
function categoryPath(category: string, categories: Record<string, { savePath: string }>, savePath: string): string {
  if (!category) return savePath
  return categories[category]?.savePath || `${savePath}/${category}`
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
    firstLastPieces: field('firstLastPiecePrio') === 'true',
    topOfQueue: field('addToTopOfQueue') === 'true',
  }
}

/**
 * A qBittorrent with one user, admin / "pass word", that hands out SID cookies and can expire them
 * (`sessions.clear()`). A wrong password gets 401 (qBittorrent 5.3+), or 200 "Fails." with
 * `legacy`, which also stands for qBittorrent 4.x's /torrents/pause and /resume in place of 5.0's
 * /stop and /start (404 there); the user "banned" gets 403, as from an IP qBittorrent has banned. Every other path
 * needs a live session: the versions, the default save path and CATEGORIES, `torrents` (a copy,
 * returned as `torrents`) as /torrents/info and /sync/maindata (a full update for rid 0,
 * `mainDataDelta` after, plus what was added or deleted since the last poll), TRACKERS, and
 * adding: /torrents/add records what came in `added` (and lists what `listAdded` makes of it) and
 * refuses a magnet link to a torrent it lists with 409 (qBittorrent 5.2+), or 200 "Fails." with `legacy`,
 * /torrents/files answers `files` (set per hash by the test, 404 for a hash it doesn't have),
 * /torrents/filePrio changes their priorities, /torrents/start and /stop answer OK and leave the
 * torrents' state as it is (qBittorrent 5.1 reports the new one only at its next refresh, 1.5 s
 * by default, so polls sent before then still have the old one),
 * /torrents/delete takes the torrents off the list and records the call in `deleted`,
 * /torrents/setLocation moves torrents to `location`, every one for `all` (409 under /unmakeable, a
 * folder it can't create; from 4.5.2 qBittorrent takes an existing folder it can't write to),
 * /app/setPreferences takes a new `save_path`, which /app/defaultSavePath and /app/preferences then
 * answer (a key qBittorrent doesn't know it ignores, as qBittorrent does), /torrents/editCategory sets
 * a category's `savePath` (404 for one it doesn't have; qBittorrent before 5.3 also drops a download
 * path not sent with it, which the fake doesn't model),
 * /torrents/setCategory sets the category (409 for one not in CATEGORIES) and, for a torrent under
 * automatic management, its save path to the category's folder (qBittorrent 5.3 reports the new
 * category and folder in the next poll, with the state `moving` until the files are there, which
 * the fake skips), /torrents/toggleSequentialDownload and /toggleFirstLastPiecePrio flip `seq_dl`
 * and `f_l_piece_prio` (qBittorrent 5.3 may report the new value a second later), and
 * /app/preferences answers PREFERENCES, /torrents/info lists only the torrents with a tag when
 * asked with `tag`, and /torrents/addTags and /removeTags change the torrents' tags, sorted and
 * joined with ", " as qBittorrent lists them.
 * Written from qBittorrent 5.3.x; when a newer version answers differently, change the fake here
 * and say the version.
 */
export async function fakeQbittorrent({
  legacy = false,
  authBypass = false,
  webUiPort,
  torrents = TORRENTS,
  listAdded,
}: {
  legacy?: boolean
  /**
   * qBittorrent's auth bypass (Options → Web UI → "Bypass authentication for clients on localhost" or
   * "… in whitelisted IP subnets", in 4.x and 5.x alike) covering the server: every request goes
   * through without a session, and /app/version answers without a login.
   */
  authBypass?: boolean
  /**
   * qBittorrent's Web UI port behind a port published as another (`18080:8080`): with Host header
   * validation, on by default, every request whose `Host` has another port is answered 401 with the
   * text `Unauthorized`, the login included, as qBittorrent 4.6 to 5.3 do (seen on 5.3.0, and in
   * `WebApplication::processRequest` of each).
   */
  webUiPort?: number
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
  let savePath = '/downloads'
  // A copy, so editing never changes the fixtures.
  const categories: Record<string, { name: string; savePath: string }> = structuredClone(CATEGORIES)
  const base = await listen(async (request, response) => {
    const bytes = await bytesOf(request)
    const body = bytes.toString()
    const url = request.url ?? ''
    // On every answer, an error's included (qBittorrent 4.6 to 5.3).
    response.setHeader('X-XSS-Protection', '1; mode=block')
    if (webUiPort !== undefined && request.headers.host?.split(':')[1] !== String(webUiPort)) return text(response, 'Unauthorized', 401)
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
    if (!authBypass && !sessions.has(/SID=(\w+)/.exec(request.headers.cookie ?? '')?.[1] ?? '')) return text(response, 'Forbidden', 403)

    const { pathname, searchParams } = new URL(url, base)
    const params = new URLSearchParams(body)
    switch (pathname) {
      case '/api/v2/app/version':
        return text(response, 'v5.2.4')
      case '/api/v2/app/defaultSavePath':
        return text(response, savePath)
      case '/api/v2/torrents/categories':
        return json(response, categories)
      case '/api/v2/app/preferences':
        return json(response, { ...PREFERENCES, save_path: savePath })
      case '/api/v2/app/setPreferences': {
        const preferences = JSON.parse(params.get('json') ?? '{}') as { save_path?: string }
        if (preferences.save_path !== undefined) savePath = preferences.save_path
        return text(response, '')
      }
      case '/api/v2/torrents/editCategory': {
        const category = categories[params.get('category') ?? '']
        if (!category) return text(response, 'Category does not exist', 404)
        category.savePath = params.get('savePath') ?? category.savePath
        return text(response, '')
      }
      case '/api/v2/torrents/info': {
        const tag = searchParams.get('tag')
        return json(response, tag === null ? listing : listing.filter((torrent) => tagsOf(torrent).includes(tag)))
      }
      case '/api/v2/torrents/addTags':
      case '/api/v2/torrents/removeTags': {
        const adding = pathname.endsWith('addTags')
        const tags = (params.get('tags') ?? '').split(',').map((tag) => tag.trim()).filter(Boolean)
        const hashes = new Set((params.get('hashes') ?? '').split('|'))
        for (const [index, torrent] of listing.entries()) {
          if (!hashes.has(torrent.hash)) continue
          const kept = tagsOf(torrent).filter((tag) => !tags.includes(tag))
          listing[index] = { ...torrent, tags: (adding ? [...kept, ...tags] : kept).sort().join(', ') }
        }
        return text(response, '')
      }
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
        const listed = new Set(listing.map((torrent) => torrent.hash))
        if (item.urls.length && item.urls.every((uri) => listed.has(/btih:(\w+)/.exec(uri)?.[1]?.toLowerCase() ?? ''))) {
          return legacy ? text(response, 'Fails.') : text(response, '', 409)
        }
        added.push(item)
        const listedNow = listAdded?.(item)
        if (listedNow) {
          listing.push(listedNow)
          pendingAdded.push(listedNow)
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
        return legacy ? text(response, 'Not Found', 404) : text(response, '')
      case '/api/v2/torrents/resume':
      case '/api/v2/torrents/pause':
        return legacy ? text(response, '') : text(response, 'Not Found', 404)
      case '/api/v2/torrents/setCategory': {
        const category = params.get('category') ?? ''
        if (category && !(category in categories)) return text(response, 'Incorrect category name', 409)
        const hashes = new Set((params.get('hashes') ?? '').split('|'))
        for (const [index, torrent] of listing.entries())
          if (hashes.has(torrent.hash))
            listing[index] = { ...torrent, category, ...(torrent.auto_tmm && { save_path: categoryPath(category, categories, savePath) }) }
        return text(response, '')
      }
      case '/api/v2/torrents/toggleSequentialDownload':
      case '/api/v2/torrents/toggleFirstLastPiecePrio': {
        const field = pathname.endsWith('SequentialDownload') ? 'seq_dl' : 'f_l_piece_prio'
        const hashes = new Set((params.get('hashes') ?? '').split('|'))
        for (const [index, torrent] of listing.entries())
          if (hashes.has(torrent.hash)) listing[index] = { ...torrent, [field]: !torrent[field] }
        return text(response, '')
      }
      case '/api/v2/torrents/setLocation': {
        // qBittorrent 4.5.2+: "Cannot make save path" for a folder it can't create, and 200 for one
        // it can't write to (the torrent fails later), so nothing here answers 403.
        const location = params.get('location') ?? ''
        if (location.startsWith('/unmakeable')) return text(response, 'Cannot make save path', 409)
        const hashes = new Set((params.get('hashes') ?? '').split('|'))
        for (const [index, torrent] of listing.entries())
          if (hashes.has('all') || hashes.has(torrent.hash)) listing[index] = { ...torrent, save_path: location }
        return text(response, '')
      }
      default:
        return text(response, 'Not Found', 404)
    }
  })
  return { base, seen, sessions, added, deleted, files, categories, torrents: listing, savePath: () => savePath, logins: () => logins }
}

/** A torrent's tags, which qBittorrent lists as one string joined with ", ". */
function tagsOf(torrent: Torrent): string[] {
  return (torrent.tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean)
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
 * does; anything else is an empty result list with a tracking cookie, which Kinopeer must not
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

/** The head of Prowlarr's sign-in page, as frontend/src/login.html has it. */
const PROWLARR_LOGIN = '<!doctype html><html><head><meta name="description" content="Prowlarr" /><title>Login - Prowlarr</title></head><body></body></html>'

/**
 * A Prowlarr that needs `apiKey` in X-Api-Key on every API call (401 otherwise) and records what
 * reached it. /api/v1/system/status and /api/v1/indexer (two enabled, one not) serve the status
 * check; /api/v1/indexerstatus answers `indexerStatus`, the indexers that failed lately (none by
 * default), with the fields of Prowlarr's IndexerStatusResource that Kinopeer reads;
 * /api/v1/search answers `releases`, each with a download link that carries the key, as Prowlarr's
 * do; /api/v1/indexer/1/download serves by its `link`: "shogun" is the Shōgun .torrent
 * from the fixtures, "magnet" redirects to PROWLARR_MAGNET, anything else is 404.
 * /login is its sign-in page, which needs no key, with Prowlarr's title (`PROWLARR_LOGIN`).
 * Written from Prowlarr 1.24.x; when a newer version answers differently, change the fake here and
 * say the version.
 */
export async function fakeProwlarr({
  apiKey = 'prowlarr-key',
  releases = RELEASES,
  indexerStatus = [],
}: {
  apiKey?: string
  releases?: Release[]
  indexerStatus?: { indexerId: number; mostRecentFailure?: string; disabledTill?: string }[]
} = {}) {
  const seen: ProwlarrRequest[] = []
  const base = await listen((request, response) => {
    const url = request.url ?? ''
    const key = request.headers['x-api-key']?.toString()
    seen.push({ url, key })
    const { pathname, searchParams } = new URL(url, base)
    // Prowlarr's sign-in page, served to anyone (its frontend/src/login.html).
    if (pathname === '/login') return html(response, PROWLARR_LOGIN)
    if (key !== apiKey) return text(response, 'Unauthorized', 401)
    if (pathname === '/api/v1/system/status') return json(response, { version: '1.24.3.4754' })
    if (pathname === '/api/v1/indexer') {
      return json(response, [
        { id: 1, name: 'Indexer A', enable: true },
        { id: 2, name: 'Indexer B', enable: true },
        { id: 3, name: 'Indexer C', enable: false },
      ])
    }
    if (pathname === '/api/v1/indexerstatus') return json(response, indexerStatus)
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

// Telegram

/** A bot token the fake Telegram knows. */
export const TELEGRAM_TOKEN = '123456:ABCdefGhIJKlmNoPQRsTUVwxyZ-_0123456'

/** A token shaped like one that the fake Telegram doesn't know, as a token @BotFather revoked. */
export const UNKNOWN_TELEGRAM_TOKEN = '999:ABCdefGhIJKlmNoPQRsTUVwxyZ-_0123456'

/** Another token of TELEGRAM_TOKEN's bot (the same id before the colon), as @BotFather renews one. */
export const RENEWED_TELEGRAM_TOKEN = '123456:NEWdefGhIJKlmNoPQRsTUVwxyZ-_0123456'

/** The token of another bot than TELEGRAM_TOKEN's, for a bot saved in its place. */
export const OTHER_TELEGRAM_TOKEN = '777:ABCdefGhIJKlmNoPQRsTUVwxyZ-_0123456'

/** What the fake Telegram saw: the method called, with the token in the path, and the JSON body. */
export interface TelegramRequest {
  path: string
  body: Record<string, unknown>
}

/**
 * Telegram's Bot API 7.0 and later (`link_preview_options` came in 7.0) for the bot TELEGRAM_TOKEN,
 * whose @username is `kinopeer_home_bot`: any other token is 401 on every method. `getUpdates`
 * answers a /start from each chat in `started` (a private chat 42 by default), or a 409 while
 * `conflict` is set, as Telegram does while the bot has a webhook or another program polls it;
 * `sendMessage` takes any chat in `started` and refuses any other with a 403, as a chat that
 * blocked the bot. `down` answers every call with a 502, `unavailable` only the methods it names,
 * and `hold`, while set, keeps every answer until it resolves. All of them can be changed while it
 * runs.
 */
export async function fakeTelegram() {
  const seen: TelegramRequest[] = []
  const state = {
    started: [{ id: 42, type: 'private', first_name: 'Alex' }] as { id: number; type: string; first_name?: string; title?: string }[],
    down: false,
    unavailable: [] as string[],
    conflict: false,
    hold: undefined as Promise<void> | undefined,
  }
  const base = await listen(async (request, response) => {
    const path = request.url ?? ''
    const body = JSON.parse((await bodyOf(request)) || '{}') as Record<string, unknown>
    seen.push({ path, body })
    await state.hold
    if (state.down) return json(response, { ok: false, error_code: 502, description: 'Bad Gateway' }, 502)
    const match = /^\/bot([^/]+)\/(\w+)$/.exec(path)
    if (!match || match[1] !== TELEGRAM_TOKEN) return json(response, { ok: false, error_code: 401, description: 'Unauthorized' }, 401)
    const method = match[2]
    if (state.unavailable.includes(method)) return json(response, { ok: false, error_code: 502, description: 'Bad Gateway' }, 502)
    if (method === 'getMe') return json(response, { ok: true, result: { id: 123456, is_bot: true, username: 'kinopeer_home_bot' } })
    if (method === 'getUpdates') {
      if (state.conflict) {
        return json(response, { ok: false, error_code: 409, description: 'Conflict: can\'t use getUpdates method while webhook is active' }, 409)
      }
      const result = state.started.map((chat, index) => ({ update_id: index + 1, message: { message_id: index + 1, text: '/start', chat } }))
      return json(response, { ok: true, result })
    }
    if (method === 'sendMessage') {
      return state.started.some((chat) => chat.id === body.chat_id)
        ? json(response, { ok: true, result: { message_id: 1 } })
        : json(response, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, 403)
    }
    json(response, { ok: false, error_code: 404, description: 'Not Found' }, 404)
  })
  return { base, seen, state, sent: () => seen.filter((request) => request.path.endsWith('/sendMessage')).map((request) => request.body) }
}

/** A browser's side of a push subscription: its keys, and what it needs to read a push. */
export interface FakeBrowser {
  keys: Pick<PushTarget, 'p256dh' | 'auth'>
  /** The payload of an `aes128gcm` body encrypted for this browser, as RFC 8291 has it decrypt one. */
  decrypt: (body: Buffer) => Buffer
}

/** A browser's subscription keys; `ecdh` and `auth` fix them (RFC 8291's example). */
export function fakeBrowser(ecdh: ECDH = createECDH('prime256v1'), auth: Buffer = randomBytes(16)): FakeBrowser {
  if (!safePrivateKey(ecdh)) ecdh.generateKeys()
  const browserKey = ecdh.getPublicKey()
  return {
    keys: { p256dh: browserKey.toString('base64url'), auth: auth.toString('base64url') },
    decrypt: (body) => {
      const salt = body.subarray(0, 16)
      const keyLength = body.readUInt8(20)
      const serverKey = body.subarray(21, 21 + keyLength)
      const record = body.subarray(21 + keyLength)
      const derive = (key: Buffer, salt: Buffer, info: string | Buffer, length: number) =>
        Buffer.from(hkdfSync('sha256', key, salt, typeof info === 'string' ? Buffer.from(info) : info, length))
      const ikm = derive(ecdh.computeSecret(serverKey), auth, Buffer.concat([Buffer.from('WebPush: info\0'), browserKey, serverKey]), 32)
      const decipher = createDecipheriv('aes-128-gcm', derive(ikm, salt, 'Content-Encoding: aes128gcm\0', 16), derive(ikm, salt, 'Content-Encoding: nonce\0', 12))
      decipher.setAuthTag(record.subarray(record.length - 16))
      const padded = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()])
      // The last record ends with the delimiter 2, then zeros of padding.
      const end = padded.lastIndexOf(2)
      if (end < 0 || padded.subarray(end + 1).some((byte) => byte !== 0)) throw new Error('not the last record')
      return padded.subarray(0, end)
    },
  }
}

function safePrivateKey(ecdh: ECDH): boolean {
  try {
    ecdh.getPrivateKey()
    return true
  } catch {
    return false
  }
}

/** A push the fake service took: the subscription's path, its headers, and the payload as its browser reads it. */
export interface ReceivedPush {
  path: string
  headers: Record<string, string | string[] | undefined>
  payload: unknown
}

/**
 * Whether `headers` carry what a push service asks of a push: a `TTL` (RFC 8030, section 5.2) and a
 * VAPID token (RFC 8292) for `origin`, good for at most 24 hours, that the key it names verifies.
 */
function pushAllowed(headers: IncomingHttpHeaders, origin: string): boolean {
  if (!/^\d+$/.test(String(headers.ttl ?? ''))) return false
  const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(String(headers.authorization ?? ''))
  if (!match) return false
  const [, head, claims, signature, publicKey] = match
  const point = Buffer.from(publicKey, 'base64url')
  if (point.length !== 65) return false
  const { aud, exp } = JSON.parse(Buffer.from(claims, 'base64url').toString()) as { aud?: unknown; exp?: unknown }
  const now = Date.now() / 1000
  if (aud !== origin || typeof exp !== 'number' || exp <= now || exp > now + 24 * 60 * 60) return false
  const key = createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') },
    format: 'jwk',
  })
  return verify('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))
}

/**
 * A push service on 127.0.0.1: each subscription is a path on it (`subscribe`), with a browser that
 * decrypts what's sent to it. As a real one, it refuses a push without a `TTL` or a VAPID token that
 * holds (400 and 401) and answers 404 at a path nothing subscribed. A subscribed path answers
 * `answers[path]` (201 by default), with `retryAfter` as `Retry-After`; `pushes` lists what it took.
 */
export async function fakePushService() {
  const browsers = new Map<string, FakeBrowser>()
  const answers: Record<string, { status: number; retryAfter?: string }> = {}
  const pushes: ReceivedPush[] = []
  const origin: string = await listen(async (request, response) => {
    const path = request.url ?? ''
    const body = await bytesOf(request)
    const browser = browsers.get(path)
    const answer = answers[path] ?? (!browser ? { status: 404 } : !request.headers.ttl ? { status: 400 } : !pushAllowed(request.headers, origin) ? { status: 401 } : { status: 201 })
    if (answer.status === 201 && browser) pushes.push({ path, headers: request.headers, payload: JSON.parse(browser.decrypt(body).toString()) })
    response.statusCode = answer.status
    if (answer.retryAfter) response.setHeader('Retry-After', answer.retryAfter)
    response.end()
  })
  return {
    origin,
    answers,
    pushes,
    /** A new subscription on the service: its endpoint and keys, as the browser hands them to Kinopeer. */
    subscribe(path: string): PushTarget {
      const browser = fakeBrowser()
      browsers.set(path, browser)
      return { endpoint: `${origin}${path}`, ...browser.keys }
    },
  }
}
