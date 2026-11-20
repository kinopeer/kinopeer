import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AuthStatus } from '../src/api/auth/types.ts'
import type {
  AddressStatus,
  DownloadDefaults,
  DownloadDefaultsBody,
  ProwlarrKeyBody,
  QbittorrentLoginBody,
  NotifyLanguage,
  SecretStatus,
  ServerSettings,
  SettingsErrorBody,
  TelegramChatBody,
  TelegramChatInfo,
  TelegramCheck,
  TelegramFoundChat,
  TelegramTestBody,
  TelegramTokenBody,
  TmdbFallback,
  TmdbKeyBody,
} from '../src/api/settings/types.ts'
import { abandoned } from './abandoned.ts'
import { baseOf, parseAddress } from './address.ts'
import { isJsonRequest, readJson, sendJson } from './json.ts'
import { JsonFile } from './jsonFile.ts'
import { checkProwlarrKey, readProwlarrApiKey, type Middleware } from './prowlarr.ts'
import { checkQbittorrent, type QbittorrentCredentials } from './qbittorrent.ts'
import { isNotifyLanguage, notifyText } from './notifyText.ts'
import { botName, isBotToken, sendMessage, startedChats, type TelegramOptions } from './telegram.ts'
import { TMDB_TIMEOUT_MS, checkTmdbKey } from './tmdb.ts'

/**
 * Settings the user enters in the app and the server keeps: the TMDB key, Prowlarr's key and address,
 * qBittorrent's login and address, and the download defaults. They live in settings.json in the data directory ($KINOPEER_DATA_DIR,
 * /data in the Docker image), readable only by the server. A saved secret wins over the matching
 * environment variables, which stay as the defaults (the Umbrel package sets qBittorrent's) and for
 * development. An address is the other way round: QBITTORRENT_URL and PROWLARR_URL win, and one is
 * saved from the app only where the environment sets none and behind Kinopeer's own login, since
 * the server then calls whatever address it was sent.
 *
 * GET /api/settings → ServerSettings (only whether each secret is set, never its value)
 * PUT /api/settings/tmdb { apiKey } → checks the key with TMDB, saves it, answers ServerSettings
 * PUT /api/settings/prowlarr { apiKey, url? } → checks the key with Prowlarr (at `url`, when given),
 *   saves both, answers ServerSettings
 * DELETE /api/settings/tmdb → forgets the saved key, so TMDB_API_KEY or Kinopeer's key applies again;
 *   refused (409) when neither would
 * DELETE /api/settings/prowlarr → forgets the saved key, so the environment's or config.xml's applies
 *   again; refused (409) when the server has no key of its own
 * PUT /api/settings/qbittorrent { username, password, url? } → logs in to qBittorrent (at `url`, when
 *   given; an empty username is no login, through qBittorrent's auth bypass), saves both
 * A `url` is refused while the environment sets that address (409 env-address) and with Kinopeer's
 * own login off (409 auth-off).
 * PATCH /api/settings/downloads { …some DownloadDefaults } → merges them in, answers ServerSettings
 *
 * The Telegram bot that sends notifications (server/notifier.ts), set up in three steps:
 * PUT /api/settings/telegram { token } → checks the token with Telegram, saves it, answers ServerSettings
 * GET /api/settings/telegram/chat → TelegramFoundChat, the chat that last sent the bot /start, not saved
 * PUT /api/settings/telegram/chat { id, language } → saves that chat, if it did, answers ServerSettings
 * POST /api/settings/telegram/test { language } → sends a test message, answers ServerSettings
 * GET /api/settings/telegram/check → TelegramCheck, for Settings' connection check
 * DELETE /api/settings/telegram → forgets the bot, answers ServerSettings
 */
