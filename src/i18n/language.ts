import i18n from 'i18next'

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'ru', name: 'Русский' },
] as const

export type Language = (typeof LANGUAGES)[number]['code']
export type LanguagePreference = 'system' | Language

export const LANGUAGE_STORAGE_KEY = 'kinopeer.language'

/**
 * Each language's texts, a chunk of their own (vite.config.ts names them `language-*`), so a page
 * loads only the language it shows (#492). The service worker precaches them with the rest of the
 * build, so a page opens in either language without the network.
 */
const TEXTS: Record<Language, () => Promise<{ default: object }>> = {
  en: () => import('./locales/en.json'),
  ru: () => import('./locales/ru.json'),
}

/** The language the page was last asked to show: a load that finishes after another was asked for shows nothing. */
let wanted: Language | undefined
let onUnavailable: () => void = () => {}

/**
 * What to do when a language's texts can't be loaded. main.tsx checks for a newer build: an update
 * the page missed removes the old build's files, and the new build has its own.
 */
export function onLanguageUnavailable(handler: () => void): void {
  onUnavailable = handler
}

/**
 * Shows the page in `language` once its texts are loaded, each language's once per page. When they
 * can't be loaded, the page keeps the language it shows (at startup, none: the keys) and the
 * `onLanguageUnavailable` handler is called. A later call wins over one still loading.
 */
export async function showLanguage(language: Language): Promise<void> {
  wanted = language
  if (!i18n.hasResourceBundle(language, 'translation')) {
    try {
      const { default: texts } = await TEXTS[language]()
      i18n.addResourceBundle(language, 'translation', texts)
    } catch {
      if (wanted === language) onUnavailable()
      return
    }
  }
  // Also when it's the language already set: i18next picks the resolved language, and React renders
  // the texts, only on a change.
  if (wanted === language) await i18n.changeLanguage(language)
}

/** The app's language for a tag by its base language ('ru-RU' → 'ru'), or null if the app doesn't have it. */
export function toLanguage(tag: string): Language | null {
  const base = tag.toLowerCase().split('-')[0]
  return LANGUAGES.find((language) => language.code === base)?.code ?? null
}

/** The saved preference, else system. */
export function readLanguagePreference(): LanguagePreference {
  try {
    const value = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (value === 'system' || LANGUAGES.some((language) => language.code === value)) return value as LanguagePreference
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
  }
  return 'system'
}

export function writeLanguagePreference(preference: LanguagePreference): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, preference)
  } catch {
    // Not persisted; the choice still applies for this session.
  }
}

function browserLanguages(): readonly string[] {
  if (navigator.languages?.length) return navigator.languages
  return navigator.language ? [navigator.language] : []
}

/** The first of the browser's preferred languages the app has, else English. */
export function systemLanguage(languages: readonly string[] = browserLanguages()): Language {
  for (const tag of languages) {
    const language = toLanguage(tag)
    if (language) return language
  }
  return 'en'
}

export function resolveLanguage(preference: LanguagePreference, languages?: readonly string[]): Language {
  return preference === 'system' ? systemLanguage(languages) : preference
}

// The preference is shared by the whole page, so every screen that shows it stays in sync.
let preference: LanguagePreference | undefined
const listeners = new Set<() => void>()

export function getLanguagePreference(): LanguagePreference {
  preference ??= readLanguagePreference()
  return preference
}

export function subscribeLanguagePreference(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setLanguagePreference(next: LanguagePreference): void {
  writeLanguagePreference(next)
  preference = next
  void showLanguage(resolveLanguage(next))
  listeners.forEach((listener) => listener())
}

/** Forgets the preference read from storage, so the next read starts over, and the language asked for. For tests. */
export function resetLanguagePreference(): void {
  preference = undefined
  wanted = undefined
}

/**
 * Calls onChange with the browser's language whenever the browser's languages change (the
 * `languagechange` event). Returns a function that stops it.
 */
export function watchSystemLanguage(onChange: (language: Language) => void): () => void {
  const listener = () => onChange(systemLanguage())
  window.addEventListener('languagechange', listener)
  return () => window.removeEventListener('languagechange', listener)
}

/**
 * Follows the browser's languages for as long as the page is open, while the preference is system,
 * and a preference changed in another tab. Called once at startup; returns a function that stops it.
 */
export function initLanguage(): () => void {
  const apply = () => void showLanguage(resolveLanguage(getLanguagePreference()))
  const stopWatching = watchSystemLanguage(apply)
  // A choice made in another tab: read it again (null is storage cleared).
  const onStorage = (event: StorageEvent) => {
    if (event.key !== LANGUAGE_STORAGE_KEY && event.key !== null) return
    preference = undefined
    apply()
    listeners.forEach((listener) => listener())
  }
  window.addEventListener('storage', onStorage)
  return () => {
    stopWatching()
    window.removeEventListener('storage', onStorage)
  }
}
