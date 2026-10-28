import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '.'
import {
  LANGUAGE_STORAGE_KEY,
  readLanguagePreference,
  resolveLanguage,
  setLanguagePreference,
  systemLanguage,
  watchSystemLanguage,
  writeLanguagePreference,
} from './language'
import { useLanguage } from './useLanguage'

/** Makes the browser prefer these languages; returns a function that changes them as the browser would. */
function stubBrowserLanguages(languages: string[]): (next: string[]) => void {
  const spy = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages)
  return (next) => {
    spy.mockReturnValue(next)
    window.dispatchEvent(new Event('languagechange'))
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('systemLanguage', () => {
  it('takes the first of the browser languages the app has, by base language', () => {
    expect(systemLanguage(['de-DE', 'RU-ru', 'en-US'])).toBe('ru')
    expect(systemLanguage(['en-GB', 'ru'])).toBe('en')
  })

  it('falls back to English when the app has none of them', () => {
    expect(systemLanguage(['de-DE', 'fr'])).toBe('en')
    expect(systemLanguage([])).toBe('en')
  })

  it("reads the browser's languages by default", () => {
    stubBrowserLanguages(['uk-UA', 'ru-RU'])
    expect(systemLanguage()).toBe('ru')
  })

  it("reads the browser's one language where it has no list", () => {
    stubBrowserLanguages([])
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ru-RU')
    expect(systemLanguage()).toBe('ru')
  })
})

describe('resolveLanguage', () => {
  it('follows the browser when the preference is system', () => {
    expect(resolveLanguage('system', ['ru-RU'])).toBe('ru')
  })

  it('uses an explicit preference regardless of the browser', () => {
    expect(resolveLanguage('en', ['ru-RU'])).toBe('en')
  })
})

describe('language preference storage', () => {
  it('defaults to system', () => {
    expect(readLanguagePreference()).toBe('system')
  })

  it('round-trips a saved preference', () => {
    writeLanguagePreference('ru')
    expect(readLanguagePreference()).toBe('ru')
    writeLanguagePreference('system')
    expect(readLanguagePreference()).toBe('system')
  })

  it('keeps a language saved before the System option, region and all', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'ru-RU')
    expect(readLanguagePreference()).toBe('ru')
  })

  it('ignores a language the app does not have', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de')
    expect(readLanguagePreference()).toBe('system')
  })

  it('defaults to system when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readLanguagePreference()).toBe('system')
  })
})

describe('setLanguagePreference', () => {
  it('saves the preference and switches to its language', async () => {
    stubBrowserLanguages(['ru-RU'])
    await act(async () => setLanguagePreference('system'))
    expect(i18n.language).toBe('ru')
    expect(document.documentElement.lang).toBe('ru')
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('system')

    await act(async () => setLanguagePreference('en'))
    expect(i18n.language).toBe('en')
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en')
  })

  it('still switches for this page when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    await act(async () => setLanguagePreference('ru'))
    expect(i18n.language).toBe('ru')
  })

  it('updates every hook that shows it', () => {
    const first = renderHook(() => useLanguage())
    const second = renderHook(() => useLanguage())
    expect(first.result.current.preference).toBe('system')

    act(() => first.result.current.setPreference('ru'))
    expect(first.result.current.preference).toBe('ru')
    expect(second.result.current.preference).toBe('ru')
  })
})

describe('following the browser', () => {
  it("switches when the browser's languages change while the preference is system", async () => {
    const changeBrowserLanguages = stubBrowserLanguages(['en-US'])
    setLanguagePreference('system')

    // The listener the app installs when it starts.
    await act(async () => changeBrowserLanguages(['ru-RU', 'en-US']))
    expect(i18n.language).toBe('ru')

    await act(async () => changeBrowserLanguages(['fr-FR']))
    expect(i18n.language).toBe('en')
  })

  it('keeps an explicit language when the browser changes', async () => {
    const changeBrowserLanguages = stubBrowserLanguages(['en-US'])
    setLanguagePreference('en')

    await act(async () => changeBrowserLanguages(['ru-RU']))
    expect(i18n.language).toBe('en')
  })

  it('stops following the browser once stopped', () => {
    const changeBrowserLanguages = stubBrowserLanguages(['en-US'])
    const onChange = vi.fn()
    const stop = watchSystemLanguage(onChange)

    changeBrowserLanguages(['ru-RU'])
    expect(onChange).toHaveBeenLastCalledWith('ru')

    stop()
    changeBrowserLanguages(['en-US'])
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
