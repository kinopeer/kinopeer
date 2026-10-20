import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import ru from './locales/ru.json'

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'ru', name: 'Русский' },
] as const

export type Language = (typeof LANGUAGES)[number]['code']

export const LANGUAGE_STORAGE_KEY = 'kinoseed.lang'

export const resources = {
  en: { translation: en },
  ru: { translation: ru },
} as const

function syncDocumentLanguage(lng: string) {
  document.documentElement.lang = lng
}

i18n.on('languageChanged', syncDocumentLanguage)

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    supportedLngs: LANGUAGES.map((l) => l.code),
    fallbackLng: 'en',
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
  })

export default i18n
