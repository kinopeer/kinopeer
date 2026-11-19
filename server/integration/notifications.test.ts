import { afterEach, describe, expect, it } from 'vitest'
import { NOTIFY_TAG, addTags, removeTags } from '../../src/api/qbittorrent/client.ts'
import {
  checkTelegram,
  findTelegramChat,
  forgetTelegram,
  getServerSettings,
  saveTelegramChat,
  saveTelegramToken,
  testTelegram,
} from '../../src/api/settings/client.ts'
import { TORRENTS } from '../../src/test/fixtures.ts'
import { NOTIFY_TAG as SERVER_NOTIFY_TAG, taggedTorrents } from '../notifier.ts'
import { qbittorrentBridge } from '../qbittorrent.ts'
import { TELEGRAM_TOKEN } from '../test/fakes.ts'
import { startKinopeer, stopKinopeer } from '../test/integration.ts'

afterEach(stopKinopeer)

describe('notifications through /api/settings/telegram and /qbt', () => {
  it('sets up the bot in three steps, sends a test message, then offers the switch', async () => {
    const { telegram, stores, responses } = await startKinopeer()
    await expect(saveTelegramToken(TELEGRAM_TOKEN)).resolves.toMatchObject({
      telegram: { bot: 'kinopeer_home_bot', chat: null },
      notifications: false,
    })
    await expect(findTelegramChat()).resolves.toEqual({ id: 42, name: 'Alex', type: 'private' })
    await expect(saveTelegramChat(42, 'en')).resolves.toMatchObject({
      telegram: { chat: { name: 'Alex', type: 'private' } },
      notifications: true,
    })
    await expect(testTelegram('en')).resolves.toMatchObject({ telegram: { refused: null } })
    expect(telegram.sent()).toEqual([expect.objectContaining({ chat_id: 42 })])
    await expect(checkTelegram()).resolves.toEqual({ bot: 'kinopeer_home_bot' })
    await expect(getServerSettings()).resolves.toMatchObject({ notifications: true })
    expect(stores.settings.current.telegram?.language).toBe('en')
    // The token's secret part never reaches the browser.
    for (const response of responses) expect(await response.text()).not.toContain(TELEGRAM_TOKEN.split(':')[1])

    await expect(forgetTelegram()).resolves.toMatchObject({ telegram: { bot: null }, notifications: false })
  })

  it('says what Telegram refused, so Settings can name it', async () => {
    const { telegram } = await startKinopeer()
    await expect(saveTelegramToken('999:ABCdefGhIJKlmNoPQRsTUVwxyZ-_0123456')).rejects.toMatchObject({ status: 422, code: 'invalid-key' })
    await saveTelegramToken(TELEGRAM_TOKEN)
    telegram.state.started = []
    await expect(findTelegramChat()).rejects.toMatchObject({ status: 404, code: 'no-chat' })
    telegram.state.down = true
    await expect(checkTelegram()).rejects.toMatchObject({ status: 502, code: 'unreachable' })
  })

  it('switches a torrent’s notification with the tag the server watches for', async () => {
    const { qbittorrent } = await startKinopeer()
    const [first] = TORRENTS
    const server = qbittorrentBridge({ url: () => qbittorrent.base, credentials: () => ({ username: 'admin', password: 'pass word' }) })
    expect(NOTIFY_TAG).toBe(SERVER_NOTIFY_TAG)

    await addTags([first.hash], [NOTIFY_TAG])
    expect((await taggedTorrents(server.get))?.map(({ hash }) => hash)).toEqual([first.hash])

    await removeTags([first.hash], [NOTIFY_TAG])
    expect(await taggedTorrents(server.get)).toEqual([])
  })
})
