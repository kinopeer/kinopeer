import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { QbittorrentLoginBody, ServerSettings, SettingsErrorBody, TmdbKeyBody } from '../src/api/settings/types.ts'
import type { Middleware } from './prowlarr.ts'
import { qbittorrentLogin, type QbittorrentCredentials } from './qbittorrent.ts'
import { checkTmdbKey } from './tmdb.ts'

/**
 * Settings the user enters in the app and the server keeps: the TMDB key and the qBittorrent
 * login. They live in settings.json in the data directory ($KINOSEED_DATA_DIR, /data in the Docker
 * image), readable only by the server. A saved value wins over the matching environment variables,
 * which stay as the defaults (the Umbrel package sets qBittorrent's) and for development.
 *
 * GET /api/settings → ServerSettings (only whether each secret is set, never its value)
 * PUT /api/settings/tmdb { apiKey } → checks the key with TMDB, saves it, answers ServerSettings
 * PUT /api/settings/qbittorrent { username, password } → logs in to qBittorrent, saves the login
 */
export interface StoredSettings {
  tmdbApiKey?: string
  qbittorrentUsername?: string
  qbittorrentPassword?: string
}

export class SettingsStore {
  private readonly path: string
  private readonly dir: string
  private cache: StoredSettings | undefined
  private writing: Promise<void> = Promise.resolve()

  constructor(dir: string) {
    this.dir = dir
    this.path = join(dir, 'settings.json')
  }

  /** Reads settings.json once; a missing or broken file is an empty one. */
  async load(): Promise<StoredSettings> {
    if (this.cache) return this.cache
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'))
      this.cache = parsed && typeof parsed === 'object' ? (parsed as StoredSettings) : {}
    } catch {
      this.cache = {}
    }
    return this.cache
  }

  /** The last loaded settings, for code that can't wait (the TMDB bridge loads them at startup). */
  get current(): StoredSettings {
    return this.cache ?? {}
  }

  /** Merges `changes` in and writes the file atomically, so a crash never leaves half a file. */
  async update(changes: StoredSettings): Promise<StoredSettings> {
    const next = { ...(await this.load()), ...changes }
    const run = this.writing.then(async () => {
      await mkdir(this.dir, { recursive: true })
      const temporary = `${this.path}.${process.pid}.tmp`
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
      await rename(temporary, this.path)
    })
    this.writing = run.catch(() => {})
    await run
    this.cache = next
    return next
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

function send(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(body))
}

function fail(response: ServerResponse, status: number, error: SettingsErrorBody['error']): void {
  send(response, status, { error } satisfies SettingsErrorBody)
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('Body too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function status(saved: string | undefined, env: string | undefined): ServerSettings['tmdb'] {
  const source = saved?.trim() ? 'saved' : env?.trim() ? 'env' : null
  return { configured: source !== null, source }
}

function snapshot(stored: StoredSettings, config: SettingsConfig): ServerSettings {
  return {
    tmdb: status(stored.tmdbApiKey, config.envTmdbApiKey),
    qbittorrent: status(stored.qbittorrentUsername, config.envQbittorrent?.username),
  }
}

async function save(config: SettingsConfig, response: ServerResponse, changes: StoredSettings) {
  try {
    send(response, 200, snapshot(await config.store.update(changes), config))
  } catch {
    console.warn('[kinoseed] could not write settings.json; is the data directory writable?')
    fail(response, 500, 'storage')
  }
}

async function saveTmdbKey(config: SettingsConfig, request: IncomingMessage, response: ServerResponse) {
  let body: unknown
  try {
    body = await readJson(request)
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
  await save(config, response, { tmdbApiKey: apiKey.trim() })
}

async function saveQbittorrentLogin(config: SettingsConfig, request: IncomingMessage, response: ServerResponse) {
  const base = config.qbittorrentUrl?.trim().replace(/\/+$/, '')
  if (!base) return fail(response, 503, 'not-configured')
  let body: Partial<QbittorrentLoginBody> | null
  try {
    body = (await readJson(request)) as Partial<QbittorrentLoginBody> | null
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
  await save(config, response, { qbittorrentUsername: username.trim(), qbittorrentPassword: password })
}

export function settingsMiddleware(config: SettingsConfig): Middleware {
  return (request, response, next) => {
    const path = new URL(request.url ?? '/', 'http://kinoseed.local').pathname
    if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return next()

    if (path === PREFIX && request.method === 'GET') {
      void config.store.load().then((stored) => send(response, 200, snapshot(stored, config)))
      return
    }
    const handler =
      path === `${PREFIX}/tmdb` ? saveTmdbKey : path === `${PREFIX}/qbittorrent` ? saveQbittorrentLogin : undefined
    if (handler && request.method === 'PUT') {
      // Only JSON: a cross-site form can't send it without a CORS preflight, which never succeeds here.
      if (!request.headers['content-type']?.startsWith('application/json')) return fail(response, 415, 'bad-request')
      handler(config, request, response).catch(() => {
        if (!response.headersSent) fail(response, 500, 'storage')
      })
      return
    }
    fail(response, 404, 'not-found')
  }
}
