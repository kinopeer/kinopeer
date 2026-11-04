import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getTorrents, toggleFirstLastPiecePrio, toggleSequentialDownload, type Torrent } from '../api/qbittorrent'
import { useToast } from '../components/Toast'
import { REQUEST_KINDS } from '../torrents/requestKinds'
import { readRefreshInterval, stateLag } from '../torrents/stateLag'
import type { Settled } from '../torrents/torrentRequests'
import { TOAST_KEYS } from './toastKeys'
import { useTorrentAction } from './useTorrentAction'

/** The download settings a torrent's page switches, by their fields in `Torrent`. */
export type DownloadToggleField = 'seq_dl' | 'f_l_piece_prio'

const TOGGLES = {
  seq_dl: { kind: REQUEST_KINDS.sequential, request: toggleSequentialDownload, toastKey: TOAST_KEYS.sequential },
  f_l_piece_prio: {
    kind: REQUEST_KINDS.firstLastPieces,
    request: toggleFirstLastPiecePrio,
    toastKey: TOAST_KEYS.firstLastPieces,
  },
} as const

export interface DownloadToggle {
  /** What the switch shows: the value being sent while it is, from anywhere, else the torrent's. */
  value: (torrent: Torrent) => boolean
  /**
   * While one is in flight, from anywhere, and while its new value is held (`stateLag`): qBittorrent
   * may still report the old one then, so a tap back would read it and flip nothing.
   */
  busy: (hash: string) => boolean
  /**
   * Turns the setting on or off. qBittorrent can only flip it, so the torrent is read just before,
   * and nothing is flipped when it's that way already (another client changed it since the last
   * poll). Once qBittorrent took it the torrent shows the new value until a poll reports it
   * (`stateLag`: qBittorrent may report the old one for a second); a failure is a toast.
   */
  set: (torrent: Torrent, on: boolean) => Promise<Settled | undefined>
}

/**
 * Sequential download or first and last pieces first for a torrent through the app's torrent
 * requests (`useTorrentAction`), one at a time per torrent wherever it was sent from, since sending
 * a flip twice would undo it.
 */
export function useDownloadToggle(field: DownloadToggleField): DownloadToggle {
  const { t } = useTranslation()
  const toast = useToast()
  const { kind, request, toastKey } = TOGGLES[field]
  const { busy, holding, pending, send } = useTorrentAction(kind)

  const set = useCallback(
    async (torrent: Torrent, on: boolean) => {
      toast.dismiss(toastKey)
      void readRefreshInterval()
      const settled = await send(
        torrent,
        on,
        async (hashes) => {
          const [current] = await getTorrents({ hashes })
          // Gone, or that way already: there's nothing to flip.
          if (!current || current[field] === on) return
          await request(hashes)
        },
        { expect: (item) => ({ ...item, [field]: on }), hold: stateLag },
      )
      if (settled && !settled.ok) toast.show(t('torrent.actionFailed'), { icon: 'alert', key: toastKey })
      return settled
    },
    [send, toast, t, field, request, toastKey],
  )

  const value = (torrent: Torrent) => {
    const sending = pending(torrent.hash)
    return typeof sending === 'boolean' ? sending : torrent[field]
  }
  return { value, busy: (hash) => busy(hash) || holding(hash), set }
}
