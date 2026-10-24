import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  DownloadDefaults,
  DownloadDefaultsBody,
  QbittorrentLoginBody,
  ServerSettings,
  SettingsErrorBody,
  TmdbKeyBody,
} from '../src/api/settings/types.ts'
import { isJsonRequest, readJson, sendJson } from './json.ts'
import { JsonFile } from './jsonFile.ts'
import type { Middleware } from './prowlarr.ts'
import { qbittorrentLogin, type QbittorrentCredentials } from './qbittorrent.ts'
import { checkTmdbKey } from './tmdb.ts'

/**
 * Settings the user enters in the app and the server keeps: the TMDB key, the qBittorrent login
 * and the download defaults. They live in settings.json in the data directory ($KINOSEED_DATA_DIR,
 * /data in the Docker image), readable only by the server. A saved secret wins over the matching
 * environment variables, which stay as the defaults (the Umbrel package sets qBittorrent's) and for
 * development.
 *
 * GET /api/settings → ServerSettings (only whether each secret is set, never its value)
 * PUT /api/settings/tmdb { apiKey } → checks the key with TMDB, saves it, answers ServerSettings
 * PUT /api/settings/qbittorrent { username, password } → logs in to qBittorrent, saves the login
 * PATCH /api/settings/downloads { …some DownloadDefaults } → merges them in, answers ServerSettings
 */
export interface StoredSettings {
  tmdbApiKey?: string
  qbittorrentUsername?: string
  qbittorrentPassword?: string
  downloads?: Partial<DownloadDefaults>
}

export class SettingsStore extends JsonFile<StoredSettings> {
  constructor(dir: string) {
    super(dir, 'settings.json')
  }

  /** Merges `changes` in and saves them. */
  update(changes: StoredSettings): Promise<StoredSettings> {
    return this.change((current) => ({ ...current, ...changes }))
  }

  /** Merges in only the download defaults given, so two devices changing different ones keep both. */
  updateDownloads(changes: DownloadDefaultsBody): Promise<StoredSettings> {
    return this.change((current) => ({ ...current, downloads: { ...current.downloads, ...changes } }))
  }
}

export interface SettingsConfig {
  store: SettingsStore
  /** TMDB_API_KEY from the environment, the fallback. */
  envTmdbApiKey?: string
  /** QBITTORRENT_URL, to check a login before saving it. */
  qbittorrentUrl?: string
  /** QBITTORRENT_USERNAME and QBITTORRENT_PASSWORD, the fallback. */
  envQbittorrent?: Partial<QbittorrentCredentials>
  /** Overridable for tests. */
  tmdbApiBase?: string
}

/** The TMDB key the bridge uses: the saved one, else the environment's. */
export function tmdbKey(store: SettingsStore, envKey: string | undefined): string | undefined {
  return store.current.tmdbApiKey?.trim() || envKey?.trim() || undefined
}

/** The qBittorrent login the bridge uses: the saved one, else the environment's. */
export function qbittorrentCredentials(
  store: SettingsStore,
  env: Partial<QbittorrentCredentials> | undefined,
): QbittorrentCredentials | undefined {
  const saved = store.current
  if (saved.qbittorrentUsername?.trim()) {
    return { username: saved.qbittorrentUsername.trim(), password: saved.qbittorrentPassword ?? '' }
  }
  if (env?.username?.trim()) return { username: env.username.trim(), password: env.password ?? '' }
  return undefined
}

const PREFIX = '/api/settings'
const MAX_BODY_BYTES = 16 * 1024

function fail(response: ServerResponse, status: number, error: SettingsErrorBody['error']): void {
  sendJson(response, status, { error } satisfies SettingsErrorBody)
}

function status(saved: string | undefined, env: string | undefined): ServerSettings['tmdb'] {
  const source = saved?.trim() ? 'saved' : env?.trim() ? 'env' : null
  return { configured: source !== null, source }
}

function snapshot(stored: StoredSettings, config: SettingsConfig): ServerSettings {
  return {
    tmdb: status(stored.tmdbApiKey, config.envTmdbApiKey),
    qbittorrent: status(stored.qbittorrentUsername, config.envQbittorrent?.username),
    downloads: stored.downloads ?? null,
  }
}

