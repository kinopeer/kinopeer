import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import type { IconName } from '../components/Icon'
import { IconButton } from '../components/IconButton'
import { LANGUAGES } from '../i18n'
import type { ThemePreference } from '../theme/theme'
import { useTheme } from '../theme/useTheme'

const THEME_OPTIONS: { value: ThemePreference; icon: IconName }[] = [
  { value: 'system', icon: 'monitor' },
  { value: 'dark', icon: 'moon' },
  { value: 'light', icon: 'sun' },
]

/** Temporary theme and language switchers until the Settings screen exists. */
export function Preferences() {
  const { t, i18n } = useTranslation()
  const { preference, setPreference } = useTheme()

  return (
    <div className="screen-controls">
      <div className="screen-group" role="group" aria-label={t('theme.label')}>
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
      <div className="screen-group" role="group" aria-label={t('language.label')}>
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
  )
}
