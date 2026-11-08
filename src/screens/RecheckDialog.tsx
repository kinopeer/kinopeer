import { useTranslation } from 'react-i18next'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'

export interface RecheckDialogProps {
  /** What the torrent is called on screen: the TMDB title or the release name. */
  title: string
  /** A recheck for the torrent is on its way, sent from here or elsewhere. */
  busy: boolean
  /** The last recheck failed while this showed the torrent. */
  failed: boolean
  onConfirm: () => void
  onClose: () => void
}

/**
 * Confirms a forced recheck: qBittorrent reads all the downloaded data again, the torrent shows as
 * checking until it's done, and pieces that fail the check are downloaded again. `useRecheck` renders
 * it and sends the recheck.
 */
export function RecheckDialog({ title, busy, failed, onConfirm, onClose }: RecheckDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('torrent.recheckTitle')}
      icon="check-circle"
      actions={
        <>
          <Button variant="secondary" block onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" block loading={busy} disabled={busy} onClick={onConfirm}>
            {t('torrent.recheck')}
          </Button>
        </>
      }
    >
      <p className="t-body c2">{t('torrent.recheckBody', { title })}</p>
      {failed && <Banner tone="error">{t('common.qbtFailed')}</Banner>}
    </Dialog>
  )
}
