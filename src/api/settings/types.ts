import type { AuthStatus } from '../auth/types.ts'
import type { PushStatus } from '../push/types.ts'

/** Where a secret comes from: saved from the app, or the server's environment variables. */
export type KeySource = 'saved' | 'env'

export interface SecretStatus {
  configured: boolean
  source: KeySource | null
}

/**
 * Where a service's address comes from: the server's environment (QBITTORRENT_URL, PROWLARR_URL),
 * which wins and whose value isn't sent, or saved from the app, sent in full, since it's no secret
 * and the app's form edits it.
 */
export type AddressStatus = { source: 'env' } | { source: 'saved'; url: string } | { source: null }

/** The login the server uses for qBittorrent, and qBittorrent's address. */
export interface QbittorrentStatus extends SecretStatus {
  address: AddressStatus
}

export interface ProwlarrKeyStatus extends SecretStatus {
  /** Prowlarr's address. */
  address: AddressStatus
  /**
   * The server has a key of its own (PROWLARR_API_KEY or a readable config.xml), which applies once
   * a saved key is forgotten.
   */
  serverKey: boolean
}

/** Defaults for adding a release, the same on every device. */
export interface DownloadDefaults {
  /** qBittorrent category for new movie downloads; null picks one named like "Movies". */
  movieCategory: string | null
  /** The same for series ("TV Shows", "Сериалы"). */
  tvCategory: string | null
  /** New downloads start stopped. */
  startPaused: boolean
  /** New downloads fetch pieces in order. */
  sequential: boolean
  /** New downloads fetch each file's first and last pieces first. */
  firstLastPieces: boolean
  /** New downloads added through Kinopeer tell when they finish (the `kinopeer:notify` tag), while a channel is set up. */
  notify: boolean
}

/** A TMDB key that serves calls without a saved one: TMDB_API_KEY, else Kinopeer's own. */
export type TmdbFallback = 'env' | 'shared'

/**
 * The TMDB key: 'shared' is Kinopeer's own, behind its proxy (tmdb-proxy/), used while the server
 * has no key of its own.
 */
export interface TmdbKeyStatus {
  configured: boolean
  source: KeySource | 'shared' | null
  /** What applies once a saved key is forgotten; null when nothing would, so it can't be. */
  fallback: TmdbFallback | null
}

/** Answer of GET /api/settings. Secrets never leave the server, only whether they are set. */
export interface ServerSettings {
  tmdb: TmdbKeyStatus
  /** The Prowlarr API key: 'env' covers PROWLARR_API_KEY and the key in Prowlarr's config.xml. */
  prowlarr: ProwlarrKeyStatus
  /** The login the server uses for qBittorrent, and its address. */
  qbittorrent: QbittorrentStatus
  /** The download defaults saved so far; null until any is saved. */
  downloads: Partial<DownloadDefaults> | null
  /** Kinopeer's own login. Servers before 1.1 don't send it: they have none. */
  auth?: AuthStatus
  /** The Telegram bot that sends notifications. Servers before 1.1 don't send it: they have none. */
  telegram?: TelegramStatus
  /** The devices that get push notifications. Servers before 1.1 don't send it: they have none. */
  push?: PushStatus
  /**
   * Some channel is set up to send a notification when a download finishes, so the app offers the
   * per-torrent switch. Servers before 1.1 don't send it.
   */
  notifications?: boolean
}

/** The languages the server writes notifications in. */
export type NotifyLanguage = 'en' | 'ru'

/** What Telegram calls a chat's kind. */
export type TelegramChatType = 'private' | 'group' | 'supergroup' | 'channel'

/** A chat as Settings shows it, so the user can tell it's theirs. */
export interface TelegramChatInfo {
  name: string
  type: TelegramChatType
}

/** Answer of GET /api/settings/telegram/chat: the chat that last sent the bot /start, not saved yet. */
export interface TelegramFoundChat extends TelegramChatInfo {
  id: number
}

export interface TelegramStatus {
  /** The bot's @username, without the @, saved with its token; null without a token. */
  bot: string | null
  /** The chat messages go to; null until one is chosen. */
  chat: TelegramChatInfo | null
  /**
   * What Telegram refused the last time Kinopeer sent a notification: the token (the bot was
   * deleted or its token revoked) or the chat (the bot was blocked or removed from it); null since a
   * message went through, or since either was saved.
   */
  refused: 'token' | 'chat' | null
}

/** Answer of GET /api/settings/telegram/check: the bot's @username, without the @. */
export interface TelegramCheck {
  bot: string
}

/** Body of PATCH /api/settings/downloads: the defaults to change. */
export type DownloadDefaultsBody = Partial<DownloadDefaults>

/** Body of PUT /api/settings/tmdb. */
export interface TmdbKeyBody {
  apiKey: string
}

/**
 * Body of PUT /api/settings/prowlarr. `url` saves Prowlarr's address with the key, only where the
 * environment sets none and behind Kinopeer's own login.
 */
export interface ProwlarrKeyBody {
  apiKey: string
  url?: string
}

/** Body of PUT /api/settings/telegram. */
export interface TelegramTokenBody {
  token: string
}

/** Body of PUT /api/settings/telegram/chat: the chat found, and the language to write in. */
export interface TelegramChatBody {
  id: number
  language: NotifyLanguage
}

/** Body of POST /api/settings/telegram/test. */
export interface TelegramTestBody {
  language: NotifyLanguage
}

/**
 * Body of PUT /api/settings/qbittorrent. An empty username is no login, for qBittorrent's auth
 * bypass. `url` saves qBittorrent's address with it, only where the environment sets none and
 * behind Kinopeer's own login.
 */
export interface QbittorrentLoginBody {
  username: string
  password: string
  url?: string
}

/** Error answers of /api/settings. */
export interface SettingsErrorBody {
  error:
    | 'bad-request'
    | 'invalid-key'
    | 'invalid-credentials'
    | 'banned'
    | 'not-configured'
    | 'bot-in-use'
    | 'unreachable'
    | 'not-prowlarr'
    | 'not-qbittorrent'
    | 'invalid-address'
    | 'env-address'
    | 'auth-off'
    | 'no-server-key'
    | 'storage'
    | 'not-found'
    /** No chat sent the bot /start in the last day, or not the one chosen. */
    | 'no-chat'
    /** Telegram doesn't know the bot's token. */
    | 'token-rejected'
    /** Telegram refused to write to the chat: the bot was blocked or removed. */
    | 'chat-rejected'
}