export interface StoredSettings {
  tmdbApiKey?: string
  prowlarrApiKey?: string
  qbittorrentUsername?: string
  qbittorrentPassword?: string
  /** qBittorrent's address saved from the app; QBITTORRENT_URL wins. */
  qbittorrentUrl?: string
  /** Prowlarr's address saved from the app; PROWLARR_URL wins. */
  prowlarrUrl?: string
  downloads?: Partial<DownloadDefaults>
  telegram?: StoredTelegram
}

/** The Telegram bot: its token (a secret), and the chat and language its messages go in. */
export interface StoredTelegram {
  token: string
  /** The bot's @username, without the @, as Telegram answered for the token. */
  bot: string
  chat?: TelegramChatInfo & { id: number }
  /** The language of the device that chose the chat. */
  language?: NotifyLanguage
  /** What Telegram refused last (TelegramStatus.refused). */
  refused?: 'token' | 'chat'
}

export class SettingsStore extends JsonFile<StoredSettings> {
  constructor(dir: string) {
    super(dir, 'settings.json')
  }

  /** Merges `changes` in and saves them. */
  update(changes: StoredSettings): Promise<StoredSettings> {
    return this.change((current) => ({ ...current, ...changes }))
  }

  /** Saves what `change` makes of the Telegram bot; undefined forgets it. */
  updateTelegram(change: (current: StoredTelegram | undefined) => StoredTelegram | undefined): Promise<StoredSettings> {
    return this.change((current) => {
      const telegram = change(current.telegram)
      return telegram === current.telegram ? current : { ...current, telegram }
    })
  }

  /** Merges in only the download defaults given, so two devices changing different ones keep both. */
  updateDownloads(changes: DownloadDefaultsBody): Promise<StoredSettings> {
    return this.change((current) => ({ ...current, downloads: { ...current.downloads, ...changes } }))
  }
}

export interface SettingsConfig {
  store: SettingsStore
  /** Kinopeer's own login (server/auth.ts); off without it. */
  auth?: () => AuthStatus
  /** TMDB_API_KEY from the environment, the fallback. */
  envTmdbApiKey?: string
  /** Kinopeer's TMDB proxy, which serves calls without a key (server/tmdb.ts); none to turn it off. */
  tmdbProxy?: string
  /** PROWLARR_URL, which wins over an address saved from the app. */
  envProwlarrUrl?: string
  /** PROWLARR_API_KEY, the fallback, already gated by the caller (`kinopeerServer`): only with PROWLARR_URL. */
  envProwlarrApiKey?: string
  /**
   * PROWLARR_CONFIG_XML, Prowlarr's config.xml to read its key from, the last fallback, already gated
   * by the caller (`kinopeerServer`): only with PROWLARR_URL.
   */
  prowlarrConfigXml?: string
  /** QBITTORRENT_URL, which wins over an address saved from the app. */
  envQbittorrentUrl?: string
  /**
   * QBITTORRENT_USERNAME and QBITTORRENT_PASSWORD, the fallback, already gated by the caller
   * (`kinopeerServer`): only with QBITTORRENT_URL.
   */
  envQbittorrent?: Partial<QbittorrentCredentials>
  /** Overridable for tests. */
  tmdbApiBase?: string
  /** How long TMDB may take to answer a key check; TMDB_TIMEOUT_MS by default. */
  tmdbTimeoutMs?: number
  /** Whether some channel sends notifications (server/notifier.ts); none without it. */
  notifications?: () => boolean
  /** How many devices get push notifications (server/push.ts); none without it. */
  pushDevices?: () => number
  /** Telegram's Bot API and how long it may take; TELEGRAM_API and its timeout by default (tests). */
  telegram?: Omit<TelegramOptions, 'signal'>
}

/** Whether the Telegram bot has a token and a chat, so it can send. */
export function telegramReady(stored: StoredSettings): stored is StoredSettings & { telegram: Required<Pick<StoredTelegram, 'chat'>> & StoredTelegram } {
  return Boolean(stored.telegram?.token && stored.telegram.chat)
}

