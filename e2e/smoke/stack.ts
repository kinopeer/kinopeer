/**
 * The smoke stand (docs/TESTING.md → Smoke journeys): the fake qBittorrent, TMDB and Prowlarr from
 * server/test/fakes.ts, the real production server (`node server/main.ts`, serving dist/) in
 * front of them, and in front of the server a reverse proxy that behaves like Umbrel's app_proxy:
 * a page load gets a session cookie, and every other request without it is 401, so a fetch that
 * forgets `credentials: 'same-origin'` fails its journey.
 *
 * Playwright starts it as the smoke config's webServer. The journeys run in another process, so
 * they reach the stand through its control server (control.ts): GET /__state answers what the
 * fakes saw and what the server saved, POST /__reset restarts the server with a fresh data
 * directory and fresh fakes in the state the body asks for.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { bodyOf, closeServers, fakeProwlarr, fakeQbittorrent, fakeTmdb } from '../../server/test/fakes.ts'
import { TORRENTS, torrent, torrentFiles } from '../../src/test/fixtures.ts'
import {
  APP_PORT,
  CONTROL_PORT,
  LOGIN,
  PROWLARR_KEY,
  PROXY_COOKIE,
  PROXY_DENIED_HEADER,
  PROXY_PORT,
  SHOGUN_HASH,
  TMDB_KEY,
  type ResetOptions,
  type StandState,
} from './control.ts'

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..')
const APP_URL = `http://127.0.0.1:${APP_PORT}`

interface Stand {
  qbittorrent: Awaited<ReturnType<typeof fakeQbittorrent>>
  tmdb: Awaited<ReturnType<typeof fakeTmdb>>
  prowlarr: Awaited<ReturnType<typeof fakeProwlarr>>
  dataDir: string
  app: ChildProcess
}

let stand: Stand | undefined

/** Starts the fakes, writes the data directory and spawns the server; resolves once it answers /healthz. */
async function start(options: ResetOptions): Promise<Stand> {
  const [qbittorrent, tmdb, prowlarr] = await Promise.all([
    fakeQbittorrent({
      torrents: options.torrents ?? TORRENTS,
      // The only torrent the fake Prowlarr hands out, listed the way qBittorrent would list it.
      listAdded: (added) =>
        torrent(SHOGUN_HASH, {
          name: 'Shogun.S01.2160p',
          tags: added.tags.join(','),
          category: added.category ?? '',
          save_path: added.savePath ?? '/downloads',
          size: torrentFiles().reduce((sum, file) => sum + file.size, 0),
        }),
    }),
    fakeTmdb(),
    fakeProwlarr({ apiKey: PROWLARR_KEY }),
  ])
  qbittorrent.files.set(SHOGUN_HASH, torrentFiles())

  const dataDir = await mkdtemp(join(tmpdir(), 'kinoseed-smoke-'))
  if (options.configured !== false) {
    const settings = { tmdbApiKey: TMDB_KEY, qbittorrentUsername: LOGIN.username, qbittorrentPassword: LOGIN.password }
    await writeFile(join(dataDir, 'settings.json'), JSON.stringify(settings))
  }
  if (options.matches) await writeFile(join(dataDir, 'matches.json'), JSON.stringify(options.matches))

  const app = spawn(process.execPath, ['server/main.ts'], {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
    // Only what the server needs: nothing from the shell, such as a real TMDB key, may leak in.
    env: {
      PATH: process.env.PATH,
      PORT: String(APP_PORT),
      HOST: '127.0.0.1',
      KINOSEED_DIST: 'dist',
      KINOSEED_DATA_DIR: dataDir,
      QBITTORRENT_URL: qbittorrent.base,
      PROWLARR_URL: prowlarr.base,
      PROWLARR_API_KEY: PROWLARR_KEY,
      TMDB_API_URL: tmdb.apiBase,
      // Off, so the journeys never reach the real proxy; the onboarding asks for a key as before.
      TMDB_PROXY_URL: '',
      TMDB_IMAGE_URL: `${tmdb.base}/t/p`,
    },
  })
  const exited = new Promise<never>((_, reject) => app.once('exit', (code) => reject(new Error(`The server exited with ${code}`))))
  await Promise.race([exited, waitForHealth()])
  return { qbittorrent, tmdb, prowlarr, dataDir, app }
}

async function waitForHealth(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      if ((await fetch(`${APP_URL}/healthz`)).ok) return
    } catch {
      // Not listening yet.
    }
    await sleep(50)
  }
  throw new Error('The server did not answer /healthz in time')
}

