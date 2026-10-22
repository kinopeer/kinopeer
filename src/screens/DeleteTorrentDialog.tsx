import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteTorrents, type Torrent } from '../api/qbittorrent'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Checkbox } from '../components/Checkbox'
import { Dialog } from '../components/Dialog'
import { useFormatters } from '../lib/format'
import './DeleteTorrentDialog.css'

export interface DeleteTorrentDialogProps {
  torrent: Pick<Torrent, 'hash' | 'size' | 'progress'>
  /** What the torrent is called on screen: the TMDB title or the release name. */
  title: string
  onClose: () => void
  /** After qBittorrent removed it. */
  onDeleted: (withFiles: boolean) => void
}

/**
 * Confirms deleting a torrent; render it while confirming, so it opens with "keep the files" each
 * time. The files are deleted too only when the user checks the box.
 */
export function DeleteTorrentDialog({ torrent, title, onClose, onDeleted }: DeleteTorrentDialogProps) {
  const { t } = useTranslation()
  const format = useFormatters()
  const id = useId()
  const [withFiles, setWithFiles] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [failed, setFailed] = useState(false)

  const confirm = async () => {
    setDeleting(true)
    setFailed(false)
    try {
      await deleteTorrents([torrent.hash], withFiles)
      onDeleted(withFiles)
    } catch {
      setFailed(true)
    } finally {
      setDeleting(false)
    }
  }

  const filesLabel = t('torrent.deleteFiles', { size: format.size(torrent.size * torrent.progress) })

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('torrent.deleteTitle')}
      icon="trash"
      tone="danger"
      actions={
        <>
          <Button variant="secondary" block onClick={onClose}>
            {t('torrent.cancel')}
          </Button>
          <Button variant="danger" block loading={deleting} disabled={deleting} onClick={confirm}>
            {t('torrent.delete')}
          </Button>
        </>
      }
    >
      <p className="t-body c2 delete-body">{t('torrent.deleteBody', { title })}</p>
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
            <div id={`${id}-hint`} className="c-err delete-hint">
              {t('torrent.deleteFilesHint')}
            </div>
          )}
        </div>
      </div>
      {failed && <Banner tone="error">{t('torrent.actionFailed')}</Banner>}
    </Dialog>
  )
}
