import { useTranslation } from 'react-i18next'
import { Button } from './components/Button'
import { IconButton } from './components/IconButton'
import type { IconName } from './components/Icon'
import { LANGUAGES } from './i18n'
import { useTheme } from './theme/useTheme'
import type { ThemePreference } from './theme/theme'
import './App.css'

const THEME_OPTIONS: { value: ThemePreference; icon: IconName }[] = [
  { value: 'system', icon: 'monitor' },
  { value: 'dark', icon: 'moon' },
  { value: 'light', icon: 'sun' },
]

function App() {
  const { t, i18n } = useTranslation()
  const { preference, setPreference } = useTheme()

  return (
    <main className="app">
      <h1 className="t-display">
        kino<span className="app-wordmark-accent">seed</span>
      </h1>
      <p className="t-body-lg c2">{t('app.tagline')}</p>
      <div className="app-controls">
        <div className="app-group" role="group" aria-label={t('theme.label')}>
          {THEME_OPTIONS.map((option) => (
            <IconButton
              key={option.value}
              icon={option.icon}
              label={t(`theme.${option.value}`)}
              active={preference === option.value}
              onClick={() => setPreference(option.value)}
            />
          ))}
        </div>
        <div className="app-group" role="group" aria-label={t('language.label')}>
          {LANGUAGES.map((language) => (
            <Button
              key={language.code}
              variant={i18n.resolvedLanguage === language.code ? 'tonal' : 'ghost'}
              size="sm"
              lang={language.code}
              aria-pressed={i18n.resolvedLanguage === language.code}
              onClick={() => void i18n.changeLanguage(language.code)}
            >
              {language.name}
            </Button>
          ))}
        </div>
      </div>
    </main>
  )
}

export default App
