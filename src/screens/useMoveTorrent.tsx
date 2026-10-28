import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { QbittorrentError, setTorrentLocation, UnauthorizedError, type Torrent } from '../api/qbittorrent'
import { MoveOutcomeContext, type MoveOutcome } from './moveOutcome'
import { MoveOutcomeToast } from './MoveOutcomeToast'
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
  // The torrent the sheet is open for, by when it was added: one re-added with the same hash is
  // another torrent, so the sheet doesn't come back for it.
  const [opened, setOpened] = useState<{ hash: string; addedOn: number } | null>(null)
  const [sendingFor, setSendingFor] = useState<string | null>(null)
  const [failure, setFailure] = useState<MoveFailure>()
  const [outcome, setOutcome] = useState<MoveOutcome | null>(null)
  // The screen's own toast shows inside it (a drawer is a modal dialog, above anything outside it);
  // once the screen is gone, App's.
  const shared = useContext(MoveOutcomeContext)
  const mounted = useRef(false)
  const report = (next: MoveOutcome) => (mounted.current || !shared ? setOutcome(next) : shared(next))
  const candidate = opened ? torrents?.[opened.hash] : undefined
  const torrent = candidate?.added_on === opened?.addedOn ? candidate : undefined
  // Read when a move settles, to tell whether its sheet still shows: set by the handlers, and the
  // screen's torrents after each render.
  const openFor = useRef<string | null>(null)
  const latest = useRef(torrents)
  useEffect(() => {
    latest.current = torrents
  })
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // A screen that's gone shows no sheet, so a move that settles after it reports in a toast.
      openFor.current = null
    }
  }, [])

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
      report({ moved: location })
      refresh()
    } catch (error) {
      const key = failureKey(error)
      if (showing(target)) setFailure(key)
      else report({ failed: key })
    } finally {
      // Another torrent's move may have started meanwhile, and is still being sent.
      setSendingFor((current) => (current === target.hash ? null : current))
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
      {outcome && <MoveOutcomeToast outcome={outcome} onDismiss={dismiss} />}
    </>
  )
  return { open, element }
}
