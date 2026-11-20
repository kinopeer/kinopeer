import { vi } from 'vitest'
import i18n from '../i18n'
import en from '../i18n/locales/en.json'
import ru from '../i18n/locales/ru.json'
import { onLanguageUnavailable } from '../i18n/language'

/** Both languages' texts, as a test starts with them; the app loads each when it shows it (src/i18n/language.ts). */
export function giveBothLanguages(): void {
  vi.doUnmock('../i18n/locales/ru.json')
  if (!i18n.hasResourceBundle('en', 'translation')) i18n.addResourceBundle('en', 'translation', en)
  if (!i18n.hasResourceBundle('ru', 'translation')) i18n.addResourceBundle('ru', 'translation', ru)
  onLanguageUnavailable(() => {})
}

/** The page without a language's texts, as it starts: it has loaded none. */
export const withoutTexts = (language: 'en' | 'ru') => i18n.removeResourceBundle(language, 'translation')

/**
 * Every load of Russian's texts fails from now on, as on a page an update left behind (the new
 * build's precache dropped the old file) or offline without the service worker.
 */
export function failRussianLoads(): void {
  vi.doMock('../i18n/locales/ru.json', () => {
    throw new TypeError('Failed to fetch dynamically imported module')
  })
}

/** The page without Russian's texts, which it can't load. */
export function russianUnreachable(): void {
  withoutTexts('ru')
  failRussianLoads()
}
