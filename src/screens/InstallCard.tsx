import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { IconButton } from '../components/IconButton'
import {
  dismissInstallCard,
  isInstallCardDismissed,
  promptInstall,
  useInstallMethod,
  type ManualInstall,
} from '../pwa/install'
import { InstallSheet } from './InstallSheet'
import './Install.css'

/**
 * Offers to install Kinoseed at the top of Downloads until the user installs it or closes the card.
 * Chromium shows its own prompt; in Safari the card explains the Share menu steps.
 */
export function InstallCard() {
  const { t } = useTranslation()
  const method = useInstallMethod()
  const [dismissed, setDismissed] = useState(isInstallCardDismissed)
  const [steps, setSteps] = useState<ManualInstall | null>(null)

  if (dismissed) return null

  return (
    <>
      {method && (
        <section className="ks-card install-card" aria-labelledby="install-card-title">
          <img className="install-icon" src="/icons/icon-192.png" alt="" width={48} height={48} />
          <div className="install-card-text">
            <h2 id="install-card-title" className="t-label install-card-title">
              {t('install.title')}
            </h2>
            <p className="t-cap c2">{t('install.body')}</p>
            <div className="install-card-actions">
              <Button size="sm" onClick={() => (method === 'prompt' ? void promptInstall() : setSteps(method))}>
                {t('install.action')}
              </Button>
              {method !== 'ios' && (
                <Button variant="ghost" size="sm" onClick={() => setSteps('ios')}>
                  {t('install.iosHow')}
                </Button>
              )}
            </div>
          </div>
          <IconButton
            icon="close"
            label={t('install.dismiss')}
            iconSize={18}
            className="install-card-close"
            onClick={() => {
              dismissInstallCard()
              setDismissed(true)
            }}
          />
        </section>
      )}
      <InstallSheet platform={steps} onClose={() => setSteps(null)} />
    </>
  )
}
