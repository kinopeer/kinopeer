import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import type { IconName } from '../components/Icon'
import { IconButton } from '../components/IconButton'
import { LANGUAGES } from '../i18n'
import { useLanguage } from '../i18n/useLanguage'
import type { ThemePreference } from '../theme/theme'
import { useTheme } from '../theme/useTheme'

const THEME_OPTIONS: { value: ThemePreference; icon: IconName }[] = [
  { value: 'system', icon: 'monitor' },
  { value: 'dark', icon: 'moon' },
  { value: 'light', icon: 'sun' },
]

/** Temporary theme and language switchers until the Settings screen exists. */
export function Preferences() {
  const { t } = useTranslation()
  const { preference, setPreference } = useTheme()
  const language = useLanguage()

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
        {LANGUAGES.map(({ code, name }) => (
          <Button
            key={code}
            variant={language.preference === code ? 'tonal' : 'ghost'}
            size="sm"
            lang={code}
            // Neither is pressed while the language follows the browser (System, chosen in Settings),
            // so tapping either one, the language shown included, is a choice that pins it.
            aria-pressed={language.preference === code}
            onClick={() => language.setPreference(code)}
          >
            {name}
          </Button>
        ))}
      </div>
    </div>
  )
}