async function save(config: SettingsConfig, response: ServerResponse, saving: Promise<StoredSettings>) {
  try {
    sendJson(response, 200, snapshot(await saving, config))
  } catch {
    console.warn('[kinoseed] could not write settings.json; is the data directory writable?')
    fail(response, 500, 'storage')
  }
}

async function saveTmdbKey(config: SettingsConfig, request: IncomingMessage, response: ServerResponse) {
  let body: unknown
  try {
    body = await readJson(request, MAX_BODY_BYTES)
  } catch {
    return fail(response, 400, 'bad-request')
  }
  const apiKey = (body as Partial<TmdbKeyBody> | null)?.apiKey
  if (typeof apiKey !== 'string' || !apiKey.trim() || /\s/.test(apiKey.trim())) return fail(response, 400, 'bad-request')

  let valid: boolean
  try {
    valid = await checkTmdbKey(apiKey.trim(), config.tmdbApiBase)
  } catch {
    return fail(response, 502, 'unreachable')
  }
  if (!valid) return fail(response, 422, 'invalid-key')
  await save(config, response, config.store.update({ tmdbApiKey: apiKey.trim() }))
}

async function saveQbittorrentLogin(config: SettingsConfig, request: IncomingMessage, response: ServerResponse) {
  const base = config.qbittorrentUrl?.trim().replace(/\/+$/, '')
  if (!base) return fail(response, 503, 'not-configured')
  let body: Partial<QbittorrentLoginBody> | null
  try {
    body = (await readJson(request, MAX_BODY_BYTES)) as Partial<QbittorrentLoginBody> | null
  } catch {
    return fail(response, 400, 'bad-request')
  }
  const { username, password } = body ?? {}
  if (typeof username !== 'string' || !username.trim() || typeof password !== 'string') {
    return fail(response, 400, 'bad-request')
  }

  let result: Awaited<ReturnType<typeof qbittorrentLogin>>
  try {
    result = await qbittorrentLogin(base, username.trim(), password)
  } catch {
    return fail(response, 502, 'unreachable')
  }
  if (result.status === 'invalid') return fail(response, 422, 'invalid-credentials')
  if (result.status === 'banned') return fail(response, 429, 'banned')
  await save(config, response, config.store.update({ qbittorrentUsername: username.trim(), qbittorrentPassword: password }))
}

const MAX_CATEGORY_LENGTH = 256

/** The changes in a PATCH body, or undefined when it holds anything but known, well-typed fields. */
function downloadChanges(body: unknown): DownloadDefaultsBody | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  const changes: DownloadDefaultsBody = {}
  for (const [key, value] of Object.entries(body)) {
    if (key === 'movieCategory' || key === 'tvCategory') {
      if (value !== null && (typeof value !== 'string' || !value.trim() || value.length > MAX_CATEGORY_LENGTH)) {
        return undefined
      }
      changes[key] = value
    } else if (key === 'startPaused' || key === 'sequential') {
      if (typeof value !== 'boolean') return undefined
      changes[key] = value
    } else {
      return undefined
    }
  }
  return changes
}

async function saveDownloadDefaults(config: SettingsConfig, request: IncomingMessage, response: ServerResponse) {
  let body: unknown
  try {
    body = await readJson(request, MAX_BODY_BYTES)
  } catch {
    return fail(response, 400, 'bad-request')
  }
  const changes = downloadChanges(body)
  if (!changes) return fail(response, 400, 'bad-request')
  await save(config, response, config.store.updateDownloads(changes))
}

export function settingsMiddleware(config: SettingsConfig): Middleware {
  return (request, response, next) => {
    const path = new URL(request.url ?? '/', 'http://kinoseed.local').pathname
    if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return next()

    if (path === PREFIX && request.method === 'GET') {
      void config.store.load().then((stored) => sendJson(response, 200, snapshot(stored, config)))
      return
    }
    const handler =
      path === `${PREFIX}/tmdb` && request.method === 'PUT'
        ? saveTmdbKey
        : path === `${PREFIX}/qbittorrent` && request.method === 'PUT'
          ? saveQbittorrentLogin
          : path === `${PREFIX}/downloads` && request.method === 'PATCH'
            ? saveDownloadDefaults
            : undefined
    if (handler) {
      if (!isJsonRequest(request)) return fail(response, 415, 'bad-request')
      handler(config, request, response).catch(() => {
        if (!response.headersSent) fail(response, 500, 'storage')
      })
      return
    }
    fail(response, 404, 'not-found')
  }
}
