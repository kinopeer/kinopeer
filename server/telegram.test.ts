import { afterEach, describe, expect, it } from 'vitest'
import { TelegramUnavailable, botName, isBotToken, sendMessage, startedChats } from './telegram.ts'
import { TELEGRAM_TOKEN as TOKEN, bodyOf, closeServers, listen, silentService } from './test/fakes.ts'

afterEach(closeServers)

/** A Bot API that answers every call with `status` and `body`, and records what it got. */
async function fakeBotApi(status: number, body: unknown) {
  const calls: { path: string; body: unknown; contentType?: string }[] = []
  const base = await listen(async (request, response) => {
    calls.push({ path: request.url ?? '', body: JSON.parse((await bodyOf(request)) || 'null'), contentType: request.headers['content-type'] })
    response.statusCode = status
    response.setHeader('Content-Type', 'application/json')
    response.end(typeof body === 'string' ? body : JSON.stringify(body))
  })
  return { base, calls }
}

describe('isBotToken', () => {
  it.each([
    ['a token as @BotFather gives it', TOKEN, true],
    ['one without the bot id', ':ABCdefGhIJKlmNoPQRsTUVwxyZ', false],
    ['one with a slash, which would steer the path', '123456:ABCdefGhIJKlmNoPQRsTU/../x', false],
    ['one with a path before the bot id', `../x/${TOKEN}`, false],
    ['one with a path after the secret', `${TOKEN}/../getMe`, false],
    ['one with a space', '123456:ABCdefGhIJKlmNoPQRs TUVwxyZ', false],
    ['one too short to be a secret', '123456:abc', false],
  ])('%s: %s', (_name, value, valid) => {
    expect(isBotToken(value)).toBe(valid)
  })
})

describe('botName', () => {
  it('asks getMe with the token in the path and answers the bot’s username', async () => {
    const api = await fakeBotApi(200, { ok: true, result: { id: 1, is_bot: true, username: 'kinopeer_home_bot' } })
    expect(await botName(TOKEN, { base: api.base })).toBe('kinopeer_home_bot')
    expect(api.calls[0].path).toBe(`/bot${TOKEN}/getMe`)
  })

  it('answers undefined when Telegram doesn’t know the token', async () => {
    const api = await fakeBotApi(401, { ok: false, error_code: 401, description: 'Unauthorized' })
    expect(await botName(TOKEN, { base: api.base })).toBeUndefined()
  })

  it('sends nothing for a value that isn’t a token', async () => {
    const api = await fakeBotApi(200, { ok: true, result: { username: 'x' } })
    expect(await botName('not a token', { base: api.base })).toBeUndefined()
    expect(api.calls).toEqual([])
  })
})