/** The TMDB key the bridge uses: the saved one, else the environment's. */
export function tmdbKey(store: SettingsStore, envKey: string | undefined): string | undefined {
  return store.current.tmdbApiKey?.trim() || envKey?.trim() || undefined
}

/**
 * The Prowlarr key the bridge uses: the saved one, else PROWLARR_API_KEY, else the one in Prowlarr's
 * config.xml (read on every call, so a key changed in Prowlarr is picked up). The caller passes the
 * environment's two only while PROWLARR_URL sets the address (`kinopeerServer`).
 */
export async function prowlarrKey(
  store: SettingsStore,
  envKey: string | undefined,
  configXml: string | undefined,
): Promise<string | undefined> {
  return (
    store.current.prowlarrApiKey?.trim() ||
    envKey?.trim() ||
    (configXml ? (await readProwlarrApiKey(configXml))?.trim() : undefined) ||
    undefined
  )
}

/** qBittorrent's address the bridge calls: QBITTORRENT_URL, else the one saved from the app. */
export function qbittorrentAddress(store: SettingsStore, envUrl: string | undefined): string | undefined {
  return baseOf(envUrl) ?? baseOf(store.current.qbittorrentUrl)
}

/** Prowlarr's address the bridge calls: PROWLARR_URL, else the one saved from the app. */
export function prowlarrAddress(store: SettingsStore, envUrl: string | undefined): string | undefined {
  return baseOf(envUrl) ?? baseOf(store.current.prowlarrUrl)
}

/**
 * The qBittorrent login the bridge uses: the saved one, else the environment's, which the caller
 * passes only while QBITTORRENT_URL sets the address (`kinopeerServer`).
 */
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

function status(saved: string | undefined, env: string | undefined): SecretStatus {
  const source = saved?.trim() ? 'saved' : env?.trim() ? 'env' : null
  return { configured: source !== null, source }
}

function addressStatus(saved: string | undefined, env: string | undefined): AddressStatus {
  if (baseOf(env)) return { source: 'env' }
  const url = baseOf(saved)
  return url ? { source: 'saved', url } : { source: null }
}

/**
 * Why an address sent with a save is refused: the environment sets it, or Kinopeer's own login is
 * off, so nothing tells who sent it; undefined when it may be saved.
 */
function addressRefusal(config: SettingsConfig, env: string | undefined): 'env-address' | 'auth-off' | undefined {
  if (baseOf(env)) return 'env-address'
  if (!config.auth?.().enabled) return 'auth-off'
  return undefined
}

/**
 * The address a save checks against: the one sent (an `invalid-address` refusal when it isn't one,
 * or one of addressRefusal's), else the service's current one.
 */
function addressToCheck(
  config: SettingsConfig,
  sent: unknown,
  env: string | undefined,
  current: string | undefined,
): { base: string | undefined; sent: boolean } | { refusal: 'env-address' | 'auth-off' | 'invalid-address' } {
  if (sent === undefined) return { base: current, sent: false }
  const refusal = addressRefusal(config, env)
  if (refusal) return { refusal }
  const base = parseAddress(sent)
  return base ? { base, sent: true } : { refusal: 'invalid-address' }
}

/** What serves TMDB without a saved key: TMDB_API_KEY, else Kinopeer's key behind its proxy. */
function tmdbFallback(config: SettingsConfig): TmdbFallback | null {
  return config.envTmdbApiKey?.trim() ? 'env' : config.tmdbProxy ? 'shared' : null
}

/** Kinopeer's key counts as a key, so onboarding doesn't ask for one; the user's own still wins. */
function tmdbStatus(saved: string | undefined, config: SettingsConfig): ServerSettings['tmdb'] {
  const fallback = tmdbFallback(config)
  const source = saved?.trim() ? 'saved' : fallback
  return { configured: source !== null, source, fallback }
}

