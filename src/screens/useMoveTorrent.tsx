import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { QbittorrentError, setTorrentLocation, UnauthorizedError, type Torrent } from '../api/qbittorrent'
import { Toast } from '../components/Toast'
import { MoveTorrentSheet, type MoveFailure } from './MoveTorrentSheet'

/** Why qBittorrent didn't take the folder, as a translation key. */
function failureKey(error: unknown): MoveFailure {
  if (error instanceof QbittorrentError && !(error instanceof UnauthorizedError)) {
    if (error.status === 403) return 'move.noAccess'
    if (error.status === 409) return 'move.cantCreate'
  }
  // A lost session included: the screen's poll notices it and asks for the login.
  return 'torrent.actionFailed'
}

type Outcome = { moved: string } | { failed: MoveFailure }

export interface MoveTorrent {
  /** Opens "Move files" for a torrent in `torrents`. */
  open: (hash: string) => void
  /** The sheet and the toast with how the move went, for the screen to render. */
  element: ReactNode
}

/**
 * "Move files" for a screen: the sheet for one of its torrents, and the move itself, which outlives
 * the sheet, so a move that fails after the sheet was closed (or its torrent went away) still says so.
 */
export function useMoveTorrent({ torrents, offline, refresh }: {
  /** The screen's torrents: the sheet is for one of them, and closes when it's gone. */
  torrents: Record<string, Torrent> | undefined
  offline: boolean
  /** After qBittorrent took the folder, so the screen shows it right away. */
  refresh: () => void
}): MoveTorrent {
  const { t } = useTranslation()
  // The torrent the sheet is open for, by when it was added: one re-added with the same hash is
  // another torrent, so the sheet doesn't come back for it.
  const [opened, setOpened] = useState<{ hash: string; addedOn: number } | null>(null)
  const [sendingFor, setSendingFor] = useState<string | null>(null)
  const [failure, setFailure] = useState<MoveFailure>()
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const candidate = opened ? torrents?.[opened.hash] : undefined
  const torrent = candidate?.added_on === opened?.addedOn ? candidate : undefined
  // Read when a move settles, to tell whether its sheet still shows: set by the handlers, and the
  // screen's torrents after each render.
  const openFor = useRef<string | null>(null)
  const latest = useRef(torrents)
  useEffect(() => {
    latest.current = torrents
  })

  const open = useCallback(
    (hash: string) => {
      const next = torrents?.[hash]
      if (!next) return
      openFor.current = hash
      setOpened({ hash, addedOn: next.added_on })
      setFailure(undefined)
    },
    [torrents],
  )
  const close = () => {
    openFor.current = null
    setOpened(null)
  }
  const dismiss = useCallback(() => setOutcome(null), [])

  const showing = (target: Torrent) =>
    openFor.current === target.hash && latest.current?.[target.hash]?.added_on === target.added_on

  const move = async (target: Torrent, location: string) => {
    setSendingFor(target.hash)
    setFailure(undefined)
    try {
      await setTorrentLocation([target.hash], location)
      if (showing(target)) close()
      setOutcome({ moved: location })
      refresh()
    } catch (error) {
      const key = failureKey(error)
      if (showing(target)) setFailure(key)
      else setOutcome({ failed: key })
    } finally {
      setSendingFor(null)
    }
  }

  const element = (
    <>
      {torrent && (
        <MoveTorrentSheet
          key={torrent.hash}
          torrent={torrent}
          offline={offline}
          sending={sendingFor === torrent.hash}
          failure={failure}
          onMove={(location) => void move(torrent, location)}
          onClose={close}
        />
      )}
      {outcome && (
        <Toast
          icon={'moved' in outcome ? 'folder' : 'alert'}
          message={'moved' in outcome ? t('move.moved', { location: outcome.moved }) : t(outcome.failed)}
          onDismiss={dismiss}
        />
      )}
    </>
  )
  return { open, element }
}
