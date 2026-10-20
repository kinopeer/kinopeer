import { useEffect, useState } from 'react'
import {
  applyTheme,
  readThemePreference,
  resolveTheme,
  systemPrefersLight,
  watchSystemTheme,
  writeThemePreference,
  type ThemePreference,
} from './theme'

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference)
  const [prefersLight, setPrefersLight] = useState(systemPrefersLight)

  useEffect(() => watchSystemTheme(setPrefersLight), [])

  const theme = resolveTheme(preference, prefersLight)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const changePreference = (next: ThemePreference) => {
    writeThemePreference(next)
    setPreference(next)
  }

  return { preference, theme, setPreference: changePreference }
}