/** The server's own Prowlarr key: a key in config.xml counts as its configuration, like the variable. */
async function serverProwlarrKey(config: SettingsConfig): Promise<string | undefined> {
  return (
    config.envProwlarrApiKey?.trim() ||
    (config.prowlarrConfigXml ? (await readProwlarrApiKey(config.prowlarrConfigXml))?.trim() : undefined) ||
    undefined
  )
}

async function snapshot(stored: StoredSettings, config: SettingsConfig): Promise<ServerSettings> {
  // Reads config.xml on every GET (a small local file): the answer says whether the server has a
  // key of its own, which decides whether a saved key can be forgotten.
  const envProwlarr = await serverProwlarrKey(config)
  return {
    tmdb: tmdbStatus(stored.tmdbApiKey, config),
    prowlarr: {
      ...status(stored.prowlarrApiKey, envProwlarr),
      serverKey: Boolean(envProwlarr),
      address: addressStatus(stored.prowlarrUrl, config.envProwlarrUrl),
    },
    qbittorrent: {
      ...status(stored.qbittorrentUsername, config.envQbittorrent?.username),
      address: addressStatus(stored.qbittorrentUrl, config.envQbittorrentUrl),
    },
    downloads: stored.downloads ?? null,
    auth: config.auth?.() ?? { enabled: false },
    telegram: {
      bot: stored.telegram?.bot ?? null,
      chat: stored.telegram?.chat ? { name: stored.telegram.chat.name, type: stored.telegram.chat.type } : null,
      refused: stored.telegram?.refused ?? null,
    },
    push: { devices: config.pushDevices?.() ?? 0 },
    notifications: config.notifications?.() ?? false,
  }
}

/** The answer of GET /api/settings, for routes elsewhere that answer with it (server/push.ts). */
export async function serverSettings(config: SettingsConfig): Promise<ServerSettings> {
  return snapshot(await config.store.load(), config)
}

async function save(config: SettingsConfig, response: ServerResponse, saving: Promise<StoredSettings>) {
  try {
    const stored = await saving
    sendJson(response, 200, await snapshot(stored, config))
  } catch {
    console.warn('[kinopeer] could not write settings.json; is the data directory writable?')
    fail(response, 500, 'storage')
  }
}

async function saveTmdbKey(config: SettingsConfig, request: IncomingMessage, response: ServerResponse) {
  const signal = AbortSignal.any([abandoned(response), AbortSignal.timeout(config.tmdbTimeoutMs ?? TMDB_TIMEOUT_MS)])
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
    valid = await checkTmdbKey(apiKey.trim(), config.tmdbApiBase, signal)
  } catch {
    return fail(response, 502, 'unreachable')
  }
  if (!valid) return fail(response, 422, 'invalid-key')
  await save(config, response, config.store.update({ tmdbApiKey: apiKey.trim() }))
}

/** Forgets the saved key, only when something else would serve TMDB, so Kinopeer is never left without it. */
async function forgetTmdbKey(config: SettingsConfig, _request: IncomingMessage, response: ServerResponse) {
  if (!tmdbFallback(config)) return fail(response, 409, 'no-server-key')
  await save(config, response, config.store.update({ tmdbApiKey: undefined }))
}

async function saveProwlarrKey(config: SettingsConfig, request: IncomingMessage, response: ServerResponse) {
  const signal = abandoned(response)
  let body: Partial<ProwlarrKeyBody> | null
  try {
    body = (await readJson(request, MAX_BODY_BYTES)) as Partial<ProwlarrKeyBody> | null
  } catch {
    return fail(response, 400, 'bad-request')
  }
  const apiKey = body?.apiKey
  if (typeof apiKey !== 'string' || !apiKey.trim() || /\s/.test(apiKey.trim())) return fail(response, 400, 'bad-request')
  const address = addressToCheck(config, body?.url, config.envProwlarrUrl, prowlarrAddress(config.store, config.envProwlarrUrl))
  if ('refusal' in address) return fail(response, address.refusal === 'invalid-address' ? 400 : 409, address.refusal)
  const base = address.base
  if (!base) return fail(response, 503, 'not-configured')

  let result: Awaited<ReturnType<typeof checkProwlarrKey>>
  try {
    result = await checkProwlarrKey(base, apiKey.trim(), signal)
  } catch {
    return fail(response, 502, 'unreachable')
  }
  if (result === 'invalid') return fail(response, 422, 'invalid-key')
  if (result === 'not-prowlarr') return fail(response, 502, 'not-prowlarr')
  await save(config, response, config.store.update({ prowlarrApiKey: apiKey.trim(), ...(address.sent && { prowlarrUrl: base }) }))
}

