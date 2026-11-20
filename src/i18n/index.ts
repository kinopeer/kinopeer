import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { getLanguagePreference, LANGUAGES, resolveLanguage } from './language'

export { LANGUAGES, LANGUAGE_STORAGE_KEY, type Language, type LanguagePreference } from './language'

function syncDocumentLanguage(lng: string) {
  document.documentElement.lang = lng
}

i18n.on('languageChanged', syncDocumentLanguage)

// No texts yet: each language's are loaded when the page shows it (`showLanguage` in ./language,
// which main.tsx waits for before the first render).
void i18n.use(initReactI18next).init({
  lng: resolveLanguage(getLanguagePreference()),
  supportedLngs: LANGUAGES.map((l) => l.code),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18n
