/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { renderHook, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  THEME_COLORS,
  THEME_STORAGE_KEY,
  applyTheme,
  initTheme,
  readThemePreference,
  resolveTheme,
  setThemePreference,
  writeThemePreference,
} from './theme'
import { useTheme } from './useTheme'

afterEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
  vi.unstubAllGlobals()
})

/** Stubs matchMedia with a system that prefers light or dark; returns a function that switches it. */
function stubSystemTheme(prefersLight: boolean): (prefersLight: boolean) => void {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const query = {
    get matches() {
      return prefersLight
    },
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
  }
  vi.stubGlobal('matchMedia', () => query)
  return (next) => {
    prefersLight = next
    listeners.forEach((listener) => listener({ matches: next } as MediaQueryListEvent))
  }
}

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

describe('initTheme', () => {
  it('applies the theme the preference and the system resolve to', () => {
    stubSystemTheme(true)
    initTheme()()
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('follows a change of the system theme while the preference is system', () => {
    const setSystem = stubSystemTheme(false)
    const stop = initTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')

    setSystem(true)
    expect(document.documentElement.dataset.theme).toBe('light')
    setSystem(false)
    expect(document.documentElement.dataset.theme).toBe('dark')
    stop()
  })

  it('keeps an explicit theme when the system theme changes', () => {
    const setSystem = stubSystemTheme(false)
    const stop = initTheme()
    setThemePreference('dark')

    setSystem(true)
    expect(document.documentElement.dataset.theme).toBe('dark')
    stop()
  })

  it('follows the system again after switching back to system', () => {
    const setSystem = stubSystemTheme(false)
    const stop = initTheme()
    setThemePreference('dark')
    setThemePreference('system')

    setSystem(true)
    expect(document.documentElement.dataset.theme).toBe('light')
    stop()
  })

  it('stops following the system once stopped', () => {
    const setSystem = stubSystemTheme(false)
    initTheme()()

    setSystem(true)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})

describe('useTheme', () => {
  it('reads the saved preference', () => {
    writeThemePreference('light')
    const { result } = renderHook(() => useTheme())
    expect(result.current.preference).toBe('light')
  })

  it('shares a change with every component that uses it', () => {
    const first = renderHook(() => useTheme())
    const second = renderHook(() => useTheme())

    act(() => first.result.current.setPreference('light'))
    expect(second.result.current.preference).toBe('light')
    expect(readThemePreference()).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
