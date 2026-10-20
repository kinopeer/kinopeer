import { afterEach, describe, expect, it } from 'vitest'
import {
  THEME_STORAGE_KEY,
  applyTheme,
  readThemePreference,
  resolveTheme,
  writeThemePreference,
} from './theme'

afterEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

describe('resolveTheme', () => {
  it('follows the system when preference is system', () => {
    expect(resolveTheme('system', true)).toBe('light')
    expect(resolveTheme('system', false)).toBe('dark')
  })

  it('uses an explicit preference regardless of the system', () => {
    expect(resolveTheme('dark', true)).toBe('dark')
    expect(resolveTheme('light', false)).toBe('light')
  })
})

describe('theme preference storage', () => {
  it('defaults to system', () => {
    expect(readThemePreference()).toBe('system')
  })

  it('round-trips a saved preference', () => {
    writeThemePreference('light')
    expect(readThemePreference()).toBe('light')
  })

  it('ignores unknown stored values', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia')
    expect(readThemePreference()).toBe('system')
  })
})

describe('applyTheme', () => {
  it('sets data-theme on the root element', () => {
    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
