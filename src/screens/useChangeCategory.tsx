import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { setCategory, type Torrent } from '../api/qbittorrent'
import { useToast } from '../components/Toast'
import { withCategory, type CategoryChange } from '../torrents/categoryChange'
import { REQUEST_KINDS } from '../torrents/requestKinds'
import { CategorySheet } from './CategorySheet'
import { useTorrentSheet } from './useTorrentSheet'

export interface ChangeCategory {
  /** Opens the Category sheet for a torrent in `torrents`. */
  open: (hash: string) => void
  /** Whether a category is being sent for the torrent, from anywhere. */
  busy: (hash: string) => boolean
  /** The sheet, for the screen to render. */
  element: ReactNode
}

/**
 * The Category sheet for a screen: the sheet for one of its torrents, and the change itself, which
 * outlives it (`useTorrentSheet`). Once qBittorrent took it the torrent shows the new category (and
 * the folder its files move to) until a poll has it, and a toast says so, naming the folder when the
 * files move. A failure stays in the sheet that shows the torrent, else it's a toast.
 */
export function useChangeCategory({ torrents, offline }: {
  /** The screen's torrents: the sheet is for one of them, and closes when it's gone. */
  torrents: Record<string, Torrent> | undefined
  offline: boolean
}): ChangeCategory {
  const { torrent, open, close, pending, failure, send } = useTorrentSheet<string>(REQUEST_KINDS.category, torrents)
  const { t } = useTranslation()
  const toast = useToast()

  const save = async (target: Torrent, category: string, change: CategoryChange) => {
    const settled = await send(target, category, () => setCategory([target.hash], category), {
      expect: (item) => withCategory(item, category, change),
    })
    if (!settled) return
    // A sheet that shows the torrent closed on its own, or kept the failure to say it.
    if (settled.ok) {
      if (change.kind === 'move' && change.folder) toast.show(t('move.moved', { location: change.folder }), { icon: 'folder' })
      else toast.show(t('category.changed'))
    } else if (!settled.showing) {
      toast.show(t('torrent.actionFailed'), { icon: 'alert' })
    }
  }

  const element = torrent && (
    <CategorySheet
      key={torrent.hash}
      torrent={torrent}
      offline={offline}
      pending={pending(torrent.hash)}
      failed={failure !== undefined}
      onSave={(category, change) => void save(torrent, category, change)}
      onClose={close}
    />
  )
  return { open, busy: (hash) => pending(hash) !== undefined, element }
}
