import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { turnOffAlternativeWebui } from '../api/qbittorrent/webui'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'
import { qbtFailedText } from '../lib/unreachable'

/** Where qBittorrent serves its interface, and served Kinopeer's page (README: at the root of a name). */
export const QBITTORRENT_ROOT = '/'

export interface QbittorrentInterfaceDialogProps {
  onClose: () => void
  /** Where the page goes once Kinopeer is off; the window's own but in a test. */
  location?: Pick<Location, 'replace'>
}

/**
 * The WebUI build's way back to qBittorrent's own interface: says what switching changes (a setting
 * of qBittorrent's, so every device) and how to come back, then turns Kinopeer off in qBittorrent
 * and loads its root, where qBittorrent now answers with its own interface (the service worker steps
 * aside: webui.md → Shipping it). The address is replaced, so Back doesn't return to it.
 */
export function QbittorrentInterfaceDialog({ onClose, location = window.location }: QbittorrentInterfaceDialogProps) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<{ error: unknown }>()

  // Switch is disabled while it's on its way, so a second tap sends nothing.
  const confirm = async () => {
    setBusy(true)
    setFailure(undefined)
    try {
      await turnOffAlternativeWebui()
    } catch (error) {
      setFailure({ error })
      setBusy(false)
      return
    }
    // Still busy: the page is leaving.
    location.replace(QBITTORRENT_ROOT)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('webui.switchInterfaceTitle')}
      icon="server"
      actions={
        <>
          <Button variant="secondary" block onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" block loading={busy} disabled={busy} onClick={() => void confirm()}>
            {t('webui.switchInterfaceConfirm')}
          </Button>
        </>
      }
    >
      <p className="t-body c2">{t('webui.switchInterfaceBody')}</p>
      <p className="t-body c2">{t('webui.switchInterfaceBack')}</p>
      {failure && <Banner tone="error">{qbtFailedText(t, failure.error)}</Banner>}
    </Dialog>
  )
}
