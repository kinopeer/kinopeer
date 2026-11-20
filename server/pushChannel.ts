import type { NotifyLanguage } from '../src/api/settings/types.ts'
import type { NotifyChannel, NotifyTorrent } from './notifier.ts'
import { notifyText } from './notifyText.ts'
import { pushPayload, type PushStore } from './push.ts'
import { PushUnavailable, sendPush } from './webPush.ts'

export interface PushChannelConfig {
  store: PushStore
  /** The title to name a finished torrent by in `language` (`finishedTitle`), else undefined. */
  title: (torrent: NotifyTorrent, language: NotifyLanguage) => Promise<string | undefined>
  /** Overridable for tests. */
  send?: typeof sendPush
  log?: (message: string) => void
}

/** What a torrent's notification has reached so far, while some device's push service is asked again. */
interface Progress {
  /** The devices done with it: sent, refused or gone. */
  done: Set<string>
  /** Whether some device took it. */
  sent: boolean
}

/**
 * Notifications as Web Push to every device that turned them on (server/push.ts), each in the
 * language it was turned on in, with the title as a notification's title and a tap opening the
 * torrent. A device whose subscription is gone (404, 410) is forgotten. When a device's push service
 * doesn't answer, the channel throws so the notifier sends again later, and that send goes only to
 * the devices that didn't get it. Every device refused or gone: `rejected`.
 */
export function pushChannel(config: PushChannelConfig): NotifyChannel {
  const send = config.send ?? sendPush
  const log = config.log ?? ((message: string) => console.warn(`[kinopeer] ${message}`))
  // Per torrent, kept only while it's sent again, until it's sent or the notifier forgets the torrent.
  const progress = new Map<string, Progress>()
  return {
    id: 'Web Push',
    ready: () => config.store.subscriptions.length > 0,
    send: async (torrent) => {
      const key = await config.store.vapidKey()
      const state = progress.get(torrent.hash) ?? { done: new Set<string>(), sent: false }
      const titles = new Map<NotifyLanguage, Promise<string | undefined>>()
      const gone: string[] = []
      let unavailable: PushUnavailable | undefined
      for (const subscription of config.store.subscriptions) {
        if (state.done.has(subscription.endpoint)) continue
        const { language } = subscription
        if (!titles.has(language)) titles.set(language, config.title(torrent, language).catch(() => undefined))
        const title = await titles.get(language)
        const payload = pushPayload({
          title: notifyText(language, 'pushFinished'),
          body: title ? `${title}\n${torrent.name}` : torrent.name,
          url: `/torrent/${torrent.hash}`,
          tag: torrent.hash,
        })
        try {
          const result = await send(subscription, payload, key)
          state.done.add(subscription.endpoint)
          if (result === 'sent') state.sent = true
          else if (result === 'gone') gone.push(subscription.endpoint)
          else log('a push service refused the notification for a finished download')
        } catch (error) {
          if (!(error instanceof PushUnavailable)) throw error
          // The longest wait any service asked for.
          if (!unavailable || (error.retryAfterMs ?? 0) > (unavailable.retryAfterMs ?? 0)) unavailable = error
        }
      }
      // Writes nothing when none is gone.
      await config.store.forget(gone).catch(() => log('could not write push.json; is the data directory writable?'))
      if (unavailable) {
        progress.set(torrent.hash, state)
        throw unavailable
      }
      progress.delete(torrent.hash)
      return state.sent ? 'sent' : 'rejected'
    },
    forget: (hash) => {
      progress.delete(hash)
    },
  }
}
