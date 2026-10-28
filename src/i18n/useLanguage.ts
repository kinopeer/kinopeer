import { useSyncExternalStore } from 'react'
import { getLanguagePreference, setLanguagePreference, subscribeLanguagePreference } from './language'

export function useLanguage() {
  const preference = useSyncExternalStore(subscribeLanguagePreference, getLanguagePreference)
  return { preference, setPreference: setLanguagePreference }
}
