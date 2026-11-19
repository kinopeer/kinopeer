import { afterEach, describe, expect, it } from 'vitest'
import { TelegramUnavailable, botName, isBotToken, sendMessage, startedChat } from './telegram.ts'
import { bodyOf, closeServers, listen, silentService } from './test/fakes.ts'

const TOKEN = '123456:ABCdefGhIJKlmNoPQRsTUVwxyZ-_0123456'

afterEach(closeServers)

/** A Bot API that answers every call with `status` and `body`, and records what it got. */
async function fakeBotApi(status: number, body: unknown) {
  const calls: { path: string; body: unknown }[] = []
  const base = await listen(async (request, response) => {
    calls.push({ path: request.url ?? '', body: JSON.parse((await bodyOf(request)) || 'null') })
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

describe('startedChat', () => {
  const update = (text: string, chat: object) => ({ update_id: 1, message: { message_id: 1, text, chat } })

  it('finds the chat that sent /start last, by its name', async () => {
    const api = await fakeBotApi(200, {
      ok: true,
      result: [
        update('/start', { id: 11, type: 'private', first_name: 'First' }),
        update('hello', { id: 33, type: 'private', first_name: 'Chatty' }),
        update('/start@kinopeer_home_bot', { id: -22, type: 'group', title: 'Home' }),
      ],
    })
    expect(await startedChat(TOKEN, { base: api.base })).toEqual({ id: -22, name: 'Home' })
    expect(api.calls[0]).toEqual({ path: `/bot${TOKEN}/getUpdates`, body: { allowed_updates: ['message'] } })
  })

  it.each([
    ['first and last name', { first_name: 'Ann', last_name: 'Lee' }, 'Ann Lee'],
    ['username alone', { username: 'ann' }, '@ann'],
    ['nothing but its id', {}, '7'],
  ])('names a private chat by its %s', async (_name, fields, name) => {
    const api = await fakeBotApi(200, { ok: true, result: [update('/start', { id: 7, type: 'private', ...fields })] })
    expect(await startedChat(TOKEN, { base: api.base })).toEqual({ id: 7, name })
  })

  it('answers undefined when no chat sent /start', async () => {
    const api = await fakeBotApi(200, { ok: true, result: [update('/stop', { id: 7, first_name: 'Ann' }), update('/starting', { id: 8 })] })
    expect(await startedChat(TOKEN, { base: api.base })).toBeUndefined()
  })

  it('answers rejected when Telegram doesn’t know the token', async () => {
    const api = await fakeBotApi(401, { ok: false })
    expect(await startedChat(TOKEN, { base: api.base })).toBe('rejected')
  })
})

describe('sendMessage', () => {
  it('sends the text to the chat as plain text, without link previews', async () => {
    const api = await fakeBotApi(200, { ok: true, result: { message_id: 5 } })
    expect(await sendMessage(TOKEN, -22, 'Downloaded', { base: api.base })).toBe('sent')
    expect(api.calls[0]).toEqual({
      path: `/bot${TOKEN}/sendMessage`,
      body: { chat_id: -22, text: 'Downloaded', link_preview_options: { is_disabled: true } },
    })
  })

  it.each([400, 401, 403])('answers rejected when Telegram refuses it with a %i', async (status) => {
    const api = await fakeBotApi(status, { ok: false, error_code: status })
    expect(await sendMessage(TOKEN, 1, 'x', { base: api.base })).toBe('rejected')
  })

  it('throws TelegramUnavailable with how long to wait on a 429', async () => {
    const api = await fakeBotApi(429, { ok: false, error_code: 429, parameters: { retry_after: 7 } })
    await expect(sendMessage(TOKEN, 1, 'x', { base: api.base })).rejects.toEqual(expect.objectContaining({ retryAfterMs: 7000 }))
  })

  it('throws TelegramUnavailable on a 5xx or an answer that isn’t JSON', async () => {
    const down = await fakeBotApi(502, '<html>Bad gateway</html>')
    await expect(sendMessage(TOKEN, 1, 'x', { base: down.base })).rejects.toBeInstanceOf(TelegramUnavailable)
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
