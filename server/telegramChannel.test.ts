import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotifyTorrent } from './notifier.ts'
import { SettingsStore, type StoredTelegram } from './settings.ts'
import { telegramChannel } from './telegramChannel.ts'
import { RENEWED_TELEGRAM_TOKEN, TELEGRAM_TOKEN, UNKNOWN_TELEGRAM_TOKEN, closeServers, fakeTelegram } from './test/fakes.ts'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kinopeer-telegram-'))
})

afterEach(async () => {
  await closeServers()
  await rm(dir, { recursive: true, force: true })
})

const connected: StoredTelegram = {
  token: TELEGRAM_TOKEN,
  bot: 'kinopeer_home_bot',
  chat: { id: 42, name: 'Alex', type: 'private' },
  language: 'ru',
}
const finished: NotifyTorrent = { hash: 'a', name: 'Dune.2021.2160p.WEB-DL-GRPA', tags: 'kinopeer:notify', progress: 1, state: 'uploading' }

async function setUp(stored?: StoredTelegram, title = async () => 'Дюна (2021)' as string | undefined) {
  const telegram = await fakeTelegram()
  const store = new SettingsStore(dir)
  if (stored) await store.update({ telegram: stored })
  const titleOf = vi.fn(title)
  return { telegram, store, titleOf, channel: telegramChannel({ store, title: titleOf, telegram: { base: telegram.base } }) }
}

describe('telegramChannel', () => {
  it('is ready only with a token and a chat', async () => {
    const { channel, store } = await setUp()
    expect(channel.ready()).toBe(false)
    await store.update({ telegram: { token: TELEGRAM_TOKEN, bot: 'kinopeer_home_bot' } })
    expect(channel.ready()).toBe(false)
    await store.update({ telegram: connected })
    expect(channel.ready()).toBe(true)
  })

  it('sends the title in the chat’s language, then the torrent’s name', async () => {
    const { channel, telegram, titleOf } = await setUp(connected)
    expect(await channel.send(finished)).toBe('sent')
    expect(titleOf).toHaveBeenCalledWith(finished, 'ru')
    expect(telegram.sent()).toEqual([
      { chat_id: 42, text: 'Загрузка завершена: Дюна (2021)\nDune.2021.2160p.WEB-DL-GRPA', link_preview_options: { is_disabled: true } },
    ])
  })

  it('writes in English when the chat was saved without a language', async () => {
    const { channel, telegram } = await setUp({ ...connected, language: undefined }, async () => undefined)
    await channel.send(finished)
    expect(telegram.sent()[0].text).toBe('Download finished: Dune.2021.2160p.WEB-DL-GRPA')
  })

  it.each([
    ['the chat, when the bot can’t write to it', { ...connected, chat: { id: 7, name: 'Gone', type: 'private' } }, 'chat'],
    ['the token, when Telegram no longer knows it', { ...connected, token: UNKNOWN_TELEGRAM_TOKEN }, 'token'],
  ] as const)('keeps that Telegram refused %s', async (_name, stored, refused) => {
    const { channel, store } = await setUp(stored)
    expect(await channel.send(finished)).toBe('rejected')
    expect(store.current.telegram?.refused).toBe(refused)
  })

  it('clears what Telegram refused once a message goes through', async () => {
    const { channel, store } = await setUp({ ...connected, refused: 'chat' })
    await channel.send(finished)
    expect(store.current.telegram?.refused).toBeUndefined()
  })

  it('keeps nothing for a bot saved while the message was on its way', async () => {
    const { channel, store, telegram } = await setUp({ ...connected, chat: { id: 7, name: 'Gone', type: 'private' } })
    let answer!: () => void
    telegram.state.hold = new Promise((resolve) => (answer = resolve))
    const sending = channel.send(finished)
    await vi.waitFor(() => expect(telegram.seen).toHaveLength(1))
    await store.update({ telegram: connected })
    answer()
    expect(await sending).toBe('rejected')
    expect(store.current.telegram).toEqual(connected)
  })

  it('keeps nothing for a token of the same bot renewed while the message was on its way', async () => {
    const gone = { ...connected, chat: { id: 7, name: 'Gone', type: 'private' as const } }
    const { channel, store, telegram } = await setUp(gone)
    let answer!: () => void
    telegram.state.hold = new Promise((resolve) => (answer = resolve))
    const sending = channel.send(finished)
    await vi.waitFor(() => expect(telegram.seen).toHaveLength(1))
    const renewed = { ...gone, token: RENEWED_TELEGRAM_TOKEN }
    await store.update({ telegram: renewed })
    answer()
    expect(await sending).toBe('rejected')
    expect(store.current.telegram).toEqual(renewed)
  })

  it('still answers what Telegram did when settings.json can’t be written, and says so in the log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { channel, store } = await setUp({ ...connected, chat: { id: 7, name: 'Gone', type: 'private' } })
    vi.spyOn(store, 'updateTelegram').mockRejectedValue(new Error('EACCES'))
    expect(await channel.send(finished)).toBe('rejected')
    expect(warn).toHaveBeenCalledWith('[kinopeer] could not write settings.json; is the data directory writable?')
    warn.mockRestore()
  })

  it('answers a refusal as one, keeping what was refused before, when Telegram then doesn’t say which part it refused', async () => {
    const { channel, store, telegram } = await setUp({ ...connected, chat: { id: 7, name: 'Gone', type: 'private' }, refused: 'chat' })
    telegram.state.unavailable = ['getMe']
    expect(await channel.send(finished)).toBe('rejected')
    expect(store.current.telegram?.refused).toBe('chat')
  })

  it('rejects when Telegram doesn’t answer, so the watcher sends again', async () => {
    const { channel, telegram } = await setUp(connected)
    telegram.state.down = true
    await expect(channel.send(finished)).rejects.toThrow()
  })

  it('refuses without sending when the bot was forgotten since the pass began', async () => {
    const { channel, telegram } = await setUp()
    expect(await channel.send(finished)).toBe('rejected')
    expect(telegram.seen).toEqual([])
  })
})
