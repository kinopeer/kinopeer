/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import {
  THEME_COLORS,
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

  it('updates the theme-color meta tag', () => {
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.append(meta)
    applyTheme('light')
    expect(meta.content).toBe(THEME_COLORS.light)
    applyTheme('dark')
    expect(meta.content).toBe(THEME_COLORS.dark)
    meta.remove()
  })

  it('uses each theme\'s background token as its theme color', () => {
    const tokens = readFileSync('src/styles/tokens.css', 'utf8')
    for (const theme of ['dark', 'light'] as const) {
      const block = tokens.slice(tokens.indexOf(`[data-theme='${theme}'] {`))
      expect(block).toMatch(new RegExp(`--bg: ${THEME_COLORS[theme]};`))
    }
  })
})
