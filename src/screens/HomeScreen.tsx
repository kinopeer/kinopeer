import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { Preferences } from './Preferences'

export interface HomeScreenProps {
  version: string
  onSignOut: () => void
}

/** Placeholder until the downloads list lands. */
export function HomeScreen({ version, onSignOut }: HomeScreenProps) {
  const { t } = useTranslation()

  return (
    <main className="screen home">
      <h1 className="t-display">
        kino<span className="wordmark-accent">seed</span>
      </h1>
      <p className="t-body-lg c2">{t('app.tagline')}</p>
      <p className="t-label ca ks-num">{t('home.connected', { version })}</p>
      <Button variant="secondary" size="sm" onClick={onSignOut}>
        {t('home.signOut')}
      </Button>
      <Preferences />
    </main>
  )
}
