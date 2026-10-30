import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteTorrents, type Torrent } from '../api/qbittorrent'
import { useToast } from '../components/Toast'
import { REQUEST_KINDS } from '../torrents/requestKinds'
import { forgetMatches } from '../torrents/serverMatches'
import { DeleteTorrentDialog } from './DeleteTorrentDialog'
import { TOAST_KEYS } from './toastKeys'
import { useTorrentAction } from './useTorrentAction'
import { findTorrent, refTo, type TorrentRef } from './useTorrentOverlay'

/** What a delete expects of its torrents: gone from every screen. */
const gone = () => undefined

export interface DeleteTorrents {
  /** Opens the confirmation for torrents among `torrents`: a row's, or the selection. */
  open: (targets: readonly Torrent[]) => void
  /** The confirmation, for the screen to render. */
  element: ReactNode
}

/**
 * Deleting torrents for a screen: the confirmation for some of its torrents, and the delete itself,
 * which outlives it (`useTorrentAction`), so a confirmation opened again for a torrent being deleted,
 * here or elsewhere, shows it busy and it never goes out twice. Once qBittorrent took it, a toast
 * says so, the torrents' titles are forgotten, they're gone from every screen until a poll sent
 * after has the final word, and the screen hears of it while it's here. A failure stays in the
 * confirmation that shows the torrents, else it's a toast, which the next try takes back.
 */
export function useDeleteTorrents({ torrents, titleOf, onDeleted }: {
  /** The screen's torrents: the confirmation is for some of them, and closes when they're gone. */
  torrents: Record<string, Torrent> | undefined
  /** What a torrent is called on the screen. */
  titleOf: (torrent: Torrent) => string
  /** After qBittorrent deleted torrents this screen sent, while the screen is here. */
  onDeleted?: () => void
}): DeleteTorrents {
  const { t } = useTranslation()
  const toast = useToast()
  const [confirming, setConfirming] = useState<TorrentRef[] | null>(null)
  const [failed, setFailed] = useState(false)
  // Without those that went away or were replaced since; none left, the confirmation is forgotten, so
  // it doesn't open again if the same torrent is back. Not before the screen's first answer.
  const shown = (confirming ?? []).flatMap((ref) => findTorrent(torrents, ref) ?? [])
  if (confirming && torrents && shown.length === 0) setConfirming(null)

  // The confirmation shows its torrents, so it says how a delete of them went, wherever it was sent
  // from: it closes, or shows the failure.
  const { busy, send } = useTorrentAction(
    REQUEST_KINDS.delete,
    shown.length > 0
      ? { torrents: shown, settled: (outcome) => (outcome.ok ? setConfirming(null) : setFailed(true)) }
      : undefined,
  )

  // Unset once the screen is gone, so a delete that settles after it (the torrent page left) doesn't
  // move the app.
  const deleted = useRef(onDeleted)
  useLayoutEffect(() => {
    deleted.current = onDeleted
    return () => {
      deleted.current = undefined
    }
  })

  const remove = async (targets: readonly Torrent[], withFiles: boolean) => {
    toast.dismiss(TOAST_KEYS.delete)
    setFailed(false)
    let sent: string[] = []
    const settled = await send(
      targets,
      withFiles,
      (hashes) => {
        sent = hashes
        return deleteTorrents(hashes, withFiles)
      },
      { expect: gone },
    )
    if (!settled) return
    if (!settled.ok) {
      if (!settled.showing) toast.show(t('torrent.actionFailed'), { icon: 'alert', key: TOAST_KEYS.delete })
      return
    }
    void forgetMatches(sent)
    toast.show(
      sent.length > 1
        ? t(withFiles ? 'downloads.deletedManyFiles' : 'downloads.deletedMany', { count: sent.length })
        : t(withFiles ? 'downloads.deletedFiles' : 'downloads.deleted'),
    )
    deleted.current?.()
  }

  const open = (targets: readonly Torrent[]) => {
    setConfirming(targets.map(refTo))
    setFailed(false)
  }

  const element = shown.length > 0 && (
    <DeleteTorrentDialog
      torrents={shown}
      title={titleOf(shown[0])}
      busy={shown.some((item) => busy(item.hash))}
      failed={failed}
      onConfirm={(withFiles) => void remove(shown, withFiles)}
      onClose={() => setConfirming(null)}
    />
  )
  return { open, element }
}
