import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/settings'
import type { DownloadDefaults, ServerSettings } from '../api/settings'
import i18n from '../i18n'
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  getSettings,
  loadServerSettings,
  resetSettings,
  useSettings,
  useTmdbLanguage,
} from './settings'

vi.mock('../api/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  getServerSettings: vi.fn(),
  saveDownloadDefaults: vi.fn(),
}))

function server(downloads: Partial<DownloadDefaults> | null): ServerSettings {
  return { tmdb: { configured: true, source: 'saved' }, qbittorrent: { configured: true, source: 'env' }, downloads }
}

beforeEach(() => {
  // The previous test's hooks may have read the settings again while unmounting.
  resetSettings()
  // No Kinoseed server unless a test sets one up.
  vi.mocked(api.getServerSettings).mockRejectedValue(new api.SettingsError(404))
  vi.mocked(api.saveDownloadDefaults).mockRejectedValue(new api.SettingsError(404))
})

afterEach(async () => {
  resetSettings()
  vi.clearAllMocks()
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

describe('download defaults on the server', () => {
  it("takes the server's defaults and keeps this browser's other preferences", async () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ movieCategory: 'Old', downloadsView: 'grid' }))
    vi.mocked(api.getServerSettings).mockResolvedValue(
      server({ movieCategory: null, tvCategory: 'TV Shows', startPaused: true, sequential: false }),
    )

    const { result } = renderHook(() => useSettings())

    await waitFor(() => expect(result.current[0].tvCategory).toBe('TV Shows'))
    expect(result.current[0]).toEqual({ ...DEFAULT_SETTINGS, tvCategory: 'TV Shows', startPaused: true, downloadsView: 'grid' })
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!)).toMatchObject({ startPaused: true, tvCategory: 'TV Shows' })
    expect(api.saveDownloadDefaults).not.toHaveBeenCalled()
    expect(api.getServerSettings).toHaveBeenCalledTimes(1)

    // Once per page.
    renderHook(() => useSettings())
    expect(api.getServerSettings).toHaveBeenCalledTimes(1)
  })

  it('sends the defaults this browser changed that the server has none of yet', async () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ movieCategory: 'Movies', sequential: true, downloadsView: 'grid' }))
    vi.mocked(api.getServerSettings).mockResolvedValue(server({ sequential: false }))
    vi.mocked(api.saveDownloadDefaults).mockResolvedValue(server({ sequential: false, movieCategory: 'Movies' }))

    const { result } = renderHook(() => useSettings())

    await waitFor(() => expect(api.saveDownloadDefaults).toHaveBeenCalledWith({ movieCategory: 'Movies' }))
    expect(result.current[0]).toMatchObject({ movieCategory: 'Movies', sequential: false })
  })

  it('sends nothing when the server has none and this browser kept the defaults', async () => {
    vi.mocked(api.getServerSettings).mockResolvedValue(server(null))
    renderHook(() => useSettings())
    await waitFor(() => expect(api.getServerSettings).toHaveBeenCalled())
    await act(() => Promise.resolve())
    expect(api.saveDownloadDefaults).not.toHaveBeenCalled()
  })

  it('saves a changed download default on the server, and nothing else', () => {
    const { result } = renderHook(() => useSettings())

    act(() => result.current[1]({ startPaused: true }))
    expect(api.saveDownloadDefaults).toHaveBeenLastCalledWith({ startPaused: true })
    act(() => result.current[1]({ movieCategory: undefined }))
    expect(api.saveDownloadDefaults).toHaveBeenLastCalledWith({ movieCategory: null })

    vi.mocked(api.saveDownloadDefaults).mockClear()
    act(() => result.current[1]({ downloadsView: 'grid', tmdbLanguage: 'ru-RU' }))
    expect(api.saveDownloadDefaults).not.toHaveBeenCalled()
  })

  it("doesn't let the server's defaults undo a change made while they were loading", async () => {
    let answer!: (settings: ServerSettings) => void
    vi.mocked(api.getServerSettings).mockReturnValue(new Promise((resolve) => (answer = resolve)))
    vi.mocked(api.saveDownloadDefaults).mockResolvedValue(server(null))
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(api.getServerSettings).toHaveBeenCalled())

    act(() => result.current[1]({ startPaused: true }))
    await act(async () => answer(server({ startPaused: false, sequential: true })))

    expect(result.current[0]).toMatchObject({ startPaused: true, sequential: true })
  })

  it("works from this browser's settings without a server, and asks again a minute later", async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ startPaused: true }))
      const { result } = renderHook(() => useSettings())
      await act(() => Promise.resolve())
      expect(result.current[0].startPaused).toBe(true)

      act(() => result.current[1]({ sequential: true }))
      expect(result.current[0].sequential).toBe(true)

      await act(async () => loadServerSettings())
      expect(api.getServerSettings).toHaveBeenCalledTimes(1)
      vi.setSystemTime(Date.now() + 61_000)
      await act(async () => loadServerSettings())
      expect(api.getServerSettings).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
