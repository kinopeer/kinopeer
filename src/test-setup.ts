import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import i18n from './i18n'
import { resetThemePreference } from './theme/theme'

// findBy* waits up to 1 s by default; the first test of a file on a busy CI runner can take longer.
configure({ asyncUtilTimeout: 3000 })

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  resetThemePreference()
})