describe('startedChats', () => {
  const update = (text: string, chat: object) => ({ update_id: 1, message: { message_id: 1, text, chat } })

  it('lists the chats that sent /start, the latest first and each once, with their names and kinds', async () => {
    const api = await fakeBotApi(200, {
      ok: true,
      result: [
        update('/start', { id: 11, type: 'private', first_name: 'First' }),
        update('hello', { id: 33, type: 'private', first_name: 'Chatty' }),
        update('/start@kinopeer_home_bot', { id: -22, type: 'group', title: 'Home' }),
        update('/start', { id: 11, type: 'private', first_name: 'First' }),
      ],
    })
    expect(await startedChats(TOKEN, { base: api.base })).toEqual([
      { id: 11, name: 'First', type: 'private' },
      { id: -22, name: 'Home', type: 'group' },
    ])
    expect(api.calls[0]).toEqual({
      path: `/bot${TOKEN}/getUpdates`,
      body: { allowed_updates: ['message', 'channel_post'], offset: -100 },
      contentType: 'application/json',
    })
  })

  it('takes a /start posted in a channel where the bot is an admin, and one with spaces around it', async () => {
    const api = await fakeBotApi(200, {
      ok: true,
      result: [
        { update_id: 1, channel_post: { message_id: 1, text: '/start', chat: { id: -100123, type: 'channel', title: 'Downloads' } } },
        update('  /start  ', { id: 7, type: 'private', first_name: 'Ann' }),
      ],
    })
    expect(await startedChats(TOKEN, { base: api.base })).toEqual([
      { id: 7, name: 'Ann', type: 'private' },
      { id: -100123, name: 'Downloads', type: 'channel' },
    ])
  })

  it.each([
    ['first and last name', { first_name: 'Ann', last_name: 'Lee' }, 'Ann Lee'],
    ['username alone', { username: 'ann' }, '@ann'],
    ['nothing but its id', {}, '7'],
  ])('names a private chat by its %s', async (_name, fields, name) => {
    const api = await fakeBotApi(200, { ok: true, result: [update('/start', { id: 7, type: 'private', ...fields })] })
    expect(await startedChats(TOKEN, { base: api.base })).toEqual([{ id: 7, name, type: 'private' }])
  })

  it('leaves out other commands, words starting with /start, chats of a kind it doesn’t know and ids that aren’t whole numbers', async () => {
    const api = await fakeBotApi(200, {
      ok: true,
      result: [
        update('/stop', { id: 7, type: 'private', first_name: 'Ann' }),
        update('/starting', { id: 8, type: 'private' }),
        update('/start', { id: 9, type: 'secret' }),
        update('/start', { id: '10', type: 'private', first_name: 'Text id' }),
        update('/start', { id: 1.5, type: 'private', first_name: 'Odd id' }),
        update('/start', { type: 'private', first_name: 'No id' }),
      ],
    })
    expect(await startedChats(TOKEN, { base: api.base })).toEqual([])
  })

  it('answers rejected when Telegram doesn’t know the token', async () => {
    const api = await fakeBotApi(401, { ok: false })
    expect(await startedChats(TOKEN, { base: api.base })).toBe('rejected')
  })

  it('answers conflict when another program takes the bot’s updates: a webhook, or another app polling it', async () => {
    const api = await fakeBotApi(409, { ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request' })
    expect(await startedChats(TOKEN, { base: api.base })).toBe('conflict')
  })
})

describe('sendMessage', () => {
  it('sends the text to the chat as plain text, without link previews', async () => {
    const api = await fakeBotApi(200, { ok: true, result: { message_id: 5 } })
    expect(await sendMessage(TOKEN, -22, 'Downloaded', { base: api.base })).toBe('sent')
    expect(api.calls[0]).toEqual({
      path: `/bot${TOKEN}/sendMessage`,
      body: { chat_id: -22, text: 'Downloaded', link_preview_options: { is_disabled: true } },
      contentType: 'application/json',
    })
  })

  it('answers rejected when Telegram says it didn’t take it, whatever the status', async () => {
    const refused = await fakeBotApi(200, { ok: false, description: 'Bad Request: message text is empty' })
    expect(await sendMessage(TOKEN, 1, 'x', { base: refused.base })).toBe('rejected')
    const odd = await fakeBotApi(404, { ok: true, result: {} })
    expect(await sendMessage(TOKEN, 1, 'x', { base: odd.base })).toBe('rejected')
  })

  it.each([400, 401, 403])('answers rejected when Telegram refuses it with a %i', async (status) => {
    const api = await fakeBotApi(status, { ok: false, error_code: status })
    expect(await sendMessage(TOKEN, 1, 'x', { base: api.base })).toBe('rejected')
  })

  it('throws TelegramUnavailable with how long to wait on a 429', async () => {
    const api = await fakeBotApi(429, { ok: false, error_code: 429, parameters: { retry_after: 7 } })
    await expect(sendMessage(TOKEN, 1, 'x', { base: api.base })).rejects.toEqual(expect.objectContaining({ retryAfterMs: 7000 }))
  })

  it.each([
    ['without parameters', {}],
    ['of 0 seconds', { parameters: { retry_after: 0 } }],
    ['that isn’t a number', { parameters: { retry_after: '7' } }],
  ])('throws TelegramUnavailable without a wait on a 429 with a retry_after %s', async (_name, fields) => {
    const api = await fakeBotApi(429, { ok: false, error_code: 429, ...fields })
    const error = await sendMessage(TOKEN, 1, 'x', { base: api.base }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TelegramUnavailable)
    expect((error as TelegramUnavailable).retryAfterMs).toBeUndefined()
  })

  it('throws TelegramUnavailable on a 5xx, JSON or not, or an answer that isn’t JSON', async () => {
    const down = await fakeBotApi(502, '<html>Bad gateway</html>')
    await expect(sendMessage(TOKEN, 1, 'x', { base: down.base })).rejects.toBeInstanceOf(TelegramUnavailable)
    const failing = await fakeBotApi(500, { ok: false, error_code: 500, description: 'Internal Server Error' })
    await expect(sendMessage(TOKEN, 1, 'x', { base: failing.base })).rejects.toBeInstanceOf(TelegramUnavailable)
    const odd = await fakeBotApi(200, 'not json')
    await expect(sendMessage(TOKEN, 1, 'x', { base: odd.base })).rejects.toBeInstanceOf(TelegramUnavailable)
  })

  it('throws TelegramUnavailable without the token when Telegram can’t be reached', async () => {
    const error = await sendMessage(TOKEN, 1, 'x', { base: 'http://127.0.0.1:1' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TelegramUnavailable)
    expect(String((error as Error).message) + String((error as Error).cause ?? '')).not.toContain(TOKEN)
  })

  it('gives up a call Telegram doesn’t answer', async () => {
    const { base } = await silentService()
    await expect(sendMessage(TOKEN, 1, 'x', { base, timeoutMs: 50 })).rejects.toBeInstanceOf(TelegramUnavailable)
  })
})