/** Forgets the saved key, only when the server has one of its own to fall back on. */
async function forgetProwlarrKey(config: SettingsConfig, _request: IncomingMessage, response: ServerResponse) {
  if (!(await serverProwlarrKey(config))) return fail(response, 409, 'no-server-key')
  await save(config, response, config.store.update({ prowlarrApiKey: undefined }))
}

async function saveQbittorrentLogin(config: SettingsConfig, request: IncomingMessage, response: ServerResponse) {
  // The browser's own attempt, not the shared session's login, so it's given up with the browser.
  const signal = abandoned(response)
  let body: Partial<QbittorrentLoginBody> | null
  try {
    body = (await readJson(request, MAX_BODY_BYTES)) as Partial<QbittorrentLoginBody> | null
  } catch {
    return fail(response, 400, 'bad-request')
  }
  const { username, password } = body ?? {}
  if (typeof username !== 'string' || typeof password !== 'string') return fail(response, 400, 'bad-request')
  const address = addressToCheck(config, body?.url, config.envQbittorrentUrl, qbittorrentAddress(config.store, config.envQbittorrentUrl))
  if ('refusal' in address) return fail(response, address.refusal === 'invalid-address' ? 400 : 409, address.refusal)
  const base = address.base
  if (!base) return fail(response, 503, 'not-configured')
  // No username is no login: qBittorrent's auth bypass lets the server in, or it asks for one.
  const user = username.trim()
  const credentials = user ? { username: user, password } : undefined

  let result: Awaited<ReturnType<typeof checkQbittorrent>>
  try {
    result = await checkQbittorrent(base, credentials, signal)
  } catch {
    return fail(response, 502, 'unreachable')
  }
  if (result === 'invalid') return fail(response, 422, 'invalid-credentials')
  if (result === 'banned') return fail(response, 429, 'banned')
  if (result === 'not-qbittorrent') return fail(response, 502, 'not-qbittorrent')
  await save(
    config,
    response,
    config.store.update({
      qbittorrentUsername: credentials?.username,
      qbittorrentPassword: credentials?.password,
      ...(address.sent && { qbittorrentUrl: base }),
    }),
  )
}

/** The bot's id, the part of its token before the colon, the same for a token @BotFather renews. */
const botId = (token: string) => token.split(':', 1)[0]

/** A Telegram route's JSON body, or undefined once it has answered 400 for a body it can't read. */
async function telegramBody<T>(request: IncomingMessage, response: ServerResponse): Promise<Partial<T> | undefined> {
  try {
    const body = (await readJson(request, MAX_BODY_BYTES)) as Partial<T> | null
    return body ?? {}
  } catch {
    fail(response, 400, 'bad-request')
    return undefined
  }
}

async function saveTelegramToken(config: SettingsConfig, request: IncomingMessage, response: ServerResponse) {
  const body = await telegramBody<TelegramTokenBody>(request, response)
  if (!body) return
  const token = typeof body.token === 'string' ? body.token.trim() : ''
  if (!isBotToken(token)) return fail(response, 400, 'bad-request')

  let bot: string | undefined
  try {
    bot = await botName(token, { ...config.telegram, signal: abandoned(response) })
  } catch {
    return fail(response, 502, 'unreachable')
  }
  if (bot === undefined) return fail(response, 422, 'invalid-key')
  // A renewed token of the same bot keeps its chat, and a refusal of that chat, which a new token doesn't
  // unblock (a refused token it answers); another bot starts over, since its chat is another.
  const saving = config.store.updateTelegram((current) => {
    const same = current && botId(current.token) === botId(token)
    if (!same) return { token, bot }
    return { token, bot, chat: current.chat, language: current.language, ...(current.refused === 'chat' ? { refused: 'chat' as const } : {}) }
  })
  await save(config, response, saving)
}

