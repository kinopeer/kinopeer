import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { recheckTorrents, type Torrent } from '../api/qbittorrent'
import { useToast } from '../components/Toast'
import { withChecking } from '../torrents/status'
import { RecheckDialog } from './RecheckDialog'
import { TOAST_KEYS } from './toastKeys'
import { useTorrentSheet } from './useTorrentSheet'

/** The requests' kind for a forced recheck. */
export const RECHECK = 'recheck'

export interface Recheck {
  /** Opens the confirmation for a torrent in `torrents`. */
  open: (hash: string) => void
  /** The confirmation, for the screen to render. */
  element: ReactNode
}

/**
 * A forced recheck for a screen: the confirmation for one of its torrents, and the recheck itself,
 * which outlives it (`useTorrentSheet`). Once qBittorrent took it, a toast says so and the torrent
 * shows as checking until a poll sent after has the final word. A failure stays in the confirmation
 * that shows the torrent, else it's a toast, which the next try takes back.
 */
export function useRecheck({ torrents, titleOf }: {
  /** The screen's torrents: the confirmation is for one of them, and closes when it's gone. */
  torrents: Record<string, Torrent> | undefined
  /** What a torrent is called on the screen. */
  titleOf: (torrent: Torrent) => string
}): Recheck {
  const { torrent, open, close, pending, failure, send } = useTorrentSheet<true>(RECHECK, torrents)
  const { t } = useTranslation()
  const toast = useToast()

  const recheck = async (target: Torrent) => {
    toast.dismiss(TOAST_KEYS.recheck)
    const settled = await send(target, true, () => recheckTorrents([target.hash]), { expect: withChecking })
    if (!settled) return
    // A confirmation that shows the torrent closed on its own, or kept the failure to say it.
    if (settled.ok) toast.show(t('torrent.rechecking'))
    else if (!settled.showing) toast.show(t('torrent.actionFailed'), { icon: 'alert', key: TOAST_KEYS.recheck })
  }

  const element = torrent && (
    <RecheckDialog
      key={torrent.hash}
      title={titleOf(torrent)}
      busy={pending(torrent.hash) !== undefined}
      failed={failure !== undefined}
      onConfirm={() => void recheck(torrent)}
      onClose={close}
    />
  )
  return { open, element }
}
