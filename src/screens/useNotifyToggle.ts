import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { NOTIFY_TAG, addTags, removeTags, type Torrent } from '../api/qbittorrent'
import { useToast } from '../components/Toast'
import { notifies, withNotify } from '../torrents/notify'
import { REQUEST_KINDS } from '../torrents/requestKinds'
import type { Settled } from '../torrents/torrentRequests'
import { TOAST_KEYS } from './toastKeys'
import { useTorrentAction } from './useTorrentAction'

export interface NotifyToggle {
  /** What the switch shows: the value being sent while it is, from anywhere, else the torrent's. */
  value: (torrent: Torrent) => boolean
  /** While one is in flight for the torrent, from anywhere. */
  busy: (hash: string) => boolean
  /**
   * Switches the notification on or off with the tag Kinopeer's server watches for. Once
   * qBittorrent took it the torrent shows it until a poll reports it; a failure is a toast.
   */
  set: (torrent: Torrent, on: boolean) => Promise<Settled | undefined>
}

/**
 * The notification when a torrent finishes, through the app's torrent requests
 * (`useTorrentAction`), one at a time per torrent wherever it was sent from. Adding and taking off
 * a tag set it rather than flip it, so nothing is read first.
 */
export function useNotifyToggle(): NotifyToggle {
  const { t } = useTranslation()
  const toast = useToast()
  const { busy, pending, send } = useTorrentAction(REQUEST_KINDS.notify)

  const set = useCallback(
    async (torrent: Torrent, on: boolean) => {
      toast.dismiss(TOAST_KEYS.notify)
      const settled = await send(torrent, on, (hashes) => (on ? addTags : removeTags)(hashes, [NOTIFY_TAG]), {
        expect: (item) => withNotify(item, on),
      })
      if (settled && !settled.ok) toast.show(t('common.qbtFailed'), { icon: 'alert', key: TOAST_KEYS.notify })
      return settled
    },
    [send, toast, t],
  )

  const value = (torrent: Torrent) => {
    const sending = pending(torrent.hash)
    return typeof sending === 'boolean' ? sending : notifies(torrent)
  }
  return { value, busy, set }
}
