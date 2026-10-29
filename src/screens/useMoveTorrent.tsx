import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { QbittorrentError, setTorrentLocation, UnauthorizedError, type Torrent } from '../api/qbittorrent'
import { MoveOutcomeContext, type MoveOutcome } from './moveOutcome'
import { MoveOutcomeToast } from './MoveOutcomeToast'
import { MoveTorrentSheet, type MoveFailure } from './MoveTorrentSheet'
import { useTorrentSheet } from './useTorrentSheet'

/** Why qBittorrent didn't take the folder, as a translation key. */
function failureKey(error: unknown): MoveFailure {
  if (error instanceof QbittorrentError && !(error instanceof UnauthorizedError)) {
    if (error.status === 403) return 'move.noAccess'
    if (error.status === 409) return 'move.cantCreate'
  }
  // A lost session included: the screen's poll notices it and asks for the login.
  return 'torrent.actionFailed'
}

export interface MoveTorrent {
  /** Opens "Move files" for a torrent in `torrents`. */
  open: (hash: string) => void
  /** The sheet and the toast with how the move went, for the screen to render. */
  element: ReactNode
}

/**
 * "Move files" for a screen: the sheet for one of its torrents, and the move itself, which outlives
 * the sheet, so a move that fails after the sheet was closed (or its torrent went away) still says so.
 * Under a `MoveOutcomeProvider` (in `App`), a move that settles after the screen is gone says so too.
 */
export function useMoveTorrent({ torrents, offline, refresh }: {
  /** The screen's torrents: the sheet is for one of them, and closes when it's gone. */
  torrents: Record<string, Torrent> | undefined
  offline: boolean
  /** After qBittorrent took the folder, so the screen shows it right away. */
  refresh: () => void
}): MoveTorrent {
  const { torrent, open, close, pending, failure, send } = useTorrentSheet<string>(torrents)
  const [outcome, setOutcome] = useState<MoveOutcome | null>(null)
  // The screen's own toast shows inside it (a drawer is a modal dialog, above anything outside it);
  // once the screen is gone, App's.
  const shared = useContext(MoveOutcomeContext)
  const mounted = useRef(false)
  const report = (next: MoveOutcome) => (mounted.current || !shared ? setOutcome(next) : shared(next))
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const dismiss = useCallback(() => setOutcome(null), [])

  const move = async (target: Torrent, location: string) => {
    const settled = await send(target, location, () => setTorrentLocation([target.hash], location))
    if (settled.ok) {
      if (settled.showing) close()
      report({ moved: location })
      refresh()
    } else if (!settled.showing) {
      report({ failed: failureKey(settled.error) })
    }
  }

  const element = (
    <>
      {torrent && (
        <MoveTorrentSheet
          key={torrent.hash}
          torrent={torrent}
          offline={offline}
          pending={pending(torrent.hash)}
          failure={failure && failureKey(failure.error)}
          onMove={(location) => void move(torrent, location)}
          onClose={close}
        />
      )}
      {outcome && <MoveOutcomeToast outcome={outcome} onDismiss={dismiss} />}
    </>
  )
  return { open, element }
}
