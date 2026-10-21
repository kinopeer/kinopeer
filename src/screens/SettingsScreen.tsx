import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { Preferences } from './Preferences'
import './SettingsScreen.css'

export interface SettingsScreenProps {
  version: string
  onSignOut: () => void
}

/** Minimal settings until the full screen from the design (roadmap step 6). */
export function SettingsScreen({ version, onSignOut }: SettingsScreenProps) {
  const { t } = useTranslation()

  return (
    <main className="settings">
      <h1 className="t-h1 settings-title">{t('settings.title')}</h1>

      <section className="settings-section" aria-labelledby="settings-appearance">
        <h2 id="settings-appearance" className="t-micro c3">
          {t('settings.appearance')}
        </h2>
        <Preferences />
      </section>

      <section className="settings-section" aria-labelledby="settings-connection">
        <h2 id="settings-connection" className="t-micro c3">
          {t('settings.connection')}
        </h2>
        <p className="t-body ks-num">{t('settings.connected', { version })}</p>
        <div>
          <Button variant="secondary" size="sm" onClick={onSignOut}>
            {t('settings.signOut')}
          </Button>
        </div>
      </section>
    </main>
  )
}