/** The saved token, or a 409 when there's none yet. */
function savedToken(config: SettingsConfig, response: ServerResponse): string | undefined {
  const token = config.store.current.telegram?.token
  if (!token) fail(response, 409, 'not-configured')
  return token
}

async function findTelegramChat(config: SettingsConfig, _request: IncomingMessage, response: ServerResponse) {
  const token = savedToken(config, response)
  if (!token) return
  let chats: Awaited<ReturnType<typeof startedChats>>
  try {
    chats = await startedChats(token, { ...config.telegram, signal: abandoned(response) })
  } catch {
    return fail(response, 502, 'unreachable')
  }
  if (chats === 'rejected') return fail(response, 422, 'token-rejected')
  if (chats === 'conflict') return fail(response, 409, 'bot-in-use')
  if (chats.length === 0) return fail(response, 404, 'no-chat')
  sendJson(response, 200, chats[0] satisfies TelegramFoundChat)
}

/**
 * Saves the chat the user saw and chose, checked against the chats that sent /start, so a chat id
 * the bot can't write to is never saved, and its name and kind are Telegram's.
 */
async function saveTelegramChat(config: SettingsConfig, request: IncomingMessage, response: ServerResponse) {
  const body = await telegramBody<TelegramChatBody>(request, response)
  if (!body) return
  const { id, language } = body
  if (!Number.isSafeInteger(id) || !isNotifyLanguage(language)) return fail(response, 400, 'bad-request')
  const token = savedToken(config, response)
  if (!token) return
  let chats: Awaited<ReturnType<typeof startedChats>>
  try {
    chats = await startedChats(token, { ...config.telegram, signal: abandoned(response) })
  } catch {
    return fail(response, 502, 'unreachable')
  }
  if (chats === 'rejected') return fail(response, 422, 'token-rejected')
  if (chats === 'conflict') return fail(response, 409, 'bot-in-use')
  const chat = chats.find((found) => found.id === id)
  if (!chat) return fail(response, 404, 'no-chat')
  // Saved only while the token it was found with is still the bot's.
  const saving = config.store.updateTelegram((current) =>
    current?.token === token ? { token, bot: current.bot, chat, language } : current,
  )
  await save(config, response, saving)
}

/**
 * Which of the two Telegram refused when it didn't take a message: the token when it no longer
 * knows it, else the chat. Rejects when it doesn't answer.
 */
export async function refusedPart(token: string, options: TelegramOptions = {}): Promise<'token' | 'chat'> {
  return (await botName(token, options)) === undefined ? 'token' : 'chat'
}

async function testTelegram(config: SettingsConfig, request: IncomingMessage, response: ServerResponse) {
  const body = await telegramBody<TelegramTestBody>(request, response)
  if (!body) return
  if (!isNotifyLanguage(body.language)) return fail(response, 400, 'bad-request')
  const telegram = config.store.current.telegram
  if (!telegram?.token || !telegram.chat) return fail(response, 409, 'not-configured')
  const options = { ...config.telegram, signal: abandoned(response) }
  let refused: 'token' | 'chat' | undefined
  try {
    const sent = await sendMessage(telegram.token, telegram.chat.id, notifyText(body.language, 'test'), options)
    if (sent === 'rejected') refused = await refusedPart(telegram.token, options)
  } catch {
    return fail(response, 502, 'unreachable')
  }
  // What Telegram answered now replaces what it answered a notification, for the same bot and chat.
  const saving = config.store.updateTelegram((current) =>
    current?.token === telegram.token && current.chat?.id === telegram.chat?.id && current.refused !== refused
      ? { ...current, refused }
      : current,
  )
  if (!refused) return save(config, response, saving)
  await saving.catch(() => {})
  fail(response, 422, refused === 'token' ? 'token-rejected' : 'chat-rejected')
}

