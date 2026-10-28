import { useCallback, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { setSpeedLimits, type Torrent } from '../api/qbittorrent'
import { Toast } from '../components/Toast'
import { SpeedLimitsSheet, type SentLimits, type SpeedLimitsChange } from './SpeedLimitsSheet'
import { useTorrentSheet } from './useTorrentSheet'

export interface SpeedLimits {
  /** Opens "Speed limits" for a torrent in `torrents`. */
  open: (hash: string) => void
  /** The sheet and the toast for a save that failed after it was closed, for the screen to render. */
  element: ReactNode
}

/**
 * "Speed limits" for a screen, in the shape of `useMoveTorrent`: the sheet for one of its torrents,
 * and the save itself, which outlives the sheet. A sheet for that torrent, the one that sent the save
 * or one opened again since, shows it in flight, closes when it's saved and says when it failed; with
 * no such sheet, a failure is a toast on the screen.
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
  const { torrent, open: openSheet, close, showing } = useTorrentSheet(torrents)
  const [savingFor, setSavingFor] = useState<string | null>(null)
  // The fields the last failed save sent, for the torrent whose sheet shows it.
  const [failure, setFailure] = useState<{ hash: string; sent: SentLimits } | null>(null)
  // The title of a torrent whose save failed after its sheet was closed.
  const [failedFor, setFailedFor] = useState<string | null>(null)

  const open = useCallback(
    (hash: string) => {
      openSheet(hash)
      setFailure(null)
    },
    [openSheet],
  )
  const dismiss = useCallback(() => setFailedFor(null), [])

  const save = async (target: Torrent, limits: SpeedLimitsChange) => {
    setSavingFor(target.hash)
    setFailure(null)
    try {
      await setSpeedLimits([target.hash], limits)
      if (showing(target)) close()
    } catch {
      const sent = { download: limits.download !== undefined, upload: limits.upload !== undefined }
      if (showing(target)) setFailure({ hash: target.hash, sent })
      else setFailedFor(titleOf(target))
    } finally {
      // Either way, show what qBittorrent took: after a failure one of the two may have gone through.
      refresh()
      // Another torrent's save may have started meanwhile, and is still being sent.
      setSavingFor((current) => (current === target.hash ? null : current))
    }
  }

  const element = (
    <>
      {torrent && (
        <SpeedLimitsSheet
          key={torrent.hash}
          torrent={torrent}
          title={titleOf(torrent)}
          offline={offline}
          saving={savingFor === torrent.hash}
          failure={failure?.hash === torrent.hash ? failure.sent : undefined}
          onSave={(limits) => void save(torrent, limits)}
          onClose={close}
        />
      )}
      {failedFor !== null && (
        <Toast icon="alert" message={t('limits.failedClosed', { title: failedFor })} onDismiss={dismiss} />
      )}
    </>
  )
  return { open, element }
}
