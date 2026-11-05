import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { Icon, type IconName } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import type { ManualInstall } from '../pwa/install'
import './Install.css'

const STEPS: { key: 'share' | 'add' | 'confirm'; icon: IconName }[] = [
  { key: 'share', icon: 'share' },
  { key: 'add', icon: 'plus-square' },
  { key: 'confirm', icon: 'check' },
]

export interface InstallSheetProps {
  /** Whose steps to show; null closes the sheet. */
  platform: ManualInstall | null
  onClose: () => void
}

/**
 * How to install Kinopeer from Safari's Share menu: to the Home Screen on iPhone and iPad, to the
 * Dock on a Mac. Safari has no install prompt.
 */
export function InstallSheet({ platform, onClose }: InstallSheetProps) {
  const { t } = useTranslation()
  // Keeps the text while the sheet closes.
  const steps = platform ?? 'ios'
  return (
    <Sheet
      open={platform !== null}
      onClose={onClose}
      title={t(`install.${steps}.title`)}
      subtitle={t(`install.${steps}.subtitle`)}
      leading={<img className="install-icon install-sheet-icon" src="/icons/icon-192.png" alt="" width={48} height={48} />}
      footer={
        <Button block onClick={onClose}>
          {t('install.gotIt')}
        </Button>
      }
    >
      <ol className="install-steps">
        {STEPS.map(({ key, icon }, index) => (
          <li key={key}>
            <span className="t-cap install-step-n ks-num" aria-hidden="true">
              {index + 1}
            </span>
            <span className="t-body install-step-text">{t(`install.${steps}.${key}`)}</span>
            <span className="install-step-icon">
              <Icon name={icon} strokeWidth={key === 'confirm' ? 2.4 : undefined} />
            </span>
          </li>
        ))}
      </ol>
    </Sheet>
  )
}
