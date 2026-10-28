import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Torrent } from '../api/qbittorrent'
import { Toast } from '../components/Toast'
import { SpeedLimitsSheet } from './SpeedLimitsSheet'

export interface SpeedLimits {
  /** Opens "Speed limits" for a torrent in `torrents`. */
  open: (hash: string) => void
  /** The sheet and the toast for a save that failed after it was closed, for the screen to render. */
  element: ReactNode
}

/**
 * "Speed limits" for a screen, in the shape of `useMoveTorrent`: the sheet for one of its torrents,
 * which closes when the torrent goes away or is replaced by another with the same hash, and a save
 * that answers after the sheet was closed neither closes a sheet opened since nor fails unsaid.
 */
export function useSpeedLimits({ torrents, offline, refresh, titleOf }: {
  /** The screen's torrents: the sheet is for one of them, and closes when it's gone. */
  torrents: Record<string, Torrent> | undefined
  offline: boolean
  /** After a save, so the screen shows what qBittorrent took. */
  refresh: () => void
  /** The torrent's name as the screen shows it. */
  titleOf: (torrent: Torrent) => string
}): SpeedLimits {
  const { t } = useTranslation()
  // The torrent the sheet is open for, by when it was added: one re-added with the same hash is
  // another torrent, so the sheet doesn't come back for it.
  const [opened, setOpened] = useState<{ hash: string; addedOn: number } | null>(null)
  // The title of a torrent whose save failed after its sheet was closed.
  const [failedFor, setFailedFor] = useState<string | null>(null)
  const candidate = opened ? torrents?.[opened.hash] : undefined
  const torrent = candidate?.added_on === opened?.addedOn ? candidate : undefined
  // Gone (deleted elsewhere) or replaced: forgotten, so the sheet doesn't open again when the same
  // torrent is back.
  if (opened && torrents && !torrent) setOpened(null)
  // Read when a save settles, to tell whether its sheet still shows: set by the handlers, and the
  // screen's torrents after each render.
  const openFor = useRef<string | null>(null)
  const latest = useRef(torrents)
  useEffect(() => {
    latest.current = torrents
  })
  useEffect(
    () => () => {
      openFor.current = null
    },
    [],
  )

  const open = useCallback(
    (hash: string) => {
      const next = torrents?.[hash]
      if (!next) return
      openFor.current = hash
      setOpened({ hash, addedOn: next.added_on })
    },
    [torrents],
  )
  const close = () => {
    openFor.current = null
    setOpened(null)
  }
  const dismiss = useCallback(() => setFailedFor(null), [])
  const showing = (target: Torrent) =>
    openFor.current === target.hash && latest.current?.[target.hash]?.added_on === target.added_on

  const element = (
    <>
      {torrent && (
        <SpeedLimitsSheet
          key={`${torrent.hash}:${torrent.added_on}`}
          torrent={torrent}
          title={titleOf(torrent)}
          offline={offline}
          onClose={close}
          onSaved={() => {
            refresh()
            if (showing(torrent)) close()
          }}
          onFailed={() => {
            // One of the two requests may have gone through: show what was applied.
            refresh()
            if (!showing(torrent)) setFailedFor(titleOf(torrent))
          }}
        />
      )}
      {failedFor !== null && (
        <Toast icon="alert" message={t('limits.failedClosed', { title: failedFor })} onDismiss={dismiss} />
      )}
    </>
  )
  return { open, element }
}
