import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '.'
import {
  LANGUAGE_STORAGE_KEY,
  LEGACY_LANGUAGE_STORAGE_KEY,
  initLanguage,
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

  it('ignores a value it does not know', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de')
    expect(readLanguagePreference()).toBe('system')
  })

  it("turns a language saved before the System option into system when it's the browser's, once", () => {
    const changeBrowserLanguages = stubBrowserLanguages(['ru-RU'])
    localStorage.setItem(LEGACY_LANGUAGE_STORAGE_KEY, 'ru-RU')
    expect(readLanguagePreference()).toBe('system')
    expect(localStorage.getItem(LEGACY_LANGUAGE_STORAGE_KEY)).toBeNull()

    // Moved for good: a later browser language doesn't make the old value a choice.
    changeBrowserLanguages(['en-US'])
    expect(readLanguagePreference()).toBe('system')
  })

  it("keeps a language saved before the System option that isn't the browser's, as a choice", () => {
    stubBrowserLanguages(['en-US'])
    localStorage.setItem(LEGACY_LANGUAGE_STORAGE_KEY, 'ru')
    expect(readLanguagePreference()).toBe('ru')
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ru')
  })

  it("turns a language saved before the System option that the app doesn't have into system", () => {
    stubBrowserLanguages(['en-US'])
    localStorage.setItem(LEGACY_LANGUAGE_STORAGE_KEY, 'de')
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

  it('updates every hook that shows it', async () => {
    const first = renderHook(() => useLanguage())
    const second = renderHook(() => useLanguage())
    expect(first.result.current.preference).toBe('system')

    await act(async () => first.result.current.setPreference('ru'))
    expect(first.result.current.preference).toBe('ru')
    expect(second.result.current.preference).toBe('ru')
  })
})

describe('following the browser', () => {
  let stopFollowing = () => {}

  afterEach(() => {
    stopFollowing()
    stopFollowing = () => {}
  })

  it("switches when the browser's languages change while the preference is system", async () => {
    const changeBrowserLanguages = stubBrowserLanguages(['en-US'])
    await act(async () => setLanguagePreference('system'))
    stopFollowing = initLanguage()

    await act(async () => changeBrowserLanguages(['ru-RU', 'en-US']))
    expect(i18n.language).toBe('ru')

    await act(async () => changeBrowserLanguages(['fr-FR']))
    expect(i18n.language).toBe('en')
  })

  it('keeps an explicit language when the browser changes', async () => {
    const changeBrowserLanguages = stubBrowserLanguages(['en-US'])
    await act(async () => setLanguagePreference('en'))
    stopFollowing = initLanguage()

    await act(async () => changeBrowserLanguages(['ru-RU']))
    expect(i18n.language).toBe('en')
  })

  it('takes a choice made in another tab', async () => {
    stubBrowserLanguages(['en-US'])
    stopFollowing = initLanguage()
    const { result } = renderHook(() => useLanguage())

    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'ru')
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: LANGUAGE_STORAGE_KEY })))
    expect(result.current.preference).toBe('ru')
    expect(i18n.language).toBe('ru')
  })

  it('ignores a change to another key in another tab, and goes back to system when storage is cleared', async () => {
    stubBrowserLanguages(['en-US'])
    await act(async () => setLanguagePreference('ru'))
    stopFollowing = initLanguage()
    const { result } = renderHook(() => useLanguage())

    // Written straight to storage, as another tab would, without this tab's store knowing.
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en')
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: 'kinoseed.theme' })))
    expect(result.current.preference).toBe('ru')

    localStorage.clear()
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: null })))
    expect(result.current.preference).toBe('system')
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
