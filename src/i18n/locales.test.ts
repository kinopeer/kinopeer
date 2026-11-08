import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import ru from './locales/ru.json'

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null ? keys(value, `${prefix}${key}.`) : [`${prefix}${key}`],
  )
}

// i18next plural suffixes differ by language (en: one/other, ru: one/few/many/other).
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/

function baseKeys(obj: object): string[] {
  return [...new Set(keys(obj).map((k) => k.replace(PLURAL_SUFFIX, '')))].sort()
}

function valueOf(locale: object, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], locale)
}

describe('locales', () => {
  it('have the same keys in every language', () => {
    expect(baseKeys(ru)).toEqual(baseKeys(en))
  })

  it('have no empty strings', () => {
    for (const locale of [en, ru]) {
      for (const key of keys(locale)) {
        expect(valueOf(locale, key), key).not.toBe('')
      }
    }
  })

  it('nest only keys that exist, so a renamed key never shows as its own name', () => {
    for (const locale of [en, ru]) {
      // A plural is nested by its base key, `$t(key, {"count": n})`, which picks the form.
      const nestable = new Set([...keys(locale), ...baseKeys(locale)])
      for (const key of keys(locale)) {
        for (const [, nested] of String(valueOf(locale, key)).matchAll(/\$t\(([^),]+)/g)) expect(nestable.has(nested), `${key} nests ${nested}`).toBe(true)
      }
    }
  })

  it("keep TMDB's required notice in its English wording", () => {
    // TMDB's API terms ask for this exact text, so no language translates it (Settings → About).
    for (const locale of [en, ru]) {
      expect(locale.settings.tmdbNotice).toBe('This product uses the TMDB API but is not endorsed or certified by TMDB.')
    }
  })
})
