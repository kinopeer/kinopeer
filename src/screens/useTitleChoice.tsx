import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Torrent } from '../api/qbittorrent'
import { useToast } from '../components/Toast'
import { useTmdbLanguage } from '../settings/settings'
import { REQUEST_KINDS } from '../torrents/requestKinds'
import { chooseTitle, sameTitle, type TitleMatch } from '../torrents/titleMatches'
import type { Settled } from '../torrents/torrentRequests'
import { ChangeTitleSheet } from './ChangeTitleSheet'
import { TOAST_KEYS } from './toastKeys'
import { useTorrentAction, type ActionWatcher } from './useTorrentAction'
import { useTorrentSheet } from './useTorrentSheet'

/** What saving a title sends: the title, and whether it's the one shown now, so it's confirmed. */
interface TitleChoice {
  title: TitleMatch
  confirmed: boolean
}

/** Saving a torrent's title and saying how it went, for both ways of choosing one. */
function useSaveTitle() {
  const { t } = useTranslation()
  const toast = useToast()
  const language = useTmdbLanguage()
  return {
    request: (target: Torrent, title: TitleMatch) => () => chooseTitle(target.hash, title, language),
    /** Before sending: the next try takes a failure back. */
    sending: () => toast.dismiss(TOAST_KEYS.title),
    /** Once it settled: success in a toast, and a failure nothing showing the torrent took. */
    settled: (settled: Settled | undefined, confirmed: boolean) => {
      if (!settled) return
      if (settled.ok) toast.show(t(confirmed ? 'match.confirmed' : 'match.changed'))
      else if (!settled.showing) toast.show(t('match.saveFailed'), { icon: 'alert', key: TOAST_KEYS.title })
    },
  }
}

export interface ChangeTitle {
  /** Opens Change title for a torrent in `torrents`. */
  open: (hash: string) => void
  /** The sheet, for the screen to render. */
  element: ReactNode
}

/**
 * Change title for a screen: the TMDB search for one of its torrents, and saving the pick, which
 * outlives the sheet (`useTorrentSheet`). A save on its way for the torrent, from here or elsewhere
 * ("Yes, right" too), shows busy in the sheet and never goes out twice. Once saved, the sheet that
 * shows the torrent closes and a toast says so; a failure stays in that sheet, else it's a toast,
 * which the next try takes back.
 */
export function useChangeTitle({ torrents, matchOf }: {
  /** The screen's torrents: the sheet is for one of them, and closes when it's gone. */
  torrents: Record<string, Torrent> | undefined
  /** The title a torrent shows now, if any. */
  matchOf: (torrent: Torrent) => TitleMatch | null | undefined
}): ChangeTitle {
  const { torrent, open, close, pending, failure, send } = useTorrentSheet<TitleChoice>(REQUEST_KINDS.title, torrents)
  const save = useSaveTitle()

  const pick = async (target: Torrent, title: TitleMatch) => {
    const confirmed = sameTitle(title, matchOf(target))
    save.sending()
    save.settled(await send(target, { title, confirmed }, save.request(target, title)), confirmed)
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

export interface ConfirmTitle {
  /** Whether a title save is in flight for the torrent, sent from anywhere. */
  busy: (hash: string) => boolean
  /** Keeps the title shown for the torrent as the user's choice, unless a save is in flight already. */
  confirm: (target: Torrent, title: TitleMatch) => Promise<Settled | undefined>
}

/**
 * "Yes, right" for a guessed title, through the app's torrent requests, so it's busy wherever the
 * torrent shows a title save in flight (Change title too) and never goes out twice. A toast says
 * it's confirmed; a failure is a toast, which the next try takes back, unless `watcher` shows the
 * torrent and takes the outcome itself.
 */
export function useConfirmTitle(watcher?: ActionWatcher): ConfirmTitle {
  const { busy, send } = useTorrentAction(REQUEST_KINDS.title, watcher)
  const save = useSaveTitle()

  const confirm = async (target: Torrent, title: TitleMatch) => {
    save.sending()
    const settled = await send(target, { title, confirmed: true } satisfies TitleChoice, save.request(target, title))
    save.settled(settled, true)
    return settled
  }
  return { busy, confirm }
}
