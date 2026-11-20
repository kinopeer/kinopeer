import { useCallback, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../components/Toast'
import { getLanguagePreference, setLanguagePreference, subscribeLanguagePreference, type LanguagePreference } from './language'

/** The toast of a language that couldn't be loaded, taken back once a choice is shown. */
const UNAVAILABLE_TOAST = 'language-unavailable'

/**
 * The language preference and its setter for the places that switch it. A choice whose texts can't be
 * loaded (offline, or a page an update left behind that doesn't reload) says so in a toast, in the
 * language still shown.
 */
export function useLanguage() {
  const preference = useSyncExternalStore(subscribeLanguagePreference, getLanguagePreference)
  const { t } = useTranslation()
  const toast = useToast()
  const setPreference = useCallback(
    async (next: LanguagePreference) => {
      if (await setLanguagePreference(next)) toast.dismiss(UNAVAILABLE_TOAST)
      else toast.show(t('language.unavailable'), { icon: 'alert', key: UNAVAILABLE_TOAST })
    },
    [t, toast],
  )
  return { preference, setPreference }
}
