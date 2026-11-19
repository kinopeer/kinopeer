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

/** A chat the bot can write to, with the name the user knows it by. */
export interface TelegramChat {
  id: number
  name: string
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

interface Update {
  message?: {
    text?: string
    chat?: { id?: number; type?: string; title?: string; username?: string; first_name?: string; last_name?: string }
  }
}

function chatName(chat: NonNullable<NonNullable<Update['message']>['chat']>): string {
  const person = [chat.first_name, chat.last_name].filter(Boolean).join(' ')
  return chat.title || person || (chat.username ? `@${chat.username}` : String(chat.id))
}

/**
 * The chat that most recently sent the bot `/start` (`/start@bot` in a group), from the updates
 * Telegram keeps for a day; undefined when there's none, and `rejected` when it doesn't know the
 * token. Reading them doesn't confirm them, so the next check sees them too.
 */
export async function startedChat(token: string, options: TelegramOptions = {}): Promise<TelegramChat | undefined | 'rejected'> {
  const answer = await call<Update[]>(token, 'getUpdates', { allowed_updates: ['message'] }, options)
  if (!answer.ok) return 'rejected'
  const updates = Array.isArray(answer.result) ? answer.result : []
  for (const update of [...updates].reverse()) {
    const chat = update.message?.chat
    const command = update.message?.text?.trim().split(/\s/)[0]
    if (chat && Number.isSafeInteger(chat.id) && (command === '/start' || command?.startsWith('/start@'))) {
      return { id: chat.id as number, name: chatName(chat) }
    }
  }
  return undefined
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
