import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { ServerSettings, SettingsErrorBody, TmdbKeyBody } from '../src/api/settings/types.ts'
import type { Middleware } from './prowlarr.ts'
import { checkTmdbKey } from './tmdb.ts'

/**
 * Settings the user enters in the app and the server keeps: for now the TMDB key. They live in
 * settings.json in the data directory ($KINOSEED_DATA_DIR, /data in the Docker image), readable only
 * by the server. A saved value wins over the matching environment variable, which stays as the
 * fallback for development and plain Docker setups.
 *
 * GET /api/settings → ServerSettings (only whether each secret is set, never its value)
 * PUT /api/settings/tmdb { apiKey } → checks the key with TMDB, saves it, answers ServerSettings
 */
export interface StoredSettings {
  tmdbApiKey?: string
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
  /** Overridable for tests. */
  tmdbApiBase?: string
}

/** The TMDB key the bridge uses: the saved one, else the environment's. */
export function tmdbKey(store: SettingsStore, envKey: string | undefined): string | undefined {
  return store.current.tmdbApiKey?.trim() || envKey?.trim() || undefined
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

function snapshot(stored: StoredSettings, envKey: string | undefined): ServerSettings {
  const source = stored.tmdbApiKey?.trim() ? 'saved' : envKey?.trim() ? 'env' : null
  return { tmdb: { configured: source !== null, source } }
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

  try {
    const stored = await config.store.update({ tmdbApiKey: apiKey.trim() })
    send(response, 200, snapshot(stored, config.envTmdbApiKey))
  } catch {
    console.warn('[kinoseed] could not write settings.json; is the data directory writable?')
    fail(response, 500, 'storage')
  }
}

export function settingsMiddleware(config: SettingsConfig): Middleware {
  return (request, response, next) => {
    const path = new URL(request.url ?? '/', 'http://kinoseed.local').pathname
    if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return next()

    if (path === PREFIX && request.method === 'GET') {
      void config.store.load().then((stored) => send(response, 200, snapshot(stored, config.envTmdbApiKey)))
      return
    }
    if (path === `${PREFIX}/tmdb` && request.method === 'PUT') {
      // Only JSON: a cross-site form can't send it without a CORS preflight, which never succeeds here.
      if (!request.headers['content-type']?.startsWith('application/json')) return fail(response, 415, 'bad-request')
      saveTmdbKey(config, request, response).catch(() => {
        if (!response.headersSent) fail(response, 500, 'storage')
      })
      return
    }
    fail(response, 404, 'not-found')
  }
}
