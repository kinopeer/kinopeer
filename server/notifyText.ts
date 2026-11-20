import type { NotifyLanguage } from '../src/api/settings/types.ts'
import en from './locales/en.json' with { type: 'json' }
import ru from './locales/ru.json' with { type: 'json' }

/**
 * The texts of the notifications the server sends, in translation files of the server's own
 * (`server/locales/`), so the app's bundle, which never shows them, doesn't carry them.
 */
const TEXTS: Record<NotifyLanguage, typeof en> = { en, ru }

export function isNotifyLanguage(value: unknown): value is NotifyLanguage {
  return typeof value === 'string' && Object.hasOwn(TEXTS, value)
}

/** A notification's text in `language`, with i18next's `{{name}}` placeholders filled from `values`. */
export function notifyText(language: NotifyLanguage, key: keyof typeof en, values: Record<string, string> = {}): string {
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
