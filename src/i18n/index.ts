import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { getLanguagePreference, LANGUAGES, resolveLanguage, watchSystemLanguage } from './language'
import en from './locales/en.json'
import ru from './locales/ru.json'

export { LANGUAGES, LANGUAGE_STORAGE_KEY, type Language, type LanguagePreference } from './language'

export const resources = {
  en: { translation: en },
  ru: { translation: ru },
} as const

function syncDocumentLanguage(lng: string) {
  document.documentElement.lang = lng
}

i18n.on('languageChanged', syncDocumentLanguage)

void i18n.use(initReactI18next).init({
  resources,
  lng: resolveLanguage(getLanguagePreference()),
  supportedLngs: LANGUAGES.map((l) => l.code),
  fallbackLng: 'en',
  nonExplicitSupportedLngs: true,
  load: 'languageOnly',
  interpolation: { escapeValue: false },
})

watchSystemLanguage()

export default i18n
