import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { TmdbKeyForm } from './TmdbKeyForm'

export interface TmdbKeyScreenProps {
  onDone: () => void
  /** Go on without a key: downloads work, search and titles ask for it again. */
  onSkip: () => void
}

/** Onboarding step after qBittorrent: the TMDB key, kept by the server. */
export function TmdbKeyScreen({ onDone, onSkip }: TmdbKeyScreenProps) {
  const { t } = useTranslation()

  return (
    <main className="screen connect">
      <div className="connect-form">
        <div className="connect-intro">
          <h1 className="t-h1">{t('tmdbKey.title')}</h1>
          <p className="t-body c2">{t('tmdbKey.body')}</p>
        </div>
        <TmdbKeyForm
          onSaved={onDone}
          secondary={
            <Button variant="ghost" size="lg" block onClick={onSkip}>
              {t('tmdbKey.skip')}
            </Button>
          }
        />
      </div>
    </main>
  )
}
