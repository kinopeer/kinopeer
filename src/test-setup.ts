import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import i18n from './i18n'
import { LANGUAGE_STORAGE_KEY, LEGACY_LANGUAGE_STORAGE_KEY, resetLanguagePreference } from './i18n/language'
import { resetThemePreference } from './theme/theme'

// findBy* waits up to 1 s by default; the first test of a file on a busy CI runner can take longer.
configure({ asyncUtilTimeout: 3000 })

// jsdom has no layout, so window.scrollTo only logs "Not implemented" (useScrollRestoration calls it
// when a screen comes back through history). Every browser has it, so the stub lives here, not in
// the code. A test that checks the scrolling replaces it with its own mock.
window.scrollTo = () => {}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  resetThemePreference()
  // Every test starts in English (above), so a language chosen in one test doesn't stay saved for the next.
  localStorage.removeItem(LANGUAGE_STORAGE_KEY)
  localStorage.removeItem(LEGACY_LANGUAGE_STORAGE_KEY)
  resetLanguagePreference()
})
