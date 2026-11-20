import { act, renderHook, screen } from '@testing-library/react'
import { useTranslation } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '.'
import { ToastProvider } from '../components/Toast'
import { failRussianLoads, russianUnreachable, withoutTexts } from '../test/languages'
import { saying } from '../test/render'
import en from './locales/en.json'
import ru from './locales/ru.json'
import {
  LANGUAGE_STORAGE_KEY,
  initLanguage,
  onLanguageUnavailable,
  readLanguagePreference,
  resolveLanguage,
  setLanguagePreference,
  showLanguage,
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

  it('defaults to system when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readLanguagePreference()).toBe('system')
  })
})

describe('showLanguage', () => {
  const unavailable = vi.fn()

  afterEach(() => {
    unavailable.mockReset()
  })

  it.each([
    ['en', en],
    ['ru', ru],
  ] as const)("loads the texts of a language the page doesn't have, then shows it: %s", async (language, texts) => {
    await act(() => i18n.changeLanguage(language === 'en' ? 'ru' : 'en'))
    withoutTexts(language)
    await act(async () => expect(await showLanguage(language)).toBe(true))
    expect(i18n.language).toBe(language)
    expect(i18n.hasResourceBundle(language, 'translation')).toBe(true)
    expect(i18n.t('theme.label')).toBe(texts.theme.label)
  })

  it('renders the texts once they arrive in the language already set, as the page does at startup', async () => {
    // No texts at all, so no English to fall back on either.
    withoutTexts('en')
    withoutTexts('ru')
    await act(() => i18n.changeLanguage('ru'))
    const { result } = renderHook(() => useTranslation())
    expect(result.current.t('language.label')).toBe('language.label')

    await act(() => showLanguage('ru'))
    expect(result.current.t('language.label')).toBe(ru.language.label)
    expect(i18n.resolvedLanguage).toBe('ru')
  })

  it('shows the language asked for last when an earlier one loads after it', async () => {
    withoutTexts('ru')
    const russian = showLanguage('ru')
    await act(() => showLanguage('en'))
    await act(() => russian)
    expect(i18n.language).toBe('en')
  })

  it("doesn't load a language's texts again once it has them", async () => {
    withoutTexts('ru')
    await act(() => showLanguage('ru'))
    await act(() => showLanguage('en'))
    failRussianLoads()
    onLanguageUnavailable(unavailable)

    await act(() => showLanguage('ru'))
    expect(i18n.language).toBe('ru')
    expect(unavailable).not.toHaveBeenCalled()
  })

  it("keeps the language shown and says so when a language's texts can't be loaded", async () => {
    russianUnreachable()
    onLanguageUnavailable(unavailable)

    await act(async () => expect(await showLanguage('ru')).toBe(false))
    expect(i18n.language).toBe('en')
    expect(unavailable).toHaveBeenCalledOnce()
  })

  it("says nothing of a language that can't be loaded once another was asked for", async () => {
    russianUnreachable()
    onLanguageUnavailable(unavailable)

    const russian = showLanguage('ru')
    await act(() => showLanguage('en'))
    await act(async () => expect(await russian).toBe(true))
    expect(i18n.language).toBe('en')
    expect(unavailable).not.toHaveBeenCalled()
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

  it("resolves to whether its language's texts could be loaded", async () => {
    await act(async () => expect(await setLanguagePreference('en')).toBe(true))
    russianUnreachable()
    await act(async () => expect(await setLanguagePreference('ru')).toBe(false))
    expect(i18n.language).toBe('en')
  })

  it('still switches for this page when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    await act(async () => setLanguagePreference('ru'))
    expect(i18n.language).toBe('ru')
  })

  it('updates every hook that shows it', async () => {
    const first = renderHook(() => useLanguage(), { wrapper: ToastProvider })
    const second = renderHook(() => useLanguage(), { wrapper: ToastProvider })
    expect(first.result.current.preference).toBe('system')

    await act(async () => first.result.current.setPreference('ru'))
    expect(first.result.current.preference).toBe('ru')
    expect(second.result.current.preference).toBe('ru')
  })
})

describe('useLanguage', () => {
  it("says in a toast, in the language still shown, that a choice's texts couldn't be loaded, and takes it back once a choice shows", async () => {
    const { result } = renderHook(() => useLanguage(), { wrapper: ToastProvider })
    russianUnreachable()

    await act(() => result.current.setPreference('ru'))
    expect(screen.getByRole('status', { name: saying(en.language.unavailable) })).toBeInTheDocument()
    expect(i18n.language).toBe('en')

    await act(() => result.current.setPreference('en'))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows no toast for a choice it shows', async () => {
    const { result } = renderHook(() => useLanguage(), { wrapper: ToastProvider })
    withoutTexts('ru')
    await act(() => result.current.setPreference('ru'))
    expect(i18n.language).toBe('ru')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
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
    const { result } = renderHook(() => useLanguage(), { wrapper: ToastProvider })

    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'ru')
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: LANGUAGE_STORAGE_KEY })))
    expect(result.current.preference).toBe('ru')
    expect(i18n.language).toBe('ru')
  })

  it('ignores a change to another key in another tab, and goes back to system when storage is cleared', async () => {
    stubBrowserLanguages(['en-US'])
    await act(async () => setLanguagePreference('ru'))
    stopFollowing = initLanguage()
    const { result } = renderHook(() => useLanguage(), { wrapper: ToastProvider })

    // Written straight to storage, as another tab would, without this tab's store knowing.
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en')
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: 'kinopeer.theme' })))
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
