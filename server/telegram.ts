import type { TelegramChatType, TelegramFoundChat } from '../src/api/settings/types.ts'

/**
 * The Telegram Bot API, as Kinopeer's notifications use it: the user's own bot, created with
 * @BotFather, whose token only the server knows. Every call goes to `${base}/bot<token>/<method>`;
 * the token is in the path, so nothing here logs a URL or passes one on in an error.
 *
 * A call that Telegram answers with a refusal (a token it doesn't know, a chat that blocked the bot
 * or is gone) is `rejected`: sending again won't help. One it doesn't answer, or answers with a 5xx
 * or a 429, throws `TelegramUnavailable`, which says how long to wait when Telegram said so.
 */

export const TELEGRAM_API = 'https://api.telegram.org'

/** How long a call may take before it's given up as unanswered. */
export const TELEGRAM_TIMEOUT_MS = 15_000

/**
 * A bot token as @BotFather gives it: the bot's id, a colon and a secret of letters, digits, `_`
 * and `-`. Checked before anything is sent, so the path can't be steered elsewhere.
 */
const TOKEN = /^\d{1,20}:[A-Za-z0-9_-]{20,100}$/

export function isBotToken(value: string): boolean {
  return TOKEN.test(value)
}

/** Telegram didn't answer, or answered that it can't now; `retryAfterMs` when it said how long to wait. */
export class TelegramUnavailable extends Error {
  readonly retryAfterMs?: number

  constructor(retryAfterMs?: number) {
    super('Telegram did not answer')
    this.name = 'TelegramUnavailable'
    this.retryAfterMs = retryAfterMs
  }
}

interface ApiAnswer<T> {
  ok: boolean
  result?: T
  parameters?: { retry_after?: number }
}

type CallResult<T> = { ok: true; result: T } | { ok: false }

export interface TelegramOptions {
  /** TELEGRAM_API by default; the tests point it at a fake. */
  base?: string
  signal?: AbortSignal
  timeoutMs?: number
}

async function call<T>(token: string, method: string, body: object, options: TelegramOptions): Promise<CallResult<T>> {
  if (!isBotToken(token)) return { ok: false }
  const signal = AbortSignal.any([
    ...(options.signal ? [options.signal] : []),
    AbortSignal.timeout(options.timeoutMs ?? TELEGRAM_TIMEOUT_MS),
  ])
  let response: Response
  try {
    response = await fetch(`${options.base ?? TELEGRAM_API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    // Never the fetch's own error: it may carry the URL, and with it the token.
    throw new TelegramUnavailable()
  }
  const answer = (await response.json().catch(() => undefined)) as ApiAnswer<T> | undefined
  if (response.status === 429 || response.status >= 500 || !answer) {
    const seconds = answer?.parameters?.retry_after
    throw new TelegramUnavailable(typeof seconds === 'number' && seconds > 0 ? seconds * 1000 : undefined)
  }
  return answer.ok && response.ok ? { ok: true, result: answer.result as T } : { ok: false }
}

/** The bot's @username, or undefined when Telegram doesn't know the token. */
export async function botName(token: string, options: TelegramOptions = {}): Promise<string | undefined> {
  const answer = await call<{ username?: string }>(token, 'getMe', {}, options)
  return answer.ok ? (answer.result.username ?? '') : undefined
}

interface Message {
  text?: string
  chat?: { id?: number; type?: string; title?: string; username?: string; first_name?: string; last_name?: string }
}

/** A message to the bot, or a post in a channel where the bot is an admin. */
interface Update {
  message?: Message
  channel_post?: Message
}

const CHAT_TYPES: readonly string[] = ['private', 'group', 'supergroup', 'channel'] satisfies TelegramChatType[]

function chatName(chat: NonNullable<Message['chat']>): string {
  const person = [chat.first_name, chat.last_name].filter(Boolean).join(' ')
  return chat.title || person || (chat.username ? `@${chat.username}` : String(chat.id))
}

/**
 * The chats that sent the bot `/start` (`/start@bot` in a group; a channel's post, with the bot an
 * admin there), the latest first, each once, from the updates Telegram keeps for a day; `rejected`
 * when it doesn't know the token. Reading them doesn't confirm them, so the next check sees them too.
 */
export async function startedChats(token: string, options: TelegramOptions = {}): Promise<TelegramFoundChat[] | 'rejected'> {
  const answer = await call<Update[]>(token, 'getUpdates', { allowed_updates: ['message', 'channel_post'] }, options)
  if (!answer.ok) return 'rejected'
  const updates = Array.isArray(answer.result) ? answer.result : []
  const chats: TelegramFoundChat[] = []
  for (const update of [...updates].reverse()) {
    const message = update.message ?? update.channel_post
    const chat = message?.chat
    const command = message?.text?.trim().split(/\s/)[0]
    const started = command === '/start' || command?.startsWith('/start@')
    if (!chat || !started || !Number.isSafeInteger(chat.id) || !CHAT_TYPES.includes(chat.type ?? '')) continue
    if (chats.some(({ id }) => id === chat.id)) continue
    chats.push({ id: chat.id as number, name: chatName(chat), type: chat.type as TelegramChatType })
  }
  return chats
}

/** Sends `text` as plain text: `sent`, or `rejected` when Telegram refused it for good. */
export async function sendMessage(
  token: string,
  chatId: number,
  text: string,
  options: TelegramOptions = {},
): Promise<'sent' | 'rejected'> {
  const answer = await call<unknown>(token, 'sendMessage', { chat_id: chatId, text, link_preview_options: { is_disabled: true } }, options)
  return answer.ok ? 'sent' : 'rejected'
}