async function checkTelegram(config: SettingsConfig, _request: IncomingMessage, response: ServerResponse) {
  const token = savedToken(config, response)
  if (!token) return
  let bot: string | undefined
  try {
    bot = await botName(token, { ...config.telegram, signal: abandoned(response) })
  } catch {
    return fail(response, 502, 'unreachable')
  }
  if (bot === undefined) return fail(response, 422, 'token-rejected')
  sendJson(response, 200, { bot } satisfies TelegramCheck)
}

async function forgetTelegram(config: SettingsConfig, _request: IncomingMessage, response: ServerResponse) {
  await save(config, response, config.store.updateTelegram(() => undefined))
}

const MAX_CATEGORY_LENGTH = 256

type BooleanDefault = { [K in keyof DownloadDefaults]: DownloadDefaults[K] extends boolean ? K : never }[keyof DownloadDefaults]

/** The on/off defaults: a Record, so a boolean added to DownloadDefaults fails typecheck until it's here. */
const BOOLEAN_DEFAULTS: Record<BooleanDefault, true> = { startPaused: true, sequential: true, firstLastPieces: true, notify: true }

const isBooleanDefault = (key: string): key is BooleanDefault => Object.hasOwn(BOOLEAN_DEFAULTS, key)

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
    } else if (isBooleanDefault(key)) {
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

type Handler = (config: SettingsConfig, request: IncomingMessage, response: ServerResponse) => Promise<void>

/** The routes under /api/settings by method and path; a route that takes a body takes only JSON. */
const ROUTES: Record<string, Handler> = {
  [`PUT ${PREFIX}/tmdb`]: saveTmdbKey,
  [`DELETE ${PREFIX}/tmdb`]: forgetTmdbKey,
  [`PUT ${PREFIX}/prowlarr`]: saveProwlarrKey,
  [`DELETE ${PREFIX}/prowlarr`]: forgetProwlarrKey,
  [`PUT ${PREFIX}/qbittorrent`]: saveQbittorrentLogin,
  [`PATCH ${PREFIX}/downloads`]: saveDownloadDefaults,
  [`PUT ${PREFIX}/telegram`]: saveTelegramToken,
  [`DELETE ${PREFIX}/telegram`]: forgetTelegram,
  [`GET ${PREFIX}/telegram/chat`]: findTelegramChat,
  [`PUT ${PREFIX}/telegram/chat`]: saveTelegramChat,
  [`POST ${PREFIX}/telegram/test`]: testTelegram,
  [`GET ${PREFIX}/telegram/check`]: checkTelegram,
}

export function settingsMiddleware(config: SettingsConfig): Middleware {
  return (request, response, next) => {
    const path = new URL(request.url ?? '/', 'http://kinopeer.local').pathname
    if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return next()

    if (path === PREFIX && request.method === 'GET') {
      void config.store
        .load()
        .then((stored) => snapshot(stored, config))
        .then((settings) => sendJson(response, 200, settings))
      return
    }
    const key = `${request.method} ${path}`
    const handler = Object.hasOwn(ROUTES, key) ? ROUTES[key] : undefined
    if (handler) {
      // A cross-site request with a JSON body needs a CORS preflight, which never succeeds here.
      if (request.method !== 'GET' && !isJsonRequest(request)) return fail(response, 415, 'bad-request')
      handler(config, request, response).catch(() => {
        if (!response.headersSent) fail(response, 500, 'storage')
      })
      return
    }
    fail(response, 404, 'not-found')
  }
}
