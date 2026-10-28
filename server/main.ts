import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MatchesStore, matchesMiddleware, qbittorrentHashes, startMatchesCleanup } from './matches.ts'
import { prowlarrMiddleware, type Middleware } from './prowlarr.ts'
import { qbittorrentBridge } from './qbittorrent.ts'
import { SettingsStore, prowlarrKey, qbittorrentCredentials, settingsMiddleware, tmdbKey } from './settings.ts'
import { staticMiddleware } from './static.ts'
import { tmdbMiddleware } from './tmdb.ts'

/**
 * The production server: the built app plus the same /api/settings, /api/matches, /qbt, /prowlarr,
 * /tmdb and /tmdb-img routes the dev server has. Configured through environment variables (see .env.example)
 * and the settings saved from the app:
 *
 *   node server/main.ts
 *
 * PORT (default 8080), HOST (default 0.0.0.0) and KINOSEED_DIST (default ../dist) set where it
 * listens and what it serves; KINOSEED_DATA_DIR (default ./data) is where settings saved from the
 * app and torrent-to-title matches are kept.
 */
export function createApp(root: string, kinoseed: KinoseedServer) {
  return createServer(chain([...kinoseed.routes, staticMiddleware({ root })]))
}

/** What the server keeps in its data directory. */
export interface DataStores {
  settings: SettingsStore
  matches: MatchesStore
}

export function dataStores(dir: string): DataStores {
  return { settings: new SettingsStore(dir), matches: new MatchesStore(dir) }
}

export interface KinoseedServer {
  /** The server's own routes, shared with the Vite dev server. */
  routes: Middleware[]
  /** Starts the background jobs (the hourly matches cleanup); returns a function that stops them. */
  startJobs: () => () => void
}

/**
 * The server's routes and jobs. Besides the variables in .env.example, PROWLARR_CONFIG_XML points
 * at Prowlarr's config.xml to read its API key from (the Umbrel package mounts it), used when
 * neither a key saved from the app nor PROWLARR_API_KEY is set, and TMDB_API_URL and TMDB_IMAGE_URL replace TMDB's API and image
 * addresses (the integration and smoke tests point them at a fake).
 */
export function kinoseedServer(env: Record<string, string | undefined>, stores: DataStores): KinoseedServer {
  const store = stores.settings
  const envQbittorrent = { username: env.QBITTORRENT_USERNAME, password: env.QBITTORRENT_PASSWORD }
  const prowlarrConfig = env.PROWLARR_CONFIG_XML
  const qbittorrent = qbittorrentBridge({
    url: env.QBITTORRENT_URL,
    credentials: () => qbittorrentCredentials(store, envQbittorrent),
  })
  return {
    routes: [
      health,
      settingsMiddleware({
        store,
        envTmdbApiKey: env.TMDB_API_KEY,
        tmdbApiBase: env.TMDB_API_URL,
        qbittorrentUrl: env.QBITTORRENT_URL,
        envQbittorrent,
        prowlarrUrl: env.PROWLARR_URL,
        envProwlarrApiKey: env.PROWLARR_API_KEY,
        prowlarrConfigXml: prowlarrConfig,
      }),
      matchesMiddleware(stores.matches),
      qbittorrent.middleware,
      prowlarrMiddleware({
        url: env.PROWLARR_URL,
        apiKey: () => prowlarrKey(store, env.PROWLARR_API_KEY, prowlarrConfig),
      }),
      tmdbMiddleware({
        apiKey: () => tmdbKey(store, env.TMDB_API_KEY),
        apiBase: env.TMDB_API_URL,
        imageBase: env.TMDB_IMAGE_URL,
      }),
    ],
    startJobs: () =>
      env.QBITTORRENT_URL ? startMatchesCleanup(stores.matches, () => qbittorrentHashes(qbittorrent.get)) : () => {},
  }
}

function chain(middlewares: Middleware[]) {
  return (request: IncomingMessage, response: ServerResponse) => {

    const run = (index: number) => {
      const middleware = middlewares[index]
      if (!middleware) return notFound(response)
      try {
        middleware(request, response, () => run(index + 1))
      } catch {
        if (!response.headersSent) internalError(response)
      }
    }
    run(0)
  }
}

/** For Docker's HEALTHCHECK and uptime monitors: the server is up (not whether qBittorrent is). */
function health(request: IncomingMessage, response: ServerResponse, next: () => void) {
  if (request.url !== '/healthz') return next()
  response.setHeader('Content-Type', 'text/plain; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end('ok')
}

function notFound(response: ServerResponse) {
  response.statusCode = 404
  response.setHeader('Content-Type', 'text/plain; charset=utf-8')
  response.end('Not found')
}

function internalError(response: ServerResponse) {
  response.statusCode = 500
  response.setHeader('Content-Type', 'text/plain; charset=utf-8')
  response.end('Internal error')
}

async function main() {
  const env = process.env
  const port = Number(env.PORT || 8080)
  const host = env.HOST || '0.0.0.0'
  const root = resolve(env.KINOSEED_DIST || resolve(dirname(fileURLToPath(import.meta.url)), '../dist'))
  const stores = dataStores(resolve(env.KINOSEED_DATA_DIR || 'data'))
  await Promise.all([stores.settings.load(), stores.matches.load()])
  const kinoseed = kinoseedServer(env, stores)
  const server = createApp(root, kinoseed)
  const stopJobs = kinoseed.startJobs()
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

  server.listen(port, host, () => {
    console.log(`[kinoseed] ${version} listening on http://${host}:${port}`)
    const missing = ['QBITTORRENT_URL', 'PROWLARR_URL'].filter((name) => !env[name])
    if (!env.PROWLARR_API_KEY && !env.PROWLARR_CONFIG_XML) missing.push('PROWLARR_API_KEY')
    if (!tmdbKey(stores.settings, env.TMDB_API_KEY)) missing.push('TMDB key (enter it in the app)')
    if (missing.length) console.warn(`[kinoseed] not set: ${missing.join(', ')}`)
  })

  // Docker sends SIGTERM on stop: finish open requests instead of waiting to be killed.
  const stop = () => {
    stopJobs()
    server.close(() => process.exit(0))
    server.closeIdleConnections()
    setTimeout(() => process.exit(0), 5000).unref()
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main()
