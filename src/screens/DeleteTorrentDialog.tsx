import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteTorrents, type Torrent } from '../api/qbittorrent'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Checkbox } from '../components/Checkbox'
import { Dialog } from '../components/Dialog'
import { useFormatters } from '../lib/format'
import { forgetMatches } from '../torrents/serverMatches'
import './DeleteTorrentDialog.css'

export interface DeleteTorrentDialogProps {
  torrents: Pick<Torrent, 'hash' | 'size' | 'progress'>[]
  /** What a single torrent is called on screen: the TMDB title or the release name. */
  title?: string
  onClose: () => void
  /** After qBittorrent removed it. */
  onDeleted: (withFiles: boolean) => void
}

/**
 * Confirms deleting one torrent or several; render it while confirming, so it opens with "keep the
 * files" each time. The files are deleted too only when the user checks the box.
 */
export function DeleteTorrentDialog({ torrents, title, onClose, onDeleted }: DeleteTorrentDialogProps) {
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
      const hashes = torrents.map((torrent) => torrent.hash)
      await deleteTorrents(hashes, withFiles)
      void forgetMatches(hashes)
      onDeleted(withFiles)
    } catch {
      setFailed(true)
    } finally {
      setDeleting(false)
    }
  }

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
            {t('torrent.cancel')}
          </Button>
          <Button variant="danger" block loading={deleting} disabled={deleting} onClick={confirm}>
            {t('torrent.delete')}
          </Button>
        </>
      }
    >
      <p className="t-body c2 delete-body">
        {many ? t('torrent.deleteBodyMany', { count: torrents.length }) : t('torrent.deleteBody', { title })}
      </p>
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
      {failed && <Banner tone="error">{t('torrent.actionFailed')}</Banner>}
    </Dialog>
  )
}
