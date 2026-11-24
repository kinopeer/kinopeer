import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Torrent } from '../api/qbittorrent'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Checkbox } from '../components/Checkbox'
import { Dialog } from '../components/Dialog'
import { qbtFailedText } from '../lib/unreachable'
import { useFormatters } from '../lib/format'
import './DeleteTorrentDialog.css'

export interface DeleteTorrentDialogProps {
  torrents: Pick<Torrent, 'hash' | 'size' | 'progress'>[]
  /** What a single torrent is called on screen: the TMDB title or the release name. */
  title?: string
  /** A delete for one of the torrents is on its way, sent from here or elsewhere. */
  busy: boolean
  /** The last delete failed while this showed the torrents, and why. */
  failure?: { error: unknown }
  /** The files are deleted too, without asking: the dialog says so in place of the checkbox. */
  withFiles?: boolean
  onConfirm: (withFiles: boolean) => void
  onClose: () => void
}

/**
 * Confirms deleting one torrent or several; render it while confirming, so it opens with "keep the
 * files" each time. The files are deleted too only when the user checks the box. `useDeleteTorrents`
 * renders it and sends the delete.
 */
export function DeleteTorrentDialog({
  torrents,
  title,
  busy,
  failure,
  withFiles: filesAlways = false,
  onConfirm,
  onClose,
}: DeleteTorrentDialogProps) {
  const { t } = useTranslation()
  const format = useFormatters()
  const id = useId()
  const [chosen, setWithFiles] = useState(false)
  const withFiles = filesAlways || chosen

  const many = torrents.length > 1
  const downloaded = torrents.reduce((sum, torrent) => sum + torrent.size * torrent.progress, 0)
  const filesLabel = t('torrent.deleteFiles', { size: format.size(downloaded) })

  return (
    <Dialog
      open
      onClose={onClose}
      title={many ? t('torrent.deleteTitleMany') : t('torrent.deleteTitle')}
      icon="trash"
      tone="danger"
      actions={
        <>
          <Button variant="secondary" block onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" block loading={busy} disabled={busy} onClick={() => onConfirm(withFiles)}>
            {t('torrent.delete')}
          </Button>
        </>
      }
    >
      <p className="t-body c2">
        {many ? t('torrent.deleteBodyMany', { count: torrents.length }) : t('torrent.deleteBody', { title })}
      </p>
      {filesAlways ? (
        <div className="delete-files-always">
          <p className="t-label">{t('torrent.deleteWithFiles', { size: format.size(downloaded) })}</p>
          <p className="t-cap c-err delete-hint">{t('torrent.deleteFilesHint')}</p>
        </div>
      ) : (
        <div className="delete-files">
          <Checkbox
            id={`${id}-files`}
            checked={withFiles}
            onChange={setWithFiles}
            label={filesLabel}
            aria-describedby={withFiles ? `${id}-hint` : undefined}
          />
          <div className="delete-files-text">
            <label htmlFor={`${id}-files`} className="t-label">
              {filesLabel}
            </label>
            {withFiles && (
              <div id={`${id}-hint`} className="t-cap c-err delete-hint">
                {t('torrent.deleteFilesHint')}
              </div>
            )}
          </div>
        </div>
      )}
      {failure && <Banner tone="error">{qbtFailedText(t, failure.error)}</Banner>}
    </Dialog>
  )
}
