import i18n from 'i18next'

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'ru', name: 'Русский' },
] as const

export type Language = (typeof LANGUAGES)[number]['code']
export type LanguagePreference = 'system' | Language

export const LANGUAGE_STORAGE_KEY = 'kinoseed.language'

/**
 * Where the language detector before the System option saved the detected language on every start,
 * so a value there can't tell a language the user picked from one that was detected.
 */
export const LEGACY_LANGUAGE_STORAGE_KEY = 'kinoseed.lang'

/** The app's language for a tag by its base language ('ru-RU' → 'ru'), or null if the app doesn't have it. */
export function toLanguage(tag: string): Language | null {
  const base = tag.toLowerCase().split('-')[0]
  return LANGUAGES.find((language) => language.code === base)?.code ?? null
}

/**
 * Moves a language saved before the System option to the preference, once: the browser's own
 * language becomes system, since keeping it changes nothing the user sees, and another language
 * stays, since only a pick could have saved it. Null when there's nothing to move.
 */
function migrateLegacyPreference(): LanguagePreference | null {
  const legacy = localStorage.getItem(LEGACY_LANGUAGE_STORAGE_KEY)
  if (legacy === null) return null
  const language = toLanguage(legacy)
  const preference = language && language !== systemLanguage() ? language : 'system'
  localStorage.setItem(LANGUAGE_STORAGE_KEY, preference)
  localStorage.removeItem(LEGACY_LANGUAGE_STORAGE_KEY)
  return preference
}

/** The saved preference, else one moved from before the System option, else system. */
export function readLanguagePreference(): LanguagePreference {
  try {
    const value = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (value === 'system' || LANGUAGES.some((language) => language.code === value)) return value as LanguagePreference
    return migrateLegacyPreference() ?? 'system'
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
  void i18n.changeLanguage(resolveLanguage(next))
  listeners.forEach((listener) => listener())
}

/** Forgets the preference read from storage, so the next read starts over. For tests. */
export function resetLanguagePreference(): void {
  preference = undefined
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
  const apply = () => void i18n.changeLanguage(resolveLanguage(getLanguagePreference()))
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
