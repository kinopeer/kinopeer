import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { startTorrents, stopTorrents } from '../api/qbittorrent'
import { Button } from '../components/Button'
import { useToast } from '../components/Toast'

export interface BulkActionsBarProps {
  /** The selected torrents. */
  hashes: string[]
  /** Accessible name of the toolbar, such as "2 selected". */
  label: string
  /** qBittorrent is unreachable: every action is disabled. */
  offline: boolean
  /** After pausing or resuming. */
  onDone: () => void
  /** Asks to confirm deleting the selected torrents. */
  onDelete: () => void
}

/** Pause, Resume and Delete for the selected downloads, in place of the tab bar. */
export function BulkActionsBar({ hashes, label, offline, onDone, onDelete }: BulkActionsBarProps) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<'pause' | 'resume' | null>(null)
  const toast = useToast()
  const disabled = hashes.length === 0 || offline || busy !== null

  const run = async (action: 'pause' | 'resume') => {
    setBusy(action)
    try {
      await (action === 'pause' ? stopTorrents(hashes) : startTorrents(hashes))
      onDone()
    } catch {
      toast(t('torrent.actionFailed'), { icon: 'alert' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="ks-tabbar downloads-bulk" role="toolbar" aria-label={label}>
      <Button
        variant="secondary"
        icon="pause"
        block
        loading={busy === 'pause'}
        disabled={disabled}
        onClick={() => void run('pause')}
      >
        {t('torrent.pause')}
      </Button>
      <Button
        variant="secondary"
        icon="play"
        block
        loading={busy === 'resume'}
        disabled={disabled}
        onClick={() => void run('resume')}
      >
        {t('torrent.resume')}
      </Button>
      <Button variant="danger" icon="trash" block disabled={disabled} onClick={onDelete}>
        {t('torrent.delete')}
      </Button>
    </div>
  )
}
