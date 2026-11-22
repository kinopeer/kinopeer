import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { setSignInNeed } from './api/auth/signInNeed'
import i18n from './i18n'
import { saves } from './logic/saves'
import { sharedRequests } from './logic/sharedRequests'
import { LANGUAGE_STORAGE_KEY, resetLanguagePreference } from './i18n/language'
import { giveBothLanguages } from './test/languages'
import { resetThemePreference } from './theme/theme'

// findBy* waits up to 1 s by default; the first test of a file on a busy CI runner can take longer.
configure({ asyncUtilTimeout: 3000 })

// jsdom has no layout, so window.scrollTo only logs "Not implemented" (useScrollRestoration calls it
// when a screen comes back through history). Every browser has it, so the stub lives here, not in
// the code. A test that checks the scrolling replaces it with its own mock.
window.scrollTo = () => {}

beforeEach(async () => {
  // The app loads a language's texts when it shows it (src/i18n/language.ts); every test has both
  // from the start, so it switches the language with i18n.changeLanguage and waits for nothing, and
  // one that took them away (src/test/languages.ts) leaves none missing for the next.
  giveBothLanguages()
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  // Answers one test's mocks gave aren't kept for the next.
  sharedRequests.clear()
  // A save one test left in flight doesn't hold the next test's sheet busy.
  saves.clear()
  // A request one test's server held back doesn't keep the next test's app at the sign-in.
  setSignInNeed(null)
  resetThemePreference()
  // Every test starts in English (above), so a language chosen in one test doesn't stay saved for the next.
  localStorage.removeItem(LANGUAGE_STORAGE_KEY)
  resetLanguagePreference()
})
