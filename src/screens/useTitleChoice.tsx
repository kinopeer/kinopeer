import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Torrent } from '../api/qbittorrent'
import { useToast } from '../components/Toast'
import { useTmdbLanguage } from '../settings/settings'
import { REQUEST_KINDS } from '../torrents/requestKinds'
import { chooseTitle, type TitleMatch } from '../torrents/titleMatches'
import { ChangeTitleSheet } from './ChangeTitleSheet'
import { TOAST_KEYS } from './toastKeys'
import { useTorrentSheet } from './useTorrentSheet'

/** What saving a title sends. */
interface TitleChoice {
  title: TitleMatch
}

export interface ChangeTitle {
  /** Opens the title search for a torrent in `torrents`. */
  open: (hash: string) => void
  /** The sheet, for the screen to render. */
  element: ReactNode
}

/**
 * The title search for a screen (Fix match, or Match title for a torrent without one): TMDB's
 * search for one of its torrents, and saving the pick as the user's choice, which outlives the
 * sheet (`useTorrentSheet`). A save on its way for the torrent, from here or another screen, shows
 * busy in the sheet and never goes out twice. Once saved, the sheet that shows the torrent closes
 * and a toast says so; a failure stays in that sheet, else it's a toast, which the next try takes
 * back.
 */
export function useChangeTitle({ torrents, matchOf }: {
  /** The screen's torrents: the sheet is for one of them, and closes when it's gone. */
  torrents: Record<string, Torrent> | undefined
  /** The title a torrent shows now, if any. */
  matchOf: (torrent: Torrent) => TitleMatch | null | undefined
}): ChangeTitle {
  const { t } = useTranslation()
  const toast = useToast()
  const language = useTmdbLanguage()
  const { torrent, open, close, pending, failure, send } = useTorrentSheet<TitleChoice>(REQUEST_KINDS.title, torrents)

  const pick = async (target: Torrent, title: TitleMatch) => {
    // The next try takes a failure back.
    toast.dismiss(TOAST_KEYS.title)
    const settled = await send(target, { title }, () => chooseTitle(target.hash, title, language))
    if (!settled) return
    if (settled.ok) toast.show(t('match.changed'))
    else if (!settled.showing) toast.show(t('match.saveFailed'), { icon: 'alert', key: TOAST_KEYS.title })
  }

  const element = torrent && (
    <ChangeTitleSheet
      key={torrent.hash}
      torrent={torrent}
      current={matchOf(torrent)}
      saving={pending(torrent.hash)?.title}
      failed={failure !== undefined}
      onPick={(title) => void pick(torrent, title)}
      onClose={close}
    />
  )
  return { open, element }
}
