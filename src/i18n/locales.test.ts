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

  it("give every plural all of its language's forms", () => {
    // i18next 27.1 fills a missing form in from the same language's `_other`, which in Russian is
    // the wrong grammar for that count, so a missing form would show with no error.
    const forms = { en: ['one', 'other'], ru: ['few', 'many', 'one', 'other'] }
    for (const [language, locale] of [['en', en], ['ru', ru]] as const) {
      const all = new Set(keys(locale))
      const plurals = new Set(keys(locale).filter((k) => PLURAL_SUFFIX.test(k)).map((k) => k.replace(PLURAL_SUFFIX, '')))
      expect(plurals.size, language).toBeGreaterThan(0)
      for (const base of plurals) {
        expect(forms[language].filter((form) => !all.has(`${base}_${form}`)), `${language} ${base}`).toEqual([])
      }
    }
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