async function stop(current: Stand): Promise<void> {
  const exited = new Promise<void>((resolve) => current.app.once('exit', () => resolve()))
  current.app.kill('SIGTERM')
  await exited
  await closeServers()
  await rm(current.dataDir, { recursive: true, force: true })
}

async function restart(options: ResetOptions): Promise<void> {
  if (stand) await stop(stand)
  stand = undefined
  stand = await start(options)
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch {
    return null
  }
}

async function stateOf(current: Stand): Promise<StandState> {
  const { qbittorrent, tmdb, prowlarr, dataDir } = current
  return {
    qbittorrent: {
      seen: qbittorrent.seen,
      added: qbittorrent.added.map(({ files, tags, category, stopped }) => ({
        files: files.map((file) => ({ name: file.name, size: file.bytes.length })),
        tags,
        category,
        stopped,
      })),
      deleted: qbittorrent.deleted,
      logins: qbittorrent.logins(),
      torrents: qbittorrent.torrents.map((item) => item.hash),
    },
    tmdb: { seen: tmdb.seen },
    prowlarr: { seen: prowlarr.seen },
    settings: (await readJson(join(dataDir, 'settings.json'))) as StandState['settings'],
    matches: (await readJson(join(dataDir, 'matches.json'))) as StandState['matches'],
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(body))
}

/** GET /__state and POST /__reset for the journeys. */
function control(request: IncomingMessage, response: ServerResponse): void {
  void (async () => {
    if (request.method === 'GET' && request.url === '/__state') {
      if (!stand) return json(response, 503, { error: 'The server is restarting' })
      return json(response, 200, await stateOf(stand))
    }
    if (request.method === 'POST' && request.url === '/__reset') {
      await restart(JSON.parse((await bodyOf(request)) || '{}') as ResetOptions)
      return json(response, 200, { ok: true })
    }
    json(response, 404, { error: 'not-found' })
  })().catch((error: unknown) => {
    json(response, 500, { error: String(error) })
  })
}

/**
 * The proxy: a page load (GET /, or any document request) without the cookie gets it and goes
 * through; every other request without it is refused with 401, as Umbrel's app_proxy refuses
 * calls from outside a session.
 */
function proxy(request: IncomingMessage, response: ServerResponse): void {
  const cookies = request.headers.cookie ?? ''
  const hasCookie = new RegExp(`(?:^|;\\s*)${PROXY_COOKIE}=1(?:;|$)`).test(cookies)
  const pageLoad = request.method === 'GET' && (request.url === '/' || request.headers['sec-fetch-dest'] === 'document')
  if (!hasCookie && !pageLoad) {
    response.statusCode = 401
    response.setHeader(PROXY_DENIED_HEADER, 'denied')
    response.setHeader('Content-Type', 'text/plain; charset=utf-8')
    return void response.end('The session cookie is missing')
  }
  const upstream = httpRequest(
    {
      host: '127.0.0.1',
      port: APP_PORT,
      method: request.method,
      path: request.url,
      headers: { ...request.headers, host: `127.0.0.1:${APP_PORT}` },
      // A new connection each time, so a restarted server never gets a stale one.
      agent: false,
    },
    (answer) => {
      const headers = { ...answer.headers }
      if (!hasCookie) headers['set-cookie'] = [...(answer.headers['set-cookie'] ?? []), `${PROXY_COOKIE}=1; Path=/; HttpOnly`]
      response.writeHead(answer.statusCode ?? 502, headers)
      answer.pipe(response)
    },
  )
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('The server is not answering')
  })
  request.pipe(upstream)
}

function listen(handler: (request: IncomingMessage, response: ServerResponse) => void, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    createServer(handler).once('error', reject).listen(port, '127.0.0.1', resolve)
  })
}

async function main(): Promise<void> {
  await listen(control, CONTROL_PORT)
  await restart({})
  // Last, so the readiness check (GET / through the proxy) passes only with everything up.
  await listen(proxy, PROXY_PORT)
  console.log(`[smoke] proxy on http://localhost:${PROXY_PORT}, control on http://127.0.0.1:${CONTROL_PORT}`)

  const quit = () => {
    void (stand ? stop(stand) : Promise.resolve()).finally(() => process.exit(0))
  }
  process.on('SIGTERM', quit)
  process.on('SIGINT', quit)
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
