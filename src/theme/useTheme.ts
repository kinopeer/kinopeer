import { useSyncExternalStore } from 'react'
import { getThemePreference, setThemePreference, subscribeThemePreference } from './theme'

export function useTheme() {
  const preference = useSyncExternalStore(subscribeThemePreference, getThemePreference)
  return { preference, setPreference: setThemePreference }
}
