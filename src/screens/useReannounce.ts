import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { reannounceTorrents, type Torrent } from '../api/qbittorrent'
import { useToast } from '../components/Toast'
import { REQUEST_KINDS } from '../torrents/requestKinds'
import type { Settled } from '../torrents/torrentRequests'
import { TOAST_KEYS } from './toastKeys'
import { useTorrentAction, type ActionWatcher } from './useTorrentAction'

export interface Reannounce {
  /** Whether a reannounce is in flight for the torrent, sent from anywhere. */
  busy: (hash: string) => boolean
  /** Asks the torrent's trackers for peers, unless that's in flight already, and says it in a toast. */
  reannounce: (torrent: Torrent) => Promise<Settled | undefined>
}

/**
 * Reannouncing through the app's torrent requests (`useTorrentAction`), so a More menu opened again
 * shows one in flight busy and it never goes out twice. Once qBittorrent took it, a toast says so;
 * a failure is a toast too, which the next try takes back, unless `watcher` shows the torrent and
 * takes the outcome itself.
 */
export function useReannounce(watcher?: ActionWatcher): Reannounce {
  const { t } = useTranslation()
  const toast = useToast()
  const { busy, send } = useTorrentAction(REQUEST_KINDS.reannounce, watcher)

  const reannounce = useCallback(
    async (torrent: Torrent) => {
      toast.dismiss(TOAST_KEYS.reannounce)
      const settled = await send(torrent, true, (hashes) => reannounceTorrents(hashes))
      if (settled?.ok) toast.show(t('torrent.reannounced'))
      else if (settled && !settled.showing) {
        toast.show(t('common.qbtFailed'), { icon: 'alert', key: TOAST_KEYS.reannounce })
      }
      return settled
    },
    [send, toast, t],
  )

  return { busy, reannounce }
}
