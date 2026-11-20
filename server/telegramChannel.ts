import type { NotifyLanguage } from '../src/api/settings/types.ts'
import type { NotifyChannel, NotifyTorrent } from './notifier.ts'
import { finishedText } from './notifyText.ts'
import { refusedPart, telegramReady, type SettingsStore } from './settings.ts'
import { sendMessage, type TelegramOptions } from './telegram.ts'

export interface TelegramChannelConfig {
  store: SettingsStore
  /** The title to name a finished torrent by in `language` (`finishedTitle`), else undefined. */
  title: (torrent: NotifyTorrent, language: NotifyLanguage) => Promise<string | undefined>
  /** Overridable for tests. */
  telegram?: Omit<TelegramOptions, 'signal'>
}

/**
 * Notifications through the user's Telegram bot, saved in Settings (server/settings.ts). When
 * Telegram refuses a message, the settings keep which of the two it refused, the token or the chat,
 * so Settings can say what to fix; a message that goes through clears it.
 */
export function telegramChannel(config: TelegramChannelConfig): NotifyChannel {
  return {
    id: 'Telegram',
    ready: () => telegramReady(config.store.current),
    send: async (torrent) => {
      const stored = config.store.current
      // Not set up any more: not now rather than refused, so the tag stays (the notifier asks `ready` first).
      if (!telegramReady(stored)) throw new Error('Telegram isn’t set up')
      const { token, chat, language = 'en' } = stored.telegram
      const text = finishedText(language, torrent.name, await config.title(torrent, language))
      const sent = await sendMessage(token, chat.id, text, config.telegram)
      let refused: 'token' | 'chat' | undefined
      if (sent === 'rejected') {
        try {
          refused = await refusedPart(token, config.telegram)
        } catch (error) {
          // Telegram doesn't say now which part it refused. With one recorded for this bot and chat,
          // the refusal stands; otherwise it's sent again later, so Settings learns what to fix
          // rather than the tag coming off while the card says all is well.
          if (stored.telegram.refused) return sent
          throw error
        }
      }
      // Kept for the bot and chat it was sent with, not for ones saved since.
      await config.store
        .updateTelegram((current) =>
          current?.token === token && current.chat?.id === chat.id && current.refused !== refused ? { ...current, refused } : current,
        )
        .catch(() => console.warn('[kinopeer] could not write settings.json; is the data directory writable?'))
      return sent
    },
  }
}
