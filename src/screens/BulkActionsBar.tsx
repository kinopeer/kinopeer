import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Torrent } from '../api/qbittorrent'
import { Button } from '../components/Button'
import { usePauseResume } from './usePauseResume'

export interface BulkActionsBarProps {
  /** The selected torrents. */
  torrents: Torrent[]
  /** Accessible name of the toolbar, such as "2 selected". */
  label: string
  /** qBittorrent is unreachable: every action is disabled. */
  offline: boolean
  /** After qBittorrent took a pause or resume. */
  onDone: () => void
  /** Asks to confirm deleting the selected torrents. */
  onDelete: () => void
}

/**
 * Pause, Resume and Delete for the selected downloads, in place of the tab bar. Pause and Resume send
 * one request for every selected torrent without a pause or resume in flight, which each shows busy.
 */
export function BulkActionsBar({ torrents, label, offline, onDone, onDelete }: BulkActionsBarProps) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<'pause' | 'resume' | null>(null)
  const pauseResume = usePauseResume()
  const disabled = torrents.length === 0 || offline || busy !== null

  const run = async (action: 'pause' | 'resume') => {
    setBusy(action)
    const settled = await pauseResume.set(torrents, action === 'resume')
    setBusy(null)
    if (settled?.ok) onDone()
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
