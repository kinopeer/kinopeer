import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { ProwlarrKeyForm } from './ProwlarrKeyForm'
import './ConnectScreen.css'

export interface ProwlarrSetupScreenProps {
  onDone: () => void
  /** Go on without Prowlarr: everything but finding releases works, and their screen says what's missing. */
  onSkip: () => void
}

/** Onboarding step after qBittorrent (and the TMDB key): Prowlarr's address and key, kept by the server. */
export function ProwlarrSetupScreen({ onDone, onSkip }: ProwlarrSetupScreenProps) {
  const { t } = useTranslation()

  return (
    <main className="screen connect">
      <div className="connect-form">
        <div className="connect-intro">
          <h1 className="t-h1">{t('prowlarrSetup.title')}</h1>
          <p className="t-body c2">{t('prowlarrSetup.body')}</p>
        </div>
        <ProwlarrKeyForm
          askAddress
          onSaved={onDone}
          secondary={
            <Button variant="ghost" size="lg" block onClick={onSkip}>
              {t('common.skipForNow')}
            </Button>
          }
        />
      </div>
    </main>
  )
}
