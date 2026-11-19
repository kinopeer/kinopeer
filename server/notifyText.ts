import type { NotifyLanguage } from '../src/api/settings/types.ts'
import en from '../src/i18n/locales/en.json' with { type: 'json' }
import ru from '../src/i18n/locales/ru.json' with { type: 'json' }

/**
 * The texts of the notifications the server sends, from the app's own translation files (their
 * `notify` keys), so they're translated with the rest. The Docker image copies those files for it.
 */
const TEXTS: Record<NotifyLanguage, typeof en.notify> = { en: en.notify, ru: ru.notify }

export function isNotifyLanguage(value: unknown): value is NotifyLanguage {
  return typeof value === 'string' && Object.hasOwn(TEXTS, value)
}

/** A notification's text in `language`, with i18next's `{{name}}` placeholders filled from `values`. */
export function notifyText(language: NotifyLanguage, key: keyof typeof en.notify, values: Record<string, string> = {}): string {
  return TEXTS[language][key].replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? values[name] : placeholder,
  )
}

/**
 * The message for a finished download: its title from TMDB when known, then the torrent's name on
 * a line of its own, which says which release of the title it was; the name alone otherwise.
 */
export function finishedText(language: NotifyLanguage, name: string, title: string | undefined): string {
  return title ? `${notifyText(language, 'finished', { title })}\n${name}` : notifyText(language, 'finished', { title: name })
}
