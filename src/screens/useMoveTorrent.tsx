import { useCallback, useRef, useState, type ReactNode } from 'react'
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
  /** The screen's torrents: the sheet closes when its torrent is gone. */
  torrents: Record<string, Torrent> | undefined
  offline: boolean
  /** After qBittorrent took the folder, so the screen shows it right away. */
  refresh: () => void
}): MoveTorrent {
  const { t } = useTranslation()
  const [hash, setHash] = useState<string | null>(null)
  const [sendingFor, setSendingFor] = useState<string | null>(null)
  const [failure, setFailure] = useState<MoveFailure>()
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  // The sheet that's open now, read when a move settles: a later sheet isn't this move's.
  const openFor = useRef<string | null>(null)
  const torrent = hash ? torrents?.[hash] : undefined
  if (hash && torrents && !torrent) {
    // The torrent is gone: forget the sheet, so it doesn't come back if the hash does.
    openFor.current = null
    setHash(null)
  }

  const open = useCallback((next: string) => {
    openFor.current = next
    setHash(next)
    setFailure(undefined)
  }, [])
  const close = () => {
    openFor.current = null
    setHash(null)
  }
  const dismiss = useCallback(() => setOutcome(null), [])

  const move = async (target: Torrent, location: string) => {
    setSendingFor(target.hash)
    setFailure(undefined)
    try {
      await setTorrentLocation([target.hash], location)
      if (openFor.current === target.hash) close()
      setOutcome({ moved: location })
      refresh()
    } catch (error) {
      const key = failureKey(error)
      if (openFor.current === target.hash) setFailure(key)
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
