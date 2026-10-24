import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, getSettings, resetSettings, useSettings, useTmdbLanguage } from './settings'

afterEach(async () => {
  resetSettings()
  await i18n.changeLanguage('en')
})

describe('settings', () => {
  it('starts from the defaults and keeps changes in localStorage', () => {
    expect(getSettings()).toEqual(DEFAULT_SETTINGS)
    const { result } = renderHook(() => useSettings())
    act(() => result.current[1]({ movieCategory: 'Movies', startPaused: true }))
    expect(result.current[0]).toMatchObject({ movieCategory: 'Movies', startPaused: true, sequential: false })
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!)).toMatchObject({ movieCategory: 'Movies' })
  })

  it('shows downloads as a list until a grid is picked, and remembers the pick', () => {
    expect(getSettings().downloadsView).toBe('list')
    const { result } = renderHook(() => useSettings())
    act(() => result.current[1]({ downloadsView: 'grid' }))
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!)).toMatchObject({ downloadsView: 'grid' })
    resetSettings()
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ downloadsView: 'grid' }))
    expect(getSettings().downloadsView).toBe('grid')
  })

  it('ignores unreadable storage', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{not json')
    expect(getSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('follows the app language for TMDB unless one is chosen', async () => {
    const { result } = renderHook(() => [useTmdbLanguage(), useSettings()[1]] as const)
    expect(result.current[0]).toBe('en-US')
    await act(() => i18n.changeLanguage('ru'))
    expect(result.current[0]).toBe('ru-RU')
    act(() => result.current[1]({ tmdbLanguage: 'en-US' }))
    expect(result.current[0]).toBe('en-US')
  })
})
