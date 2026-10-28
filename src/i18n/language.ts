import i18n from 'i18next'

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'ru', name: 'Русский' },
] as const

export type Language = (typeof LANGUAGES)[number]['code']
export type LanguagePreference = 'system' | Language

export const LANGUAGE_STORAGE_KEY = 'kinoseed.lang'

/** The app's language for a tag by its base language ('ru-RU' → 'ru'), or null if the app doesn't have it. */
export function toLanguage(tag: string): Language | null {
  const base = tag.toLowerCase().split('-')[0]
  return LANGUAGES.find((language) => language.code === base)?.code ?? null
}

/**
 * The saved preference, else system. Before the System option the language detector saved the
 * detected language here on every start, so a value from then is taken as the user's choice: it
 * can't be told apart from one they picked, and keeping it changes nothing they see.
 */
export function readLanguagePreference(): LanguagePreference {
  try {
    const value = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (value === 'system') return value
    if (value) return toLanguage(value) ?? 'system'
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
 * Follows the browser's languages for as long as the page is open, while the preference is system.
 * Returns a function that stops it.
 */
export function watchSystemLanguage(): () => void {
  const listener = () => {
    if (getLanguagePreference() === 'system') void i18n.changeLanguage(systemLanguage())
  }
  window.addEventListener('languagechange', listener)
  return () => window.removeEventListener('languagechange', listener)
}
