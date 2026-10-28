import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { recheckTorrents } from '../api/qbittorrent'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'

export interface RecheckDialogProps {
  hash: string
  /** What the torrent is called on screen: the TMDB title or the release name. */
  title: string
  onClose: () => void
  /** After qBittorrent started the check. */
  onRechecked: () => void
}

/**
 * Confirms a forced recheck: qBittorrent reads all the downloaded data again, the torrent shows as
 * checking until it's done, and pieces that fail the check are downloaded again.
 */
export function RecheckDialog({ hash, title, onClose, onRechecked }: RecheckDialogProps) {
  const { t } = useTranslation()
  const [checking, setChecking] = useState(false)
  const [failed, setFailed] = useState(false)

  const confirm = async () => {
    setChecking(true)
    setFailed(false)
    try {
      await recheckTorrents([hash])
      onRechecked()
    } catch {
      setFailed(true)
      setChecking(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('torrent.recheckTitle')}
      icon="check-circle"
      actions={
        <>
          <Button variant="secondary" block onClick={onClose}>
            {t('torrent.cancel')}
          </Button>
          <Button variant="primary" block loading={checking} disabled={checking} onClick={confirm}>
            {t('torrent.recheck')}
          </Button>
        </>
      }
    >
      <p className="t-body c2">{t('torrent.recheckBody', { title })}</p>
      {failed && <Banner tone="error">{t('torrent.actionFailed')}</Banner>}
    </Dialog>
  )
}
